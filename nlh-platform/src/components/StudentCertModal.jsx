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

function todayYMD() {
  const d = new Date()
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0')
}

// ── print window ───────────────────────────────────────────────────────────────

export function printStudentCert(student, selectedEnrollments, centre) {
  const isMale = (student.gender || '').toLowerCase() === 'male'
  const title  = isMale ? 'Mast.' : 'Miss.'
  const rel    = isMale ? 'S/o.' : 'D/o.'

  const location = [
    student.city,
    student.country && student.country !== 'India' ? student.country : null,
  ].filter(Boolean).join(', ')

  const centreBase = centre?.business_name || 'New Learning Horizons'
  const centerFull = centre?.city ? `${centreBase}, ${centre.city}` : centreBase

  // Pipe-separated for multiple courses
  const programs = selectedEnrollments.map(e => e.skus?.courses?.group_name || 'Course').join('|')
  const levels   = selectedEnrollments.map(e => e.skus?.level_name || '').join('|')

  const params = new URLSearchParams({
    name:     student.full_name,
    title,
    rel,
    parent:   student.parent_name || '',
    location,
    program:  programs,
    level:    levels,
    center:   centerFull,
    date:     todayYMD(),
  })
  window.open(`/certificate/Issue%20Certificate.html?${params}`, '_blank', 'width=1120,height=820')
}

// ── modal component ────────────────────────────────────────────────────────────

export default function StudentCertModal({ student, enrollments, centre, onClose }) {
  const allEnrollments = enrollments || []

  const [emailing,   setEmailing]   = useState(false)
  const [emailed,    setEmailed]    = useState(() => allEnrollments.some(e => !!e.cert_emailed_at))
  const [emailInput, setEmailInput] = useState(student.email || '')
  const [showInput,  setShowInput]  = useState(false)
  const [selectedIds, setSelectedIds] = useState(() => new Set(allEnrollments.map(e => e.id)))

  const selected = allEnrollments.filter(e => selectedIds.has(e.id))

  const isMale     = (student.gender || '').toLowerCase() === 'male'
  const title      = isMale ? 'Mast.' : 'Miss.'
  const rel        = isMale ? 'S/o.' : 'D/o.'
  const parentText = [
    student.parent_name ? `${rel} ${student.parent_name}` : null,
    student.city ? `R/o. ${student.city}` : null,
  ].filter(Boolean).join(', ')

  const centreBase = centre?.business_name || 'New Learning Horizons'
  const centerText = centre?.city ? `${centreBase}, ${centre.city}` : centreBase

  function toggleId(id) {
    setSelectedIds(function (prev) {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleAll() {
    setSelectedIds(
      selectedIds.size === allEnrollments.length
        ? new Set()
        : new Set(allEnrollments.map(e => e.id))
    )
  }

  async function handleEmail() {
    const dest = emailInput.trim()
    if (!dest || !dest.includes('@')) {
      showToast('Please enter a valid email address', 'warn')
      setShowInput(true)
      return
    }
    if (!selected.length) {
      showToast('Select at least one course', 'warn')
      return
    }
    setEmailing(true)
    try {
      const res = await sendStudentCertEmail(student, selected[0], centre, dest)
      if (!res.success) throw new Error(res.error || 'Send failed')
      await sb.from('enrollments')
        .update({ cert_emailed_at: new Date().toISOString() })
        .in('id', selected.map(e => e.id))
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
    <div className="modal-bg" onClick={function (e) { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ maxWidth: 580 }}>
        <div className="ch">
          <span>🎓 Certificate of Accomplishment</span>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>

        <div style={{ padding: '0 20px' }}>

          {/* ── Certificate preview — scaled replica of the real cert ── */}
          <div style={{
            overflow: 'hidden', borderRadius: 8,
            border: '1px solid #D6D0C4', marginBottom: 14,
            height: 358, position: 'relative', background: '#f5f4f0',
          }}>
            <div style={{
              width: 2000, height: 1414,
              transform: 'scale(0.252)', transformOrigin: 'top left',
              position: 'absolute', top: 0, left: 0,
              backgroundImage: 'url(/certificate/assets/cert-bg.png)',
              backgroundSize: '100% 100%',
              fontFamily: '"DM Sans", Arial, sans-serif',
            }}>
              {/* Student name */}
              <div style={{
                position: 'absolute', top: 700, left: 80, right: 80,
                transform: 'translateY(-100%)', textAlign: 'center',
                fontWeight: 700, fontSize: 100, color: '#C41818',
                whiteSpace: 'nowrap', lineHeight: 1, letterSpacing: '-0.02em',
              }}>
                {title} {student.full_name}
              </div>

              {/* Body text block */}
              <div style={{
                position: 'absolute', top: 775, left: 80, right: 80,
                textAlign: 'center', fontSize: 36, color: '#1A1A2E', lineHeight: 1.38,
              }}>
                <div>{parentText}</div>
                <div style={{ fontSize: 34, color: '#2A2A40', marginTop: 10 }}>
                  has successfully completed
                </div>

                {selected.length > 0
                  ? selected.map(function (e, i) {
                      const course = e.skus?.courses?.group_name || 'Course'
                      const level  = e.skus?.level_name || ''
                      return (
                        <div key={i} style={{
                          fontSize: selected.length > 2 ? 38 : 46,
                          fontWeight: 700, color: '#0A1A33',
                          margin: '4px 0', lineHeight: 1.2,
                        }}>
                          {level ? `${course} — ${level}` : course}
                        </div>
                      )
                    })
                  : <div style={{ fontSize: 46, fontWeight: 700, color: '#ccc', margin: '6px 0' }}>
                      — select courses below —
                    </div>
                }

                <div style={{ fontSize: 34, color: '#2A2A40', marginTop: 6 }}>
                  at <span style={{ fontWeight: 600 }}>{centerText}</span>
                </div>
              </div>

              {/* Date */}
              <div style={{
                position: 'absolute', top: 1190, left: 610, width: 460,
                transform: 'translateY(-100%)', textAlign: 'center',
                fontSize: 28, fontWeight: 600, color: '#1A1A2E', letterSpacing: '0.02em',
              }}>
                {todayDMY()}
              </div>
            </div>
          </div>

          {/* ── Course selector ── */}
          {allEnrollments.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{
                  fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 600,
                  color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em',
                }}>
                  Courses to include
                </span>
                <button onClick={toggleAll} style={{
                  background: 'none', border: 'none', color: 'var(--purple)',
                  cursor: 'pointer', font: '500 11px var(--font)', textDecoration: 'underline',
                }}>
                  {selectedIds.size === allEnrollments.length ? 'Deselect all' : 'Select all'}
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {allEnrollments.map(function (e) {
                  const isChecked  = selectedIds.has(e.id)
                  const courseName = e.skus?.courses?.group_name || 'Course'
                  const levelName  = e.skus?.level_name || ''
                  return (
                    <label key={e.id} style={{
                      display: 'flex', alignItems: 'center', gap: 9,
                      padding: '8px 11px', borderRadius: 7, cursor: 'pointer',
                      border: `1px solid ${isChecked ? 'var(--purple)' : 'var(--border)'}`,
                      background: isChecked ? 'var(--purple-bg)' : 'var(--bg)',
                      transition: 'all 0.1s',
                    }}>
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={function () { toggleId(e.id) }}
                        style={{ accentColor: 'var(--purple)', width: 14, height: 14 }}
                      />
                      <span style={{ fontSize: 13, fontWeight: 500, color: isChecked ? 'var(--purple)' : 'var(--text)' }}>
                        {courseName}{levelName ? ` — ${levelName}` : ''}
                      </span>
                      {e.cert_emailed_at && (
                        <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text3)' }}>
                          ✓ emailed {new Date(e.cert_emailed_at).toLocaleDateString('en-IN')}
                        </span>
                      )}
                    </label>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── Email section ── */}
          {emailed && (
            <p className="hint" style={{ color: 'var(--green)' }}>
              ✓ Certificate emailed successfully
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
                onChange={function (e) { setEmailInput(e.target.value) }}
                placeholder="parent@example.com"
                style={{ width: '100%' }}
              />
            </div>
          )}
          {student.email && !showInput && (
            <p className="hint">
              Will be sent to: <strong>{student.email}</strong> &nbsp;
              <button
                onClick={function () { setShowInput(true) }}
                style={{
                  background: 'none', border: 'none', color: 'var(--purple)',
                  cursor: 'pointer', font: '500 11px var(--font)', textDecoration: 'underline',
                }}
              >Change</button>
            </p>
          )}
        </div>

        <div className="modal-actions">
          <button className="btn" onClick={onClose}>Close</button>
          <button
            className="btn-s"
            onClick={function () { printStudentCert(student, selected, centre) }}
            disabled={!selected.length}
          >
            🖨️ Print / PDF
          </button>
          <button
            className="btn-p"
            onClick={handleEmail}
            disabled={emailing || !selected.length}
          >
            {emailing ? 'Sending…' : emailed ? '📧 Re-send' : '📧 Email to Parent'}
          </button>
        </div>
      </div>
    </div>
  )
}
