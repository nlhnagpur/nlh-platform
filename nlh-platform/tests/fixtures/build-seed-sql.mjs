// Generates docs/phase-2/stage-0/synthetic_seed.sql from the synthetic dataset.
//
//   node tests/fixtures/build-seed-sql.mjs
//
// Pure file generation: reads tests/fixtures/synthetic-dataset.mjs, writes one
// .sql file. It opens no database connection and reads no environment
// variable. The generated SQL is meant for an ISOLATED database only and
// refuses to run anywhere that holds non-synthetic students or franchisees.
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { centres, courses, skus, students, enrolmentId, invoiceId, paymentId } from './synthetic-dataset.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const out = resolve(here, '../../docs/phase-2/stage-0/synthetic_seed.sql')

function q(v) {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'number') return String(v)
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  return "'" + String(v).replace(/'/g, "''") + "'"
}
const skuBy = Object.fromEntries(skus.map(function (s) { return [s.key, s] }))
const courseBy = Object.fromEntries(courses.map(function (c) { return [c.key, c] }))
function initialStatus(total) { return Number(total) === 0 ? 'none' : 'pending' }
// Same rule as the app's deriveStatus and the DB trigger.
function statusOf(total, paid) { total = Number(total) || 0; paid = Number(paid) || 0; return total === 0 ? 'none' : paid <= 0 ? 'pending' : paid >= total ? 'paid' : 'partial' }

const L = []
const push = function (s) { L.push(s) }

push('-- ============================================================================')
push('-- SYNTHETIC SEED — Phase 2, Stage 0.  GENERATED FILE: do not edit by hand.')
push('-- Source: tests/fixtures/synthetic-dataset.mjs  (regenerate with build-seed-sql.mjs)')
push('--')
push('-- !! ISOLATED DATABASE ONLY (Supabase branch / local Postgres). NEVER production. !!')
push('--')
push('-- Safety interlocks (the script aborts, changing nothing, if any fails):')
push("--   1. you must have run   set nlh.allow_synthetic_seed = 'on';   in the same session;")
push("--   2. public.students must contain no row whose notes do not start 'SYNTHETIC';")
push("--   3. public.franchisees must contain no row whose business_name does not start 'SYN '.")
push('-- The live project holds real students, so interlock 2 stops it there.')
push('-- ============================================================================')
push('begin;')
push('')
push('do $guard$')
push('begin')
push("  if coalesce(current_setting('nlh.allow_synthetic_seed', true), '') <> 'on' then")
push("    raise exception 'Synthetic seed refused: run  set nlh.allow_synthetic_seed = ''on'';  first (isolated databases only).';")
push('  end if;')
push("  if exists (select 1 from public.students where coalesce(notes, '') not like 'SYNTHETIC%') then")
push("    raise exception 'Synthetic seed refused: non-synthetic students exist - this looks like a real database.';")
push('  end if;')
push("  if exists (select 1 from public.franchisees where business_name not like 'SYN %') then")
push("    raise exception 'Synthetic seed refused: non-synthetic franchisees exist - this looks like a real database.';")
push('  end if;')
push('end $guard$;')
push('')

push('-- Centres (parents first)')
centres.forEach(function (c) {
  push('insert into public.franchisees (id, parent_id, tier, business_name, owner_name, phone, email, city, state, status, enrollment_fee, registered_courses)')
  push('values (' + [q(c.id), q(c.parent ? centres.find(function (x) { return x.key === c.parent }).id : null), q(c.tier), q(c.name), q('SYN Owner ' + c.key), q(c.phone), q(c.email), q(c.city), q(c.state), q('active'), 0, "'{}'"].join(', ') + ');')
})
push('')
push('-- Courses and levels (SKUs)')
courses.forEach(function (c) {
  push('insert into public.courses (id, name, group_name, billing_type, is_active) values (' + [q(c.id), q(c.name), q(c.name), q(c.billing), 'true'].join(', ') + ');')
})
skus.forEach(function (s) {
  push('insert into public.skus (id, course_id, level_name, student_fee, total_sessions, is_active) values (' + [q(s.id), q(courseBy[s.course].id), q(s.level), s.fee, s.sessions === null ? 'null' : s.sessions, 'true'].join(', ') + ');')
})
push('')

students.forEach(function (st, si) {
  push('-- ' + st.key + ' — ' + st.scenario)
  push('insert into public.students (id, full_name, parent_name, phone, email, city, state, country, address, channel, franchisee_id, is_active, fee_total, fee_paid, payment_status, registered_at, notes, discount_amount, other_charges' + (st.is_active === false ? ', closed_at, close_reason' : '') + ')')
  push('values (' + [
    q(st.id), q(st.full_name), q(st.parent_name), q(st.phone), q(st.email), q('Nagpur'), q('Maharashtra'), q('India'), q('SYN Address'), q('walk-in'),
    q(st.centreId), q(st.is_active), st.fee_total, 0, q(initialStatus(st.fee_total)), q(st.enrol[0] ? st.enrol[0].start : '2026-09-01'),
    q('SYNTHETIC ' + st.key + ' — ' + st.scenario), st.discount_amount, st.other_charges,
  ].join(', ') + (st.is_active === false ? ", now(), 'withdrawn'" : '') + ');')

  const enrols = st.enrol.slice()
  function enrolSql(e, ei) {
    const sku = skuBy[e.sku]
    const monthly = courseBy[sku.course].billing === 'monthly'
    return 'insert into public.enrollments (id, student_id, sku_id, franchisee_id, enrolled_at, status, fee_amount, list_price, waived, cycle_started_at) values (' + [
      q(enrolmentId(si, ei)), q(st.id), q(sku.id), q(st.centreId), q(e.start + 'T00:00:00+00'), q(e.status || 'active'),
      e.fee, e.list, e.waived || 0, monthly ? q(e.cycle || e.start) : 'null',
    ].join(', ') + ');'
  }
  enrols.forEach(function (e, ei) { push(enrolSql(e, ei)) })

  let invCount = 0
  function invoiceSql(inv) {
    const items = inv.enrol.map(function (ei) {
      const e = enrols[ei]
      const sku = skuBy[e.sku]
      const item = { kind: 'course', sku_id: sku.id, enrollment_id: enrolmentId(si, ei), name: courseBy[sku.course].name + ' - ' + sku.level, qty: 1, rate: e.fee, amount: e.fee }
      if (inv.cycle) { item.cycle = inv.cycle; item.period_start = inv.period }
      return item
    })
    const subtotal = items.reduce(function (s, i) { return s + i.amount }, 0)
    const discount = inv.discount || 0
    const idx = invCount++
    return 'insert into public.student_invoices (id, student_id, franchisee_id, invoice_date, items, subtotal, discount, total, amount_paid, status, created_by, created_at, enrollment_id) values (' + [
      q(invoiceId(si, idx)), q(st.id), q(st.centreId), q(inv.date), q(JSON.stringify(items)) + '::jsonb', subtotal, discount, subtotal - discount, 0, q('unpaid'), q('synthetic-seed'),
      q(inv.date + 'T10:00:00+00'), inv.enrol.length === 1 ? q(enrolmentId(si, inv.enrol[0])) : 'null',
    ].join(', ') + ');'
  }
  st.invoices.forEach(function (inv) { push(invoiceSql(inv)) })

  let payCount = 0
  let runFee = st.fee_total
  let runPaid = 0
  function paymentSql(p) {
    runPaid += p.amount
    return 'insert into public.student_payments (id, student_id, franchisee_id, amount, mode, paid_at, receipt_date, note) values (' + [
      q(paymentId(si, payCount++)), q(st.id), q(st.centreId), p.amount, q(p.mode), q(p.paid_at), q(p.paid_at), q('SYNTHETIC'),
    ].join(', ') + ');'
  }
  st.payments.forEach(function (p) { push(paymentSql(p)) })

  st.after.forEach(function (a) {
    if (a.op === 'addEnrolment') { enrols.push(a.enrol); push(enrolSql(a.enrol, enrols.length - 1)) }
    // Like the app, a fee change also writes the re-derived payment_status
    // (the DB trigger only re-derives it when a PAYMENT row changes).
    else if (a.op === 'fee_total') { runFee = a.value; push('update public.students set fee_total = ' + a.value + ', payment_status = ' + q(statusOf(runFee, runPaid)) + ' where id = ' + q(st.id) + ';') }
    else if (a.op === 'student') {
      if (a.set.fee_total != null) runFee = a.set.fee_total
      push('update public.students set ' + Object.keys(a.set).map(function (k) { return k + ' = ' + q(a.set[k]) }).join(', ') + ', payment_status = ' + q(statusOf(runFee, runPaid)) + ' where id = ' + q(st.id) + ';')
    }
    else if (a.op === 'enrolment') push('update public.enrollments set ' + Object.keys(a.set).map(function (k) { return k + ' = ' + q(a.set[k]) }).join(', ') + ' where id = ' + q(enrolmentId(si, a.index)) + ';')
    else if (a.op === 'invoice') push(invoiceSql(a))
    else if (a.op === 'payment') push(paymentSql(a))
  })
  push('')
})

push('-- Expected end state per student is in tests/fixtures/synthetic-dataset.mjs (`expect`).')
push('commit;')

mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, L.join('\n') + '\n', 'utf8')
console.log('wrote', out, '(' + L.length + ' lines, ' + students.length + ' synthetic students)')
