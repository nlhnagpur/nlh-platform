import React, { useState, useEffect } from 'react'
import { sb } from '../supabase'
import { useAuth } from '../context/AuthContext'
import { showToast } from '../utils'

export default function OnboardingPage() {
  const { currentUser, currentRole, setScreen, setCurrentFranchiseeId, signOut } = useAuth()
  const [step, setStep] = useState('choose') // 'choose' | 'franchisee' | 'student'

  // Franchisee form state
  const [frTier, setFrTier] = useState('UF')
  const [frName, setFrName] = useState('')
  const [frEmail, setFrEmail] = useState(currentUser?.email || '')
  const [frPhone, setFrPhone] = useState('')
  const [frCountry, setFrCountry] = useState('India')
  const [frState, setFrState] = useState('')
  const [frCity, setFrCity] = useState('')
  const [frArea, setFrArea] = useState('')
  const [frAddress, setFrAddress] = useState('')
  const [parents, setParents] = useState([])
  const [frParentId, setFrParentId] = useState('')
  const [frSaving, setFrSaving] = useState(false)

  // Student form state
  const [stName, setStName] = useState('')
  const [stParent, setStParent] = useState('')
  const [stPhone, setStPhone] = useState('')
  const [stEmail, setStEmail] = useState('')
  const [stDob, setStDob] = useState('')
  const [stCountry, setStCountry] = useState('India')
  const [stState, setStState] = useState('')
  const [stCity, setStCity] = useState('')
  const [stArea, setStArea] = useState('')
  const [stAddress, setStAddress] = useState('')
  const [centres, setCentres] = useState([])
  const [stCentre, setStCentre] = useState('')
  const [stSaving, setStSaving] = useState(false)

  // Load parent franchisees when tier changes
  useEffect(() => {
    if (step !== 'franchisee') return
    async function loadParents() {
      if (frTier === 'SMF') { setParents([]); return }
      if (frTier === 'CF') {
        const { data } = await sb.from('franchisees').select('id, business_name, city, state, country, tier').eq('tier', 'SMF').eq('status', 'active').order('business_name')
        setParents(data || [])
        return
      }
      // UF: load CFs + SMFs + NLH HO so admin/self can pick appropriate parent
      const [cfs, smfs, nlh] = await Promise.all([
        sb.from('franchisees').select('id, business_name, city, state, country, tier').eq('tier', 'CF').eq('status', 'active').order('business_name'),
        sb.from('franchisees').select('id, business_name, city, state, country, tier').eq('tier', 'SMF').eq('status', 'active').order('business_name'),
        sb.from('franchisees').select('id, business_name, city, state, country, tier').eq('tier', 'NLH').single(),
      ])
      setParents([...(cfs.data || []), ...(smfs.data || []), ...(nlh.data ? [nlh.data] : [])])
    }
    loadParents()
  }, [frTier, step])

  // Load all active centres for student (UF, CF, SMF, NLH)
  useEffect(() => {
    if (step !== 'student') return
    async function loadCentres() {
      const { data } = await sb.from('franchisees')
        .select('id, business_name, city, area, country, tier')
        .in('tier', ['UF', 'CF', 'SMF', 'NLH'])
        .eq('status', 'active')
        .order('tier').order('business_name')
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
      // Territory duplicate check
      if (frTier === 'SMF' || frTier === 'CF') {
        const country = (frCountry || 'India').trim()
        const isIndia = country.toLowerCase() === 'india'
        if (frTier === 'SMF') {
          if (isIndia && !frState.trim()) { showToast('State is required for an Indian SMF', 'warn'); setFrSaving(false); return }
          let dupQ = sb.from('franchisees').select('id,business_name').eq('tier', 'SMF').ilike('country', country).eq('status', 'active')
          if (isIndia) dupQ = dupQ.ilike('state', frState.trim())
          const { data: existing } = await dupQ
          if (existing && existing.length > 0) {
            showToast(`An active SMF already exists for ${isIndia ? frState : country}: ${existing[0].business_name}`, 'warn')
            setFrSaving(false); return
          }
        } else {
          if (!frCity.trim()) { showToast('City is required for CF', 'warn'); setFrSaving(false); return }
          const { data: existing } = await sb.from('franchisees')
            .select('id,business_name').eq('tier', 'CF').ilike('country', country).ilike('city', frCity.trim()).eq('status', 'active')
          if (existing && existing.length > 0) {
            showToast(`An active CF already exists in ${frCity}: ${existing[0].business_name}`, 'warn')
            setFrSaving(false); return
          }
        }
      }
      const { data: fr, error } = await sb.from('franchisees').insert({
        business_name: frName, email: frEmail, phone: frPhone,
        country: frCountry, state: frState, city: frCity, area: frArea, address: frAddress,
        tier: frTier, status: 'active',
        parent_id: frParentId || null,
      }).select().single()
      if (error) throw error
      // DB trigger (tr_franchisee_onboarded) automatically sets
      // users.role = tier and users.franchisee_id = fr.id

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
        full_name: stName, parent_name: stParent, phone: stPhone,
        email: stEmail.trim() || null,
        dob: stDob || null,
        country: stCountry, state: stState, city: stCity, area: stArea, address: stAddress,
        franchisee_id: stCentre, is_active: true,
        fee_total: 0, fee_paid: 0, payment_status: 'none',
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
                  <label>Country</label>
                  <input value={frCountry} onChange={e => setFrCountry(e.target.value)} placeholder="India" />
                </div>
                <div className="fr">
                  <label>State</label>
                  <input value={frState} onChange={e => setFrState(e.target.value)} placeholder="Maharashtra" />
                </div>
              </div>
              <div className="g2">
                <div className="fr">
                  <label>City</label>
                  <input value={frCity} onChange={e => setFrCity(e.target.value)} placeholder="Nagpur" />
                </div>
                <div className="fr">
                  <label>Area / Locality</label>
                  <input value={frArea} onChange={e => setFrArea(e.target.value)} placeholder="Sadar, Dharampeth…" />
                </div>
              </div>
              <div className="fr">
                <label>Street / Building Address</label>
                <input value={frAddress} onChange={e => setFrAddress(e.target.value)} placeholder="Shop no., building, street" />
              </div>
              {(frTier === 'UF' || frTier === 'CF') && (
                <div className="fr">
                  <label>Parent {frTier === 'CF' ? 'State Master Franchisee' : 'Franchisee'} *</label>
                  <select value={frParentId} onChange={e => setFrParentId(e.target.value)}>
                    <option value="">— Select —</option>
                    {parents.map(p => (
                      <option key={p.id} value={p.id}>[{p.tier}] {p.business_name} ({p.city || p.state || p.country}{p.country && p.country !== 'India' ? ' · ' + p.country : ''})</option>
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

        {step === 'choose' && (
          <div style={{ marginTop: 24, textAlign: 'center' }}>
            <button
              onClick={signOut}
              style={{ background: 'none', border: 'none', cursor: 'pointer', font: '500 11px var(--font)', color: 'var(--text3)', textDecoration: 'underline' }}
            >
              Not {currentUser?.email?.split('@')[0]}? Sign out
            </button>
          </div>
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
                  <label>Parent Email</label>
                  <input type="email" value={stEmail} onChange={e => setStEmail(e.target.value)} placeholder="parent@email.com" />
                </div>
              </div>
              <div className="g2">
                <div className="fr">
                  <label>Date of Birth</label>
                  <input type="date" value={stDob} onChange={e => setStDob(e.target.value)} />
                </div>
                <div className="fr" />
              </div>
              <div className="g2">
                <div className="fr">
                  <label>Country</label>
                  <input value={stCountry} onChange={e => setStCountry(e.target.value)} placeholder="India" />
                </div>
                <div className="fr">
                  <label>State</label>
                  <input value={stState} onChange={e => setStState(e.target.value)} placeholder="Maharashtra" />
                </div>
              </div>
              <div className="g2">
                <div className="fr">
                  <label>City *</label>
                  <input value={stCity} onChange={e => setStCity(e.target.value)} placeholder="Your city" />
                </div>
                <div className="fr">
                  <label>Area / Locality</label>
                  <input value={stArea} onChange={e => setStArea(e.target.value)} placeholder="Neighbourhood" />
                </div>
              </div>
              <div className="fr">
                <label>Street / Building Address</label>
                <input value={stAddress} onChange={e => setStAddress(e.target.value)} placeholder="Flat no., building, street" />
              </div>
              <div className="fr" style={{ marginTop:4 }}>
                <label>NLH Centre *</label>
                {(() => {
                  const nlhHo = centres.find(c => c.tier === 'NLH')
                  const cityStr = stCity.trim()
                  const countryStr = stCountry.trim() || 'India'
                  const localCentres = cityStr
                    ? centres.filter(c => c.tier !== 'NLH' && c.city === cityStr && (c.country || 'India') === countryStr)
                    : []
                  return (
                    <div style={{ display:'flex', flexDirection:'column', gap:8, marginTop:4 }}>
                      {nlhHo && (
                        <div
                          onClick={() => setStCentre(nlhHo.id)}
                          style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 14px', borderRadius:10,
                            border:`1.5px solid ${stCentre===nlhHo.id ? 'var(--purple)' : 'var(--border)'}`,
                            background: stCentre===nlhHo.id ? 'var(--purple-bg)' : 'var(--bg)',
                            cursor:'pointer', transition:'all .12s' }}
                        >
                          <span style={{ fontSize:18 }}>🏛️</span>
                          <span style={{ flex:1 }}>
                            <span style={{ font:'600 12.5px var(--font)', color:'var(--text)' }}>NLH Head Office</span>
                            <span style={{ font:'500 10px var(--mono)', color:'var(--text3)', marginLeft:8 }}>Nagpur · India · Online / In-person</span>
                          </span>
                          {stCentre===nlhHo.id && <span style={{ font:'700 10px var(--mono)', color:'var(--purple)' }}>✓</span>}
                        </div>
                      )}
                      {!cityStr ? (
                        <p style={{ font:'500 11px var(--font)', color:'var(--text3)', margin:0 }}>
                          Fill in your <b>City</b> above to see local centres.
                        </p>
                      ) : localCentres.length === 0 ? (
                        <p style={{ font:'500 11px var(--font)', color:'var(--text3)', margin:0 }}>
                          No centres in <b>{cityStr}</b> — please enrol at NLH Head Office above.
                        </p>
                      ) : (
                        <select
                          value={stCentre !== nlhHo?.id ? stCentre : ''}
                          onChange={e => setStCentre(e.target.value)}
                        >
                          <option value="">— Select centre in {cityStr} —</option>
                          {localCentres.map(c => (
                            <option key={c.id} value={c.id}>
                              [{c.tier}] {c.business_name}{c.area ? ` — ${c.area}` : ''}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  )
                })()}
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
