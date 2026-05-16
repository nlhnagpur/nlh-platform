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

function validTill(fr) {
  // Use stored valid_till if admin has set it, otherwise compute 3 years from onboarding
  const d = fr.valid_till
    ? new Date(fr.valid_till)
    : (() => { const x = new Date(fr.created_at || Date.now()); x.setFullYear(x.getFullYear() + 3); return x })()
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
  const till     = validTill(franchisee)
  const address  = buildAddress(franchisee)
  const courses  = courseNames.join(', ')
  const isSMF    = franchisee.tier === 'SMF'
  const origin   = window.location.origin
  const bgUrl    = origin + '/Franchisee%20Certificate%20Blank.png'
  const logoUrl  = origin + '/NLH%20Logo.png'
  const sigUrl   = origin + '/DRP%20Signature.png'
  const mascotUrl = origin + '/NLH%20Mascot.png'

  // mask height is taller for SMF because state name adds an extra line
  const maskH    = isSMF ? '145mm' : '138mm'
  const nameSz   = isSMF ? '26pt'  : '30pt'
  const nameGap  = isSMF ? '1mm'   : '2mm'

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
    /* White mask covers the pre-printed text area */
    .mask{
      position:absolute;
      top:8mm;left:3mm;width:211mm;height:${maskH};
      background:#fff;
      display:flex;flex-direction:column;
      align-items:center;
      padding:3mm 8mm 2mm;
    }
    /* ── Header ── */
    .lg{height:28px;object-fit:contain;margin-bottom:1.5mm}
    .t1{font-family:Arial,sans-serif;font-size:13pt;font-weight:900;letter-spacing:1.5px;
        color:#1A1916;margin-bottom:2mm;text-align:center}
    .t2{font-family:Arial,sans-serif;font-size:8.5pt;color:#3A3830;
        margin-bottom:2.5mm;text-align:center}
    /* ── Main content ── */
    .body{flex:1;display:flex;flex-direction:column;justify-content:center;align-items:center;width:100%}
    .nm{font-family:'Dancing Script',cursive;font-size:${nameSz};font-weight:700;
        color:#CC0000;margin-bottom:${nameGap};text-align:center;line-height:1.1}
    .st{font-family:'Dancing Script',cursive;font-size:17pt;font-weight:700;
        color:#CC0000;margin-bottom:2mm;text-align:center}
    .t3{font-family:Arial,sans-serif;font-size:8.5pt;color:#3A3830;
        margin-bottom:1mm;text-align:center}
    .tl{font-family:Arial,sans-serif;font-size:10.5pt;font-weight:700;
        color:#CC0000;margin-bottom:2mm;text-align:center}
    .t4{font-family:Arial,sans-serif;font-size:12pt;font-weight:700;
        color:#1A1916;margin-bottom:2mm;text-align:center}
    .ad{font-family:Arial,sans-serif;font-size:8pt;color:#1A1916;
        margin-bottom:2mm;text-align:center;line-height:1.4}
    .cr{font-family:Arial,sans-serif;font-size:8.5pt;color:#1A1916;
        text-align:center;line-height:1.4;max-width:200mm}
    /* ── Footer: sig | social+date | mascot ── */
    .ft{
      width:100%;display:flex;justify-content:space-between;align-items:flex-end;
      border-top:1px solid #ddd;margin-top:2mm;padding-top:2mm;
    }
    .sig-blk{display:flex;flex-direction:column;align-items:flex-start;min-width:55mm}
    .sig-img{height:13mm;object-fit:contain;margin-bottom:0.5mm}
    .sig-nm{font-family:'Dancing Script',cursive;font-size:11pt;font-weight:700;color:#1A1916}
    .sig-tl{font-family:Arial,sans-serif;font-size:7pt;color:#3A3830}
    .mid-blk{display:flex;flex-direction:column;align-items:center;gap:1.5mm}
    .sm-row{display:flex;gap:4mm;font-family:Arial,sans-serif;font-size:6.5pt;color:#534AB7}
    .vt-blk{display:flex;flex-direction:column;align-items:center}
    .vt-lbl{font-family:Arial,sans-serif;font-size:6.5pt;color:#3A3830}
    .vt-val{font-family:Arial,sans-serif;font-size:9pt;font-weight:700;color:#1A1916}
    .mascot-blk{display:flex;align-items:flex-end;min-width:30mm;justify-content:flex-end}
    .mascot-img{height:20mm;object-fit:contain}
    /* print button */
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

      <!-- Header -->
      <img class="lg" src="${logoUrl}" alt="NLH" onerror="this.style.display='none'">
      <div class="t1">FRANCHISE CERTIFICATE</div>
      <div class="t2">This is to Certify that</div>

      <!-- Main content -->
      <div class="body">
        <div class="nm">${franchisee.business_name}</div>
        ${isSMF ? `<div class="st">${franchisee.state || ''}</div>` : ''}
        <div class="t3">Is a Registered</div>
        <div class="tl">${label}</div>
        <div class="t4">New Learning Horizons at</div>
        <div class="ad">${address}</div>
        ${courses ? `<div class="cr">for ${courses}</div>` : ''}
      </div>

      <!-- Footer -->
      <div class="ft">
        <div class="sig-blk">
          <img class="sig-img" src="${sigUrl}" alt="Signature" onerror="this.style.display='none'">
          <div class="sig-nm">Dhiral Panchmatia</div>
          <div class="sig-tl">Founder, New Learning Horizons</div>
        </div>
        <div class="mid-blk">
          <div class="sm-row">
            <span>📸 /newlearninghorizon</span>
            <span>📘 /nlhnag</span>
            <span>🌐 nlhnagpur.info</span>
          </div>
          <div class="vt-blk">
            <div class="vt-val">${till}</div>
            <div class="vt-lbl">Valid Till</div>
          </div>
        </div>
        <div class="mascot-blk">
          <img class="mascot-img" src="${mascotUrl}" alt="" onerror="this.style.display='none'">
        </div>
      </div>

    </div>
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
  const till    = validTill(franchisee)
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
            padding: '16px 20px', textAlign: 'center',
            fontFamily: 'Arial,sans-serif', marginBottom: 12,
          }}>
            {/* Logo + social row */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <img
                src="/NLH Logo.png" alt="NLH"
                style={{ height: 40, objectFit: 'contain' }}
                onError={e => { e.target.style.display = 'none' }}
              />
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                <span style={{ fontSize: 9, color: '#534AB7' }}>📸 /newlearninghorizon</span>
                <span style={{ fontSize: 9, color: '#534AB7' }}>📘 /nlhnag</span>
                <span style={{ fontSize: 9, color: '#534AB7' }}>🌐 nlhnagpur.info</span>
              </div>
            </div>

            <div style={{ fontSize: 13, fontWeight: 900, letterSpacing: 2, color: '#1A1916', marginBottom: 4 }}>
              FRANCHISE CERTIFICATE
            </div>
            <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 10 }}>This is to Certify that</div>

            <div style={{
              fontFamily: 'Georgia,serif', fontSize: 22, fontWeight: 700,
              color: '#CC0000', marginBottom: 2, lineHeight: 1.15,
            }}>
              {franchisee.business_name}
            </div>
            {franchisee.tier === 'SMF' && (
              <div style={{ fontFamily: 'Georgia,serif', fontSize: 14, color: '#CC0000', marginBottom: 4 }}>
                {franchisee.state}
              </div>
            )}

            <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 8, marginBottom: 2 }}>Is a Registered</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#CC0000', marginBottom: 5 }}>{label}</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#1A1916', marginBottom: 4 }}>New Learning Horizons at</div>
            <div style={{ fontSize: 10, color: 'var(--text2)', marginBottom: courses ? 4 : 0 }}>{address}</div>
            {courses && (
              <div style={{ fontSize: 10, color: 'var(--text)', lineHeight: 1.5, marginBottom: 2 }}>for {courses}</div>
            )}

            {/* Footer: sig | valid till | mascot */}
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end',
              marginTop: 12, paddingTop: 10, borderTop: '1px dashed var(--border)',
            }}>
              <div style={{ textAlign: 'left' }}>
                <img
                  src="/DRP Signature.png" alt="Signature"
                  style={{ height: 32, objectFit: 'contain', display: 'block', marginBottom: 2 }}
                  onError={e => { e.target.style.display = 'none' }}
                />
                <div style={{ fontSize: 11, fontStyle: 'italic', color: '#1A1916', fontWeight: 600 }}>Dhiral Panchmatia</div>
                <div style={{ fontSize: 9, color: 'var(--text3)' }}>Founder, NLH</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 9, color: 'var(--text3)' }}>Valid Till</div>
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
