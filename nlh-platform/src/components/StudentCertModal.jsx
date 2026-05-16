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
  const courseName  = enrollment.skus?.courses?.group_name || 'Course'
  const levelName   = enrollment.skus?.level_name || 'Level'
  const fullCourse  = `${courseName} — ${levelName}`
  const parentLine  = [
    student.parent_name ? `S/o. ${student.parent_name}` : null,
    student.city
      ? `R/o. ${student.city}${student.country && student.country !== 'India' ? ', ' + student.country : ''}`
      : null,
  ].filter(Boolean).join(', ')
  const centreLine  = `${centre?.business_name || 'New Learning Horizons'}${centre?.city ? ', ' + centre.city : ''}`
  const dateStr     = todayDMY()
  const bgUrl       = window.location.origin + '/Student%20Certificate%20blank.png'

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Certificate of Accomplishment — ${student.full_name}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Dancing+Script:wght@700&display=swap" rel="stylesheet">
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    @page{size:A4 landscape;margin:0}
    body{margin:0;padding:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .cert{
      width:297mm;height:210mm;
      position:relative;overflow:hidden;
      background:url('${bgUrl}') center/cover no-repeat;
    }
    /* Semi-opaque mask over the main text area (right of NLH logo column ~83mm) */
    .mask{
      position:absolute;
      top:5mm;left:83mm;width:200mm;height:148mm;
      background:rgba(195,228,250,0.94);
      display:flex;flex-direction:column;
      justify-content:center;align-items:center;
      padding:4mm 10mm;
    }
    .acc{font-family:'Dancing Script',cursive;font-size:22pt;font-weight:700;
         color:#CC0000;margin-bottom:3mm;text-align:center}
    .certify{font-family:Arial,sans-serif;font-size:10pt;font-weight:700;
             letter-spacing:1.5px;color:#1A3A6A;margin-bottom:4mm;text-align:center}
    .nm{font-family:'Dancing Script',cursive;font-size:30pt;font-weight:700;
        color:#CC0000;margin-bottom:3mm;text-align:center;line-height:1.1}
    .pr{font-family:Arial,sans-serif;font-size:9.5pt;color:#1A1916;
        margin-bottom:3mm;text-align:center}
    .comp{font-family:Arial,sans-serif;font-size:9.5pt;color:#1A1916;
          margin-bottom:2mm;text-align:center}
    .cr{font-family:Arial,sans-serif;font-size:13pt;font-weight:700;
        color:#1A3A6A;margin-bottom:2mm;text-align:center;line-height:1.3}
    .ct{font-family:Arial,sans-serif;font-size:9.5pt;color:#1A1916;text-align:center}
    .dt{position:absolute;bottom:10mm;left:130mm;
        font-family:Arial,sans-serif;font-size:9pt;font-weight:700;color:#1A1916}
    .np{text-align:right;padding:10px 20px;background:#f4f4f4}
    @media print{.np{display:none}}
  </style>
</head>
<body>
  <div class="np">
    <button onclick="window.print()"
      style="background:#534AB7;color:#fff;border:none;padding:10px 24px;
             border-radius:8px;font:700 13px Arial;cursor:pointer">
      🖨️ Print / Save as PDF
    </button>
  </div>
  <div class="cert">
    <div class="mask">
      <div class="acc">Certificate of Accomplishment</div>
      <div class="certify">THIS IS TO CERTIFY THAT</div>
      <div class="nm">${student.full_name}</div>
      ${parentLine ? `<div class="pr">${parentLine}</div>` : ''}
      <div class="comp">Has successfully completed</div>
      <div class="cr">${fullCourse}</div>
      <div class="ct">at ${centreLine}</div>
    </div>
    <div class="dt">${dateStr}</div>
  </div>
</body>
</html>`

  const win = window.open('', '_blank', 'width=1120,height=820')
  if (win) { win.document.write(html); win.document.close() }
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
      <div className="modal" style={{ maxWidth: 540 }}>
        <div className="ch">
          <span>🎓 Certificate of Accomplishment</span>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>

        {/* ── Preview card ── */}
        <div style={{ padding: '0 20px' }}>
          <div style={{
            border: '2px solid #89CFF0', borderRadius: 10,
            background: 'linear-gradient(135deg,#E8F4FD 0%,#C8E6F8 100%)',
            padding: '20px 24px', textAlign: 'center',
            fontFamily: 'Arial,sans-serif', marginBottom: 12,
          }}>
            <div style={{ fontFamily: 'Georgia,serif', fontSize: 18, fontStyle: 'italic', color: '#CC0000', marginBottom: 4 }}>
              Certificate of Accomplishment
            </div>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 2, color: '#1A3A6A', marginBottom: 12 }}>
              THIS IS TO CERTIFY THAT
            </div>

            <div style={{
              fontFamily: 'Georgia,serif', fontSize: 24, fontWeight: 700,
              color: '#CC0000', marginBottom: 3, lineHeight: 1.2,
            }}>
              {student.full_name}
            </div>
            {student.parent_name && (
              <div style={{ fontSize: 10, color: 'var(--text2)', marginBottom: 10 }}>
                S/o. {student.parent_name}{student.city ? `, R/o. ${student.city}` : ''}
              </div>
            )}

            <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 4 }}>Has successfully completed</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#1A3A6A', marginBottom: 4, lineHeight: 1.3 }}>
              {fullCourse}
            </div>
            <div style={{ fontSize: 10, color: 'var(--text2)' }}>
              at {centre?.business_name || 'New Learning Horizons'}{centre?.city ? ', ' + centre.city : ''}
            </div>

            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end',
              marginTop: 14, paddingTop: 10, borderTop: '1px dashed #89CFF0',
            }}>
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontSize: 9, fontStyle: 'italic', color: 'var(--text3)' }}>Dhiral Panchmatia</div>
                <div style={{ fontSize: 9, color: 'var(--text3)' }}>Director, NLH</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 9, color: 'var(--text3)' }}>Date</div>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#1A1916' }}>{todayDMY()}</div>
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
