import { sb } from '../supabase'

// Unit Franchise Agreement — generate, load, and sign. Mirrors how the
// enrollment invoice is generated (franchisees.registered_courses joined
// against skus.uf_rate) so nothing about a specific franchisee is ever
// hand-typed; the terms are snapshotted into the row at generation time so
// a later fee change or re-registration never rewrites an already-signed
// contract underneath the franchisee.

export async function loadLatestAgreement(franchiseeId) {
  const { data } = await sb.from('franchisee_agreements')
    .select('*')
    .eq('franchisee_id', franchiseeId)
    .order('generated_at', { ascending: false })
    .limit(1)
  return (data && data[0]) || null
}

// Builds the courses/kit snapshot and inserts a new draft row. `generatedBy`
// is the admin's email, recorded for audit only.
export async function generateAgreement(franchisee, generatedBy) {
  const [courseRes, allSkuRes] = await Promise.all([
    (franchisee.registered_courses && franchisee.registered_courses.length)
      ? sb.from('courses').select('id, group_name, name').in('id', franchisee.registered_courses)
      : Promise.resolve({ data: [] }),
    (franchisee.registered_courses && franchisee.registered_courses.length)
      ? sb.from('skus').select('course_id, level_name, uf_rate').in('course_id', franchisee.registered_courses)
      : Promise.resolve({ data: [] }),
  ])
  const coursesById = {}
  ;(courseRes.data || []).forEach(function (c) { coursesById[c.id] = c })

  const courseNames = Array.from(new Set(
    (courseRes.data || []).map(function (c) { return c.group_name || c.name }).filter(Boolean)
  )).sort()

  const kit = (allSkuRes.data || [])
    .map(function (s) {
      const c = coursesById[s.course_id]
      return c ? { course: c.group_name || c.name, level: s.level_name, rate: s.uf_rate || 0 } : null
    })
    .filter(Boolean)
    .sort(function (a, b) { return (a.course + a.level).localeCompare(b.course + b.level) })

  const start = franchisee.contract_start || franchisee.created_at
  const startDate = new Date(String(start).length <= 10 ? start + 'T00:00:00' : start)
  const endDate = new Date(startDate)
  endDate.setFullYear(endDate.getFullYear() + 3)
  endDate.setDate(endDate.getDate() - 1)

  const row = {
    franchisee_id: franchisee.id,
    fee: franchisee.enrollment_fee || 0,
    term_years: 3,
    term_start: startDate.toISOString().slice(0, 10),
    term_end: endDate.toISOString().slice(0, 10),
    courses: courseNames,
    kit: kit,
    generated_by: generatedBy || null,
  }

  const { data, error } = await sb.from('franchisee_agreements').insert(row).select('*').single()
  if (error) throw error
  return data
}

// School Program Partnership Agreement. Kit rates are what HO actually bills
// this school (school_sku_rates), falling back to the default rate only for a
// level with no school-specific rate. Term runs from today to 30 April of the
// following calendar year (the Academic-Year convention in the agreement).
// opts: { model: 'inhouse' | 'full_service', repName, repTitle,
//         charges: [{ course, level, charge, frequency }] }
export async function generateSchoolAgreement(school, opts, generatedBy) {
  const o = opts || {}
  const courseIds = school.registered_courses || []
  const [courseRes, skuRes, rateRes] = await Promise.all([
    courseIds.length ? sb.from('courses').select('id, group_name, name').in('id', courseIds) : Promise.resolve({ data: [] }),
    courseIds.length ? sb.from('skus').select('id, course_id, level_name, age_range, uf_rate, sort_order').in('course_id', courseIds) : Promise.resolve({ data: [] }),
    sb.from('school_sku_rates').select('sku_id, rate').eq('franchisee_id', school.id),
  ])
  const coursesById = {}
  ;(courseRes.data || []).forEach(function (c) { coursesById[c.id] = c })
  const billed = {}
  ;(rateRes.data || []).forEach(function (r) { billed[r.sku_id] = r.rate })
  const hasBilled = Object.keys(billed).length > 0

  const kit = (skuRes.data || [])
    .filter(function (s) { return !hasBilled || billed[s.id] != null })
    .map(function (s) {
      const c = coursesById[s.course_id]
      if (!c) return null
      return { course: c.group_name || c.name, level: s.level_name, age: s.age_range || '', rate: billed[s.id] != null ? billed[s.id] : (s.uf_rate || 0), _o: s.sort_order || 0 }
    })
    .filter(Boolean)
    .sort(function (a, b) { return a.course.localeCompare(b.course) || (a._o - b._o) })
    .map(function (k) { return { course: k.course, level: k.level, age: k.age, rate: k.rate } })

  const courseNames = Array.from(new Set(kit.map(function (k) { return k.course }))).sort()

  const start = new Date()
  const end = new Date(start.getFullYear() + 1, 3, 30) // 30 April next calendar year
  function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') }

  const full = o.model === 'full_service'
  const row = {
    franchisee_id: school.id,
    kind: 'school',
    service_model: full ? 'full_service' : 'inhouse',
    fee: 0,
    term_years: 1,
    term_start: iso(start),
    term_end: iso(end),
    courses: courseNames,
    kit: kit,
    extra: {
      rep_name: (o.repName || school.owner_name || '').trim(),
      rep_title: (o.repTitle || 'Principal').trim(),
      full_service_charges: full ? (o.charges || []).filter(function (c) { return c.course && c.charge }) : [],
    },
    generated_by: generatedBy || null,
  }
  const { data, error } = await sb.from('franchisee_agreements').insert(row).select('*').single()
  if (error) throw error
  return data
}

// Best-effort public IP lookup for the signature audit trail — the sign
// action still succeeds if this fails (e.g. offline, blocked), just with a
// blank IP on record.
async function lookupIp() {
  try {
    const res = await fetch('https://api.ipify.org?format=json')
    const j = await res.json()
    return j.ip || null
  } catch (e) { return null }
}

async function sha256Hex(text) {
  try {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
    return Array.from(new Uint8Array(buf)).map(function (b) { return b.toString(16).padStart(2, '0') }).join('')
  } catch (e) { return null }
}

// Clickwrap e-signature: typed legal name + explicit "I agree" consent,
// already tied to the franchisee's authenticated login (RLS scopes the
// update to their own row) — plus a timestamp, best-effort IP, and a hash
// of the exact terms they agreed to, so the signed record is tamper-evident
// without needing a third-party e-sign provider.
export async function signAgreement(agreement, typedName) {
  const ip = await lookupIp()
  const hash = await sha256Hex(JSON.stringify({
    agreement_no: agreement.agreement_no,
    fee: agreement.fee,
    term_start: agreement.term_start,
    term_end: agreement.term_end,
    courses: agreement.courses,
    kit: agreement.kit,
    signed_name: typedName,
  }))
  const { data, error } = await sb.from('franchisee_agreements')
    .update({
      status: 'signed',
      signed_name: typedName,
      signed_at: new Date().toISOString(),
      signed_ip: ip,
      doc_hash: hash,
    })
    .eq('id', agreement.id)
    .select('*')
    .single()
  if (error) throw error
  return data
}
