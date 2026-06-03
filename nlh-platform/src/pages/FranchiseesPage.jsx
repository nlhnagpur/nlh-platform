import React, { useState, useEffect } from 'react'
import { sb } from '../supabase'
import { useAuth } from '../context/AuthContext'
import { fmtAmt, fmtDate, showToast, statusBadge } from '../utils'
import { isAdminRole } from '../constants/roles'
import { getTreeIds } from '../utils/hierarchy'
import { sendWelcomeEmail, sendFranchiseeWelcomeLetter, sendFranchiseeCertEmail } from '../services/email'
import { sendWAPaymentReceived } from '../services/whatsapp'
import { printFranchiseeCert, default as FranchiseeCertModal } from '../components/FranchiseeCertModal'
import { StudentDetailModal } from './StudentsPage'

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

function LocationFields({ form, onChange, disabled }) {
  const isIndia = (form.country || 'India').toLowerCase() === 'india'
  const cityList = isIndia ? (STATE_CITIES[form.state] || []) : []

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

  async function handleSave() {
    const amt = Number(amount)
    if (!amt || amt <= 0) { showToast('Enter a valid amount', 'warn'); return }
    setSaving(true)
    const { error: insErr } = await sb.from('franchisee_payments').insert({
      franchisee_id: franchisee.id,
      amount:        amt,
      payment_date:  date,
      payment_mode:  mode,
      reference_no:  ref.trim() || null,
      notes:         notes.trim() || null,
      recorded_by:   currentUser || null,
    })
    if (insErr) { showToast('Failed: ' + insErr.message, 'err'); setSaving(false); return }

    const newFeePaid = (franchisee.fee_paid || 0) + amt
    const newBalance = (Number(franchisee.enrollment_fee) || 0) - newFeePaid
    const { error: feeErr } = await sb.from('franchisees').update({ fee_paid: newFeePaid }).eq('id', franchisee.id)
    if (feeErr) { showToast('Failed to update fee record: ' + feeErr.message, 'err'); setSaving(false); return }
    setSaving(false)
    showToast('Payment of ₹' + fmtAmt(amt) + ' recorded')
    try {
      if (franchisee.phone) {
        await sendWAPaymentReceived(franchisee.phone, {
          name:    franchisee.business_name || 'Partner',
          amount:  fmtAmt(amt),
          balance: newBalance,
        })
      }
    } catch (waErr) {
      console.warn('WhatsApp payment notification failed:', waErr.message)
    }
    onSaved(newFeePaid)
  }

  return (
    <div className="modal-bg" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="ch">
          <span>📥 Record Payment — {franchisee.business_name}</span>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>
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
  const cls = { SMF: 't-smf', CF: 't-cf', UF: 't-uf' }[tier] || ''
  return <span className={`tier ${cls}`}>{tier}</span>
}

function StatusBadge({ status }) {
  const s = (status || '').toLowerCase()
  const map = { active: 'ba', inactive: 'bd', pending: 'bp', approved: 'ba', rejected: 'bd' }
  return <span className={`badge ${map[s] || 'br'}`}>{status || '—'}</span>
}

function genTempPass() {
  return 'NLH@' + Math.random().toString(36).slice(2, 8).toUpperCase()
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
    valid_till: franchisee.valid_till || '',
    renewal_fee: franchisee.renewal_fee ?? '',
  })
  const [registeredCourses, setRegisteredCourses] = useState(franchisee.registered_courses || [])
  const [saving, setSaving] = useState(false)
  const [orders, setOrders] = useState([])
  const [students, setStudents] = useState([])
  const [tabLoaded, setTabLoaded] = useState({ info: true, courses: false, orders: false, students: false, cert: false })
  const [certEmailing, setCertEmailing] = useState(false)
  const [certEmailedAt, setCertEmailedAt] = useState(franchisee.cert_emailed_at || null)
  const [resending, setResending] = useState(false)
  const [changingEmail, setChangingEmail] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [savingEmail, setSavingEmail] = useState(false)
  const [payments, setPayments] = useState([])
  const [showPayModal, setShowPayModal] = useState(false)
  const [studentCount, setStudentCount] = useState(null)
  const [selectedStudent, setSelectedStudent] = useState(null)

  useEffect(function () {
    sb.from('franchisee_payments')
      .select('id,amount,payment_date,payment_mode,reference_no,notes,recorded_by,created_at')
      .eq('franchisee_id', franchisee.id)
      .order('payment_date', { ascending: false })
      .then(function ({ data }) { setPayments(data || []) })
  }, [franchisee.id])

  useEffect(function () {
    sb.from('students').select('id', { count: 'exact', head: true })
      .eq('franchisee_id', franchisee.id)
      .then(function ({ count }) { setStudentCount(count || 0) })
  }, [franchisee.id])

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
      const { data } = await sb.from('students').select('id,full_name,parent_name,dob,registered_at,phone,email,pincode,country,state,city,area,address,channel,payment_status,payment_mode,fee_total,fee_paid,franchisee_id').eq('franchisee_id', franchisee.id).order('full_name').limit(50)
      setStudents(data || [])
    }
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
      valid_till: form.valid_till || null,
      renewal_fee: form.renewal_fee === '' ? null : Number(form.renewal_fee),
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
          {['info', 'courses', 'orders', 'students', 'cert'].map(t => (
            <button key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => loadTab(t)}>
              {t === 'cert' ? '📜 Certificate' : t.charAt(0).toUpperCase() + t.slice(1)}
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
              {admin && (
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
              <div className="col-span-2" style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 4, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ font: '700 10px var(--mono)', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.08em' }}>💰 Fee Tracking</span>
                {admin && balance > 0 && (
                  <button className="btn-s" onClick={() => setShowPayModal(true)} style={{ fontSize: 11 }}>
                    📥 Record Payment
                  </button>
                )}
              </div>
              <label>Enrollment Fee (₹)
                <input type="number" value={form.enrollment_fee} onChange={field('enrollment_fee')} disabled={!admin} />
              </label>
              <label>Fee Paid (₹)
                <input type="number" value={form.fee_paid} onChange={field('fee_paid')} disabled={!admin} />
              </label>
              <label>Balance
                <input value={'₹' + fmtAmt(balance)} disabled style={{ color: balance > 0 ? 'var(--red)' : 'var(--green)' }} />
              </label>

              {/* ── Payment History ── */}
              {payments.length > 0 && (
                <div className="col-span-2" style={{ marginTop: 4 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>
                    Payment History
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {payments.map(function (p) {
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
              <label>Valid Till (date)
                <input
                  type="date"
                  value={form.valid_till}
                  onChange={field('valid_till')}
                  disabled={!admin}
                />
              </label>
              <label>Custom Renewal Fee (₹)
                <input
                  type="number"
                  value={form.renewal_fee}
                  onChange={field('renewal_fee')}
                  disabled={!admin}
                  placeholder={'Default: ₹' + (rs.fee != null ? fmtAmt(rs.fee) : '25% of fee paid')}
                />
              </label>
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
                    <tr><th>Name</th><th>Status</th><th>Fee Total</th><th>Fee Paid</th><th>Balance</th></tr>
                  </thead>
                  <tbody>
                    {students.length === 0 && <tr><td colSpan={5} className="empty">No students</td></tr>}
                    {students.map(function (s) {
                      return (
                        <tr key={s.id} style={{ cursor: 'pointer' }} onClick={function () { setSelectedStudent(s) }}>
                          <td>{s.full_name}</td>
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
            function vTill(f) {
              const d = f.valid_till
                ? new Date(f.valid_till)
                : (() => { const x = new Date(f.created_at || Date.now()); x.setFullYear(x.getFullYear() + 3); return x })()
              return [String(d.getDate()).padStart(2,'0'), String(d.getMonth()+1).padStart(2,'0'), d.getFullYear()].join('.')
            }
            const address = [fr.address, fr.area, fr.city, fr.state,
              fr.country && fr.country !== 'India' ? fr.country : null].filter(Boolean).join(', ')
            const courses = courseNames.join(', ')
            const label   = tierLbl(fr)
            const till    = vTill(fr)

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

                  <div style={{ fontSize: 13, fontWeight: 900, letterSpacing: 2, color: '#1A1916', marginBottom: 4 }}>FRANCHISE CERTIFICATE</div>
                  <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 10 }}>This is to Certify that</div>
                  <div style={{ fontFamily: 'Georgia,serif', fontSize: 22, fontWeight: 700, color: '#CC0000', marginBottom: 2, lineHeight: 1.2 }}>
                    {fr.name || fr.business_name}
                  </div>
                  {fr.tier === 'SMF' && (
                    <div style={{ fontFamily: 'Georgia,serif', fontSize: 14, color: '#CC0000', marginBottom: 4 }}>{fr.state}</div>
                  )}
                  <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 8, marginBottom: 2 }}>Is a Registered</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#CC0000', marginBottom: 5 }}>{label}</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#1A1916', marginBottom: 4 }}>New Learning Horizons at</div>
                  <div style={{ fontSize: 10, color: 'var(--text2)', marginBottom: courses ? 4 : 0 }}>{address}</div>
                  {courses && <div style={{ fontSize: 10, color: 'var(--text)', lineHeight: 1.5, marginBottom: 2 }}>for {courses}</div>}

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

    {showPayModal && (
      <RecordFranchiseePaymentModal
        franchisee={{ ...franchisee, fee_paid: Number(form.fee_paid) || 0 }}
        balance={balance}
        currentUser={currentUser?.email}
        onSaved={function (newFeePaid) {
          setForm(f => ({ ...f, fee_paid: String(newFeePaid) }))
          setShowPayModal(false)
          sb.from('franchisee_payments')
            .select('id,amount,payment_date,payment_mode,reference_no,notes,recorded_by,created_at')
            .eq('franchisee_id', franchisee.id)
            .order('payment_date', { ascending: false })
            .then(function ({ data }) { setPayments(data || []) })
        }}
        onClose={function () { setShowPayModal(false) }}
      />
    )}
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
      }).select().single()

      if (frErr) { showToast('Failed to create franchisee: ' + frErr.message, 'err'); setSaving(false); return }

      // Create auth account server-side — no session displacement
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
        }),
      })
      const createData = await createRes.json()
      if (!createData.success && !createData.error?.includes('already registered')) {
        showToast('Auth account error: ' + (createData.error || 'Unknown'), 'warn')
      }

      // Insert user record
      const roleMap = { SMF: 'smf', CF: 'cf', UF: 'uf' }
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
        <div className="ch">
          <span>Add Franchisee</span>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>
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
  }

  const totalOutstanding = franchisees.reduce(function (sum, f) {
    const bal = (Number(f.enrollment_fee) || 0) - (Number(f.fee_paid) || 0)
    return sum + (bal > 0 ? bal : 0)
  }, 0)

  // Avatar color by tier
  function tierColor(tier) {
    return { SMF: '#F59E0B', CF: '#16A34A', UF: '#2563EB' }[tier] || '#534AB7'
  }

  function frInitials(name) {
    return (name || '').split(' ').map(function (w) { return w[0] }).join('').slice(0, 2).toUpperCase()
  }

  function exportCSV() {
    // Use the already-loaded, role-filtered franchisees state — no extra DB query needed
    if (!franchisees.length) { showToast('No franchisees to export.', 'warn'); return }
    setExporting(true)
    try {
      const date = new Date().toISOString().slice(0, 10)
      function esc(v) {
        if (v == null || v === '') return ''
        const s = String(v)
        return (s.includes(',') || s.includes('"') || s.includes('\n')) ? '"' + s.replace(/"/g, '""') + '"' : s
      }
      const headers = ['Business Name','Owner Name','Tier','Email','Phone','Area','City','State','Country','PIN Code','Status','Enrollment Fee','Fee Paid']
      const rows    = franchisees.map(function (r) {
        return [r.business_name, r.owner_name, r.tier, r.email, r.phone, r.area, r.city, r.state, r.country, r.pincode, r.status, r.enrollment_fee || 0, r.fee_paid || 0]
      })
      const csv  = headers.join(',') + '\n' + rows.map(function (r) { return r.map(esc).join(',') }).join('\n')
      const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href = url; a.download = 'nlh-franchisees-' + date + '.csv'
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      URL.revokeObjectURL(url)
      showToast(rows.length + ' franchisees exported ✓')
    } catch (err) {
      showToast('Export failed: ' + err.message, 'err')
    }
    setExporting(false)
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
          <button className="btn btn-s" onClick={exportCSV} disabled={exporting} title="Export CSV">
            {exporting ? '…' : '↓'}<span className="btn-label">{exporting ? ' Exporting' : ' Export'}</span>
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
              {(function () {
                const partnerCount = admin
                  ? franchisees.filter(function (f) { return f.tier !== 'NLH' }).length
                  : franchisees.filter(function (f) { return f.id !== currentFranchiseeId }).length
                return <><b>{partnerCount} partner{partnerCount !== 1 ? 's' : ''}</b> in your network. Organised by tier: SMF · CF · UF.</>
              })()}
            </div>
          </div>
        </div>

        {/* Mini stats */}
        <div className="mini-stats">
          <div className="mini">
            <div className="mini-ic" style={{ background: 'var(--purple-bg)' }}>🏢</div>
            <div className="mini-num">{franchisees.length}</div>
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

        {selected ? (
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
            ].map(function (t) {
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
    </div>
  )
}

