import { sb } from '../supabase'

// Full-Service school billing: monthly instructor (CI) invoices are ordinary
// rows in `orders` (kind='service'), one per school per month, using the same
// INV series and the same Orders screens as kit invoices. The CF commission
// lives ONLY in admin-only tables (cf_commission_terms / order_commission_lines)
// so a school or CF login can never read it.

export function monthFirst(d) {
  const dt = d instanceof Date ? d : new Date(String(d).length <= 10 ? d + 'T00:00:00' : d)
  return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-01'
}

function monthLastIso(firstIso) {
  const d = new Date(firstIso + 'T00:00:00')
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0)
  return last.getFullYear() + '-' + String(last.getMonth() + 1).padStart(2, '0') + '-' + String(last.getDate()).padStart(2, '0')
}

export function monthLabel(firstIso) {
  return new Date(firstIso + 'T00:00:00').toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
}

export function lineDescription(program, level, firstIso) {
  return 'Instructor services — ' + program + (level ? ' · ' + level : '') + ' · ' + monthLabel(firstIso)
}

// CI appointments that are active at any point in the month.
export function activeInMonth(rows, firstIso) {
  const last = monthLastIso(firstIso)
  return (rows || []).filter(function (r) {
    return r.starts_on <= last && (!r.ends_on || r.ends_on >= firstIso)
  })
}

// Groups appointments into invoice lines: same program + level + charge => one line, qty = number of CIs.
export function groupServiceLines(rows, firstIso) {
  const map = {}
  activeInMonth(rows, firstIso).forEach(function (r) {
    const key = [r.program, r.level_label || '', r.monthly_charge].join('|')
    if (!map[key]) {
      map[key] = {
        key: key, program: r.program, level: r.level_label || '', rate: r.monthly_charge, qty: 0,
        description: lineDescription(r.program, r.level_label, firstIso), ciIds: [],
      }
    }
    map[key].qty += 1
    map[key].ciIds.push(r.id)
  })
  return Object.values(map)
}

// Creates one pending service invoice per Full-Service school for the month.
// Never creates a second one for the same school + month (also enforced by a
// unique index). Returns { created: [...], skipped: [...] } for the UI to show.
export async function generateServiceInvoices(monthIso, opts) {
  const o = opts || {}
  const first = monthFirst(monthIso)
  const out = { created: [], skipped: [] }

  let q = sb.from('franchisees').select('id, business_name, owner_name, parent_id, status').eq('tier', 'SCHOOL').eq('status', 'active')
  if (o.schoolId) q = q.eq('id', o.schoolId)
  const { data: schools, error: sErr } = await q
  if (sErr) throw sErr
  if (!schools || !schools.length) return out
  const ids = schools.map(function (s) { return s.id })

  const [ciRes, agRes, existRes, parentRes] = await Promise.all([
    sb.from('school_ci_assignments').select('*').in('school_id', ids),
    sb.from('franchisee_agreements').select('franchisee_id, service_model, kind, generated_at').in('franchisee_id', ids).eq('kind', 'school').order('generated_at', { ascending: false }),
    sb.from('orders').select('bill_to_franchisee_id').eq('kind', 'service').eq('service_month', first).is('invoice_cancelled_at', null).in('bill_to_franchisee_id', ids),
    sb.from('franchisees').select('id, tier').in('id', schools.map(function (s) { return s.parent_id }).filter(Boolean)),
  ])
  const modelBySchool = {}
  ;(agRes.data || []).forEach(function (a) { if (!(a.franchisee_id in modelBySchool)) modelBySchool[a.franchisee_id] = a.service_model })
  const already = {}
  ;(existRes.data || []).forEach(function (e) { already[e.bill_to_franchisee_id] = true })
  const parentTier = {}
  ;(parentRes.data || []).forEach(function (p) { parentTier[p.id] = p.tier })

  for (const school of schools) {
    const name = school.business_name || school.owner_name
    if (already[school.id]) { out.skipped.push({ school: name, reason: 'Already invoiced for ' + monthLabel(first) }); continue }
    if (modelBySchool[school.id] !== 'full_service') { out.skipped.push({ school: name, reason: 'Not a Full-Service school (no Full-Service agreement)' }); continue }
    const lines = groupServiceLines((ciRes.data || []).filter(function (c) { return c.school_id === school.id }), first)
    if (!lines.length) { out.skipped.push({ school: name, reason: 'No CIs appointed for ' + monthLabel(first) }); continue }

    const placerIsParent = school.parent_id && (parentTier[school.parent_id] === 'CF' || parentTier[school.parent_id] === 'SMF')
    const total = lines.reduce(function (s, l) { return s + l.qty * l.rate }, 0)
    const { data: order, error: oErr } = await sb.from('orders').insert({
      kind: 'service',
      service_month: first,
      placer_id: placerIsParent ? school.parent_id : school.id,
      placer_tier: placerIsParent ? parentTier[school.parent_id] : 'UF',
      bill_to_franchisee_id: school.id,
      bill_to_name: name,
      status: 'pending',
      subtotal: total,
      grand_total: total,
      notes: 'Instructor services — ' + monthLabel(first),
    }).select().single()
    if (oErr) { out.skipped.push({ school: name, reason: oErr.message }); continue }

    const { error: iErr } = await sb.from('order_items').insert(lines.map(function (l) {
      return { order_id: order.id, description: l.description, ordered_qty: l.qty, sent_qty: l.qty, rate: l.rate, excluded_kit_items: [] }
    }))
    if (iErr) { out.skipped.push({ school: name, reason: 'Invoice created but lines failed: ' + iErr.message }); continue }
    out.created.push({ school: name, order_ref: order.order_ref, total: total })
  }
  return out
}

// ── CF commission snapshot (admin-only) ───────────────────────────────────
// Stamped when an order is invoiced so later changes to the terms never
// rewrite it. Idempotent. Kit orders: fixed Rs per kit per SKU. Service
// orders: fixed Rs per CI per month.
export async function snapshotOrderCommission(order) {
  try {
    const { data: have } = await sb.from('order_commission_lines').select('id').eq('order_id', order.id).limit(1)
    if (have && have.length) return
    const schoolId = order.bill_to_franchisee_id
    if (!schoolId) return
    const { data: items } = await sb.from('order_items').select('id, sku_id, description, ordered_qty, rate').eq('order_id', order.id)
    const rows = []

    if (order.kind === 'service') {
      const first = order.service_month
      const { data: cis } = await sb.from('school_ci_assignments').select('*').eq('school_id', schoolId)
      const active = activeInMonth(cis || [], first)
      if (!active.length) return
      const { data: terms } = await sb.from('cf_commission_terms').select('ci_assignment_id, share_amount').eq('kind', 'ci').in('ci_assignment_id', active.map(function (c) { return c.id }))
      const shareByCi = {}
      ;(terms || []).forEach(function (t) { shareByCi[t.ci_assignment_id] = t.share_amount })
      active.forEach(function (c) {
        const share = shareByCi[c.id] || 0
        if (share <= 0) return
        const desc = lineDescription(c.program, c.level_label, first)
        const item = (items || []).find(function (i) { return i.description === desc && i.rate === c.monthly_charge })
        rows.push({ order_id: order.id, order_item_id: item ? item.id : null, kind: 'ci', description: c.ci_name + ' · ' + desc, qty: 1, share_amount: share })
      })
    } else {
      const skuItems = (items || []).filter(function (i) { return i.sku_id })
      if (!skuItems.length) return
      const { data: terms } = await sb.from('cf_commission_terms').select('sku_id, share_amount').eq('kind', 'kit').eq('school_id', schoolId).in('sku_id', skuItems.map(function (i) { return i.sku_id }))
      const shareBySku = {}
      ;(terms || []).forEach(function (t) { shareBySku[t.sku_id] = t.share_amount })
      skuItems.forEach(function (i) {
        const share = shareBySku[i.sku_id] || 0
        if (share > 0) rows.push({ order_id: order.id, order_item_id: i.id, kind: 'kit', description: null, qty: null, share_amount: share })
      })
    }
    if (rows.length) await sb.from('order_commission_lines').insert(rows)
  } catch (e) {
    console.warn('[commission snapshot] failed:', e.message)
  }
}

// Total + breakdown for the Raise Credit Note screen. Falls back to stamping a
// snapshot now for orders invoiced before this existed.
export async function computeOrderCommission(order) {
  let { data: lines } = await sb.from('order_commission_lines').select('*').eq('order_id', order.id)
  if (!lines || !lines.length) {
    await snapshotOrderCommission(order)
    ;({ data: lines } = await sb.from('order_commission_lines').select('*').eq('order_id', order.id))
  }
  const { data: items } = await sb.from('order_items')
    .select('id, sent_qty, ordered_qty, skus(level_name, courses(group_name))').eq('order_id', order.id)
  const itemById = {}
  ;(items || []).forEach(function (i) { itemById[i.id] = i })

  const parts = (lines || []).map(function (l) {
    const it = l.order_item_id ? itemById[l.order_item_id] : null
    const qty = l.qty != null ? l.qty : (it ? ((it.sent_qty && it.sent_qty > 0) ? it.sent_qty : (it.ordered_qty || 0)) : 0)
    const label = l.description || (it && it.skus ? ((it.skus.courses && it.skus.courses.group_name) || 'Kit') + ' — ' + (it.skus.level_name || '') : 'Kit')
    return { label: label, qty: qty, share: l.share_amount, amount: qty * l.share_amount }
  })
  return { parts: parts, total: parts.reduce(function (s, p) { return s + p.amount }, 0) }
}
