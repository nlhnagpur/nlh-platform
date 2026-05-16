import React, { useState } from 'react'
import { sb } from '../supabase'
import { showToast } from '../utils'
import { sendFranchiseeCertEmail } from '../services/email'

// ── helpers ────────────────────────────────────────────────────────────────────

function tierLabel(fr) {
  if (fr.tier === 'SMF') return 'State Master Franchisee of'
  if (fr.tier === 'CF')  return `${fr.city || ''} City Master Franchisee of`
  return 'Unit Franchisee of'
}

function validTill(createdAt) {
  const d = new Date(createdAt || Date.now())
  d.setFullYear(d.getFullYear() + 5)
  return [
    String(d.getDate()).padStart(2, '0'),
    String(d.getMonth() + 1).padStart(2, '0'),
    d.getFullYear(),
  ].join('.')
}

function buildAddress(fr) {
  return [fr.address, fr.area, fr.city, fr.state,
    fr.country && fr.country !== 'India' ? fr.country : null]
    .filter(Boolean).join(', ')
}

// ── print window ───────────────────────────────────────────────────────────────

export function printFranchiseeCert(franchisee, courseNames) {
  const label    = tierLabel(franchisee)
  const till     = validTill(franchisee.created_at)
  const address  = buildAddress(franchisee)
  const courses  = courseNames.join(', ')
  const isSMF    = franchisee.tier === 'SMF'
  const bgUrl    = window.location.origin + '/Franchisee%20Certificate%20Blank.png'

  // mask height is taller for SMF because state name adds an extra line
  const maskH    = isSMF ? '140mm' : '132mm'
  const nameSz   = isSMF ? '26pt'  : '30pt'
  const nameGap  = isSMF ? '1mm'   : '3mm'

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Franchise Certificate — ${franchisee.business_name}</title>
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
    /* White mask covers the pre-printed text area (incl. "Unit Franchisee of") */
    .mask{
      position:absolute;
      top:8mm;left:3mm;width:211mm;height:${maskH};
      background:#fff;
      display:flex;flex-direction:column;
      justify-content:center;align-items:center;
      padding:3mm 8mm;
    }
    .t1{font-family:Arial,sans-serif;font-size:14pt;font-weight:900;letter-spacing:1.5px;
        color:#1A1916;margin-bottom:3mm;text-align:center}
    .t2{font-family:Arial,sans-serif;font-size:9pt;color:#3A3830;
        margin-bottom:4mm;text-align:center}
    .nm{font-family:'Dancing Script',cursive;font-size:${nameSz};font-weight:700;
        color:#CC0000;margin-bottom:${nameGap};text-align:center;line-height:1.1}
    .st{font-family:'Dancing Script',cursive;font-size:18pt;font-weight:700;
        color:#CC0000;margin-bottom:3mm;text-align:center}
    .t3{font-family:Arial,sans-serif;font-size:9pt;color:#3A3830;
        margin-bottom:1.5mm;text-align:center}
    .tl{font-family:Arial,sans-serif;font-size:11pt;font-weight:700;
        color:#CC0000;margin-bottom:2.5mm;text-align:center}
    .t4{font-family:Arial,sans-serif;font-size:13pt;font-weight:700;
        color:#1A1916;margin-bottom:2.5mm;text-align:center}
    .ad{font-family:Arial,sans-serif;font-size:8.5pt;color:#1A1916;
        margin-bottom:2.5mm;text-align:center;line-height:1.4}
    .cr{font-family:Arial,sans-serif;font-size:9.5pt;color:#1A1916;
        text-align:center;line-height:1.5;max-width:200mm}
    .dt{position:absolute;bottom:13mm;left:10mm;
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
      <div class="t1">FRANCHISE CERTIFICATE</div>
      <div class="t2">This is to Certify that</div>
      <div class="nm">${franchisee.business_name}</div>
      ${isSMF ? `<div class="st">${franchisee.state || ''}</div>` : ''}
      <div class="t3">Is a Registered</div>
      <div class="tl">${label}</div>
      <div class="t4">New Learning Horizons at</div>
      <div class="ad">${address}</div>
      ${courses ? `<div class="cr">for ${courses}</div>` : ''}
    </div>
    <div class="dt">${till}</div>
  </div>
</body>
</html>`

  const win = window.open('', '_blank', 'width=1120,height=820')
  if (win) { win.document.write(html); win.document.close() }
}

// ── modal component ────────────────────────────────────────────────────────────

export default function FranchiseeCertModal({ franchisee, courseNames, onClose }) {
  const [emailing, setEmailing] = useState(false)
  const [emailed,  setEmailed]  = useState(!!franchisee.cert_emailed_at)

  const label   = tierLabel(franchisee)
  const till    = validTill(franchisee.created_at)
  const address = buildAddress(franchisee)
  const courses = courseNames.join(', ')

  async function handleEmail() {
    if (!franchisee.email) {
      showToast('No email address on file for this franchisee', 'warn')
      return
    }
    setEmailing(true)
    try {
      const res = await sendFranchiseeCertEmail(franchisee, courseNames)
      if (!res.success) throw new Error(res.error || 'Send failed')
      await sb.from('franchisees')
        .update({ cert_emailed_at: new Date().toISOString() })
        .eq('id', franchisee.id)
      setEmailed(true)
      showToast('Certificate emailed to ' + franchisee.email)
    } catch (err) {
      showToast('Email failed: ' + err.message, 'err')
    }
    setEmailing(false)
  }

  return (
    <div className="modal-bg" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 580 }}>
        <div className="ch">
          <span>📜 Franchise Certificate</span>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>

        {/* ── Preview card ── */}
        <div style={{ padding: '0 20px' }}>
          <div style={{
            border: '2px solid var(--border)', borderRadius: 10,
            background: 'linear-gradient(135deg,#fffef8 0%,#f8f6ff 100%)',
            padding: '20px 24px', textAlign: 'center',
            fontFamily: 'Arial,sans-serif', marginBottom: 12,
          }}>
            <div style={{ fontSize: 13, fontWeight: 900, letterSpacing: 2, color: '#1A1916', marginBottom: 4 }}>
              FRANCHISE CERTIFICATE
            </div>
            <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 10 }}>This is to Certify that</div>

            <div style={{
              fontFamily: 'Georgia,serif', fontSize: 24, fontWeight: 700,
              color: '#CC0000', marginBottom: 2, lineHeight: 1.15,
            }}>
              {franchisee.business_name}
            </div>
            {franchisee.tier === 'SMF' && (
              <div style={{ fontFamily: 'Georgia,serif', fontSize: 15, color: '#CC0000', marginBottom: 4 }}>
                {franchisee.state}
              </div>
            )}

            <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 8, marginBottom: 2 }}>Is a Registered</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#CC0000', marginBottom: 6 }}>{label}</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#1A1916', marginBottom: 5 }}>New Learning Horizons at</div>
            <div style={{ fontSize: 10, color: 'var(--text2)', marginBottom: courses ? 5 : 0 }}>{address}</div>
            {courses && (
              <div style={{ fontSize: 10, color: 'var(--text)', lineHeight: 1.5 }}>for {courses}</div>
            )}

            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end',
              marginTop: 14, paddingTop: 10, borderTop: '1px dashed var(--border)',
            }}>
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontSize: 9, color: 'var(--text3)' }}>Valid Till</div>
                <div style={{ fontSize: 11, fontWeight: 700 }}>{till}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 9, fontStyle: 'italic', color: 'var(--text3)' }}>Dhiral Panchmatia</div>
                <div style={{ fontSize: 9, color: 'var(--text3)' }}>Director, NLH</div>
              </div>
            </div>
          </div>

          {emailed
            ? <p className="hint" style={{ color: 'var(--green)' }}>
                ✓ Certificate emailed to <strong>{franchisee.email}</strong>
                {franchisee.cert_emailed_at
                  ? ` on ${new Date(franchisee.cert_emailed_at).toLocaleDateString('en-IN')}`
                  : ''}
              </p>
            : franchisee.email
              ? <p className="hint">Ready to send to: <strong>{franchisee.email}</strong></p>
              : <p className="hint" style={{ color: 'var(--red)' }}>
                  ⚠ No email address on file — cannot send certificate.
                </p>
          }
        </div>

        <div className="modal-actions">
          <button className="btn" onClick={onClose}>Close</button>
          <button className="btn-s" onClick={() => printFranchiseeCert(franchisee, courseNames)}>
            🖨️ Print / PDF
          </button>
          <button className="btn-p" onClick={handleEmail} disabled={emailing || !franchisee.email}>
            {emailing ? 'Sending…' : emailed ? '📧 Re-send Certificate' : '📧 Email Certificate'}
          </button>
        </div>
      </div>
    </div>
  )
}
