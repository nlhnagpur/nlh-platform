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
  ].filter(Boolean).join(' • ')
  const centreLine  = `${centre?.business_name || 'New Learning Horizons'}${centre?.city ? ', ' + centre.city : ''}`
  const dateStr     = todayDMY()
  const origin      = window.location.origin
  const bgUrl       = origin + '/Certificate%20Background.png'
  const sigUrl      = origin + '/DRP%20Signature.png'
  const logoUrl     = origin + '/NLH%20Logo.png'
  const mascotUrl   = origin + '/NLH%20Mascot.png'

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Certificate of Accomplishment — ${student.full_name}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Dancing+Script:wght@600;700&display=swap" rel="stylesheet">
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    @page{size:A4 landscape;margin:0}
    body{margin:0;padding:0;-webkit-print-color-adjust:exact;print-color-adjust:exact;font-family:Arial,sans-serif}

    /* ── Full canvas: main area + right sidebar ── */
    .cert{
      width:297mm;height:210mm;
      display:flex;overflow:hidden;
      background:url('${bgUrl}') center/cover no-repeat;
    }

    /* ── Main content area ── */
    .main{
      flex:1;display:flex;flex-direction:column;
      padding:7mm 9mm 5mm;
    }
    .nlh-logo{height:18mm;width:auto;object-fit:contain;margin-bottom:3mm}

    /* Title */
    .acc{
      font-family:'Dancing Script',cursive;font-size:30pt;font-weight:700;
      color:#CC0000;margin-bottom:1mm;
    }
    .certify{
      font-size:9pt;font-weight:700;letter-spacing:2.5px;
      color:#1A3A6A;margin-bottom:5mm;
    }

    /* Student name */
    .nm{
      font-family:'Dancing Script',cursive;font-size:42pt;font-weight:700;
      color:#CC0000;line-height:1.05;margin-bottom:2mm;
    }
    .pr{font-size:10pt;color:#1A1916;font-style:italic;margin-bottom:2mm}
    .comp{font-size:10pt;color:#555;margin-bottom:1.5mm}
    .cr{font-size:15pt;font-weight:700;color:#1A3A6A;line-height:1.3;margin-bottom:1.5mm}
    .ct{font-size:10pt;color:#1A1916}

    /* Footer: sig | mascot | date */
    .ft{
      display:flex;justify-content:space-between;align-items:flex-end;
      border-top:1.5px solid rgba(26,58,106,0.2);
      padding-top:2.5mm;margin-top:auto;
    }
    .sig-blk{display:flex;flex-direction:column;align-items:flex-start}
    .sig-img{height:13mm;object-fit:contain;margin-bottom:0.5mm}
    .sig-nm{font-family:'Dancing Script',cursive;font-size:12pt;font-weight:700;color:#1A1916}
    .sig-tl{font-size:7.5pt;color:#1A3A6A}
    .mascot-img{height:24mm;width:auto;object-fit:contain}
    .dt-blk{text-align:right}
    .dt-val{font-size:11pt;font-weight:700;color:#1A1916}
    .dt-lbl{font-size:7pt;color:#555;letter-spacing:1px;text-transform:uppercase}

    /* ── Right sidebar ── */
    .sidebar{
      width:55mm;display:flex;flex-direction:column;
      align-items:center;justify-content:space-between;
      padding:6mm 5mm;text-align:center;
      border-left:2px solid rgba(204,0,0,0.22);
      background:rgba(255,255,255,0.10);
    }
    .estd{font-size:9pt;font-weight:700;color:#CC0000;letter-spacing:1px}
    .sb-logo{height:18mm;width:auto;object-fit:contain}
    .iso{font-size:7.5pt;font-weight:700;color:#1A3A6A;letter-spacing:0.5px}
    .tagline{font-size:7.5pt;color:#3A3830;font-style:italic;line-height:1.45}
    .social{display:flex;flex-direction:column;gap:2mm;font-size:7.5pt;color:#534AB7}
    .brand-row{display:flex;flex-direction:column;gap:2mm;align-items:center}
    .brand-row img{height:9mm;width:auto;object-fit:contain}

    .np{text-align:right;padding:10px 20px;background:#f0f0f0}
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

    <!-- ── Main content ── -->
    <div class="main">
      <img class="nlh-logo" src="${logoUrl}" alt="NLH" onerror="this.style.display='none'">

      <div class="acc">Certificate of Accomplishment</div>
      <div class="certify">THIS IS TO CERTIFY THAT</div>

      <div class="nm">${student.full_name}</div>
      ${parentLine ? `<div class="pr">${parentLine}</div>` : ''}
      <div class="comp">Has successfully completed</div>
      <div class="cr">${fullCourse}</div>
      <div class="ct">at ${centreLine}</div>

      <div class="ft">
        <div class="sig-blk">
          <img class="sig-img" src="${sigUrl}" alt="Signature" onerror="this.style.display='none'">
          <div class="sig-nm">Dhiral Panchmatia</div>
          <div class="sig-tl">Founder, New Learning Horizons</div>
        </div>
        <img class="mascot-img" src="${mascotUrl}" alt="" onerror="this.style.display='none'">
        <div class="dt-blk">
          <div class="dt-val">${dateStr}</div>
          <div class="dt-lbl">Date</div>
        </div>
      </div>
    </div>

    <!-- ── Right sidebar ── -->
    <div class="sidebar">
      <div class="estd">Estd. 2008</div>
      <img class="sb-logo" src="${logoUrl}" alt="NLH" onerror="this.style.display='none'">
      <div class="iso">ISO 9001:2015</div>
      <div class="tagline">Enriching Children's<br>Future since 2008</div>
      <div class="social">
        <span>📸 /newlearninghorizon</span>
        <span>📘 /nlhnag</span>
        <span>🌐 nlhnagpur.info</span>
      </div>
      <div class="brand-row">
        <img src="${origin}/acem-abacus-logo.png" alt="ACEM Abacus" onerror="this.style.display='none'">
        <img src="${origin}/writewell-logo.png" alt="WriteWell" onerror="this.style.display='none'">
        <img src="${origin}/easy-math-logo.png" alt="Easy Math" onerror="this.style.display='none'">
      </div>
    </div>

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
