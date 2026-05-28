import React, { useState, useRef } from 'react'
import { toPng } from 'html-to-image'
import { sb } from '../supabase'
import { showToast } from '../utils'
import { sendStudentCertEmail } from '../services/email'
import { toWAPhone } from '../services/whatsapp'

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

  // WhatsApp state
  const [waSending,   setWaSending]   = useState(false)
  const [waSent,      setWaSent]      = useState(() => allEnrollments.some(e => !!e.cert_wa_sent_at))
  const [waPhone,     setWaPhone]     = useState(student.phone || '')
  const [showWaInput, setShowWaInput] = useState(false)

  // Hidden full-size cert div for PNG capture
  const certCaptureRef = useRef(null)
  // Stable cert ID for this session
  const certIdRef = useRef(null)
  if (!certIdRef.current && allEnrollments.length > 0) {
    const prog = (allEnrollments[0]?.skus?.courses?.group_name || 'NLH').replace(/[^a-zA-Z]/g, '').slice(0, 4).toUpperCase()
    const lvl  = (allEnrollments[0]?.skus?.level_name || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 4).toUpperCase() || 'L1'
    certIdRef.current = `NLH-${new Date().getFullYear()}-${prog}-${lvl}-${String(Math.floor(Math.random() * 90000) + 10000)}`
  }

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

  async function handleWhatsApp() {
    const phone = waPhone.trim()
    if (!phone || !toWAPhone(phone)) {
      showToast('Please enter a valid WhatsApp phone number', 'warn')
      setShowWaInput(true)
      return
    }
    if (!selected.length) {
      showToast('Select at least one course', 'warn')
      return
    }
    if (!certCaptureRef.current) {
      showToast('Certificate not ready — try again', 'warn')
      return
    }
    setWaSending(true)
    try {
      const waTo = toWAPhone(phone)

      const courses = selected.map(function (e) {
        const c = e.skus?.courses?.group_name || 'Course'
        const l = e.skus?.level_name || ''
        return l ? `${c} — ${l}` : c
      }).join(', ')

      // ── 1. Send congratulatory text first (opens the session window) ──────
      const textBody =
        `🎓 *Congratulations ${student.full_name}!*\n\n` +
        `Dear ${student.parent_name || 'Parent'},\n\n` +
        `We are delighted to inform you that *${student.full_name}* has successfully completed ` +
        `*${courses}* at New Learning Horizons! 🌟\n\n` +
        `Thank you for choosing NLH and for your continued trust in us. ` +
        `We look forward to welcoming ${student.full_name} to the next level and exploring our other exciting programmes together.\n\n` +
        `With warm regards,\nNew Learning Horizons 🌟`

      const textRes = await fetch('/api/send-whatsapp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: waTo, text: textBody }),
      })
      const textData = await textRes.json()
      console.log('[WA] text send response:', JSON.stringify(textData))
      if (!textData.success) {
        const detail = textData.data?.error
        const code   = detail?.code ? ` (code ${detail.code})` : ''
        throw new Error((detail?.message || textData.error || 'Text message failed') + code)
      }

      // ── 2. Capture the hidden full-size cert as PNG ───────────────────────
      const dataUrl = await toPng(certCaptureRef.current, {
        width: 2000, height: 1414, pixelRatio: 1, cacheBust: true,
      })

      // ── 3. Send certificate image ─────────────────────────────────────────
      const imgRes = await fetch('/api/send-whatsapp-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to:          waTo,
          imageBase64: dataUrl,
          caption:     `📜 Certificate of Accomplishment — ${courses}`,
          filename:    `NLH-Certificate-${student.full_name.replace(/\s+/g, '-')}.png`,
        }),
      })
      const imgData = await imgRes.json()
      console.log('[WA] image send response:', JSON.stringify(imgData))
      if (!imgData.success) {
        const detail = imgData.detail?.error
        const code   = detail?.code ? ` (code ${detail.code})` : ''
        throw new Error((detail?.message || imgData.error || 'Image send failed') + code)
      }

      const msgId = imgData.data?.messages?.[0]?.id || '—'
      console.log('[WA] image message id:', msgId, '→ sent to', waTo)

      // ── 4. Mark as sent ───────────────────────────────────────────────────
      await sb.from('enrollments')
        .update({ cert_wa_sent_at: new Date().toISOString() })
        .in('id', selected.map(e => e.id))
      setWaSent(true)
      setShowWaInput(false)
      showToast(`Certificate sent via WhatsApp to ${waTo} ✓`)
    } catch (err) {
      showToast('WhatsApp send failed: ' + err.message, 'err')
    }
    setWaSending(false)
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
                  ? <div style={{ fontSize: 46, fontWeight: 700, color: '#0A1A33', margin: '6px 0', lineHeight: 1.3 }}>
                      {selected.map(function (e, i) {
                        const course = e.skus?.courses?.group_name || 'Course'
                        const level  = e.skus?.level_name || ''
                        const text   = level ? `${course} — ${level}` : course
                        return i === 0 ? text : `, ${text}`
                      }).join('')}
                    </div>
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
                      <span style={{ marginLeft: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                        {e.cert_emailed_at && (
                          <span style={{ fontSize: 10, color: 'var(--text3)' }}>
                            ✓ emailed {new Date(e.cert_emailed_at).toLocaleDateString('en-IN')}
                          </span>
                        )}
                        {e.cert_wa_sent_at && (
                          <span style={{ fontSize: 10, color: '#25D366' }}>
                            ✓ WhatsApp {new Date(e.cert_wa_sent_at).toLocaleDateString('en-IN')}
                          </span>
                        )}
                      </span>
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

          {/* ── WhatsApp section ── */}
          <div style={{ borderTop: '1px solid var(--border)', marginTop: 10, paddingTop: 10 }}>
            {waSent && (
              <p className="hint" style={{ color: '#25D366', marginBottom: 4 }}>
                ✓ Certificate shared via WhatsApp
              </p>
            )}
            {(showWaInput || !student.phone) && (
              <div className="fr" style={{ marginBottom: 4 }}>
                <label style={{ fontSize: 11, marginBottom: 4, display: 'block' }}>
                  Parent's WhatsApp number *
                </label>
                <input
                  type="tel"
                  value={waPhone}
                  onChange={function (e) { setWaPhone(e.target.value) }}
                  placeholder="e.g. 9876543210"
                  style={{ width: '100%' }}
                />
              </div>
            )}
            {student.phone && !showWaInput && (
              <p className="hint">
                WhatsApp to: <strong>{student.phone}</strong> &nbsp;
                <button
                  onClick={function () { setShowWaInput(true) }}
                  style={{
                    background: 'none', border: 'none', color: 'var(--purple)',
                    cursor: 'pointer', font: '500 11px var(--font)', textDecoration: 'underline',
                  }}
                >Change</button>
              </p>
            )}
          </div>
        </div>

        {/* ── Hidden full-size cert for PNG capture (off-screen) ── */}
        <div
          ref={certCaptureRef}
          aria-hidden="true"
          style={{
            position: 'fixed', top: '-9999px', left: '-9999px',
            width: 2000, height: 1414,
            backgroundImage: 'url(/certificate/assets/cert-bg.png)',
            backgroundSize: '100% 100%',
            fontFamily: '"DM Sans", Arial, sans-serif',
            pointerEvents: 'none',
          }}
        >
          {/* Student name */}
          <div style={{
            position: 'absolute', top: 700, left: 80, right: 80,
            transform: 'translateY(-100%)', textAlign: 'center',
            fontWeight: 700,
            fontSize: Math.min(110, Math.floor(1840 / Math.max((`${title} ${student.full_name}`).length * 0.62, 1))),
            color: '#C41818', whiteSpace: 'nowrap', lineHeight: 1, letterSpacing: '-0.02em',
          }}>
            {title} {student.full_name}
          </div>
          {/* Body text */}
          <div style={{
            position: 'absolute', top: 775, left: 80, right: 80,
            textAlign: 'center', fontSize: 38, color: '#1A1A2E', lineHeight: 1.38,
          }}>
            <div>{parentText}</div>
            <div style={{ fontSize: 34, color: '#2A2A40', marginTop: 10 }}>has successfully completed</div>
            <div style={{ fontSize: 50, fontWeight: 700, color: '#0A1A33', margin: '8px 0 6px', lineHeight: 1.2 }}>
              {selected.map(function (e, i) {
                const course = e.skus?.courses?.group_name || 'Course'
                const level  = e.skus?.level_name || ''
                const text   = level ? `${course} — ${level}` : course
                return (
                  <React.Fragment key={e.id || i}>
                    {i > 0 && ', '}
                    <span style={{ whiteSpace: 'nowrap' }}>{text}</span>
                  </React.Fragment>
                )
              })}
            </div>
            <div style={{ fontSize: 34, color: '#2A2A40', marginTop: 6 }}>
              at <span style={{ fontWeight: 600 }}>{centerText}</span>
            </div>
          </div>
          {/* Date */}
          <div style={{
            position: 'absolute', top: 1190, left: 610, width: 460,
            transform: 'translateY(-100%)', textAlign: 'center',
            fontSize: 30, fontWeight: 600, color: '#1A1A2E', letterSpacing: '0.02em',
          }}>
            {todayDMY()}
          </div>
          {/* Cert ID */}
          <div style={{
            position: 'absolute', top: 1372, left: 0, right: 0,
            textAlign: 'center', fontFamily: '"DM Mono", monospace',
            fontSize: 16, letterSpacing: '0.14em', textTransform: 'uppercase',
            color: 'rgba(30,30,60,0.55)',
          }}>
            {certIdRef.current}
          </div>
          {/* Mascot */}
          <img
            src="/certificate/assets/mascot.png"
            alt=""
            style={{ position: 'absolute', top: 330, right: 28, width: 270, height: 'auto' }}
          />
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
          <button
            onClick={handleWhatsApp}
            disabled={waSending || !selected.length}
            style={{
              padding: '8px 16px', borderRadius: 8, border: 'none',
              background: waSending ? '#aaa' : '#25D366',
              color: '#fff', fontWeight: 600, fontSize: 13,
              cursor: waSending || !selected.length ? 'not-allowed' : 'pointer',
              opacity: !selected.length ? 0.5 : 1,
              display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            {waSending ? 'Sending…' : waSent ? '💬 Re-send WA' : '💬 Send on WA'}
          </button>
        </div>
      </div>
    </div>
  )
}
