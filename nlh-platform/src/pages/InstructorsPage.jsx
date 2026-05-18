import React, { useState, useEffect } from 'react'
import { sb } from '../supabase'
import { useAuth } from '../context/AuthContext'
import { fmtDate, showToast } from '../utils'
import { isAdminRole } from '../constants/roles'

// ── helpers ────────────────────────────────────────────────────────────────────

function StatusBadge({ status }) {
  const map = { active: 'ba', inactive: 'bd', resigned: 'bd', terminated: 'br' }
  return <span className={`badge ${map[status] || 'br'}`}>{status || '—'}</span>
}

function CautionBadge({ status }) {
  const map = { held: 'bp', refunded: 'ba', forfeited: 'bd', partial: 'br' }
  return <span className={`badge ${map[status] || 'bp'}`}>{status || 'held'}</span>
}

function avatar(name) {
  return (name || '?').split(' ').map(function (w) { return w[0] }).join('').slice(0, 2).toUpperCase()
}

const REMUN_LABELS = {
  per_student: 'Per Student (on completion)',
  per_session: 'Per Session (1 hr)',
  monthly:     'Monthly Fixed',
}

const REMUN_SUFFIX = {
  per_student: '/ student',
  per_session: '/ session',
  monthly:     '/ month',
}

// ── InstructorDetailModal ──────────────────────────────────────────────────────

function InstructorDetailModal({ instructor, allCourses, onClose, onSaved }) {
  const [tab, setTab]           = useState('profile')
  const [tabLoaded, setTabLoaded] = useState({ profile: true, caution: false, courses: false })
  const [saving, setSaving]     = useState(false)

  // ── Profile form ──
  const [form, setForm] = useState({
    full_name:  instructor.full_name  || '',
    phone:      instructor.phone      || '',
    email:      instructor.email      || '',
    address:    instructor.address    || '',
    area:       instructor.area       || '',
    city:       instructor.city       || '',
    state:      instructor.state      || '',
    pincode:    instructor.pincode    || '',
    joined_at:  instructor.joined_at  || '',
    left_at:    instructor.left_at    || '',
    status:     instructor.status     || 'active',
    notes:      instructor.notes      || '',
  })

  // ── Caution form ──
  const [caution, setCaution] = useState({
    caution_amount:            instructor.caution_amount            ?? 0,
    caution_paid_at:           instructor.caution_paid_at           || '',
    caution_mode:              instructor.caution_mode              || '',
    caution_status:            instructor.caution_status            || 'held',
    caution_settled_at:        instructor.caution_settled_at        || '',
    caution_settlement_amount: instructor.caution_settlement_amount ?? '',
    caution_notes:             instructor.caution_notes             || '',
  })

  // ── Courses state ──
  const [appointments, setAppointments]   = useState([])
  const [showAddCourse, setShowAddCourse] = useState(false)
  const [newAppt, setNewAppt] = useState({
    course_id: '', trained_by_nlh: false, training_fee: '', training_date: '',
    remuneration_mode: 'per_session', remuneration_rate: '',
    appointed_at: new Date().toISOString().split('T')[0], notes: '',
  })

  function fld(k)  { return function (e) { setForm(f    => ({ ...f, [k]: e.target.value })) } }
  function cfd(k)  { return function (e) { setCaution(c => ({ ...c, [k]: e.target.value })) } }
  function nfd(k)  { return function (e) { setNewAppt(a => ({ ...a, [k]: e.target.value })) } }

  async function loadTab(t) {
    setTab(t)
    if (tabLoaded[t]) return
    setTabLoaded(tl => ({ ...tl, [t]: true }))
    if (t === 'courses') {
      const { data } = await sb.from('instructor_courses')
        .select('*, courses(id,group_name)')
        .eq('instructor_id', instructor.id)
        .order('appointed_at', { ascending: false })
      setAppointments(data || [])
    }
  }

  // ── Save profile ──
  async function saveProfile() {
    if (!form.full_name.trim()) { showToast('Name is required', 'warn'); return }
    setSaving(true)
    const payload = {
      full_name: form.full_name.trim(),
      phone:     form.phone.trim()   || null,
      email:     form.email.trim()   || null,
      address:   form.address.trim() || null,
      area:      form.area.trim()    || null,
      city:      form.city.trim()    || null,
      state:     form.state.trim()   || null,
      pincode:   form.pincode.trim() || null,
      joined_at: form.joined_at      || null,
      left_at:   form.left_at        || null,
      status:    form.status,
      notes:     form.notes.trim()   || null,
      updated_at: new Date().toISOString(),
    }
    const { error } = await sb.from('instructors').update(payload).eq('id', instructor.id)
    setSaving(false)
    if (error) { showToast('Save failed: ' + error.message, 'err'); return }
    showToast('Profile saved')
    onSaved({ ...instructor, ...payload })
  }

  // ── Save caution ──
  async function saveCaution() {
    setSaving(true)
    const payload = {
      caution_amount:            Number(caution.caution_amount) || 0,
      caution_paid_at:           caution.caution_paid_at           || null,
      caution_mode:              caution.caution_mode              || null,
      caution_status:            caution.caution_status,
      caution_settled_at:        caution.caution_settled_at        || null,
      caution_settlement_amount: caution.caution_settlement_amount !== ''
                                   ? Number(caution.caution_settlement_amount) : null,
      caution_notes:             caution.caution_notes.trim()      || null,
      updated_at: new Date().toISOString(),
    }
    const { error } = await sb.from('instructors').update(payload).eq('id', instructor.id)
    setSaving(false)
    if (error) { showToast('Save failed: ' + error.message, 'err'); return }
    showToast('Caution deposit saved')
    onSaved({ ...instructor, ...payload })
  }

  // ── Add course appointment ──
  async function addAppointment() {
    if (!newAppt.course_id)        { showToast('Select a course', 'warn');           return }
    if (!newAppt.remuneration_rate){ showToast('Enter remuneration rate', 'warn');   return }
    setSaving(true)
    const { data, error } = await sb.from('instructor_courses').insert({
      instructor_id:      instructor.id,
      course_id:          newAppt.course_id,
      trained_by_nlh:     newAppt.trained_by_nlh,
      training_fee:       newAppt.trained_by_nlh && newAppt.training_fee
                            ? Number(newAppt.training_fee) : null,
      training_date:      newAppt.trained_by_nlh && newAppt.training_date
                            ? newAppt.training_date : null,
      remuneration_mode:  newAppt.remuneration_mode,
      remuneration_rate:  Number(newAppt.remuneration_rate),
      appointed_at:       newAppt.appointed_at,
      notes:              newAppt.notes.trim() || null,
    }).select('*, courses(id,group_name)').single()
    setSaving(false)
    if (error) { showToast('Failed: ' + error.message, 'err'); return }
    setAppointments(a => [data, ...a])
    setShowAddCourse(false)
    setNewAppt({
      course_id: '', trained_by_nlh: false, training_fee: '', training_date: '',
      remuneration_mode: 'per_session', remuneration_rate: '',
      appointed_at: new Date().toISOString().split('T')[0], notes: '',
    })
    showToast('Course appointment added')
  }

  // ── Toggle appointment active/inactive ──
  async function toggleApptStatus(appt) {
    const newStatus  = appt.status === 'active' ? 'inactive' : 'active'
    const removed_at = newStatus === 'inactive' ? new Date().toISOString().split('T')[0] : null
    const { error }  = await sb.from('instructor_courses')
      .update({ status: newStatus, removed_at }).eq('id', appt.id)
    if (error) { showToast('Update failed', 'err'); return }
    setAppointments(a => a.map(x => x.id === appt.id ? { ...x, status: newStatus, removed_at } : x))
    showToast(newStatus === 'active' ? 'Reactivated' : 'Deactivated')
  }

  const appointedIds    = appointments.filter(a => a.status === 'active').map(a => a.course_id)
  const availableCourses = allCourses.filter(c => !appointedIds.includes(c.id))
  const showSettlement   = ['refunded', 'partial', 'forfeited'].includes(caution.caution_status)

  return (
    <div className="modal-bg" onClick={function (e) { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ maxWidth: 640 }}>

        {/* header */}
        <div className="ch">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 38, height: 38, borderRadius: '50%', background: 'var(--purple)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', fontWeight: 700, fontSize: 13, flexShrink: 0,
            }}>
              {avatar(instructor.full_name)}
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{instructor.full_name}</div>
              <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                {instructor.city || 'Course Instructor'}
              </div>
            </div>
            <StatusBadge status={instructor.status} />
          </div>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>

        {/* tabs */}
        <div className="tab-row">
          {[['profile','👤 Profile'],['caution','🔒 Caution'],['courses','📚 Courses']].map(function ([id, label]) {
            return (
              <button key={id} className={'tab ' + (tab === id ? 'on' : '')} onClick={function () { loadTab(id) }}>
                {label}
              </button>
            )
          })}
        </div>

        {/* ══ Profile tab ══════════════════════════════════════════════════════ */}
        {tab === 'profile' && (
          <div>
            <div className="form-grid">
              <label className="col-span-2">Full Name *
                <input value={form.full_name} onChange={fld('full_name')} placeholder="Instructor's full name" />
              </label>
              <label>Phone
                <input value={form.phone} onChange={fld('phone')} placeholder="Mobile number" />
              </label>
              <label>Email
                <input type="email" value={form.email} onChange={fld('email')} placeholder="Email address" />
              </label>
              <label>City
                <input value={form.city} onChange={fld('city')} placeholder="Nagpur" />
              </label>
              <label>Area / Locality
                <input value={form.area} onChange={fld('area')} placeholder="Sadar, Dharampeth…" />
              </label>
              <label>State
                <input value={form.state} onChange={fld('state')} placeholder="Maharashtra" />
              </label>
              <label>PIN Code
                <input value={form.pincode} onChange={fld('pincode')} placeholder="440001" />
              </label>
              <label className="col-span-2">Street / Building Address
                <input value={form.address} onChange={fld('address')} placeholder="Flat / building / street" />
              </label>
              <label>Status
                <select value={form.status} onChange={fld('status')}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="resigned">Resigned</option>
                  <option value="terminated">Terminated</option>
                </select>
              </label>
              <label>Joined Date
                <input type="date" value={form.joined_at} onChange={fld('joined_at')} />
              </label>
              <label>Left Date
                <input type="date" value={form.left_at} onChange={fld('left_at')} />
              </label>
              <label className="col-span-2">Notes / Remarks
                <textarea value={form.notes} onChange={fld('notes')} rows={2}
                  placeholder="Any internal notes…" style={{ resize: 'vertical' }} />
              </label>
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={onClose}>Cancel</button>
              <button className="btn-p" onClick={saveProfile} disabled={saving}>
                {saving ? 'Saving…' : 'Save Profile'}
              </button>
            </div>
          </div>
        )}

        {/* ══ Caution tab ══════════════════════════════════════════════════════ */}
        {tab === 'caution' && (
          <div>
            {/* summary bar */}
            <div style={{
              margin: '0 20px 14px', padding: '10px 14px', borderRadius: 8,
              background: 'var(--purple-bg)', border: '1px solid var(--border)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 2 }}>Caution held</div>
                <div style={{ fontWeight: 700, fontSize: 18 }}>
                  ₹{Number(caution.caution_amount || 0).toLocaleString('en-IN')}
                </div>
              </div>
              <CautionBadge status={caution.caution_status} />
            </div>

            <div className="form-grid">
              <label>Amount (₹) *
                <input type="number" value={caution.caution_amount} onChange={cfd('caution_amount')} placeholder="0" />
              </label>
              <label>Collection Mode
                <select value={caution.caution_mode} onChange={cfd('caution_mode')}>
                  <option value="">— Select —</option>
                  <option value="upfront">Paid upfront on joining</option>
                  <option value="deducted">Deducted from first payment</option>
                  <option value="waived">Waived</option>
                </select>
              </label>
              <label>Date Paid / Deducted
                <input type="date" value={caution.caution_paid_at} onChange={cfd('caution_paid_at')} />
              </label>
              <label>Deposit Status
                <select value={caution.caution_status} onChange={cfd('caution_status')}>
                  <option value="held">Held (active)</option>
                  <option value="refunded">Refunded in full</option>
                  <option value="partial">Partially refunded</option>
                  <option value="forfeited">Forfeited</option>
                </select>
              </label>
              {showSettlement && (
                <>
                  <label>Settlement Date
                    <input type="date" value={caution.caution_settled_at} onChange={cfd('caution_settled_at')} />
                  </label>
                  <label>Settlement Amount (₹)
                    <input type="number" value={caution.caution_settlement_amount}
                      onChange={cfd('caution_settlement_amount')}
                      placeholder="Amount returned / forfeited" />
                  </label>
                </>
              )}
              <label className="col-span-2">Notes
                <textarea value={caution.caution_notes} onChange={cfd('caution_notes')} rows={2}
                  placeholder="Notes on the deposit…" style={{ resize: 'vertical' }} />
              </label>
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={onClose}>Cancel</button>
              <button className="btn-p" onClick={saveCaution} disabled={saving}>
                {saving ? 'Saving…' : 'Save Caution'}
              </button>
            </div>
          </div>
        )}

        {/* ══ Courses tab ══════════════════════════════════════════════════════ */}
        {tab === 'courses' && (
          <div>
            <div style={{ padding: '0 20px 12px' }}>
              {appointments.length === 0 && !showAddCourse && (
                <p className="hint">No course appointments yet.</p>
              )}

              {/* Appointment cards */}
              {appointments.map(function (appt) {
                return (
                  <div key={appt.id} style={{
                    border: '1px solid var(--border)', borderRadius: 8,
                    padding: '10px 14px', marginBottom: 8,
                    background: appt.status === 'inactive' ? 'var(--bg2)' : 'var(--bg)',
                    opacity: appt.status === 'inactive' ? 0.65 : 1,
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 3 }}>
                          {appt.courses?.group_name || '—'}
                          <span className={`badge ${appt.status === 'active' ? 'ba' : 'bd'}`}
                            style={{ marginLeft: 6, fontSize: 9 }}>
                            {appt.status}
                          </span>
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--purple)', fontWeight: 600, marginBottom: 2 }}>
                          {REMUN_LABELS[appt.remuneration_mode]}
                          {' · '}₹{Number(appt.remuneration_rate).toLocaleString('en-IN')}
                          {' '}{REMUN_SUFFIX[appt.remuneration_mode]}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                          Appointed: {fmtDate(appt.appointed_at)}
                          {appt.removed_at && ` · Removed: ${fmtDate(appt.removed_at)}`}
                          {appt.trained_by_nlh && (
                            <span style={{ marginLeft: 10 }}>
                              ✅ NLH Trained
                              {appt.training_date ? ` (${fmtDate(appt.training_date)})` : ''}
                              {appt.training_fee ? ` · ₹${Number(appt.training_fee).toLocaleString('en-IN')}` : ''}
                            </span>
                          )}
                        </div>
                        {appt.notes && (
                          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
                            {appt.notes}
                          </div>
                        )}
                      </div>
                      <button className="btn" style={{ fontSize: 11, padding: '4px 10px', flexShrink: 0 }}
                        onClick={function () { toggleApptStatus(appt) }}>
                        {appt.status === 'active' ? 'Deactivate' : 'Reactivate'}
                      </button>
                    </div>
                  </div>
                )
              })}

              {/* Add appointment form */}
              {showAddCourse ? (
                <div style={{ border: '1.5px dashed var(--purple)', borderRadius: 8, padding: '14px', marginTop: 8 }}>
                  <div style={{ font: '600 12px var(--font)', color: 'var(--purple)', marginBottom: 10 }}>
                    New Course Appointment
                  </div>
                  <div className="form-grid">
                    <label className="col-span-2">Course *
                      <select value={newAppt.course_id} onChange={nfd('course_id')}>
                        <option value="">— Select course —</option>
                        {availableCourses.map(function (c) {
                          return <option key={c.id} value={c.id}>{c.group_name}</option>
                        })}
                      </select>
                    </label>
                    <label>Remuneration Mode *
                      <select value={newAppt.remuneration_mode} onChange={nfd('remuneration_mode')}>
                        <option value="per_session">Per Session (₹ / hour)</option>
                        <option value="per_student">Per Student (₹ on completion)</option>
                        <option value="monthly">Monthly Fixed (₹ / month)</option>
                      </select>
                    </label>
                    <label>Rate (₹) *
                      <input type="number" value={newAppt.remuneration_rate}
                        onChange={nfd('remuneration_rate')}
                        placeholder={
                          newAppt.remuneration_mode === 'per_session' ? 'e.g. 150' :
                          newAppt.remuneration_mode === 'monthly'     ? 'e.g. 5000' :
                                                                        'e.g. 500'
                        } />
                    </label>
                    <label>Appointed From
                      <input type="date" value={newAppt.appointed_at} onChange={nfd('appointed_at')} />
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 20 }}>
                      <input type="checkbox" checked={newAppt.trained_by_nlh}
                        onChange={function (e) { setNewAppt(a => ({ ...a, trained_by_nlh: e.target.checked })) }} />
                      Trained by NLH
                    </label>
                    {newAppt.trained_by_nlh && (
                      <>
                        <label>Training Fee Paid (₹)
                          <input type="number" value={newAppt.training_fee} onChange={nfd('training_fee')}
                            placeholder="0 if waived" />
                        </label>
                        <label>Training Date
                          <input type="date" value={newAppt.training_date} onChange={nfd('training_date')} />
                        </label>
                      </>
                    )}
                    <label className="col-span-2">Notes
                      <input value={newAppt.notes} onChange={nfd('notes')}
                        placeholder="Remarks on this appointment…" />
                    </label>
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                    <button className="btn" onClick={function () { setShowAddCourse(false) }}>Cancel</button>
                    <button className="btn-p" onClick={addAppointment} disabled={saving}>
                      {saving ? 'Saving…' : 'Add Appointment'}
                    </button>
                  </div>
                </div>
              ) : (
                <button className="btn-s" style={{ marginTop: 4 }}
                  onClick={function () { setShowAddCourse(true) }}
                  disabled={availableCourses.length === 0}>
                  + Appoint to Course
                </button>
              )}
              {availableCourses.length === 0 && appointments.filter(a => a.status === 'active').length > 0 && (
                <p className="hint" style={{ marginTop: 6 }}>All courses are already appointed.</p>
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  )
}

// ── AddInstructorModal ─────────────────────────────────────────────────────────

function AddInstructorModal({ nlhCentreId, onClose, onSaved }) {
  const [form, setForm] = useState({
    full_name: '', phone: '', email: '',
    city: '', area: '', state: '', pincode: '', address: '',
    joined_at: new Date().toISOString().split('T')[0],
    caution_amount: '', caution_mode: '', caution_paid_at: '',
    notes: '',
  })
  const [saving, setSaving] = useState(false)

  function fld(k) { return function (e) { setForm(f => ({ ...f, [k]: e.target.value })) } }

  async function save() {
    if (!form.full_name.trim()) { showToast('Name is required', 'warn'); return }
    setSaving(true)
    const { data, error } = await sb.from('instructors').insert({
      franchisee_id:  nlhCentreId,
      full_name:      form.full_name.trim(),
      phone:          form.phone.trim()    || null,
      email:          form.email.trim()    || null,
      address:        form.address.trim()  || null,
      area:           form.area.trim()     || null,
      city:           form.city.trim()     || null,
      state:          form.state.trim()    || null,
      pincode:        form.pincode.trim()  || null,
      joined_at:      form.joined_at       || null,
      caution_amount: form.caution_amount  ? Number(form.caution_amount) : 0,
      caution_mode:   form.caution_mode    || null,
      caution_paid_at:form.caution_paid_at || null,
      caution_status: 'held',
      notes:          form.notes.trim()    || null,
    }).select().single()
    setSaving(false)
    if (error) { showToast('Failed: ' + error.message, 'err'); return }
    showToast(form.full_name.trim() + ' added as CI')
    onSaved(data)
  }

  return (
    <div className="modal-bg" onClick={function (e) { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ maxWidth: 580 }}>
        <div className="ch">
          <span>➕ Add Course Instructor (CI)</span>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>

        <div>
          {/* Personal info */}
          <div className="form-grid">
            <label className="col-span-2">Full Name *
              <input value={form.full_name} onChange={fld('full_name')}
                placeholder="Instructor's full name" autoFocus />
            </label>
            <label>Phone
              <input value={form.phone} onChange={fld('phone')} placeholder="Mobile number" />
            </label>
            <label>Email
              <input type="email" value={form.email} onChange={fld('email')} placeholder="Email address" />
            </label>
            <label>City
              <input value={form.city} onChange={fld('city')} placeholder="Nagpur" />
            </label>
            <label>Area / Locality
              <input value={form.area} onChange={fld('area')} placeholder="Sadar, Dharampeth…" />
            </label>
            <label>State
              <input value={form.state} onChange={fld('state')} placeholder="Maharashtra" />
            </label>
            <label>PIN Code
              <input value={form.pincode} onChange={fld('pincode')} placeholder="440001" />
            </label>
            <label>Joined Date
              <input type="date" value={form.joined_at} onChange={fld('joined_at')} />
            </label>
          </div>

          {/* Caution deposit */}
          <div style={{ borderTop: '1px solid var(--border)', margin: '4px 20px 0', paddingTop: 12 }}>
            <div style={{ font: '600 12px var(--font)', color: 'var(--text)', marginBottom: 8 }}>
              🔒 Caution Deposit
            </div>
            <div className="form-grid">
              <label>Amount (₹)
                <input type="number" value={form.caution_amount} onChange={fld('caution_amount')}
                  placeholder="0" />
              </label>
              <label>Collection Mode
                <select value={form.caution_mode} onChange={fld('caution_mode')}>
                  <option value="">— Select —</option>
                  <option value="upfront">Paid upfront on joining</option>
                  <option value="deducted">Deducted from first payment</option>
                  <option value="waived">Waived</option>
                </select>
              </label>
              {form.caution_mode && form.caution_mode !== 'waived' && (
                <label>Date Paid / Deducted
                  <input type="date" value={form.caution_paid_at} onChange={fld('caution_paid_at')} />
                </label>
              )}
            </div>
          </div>

          {/* Notes */}
          <div style={{ padding: '0 20px', marginTop: 4 }}>
            <label>Notes
              <textarea value={form.notes} onChange={fld('notes')} rows={2}
                placeholder="Any internal notes…" style={{ resize: 'vertical', width: '100%' }} />
            </label>
          </div>
        </div>

        <div className="modal-actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn-p" onClick={save} disabled={saving}>
            {saving ? 'Adding…' : 'Add Instructor'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── InstructorsPage ────────────────────────────────────────────────────────────

export default function InstructorsPage() {
  const { currentRole } = useAuth()
  const admin = isAdminRole(currentRole)

  const [instructors,   setInstructors]   = useState([])
  const [allCourses,    setAllCourses]     = useState([])
  const [nlhCentreId,   setNlhCentreId]   = useState(null)
  const [loading,       setLoading]        = useState(true)
  const [search,        setSearch]         = useState('')
  const [statusFilter,  setStatusFilter]   = useState('active')
  const [selected,      setSelected]       = useState(null)
  const [showAdd,       setShowAdd]        = useState(false)

  useEffect(function () {
    async function load() {
      setLoading(true)

      // NLH Own Centre
      const { data: nlh } = await sb.from('franchisees').select('id').eq('tier', 'NLH').single()
      if (!nlh) { setLoading(false); return }
      setNlhCentreId(nlh.id)

      // Instructors with their active course appointments
      const { data: ins, error } = await sb.from('instructors')
        .select('*, instructor_courses(id,status,remuneration_mode,remuneration_rate,courses(group_name))')
        .eq('franchisee_id', nlh.id)
        .order('full_name')
      if (error) showToast('Load failed: ' + error.message, 'err')
      setInstructors(ins || [])

      // All courses for appointment modal
      const { data: courses } = await sb.from('courses').select('id,group_name').order('group_name')
      setAllCourses(courses || [])

      setLoading(false)
    }
    load()
  }, [])

  const filtered = instructors.filter(function (ins) {
    if (statusFilter !== 'all' && ins.status !== statusFilter) return false
    const q = search.toLowerCase()
    return !q
      || ins.full_name?.toLowerCase().includes(q)
      || ins.phone?.includes(q)
      || ins.city?.toLowerCase().includes(q)
  })

  function handleSaved(updated) {
    setInstructors(function (prev) {
      return prev.map(function (i) { return i.id === updated.id ? { ...i, ...updated } : i })
    })
    setSelected(function (s) { return s && s.id === updated.id ? { ...s, ...updated } : s })
  }

  function handleAdded(ins) {
    setInstructors(function (prev) {
      return [...prev, { ...ins, instructor_courses: [] }]
        .sort(function (a, b) { return (a.full_name || '').localeCompare(b.full_name || '') })
    })
    setShowAdd(false)
  }

  // summary counts
  const total       = instructors.length
  const activeCount = instructors.filter(function (i) { return i.status === 'active' }).length
  const inactiveCount = total - activeCount
  const totalCaution  = instructors.reduce(function (s, i) {
    return s + (i.caution_status === 'held' || i.caution_status === 'partial' ? (i.caution_amount || 0) : 0)
  }, 0)
  const coursesCovered = [...new Set(
    instructors.flatMap(function (i) {
      return (i.instructor_courses || [])
        .filter(function (c) { return c.status === 'active' })
        .map(function (c) { return c.courses?.group_name })
    }).filter(Boolean)
  )].length

  return (
    <div className="pg">
      {/* topbar */}
      <header className="tb">
        <div className="crumb">Operations <span className="sep">›</span> <b>Instructors</b></div>
        <div className="tb-r">
          <input className="search tb-search" placeholder="Search by name, phone, city…"
            value={search} onChange={function (e) { setSearch(e.target.value) }} />
          {admin && (
            <button className="btn btn-p" onClick={function () { setShowAdd(true) }}>+ Add CI</button>
          )}
        </div>
      </header>

      <div className="content">
        {/* page header */}
        <div className="ph">
          <div className="ph-l">
            <div className="ph-eyebrow"><span className="dot"></span>NLH Own Centre</div>
            <h1 className="ph-title">Course Instructors</h1>
            <div className="ph-sub">
              <b>{activeCount} active</b> instructor{activeCount !== 1 ? 's' : ''} covering {coursesCovered} course{coursesCovered !== 1 ? 's' : ''}.
            </div>
          </div>
        </div>

        {/* mini stats */}
        <div className="mini-stats">
          <div className="mini">
            <div className="mini-ic" style={{ background: 'var(--purple-bg)' }}>👩‍🏫</div>
            <div className="mini-num">{activeCount}</div>
            <div className="mini-lbl">Active CIs</div>
          </div>
          <div className="mini">
            <div className="mini-ic" style={{ background: 'var(--sun-bg)' }}>📚</div>
            <div className="mini-num">{coursesCovered}</div>
            <div className="mini-lbl">Courses covered</div>
          </div>
          <div className="mini">
            <div className="mini-ic" style={{ background: 'var(--green-bg)' }}>🔒</div>
            <div className="mini-num">₹{totalCaution.toLocaleString('en-IN')}</div>
            <div className="mini-lbl">Caution held</div>
          </div>
          <div className="mini">
            <div className="mini-ic" style={{ background: 'var(--bg4)' }}>💤</div>
            <div className="mini-num">{inactiveCount}</div>
            <div className="mini-lbl">Inactive / Left</div>
          </div>
        </div>

        {/* filter pills */}
        <div className="filter-pills" style={{ marginBottom: 12 }}>
          {[
            ['active',   'Active',        activeCount],
            ['all',      'All',           total],
            ['inactive', 'Inactive / Left', inactiveCount],
          ].map(function ([val, label, count]) {
            return (
              <button key={val}
                className={'pill ' + (statusFilter === val ? 'on' : '')}
                onClick={function () { setStatusFilter(val) }}>
                {label} <span className="pill-count">{count}</span>
              </button>
            )
          })}
        </div>

        {/* table */}
        {loading ? (
          <div className="loading">Loading instructors…</div>
        ) : (
          <div className="card tbl-scroll" style={{ marginBottom: 0 }}>
            <table className="big-tbl">
              <thead>
                <tr>
                  <th>Instructor</th>
                  <th>Contact</th>
                  <th>Courses Appointed</th>
                  <th>Caution</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr><td colSpan={6} className="empty">No instructors found</td></tr>
                )}
                {filtered.map(function (ins) {
                  const activeCourses = (ins.instructor_courses || [])
                    .filter(function (c) { return c.status === 'active' })
                  return (
                    <tr key={ins.id} style={{ cursor: 'pointer' }}
                      onClick={function () { setSelected(ins) }}>
                      <td>
                        <div className="placer-cell">
                          <div className="placer-av" style={{ background: 'var(--purple)' }}>
                            {avatar(ins.full_name)}
                          </div>
                          <div>
                            <div className="placer-name">{ins.full_name}</div>
                            <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                              {ins.joined_at ? 'Joined ' + fmtDate(ins.joined_at) : 'No join date'}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--text2)' }}>
                        <div>{ins.phone || '—'}</div>
                        <div style={{ color: 'var(--text3)' }}>{ins.city || ''}</div>
                      </td>
                      <td>
                        {activeCourses.length === 0
                          ? <span style={{ color: 'var(--text3)', fontSize: 12 }}>None appointed</span>
                          : activeCourses.map(function (c) {
                            return (
                              <span key={c.id} className="badge bp"
                                style={{ marginRight: 4, marginBottom: 2, fontSize: 10 }}>
                                {c.courses?.group_name || '—'}
                              </span>
                            )
                          })
                        }
                      </td>
                      <td style={{ fontSize: 12 }}>
                        {ins.caution_amount > 0
                          ? <>
                              <div style={{ fontWeight: 600 }}>
                                ₹{Number(ins.caution_amount).toLocaleString('en-IN')}
                              </div>
                              <CautionBadge status={ins.caution_status} />
                            </>
                          : <span style={{ color: 'var(--text3)' }}>—</span>
                        }
                      </td>
                      <td><StatusBadge status={ins.status} /></td>
                      <td style={{ textAlign: 'right' }}>
                        <button className="row-action"
                          onClick={function (e) { e.stopPropagation(); setSelected(ins) }}>
                          View
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selected && (
        <InstructorDetailModal
          instructor={selected}
          allCourses={allCourses}
          onClose={function () { setSelected(null) }}
          onSaved={handleSaved}
        />
      )}

      {showAdd && nlhCentreId && (
        <AddInstructorModal
          nlhCentreId={nlhCentreId}
          onClose={function () { setShowAdd(false) }}
          onSaved={handleAdded}
        />
      )}
    </div>
  )
}
