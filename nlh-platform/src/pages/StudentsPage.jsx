import React, { useState, useEffect } from 'react'
import { sb } from '../supabase'
import { useAuth } from '../context/AuthContext'
import { fmtAmt, fmtDate, showToast } from '../utils'
import { isAdminRole } from '../constants/roles'
import { getTreeIds } from '../utils/hierarchy'
import { deriveFilter } from '../utils/courseAccess'
import { studentReceiptCtx, studentReceiptCtxFull } from '../utils/studentReceipts'
import { addOneMonth, todayIso, CYCLE_DAY_NAMES, formatCycleDays, parseCycleDays, countCycleDays, computeCycle, cycleAnchor, isMonthlyActive, renewalInfo, enrolmentBucket, certPending, attentionReasons, studentBucket, fetchAllRows, shortDay } from '../utils/studentLifecycle'
import { sendWelcomeEmail } from '../services/email'
import { sendWAStudentEnrolled, sendWAReviewRequest, sendWAStudentReceipt, sendWAFeeReminder } from '../services/whatsapp'
import CouponField from '../components/CouponField'
import { printStudentInvoice, printStudentReceipt } from '../components/studentDocs'
import { captureDocPng } from '../utils/captureReceipt'
import ModalHeader from '../components/ModalHeader'
import ActionsMenu from '../components/ActionsMenu'
import AttendanceSheet from '../components/AttendanceSheet'
import StudentLedgerView from '../components/StudentLedgerView'
import { invoiceSettlement } from '../utils/studentLedger'
import StudentCertModal from '../components/StudentCertModal'
import WhatsAppSendConfirm from '../components/WhatsAppSendConfirm'

// ── Phase 3 dual-write (see docs/transaction-model-migration-plan.md) ──────
// course_fee is pooled per STUDENT, not per invoice (settled in Phase 2 —
// the app already tracks one running fee_total/fee_paid on the students
// row, with payments recorded against the student, not any one invoice).
// So unlike kit_order (which reuses orders.id 1:1), there's no natural
// source id to key the transactions row on — find-or-create by
// (type='course_fee', person_id), same as the franchise_fee pattern.
// Full resync on every call: re-reads the student + all their
// student_invoices fresh and upserts transactions/transaction_items to
// match. Best-effort — every call site wraps this in try/catch and only
// logs a warning; students/student_invoices/student_payments remain the
// source of truth every screen actually reads.
async function mirrorStudentToTransaction(studentId) {
  const { data: s } = await sb.from('students')
    .select('id, franchisee_id, fee_total, discount_amount, coupon_id, coupon_code, payment_status, created_at')
    .eq('id', studentId).single()
  if (!s) return null

  const { data: invoices } = await sb.from('student_invoices')
    .select('id, invoice_no, subtotal, items, created_at').eq('student_id', studentId).order('created_at')

  const subtotalSum = (invoices || []).reduce(function (sum, inv) { return sum + (inv.subtotal || 0) }, 0)
  const invoiceNos = (invoices || []).map(function (inv) { return inv.invoice_no }).filter(Boolean)
  const invoiceIds = (invoices || []).map(function (inv) { return inv.id })
  const statusMap = { paid: 'paid', partial: 'part_paid' }

  const { data: existing } = await sb.from('transactions')
    .select('id').eq('type', 'course_fee').eq('person_id', studentId).maybeSingle()

  const txRow = {
    type: 'course_fee', party_id: s.franchisee_id, person_id: studentId,
    status: statusMap[s.payment_status] || 'confirmed',
    subtotal: subtotalSum, discount_amount: s.discount_amount || 0,
    coupon_id: s.coupon_id, coupon_code: s.coupon_code, total: s.fee_total || 0,
    metadata: invoiceNos.length ? { invoice_nos: invoiceNos, invoice_ids: invoiceIds } : {},
  }

  let txId = existing?.id
  if (txId) {
    await sb.from('transactions').update(txRow).eq('id', txId)
  } else {
    const { data: created } = await sb.from('transactions')
      .insert({ ...txRow, created_at: s.created_at }).select('id').single()
    txId = created?.id
  }
  if (!txId) return null

  await sb.from('transaction_items').delete().eq('transaction_id', txId)
  const itemRows = []
  ;(invoices || []).forEach(function (inv) {
    (inv.items || []).forEach(function (li) {
      itemRows.push({
        transaction_id: txId,
        sku_id: li.sku_id || null, item_id: li.item_id || null, enrollment_id: li.enrollment_id || null,
        name: li.name || null, qty: li.qty ?? 1, rate: li.rate ?? 0, amount: li.amount ?? 0,
      })
    })
  })
  if (itemRows.length) await sb.from('transaction_items').insert(itemRows)
  return txId
}

// Mirrors one student_payments row into transaction_payments, ensuring the
// parent transactions row exists first.
async function mirrorStudentPayment(studentId, payment) {
  const txId = await mirrorStudentToTransaction(studentId)
  if (!txId) return
  await sb.from('transaction_payments').insert({
    transaction_id: txId, amount: payment.amount, paid_on: payment.paid_on,
    mode: payment.mode, reference: payment.reference, note: payment.note,
    recorded_by: payment.recorded_by, receipt_no: payment.receipt_no,
  })
}

// ── helpers ────────────────────────────────────────────────────────────────────

// Days remaining in the current calendar month (today = the last day → 0)
export function daysLeftInMonth() {
  const d = new Date()
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  return lastDay - d.getDate()
}

// Shared: derive payment_status from fee amounts — single source of truth
function deriveStatus(total, paid) {
  const t = Number(total) || 0
  const p = Number(paid)  || 0
  if (t === 0)   return 'none'
  if (p <= 0)    return 'pending'
  if (p >= t)    return 'paid'
  return 'partial'
}

// Course-wise fee settlement. Payments are held against the STUDENT, so we
// settle courses oldest-first from a pool of real credits (payments + the
// package discount). A waiver is NOT a separate thing here: discontinuing a
// course reduces its fee_amount (and the student's fee_total) exactly like a
// discount, and the amount is stored per course as `waived` purely for display
// and reversal. So the true balance is always fee_total - fee_paid — nothing to
// subtract. Returns { perId, discount, waivedTotal, activeOutstanding, other }.
function computeCoverage(enrollments, payments, feeTotalRaw, otherRaw) {
  const list      = enrollments || []
  const paidTotal = (payments || []).reduce(function (s, p) { return s + (p.amount || 0) }, 0)
  const courseSum = list.reduce(function (s, e) { return s + (Number(e.fee_amount) || 0) }, 0)
  const other     = Number(otherRaw) || 0
  const feeTotal  = Number(feeTotalRaw) || 0
  // Charged below list = a discount (or a waiver, treated identically).
  const discount  = Math.max(0, courseSum + other - feeTotal)

  const ordered = list.slice().sort(function (a, b) {
    const ad = a.enrolled_at || a.created_at || ''
    const bd = b.enrolled_at || b.created_at || ''
    if (ad !== bd) return ad < bd ? -1 : 1     // oldest first
    return String(a.id) < String(b.id) ? -1 : 1
  })

  let pool = paidTotal + discount
  let waivedTotal = 0
  let activeDue   = 0
  const perId = {}
  ordered.forEach(function (en) {
    const fee     = Number(en.fee_amount) || 0
    const listP   = Number(en.list_price) || 0
    const waived  = Number(en.waived) || 0
    const covered = Math.min(pool, fee)
    pool -= covered
    const remaining = Math.max(0, fee - covered)
    const dropped   = en.status === 'dropped'
    waivedTotal += waived
    if (!dropped) activeDue += remaining
    perId[en.id] = {
      // fee_amount is already net of the waiver, so `off` reflects catalogue →
      // charged (real discount) and the waiver shows as its own figure.
      fee: fee, list: listP, off: Math.max(0, listP - fee - waived),
      paid: covered, due: remaining, dropped: dropped, waived: waived,
    }
  })

  const otherCovered = Math.min(pool, other)
  const otherDue     = Math.max(0, other - otherCovered)

  return {
    perId: perId, discount: discount, waivedTotal: waivedTotal,
    activeOutstanding: activeDue + otherDue,
    other: { fee: other, paid: otherCovered, due: otherDue },
  }
}

// The stored phone must be a bare 10-digit mobile — that is what links to
// WhatsApp (toWAPhone prepends 91 on send). Strip anything else, drop a leading
// country code (91) or trunk 0 if the extra digits push past 10, and cap at 10.
function to10Digit(raw) {
  let d = String(raw || '').replace(/\D/g, '')
  if (d.length > 10 && d.startsWith('91')) d = d.slice(2)   // +91 / 91 prefix
  if (d.length > 10 && d.startsWith('0'))  d = d.slice(1)   // trunk 0
  return d.slice(0, 10)
}

function StatusBadge({ status }) {
  const s = (status || '').toLowerCase()
  const map = { active: 'ba', inactive: 'bd', pending: 'bp' }
  return <span className={`badge ${map[s] || 'br'}`}>{status || '—'}</span>
}

function genTempPass() {
  return 'NLH@123'
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// ── StudentDetailModal ─────────────────────────────────────────────────────────

export function StudentDetailModal({ student, onClose, onSaved, inline }) {
  const { currentRole, currentFranchiseeId, currentUser, can } = useAuth()
  const admin = isAdminRole(currentRole) && can('students.edit')
  const canEdit = admin || (['uf', 'cf', 'smf'].includes(currentRole) && student.franchisee_id === currentFranchiseeId)
  // Fees / discounts / payments: any admin, or any franchisee who can see this
  // student (visibility is already hierarchy-scoped), incl. parent CF / SMF.
  const canManageFees = admin || ['uf', 'cf', 'smf'].includes(currentRole)

  const [tab, setTab] = useState('profile')

  const [form, setForm] = useState({
    full_name: student.full_name || '',
    parent_name: student.parent_name || '',
    gender: student.gender || '',
    camp_name: student.camp_name || '',
    dob: student.dob || '',
    registered_at: student.registered_at || '',
    phone: student.phone || '',
    email: student.email || '',
    pincode: student.pincode || '',
    country: student.country || 'India',
    state: student.state || '',
    city: student.city || '',
    area: student.area || '',
    address: student.address || '',
    channel: student.channel || 'franchise',
    payment_status: student.payment_status || '',
    payment_mode: student.payment_mode || '',
    fee_total: student.fee_total ?? '',
    other_charges: student.other_charges ?? 0,
    fee_paid: student.fee_paid ?? '',
    is_active: student.is_active !== false,
    waived_amount: student.waived_amount ?? 0,
    payment_status: student.payment_status || 'pending',
  })
  const [certModal,   setCertModal]   = useState(null)
  const [centreCache, setCentreCache] = useState(null)
  const [saving,      setSaving]      = useState(false)

  // ── Courses / Batch state ──
  const [localEnrollments, setLocalEnrollments] = useState(student.enrollments || [])
  const [batchAssignments,setBatchAssignments] = useState({})   // { [enrollment_id]: batch_student row }
  const [cycleProgress,   setCycleProgress]   = useState({})   // { [enrollment_id]: sessions held since cycle_started_at }
  const [sessionCounts,   setSessionCounts]   = useState({})   // { [enrollment_id]: attended count }
  const [lastAttendedDate,setLastAttendedDate]= useState({})   // { [enrollment_id]: latest attended session_date (YYYY-MM-DD) }
  const [kitIssued,       setKitIssued]       = useState({})   // { [enrollment_id]: true } — kit issued + stock deducted
  const [kitDefs,         setKitDefs]         = useState({})   // { [sku_id]: [{item_id, name, quantity}] } — full kit definition
  const [kitGiven,        setKitGiven]        = useState({})   // { [enrollment_id]: { [item_id]: stock_ledger row } } — what's actually been deducted, per item
  const [kitPanelEnrId,   setKitPanelEnrId]   = useState(null) // enrollment whose kit-confirm panel is open
  const [kitSaving,       setKitSaving]       = useState(false)
  const [certWaStatus,    setCertWaStatus]    = useState({})   // { [enrollment_id]: 'sent'|'delivered'|'read'|'failed' }
  const [remindSending,   setRemindSending]   = useState(false)
  const [waConfirm,       setWaConfirm]       = useState(null)
  const [enrolWaSending,  setEnrolWaSending]  = useState(false)
  const [enrolWaPhone,    setEnrolWaPhone]    = useState(student.phone || '')
  // Only holds explicit overrides; anything absent falls back to "is this
  // course still running", so newly added courses are ticked without an effect
  // having to keep this in sync with the enrolment list.
  const [enrolWaSel,      setEnrolWaSel]      = useState({})
  function enrolWaChecked(en) {
    return enrolWaSel[en.id] !== undefined ? enrolWaSel[en.id] : !en.completed_at
  }
  const [feeEditId,       setFeeEditId]       = useState(null)
  const [feeEditVal,      setFeeEditVal]      = useState('')
  const [otherEdit,       setOtherEdit]       = useState(false)
  const [otherVal,        setOtherVal]        = useState('')
  const [courseBusy,      setCourseBusy]      = useState(null)
  const [feeEvents,       setFeeEvents]       = useState(null)   // null = not loaded yet
  const [feeEventsOpen,   setFeeEventsOpen]   = useState(false)

  async function loadFeeEvents() {
    const { data } = await sb.from('student_fee_events')
      .select('id, enrollment_id, field, old_value, new_value, delta, actor, at')
      .eq('student_id', student.id)
      .order('at', { ascending: false })
    setFeeEvents(data || [])
  }
  const [skuFee,          setSkuFee]          = useState({})   // { [sku_id]: student_fee } — for invoice lines
  const [invoices,        setInvoices]        = useState([])   // student_invoices rows
  const [editInvId,       setEditInvId]       = useState(null) // invoice being edited
  const [editInv,         setEditInv]         = useState({})   // { invoice_date, amount_paid, status, notes }
  const [skuTotals,       setSkuTotals]       = useState({})   // { [sku_id]: total_sessions }
  const [skuBilling,      setSkuBilling]      = useState({})   // { [sku_id]: billing_type }
  const [coursesLoaded,   setCoursesLoaded]   = useState(false)
  const [batchPanelEnrId, setBatchPanelEnrId] = useState(null)  // enrollment.id whose panel is open
  const [panelData,       setPanelData]       = useState({ batches: [], loading: false })
  const [panelSaving,     setPanelSaving]     = useState(false)
  // "When did they join this batch" isn't a separate question from "when did
  // they join the course" — enrollments.enrolled_at is the one date anyone
  // edits; batch_students.assigned_at is just a system timestamp, set once,
  // never shown as an editable field.
  const [newBatchOpen,    setNewBatchOpen]    = useState(false)  // inline "+ create batch" form, within the assign panel
  const [newBatchForm,    setNewBatchForm]    = useState({ instructor_id: '', name: '', days: [], time: '', is_individual: false })
  const [eligibleCIs,     setEligibleCIs]     = useState([])   // instructors certified for the open enrollment's sku
  const [completingEnr,   setCompletingEnr]   = useState(null)  // enrollment pending completion-date entry
  const [completeDate,    setCompleteDate]    = useState(new Date().toISOString().slice(0, 10))
  // ── School-only marks → HO certify gate ──────────────────────────────────
  // Only School-tier franchisees go through this; regular UF/CF/SMF centres
  // keep self-certifying (completing a course there makes the certificate
  // available immediately, same as always). centreTier is filled in once the
  // student's own franchisee row loads (see loadCourseData below).
  const [centreTier,      setCentreTier]      = useState(null)
  const isSchool = centreTier === 'SCHOOL'
  const [marksObtained,   setMarksObtained]   = useState('')
  const [marksTotal,      setMarksTotal]      = useState('')
  const [marksRemarks,    setMarksRemarks]    = useState('')
  const [certifyingEn,    setCertifyingEn]    = useState(null)  // admin reviewing a school's pending-review enrollment
  const [certifySaving,   setCertifySaving]   = useState(false)
  const [certifyRejectNote, setCertifyRejectNote] = useState('')
  const [showAttSheet,    setShowAttSheet]    = useState(false) // monthly attendance sheet open
  const [renewOpen,       setRenewOpen]       = useState(false) // Renew Cycle dialog (all of the student's monthly courses)
  const [renewRows,       setRenewRows]       = useState({})    // { [enrollment_id]: { on, date, fee, days[] } }
  const [renewSaving,     setRenewSaving]     = useState(false)
  const [reviewingEn,     setReviewingEn]     = useState(null)  // enrollment pending review-send
  const [reviewPhone,     setReviewPhone]     = useState('')
  const [reviewSending,   setReviewSending]   = useState(false)
  const [changingEn,      setChangingEn]      = useState(null)  // enrollment whose level is being changed
  const [changeSkuId,     setChangeSkuId]     = useState('')
  const [changeSaving,    setChangeSaving]    = useState(false)
  // Fee payment ledger
  const [payments,        setPayments]        = useState([])
  const receiptPhone = student.phone || ''
  const [editPayId,       setEditPayId]       = useState(null)
  const [editPay,         setEditPay]         = useState({ amount: '', paid_at: '', mode: '', reference: '' })

  // ── Add-enrollment state ──
  const [showAddEnrollment, setShowAddEnrollment] = useState(false)
  const [allCentreSkus,     setAllCentreSkus]     = useState([])   // ALL SKUs the centre offers (enrolled + available)
  const [availableSkus,     setAvailableSkus]     = useState([])   // SKUs the centre offers, minus already enrolled
  const [selectedNewSkus,   setSelectedNewSkus]   = useState([])
  const [addingEnrollment,  setAddingEnrollment]  = useState(false)
  const [addCoupon,         setAddCoupon]         = useState(null)   // { coupon_id, code, discount }
  const [addBatchData,      setAddBatchData]      = useState({})     // { skuId: { batches, eligibleCIs, loading } }
  const [addBatchSel,       setAddBatchSel]       = useState({})     // { skuId: batchId | '__new__' }
  const [addNewBatch,       setAddNewBatch]       = useState({})     // { skuId: { ci, name, days, time, is_individual } }
  const [addEnrollDate,     setAddEnrollDate]     = useState(new Date().toISOString().slice(0, 10))
  const [addFeeOverride,    setAddFeeOverride]    = useState({})     // { skuId: editable fee }
  const [addKitData,        setAddKitData]        = useState({})     // { skuId: [{ item_id, name, quantity }] }
  const [addKitExcluded,    setAddKitExcluded]    = useState({})     // { skuId: { item_id: true } } unchecked kit items
  const [addSessionsPerWeek, setAddSessionsPerWeek] = useState({})   // { skuId: sessions/week } — monthly-billing courses only

  // ── Delete state ──
  const [deleting, setDeleting] = useState(false)
  const [closing,  setClosing]  = useState(false)

  // Per-course dues come from the settlement pass; the balance is simply
  // fee_total - fee_paid, because waivers already reduced fee_total (like a
  // discount). Nothing anywhere needs to subtract a separate waived figure.
  const coverage = computeCoverage(localEnrollments, payments, form.fee_total, form.other_charges)
  const balance  = Math.max(0, (Number(form.fee_total) || 0) - (Number(form.fee_paid) || 0))

  function field(k) {
    return function (e) { setForm(function (f) { return { ...f, [k]: e.target.value } }) }
  }

  const derivedStatus = deriveStatus(form.fee_total, form.fee_paid)

  async function save() {
    if (to10Digit(form.phone).length !== 10) { showToast('Enter a valid 10-digit mobile number (no country code)', 'warn'); return }
    setSaving(true)
    const feeTotal = form.fee_total === '' ? null : Number(form.fee_total)
    // fee_paid is NOT written here — it is maintained by the payment ledger
    // (student_payments) via a DB trigger. We only set fee_total + status.
    const payload = {
      full_name:      form.full_name.trim(),
      parent_name:    form.parent_name.trim(),
      gender:         form.gender || null,
      camp_name:      form.camp_name.trim() || null,
      dob:            form.dob || null,
      registered_at:  form.registered_at || null,
      phone:          to10Digit(form.phone),
      email:          form.email.trim() || null,
      pincode:        form.pincode.trim() || null,
      country:        form.country.trim(),
      state:          form.state.trim(),
      city:           form.city.trim(),
      area:           form.area.trim(),
      address:        form.address.trim(),
      channel:        form.channel || 'walk-in',
      fee_total:      feeTotal,
      payment_status: derivedStatus,
    }
    const { error } = await sb.from('students').update(payload).eq('id', student.id)
    if (error) { setSaving(false); showToast('Save failed: ' + error.message, 'err'); return }

    try { await mirrorStudentToTransaction(student.id) } catch (e) { console.warn('[Phase 3 dual-write] student save mirror failed:', e.message) }

    // Sync batch joining date to match updated registration date
    if (form.registered_at && form.registered_at !== student.registered_at) {
      const enrIds = (student.enrollments || []).map(function (e) { return e.id })
      if (enrIds.length > 0) {
        await sb.from('batch_students')
          .update({ assigned_at: form.registered_at + 'T00:00:00+00:00' })
          .in('enrollment_id', enrIds)
          .is('removed_at', null)
      }
    }

    setSaving(false)
    showToast('Saved')
    onSaved({ ...student, ...payload })
  }

  // ── Payment ledger ──
  useEffect(function () {
    let cancelled = false
    sb.from('student_payments')
      .select('id, amount, mode, reference, paid_at, note, receipt_no')
      .eq('student_id', student.id)
      .order('paid_at', { ascending: false })
      .order('created_at', { ascending: false })
      .then(function (res) { if (!cancelled && res.data) setPayments(res.data) })
    return function () { cancelled = true }
  }, [student.id])

  function applyPaid(newPayments) {
    const newPaid = newPayments.reduce(function (s, p) { return s + (p.amount || 0) }, 0)
    setForm(function (f) { return { ...f, fee_paid: newPaid } })
    onSaved({ ...student, fee_paid: newPaid, payment_status: deriveStatus(form.fee_total, newPaid) })
  }

  // Payments are recorded from Students → Receipts (StudentReceiptModal), not
  // here; this profile only shows the ledger and reprints / resends receipts.

  // ── Resend a receipt for a past payment ── (goes through waConfirm first)
  async function resendReceipt(p, phone) {
    const paidSoFar = payments.reduce(function (s, x) { return s + (x.amount || 0) }, 0)
    const bal = Math.max(0, (Number(form.fee_total) || 0) - paidSoFar)
    const r = await sendWAStudentReceipt(phone, {
      name: student.parent_name || student.full_name,
      receiptNo: p.receipt_no,
      amount: fmtAmt(p.amount),
      date: fmtDate(p.paid_at),
      balance: bal,
      imageUrl: await receiptPng(p),
    })
    if (r && r.success) showToast('Receipt resent on WhatsApp ✓')
    else showToast('Receipt failed' + (r && r.error ? ': ' + r.error : ''), 'err')
  }

  // Per-course view over the single settlement pass above.
  const feeCoverage = coverage.perId

  // Change one course's list price. The student's agreed total is deliberately
  // left alone — it is what was settled with the parent, and the gap between
  // the two is the discount. Editing a course price here must not quietly
  // re-bill the parent.
  async function saveCourseFee(en) {
    const val = Math.max(0, parseInt(feeEditVal, 10) || 0)
    // Preserve the list price if it was never captured, so the discount this
    // edit creates has something to be measured against later.
    const list = Number(en.list_price) || Number(en.fee_amount) || 0
    const { error } = await sb.from('enrollments')
      .update({ fee_amount: val, list_price: list }).eq('id', en.id)
    if (error) { showToast('Could not save the fee: ' + error.message, 'err'); return }
    setLocalEnrollments(function (prev) {
      return prev.map(function (x) {
        return x.id === en.id ? { ...x, fee_amount: val, list_price: list } : x
      })
    })
    setFeeEditId(null)
    const off = list - val
    showToast(off > 0
      ? 'Course fee ₹' + fmtAmt(val) + ' · discount of ₹' + fmtAmt(off) + ' recorded'
      : 'Course fee updated')
  }

  // Other charges change what the student owes, so unlike a course list price
  // this DOES move the agreed total — it is a charge, not a re-pricing.
  async function saveOtherCharges() {
    const val = Math.max(0, parseInt(otherVal, 10) || 0)
    const prev = Number(form.other_charges) || 0
    const newTotal = Math.max(0, (Number(form.fee_total) || 0) - prev + val)
    const { error } = await sb.from('students')
      .update({ other_charges: val, fee_total: newTotal,
                payment_status: deriveStatus(newTotal, Number(form.fee_paid) || 0) })
      .eq('id', student.id)
    if (error) { showToast('Could not save: ' + error.message, 'err'); return }
    try { await mirrorStudentToTransaction(student.id) } catch (e) { console.warn('[Phase 3 dual-write] other-charges mirror failed:', e.message) }
    setForm(function (f) { return { ...f, other_charges: val, fee_total: newTotal } })
    setOtherEdit(false)
    onSaved({ ...student, other_charges: val, fee_total: newTotal })
    showToast('Other charges ₹' + fmtAmt(val) + ' · agreed fee now ₹' + fmtAmt(newTotal))
  }

  // ── WhatsApp enrolment confirmation to the parent ──
  // Lists whatever the student is currently enrolled in, so it works equally as
  // a first confirmation, after a course is added later, or as a re-send.
  async function sendEnrolmentWA() {
    const phone = (enrolWaPhone || '').trim()
    if (!phone) { showToast('Enter a mobile number to send to', 'warn'); return }
    const list = localEnrollments
      .filter(enrolWaChecked)
      .map(function (e) {
        const c = e.skus?.courses?.group_name
        const l = e.skus?.level_name
        return c ? (l ? c + ' — ' + l : c) : l
      })
      .filter(Boolean)
    if (list.length === 0) { showToast('Tick at least one course to confirm', 'warn'); return }

    setEnrolWaSending(true)
    try {
      const r = await sendWAStudentEnrolled(phone, {
        parentName:  student.parent_name || 'Parent',
        studentName: student.full_name,
        courses:     list.join(', '),
        centre:      student.franchisees?.business_name || 'New Learning Horizons',
      })
      if (r && r.success) showToast('Enrollment confirmation sent on WhatsApp ✓')
      else showToast('WhatsApp failed' + (r && r.error ? ': ' + r.error : ''), 'warn')
    } catch (e) {
      showToast('WhatsApp failed: ' + e.message, 'warn')
    }
    setEnrolWaSending(false)
  }

  // ── WhatsApp balance reminder to the parent ── (goes through waConfirm first)
  async function sendFeeReminderWA(phone) {
    if (balance <= 0) { showToast('Nothing outstanding — no reminder needed', 'warn'); return }
    setRemindSending(true)
    const r = await sendWAFeeReminder(phone, {
      name:    student.parent_name || student.full_name,
      balance: fmtAmt(balance),
      towards: 'course fees for ' + (student.full_name || 'your child'),
    })
    setRemindSending(false)
    if (r && r.success) showToast('Balance reminder sent on WhatsApp ✓')
    else showToast('Reminder failed' + (r && r.error ? ': ' + r.error : ''), 'err')
  }

  // ── Print a stored invoice ──
  function handlePrintInvoice(inv, settle) {
    printStoredInvoice(student, inv, settle)
  }


  function startEditInvoice(inv) {
    setEditInvId(inv.id)
    setEditInv({ invoice_date: inv.invoice_date, amount_paid: inv.amount_paid || 0, status: inv.status || 'unpaid', notes: inv.notes || '' })
  }
  async function saveInvoiceEdit() {
    const { data, error } = await sb.from('student_invoices').update({
      invoice_date: editInv.invoice_date, amount_paid: parseInt(editInv.amount_paid, 10) || 0,
      status: editInv.status, notes: editInv.notes || null,
    }).eq('id', editInvId).select().single()
    if (error) { showToast('Save failed: ' + error.message, 'err'); return }
    setInvoices(function (prev) { return prev.map(function (i) { return i.id === editInvId ? data : i }) })
    setEditInvId(null); showToast('Invoice updated ✓')
  }
  async function deleteInvoice(id) {
    const { error } = await sb.from('student_invoices').delete().eq('id', id)
    if (error) { showToast('Delete failed: ' + error.message, 'err'); return }
    setInvoices(function (prev) { return prev.filter(function (i) { return i.id !== id }) })
    showToast('Invoice deleted')
  }

  // ── Printable branded payment receipt for one payment ──
  // Figures as at THAT payment, so a reprint or a resent image shows what the
  // receipt showed when it was issued — not today's running total.
  // Fee breakdown + payment history on the receipt. The shared helper
  // (studentReceiptCtxFull, also used by the Receipts tab) does the work; it's
  // handed this profile's live fee total and enrolments so an unsaved-fresher
  // value here wins over the list row's copy.
  async function receiptCtxFull(p, list) {
    return studentReceiptCtxFull(
      { ...student, fee_total: form.fee_total, enrollments: localEnrollments },
      p, list || payments
    )
  }

  async function handlePrintReceipt(p) {
    printStudentReceipt(student, p, await receiptCtxFull(p))
  }

  // PNG of the receipt for the WhatsApp image header. Best-effort: on failure
  // the send falls back to the text template rather than not going at all.
  async function receiptPng(p, list) {
    try {
      const html = printStudentReceipt(student, p, { ...(await receiptCtxFull(p, list)), asHtml: true })
      return await captureDocPng(html, p.receipt_no || 'receipt')
    } catch (e) { return null }
  }

  async function deletePayment(id) {
    const deleted = payments.find(function (p) { return p.id === id })
    const { error } = await sb.from('student_payments').delete().eq('id', id)
    if (error) { showToast('Delete failed: ' + error.message, 'err'); return }
    if (deleted && deleted.receipt_no) {
      try {
        const { data: tx } = await sb.from('transactions').select('id').eq('type', 'course_fee').eq('person_id', student.id).maybeSingle()
        if (tx) await sb.from('transaction_payments').delete().eq('transaction_id', tx.id).eq('receipt_no', deleted.receipt_no)
      } catch (e) { console.warn('[Phase 3 dual-write] student payment delete mirror failed:', e.message) }
    }
    const next = payments.filter(function (p) { return p.id !== id })
    setPayments(next)
    applyPaid(next)
    if (editPayId === id) setEditPayId(null)
    showToast('Payment removed')
  }

  function startEditPay(p) {
    setEditPayId(p.id)
    setEditPay({
      amount: String(p.amount ?? ''),
      paid_at: (p.paid_at || '').slice(0, 10),
      mode: p.mode || '',
      reference: p.reference || '',
    })
  }

  async function savePaymentEdit() {
    const amt = Number(editPay.amount)
    if (!amt || amt <= 0) { showToast('Enter a valid amount', 'warn'); return }
    const { data, error } = await sb.from('student_payments').update({
      amount:    amt,
      paid_at:   editPay.paid_at || null,
      mode:      editPay.mode || null,
      reference: editPay.reference.trim() || null,
    }).eq('id', editPayId).select('id, amount, mode, reference, paid_at, note, receipt_no').single()
    if (error) { showToast('Update failed: ' + error.message, 'err'); return }
    const next = payments.map(function (p) { return p.id === editPayId ? { ...p, ...data } : p })
    setPayments(next)
    applyPaid(next)
    setEditPayId(null)
    showToast('Payment updated ✓')
  }

  // Monthly-billing cycle progress for each running monthly enrolment — see
  // computeCycle (utils/studentLifecycle.js): target is the student's class
  // days in the cycle (their own chosen days, else the batch's, less declared
  // holidays); Saturday revision classes count only to make up absences, unless
  // Saturday is one of the student's class days. Same maths as the
  // Students list. Takes the enrolments/batch map explicitly so it can re-run
  // right after a renewal with the new cycle start.
  async function loadCycleProgress(enrList, assignMap) {
    const monthly = enrList.filter(function (en) { return !en.completed_at && en.status !== 'dropped' && assignMap[en.id] })
    const batchIds = Array.from(new Set(monthly.map(function (en) { return assignMap[en.id].batch_id }).filter(Boolean)))
    if (batchIds.length === 0) { setCycleProgress({}); return }
    try {
      const anchors = monthly.map(cycleAnchor).filter(Boolean).sort()
      const [sessRows, attRows] = await Promise.all([
        fetchAllRows(function (from, to) {
          return sb.from('batch_sessions').select('id, batch_id, session_date, is_holiday')
            .in('batch_id', batchIds).gte('session_date', anchors[0]).order('id').range(from, to)
        }),
        fetchAllRows(function (from, to) {
          return sb.from('session_attendance').select('id, enrollment_id, session_id, attended')
            .in('enrollment_id', monthly.map(function (en) { return en.id })).order('id').range(from, to)
        }),
      ])
      const attendanceByEnr = {}
      attRows.forEach(function (a) { (attendanceByEnr[a.enrollment_id] = attendanceByEnr[a.enrollment_id] || new Map()).set(a.session_id, !!a.attended) })
      const progress = {}
      monthly.forEach(function (en) {
        const bsRow = assignMap[en.id]
        progress[en.id] = computeCycle(en, sessRows.filter(function (s) { return s.batch_id === bsRow.batch_id }), attendanceByEnr[en.id], bsRow.batches?.schedule_days)
      })
      setCycleProgress(progress)
    } catch (e) { console.error('Cycle progress load error:', e); setCycleProgress({}) }
  }

  // ── Load courses tab ──
  async function loadCoursesTab() {
    if (coursesLoaded) return
    setCoursesLoaded(true)

    // Load batch assignments for all enrollments of this student
    const enrIds = localEnrollments.map(function (e) { return e.id })
    if (enrIds.length > 0) {
      const { data: bsRows } = await sb.from('batch_students')
        .select('id, enrollment_id, assigned_at, batch_id, batches(id, name, schedule_days, schedule_time, instructor_id, instructors(full_name))')
        .in('enrollment_id', enrIds)
        .is('removed_at', null)
      const map = {}
      ;(bsRows || []).forEach(function (bs) { map[bs.enrollment_id] = bs })
      setBatchAssignments(map)

      await loadCycleProgress(localEnrollments, map)

      // Which enrollments have had their kit issued (HO stock deducted) —
      // and specifically which items, so "Kit issued" can be confirmed or
      // corrected per item instead of being a fire-and-forget badge. A new
      // enrollment auto-deducts the full kit with no confirmation step
      // (see addStudent/addEnrollments) — this is what lets an admin catch
      // and fix a "nothing was actually handed over yet" case afterward.
      const { data: kitLedger } = await sb.from('stock_ledger')
        .select('id, item_id, ref_id, qty').eq('ref_type', 'enrollment').eq('movement_type', 'issue_to_student').in('ref_id', enrIds)
      const ki = {}
      const kg = {}
      ;(kitLedger || []).forEach(function (r) {
        ki[r.ref_id] = true
        if (!kg[r.ref_id]) kg[r.ref_id] = {}
        kg[r.ref_id][r.item_id] = r
      })
      setKitIssued(ki)
      setKitGiven(kg)

      const kitSkuIds = Array.from(new Set(localEnrollments.map(function (e) { return e.sku_id }).filter(Boolean)))
      if (kitSkuIds.length > 0) {
        const { data: kitRows } = await sb.from('kit_items')
          .select('sku_id, item_id, quantity, inventory_items(name)').in('sku_id', kitSkuIds)
        const kd = {}
        ;(kitRows || []).forEach(function (k) {
          if (!kd[k.sku_id]) kd[k.sku_id] = []
          kd[k.sku_id].push({ item_id: k.item_id, name: k.inventory_items?.name || 'Kit item', quantity: Number(k.quantity) || 1 })
        })
        setKitDefs(kd)
      }

      // Certificate WhatsApp status — read straight off the enrollment (kept in
      // sync by the webhook) so franchisees see it without whatsapp_messages access
      const { data: certRows } = await sb.from('enrollments')
        .select('id, cert_wa_status').in('id', enrIds).not('cert_wa_message_id', 'is', null)
      const cs = {}
      ;(certRows || []).forEach(function (r) { cs[r.id] = r.cert_wa_status || 'sent' })
      setCertWaStatus(cs)

      // Attended-session count per enrollment (for the "X / Y sessions" badge),
      // plus the date of each enrollment's most recent attended session — used
      // to default "Mark Course Complete" to the last class actually attended
      // instead of today.
      const { data: attRows } = await sb.from('session_attendance')
        .select('enrollment_id, batch_sessions(session_date)')
        .in('enrollment_id', enrIds)
        .eq('attended', true)
      const counts = {}
      const lastDate = {}
      ;(attRows || []).forEach(function (a) {
        counts[a.enrollment_id] = (counts[a.enrollment_id] || 0) + 1
        const d = a.batch_sessions?.session_date
        if (d && (!lastDate[a.enrollment_id] || d > lastDate[a.enrollment_id])) lastDate[a.enrollment_id] = d
      })
      setSessionCounts(counts)
      setLastAttendedDate(lastDate)

      // Total sessions + billing type per enrolled SKU
      const enrSkuIds = localEnrollments.map(function (e) { return e.sku_id }).filter(Boolean)
      if (enrSkuIds.length > 0) {
        const { data: skuRows } = await sb.from('skus')
          .select('id, total_sessions, courses(billing_type)')
          .in('id', enrSkuIds)
        const totals = {}
        const billing = {}
        ;(skuRows || []).forEach(function (s) {
          totals[s.id]  = s.total_sessions
          billing[s.id] = s.courses?.billing_type || null
        })
        setSkuTotals(totals)
        setSkuBilling(billing)
      }
    }

    // Load available SKUs for the "+ Add Course" panel
    const [{ data: fr }, { data: allSkuRows }] = await Promise.all([
      sb.from('franchisees').select('tier, registered_skus, registered_courses').eq('id', student.franchisee_id).single(),
      sb.from('skus').select('id, level_name, student_fee, course_id, courses(group_name, billing_type)').order('sort_order'),
    ])
    setCentreTier(fr?.tier || null)
    const filter = deriveFilter(fr)
    const enrolledSkuIds = localEnrollments.map(function (e) { return e.sku_id })
    let candidates = []
    if (filter === 'all') {
      candidates = allSkuRows || []
    } else if (filter && filter.skuIds) {
      candidates = (allSkuRows || []).filter(function (s) { return filter.skuIds.includes(s.id) })
    } else if (filter && filter.courseIds) {
      candidates = (allSkuRows || []).filter(function (s) { return filter.courseIds.includes(s.course_id) })
    }
    setAllCentreSkus(candidates)
    setAvailableSkus(candidates.filter(function (s) { return !enrolledSkuIds.includes(s.id) }))
    const fees = {}
    ;(allSkuRows || []).forEach(function (s) { fees[s.id] = s.student_fee || 0 })
    setSkuFee(fees)

    // Invoice history
    const { data: invRows } = await sb.from('student_invoices')
      .select('*').eq('student_id', student.id).order('created_at', { ascending: false })
    setInvoices(invRows || [])
  }

  // ── Open batch assignment panel for one enrollment ──
  async function openBatchPanel(enrollment) {
    if (batchPanelEnrId === enrollment.id) { setBatchPanelEnrId(null); return }
    setBatchPanelEnrId(enrollment.id)
    setNewBatchOpen(false)
    setNewBatchForm({ instructor_id: '', name: '', days: [], time: '', is_individual: false })
    setPanelData({ batches: [], loading: true })

    // Instructors certified to teach this exact level — offered as the
    // "+ create batch" picker below, so a course with no batch yet never
    // dead-ends this panel into "go find the right instructor yourself".
    const { data: cis } = await sb.from('instructor_courses')
      .select('instructor_id, instructors(id, full_name, franchisee_id)')
      .eq('sku_id', enrollment.sku_id).eq('status', 'active')
    setEligibleCIs((cis || [])
      .map(function (c) { return c.instructors })
      .filter(function (i) { return i && i.franchisee_id === student.franchisee_id }))

    // Get the course_id for this enrollment's SKU
    const { data: skuRow } = await sb.from('skus').select('course_id').eq('id', enrollment.sku_id).single()

    // Get all SKU IDs for that course so we can find batches at any level
    const { data: courseSkus } = skuRow?.course_id
      ? await sb.from('skus').select('id').eq('course_id', skuRow.course_id)
      : { data: [] }
    const courseSkuIds = (courseSkus || []).map(function (s) { return s.id })

    // Fetch this centre's own active batches for this course (any level) —
    // a franchisee's students can only join a batch run by their own centre,
    // never HO's or another franchisee's (CIs teach on-site, in person).
    const { data: batches } = courseSkuIds.length
      ? await sb.from('batches')
          .select('id, name, sku_id, schedule_days, schedule_time, is_individual, sessions_done, instructor_id, instructors(id, full_name)')
          .in('sku_id', courseSkuIds)
          .eq('is_active', true)
          .eq('franchisee_id', student.franchisee_id)
          .order('schedule_time')
      : { data: [] }

    setPanelData({ batches: batches || [], loading: false })
  }

  // ── Assign (or switch) a student to a batch ──
  // assigned_at is a system timestamp only — set once, on assignment, and
  // never re-edited. The one date anyone actually manages is the course's
  // own enrolled_at (see the enrollment record itself).
  async function assignToBatch(batchId, enrollmentId) {
    setPanelSaving(true)
    const assignedAt = new Date().toISOString()
    const selectFields = 'id, enrollment_id, assigned_at, batch_id, batches(id, name, schedule_days, schedule_time, instructor_id, instructors(full_name))'

    // Remove from any existing (different) batch first — this is the
    // "switch batch" path, same action whether it's the first assignment
    // or a change.
    const existing = batchAssignments[enrollmentId]
    if (existing && existing.batch_id !== batchId) {
      await sb.from('batch_students').update({ removed_at: new Date().toISOString() }).eq('id', existing.id)
    }

    // Reactivate a prior row for this (batch, enrollment) if one exists, else insert
    const { data: prior } = await sb.from('batch_students')
      .select('id')
      .eq('batch_id', batchId)
      .eq('enrollment_id', enrollmentId)
      .order('assigned_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    let data, error
    if (prior) {
      ;({ data, error } = await sb.from('batch_students')
        .update({ removed_at: null, assigned_at: assignedAt })
        .eq('id', prior.id)
        .select(selectFields)
        .single())
    } else {
      ;({ data, error } = await sb.from('batch_students')
        .insert({ batch_id: batchId, enrollment_id: enrollmentId, assigned_at: assignedAt })
        .select(selectFields)
        .single())
    }
    setPanelSaving(false)
    if (error) { showToast('Failed: ' + error.message, 'err'); return }
    setBatchAssignments(function (prev) { return { ...prev, [enrollmentId]: data } })
    setBatchPanelEnrId(null)
    showToast('Assigned to batch ✓')
  }

  // ── Create a new batch inline (right from the assign panel) and assign
  // this student to it in one step — no more leaving the student's page to
  // go create a batch on the instructor's page first. ──
  async function createBatchAndAssign(enrollment) {
    const nbf = newBatchForm
    if (!nbf.instructor_id) { showToast('Select an instructor', 'warn'); return }
    if (!nbf.name.trim()) { showToast('Name the batch', 'warn'); return }
    setPanelSaving(true)
    const { data: nb, error } = await sb.from('batches').insert({
      instructor_id: nbf.instructor_id, franchisee_id: student.franchisee_id, sku_id: enrollment.sku_id,
      name: nbf.name.trim(), is_individual: nbf.is_individual,
      schedule_days: nbf.days.length ? nbf.days.join(', ') : null,
      schedule_time: nbf.time || null, is_active: true, sessions_done: 0,
      start_date: new Date().toISOString().slice(0, 10),
    }).select('id').single()
    if (error) { setPanelSaving(false); showToast('Batch create failed: ' + error.message, 'err'); return }
    await assignToBatch(nb.id, enrollment.id)   // sets panelSaving(false) itself
  }

  // ── Remove student from current batch ──
  async function removeFromBatch(enrollmentId) {
    const bs = batchAssignments[enrollmentId]
    if (!bs) return
    const { error } = await sb.from('batch_students')
      .update({ removed_at: new Date().toISOString() }).eq('id', bs.id)
    if (error) { showToast('Failed', 'err'); return }
    setBatchAssignments(function (prev) { const n = { ...prev }; delete n[enrollmentId]; return n })
    showToast('Removed from batch')
  }

  // ── Mark course complete ──

  async function markCourseComplete(en, endDate) {
    // endDate is 'YYYY-MM-DD' (course end date chosen by the user); default to today.
    var dateStr = endDate || new Date().toISOString().slice(0, 10)
    var completed_at = dateStr + 'T12:00:00+00:00'
    var patch = { completed_at, status: 'completed' }
    // School-tier centres submit marks at completion and wait for HO to
    // certify before the certificate can be issued — regular franchisee
    // tiers (UF/CF/SMF) are trusted to self-certify, same as before.
    if (isSchool) {
      patch.marks_obtained = marksObtained === '' ? null : Number(marksObtained)
      patch.marks_total = marksTotal === '' ? null : Number(marksTotal)
      patch.marks_remarks = marksRemarks.trim() || null
      patch.marks_submitted_at = new Date().toISOString()
      patch.marks_submitted_by = currentUser?.email || currentRole || null
      patch.cert_status = 'pending_review'
      patch.cert_reviewed_at = null
      patch.cert_reviewed_by = null
      patch.cert_reject_note = null
    }
    var { error } = await sb.from('enrollments')
      .update(patch)
      .eq('id', en.id)
    if (error) { showToast('Failed: ' + error.message, 'err'); return }
    const next = localEnrollments.map(function (e) {
      return e.id === en.id ? { ...e, ...patch } : e
    })
    setLocalEnrollments(next)
    setCompletingEnr(null)
    showToast(isSchool
      ? 'Marks submitted for ' + fmtDate(dateStr) + ' — awaiting HO certification ✓'
      : 'Marked as completed on ' + fmtDate(dateStr) + ' ✓')
    // Sync the outer student list too — this modal's localEnrollments is a
    // separate copy from the parent's cached row, so without this the table's
    // Courses column keeps showing the pre-completion state until a full
    // page reload (the bug reported: chip showed "0/10" instead of "✓ done").
    if (onSaved) onSaved({ ...student, ...form, enrollments: next })
  }

  // ── Record that a certificate was handed over outside the app ──
  // (printed at the centre, or issued before sending existed) — clears it
  // from Needs attention without claiming it was emailed or WhatsApped.
  async function markCertIssued(en) {
    if (!window.confirm('Mark the certificate for this course as already issued?\n\nIt will stop showing under Needs attention. This does not send anything to the parent.')) return
    const patch = { cert_issued_at: new Date().toISOString(), cert_issued_by: currentUser?.email || currentRole || null, cert_issued_note: 'Marked as issued manually' }
    const { error } = await sb.from('enrollments').update(patch).eq('id', en.id)
    if (error) { showToast('Failed: ' + error.message, 'err'); return }
    const next = localEnrollments.map(function (e) { return e.id === en.id ? { ...e, ...patch } : e })
    setLocalEnrollments(next)
    showToast('Certificate marked as issued ✓')
    if (onSaved) onSaved({ ...student, ...form, enrollments: next })
  }

  // ── HO certify / reject a school's submitted marks ──
  async function certifyEnrollment(en, approve, rejectNote) {
    setCertifySaving(true)
    const patch = approve
      ? { cert_status: 'certified', cert_reviewed_at: new Date().toISOString(), cert_reviewed_by: currentUser?.email || currentRole || null, cert_reject_note: null }
      : { cert_status: 'rejected', cert_reviewed_at: new Date().toISOString(), cert_reviewed_by: currentUser?.email || currentRole || null, cert_reject_note: (rejectNote || '').trim() || null }
    const { error } = await sb.from('enrollments').update(patch).eq('id', en.id)
    setCertifySaving(false)
    if (error) { showToast('Failed: ' + error.message, 'err'); return }
    const next = localEnrollments.map(function (e) { return e.id === en.id ? { ...e, ...patch } : e })
    setLocalEnrollments(next)
    setCertifyingEn(null)
    showToast(approve ? 'Certified — the certificate is now available ✓' : 'Marks rejected — sent back to the school ✓')
    if (onSaved) onSaved({ ...student, ...form, enrollments: next })
  }

  // ── Renew a monthly billing cycle ──
  // Not a rigid "+30 days" — the admin sets the new cycle start by hand,
  // so a session or two either side of the old cycle's boundary can be
  // folded into where the next cycle actually begins, same as the old
  // cycle's progress was counted strictly from its own start date.
  function openRenewCycle(preselectId) {
    // Each course defaults to its own cycle's due date (same date next month),
    // not today — a renewal collected a few days late still counts classes
    // date-to-date from where the paid month actually began. Editable to nudge.
    // Courses that are due / overdue start ticked; if none are, all are.
    const rows = {}
    localEnrollments.filter(isMonthlyActive).forEach(function (en) {
      const ri = renewalInfo(en)
      rows[en.id] = {
        on: preselectId ? en.id === preselectId : (!!ri && ri.state !== 'ok'),
        date: ri ? ri.due : todayIso(),
        fee: String(en.fee_amount || 0),
        // This student's own days, else the batch's, else all seven.
        days: parseCycleDays(en.cycle_days, batchAssignments[en.id] && batchAssignments[en.id].batches && batchAssignments[en.id].batches.schedule_days),
      }
    })
    if (!Object.keys(rows).some(function (k) { return rows[k].on })) Object.keys(rows).forEach(function (k) { rows[k].on = true })
    setRenewRows(rows)
    setRenewOpen(true)
  }
  function setRenewRow(id, patch) {
    setRenewRows(function (prev) { return { ...prev, [id]: { ...prev[id], ...patch } } })
  }

  // One renewal for the student: every ticked course gets its new cycle, the
  // fees go onto the account in one step, and ONE invoice lists them all.
  async function renewCycle() {
    const chosen = localEnrollments.filter(function (e) { return renewRows[e.id] && renewRows[e.id].on })
    if (chosen.length === 0) { showToast('Tick at least one course to renew', 'warn'); return }
    for (const en of chosen) {
      const r = renewRows[en.id]
      const nm = (en.skus?.courses?.group_name || 'Course')
      if (!r.date) { showToast('Set a start date for ' + nm, 'warn'); return }
      if (r.days.length === 0) { showToast('Pick at least one day of the week for ' + nm, 'warn'); return }
    }
    setRenewSaving(true)

    // Only the start dates move. Each next cycle's target is worked out from
    // its own window and chosen days; a student who missed classes makes them
    // up at Saturday revision, so nothing is carried between cycles.
    const patches = {}
    for (const en of chosen) {
      const r = renewRows[en.id]
      const patch = { cycle_started_at: r.date, cycle_days: formatCycleDays(r.days) }
      const { error: enrErr } = await sb.from('enrollments').update(patch).eq('id', en.id)
      if (enrErr) { setRenewSaving(false); showToast('Failed: ' + enrErr.message, 'err'); return }
      patches[en.id] = patch
    }

    const items = []
    chosen.forEach(function (en) {
      const r = renewRows[en.id]
      const fee = Number(r.fee) || 0
      if (fee <= 0) return
      const rd = new Date(r.date + 'T00:00:00')
      items.push({
        kind: 'course', cycle: 'renewal', sku_id: en.sku_id, enrollment_id: en.id,
        name: (en.skus?.courses?.group_name ? en.skus.courses.group_name + ' — ' : '') + (en.skus?.level_name || ''),
        period_start: r.date, period_label: rd.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }),
        qty: 1, rate: fee, amount: fee,
      })
    })
    const total = items.reduce(function (sum, i) { return sum + i.amount }, 0)
    let newTotal = Number(form.fee_total) || 0

    // Same pattern as adding a new course's fee — bump the account's Fee
    // Total once; the DB trigger logs it to student_fee_events automatically.
    if (total > 0) {
      newTotal += total
      const { error: stuErr } = await sb.from('students').update({ fee_total: newTotal }).eq('id', student.id)
      if (stuErr) { setRenewSaving(false); showToast('Cycle dates saved, but fee update failed: ' + stuErr.message, 'err'); return }
      setForm(function (f) { return { ...f, fee_total: newTotal } })

      // One invoice (SINV-…) for the whole renewal, each line flagged with the
      // month it covers so the Accounts tab and receipts can name it.
      const dates = chosen.filter(function (e) { return Number(renewRows[e.id].fee) > 0 }).map(function (e) { return renewRows[e.id].date }).sort()
      const { data: renInv, error: invErr } = await sb.from('student_invoices').insert({
        student_id: student.id, franchisee_id: student.franchisee_id || null,
        enrollment_id: items.length === 1 ? items[0].enrollment_id : null,
        invoice_date: dates[0], items: items,
        subtotal: total, discount: 0, total: total, amount_paid: 0, status: 'unpaid',
        created_by: currentUser?.email || currentRole || null,
      }).select().single()
      if (invErr) showToast('Renewed, but the invoice could not be created: ' + invErr.message, 'warn')
      else if (renInv) setInvoices(function (prev) { return [renInv, ...prev] })
    }

    const next = localEnrollments.map(function (e) { return patches[e.id] ? { ...e, ...patches[e.id] } : e })
    setLocalEnrollments(next)
    // Recompute from the new start dates — a late renewal already has classes
    // held since the old cycle's due date, so this is not simply zero.
    await loadCycleProgress(next, batchAssignments)
    setRenewSaving(false)
    setRenewOpen(false)
    showToast(chosen.length + ' course' + (chosen.length > 1 ? 's' : '') + ' renewed' + (total > 0 ? ' · ₹' + fmtAmt(total) + ' added to Fee Total ✓' : ' ✓'))
    if (onSaved) onSaved({ ...student, ...form, fee_total: newTotal, enrollments: next })
  }

  // ── Confirm / correct kit issuance, per item ──
  // New enrollments auto-deduct the full kit with no confirmation step
  // (see addEnrollments / AddStudentModal) — this is the "actually, nothing
  // was handed over yet" fix: unchecking an item reverses its stock
  // deduction (deletes the wrongful ledger row, doesn't just log a return —
  // it was never really issued), checking one deducts it for real.
  async function toggleKitGiven(en, item) {
    setKitSaving(true)
    const existing = (kitGiven[en.id] || {})[item.item_id]
    let forEnr = { ...(kitGiven[en.id] || {}) }
    if (existing) {
      const { error } = await sb.from('stock_ledger').delete().eq('id', existing.id)
      if (error) { setKitSaving(false); showToast('Failed: ' + error.message, 'err'); return }
      delete forEnr[item.item_id]
    } else {
      const { data, error } = await sb.from('stock_ledger').insert({
        item_id: item.item_id, location_type: 'ho', movement_type: 'issue_to_student',
        qty: -item.quantity, ref_type: 'enrollment', ref_id: en.id,
        franchisee_id: student.franchisee_id || null, note: 'Kit · ' + (student.full_name || 'student'),
      }).select('id, item_id, ref_id, qty').single()
      if (error) { setKitSaving(false); showToast('Failed: ' + error.message, 'err'); return }
      forEnr[item.item_id] = data
    }
    setKitGiven(function (prev) { return { ...prev, [en.id]: forEnr } })
    setKitIssued(function (prev) { return { ...prev, [en.id]: Object.keys(forEnr).length > 0 } })
    setKitSaving(false)
  }

  function openReview(en) {
    setReviewPhone(student.phone || '')
    setReviewingEn(en)
  }

  async function doSendReview() {
    if (!reviewingEn) return
    if (!reviewPhone.trim()) { showToast('Enter a WhatsApp number', 'warn'); return }
    var en = reviewingEn
    var course = (en.skus?.courses?.group_name || '') + (en.skus?.level_name ? ' ' + en.skus.level_name : '')
    setReviewSending(true)
    var res = await sendWAReviewRequest(reviewPhone.trim(), {
      parentName:  student.parent_name,
      studentName: student.full_name,
      courseName:  course.trim(),
    })
    setReviewSending(false)
    if (res.success) { showToast('Review request sent on WhatsApp ✓'); setReviewingEn(null) }
    else showToast('Review send failed: ' + (res.error || 'Unknown error'), 'err')
  }

  // ── Change an enrollment's course / level (swap sku_id in place) ──
  function openChangeLevel(en) {
    setChangeSkuId(en.sku_id || '')
    setChangingEn(en)
  }

  async function saveChangeLevel() {
    if (!changingEn) return
    const newSkuId = changeSkuId
    if (!newSkuId || newSkuId === changingEn.sku_id) { setChangingEn(null); return }
    // Prevent creating a duplicate of an existing enrollment
    const dup = localEnrollments.some(function (e) { return e.id !== changingEn.id && e.sku_id === newSkuId })
    if (dup) { showToast('Student is already enrolled in that level', 'warn'); return }
    const target = allCentreSkus.find(function (s) { return s.id === newSkuId })
    setChangeSaving(true)
    const { error } = await sb.from('enrollments').update({ sku_id: newSkuId }).eq('id', changingEn.id)
    setChangeSaving(false)
    if (error) { showToast('Change failed: ' + error.message, 'err'); return }
    const next = localEnrollments.map(function (e) {
      if (e.id !== changingEn.id) return e
      return {
        ...e,
        sku_id: newSkuId,
        skus: target
          ? { level_name: target.level_name, courses: target.courses || e.skus?.courses }
          : e.skus,
      }
    })
    setLocalEnrollments(next)
    setChangingEn(null)
    showToast('Course / level updated ✓')
    if (onSaved) onSaved({ ...student, ...form, enrollments: next })
  }

  // ── Remove an enrollment ──
  async function removeEnrollment(enrollment) {
    // Soft-delete any active batch_student row first
    const { data: bsRows } = await sb.from('batch_students')
      .select('id')
      .eq('enrollment_id', enrollment.id)
      .is('removed_at', null)
    if (bsRows && bsRows.length > 0) {
      await sb.from('batch_students')
        .update({ removed_at: new Date().toISOString() })
        .in('id', bsRows.map(function (b) { return b.id }))
    }
    const { error } = await sb.from('enrollments').delete().eq('id', enrollment.id)
    if (error) { showToast('Remove failed: ' + error.message, 'err'); return }
    setLocalEnrollments(function (prev) { return prev.filter(function (e) { return e.id !== enrollment.id }) })
    setBatchAssignments(function (prev) { const n = { ...prev }; delete n[enrollment.id]; return n })
    // Re-add the SKU to the available list
    setAvailableSkus(function (prev) {
      if (prev.some(function (s) { return s.id === enrollment.sku_id })) return prev
      return [...prev, { id: enrollment.sku_id, sku_id: enrollment.sku_id, level_name: enrollment.skus?.level_name, student_fee: null, courses: enrollment.skus?.courses }]
    })
    showToast('Course removed')
    const { data: updated } = await sb.from('students')
      .select('*, enrollments(id, sku_id, fee_amount, list_price, waived, sessions_per_week, sessions_per_cycle, cycle_started_at, cycle_days, enrolled_at, completed_at, status, marks_obtained, marks_total, marks_remarks, marks_submitted_at, cert_status, cert_reject_note, cert_emailed_at, cert_wa_sent_at, cert_issued_at, skus(level_name, courses(group_name)))')
      .eq('id', student.id).single()
    if (updated) onSaved(updated)
  }

  // ── Save just the agreed fee (quick, without the full profile save) ──
  async function saveFeeOnly() {
    const ft = form.fee_total === '' ? null : Number(form.fee_total)
    const { error } = await sb.from('students')
      .update({ fee_total: ft, payment_status: deriveStatus(ft, form.fee_paid) })
      .eq('id', student.id)
    if (error) { showToast('Save failed: ' + error.message, 'err'); return }
    showToast('Fee updated ✓')
    if (onSaved) onSaved({ ...student, ...form, fee_total: ft, payment_status: deriveStatus(ft, form.fee_paid) })
  }

  // ── Apply a coupon discount to the student's agreed fee ──
  async function applyFeeDiscount(c) {
    const base = Number(form.fee_total) || 0
    const disc = Math.min(c.discount || 0, base)
    if (disc <= 0) { showToast('No discount applies to this amount', 'warn'); return }
    const newTotal = Math.max(0, base - disc)
    const { error } = await sb.from('students').update({
      fee_total: newTotal,
      coupon_id: c.coupon_id, coupon_code: c.code,
      discount_amount: (student.discount_amount || 0) + disc,
      payment_status: deriveStatus(newTotal, form.fee_paid),
    }).eq('id', student.id)
    if (error) { showToast('Failed: ' + error.message, 'err'); return }
    try { await mirrorStudentToTransaction(student.id) } catch (e) { console.warn('[Phase 3 dual-write] discount mirror failed:', e.message) }
    // Coupon is applied to the fee but NOT locked yet — it redeems only when the
    // first fee payment is received (see StudentReceiptModal).
    setForm(function (f) { return { ...f, fee_total: newTotal } })
    showToast('Discount applied — ₹' + fmtAmt(disc) + ' off')
  }

  // ── Load batches eligible for a SKU (for the Add-Course batch picker) ──
  async function loadAddBatchData(skuId) {
    if (addBatchData[skuId]) return
    setAddBatchData(function (prev) { return { ...prev, [skuId]: { batches: [], eligibleCIs: [], loading: true } } })
    // Certified CIs AND existing batches are both scoped to this student's own
    // centre — an instructor teaches in person, so HO's or another centre's
    // roster/batches are never relevant here (see openBatchPanel above, the
    // same scoping applied to the course-card panel).
    const { data: ciRows } = await sb.from('instructor_courses')
      .select('instructor_id, instructors(id, full_name, status, franchisee_id)')
      .eq('sku_id', skuId).eq('status', 'active')
    const eligibleCIs = (ciRows || [])
      .map(function (r) { return r.instructors })
      .filter(function (i) { return i && i.status === 'active' && i.franchisee_id === student.franchisee_id })
      .filter(function (i, idx, arr) { return arr.findIndex(function (x) { return x.id === i.id }) === idx })
    const eligibleCIIds = eligibleCIs.map(function (ci) { return ci.id })
    const { data: batches } = eligibleCIIds.length
      ? await sb.from('batches')
          .select('id, name, schedule_days, schedule_time, is_individual, instructor_id, instructors(id, full_name)')
          .in('instructor_id', eligibleCIIds).eq('is_active', true).eq('franchisee_id', student.franchisee_id).order('created_at')
      : { data: [] }
    setAddBatchData(function (prev) { return { ...prev, [skuId]: { batches: batches || [], eligibleCIs: eligibleCIs, loading: false } } })
  }

  // ── Load a course's kit items + seed its editable fee when it is selected ──
  async function loadAddKit(sku) {
    setAddFeeOverride(function (prev) { return prev[sku.id] != null ? prev : { ...prev, [sku.id]: sku.student_fee || 0 } })
    if (addKitData[sku.id]) return
    const { data } = await sb.from('kit_items')
      .select('item_id, quantity, inventory_items(name)').eq('sku_id', sku.id)
    setAddKitData(function (prev) { return { ...prev, [sku.id]: (data || []).map(function (k) { return { item_id: k.item_id, name: k.inventory_items?.name || 'Kit item', quantity: Number(k.quantity || 1) } }) } })
  }
  function toggleAddKit(skuId, itemId) {
    setAddKitExcluded(function (prev) {
      const cur = { ...(prev[skuId] || {}) }
      if (cur[itemId]) delete cur[itemId]; else cur[itemId] = true
      return { ...prev, [skuId]: cur }
    })
  }
  function feeFor(sku) {
    const o = addFeeOverride[sku.id]
    return o != null ? (parseInt(o, 10) || 0) : (sku.student_fee || 0)
  }

  // ── Add new enrollments — records fees (with optional coupon) and assigns batches ──
  async function addEnrollments() {
    if (!selectedNewSkus.length) { showToast('Select at least one course', 'warn'); return }
    setAddingEnrollment(true)

    // 1) Insert the enrollments (with chosen enrollment date)
    const enrolledAt = (addEnrollDate || new Date().toISOString().slice(0, 10)) + 'T00:00:00+00:00'
    const rows = selectedNewSkus.map(function (sku) {
      const isMonthly = sku.courses?.billing_type === 'monthly'
      const perWeek = isMonthly ? (addSessionsPerWeek[sku.id] != null ? Number(addSessionsPerWeek[sku.id]) : 3) : null
      return {
        student_id:    student.id,
        sku_id:        sku.id,
        franchisee_id: student.franchisee_id,
        enrolled_at:   enrolledAt,
        sessions_per_week:  isMonthly ? perWeek : null,
        sessions_per_cycle: isMonthly ? Math.round((perWeek || 0) * 4) : null,
        cycle_started_at:   isMonthly ? addEnrollDate : null,
      }
    })
    const { data, error } = await sb.from('enrollments').insert(rows)
      .select('id, sku_id, fee_amount, list_price, waived, sessions_per_week, sessions_per_cycle, cycle_started_at, cycle_days, enrolled_at, completed_at, status, marks_obtained, marks_total, marks_remarks, marks_submitted_at, cert_status, cert_reject_note, cert_emailed_at, cert_wa_sent_at, cert_issued_at, skus(level_name, courses(group_name))')
    if (error) { setAddingEnrollment(false); showToast('Failed: ' + error.message, 'err'); return }
    const added = data || []

    // 2) Assign / create a batch per selected course (joining date = enrollment date)
    const assignedAt = enrolledAt
    for (let i = 0; i < selectedNewSkus.length; i++) {
      const sku = selectedNewSkus[i]
      const enr = added.find(function (e) { return e.sku_id === sku.id })
      const sel = addBatchSel[sku.id]
      if (!enr || !sel) continue
      let batchId = sel
      if (sel === '__new__') {
        const nbf = addNewBatch[sku.id] || {}
        if (!nbf.ci || !nbf.name || !nbf.name.trim()) continue
        const { data: nb, error: bErr } = await sb.from('batches').insert({
          instructor_id: nbf.ci, franchisee_id: student.franchisee_id, name: nbf.name.trim(),
          is_individual: nbf.is_individual || false,
          schedule_days: (nbf.days || []).length ? nbf.days.join(', ') : null,
          schedule_time: nbf.time || null, is_active: true, sessions_done: 0,
        }).select('id').single()
        if (bErr) { showToast('Batch create failed for ' + sku.level_name + ': ' + bErr.message, 'warn'); continue }
        batchId = nb.id
      }
      await sb.from('batch_students').insert({ batch_id: batchId, enrollment_id: enr.id, assigned_at: assignedAt })
    }

    // 3) Fees — add the new courses' fee (net of any coupon) to the Fee Total
    const addedFee = selectedNewSkus.reduce(function (s, sk) { return s + feeFor(sk) }, 0)
    const discount = addCoupon ? Math.min(addCoupon.discount, addedFee) : 0
    const netAdded = Math.max(0, addedFee - discount)
    const newFeeTotal = (Number(form.fee_total) || 0) + netAdded
    // Re-joining a closed student: adding a course reactivates the account, but
    // the past stays settled — dropped courses stay dropped, the waiver stays a
    // credit. So the new course starts fresh and the written-off balance never
    // returns. deriveStatus counts fee_paid + waiver as covered, leaving only
    // the new course due.
    const rejoining = form.is_active === false
    if (addedFee > 0 || rejoining) {
      // Status from the settlement pass over the combined set: dropped courses
      // stay waived, the new active course carries its own due — the written-off
      // past never returns.
      const nextSet = localEnrollments.concat(added || [])
      const cov2 = computeCoverage(nextSet, payments, newFeeTotal, form.other_charges)
      const paidTotal = payments.reduce(function (s, p) { return s + (p.amount || 0) }, 0)
      const status = cov2.activeOutstanding > 0 ? (paidTotal > 0 ? 'partial' : 'pending')
                   : (cov2.waivedTotal > 0 ? 'waived' : (newFeeTotal > 0 ? 'paid' : 'none'))
      const patch = { fee_total: newFeeTotal, payment_status: status }
      if (rejoining) { patch.is_active = true; patch.closed_at = null; patch.close_reason = null }
      await sb.from('students').update(patch).eq('id', student.id)
      setForm(function (f) { return { ...f, fee_total: newFeeTotal, ...(rejoining ? { is_active: true } : {}) } })
      if (rejoining) { onSaved({ ...student, is_active: true, fee_total: newFeeTotal }); showToast('Welcome back — account reactivated for the new course') }
    }
    // Coupon applied to the added fee but not locked here — it redeems when the
    // first fee payment is received (see StudentReceiptModal).

    // 3b) Raise ONE invoice for this enrolment (courses w/ edited fees + selected kit items)
    const invLines = []
    selectedNewSkus.forEach(function (sku) {
      const enr = added.find(function (e) { return e.sku_id === sku.id })
      const cname = (sku.courses?.group_name ? sku.courses.group_name + ' — ' : '') + sku.level_name
      // A level in a course the student already has (or had) is a next level —
      // flagged so the Accounts tab and receipts can call it that.
      const grp = sku.courses?.group_name
      const isNext = !!grp && localEnrollments.some(function (e) { return e.skus?.courses?.group_name === grp })
      invLines.push({ kind: 'course', sku_id: sku.id, enrollment_id: enr?.id || null, name: cname, qty: 1, rate: feeFor(sku), amount: feeFor(sku), ...(isNext ? { cycle: 'next_level' } : {}) })
      const ex = addKitExcluded[sku.id] || {}
      ;(addKitData[sku.id] || []).filter(function (k) { return !ex[k.item_id] }).forEach(function (k) {
        invLines.push({ kind: 'kit', sku_id: sku.id, item_id: k.item_id, name: k.name, qty: k.quantity, rate: 0, amount: 0 })
      })
    })
    const { data: newInv } = await sb.from('student_invoices').insert({
      student_id: student.id, franchisee_id: student.franchisee_id || null,
      enrollment_id: added.length === 1 ? added[0].id : null,
      invoice_date: addEnrollDate || new Date().toISOString().slice(0, 10), items: invLines,
      subtotal: addedFee, discount: discount, coupon_code: addCoupon?.code || null,
      total: netAdded, amount_paid: 0, status: netAdded > 0 ? 'unpaid' : 'paid',
      created_by: currentUser?.email || currentRole || null,
    }).select().single()
    if (newInv) setInvoices(function (prev) { return [newInv, ...prev] })

    // 3c) Deduct HO stock for the SELECTED kit items, per enrollment (guarded once)
    const stockRows = []
    selectedNewSkus.forEach(function (sku) {
      const enr = added.find(function (e) { return e.sku_id === sku.id })
      if (!enr) return
      const ex = addKitExcluded[sku.id] || {}
      ;(addKitData[sku.id] || []).filter(function (k) { return !ex[k.item_id] && k.quantity > 0 }).forEach(function (k) {
        stockRows.push({ item_id: k.item_id, location_type: 'ho', movement_type: 'issue_to_student', qty: -k.quantity, ref_type: 'enrollment', ref_id: enr.id, franchisee_id: student.franchisee_id || null, note: 'Kit · ' + (student.full_name || 'student') })
      })
    })
    if (stockRows.length) {
      const { error: stkErr } = await sb.from('stock_ledger').insert(stockRows)
      if (!stkErr) setKitIssued(function (prev) { const n = { ...prev }; added.forEach(function (e) { n[e.id] = true }); return n })
    }
    if (newInv) showToast('🧾 Invoice ' + (newInv.invoice_no || '') + ' generated')
    try { await mirrorStudentToTransaction(student.id) } catch (e) { console.warn('[Phase 3 dual-write] add-course mirror failed:', e.message) }

    // 4) Reflect batch assignments for the new courses immediately
    const newEnrIds = added.map(function (e) { return e.id })
    if (newEnrIds.length) {
      const { data: bsRows } = await sb.from('batch_students')
        .select('id, enrollment_id, assigned_at, batch_id, batches(id, name, schedule_days, schedule_time, instructor_id, instructors(full_name))')
        .in('enrollment_id', newEnrIds).is('removed_at', null)
      if (bsRows && bsRows.length) setBatchAssignments(function (prev) {
        const n = { ...prev }; bsRows.forEach(function (r) { n[r.enrollment_id] = r }); return n
      })
    }

    // 4b) Pull session totals + billing for the new SKUs so rows show "0 / N" immediately
    const newSkuIds = added.map(function (e) { return e.sku_id })
    if (newSkuIds.length) {
      const { data: skuRows } = await sb.from('skus').select('id, total_sessions, courses(billing_type)').in('id', newSkuIds)
      if (skuRows) {
        setSkuTotals(function (prev) { const n = { ...prev }; skuRows.forEach(function (s) { n[s.id] = s.total_sessions }); return n })
        setSkuBilling(function (prev) { const n = { ...prev }; skuRows.forEach(function (s) { n[s.id] = s.courses?.billing_type || null }); return n })
      }
    }
    setSessionCounts(function (prev) { const n = { ...prev }; added.forEach(function (e) { if (n[e.id] == null) n[e.id] = 0 }); return n })

    // Kit issuance + invoice happen per-enrollment via the 🧾 Invoice button on
    // each course row (with kit-item selection) — not automatically here.

    // 5) Local state + cleanup
    setLocalEnrollments(function (prev) { return [...prev, ...added] })
    const addedSkuIds = added.map(function (e) { return e.sku_id })
    setAvailableSkus(function (prev) { return prev.filter(function (s) { return !addedSkuIds.includes(s.id) }) })
    setSelectedNewSkus([]); setShowAddEnrollment(false)
    setAddCoupon(null); setAddBatchSel({}); setAddNewBatch({})
    setAddFeeOverride({}); setAddKitData({}); setAddKitExcluded({})
    setAddingEnrollment(false)
    showToast(added.length + ' course' + (added.length !== 1 ? 's' : '') + ' added · ₹' + fmtAmt(netAdded) + ' added to fees')
    const { data: updated } = await sb.from('students')
      .select('*, enrollments(id, sku_id, fee_amount, list_price, waived, sessions_per_week, sessions_per_cycle, cycle_started_at, cycle_days, enrolled_at, completed_at, status, marks_obtained, marks_total, marks_remarks, marks_submitted_at, cert_status, cert_reject_note, cert_emailed_at, cert_wa_sent_at, cert_issued_at, skus(level_name, courses(group_name)))')
      .eq('id', student.id).single()
    if (updated) onSaved(updated)
  }

  // Discontinue ONE course: waive its unpaid remainder by reducing THAT course's
  // fee and the student's agreed total (a waiver is just a discount applied at
  // withdrawal). The amount is stored on the enrolment so it can be restored.
  async function discontinueCourse(en) {
    const cov = feeCoverage[en.id] || {}
    const due = Math.max(0, cov.due || 0)
    const label = (en.skus?.courses?.group_name || '') + (en.skus?.level_name ? ' — ' + en.skus.level_name : '')
    const msg = 'Discontinue ' + (label || 'this course') + '?\n\n' +
      '• Marked Discontinued — no certificate\n' +
      (due > 0 ? '• Its unpaid ₹' + fmtAmt(due) + ' will be WAIVED (written off)\n' : '') +
      '\nThe student stays active. This can be undone.'
    if (!window.confirm(msg)) return
    setCourseBusy(en.id)
    const newFee    = (Number(en.fee_amount) || 0) - due
    const newWaived = (Number(en.waived) || 0) + due
    const newTotal  = (Number(form.fee_total) || 0) - due
    const { error } = await sb.from('enrollments')
      .update({ status: 'dropped', fee_amount: newFee, waived: newWaived }).eq('id', en.id)
    if (!error) await sb.from('students').update({
      fee_total: newTotal, waived_amount: (Number(form.waived_amount) || 0) + due,
      payment_status: deriveStatus(newTotal, Number(form.fee_paid) || 0),
    }).eq('id', student.id)
    setCourseBusy(null)
    if (error) { showToast('Could not discontinue: ' + error.message, 'err'); return }
    try { await mirrorStudentToTransaction(student.id) } catch (e) { console.warn('[Phase 3 dual-write] discontinue mirror failed:', e.message) }
    const next = localEnrollments.map(function (e) { return e.id === en.id ? { ...e, status: 'dropped', fee_amount: newFee, waived: newWaived } : e })
    setLocalEnrollments(next)
    setForm(function (f) { return { ...f, fee_total: newTotal, waived_amount: (Number(f.waived_amount) || 0) + due } })
    showToast(due > 0 ? 'Course discontinued · ₹' + fmtAmt(due) + ' waived' : 'Course discontinued')
    onSaved({ ...student, fee_total: newTotal, enrollments: next })
  }

  // Undo a discontinuation — the waived amount is restored to the course fee and
  // the agreed total, and the course becomes active and due again.
  async function restoreCourse(en) {
    setCourseBusy(en.id)
    const back      = Number(en.waived) || 0
    const newFee    = (Number(en.fee_amount) || 0) + back
    const newTotal  = (Number(form.fee_total) || 0) + back
    const { error } = await sb.from('enrollments')
      .update({ status: 'active', fee_amount: newFee, waived: 0 }).eq('id', en.id)
    if (!error) await sb.from('students').update({
      fee_total: newTotal, waived_amount: Math.max(0, (Number(form.waived_amount) || 0) - back),
      payment_status: deriveStatus(newTotal, Number(form.fee_paid) || 0),
    }).eq('id', student.id)
    setCourseBusy(null)
    if (error) { showToast('Could not restore: ' + error.message, 'err'); return }
    try { await mirrorStudentToTransaction(student.id) } catch (e) { console.warn('[Phase 3 dual-write] restore-course mirror failed:', e.message) }
    const next = localEnrollments.map(function (e) { return e.id === en.id ? { ...e, status: 'active', fee_amount: newFee, waived: 0 } : e })
    setLocalEnrollments(next)
    setForm(function (f) { return { ...f, fee_total: newTotal, waived_amount: Math.max(0, (Number(f.waived_amount) || 0) - back) } })
    showToast('Course restored')
    onSaved({ ...student, fee_total: newTotal, enrollments: next })
  }

  // ── Delete student (admin only) ──
  // Close a student who left mid-course: discontinue every unfinished course (no
  // certificate), waive the outstanding balance (recorded, never a payment) and
  // deactivate them. Reversible — nothing is deleted.
  async function closeStudentAccount() {
    const bal = balance
    const msg = 'Close ' + student.full_name + "'s account?\n\n" +
      '• Unfinished courses will be marked Discontinued (no certificate)\n' +
      (bal > 0 ? '• The outstanding ₹' + fmtAmt(bal) + ' will be WAIVED (written off, not collected)\n' : '') +
      '• The student will be moved to Inactive\n\nThis can be reopened later.'
    if (!window.confirm(msg)) return
    const reason = window.prompt('Reason for closing (optional) — e.g. discontinued, relocated:', '')
    if (reason === null) return   // cancelled the second dialog

    setClosing(true)
    // Waive each unfinished course's due (reduce its fee + the agreed total),
    // then deactivate. Each course keeps its waived amount for a later reopen.
    const openEnr = localEnrollments.filter(function (e) { return !e.completed_at && e.status !== 'dropped' })
    let totalWaived = 0
    const nextById = {}
    for (let i = 0; i < openEnr.length; i++) {
      const e = openEnr[i]
      const due = Math.max(0, (feeCoverage[e.id] && feeCoverage[e.id].due) || 0)
      totalWaived += due
      const nf = (Number(e.fee_amount) || 0) - due
      const nw = (Number(e.waived) || 0) + due
      nextById[e.id] = { ...e, status: 'dropped', fee_amount: nf, waived: nw }
      await sb.from('enrollments').update({ status: 'dropped', fee_amount: nf, waived: nw }).eq('id', e.id)
    }
    const newTotal = (Number(form.fee_total) || 0) - totalWaived
    const newWA    = (Number(form.waived_amount) || 0) + totalWaived
    const status   = (newTotal - (Number(form.fee_paid) || 0) <= 0 && newWA > 0) ? 'waived' : deriveStatus(newTotal, form.fee_paid)
    const { error } = await sb.from('students').update({
      is_active: false, payment_status: status, fee_total: newTotal, waived_amount: newWA,
      closed_at: new Date().toISOString(), close_reason: reason.trim() || null,
    }).eq('id', student.id)
    setClosing(false)
    if (error) { showToast('Could not close the account: ' + error.message, 'err'); return }
    try { await mirrorStudentToTransaction(student.id) } catch (e) { console.warn('[Phase 3 dual-write] close-account mirror failed:', e.message) }

    setLocalEnrollments(localEnrollments.map(function (e) { return nextById[e.id] || e }))
    setForm(function (f) { return { ...f, is_active: false, fee_total: newTotal, waived_amount: newWA, payment_status: status } })
    showToast(totalWaived > 0 ? 'Account closed · ₹' + fmtAmt(totalWaived) + ' waived' : 'Account closed')
    onSaved({ ...student, is_active: false, fee_total: newTotal, payment_status: status, closed_at: new Date().toISOString() })
  }

  async function reopenStudentAccount() {
    if (!window.confirm('Reopen ' + student.full_name + "'s account? They return to Active. Waived fees become due again, and discontinued courses become active.")) return
    setClosing(true)
    const discEnr = localEnrollments.filter(function (e) { return e.status === 'dropped' })
    let totalBack = 0
    const nextById = {}
    for (let i = 0; i < discEnr.length; i++) {
      const e = discEnr[i]
      const back = Number(e.waived) || 0
      totalBack += back
      const nf = (Number(e.fee_amount) || 0) + back
      nextById[e.id] = { ...e, status: 'active', fee_amount: nf, waived: 0 }
      await sb.from('enrollments').update({ status: 'active', fee_amount: nf, waived: 0 }).eq('id', e.id)
    }
    const newTotal = (Number(form.fee_total) || 0) + totalBack
    const status   = deriveStatus(newTotal, form.fee_paid)
    const { error } = await sb.from('students').update({
      is_active: true, payment_status: status, fee_total: newTotal, waived_amount: 0,
      closed_at: null, close_reason: null,
    }).eq('id', student.id)
    setClosing(false)
    if (error) { showToast('Could not reopen: ' + error.message, 'err'); return }
    try { await mirrorStudentToTransaction(student.id) } catch (e) { console.warn('[Phase 3 dual-write] reopen-account mirror failed:', e.message) }
    setLocalEnrollments(localEnrollments.map(function (e) { return nextById[e.id] || e }))
    setForm(function (f) { return { ...f, is_active: true, fee_total: newTotal, waived_amount: 0, payment_status: status } })
    showToast('Account reopened')
    onSaved({ ...student, is_active: true, fee_total: newTotal, payment_status: status, closed_at: null })
  }

  async function deleteStudent() {
    // Deleting a student cascades away their payment + receipt records. That is
    // financial history — once money has been taken, use Close/Withdraw (which
    // keeps the record) instead of erasing it. Delete stays available for a
    // genuine mis-entry that never took a payment.
    const { count: payCount } = await sb.from('student_payments')
      .select('id', { count: 'exact', head: true }).eq('student_id', student.id)
    if ((payCount || 0) > 0) {
      showToast(student.full_name + ' has ' + payCount + ' recorded payment' + (payCount > 1 ? 's' : '') +
        ' — use ⊘ Close / Withdraw to keep the receipts. Delete is only for entries with no payments.', 'warn')
      return
    }
    if (!window.confirm('Permanently delete ' + student.full_name + ' and ALL their records (enrollments, batch assignments)?\n\nThis CANNOT be undone.')) return
    setDeleting(true)
    const enrIds = localEnrollments.map(function (e) { return e.id })
    if (enrIds.length > 0) {
      await sb.from('batch_students').delete().in('enrollment_id', enrIds)
      await sb.from('enrollments').delete().in('id', enrIds)
    }
    const { error } = await sb.from('students').delete().eq('id', student.id)
    setDeleting(false)
    if (error) { showToast('Delete failed: ' + error.message, 'err'); return }
    try { await sb.from('transactions').delete().eq('type', 'course_fee').eq('person_id', student.id) } catch (e) { console.warn('[Phase 3 dual-write] student delete mirror failed:', e.message) }
    showToast(student.full_name + ' deleted')
    onSaved(null)   // null signals deletion to parent
    onClose()
  }

  return (
    <div
      className={inline ? '' : 'modal-bg'}
      onClick={inline ? undefined : function (e) { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className={inline ? '' : 'modal'}
        style={inline
          ? { width: '100%', background: 'var(--card, #fff)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,.05)' }
          : { width: 860, maxWidth: '96vw' }}
      >
        {/* Hero header */}
        {(function () {
          var av = (student.full_name || '?').split(' ').map(function (w) { return w[0] }).join('').slice(0, 2).toUpperCase()
          var loc = [form.city, form.state].filter(Boolean).join(', ')
          return (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, padding: '18px 20px 14px', background: 'linear-gradient(135deg,#eff6ff,#dbeafe)', borderBottom: '1px solid var(--border)' }}>
              <div style={{ width: 50, height: 50, borderRadius: 13, flexShrink: 0, background: '#dbeafe', color: '#1d4ed8', display: 'flex', alignItems: 'center', justifyContent: 'center', font: '700 17px var(--font)' }}>{av}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', marginBottom: 2 }}>
                  <span style={{ font: '700 15px var(--font)', color: 'var(--text)' }}>{student.full_name}</span>
                  {derivedStatus && derivedStatus !== 'none' && (
                    <span className={`badge ${derivedStatus === 'paid' ? 'ba' : derivedStatus === 'partial' ? 'bp' : 'br'}`}>{derivedStatus}</span>
                  )}
                </div>
                {form.parent_name && <div style={{ font: '500 12px var(--font)', color: 'var(--text2)', marginBottom: 2 }}>Parent: {form.parent_name}</div>}
                {loc && <div style={{ font: '500 11px var(--font)', color: 'var(--text3)' }}>📍 {loc}</div>}
              </div>
              <button className="btn-icon" onClick={onClose} style={{ flexShrink: 0, marginTop: -2 }}>✕</button>
            </div>
          )
        })()}

        {/* Stats strip */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', background: 'var(--card)', borderBottom: '1px solid var(--border)' }}>
          {[
            { label: 'Courses',   val: localEnrollments.length > 0 ? String(localEnrollments.length) : '—', color: 'var(--blue)' },
            { label: 'Fee Total', val: form.fee_total !== '' && form.fee_total != null ? '₹' + fmtAmt(form.fee_total) : '—', color: 'var(--text)' },
            { label: 'Paid',      val: form.fee_paid  !== '' && form.fee_paid  != null ? '₹' + fmtAmt(form.fee_paid)  : '—', color: 'var(--green)' },
            { label: 'Balance',   val: form.fee_total != null && form.fee_total !== '' ? (balance > 0 ? '₹' + fmtAmt(balance) : '✓ Cleared') : '—', color: balance > 0 ? 'var(--red)' : 'var(--green)' },
          ].map(function (st, i) {
            return (
              <div key={i} style={{ padding: '9px 14px', borderRight: i < 3 ? '1px solid var(--border)' : 'none' }}>
                <div style={{ font: '500 9px var(--mono)', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 3 }}>{st.label}</div>
                <div style={{ font: '700 14px var(--font)', color: st.color }}>{st.val}</div>
              </div>
            )
          })}
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, padding: '0 20px', borderBottom: '1px solid var(--border)', background: 'var(--bg)' }}>
          {['profile', 'courses', 'accounts'].map(function (t) {
            return (
              <button
                key={t}
                onClick={function () {
                  setTab(t)
                  if (t === 'courses') loadCoursesTab()
                }}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  padding: '10px 16px', fontSize: 13, fontWeight: 600,
                  color: tab === t ? 'var(--purple)' : 'var(--text3)',
                  borderBottom: tab === t ? '2px solid var(--purple)' : '2px solid transparent',
                  marginBottom: -1, transition: 'color 0.15s',
                }}
              >
                {t === 'profile' ? '👤 Profile' : t === 'courses' ? '📚 Courses & Batches' : '💰 Accounts'}
              </button>
            )
          })}
        </div>

        {/* ── PROFILE TAB ── */}
        {tab === 'profile' && (
          <div>
            <div className="form-grid">
              {/* Row 1 — Student Name / Parent-Guardian */}
              <label>Student Name *
                <input value={form.full_name} onChange={field('full_name')} disabled={!canEdit} />
              </label>
              <label>Parent / Guardian
                <input value={form.parent_name} onChange={field('parent_name')} disabled={!canEdit} />
              </label>

              {/* Row 2 — Gender (left) / Date of Birth + Date of Registration (right) */}
              <label>Gender
                <select value={form.gender} onChange={field('gender')} disabled={!canEdit}>
                  <option value="">— Select —</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                </select>
              </label>
              <div style={{ display: 'flex', gap: 12 }}>
                <label style={{ flex: 1 }}>Date of Birth
                  <input type="date" value={form.dob} onChange={field('dob')} disabled={!canEdit} />
                </label>
                <label style={{ flex: 1 }}>Date of Registration
                  <input type="date" value={form.registered_at} onChange={field('registered_at')} disabled={!canEdit} />
                </label>
              </div>

              {/* Row 3 — Parent Email / Phone */}
              <label>Parent Email
                <input type="email" value={form.email} onChange={field('email')} disabled={!canEdit} placeholder="parent@email.com" />
              </label>
              <label>Phone
                <input value={form.phone}
                  onChange={function (e) { setForm(function (f) { return { ...f, phone: to10Digit(e.target.value) } }) }}
                  inputMode="numeric" maxLength={10}
                  placeholder="10-digit mobile — no country code"
                  disabled={!canEdit} />
              </label>

              {/* Row 4 — Street/Building Address / Area-Locality */}
              <label>Street / Building Address
                <input value={form.address} onChange={field('address')} disabled={!canEdit} placeholder="Flat/Shop no., building, street" />
              </label>
              <label>Area / Locality
                <input value={form.area} onChange={field('area')} disabled={!canEdit} placeholder="Neighbourhood / Area" />
              </label>

              {/* Row 5 — City + State (left) / PIN + Country (right) */}
              <div style={{ display: 'flex', gap: 12 }}>
                <label style={{ flex: 1 }}>City
                  <input value={form.city} onChange={field('city')} disabled={!canEdit} placeholder="Nagpur" />
                </label>
                <label style={{ flex: 1 }}>State
                  <input value={form.state} onChange={field('state')} disabled={!canEdit} placeholder="Maharashtra" />
                </label>
              </div>
              <div style={{ display: 'flex', gap: 12 }}>
                <label style={{ flex: 1 }}>PIN Code
                  <input value={form.pincode} onChange={field('pincode')} disabled={!canEdit} placeholder="e.g. 440001" />
                </label>
                <label style={{ flex: 1 }}>Country
                  <input value={form.country} onChange={field('country')} disabled={!canEdit} placeholder="India" />
                </label>
              </div>

              {/* Row 6 — Enrolment Channel / Payment Status */}
              <label>Enrolment Channel
                <select
                  value={form.channel}
                  disabled={!canEdit}
                  onChange={function (e) {
                    const v = e.target.value
                    setForm(function (f) { return { ...f, channel: v, camp_name: v === 'camp' ? f.camp_name : '' } })
                  }}>
                  <option value="franchise">Franchise Centre</option>
                  <option value="own_centre">NLH Own Centre</option>
                  <option value="international">International / Online</option>
                  <option value="walk-in">Walk-in</option>
                  <option value="referral">Referral</option>
                  <option value="online">Online Campaign</option>
                  <option value="camp">Camp / Event</option>
                  <option value="school">School Tie-up</option>
                  <option value="other">Other</option>
                </select>
              </label>
              {form.channel === 'camp' && (
                <label>Camp name
                  <input
                    value={form.camp_name}
                    onChange={field('camp_name')}
                    disabled={!canEdit}
                    placeholder="e.g. Summer Camp 2026"
                  />
                  <p className="hint">Appears on the certificate above the course names.</p>
                </label>
              )}
              <label>Payment Status
                <div style={{ paddingTop: 6 }}>
                  <StatusBadge status={derivedStatus} />
                  <span style={{ fontSize: 11, color: 'var(--text3)', marginLeft: 6 }}>auto-calculated</span>
                </div>
              </label>
            </div>

            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <strong>Fee Tracking
                  {localEnrollments.length > 1 && (
                    <span style={{ font: '500 11px var(--font)', color: 'var(--text3)', marginLeft: 8 }}>
                      · agreed total across {localEnrollments.length} courses — see Courses &amp; Batches for each
                    </span>
                  )}
                </strong>
                <div style={{ display: 'flex', gap: 6 }}>
                  {canManageFees && balance > 0 && (
                    <button className="btn-s" style={{ fontSize: 12, padding: '5px 12px' }}
                      onClick={function () { setWaConfirm({ label: 'Send Balance Reminder', phone: receiptPhone || student.phone || '', send: sendFeeReminderWA }) }} disabled={remindSending}
                      title="Send a WhatsApp balance reminder to the parent">
                      {remindSending ? '…' : '⏰ Remind'}
                    </button>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
                <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>Agreed Fee (₹)
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input type="number" value={form.fee_total} onChange={field('fee_total')} disabled={!canManageFees}
                      placeholder="Type agreed amount" style={{ flex: 1 }} title="The total fee agreed with the parent — edit freely" />
                    {canManageFees && (
                      <button className="btn-s" style={{ fontSize: 12, whiteSpace: 'nowrap' }} onClick={saveFeeOnly} title="Save the fee amount">Save</button>
                    )}
                  </div>
                </label>
                <div style={{ flex: 1, display: 'flex', gap: 12 }}>
                <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>Fee Paid (₹)
                  <input value={'₹' + fmtAmt(form.fee_paid || 0)} disabled
                    style={{ color: 'var(--green)' }} title="Sum of recorded payments — record a payment to change this" />
                </label>
                <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>Balance
                  <input
                    value={balance > 0 ? '₹' + fmtAmt(balance) : '✓ Cleared'}
                    disabled
                    style={{ color: balance > 0 ? 'var(--red)' : 'var(--green)' }}
                  />
                </label>
                </div>
              </div>

              {/* Give discount on the agreed fee */}
              {canManageFees && (
                <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ font: '600 12px var(--font)', color: 'var(--text2)' }}>🎟️ Give discount</span>
                  <CouponField context="student" amount={Number(form.fee_total) || 0} franchiseeId={student.franchisee_id}
                    applied={null} onApply={applyFeeDiscount} excludeRef={student.id} compact />
                  <span style={{ font: '500 11px var(--font)', color: 'var(--text3)' }}>— or just lower the Agreed Fee above and Save</span>
                </div>
              )}

              {/* Payment history */}
              <div style={{ marginTop: 12 }}>
                <div style={{ font: '600 11px var(--mono)', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 6 }}>
                  Payment history
                </div>
                {payments.length === 0 ? (
                  <p className="hint" style={{ margin: 0 }}>No payments recorded yet. Record payments from Students → Receipts.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {payments.map(function (p) {
                      if (admin && editPayId === p.id) {
                        return (
                          <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', padding: '8px 10px', borderRadius: 8, background: 'var(--bg)', border: '1.5px solid var(--purple)' }}>
                            <input type="number" value={editPay.amount} onChange={function (e) { setEditPay(function (f) { return { ...f, amount: e.target.value } }) }}
                              placeholder="Amount" style={{ width: 90, fontSize: 12 }} />
                            <input type="date" value={editPay.paid_at} onChange={function (e) { setEditPay(function (f) { return { ...f, paid_at: e.target.value } }) }}
                              style={{ fontSize: 12 }} />
                            <select value={editPay.mode} onChange={function (e) { setEditPay(function (f) { return { ...f, mode: e.target.value } }) }} style={{ fontSize: 12 }}>
                              <option value="">— mode —</option>
                              {['cash', 'upi', 'cheque', 'card', 'online'].concat(
                                editPay.mode && !['cash', 'upi', 'cheque', 'card', 'online'].includes(editPay.mode) ? [editPay.mode] : []
                              ).map(function (m) { return <option key={m} value={m}>{m}</option> })}
                            </select>
                            <input value={editPay.reference} onChange={function (e) { setEditPay(function (f) { return { ...f, reference: e.target.value } }) }}
                              placeholder="Reference / UTR" style={{ flex: 1, minWidth: 110, fontSize: 12 }} />
                            <button className="btn-p" style={{ fontSize: 10, padding: '3px 10px' }} onClick={savePaymentEdit}>Save</button>
                            <button className="btn-s" style={{ fontSize: 10, padding: '3px 10px' }} onClick={function () { setEditPayId(null) }}>Cancel</button>
                          </div>
                        )
                      }
                      return (
                        <div key={p.id} style={{
                          display: 'flex', alignItems: 'center', gap: 10,
                          padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)',
                        }}>
                          <div style={{ font: '700 13px var(--mono)', color: 'var(--green)', minWidth: 72 }}>₹{fmtAmt(p.amount)}</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ font: '500 12px var(--font)', color: 'var(--text)' }}>
                              {fmtDate(p.paid_at)}
                              {p.mode && <span style={{ color: 'var(--text3)' }}> · {p.mode.replace(/_/g, ' ')}</span>}
                            </div>
                            <div style={{ font: '500 10px var(--mono)', color: 'var(--text3)' }}>
                              {p.receipt_no ? p.receipt_no : ''}
                              {(p.reference || p.note) ? (p.receipt_no ? ' · ' : '') + (p.reference || p.note) : ''}
                            </div>
                          </div>
                          {canManageFees && (
                            <button className="btn-s" style={{ fontSize: 10, padding: '2px 8px', whiteSpace: 'nowrap' }}
                              title="Print / save receipt"
                              onClick={function () { handlePrintReceipt(p) }}>
                              🧾 Print
                            </button>
                          )}
                          {canManageFees && (
                            <button className="btn-s" style={{ fontSize: 10, padding: '2px 8px', whiteSpace: 'nowrap' }}
                              title="Resend WhatsApp receipt to parent"
                              onClick={function () { setWaConfirm({ label: 'Send Payment Receipt', phone: receiptPhone || student.phone || '', send: function (phone) { return resendReceipt(p, phone) } }) }}>
                              💬 Receipt
                            </button>
                          )}
                          {admin && (
                            <button className="btn-s" style={{ fontSize: 10, padding: '2px 8px', whiteSpace: 'nowrap' }}
                              title="Edit date / method / amount"
                              onClick={function () { startEditPay(p) }}>✎ Edit</button>
                          )}
                          {admin && (
                            <button className="btn" style={{ fontSize: 10, padding: '2px 7px', color: 'var(--red, #dc2626)', borderColor: 'var(--red, #dc2626)' }}
                              onClick={function () { if (window.confirm('Remove this ₹' + fmtAmt(p.amount) + ' payment entry?')) deletePayment(p.id) }}>
                              🗑
                            </button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Invoice history */}
              <div style={{ marginTop: 14 }}>
                <div style={{ font: '600 11px var(--mono)', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 6 }}>
                  Invoice history
                </div>
                {invoices.length === 0 ? (
                  <p className="hint" style={{ margin: 0 }}>No invoices yet — generate one from the Courses &amp; Batches tab or when adding a course.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {invoices.map(function (inv) {
                      const bal = Math.max(0, (inv.total || 0) - (inv.amount_paid || 0))
                      if (admin && editInvId === inv.id) {
                        return (
                          <div key={inv.id} style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', padding: '8px 10px', borderRadius: 8, background: 'var(--bg)', border: '1.5px solid var(--purple)' }}>
                            <span style={{ font: '700 11px var(--mono)', color: 'var(--purple)' }}>{inv.invoice_no}</span>
                            <input type="date" value={editInv.invoice_date || ''} onChange={function (e) { setEditInv(function (f) { return { ...f, invoice_date: e.target.value } }) }} style={{ fontSize: 12 }} />
                            <input type="number" value={editInv.amount_paid} onChange={function (e) { setEditInv(function (f) { return { ...f, amount_paid: e.target.value } }) }} placeholder="Paid" style={{ width: 80, fontSize: 12 }} />
                            <select value={editInv.status} onChange={function (e) { setEditInv(function (f) { return { ...f, status: e.target.value } }) }} style={{ fontSize: 12 }}>
                              {['unpaid', 'part', 'paid'].map(function (s) { return <option key={s} value={s}>{s}</option> })}
                            </select>
                            <button className="btn-p" style={{ fontSize: 10, padding: '3px 10px' }} onClick={saveInvoiceEdit}>Save</button>
                            <button className="btn-s" style={{ fontSize: 10, padding: '3px 10px' }} onClick={function () { setEditInvId(null) }}>Cancel</button>
                          </div>
                        )
                      }
                      return (
                        <div key={inv.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)' }}>
                          <div style={{ font: '700 12px var(--mono)', color: 'var(--purple)', minWidth: 120 }}>{inv.invoice_no}</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ font: '500 12px var(--font)', color: 'var(--text)' }}>
                              {fmtDate(inv.invoice_date)} · ₹{fmtAmt(inv.total)}
                              <span style={{ color: bal > 0 ? 'var(--red)' : 'var(--green)', marginLeft: 6 }}>{bal > 0 ? '₹' + fmtAmt(bal) + ' due' : 'paid ✓'}</span>
                            </div>
                            <div style={{ font: '500 10px var(--mono)', color: 'var(--text3)' }}>
                              {(inv.items || []).filter(function (i) { return i.kind === 'course' }).map(function (i) { return i.name }).join(', ')}
                            </div>
                          </div>
                          <button className="btn-s" style={{ fontSize: 10, padding: '2px 8px', whiteSpace: 'nowrap' }} title="Print / save invoice" onClick={function () { handlePrintInvoice(inv) }}>🧾 Print</button>
                          {admin && <button className="btn-s" style={{ fontSize: 10, padding: '2px 8px', whiteSpace: 'nowrap' }} title="Edit date / paid / status" onClick={function () { startEditInvoice(inv) }}>✎ Edit</button>}
                          {admin && <button className="btn" style={{ fontSize: 10, padding: '2px 7px', color: 'var(--red, #dc2626)', borderColor: 'var(--red, #dc2626)' }} onClick={function () { if (window.confirm('Delete invoice ' + inv.invoice_no + '?')) deleteInvoice(inv.id) }}>🗑</button>}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Fee change history — the audit trail behind the numbers above */}
              <div style={{ marginTop: 14 }}>
                <button className="btn-s"
                  style={{ fontSize: 11, padding: '4px 10px' }}
                  onClick={function () {
                    const next = !feeEventsOpen
                    setFeeEventsOpen(next)
                    if (next && feeEvents === null) loadFeeEvents()
                  }}>
                  {feeEventsOpen ? '▾' : '▸'} Fee change history
                </button>
                {feeEventsOpen && (
                  <div style={{ marginTop: 8 }}>
                    {feeEvents === null ? (
                      <p className="hint" style={{ margin: 0 }}>Loading…</p>
                    ) : feeEvents.length === 0 ? (
                      <p className="hint" style={{ margin: 0 }}>No fee changes recorded yet. (Only changes made from now on are logged.)</p>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        {feeEvents.map(function (ev) {
                          const labels = { fee_total: 'Agreed fee', other_charges: 'Other charges',
                            waived_amount: 'Total waived', fee_amount: 'Course fee', waived: 'Course waiver', status: 'Course status' }
                          const enr = localEnrollments.find(function (e) { return e.id === ev.enrollment_id })
                          const course = enr ? ((enr.skus?.courses?.group_name || '') + (enr.skus?.level_name ? ' ' + enr.skus.level_name : '')) : ''
                          const numeric = ev.delta !== null && ev.field !== 'status'
                          return (
                            <div key={ev.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px',
                              borderRadius: 7, background: 'var(--bg)', border: '1px solid var(--border)', font: '500 11px var(--font)' }}>
                              <span style={{ color: 'var(--text3)', fontFamily: 'var(--mono)', minWidth: 96, fontSize: 10 }}>
                                {fmtDate(String(ev.at).slice(0, 10))}
                              </span>
                              <span style={{ fontWeight: 600, color: 'var(--text2)' }}>
                                {labels[ev.field] || ev.field}{course ? ' · ' + course : ''}
                              </span>
                              <span style={{ color: 'var(--text3)', fontFamily: 'var(--mono)' }}>
                                {numeric
                                  ? '₹' + fmtAmt(Number(ev.old_value) || 0) + ' → ₹' + fmtAmt(Number(ev.new_value) || 0)
                                  : (ev.old_value ? ev.old_value + ' → ' : '') + (ev.new_value || '')}
                              </span>
                              {numeric && ev.delta !== 0 && (
                                <span style={{ fontWeight: 700, color: ev.delta > 0 ? '#92400e' : 'var(--green)' }}>
                                  {ev.delta > 0 ? '+' : '−'}₹{fmtAmt(Math.abs(ev.delta))}
                                </span>
                              )}
                              <span style={{ marginLeft: 'auto', color: 'var(--text3)', fontSize: 10 }}>{ev.actor}</span>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── COURSES & BATCHES TAB ── */}
        {tab === 'accounts' && admin && (editPayId || editInvId) && (
          <div className="modal-bg" onClick={function (e) { if (e.target === e.currentTarget) { setEditPayId(null); setEditInvId(null) } }}>
            <div className="modal" style={{ maxWidth: 440 }}>
              {editPayId ? (
                <>
                  <ModalHeader flush title="Edit payment"
                    subtitle={(payments.find(function (x) { return x.id === editPayId }) || {}).receipt_no || ''}
                    onClose={function () { setEditPayId(null) }} />
                  <div className="form-grid" style={{ padding: '4px 20px 16px' }}>
                    <label>Amount (₹)
                      <input type="number" value={editPay.amount} onChange={function (e) { setEditPay(function (f) { return { ...f, amount: e.target.value } }) }} /></label>
                    <label>Date
                      <input type="date" value={editPay.paid_at} onChange={function (e) { setEditPay(function (f) { return { ...f, paid_at: e.target.value } }) }} /></label>
                    <label>Mode
                      <select value={editPay.mode} onChange={function (e) { setEditPay(function (f) { return { ...f, mode: e.target.value } }) }}>
                        <option value="">— mode —</option>
                        {['cash', 'upi', 'cheque', 'card', 'online'].concat(
                          editPay.mode && !['cash', 'upi', 'cheque', 'card', 'online'].includes(editPay.mode) ? [editPay.mode] : []
                        ).map(function (m) { return <option key={m} value={m}>{m}</option> })}
                      </select></label>
                    <label>Reference / UTR
                      <input value={editPay.reference} onChange={function (e) { setEditPay(function (f) { return { ...f, reference: e.target.value } }) }} /></label>
                  </div>
                  <div className="modal-actions">
                    <button className="btn" onClick={function () { setEditPayId(null) }}>Cancel</button>
                    <button className="btn-p" onClick={savePaymentEdit}>Save</button>
                  </div>
                </>
              ) : (
                <>
                  <ModalHeader flush title="Edit invoice"
                    subtitle={(invoices.find(function (x) { return x.id === editInvId }) || {}).invoice_no || ''}
                    onClose={function () { setEditInvId(null) }} />
                  <div className="form-grid" style={{ padding: '4px 20px 16px' }}>
                    <label>Invoice date
                      <input type="date" value={editInv.invoice_date || ''} onChange={function (e) { setEditInv(function (f) { return { ...f, invoice_date: e.target.value } }) }} /></label>
                    <label>Amount paid (₹)
                      <input type="number" value={editInv.amount_paid} onChange={function (e) { setEditInv(function (f) { return { ...f, amount_paid: e.target.value } }) }} /></label>
                    <label>Status
                      <select value={editInv.status} onChange={function (e) { setEditInv(function (f) { return { ...f, status: e.target.value } }) }}>
                        {['unpaid', 'part', 'paid'].map(function (x) { return <option key={x} value={x}>{x}</option> })}
                      </select></label>
                    <label>Notes
                      <input value={editInv.notes || ''} onChange={function (e) { setEditInv(function (f) { return { ...f, notes: e.target.value } }) }} /></label>
                  </div>
                  <div className="modal-actions">
                    <button className="btn" onClick={function () { setEditInvId(null) }}>Cancel</button>
                    <button className="btn-p" onClick={saveInvoiceEdit}>Save</button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {tab === 'accounts' && (
          <StudentLedgerView
            studentId={student.id}
            reloadKey={form.fee_total + ':' + payments.map(function (x) { return x.id + x.paid_at + x.amount }).join() + ':' + invoices.map(function (x) { return x.id + x.invoice_date + x.amount_paid + x.status }).join()}
            onPrintInvoice={handlePrintInvoice}
            onPrintReceipt={handlePrintReceipt}
            onEditInvoice={admin ? startEditInvoice : null}
            onEditPayment={admin ? startEditPay : null}
          />
        )}

        {tab === 'courses' && (
          <div style={{ padding: '16px 0' }}>
            {localEnrollments.length > 0 && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 10 }}>
                {localEnrollments.some(isMonthlyActive) && (function () {
                  const dueN = localEnrollments.filter(function (e) { if (!isMonthlyActive(e)) return false; const ri = renewalInfo(e); return ri && ri.state !== 'ok' }).length
                  return (
                    <button className="btn-s" style={{ fontSize: 12, fontWeight: 600, color: '#1D4ED8', background: '#DBEAFE', borderColor: '#93C5FD' }}
                      onClick={function () { openRenewCycle() }}
                      title="Renew one or more of this student's monthly courses together — one invoice">
                      📅 Renew cycle{dueN > 0 ? ' · ' + dueN + ' due' : ''}
                    </button>
                  )
                })()}
                <button className="btn-s" style={{ fontSize: 12 }} onClick={function () { setShowAttSheet(true) }}
                  title="Month-by-month present / absent / not marked for every course, and the classes attended">
                  📋 Attendance sheet
                </button>
              </div>
            )}
            {form.is_active === false && (
              <div style={{ marginBottom: 12, padding: '10px 14px', borderRadius: 10,
                background: '#fef2f2', border: '1px solid #fca5a5',
                font: '600 12px var(--font)', color: '#991b1b' }}>
                ⊘ Account closed{student.closed_at ? ' · ' + fmtDate(String(student.closed_at).slice(0, 10)) : ''}
                {(Number(form.waived_amount) || 0) > 0 && ' · ₹' + fmtAmt(form.waived_amount) + ' waived'}
                {student.close_reason ? ' · ' + student.close_reason : ''}
                <div style={{ fontWeight: 500, color: '#7f1d1d', marginTop: 4 }}>
                  Use <b>+ Add Course</b> below to re-join for a fresh course — the past stays closed and the waived balance does not return.
                  To undo this closure entirely, <b>Reopen</b> from the footer.
                </div>
              </div>
            )}
            {/* The enrolment confirmation is otherwise only offered on Add
                Student — there was no way to send it after a course is added
                later, or to re-send one the parent missed. */}
            {localEnrollments.length > 0 && (
              <div style={{ marginBottom: 12, padding: '9px 12px', borderRadius: 10,
                background: 'var(--green-bg, #f0fdf4)', border: '1px solid var(--green, #1D7A4F)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ font: '600 12px var(--font)', color: 'var(--green, #1D7A4F)' }}>
                    💬 Enrollment confirmation to parent
                  </span>
                  <input
                    value={enrolWaPhone}
                    onChange={function (e) { setEnrolWaPhone(e.target.value) }}
                    placeholder="Mobile number"
                    title="Send to a different number — a second parent, or a corrected one"
                    style={{ width: 140, fontSize: 12, padding: '3px 8px' }} />
                  <button className="btn-s" style={{ fontSize: 11, padding: '4px 10px', whiteSpace: 'nowrap', marginLeft: 'auto' }}
                    disabled={enrolWaSending || !enrolWaPhone.trim()}
                    onClick={sendEnrolmentWA}>
                    {enrolWaSending ? 'Sending…' : 'Send'}
                  </button>
                </div>
                {/* Confirmations usually cover the course just added, not the
                    student's whole history — running courses start ticked and
                    completed ones do not. */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', marginTop: 8 }}>
                  {localEnrollments.map(function (en) {
                    const c = en.skus?.courses?.group_name
                    const l = en.skus?.level_name
                    const label = c ? (l ? c + ' — ' + l : c) : (l || 'Course')
                    return (
                      <label key={en.id} style={{ display: 'flex', alignItems: 'center', gap: 5,
                        font: '500 11px var(--font)', color: 'var(--text2)', cursor: 'pointer' }}>
                        <input type="checkbox" checked={enrolWaChecked(en)}
                          onChange={function (e) {
                            const v = e.target.checked
                            setEnrolWaSel(function (prev) { return { ...prev, [en.id]: v } })
                          }} />
                        {label}
                        {en.completed_at && (
                          <span style={{ font: '500 10px var(--mono)', color: 'var(--text3)' }}>· completed</span>
                        )}
                      </label>
                    )
                  })}
                </div>
              </div>
            )}
            {/* Course prices are catalogue rates; say plainly why they add up to
                more than the parent was asked for, or the figures look wrong. */}
            {(function () {
              // Two kinds of discount can be in play: recorded per course (list
              // price vs charged) and a package discount that predates this and
              // was never attributed to any one course. Show both, separately.
              const perCourse = localEnrollments.reduce(function (s, e) {
                return s + Math.max(0, (Number(e.list_price) || 0) - (Number(e.fee_amount) || 0))
              }, 0)
              const pkg = coverage.discount || 0
              const charged = localEnrollments.reduce(function (s, e) { return s + (Number(e.fee_amount) || 0) }, 0)
              // Anything above the course prices is now carried as an explicit
              // Other charges line below, so nothing needs explaining here.
              if (perCourse === 0 && pkg === 0) return null
              return (
                <div style={{ marginBottom: 12, padding: '8px 12px', borderRadius: 10,
                  background: 'var(--purple-bg)', border: '1px solid var(--purple)',
                  font: '500 11px var(--font)', color: 'var(--purple)' }}>
                  {perCourse > 0 && (
                    <div>Course discounts total <b>₹{fmtAmt(perCourse)}</b> against list price.</div>
                  )}
                  {pkg > 0 && (
                    <div>
                      Courses charge ₹{fmtAmt(charged)} — a further package discount of <b>₹{fmtAmt(pkg)}</b> brings
                      the agreed fee to <b>₹{fmtAmt(Number(form.fee_total) || 0)}</b>, credited to the earliest courses first.
                    </div>
                  )}
                </div>
              )
            })()}
            {localEnrollments.length === 0 && !showAddEnrollment ? (
              <p className="hint" style={{ textAlign: 'center', padding: 24 }}>No courses enrolled yet.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {localEnrollments.slice().sort(function (a, b) {
                  // Completed courses sink to the bottom; within each group, latest on top.
                  const ac = a.completed_at ? 1 : 0
                  const bc = b.completed_at ? 1 : 0
                  if (ac !== bc) return ac - bc
                  const ad = a.enrolled_at || a.completed_at || ''
                  const bd = b.enrolled_at || b.completed_at || ''
                  if (ad !== bd) return ad < bd ? 1 : -1   // newer first
                  return 0
                }).map(function (en) {
                  const bs          = batchAssignments[en.id]
                  const isOpen      = batchPanelEnrId === en.id
                  const courseName  = en.skus?.courses?.group_name || '—'
                  const levelName   = en.skus?.level_name || '—'

                  const isCompleted     = !!en.completed_at
                  const isDiscontinued  = en.status === 'dropped'
                  const attended     = sessionCounts[en.id] || 0
                  const totalSess    = skuTotals[en.sku_id] || 0
                  const billingType  = skuBilling[en.sku_id] || null
                  // Session-based course finished its sessions but not marked complete → follow up
                  // (Monthly courses never "finish" at a session count — they renew.)
                  const sessionsDone = !isCompleted && billingType !== 'monthly' && totalSess > 0 && attended >= totalSess
                  // Monthly course — cycle progress is real held classes for this
                  // enrollment's own batch since ITS cycle_started_at (a
                  // per-student date, not the calendar month), against the
                  // sessions/week target agreed at enrollment. Replaces the old
                  // "days left in the calendar month" check, which was the same
                  // for every student regardless of when they actually started.
                  //
                  // The renew prompt itself is date-driven, not session-count-
                  // driven — "the month has to be counted date to date": a
                  // student who happened to get more classes in than the target
                  // isn't force-renewed early (those extra ones are just
                  // complimentary), and a student who got fewer (holidays, a
                  // schedule gap) still gets prompted once the month's actually
                  // up rather than waiting forever for a count that may never
                  // arrive — the shortfall carries into the next cycle instead.
                  // A cycle runs to the same date next month; its target is the
                  // student's class days in that window (Saturday revision only
                  // makes up absences); enrolments with no stored cycle
                  // start use their enrolment date. Same maths the Students
                  // list uses (utils/studentLifecycle.js) so the two agree.
                  const isMonthlyRunning = billingType === 'monthly' && !isCompleted && !isDiscontinued
                  const cycle        = isMonthlyRunning ? (cycleProgress[en.id] || computeCycle(en, [], null, '')) : null
                  const cycleHeld    = cycle ? cycle.done : 0
                  const cycleTarget  = cycle ? cycle.target : 0
                  const renewal      = isMonthlyRunning ? renewalInfo(en) : null
                  const monthEnding  = !!renewal && renewal.state !== 'ok'
                  const kitItems     = kitDefs[en.sku_id] || []
                  const kitGivenForEnr = kitGiven[en.id] || {}
                  const kitPanelOpen = kitPanelEnrId === en.id

                  return (
                    <div key={en.id} style={{
                      border: '1px solid ' + (isCompleted ? 'var(--green)' : 'var(--border)'),
                      borderRadius: 10, overflow: 'hidden',
                      background: isCompleted ? 'var(--green-bg)' : 'var(--card)',
                    }}>
                      {/* Enrollment header row */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', flexWrap: 'wrap' }}>
                        <div style={{ flex: '1 1 320px', minWidth: 0 }}>
                          <div style={{ font: '600 13px var(--font)', color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            {courseName}
                            <span style={{ font: '500 11px var(--mono)', color: 'var(--text3)' }}>
                              {levelName}
                            </span>
                            {isCompleted && (
                              <span style={{ font: '600 10px var(--font)', color: 'var(--green)', background: 'var(--green-bg)', border: '1px solid var(--green)', borderRadius: 20, padding: '1px 7px', whiteSpace: 'nowrap' }}>
                                ✓ Completed{en.completed_at ? ' · ' + fmtDate(String(en.completed_at).slice(0, 10)) : ''}
                              </span>
                            )}
                            {isDiscontinued && !isCompleted && (
                              <span style={{ font: '600 10px var(--font)', color: '#991b1b', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 20, padding: '1px 7px', whiteSpace: 'nowrap' }}>
                                ⊘ Discontinued
                              </span>
                            )}
                            {/* Monthly courses have no fixed session total — their one
                                counter is the cycle chip below, so this "x / total"
                                chip (which used the course's old fixed number and
                                contradicted it) is for fixed-session courses only. */}
                            {!isMonthlyRunning && (
                              <span style={{ font: '600 10px var(--mono)', color: sessionsDone ? '#B45309' : 'var(--purple)', background: sessionsDone ? '#FEF3C7' : 'var(--purple-bg)', borderRadius: 20, padding: '1px 8px', whiteSpace: 'nowrap' }}>
                                {attended}{totalSess > 0 ? ' / ' + totalSess : ''} sessions
                              </span>
                            )}
                            {kitItems.length > 0 && (
                              <button
                                onClick={function () { setKitPanelEnrId(kitPanelOpen ? null : en.id) }}
                                title={kitIssued[en.id] ? 'Confirm exactly which kit items were handed over' : 'No kit items confirmed as given yet — click to check them off'}
                                style={{
                                  font: '600 10px var(--font)', borderRadius: 20, padding: '1px 8px', whiteSpace: 'nowrap', cursor: 'pointer',
                                  color: kitIssued[en.id] ? '#0E7490' : 'var(--text3)',
                                  background: kitIssued[en.id] ? '#CFFAFE' : 'var(--bg2)',
                                  border: '1px solid ' + (kitIssued[en.id] ? '#67E8F9' : 'var(--border)'),
                                }}>
                                🧰 {kitIssued[en.id] ? Object.keys(kitGivenForEnr).length + '/' + kitItems.length + ' kit given' : 'Confirm kit'}
                              </button>
                            )}
                            {en.cert_issued_at && (
                              <span title={'Marked issued' + (en.cert_issued_by ? ' by ' + en.cert_issued_by : '') + ' — handed over outside the app'}
                                style={{ font: '600 10px var(--font)', color: '#6B7280', background: '#F3F4F6', border: '1px solid #D1D5DB', borderRadius: 20, padding: '1px 8px', whiteSpace: 'nowrap' }}>
                                🎓 Cert issued {fmtDate(String(en.cert_issued_at).slice(0, 10))}
                              </span>
                            )}
                            {(en.cert_wa_sent_at || certWaStatus[en.id]) && (function () {
                              const st = certWaStatus[en.id] || 'sent'
                              const map = {
                                read:      { t: '🎓 Cert read',      c: '#1D4ED8', bg: '#DBEAFE', bd: '#93C5FD', tick: '✓✓' },
                                delivered: { t: '🎓 Cert delivered', c: '#0E7490', bg: '#CFFAFE', bd: '#67E8F9', tick: '✓✓' },
                                failed:    { t: '🎓 Cert failed',    c: '#B91C1C', bg: '#FEE2E2', bd: '#FCA5A5', tick: '✕' },
                              }
                              const m = map[st] || { t: '🎓 Cert sent', c: '#6B7280', bg: '#F3F4F6', bd: '#D1D5DB', tick: '✓' }
                              return (
                                <span title={'Certificate WhatsApp: ' + st} style={{ font: '600 10px var(--font)', color: m.c, background: m.bg, border: '1px solid ' + m.bd, borderRadius: 20, padding: '1px 8px', whiteSpace: 'nowrap' }}>
                                  {m.tick} {m.t.replace('🎓 ', '🎓 ')}
                                </span>
                              )
                            })()}
                            {sessionsDone && (
                              <span title="All sessions attended but course not marked complete — follow up"
                                style={{ font: '600 10px var(--font)', color: '#B45309', background: '#FEF3C7', border: '1px solid #FCD34D', borderRadius: 20, padding: '1px 8px', whiteSpace: 'nowrap' }}>
                                ⚠ Sessions done — review
                              </span>
                            )}
                            {renewal && cycle && (
                              <>
                                {/* Progress + the cycle's own dates, so the target isn't a
                                    mystery number: it's the student's class days inside this range. */}
                                <span title={'Cycle ' + fmtDate(cycle.start) + ' to ' + fmtDate(cycle.end) + ': ' + cycleTarget + ' classes (' + cycle.days.join(', ') + ') after declared holidays.' + (cycle.satRevision ? ' Saturday revision classes are included in the fee and only count to make up classes the student was marked absent for.' : '')}
                                  style={{ font: '600 10px var(--mono)', color: monthEnding ? '#B45309' : 'var(--text3)', background: monthEnding ? '#FEF3C7' : 'var(--bg2)', borderRadius: 20, padding: '1px 8px', whiteSpace: 'nowrap' }}>
                                  {cycleHeld} / {cycleTarget} this cycle · {shortDay(cycle.start)}–{shortDay(cycle.end)}
                                </span>
                                {/* S sessions held this cycle, P present, A absent, N not
                                    marked (S = P + A + N). Includes Saturday revision. */}
                                <span title={'This cycle so far — S: ' + cycle.spa.S + ' classes held, P: ' + cycle.spa.P + ' present, A: ' + cycle.spa.A + ' absent, N: ' + cycle.spa.N + ' not marked (attendance never recorded — mark it so it is counted).'
                                  + (cycle.makeUp > 0 ? ' ' + cycle.makeUp + ' absence' + (cycle.makeUp > 1 ? 's' : '') + ' made up at Saturday revision.' : '')}
                                  style={{ font: '600 10px var(--mono)', color: cycle.spa.N > 0 ? '#B45309' : 'var(--text2)', background: cycle.spa.N > 0 ? '#FEF3C7' : 'var(--bg2)', borderRadius: 20, padding: '1px 8px', whiteSpace: 'nowrap' }}>
                                  S {cycle.spa.S} · P {cycle.spa.P} · A {cycle.spa.A} · N {cycle.spa.N}
                                </span>
                                <span style={{ font: '600 10px var(--font)', color: renewal.state === 'overdue' ? '#991b1b' : renewal.state === 'soon' ? '#B45309' : 'var(--text3)', background: renewal.state === 'overdue' ? '#fef2f2' : renewal.state === 'soon' ? '#FEF3C7' : 'var(--bg2)', borderRadius: 20, padding: '1px 8px', whiteSpace: 'nowrap' }}>
                                  {renewal.state === 'overdue' ? 'Renewal overdue since ' : 'Renews '}{fmtDate(renewal.due)}
                                </span>
                              </>
                            )}
                          </div>
                          {bs ? (
                            <div style={{ font: '500 12px var(--font)', color: 'var(--text2)', marginTop: 3 }}>
                              <span style={{ color: 'var(--green)' }}>●</span>
                              {' '}{bs.batches?.name || 'Batch'}
                              {bs.batches?.instructors?.full_name ? (
                                <span style={{ color: 'var(--text3)' }}> · {bs.batches.instructors.full_name}</span>
                              ) : null}
                              {bs.batches?.schedule_days ? (
                                <span style={{ color: 'var(--text3)' }}> · {bs.batches.schedule_days}</span>
                              ) : null}
                              {bs.batches?.schedule_time ? (
                                <span style={{ color: 'var(--text3)' }}> {bs.batches.schedule_time}</span>
                              ) : null}
                            </div>
                          ) : (
                            <div style={{ font: '500 12px var(--font)', color: 'var(--text3)', marginTop: 3 }}>
                              Not assigned to a batch
                            </div>
                          )}

                          {en.enrolled_at && (
                            <div style={{ font: '500 11px var(--mono)', color: 'var(--text3)', marginTop: 3 }}>
                              Enrolled {fmtDate(String(en.enrolled_at).slice(0, 10))}
                            </div>
                          )}

                          {/* Kit confirmation — new enrollments auto-deduct the
                              full kit with no confirmation, so this is where an
                              admin actually confirms (or corrects) what was
                              handed over, item by item. */}
                          {kitPanelOpen && kitItems.length > 0 && (
                            <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 8, background: 'var(--bg)', border: '1px solid var(--border)' }}>
                              <div style={{ font: '600 9.5px var(--mono)', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 6 }}>
                                Kit items given <span style={{ textTransform: 'none', fontWeight: 400 }}>— confirm what was actually handed over</span>
                              </div>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                {kitItems.map(function (k) {
                                  const given = !!kitGivenForEnr[k.item_id]
                                  return (
                                    <label key={k.item_id} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 9px', borderRadius: 20, cursor: kitSaving ? 'default' : 'pointer', font: '500 11px var(--font)', border: '1px solid ' + (given ? 'var(--purple)' : 'var(--border)'), background: given ? 'var(--purple-bg)' : 'var(--bg)', color: given ? 'var(--purple)' : 'var(--text3)', textDecoration: given ? 'none' : 'line-through' }}>
                                      <input type="checkbox" checked={given} disabled={kitSaving}
                                        onChange={function () { toggleKitGiven(en, k) }} style={{ accentColor: 'var(--purple)' }} />
                                      {k.name}{k.quantity > 1 ? ' ×' + k.quantity : ''}
                                    </label>
                                  )
                                })}
                              </div>
                            </div>
                          )}

                          {/* Fee for THIS course, and how far the money received
                              reaches. Payments are held against the student, not
                              a course, so coverage is applied oldest course first
                              — an indication of what is settled, not an
                              allocation of specific receipts. */}
                          {(function () {
                            const cov = feeCoverage[en.id]
                            if (!cov) return null
                            const editing = feeEditId === en.id
                            return (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                                <span style={{ font: '600 11px var(--mono)', color: 'var(--text3)' }}>FEE</span>
                                {editing ? (
                                  <>
                                    <input type="number" value={feeEditVal} autoFocus
                                      onChange={function (e) { setFeeEditVal(e.target.value) }}
                                      style={{ width: 90, fontSize: 12, padding: '2px 6px' }} />
                                    {/* Charge less than list and the difference is the
                                        discount — shown as it is typed, so the person
                                        giving it sees exactly what they are giving. */}
                                    {cov.list > 0 && (function () {
                                      const typed = parseInt(feeEditVal, 10)
                                      const off   = isNaN(typed) ? 0 : cov.list - typed
                                      return (
                                        <span style={{ font: '500 11px var(--mono)', color: off > 0 ? 'var(--purple)' : 'var(--text3)' }}>
                                          list ₹{fmtAmt(cov.list)}
                                          {off > 0 ? ' · discount ₹' + fmtAmt(off) : off < 0 ? ' · ₹' + fmtAmt(-off) + ' above list' : ''}
                                        </span>
                                      )
                                    })()}
                                    <button className="btn-s" style={{ fontSize: 10, padding: '2px 8px' }}
                                      onClick={function () { saveCourseFee(en) }}>Save</button>
                                    <button className="btn-s" style={{ fontSize: 10, padding: '2px 8px' }}
                                      onClick={function () { setFeeEditId(null) }}>Cancel</button>
                                  </>
                                ) : (
                                  <>
                                    <span style={{ font: '700 12px var(--mono)', color: 'var(--text)' }}>
                                      ₹{fmtAmt(cov.fee)}
                                    </span>
                                    {cov.off > 0 && (
                                      <span title={'List price ₹' + fmtAmt(cov.list) + ' · discount ₹' + fmtAmt(cov.off)}
                                        style={{ font: '600 10px var(--font)', color: 'var(--purple)', background: 'var(--purple-bg)', border: '1px solid var(--purple)', borderRadius: 20, padding: '1px 8px', whiteSpace: 'nowrap' }}>
                                        <s style={{ opacity: .7 }}>₹{fmtAmt(cov.list)}</s> · ₹{fmtAmt(cov.off)} off
                                      </span>
                                    )}
                                    {cov.dropped ? (
                                      <span style={{ font: '600 11px var(--font)', color: '#991b1b', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 20, padding: '1px 8px' }}>
                                        {cov.waived > 0 ? '₹' + fmtAmt(cov.waived) + ' waived' : 'Settled'}
                                      </span>
                                    ) : cov.due > 0 ? (
                                      <span style={{ font: '600 11px var(--font)', color: '#92400e', background: '#fffbeb', border: '1px solid #fbbf24', borderRadius: 20, padding: '1px 8px' }}>
                                        ₹{fmtAmt(cov.due)} due
                                      </span>
                                    ) : (
                                      <span style={{ font: '600 11px var(--font)', color: 'var(--green)', background: 'var(--green-bg)', border: '1px solid var(--green)', borderRadius: 20, padding: '1px 8px' }}>
                                        ✓ Paid
                                      </span>
                                    )}
                                    {cov.paid > 0 && cov.due > 0 && (
                                      <span style={{ font: '500 11px var(--mono)', color: 'var(--text3)' }}>
                                        ₹{fmtAmt(cov.paid)} received
                                      </span>
                                    )}
                                    {canManageFees && (
                                      <button className="btn-s" style={{ fontSize: 10, padding: '1px 7px' }}
                                        title="Change this course's fee"
                                        onClick={function () { setFeeEditId(en.id); setFeeEditVal(String(cov.fee)) }}>
                                        ✎
                                      </button>
                                    )}
                                  </>
                                )}
                              </div>
                            )
                          })()}
                        </div>

                        {/* Every per-course action lives under one Actions menu (the same
                            component Orders uses) instead of a row of buttons that ran off
                            the card. Status that isn't an action (pending HO review, a
                            rejection note) shows as a line at the top of the menu. */}
                        <div style={{ marginLeft: 'auto', flexShrink: 0 }}>
                          <ActionsMenu
                            info={[
                              !isDiscontinued && isSchool && en.cert_status === 'pending_review' && !(admin && can('students.complete')) && { key: 'pendreview', text: '⏳ Pending HO review', color: '#92400e' },
                              !isDiscontinued && isSchool && en.cert_status === 'rejected' && { key: 'rejected', text: '✖ Rejected' + (en.cert_reject_note ? ': ' + en.cert_reject_note : ''), color: '#991b1b' },
                            ]}
                            items={[
                              canEdit && can('students.complete') && !isCompleted && !isDiscontinued && {
                                key: 'complete', label: '✓ Complete',
                                onClick: function () {
                                  setCompleteDate(lastAttendedDate[en.id] || new Date().toISOString().slice(0, 10))
                                  setMarksObtained(en.marks_obtained != null ? String(en.marks_obtained) : '')
                                  setMarksTotal(en.marks_total != null ? String(en.marks_total) : '')
                                  setMarksRemarks(en.marks_remarks || '')
                                  setCompletingEnr(en)
                                },
                              },
                              // School-tier: the certificate is gated behind HO review of the
                              // submitted marks. Every other tier self-certifies via the
                              // Certificate item below.
                              !isDiscontinued && isSchool && en.cert_status === 'pending_review' && admin && can('students.complete') && {
                                key: 'reviewmarks', label: '⏳ Review marks', cls: 'primary',
                                title: 'Review submitted marks and certify or reject',
                                onClick: function () { setCertifyingEn(en); setCertifyRejectNote('') },
                              },
                              !isDiscontinued && isSchool && en.cert_status === 'rejected' && canEdit && {
                                key: 'resubmit', label: '✎ Resubmit marks',
                                onClick: function () {
                                  setCompleteDate(en.completed_at ? en.completed_at.slice(0, 10) : new Date().toISOString().slice(0, 10))
                                  setMarksObtained(en.marks_obtained != null ? String(en.marks_obtained) : '')
                                  setMarksTotal(en.marks_total != null ? String(en.marks_total) : '')
                                  setMarksRemarks(en.marks_remarks || '')
                                  setCompletingEnr(en)
                                },
                              },
                              !isDiscontinued && (!isSchool || en.cert_status === 'certified') && {
                                key: 'cert', label: en.cert_emailed_at ? '🎓 Re-issue certificate' : '🎓 Certificate',
                                onClick: async function () {
                                  let centre = centreCache
                                  if (!centre && student.franchisee_id) {
                                    const { data } = await sb.from('franchisees')
                                      .select('id,business_name,city,area,country,tier')
                                      .eq('id', student.franchisee_id).single()
                                    centre = data || null
                                    setCentreCache(centre)
                                  }
                                  setCertModal({ enrollments: localEnrollments, centre })
                                },
                              },
                              canEdit && certPending(en) && {
                                key: 'certissued', label: '✓ Mark certificate issued',
                                title: 'Certificate was already handed over outside the app — mark it issued so it stops showing as pending',
                                onClick: function () { markCertIssued(en) },
                              },
                              isCompleted && {
                                key: 'review', label: '💬 Send Google review request',
                                title: 'Send Google Review request on WhatsApp',
                                onClick: function () { openReview(en) },
                              },
                              // Assign batch — HO-only for now: batch/instructor scheduling
                              // isn't something franchisees manage yet.
                              admin && {
                                key: 'batch', label: isOpen ? 'Close batch panel' : bs ? '✏️ Change batch' : '+ Assign batch',
                                onClick: function () { openBatchPanel(en) },
                              },
                              admin && bs && !isOpen && {
                                key: 'rmbatch', label: '✕ Remove from batch', cls: 'danger',
                                onClick: function () { removeFromBatch(en.id) },
                              },
                              canEdit && {
                                key: 'level', label: '⇄ Change course / level',
                                onClick: function () { openChangeLevel(en) },
                              },
                              // Discontinue one course (student stays active); Restore undoes it.
                              canEdit && !isCompleted && !isDiscontinued && {
                                key: 'discontinue', label: courseBusy === en.id ? '…' : '⊘ Discontinue course',
                                disabled: courseBusy === en.id,
                                title: 'Mark this course discontinued and waive its unpaid fee',
                                onClick: function () { discontinueCourse(en) },
                              },
                              canEdit && isDiscontinued && {
                                key: 'restore', label: courseBusy === en.id ? '…' : '↩ Restore course',
                                disabled: courseBusy === en.id,
                                title: 'Undo — the course becomes active and its fee due again',
                                onClick: function () { restoreCourse(en) },
                              },
                              admin && {
                                key: 'remove', label: '🗑 Remove course', cls: 'danger',
                                title: 'Remove course enrollment',
                                onClick: function () {
                                  if (window.confirm('Remove ' + courseName + ' ' + levelName + ' enrollment for ' + student.full_name + '?')) {
                                    removeEnrollment(en)
                                  }
                                },
                              },
                            ]}
                          />
                        </div>
                      </div>

                      {/* Batch assignment panel */}
                      {isOpen && (
                        <div style={{ borderTop: '1px solid var(--border)', background: 'var(--bg)', padding: 16 }}>
                          {panelData.loading ? (
                            <div className="hint">Loading batches…</div>
                          ) : (
                            <>
                              {/* Existing batches — pick one, or switch away from the current one */}
                              {panelData.batches.length > 0 && (
                                <div style={{ marginBottom: 16 }}>
                                  <div style={{ font: '600 11px var(--mono)', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
                                    Existing Batches
                                  </div>
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                    {panelData.batches.map(function (b) {
                                      const isCurrent = bs && bs.batch_id === b.id
                                      return (
                                        <div key={b.id} style={{
                                          display: 'flex', alignItems: 'center', gap: 10,
                                          padding: '8px 12px', borderRadius: 8,
                                          border: isCurrent ? '1.5px solid var(--purple)' : '1px solid var(--border)',
                                          background: isCurrent ? 'var(--purple-bg)' : 'var(--card)',
                                        }}>
                                          <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ font: '600 12px var(--font)', color: 'var(--text)' }}>
                                              {b.name}
                                              {isCurrent && <span style={{ color: 'var(--purple)', marginLeft: 6, fontSize: 11 }}>● current</span>}
                                            </div>
                                            <div style={{ font: '500 11px var(--font)', color: 'var(--text3)', marginTop: 2 }}>
                                              {b.instructors?.full_name || 'No instructor'}
                                              {b.schedule_days ? ' · ' + b.schedule_days : ''}
                                              {b.schedule_time ? ' ' + b.schedule_time : ''}
                                              {b.is_individual ? ' · Individual' : ' · Group'}
                                              {isCurrent && bs?.assigned_at ? ' · in this batch since ' + fmtDate(String(bs.assigned_at).slice(0, 10)) : ''}
                                            </div>
                                          </div>
                                          {!isCurrent && (
                                            <button
                                              className="btn-s"
                                              style={{ fontSize: 11, padding: '3px 12px', flexShrink: 0 }}
                                              disabled={panelSaving}
                                              onClick={function () { assignToBatch(b.id, en.id) }}
                                            >
                                              {bs ? 'Switch here' : 'Assign'}
                                            </button>
                                          )}
                                        </div>
                                      )
                                    })}
                                  </div>
                                </div>
                              )}

                              {/* Create a new batch right here — a course with no
                                  matching batch yet never dead-ends this panel
                                  into "go create one on the instructor's page". */}
                              {!newBatchOpen ? (
                                <button className="btn-s" style={{ fontSize: 11 }}
                                  onClick={function () { setNewBatchOpen(true) }}>
                                  + Create new batch
                                </button>
                              ) : (
                                <div style={{ border: '1px dashed var(--purple)', borderRadius: 8, padding: 12 }}>
                                  <div style={{ font: '600 11px var(--font)', color: 'var(--purple)', marginBottom: 8 }}>New batch for this level</div>
                                  {eligibleCIs.length === 0 ? (
                                    <p className="hint" style={{ color: 'var(--red)' }}>No instructor is appointed for this course level yet — appoint one on the Instructors page first.</p>
                                  ) : (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                      <select value={newBatchForm.instructor_id}
                                        onChange={function (e) { setNewBatchForm(function (f) { return { ...f, instructor_id: e.target.value } }) }}
                                        style={{ fontSize: 12 }}>
                                        <option value="">— Select instructor —</option>
                                        {eligibleCIs.map(function (ci) { return <option key={ci.id} value={ci.id}>{ci.full_name}</option> })}
                                      </select>
                                      <input value={newBatchForm.name} placeholder="Batch name — e.g. Morning Batch A"
                                        onChange={function (e) { setNewBatchForm(function (f) { return { ...f, name: e.target.value } }) }}
                                        style={{ fontSize: 12 }} />
                                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                        {DAYS.map(function (d) {
                                          const on = newBatchForm.days.includes(d)
                                          return (
                                            <button key={d} type="button"
                                              onClick={function () {
                                                setNewBatchForm(function (f) {
                                                  return { ...f, days: on ? f.days.filter(function (x) { return x !== d }) : [...f.days, d] }
                                                })
                                              }}
                                              style={{
                                                padding: '3px 9px', borderRadius: 6, fontSize: 11, cursor: 'pointer',
                                                border: on ? '1.5px solid var(--purple)' : '1px solid var(--border)',
                                                background: on ? 'var(--purple-bg)' : 'var(--bg2)',
                                                color: on ? 'var(--purple)' : 'var(--text2)',
                                              }}>{d}</button>
                                          )
                                        })}
                                      </div>
                                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                        <input type="time" value={newBatchForm.time}
                                          onChange={function (e) { setNewBatchForm(function (f) { return { ...f, time: e.target.value } }) }}
                                          style={{ fontSize: 12 }} />
                                        <label style={{ display: 'flex', alignItems: 'center', gap: 5, font: '500 11px var(--font)' }}>
                                          <input type="checkbox" checked={newBatchForm.is_individual}
                                            onChange={function (e) { setNewBatchForm(function (f) { return { ...f, is_individual: e.target.checked } }) }} />
                                          Individual (1-on-1)
                                        </label>
                                      </div>
                                      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                                        <button className="btn-s" style={{ fontSize: 11 }} disabled={panelSaving}
                                          onClick={function () { setNewBatchOpen(false) }}>Cancel</button>
                                        <button className="btn-p" style={{ fontSize: 11 }} disabled={panelSaving}
                                          onClick={function () { createBatchAndAssign(en) }}>
                                          {panelSaving ? 'Creating…' : 'Create & assign'}
                                        </button>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}

                {/* ── Other charges — belong to the account, not a course ── */}
                {(coverage.other?.fee > 0 || otherEdit) && (
                  <div style={{ border: '1px dashed var(--border)', borderRadius: 10, padding: '10px 16px',
                    display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', background: 'var(--bg2)' }}>
                    <span style={{ font: '600 13px var(--font)', color: 'var(--text2)', flex: 1 }}>
                      Other charges
                      <span style={{ font: '500 11px var(--mono)', color: 'var(--text3)', marginLeft: 6 }}>
                        registration / admission — not tied to a course
                      </span>
                    </span>
                    {otherEdit ? (
                      <>
                        <input type="number" value={otherVal} autoFocus
                          onChange={function (e) { setOtherVal(e.target.value) }}
                          style={{ width: 100, fontSize: 12, padding: '2px 6px' }} />
                        <button className="btn-s" style={{ fontSize: 10, padding: '2px 8px' }}
                          onClick={saveOtherCharges}>Save</button>
                        <button className="btn-s" style={{ fontSize: 10, padding: '2px 8px' }}
                          onClick={function () { setOtherEdit(false) }}>Cancel</button>
                      </>
                    ) : (
                      <>
                        <span style={{ font: '700 12px var(--mono)', color: 'var(--text)' }}>
                          ₹{fmtAmt(coverage.other.fee)}
                        </span>
                        {coverage.other.due > 0 ? (
                          <span style={{ font: '600 11px var(--font)', color: '#92400e', background: '#fffbeb', border: '1px solid #fbbf24', borderRadius: 20, padding: '1px 8px' }}>
                            ₹{fmtAmt(coverage.other.due)} due
                          </span>
                        ) : (
                          <span style={{ font: '600 11px var(--font)', color: 'var(--green)', background: 'var(--green-bg)', border: '1px solid var(--green)', borderRadius: 20, padding: '1px 8px' }}>
                            ✓ Paid
                          </span>
                        )}
                        {canManageFees && (
                          <button className="btn-s" style={{ fontSize: 10, padding: '1px 7px' }}
                            onClick={function () { setOtherEdit(true); setOtherVal(String(coverage.other.fee)) }}>✎</button>
                        )}
                      </>
                    )}
                  </div>
                )}
                {canManageFees && !(coverage.other?.fee > 0) && !otherEdit && (
                  <button className="btn-s" style={{ fontSize: 11, alignSelf: 'flex-start', padding: '3px 10px' }}
                    onClick={function () { setOtherEdit(true); setOtherVal('') }}>
                    + Add other charges
                  </button>
                )}

                {/* ── Add Course panel ── */}
                {canEdit && (
                  <div style={{ marginTop: 4 }}>
                    {!showAddEnrollment ? (
                      <button
                        className="btn-s"
                        style={{ fontSize: 12, width: '100%' }}
                        onClick={function () { setShowAddEnrollment(true) }}
                        disabled={availableSkus.length === 0}
                      >
                        {availableSkus.length === 0 ? 'All available courses enrolled' : '+ Add Course'}
                      </button>
                    ) : (
                      <div style={{ border: '1.5px dashed var(--purple)', borderRadius: 10, padding: 16, background: 'var(--bg)' }}>
                        <div style={{ font: '600 12px var(--font)', color: 'var(--purple)', marginBottom: 12 }}>
                          Add Course Enrollment
                        </div>
                        {(function () {
                          const enrolledSkuIds = localEnrollments.map(function (e) { return e.sku_id })
                          // Group ALL centre SKUs by course (so enrolled levels are visible too)
                          const groupMap = {}
                          allCentreSkus.forEach(function (s) {
                            const g = s.courses?.group_name || 'Other'
                            if (!groupMap[g]) groupMap[g] = []
                            groupMap[g].push(s)
                          })
                          const groups = Object.entries(groupMap)
                          if (groups.length === 0) {
                            return <p className="hint" style={{ color: 'var(--red)' }}>No additional courses available for this centre.</p>
                          }
                          return (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                              {groups.map(function ([groupName, skus]) {
                                // Enrolled SKUs in this group
                                const enrolledInGroup = skus.filter(function (s) { return enrolledSkuIds.includes(s.id) })
                                // Available (unenrolled) SKUs in this group, in curriculum order
                                const availableInGroup = skus.filter(function (s) { return !enrolledSkuIds.includes(s.id) })
                                // The first available SKU is the "next level" recommendation
                                const nextLevelId = availableInGroup.length > 0 ? availableInGroup[0].id : null
                                if (enrolledInGroup.length === 0 && availableInGroup.length === 0) return null
                                return (
                                  <div key={groupName}>
                                    <div style={{ font: '600 11px var(--mono)', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>
                                      {groupName}
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                      {/* Already enrolled levels — greyed out */}
                                      {enrolledInGroup.map(function (sku) {
                                        return (
                                          <div key={sku.id} style={{
                                            display: 'flex', alignItems: 'center', gap: 8,
                                            padding: '5px 10px', borderRadius: 6,
                                            background: 'var(--bg2)', border: '1px solid var(--border)',
                                            opacity: 0.7,
                                          }}>
                                            <span style={{ color: 'var(--green)', fontWeight: 700, fontSize: 13 }}>✓</span>
                                            <span style={{ font: '500 12px var(--font)', color: 'var(--text2)', flex: 1 }}>{sku.level_name}</span>
                                            <span style={{ font: '500 10px var(--mono)', color: 'var(--text3)', background: '#dcfce7', border: '1px solid #bbf7d0', borderRadius: 4, padding: '1px 6px' }}>Enrolled</span>
                                          </div>
                                        )
                                      })}
                                      {/* Available levels — selectable, first one highlighted as Next Level */}
                                      {availableInGroup.map(function (sku) {
                                        const checked = selectedNewSkus.some(function (s) { return s.id === sku.id })
                                        const isNext = sku.id === nextLevelId && enrolledInGroup.length > 0
                                        return (
                                          <label key={sku.id} style={{
                                            display: 'flex', alignItems: 'center', gap: 8,
                                            padding: '5px 10px', borderRadius: 6, cursor: 'pointer',
                                            background: isNext ? 'var(--purple-bg)' : (checked ? 'var(--purple-bg)' : 'var(--card)'),
                                            border: isNext ? '1.5px solid var(--purple)' : (checked ? '1.5px solid var(--purple)' : '1px solid var(--border)'),
                                          }}>
                                            <input
                                              type="checkbox"
                                              checked={checked}
                                              onChange={function () {
                                                setAddCoupon(null)  // fee changed — re-apply against new total
                                                if (!checked) { loadAddBatchData(sku.id); loadAddKit(sku) }
                                                setSelectedNewSkus(function (prev) {
                                                  return checked
                                                    ? prev.filter(function (s) { return s.id !== sku.id })
                                                    : [...prev, sku]
                                                })
                                              }}
                                              style={{ accentColor: 'var(--purple)' }}
                                            />
                                            <span style={{ font: '500 12px var(--font)', color: 'var(--text)', flex: 1 }}>{sku.level_name}</span>
                                            {isNext && <span style={{ font: '700 10px var(--mono)', color: 'var(--purple)', background: 'var(--purple-bg)', border: '1px solid var(--purple)', borderRadius: 4, padding: '1px 6px', whiteSpace: 'nowrap' }}>→ Next Level</span>}
                                            {sku.student_fee ? <span style={{ font: '500 10px var(--mono)', color: 'var(--text3)' }}>₹{fmtAmt(sku.student_fee)}</span> : null}
                                          </label>
                                        )
                                      })}
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          )
                        })()}

                        {selectedNewSkus.length > 0 && (function () {
                          const addedFee = selectedNewSkus.reduce(function (s, sk) { return s + feeFor(sk) }, 0)
                          const discount = addCoupon ? Math.min(addCoupon.discount, addedFee) : 0
                          const netAdded = Math.max(0, addedFee - discount)
                          const newTotal = (Number(form.fee_total) || 0) + netAdded
                          return (
                            <>
                              {/* Invoice lines: each selected course — editable fee + kit-item selection */}
                              <div style={{ borderTop: '1px solid var(--border)', marginTop: 12, paddingTop: 12 }}>
                                <div style={{ font: '600 12px var(--font)', color: 'var(--text)', marginBottom: 8 }}>🧾 Invoice — courses, fees &amp; kit</div>
                                {selectedNewSkus.map(function (sku) {
                                  const kits = addKitData[sku.id]
                                  const ex = addKitExcluded[sku.id] || {}
                                  // Batch assignment lives right under its own course now
                                  // (was a separate repeated section further down the form).
                                  const bd  = addBatchData[sku.id] || { batches: [], eligibleCIs: [], loading: true }
                                  const sel = addBatchSel[sku.id] || ''
                                  const nbf = addNewBatch[sku.id] || { ci: '', name: '', days: [], time: '', is_individual: false }
                                  function updateNbf(patch) { setAddNewBatch(function (prev) { return { ...prev, [sku.id]: { ...nbf, ...patch } } }) }
                                  return (
                                    <div key={sku.id} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', marginBottom: 8 }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                        <span style={{ font: '600 12px var(--font)', color: 'var(--text)', flex: 1, minWidth: 120 }}>
                                          {sku.courses?.group_name || '—'} <span style={{ font: '500 10px var(--mono)', color: 'var(--text3)' }}>{sku.level_name}</span>
                                        </span>
                                        <span style={{ font: '500 11px var(--font)', color: 'var(--text3)' }}>Fee ₹</span>
                                        <input type="number" min={0} value={addFeeOverride[sku.id] != null ? addFeeOverride[sku.id] : (sku.student_fee || 0)}
                                          onChange={function (e) { setAddCoupon(null); setAddFeeOverride(function (p) { return { ...p, [sku.id]: e.target.value } }) }}
                                          style={{ width: 90, fontSize: 13, fontWeight: 600, padding: '5px 8px' }} />
                                      </div>
                                      {kits == null ? (
                                        <div className="hint" style={{ marginTop: 6 }}>Loading kit…</div>
                                      ) : kits.length === 0 ? (
                                        <div className="hint" style={{ marginTop: 6 }}>No kit defined for this course.</div>
                                      ) : (
                                        <div style={{ marginTop: 8 }}>
                                          <div style={{ font: '600 9.5px var(--mono)', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 5 }}>Kit items given <span style={{ textTransform: 'none', fontWeight: 400 }}>— uncheck any not handed over</span></div>
                                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                            {kits.map(function (k) {
                                              const on = !ex[k.item_id]
                                              return (
                                                <label key={k.item_id} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 9px', borderRadius: 20, cursor: 'pointer', font: '500 11px var(--font)', border: '1px solid ' + (on ? 'var(--purple)' : 'var(--border)'), background: on ? 'var(--purple-bg)' : 'var(--bg)', color: on ? 'var(--purple)' : 'var(--text3)', textDecoration: on ? 'none' : 'line-through' }}>
                                                  <input type="checkbox" checked={on} onChange={function () { toggleAddKit(sku.id, k.item_id) }} style={{ accentColor: 'var(--purple)' }} />
                                                  {k.name}{k.quantity > 1 ? ' ×' + k.quantity : ''}
                                                </label>
                                              )
                                            })}
                                          </div>
                                        </div>
                                      )}

                                      {/* Monthly-billing cycle target — captured per student, since the
                                          agreed weekly frequency (and so the sessions/month it works
                                          out to) can differ student to student even for the same course. */}
                                      {sku.courses?.billing_type === 'monthly' && (function () {
                                        const perWeek = addSessionsPerWeek[sku.id] != null ? addSessionsPerWeek[sku.id] : 3
                                        const perCycle = Math.round((Number(perWeek) || 0) * 4)
                                        return (
                                          <div style={{ marginTop: 10, borderTop: '1px dashed var(--border)', paddingTop: 8, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                            <span style={{ font: '600 9.5px var(--mono)', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.5px' }}>Classes / week</span>
                                            <input type="number" min={1} max={7} value={perWeek}
                                              onChange={function (e) { setAddSessionsPerWeek(function (p) { return { ...p, [sku.id]: e.target.value } }) }}
                                              style={{ width: 60, fontSize: 12, padding: '4px 6px' }} />
                                            <span className="hint">≈ {perCycle} classes make up one billing cycle</span>
                                          </div>
                                        )
                                      })()}

                                      {/* Assign to batch — right under this course.
                                          HO-only: franchisees don't manage batches/
                                          instructors at this stage, just the student
                                          and their fee/kit/certificate. */}
                                      {admin && <div style={{ marginTop: 10, borderTop: '1px dashed var(--border)', paddingTop: 8 }}>
                                        <div style={{ font: '600 9.5px var(--mono)', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 5 }}>
                                          Assign to batch <span style={{ textTransform: 'none', fontWeight: 400 }}>(optional — can be done later)</span>
                                        </div>
                                        {bd.loading ? <span className="hint">Loading batches…</span> : (
                                          <>
                                            <select value={sel}
                                              onChange={function (e) { setAddBatchSel(function (p) { return { ...p, [sku.id]: e.target.value } }) }}
                                              style={{ fontSize: 12, width: '100%' }}>
                                              <option value="">— No batch yet (assign later) —</option>
                                              {bd.batches.map(function (b) {
                                                return <option key={b.id} value={b.id}>{b.name}{b.instructors?.full_name ? ' · ' + b.instructors.full_name : ''}{b.schedule_days ? ' · ' + b.schedule_days : ''}{b.schedule_time ? ' ' + b.schedule_time : ''}</option>
                                              })}
                                              <option value="__new__">+ Create new batch</option>
                                            </select>
                                            {sel === '__new__' && (
                                              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
                                                {bd.eligibleCIs.length === 0 ? (
                                                  <p className="hint" style={{ color: 'var(--red)' }}>⚠ No active Course Instructors appointed for this level yet.</p>
                                                ) : (
                                                  <label style={{ font: '500 11px var(--font)' }}>Course Instructor *
                                                    <select value={nbf.ci} onChange={function (e) { updateNbf({ ci: e.target.value }) }} style={{ marginTop: 4, fontSize: 12 }}>
                                                      <option value="">— Select CI —</option>
                                                      {bd.eligibleCIs.map(function (ci) { return <option key={ci.id} value={ci.id}>{ci.full_name}</option> })}
                                                    </select>
                                                  </label>
                                                )}
                                                <label style={{ font: '500 11px var(--font)' }}>Batch Name *
                                                  <input value={nbf.name} onChange={function (e) { updateNbf({ name: e.target.value }) }} placeholder="e.g. Saturday Morning Group" style={{ marginTop: 4, fontSize: 12 }} />
                                                </label>
                                                <div>
                                                  <div style={{ font: '500 11px var(--font)', marginBottom: 5 }}>Schedule Days</div>
                                                  <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                                                    {DAYS.map(function (d) {
                                                      const active = nbf.days.includes(d)
                                                      return <button key={d} type="button"
                                                        onClick={function () { updateNbf({ days: active ? nbf.days.filter(function (x) { return x !== d }) : [...nbf.days, d] }) }}
                                                        style={{ padding: '3px 9px', borderRadius: 20, fontSize: 11, cursor: 'pointer', border: active ? '1.5px solid var(--purple)' : '1px solid var(--border)', background: active ? 'var(--purple-bg)' : 'var(--card)', color: active ? 'var(--purple)' : 'var(--text2)', fontWeight: active ? 700 : 500 }}>{d}</button>
                                                    })}
                                                  </div>
                                                </div>
                                                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
                                                  <label style={{ font: '500 11px var(--font)', flex: 1 }}>Time
                                                    <input type="time" value={nbf.time} onChange={function (e) { updateNbf({ time: e.target.value }) }} style={{ marginTop: 4, fontSize: 12 }} />
                                                  </label>
                                                  <label style={{ display: 'flex', alignItems: 'center', gap: 5, font: '500 11px var(--font)', paddingBottom: 5 }}>
                                                    <input type="checkbox" checked={nbf.is_individual} onChange={function (e) { updateNbf({ is_individual: e.target.checked }) }} />
                                                    Individual
                                                  </label>
                                                </div>
                                              </div>
                                            )}
                                          </>
                                        )}
                                      </div>}
                                    </div>
                                  )
                                })}
                              </div>

                              {/* Enrollment date for the new courses */}
                              <div style={{ borderTop: '1px solid var(--border)', marginTop: 12, paddingTop: 12 }}>
                                <label style={{ font: '600 11px var(--font)', color: 'var(--text2)' }}>
                                  📅 Start date
                                  <span style={{ font: '500 10px var(--font)', color: 'var(--text3)', marginLeft: 6 }}>
                                    (course start &amp; batch joining date — one date for both)
                                  </span>
                                  <input type="date" value={addEnrollDate}
                                    onChange={function (e) { setAddEnrollDate(e.target.value) }}
                                    style={{ marginTop: 5, fontSize: 13, width: '100%', maxWidth: 220 }} />
                                </label>
                              </div>

                              {/* Fee + coupon for the new courses */}
                              <div style={{ borderTop: '1px solid var(--border)', marginTop: 12, paddingTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <span style={{ font: '600 12px var(--font)', color: 'var(--text2)' }}>🎟️ Coupon</span>
                                  <CouponField context="student" amount={addedFee} franchiseeId={student.franchisee_id}
                                    applied={addCoupon} onApply={setAddCoupon} onClear={function () { setAddCoupon(null) }} excludeRef={student.id} compact />
                                </div>
                                <div style={{ textAlign: 'right' }}>
                                  <div style={{ font: '500 10px var(--mono)', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em' }}>New course fees</div>
                                  <div style={{ font: '700 16px var(--font)', color: 'var(--purple)' }}>
                                    ₹{fmtAmt(netAdded)}
                                    {discount > 0 && <span style={{ font: '500 11px var(--font)', color: 'var(--text3)', textDecoration: 'line-through', marginLeft: 6 }}>₹{fmtAmt(addedFee)}</span>}
                                  </div>
                                  <div style={{ font: '500 10px var(--font)', color: 'var(--text3)' }}>Fee Total becomes ₹{fmtAmt(newTotal)}</div>
                                </div>
                              </div>
                            </>
                          )
                        })()}

                        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                          <button className="btn" style={{ fontSize: 12 }} onClick={function () { setShowAddEnrollment(false); setSelectedNewSkus([]); setAddCoupon(null); setAddBatchSel({}); setAddNewBatch({}) }}>
                            Cancel
                          </button>
                          <button
                            className="btn-p"
                            style={{ fontSize: 12 }}
                            disabled={!selectedNewSkus.length || addingEnrollment}
                            onClick={addEnrollments}
                          >
                            {addingEnrollment ? 'Adding…' : 'Enroll in ' + selectedNewSkus.length + ' Course' + (selectedNewSkus.length !== 1 ? 's' : '')}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Certificate modal */}
        {certModal && (
          <StudentCertModal
            student={{ ...student, ...form }}
            enrollments={certModal.enrollments}
            centre={certModal.centre}
            onClose={function () { setCertModal(null) }}
          />
        )}

        {waConfirm && <WhatsAppSendConfirm {...waConfirm} onClose={function () { setWaConfirm(null) }} />}

        {/* HO review of a school's submitted marks — certify unlocks the
            certificate, reject sends it back with a note for the school
            to fix and resubmit. */}
        {certifyingEn && (
          <div className="modal-bg" onClick={function (e) { if (e.target === e.currentTarget) setCertifyingEn(null) }}>
            <div className="modal" style={{ maxWidth: 420 }}>
              <ModalHeader flush title="Review Marks"
                subtitle={(certifyingEn.skus?.courses?.group_name || 'Course') + (certifyingEn.skus?.level_name ? ' · ' + certifyingEn.skus.level_name : '')}
                onClose={function () { setCertifyingEn(null) }} />
              <div style={{ padding: '4px 20px 16px' }}>
                <div style={{ display: 'flex', gap: 16, marginBottom: 10 }}>
                  <div>
                    <div style={{ font: '600 9.5px var(--mono)', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.5px' }}>Marks</div>
                    <div style={{ font: '700 18px var(--mono)', color: 'var(--text)' }}>
                      {certifyingEn.marks_obtained != null ? certifyingEn.marks_obtained : '—'}
                      {certifyingEn.marks_total != null ? ' / ' + certifyingEn.marks_total : ''}
                    </div>
                  </div>
                  <div>
                    <div style={{ font: '600 9.5px var(--mono)', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.5px' }}>Submitted</div>
                    <div style={{ font: '600 12px var(--font)', color: 'var(--text)' }}>
                      {certifyingEn.marks_submitted_at ? fmtDate(certifyingEn.marks_submitted_at.slice(0, 10)) : '—'}
                    </div>
                  </div>
                </div>
                {certifyingEn.marks_remarks && (
                  <p className="hint" style={{ marginBottom: 10 }}>“{certifyingEn.marks_remarks}”</p>
                )}
                <label style={{ font: '600 12px var(--font)', color: 'var(--text2)' }}>
                  Rejection note <span style={{ fontWeight: 400, color: 'var(--text3)' }}>(only needed if rejecting)</span>
                  <textarea value={certifyRejectNote}
                    onChange={function (e) { setCertifyRejectNote(e.target.value) }}
                    rows={2} placeholder="e.g. marks look inconsistent with attendance — please recheck"
                    style={{ marginTop: 6, fontSize: 13, width: '100%', resize: 'vertical' }} />
                </label>
              </div>
              <div className="modal-actions">
                <button className="btn" onClick={function () { setCertifyingEn(null) }}>Cancel</button>
                <button className="btn-s" style={{ color: '#991b1b', borderColor: '#fca5a5' }}
                  disabled={certifySaving}
                  onClick={function () { certifyEnrollment(certifyingEn, false, certifyRejectNote) }}>
                  {certifySaving ? '…' : '✖ Reject'}
                </button>
                <button className="btn-p"
                  disabled={certifySaving}
                  onClick={function () { certifyEnrollment(certifyingEn, true, '') }}>
                  {certifySaving ? '…' : '✓ Certify'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Course completion date modal */}
        {completingEnr && (
          <div className="modal-bg" onClick={function (e) { if (e.target === e.currentTarget) setCompletingEnr(null) }}>
            <div className="modal" style={{ maxWidth: 380 }}>
              <ModalHeader flush title="Mark Course Complete"
                subtitle={(completingEnr.skus?.courses?.group_name || 'Course') + (completingEnr.skus?.level_name ? ' · ' + completingEnr.skus.level_name : '')}
                onClose={function () { setCompletingEnr(null) }} />
              <div style={{ padding: '4px 20px 16px' }}>
                <label style={{ font: '600 12px var(--font)', color: 'var(--text2)' }}>
                  Course end date
                  <input
                    type="date"
                    value={completeDate}
                    max={new Date().toISOString().slice(0, 10)}
                    onChange={function (e) { setCompleteDate(e.target.value) }}
                    style={{ marginTop: 6, fontSize: 13, width: '100%' }}
                  />
                </label>
                <p className="hint" style={{ marginTop: 8 }}>
                  Defaults to the last attended class. The student stays on sessions up to this date and drops off any sessions after it.
                </p>
                {isSchool && (
                  <div style={{ borderTop: '1px solid var(--border)', marginTop: 12, paddingTop: 12 }}>
                    <div style={{ font: '600 12px var(--font)', color: 'var(--text)', marginBottom: 8 }}>
                      📝 Marks — required before HO can certify
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <label style={{ font: '600 11px var(--font)', color: 'var(--text2)', flex: 1 }}>
                        Marks obtained
                        <input type="number" min={0} value={marksObtained}
                          onChange={function (e) { setMarksObtained(e.target.value) }}
                          style={{ marginTop: 4, fontSize: 13, width: '100%' }} />
                      </label>
                      <label style={{ font: '600 11px var(--font)', color: 'var(--text2)', flex: 1 }}>
                        Out of
                        <input type="number" min={0} value={marksTotal}
                          onChange={function (e) { setMarksTotal(e.target.value) }}
                          style={{ marginTop: 4, fontSize: 13, width: '100%' }} />
                      </label>
                    </div>
                    <label style={{ font: '600 11px var(--font)', color: 'var(--text2)', display: 'block', marginTop: 8 }}>
                      Remarks (optional)
                      <textarea value={marksRemarks}
                        onChange={function (e) { setMarksRemarks(e.target.value) }}
                        rows={2}
                        style={{ marginTop: 4, fontSize: 13, width: '100%', resize: 'vertical' }} />
                    </label>
                    <p className="hint" style={{ marginTop: 6 }}>
                      This goes to HO for review — the certificate won't be available until it's certified.
                    </p>
                  </div>
                )}
              </div>
              <div className="modal-actions">
                <button className="btn" onClick={function () { setCompletingEnr(null) }}>Cancel</button>
                <button className="btn-p"
                  disabled={!completeDate || (isSchool && (marksObtained === '' || marksTotal === ''))}
                  onClick={function () { markCourseComplete(completingEnr, completeDate) }}>
                  {isSchool ? 'Submit for HO Review' : 'Mark Complete'}
                </button>
              </div>
            </div>
          </div>
        )}

        {showAttSheet && (
          <AttendanceSheet mode="student" student={{ ...student, enrollments: localEnrollments }} onClose={function () { setShowAttSheet(false) }} />
        )}

        {/* Renew monthly billing cycles — pick the courses; one invoice results. */}
        {renewOpen && (function () {
          const mon = localEnrollments.filter(isMonthlyActive)
          const sel = mon.filter(function (e) { return renewRows[e.id] && renewRows[e.id].on })
          const sum = sel.reduce(function (t, e) { return t + (Number(renewRows[e.id].fee) || 0) }, 0)
          return (
          <div className="modal-bg" onClick={function (e) { if (e.target === e.currentTarget) setRenewOpen(false) }}>
            <div className="modal" style={{ maxWidth: 560 }}>
              <ModalHeader flush title="Renew Cycle"
                subtitle={student.full_name + ' · tick the courses to renew — one invoice is raised'}
                onClose={function () { setRenewOpen(false) }} />
              <div style={{ padding: '4px 20px 16px', maxHeight: '62vh', overflowY: 'auto' }}>
                <p className="hint" style={{ marginBottom: 10 }}>
                  Each new cycle starts on that course's due date (same date next month) — nudge it a day or two to fold in a session that ran early or late. Nothing carries into the next cycle; mark attendance first so it is counted.
                </p>
                {mon.map(function (en) {
                  const r = renewRows[en.id]
                  if (!r) return null
                  const cyc = cycleProgress[en.id]
                  const ri = renewalInfo(en)
                  return (
                    <div key={en.id} style={{ border: '1.5px solid ' + (r.on ? 'var(--purple)' : 'var(--border)'), borderRadius: 10, padding: '10px 12px', marginBottom: 8, background: r.on ? 'var(--purple-bg)' : 'var(--bg)' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                        <input type="checkbox" checked={r.on} onChange={function (e) { setRenewRow(en.id, { on: e.target.checked }) }} />
                        <span style={{ font: '700 13px var(--font)', color: 'var(--text)', flex: 1 }}>
                          {en.skus?.courses?.group_name || 'Course'}{en.skus?.level_name ? ' · ' + en.skus.level_name : ''}
                        </span>
                        {ri && (
                          <span style={{ font: '600 10px var(--font)', color: ri.state === 'overdue' ? '#991b1b' : ri.state === 'soon' ? '#B45309' : 'var(--text3)', whiteSpace: 'nowrap' }}>
                            {ri.state === 'overdue' ? 'overdue since ' : 'due '}{fmtDate(ri.due)}
                          </span>
                        )}
                      </label>
                      {cyc && (
                        <div style={{ font: '500 11px var(--font)', color: 'var(--text3)', margin: '4px 0 0 24px' }}>
                          {cyc.done} of {cyc.target} classes done in the cycle that started {fmtDate(cycleAnchor(en))}
                          {cyc.unmarked > 0 ? ' · ' + cyc.unmarked + ' not marked' : ''}
                        </div>
                      )}
                      {r.on && (
                        <div style={{ margin: '10px 0 0 24px' }}>
                          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                            <label style={{ font: '600 11px var(--font)', color: 'var(--text2)' }}>New cycle start
                              <input type="date" value={r.date} onChange={function (e) { setRenewRow(en.id, { date: e.target.value }) }}
                                style={{ display: 'block', marginTop: 4, fontSize: 12 }} />
                            </label>
                            <label style={{ font: '600 11px var(--font)', color: 'var(--text2)' }}>Fee for the month (₹)
                              <input type="number" min={0} value={r.fee} onChange={function (e) { setRenewRow(en.id, { fee: e.target.value }) }}
                                style={{ display: 'block', marginTop: 4, fontSize: 12, width: 110 }} />
                            </label>
                          </div>
                          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 8 }}>
                            {CYCLE_DAY_NAMES.map(function (d) {
                              const on = r.days.includes(d)
                              return (
                                <button key={d} type="button"
                                  onClick={function () { setRenewRow(en.id, { days: on ? r.days.filter(function (x) { return x !== d }) : r.days.concat(d) }) }}
                                  style={{ padding: '4px 7px', borderRadius: 7, cursor: 'pointer', font: '600 11px var(--font)', border: '1.5px solid ' + (on ? 'var(--purple)' : 'var(--border)'), background: on ? '#fff' : 'var(--bg)', color: on ? 'var(--purple)' : 'var(--text3)' }}>
                                  {d}
                                </button>
                              )
                            })}
                          </div>
                          <span className="hint" style={{ display: 'block', marginTop: 5 }}>
                            {r.days.length === 0
                              ? 'Pick at least one day.'
                              : countCycleDays(r.date || todayIso(), r.days) + ' class days to ' + fmtDate(addOneMonth(r.date || todayIso())) + ' (declared holidays come off the target).'}
                          </span>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
              <div className="modal-actions">
                <span style={{ marginRight: 'auto', font: '600 12px var(--font)', color: 'var(--text2)' }}>
                  {sel.length} course{sel.length === 1 ? '' : 's'} · {sum > 0 ? '₹' + fmtAmt(sum) + ' on one invoice' : 'dates only, no fee'}
                </span>
                <button className="btn" onClick={function () { setRenewOpen(false) }} disabled={renewSaving}>Cancel</button>
                <button className="btn-p" disabled={sel.length === 0 || renewSaving} onClick={renewCycle}>
                  {renewSaving ? 'Saving…' : 'Renew ' + (sel.length || '') + ' course' + (sel.length === 1 ? '' : 's')}
                </button>
              </div>
            </div>
          </div>
          )
        })()}

        {/* Send-review modal (editable recipient number) */}
        {reviewingEn && (
          <div className="modal-bg" onClick={function (e) { if (e.target === e.currentTarget) setReviewingEn(null) }}>
            <div className="modal" style={{ maxWidth: 380 }}>
              <ModalHeader flush title="Send Google Review Request"
                subtitle={(reviewingEn.skus?.courses?.group_name || 'Course') + (reviewingEn.skus?.level_name ? ' · ' + reviewingEn.skus.level_name : '')}
                onClose={function () { setReviewingEn(null) }} />
              <div style={{ padding: '4px 20px 16px' }}>
                <label style={{ font: '600 12px var(--font)', color: 'var(--text2)' }}>
                  Parent's WhatsApp number
                  <input
                    type="tel"
                    value={reviewPhone}
                    onChange={function (e) { setReviewPhone(e.target.value) }}
                    placeholder="e.g. 9028006800"
                    style={{ marginTop: 6, fontSize: 13, width: '100%' }}
                  />
                </label>
                <p className="hint" style={{ marginTop: 8 }}>
                  Defaults to the number on file. Change it to send to any number (e.g. to verify delivery).
                </p>
              </div>
              <div className="modal-actions">
                <button className="btn" onClick={function () { setReviewingEn(null) }} disabled={reviewSending}>Cancel</button>
                <button className="btn-p" onClick={doSendReview} disabled={reviewSending || !reviewPhone.trim()}>
                  {reviewSending ? 'Sending…' : 'Send on WhatsApp'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Change course / level modal */}
        {changingEn && (
          <div className="modal-bg" onClick={function (e) { if (e.target === e.currentTarget) setChangingEn(null) }}>
            <div className="modal" style={{ maxWidth: 420 }}>
              <ModalHeader flush title="Change Course / Level"
                subtitle={'Currently: ' + (changingEn.skus?.courses?.group_name || 'Course') + (changingEn.skus?.level_name ? ' · ' + changingEn.skus.level_name : '')}
                onClose={function () { setChangingEn(null) }} />
              <div style={{ padding: '4px 20px 16px' }}>
                <label style={{ font: '600 12px var(--font)', color: 'var(--text2)' }}>New course / level
                  <select value={changeSkuId} onChange={function (e) { setChangeSkuId(e.target.value) }} style={{ marginTop: 6 }}>
                    {allCentreSkus.map(function (s) {
                      return (
                        <option key={s.id} value={s.id}>
                          {(s.courses?.group_name || 'Course') + (s.level_name ? ' — ' + s.level_name : '')}
                        </option>
                      )
                    })}
                  </select>
                </label>
                <p className="hint" style={{ marginTop: 8 }}>
                  Keeps the batch assignment, attendance and certificate history — only the course/level is swapped.
                </p>
              </div>
              <div className="modal-actions">
                <button className="btn" onClick={function () { setChangingEn(null) }} disabled={changeSaving}>Cancel</button>
                <button className="btn-p" onClick={saveChangeLevel} disabled={changeSaving || !changeSkuId}>
                  {changeSaving ? 'Saving…' : 'Update'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Footer actions */}
        <div className="modal-actions">
          {admin && can('students.delete') && (
            <button
              className="btn"
              style={{ color: 'var(--red, #dc2626)', borderColor: 'var(--red, #dc2626)', marginRight: 'auto' }}
              onClick={deleteStudent}
              disabled={deleting}
            >
              {deleting ? 'Deleting…' : '🗑 Delete Student'}
            </button>
          )}
          {/* Close / reopen — the correct way to end a mid-course leaver's
              account, as opposed to Delete which erases the record entirely. */}
          {canEdit && (form.is_active === false
            ? <button className="btn" onClick={reopenStudentAccount} disabled={closing}>
                {closing ? '…' : '↩ Reopen Account'}
              </button>
            : <button className="btn" style={{ color: '#92400e', borderColor: '#fbbf24' }}
                onClick={closeStudentAccount} disabled={closing}>
                {closing ? '…' : '⊘ Close / Withdraw'}
              </button>
          )}
          <button className="btn" onClick={onClose}>Close</button>
          {canEdit && tab === 'profile' && (
            <button className="btn-p" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── AddStudentModal ────────────────────────────────────────────────────────────

// deriveFilter/CENTRE_TIERS now live in ../utils/courseAccess.js (shared with
// InstructorsPage.jsx and anywhere else a franchisee's registered-courses
// scope needs to be applied) — kept as a single source of truth per the
// standing rule that a franchisee only ever sees courses HO registered them
// for, never the full catalogue.

function AddStudentModal({ onClose, onSaved, onOpenExisting }) {
  const { currentRole, currentFranchiseeId } = useAuth()
  const admin = isAdminRole(currentRole)

  const [form, setForm] = useState({
    full_name: '', parent_name: '', gender: '', camp_name: '', dob: '', registered_at: '', phone: '', email: '',
    pincode: '', city: '', area: '', state: '', country: 'India', address: '',
    channel: 'franchise',
    franchisee_id: admin ? '' : (currentFranchiseeId || ''),
  })
  const [showAddress, setShowAddress] = useState(false)
  const [centreList, setCentreList] = useState([])
  const [allSkus, setAllSkus] = useState([])
  const [phoneMatches, setPhoneMatches] = useState([])   // existing students with same phone
  const [phoneConfirmed, setPhoneConfirmed] = useState(false) // user chose to add new despite matches
  // null = no centre chosen yet; 'all' = show everything; {skuIds} or {courseIds} = filtered
  const [regFilter, setRegFilter] = useState(null)
  const [selectedSkus, setSelectedSkus] = useState([])
  const [feeTotal, setFeeTotal] = useState(0)
  const [coupon, setCoupon] = useState(null)   // { coupon_id, code, discount }
  const [saving, setSaving] = useState(false)
  const [sendWAEnroll, setSendWAEnroll] = useState(true)

  const couponDiscount = coupon ? Math.min(coupon.discount, feeTotal) : 0
  const netFee = Math.max(0, feeTotal - couponDiscount)

  // ── Batch assignment state ──
  // { [sku_id]: { batches: [], eligibleCIs: [], loading: bool } }
  const [batchData, setBatchData] = useState({})
  // { [sku_id]: '' | batch_id | '__new__' }
  const [batchSel, setBatchSel] = useState({})
  // { [sku_id]: { ci, name, days, time, is_individual } }
  const [newBatchForms, setNewBatchForms] = useState({})

  // ── Kit-issuance confirmation state (same pattern as the Add-Course flow
  // on an existing student — this initial enrollment used to skip it
  // entirely and just deduct the full kit with no confirmation step). ──
  const [kitData,     setKitData]     = useState({})   // { [sku_id]: [{ item_id, name, quantity }] }
  const [kitExcluded, setKitExcluded] = useState({})   // { [sku_id]: { [item_id]: true } } — unchecked = not actually given

  async function loadKit(sku) {
    if (kitData[sku.id]) return
    const { data } = await sb.from('kit_items')
      .select('item_id, quantity, inventory_items(name)').eq('sku_id', sku.id)
    setKitData(function (prev) { return { ...prev, [sku.id]: (data || []).map(function (k) { return { item_id: k.item_id, name: k.inventory_items?.name || 'Kit item', quantity: Number(k.quantity || 1) } } ) } })
  }
  function toggleKitItem(skuId, itemId) {
    setKitExcluded(function (prev) {
      const cur = { ...(prev[skuId] || {}) }
      if (cur[itemId]) delete cur[itemId]; else cur[itemId] = true
      return { ...prev, [skuId]: cur }
    })
  }

  const FR_FIELDS = 'id,business_name,city,area,country,tier,registered_courses,registered_skus'

  useEffect(() => {
    async function loadCentres() {
      if (admin) {
        // HO enrols only at its own Head Office centre — never on behalf of another centre.
        const { data } = await sb.from('franchisees')
          .select('id,business_name,tier,registered_courses,registered_skus')
          .eq('tier', 'NLH').limit(1).maybeSingle()
        if (data) {
          setCentreList([data])
          setForm(function (f) { return { ...f, franchisee_id: data.id } })
          setRegFilter(deriveFilter(data))
        }
      } else {
        // UF / CF / SMF: fixed to their own centre — registration is by the centre holder only
        const { data } = await sb.from('franchisees')
          .select('id,business_name,tier,registered_courses,registered_skus').eq('id', currentFranchiseeId).single()
        if (data) { setCentreList([data]); setForm(function (f) { return { ...f, franchisee_id: data.id } }) }
        setRegFilter(deriveFilter(data))
      }
    }
    loadCentres()

    // Load all SKUs once, sorted by curriculum order
    sb.from('skus').select('id,level_name,student_fee,course_id,courses(group_name)').order('sort_order')
      .then(({ data }) => { setAllSkus(data || []) })
  }, [])

  // Phone lookup — debounced 500ms, searches ALL centres
  useEffect(function () {
    setPhoneConfirmed(false)
    if (!form.phone || form.phone.replace(/\D/g, '').length < 10) { setPhoneMatches([]); return }
    const timer = setTimeout(async function () {
      // Match on the digit string, not the exact text — a stored "+91 96232…"
      // must still match a typed "96232…", or a duplicate gets created for a
      // student who is already on file (the whole point of this lookup).
      const digits = form.phone.replace(/\D/g, '').slice(-10)
      const { data } = await sb.from('students')
        .select('id, full_name, parent_name, franchisee_id, is_active, payment_status, closed_at, franchisees(business_name, city), enrollments(id, sku_id, status, skus(level_name, courses(group_name)))')
        .ilike('phone', '%' + digits + '%')
      setPhoneMatches(data || [])
    }, 500)
    return function () { clearTimeout(timer) }
  }, [form.phone])

  // Build filtered + grouped SKU list for display
  function buildGroups() {
    if (!regFilter) return []
    let filtered
    if (regFilter === 'all') {
      filtered = allSkus
    } else if (regFilter.skuIds) {
      filtered = allSkus.filter(s => regFilter.skuIds.includes(s.id))
    } else if (regFilter.courseIds) {
      filtered = allSkus.filter(s => regFilter.courseIds.includes(s.course_id))
    } else {
      filtered = []
    }
    const map = {}
    filtered.forEach(function (sku) {
      const g = sku.courses?.group_name || 'Other'
      if (!map[g]) map[g] = []
      map[g].push(sku)
    })
    return Object.entries(map).map(function ([name, skus]) { return { name, skus } })
  }

  function field(k) {
    return function (e) { setForm(f => ({ ...f, [k]: e.target.value })) }
  }

  function handleCentreChange(fid) {
    setForm(f => ({ ...f, franchisee_id: fid }))
    setSelectedSkus([])
    setFeeTotal(0)
    setBatchData({})
    setBatchSel({})
    setNewBatchForms({})
    setKitData({})
    setKitExcluded({})
    if (!fid) { setRegFilter(null); return }
    const fr = centreList.find(function (c) { return c.id === fid })
    setRegFilter(deriveFilter(fr))
  }

  async function loadBatchData(skuId) {
    if (batchData[skuId]) return   // already loaded or loading
    setBatchData(function (prev) { return { ...prev, [skuId]: { batches: [], eligibleCIs: [], loading: true } } })
    // Get CIs certified for this SKU at this centre — the selected franchisee
    // (form.franchisee_id), never HO's or another centre's roster.
    const { data: ciRows } = await sb.from('instructor_courses')
      .select('instructor_id, instructors(id, full_name, status, franchisee_id)')
      .eq('sku_id', skuId).eq('status', 'active')
    const eligibleCIs = (ciRows || [])
      .map(function (r) { return r.instructors })
      .filter(function (i) { return i && i.status === 'active' && i.franchisee_id === form.franchisee_id })
      .filter(function (i, idx, arr) { return arr.findIndex(function (x) { return x.id === i.id }) === idx })
    const eligibleCIIds = eligibleCIs.map(function (ci) { return ci.id })
    // Batches whose instructor is certified for this SKU
    const { data: batches } = eligibleCIIds.length
      ? await sb.from('batches')
          .select('id, name, schedule_days, schedule_time, is_individual, instructor_id, instructors(id, full_name)')
          .in('instructor_id', eligibleCIIds).eq('is_active', true).eq('franchisee_id', form.franchisee_id).order('created_at')
      : { data: [] }
    setBatchData(function (prev) { return { ...prev, [skuId]: { batches: batches || [], eligibleCIs, loading: false } } })
  }

  function toggleSku(sku) {
    setSelectedSkus(function (prev) {
      const exists = prev.find(function (s) { return s.id === sku.id })
      const next = exists ? prev.filter(function (s) { return s.id !== sku.id }) : [...prev, sku]
      setFeeTotal(next.reduce(function (sum, s) { return sum + (s.student_fee || 0) }, 0))
      setCoupon(null)  // fee changed — re-apply coupon against the new total
      if (!exists) {
        // selecting — load batch data + kit items for this SKU
        loadBatchData(sku.id)
        loadKit(sku)
      } else {
        // deselecting — clear its batch selection and kit exclusions
        setBatchSel(function (p) { const n = { ...p }; delete n[sku.id]; return n })
        setNewBatchForms(function (p) { const n = { ...p }; delete n[sku.id]; return n })
        setKitExcluded(function (p) { const n = { ...p }; delete n[sku.id]; return n })
      }
      return next
    })
  }

  async function save() {
    if (!form.full_name.trim()) { showToast('Student name is required', 'warn'); return }
    if (to10Digit(form.phone).length !== 10) { showToast('Enter a valid 10-digit mobile number (no country code)', 'warn'); return }
    if (!form.email.trim() || !form.email.includes('@')) { showToast('Parent email address is required', 'warn'); return }
    if (!form.franchisee_id) { showToast('Please select a centre', 'warn'); return }

    setSaving(true)
    const tempPass = genTempPass()

    try {
      // Insert student
      const { data: st, error: stErr } = await sb.from('students').insert({
        full_name: form.full_name.trim(),
        parent_name: form.parent_name.trim(),
        gender: form.gender || null,
        camp_name: form.camp_name.trim() || null,
        dob: form.dob || null,
        registered_at: form.registered_at || new Date().toISOString().slice(0, 10),
        phone: to10Digit(form.phone),
        email: form.email.trim() || null,
        pincode: form.pincode.trim() || null,
        city: form.city.trim(),
        area: form.area.trim(),
        state: form.state.trim(),
        country: form.country.trim(),
        address: form.address.trim(),
        channel: form.channel || 'walk-in',
        franchisee_id: form.franchisee_id,
        is_active: true,
        fee_total: netFee,
        fee_paid: 0,
        payment_status: deriveStatus(netFee, 0),
        coupon_id: coupon?.coupon_id || null,
        coupon_code: coupon?.code || null,
        discount_amount: couponDiscount,
      }).select().single()

      if (stErr) { showToast('Failed to create student: ' + stErr.message, 'err'); setSaving(false); return }

      // NOTE: the coupon is applied to the admission (stored on the student) but
      // not redeemed/locked here — it locks when the first fee payment is
      // received (see StudentReceiptModal), mirroring 'lock on dispatch' for orders.

      // Insert enrollments and capture IDs for batch assignment.
      // Start date = the registration date (one date threads enrolment + batch joining).
      const startAt = (form.registered_at || new Date().toISOString().slice(0, 10)) + 'T00:00:00+00:00'
      let enrData = []
      if (selectedSkus.length > 0) {
        const enrollRows = selectedSkus.map(function (sku) { return {
          student_id: st.id,
          sku_id: sku.id,
          franchisee_id: form.franchisee_id,
          enrolled_at: startAt,
        } })
        const { data: inserted } = await sb.from('enrollments').insert(enrollRows).select('id, sku_id')
        enrData = inserted || []
      }

      // Raise the admission's fee invoice (courses + their confirmed kit
      // items) and deduct HO stock only for what was actually confirmed as
      // given — kitData/kitExcluded were already loaded per SKU when it was
      // checked in Section 3, same "uncheck any not handed over" pattern the
      // Add-Course flow already used for an existing student.
      if (enrData.length > 0) {
        const lines = []
        const stockRows = []
        enrData.forEach(function (e) {
          const sku = selectedSkus.find(function (s) { return s.id === e.sku_id })
          const cname = (sku?.courses?.group_name ? sku.courses.group_name + ' — ' : '') + (sku?.level_name || '')
          const fee = sku?.student_fee || 0
          lines.push({ kind: 'course', sku_id: e.sku_id, enrollment_id: e.id, name: cname, qty: 1, rate: fee, amount: fee })
          const ex = kitExcluded[e.sku_id] || {}
          ;(kitData[e.sku_id] || []).filter(function (k) { return !ex[k.item_id] }).forEach(function (k) {
            const qn = Number(k.quantity || 1)
            lines.push({ kind: 'kit', sku_id: e.sku_id, item_id: k.item_id, name: k.name, qty: qn, rate: 0, amount: 0 })
            if (qn > 0) stockRows.push({ item_id: k.item_id, location_type: 'ho', movement_type: 'issue_to_student', qty: -qn, ref_type: 'enrollment', ref_id: e.id, franchisee_id: form.franchisee_id || null, note: 'Kit · ' + form.full_name.trim() })
          })
        })
        const subtotal = lines.filter(function (l) { return l.kind === 'course' }).reduce(function (s, l) { return s + l.amount }, 0)
        const disc = couponDiscount || 0
        await sb.from('student_invoices').insert({
          student_id: st.id, franchisee_id: form.franchisee_id || null,
          enrollment_id: enrData.length === 1 ? enrData[0].id : null,
          invoice_date: form.registered_at || new Date().toISOString().slice(0, 10), items: lines,
          subtotal: subtotal, discount: disc, coupon_code: coupon?.code || null,
          total: Math.max(0, subtotal - disc), amount_paid: 0, status: (subtotal - disc) > 0 ? 'unpaid' : 'paid',
        })
        if (stockRows.length) await sb.from('stock_ledger').insert(stockRows)
      }

      // Assign batches (or create new ones) for each selected SKU
      for (let i = 0; i < selectedSkus.length; i++) {
        const sku = selectedSkus[i]
        const sel = batchSel[sku.id]
        if (!sel) continue
        const enrollment = enrData.find(function (e) { return e.sku_id === sku.id })
        if (!enrollment) continue

        let batchId = sel
        if (sel === '__new__') {
          const nbf = newBatchForms[sku.id] || {}
          if (!nbf.ci || !nbf.name || !nbf.name.trim()) continue
          const { data: newBatch, error: bErr } = await sb.from('batches').insert({
            instructor_id:  nbf.ci,
            franchisee_id:  form.franchisee_id,
            name:           nbf.name.trim(),
            is_individual:  nbf.is_individual || false,
            schedule_days:  (nbf.days || []).length ? nbf.days.join(', ') : null,
            schedule_time:  nbf.time || null,
            is_active:      true,
            sessions_done:  0,
          }).select('id').single()
          if (bErr) { showToast('Batch create failed for ' + sku.level_name + ': ' + bErr.message, 'warn'); continue }
          batchId = newBatch.id
        }

        await sb.from('batch_students').insert({ batch_id: batchId, enrollment_id: enrollment.id, assigned_at: startAt })
      }

      // Admin session restore hack for auth account creation
      if (form.phone) {
        const loginEmail = `student.${st.id}@nlhnagpur.info`
        try {
          const { data: { session: admSess } } = await sb.auth.getSession()
          const createRes = await fetch('/api/create-user', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(admSess ? { Authorization: `Bearer ${admSess.access_token}` } : {}),
            },
            body: JSON.stringify({
              email:    loginEmail,
              password: tempPass,
              fullName: form.full_name.trim(),
              role:     'student',
            }),
          })
          const createData = await createRes.json()
          if (createData.success || createData.error?.includes('already registered')) {
            // Only write the profile row when a real login account exists —
            // otherwise this leaves a login that always fails (matches the
            // bug fixed in FranchiseesPage.jsx's onboarding flow).
            await sb.from('users').upsert({
              email: loginEmail,
              full_name: form.full_name.trim(),
              role: 'student',
              franchisee_id: form.franchisee_id,
              student_id: st.id,
            }, { onConflict: 'email' })
          } else {
            console.warn('Student auth account creation failed:', createData.error)
            showToast('Student saved, but login account could not be created: ' + (createData.error || 'Unknown error'), 'warn')
          }
        } catch (authErr) {
          console.warn('Student auth account skipped:', authErr.message)
        }
      }

      showToast('Student added successfully')
      if (sendWAEnroll && form.phone && selectedSkus.length > 0) {
        try {
          const courseNames = selectedSkus.map(function (s) { return s.courses?.group_name || s.name }).join(', ')
          const r = await sendWAStudentEnrolled(form.phone, {
            parentName:  form.parent_name || 'Parent',
            studentName: form.full_name,
            courses:     courseNames,
            // The centre the student actually enrolled at — the parent is told
            // to contact their centre, so naming Head Office to a UF's parent
            // sends them to the wrong place.
            centre:      (centreList.find(function (c) { return c.id === form.franchisee_id }) || {}).business_name
                         || 'New Learning Horizons',
          })
          if (r && r.success) showToast('Enrollment confirmation sent on WhatsApp ✓')
          else showToast('Student added · WhatsApp confirmation failed' + (r && r.error ? ': ' + r.error : ''), 'warn')
        } catch (waErr) {
          showToast('Student added · WhatsApp confirmation failed: ' + waErr.message, 'warn')
        }
      }
      try { await mirrorStudentToTransaction(st.id) } catch (e) { console.warn('[Phase 3 dual-write] student create mirror failed:', e.message) }
      // Re-fetch with full joins so the list shows enrollments immediately
      const { data: fullSt } = await sb.from('students')
        .select('*, franchisees(business_name, city), enrollments(id, sku_id, fee_amount, list_price, waived, sessions_per_week, sessions_per_cycle, cycle_started_at, cycle_days, completed_at, status, marks_obtained, marks_total, marks_remarks, marks_submitted_at, cert_status, cert_reject_note, cert_emailed_at, cert_wa_sent_at, cert_issued_at, skus(level_name, courses(group_name)))')
        .eq('id', st.id)
        .single()
      onSaved(fullSt || st)
    } catch (err) {
      showToast('Unexpected error: ' + err.message, 'err')
    } finally {
      setSaving(false)
    }
  }

  const groups = buildGroups()

  return (
    <div className="modal-bg" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: '92vh' }}>
        <ModalHeader title="New Student" subtitle="New Learning Horizons · Admission form" onClose={onClose} />

        <div style={{ padding: '18px 22px', overflowY: 'auto', background: 'var(--bg2, #FAFAF8)', flex: 1 }}>
          {/* ── Phone — primary student ID (always visible) ── */}
          <div style={{ marginBottom: 14 }}>
            <label style={{ font: '600 12px var(--font)', color: 'var(--text)', display: 'block', marginBottom: 4 }}>
              Mobile Number *
              <span style={{ font: '500 10px var(--font)', color: 'var(--text3)', marginLeft: 6 }}>
                (primary student ID — enter first)
              </span>
            </label>
            <input
              value={form.phone}
              onChange={function (e) { setForm(function (f) { return { ...f, phone: to10Digit(e.target.value) } }) }}
              inputMode="numeric"
              maxLength={10}
              placeholder="10-digit mobile — no country code"
              autoFocus
              style={{ fontSize: 15, letterSpacing: '0.5px', fontWeight: 600 }}
            />
            {form.phone.replace(/\D/g, '').length >= 10 && phoneMatches.length === 0 && (
              <div style={{ font: '500 11px var(--font)', color: 'var(--green, #16a34a)', marginTop: 4 }}>
                ✓ No existing student found — fill in details below
              </div>
            )}
          </div>

          {/* ── Phase 2a: Match picker ── */}
          {phoneMatches.length > 0 && !phoneConfirmed && (
            <div>
              <div style={{ font: '600 12px var(--font)', color: 'var(--text)', marginBottom: 8 }}>
                Already on file — {phoneMatches.length} student{phoneMatches.length > 1 ? 's' : ''} with this number.
                {phoneMatches.some(function (s) { return s.is_active === false }) && (
                  <span style={{ fontWeight: 500, color: 'var(--text3)' }}> Open a closed one to re-join them for a new course — no re-entry needed.</span>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
                {phoneMatches.map(function (st) {
                  const initials = (st.full_name || '?').split(' ').slice(0, 2).map(function (w) { return w[0] }).join('').toUpperCase()
                  const courses = (st.enrollments || [])
                    .map(function (e) { return e.skus?.courses?.group_name })
                    .filter(Boolean)
                    .filter(function (c, i, a) { return a.indexOf(c) === i })
                  return (
                    <button
                      key={st.id}
                      type="button"
                      onClick={function () { onOpenExisting(st); onClose() }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 12,
                        padding: '10px 14px', borderRadius: 10,
                        border: '1.5px solid var(--border)', background: 'var(--card)',
                        cursor: 'pointer', textAlign: 'left', width: '100%',
                      }}
                    >
                      <div style={{
                        width: 38, height: 38, borderRadius: '50%',
                        background: 'var(--purple-bg)', color: 'var(--purple)',
                        font: '700 14px var(--font)', display: 'flex',
                        alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                      }}>{initials}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ font: '700 13px var(--font)', color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 6 }}>
                          {st.full_name}
                          {st.is_active === false && (
                            <span style={{ font: '600 9px var(--font)', color: '#991b1b', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 20, padding: '1px 7px' }}>
                              ⊘ Closed — re-join
                            </span>
                          )}
                        </div>
                        {st.parent_name && (
                          <div style={{ font: '500 11px var(--font)', color: 'var(--text3)' }}>
                            Parent: {st.parent_name}
                          </div>
                        )}
                        <div style={{ font: '500 11px var(--font)', color: 'var(--text3)' }}>
                          📍 {st.franchisees?.business_name || '—'}{st.franchisees?.city ? `, ${st.franchisees.city}` : ''}
                        </div>
                        {courses.length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                            {courses.map(function (c) {
                              return (
                                <span key={c} style={{
                                  padding: '1px 7px', borderRadius: 20,
                                  background: 'var(--purple-bg)', color: 'var(--purple)',
                                  font: '500 10px var(--font)',
                                }}>{c}</span>
                              )
                            })}
                          </div>
                        )}
                      </div>
                      <div style={{ font: '700 11px var(--font)', color: 'var(--purple)', flexShrink: 0 }}>
                        Open →
                      </div>
                    </button>
                  )
                })}
              </div>
              <button
                type="button"
                onClick={function () { setPhoneConfirmed(true) }}
                style={{
                  width: '100%', padding: '9px 0', borderRadius: 8,
                  border: '1.5px dashed var(--border)', background: 'none',
                  font: '600 12px var(--font)', color: 'var(--text2)', cursor: 'pointer',
                }}
              >
                ➕ Enrol as new student with this number anyway
              </button>
            </div>
          )}

          {/* ── Phase 2b: full form (no matches, or user confirmed new) ── */}
          {(phoneMatches.length === 0 || phoneConfirmed) && (<>

          {/* ── Section 1: Student basics ── */}
          <div className="form-grid">
            <label>Student Name *
              <input value={form.full_name} onChange={field('full_name')} placeholder="Full name" />
            </label>
            <label>Parent / Guardian
              <input value={form.parent_name} onChange={field('parent_name')} placeholder="Parent name" />
            </label>
            <label>Gender
              <select value={form.gender} onChange={field('gender')}>
                <option value="">— Select —</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
              </select>
            </label>
            <div style={{ display: 'flex', gap: 12 }}>
              <label style={{ flex: 1 }}>Date of Birth
                <input type="date" value={form.dob} onChange={field('dob')} />
              </label>
              <label style={{ flex: 1 }}>Date of Registration
                <input type="date" value={form.registered_at} onChange={field('registered_at')} />
              </label>
            </div>
            <label>Parent Email *
              <input type="email" value={form.email} onChange={field('email')} placeholder="parent@email.com" />
            </label>
          </div>

          {/* ── Section 2: Centre ── */}
          <div style={{ borderTop:'1px solid var(--border)', paddingTop:12, marginTop:12 }}>
            <div style={{ font:'600 12px var(--font)', color:'var(--text)', marginBottom:8 }}>
              Enrolment Centre *
            </div>
            {/* Enrolment is always at the logged-in user's own centre (HO included) */}
            <div style={{ padding:'8px 12px', borderRadius:8, background:'var(--purple-bg)',
              border:'1.5px solid var(--purple)', font:'600 12.5px var(--font)', color:'var(--text)',
              display:'flex', alignItems:'center', gap:6 }}>
              <span>{centreList[0]?.tier === 'NLH' ? '🏛️' : '🏢'}</span>
              {centreList[0]?.business_name || 'Your centre'}
              {centreList[0]?.tier ? <span style={{ font:'600 10px var(--mono)', color:'var(--text3)' }}>· {centreList[0].tier}</span> : null}
            </div>
          </div>

          {/* ── Section 3: Course enrolment ── */}
          <div style={{ borderTop:'1px solid var(--border)', paddingTop:12, marginTop:12 }}>
            <div style={{ font:'600 12px var(--font)', color:'var(--text)', marginBottom:4 }}>
              Courses &amp; Levels
              {feeTotal > 0 && (
                <span style={{ float:'right', color:'var(--purple)', fontSize:13 }}>
                  Total: ₹{fmtAmt(feeTotal)}
                </span>
              )}
            </div>
            {feeTotal > 0 && (
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, flexWrap:'wrap',
                background:'var(--bg2, #F7F6F2)', border:'1px solid var(--border)', borderRadius:10, padding:'10px 12px', margin:'8px 0 2px' }}>
                <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                  <span style={{ font:'600 12px var(--font)', color:'var(--text2)' }}>🎟️ Discount coupon</span>
                  <CouponField context="student" amount={feeTotal} franchiseeId={form.franchisee_id || null}
                    applied={coupon} onApply={setCoupon} onClear={function () { setCoupon(null) }} compact />
                </div>
                {couponDiscount > 0 && (
                  <div style={{ textAlign:'right' }}>
                    <div style={{ font:'500 11px var(--font)', color:'var(--text3)', textDecoration:'line-through' }}>₹{fmtAmt(feeTotal)}</div>
                    <div style={{ font:'700 15px var(--font)', color:'var(--green, #1D7A4F)' }}>Payable ₹{fmtAmt(netFee)}</div>
                  </div>
                )}
              </div>
            )}
            {!regFilter ? (
              <p className="hint">Select a centre above to see available courses.</p>
            ) : groups.length === 0 ? (
              <p className="hint" style={{ color:'var(--red)' }}>No courses registered for this centre yet.</p>
            ) : (
              <div style={{ display:'flex', flexDirection:'column', gap:10, marginTop:8 }}>
                {groups.map(group => (
                  <div key={group.name}>
                    <div style={{ font:'600 11px var(--mono)', color:'var(--text3)', textTransform:'uppercase',
                      letterSpacing:'0.5px', marginBottom:4 }}>
                      {group.name}
                    </div>
                    <div className="checkbox-grid">
                      {group.skus.map(sku => {
                        const checked = selectedSkus.some(s => s.id === sku.id)
                        return (
                          <label key={sku.id} className="checkbox-item">
                            <input type="checkbox" checked={checked} onChange={() => toggleSku(sku)} />
                            {sku.level_name}
                            {sku.student_fee ? <span className="hint"> ₹{fmtAmt(sku.student_fee)}</span> : null}
                          </label>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Section 4: Kit Confirmation (+ Batch Assignment for HO) ── */}
          {selectedSkus.length > 0 && (
            <div style={{ borderTop:'1px solid var(--border)', paddingTop:12, marginTop:12 }}>
              <div style={{ font:'600 12px var(--font)', color:'var(--text)', marginBottom:8 }}>
                {admin ? '📋 Batch Assignment' : '🧾 Kit Confirmation'}
                <span style={{ font:'500 10px var(--font)', color:'var(--text3)', marginLeft:8 }}>
                  {admin ? 'Assign each course to a batch (optional — can be done later)' : 'Confirm what was handed over for each course'}
                </span>
              </div>

              {selectedSkus.map(function (sku) {
                const bd  = batchData[sku.id] || { batches: [], eligibleCIs: [], loading: true }
                const sel = batchSel[sku.id] || ''
                const nbf = newBatchForms[sku.id] || { ci: '', name: '', days: [], time: '', is_individual: false }

                function updateNbf(patch) {
                  setNewBatchForms(function (prev) {
                    return { ...prev, [sku.id]: { ...nbf, ...patch } }
                  })
                }

                return (
                  <div key={sku.id} style={{
                    border:'1px solid var(--border)', borderRadius:8,
                    overflow:'hidden', marginBottom:8,
                  }}>
                    {/* SKU header */}
                    <div style={{
                      background:'var(--bg3)', padding:'7px 12px',
                      font:'600 12px var(--font)', color:'var(--text)',
                      display:'flex', alignItems:'center', gap:8,
                    }}>
                      <span>{sku.courses?.group_name || '—'}</span>
                      <span style={{ font:'500 10px var(--mono)', color:'var(--text3)' }}>{sku.level_name}</span>
                    </div>

                    <div style={{ padding:'10px 12px' }}>
                      {/* Kit items — confirm what was actually handed over at
                          admission (previously deducted blindly with no check). */}
                      {(function () {
                        const kits = kitData[sku.id]
                        const ex = kitExcluded[sku.id] || {}
                        if (kits == null) return <div className="hint" style={{ marginBottom:10 }}>Loading kit…</div>
                        if (kits.length === 0) return <div className="hint" style={{ marginBottom:10 }}>No kit defined for this course.</div>
                        return (
                          <div style={{ marginBottom:10 }}>
                            <div style={{ font:'600 9.5px var(--mono)', color:'var(--text3)', textTransform:'uppercase', letterSpacing:'.5px', marginBottom:5 }}>
                              Kit items given <span style={{ textTransform:'none', fontWeight:400 }}>— uncheck any not handed over</span>
                            </div>
                            <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                              {kits.map(function (k) {
                                const on = !ex[k.item_id]
                                return (
                                  <label key={k.item_id} style={{ display:'inline-flex', alignItems:'center', gap:5, padding:'4px 9px', borderRadius:20, cursor:'pointer', font:'500 11px var(--font)', border:'1px solid ' + (on ? 'var(--purple)' : 'var(--border)'), background: on ? 'var(--purple-bg)' : 'var(--bg)', color: on ? 'var(--purple)' : 'var(--text3)', textDecoration: on ? 'none' : 'line-through' }}>
                                    <input type="checkbox" checked={on} onChange={function () { toggleKitItem(sku.id, k.item_id) }} style={{ accentColor:'var(--purple)' }} />
                                    {k.name}{k.quantity > 1 ? ' ×' + k.quantity : ''}
                                  </label>
                                )
                              })}
                            </div>
                          </div>
                        )
                      })()}

                      {/* Batch assignment — HO-only for now; franchisees just
                          enrol the student, then later mark the course
                          complete and send the certificate. */}
                      {admin && (bd.loading ? (
                        <span className="hint">Loading batches…</span>
                      ) : (
                        <>
                          {/* Batch selector dropdown */}
                          <select
                            value={sel}
                            onChange={function (e) { setBatchSel(function (p) { return { ...p, [sku.id]: e.target.value } }) }}
                            style={{ fontSize:12, width:'100%', marginBottom: sel === '__new__' ? 10 : 0 }}
                          >
                            <option value="">— No batch yet (assign later) —</option>
                            {bd.batches.map(function (b) {
                              return (
                                <option key={b.id} value={b.id}>
                                  {b.name}
                                  {b.instructors?.full_name ? ' · ' + b.instructors.full_name : ''}
                                  {b.schedule_days ? ' · ' + b.schedule_days : ''}
                                  {b.schedule_time ? ' ' + b.schedule_time : ''}
                                </option>
                              )
                            })}
                            <option value="__new__">+ Create new batch</option>
                          </select>

                          {/* New batch mini-form */}
                          {sel === '__new__' && (
                            <div style={{ display:'flex', flexDirection:'column', gap:8, marginTop:10 }}>
                              {bd.eligibleCIs.length === 0 ? (
                                <p className="hint" style={{ color:'var(--red)' }}>
                                  ⚠ No active Course Instructors appointed for this level yet.
                                </p>
                              ) : (
                                <label style={{ font:'500 11px var(--font)' }}>
                                  Course Instructor *
                                  <select
                                    value={nbf.ci}
                                    onChange={function (e) { updateNbf({ ci: e.target.value }) }}
                                    style={{ marginTop:4, fontSize:12 }}
                                  >
                                    <option value="">— Select CI —</option>
                                    {bd.eligibleCIs.map(function (ci) {
                                      return <option key={ci.id} value={ci.id}>{ci.full_name}</option>
                                    })}
                                  </select>
                                </label>
                              )}

                              <label style={{ font:'500 11px var(--font)' }}>
                                Batch Name *
                                <input
                                  value={nbf.name}
                                  onChange={function (e) { updateNbf({ name: e.target.value }) }}
                                  placeholder="e.g. Saturday Morning Group"
                                  style={{ marginTop:4, fontSize:12 }}
                                />
                              </label>

                              <div>
                                <div style={{ font:'500 11px var(--font)', marginBottom:5 }}>Schedule Days</div>
                                <div style={{ display:'flex', gap:5, flexWrap:'wrap' }}>
                                  {DAYS.map(function (d) {
                                    const active = nbf.days.includes(d)
                                    return (
                                      <button
                                        key={d} type="button"
                                        onClick={function () {
                                          updateNbf({ days: active ? nbf.days.filter(function (x) { return x !== d }) : [...nbf.days, d] })
                                        }}
                                        style={{
                                          padding:'3px 9px', borderRadius:20, fontSize:11, cursor:'pointer',
                                          border: active ? '1.5px solid var(--purple)' : '1px solid var(--border)',
                                          background: active ? 'var(--purple-bg)' : 'var(--card)',
                                          color: active ? 'var(--purple)' : 'var(--text2)',
                                          fontWeight: active ? 700 : 500,
                                        }}
                                      >{d}</button>
                                    )
                                  })}
                                </div>
                              </div>

                              <div style={{ display:'flex', gap:10, alignItems:'flex-end' }}>
                                <label style={{ font:'500 11px var(--font)', flex:1 }}>
                                  Time
                                  <input
                                    type="time" value={nbf.time}
                                    onChange={function (e) { updateNbf({ time: e.target.value }) }}
                                    style={{ marginTop:4, fontSize:12 }}
                                  />
                                </label>
                                <label style={{ display:'flex', alignItems:'center', gap:5,
                                  font:'500 11px var(--font)', paddingBottom:5 }}>
                                  <input
                                    type="checkbox" checked={nbf.is_individual}
                                    onChange={function (e) { updateNbf({ is_individual: e.target.checked }) }}
                                  />
                                  Individual
                                </label>
                              </div>
                            </div>
                          )}
                        </>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* ── Section 5: Address & extras (collapsible) ── */}
          <div style={{ borderTop:'1px solid var(--border)', paddingTop:10, marginTop:12 }}>
            <button
              type="button"
              onClick={() => setShowAddress(a => !a)}
              style={{ background:'none', border:'none', cursor:'pointer', padding:0,
                font:'500 12px var(--font)', color:'var(--text3)', display:'flex', alignItems:'center', gap:6 }}
            >
              <span style={{ fontSize:10 }}>{showAddress ? '▾' : '▸'}</span>
              {showAddress ? 'Hide' : 'Add'} address &amp; channel
              <span style={{ font:'500 10px var(--mono)', color:'var(--text3)', marginLeft:4 }}>(optional)</span>
            </button>

            {showAddress && (
              <div className="form-grid" style={{ marginTop:10 }}>
                <label>Street / Building Address
                  <input value={form.address} onChange={field('address')} placeholder="Flat/Shop no., building, street" />
                </label>
                <label>Area / Locality
                  <input value={form.area} onChange={field('area')} placeholder="Sadar, Dharampeth…" />
                </label>
                <div style={{ display:'flex', gap:12 }}>
                  <label style={{ flex:1 }}>City
                    <input value={form.city} onChange={field('city')} placeholder="Nagpur" />
                  </label>
                  <label style={{ flex:1 }}>State
                    <input value={form.state} onChange={field('state')} placeholder="Maharashtra" />
                  </label>
                </div>
                <div style={{ display:'flex', gap:12 }}>
                  <label style={{ flex:1 }}>PIN Code
                    <input value={form.pincode} onChange={field('pincode')} placeholder="e.g. 440001" />
                  </label>
                  <label style={{ flex:1 }}>Country
                    <input value={form.country} onChange={field('country')} placeholder="India" />
                  </label>
                </div>
                <label>Enrolment Channel
                  <select
                    value={form.channel}
                    onChange={function (e) {
                      const v = e.target.value
                      setForm(function (f) { return { ...f, channel: v, camp_name: v === 'camp' ? f.camp_name : '' } })
                    }}>
                    <option value="franchise">Franchise Centre</option>
                    <option value="own_centre">NLH Own Centre</option>
                    <option value="international">International / Online</option>
                    <option value="walk-in">Walk-in</option>
                    <option value="referral">Referral</option>
                    <option value="online">Online Campaign</option>
                    <option value="camp">Camp / Event</option>
                    <option value="school">School Tie-up</option>
                    <option value="other">Other</option>
                  </select>
                </label>
                {form.channel === 'camp' && (
                  <label>Camp name
                    <input
                      value={form.camp_name}
                      onChange={field('camp_name')}
                      placeholder="e.g. Summer Camp 2026"
                    />
                    <p className="hint">Appears on the certificate above the course names.</p>
                  </label>
                )}
              </div>
            )}
          </div>

          </>)}

          {selectedSkus.length > 0 && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, padding: '10px 12px', borderRadius: 10, background: 'var(--green-bg, #f0fdf4)', border: '1px solid var(--green, #1D7A4F)', font: '600 12px var(--font)', color: 'var(--green, #1D7A4F)', cursor: 'pointer' }}>
              <input type="checkbox" checked={sendWAEnroll} onChange={function (e) { setSendWAEnroll(e.target.checked) }} />
              💬 Send WhatsApp enrollment confirmation to parent {form.phone ? '(' + form.phone + ')' : '— add a mobile number above'}
            </label>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '14px 22px', borderTop: '1px solid var(--border)', background: '#fff', flexShrink: 0 }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          {(phoneMatches.length === 0 || phoneConfirmed) && (
            <button className="btn-p" onClick={save} disabled={saving}>
              {saving ? 'Adding…' : 'Add Student'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── MarkCertsIssuedModal ───────────────────────────────────────────────────────
// Bulk "these certificates were already handed over" — for completions whose
// certificate went out at the centre (or before sending existed), so they stop
// sitting in Needs attention. Records an issued marker only; nothing is sent.
function MarkCertsIssuedModal({ rows, userEmail, onClose, onDone }) {
  const [cutoff, setCutoff] = useState('')                 // completed on or before
  const [excluded, setExcluded] = useState(function () { return new Set() })
  const [saving, setSaving] = useState(false)

  const shown = rows.filter(function (r) { return !cutoff || r.completedOn <= cutoff })
  const picked = shown.filter(function (r) { return !excluded.has(r.enrId) })

  function toggle(id) {
    setExcluded(function (prev) {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  function setAll(on) {
    setExcluded(on ? new Set() : new Set(shown.map(function (r) { return r.enrId })))
  }

  async function save() {
    if (!picked.length) return
    setSaving(true)
    const patch = { cert_issued_at: new Date().toISOString(), cert_issued_by: userEmail || null, cert_issued_note: 'Marked as issued in bulk (handed over outside the app)' }
    const ids = picked.map(function (r) { return r.enrId })
    for (let i = 0; i < ids.length; i += 100) {
      const { error } = await sb.from('enrollments').update(patch).in('id', ids.slice(i, i + 100))
      if (error) { setSaving(false); showToast('Failed: ' + error.message, 'err'); return }
    }
    setSaving(false)
    showToast(ids.length + ' certificate' + (ids.length > 1 ? 's' : '') + ' marked as issued ✓')
    onDone(ids, patch)
  }

  return (
    <div className="modal-bg" onClick={function (e) { if (e.target === e.currentTarget && !saving) onClose() }}>
      <div className="modal" style={{ maxWidth: 560 }}>
        <ModalHeader flush title="Mark certificates as issued" subtitle="Already handed over outside the app — nothing is sent" onClose={onClose} />
        <div style={{ padding: '4px 20px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p className="hint" style={{ margin: 0 }}>
            These completed courses have no certificate recorded as sent. Tick the ones that were already issued; they'll leave Needs attention. Anything you leave unticked stays pending.
          </p>
          <label style={{ font: '600 12px var(--font)', color: 'var(--text2)' }}>Completed on or before (optional)
            <input type="date" value={cutoff} onChange={function (e) { setCutoff(e.target.value) }} style={{ marginTop: 6, fontSize: 13, width: '100%' }} />
          </label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button type="button" className="btn-s" style={{ fontSize: 11 }} onClick={function () { setAll(true) }}>Select all</button>
            <button type="button" className="btn-s" style={{ fontSize: 11 }} onClick={function () { setAll(false) }}>Select none</button>
            <span className="hint" style={{ marginLeft: 'auto' }}>{picked.length} of {shown.length} selected</span>
          </div>
          <div style={{ maxHeight: 300, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
            {shown.length === 0 && <div className="empty" style={{ padding: 16 }}>No pending certificates in that range.</div>}
            {shown.map(function (r) {
              return (
                <label key={r.enrId} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderBottom: '1px solid var(--border)', cursor: 'pointer', font: '500 12px var(--font)' }}>
                  <input type="checkbox" checked={!excluded.has(r.enrId)} onChange={function () { toggle(r.enrId) }} />
                  <span style={{ flex: 1 }}>
                    <b>{r.studentName}</b>
                    <span style={{ color: 'var(--text3)' }}> · {r.course}</span>
                  </span>
                  <span className="mono" style={{ color: 'var(--text3)', fontSize: 11 }}>{fmtDate(r.completedOn)}</span>
                </label>
              )
            })}
          </div>
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn-p" onClick={save} disabled={saving || picked.length === 0}>
            {saving ? 'Saving…' : 'Mark ' + picked.length + ' as issued'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── StudentsPage ───────────────────────────────────────────────────────────────

// ── Student receipts ───────────────────────────────────────────────────────────
// Fee payments are entered in ONE place — the Receipts tab's "New Receipt"
// screen — and listed in the register beside it (same idea as Orders →
// Receipts). A payment is held against the student, not one course, so a
// single receipt covers however many courses the student owes for: the screen
// shows the course-wise dues and how the amount being entered settles them
// (oldest course first, the same computeCoverage pass the profile uses).

const RECEIPT_MODES = [
  ['cash', 'Cash'], ['upi', 'UPI'], ['bank_transfer', 'Bank Transfer / NEFT'],
  ['cheque', 'Cheque'], ['card', 'Card'], ['online', 'Online Payment'],
]

function enrolmentLabel(en) {
  return (en.skus?.courses?.group_name || 'Course') + (en.skus?.level_name ? ' — ' + en.skus.level_name : '')
}

// Prints a stored student invoice. `settle` (from the Accounts ledger) carries
// how much of it the student's payments have covered; without it the
// invoice's own amount_paid is used.
function printStoredInvoice(student, inv, settle) {
  const total = Number(inv.total) || 0
  const paid = settle ? settle.paid : (Number(inv.amount_paid) || 0)
  printStudentInvoice(student, {
    centre: student.franchisees?.business_name || '',
    date: inv.invoice_date, refVal: inv.invoice_no,
    items: inv.items || [],
    summary: {
      discount: inv.discount || 0, couponCode: inv.coupon_code,
      total: total, paid: paid, balance: Math.max(0, total - paid),
    },
  })
}

async function studentReceiptPng(student, p, list) {
  try {
    const html = printStudentReceipt(student, p, { ...(await studentReceiptCtxFull(student, p, list)), asHtml: true })
    return await captureDocPng(html, p.receipt_no || 'receipt')
  } catch (e) { return null }
}

function StudentReceiptModal({ students, onClose, onRecorded }) {
  const [query,     setQuery]     = useState('')
  const [student,   setStudent]   = useState(null)
  const [payments,  setPayments]  = useState(null)   // this student's ledger; null while loading
  const [form,      setForm]      = useState({ amount: '', mode: 'cash', paid_at: todayIso(), reference: '' })
  const [sendWa,    setSendWa]    = useState(true)
  const [waPhone,   setWaPhone]   = useState('')
  const [saving,    setSaving]    = useState(false)

  const q = query.trim().toLowerCase()
  const matches = !q ? [] : students.filter(function (s) {
    return s.full_name?.toLowerCase().includes(q) || s.parent_name?.toLowerCase().includes(q) || s.phone?.includes(q)
  }).slice(0, 8)

  async function pickStudent(s) {
    setStudent(s)
    setPayments(null)
    setWaPhone(s.phone || '')
    const { data, error } = await sb.from('student_payments')
      .select('id, amount, mode, reference, paid_at, note, receipt_no').eq('student_id', s.id)
    if (error) { showToast('Could not load payments: ' + error.message, 'err'); setStudent(null); return }
    const list = data || []
    setPayments(list)
    const got = list.reduce(function (sum, p) { return sum + (p.amount || 0) }, 0)
    const due = Math.max(0, (Number(s.fee_total) || 0) - got)
    setForm(function (f) { return { ...f, amount: due > 0 ? String(due) : '' } })
  }

  const feeTotal = student ? Number(student.fee_total) || 0 : 0
  const paidSoFar = (payments || []).reduce(function (sum, p) { return sum + (p.amount || 0) }, 0)
  const balance = Math.max(0, feeTotal - paidSoFar)
  const amt = Number(form.amount) || 0
  const enrs = student ? (student.enrollments || []) : []
  const before = student && payments ? computeCoverage(enrs, payments, feeTotal, student.other_charges) : null
  const after = before ? computeCoverage(enrs, payments.concat(amt > 0 ? [{ amount: amt }] : []), feeTotal, student.other_charges) : null
  const tooMuch = feeTotal > 0 && amt > balance

  async function save() {
    if (!student || !payments) return
    if (!amt || amt <= 0) { showToast('Enter a valid amount', 'warn'); return }
    // Every entry ADDS to the ledger, so re-keying a receipt that's already
    // there silently doubles it. A student can never pay more than the fee.
    if (tooMuch) {
      showToast(balance === 0
        ? 'Fees are already fully paid (₹' + fmtAmt(feeTotal) + '). Nothing more to record.'
        : "That's more than the balance. Only ₹" + fmtAmt(balance) + ' is outstanding.', 'warn')
      return
    }
    setSaving(true)
    const paidAt = form.paid_at || todayIso()
    const { data, error } = await sb.from('student_payments').insert({
      student_id:    student.id,
      franchisee_id: student.franchisee_id || null,
      amount:        amt,
      mode:          form.mode || null,
      reference:     form.reference.trim() || null,
      paid_at:       paidAt,
    }).select('id, student_id, franchisee_id, amount, mode, reference, paid_at, note, receipt_no, created_at').single()
    if (error) { setSaving(false); showToast('Failed: ' + error.message, 'err'); return }
    try {
      await mirrorStudentPayment(student.id, {
        amount: amt, paid_on: paidAt, mode: form.mode || null, reference: form.reference.trim() || null,
        note: null, recorded_by: null, receipt_no: data.receipt_no,
      })
    } catch (e) { console.warn('[Phase 3 dual-write] student payment mirror failed:', e.message) }

    // Lock (redeem) the admission coupon on the FIRST payment received.
    if (payments.length === 0) {
      const { data: sd } = await sb.from('students')
        .select('coupon_code, franchisee_id, fee_total, discount_amount').eq('id', student.id).single()
      if (sd && sd.coupon_code) {
        try {
          const r = await sb.rpc('redeem_coupon', {
            p_code: sd.coupon_code, p_context: 'student',
            p_amount: (Number(sd.fee_total) || 0) + (Number(sd.discount_amount) || 0),
            p_franchisee: sd.franchisee_id, p_ref: student.id,
          })
          if (r && r.data && r.data.valid === false) showToast('Payment saved · coupon could not be locked: ' + (r.data.message || 'limit reached'), 'warn')
        } catch (cErr) { console.warn('Coupon lock skipped:', cErr.message) }
      }
    }

    const all = [data].concat(payments)
    const newPaid = paidSoFar + amt
    showToast('Receipt ' + (data.receipt_no || '') + ' — ₹' + fmtAmt(amt) + ' recorded ✓')
    onRecorded(data, { ...student, fee_paid: newPaid, payment_status: deriveStatus(feeTotal, newPaid) })

    if (sendWa && waPhone.trim()) {
      const r = await sendWAStudentReceipt(waPhone.trim(), {
        name: student.parent_name || student.full_name,
        receiptNo: data.receipt_no, amount: fmtAmt(amt), date: fmtDate(data.paid_at),
        balance: Math.max(0, feeTotal - newPaid),
        imageUrl: await studentReceiptPng(student, data, all),
      })
      if (r && r.success) showToast('Receipt ' + (data.receipt_no || '') + ' sent on WhatsApp ✓')
      else showToast('Payment saved · WhatsApp receipt failed' + (r && r.error ? ': ' + r.error : ''), 'warn')
    }
    setSaving(false)
    onClose()
  }

  const cell = { padding: '5px 8px', borderBottom: '1px solid var(--border)', font: '500 12px var(--font)' }
  const num = Object.assign({}, cell, { textAlign: 'right', fontFamily: 'var(--mono)' })

  return (
    <div className="modal-bg" onClick={function (e) { if (e.target === e.currentTarget && !saving) onClose() }}>
      <div className="modal" style={{ maxWidth: 520 }}>
        <ModalHeader flush title="New Receipt"
          subtitle={student ? student.full_name + (balance > 0 ? ' · balance ₹' + fmtAmt(balance) : ' · cleared') : 'Payment received from a student'}
          onClose={onClose} />
        <div style={{ padding: '4px 20px 16px' }}>
          {!student ? (
            <div>
              <label style={{ font: '600 12px var(--font)', color: 'var(--text2)' }}>Student
                <input autoFocus value={query} onChange={function (e) { setQuery(e.target.value) }}
                  placeholder="Search by student, parent or phone…" style={{ marginTop: 6, fontSize: 13, width: '100%' }} />
              </label>
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {q && matches.length === 0 && <p className="hint" style={{ margin: 0 }}>No student matches.</p>}
                {matches.map(function (s) {
                  const due = Math.max(0, (s.fee_total || 0) - (s.fee_paid || 0))
                  return (
                    <button key={s.id} type="button" onMouseDown={function (e) { e.preventDefault(); pickStudent(s) }}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', cursor: 'pointer' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ font: '600 13px var(--font)', color: 'var(--text)' }}>{s.full_name}</div>
                        <div style={{ font: '500 11px var(--font)', color: 'var(--text3)' }}>
                          {[s.parent_name, s.phone, s.franchisees?.business_name].filter(Boolean).join(' · ')}
                        </div>
                      </div>
                      <div style={{ font: '700 12px var(--mono)', color: due > 0 ? 'var(--red)' : 'var(--green)', whiteSpace: 'nowrap' }}>
                        {due > 0 ? '₹' + fmtAmt(due) + ' due' : '✓ Cleared'}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          ) : !payments ? (
            <div className="loading">Loading…</div>
          ) : (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <div style={{ flex: 1, font: '500 11px var(--font)', color: 'var(--text3)' }}>
                  {[student.parent_name, student.phone, student.franchisees?.business_name].filter(Boolean).join(' · ')}
                </div>
                <button className="btn-s" style={{ fontSize: 11 }} onClick={function () { setStudent(null); setPayments(null) }} disabled={saving}>Change student</button>
              </div>

              {/* Course-wise dues, and what this receipt does to them. */}
              <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 10 }}>
                <thead>
                  <tr>
                    <th style={Object.assign({}, cell, { textAlign: 'left', font: '600 10px var(--mono)', color: 'var(--text3)', textTransform: 'uppercase' })}>Course</th>
                    <th style={Object.assign({}, num, { font: '600 10px var(--mono)', color: 'var(--text3)', textTransform: 'uppercase' })}>Fee</th>
                    <th style={Object.assign({}, num, { font: '600 10px var(--mono)', color: 'var(--text3)', textTransform: 'uppercase' })}>Due</th>
                    <th style={Object.assign({}, num, { font: '600 10px var(--mono)', color: 'var(--text3)', textTransform: 'uppercase' })}>This receipt</th>
                  </tr>
                </thead>
                <tbody>
                  {enrs.filter(function (en) { return before.perId[en.id] && (before.perId[en.id].fee > 0 || !before.perId[en.id].dropped) }).map(function (en) {
                    const b = before.perId[en.id], a = after.perId[en.id]
                    const applied = a.paid - b.paid
                    return (
                      <tr key={en.id}>
                        <td style={cell}>{enrolmentLabel(en)}{b.dropped ? <span style={{ color: 'var(--text3)' }}> · discontinued</span> : null}</td>
                        <td style={num}>₹{fmtAmt(b.fee)}</td>
                        <td style={Object.assign({}, num, { color: b.due > 0 ? 'var(--red)' : 'var(--green)' })}>{b.due > 0 ? '₹' + fmtAmt(b.due) : '✓'}</td>
                        <td style={Object.assign({}, num, { color: applied > 0 ? 'var(--green)' : 'var(--text3)', fontWeight: 700 })}>{applied > 0 ? '₹' + fmtAmt(applied) : '—'}</td>
                      </tr>
                    )
                  })}
                  {before.other.fee > 0 && (
                    <tr>
                      <td style={cell}>Other charges</td>
                      <td style={num}>₹{fmtAmt(before.other.fee)}</td>
                      <td style={Object.assign({}, num, { color: before.other.due > 0 ? 'var(--red)' : 'var(--green)' })}>{before.other.due > 0 ? '₹' + fmtAmt(before.other.due) : '✓'}</td>
                      <td style={Object.assign({}, num, { color: after.other.paid - before.other.paid > 0 ? 'var(--green)' : 'var(--text3)', fontWeight: 700 })}>{after.other.paid - before.other.paid > 0 ? '₹' + fmtAmt(after.other.paid - before.other.paid) : '—'}</td>
                    </tr>
                  )}
                  <tr>
                    <td style={Object.assign({}, cell, { fontWeight: 700, borderBottom: 'none' })}>Agreed fee ₹{fmtAmt(feeTotal)} · paid ₹{fmtAmt(paidSoFar)}</td>
                    <td style={Object.assign({}, num, { borderBottom: 'none' })}></td>
                    <td style={Object.assign({}, num, { fontWeight: 700, borderBottom: 'none', color: balance > 0 ? 'var(--red)' : 'var(--green)' })}>{balance > 0 ? '₹' + fmtAmt(balance) : '✓'}</td>
                    <td style={Object.assign({}, num, { fontWeight: 700, borderBottom: 'none' })}>{amt > 0 ? '₹' + fmtAmt(amt) : '—'}</td>
                  </tr>
                </tbody>
              </table>

              {feeTotal > 0 && balance === 0 && (
                <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8, padding: '10px 14px', margin: '0 0 12px', fontSize: 12, color: '#166534' }}>
                  ✓ <b>Fees already fully paid.</b> Don't re-enter a receipt that's already in the register — it would be counted twice.
                </div>
              )}

              <div className="form-grid">
                <label>Amount received (₹) *
                  <input type="number" autoFocus value={form.amount} max={balance > 0 ? balance : undefined}
                    onChange={function (e) { setForm(function (f) { return { ...f, amount: e.target.value } }) }} placeholder="e.g. 1500" />
                </label>
                <label>Date
                  <input type="date" value={form.paid_at} onChange={function (e) { setForm(function (f) { return { ...f, paid_at: e.target.value } }) }} />
                </label>
                <label>Mode
                  <select value={form.mode} onChange={function (e) { setForm(function (f) { return { ...f, mode: e.target.value } }) }}>
                    {RECEIPT_MODES.map(function (m) { return <option key={m[0]} value={m[0]}>{m[1]}</option> })}
                  </select>
                </label>
                <label>Reference (optional)
                  <input value={form.reference} onChange={function (e) { setForm(function (f) { return { ...f, reference: e.target.value } }) }} placeholder="UTR / cheque no. / note" />
                </label>
              </div>
              {amt > 0 && (
                <p className="hint" style={{ marginTop: 8, color: tooMuch ? 'var(--red)' : undefined }}>
                  {tooMuch
                    ? 'More than the balance — only ₹' + fmtAmt(balance) + ' is outstanding.'
                    : 'Balance after this receipt: ' + (balance - amt > 0 ? '₹' + fmtAmt(balance - amt) : 'cleared') + '. Applied to the oldest unpaid course first.'}
                </p>
              )}

              <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 10, background: 'var(--green-bg)', border: '1px solid var(--green, #1D7A4F)' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, font: '600 12px var(--font)', color: 'var(--green, #1D7A4F)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={sendWa} onChange={function (e) { setSendWa(e.target.checked) }} />
                  💬 Send WhatsApp receipt to parent
                </label>
                {sendWa && (
                  <input value={waPhone} onChange={function (e) { setWaPhone(e.target.value) }}
                    placeholder="Parent WhatsApp number" style={{ marginTop: 8, fontSize: 13, width: '100%' }} />
                )}
              </div>
            </div>
          )}
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn-p" onClick={save} disabled={saving || !student || !payments || !amt || tooMuch}>
            {saving ? 'Saving…' : 'Save Receipt'}
          </button>
        </div>
      </div>
    </div>
  )
}

// The register: every student payment the login can see, newest first.
// receipts = student_payments rows (null while loading); students = the
// page's already role-scoped list, used to name each row.
function StudentReceiptsRegister({ receipts, students, search, centreFilter, showCentre, onEdit }) {
  const [waConfirm, setWaConfirm] = useState(null)
  if (!receipts) return <div className="loading">Loading receipts…</div>

  const byId = {}
  students.forEach(function (s) { byId[s.id] = s })
  const q = search.trim().toLowerCase()
  const rows = receipts.filter(function (p) {
    const s = byId[p.student_id]
    if (centreFilter && p.franchisee_id !== centreFilter && (!s || s.franchisee_id !== centreFilter)) return false
    if (!q) return true
    return (p.receipt_no || '').toLowerCase().includes(q) || (p.reference || '').toLowerCase().includes(q)
      || (s && (s.full_name?.toLowerCase().includes(q) || s.parent_name?.toLowerCase().includes(q) || s.phone?.includes(q)))
  })
  const total = rows.reduce(function (sum, p) { return sum + (p.amount || 0) }, 0)

  function ledgerOf(studentId) { return receipts.filter(function (x) { return x.student_id === studentId }) }

  async function sendWa(p, s, phone) {
    const list = ledgerOf(s.id)
    const paid = list.reduce(function (sum, x) { return sum + (x.amount || 0) }, 0)
    const r = await sendWAStudentReceipt(phone, {
      name: s.parent_name || s.full_name, receiptNo: p.receipt_no, amount: fmtAmt(p.amount), date: fmtDate(p.paid_at),
      balance: Math.max(0, (Number(s.fee_total) || 0) - paid),
      imageUrl: await studentReceiptPng(s, p, list),
    })
    if (r && r.success) showToast('Receipt sent on WhatsApp ✓')
    else showToast('Receipt failed' + (r && r.error ? ': ' + r.error : ''), 'err')
  }

  return (
    <div className="card tbl-scroll" style={{ marginBottom: 0 }}>
      {rows.length === 0 ? (
        <div className="empty">{receipts.length === 0 ? 'No receipts yet.' : 'No receipts match.'}</div>
      ) : (
        <table className="big-tbl">
          <thead>
            <tr>
              <th>Receipt No.</th>
              <th>Date</th>
              <th>Student</th>
              {showCentre && <th className="hide-mobile">Centre</th>}
              <th className="hide-mobile">Mode</th>
              <th className="hide-mobile">Reference</th>
              <th style={{ textAlign: 'right' }}>Amount</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(function (p) {
              const s = byId[p.student_id]
              return (
                <tr key={p.id}>
                  <td className="mono" style={{ fontWeight: 600 }}>{p.receipt_no || '—'}</td>
                  <td className="mono">{fmtDate(p.paid_at)}</td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{s ? s.full_name : '—'}</div>
                    {s && s.parent_name && <div style={{ font: '500 11px var(--font)', color: 'var(--text3)' }}>{s.parent_name}</div>}
                  </td>
                  {showCentre && <td className="hide-mobile">{s?.franchisees?.business_name || '—'}</td>}
                  <td className="hide-mobile">{p.mode ? p.mode.replace(/_/g, ' ') : '—'}</td>
                  <td className="mono hide-mobile">{p.reference || p.note || '—'}</td>
                  <td style={{ textAlign: 'right' }}><div className="amt" style={{ color: 'var(--green)' }}>₹{fmtAmt(p.amount)}</div></td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {s && (
                      <>
                        <button className="row-action" onClick={async function () { printStudentReceipt(s, p, await studentReceiptCtxFull(s, p, ledgerOf(s.id))) }}>Print</button>
                        <button className="row-action" onClick={function () { setWaConfirm({ label: 'Send receipt ' + (p.receipt_no || ''), phone: s.phone || '', send: function (phone) { return sendWa(p, s, phone) } }) }}>WhatsApp</button>
                      </>
                    )}
                    {onEdit && <button className="row-action" onClick={function () { onEdit(p) }}>Edit</button>}
                  </td>
                </tr>
              )
            })}
            <tr>
              <td colSpan={showCentre ? 6 : 5} style={{ textAlign: 'right', fontWeight: 700 }}>{rows.length} receipt{rows.length > 1 ? 's' : ''} · total</td>
              <td style={{ textAlign: 'right' }}><div className="amt" style={{ color: 'var(--green)', fontWeight: 700 }}>₹{fmtAmt(total)}</div></td>
              <td></td>
            </tr>
          </tbody>
        </table>
      )}
      {waConfirm && <WhatsAppSendConfirm {...waConfirm} onClose={function () { setWaConfirm(null) }} />}
    </div>
  )
}

// Edit one payment or invoice straight from the Receipts / Invoices registers
// (admins). Same fields and rules as the Edit on the student's own tabs.
function RegisterEditModal({ edit, onClose, onSaved }) {
  const row = edit.row
  const isPay = edit.kind === 'payment'
  const [f, setF] = useState(isPay
    ? { amount: String(row.amount ?? ''), paid_at: (row.paid_at || '').slice(0, 10), mode: row.mode || '', reference: row.reference || '' }
    : { invoice_date: (row.invoice_date || '').slice(0, 10), amount_paid: String(row.amount_paid || 0), status: row.status || 'unpaid', notes: row.notes || '' })
  const [saving, setSaving] = useState(false)
  function set(k) { return function (e) { const v = e.target.value; setF(function (x) { return { ...x, [k]: v } }) } }

  async function save() {
    setSaving(true)
    if (isPay) {
      const amt = Number(f.amount)
      if (!amt || amt <= 0) { setSaving(false); showToast('Enter a valid amount', 'warn'); return }
      const { data, error } = await sb.from('student_payments').update({
        amount: amt, paid_at: f.paid_at || null, mode: f.mode || null, reference: f.reference.trim() || null,
      }).eq('id', row.id).select('id, student_id, franchisee_id, amount, mode, reference, paid_at, note, receipt_no, created_at').single()
      if (error) { setSaving(false); showToast('Update failed: ' + error.message, 'err'); return }
      // Student's paid total / status are kept by the database; re-read them.
      const { data: stu } = await sb.from('students').select('id, fee_paid, payment_status').eq('id', row.student_id).single()
      showToast('Payment updated ✓')
      onSaved(data, stu)
    } else {
      const { data, error } = await sb.from('student_invoices').update({
        invoice_date: f.invoice_date, amount_paid: parseInt(f.amount_paid, 10) || 0, status: f.status, notes: f.notes || null,
      }).eq('id', row.id).select().single()
      if (error) { setSaving(false); showToast('Save failed: ' + error.message, 'err'); return }
      showToast('Invoice updated ✓')
      onSaved(data, null)
    }
    setSaving(false)
  }

  return (
    <div className="modal-bg" onClick={function (e) { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ maxWidth: 440 }}>
        <ModalHeader flush title={isPay ? 'Edit payment' : 'Edit invoice'}
          subtitle={(isPay ? row.receipt_no : row.invoice_no) || ''} onClose={onClose} />
        <div className="form-grid" style={{ padding: '4px 20px 16px' }}>
          {isPay ? (
            <>
              <label>Amount (₹)<input type="number" value={f.amount} onChange={set('amount')} /></label>
              <label>Date<input type="date" value={f.paid_at} onChange={set('paid_at')} /></label>
              <label>Mode
                <select value={f.mode} onChange={set('mode')}>
                  <option value="">— mode —</option>
                  {['cash', 'upi', 'cheque', 'card', 'online'].concat(f.mode && !['cash', 'upi', 'cheque', 'card', 'online'].includes(f.mode) ? [f.mode] : [])
                    .map(function (m) { return <option key={m} value={m}>{m}</option> })}
                </select></label>
              <label>Reference / UTR<input value={f.reference} onChange={set('reference')} /></label>
            </>
          ) : (
            <>
              <label>Invoice date<input type="date" value={f.invoice_date} onChange={set('invoice_date')} /></label>
              <label>Amount paid (₹)<input type="number" value={f.amount_paid} onChange={set('amount_paid')} /></label>
              <label>Status
                <select value={f.status} onChange={set('status')}>
                  {['unpaid', 'part', 'paid'].map(function (x) { return <option key={x} value={x}>{x}</option> })}
                </select></label>
              <label>Notes<input value={f.notes} onChange={set('notes')} /></label>
            </>
          )}
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn-p" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  )
}

// The invoice register: every student invoice the login can see — course
// fees, monthly renewals, next levels — newest first, with how far each is
// settled (payments are held against the student and applied oldest first).
function StudentInvoicesRegister({ invoices, students, search, centreFilter, showCentre, onEdit }) {
  if (!invoices) return <div className="loading">Loading invoices…</div>

  const byId = {}
  students.forEach(function (s) { byId[s.id] = s })
  const perStudent = {}
  invoices.forEach(function (i) { (perStudent[i.student_id] = perStudent[i.student_id] || []).push(i) })
  const settle = {}
  Object.keys(perStudent).forEach(function (sid) {
    const st = byId[sid]
    Object.assign(settle, invoiceSettlement(perStudent[sid], st ? st.fee_total : 0, st ? st.fee_paid : 0))
  })

  function kindOf(inv) {
    const first = (inv.items || []).find(function (x) { return x && x.kind === 'course' }) || {}
    if (first.cycle === 'renewal') return 'Renewal' + (first.period_label ? ' · ' + first.period_label : '')
    if (first.cycle === 'next_level') return 'Next level'
    return 'Course fee'
  }
  function courseOf(inv) {
    return (inv.items || []).filter(function (x) { return x && x.kind === 'course' }).map(function (x) { return x.name }).join(', ') || '—'
  }

  const q = search.trim().toLowerCase()
  const rows = invoices.filter(function (inv) {
    const st = byId[inv.student_id]
    if (centreFilter && inv.franchisee_id !== centreFilter && (!st || st.franchisee_id !== centreFilter)) return false
    if (!q) return true
    return (inv.invoice_no || '').toLowerCase().includes(q) || courseOf(inv).toLowerCase().includes(q)
      || (st && (st.full_name?.toLowerCase().includes(q) || st.parent_name?.toLowerCase().includes(q) || st.phone?.includes(q)))
  })
  const total = rows.reduce(function (sum, i) { return sum + (Number(i.total) || 0) }, 0)
  const due = rows.reduce(function (sum, i) { return sum + ((settle[i.id] || {}).due || 0) }, 0)

  const CHIP = {
    paid:   { t: 'Paid',   c: 'var(--green,#1D7A4F)', b: 'var(--green-bg,#e6f4ec)' },
    part:   { t: 'Part',   c: '#a15c00',              b: '#fff4e0' },
    unpaid: { t: 'Unpaid', c: 'var(--red,#dc2626)',   b: 'var(--red-bg,#fef2f2)' },
  }

  return (
    <div className="card tbl-scroll" style={{ marginBottom: 0 }}>
      {rows.length === 0 ? (
        <div className="empty">{invoices.length === 0 ? 'No invoices yet.' : 'No invoices match.'}</div>
      ) : (
        <table className="big-tbl">
          <thead>
            <tr>
              <th>Invoice No.</th>
              <th>Date</th>
              <th>Student</th>
              {showCentre && <th className="hide-mobile">Centre</th>}
              <th>For</th>
              <th style={{ textAlign: 'right' }}>Amount</th>
              <th>Status</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(function (inv) {
              const st = byId[inv.student_id]
              const sm = settle[inv.id]
              const chip = sm ? CHIP[sm.status] : null
              return (
                <tr key={inv.id}>
                  <td className="mono" style={{ fontWeight: 600 }}>{inv.invoice_no || '—'}</td>
                  <td className="mono">{fmtDate(inv.invoice_date)}</td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{st ? st.full_name : '—'}</div>
                    {st && st.parent_name && <div style={{ font: '500 11px var(--font)', color: 'var(--text3)' }}>{st.parent_name}</div>}
                  </td>
                  {showCentre && <td className="hide-mobile">{st?.franchisees?.business_name || '—'}</td>}
                  <td>
                    <div style={{ fontSize: 12 }}>{courseOf(inv)}</div>
                    <div style={{ font: '500 11px var(--font)', color: 'var(--text3)' }}>{kindOf(inv)}</div>
                  </td>
                  <td style={{ textAlign: 'right' }}><div className="amt">₹{fmtAmt(inv.total)}</div></td>
                  <td>
                    {chip && (
                      <span style={{ font: '700 10px var(--mono)', color: chip.c, background: chip.b, borderRadius: 4, padding: '2px 7px', whiteSpace: 'nowrap' }}>
                        {chip.t}{sm.status === 'part' ? ' · due ₹' + fmtAmt(sm.due) : ''}
                      </span>
                    )}
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {st && <button className="row-action" onClick={function () { printStoredInvoice(st, inv, sm) }}>Print</button>}
                    {onEdit && <button className="row-action" onClick={function () { onEdit(inv) }}>Edit</button>}
                  </td>
                </tr>
              )
            })}
            <tr>
              <td colSpan={showCentre ? 5 : 4} style={{ textAlign: 'right', fontWeight: 700 }}>{rows.length} invoice{rows.length > 1 ? 's' : ''} · total</td>
              <td style={{ textAlign: 'right' }}><div className="amt" style={{ fontWeight: 700 }}>₹{fmtAmt(total)}</div></td>
              <td colSpan={2} style={{ fontWeight: 700, color: due > 0 ? 'var(--red,#dc2626)' : 'var(--green,#1D7A4F)' }}>
                {due > 0 ? '₹' + fmtAmt(due) + ' still due' : '✓ all settled'}
              </td>
            </tr>
          </tbody>
        </table>
      )}
    </div>
  )
}

export default function StudentsPage() {
  const { currentRole, currentFranchiseeId, currentUser, can } = useAuth()
  const admin = isAdminRole(currentRole)

  const [students, setStudents]   = useState([])
  const [loading, setLoading]     = useState(true)
  const [search, setSearch]       = useState('')
  const [centreFilter, setCentreFilter] = useState('')
  const [centreFilterTouched, setCentreFilterTouched] = useState(false)
  const [sortBy, setSortBy] = useState('activity')   // activity | name | joined | balance
  const [showClosed, setShowClosed] = useState(false)
  const [viewTab, setViewTab] = useState('current')   // current | attention | completed | all | receipts
  const [receipts, setReceipts] = useState(null)       // student_payments register; null until loaded
  const [invoiceRows, setInvoiceRows] = useState(null)  // student_invoices register; null until loaded
  const [regEdit, setRegEdit] = useState(null)           // { kind: 'payment'|'invoice', row } — register Edit dialog
  const [showReceipt, setShowReceipt] = useState(false)
  // Same rule as the profile: any admin, or a franchisee for their own tree (RLS-scoped).
  const canRecordFees = admin || ['uf', 'cf', 'smf'].includes(currentRole)
  const [showCertBulk, setShowCertBulk] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [selected, setSelected] = useState(null)
  const [showAdd, setShowAdd] = useState(false)
  const [attMap, setAttMap] = useState({})   // { [enrollment_id]: attended count }
  const [cycleMap, setCycleMap] = useState({})   // { [enrollment_id]: sessions held since its own cycle_started_at }

  // Centre filter dropdown still available to multi-centre roles; the column
  // itself is replaced by a Sessions/Billing summary.
  const showCentreCol = admin || currentRole === 'smf' || currentRole === 'cf'

  useEffect(() => {
    if (currentRole === null) return   // wait for auth to resolve
    async function load() {
      setLoading(true)
      let q = sb.from('students')
        .select('*, franchisees(business_name, city, tier), enrollments(id, sku_id, fee_amount, list_price, waived, sessions_per_week, sessions_per_cycle, cycle_started_at, cycle_days, enrolled_at, completed_at, status, marks_obtained, marks_total, marks_remarks, marks_submitted_at, cert_status, cert_reject_note, cert_emailed_at, cert_wa_sent_at, cert_issued_at, skus(level_name, total_sessions, courses(group_name, billing_type)))')
        // Most recent activity first; final ordering is by last enrolment (below)
        .order('registered_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })

      if (admin) {
        // Admin sees all students — no filter
      } else if (currentRole === 'smf' || currentRole === 'cf') {
        // SMF / CF sees students from self + all sub-franchisees
        if (!currentFranchiseeId) { setLoading(false); return }
        const treeIds = await getTreeIds(currentFranchiseeId)
        q = q.in('franchisee_id', treeIds.length > 0 ? treeIds : [currentFranchiseeId])
      } else {
        // UF sees only own students
        if (!currentFranchiseeId) { setLoading(false); return }
        q = q.eq('franchisee_id', currentFranchiseeId)
      }

      const { data, error } = await q
      if (error) { console.error('Students load error:', error); showToast('Failed to load students: ' + error.message, 'err') }
      setStudents(data || [])
      setLoading(false)

      // Attended-session counts per enrollment (for the Sessions column).
      // Only enrolments still running need a live count — a completed one just
      // shows "done". Paged: PostgREST caps one response at 1000 rows and
      // attendance is well past that, which used to drop the newest rows
      // (current handwriting students showed 0/15 despite 19 attended).
      const enrIds = (data || []).flatMap(function (s) {
        return (s.enrollments || []).filter(function (e) { return !e.completed_at }).map(function (e) { return e.id })
      })
      if (enrIds.length > 0) {
        try {
          const attRows = await fetchAllRows(function (from, to) {
            return sb.from('session_attendance').select('id, enrollment_id')
              .in('enrollment_id', enrIds).eq('attended', true).order('id').range(from, to)
          })
          const m = {}
          attRows.forEach(function (a) { m[a.enrollment_id] = (m[a.enrollment_id] || 0) + 1 })
          setAttMap(m)
        } catch (e) { console.error('Attendance load error:', e); setAttMap({}) }
      } else {
        setAttMap({})
      }

      // Monthly-billing cycle progress for the whole list — same logic as
      // the student detail view: actual class dates held for each
      // enrollment's assigned batch since ITS OWN cycle start (or the
      // enrolment date for ones that predate cycle tracking), not the
      // calendar month. Batched, not one query per row.
      const monthlyEnrIds = (data || []).flatMap(function (s) {
        return (s.enrollments || []).filter(isMonthlyActive).map(function (e) { return e.id })
      })
      if (monthlyEnrIds.length > 0) {
        const { data: bsRows } = await sb.from('batch_students')
          .select('enrollment_id, batch_id, batches(schedule_days)').in('enrollment_id', monthlyEnrIds).is('removed_at', null)
        const batchByEnr = {}, daysByEnr = {}
        ;(bsRows || []).forEach(function (bs) { batchByEnr[bs.enrollment_id] = bs.batch_id; daysByEnr[bs.enrollment_id] = bs.batches?.schedule_days || '' })
        const batchIds = Array.from(new Set(Object.values(batchByEnr)))
        try {
          let sessRows = [], attRows = []
          if (batchIds.length > 0) {
            const anchors = (data || []).flatMap(function (s) { return (s.enrollments || []).filter(isMonthlyActive).map(cycleAnchor) }).filter(Boolean).sort()
            ;[sessRows, attRows] = await Promise.all([
              // No upper date bound: a holiday declared for a later day in the
              // month lowers that cycle's target.
              fetchAllRows(function (from, to) {
                return sb.from('batch_sessions').select('id, batch_id, session_date, is_holiday')
                  .in('batch_id', batchIds).gte('session_date', anchors[0]).order('id').range(from, to)
              }),
              // Present AND absent rows: "absent" and "never marked" are
              // different things and the cycle count treats them differently.
              fetchAllRows(function (from, to) {
                return sb.from('session_attendance').select('id, enrollment_id, session_id, attended')
                  .in('enrollment_id', monthlyEnrIds).order('id').range(from, to)
              }),
            ])
          }
          const attendanceByEnr = {}
          attRows.forEach(function (a) { (attendanceByEnr[a.enrollment_id] = attendanceByEnr[a.enrollment_id] || new Map()).set(a.session_id, !!a.attended) })
          const cm = {}
          ;(data || []).forEach(function (s) {
            (s.enrollments || []).filter(isMonthlyActive).forEach(function (e) {
              const bId = batchByEnr[e.id]
              cm[e.id] = computeCycle(e, sessRows.filter(function (r) { return r.batch_id === bId }), attendanceByEnr[e.id], daysByEnr[e.id])
            })
          })
          setCycleMap(cm)
        } catch (e) { console.error('Cycle progress load error:', e); setCycleMap({}) }
      } else {
        setCycleMap({})
      }
    }
    load()
  }, [admin, currentRole, currentFranchiseeId])

  // Receipts register — every student payment this login can see (RLS scopes
  // it the same way as students). Paged: it passes 1000 rows quickly.
  useEffect(function () {
    if (currentRole === null) return
    let cancelled = false
    fetchAllRows(function (from, to) {
      return sb.from('student_payments')
        .select('id, student_id, franchisee_id, amount, mode, reference, paid_at, note, receipt_no, created_at')
        .order('paid_at', { ascending: false }).order('created_at', { ascending: false }).order('id').range(from, to)
    }).then(function (rows) { if (!cancelled) setReceipts(rows) })
      .catch(function (e) { console.error('Receipts load error:', e); if (!cancelled) setReceipts([]) })
    return function () { cancelled = true }
  }, [currentRole, currentFranchiseeId])

  // Invoices register — same scoping and paging as receipts. Reloaded when the
  // detail view closes, since renewals/new courses raise invoices from there.
  useEffect(function () {
    if (currentRole === null || selected) return
    let cancelled = false
    fetchAllRows(function (from, to) {
      return sb.from('student_invoices')
        .select('id, student_id, franchisee_id, enrollment_id, invoice_no, invoice_date, items, subtotal, discount, coupon_code, total, amount_paid, status, created_at')
        .order('invoice_date', { ascending: false }).order('created_at', { ascending: false }).order('id').range(from, to)
    }).then(function (rows) { if (!cancelled) setInvoiceRows(rows) })
      .catch(function (e) { console.error('Invoices load error:', e); if (!cancelled) setInvoiceRows([]) })
    return function () { cancelled = true }
  }, [currentRole, currentFranchiseeId, selected])

  function handleReceiptRecorded(row, updatedStudent) {
    setReceipts(function (prev) { return [row].concat(prev || []) })
    setStudents(function (ss) { return ss.map(function (s) { return s.id === updatedStudent.id ? { ...s, fee_paid: updatedStudent.fee_paid, payment_status: updatedStudent.payment_status } : s }) })
  }

  // The Centre column itself is only useful when rows can come from more than
  // one centre — once a specific centre is picked in the filter, every row
  // shows the same centre, so the column is pure noise. The filter dropdown
  // stays available regardless (showCentreCol); only the column disappears.
  const centreColVisible = showCentreCol && !centreFilter

  const centreOptions = showCentreCol
    ? [...new Map(
        students.filter(function (s) { return s.franchisees }).map(function (s) {
          return [s.franchisee_id, { id: s.franchisee_id, name: s.franchisees?.business_name, city: s.franchisees?.city, tier: s.franchisees?.tier }]
        })
      ).values()].sort(function (a, b) {
        // Head Office first, then A→Z
        if ((a.tier === 'NLH') !== (b.tier === 'NLH')) return a.tier === 'NLH' ? -1 : 1
        return (a.name || '').localeCompare(b.name || '')
      })
    : []

  // Default the list to the viewer's OWN centre so centres don't mix; they can
  // then filter down their hierarchy (a CF to its city's units, an SMF to its
  // state's centres) or pick "All". HO = the Head Office centre; CF/SMF = self.
  const hoCentreId = (centreOptions.find(function (c) { return c.tier === 'NLH' }) || {}).id
  const ownCentreId = admin ? hoCentreId : currentFranchiseeId
  useEffect(function () {
    if (showCentreCol && !centreFilterTouched && !centreFilter && ownCentreId) setCentreFilter(ownCentreId)
  }, [showCentreCol, ownCentreId, centreFilter, centreFilterTouched])

  // Most-recent activity = latest of registration, creation, and any enrolment.
  // Re-enrolling a student therefore bumps them to the top of the list.
  function lastActivity(s) {
    let t = 0
    function take(v) { if (v) { const x = new Date(v).getTime(); if (x > t) t = x } }
    take(s.registered_at); take(s.created_at)
    ;(s.enrollments || []).forEach(function (e) { take(e.enrolled_at) })
    return t
  }

  // Completed view orders by when they last finished something, newest first.
  function lastCompletion(s) {
    let t = 0
    ;(s.enrollments || []).forEach(function (e) { if (e.completed_at) { const x = new Date(e.completed_at).getTime(); if (x > t) t = x } })
    return t
  }

  const closedCount = students.filter(function (s) { return s.is_active === false }).length

  // Derived per student from their enrolments — no manual flag to maintain.
  // Current = at least one course still running; Completed = none running;
  // Needs attention = any open follow-up (renewal, sessions finished,
  // certificate not yet sent, balance) and is independent of the other two,
  // so a student can be in Completed AND Needs attention until the
  // certificate goes out.
  const lifecycle = {}
  students.forEach(function (s) {
    lifecycle[s.id] = { bucket: studentBucket(s), reasons: attentionReasons(s, attMap) }
  })

  const q0 = search.toLowerCase()
  function inCentreScope(s) {
    return (!centreFilter || s.franchisee_id === centreFilter) && (showClosed || s.is_active !== false || (q0 && (s.full_name?.toLowerCase().includes(q0) || s.parent_name?.toLowerCase().includes(q0) || s.phone?.includes(q0))))
  }
  const tabCounts = { current: 0, attention: 0, completed: 0, all: 0 }
  students.filter(inCentreScope).forEach(function (s) {
    const lc = lifecycle[s.id]
    tabCounts.all++
    if (lc.bucket === 'current') tabCounts.current++
    else tabCounts.completed++
    if (lc.reasons.length > 0) tabCounts.attention++
  })

  // Completed courses with no certificate recorded — what the bulk
  // "mark as issued" option works on (respects the centre filter).
  const pendingCertRows = []
  students.filter(inCentreScope).forEach(function (s) {
    (s.enrollments || []).filter(certPending).forEach(function (e) {
      pendingCertRows.push({
        enrId: e.id, studentName: s.full_name,
        course: (e.skus?.courses?.group_name || 'Course') + (e.skus?.level_name ? ' — ' + e.skus.level_name : ''),
        completedOn: String(e.completed_at).slice(0, 10),
      })
    })
  })
  pendingCertRows.sort(function (a, b) { return a.completedOn < b.completedOn ? 1 : -1 })

  function handleCertsIssued(ids, patch) {
    const idSet = new Set(ids)
    setStudents(function (ss) {
      return ss.map(function (s) {
        return (s.enrollments || []).some(function (e) { return idSet.has(e.id) })
          ? { ...s, enrollments: s.enrollments.map(function (e) { return idSet.has(e.id) ? { ...e, ...patch } : e }) }
          : s
      })
    })
    setShowCertBulk(false)
  }

  const filtered = students.filter(function (s) {
    const q = search.toLowerCase()
    const matchesSearch = !q || s.full_name?.toLowerCase().includes(q) || s.parent_name?.toLowerCase().includes(q) || s.phone?.includes(q)
    const matchesCentre = !centreFilter || s.franchisee_id === centreFilter
    // Closed students are hidden unless explicitly shown, so the roster and its
    // totals reflect who is actually studying. A search match reveals them
    // regardless, so a closed student is never truly lost.
    const matchesActive = showClosed || s.is_active !== false || (q && matchesSearch)
    // Same rule for the view tabs: searching looks across everyone, so a
    // student who has moved to Completed is still one search away.
    const lc = lifecycle[s.id]
    const matchesTab = !!q || viewTab === 'all' || viewTab === 'receipts' || viewTab === 'invoices'
      || (viewTab === 'current' && lc.bucket === 'current')
      || (viewTab === 'completed' && lc.bucket === 'past')
      || (viewTab === 'attention' && lc.reasons.length > 0)
    return matchesSearch && matchesCentre && matchesActive && matchesTab
  }).sort(function (a, b) {
    if (viewTab === 'completed' && sortBy === 'activity') return lastCompletion(b) - lastCompletion(a)
    if (sortBy === 'name')    return (a.full_name || '').localeCompare(b.full_name || '')
    if (sortBy === 'joined')  return new Date(b.registered_at || b.created_at || 0) - new Date(a.registered_at || a.created_at || 0)
    if (sortBy === 'balance') {
      const bal = function (s) { return Math.max(0, (s.fee_total || 0) - (s.fee_paid || 0)) }
      return bal(b) - bal(a)
    }
    return lastActivity(b) - lastActivity(a)   // 'activity' (default)
  })

  function handleSaved(updated) {
    if (updated === null) {
      // Student was deleted — remove from list and close modal
      setStudents(function (ss) { return ss.filter(function (s) { return s.id !== selected?.id }) })
      setSelected(null)
      return
    }
    setStudents(ss => ss.map(s => s.id === updated.id ? { ...s, ...updated } : s))
    setSelected(s => s && s.id === updated.id ? { ...s, ...updated } : s)
  }

  function handleAdded(st) {
    // st already comes fully joined (franchisees + enrollments) from
    // AddStudentModal's own post-save re-fetch — don't clobber that with a
    // hardcoded empty array, or a student added with courses shows "No
    // courses enrolled yet" / "No invoices yet" until the next page reload,
    // even though the enrollment and invoice were created correctly.
    setStudents(ss => [st, ...ss])
    setShowAdd(false)
  }

  async function handleOpenExisting(st) {
    setShowAdd(false)
    // The lookup card carries only a few fields; the profile needs the whole
    // row (fees, waiver, all enrolments). Prefer the already-loaded copy, else
    // fetch it — a closed student from another centre may not be in the list.
    const loaded = students.find(function (s) { return s.id === st.id })
    if (loaded) { setSelected(loaded); return }
    const { data } = await sb.from('students')
      .select('*, franchisees(business_name, city, tier), enrollments(id, sku_id, fee_amount, list_price, waived, sessions_per_week, sessions_per_cycle, cycle_started_at, cycle_days, enrolled_at, completed_at, status, marks_obtained, marks_total, marks_remarks, marks_submitted_at, cert_status, cert_reject_note, cert_emailed_at, cert_wa_sent_at, cert_issued_at, skus(level_name, total_sessions, courses(group_name, billing_type)))')
      .eq('id', st.id).single()
    setSelected(data || st)
  }

  // Tone index per course name (cycle through 8 tones)
  const courseList = [...new Set(students.flatMap(s => (s.enrollments || []).map(e => e.skus?.courses?.group_name).filter(Boolean)))]
  function courseTone(name) {
    const idx = courseList.indexOf(name)
    return (idx % 8) + 1
  }

  function exportCSV() {
    // Use the already-loaded, role-filtered students state
    if (!students.length) { showToast('No students to export.', 'warn'); return }
    setExporting(true)
    try {
      const date = new Date().toISOString().slice(0, 10)
      function esc(v) {
        if (v == null || v === '') return ''
        const s = String(v)
        return (s.includes(',') || s.includes('"') || s.includes('\n')) ? '"' + s.replace(/"/g, '""') + '"' : s
      }
      const headers = ['Student Name','Parent Name','Phone','Email','City','State','Fee Total','Fee Paid','Payment Status','Courses']
      const rows    = students.map(function (r) {
        const courses = (r.enrollments || [])
          .map(function (e) { return e.skus?.courses?.group_name })
          .filter(Boolean)
          .filter(function (c, i, a) { return a.indexOf(c) === i })
          .join('; ')
        return [r.full_name, r.parent_name, r.phone, r.email, r.city, r.state, r.fee_total || 0, r.fee_paid || 0, r.payment_status, courses]
      })
      const csv  = headers.join(',') + '\n' + rows.map(function (r) { return r.map(esc).join(',') }).join('\n')
      const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href = url; a.download = 'nlh-students-' + date + '.csv'
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      URL.revokeObjectURL(url)
      showToast(rows.length + ' students exported ✓')
    } catch (err) {
      showToast('Export failed: ' + err.message, 'err')
    }
    setExporting(false)
  }

  return (
    <div className="pg">
      {/* Topbar */}
      <header className="tb">
        <div className="crumb">Operations <span className="sep">›</span> <b>Students</b></div>
        <div className="tb-r">
          {showCentreCol && centreOptions.length > 1 && (
            <select
              value={centreFilter}
              onChange={function (e) { setCentreFilterTouched(true); setCentreFilter(e.target.value) }}
              style={{ fontSize: 12 }}
              title="Filter students by centre"
            >
              <option value="">🏫 {admin ? 'All centres' : 'All my centres'}</option>
              {centreOptions.map(function (c) {
                return <option key={c.id} value={c.id}>{c.tier === 'NLH' ? '🏛️ ' : '[' + (c.tier || '?') + '] '}{c.name}{c.city ? ' — ' + c.city : ''}</option>
              })}
            </select>
          )}
          <select value={sortBy} onChange={function (e) { setSortBy(e.target.value) }}
            style={{ fontSize: 12 }} title="Sort students by">
            <option value="activity">↕ Recently active</option>
            <option value="joined">Date joined</option>
            <option value="name">Name (A–Z)</option>
            <option value="balance">Balance due</option>
          </select>
          {closedCount > 0 && (
            <button className="btn btn-s" onClick={function () { setShowClosed(function (v) { return !v }) }}
              title={showClosed ? 'Hide closed accounts' : 'Show closed accounts'}
              style={showClosed ? { background: '#fef2f2', borderColor: '#fca5a5', color: '#991b1b' } : null}>
              {showClosed ? '⊘ Hiding' : '⊘ Closed'} ({closedCount})
            </button>
          )}
          <input
            className="search tb-search"
            placeholder="Search students by name or parent…"
            value={search}
            onChange={function (e) { setSearch(e.target.value) }}
          />
          <button className="btn btn-s" onClick={exportCSV} disabled={exporting} title="Export CSV">
            {exporting ? '…' : '↓'}<span className="btn-label">{exporting ? ' Exporting' : ' Export'}</span>
          </button>
          {can('students.edit') && <button className="btn btn-p" onClick={() => setShowAdd(true)}>+ Enrol Student</button>}
        </div>
      </header>

      <div className="content">
        {/* Page header */}
        <div className="ph">
          <div className="ph-l">
            <div className="ph-eyebrow"><span className="dot"></span>Enrollment</div>
            <h1 className="ph-title">Students</h1>
            <div className="ph-sub">
              <b>{tabCounts.current} current</b> · {tabCounts.completed} completed
              {currentRole === 'uf'
                ? ' at your centre.'
                : centreFilter
                  ? ' at this centre.'
                  : showCentreCol ? ' across your territory.' : ' across all centres.'}
            </div>
          </div>
        </div>

        {/* Stats */}
        {(function() {
          // fee_total is already net of any waiver (a waiver reduces it, like a
          // discount), so balance due is simply charged − received.
          const totalCharged  = filtered.reduce(function(s, r) { return s + (Number(r.fee_total) || 0) }, 0)
          const totalReceived = filtered.reduce(function(s, r) { return s + (Number(r.fee_paid)  || 0) }, 0)
          const totalBalance  = Math.max(0, totalCharged - totalReceived)
          return (
            <div className="mini-stats">
              <div className="mini">
                <div className="mini-ic" style={{ background: 'var(--purple-bg)' }}>🎓</div>
                <div className="mini-num">{filtered.length}</div>
                <div className="mini-lbl">{viewTab === 'current' ? 'Current students' : viewTab === 'attention' ? 'Need attention' : viewTab === 'completed' ? 'Completed' : 'All students'}</div>
              </div>
              <div className="mini">
                <div className="mini-ic" style={{ background: 'var(--sun-bg)' }}>💰</div>
                <div className="mini-num" style={{ fontSize: totalCharged >= 100000 ? 18 : undefined }}>₹{fmtAmt(totalCharged)}</div>
                <div className="mini-lbl">Fees charged</div>
              </div>
              <div className="mini">
                <div className="mini-ic" style={{ background: 'var(--green-bg)' }}>✅</div>
                <div className="mini-num" style={{ fontSize: totalReceived >= 100000 ? 18 : undefined }}>₹{fmtAmt(totalReceived)}</div>
                <div className="mini-lbl">Fees received</div>
              </div>
              <div className="mini">
                <div className="mini-ic" style={{ background: totalBalance > 0 ? 'var(--red-bg)' : 'var(--green-bg)' }}>⏳</div>
                <div className="mini-num" style={{ color: totalBalance > 0 ? 'var(--red, #dc2626)' : undefined, fontSize: totalBalance >= 100000 ? 18 : undefined }}>₹{fmtAmt(totalBalance)}</div>
                <div className="mini-lbl">Balance due</div>
              </div>
            </div>
          )
        })()}

        {/* View tabs — Current is the working roster; finished students live
            under Completed (nothing is deleted or moved, it's a filter), and
            Needs attention is a cross-cutting follow-up list. Searching
            ignores the tab so nobody is ever hidden from a search. */}
        {!selected && (
          <div className="tabs" style={{ marginTop: 4 }}>
            {[
              { id: 'current',   label: 'Current' },
              { id: 'attention', label: 'Needs attention' },
              { id: 'completed', label: 'Completed' },
              { id: 'all',       label: 'All' },
              { id: 'invoices',  label: '📄 Invoices' },
              { id: 'receipts',  label: '🧾 Receipts' },
            ].map(function (t) {
              return (
                <button key={t.id} className={'tab' + (viewTab === t.id ? ' active' : '')} onClick={function () { setViewTab(t.id) }}>
                  {t.label} <span style={{ font: '600 11px var(--mono)', color: t.id === 'attention' && tabCounts.attention > 0 ? '#B45309' : 'var(--text3)', marginLeft: 3 }}>{t.id === 'receipts' ? (receipts ? receipts.length : '') : t.id === 'invoices' ? (invoiceRows ? invoiceRows.length : '') : tabCounts[t.id]}</span>
                </button>
              )
            })}
            {search.trim() && viewTab !== 'all' && viewTab !== 'receipts' && viewTab !== 'invoices' && (
              <span style={{ alignSelf: 'center', marginLeft: 8, font: '500 11px var(--font)', color: 'var(--text3)' }}>Searching across all students</span>
            )}
            {can('students.edit') && pendingCertRows.length > 0 && (viewTab === 'attention' || viewTab === 'completed') && (
              <button className="btn-s" style={{ marginLeft: 'auto', alignSelf: 'center', fontSize: 12 }}
                title="Certificates that were already handed over outside the app"
                onClick={function () { setShowCertBulk(true) }}>
                🎓 Mark certificates issued ({pendingCertRows.length})
              </button>
            )}
            {canRecordFees && viewTab === 'receipts' && (
              <button className="btn btn-p" style={{ marginLeft: 'auto', alignSelf: 'center', fontSize: 12 }}
                onClick={function () { setShowReceipt(true) }}>
                + New Receipt
              </button>
            )}
          </div>
        )}

        {regEdit && (
          <RegisterEditModal
            edit={regEdit}
            onClose={function () { setRegEdit(null) }}
            onSaved={function (row, stu) {
              if (regEdit.kind === 'payment') {
                setReceipts(function (prev) { return (prev || []).map(function (x) { return x.id === row.id ? { ...x, ...row } : x }) })
                if (stu) setStudents(function (ss) { return ss.map(function (x) { return x.id === stu.id ? { ...x, fee_paid: stu.fee_paid, payment_status: stu.payment_status } : x }) })
              } else {
                setInvoiceRows(function (prev) { return (prev || []).map(function (x) { return x.id === row.id ? { ...x, ...row } : x }) })
              }
              setRegEdit(null)
            }}
          />
        )}

        {/* Inline student detail (opens in the main window, below the stats) */}
        {selected ? (
          <div style={{ marginTop: 4 }}>
            <button className="btn" style={{ marginBottom: 12, fontSize: 13 }}
              onClick={function () { setSelected(null) }}>← Back to students</button>
            <StudentDetailModal
              inline
              student={selected}
              onClose={function () { setSelected(null) }}
              onSaved={handleSaved}
            />
          </div>
        ) : loading ? (
          <div className="loading">Loading students…</div>
        ) : viewTab === 'invoices' ? (
          <StudentInvoicesRegister invoices={invoiceRows} students={students} search={search} centreFilter={centreFilter} showCentre={centreColVisible} onEdit={admin ? function (row) { setRegEdit({ kind: 'invoice', row: row }) } : null} />
        ) : viewTab === 'receipts' ? (
          <StudentReceiptsRegister receipts={receipts} students={students} search={search} centreFilter={centreFilter} showCentre={centreColVisible} onEdit={admin ? function (row) { setRegEdit({ kind: 'payment', row: row }) } : null} />
        ) : (
          <div className="card tbl-scroll" style={{ marginBottom: 0 }}>
            <table className="big-tbl stu-tbl">
              <thead>
                <tr>
                  <th>Student</th>
                  {centreColVisible && <th className="hide-mobile">Centre</th>}
                  <th className="hide-mobile">Parent</th>
                  <th>Courses</th>
                  <th className="hide-mobile" style={{ textAlign: 'right' }}>Fee Total</th>
                  <th className="hide-mobile" style={{ textAlign: 'right' }}>Fee Paid</th>
                  <th className="hide-mobile" style={{ textAlign: 'right' }}>Balance</th>
                  <th>Learning</th>
                  <th className="hide-mobile" style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr><td colSpan={centreColVisible ? 9 : 8} className="empty">
                    {viewTab === 'current' ? 'No current students.' : viewTab === 'attention' ? 'Nothing needs attention.' : viewTab === 'completed' ? 'No completed students.' : 'No students found'}
                  </td></tr>
                )}
                {filtered.map(function (s) {
                  // Waivers already reduced fee_total, so this is the true owed.
                  const balance = Math.max(0, (s.fee_total || 0) - (s.fee_paid || 0))
                  return (
                    <tr key={s.id} style={{ cursor: 'pointer' }} onClick={function () { setSelected(s) }}>
                      <td>
                        <div className="placer-cell">
                          <div className="placer-av" style={{ background: 'var(--purple)' }}>
                            {(s.full_name || '').split(' ').map(function (w) { return w[0] }).join('').slice(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <div className="placer-name">{s.full_name}</div>
                            {(s.registered_at || s.created_at) && (
                              <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 1 }}>
                                Joined {new Date(s.registered_at || s.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      {centreColVisible && (
                        <td className="hide-mobile">
                          {s.franchisees ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, font: '600 11px var(--font)', color: s.franchisees.tier === 'NLH' ? 'var(--purple)' : 'var(--text2)' }}>
                              <span>{s.franchisees.tier === 'NLH' ? '🏛️' : '🏢'}</span>
                              <span>{s.franchisees.business_name}{s.franchisees.tier && s.franchisees.tier !== 'NLH' ? ' · ' + s.franchisees.tier : ''}</span>
                            </span>
                          ) : <span style={{ color: 'var(--text3)' }}>—</span>}
                        </td>
                      )}
                      <td className="hide-mobile" style={{ color: 'var(--text2)' }}>
                        <div>{s.parent_name || '—'}</div>
                        {s.phone && <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 1 }}>{s.phone}</div>}
                      </td>
                      <td style={{ fontSize: 11 }}>
                        {(function () {
                          const ens = s.enrollments || []
                          if (ens.length === 0) return <span style={{ color: 'var(--text3)' }}>None</span>
                          // Running courses by default; the Completed/All views
                          // show history. A student with nothing running (found
                          // via search or Needs attention) shows their history
                          // rather than an empty cell.
                          const showHistory = viewTab === 'completed' || viewTab === 'all'
                          let visible = showHistory ? ens : ens.filter(function (e) { return enrolmentBucket(e) === 'active' })
                          if (visible.length === 0) visible = ens
                          const hidden = ens.length - visible.length
                          return (
                            <>
                              {visible.map(function (e) {
                                const group = e.skus?.courses?.group_name || 'Course'
                                const cn = group + (e.skus?.level_name ? ' — ' + e.skus.level_name : '')
                                const bt  = e.skus?.courses?.billing_type
                                const tot = e.skus?.total_sessions || 0
                                const att = attMap[e.id] || 0
                                const done = !e.completed_at && tot > 0 && att >= tot
                                const bucket = enrolmentBucket(e)
                                let txt, color, bg, extra = null
                                if (bucket === 'completed') {
                                  txt = '✓ done ' + shortDay(String(e.completed_at).slice(0, 10)); color = 'var(--green)'; bg = 'var(--green-bg)'
                                  extra = certPending(e)
                                    ? { t: 'cert pending', color: '#B45309', bg: '#FEF3C7' }
                                    : { t: (e.cert_wa_sent_at || e.cert_emailed_at) ? '🎓 sent' : '🎓 issued', color: 'var(--text3)', bg: 'var(--bg2)' }
                                }
                                else if (bucket === 'dropped') { txt = '⊘ dropped'; color = '#991b1b'; bg = '#fef2f2' }
                                else if (bt === 'monthly') {
                                  // Monthly: classes done / this cycle's class-day target
                                  // (Saturday revision only makes up absences), renewing
                                  // on the same date next month — and the date is shown,
                                  // not just implied by a chip that appears.
                                  const cyc = cycleMap[e.id] || computeCycle(e, [], null, '')
                                  const held = cyc ? cyc.done : 0
                                  const target = cyc ? cyc.target : 0
                                  const ri = renewalInfo(e)
                                  if (ri && ri.state === 'overdue') { txt = 'Overdue ' + (-ri.daysLeft) + 'd · due ' + shortDay(ri.due); color = '#991b1b'; bg = '#fef2f2' }
                                  else if (ri && ri.state === 'soon') { txt = held + '/' + target + ' · renew ' + shortDay(ri.due); color = '#B45309'; bg = '#FEF3C7' }
                                  else if (ri) { txt = held + '/' + target + ' · renews ' + shortDay(ri.due); color = 'var(--text2)'; bg = 'var(--bg2)' }
                                  else { txt = held + '/' + target; color = 'var(--text2)'; bg = 'var(--bg2)' }
                                  // Attendance never recorded for some classes — point at it
                                  // rather than quietly counting them as absences.
                                  if (cyc && cyc.unmarked > 0) extra = { t: cyc.unmarked + ' not marked', color: '#B45309', bg: '#FEF3C7' }
                                }
                                else if (tot > 0) { txt = att + '/' + tot; color = done ? '#B45309' : 'var(--text2)'; bg = done ? '#FEF3C7' : 'var(--bg2)' }
                                else { txt = att + ' sess'; color = 'var(--text2)'; bg = 'var(--bg2)' }
                                return (
                                  <span key={e.id} className={'stu-chip stu-chip-' + courseTone(group)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                                    <span>{cn}</span>
                                    <span style={{ color: color, background: bg, borderRadius: 10, padding: '0 6px', fontWeight: 600 }}>{txt}</span>
                                    {extra && <span style={{ color: extra.color, background: extra.bg, borderRadius: 10, padding: '0 6px', fontWeight: 600 }}>{extra.t}</span>}
                                  </span>
                                )
                              })}
                              {hidden > 0 && (
                                <span title="Open the student to see completed courses" style={{ color: 'var(--text3)', alignSelf: 'center', marginLeft: 4 }}>+{hidden} completed</span>
                              )}
                            </>
                          )
                        })()}
                      </td>
                      <td className="hide-mobile" style={{ textAlign: 'right' }}><div className="amt">₹{fmtAmt(s.fee_total)}</div></td>
                      <td className="hide-mobile" style={{ textAlign: 'right' }}><div className="amt" style={{ color: 'var(--green)' }}>₹{fmtAmt(s.fee_paid)}</div></td>
                      <td className="hide-mobile" style={{ textAlign: 'right' }}>
                        <div className="amt" style={{ color: balance > 0 ? 'var(--red)' : 'var(--green)' }}>₹{fmtAmt(balance)}</div>
                        <div style={{ marginTop: 4 }}><StatusBadge status={s.payment_status} /></div>
                      </td>
                      <td>
                        {(function () {
                          const lc = lifecycle[s.id]
                          const tone = {
                            red:   { color: '#991b1b', bg: '#fef2f2' },
                            amber: { color: '#B45309', bg: '#FEF3C7' },
                            green: { color: 'var(--green)', bg: 'var(--green-bg)' },
                            grey:  { color: 'var(--text2)', bg: 'var(--bg2)' },
                          }
                          const pills = lc.reasons.length > 0
                            ? lc.reasons.map(function (r) {
                                return { key: r.key, tone: r.tone, label: r.key === 'renew_soon' ? 'Renews ' + shortDay(r.date) : r.label }
                              })
                            : [lc.bucket === 'current'
                                ? { key: 'active', tone: 'green', label: 'Active' }
                                : (s.enrollments || []).some(function (e) { return enrolmentBucket(e) === 'completed' })
                                  ? { key: 'completed', tone: 'grey', label: 'Completed' }
                                  : { key: 'dropped', tone: 'red', label: 'Discontinued' }]
                          return (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-start' }}>
                              {pills.map(function (p) {
                                return <span key={p.key} title={p.label} style={{ font: '600 10px var(--font)', color: tone[p.tone].color, background: tone[p.tone].bg, borderRadius: 10, padding: '2px 8px', maxWidth: 150 }}>{p.label}</span>
                              })}
                            </div>
                          )
                        })()}
                      </td>
                      <td className="hide-mobile" style={{ textAlign: 'right' }}>
                        <button className="row-action" onClick={function (e) { e.stopPropagation(); setSelected(s) }}>View</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showReceipt && (
        <StudentReceiptModal
          students={students}
          onClose={function () { setShowReceipt(false) }}
          onRecorded={handleReceiptRecorded}
        />
      )}

      {showCertBulk && (
        <MarkCertsIssuedModal
          rows={pendingCertRows}
          userEmail={currentUser && currentUser.email}
          onClose={function () { setShowCertBulk(false) }}
          onDone={handleCertsIssued}
        />
      )}

      {showAdd && (
        <AddStudentModal
          onClose={() => setShowAdd(false)}
          onSaved={handleAdded}
          onOpenExisting={handleOpenExisting}
        />
      )}
    </div>
  )
}

