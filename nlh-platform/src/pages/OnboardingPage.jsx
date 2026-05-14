import React, { useState, useEffect } from 'react'
import { sb } from '../supabase'
import { useAuth } from '../context/AuthContext'
import { showToast } from '../utils'

export default function OnboardingPage() {
  const { currentUser, currentRole, setScreen, setCurrentFranchiseeId } = useAuth()
  const [step, setStep] = useState('choose') // 'choose' | 'franchisee' | 'student'

  // Franchisee form state
  const [frTier, setFrTier] = useState('UF')
  const [frName, setFrName] = useState('')
  const [frEmail, setFrEmail] = useState(currentUser?.email || '')
  const [frPhone, setFrPhone] = useState('')
  const [frState, setFrState] = useState('')
  const [frCity, setFrCity] = useState('')
  const [frAddress, setFrAddress] = useState('')
  const [parents, setParents] = useState([])
  const [frParentId, setFrParentId] = useState('')
  const [frSaving, setFrSaving] = useState(false)

  // Student form state
  const [stName, setStName] = useState('')
  const [stParent, setStParent] = useState('')
  const [stPhone, setStPhone] = useState('')
  const [stDob, setStDob] = useState('')
  const [stAddress, setStAddress] = useState('')
  const [centres, setCentres] = useState([])
  const [stCentre, setStCentre] = useState('')
  const [stSaving, setStSaving] = useState(false)

  // Load parent franchisees when tier changes
  useEffect(() => {
    if (step !== 'franchisee') return
    async function loadParents() {
      const parentTier = frTier === 'UF' ? 'CF' : frTier === 'CF' ? 'SMF' : null
      if (!parentTier) { setParents([]); return }
      const { data } = await sb.from('franchisees').select('id, name, city, state').eq('tier', parentTier).eq('status', 'active').order('name')
      setParents(data || [])
    }
    loadParents()
  }, [frTier, step])

  // Load UF centres for student
  useEffect(() => {
    if (step !== 'student') return
    async function loadCentres() {
      const { data } = await sb.from('franchisees').select('id, name, city').eq('tier', 'UF').eq('status', 'active').order('name')
      setCentres(data || [])
    }
    loadCentres()
  }, [step])

  async function submitFranchisee(e) {
    e.preventDefault()
    if (!frName || !frEmail || !frPhone) { showToast('Please fill all required fields', 'warn'); return }
    if ((frTier === 'UF' || frTier === 'CF') && !frParentId) { showToast('Please select a parent franchisee', 'warn'); return }
    setFrSaving(true)
    try {
      const { data: fr, error } = await sb.from('franchisees').insert({
        name: frName, email: frEmail, phone: frPhone,
        state: frState, city: frCity, address: frAddress,
        tier: frTier, status: 'active',
        parent_id: frParentId || null,
      }).select().single()
      if (error) throw error

      await sb.from('users').update({
        franchisee_id: fr.id,
        role: frTier.toLowerCase(),
      }).ilike('email', currentUser.email)

      setCurrentFranchiseeId(fr.id)
      showToast('Profile created! Welcome to NLH Platform.')
      setScreen('app')
    } catch (err) {
      showToast('Error: ' + err.message, 'err')
    }
    setFrSaving(false)
  }

  async function submitStudent(e) {
    e.preventDefault()
    if (!stName || !stPhone || !stCentre) { showToast('Please fill all required fields', 'warn'); return }
    setStSaving(true)
    try {
      const { data: st, error } = await sb.from('students').insert({
        name: stName, parent_name: stParent, phone: stPhone,
        dob: stDob || null, address: stAddress,
        franchisee_id: stCentre, status: 'active',
        fee_total: 0, fee_paid: 0,
      }).select().single()
      if (error) throw error

      await sb.from('users').update({ student_id: st.id }).ilike('email', currentUser.email)

      showToast('Profile created! Welcome to NLH Platform.')
      setScreen('app')
    } catch (err) {
      showToast('Error: ' + err.message, 'err')
    }
    setStSaving(false)
  }

  return (
    <div className="ob-wrap">
      <div className="ob-card">
        <div className="login-logo" style={{ marginBottom: 20 }}>
          <div className="login-icon">N</div>
          <div>
            <div className="login-brand">New Learning Horizons</div>
            <div className="login-brand-sub">Complete your profile to get started</div>
          </div>
        </div>

        {step === 'choose' && (
          <>
            <div className="login-title">Welcome, {currentUser?.email?.split('@')[0]}!</div>
            <p style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 24, marginTop: 6 }}>
              Let's set up your profile. Are you joining as a franchisee or a student?
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <button className="btn-s" style={{ padding: '20px 16px', borderRadius: 12, textAlign: 'center', fontSize: 13 }} onClick={() => setStep('franchisee')}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>🏢</div>
                <div style={{ fontWeight: 600, color: 'var(--text)' }}>I'm a Franchisee</div>
                <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>SMF / CF / UF partner</div>
              </button>
              <button className="btn-s" style={{ padding: '20px 16px', borderRadius: 12, textAlign: 'center', fontSize: 13 }} onClick={() => setStep('student')}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>👨‍🎓</div>
                <div style={{ fontWeight: 600, color: 'var(--text)' }}>I'm a Student</div>
                <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>Enrolled in NLH courses</div>
              </button>
            </div>
          </>
        )}

        {step === 'franchisee' && (
          <>
            <div className="login-title">Franchisee Profile</div>
            <p style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 20, marginTop: 4 }}>Fill in your details to activate your account.</p>
            <form onSubmit={submitFranchisee}>
              <div className="g2">
                <div className="fr">
                  <label>Franchise Type *</label>
                  <select value={frTier} onChange={e => { setFrTier(e.target.value); setFrParentId('') }}>
                    <option value="UF">Unit Franchisee (UF)</option>
                    <option value="CF">City Franchisee (CF)</option>
                    <option value="SMF">State Master Franchisee (SMF)</option>
                  </select>
                </div>
                <div className="fr">
                  <label>Full Name *</label>
                  <input value={frName} onChange={e => setFrName(e.target.value)} placeholder="Your / Centre name" />
                </div>
              </div>
              <div className="g2">
                <div className="fr">
                  <label>Email *</label>
                  <input type="email" value={frEmail} onChange={e => setFrEmail(e.target.value)} />
                </div>
                <div className="fr">
                  <label>Phone *</label>
                  <input value={frPhone} onChange={e => setFrPhone(e.target.value)} placeholder="10-digit mobile" />
                </div>
              </div>
              <div className="g2">
                <div className="fr">
                  <label>State</label>
                  <input value={frState} onChange={e => setFrState(e.target.value)} placeholder="Maharashtra" />
                </div>
                <div className="fr">
                  <label>City</label>
                  <input value={frCity} onChange={e => setFrCity(e.target.value)} placeholder="Nagpur" />
                </div>
              </div>
              <div className="fr">
                <label>Address</label>
                <input value={frAddress} onChange={e => setFrAddress(e.target.value)} placeholder="Shop / Centre address" />
              </div>
              {(frTier === 'UF' || frTier === 'CF') && (
                <div className="fr">
                  <label>Parent {frTier === 'UF' ? 'City Franchisee' : 'State Master Franchisee'} *</label>
                  <select value={frParentId} onChange={e => setFrParentId(e.target.value)}>
                    <option value="">— Select —</option>
                    {parents.map(p => (
                      <option key={p.id} value={p.id}>{p.name} ({p.city || p.state})</option>
                    ))}
                  </select>
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                <button type="button" className="btn-s" onClick={() => setStep('choose')}>← Back</button>
                <button type="submit" className="btn-p" style={{ flex: 1 }} disabled={frSaving}>
                  {frSaving ? 'Saving...' : 'Activate my account'}
                </button>
              </div>
            </form>
          </>
        )}

        {step === 'student' && (
          <>
            <div className="login-title">Student Profile</div>
            <p style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 20, marginTop: 4 }}>Enter your details to complete enrolment.</p>
            <form onSubmit={submitStudent}>
              <div className="g2">
                <div className="fr">
                  <label>Student Name *</label>
                  <input value={stName} onChange={e => setStName(e.target.value)} placeholder="Full name" />
                </div>
                <div className="fr">
                  <label>Parent / Guardian Name</label>
                  <input value={stParent} onChange={e => setStParent(e.target.value)} />
                </div>
              </div>
              <div className="g2">
                <div className="fr">
                  <label>Phone *</label>
                  <input value={stPhone} onChange={e => setStPhone(e.target.value)} placeholder="Contact number" />
                </div>
                <div className="fr">
                  <label>Date of Birth</label>
                  <input type="date" value={stDob} onChange={e => setStDob(e.target.value)} />
                </div>
              </div>
              <div className="fr">
                <label>NLH Centre (Unit Franchisee) *</label>
                <select value={stCentre} onChange={e => setStCentre(e.target.value)}>
                  <option value="">— Select your centre —</option>
                  {centres.map(c => (
                    <option key={c.id} value={c.id}>{c.name} — {c.city}</option>
                  ))}
                </select>
              </div>
              <div className="fr">
                <label>Address</label>
                <input value={stAddress} onChange={e => setStAddress(e.target.value)} placeholder="Home address" />
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                <button type="button" className="btn-s" onClick={() => setStep('choose')}>← Back</button>
                <button type="submit" className="btn-p" style={{ flex: 1 }} disabled={stSaving}>
                  {stSaving ? 'Saving...' : 'Complete enrolment'}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
