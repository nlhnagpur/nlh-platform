import React, { useState } from 'react'
import { sb } from '../supabase'
import { showToast } from '../utils'
import { sendStudentCertEmail } from '../services/email'

// ── helpers ────────────────────────────────────────────────────────────────────

function todayDMY() {
  const d = new Date()
  return [
    String(d.getDate()).padStart(2, '0'),
    String(d.getMonth() + 1).padStart(2, '0'),
    d.getFullYear(),
  ].join('.')
}

// ── print window ───────────────────────────────────────────────────────────────

export function printStudentCert(student, enrollment, centre) {
  const courseName = enrollment.skus?.courses?.group_name || 'Course'
  const levelName  = enrollment.skus?.level_name || 'Level'
  const fullCourse = `${courseName} — ${levelName}`
  const parentLine = [
    student.parent_name ? `S/o. ${student.parent_name}` : null,
    student.city
      ? `R/o. ${student.city}${student.country && student.country !== 'India' ? ', ' + student.country : ''}`
      : null,
  ].filter(Boolean).join(' • ')
  const centreLine = `${centre?.business_name || 'New Learning Horizons'}${centre?.city ? ', ' + centre.city : ''}`

  const params = new URLSearchParams({
    type:   'student',
    name:   student.full_name,
    parent: parentLine,
    course: fullCourse,
    centre: centreLine,
    date:   todayDMY(),
  })
  window.open(`/certificate/Issue%20Certificate.html?${params}`, '_blank', 'width=1120,height=820')
}

// ── modal component ────────────────────────────────────────────────────────────

export default function StudentCertModal({ student, enrollment, centre, onClose }) {
  const [emailing,    setEmailing]    = useState(false)
  const [emailed,     setEmailed]     = useState(!!enrollment.cert_emailed_at)
  const [emailInput,  setEmailInput]  = useState(student.email || '')
  const [showInput,   setShowInput]   = useState(false)

  const courseName  = enrollment.skus?.courses?.group_name || 'Course'
  const levelName   = enrollment.skus?.level_name || 'Level'
  const fullCourse  = `${courseName} — ${levelName}`

  async function handleEmail() {
    const dest = emailInput.trim()
    if (!dest || !dest.includes('@')) {
      showToast('Please enter a valid email address', 'warn')
      setShowInput(true)
      return
    }
    setEmailing(true)
    try {
      const res = await sendStudentCertEmail(student, enrollment, centre, dest)
      if (!res.success) throw new Error(res.error || 'Send failed')
      await sb.from('enrollments')
        .update({ cert_emailed_at: new Date().toISOString() })
        .eq('id', enrollment.id)
      // Also persist the email on student record if not already set
      if (!student.email && dest) {
        await sb.from('students').update({ email: dest }).eq('id', student.id)
      }
      setEmailed(true)
      setShowInput(false)
      showToast('Certificate emailed to ' + dest)
    } catch (err) {
      showToast('Email failed: ' + err.message, 'err')
    }
    setEmailing(false)
  }

  return (
    <div className="modal-bg" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 560 }}>
        <div className="ch">
          <span>🎓 Certificate of Accomplishment</span>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>

        {/* ── Preview card ── */}
        <div style={{ padding: '0 20px' }}>
          <div style={{
            borderRadius: 10, overflow: 'hidden',
            border: '1px solid #D6D0C4',
            backgroundImage: 'url(/Certificate%20Background.png)',
            backgroundSize: 'cover', backgroundPosition: 'center',
            display: 'flex', marginBottom: 12,
            fontFamily: 'Arial,sans-serif',
          }}>
            {/* Main area */}
            <div style={{ flex: 1, padding: '12px 14px 10px', display: 'flex', flexDirection: 'column' }}>
              <img
                src="/NLH Logo.png" alt="NLH"
                style={{ height: 32, objectFit: 'contain', alignSelf: 'flex-start', marginBottom: 6 }}
                onError={e => { e.target.style.display = 'none' }}
              />
              <div style={{ fontFamily: 'Georgia,serif', fontSize: 16, fontStyle: 'italic', fontWeight: 700, color: '#CC0000', marginBottom: 2 }}>
                Certificate of Accomplishment
              </div>
              <div style={{ fontSize: 8, fontWeight: 700, letterSpacing: 2, color: '#1A3A6A', marginBottom: 8 }}>
                THIS IS TO CERTIFY THAT
              </div>

              <div style={{ fontFamily: 'Georgia,serif', fontSize: 20, fontWeight: 700, color: '#CC0000', marginBottom: 2, lineHeight: 1.15 }}>
                {student.full_name}
              </div>
              {student.parent_name && (
                <div style={{ fontSize: 9, fontStyle: 'italic', color: '#1A1916', marginBottom: 5 }}>
                  S/o. {student.parent_name}{student.city ? ` • R/o. ${student.city}` : ''}
                </div>
              )}

              <div style={{ fontSize: 9, color: '#555', marginBottom: 2 }}>Has successfully completed</div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#1A3A6A', marginBottom: 2, lineHeight: 1.3 }}>
                {fullCourse}
              </div>
              <div style={{ fontSize: 9, color: '#1A1916', marginBottom: 8 }}>
                at {centre?.business_name || 'New Learning Horizons'}{centre?.city ? ', ' + centre.city : ''}
              </div>

              {/* Footer: sig | mascot | date */}
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end',
                marginTop: 'auto', paddingTop: 8, borderTop: '1px solid rgba(26,58,106,0.18)',
              }}>
                <div style={{ textAlign: 'left' }}>
                  <img
                    src="/DRP Signature.png" alt="Signature"
                    style={{ height: 26, objectFit: 'contain', display: 'block', marginBottom: 1 }}
                    onError={e => { e.target.style.display = 'none' }}
                  />
                  <div style={{ fontSize: 10, fontStyle: 'italic', color: '#1A1916', fontWeight: 700 }}>Dhiral Panchmatia</div>
                  <div style={{ fontSize: 8, color: '#1A3A6A' }}>Founder, New Learning Horizons</div>
                </div>
                <img
                  src="/NLH Mascot.png" alt=""
                  style={{ height: 40, objectFit: 'contain' }}
                  onError={e => { e.target.style.display = 'none' }}
                />
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#1A1916' }}>{todayDMY()}</div>
                  <div style={{ fontSize: 8, color: '#555', letterSpacing: 1 }}>DATE</div>
                </div>
              </div>
            </div>

            {/* Right sidebar */}
            <div style={{
              width: 78, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 6px', textAlign: 'center',
              borderLeft: '1.5px solid rgba(204,0,0,0.2)',
              background: 'rgba(255,255,255,0.1)',
            }}>
              <div style={{ fontSize: 8, fontWeight: 700, color: '#CC0000' }}>Estd. 2008</div>
              <img
                src="/NLH Logo.png" alt="NLH"
                style={{ height: 28, objectFit: 'contain' }}
                onError={e => { e.target.style.display = 'none' }}
              />
              <div style={{ fontSize: 7, fontWeight: 700, color: '#1A3A6A' }}>ISO 9001:2015</div>
              <div style={{ fontSize: 7, color: '#555', fontStyle: 'italic', lineHeight: 1.4 }}>
                Enriching Children's Future
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 7, color: '#534AB7' }}>
                <span>📸 /newlearninghorizon</span>
                <span>📘 /nlhnag</span>
                <span>🌐 nlhnagpur.info</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'center' }}>
                <img src="/acem-abacus-logo.png" alt="ACEM" style={{ height: 16, objectFit: 'contain' }} onError={e => { e.target.style.display = 'none' }} />
                <img src="/writewell-logo.png" alt="WriteWell" style={{ height: 16, objectFit: 'contain' }} onError={e => { e.target.style.display = 'none' }} />
                <img src="/easy-math-logo.png" alt="Easy Math" style={{ height: 16, objectFit: 'contain' }} onError={e => { e.target.style.display = 'none' }} />
              </div>
            </div>
          </div>

          {/* ── Email section ── */}
          {emailed && (
            <p className="hint" style={{ color: 'var(--green)' }}>
              ✓ Certificate emailed
              {enrollment.cert_emailed_at
                ? ` on ${new Date(enrollment.cert_emailed_at).toLocaleDateString('en-IN')}`
                : ''}
            </p>
          )}

          {(showInput || !student.email) && (
            <div className="fr" style={{ marginBottom: 4 }}>
              <label style={{ fontSize: 11, marginBottom: 4, display: 'block' }}>
                Parent's email address *
              </label>
              <input
                type="email"
                value={emailInput}
                onChange={e => setEmailInput(e.target.value)}
                placeholder="parent@example.com"
                style={{ width: '100%' }}
              />
            </div>
          )}
          {student.email && !showInput && (
            <p className="hint">
              Will be sent to: <strong>{student.email}</strong> &nbsp;
              <button
                onClick={() => setShowInput(true)}
                style={{ background: 'none', border: 'none', color: 'var(--purple)', cursor: 'pointer', font: '500 11px var(--font)', textDecoration: 'underline' }}
              >
                Change
              </button>
            </p>
          )}
        </div>

        <div className="modal-actions">
          <button className="btn" onClick={onClose}>Close</button>
          <button className="btn-s" onClick={() => printStudentCert(student, enrollment, centre)}>
            🖨️ Print / PDF
          </button>
          <button className="btn-p" onClick={handleEmail} disabled={emailing}>
            {emailing ? 'Sending…' : emailed ? '📧 Re-send' : '📧 Email to Parent'}
          </button>
        </div>
      </div>
    </div>
  )
}
