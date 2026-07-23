import React, { useState, useEffect } from 'react'
import { sb } from '../supabase'
import { useAuth } from '../context/AuthContext'
import { fmtAmt, fmtDate, showToast } from '../utils'
import { isAdminRole } from '../constants/roles'
import { getTreeIds } from '../utils/hierarchy'
import { sendWelcomeEmail } from '../services/email'
import { sendWAStudentEnrolled, sendWAReviewRequest, sendWAStudentReceipt, sendWAFeeReminder } from '../services/whatsapp'
import CouponField from '../components/CouponField'
import { printStudentInvoice, printStudentReceipt } from '../components/studentDocs'
import { captureDocPng } from '../utils/captureReceipt'
import ModalHeader from '../components/ModalHeader'
import StudentCertModal from '../components/StudentCertModal'

// ── helpers ────────────────────────────────────────────────────────────────────

// Days remaining in the current calendar month (today = the last day → 0)
function daysLeftInMonth() {
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

function StatusBadge({ status }) {
  const s = (status || '').toLowerCase()
  const map = { active: 'ba', inactive: 'bd', pending: 'bp' }
  return <span className={`badge ${map[s] || 'br'}`}>{status || '—'}</span>
}

function genTempPass() {
  return 'NLH@' + Math.random().toString(36).slice(2, 8).toUpperCase()
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// ── StudentDetailModal ─────────────────────────────────────────────────────────

export function StudentDetailModal({ student, onClose, onSaved, inline }) {
  const { currentRole, currentFranchiseeId, currentUser } = useAuth()
  const admin = isAdminRole(currentRole)
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
  const [sessionCounts,   setSessionCounts]   = useState({})   // { [enrollment_id]: attended count }
  const [kitIssued,       setKitIssued]       = useState({})   // { [enrollment_id]: true } — kit issued + stock deducted
  const [certWaStatus,    setCertWaStatus]    = useState({})   // { [enrollment_id]: 'sent'|'delivered'|'read'|'failed' }
  const [remindSending,   setRemindSending]   = useState(false)
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
  const [assignJoinDate,  setAssignJoinDate]  = useState(new Date().toISOString().slice(0, 10))
  const [completingEnr,   setCompletingEnr]   = useState(null)  // enrollment pending completion-date entry
  const [completeDate,    setCompleteDate]    = useState(new Date().toISOString().slice(0, 10))
  const [reviewingEn,     setReviewingEn]     = useState(null)  // enrollment pending review-send
  const [reviewPhone,     setReviewPhone]     = useState('')
  const [reviewSending,   setReviewSending]   = useState(false)
  const [changingEn,      setChangingEn]      = useState(null)  // enrollment whose level is being changed
  const [changeSkuId,     setChangeSkuId]     = useState('')
  const [changeSaving,    setChangeSaving]    = useState(false)
  // Fee payment ledger
  const [payments,        setPayments]        = useState([])
  const [showPayModal,    setShowPayModal]    = useState(false)
  const [payForm,         setPayForm]         = useState({ amount: '', mode: 'cash', paid_at: new Date().toISOString().slice(0, 10), reference: '' })
  const [paySaving,       setPaySaving]       = useState(false)
  const [sendReceipt,     setSendReceipt]     = useState(true)
  const [receiptPhone,    setReceiptPhone]    = useState(student.phone || '')
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

  // ── Delete state ──
  const [deleting, setDeleting] = useState(false)
  const [closing,  setClosing]  = useState(false)

  // A waiver is a permanent credit, not a payment — so it settles fees like
  // money without inflating "paid". This is what lets a re-joined student's
  // balance reflect only the new course, with the written-off past staying gone.
  const waivedCredit  = Number(form.waived_amount) || 0
  const effectivePaid = (Number(form.fee_paid) || 0) + waivedCredit
  const balance = Math.max(0, (Number(form.fee_total) || 0) - effectivePaid)

  function field(k) {
    return function (e) { setForm(function (f) { return { ...f, [k]: e.target.value } }) }
  }

  // deriveStatus is defined at module level — shared with AddStudentModal
  const derivedStatus = deriveStatus(form.fee_total, effectivePaid)

  async function save() {
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
      phone:          form.phone.trim(),
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

  async function recordPayment() {
    const amt = Number(payForm.amount)
    if (!amt || amt <= 0) { showToast('Enter a valid amount', 'warn'); return }
    // Every entry ADDS to the ledger, so re-keying a receipt that's already
    // there silently doubles it. A student can never pay more than the fee.
    const feeTotal   = Number(form.fee_total) || 0
    const alreadyGot = payments.reduce(function (s, p) { return s + (p.amount || 0) }, 0)
    const feeBalance = Math.max(0, feeTotal - alreadyGot)
    if (feeTotal > 0 && alreadyGot + amt > feeTotal) {
      showToast(
        feeBalance === 0
          ? `Fees are already fully paid (₹${fmtAmt(feeTotal)}). Nothing more to record.`
          : `That's more than the balance. Only ₹${fmtAmt(feeBalance)} is outstanding.`,
        'warn'
      )
      return
    }
    setPaySaving(true)
    const { data, error } = await sb.from('student_payments').insert({
      student_id:    student.id,
      franchisee_id: student.franchisee_id || null,
      amount:        amt,
      mode:          payForm.mode || null,
      reference:     payForm.reference.trim() || null,
      paid_at:       payForm.paid_at || new Date().toISOString().slice(0, 10),
    }).select('id, amount, mode, reference, paid_at, note, receipt_no').single()
    setPaySaving(false)
    if (error) { showToast('Failed: ' + error.message, 'err'); return }
    const next = [data, ...payments]
    setPayments(next)
    applyPaid(next)
    setShowPayModal(false)
    setPayForm({ amount: '', mode: 'cash', paid_at: new Date().toISOString().slice(0, 10), reference: '' })
    showToast('Payment of ₹' + fmtAmt(amt) + ' recorded ✓')

    // ── Lock (redeem) the admission coupon on the FIRST payment received ──
    if (payments.length === 0) {
      const { data: sd } = await sb.from('students')
        .select('coupon_code, franchisee_id, fee_total, discount_amount').eq('id', student.id).single()
      if (sd && sd.coupon_code) {
        const base = (Number(sd.fee_total) || 0) + (Number(sd.discount_amount) || 0)   // gross fee the coupon applied to
        try {
          const r = await sb.rpc('redeem_coupon', {
            p_code: sd.coupon_code, p_context: 'student', p_amount: base,
            p_franchisee: sd.franchisee_id, p_ref: student.id,
          })
          if (r && r.data && r.data.valid === false) {
            showToast('Payment saved · coupon could not be locked: ' + (r.data.message || 'limit reached'), 'warn')
          }
        } catch (cErr) { console.warn('Coupon lock skipped:', cErr.message) }
      }
    }

    // WhatsApp receipt to the parent
    if (sendReceipt && receiptPhone) {
      const newPaid = next.reduce(function (s, p) { return s + (p.amount || 0) }, 0)
      const newBalance = Math.max(0, (Number(form.fee_total) || 0) - newPaid)
      const r = await sendWAStudentReceipt(receiptPhone, {
        name: student.parent_name || student.full_name,
        receiptNo: data.receipt_no,
        amount: fmtAmt(amt),
        date: fmtDate(data.paid_at),
        balance: newBalance,
        imageUrl: await receiptPng(data, next),
      })
      if (r && r.success) showToast('Receipt ' + (data.receipt_no || '') + ' sent on WhatsApp ✓')
      else showToast('Payment saved · WhatsApp receipt failed' + (r && r.error ? ': ' + r.error : ''), 'warn')
    }
  }

  // ── Resend a receipt for a past payment ──
  async function resendReceipt(p) {
    const phone = receiptPhone || student.phone
    if (!phone) { showToast('No parent phone on file', 'warn'); return }
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

  // ── Course-wise fee coverage ───────────────────────────────────────────────
  // Payments are recorded against the STUDENT, not a course, so there is no
  // recorded answer to "which course did this money pay for". We apply the
  // total received to courses oldest-first — a settlement order, not an
  // allocation of specific receipts — so staff can see what is still owed
  // course by course. Keyed by enrolment id.
  const feeCoverage = React.useMemo(function () {
    const paidTotal = payments.reduce(function (s, p) { return s + (p.amount || 0) }, 0)
    const courseSum = localEnrollments.reduce(function (s, e) { return s + (Number(e.fee_amount) || 0) }, 0)
    // Courses are priced at catalogue rate; whatever the student was agreed
    // below that is a discount, and it settles courses just as money does.
    // Without it a fully-paid student on a discounted package would show dues.
    const other     = Number(form.other_charges) || 0
    const discount  = Math.max(0, courseSum + other - (Number(form.fee_total) || 0))
    // A waiver settles courses exactly as money does, so a closed student's
    // course cards read Paid/settled rather than still showing dues.
    const waived    = Number(form.waived_amount) || 0

    const ordered = localEnrollments.slice().sort(function (a, b) {
      const ad = a.enrolled_at || a.created_at || ''
      const bd = b.enrolled_at || b.created_at || ''
      if (ad !== bd) return ad < bd ? -1 : 1     // oldest first
      return String(a.id) < String(b.id) ? -1 : 1
    })
    let left = paidTotal + discount + waived
    const out = {}
    ordered.forEach(function (en) {
      const fee     = Number(en.fee_amount) || 0
      const list    = Number(en.list_price) || 0
      const covered = Math.min(left, fee)
      left -= covered
      out[en.id] = {
        fee: fee, paid: covered, due: Math.max(0, fee - covered),
        list: list,
        // What this course was actually discounted by, from two stored figures
        off: Math.max(0, list - fee),
      }
    })
    // Other charges settle last, after every course — they are the least
    // urgent thing to chase and this keeps course dues the headline figure.
    out.__discount = discount
    out.__other    = { fee: other, paid: Math.min(left, other), due: Math.max(0, other - Math.min(left, other)) }
    return out
  }, [localEnrollments, payments, form.fee_total, form.other_charges, form.waived_amount])

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

  // ── WhatsApp balance reminder to the parent ──
  async function sendFeeReminderWA() {
    const phone = receiptPhone || student.phone
    if (!phone) { showToast('No parent phone on file', 'warn'); return }
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
  function handlePrintInvoice(inv) {
    printStudentInvoice(student, {
      centre: student.franchisees?.business_name || '',
      date: inv.invoice_date, refVal: inv.invoice_no,
      items: inv.items || [],
      summary: {
        discount: inv.discount || 0, couponCode: inv.coupon_code,
        total: inv.total || 0, paid: inv.amount_paid || 0,
        balance: Math.max(0, (inv.total || 0) - (inv.amount_paid || 0)),
      },
    })
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
  function receiptCtx(p, list) {
    const total = Number(form.fee_total) || 0
    const paidToDate = (list || payments)
      .filter(function (x) { return (x.paid_at || '') <= (p.paid_at || '') })
      .reduce(function (s, x) { return s + (x.amount || 0) }, 0)
    return {
      centre: student.franchisees?.business_name || '',
      summary: { total: total, paid: paidToDate, balance: Math.max(0, total - paidToDate) },
    }
  }

  function handlePrintReceipt(p) {
    printStudentReceipt(student, p, receiptCtx(p))
  }

  // PNG of the receipt for the WhatsApp image header. Best-effort: on failure
  // the send falls back to the text template rather than not going at all.
  async function receiptPng(p, list) {
    try {
      const html = printStudentReceipt(student, p, { ...receiptCtx(p, list), asHtml: true })
      return await captureDocPng(html, p.receipt_no || 'receipt')
    } catch (e) { return null }
  }

  async function deletePayment(id) {
    const { error } = await sb.from('student_payments').delete().eq('id', id)
    if (error) { showToast('Delete failed: ' + error.message, 'err'); return }
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

      // Which enrollments have had their kit issued (HO stock deducted)
      const { data: kitLedger } = await sb.from('stock_ledger')
        .select('ref_id').eq('ref_type', 'enrollment').in('ref_id', enrIds)
      const ki = {}
      ;(kitLedger || []).forEach(function (r) { ki[r.ref_id] = true })
      setKitIssued(ki)

      // Certificate WhatsApp status — read straight off the enrollment (kept in
      // sync by the webhook) so franchisees see it without whatsapp_messages access
      const { data: certRows } = await sb.from('enrollments')
        .select('id, cert_wa_status').in('id', enrIds).not('cert_wa_message_id', 'is', null)
      const cs = {}
      ;(certRows || []).forEach(function (r) { cs[r.id] = r.cert_wa_status || 'sent' })
      setCertWaStatus(cs)

      // Attended-session count per enrollment (for the "X / Y sessions" badge)
      const { data: attRows } = await sb.from('session_attendance')
        .select('enrollment_id')
        .in('enrollment_id', enrIds)
        .eq('attended', true)
      const counts = {}
      ;(attRows || []).forEach(function (a) {
        counts[a.enrollment_id] = (counts[a.enrollment_id] || 0) + 1
      })
      setSessionCounts(counts)

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
      sb.from('skus').select('id, level_name, student_fee, course_id, courses(group_name)').order('sort_order'),
    ])
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
    // Default the joining-date field to the current batch's date (if assigned), else the registration date
    const curBs = batchAssignments[enrollment.id]
    const curDate = curBs && curBs.assigned_at ? String(curBs.assigned_at).slice(0, 10) : null
    setAssignJoinDate(curDate || student.registered_at || new Date().toISOString().slice(0, 10))
    setPanelData({ batches: [], loading: true })

    // Get the course_id for this enrollment's SKU
    const { data: skuRow } = await sb.from('skus').select('course_id').eq('id', enrollment.sku_id).single()

    // Get all SKU IDs for that course so we can find batches at any level
    const { data: courseSkus } = skuRow?.course_id
      ? await sb.from('skus').select('id').eq('course_id', skuRow.course_id)
      : { data: [] }
    const courseSkuIds = (courseSkus || []).map(function (s) { return s.id })

    // Fetch all active batches for this course (any level)
    const { data: batches } = courseSkuIds.length
      ? await sb.from('batches')
          .select('id, name, sku_id, schedule_days, schedule_time, is_individual, sessions_done, instructor_id, instructors(id, full_name)')
          .in('sku_id', courseSkuIds)
          .eq('is_active', true)
          .order('schedule_time')
      : { data: [] }

    setPanelData({ batches: batches || [], loading: false })
  }

  // ── Assign student to an existing batch ──
  async function assignToBatch(batchId, enrollmentId) {
    setPanelSaving(true)
    const assignedAt = assignJoinDate + 'T00:00:00+00:00'
    const selectFields = 'id, enrollment_id, assigned_at, batch_id, batches(id, name, schedule_days, schedule_time, instructor_id, instructors(full_name))'

    // Remove from any existing (different) batch first
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

  // ── Update only the joining date of the current batch (no batch change) ──
  async function updateJoinDate(enrollmentId) {
    const existing = batchAssignments[enrollmentId]
    if (!existing) { showToast('Assign a batch first to set a joining date', 'warn'); return }
    setPanelSaving(true)
    const assignedAt = assignJoinDate + 'T00:00:00+00:00'
    const selectFields = 'id, enrollment_id, assigned_at, batch_id, batches(id, name, schedule_days, schedule_time, instructor_id, instructors(full_name))'
    const { data, error } = await sb.from('batch_students')
      .update({ assigned_at: assignedAt }).eq('id', existing.id).select(selectFields).single()
    setPanelSaving(false)
    if (error) { showToast('Failed: ' + error.message, 'err'); return }
    setBatchAssignments(function (prev) { return { ...prev, [enrollmentId]: data } })
    setBatchPanelEnrId(null)
    showToast('Joining date updated ✓')
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
    var { error } = await sb.from('enrollments')
      .update({ completed_at, status: 'completed' })
      .eq('id', en.id)
    if (error) { showToast('Failed: ' + error.message, 'err'); return }
    setLocalEnrollments(function (prev) {
      return prev.map(function (e) {
        return e.id === en.id ? { ...e, completed_at, status: 'completed' } : e
      })
    })
    setCompletingEnr(null)
    showToast('Marked as completed on ' + fmtDate(dateStr) + ' ✓')
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
    setLocalEnrollments(function (prev) {
      return prev.map(function (e) {
        if (e.id !== changingEn.id) return e
        return {
          ...e,
          sku_id: newSkuId,
          skus: target
            ? { level_name: target.level_name, courses: target.courses || e.skus?.courses }
            : e.skus,
        }
      })
    })
    setChangingEn(null)
    showToast('Course / level updated ✓')
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
      .select('*, enrollments(id, sku_id, fee_amount, list_price, enrolled_at, completed_at, status, cert_emailed_at, cert_wa_sent_at, skus(level_name, courses(group_name)))')
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
    // Coupon is applied to the fee but NOT locked yet — it redeems only when the
    // first fee payment is received (see recordPayment).
    setForm(function (f) { return { ...f, fee_total: newTotal } })
    showToast('Discount applied — ₹' + fmtAmt(disc) + ' off')
  }

  // ── Load batches eligible for a SKU (for the Add-Course batch picker) ──
  async function loadAddBatchData(skuId) {
    if (addBatchData[skuId]) return
    setAddBatchData(function (prev) { return { ...prev, [skuId]: { batches: [], eligibleCIs: [], loading: true } } })
    const { data: ciRows } = await sb.from('instructor_courses')
      .select('instructor_id, instructors(id, full_name, status)')
      .eq('sku_id', skuId).eq('status', 'active')
    const eligibleCIs = (ciRows || [])
      .map(function (r) { return r.instructors })
      .filter(function (i) { return i && i.status === 'active' })
      .filter(function (i, idx, arr) { return arr.findIndex(function (x) { return x.id === i.id }) === idx })
    const eligibleCIIds = eligibleCIs.map(function (ci) { return ci.id })
    const { data: batches } = eligibleCIIds.length
      ? await sb.from('batches')
          .select('id, name, schedule_days, schedule_time, is_individual, instructor_id, instructors(id, full_name)')
          .in('instructor_id', eligibleCIIds).eq('is_active', true).order('created_at')
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
    const rows = selectedNewSkus.map(function (sku) { return {
      student_id:    student.id,
      sku_id:        sku.id,
      franchisee_id: student.franchisee_id,
      enrolled_at:   enrolledAt,
    } })
    const { data, error } = await sb.from('enrollments').insert(rows)
      .select('id, sku_id, fee_amount, list_price, enrolled_at, completed_at, status, cert_emailed_at, cert_wa_sent_at, skus(level_name, courses(group_name))')
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
    const rejoining   = form.is_active === false
    const effPaid     = (Number(form.fee_paid) || 0) + (Number(form.waived_amount) || 0)
    if (addedFee > 0 || rejoining) {
      const patch = { fee_total: newFeeTotal, payment_status: deriveStatus(newFeeTotal, effPaid) }
      if (rejoining) { patch.is_active = true; patch.closed_at = null; patch.close_reason = null }
      await sb.from('students').update(patch).eq('id', student.id)
      setForm(function (f) { return { ...f, fee_total: newFeeTotal, ...(rejoining ? { is_active: true } : {}) } })
      if (rejoining) { onSaved({ ...student, is_active: true, fee_total: newFeeTotal }); showToast('Welcome back — account reactivated for the new course') }
    }
    // Coupon applied to the added fee but not locked here — it redeems when the
    // first fee payment is received (see recordPayment).

    // 3b) Raise ONE invoice for this enrolment (courses w/ edited fees + selected kit items)
    const invLines = []
    selectedNewSkus.forEach(function (sku) {
      const enr = added.find(function (e) { return e.sku_id === sku.id })
      const cname = (sku.courses?.group_name ? sku.courses.group_name + ' — ' : '') + sku.level_name
      invLines.push({ kind: 'course', sku_id: sku.id, enrollment_id: enr?.id || null, name: cname, qty: 1, rate: feeFor(sku), amount: feeFor(sku) })
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
      .select('*, enrollments(id, sku_id, fee_amount, list_price, enrolled_at, completed_at, status, cert_emailed_at, cert_wa_sent_at, skus(level_name, courses(group_name)))')
      .eq('id', student.id).single()
    if (updated) onSaved(updated)
  }

  // ── Delete student (admin only) ──
  // Close a student who left mid-course: discontinue any unfinished courses (no
  // certificate), waive the outstanding balance (recorded, never a payment) and
  // deactivate them. Reversible — nothing is deleted.
  async function closeStudentAccount() {
    const bal = Math.max(0, (Number(form.fee_total) || 0) - (Number(form.fee_paid) || 0))
    const msg = 'Close ' + student.full_name + "'s account?\n\n" +
      '• Unfinished courses will be marked Discontinued (no certificate)\n' +
      (bal > 0 ? '• The outstanding ₹' + fmtAmt(bal) + ' will be WAIVED (written off, not collected)\n' : '') +
      '• The student will be moved to Inactive\n\nThis can be reopened later.'
    if (!window.confirm(msg)) return
    const reason = window.prompt('Reason for closing (optional) — e.g. discontinued, relocated:', '')
    if (reason === null) return   // cancelled the second dialog

    setClosing(true)
    const openEnr = localEnrollments.filter(function (e) { return !e.completed_at })
    if (openEnr.length > 0) {
      await sb.from('enrollments').update({ status: 'dropped' })
        .in('id', openEnr.map(function (e) { return e.id }))
    }
    const { error } = await sb.from('students').update({
      is_active:      false,
      payment_status: bal > 0 ? 'waived' : form.payment_status,
      waived_amount:  bal,
      closed_at:      new Date().toISOString(),
      close_reason:   reason.trim() || null,
    }).eq('id', student.id)
    setClosing(false)
    if (error) { showToast('Could not close the account: ' + error.message, 'err'); return }

    setLocalEnrollments(function (prev) {
      return prev.map(function (e) { return e.completed_at ? e : { ...e, status: 'dropped' } })
    })
    setForm(function (f) { return { ...f, is_active: false, waived_amount: bal,
      payment_status: bal > 0 ? 'waived' : f.payment_status } })
    showToast(bal > 0
      ? 'Account closed · ₹' + fmtAmt(bal) + ' waived'
      : 'Account closed')
    onSaved({ ...student, is_active: false, payment_status: bal > 0 ? 'waived' : student.payment_status, closed_at: new Date().toISOString() })
  }

  async function reopenStudentAccount() {
    if (!window.confirm('Reopen ' + student.full_name + "'s account? They return to Active. Waived fees become due again, and discontinued courses become active.")) return
    setClosing(true)
    const discEnr = localEnrollments.filter(function (e) { return e.status === 'dropped' })
    if (discEnr.length > 0) {
      await sb.from('enrollments').update({ status: 'active' })
        .in('id', discEnr.map(function (e) { return e.id }))
    }
    const restored = deriveStatus(Number(form.fee_total) || 0, Number(form.fee_paid) || 0)
    const { error } = await sb.from('students').update({
      is_active: true, payment_status: restored, waived_amount: 0,
      closed_at: null, close_reason: null,
    }).eq('id', student.id)
    setClosing(false)
    if (error) { showToast('Could not reopen: ' + error.message, 'err'); return }
    setLocalEnrollments(function (prev) {
      return prev.map(function (e) { return e.status === 'dropped' ? { ...e, status: 'active' } : e })
    })
    setForm(function (f) { return { ...f, is_active: true, waived_amount: 0, payment_status: restored } })
    showToast('Account reopened')
    onSaved({ ...student, is_active: true, payment_status: restored, closed_at: null })
  }

  async function deleteStudent() {
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
          {['profile', 'courses'].map(function (t) {
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
                {t === 'profile' ? '👤 Profile' : '📚 Courses & Batches'}
              </button>
            )
          })}
        </div>

        {/* ── PROFILE TAB ── */}
        {tab === 'profile' && (
          <div>
            <div className="form-grid">
              <label>Student Name *
                <input value={form.full_name} onChange={field('full_name')} disabled={!canEdit} />
              </label>
              <label>Parent / Guardian
                <input value={form.parent_name} onChange={field('parent_name')} disabled={!canEdit} />
              </label>
              <label>Gender
                <select value={form.gender} onChange={field('gender')} disabled={!canEdit}>
                  <option value="">— Select —</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                </select>
              </label>
              <label>Date of Birth
                <input type="date" value={form.dob} onChange={field('dob')} disabled={!canEdit} />
              </label>
              <label>Date of Registration
                <input type="date" value={form.registered_at} onChange={field('registered_at')} disabled={!canEdit} />
              </label>
              <label>Phone
                <input value={form.phone} onChange={field('phone')} disabled={!canEdit} />
              </label>
              <label>Parent Email
                <input type="email" value={form.email} onChange={field('email')} disabled={!canEdit} placeholder="parent@email.com" />
              </label>
              <label>PIN Code
                <input value={form.pincode} onChange={field('pincode')} disabled={!canEdit} placeholder="e.g. 440001" />
              </label>
              <label>City
                <input value={form.city} onChange={field('city')} disabled={!canEdit} placeholder="Nagpur" />
              </label>
              <label>Area / Locality
                <input value={form.area} onChange={field('area')} disabled={!canEdit} placeholder="Neighbourhood / Area" />
              </label>
              <label>State
                <input value={form.state} onChange={field('state')} disabled={!canEdit} placeholder="Maharashtra" />
              </label>
              <label>Country
                <input value={form.country} onChange={field('country')} disabled={!canEdit} placeholder="India" />
              </label>
              <label className="col-span-2">Street / Building Address
                <input value={form.address} onChange={field('address')} disabled={!canEdit} placeholder="Flat/Shop no., building, street" />
              </label>
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
                      onClick={sendFeeReminderWA} disabled={remindSending}
                      title="Send a WhatsApp balance reminder to the parent">
                      {remindSending ? '…' : '⏰ Remind'}
                    </button>
                  )}
                  {canManageFees && (
                    <button className="btn-p" style={{ fontSize: 12, padding: '5px 12px' }}
                      onClick={function () {
                        setPayForm({ amount: '', mode: 'cash', paid_at: new Date().toISOString().slice(0, 10), reference: '' })
                        setShowPayModal(true)
                      }}>
                      + Record Payment
                    </button>
                  )}
                </div>
              </div>
              <div className="form-grid" style={{ marginTop: 8 }}>
                <label>Agreed Fee (₹)
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input type="number" value={form.fee_total} onChange={field('fee_total')} disabled={!canManageFees}
                      placeholder="Type agreed amount" style={{ flex: 1 }} title="The total fee agreed with the parent — edit freely" />
                    {canManageFees && (
                      <button className="btn-s" style={{ fontSize: 12, whiteSpace: 'nowrap' }} onClick={saveFeeOnly} title="Save the fee amount">Save</button>
                    )}
                  </div>
                </label>
                <label>Fee Paid (₹)
                  <input value={'₹' + fmtAmt(form.fee_paid || 0)} disabled
                    style={{ color: 'var(--green)' }} title="Sum of recorded payments — record a payment to change this" />
                </label>
                <label>Balance
                  <input
                    value={balance > 0 ? '₹' + fmtAmt(balance) : '✓ Cleared'}
                    disabled
                    style={{ color: balance > 0 ? 'var(--red)' : 'var(--green)' }}
                  />
                </label>
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
                  <p className="hint" style={{ margin: 0 }}>No payments recorded yet.</p>
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
                              onClick={function () { resendReceipt(p) }}>
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
            </div>
          </div>
        )}

        {/* ── COURSES & BATCHES TAB ── */}
        {tab === 'courses' && (
          <div style={{ padding: '16px 0' }}>
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
              const pkg = feeCoverage.__discount || 0
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
                  const sessionsDone = !isCompleted && totalSess > 0 && attended >= totalSess
                  // Monthly course nearing month-end → collect next month's fee if continuing
                  const monthEnding  = !isCompleted && billingType === 'monthly' && daysLeftInMonth() <= 5

                  return (
                    <div key={en.id} style={{
                      border: '1px solid ' + (isCompleted ? 'var(--green)' : 'var(--border)'),
                      borderRadius: 10, overflow: 'hidden',
                      background: isCompleted ? 'var(--green-bg)' : 'var(--card)',
                    }}>
                      {/* Enrollment header row */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px' }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ font: '600 13px var(--font)', color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 6 }}>
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
                            <span style={{ font: '600 10px var(--mono)', color: sessionsDone ? '#B45309' : 'var(--purple)', background: sessionsDone ? '#FEF3C7' : 'var(--purple-bg)', borderRadius: 20, padding: '1px 8px', whiteSpace: 'nowrap' }}>
                              {attended}{totalSess > 0 ? ' / ' + totalSess : ''} sessions
                            </span>
                            {kitIssued[en.id] && (
                              <span title="Kit issued — HO stock deducted"
                                style={{ font: '600 10px var(--font)', color: '#0E7490', background: '#CFFAFE', border: '1px solid #67E8F9', borderRadius: 20, padding: '1px 8px', whiteSpace: 'nowrap' }}>
                                🧰 Kit issued
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
                            {monthEnding && (
                              <span title="Monthly course — month ending, collect next month's fee if continuing"
                                style={{ font: '600 10px var(--font)', color: '#1D4ED8', background: '#DBEAFE', border: '1px solid #93C5FD', borderRadius: 20, padding: '1px 8px', whiteSpace: 'nowrap' }}>
                                📅 Renew — month ending
                              </span>
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
                                    {cov.due > 0 ? (
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

                        {/* Complete / WhatsApp / Certificate buttons */}
                        {canEdit && !isCompleted && (
                          <button className="btn-s"
                            style={{ fontSize: 11, padding: '3px 10px', flexShrink: 0 }}
                            onClick={function () {
                              setCompleteDate(new Date().toISOString().slice(0, 10))
                              setCompletingEnr(en)
                            }}>
                            ✓ Complete
                          </button>
                        )}
                        {isCompleted && (
                          <button className="btn-s"
                            style={{ fontSize: 11, padding: '3px 10px', flexShrink: 0, background: '#25D366', borderColor: '#25D366', color: '#fff' }}
                            onClick={function () { openReview(en) }}
                            title="Send Google Review request on WhatsApp">
                            💬 Review
                          </button>
                        )}
                        <button
                          className="btn-s"
                          style={{ fontSize: 11, padding: '3px 10px', flexShrink: 0 }}
                          onClick={async function () {
                            let centre = centreCache
                            if (!centre && student.franchisee_id) {
                              const { data } = await sb.from('franchisees')
                                .select('id,business_name,city,area,country,tier')
                                .eq('id', student.franchisee_id).single()
                              centre = data || null
                              setCentreCache(centre)
                            }
                            setCertModal({ enrollments: localEnrollments, centre })
                          }}
                        >
                          {en.cert_emailed_at ? '🎓 Re-issue' : '🎓 Cert'}
                        </button>

                        {/* Assign batch toggle */}
                        {canEdit && (
                          <button
                            className={isOpen ? 'btn' : 'btn-s'}
                            style={{ fontSize: 11, padding: '4px 12px', flexShrink: 0 }}
                            onClick={function () { openBatchPanel(en) }}
                          >
                            {isOpen ? 'Close' : bs ? '✏️ Batch' : '+ Batch'}
                          </button>
                        )}

                        {/* Remove from batch */}
                        {canEdit && bs && !isOpen && (
                          <button
                            className="btn-s"
                            style={{ fontSize: 11, padding: '4px 8px', flexShrink: 0, color: 'var(--red)' }}
                            onClick={function () { removeFromBatch(en.id) }}
                            title="Remove from batch"
                          >✕ Batch</button>
                        )}

                        {/* Change course / level */}
                        {canEdit && (
                          <button
                            className="btn-s"
                            style={{ fontSize: 11, padding: '4px 8px', flexShrink: 0 }}
                            onClick={function () { openChangeLevel(en) }}
                            title="Change course / level"
                          >⇄ Level</button>
                        )}

                        {/* Remove enrollment entirely */}
                        {admin && (
                          <button
                            className="btn-s"
                            style={{ fontSize: 11, padding: '4px 8px', flexShrink: 0, color: 'var(--red)', borderColor: 'var(--red)' }}
                            onClick={function () {
                              if (window.confirm('Remove ' + courseName + ' ' + levelName + ' enrollment for ' + student.full_name + '?')) {
                                removeEnrollment(en)
                              }
                            }}
                            title="Remove course enrollment"
                          >🗑</button>
                        )}
                      </div>

                      {/* Batch assignment panel */}
                      {isOpen && (
                        <div style={{ borderTop: '1px solid var(--border)', background: 'var(--bg)', padding: 16 }}>
                          {panelData.loading ? (
                            <div className="hint">Loading batches…</div>
                          ) : (
                            <>
                              {/* Joining date */}
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                                <span style={{ font: '600 11px var(--font)', color: 'var(--text2)', whiteSpace: 'nowrap' }}>Joining date:</span>
                                <input type="date" value={assignJoinDate}
                                  onChange={function (e) { setAssignJoinDate(e.target.value) }}
                                  style={{ fontSize: 12, padding: '4px 8px' }} />
                              </div>
                              {/* Existing batches */}
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
                                            </div>
                                          </div>
                                          {!isCurrent ? (
                                            <button
                                              className="btn-s"
                                              style={{ fontSize: 11, padding: '3px 12px', flexShrink: 0 }}
                                              disabled={panelSaving}
                                              onClick={function () { assignToBatch(b.id, en.id) }}
                                            >
                                              Assign
                                            </button>
                                          ) : (
                                            <button
                                              className="btn-s"
                                              style={{ fontSize: 11, padding: '3px 12px', flexShrink: 0 }}
                                              disabled={panelSaving}
                                              onClick={function () { updateJoinDate(en.id) }}
                                              title="Save the joining date above for this batch"
                                            >
                                              📅 Save date
                                            </button>
                                          )}
                                        </div>
                                      )
                                    })}
                                  </div>
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
                {(feeCoverage.__other?.fee > 0 || otherEdit) && (
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
                          ₹{fmtAmt(feeCoverage.__other.fee)}
                        </span>
                        {feeCoverage.__other.due > 0 ? (
                          <span style={{ font: '600 11px var(--font)', color: '#92400e', background: '#fffbeb', border: '1px solid #fbbf24', borderRadius: 20, padding: '1px 8px' }}>
                            ₹{fmtAmt(feeCoverage.__other.due)} due
                          </span>
                        ) : (
                          <span style={{ font: '600 11px var(--font)', color: 'var(--green)', background: 'var(--green-bg)', border: '1px solid var(--green)', borderRadius: 20, padding: '1px 8px' }}>
                            ✓ Paid
                          </span>
                        )}
                        {canManageFees && (
                          <button className="btn-s" style={{ fontSize: 10, padding: '1px 7px' }}
                            onClick={function () { setOtherEdit(true); setOtherVal(String(feeCoverage.__other.fee)) }}>✎</button>
                        )}
                      </>
                    )}
                  </div>
                )}
                {canManageFees && !(feeCoverage.__other?.fee > 0) && !otherEdit && (
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

                              {/* Batch assignment per new course */}
                              <div style={{ borderTop: '1px solid var(--border)', marginTop: 12, paddingTop: 12 }}>
                                <div style={{ font: '600 12px var(--font)', color: 'var(--text)', marginBottom: 8 }}>
                                  📋 Assign to batch <span style={{ font: '500 10px var(--font)', color: 'var(--text3)' }}>(optional — can be done later)</span>
                                </div>
                                {selectedNewSkus.map(function (sku) {
                                  const bd  = addBatchData[sku.id] || { batches: [], eligibleCIs: [], loading: true }
                                  const sel = addBatchSel[sku.id] || ''
                                  const nbf = addNewBatch[sku.id] || { ci: '', name: '', days: [], time: '', is_individual: false }
                                  function updateNbf(patch) { setAddNewBatch(function (prev) { return { ...prev, [sku.id]: { ...nbf, ...patch } } }) }
                                  return (
                                    <div key={sku.id} style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', marginBottom: 8 }}>
                                      <div style={{ background: 'var(--bg3)', padding: '7px 12px', font: '600 12px var(--font)', color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <span>{sku.courses?.group_name || '—'}</span>
                                        <span style={{ font: '500 10px var(--mono)', color: 'var(--text3)' }}>{sku.level_name}</span>
                                      </div>
                                      <div style={{ padding: '10px 12px' }}>
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
                                      </div>
                                    </div>
                                  )
                                })}
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
                  The student stays on sessions up to this date and drops off any sessions after it.
                </p>
              </div>
              <div className="modal-actions">
                <button className="btn" onClick={function () { setCompletingEnr(null) }}>Cancel</button>
                <button className="btn-p"
                  disabled={!completeDate}
                  onClick={function () { markCourseComplete(completingEnr, completeDate) }}>
                  Mark Complete
                </button>
              </div>
            </div>
          </div>
        )}

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

        {/* Record payment modal */}
        {showPayModal && (
          <div className="modal-bg" onClick={function (e) { if (e.target === e.currentTarget) setShowPayModal(false) }}>
            <div className="modal" style={{ maxWidth: 420 }}>
              <ModalHeader flush title="Record Payment"
                subtitle={'Balance due: ' + (balance > 0 ? '₹' + fmtAmt(balance) : 'Cleared')}
                onClose={function () { setShowPayModal(false) }} />
              <div style={{ padding: '4px 20px 16px' }}>
                {/* The amount only ever ADDS to the ledger — warn before it doubles */}
                {(Number(form.fee_total) || 0) > 0 && balance === 0 && (
                  <div style={{ background:'#f0fdf4', border:'1px solid #86efac', borderRadius:8,
                    padding:'10px 14px', margin:'8px 0 12px', fontSize:12, color:'#166534' }}>
                    ✓ <b>Fees already fully paid.</b> Don't re-enter a receipt that's already
                    listed below — it would be counted twice.
                  </div>
                )}
                <div className="form-grid">
                  <label>Amount received (₹) *
                    <input type="number" autoFocus value={payForm.amount}
                      max={balance > 0 ? balance : undefined}
                      onChange={function (e) { setPayForm(function (f) { return { ...f, amount: e.target.value } }) }}
                      placeholder="e.g. 1500" />
                  </label>
                  <label>Date
                    <input type="date" value={payForm.paid_at}
                      onChange={function (e) { setPayForm(function (f) { return { ...f, paid_at: e.target.value } }) }} />
                  </label>
                  <label>Mode
                    <select value={payForm.mode}
                      onChange={function (e) { setPayForm(function (f) { return { ...f, mode: e.target.value } }) }}>
                      <option value="cash">Cash</option>
                      <option value="upi">UPI</option>
                      <option value="bank_transfer">Bank Transfer / NEFT</option>
                      <option value="cheque">Cheque</option>
                      <option value="card">Card</option>
                      <option value="online">Online Payment</option>
                    </select>
                  </label>
                  <label>Reference (optional)
                    <input value={payForm.reference}
                      onChange={function (e) { setPayForm(function (f) { return { ...f, reference: e.target.value } }) }}
                      placeholder="UTR / cheque no. / note" />
                  </label>
                </div>
                {payForm.amount && Number(payForm.amount) > 0 && (
                  <p className="hint" style={{ marginTop: 8 }}>
                    New paid: ₹{fmtAmt((Number(form.fee_paid) || 0) + Number(payForm.amount))}
                    {' '}of ₹{fmtAmt(form.fee_total || 0)}
                    {' · '}Balance ₹{fmtAmt(Math.max(0, (Number(form.fee_total) || 0) - ((Number(form.fee_paid) || 0) + Number(payForm.amount))))}
                  </p>
                )}

                {/* WhatsApp receipt to parent */}
                <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 10, background: 'var(--green-bg)', border: '1px solid var(--green, #1D7A4F)' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, font: '600 12px var(--font)', color: 'var(--green, #1D7A4F)', cursor: 'pointer' }}>
                    <input type="checkbox" checked={sendReceipt} onChange={function (e) { setSendReceipt(e.target.checked) }} />
                    💬 Send WhatsApp receipt to parent
                  </label>
                  {sendReceipt && (
                    <input value={receiptPhone} onChange={function (e) { setReceiptPhone(e.target.value) }}
                      placeholder="Parent WhatsApp number"
                      style={{ marginTop: 8, fontSize: 13, width: '100%' }} />
                  )}
                </div>
              </div>
              <div className="modal-actions">
                <button className="btn" onClick={function () { setShowPayModal(false) }} disabled={paySaving}>Cancel</button>
                <button className="btn-p" onClick={recordPayment} disabled={paySaving || !payForm.amount}>
                  {paySaving ? 'Saving…' : 'Record Payment'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Footer actions */}
        <div className="modal-actions">
          {admin && (
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

// Tiers that can operate as student-enrolment centres
const CENTRE_TIERS = ['UF', 'CF', 'SMF', 'NLH']

// Derive the SKU filter for a given franchisee record.
// Returns:
//   null            — no centre selected; show nothing
//   'all'           — unrestricted centre (NLH HO, CF/SMF with no explicit list)
//   { skuIds }      — filter to specific SKU IDs
//   { courseIds }   — filter to specific course IDs
function deriveFilter(fr) {
  if (!fr) return null
  const skus    = fr.registered_skus    || []
  const courses = fr.registered_courses || []
  if (skus.length > 0)    return { skuIds: skus }
  if (courses.length > 0) return { courseIds: courses }
  // UF with nothing registered = no courses approved yet; NLH / CF / SMF = unrestricted
  if (fr.tier === 'UF') return { skuIds: [] }
  return 'all'
}

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
      const { data } = await sb.from('students')
        .select('id, full_name, parent_name, franchisee_id, franchisees(business_name, city), enrollments(id, sku_id, skus(level_name, courses(group_name)))')
        .eq('phone', form.phone.trim())
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
    if (!fid) { setRegFilter(null); return }
    const fr = centreList.find(function (c) { return c.id === fid })
    setRegFilter(deriveFilter(fr))
  }

  async function loadBatchData(skuId) {
    if (batchData[skuId]) return   // already loaded or loading
    setBatchData(function (prev) { return { ...prev, [skuId]: { batches: [], eligibleCIs: [], loading: true } } })
    // Get CIs certified for this SKU
    const { data: ciRows } = await sb.from('instructor_courses')
      .select('instructor_id, instructors(id, full_name, status)')
      .eq('sku_id', skuId).eq('status', 'active')
    const eligibleCIs = (ciRows || [])
      .map(function (r) { return r.instructors })
      .filter(function (i) { return i && i.status === 'active' })
      .filter(function (i, idx, arr) { return arr.findIndex(function (x) { return x.id === i.id }) === idx })
    const eligibleCIIds = eligibleCIs.map(function (ci) { return ci.id })
    // Batches whose instructor is certified for this SKU
    const { data: batches } = eligibleCIIds.length
      ? await sb.from('batches')
          .select('id, name, schedule_days, schedule_time, is_individual, instructor_id, instructors(id, full_name)')
          .in('instructor_id', eligibleCIIds).eq('is_active', true).order('created_at')
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
        // selecting — load batch data for this SKU
        loadBatchData(sku.id)
      } else {
        // deselecting — clear its batch selection
        setBatchSel(function (p) { const n = { ...p }; delete n[sku.id]; return n })
        setNewBatchForms(function (p) { const n = { ...p }; delete n[sku.id]; return n })
      }
      return next
    })
  }

  async function save() {
    if (!form.full_name.trim()) { showToast('Student name is required', 'warn'); return }
    if (!form.phone.trim()) { showToast('Parent mobile number is required', 'warn'); return }
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
        phone: form.phone.trim(),
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
      // received (see recordPayment), mirroring 'lock on dispatch' for orders.

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

      // Raise the admission's fee invoice (courses + their kit items) and deduct
      // HO stock for the issued kit. (Per-item kit selection is available on the
      // Courses tab's Add-Course invoicing screen for later add-ons.)
      if (enrData.length > 0) {
        const skuIds = enrData.map(function (e) { return e.sku_id })
        const { data: kits } = await sb.from('kit_items')
          .select('sku_id, item_id, quantity, inventory_items(name)').in('sku_id', skuIds)
        const lines = []
        const stockRows = []
        enrData.forEach(function (e) {
          const sku = selectedSkus.find(function (s) { return s.id === e.sku_id })
          const cname = (sku?.courses?.group_name ? sku.courses.group_name + ' — ' : '') + (sku?.level_name || '')
          const fee = sku?.student_fee || 0
          lines.push({ kind: 'course', sku_id: e.sku_id, enrollment_id: e.id, name: cname, qty: 1, rate: fee, amount: fee })
          ;(kits || []).filter(function (k) { return k.sku_id === e.sku_id }).forEach(function (k) {
            const qn = Number(k.quantity || 1)
            lines.push({ kind: 'kit', sku_id: e.sku_id, item_id: k.item_id, name: k.inventory_items?.name || 'Kit item', qty: qn, rate: 0, amount: 0 })
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
          await fetch('/api/create-user', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(admSess ? { Authorization: `Bearer ${admSess.access_token}` } : {}),
            },
            body: JSON.stringify({
              email:    loginEmail,
              password: tempPass,
              fullName: form.full_name.trim(),
            }),
          })
          await sb.from('users').upsert({
            email: loginEmail,
            full_name: form.full_name.trim(),
            role: 'student',
            franchisee_id: form.franchisee_id,
            student_id: st.id,
          }, { onConflict: 'email' })
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
      // Re-fetch with full joins so the list shows enrollments immediately
      const { data: fullSt } = await sb.from('students')
        .select('*, franchisees(business_name, city), enrollments(id, sku_id, fee_amount, list_price, completed_at, status, cert_emailed_at, cert_wa_sent_at, skus(level_name, courses(group_name)))')
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
              onChange={field('phone')}
              placeholder="10-digit parent / guardian mobile"
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
                {phoneMatches.length} student{phoneMatches.length > 1 ? 's' : ''} found with this number:
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
                        <div style={{ font: '700 13px var(--font)', color: 'var(--text)' }}>{st.full_name}</div>
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
            <label>Date of Birth
              <input type="date" value={form.dob} onChange={field('dob')} />
            </label>
            <label>Date of Registration
              <input type="date" value={form.registered_at} onChange={field('registered_at')} />
            </label>
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

          {/* ── Section 4: Batch Assignment ── */}
          {selectedSkus.length > 0 && (
            <div style={{ borderTop:'1px solid var(--border)', paddingTop:12, marginTop:12 }}>
              <div style={{ font:'600 12px var(--font)', color:'var(--text)', marginBottom:8 }}>
                📋 Batch Assignment
                <span style={{ font:'500 10px var(--font)', color:'var(--text3)', marginLeft:8 }}>
                  Assign each course to a batch (optional — can be done later)
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
                      {bd.loading ? (
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
                      )}
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
                <label>PIN Code
                  <input value={form.pincode} onChange={field('pincode')} placeholder="e.g. 440001" />
                </label>
                <label>City
                  <input value={form.city} onChange={field('city')} placeholder="Nagpur" />
                </label>
                <label>Area / Locality
                  <input value={form.area} onChange={field('area')} placeholder="Sadar, Dharampeth…" />
                </label>
                <label>State
                  <input value={form.state} onChange={field('state')} placeholder="Maharashtra" />
                </label>
                <label>Country
                  <input value={form.country} onChange={field('country')} placeholder="India" />
                </label>
                <label className="col-span-2">Street / Building Address
                  <input value={form.address} onChange={field('address')} placeholder="Flat/Shop no., building, street" />
                </label>
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

// ── StudentsPage ───────────────────────────────────────────────────────────────

export default function StudentsPage() {
  const { currentRole, currentFranchiseeId } = useAuth()
  const admin = isAdminRole(currentRole)

  const [students, setStudents]   = useState([])
  const [loading, setLoading]     = useState(true)
  const [search, setSearch]       = useState('')
  const [centreFilter, setCentreFilter] = useState('')
  const [centreFilterTouched, setCentreFilterTouched] = useState(false)
  const [sortBy, setSortBy] = useState('activity')   // activity | name | joined | balance
  const [showClosed, setShowClosed] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [selected, setSelected] = useState(null)
  const [showAdd, setShowAdd] = useState(false)
  const [attMap, setAttMap] = useState({})   // { [enrollment_id]: attended count }

  // Centre filter dropdown still available to multi-centre roles; the column
  // itself is replaced by a Sessions/Billing summary.
  const showCentreCol = admin || currentRole === 'smf' || currentRole === 'cf'

  useEffect(() => {
    if (currentRole === null) return   // wait for auth to resolve
    async function load() {
      setLoading(true)
      let q = sb.from('students')
        .select('*, franchisees(business_name, city, tier), enrollments(id, sku_id, fee_amount, list_price, enrolled_at, completed_at, status, cert_emailed_at, cert_wa_sent_at, skus(level_name, total_sessions, courses(group_name, billing_type)))')
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

      // Attended-session counts per enrollment (for the Sessions column)
      const enrIds = (data || []).flatMap(function (s) { return (s.enrollments || []).map(function (e) { return e.id }) })
      if (enrIds.length > 0) {
        const { data: attRows } = await sb.from('session_attendance')
          .select('enrollment_id').in('enrollment_id', enrIds).eq('attended', true)
        const m = {}
        ;(attRows || []).forEach(function (a) { m[a.enrollment_id] = (m[a.enrollment_id] || 0) + 1 })
        setAttMap(m)
      } else {
        setAttMap({})
      }
    }
    load()
  }, [admin, currentRole, currentFranchiseeId])

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

  const closedCount = students.filter(function (s) { return s.is_active === false }).length
  const filtered = students.filter(function (s) {
    const q = search.toLowerCase()
    const matchesSearch = !q || s.full_name?.toLowerCase().includes(q) || s.parent_name?.toLowerCase().includes(q) || s.phone?.includes(q)
    const matchesCentre = !centreFilter || s.franchisee_id === centreFilter
    // Closed students are hidden unless explicitly shown, so the roster and its
    // totals reflect who is actually studying. A search match reveals them
    // regardless, so a closed student is never truly lost.
    const matchesActive = showClosed || s.is_active !== false || (q && matchesSearch)
    return matchesSearch && matchesCentre && matchesActive
  }).sort(function (a, b) {
    if (sortBy === 'name')    return (a.full_name || '').localeCompare(b.full_name || '')
    if (sortBy === 'joined')  return new Date(b.registered_at || b.created_at || 0) - new Date(a.registered_at || a.created_at || 0)
    if (sortBy === 'balance') return ((b.fee_total || 0) - (b.fee_paid || 0)) - ((a.fee_total || 0) - (a.fee_paid || 0))
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
    setStudents(ss => [{ ...st, enrollments: [] }, ...ss])
    setShowAdd(false)
  }

  function handleOpenExisting(st) {
    setShowAdd(false)
    setSelected(st)
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
          <button className="btn btn-p" onClick={() => setShowAdd(true)}>+ Enrol Student</button>
        </div>
      </header>

      <div className="content">
        {/* Page header */}
        <div className="ph">
          <div className="ph-l">
            <div className="ph-eyebrow"><span className="dot"></span>Enrollment</div>
            <h1 className="ph-title">Students</h1>
            <div className="ph-sub">
              {currentRole === 'uf'
                ? <><b>{students.length} students</b> enrolled at your centre.</>
                : <><b>{students.length} students</b>{showCentreCol ? ' enrolled across your territory.' : ' enrolled across all centres.'}</>
              }
            </div>
          </div>
        </div>

        {/* Stats */}
        {(function() {
          const totalCharged  = filtered.reduce(function(s, r) { return s + (Number(r.fee_total) || 0) }, 0)
          const totalReceived = filtered.reduce(function(s, r) { return s + (Number(r.fee_paid)  || 0) }, 0)
          const totalBalance  = totalCharged - totalReceived
          return (
            <div className="mini-stats">
              <div className="mini">
                <div className="mini-ic" style={{ background: 'var(--purple-bg)' }}>🎓</div>
                <div className="mini-num">{filtered.length}</div>
                <div className="mini-lbl">Total enrolled</div>
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
        ) : (
          <div className="card tbl-scroll" style={{ marginBottom: 0 }}>
            <table className="big-tbl">
              <thead>
                <tr>
                  <th>Student</th>
                  {showCentreCol && <th className="hide-mobile">Centre</th>}
                  <th className="hide-mobile">Sessions</th>
                  <th className="hide-mobile">Parent</th>
                  <th>Courses</th>
                  <th className="hide-mobile" style={{ textAlign: 'right' }}>Fee Total</th>
                  <th className="hide-mobile" style={{ textAlign: 'right' }}>Fee Paid</th>
                  <th className="hide-mobile" style={{ textAlign: 'right' }}>Balance</th>
                  <th>Status</th>
                  <th className="hide-mobile" style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr><td colSpan={showCentreCol ? 10 : 9} className="empty">No students found</td></tr>
                )}
                {filtered.map(function (s) {
                  const balance = (s.fee_total || 0) - (s.fee_paid || 0)
                  const courseNames = [...new Set((s.enrollments || []).map(e => e.skus?.courses?.group_name).filter(Boolean))]
                  const monthEnd = daysLeftInMonth() <= 5
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
                      {showCentreCol && (
                        <td className="hide-mobile">
                          {s.franchisees ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, font: '600 11px var(--font)', color: s.franchisees.tier === 'NLH' ? 'var(--purple)' : 'var(--text2)' }}>
                              <span>{s.franchisees.tier === 'NLH' ? '🏛️' : '🏢'}</span>
                              <span>{s.franchisees.business_name}{s.franchisees.tier && s.franchisees.tier !== 'NLH' ? ' · ' + s.franchisees.tier : ''}</span>
                            </span>
                          ) : <span style={{ color: 'var(--text3)' }}>—</span>}
                        </td>
                      )}
                      <td className="hide-mobile" style={{ fontSize: 11 }}>
                        {(s.enrollments || []).length === 0
                          ? <span style={{ color: 'var(--text3)' }}>—</span>
                          : (s.enrollments || []).map(function (e) {
                              const cn  = e.skus?.courses?.group_name || 'Course'
                              const bt  = e.skus?.courses?.billing_type
                              const tot = e.skus?.total_sessions || 0
                              const att = attMap[e.id] || 0
                              const done = !e.completed_at && tot > 0 && att >= tot
                              let txt, color, bg
                              if (e.completed_at) { txt = '✓ done'; color = 'var(--green)'; bg = 'var(--green-bg)' }
                              else if (bt === 'monthly') {
                                if (monthEnd) { txt = '📅 renew'; color = '#1D4ED8'; bg = '#DBEAFE' }
                                else { txt = 'monthly'; color = 'var(--text2)'; bg = 'var(--bg2)' }
                              }
                              else if (tot > 0) { txt = att + '/' + tot; color = done ? '#B45309' : 'var(--text2)'; bg = done ? '#FEF3C7' : 'var(--bg2)' }
                              else { txt = att + ' sess'; color = 'var(--text2)'; bg = 'var(--bg2)' }
                              return (
                                <div key={e.id} style={{ display: 'flex', gap: 5, alignItems: 'center', marginBottom: 2, whiteSpace: 'nowrap' }}>
                                  <span style={{ color: 'var(--text3)', maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis' }}>{cn}</span>
                                  <span style={{ color: color, background: bg, borderRadius: 10, padding: '0 6px', fontWeight: 600 }}>{txt}</span>
                                </div>
                              )
                            })
                        }
                      </td>
                      <td className="hide-mobile" style={{ color: 'var(--text2)' }}>
                        <div>{s.parent_name || '—'}</div>
                        {s.phone && <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 1 }}>{s.phone}</div>}
                      </td>
                      <td>
                        {courseNames.length === 0
                          ? <span style={{ color: 'var(--text3)' }}>None</span>
                          : courseNames.map(function (cn) {
                            return (
                              <span key={cn} className={'stu-chip stu-chip-' + courseTone(cn)}>{cn}</span>
                            )
                          })
                        }
                      </td>
                      <td className="hide-mobile" style={{ textAlign: 'right' }}><div className="amt">₹{fmtAmt(s.fee_total)}</div></td>
                      <td className="hide-mobile" style={{ textAlign: 'right' }}><div className="amt" style={{ color: 'var(--green)' }}>₹{fmtAmt(s.fee_paid)}</div></td>
                      <td className="hide-mobile" style={{ textAlign: 'right' }}>
                        <div className="amt" style={{ color: balance > 0 ? 'var(--red)' : 'var(--green)' }}>₹{fmtAmt(balance)}</div>
                      </td>
                      <td><StatusBadge status={s.payment_status} /></td>
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

