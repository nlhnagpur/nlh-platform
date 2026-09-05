import React, { useState, useEffect } from 'react'
import { sb } from '../supabase'
import { useAuth } from '../context/AuthContext'
import { fmtAmt, fmtDate, showToast, statusBadge } from '../utils'
import { isAdminRole } from '../constants/roles'
import { getTreeIds } from '../utils/hierarchy'
import { sendWelcomeEmail, sendFranchiseeWelcomeLetter, sendFranchiseeCertEmail } from '../services/email'
import { sendWAPaymentReceived, sendWAFeeReminder } from '../services/whatsapp'
import WhatsAppSendConfirm from '../components/WhatsAppSendConfirm'
import ModalHeader from '../components/ModalHeader'
import { printFranchiseeCert, default as FranchiseeCertModal } from '../components/FranchiseeCertModal'
import { printFranchiseeReceipt, printFranchiseeEnrollmentInvoice, printFranchiseeAgreement } from '../components/studentDocs'
import { captureDocPng } from '../utils/captureReceipt'
import { StudentDetailModal, daysLeftInMonth } from './StudentsPage'
import FranchiseeLedgerView from '../components/FranchiseeLedgerView'
import { loadLatestAgreement, generateAgreement } from '../utils/franchiseeAgreement'
import { buildAgreementPdfDataUrl, downloadAgreementPdf } from '../utils/agreementPdf'

// ── Location data ──────────────────────────────────────────────────────────────

const COUNTRIES = [
  'India','Australia','Bahrain','Bangladesh','Canada','France','Germany',
  'Kuwait','Malaysia','Maldives','Nepal','New Zealand','Oman','Qatar',
  'Saudi Arabia','Singapore','South Africa','Sri Lanka','UAE','United Kingdom',
  'United States',
]

const STATE_CITIES = {
  'Andhra Pradesh':    ['Visakhapatnam','Vijayawada','Guntur','Nellore','Kurnool','Rajahmundry','Tirupati','Kakinada','Kadapa','Anantapur','Eluru','Ongole','Nandyal','Vizianagaram','Chittoor'],
  'Arunachal Pradesh': ['Itanagar','Naharlagun','Pasighat','Tawang','Ziro','Bomdila'],
  'Assam':             ['Guwahati','Silchar','Dibrugarh','Jorhat','Nagaon','Tinsukia','Tezpur','Sivasagar','Karimganj','Bongaigaon','Dhubri','Barpeta','North Lakhimpur'],
  'Bihar':             ['Patna','Gaya','Bhagalpur','Muzaffarpur','Purnia','Darbhanga','Bihar Sharif','Arrah','Begusarai','Katihar','Munger','Chhapra','Hajipur','Samastipur'],
  'Chhattisgarh':      ['Raipur','Bhilai','Korba','Bilaspur','Durg','Rajnandgaon','Jagdalpur','Ambikapur','Raigarh','Dhamtari'],
  'Goa':               ['Panaji','Margao','Vasco da Gama','Mapusa','Ponda','Bicholim','Curchorem','Sanquelim'],
  'Gujarat':           ['Ahmedabad','Surat','Vadodara','Rajkot','Bhavnagar','Jamnagar','Junagadh','Gandhinagar','Anand','Bharuch','Morbi','Nadiad','Mehsana','Surendranagar','Amreli','Navsari','Valsad','Porbandar','Gondal','Gandhidham','Palanpur','Patan','Botad','Deesa','Veraval'],
  'Haryana':           ['Faridabad','Gurugram','Panipat','Ambala','Yamunanagar','Rohtak','Hisar','Karnal','Sonipat','Panchkula','Bhiwani','Sirsa','Bahadurgarh','Jind','Thanesar'],
  'Himachal Pradesh':  ['Shimla','Mandi','Solan','Dharamshala','Kullu','Baddi','Palampur','Hamirpur','Una','Bilaspur','Chamba','Nahan','Rampur'],
  'Jharkhand':         ['Ranchi','Jamshedpur','Dhanbad','Bokaro','Deoghar','Hazaribagh','Giridih','Ramgarh','Medininagar','Chaibasa'],
  'Karnataka':         ['Bengaluru','Mysuru','Mangaluru','Hubli','Belagavi','Kalaburagi','Davanagere','Ballari','Vijayapura','Shivamogga','Tumakuru','Bidar','Raichur','Hassan','Udupi','Mandya','Gadag','Dharwad','Chitradurga'],
  'Kerala':            ['Thiruvananthapuram','Kochi','Kozhikode','Thrissur','Kollam','Alappuzha','Palakkad','Malappuram','Kannur','Kottayam','Kasaragod','Ernakulam'],
  'Madhya Pradesh':    ['Indore','Bhopal','Jabalpur','Gwalior','Ujjain','Sagar','Dewas','Satna','Ratlam','Rewa','Singrauli','Burhanpur','Khandwa','Bhind','Chhindwara','Guna','Shivpuri','Vidisha','Chhatarpur'],
  'Maharashtra':       ['Mumbai','Pune','Nagpur','Nashik','Aurangabad','Solapur','Kolhapur','Amravati','Nanded','Thane','Pimpri-Chinchwad','Kalyan','Vasai-Virar','Malegaon','Jalgaon','Akola','Latur','Dhule','Sangli','Satara','Ratnagiri','Ahmednagar','Chandrapur','Yavatmal','Bhusawal','Panvel','Wardha','Hinganghat','Mira-Bhayandar'],
  'Manipur':           ['Imphal','Thoubal','Bishnupur','Churachandpur','Senapati','Ukhrul'],
  'Meghalaya':         ['Shillong','Tura','Nongstoin','Jowai','Baghmara'],
  'Mizoram':           ['Aizawl','Lunglei','Saiha','Champhai','Serchhip','Kolasib'],
  'Nagaland':          ['Kohima','Dimapur','Mokokchung','Tuensang','Wokha','Mon'],
  'Odisha':            ['Bhubaneswar','Cuttack','Rourkela','Brahmapur','Sambalpur','Puri','Balasore','Baripada','Bhadrak','Balangir','Jharsuguda','Berhampur','Rayagada','Koraput','Kendrapara'],
  'Punjab':            ['Ludhiana','Amritsar','Jalandhar','Patiala','Bathinda','Hoshiarpur','Pathankot','Moga','Abohar','Malerkotla','Khanna','Phagwara','Muktsar','Firozpur','Mohali','Batala'],
  'Rajasthan':         ['Jaipur','Jodhpur','Kota','Bikaner','Ajmer','Udaipur','Bhilwara','Alwar','Bharatpur','Sikar','Pali','Sri Ganganagar','Churu','Jhunjhunu','Barmer','Nagaur','Tonk','Bundi','Sawai Madhopur'],
  'Sikkim':            ['Gangtok','Namchi','Geyzing','Mangan','Rangpo','Jorethang'],
  'Tamil Nadu':        ['Chennai','Coimbatore','Madurai','Tiruchirappalli','Salem','Tirunelveli','Tiruppur','Vellore','Erode','Thoothukudi','Dindigul','Thanjavur','Ranipet','Sivakasi','Karur','Hosur','Nagercoil','Kancheepuram','Cuddalore','Kumbakonam','Udhagamandalam'],
  'Telangana':         ['Hyderabad','Warangal','Nizamabad','Khammam','Karimnagar','Ramagundam','Mahbubnagar','Nalgonda','Adilabad','Suryapet','Miryalaguda','Siddipet','Jagtial'],
  'Tripura':           ['Agartala','Dharmanagar','Udaipur','Kailashahar','Belonia','Ambassa','Khowai'],
  'Uttar Pradesh':     ['Lucknow','Kanpur','Ghaziabad','Agra','Meerut','Varanasi','Prayagraj','Bareilly','Aligarh','Moradabad','Saharanpur','Gorakhpur','Noida','Firozabad','Jhansi','Muzaffarnagar','Mathura','Rampur','Shahjahanpur','Hapur','Sambhal','Amroha','Mau','Bulandshahr','Unnao','Etawah','Mirzapur','Faizabad','Rae Bareli','Bahraich','Sultanpur','Fatehpur','Sitapur','Hathras','Orai','Banda','Pilibhit','Mainpuri','Budaun','Hardoi','Gonda','Azamgarh','Etah','Lakhimpur','Deoria','Ballia','Bijnor','Basti'],
  'Uttarakhand':       ['Dehradun','Haridwar','Roorkee','Haldwani','Rudrapur','Kashipur','Rishikesh','Kotdwar','Ramnagar','Pithoragarh','Almora','Nainital','Mussoorie'],
  'West Bengal':       ['Kolkata','Howrah','Durgapur','Asansol','Siliguri','Bardhaman','Malda','Baharampur','Habra','Kharagpur','Shantipur','Ranaghat','Haldia','Raiganj','Krishnanagar','Nabadwip','Medinipur','Jalpaiguri','Balurghat','Basirhat','Bankura','Darjeeling'],
  'Andaman & Nicobar Islands': ['Port Blair','Diglipur','Rangat'],
  'Chandigarh':        ['Chandigarh'],
  'Dadra & Nagar Haveli and Daman & Diu': ['Daman','Diu','Silvassa'],
  'Delhi':             ['New Delhi','Central Delhi','North Delhi','South Delhi','East Delhi','West Delhi','Dwarka','Rohini','Janakpuri','Laxmi Nagar','Shahdara'],
  'Jammu & Kashmir':   ['Srinagar','Jammu','Anantnag','Baramulla','Sopore','Kathua','Udhampur','Rajouri','Poonch'],
  'Ladakh':            ['Leh','Kargil'],
  'Lakshadweep':       ['Kavaratti','Minicoy','Andrott'],
  'Puducherry':        ['Puducherry','Karaikal','Mahe','Yanam'],
}

const INDIA_STATES = Object.keys(STATE_CITIES).sort()

// ── Franchisee CSV export — every downloadable field, in a fixed column order ──
// `checkedByDefault` reproduces the original always-exported set so existing
// habits don't change unless the user opens the picker and asks for more.
const EXPORT_FIELDS = [
  { key: 'business_name',          label: 'Business Name',          get: r => r.business_name,          checkedByDefault: true },
  { key: 'owner_name',             label: 'Owner Name',             get: r => r.owner_name,              checkedByDefault: true },
  { key: 'tier',                   label: 'Tier',                   get: r => r.tier,                    checkedByDefault: true },
  { key: 'email',                  label: 'Email',                  get: r => r.email,                   checkedByDefault: true },
  { key: 'phone',                  label: 'Phone',                  get: r => r.phone,                   checkedByDefault: true },
  { key: 'address',                label: 'Address',                get: r => r.address,                 checkedByDefault: false },
  { key: 'area',                   label: 'Area',                   get: r => r.area,                    checkedByDefault: true },
  { key: 'city',                   label: 'City',                   get: r => r.city,                    checkedByDefault: true },
  { key: 'state',                  label: 'State',                  get: r => r.state,                   checkedByDefault: true },
  { key: 'country',                label: 'Country',                get: r => r.country,                 checkedByDefault: true },
  { key: 'pincode',                label: 'PIN Code',                get: r => r.pincode,                checkedByDefault: true },
  { key: 'gstin',                  label: 'GSTIN',                  get: r => r.gstin,                   checkedByDefault: false },
  { key: 'centre_code',            label: 'Centre Code',            get: r => r.centre_code,             checkedByDefault: false },
  { key: 'status',                 label: 'Status',                 get: r => r.status,                  checkedByDefault: true },
  { key: 'payment_status',         label: 'Payment Status',         get: r => r.payment_status,          checkedByDefault: false },
  { key: 'enrollment_fee',         label: 'Enrollment Fee',         get: r => r.enrollment_fee || 0,     checkedByDefault: true },
  { key: 'fee_paid',               label: 'Fee Paid',               get: r => r.fee_paid || 0,           checkedByDefault: true },
  { key: 'renewal_fee',            label: 'Renewal Fee',            get: r => r.renewal_fee || 0,        checkedByDefault: false },
  { key: 'enrollment_invoice_no',  label: 'Enrollment Invoice No',  get: r => r.enrollment_invoice_no,   checkedByDefault: false },
  { key: 'contract_start',         label: 'Contract Start',         get: r => r.contract_start,          checkedByDefault: false },
  { key: 'contract_end',           label: 'Contract End',           get: r => r.contract_end,            checkedByDefault: false },
  { key: 'valid_till',             label: 'Valid Till',             get: r => r.valid_till,              checkedByDefault: false },
  { key: 'date_of_birth',          label: 'Date of Birth',          get: r => r.date_of_birth,           checkedByDefault: false },
  { key: 'qualification',          label: 'Qualification',          get: r => r.qualification,           checkedByDefault: false },
  { key: 'registered_courses',     label: 'Registered Courses (count)', get: r => (r.registered_courses || []).length, checkedByDefault: false },
  { key: 'registered_skus',        label: 'Registered SKUs (count)',    get: r => (r.registered_skus || []).length,    checkedByDefault: false },
]

function LocationFields({ form, onChange, disabled }) {
  const isIndia = (form.country || 'India').toLowerCase() === 'india'
  const presetCities = isIndia ? (STATE_CITIES[form.state] || []) : []
  // The city list is a curated preset, not the full set of real cities/towns —
  // a saved value that isn't in it (renamed city, smaller town, data entered
  // before this was a dropdown) would otherwise vanish from the <select>
  // entirely even though it's still the real, unchanged value underneath.
  const cityList = (form.city && !presetCities.includes(form.city))
    ? [form.city, ...presetCities]
    : presetCities

  function handleCountryChange(e) {
    onChange('country', e.target.value)
    onChange('state', '')
    onChange('city', '')
  }
  function handleStateChange(e) {
    onChange('state', e.target.value)
    onChange('city', '')
  }
  function handleCityChange(e) { onChange('city', e.target.value) }

  return (
    <>
      <label>Country
        <select value={form.country || 'India'} onChange={handleCountryChange} disabled={disabled}>
          {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </label>
      <label>{isIndia ? 'State' : 'State / Province'}
        {isIndia ? (
          <select value={form.state || ''} onChange={handleStateChange} disabled={disabled}>
            <option value="">— Select State —</option>
            {INDIA_STATES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        ) : (
          <input value={form.state || ''} onChange={handleStateChange} disabled={disabled} placeholder="State / Province / Region" />
        )}
      </label>
      <label>City
        {isIndia ? (
          <select value={form.city || ''} onChange={handleCityChange} disabled={disabled || !form.state}>
            <option value="">— Select City —</option>
            {cityList.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        ) : (
          <input value={form.city || ''} onChange={handleCityChange} disabled={disabled} placeholder="City" />
        )}
      </label>
    </>
  )
}

// ── RecordFranchiseePaymentModal ───────────────────────────────────────────────

function RecordFranchiseePaymentModal({ franchisee, balance, currentUser, onSaved, onClose }) {
  const [amount,  setAmount]  = useState(balance > 0 ? String(balance) : '')
  const [date,    setDate]    = useState(new Date().toISOString().slice(0, 10))
  const [mode,    setMode]    = useState('UPI')
  const [ref,     setRef]     = useState('')
  const [notes,   setNotes]   = useState('')
  const [saving,  setSaving]  = useState(false)
  const [sendWA,  setSendWA]  = useState(true)
  const [waPhone, setWaPhone] = useState(franchisee.phone || '')

  async function handleSave() {
    const amt = Number(amount)
    if (!amt || amt <= 0) { showToast('Enter a valid amount', 'warn'); return }
    // Guard client-side too, so staff get a plain message rather than the raw
    // DB exception when a payment would exceed the franchise fee.
    const feeCap  = Number(franchisee.enrollment_fee) || 0
    const already = Number(franchisee.fee_paid) || 0
    if (feeCap > 0 && already + amt > feeCap) {
      showToast('That exceeds the franchise fee — only ₹' + fmtAmt(Math.max(0, feeCap - already)) + ' is outstanding.', 'warn')
      return
    }
    setSaving(true)
    const { data: inserted, error: insErr } = await sb.from('franchisee_payments').insert({
      franchisee_id: franchisee.id,
      amount:        amt,
      payment_date:  date,
      payment_mode:  mode,
      reference_no:  ref.trim() || null,
      notes:         notes.trim() || null,
      recorded_by:   currentUser || null,
    }).select('receipt_no').single()
    if (insErr) { showToast('Failed: ' + insErr.message, 'err'); setSaving(false); return }

    // Phase 3 dual-write (see docs/transaction-model-migration-plan.md) —
    // mirror this payment into the new transactions/transaction_payments
    // tables alongside the write above. Best-effort: franchisee_payments is
    // still the source of truth every screen actually reads from, so a
    // failure here must never surface as a failed payment.
    try {
      let { data: tx } = await sb.from('transactions')
        .select('id').eq('type', 'franchise_fee').eq('party_id', franchisee.id).maybeSingle()
      if (!tx) {
        const { data: newTx, error: txErr } = await sb.from('transactions').insert({
          type: 'franchise_fee', party_id: franchisee.id,
          total: feeCap, status: 'confirmed',
        }).select('id').single()
        if (txErr) throw txErr
        tx = newTx
      }
      await sb.from('transaction_payments').insert({
        transaction_id: tx.id, amount: amt, paid_on: date, mode: mode,
        reference: ref.trim() || null, note: notes.trim() || null,
        recorded_by: currentUser || null, receipt_no: inserted && inserted.receipt_no,
      })
    } catch (dualWriteErr) {
      console.warn('[Phase 3 dual-write] franchise_fee payment mirror failed:', dualWriteErr.message)
    }

    // fee_paid is maintained by a DB trigger now — no manual update here.
    const newFeePaid = already + amt
    const newBalance = feeCap - newFeePaid
    setSaving(false)
    showToast('Payment of ₹' + fmtAmt(amt) + ' recorded')
    if (sendWA && waPhone) {
      try {
        // PNG of the receipt for the image header. Best-effort: on failure the
        // send falls back to the text template rather than not going at all.
        let imageUrl = null
        try {
          const html = printFranchiseeReceipt(
            franchisee,
            { receipt_no: inserted && inserted.receipt_no, amount: amt, payment_date: date,
              payment_mode: mode, reference_no: ref.trim() || null, notes: notes.trim() || null },
            { total: Number(franchisee.enrollment_fee) || 0, paidToDate: newFeePaid, asHtml: true }
          )
          imageUrl = await captureDocPng(html, (inserted && inserted.receipt_no) || 'receipt')
        } catch (capErr) { /* non-fatal */ }

        const r = await sendWAPaymentReceived(waPhone, {
          name:      franchisee.business_name || 'Partner',
          amount:    fmtAmt(amt),
          balance:   newBalance,
          imageUrl:  imageUrl,
          // The real receipt number, not the bank reference — the franchisee
          // needs to be able to quote this against the printed receipt.
          receiptNo: (inserted && inserted.receipt_no) || ref.trim() || mode,
          date:      fmtDate(date),
        })
        if (r && r.success) showToast('WhatsApp receipt sent ✓')
        else showToast('Payment saved · WhatsApp receipt failed' + (r && r.error ? ': ' + r.error : ''), 'warn')
      } catch (waErr) {
        showToast('Payment saved · WhatsApp receipt failed: ' + waErr.message, 'warn')
      }
    }
    onSaved(newFeePaid)
  }

  return (
    <div className="modal-bg" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <ModalHeader flush title="Record Payment" subtitle={franchisee.business_name} onClose={onClose} />
        <div style={{ padding: '0 20px 4px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ background: '#f8f7ff', border: '1px solid #ddd9f9', borderRadius: 8, padding: '10px 14px', fontSize: 13 }}>
            <span style={{ color: 'var(--text2)' }}>Outstanding balance: </span>
            <strong style={{ color: balance > 0 ? 'var(--red)' : 'var(--green)', fontSize: 15 }}>
              ₹{fmtAmt(balance)}
            </strong>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label>Amount Received (₹)
              <input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0" autoFocus />
            </label>
            <label>Payment Date
              <input type="date" value={date} onChange={e => setDate(e.target.value)} />
            </label>
            <label>Payment Mode
              <select value={mode} onChange={e => setMode(e.target.value)}>
                <option>UPI</option>
                <option>NEFT</option>
                <option>RTGS</option>
                <option>Cash</option>
                <option>Cheque</option>
                <option>DD</option>
              </select>
            </label>
            <label>Reference / UTR No.
              <input value={ref} onChange={e => setRef(e.target.value)} placeholder="Optional" />
            </label>
            <label style={{ gridColumn: '1 / -1' }}>Notes (optional)
              <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. Part payment, balance next month" />
            </label>
          </div>

          {/* WhatsApp receipt to franchisee */}
          <div style={{ padding: '10px 12px', borderRadius: 10, background: 'var(--green-bg, #f0fdf4)', border: '1px solid var(--green, #1D7A4F)' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, font: '600 12px var(--font)', color: 'var(--green, #1D7A4F)', cursor: 'pointer' }}>
              <input type="checkbox" checked={sendWA} onChange={e => setSendWA(e.target.checked)} />
              💬 Send WhatsApp receipt to franchisee
            </label>
            {sendWA && (
              <input value={waPhone} onChange={e => setWaPhone(e.target.value)}
                placeholder="Franchisee WhatsApp number"
                style={{ marginTop: 8, fontSize: 13, width: '100%' }} />
            )}
          </div>
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn-p" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : '✓ Record Payment'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── helpers ────────────────────────────────────────────────────────────────────

function TierBadge({ tier }) {
  if (!tier) return null
  const cls = { SMF: 't-smf', CF: 't-cf', UF: 't-uf', SCHOOL: 't-school' }[tier] || ''
  return <span className={`tier ${cls}`}>{tier}</span>
}

function StatusBadge({ status }) {
  const s = (status || '').toLowerCase()
  const map = { active: 'ba', inactive: 'bd', pending: 'bp', approved: 'ba', rejected: 'bd' }
  return <span className={`badge ${map[s] || 'br'}`}>{status || '—'}</span>
}

function genTempPass() {
  return 'NLH@123'
}

// Sort franchisees: state A→Z → tier SMF→CF→UF → city A→Z → name A→Z
// SMF is state-level (one per state), CF/UF are city-level beneath it.
const TIER_ORDER = { NLH: 0, SMF: 1, CF: 2, UF: 3 }
function sortFranchisees(list) {
  return [...list].sort(function (a, b) {
    const state = (a.state || '').localeCompare(b.state || '')
    if (state !== 0) return state
    const tier = (TIER_ORDER[a.tier] ?? 9) - (TIER_ORDER[b.tier] ?? 9)
    if (tier !== 0) return tier
    const city = (a.city || '').localeCompare(b.city || '')
    if (city !== 0) return city
    return (a.business_name || '').localeCompare(b.business_name || '')
  })
}

function renewalStatus(fr) {
  const vt = fr.valid_till
    ? new Date(fr.valid_till)
    : (() => { const d = new Date(fr.created_at || Date.now()); d.setFullYear(d.getFullYear() + 3); return d })()
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const daysLeft = Math.ceil((vt - today) / 86400000)
  return {
    date: vt,
    daysLeft,
    isExpired: daysLeft <= 0,
    isExpiring: daysLeft > 0 && daysLeft <= 90,
    isValid: daysLeft > 90,
    fee: fr.renewal_fee != null ? fr.renewal_fee : (fr.fee_paid ? Math.round(fr.fee_paid * 0.25) : null),
  }
}

// ── FranchiseeDetailModal ──────────────────────────────────────────────────────

function FranchiseeDetailModal({ franchisee, allCourses, onClose, onSaved, inline }) {
  const { currentRole, currentUser } = useAuth()
  const admin = isAdminRole(currentRole)

  const [tab, setTab] = useState('info')
  const [form, setForm] = useState({
    name: franchisee.business_name || '',
    owner_name: franchisee.owner_name || '',
    email: franchisee.email || '',
    phone: franchisee.phone || '',
    country: franchisee.country || 'India',
    state: franchisee.state || '',
    city: franchisee.city || '',
    area: franchisee.area || '',
    pincode: franchisee.pincode || '',
    address: franchisee.address || '',
    status: franchisee.status || 'active',
    enrollment_fee: franchisee.enrollment_fee ?? '',
    fee_paid: franchisee.fee_paid ?? '',
    // Defaults to the day access was granted (the franchisee record's own
    // created_at) unless contract_start is already set or the admin changes
    // it while entering the fee — see save() and viewEnrollmentInvoice below.
    enrollment_date: franchisee.contract_start || (franchisee.created_at ? franchisee.created_at.slice(0, 10) : ''),
    valid_till: franchisee.valid_till || '',
    renewal_fee: franchisee.renewal_fee ?? '',
    date_of_birth: franchisee.date_of_birth || '',
    qualification: franchisee.qualification || '',
  })
  const [registeredCourses, setRegisteredCourses] = useState(franchisee.registered_courses || [])
  const [saving, setSaving] = useState(false)
  const [orders, setOrders] = useState([])
  const [students, setStudents] = useState([])
  const [attMap, setAttMap] = useState({})   // { [enrollment_id]: attended session count }
  const [tabLoaded, setTabLoaded] = useState({ info: true, courses: false, orders: false, students: false, cert: false, agreement: false, schools: false })

  // CF's schools — a school is a real franchisee row (tier 'SCHOOL', parented
  // under this CF), so it gets the full franchisee machinery (students,
  // enrollments, courses, orders, accounts) for free. Only kit pricing/CF
  // commission (school_sku_rates) and the bill-to-school order path are custom.
  const [schools, setSchools] = useState([])
  const [showAddSchool, setShowAddSchool] = useState(false)
  const [ratesForSchool, setRatesForSchool] = useState(null)   // school franchisee row currently open in the rates editor
  const [viewingSchool, setViewingSchool] = useState(null)     // school franchisee row currently drilled into (its own full detail modal)
  const [certEmailing, setCertEmailing] = useState(false)
  const [certEmailedAt, setCertEmailedAt] = useState(franchisee.cert_emailed_at || null)
  const [agreement, setAgreement] = useState(null)
  const [agreementBusy, setAgreementBusy] = useState(false)
  const [resending, setResending] = useState(false)
  const [changingEmail, setChangingEmail] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [savingEmail, setSavingEmail] = useState(false)
  const [payments, setPayments] = useState([])
  const [showPayModal, setShowPayModal] = useState(false)
  const [editPayId, setEditPayId] = useState(null)
  const [waSendingId, setWaSendingId] = useState(null)
  const [waConfirm, setWaConfirm] = useState(null)
  const [editPay, setEditPay] = useState({ amount: '', payment_date: '', payment_mode: '', reference_no: '' })
  const [studentCount, setStudentCount] = useState(null)
  const [selectedStudent, setSelectedStudent] = useState(null)

  useEffect(function () {
    sb.from('franchisee_payments')
      .select('id,amount,payment_date,payment_mode,reference_no,notes,recorded_by,created_at,receipt_no')
      .eq('franchisee_id', franchisee.id)
      .order('payment_date', { ascending: false })
      .then(function ({ data }) { setPayments(data || []) })
  }, [franchisee.id])

  useEffect(function () {
    sb.from('students').select('id', { count: 'exact', head: true })
      .eq('franchisee_id', franchisee.id)
      .then(function ({ count }) { setStudentCount(count || 0) })
  }, [franchisee.id])

  // Reload the ledger and recompute fee_paid from the sum of payments
  async function reloadPaymentsAndFee() {
    const { data } = await sb.from('franchisee_payments')
      .select('id,amount,payment_date,payment_mode,reference_no,notes,recorded_by,created_at,receipt_no')
      .eq('franchisee_id', franchisee.id)
      .order('payment_date', { ascending: false })
    const list = data || []
    setPayments(list)
    const total = list.reduce(function (s, p) { return s + (p.amount || 0) }, 0)
    await sb.from('franchisees').update({ fee_paid: total }).eq('id', franchisee.id)
    setForm(function (f) { return { ...f, fee_paid: String(total) } })
    if (onSaved) onSaved({ ...franchisee, fee_paid: total })
  }

  function startEditPay(p) {
    setEditPayId(p.id)
    setEditPay({
      amount: String(p.amount ?? ''),
      payment_date: (p.payment_date || '').slice(0, 10),
      payment_mode: p.payment_mode || '',
      reference_no: p.reference_no || '',
    })
  }

  async function savePaymentEdit() {
    const amt = Number(editPay.amount)
    if (!amt || amt <= 0) { showToast('Enter a valid amount', 'warn'); return }
    const { error } = await sb.from('franchisee_payments').update({
      amount:       amt,
      payment_date: editPay.payment_date || null,
      payment_mode: editPay.payment_mode || null,
      reference_no: editPay.reference_no.trim() || null,
    }).eq('id', editPayId)
    if (error) { showToast('Update failed: ' + error.message, 'err'); return }
    setEditPayId(null)
    await reloadPaymentsAndFee()
    showToast('Payment updated ✓')
  }

  // Print one payment's receipt. "Paid to date" is the running total as at THAT
  // payment, not today's, so reprinting an old receipt shows the figures as
  // they stood when it was issued.
  // Running total as at THAT payment, so a reprint or resend shows the figures
  // as they stood when the receipt was issued.
  function paidAsAt(p) {
    return payments
      .filter(function (x) {
        return x.payment_date < p.payment_date ||
               (x.payment_date === p.payment_date && x.id === p.id)
      })
      .reduce(function (s, x) { return s + (x.amount || 0) }, 0)
  }

  function printPaymentReceipt(p) {
    printFranchiseeReceipt(franchisee, p, {
      total:      Number(form.enrollment_fee) || 0,
      paidToDate: paidAsAt(p),
    })
  }

  // Send (or re-send) one receipt on WhatsApp, with a PNG of the document.
  // Goes through the WhatsAppSendConfirm modal (see waConfirm) first.
  async function sendPaymentReceiptWA(p, phone) {
    setWaSendingId(p.id)
    try {
      const total = Number(form.enrollment_fee) || 0
      const asAt  = paidAsAt(p)
      let imageUrl = null
      try {
        const html = printFranchiseeReceipt(franchisee, p, { total: total, paidToDate: asAt, asHtml: true })
        imageUrl = await captureDocPng(html, p.receipt_no || 'receipt')
      } catch (capErr) { /* falls back to the text receipt */ }

      const r = await sendWAPaymentReceived(phone, {
        name:      franchisee.business_name || 'Partner',
        amount:    fmtAmt(p.amount),
        balance:   Math.max(0, total - asAt),
        receiptNo: p.receipt_no || '—',
        date:      fmtDate(p.payment_date),
        imageUrl:  imageUrl,
      })
      if (r && r.success) showToast('💬 Receipt ' + (p.receipt_no || '') + ' sent on WhatsApp.')
      else showToast('WhatsApp failed' + (r && r.error ? ': ' + r.error : ''), 'warn')
    } catch (e) {
      showToast('WhatsApp failed: ' + e.message, 'warn')
    }
    setWaSendingId(null)
  }

  async function deletePaymentEntry(p) {
    if (!window.confirm('Delete this ₹' + fmtAmt(p.amount) + ' payment entry? Fee Paid will be recalculated.')) return
    const { error } = await sb.from('franchisee_payments').delete().eq('id', p.id)
    if (error) { showToast('Delete failed: ' + error.message, 'err'); return }
    if (editPayId === p.id) setEditPayId(null)
    await reloadPaymentsAndFee()
    showToast('Payment removed')
  }

  async function sendFeeReminder(phone) {
    const bal = (Number(form.enrollment_fee) || 0) - (Number(form.fee_paid) || 0)
    if (bal <= 0) { showToast('Nothing outstanding — no reminder needed', 'warn'); return }
    const r = await sendWAFeeReminder(phone, {
      name:    franchisee.business_name || 'Partner',
      balance: fmtAmt(bal),
      towards: 'your franchise enrolment fee',
    })
    if (r && r.success) showToast('Fee reminder sent on WhatsApp ✓')
    else showToast('Reminder failed' + (r && r.error ? ': ' + r.error : ''), 'err')
  }

  // Reported live: admin typed an Enrollment Fee, clicked Invoice, the
  // printed document showed it correctly (it reads live `form` state) — but
  // the value was never actually written to the database, since this only
  // ever printed and the separate page-level Save button is what persists
  // `form`. Reopening the record later showed Enrollment Fee back at 0.
  // Generating the invoice now saves first, so what's on the printed
  // invoice is always what's actually on record.
  async function viewEnrollmentInvoice() {
    if (admin) await save()
    const courseNames = Array.from(new Set(
      allCourses
        .filter(function (c) { return registeredCourses.includes(c.id) })
        .map(function (c) { return c.group_name || c.name })
        .filter(Boolean)
    )).sort()
    printFranchiseeEnrollmentInvoice(
      Object.assign({}, franchisee, form, {
        enrollment_fee: Number(form.enrollment_fee) || 0,
        contract_start: form.enrollment_date || franchisee.contract_start || null,
      }),
      courseNames
    )
  }

  function field(k) {
    return function (e) { setForm(f => ({ ...f, [k]: e.target.value })) }
  }

  async function loadTab(t) {
    setTab(t)
    if (tabLoaded[t]) return
    setTabLoaded(tl => ({ ...tl, [t]: true }))

    if (t === 'orders') {
      const { data } = await sb.from('orders').select('id,invoice_no,created_at,status,amount_paid').eq('placer_id', franchisee.id).order('created_at', { ascending: false }).limit(20)
      setOrders(data || [])
    }
    if (t === 'students') {
      // select('*', ...) rather than an enumerated column list — the hand-picked
      // list this used to be was missing gender (and would silently miss
      // whatever's added next); StudentDetailModal reads directly off
      // whatever student.* it's handed, so any column left out here just
      // shows blank there, with no error to catch it.
      const { data } = await sb.from('students').select('*, enrollments(id, sku_id, fee_amount, list_price, waived, enrolled_at, completed_at, status, cert_emailed_at, cert_wa_sent_at, skus(level_name, total_sessions, courses(group_name, billing_type)))').eq('franchisee_id', franchisee.id).order('full_name').limit(50)
      setStudents(data || [])

      // Attended-session counts per enrollment, same as the main Students
      // page — needed for the same "3/15" progress badge in the Courses column.
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
    if (t === 'agreement') {
      const row = await loadLatestAgreement(franchisee.id)
      setAgreement(row)
    }
    if (t === 'schools') {
      const { data } = await sb.from('franchisees').select('*').eq('parent_id', franchisee.id).eq('tier', 'SCHOOL').order('business_name')
      setSchools(data || [])
    }
  }

  async function reloadSchools() {
    const { data } = await sb.from('franchisees').select('*').eq('parent_id', franchisee.id).eq('tier', 'SCHOOL').order('business_name')
    setSchools(data || [])
  }

  async function generateOrRefreshAgreement() {
    setAgreementBusy(true)
    try {
      const row = await generateAgreement(
        Object.assign({}, franchisee, form, {
          enrollment_fee: Number(form.enrollment_fee) || 0,
          registered_courses: registeredCourses,
        }),
        currentUser?.email
      )
      setAgreement(row)
      showToast('Agreement ' + row.agreement_no + ' generated ✓')
    } catch (err) {
      showToast('Could not generate agreement: ' + err.message, 'err')
    }
    setAgreementBusy(false)
  }

  async function sendAgreementForSignature() {
    if (!agreement) return
    if (!(form.email || franchisee.email)) {
      showToast('No email on file for this franchisee — BoldSign needs one to send the signing invite', 'err')
      return
    }
    setAgreementBusy(true)
    try {
      const pdfDataUrl = await buildAgreementPdfDataUrl(Object.assign({}, franchisee, form), agreement)
      const { data, error } = await sb.functions.invoke('boldsign-send', {
        body: { agreementId: agreement.id, pdfDataUrl },
      })
      if (error) throw error
      if (data?.error) throw new Error(typeof data.error === 'string' ? data.error : JSON.stringify(data.error))
      setAgreement(function (a) { return { ...a, status: 'sent', boldsign_document_id: data.documentId } })
      showToast('Sent for signature via BoldSign ✓ — ' + (form.email || franchisee.email) + ' will get a signing email')
    } catch (err) {
      showToast('Could not send for signature: ' + err.message, 'err')
    }
    setAgreementBusy(false)
  }

  function viewAgreement() {
    if (!agreement) return
    printFranchiseeAgreement(Object.assign({}, franchisee, form), agreement)
  }

  function downloadAgreementPdfFile() {
    if (!agreement) return
    downloadAgreementPdf(Object.assign({}, franchisee, form), agreement)
  }

  function toggleCourse(id) {
    setRegisteredCourses(rc =>
      rc.includes(id) ? rc.filter(x => x !== id) : [...rc, id]
    )
  }

  async function save() {
    setSaving(true)
    const payload = {
      owner_name: form.owner_name.trim(),
      business_name: form.name.trim() || form.owner_name.trim(),
      phone: form.phone.trim(),
      country: form.country.trim(),
      state: form.state.trim(),
      city: form.city.trim(),
      area: form.area.trim(),
      pincode: form.pincode.trim() || null,
      address: form.address.trim(),
      status: form.status,
      enrollment_fee: form.enrollment_fee === '' ? null : Number(form.enrollment_fee),
      fee_paid: form.fee_paid === '' ? null : Number(form.fee_paid),
      contract_start: form.enrollment_date || null,
      valid_till: form.valid_till || null,
      renewal_fee: form.renewal_fee === '' ? null : Number(form.renewal_fee),
      date_of_birth: form.date_of_birth || null,
      qualification: form.qualification.trim() || null,
    }
    payload.registered_courses = registeredCourses
    const { error } = await sb.from('franchisees').update(payload).eq('id', franchisee.id)
    setSaving(false)
    if (error) { showToast('Save failed: ' + error.message, 'err'); return }
    showToast('Saved')
    onSaved({ ...franchisee, ...payload })
  }

  const balance = (Number(form.enrollment_fee) || 0) - (Number(form.fee_paid) || 0)

  const rs = renewalStatus({ ...franchisee, ...form })

  // Tone index per course name (cycle through 8 tones) — same scheme as the
  // main Students page, scoped to this franchisee's own course list rather
  // than imported, since it's a closure over locally-loaded students.
  const courseList = [...new Set(students.flatMap(function (s) { return (s.enrollments || []).map(function (e) { return e.skus?.courses?.group_name }).filter(Boolean) }))]
  function courseTone(name) {
    const idx = courseList.indexOf(name)
    return (idx % 8) + 1
  }
  const monthEnd = daysLeftInMonth() <= 5

  async function resendAccess() {
    return resendAccessImpl()
  }

  async function changeEmail() {
    const ne = (newEmail || '').trim().toLowerCase()
    if (!ne || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ne)) { showToast('Enter a valid email address', 'warn'); return }
    if (ne === (form.email || '').toLowerCase()) { setChangingEmail(false); return }
    setSavingEmail(true)
    const { data: { session } } = await sb.auth.getSession()
    const res = await fetch('/api/change-user-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: 'Bearer ' + session.access_token } : {}) },
      body: JSON.stringify({ oldEmail: form.email, newEmail: ne, table: 'franchisees', rowId: franchisee.id }),
    })
    const data = await res.json().catch(function () { return {} })
    setSavingEmail(false)
    if (!res.ok || !data.success) { showToast('Email change failed: ' + (data.error || 'Unknown error'), 'err'); return }
    setForm(function (f) { return { ...f, email: ne } })
    setChangingEmail(false)
    setNewEmail('')
    onSaved({ ...franchisee, email: ne })
    showToast('Login email updated to ' + ne + ' ✓')
  }

  async function resendAccessImpl() {
    if (!franchisee.email) { showToast('No email on record', 'warn'); return }
    setResending(true)
    try {
      const { error } = await sb.auth.resetPasswordForEmail(franchisee.email, {
        redirectTo: 'https://nlh-platform.vercel.app',
      })
      if (error) throw error

      const displayName = franchisee.owner_name || franchisee.business_name || 'Partner'
      const tierMap = { SMF: 'State Master Franchisee', CF: 'City Franchisee', UF: 'Unit Franchisee' }
      const roleLabel = tierMap[franchisee.tier] || franchisee.tier

      // 1. Platform access email (password reset notice)
      await sendWelcomeEmail(
        franchisee.email, displayName,
        roleLabel.toLowerCase().replace(/ /g, '_'),
        '(see reset link in separate email)'
      )

      // 2. Dhiral's welcome letter with franchisee's registered courses
      const courseNames = (franchisee.registered_courses || [])
        .map(function (id) { return (allCourses || []).find(function (c) { return c.id === id }) })
        .filter(Boolean)
        .map(function (c) { return c.group_name || c.name })
        .filter(function (n, i, a) { return a.indexOf(n) === i }) // dedupe
      await sendFranchiseeWelcomeLetter(franchisee)

      showToast('Access sent to ' + franchisee.email + ' — welcome letter + reset link dispatched.')
    } catch (err) {
      showToast('Failed to send: ' + err.message, 'err')
    } finally {
      setResending(false)
    }
  }

  async function recordRenewal() {
    const newTill = new Date(rs.date)
    newTill.setFullYear(newTill.getFullYear() + 3)
    const newTillStr = newTill.toISOString().split('T')[0]
    const { error } = await sb.from('franchisees')
      .update({ valid_till: newTillStr })
      .eq('id', franchisee.id)
    if (error) { showToast('Renewal record failed: ' + error.message, 'err'); return }
    setForm(f => ({ ...f, valid_till: newTillStr }))
    showToast('Franchise renewed — valid till ' + newTillStr.split('-').reverse().join('.'))
  }

  return (
    <>
    <div className={inline ? '' : 'modal-bg'} onClick={inline ? undefined : (e => e.target === e.currentTarget && onClose())}>
      <div className={inline ? '' : 'modal'}
        style={inline ? { width: '100%', background: 'var(--card, #fff)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,.05)' } : undefined}>
        {/* ── HERO HEADER ── */}
        {(function () {
          var ts = {
            SMF: { bg: 'linear-gradient(135deg,#fffbeb,#fef3c7)', avBg: '#fef3c7', ac: '#b45309' },
            CF:  { bg: 'linear-gradient(135deg,#f0fdf4,#dcfce7)', avBg: '#dcfce7', ac: '#15803d' },
            UF:  { bg: 'linear-gradient(135deg,#eff6ff,#dbeafe)', avBg: '#dbeafe', ac: '#1d4ed8' },
          }[franchisee.tier] || { bg: 'linear-gradient(135deg,#f5f3ff,#ede9fe)', avBg: '#ede9fe', ac: '#6d28d9' }
          var av = (franchisee.business_name || franchisee.owner_name || '?')
            .split(' ').map(function (w) { return w[0] }).join('').slice(0, 2).toUpperCase()
          var loc = [franchisee.area, franchisee.city, franchisee.state].filter(Boolean).join(', ')
          return (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, padding: '18px 20px 14px', background: ts.bg, borderBottom: '1px solid var(--border)' }}>
              <div style={{ width: 50, height: 50, borderRadius: 13, flexShrink: 0, background: ts.avBg, color: ts.ac, display: 'flex', alignItems: 'center', justifyContent: 'center', font: '700 17px var(--font)' }}>{av}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', marginBottom: 2 }}>
                  <span style={{ font: '700 15px var(--font)', color: 'var(--text)' }}>{franchisee.business_name || franchisee.owner_name}</span>
                  <TierBadge tier={franchisee.tier} />
                  <StatusBadge status={franchisee.status} />
                </div>
                {franchisee.owner_name && franchisee.owner_name !== franchisee.business_name && (
                  <div style={{ font: '500 12px var(--font)', color: 'var(--text2)', marginBottom: 2 }}>{franchisee.owner_name}</div>
                )}
                {loc && <div style={{ font: '500 11px var(--font)', color: 'var(--text3)' }}>📍 {loc}</div>}
              </div>
              <button className="btn-icon" onClick={onClose} style={{ flexShrink: 0, marginTop: -2 }}>✕</button>
            </div>
          )
        })()}

        {/* ── STATS STRIP ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', background: 'var(--card)', borderBottom: '1px solid var(--border)' }}>
          {[
            { label: 'Students', val: studentCount === null ? '…' : String(studentCount), color: 'var(--purple)' },
            { label: 'Courses',  val: String(registeredCourses.length), color: 'var(--blue)' },
            { label: 'Validity', val: rs.isExpired ? 'Expired' : rs.isExpiring ? rs.daysLeft + 'd left' : 'Active', color: rs.isExpired ? 'var(--red)' : rs.isExpiring ? '#b45309' : 'var(--green)' },
            { label: 'Balance',  val: balance > 0 ? '₹' + fmtAmt(balance) : '✓ Cleared', color: balance > 0 ? 'var(--red)' : 'var(--green)' },
          ].map(function (st, i) {
            return (
              <div key={i} style={{ padding: '9px 14px', borderRight: i < 3 ? '1px solid var(--border)' : 'none' }}>
                <div style={{ font: '500 9px var(--mono)', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 3 }}>{st.label}</div>
                <div style={{ font: '700 14px var(--font)', color: st.color }}>{st.val}</div>
              </div>
            )
          })}
        </div>

        <div className="tabs">
          {(franchisee.tier === 'SCHOOL'
              // A school doesn't sign a Unit Franchise Agreement — it's a
              // CF's B2B customer, not a franchise business in its own right.
              ? ['info', 'courses', 'orders', 'students', 'ledger', 'cert']
              : ['info', 'courses', 'orders', 'students', 'ledger', 'cert', 'agreement']
                  .concat(franchisee.tier === 'CF' ? ['schools'] : [])
            ).map(t => (
            <button key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => loadTab(t)}>
              {t === 'cert' ? '📜 Certificate' : t === 'agreement' ? '📄 Agreement' : t === 'ledger' ? '💰 Accounts' : t === 'schools' ? '🏫 Schools' : t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        <div >

          {tab === 'info' && (
            <div className="form-grid">
              <label>Owner Name *
                <input value={form.owner_name} onChange={field('owner_name')} disabled={!admin} placeholder="Owner's full name" />
              </label>
              <label>Business / Centre Name
                <input value={form.name} onChange={field('name')} disabled={!admin} placeholder="Optional — e.g. Bright Minds Academy" />
              </label>
              <label>Email
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input value={form.email} disabled style={{ flex: 1 }} />
                  {admin && !changingEmail && (
                    <button type="button" className="btn-s" style={{ fontSize: 11, whiteSpace: 'nowrap' }}
                      onClick={function () { setNewEmail(form.email || ''); setChangingEmail(true) }}>✎ Change</button>
                  )}
                </div>
                {admin && changingEmail && (
                  <>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6 }}>
                      <input type="email" value={newEmail} onChange={function (e) { setNewEmail(e.target.value) }}
                        placeholder="new@email.com" style={{ flex: 1 }} autoFocus />
                      <button type="button" className="btn-p" style={{ fontSize: 11 }} onClick={changeEmail} disabled={savingEmail}>
                        {savingEmail ? 'Saving…' : 'Save'}
                      </button>
                      <button type="button" className="btn" style={{ fontSize: 11 }} disabled={savingEmail}
                        onClick={function () { setChangingEmail(false); setNewEmail('') }}>Cancel</button>
                    </div>
                    <p className="hint" style={{ marginTop: 4 }}>
                      Updates their login email everywhere (login, profile, certificates). They sign in with the new email next time; their password is unchanged.
                    </p>
                  </>
                )}
              </label>
              {admin && franchisee.tier !== 'SCHOOL' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <button
                    className="btn-s"
                    onClick={resendAccess}
                    disabled={resending}
                    style={{ fontSize: 12, whiteSpace: 'nowrap' }}
                  >
                    {resending ? 'Sending…' : '📧 Resend Login Access'}
                  </button>
                  <span style={{ fontSize: 11, color: 'var(--text3)' }}>
                    Sends a password reset link to the franchisee's email
                  </span>
                </div>
              )}
              <label>Phone
                <input value={form.phone} onChange={field('phone')} disabled={!admin} />
              </label>
              <LocationFields
                form={form}
                onChange={function(k, v) { setForm(function(f) { return { ...f, [k]: v } }) }}
                disabled={!admin}
              />
              <label>Area / Locality
                <input value={form.area} onChange={field('area')} disabled={!admin} placeholder="Sadar, Dharampeth…" />
              </label>
              <label>PIN Code
                <input value={form.pincode} onChange={field('pincode')} disabled={!admin} placeholder="e.g. 440001" />
              </label>
              <label className="col-span-2">Street / Building Address
                <input value={form.address} onChange={field('address')} disabled={!admin} placeholder="Shop no., building name, street" />
              </label>
              <label>Status
                <select value={form.status} onChange={field('status')} disabled={!admin}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="pending">Pending</option>
                </select>
              </label>
              <label>Date of Birth
                <input type="date" value={form.date_of_birth} onChange={field('date_of_birth')} disabled={!admin} />
              </label>
              <label>Qualification
                <input value={form.qualification} onChange={field('qualification')} disabled={!admin} placeholder="e.g. B.Ed, M.A. Education" />
              </label>
              <div className="col-span-2" style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 4, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ font: '700 10px var(--mono)', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.08em' }}>💰 Fee Tracking</span>
                <span style={{ display: 'flex', gap: 6 }}>
                  <button className="btn-s" onClick={viewEnrollmentInvoice} disabled={saving} style={{ fontSize: 11 }} title="Saves and prints the franchise enrollment invoice">
                    {saving ? 'Saving…' : '🧾 Invoice'}
                  </button>
                  {admin && balance > 0 && (
                    <>
                      <button className="btn-s" onClick={function () { setWaConfirm({ label: 'Send Fee Reminder', phone: franchisee.phone || '', send: sendFeeReminder }) }} style={{ fontSize: 11 }} title="Send a WhatsApp fee reminder to the franchisee">
                        💬 Send Reminder
                      </button>
                      <button className="btn-s" onClick={() => setShowPayModal(true)} style={{ fontSize: 11 }}>
                        📥 Record Payment
                      </button>
                    </>
                  )}
                </span>
              </div>
              <div className="col-span-2" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <label style={{ width: 130 }}>Enrollment Fee (₹)
                  <input type="number" value={form.enrollment_fee} onChange={field('enrollment_fee')} disabled={!admin} />
                </label>
                <label style={{ width: 130 }}>Fee Paid (₹)
                  <input value={'₹' + fmtAmt(Number(form.fee_paid) || 0)} disabled
                    style={{ color: 'var(--green)' }}
                    title="Maintained automatically from recorded payments — use “Record Payment” to add one" />
                </label>
                <label style={{ width: 150 }}>Enrollment Date
                  <input type="date" value={form.enrollment_date} onChange={field('enrollment_date')} disabled={!admin}
                    title="Defaults to the day access was granted — change it if the actual enrollment date differs" />
                </label>
                <label style={{ width: 130 }}>Balance
                  <input value={'₹' + fmtAmt(balance)} disabled style={{ color: balance > 0 ? 'var(--red)' : 'var(--green)' }} />
                </label>
              </div>

              {/* ── Payment History ── */}
              {payments.length > 0 && (
                <div className="col-span-2" style={{ marginTop: 4 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>
                    Payment History
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {payments.map(function (p) {
                      if (admin && editPayId === p.id) {
                        return (
                          <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', padding: '8px 10px', borderRadius: 7, background: '#fff', border: '1.5px solid var(--purple)' }}>
                            <input type="number" value={editPay.amount} onChange={function (e) { setEditPay(function (f) { return { ...f, amount: e.target.value } }) }}
                              placeholder="Amount" style={{ width: 90, fontSize: 12 }} />
                            <input type="date" value={editPay.payment_date} onChange={function (e) { setEditPay(function (f) { return { ...f, payment_date: e.target.value } }) }}
                              style={{ fontSize: 12 }} />
                            <select value={editPay.payment_mode} onChange={function (e) { setEditPay(function (f) { return { ...f, payment_mode: e.target.value } }) }} style={{ fontSize: 12 }}>
                              <option value="">— mode —</option>
                              {['UPI', 'Cash', 'Bank Transfer', 'Cheque', 'Card', 'Online'].concat(
                                editPay.payment_mode && !['UPI', 'Cash', 'Bank Transfer', 'Cheque', 'Card', 'Online'].includes(editPay.payment_mode) ? [editPay.payment_mode] : []
                              ).map(function (m) { return <option key={m} value={m}>{m}</option> })}
                            </select>
                            <input value={editPay.reference_no} onChange={function (e) { setEditPay(function (f) { return { ...f, reference_no: e.target.value } }) }}
                              placeholder="Reference / UTR" style={{ flex: 1, minWidth: 120, fontSize: 12 }} />
                            <button className="btn-p" style={{ fontSize: 11, padding: '4px 10px' }} onClick={savePaymentEdit}>Save</button>
                            <button className="btn-s" style={{ fontSize: 11, padding: '4px 10px' }} onClick={function () { setEditPayId(null) }}>Cancel</button>
                          </div>
                        )
                      }
                      return (
                        <div key={p.id} style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          padding: '7px 10px', borderRadius: 7,
                          background: '#f8f7ff', border: '1px solid #e8e6fb',
                          fontSize: 12,
                        }}>
                          <span style={{ fontWeight: 700, color: 'var(--green)', minWidth: 72 }}>
                            +₹{fmtAmt(p.amount)}
                          </span>
                          <span style={{ color: 'var(--text2)', minWidth: 80 }}>
                            {new Date(p.payment_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                          </span>
                          <span style={{ background: '#ede9fc', color: 'var(--purple)', borderRadius: 4, padding: '1px 6px', fontSize: 10, fontWeight: 600 }}>
                            {p.payment_mode || '—'}
                          </span>
                          {p.receipt_no && (
                            <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--purple)', fontWeight: 600 }}>
                              {p.receipt_no}
                            </span>
                          )}
                          {p.reference_no && (
                            <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text2)' }}>
                              {p.reference_no}
                            </span>
                          )}
                          {p.notes && (
                            <span style={{ color: 'var(--text3)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {p.notes}
                            </span>
                          )}
                          {admin && (
                            <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                              <button className="btn-s" style={{ fontSize: 10, padding: '2px 8px' }} title="Print this receipt"
                                onClick={function () { printPaymentReceipt(p) }}>🧾 Receipt</button>
                              <button className="btn-s" style={{ fontSize: 10, padding: '2px 8px', color: 'var(--green,#1D7A4F)' }}
                                title="Send this receipt on WhatsApp" disabled={waSendingId === p.id}
                                onClick={function () { setWaConfirm({ label: 'Send Payment Receipt', phone: franchisee.phone || '', send: function (phone) { return sendPaymentReceiptWA(p, phone) } }) }}>
                                {waSendingId === p.id ? '…' : '💬'}</button>
                              <button className="btn-s" style={{ fontSize: 10, padding: '2px 8px' }} title="Edit date / method / amount"
                                onClick={function () { startEditPay(p) }}>✎ Edit</button>
                              <button className="btn-s" style={{ fontSize: 10, padding: '2px 7px', color: 'var(--red,#dc2626)', borderColor: 'var(--red,#dc2626)' }} title="Delete entry"
                                onClick={function () { deletePaymentEntry(p) }}>🗑</button>
                            </span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* ── Validity & Renewal ── */}
              <div className="col-span-2" style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 4 }}>
                <span style={{ font: '700 10px var(--mono)', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.08em' }}>📅 Validity &amp; Renewal</span>
              </div>
              <div className="col-span-2" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <label style={{ width: 150 }}>Valid Till (date)
                  <input
                    type="date"
                    value={form.valid_till}
                    onChange={field('valid_till')}
                    disabled={!admin}
                  />
                </label>
                <label style={{ width: 170 }}>Custom Renewal Fee (₹)
                  <input
                    type="number"
                    value={form.renewal_fee}
                    onChange={field('renewal_fee')}
                    disabled={!admin}
                    placeholder={'Default: ₹' + (rs.fee != null ? fmtAmt(rs.fee) : '25% of fee paid')}
                  />
                </label>
              </div>
              <div className="col-span-2" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 2 }}>
                {/* Status badge */}
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700,
                  background: rs.isExpired ? 'var(--red-bg,#fef2f2)' : rs.isExpiring ? '#fffbeb' : 'var(--green-bg,#f0fdf4)',
                  color: rs.isExpired ? 'var(--red)' : rs.isExpiring ? '#92400e' : 'var(--green)',
                  border: '1px solid ' + (rs.isExpired ? 'var(--red)' : rs.isExpiring ? '#fbbf24' : 'var(--green)'),
                }}>
                  {rs.isExpired
                    ? `⚠ Expired ${Math.abs(rs.daysLeft)} days ago`
                    : rs.isExpiring
                      ? `⏳ Expiring in ${rs.daysLeft} days`
                      : `✓ Valid · ${rs.daysLeft} days left`}
                </span>
                <span style={{ font: '500 11px var(--mono)', color: 'var(--text3)' }}>
                  Till: {rs.date.toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' })}
                </span>
                {rs.fee != null && (
                  <span style={{ font: '500 11px var(--font)', color: 'var(--text2)' }}>
                    Renewal fee due: <strong style={{ color: 'var(--purple)' }}>₹{fmtAmt(rs.fee)}</strong>
                    {franchisee.renewal_fee == null ? ' (25% of fee paid)' : ' (custom)'}
                  </span>
                )}
                {admin && (rs.isExpired || rs.isExpiring) && (
                  <button
                    className="btn-s"
                    onClick={recordRenewal}
                    style={{ marginLeft: 'auto' }}
                  >
                    🔄 Record Renewal
                  </button>
                )}
              </div>
            </div>
          )}

          {tab === 'courses' && (
            <div>
              {/* Summary bar with progress */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 20px', background: 'var(--bg)', borderBottom: '1px solid var(--border)' }}>
                <span style={{ font: '500 12px var(--font)', color: 'var(--text2)', whiteSpace: 'nowrap' }}>
                  <b style={{ color: 'var(--text)' }}>{registeredCourses.length}</b> of <b style={{ color: 'var(--text)' }}>{allCourses.length}</b> courses
                </span>
                {allCourses.length > 0 && (
                  <div style={{ flex: 1, height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${Math.round(registeredCourses.length / allCourses.length * 100)}%`, background: 'var(--purple)', borderRadius: 2, transition: 'width .3s' }} />
                  </div>
                )}
              </div>
              <div style={{ padding: '14px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {(() => {
                  const groups = []
                  const seen = {}
                  allCourses.forEach(c => {
                    const g = c.group_name || 'Other'
                    if (!seen[g]) { seen[g] = []; groups.push({ name: g, courses: seen[g] }) }
                    seen[g].push(c)
                  })
                  return groups.map(group => {
                    const allChecked = group.courses.every(c => registeredCourses.includes(c.id))
                    const someChecked = group.courses.some(c => registeredCourses.includes(c.id))
                    const groupCount = group.courses.filter(c => registeredCourses.includes(c.id)).length
                    function toggleGroup() {
                      if (!admin) return
                      if (allChecked) {
                        setRegisteredCourses(prev => prev.filter(id => !group.courses.find(c => c.id === id)))
                      } else {
                        setRegisteredCourses(prev => [...new Set([...prev, ...group.courses.map(c => c.id)])])
                      }
                    }
                    return (
                      <div key={group.name} style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'var(--bg)', borderBottom: '1px solid var(--border)' }}>
                          <input
                            type="checkbox"
                            checked={allChecked}
                            ref={el => { if (el) el.indeterminate = someChecked && !allChecked }}
                            onChange={toggleGroup}
                            disabled={!admin}
                            style={{ accentColor: 'var(--purple)', width: 14, height: 14, cursor: admin ? 'pointer' : 'default', flexShrink: 0 }}
                          />
                          <span style={{ font: '600 12px var(--font)', color: 'var(--text)', flex: 1 }}>{group.name}</span>
                          <span style={{
                            font: '600 10px var(--mono)', padding: '2px 7px', borderRadius: 10,
                            background: groupCount > 0 ? '#ede9fe' : 'var(--bg4)',
                            color: groupCount > 0 ? 'var(--purple)' : 'var(--text3)',
                          }}>
                            {groupCount}/{group.courses.length}
                          </span>
                        </div>
                        <div className="checkbox-grid" style={{ padding: '8px 12px' }}>
                          {group.courses.map(c => (
                            <label key={c.id} className="checkbox-item">
                              <input
                                type="checkbox"
                                checked={registeredCourses.includes(c.id)}
                                onChange={() => admin && toggleCourse(c.id)}
                                disabled={!admin}
                              />
                              {c.name}
                            </label>
                          ))}
                        </div>
                      </div>
                    )
                  })
                })()}
              </div>
            </div>
          )}

          {tab === 'orders' && (
            <div>
              {orders.length > 0 && (
                <div style={{ display: 'flex', gap: 16, padding: '10px 20px', background: 'var(--bg)', borderBottom: '1px solid var(--border)', font: '500 12px var(--font)', color: 'var(--text2)' }}>
                  <span><b style={{ color: 'var(--text)' }}>{orders.length}</b> {orders.length === 1 ? 'order' : 'orders'}</span>
                  <span style={{ color: 'var(--green)' }}>₹{fmtAmt(orders.reduce(function (s, o) { return s + (o.amount_paid || 0) }, 0))} collected</span>
                </div>
              )}
              <div className="tbl-scroll">
                <table className="data-table">
                  <thead>
                    <tr><th>Invoice</th><th>Date</th><th>Status</th><th>Paid</th></tr>
                  </thead>
                  <tbody>
                    {orders.length === 0 && <tr><td colSpan={4} className="empty">No orders</td></tr>}
                    {orders.map(function (o) {
                      return (
                        <tr key={o.id}>
                          <td style={{ fontFamily: 'var(--mono)', fontSize: 11, color: o.invoice_no ? 'var(--text)' : 'var(--text3)' }}>
                            {o.invoice_no || '—'}
                          </td>
                          <td>{fmtDate(o.created_at)}</td>
                          <td><StatusBadge status={o.status} /></td>
                          <td>₹{fmtAmt(o.amount_paid)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === 'students' && (
            <div>
              {students.length > 0 && (
                <div style={{ display: 'flex', gap: 16, padding: '10px 20px', background: 'var(--bg)', borderBottom: '1px solid var(--border)', font: '500 12px var(--font)', color: 'var(--text2)' }}>
                  <span><b style={{ color: 'var(--text)' }}>{students.length}</b> {students.length === 1 ? 'student' : 'students'}</span>
                  <span style={{ color: 'var(--green)' }}>₹{fmtAmt(students.reduce(function (s, r) { return s + (r.fee_paid || 0) }, 0))} collected</span>
                  <span style={{ color: 'var(--text3)' }}>of ₹{fmtAmt(students.reduce(function (s, r) { return s + (r.fee_total || 0) }, 0))} charged</span>
                </div>
              )}
              <div className="tbl-scroll">
                <table className="data-table">
                  <thead>
                    <tr><th>Name</th><th>Course &amp; Level</th><th>Status</th><th>Fee Total</th><th>Fee Paid</th><th>Balance</th></tr>
                  </thead>
                  <tbody>
                    {students.length === 0 && <tr><td colSpan={6} className="empty">No students</td></tr>}
                    {students.map(function (s) {
                      const enrolled = (s.enrollments || []).filter(function (e) { return e.status !== 'discontinued' })
                      return (
                        <tr key={s.id} style={{ cursor: 'pointer' }} onClick={function () { setSelectedStudent(s) }}>
                          <td>{s.full_name}</td>
                          <td style={{ fontSize: 11 }}>
                            {enrolled.length === 0
                              ? <span style={{ color: 'var(--text3)' }}>None</span>
                              : enrolled.map(function (e) {
                                  const group = e.skus?.courses?.group_name || 'Course'
                                  const cn = group + (e.skus?.level_name ? ' — ' + e.skus.level_name : '')
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
                                    <span key={e.id} className={'stu-chip stu-chip-' + courseTone(group)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                                      <span>{cn}</span>
                                      <span style={{ color: color, background: bg, borderRadius: 10, padding: '0 6px', fontWeight: 600 }}>{txt}</span>
                                    </span>
                                  )
                                })
                            }
                          </td>
                          <td><StatusBadge status={s.payment_status} /></td>
                          <td>₹{fmtAmt(s.fee_total)}</td>
                          <td>₹{fmtAmt(s.fee_paid)}</td>
                          <td style={{ color: (s.fee_total - s.fee_paid) > 0 ? 'var(--red)' : 'var(--green)' }}>
                            ₹{fmtAmt((s.fee_total || 0) - (s.fee_paid || 0))}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === 'ledger' && (
            <div style={{ padding: 20 }}>
              <FranchiseeLedgerView franchiseeId={franchisee.id} franchiseeName={franchisee.business_name || franchisee.owner_name} />
            </div>
          )}

          {tab === 'cert' && (() => {
            // Show unique program/group names, not individual level names
            const courseNames = [...new Set(
              allCourses
                .filter(c => registeredCourses.includes(c.id))
                .map(c => c.group_name || c.name)
            )]
            const fr = { ...franchisee, ...form, cert_emailed_at: certEmailedAt }

            function tierLbl(f) {
              if (f.tier === 'SMF') return 'State Master Franchisee of'
              if (f.tier === 'CF')  return `${f.city || ''} City Master Franchisee of`
              return 'Unit Franchisee of'
            }
            // A school's authorization runs to the end of the current academic
            // year (30 April), not the 3-year franchise term — re-issued fresh
            // each year the school continues with NLH, not renewed multi-year.
            function schoolAcademicYearEnd() {
              const now = new Date()
              const aprilThisYear = new Date(now.getFullYear(), 3, 30)
              return now <= aprilThisYear ? aprilThisYear : new Date(now.getFullYear() + 1, 3, 30)
            }
            function vTill(f) {
              const d = f.valid_till
                ? new Date(f.valid_till)
                : f.tier === 'SCHOOL'
                  ? schoolAcademicYearEnd()
                  : (() => { const x = new Date(f.created_at || Date.now()); x.setFullYear(x.getFullYear() + 3); return x })()
              return [String(d.getDate()).padStart(2,'0'), String(d.getMonth()+1).padStart(2,'0'), d.getFullYear()].join('.')
            }
            // "the X Program" / "the X & Y Programs" — matches franchise-cert.html's
            // buildAuthorisationText so the on-screen preview and the printed
            // certificate always agree.
            function authorisationText(names) {
              if (!names.length) return 'and is authorized to conduct programs at its school premises.'
              const named = names.length === 1 ? names[0] : names.slice(0, -1).join(', ') + ' & ' + names[names.length - 1]
              const word  = names.length === 1 ? 'Program' : 'Programs'
              return `and is authorized to conduct the ${named} ${word} at its school premises.`
            }
            const isSchool = fr.tier === 'SCHOOL'
            const address = [fr.address, fr.area, fr.city, fr.state,
              fr.country && fr.country !== 'India' ? fr.country : null].filter(Boolean).join(', ')
            const location = [fr.city, fr.state].filter(Boolean).join(', ')
            const courses = courseNames.join(', ')
            const label   = tierLbl(fr)
            const till    = vTill(fr)
            const authText = authorisationText(courseNames)

            async function emailCert() {
              if (!fr.email) { showToast('No email on file for this franchisee', 'warn'); return }
              setCertEmailing(true)
              try {
                const res = await sendFranchiseeCertEmail(fr)
                if (!res.success) throw new Error(res.error || 'Send failed')
                await sb.from('franchisees').update({ cert_emailed_at: new Date().toISOString() }).eq('id', franchisee.id)
                const now = new Date().toISOString()
                setCertEmailedAt(now)
                showToast('Certificate emailed to ' + fr.email)
              } catch (err) { showToast('Email failed: ' + err.message, 'err') }
              setCertEmailing(false)
            }

            return (
              <div>
                {/* Preview card */}
                <div style={{
                  border: '2px solid var(--border)', borderRadius: 10,
                  background: 'linear-gradient(135deg,#fffef8 0%,#f8f6ff 100%)',
                  padding: '16px 20px', textAlign: 'center',
                  fontFamily: 'Arial,sans-serif', marginBottom: 12,
                }}>
                  {/* Logo + social row */}
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: 10 }}>
                    <img
                      src="/NLH Logo.png" alt="NLH"
                      style={{ height: 40, objectFit: 'contain' }}
                      onError={e => { e.target.style.display = 'none' }}
                    />
                    <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap: 2 }}>
                      <span style={{ fontSize: 9, color: '#534AB7' }}>📸 /newlearninghorizon</span>
                      <span style={{ fontSize: 9, color: '#534AB7' }}>📘 /nlhnag</span>
                      <span style={{ fontSize: 9, color: '#534AB7' }}>🌐 nlhnagpur.info</span>
                    </div>
                  </div>

                  <div style={{ fontSize: 13, fontWeight: 900, letterSpacing: 2, color: '#1A1916', marginBottom: 4 }}>
                    {isSchool ? 'CERTIFICATE OF AUTHORISATION' : 'FRANCHISE CERTIFICATE'}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 10 }}>This is to Certify that</div>
                  <div style={{ fontFamily: 'Georgia,serif', fontSize: 22, fontWeight: 700, color: '#CC0000', marginBottom: 2, lineHeight: 1.2 }}>
                    {fr.name || fr.business_name}
                  </div>
                  {fr.tier === 'SMF' && (
                    <div style={{ fontFamily: 'Georgia,serif', fontSize: 14, color: '#CC0000', marginBottom: 4 }}>{fr.state}</div>
                  )}
                  {isSchool && location && (
                    <div style={{ fontSize: 15, fontWeight: 700, color: '#1A1916', marginBottom: 4 }}>{location}</div>
                  )}
                  {isSchool ? (
                    <>
                      <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 8, marginBottom: 2 }}>is an Authorized</div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#CC0000', marginBottom: 5 }}>Program Partner of</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#1A1916', marginBottom: 5 }}>New Learning Horizons</div>
                      <div style={{ fontSize: 10, color: 'var(--text)', lineHeight: 1.5 }}>{authText}</div>
                    </>
                  ) : (
                    <>
                      <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 8, marginBottom: 2 }}>Is a Registered</div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#CC0000', marginBottom: 5 }}>{label}</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#1A1916', marginBottom: 4 }}>New Learning Horizons at</div>
                      <div style={{ fontSize: 10, color: 'var(--text2)', marginBottom: courses ? 4 : 0 }}>{address}</div>
                      {courses && <div style={{ fontSize: 10, color: 'var(--text)', lineHeight: 1.5, marginBottom: 2 }}>for {courses}</div>}
                    </>
                  )}

                  {/* Footer: sig | valid till | mascot */}
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-end', marginTop:12, paddingTop:10, borderTop:'1px dashed var(--border)' }}>
                    <div style={{ textAlign:'left' }}>
                      <img
                        src="/DRP Signature.png" alt="Signature"
                        style={{ height: 32, objectFit: 'contain', display: 'block', marginBottom: 2 }}
                        onError={e => { e.target.style.display = 'none' }}
                      />
                      <div style={{ fontSize: 11, fontStyle:'italic', color:'#1A1916', fontWeight: 600 }}>Dhiral Panchmatia</div>
                      <div style={{ fontSize: 9, color:'var(--text3)' }}>Founder, NLH</div>
                    </div>
                    <div style={{ textAlign:'center' }}>
                      <div style={{ fontSize: 9, color:'var(--text3)' }}>Valid Till</div>
                      <div style={{ fontSize: 11, fontWeight: 700 }}>{till}</div>
                    </div>
                    <div>
                      <img
                        src="/NLH Mascot.png" alt=""
                        style={{ height: 52, objectFit: 'contain' }}
                        onError={e => { e.target.style.display = 'none' }}
                      />
                    </div>
                  </div>
                </div>

                {certEmailedAt
                  ? <p className="hint" style={{ color: 'var(--green)' }}>
                      ✓ Certificate emailed to <strong>{fr.email}</strong> on {new Date(certEmailedAt).toLocaleDateString('en-IN')}
                    </p>
                  : fr.email
                    ? <p className="hint">Ready to send to: <strong>{fr.email}</strong></p>
                    : <p className="hint" style={{ color: 'var(--red)' }}>⚠ No email on file — cannot send.</p>
                }

                <div style={{ display:'flex', gap:8, marginTop:8 }}>
                  <button className="btn-s" onClick={() => printFranchiseeCert(fr, courseNames)}>
                    🖨️ Print / PDF
                  </button>
                  <button className="btn-p" onClick={emailCert} disabled={certEmailing || !fr.email}>
                    {certEmailing ? 'Sending…' : certEmailedAt ? '📧 Re-send Certificate' : '📧 Email Certificate'}
                  </button>
                </div>
              </div>
            )
          })()}

          {tab === 'agreement' && (
            <div>
              {!agreement && (
                <p className="hint">No Unit Franchise Agreement generated yet for this franchisee.</p>
              )}
              {agreement && (
                <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '14px 18px', marginBottom: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <span style={{ font: '700 13px var(--font)' }}>{agreement.agreement_no}</span>
                    <span className={`badge ${agreement.status === 'signed' ? 'ba' : 'bp'}`}>
                      {agreement.status === 'signed' ? '✓ Signed' : agreement.status === 'sent' ? 'Sent' : 'Draft'}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text3)', lineHeight: 1.7 }}>
                    Fee: <strong style={{ color: 'var(--text)' }}>₹{fmtAmt(agreement.fee)}</strong> &middot;
                    {' '}Term: <strong style={{ color: 'var(--text)' }}>{fmtDate(agreement.term_start)} – {fmtDate(agreement.term_end)}</strong><br/>
                    {agreement.status === 'signed'
                      ? <>Signed via BoldSign by <strong style={{ color: 'var(--text)' }}>{agreement.signed_name}</strong> on {fmtDate(agreement.signed_at)}</>
                      : agreement.status === 'sent'
                        ? <>Sent to <strong style={{ color: 'var(--text)' }}>{form.email || franchisee.email}</strong> for signature via BoldSign — waiting on them to sign.</>
                        : 'Not sent yet.'}
                  </div>
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {admin && (
                  <button className="btn-s" onClick={generateOrRefreshAgreement} disabled={agreementBusy}>
                    {agreementBusy
                      ? 'Generating…'
                      : !agreement
                        ? '📄 Generate Agreement'
                        : agreement.status === 'draft'
                          ? '🔁 Regenerate'
                          : '🆕 New Agreement'}
                  </button>
                )}
                {agreement && (
                  <button className="btn-p" onClick={viewAgreement}>🖨️ View / Print</button>
                )}
                {agreement && agreement.status === 'draft' && (
                  <button className="btn-s" onClick={downloadAgreementPdfFile}>⬇ Download PDF for BoldSign</button>
                )}
                {admin && agreement && agreement.status === 'draft' && (
                  <button className="btn-p" onClick={sendAgreementForSignature} disabled={agreementBusy} title="Requires a Live BoldSign API key — currently sandbox">
                    {agreementBusy ? 'Sending…' : '📤 Send via BoldSign API'}
                  </button>
                )}
              </div>
              {agreement && agreement.status === 'draft' && (
                <p className="hint" style={{ marginTop: 8 }}>
                  Download the PDF, then in BoldSign click <strong>Create New → Send a Document</strong>, upload it, and send to <strong>{form.email || franchisee.email}</strong> —
                  keep the document title exactly as <strong>"Unit Franchise Agreement — {franchisee.business_name || franchisee.owner_name} ({agreement.agreement_no})"</strong> so this app can match it and update the status automatically once signed.
                  Regenerating creates a fresh draft with a new agreement number.
                </p>
              )}
            </div>
          )}

          {tab === 'schools' && (
            <div style={{ padding: '4px 20px 16px' }}>
              <p className="hint" style={{ marginBottom: 12 }}>
                Schools this CF brings in — each works like a UF (its own students,
                enrollments, certificates, courses), except HO bills the school directly
                and this CF earns a per-kit commission (set per school, per SKU) instead
                of the usual franchise fee/order model. Click a row to open it fully.
              </p>
              {schools.length === 0 ? (
                <p style={{ color: 'var(--text3)', fontSize: 13 }}>No schools added yet.</p>
              ) : (
                <div className="tbl-scroll">
                  <table className="data-table">
                    <thead>
                      <tr><th>School</th><th>City</th><th>Status</th><th></th></tr>
                    </thead>
                    <tbody>
                      {schools.map(function (s) {
                        return (
                          <tr key={s.id} style={{ cursor: 'pointer' }} onClick={function () { setViewingSchool(s) }}>
                            <td>{s.business_name}</td>
                            <td>{s.city || '—'}</td>
                            <td><span className={'badge ' + (s.status === 'active' ? 'ba' : 'bp')}>{s.status}</span></td>
                            <td><button className="btn-s" style={{ fontSize: 11 }} onClick={function (e) { e.stopPropagation(); setRatesForSchool(s) }}>Kit Rates</button></td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <button className="btn-p" style={{ marginTop: 12 }} onClick={function () { setShowAddSchool(true) }}>+ Add School</button>
            </div>
          )}
        </div>

        {admin && (tab === 'info' || tab === 'courses') && (
          <div className="modal-actions">
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn-p" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        )}
      </div>
    </div>

    {selectedStudent && (
      <StudentDetailModal
        student={selectedStudent}
        onClose={function () { setSelectedStudent(null) }}
        onSaved={function (updated) {
          setSelectedStudent(null)
          setStudents(function (prev) { return prev.map(function (s) { return s.id === updated.id ? { ...s, ...updated } : s }) })
        }}
      />
    )}

    {showAddSchool && (
      <AddSchoolModal
        cfFranchiseeId={franchisee.id}
        onClose={function () { setShowAddSchool(false) }}
        onSaved={function () { setShowAddSchool(false); reloadSchools() }}
      />
    )}

    {ratesForSchool && (
      <SchoolRatesModal
        school={ratesForSchool}
        admin={admin}
        onClose={function () { setRatesForSchool(null) }}
      />
    )}

    {viewingSchool && (
      <FranchiseeDetailModal
        franchisee={viewingSchool}
        allCourses={allCourses}
        onClose={function () { setViewingSchool(null) }}
        onSaved={function (updated) {
          const wasId = viewingSchool.id
          setViewingSchool(null)
          setSchools(function (prev) {
            if (updated === null) return prev.filter(function (s) { return s.id !== wasId })
            return prev.map(function (s) { return s.id === updated.id ? { ...s, ...updated } : s })
          })
        }}
      />
    )}

    {showPayModal && (
      <RecordFranchiseePaymentModal
        franchisee={{ ...franchisee, fee_paid: Number(form.fee_paid) || 0 }}
        balance={balance}
        currentUser={currentUser?.email}
        onSaved={function (newFeePaid) {
          setForm(f => ({ ...f, fee_paid: String(newFeePaid) }))
          setShowPayModal(false)
          sb.from('franchisee_payments')
            .select('id,amount,payment_date,payment_mode,reference_no,notes,recorded_by,created_at,receipt_no')
            .eq('franchisee_id', franchisee.id)
            .order('payment_date', { ascending: false })
            .then(function ({ data }) { setPayments(data || []) })
        }}
        onClose={function () { setShowPayModal(false) }}
      />
    )}

    {waConfirm && <WhatsAppSendConfirm {...waConfirm} onClose={function () { setWaConfirm(null) }} />}
    </>
  )
}

// ── AddFranchiseeModal ─────────────────────────────────────────────────────────

function AddFranchiseeModal({ onClose, onSaved }) {
  const [form, setForm] = useState({
    name: '', owner_name: '', email: '', phone: '',
    country: 'India', state: '', city: '', area: '', pincode: '', address: '',
    tier: 'UF', parent_id: '',
  })
  const [parentOptions, setParentOptions] = useState([])
  const [saving, setSaving] = useState(false)
  const [allCourses, setAllCourses] = useState([])

  useEffect(() => {
    sb.from('courses').select('id,name,group_name').order('group_name').order('name').then(({ data }) => setAllCourses(data || []))
  }, [])

  useEffect(() => {
    if (!form.tier) return
    if (form.tier === 'SMF') { setParentOptions([]); return }

    if (form.tier === 'CF') {
      // CF sits under SMF
      sb.from('franchisees').select('id,business_name,city,state,country,tier').eq('tier', 'SMF').eq('status', 'active').order('business_name')
        .then(({ data }) => setParentOptions(data || []))
      return
    }

    // UF: prefer CF → fall back to SMF → fall back to NLH HO
    Promise.all([
      sb.from('franchisees').select('id,business_name,city,state,country,tier').eq('tier', 'CF').eq('status', 'active').order('business_name'),
      sb.from('franchisees').select('id,business_name,city,state,country,tier').eq('tier', 'SMF').eq('status', 'active').order('business_name'),
      sb.from('franchisees').select('id,business_name,city,state,country,tier').eq('tier', 'NLH').single(),
    ]).then(([cfs, smfs, nlh]) => {
      setParentOptions([
        ...(cfs.data || []),
        ...(smfs.data || []),
        ...(nlh.data ? [nlh.data] : []),
      ])
    })
  }, [form.tier])

  function field(k) {
    return function (e) { setForm(f => ({ ...f, [k]: e.target.value })) }
  }

  async function save() {
    if (!form.owner_name.trim()) { showToast('Owner name is required', 'warn'); return }
    if (!form.email.trim()) { showToast('Email is required', 'warn'); return }
    if ((form.tier === 'UF' || form.tier === 'CF') && !form.parent_id) {
      showToast(`Please select a parent franchisee for this ${form.tier}`, 'warn'); return
    }

    // Territory check — country-aware
    if (form.tier === 'SMF' || form.tier === 'CF') {
      const country = (form.country || 'India').trim()
      const isIndia = country.toLowerCase() === 'india'

      if (form.tier === 'SMF') {
        // India: 1 SMF per state. International: 1 SMF per country.
        if (isIndia && !form.state.trim()) { showToast('State is required for an Indian SMF', 'warn'); return }
        let dupQ = sb.from('franchisees').select('id,business_name').eq('tier', 'SMF').ilike('country', country).eq('status', 'active')
        if (isIndia) dupQ = dupQ.ilike('state', form.state.trim())
        const { data: existing } = await dupQ
        if (existing && existing.length > 0) {
          const territory = isIndia ? form.state.trim() : country
          showToast(`An active SMF already exists for ${territory}: ${existing[0].business_name}`, 'warn')
          return
        }
      } else { // CF
        if (!form.city.trim()) { showToast('City is required for CF', 'warn'); return }
        const { data: existing } = await sb.from('franchisees')
          .select('id,business_name').eq('tier', 'CF').ilike('country', country).ilike('city', form.city.trim()).eq('status', 'active')
        if (existing && existing.length > 0) {
          showToast(`An active CF already exists in ${form.city} (${country}): ${existing[0].business_name}`, 'warn')
          return
        }
      }
    }

    setSaving(true)
    const tempPass = genTempPass()

    try {
      // SMF and CF automatically get all courses; UF starts with none
      let defaultCourses = null
      if (form.tier === 'SMF' || form.tier === 'CF') {
        const { data: allCrs } = await sb.from('courses').select('id').eq('is_active', true)
        defaultCourses = (allCrs || []).map(c => c.id)
      }

      // Contract term starts today, runs 3 years (matches the franchise agreement
      // generator's own +3 years / -1 day convention — see franchiseeAgreement.js)
      const contractStart = new Date().toISOString().slice(0, 10)
      const contractEndDate = new Date(contractStart + 'T00:00:00')
      contractEndDate.setFullYear(contractEndDate.getFullYear() + 3)
      contractEndDate.setDate(contractEndDate.getDate() - 1)
      const contractEnd = contractEndDate.toISOString().slice(0, 10)

      // Insert franchisee
      const { data: fr, error: frErr } = await sb.from('franchisees').insert({
        owner_name: form.owner_name.trim(),
        business_name: form.name.trim() || form.owner_name.trim(),
        email: form.email.trim().toLowerCase(),
        phone: form.phone.trim(),
        country: form.country.trim(),
        state: form.state.trim(),
        city: form.city.trim(),
        area: form.area.trim(),
        pincode: form.pincode.trim() || null,
        address: form.address.trim(),
        tier: form.tier,
        parent_id: form.parent_id || null,
        status: 'active',
        registered_courses: defaultCourses,
        contract_start: contractStart,
        contract_end: contractEnd,
      }).select().single()

      if (frErr) { showToast('Failed to create franchisee: ' + frErr.message, 'err'); setSaving(false); return }

      // Create auth account server-side — no session displacement
      const roleMap = { SMF: 'smf', CF: 'cf', UF: 'uf' }
      const { data: { session: admSess } } = await sb.auth.getSession()
      const createRes = await fetch('/api/create-user', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(admSess ? { Authorization: `Bearer ${admSess.access_token}` } : {}),
        },
        body: JSON.stringify({
          email:    form.email.trim().toLowerCase(),
          password: tempPass,
          fullName: form.owner_name.trim(),
          role:     roleMap[form.tier] || 'uf',
          franchiseeId: fr.id,
        }),
      })
      const createData = await createRes.json()
      if (!createData.success && !createData.error?.includes('already registered')) {
        // Login account was NOT created — do not proceed. Continuing here
        // would leave a franchisee record + welcome email with credentials
        // that can never actually log in (the exact bug this guards against).
        showToast('Franchisee record saved, but login account creation failed: ' + (createData.error || 'Unknown error') + '. Fix the issue and use "Resend Login Access" once available, or contact support.', 'err')
        setSaving(false)
        return
      }

      // Insert user record
      await sb.from('users').upsert({
        email: form.email.trim().toLowerCase(),
        full_name: form.owner_name.trim(),
        role: roleMap[form.tier] || 'uf',
        franchisee_id: fr.id,
      }, { onConflict: 'email' })

      // 1. Platform access email (credentials + login)
      await sendWelcomeEmail(form.email.trim(), form.owner_name.trim() || form.name.trim(), form.tier, tempPass)

      // 2. Dhiral's personalised welcome letter
      const courseNames = (form.tier === 'SMF' || form.tier === 'CF')
        ? allCourses.map(function (c) { return c.group_name || c.name }).filter(function (n, i, a) { return a.indexOf(n) === i })
        : [] // UF starts with no courses; letter will show "To be assigned"
      await sendFranchiseeWelcomeLetter(fr)

      showToast('Franchisee created. Credentials sent via email.')
      onSaved(fr)
    } catch (err) {
      showToast('Unexpected error: ' + err.message, 'err')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-bg" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <ModalHeader flush title="Add Franchisee" subtitle="New Learning Horizons · Partner onboarding" onClose={onClose} />
        <div >
          <div className="form-grid">
            <label>Owner Name *
              <input value={form.owner_name} onChange={field('owner_name')} placeholder="Owner's full name" />
            </label>
            <label>Business / Centre Name
              <input value={form.name} onChange={field('name')} placeholder="Optional — e.g. Bright Minds Academy" />
            </label>
            <label>Email *
              <input type="email" value={form.email} onChange={field('email')} placeholder="login@email.com" />
            </label>
            <label>Phone
              <input value={form.phone} onChange={field('phone')} placeholder="10-digit mobile" />
            </label>
            <label>Tier *
              <select value={form.tier} onChange={field('tier')}>
                <option value="SMF">SMF — State Master Franchisee</option>
                <option value="CF">CF — City Franchisee</option>
                <option value="UF">UF — Unit Franchisee</option>
              </select>
            </label>
            {form.tier !== 'SMF' && (
              <label>Parent {form.tier === 'CF' ? 'SMF' : 'Franchisee'} *
                <select value={form.parent_id} onChange={field('parent_id')}>
                  <option value="">— Select —</option>
                  {parentOptions.map(p => (
                    <option key={p.id} value={p.id}>
                      [{p.tier}] {p.business_name} ({p.city || p.state || p.country}{p.country && p.country !== 'India' ? ' · ' + p.country : ''})
                    </option>
                  ))}
                </select>
              </label>
            )}
              <LocationFields
                form={form}
                onChange={function(k, v) { setForm(function(f) { return { ...f, [k]: v } }) }}
                disabled={false}
              />
            <label>Area / Locality
              <input value={form.area} onChange={field('area')} placeholder="Sadar, Dharampeth…" />
            </label>
            <label>PIN Code
              <input value={form.pincode} onChange={field('pincode')} placeholder="e.g. 440001" />
            </label>
            <label className="col-span-2">Street / Building Address
              <input value={form.address} onChange={field('address')} placeholder="Shop no., building name, street" />
            </label>
          </div>
          <p className="hint" style={{ marginTop: 12 }}>
            A login account will be created and a welcome email with temp password will be sent.
          </p>
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn-p" onClick={save} disabled={saving}>
            {saving ? 'Creating…' : 'Create Franchisee'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── AddSchoolModal — CF adds an institutional customer it services ─────────────
function AddSchoolModal({ cfFranchiseeId, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: '', contact_name: '', phone: '', email: '',
    address: '', area: '', city: '', state: '', country: 'India', pincode: '', gstin: '',
  })
  const [saving, setSaving] = useState(false)

  function field(k) { return function (e) { setForm(f => ({ ...f, [k]: e.target.value })) } }

  async function save() {
    if (!form.name.trim()) { showToast('School name is required', 'warn'); return }
    // franchisees.phone/email/city/state are all NOT NULL — every other
    // franchisee row already requires these, a school is no different.
    if (!form.phone.trim()) { showToast('Phone is required', 'warn'); return }
    if (!form.email.trim()) { showToast('Email is required', 'warn'); return }
    if (!form.city.trim()) { showToast('City is required', 'warn'); return }
    if (!form.state.trim()) { showToast('State is required', 'warn'); return }
    setSaving(true)
    // A school is a real franchisee row (tier SCHOOL, parented under this CF)
    // so it gets students/enrollments/courses/orders for free — no login is
    // created (the CF manages it), no enrollment_fee (schools don't pay a
    // franchise fee — see the ledger, which only debits a fee line when
    // enrollment_fee > 0), and it starts with no registered_courses, same
    // as a fresh UF, so admin/CF has to explicitly enable levels for it.
    const { error } = await sb.from('franchisees').insert({
      tier: 'SCHOOL',
      parent_id: cfFranchiseeId,
      business_name: form.name.trim(),
      owner_name: form.contact_name.trim() || form.name.trim(),
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      address: form.address.trim() || null,
      area: form.area.trim() || null,
      city: form.city.trim() || null,
      state: form.state.trim() || null,
      country: form.country.trim() || 'India',
      pincode: form.pincode.trim() || null,
      gstin: form.gstin.trim() || null,
      status: 'active',
      registered_courses: [],
    })
    setSaving(false)
    if (error) { showToast('Failed to add school: ' + error.message, 'err'); return }
    showToast('School added ✓')
    onSaved()
  }

  return (
    <div className="modal-bg" onClick={function (e) { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ maxWidth: 480 }}>
        <ModalHeader flush title="Add School" subtitle="A CF-serviced institutional customer" onClose={onClose} />
        <div className="form-grid" style={{ padding: '4px 20px 16px' }}>
          <label>School Name *
            <input value={form.name} onChange={field('name')} placeholder="e.g. St. Xavier's High School" />
          </label>
          <label>Point of Contact
            <input value={form.contact_name} onChange={field('contact_name')} placeholder="Contact person at the school" />
          </label>
          <label>Phone *
            <input value={form.phone} onChange={field('phone')} />
          </label>
          <label>Email *
            <input value={form.email} onChange={field('email')} />
          </label>
          <label>GSTIN
            <input value={form.gstin} onChange={field('gstin')} />
          </label>
          <LocationFields
            form={form}
            onChange={function (k, v) { setForm(function (f) { return { ...f, [k]: v } }) }}
            disabled={false}
          />
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn-p" onClick={save} disabled={saving}>{saving ? 'Adding…' : 'Add School'}</button>
        </div>
      </div>
    </div>
  )
}

// ── SchoolRatesModal — per-SKU price + CF commission for one school ────────────
// Rate/cut are set once here and reused on every future order for this school
// (order_items snapshots cf_commission_rate at order time). Admin-only to
// write — a CF setting their own commission would be a conflict of interest;
// the CF can still open this to see what's agreed.
function SchoolRatesModal({ school, admin, onClose }) {
  const [skus, setSkus] = useState([])
  const [rates, setRates] = useState({})     // { [sku_id]: { rate, cf_cut, _rowId } }
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(function () {
    async function load() {
      const [skuRes, rateRes] = await Promise.all([
        sb.from('skus').select('id, level_name, courses(group_name)').order('sort_order'),
        sb.from('school_sku_rates').select('*').eq('franchisee_id', school.id),
      ])
      setSkus(skuRes.data || [])
      const m = {}
      ;(rateRes.data || []).forEach(function (r) { m[r.sku_id] = { rate: String(r.rate), cf_cut: String(r.cf_cut), _rowId: r.id } })
      setRates(m)
      setLoading(false)
    }
    load()
  }, [school.id])

  function setRate(skuId, field, val) {
    setRates(function (prev) {
      return { ...prev, [skuId]: { ...(prev[skuId] || { rate: '', cf_cut: '' }), [field]: val } }
    })
  }

  async function saveAll() {
    setSaving(true)
    const rows = Object.entries(rates)
      .filter(function ([, v]) { return v.rate !== '' || v.cf_cut !== '' })
      .map(function ([skuId, v]) {
        return { franchisee_id: school.id, sku_id: skuId, rate: parseInt(v.rate, 10) || 0, cf_cut: parseInt(v.cf_cut, 10) || 0 }
      })
    const { error } = await sb.from('school_sku_rates').upsert(rows, { onConflict: 'franchisee_id,sku_id' })
    setSaving(false)
    if (error) { showToast('Failed to save rates: ' + error.message, 'err'); return }
    showToast('Kit rates saved ✓')
    onClose()
  }

  const grouped = skus.reduce(function (acc, s) {
    const c = s.courses?.group_name || 'Other'
    if (!acc[c]) acc[c] = []
    acc[c].push(s)
    return acc
  }, {})

  return (
    <div className="modal-bg" onClick={function (e) { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal modal-lg" style={{ maxWidth: 640, display: 'flex', flexDirection: 'column', maxHeight: '86vh' }}>
        <ModalHeader flush title={'Kit Rates — ' + school.business_name}
          subtitle={admin ? 'Price billed to the school, and this CF\'s commission, per kit' : 'View only — set by admin'}
          onClose={onClose} />
        <div style={{ padding: '4px 20px 16px', overflowY: 'auto' }}>
          {loading ? <div className="muted">Loading…</div> : (
            <div className="tbl-scroll">
              <table className="data-table">
                <thead>
                  <tr><th>Course / Level</th><th style={{ textAlign: 'right' }}>Rate to School</th><th style={{ textAlign: 'right' }}>CF Cut</th></tr>
                </thead>
                <tbody>
                  {Object.entries(grouped).map(function ([course, list]) {
                    return list.map(function (s, i) {
                      const r = rates[s.id] || { rate: '', cf_cut: '' }
                      return (
                        <tr key={s.id}>
                          <td style={{ fontSize: 12 }}>{i === 0 && <span style={{ font: '700 10px var(--mono)', color: 'var(--purple)', display: 'block' }}>{course}</span>}{s.level_name}</td>
                          <td style={{ textAlign: 'right' }}>
                            <input type="number" min={0} value={r.rate} disabled={!admin}
                              onChange={function (e) { setRate(s.id, 'rate', e.target.value) }}
                              style={{ width: 90, textAlign: 'right', fontSize: 12 }} placeholder="0" />
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <input type="number" min={0} value={r.cf_cut} disabled={!admin}
                              onChange={function (e) { setRate(s.id, 'cf_cut', e.target.value) }}
                              style={{ width: 90, textAlign: 'right', fontSize: 12 }} placeholder="0" />
                          </td>
                        </tr>
                      )
                    })
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="hint" style={{ marginTop: 10 }}>
            Only SKUs with a Rate to School set here will be orderable for this school. Leave both
            blank for a kit this school isn't buying.
          </p>
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>{admin ? 'Cancel' : 'Close'}</button>
          {admin && (
            <button className="btn-p" onClick={saveAll} disabled={saving || loading}>{saving ? 'Saving…' : 'Save Rates'}</button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── FranchiseesPage ────────────────────────────────────────────────────────────

export default function FranchiseesPage() {
  const { currentRole, currentFranchiseeId } = useAuth()
  const admin = isAdminRole(currentRole)

  const [franchisees, setFranchisees] = useState([])
  const [allCourses, setAllCourses] = useState([])
  const [loading, setLoading]       = useState(true)
  const [search, setSearch]         = useState('')
  const [exporting, setExporting]   = useState(false)
  const [selected, setSelected] = useState(null)
  const [showAdd, setShowAdd] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const [exportFieldKeys, setExportFieldKeys] = useState(function () {
    return EXPORT_FIELDS.filter(function (f) { return f.checkedByDefault }).map(function (f) { return f.key })
  })
  const [exportTiers, setExportTiers] = useState(['NLH', 'SMF', 'CF', 'UF'])
  const [pageTab, setPageTab] = useState('list')   // 'list' | 'invoices'

  useEffect(() => {
    if (currentRole === null) return  // wait until auth resolves
    async function load() {
      setLoading(true)
      const courseResult = await sb.from('courses').select('id,name,group_name').order('group_name').order('name')
      if (courseResult.error) console.error('Courses load error:', courseResult.error)
      setAllCourses(courseResult.data || [])

      if (admin) {
        // Admin sees all franchisees
        const { data, error } = await sb.from('franchisees').select('*').order('city').order('business_name')
        if (error) console.error('Franchisees load error:', error)
        setFranchisees(sortFranchisees(data || []))
      } else {
        // SMF / CF / UF: show own centre + full descendant tree
        if (!currentFranchiseeId) { setLoading(false); return }
        const treeIds = await getTreeIds(currentFranchiseeId)
        const { data, error } = await sb
          .from('franchisees')
          .select('*')
          .in('id', treeIds)
          .order('city')
          .order('business_name')
        if (error) console.error('Franchisees load error:', error)
        setFranchisees(sortFranchisees(data || []))
      }
      setLoading(false)
    }
    load()
  }, [admin, currentRole, currentFranchiseeId])

  const filtered = franchisees.filter(f => {
    const q = search.toLowerCase()
    return !q || f.business_name?.toLowerCase().includes(q) || f.owner_name?.toLowerCase().includes(q) || f.city?.toLowerCase().includes(q) || f.state?.toLowerCase().includes(q) || f.country?.toLowerCase().includes(q)
  })

  function handleSaved(updated) {
    setFranchisees(fs => fs.map(f => f.id === updated.id ? { ...f, ...updated } : f))
    setSelected(s => s && s.id === updated.id ? { ...s, ...updated } : s)
  }

  function handleAdded(fr) {
    setFranchisees(fs => sortFranchisees([...fs, fr]))
    setShowAdd(false)
  }

  const [tierFilter, setTierFilter] = useState('all')

  const tierFiltered = filtered.filter(function (f) {
    if (tierFilter === 'all') return true
    return (f.tier || '').toLowerCase() === tierFilter
  })

  const counts = {
    all: filtered.length,
    smf: filtered.filter(function (f) { return f.tier === 'SMF' }).length,
    cf:  filtered.filter(function (f) { return f.tier === 'CF' }).length,
    uf:  filtered.filter(function (f) { return f.tier === 'UF' }).length,
    school: filtered.filter(function (f) { return f.tier === 'SCHOOL' }).length,
  }

  // "Partners" excludes NLH HQ's own row (it's the franchisor, not a partner)
  // and — like the SMF/CF/UF breakdown above — respects the active search,
  // so the subtitle and the Total Partners stat card always agree and both
  // move together when searching, instead of the stat card staying pinned
  // to the full unfiltered count.
  const partnerCount = admin
    ? filtered.filter(function (f) { return f.tier !== 'NLH' }).length
    : filtered.filter(function (f) { return f.id !== currentFranchiseeId }).length

  const totalOutstanding = franchisees.reduce(function (sum, f) {
    const bal = (Number(f.enrollment_fee) || 0) - (Number(f.fee_paid) || 0)
    return sum + (bal > 0 ? bal : 0)
  }, 0)

  // Enrollment invoices list (see "Enrollment Invoices" tab) — every
  // franchisee that's actually been charged an enrollment fee, newest first.
  const enrollmentInvoices = franchisees
    .filter(function (f) { return (Number(f.enrollment_fee) || 0) > 0 })
    .slice()
    .sort(function (a, b) { return (b.enrollment_invoice_no || '').localeCompare(a.enrollment_invoice_no || '') })

  function printEnrollmentInvoiceFor(f) {
    const courseNames = Array.from(new Set(
      allCourses
        .filter(function (c) { return (f.registered_courses || []).includes(c.id) })
        .map(function (c) { return c.group_name || c.name })
        .filter(Boolean)
    )).sort()
    printFranchiseeEnrollmentInvoice(f, courseNames)
  }

  // Avatar color by tier
  function tierColor(tier) {
    return { SMF: '#F59E0B', CF: '#16A34A', UF: '#2563EB' }[tier] || '#534AB7'
  }

  function frInitials(name) {
    return (name || '').split(' ').map(function (w) { return w[0] }).join('').slice(0, 2).toUpperCase()
  }

  function exportCSV() {
    // Use the already-loaded, role-filtered franchisees state — no extra DB query needed
    const tierSet = new Set(exportTiers)
    const scoped = franchisees.filter(function (r) { return tierSet.has(r.tier) })
    const fields = EXPORT_FIELDS.filter(function (f) { return exportFieldKeys.includes(f.key) })
    if (!scoped.length) { showToast('No franchisees match the selected tiers.', 'warn'); return }
    if (!fields.length) { showToast('Select at least one field to export.', 'warn'); return }
    setExporting(true)
    try {
      const date = new Date().toISOString().slice(0, 10)
      function esc(v) {
        if (v == null || v === '') return ''
        const s = String(v)
        return (s.includes(',') || s.includes('"') || s.includes('\n')) ? '"' + s.replace(/"/g, '""') + '"' : s
      }
      const headers = fields.map(function (f) { return f.label })
      const rows    = scoped.map(function (r) { return fields.map(function (f) { return f.get(r) }) })
      const csv  = headers.join(',') + '\n' + rows.map(function (r) { return r.map(esc).join(',') }).join('\n')
      const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href = url; a.download = 'nlh-franchisees-' + date + '.csv'
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      URL.revokeObjectURL(url)
      showToast(rows.length + ' franchisees exported ✓')
      setShowExport(false)
    } catch (err) {
      showToast('Export failed: ' + err.message, 'err')
    }
    setExporting(false)
  }

  function toggleExportField(key) {
    setExportFieldKeys(function (prev) {
      return prev.includes(key) ? prev.filter(function (k) { return k !== key }) : [...prev, key]
    })
  }
  function toggleExportTier(tier) {
    setExportTiers(function (prev) {
      return prev.includes(tier) ? prev.filter(function (t) { return t !== tier }) : [...prev, tier]
    })
  }

  return (
    <div className="pg">
      {/* Topbar */}
      <header className="tb">
        <div className="crumb">Operations <span className="sep">›</span> <b>Franchisees</b></div>
        <div className="tb-r">
          <input
            className="search tb-search"
            placeholder="Search by name, owner, or city…"
            value={search}
            onChange={function (e) { setSearch(e.target.value) }}
          />
          <button className="btn btn-s" onClick={function () { setShowExport(true) }} title="Choose fields and tiers to export">
            ↓<span className="btn-label"> Export</span>
          </button>
          {admin && (
            <button className="btn btn-p" onClick={() => setShowAdd(true)}>+ Add Franchisee</button>
          )}
        </div>
      </header>

      <div className="content">
        {/* Page header */}
        <div className="ph">
          <div className="ph-l">
            <div className="ph-eyebrow"><span className="dot"></span>Network</div>
            <h1 className="ph-title">Franchisees</h1>
            <div className="ph-sub">
              <b>{partnerCount} partner{partnerCount !== 1 ? 's' : ''}</b> in your network. Organised by tier: SMF · CF · UF.
            </div>
          </div>
        </div>

        {/* Mini stats */}
        <div className="mini-stats">
          <div className="mini">
            <div className="mini-ic" style={{ background: 'var(--purple-bg)' }}>🏢</div>
            <div className="mini-num">{partnerCount}</div>
            <div className="mini-lbl">Total partners</div>
          </div>
          <div className="mini">
            <div className="mini-ic" style={{ background: 'var(--sun-bg)' }}>🌟</div>
            <div className="mini-num">{counts.smf}</div>
            <div className="mini-lbl">SMF · State Master</div>
          </div>
          <div className="mini">
            <div className="mini-ic" style={{ background: 'var(--green-bg)' }}>🏙️</div>
            <div className="mini-num">{counts.cf}</div>
            <div className="mini-lbl">CF · City</div>
          </div>
          <div className="mini">
            <div className="mini-ic" style={{ background: 'var(--blue-bg)' }}>📍</div>
            <div className="mini-num">{counts.uf}</div>
            <div className="mini-lbl">UF · Urban</div>
          </div>
          {admin && totalOutstanding > 0 && (
            <div className="mini" style={{ borderLeft: '3px solid var(--red)', background: '#fff8f8' }}>
              <div className="mini-ic" style={{ background: '#fee2e2' }}>💰</div>
              <div className="mini-num" style={{ color: 'var(--red)', fontSize: 15 }}>₹{fmtAmt(totalOutstanding)}</div>
              <div className="mini-lbl">Total fee outstanding</div>
            </div>
          )}
        </div>

        {admin && (
          <div className="tabs">
            <button className={'tab' + (pageTab === 'list' ? ' active' : '')} onClick={function () { setPageTab('list') }}>👥 Franchisees</button>
            <button className={'tab' + (pageTab === 'invoices' ? ' active' : '')} onClick={function () { setPageTab('invoices') }}>
              🧾 Enrollment Invoices{enrollmentInvoices.length > 0 ? ' (' + enrollmentInvoices.length + ')' : ''}
            </button>
          </div>
        )}

        {pageTab === 'invoices' ? (
          <div className="card tbl-scroll" style={{ marginBottom: 0 }}>
            {enrollmentInvoices.length === 0 ? (
              <div className="empty">No enrollment invoices yet.</div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Invoice No</th>
                    <th>Franchisee</th>
                    <th>Tier</th>
                    <th>Enrollment Date</th>
                    <th style={{ textAlign: 'right' }}>Fee</th>
                    <th style={{ textAlign: 'right' }}>Paid</th>
                    <th style={{ textAlign: 'right' }}>Balance</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {enrollmentInvoices.map(function (f) {
                    const bal = (Number(f.enrollment_fee) || 0) - (Number(f.fee_paid) || 0)
                    return (
                      <tr key={f.id}>
                        <td style={{ fontFamily: 'var(--mono)', color: 'var(--purple)', fontWeight: 600 }}>{f.enrollment_invoice_no || '—'}</td>
                        <td>{f.business_name}</td>
                        <td><TierBadge tier={f.tier} /></td>
                        <td className="mono">{fmtDate(f.contract_start || f.created_at)}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--mono)' }}>₹{fmtAmt(f.enrollment_fee || 0)}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', color: 'var(--green)' }}>₹{fmtAmt(f.fee_paid || 0)}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', color: bal > 0 ? 'var(--red)' : 'var(--green)', fontWeight: bal > 0 ? 700 : 500 }}>
                          {bal > 0 ? '₹' + fmtAmt(bal) : '₹0'}
                        </td>
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <button className="row-action" onClick={function () { printEnrollmentInvoiceFor(f) }}>View / Print</button>
                          {' '}
                          <button className="row-action" onClick={function () { setPageTab('list'); setSelected(f) }}>Open</button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        ) : selected ? (
          <div style={{ marginTop: 4 }}>
            <button className="btn" style={{ marginBottom: 12, fontSize: 13 }}
              onClick={function () { setSelected(null) }}>← Back to franchisees</button>
            <FranchiseeDetailModal
              inline
              franchisee={selected}
              allCourses={allCourses}
              onClose={function () { setSelected(null) }}
              onSaved={handleSaved}
            />
          </div>
        ) : (<>
        {/* Toolbar with search + tier filter */}
        <div className="fr-toolbar">
          <input
            className="fr-search"
            placeholder="Search by business name, city…"
            value={search}
            onChange={function (e) { setSearch(e.target.value) }}
          />
          <div className="fr-tabs">
            {[
              { id: 'all', l: 'All' },
              { id: 'smf', l: 'SMF' },
              { id: 'cf',  l: 'CF'  },
              { id: 'uf',  l: 'UF'  },
            ].concat(counts.school > 0 ? [{ id: 'school', l: 'Schools' }] : [])
              .map(function (t) {
              return (
                <button
                  key={t.id}
                  className={'fr-tab ' + (tierFilter === t.id ? 'on' : '')}
                  onClick={function () { setTierFilter(t.id) }}
                >
                  {t.l} <span className="ct">{counts[t.id]}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* City-grouped list */}
        {loading ? (
          <div className="loading"><span className="spinner" />Loading…</div>
        ) : tierFiltered.length === 0 ? (
          <div className="empty">No franchisees found.</div>
        ) : (function () {
          // Pin own centre to top (NLH HO for admin, own franchisee for everyone else)
          const ownCentre = admin
            ? tierFiltered.find(function (f) { return f.tier === 'NLH' })
            : tierFiltered.find(function (f) { return f.id === currentFranchiseeId })
          const others = tierFiltered.filter(function (f) { return f.id !== (ownCentre && ownCentre.id) })

          // Group by city (fallback to state → country)
          const cityMap = {}
          others.forEach(function (f) {
            const key = f.city || f.state || f.country || 'Unknown'
            if (!cityMap[key]) cityMap[key] = []
            cityMap[key].push(f)
          })
          const cityGroups = Object.keys(cityMap).sort().map(function (city) {
            return {
              city,
              items: cityMap[city].slice().sort(function (a, b) {
                const t = (TIER_ORDER[a.tier] ?? 9) - (TIER_ORDER[b.tier] ?? 9)
                if (t !== 0) return t
                return (a.business_name || '').localeCompare(b.business_name || '')
              }),
            }
          })

          return (
            <div>
              {/* Own Centre — pinned at top for all tiers */}
              {ownCentre && (function () {
                const tierBadgeLabel = { NLH: 'NLH HQ', SMF: 'My Centre · SMF', CF: 'My Centre · CF', UF: 'My Centre · UF' }[ownCentre.tier] || 'My Centre'
                const tierBadgeColor = { NLH: 'var(--purple)', SMF: '#b45309', CF: '#16A34A', UF: '#2563EB' }[ownCentre.tier] || 'var(--purple)'
                return (
                  <div className="nlh-own-card" onClick={function () { setSelected(ownCentre) }}>
                    <img
                      className="nlh-own-logo" src="/NLH Logo.png" alt="NLH"
                      onError={function (e) { e.target.style.display = 'none' }}
                    />
                    <div className="nlh-own-info">
                      <div className="nlh-own-name">{ownCentre.business_name || ownCentre.owner_name}</div>
                      <div className="nlh-own-loc">
                        {[ownCentre.area, ownCentre.city, ownCentre.state].filter(Boolean).join(', ')}
                      </div>
                    </div>
                    <span className="nlh-own-badge" style={{ background: tierBadgeColor + '1a', color: tierBadgeColor, border: '1px solid ' + tierBadgeColor + '40' }}>{tierBadgeLabel}</span>
                    <span className="nlh-own-arrow">›</span>
                  </div>
                )
              })()}

              {/* City sections */}
              {cityGroups.map(function (group) {
                return (
                  <div key={group.city} className="city-section">
                    <div className="city-hdr">
                      <span className="city-hdr-name">{group.city}</span>
                      <span className="city-hdr-count">{group.items.length} partner{group.items.length !== 1 ? 's' : ''}</span>
                    </div>

                    {group.items.map(function (f) {
                      const tierCls = (f.tier || 'uf').toLowerCase()
                      const rs2 = renewalStatus(f)
                      const valCol = rs2.isExpired ? 'var(--red)' : rs2.isExpiring ? '#b45309' : 'var(--green)'
                      const valLbl = rs2.isExpired
                        ? '⚠ Expired'
                        : rs2.isExpiring
                          ? `⏳ ${rs2.daysLeft}d`
                          : '✓ Active'

                      const frBalance = (Number(f.enrollment_fee) || 0) - (Number(f.fee_paid) || 0)

                      return (
                        <div
                          key={f.id}
                          className={'fr-row ' + tierCls}
                          onClick={function () { setSelected(f) }}
                        >
                          <TierBadge tier={f.tier} />

                          <div className="fr-row-main">
                            <div className="fr-row-name">{f.business_name}</div>
                            {f.owner_name && f.owner_name !== f.business_name && (
                              <div className="fr-row-owner">{f.owner_name}</div>
                            )}
                            {(f.area || f.state) && (
                              <div className="fr-row-loc">
                                {[f.area, f.tier === 'SMF' ? f.state : null].filter(Boolean).join(' · ')}
                              </div>
                            )}
                          </div>

                          <div className="fr-row-meta">
                            {f.phone && <span className="fr-row-phone">{f.phone}</span>}
                            {(f.registered_courses || []).length > 0 && (
                              <span className="fr-row-courses">{(f.registered_courses || []).length} courses</span>
                            )}
                            {frBalance > 0 && (
                              <span style={{
                                fontSize: 10, fontWeight: 700, fontFamily: 'var(--mono)',
                                color: 'var(--red)', background: '#fee2e2',
                                border: '1px solid #fecaca', borderRadius: 4,
                                padding: '1px 6px', letterSpacing: '.01em',
                              }}>
                                ₹{fmtAmt(frBalance)} due
                              </span>
                            )}
                          </div>

                          <span className="fr-row-validity" style={{ color: valCol, flexShrink: 0 }}>
                            {valLbl}
                          </span>

                          <span className="fr-row-arrow">›</span>
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          )
        })()}
        </>)}
      </div>

      {showAdd && (
        <AddFranchiseeModal
          onClose={() => setShowAdd(false)}
          onSaved={handleAdded}
        />
      )}

      {showExport && (
        <div className="modal-bg" onClick={function (e) { if (e.target === e.currentTarget) setShowExport(false) }}>
          <div className="modal" style={{ maxWidth: 480, padding: 0, display: 'flex', flexDirection: 'column', maxHeight: '86vh' }}>
            <ModalHeader flush title="Export Franchisees" subtitle="Choose tiers and fields to include"
              onClose={function () { setShowExport(false) }} />
            <div style={{ padding: '4px 22px 18px', overflowY: 'auto' }}>
              <div style={{ font: '700 11px var(--mono)', color: 'var(--text3)', textTransform: 'uppercase', marginBottom: 8 }}>
                Tiers
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 18 }}>
                {[
                  { key: 'NLH', label: 'NLH Head Office' },
                  { key: 'SMF', label: 'SMF' },
                  { key: 'CF',  label: 'CF' },
                  { key: 'UF',  label: 'UF' },
                ].map(function (t) {
                  const count = franchisees.filter(function (f) { return f.tier === t.key }).length
                  if (count === 0) return null
                  return (
                    <label key={t.key} className="checkbox-item" style={{ display: 'flex', alignItems: 'center', gap: 6, border: '1px solid var(--border)', borderRadius: 8, padding: '5px 10px', cursor: 'pointer' }}>
                      <input type="checkbox" checked={exportTiers.includes(t.key)} onChange={function () { toggleExportTier(t.key) }} />
                      <span style={{ fontSize: 12 }}>{t.label} <span style={{ color: 'var(--text3)' }}>({count})</span></span>
                    </label>
                  )
                })}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <div style={{ font: '700 11px var(--mono)', color: 'var(--text3)', textTransform: 'uppercase' }}>
                  Fields
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button style={{ font: '600 11px var(--font)', color: 'var(--purple)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                    onClick={function () { setExportFieldKeys(EXPORT_FIELDS.map(function (f) { return f.key })) }}>
                    Select all
                  </button>
                  <button style={{ font: '600 11px var(--font)', color: 'var(--text3)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                    onClick={function () { setExportFieldKeys([]) }}>
                    Clear
                  </button>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px' }}>
                {EXPORT_FIELDS.map(function (f) {
                  return (
                    <label key={f.key} className="checkbox-item" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0', cursor: 'pointer' }}>
                      <input type="checkbox" checked={exportFieldKeys.includes(f.key)} onChange={function () { toggleExportField(f.key) }} />
                      <span style={{ fontSize: 12 }}>{f.label}</span>
                    </label>
                  )
                })}
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={function () { setShowExport(false) }}>Cancel</button>
              <button className="btn-p" disabled={exporting} onClick={exportCSV}>
                {exporting ? 'Exporting…' : 'Download CSV'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

