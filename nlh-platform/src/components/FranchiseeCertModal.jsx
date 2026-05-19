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
  const label   = tierLabel(franchisee)
  const till    = validTill(franchisee)
  const address = buildAddress(franchisee)
  const courses = courseNames.join(', ')
  const isSMF   = franchisee.tier === 'SMF'
  const origin  = window.location.origin
  const bgUrl   = origin + '/Franchisee%20Certificate%20Background.png'
  const logoUrl = origin + '/NLH%20Logo.png'
  const sigUrl  = origin + '/DRP%20Signature.png'

  const nameSz  = isSMF ? '24pt' : '30pt'

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
    .c-title{font-size:20pt;font-weight:900;letter-spacing:2px;color:#1A1916;margin-bottom:1.5mm}
    .c-sub{font-size:9pt;font-style:italic;color:#3A3830;margin-bottom:5mm}
    .nm{
      font-family:'Dancing Script',cursive;font-size:${nameSz};font-weight:700;
      color:#CC0000;line-height:1.1;margin-bottom:2mm;
    }
    .st{
      font-family:'Dancing Script',cursive;font-size:17pt;font-weight:700;
      color:#CC0000;margin-bottom:2mm;
    }
    .is-reg{font-size:8.5pt;color:#555;margin-bottom:1mm}
    .tier{font-size:11pt;font-weight:700;color:#CC0000;margin-bottom:2mm}
    .nlh-at{font-size:10pt;font-weight:700;color:#1A1916;margin-bottom:1mm}
    .addr{font-size:8.5pt;color:#3A3830;line-height:1.4;margin-bottom:1.5mm}
    .courses{font-size:8.5pt;color:#1A1916;line-height:1.4;max-width:180mm}

    /* Footer: sig left, valid-till right */
    .ft{
      display:flex;justify-content:space-between;align-items:flex-end;
      border-top:1.5px solid rgba(26,58,106,0.2);
      padding-top:2.5mm;margin-top:auto;
    }
    .sig-blk{display:flex;flex-direction:column;align-items:flex-start}
    .sig-img{height:13mm;object-fit:contain;margin-bottom:0.5mm}
    .sig-nm{font-family:'Dancing Script',cursive;font-size:12pt;font-weight:700;color:#1A1916}
    .sig-tl{font-size:7.5pt;color:#3A3830}
    .vt-blk{text-align:right}
    .vt-lbl{font-size:7pt;color:#555;letter-spacing:1px;text-transform:uppercase}
    .vt-val{font-size:11pt;font-weight:700;color:#1A1916}

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

    <!-- ── Main content ── -->
    <div class="main">
      <img class="nlh-logo" src="${logoUrl}" alt="NLH" onerror="this.style.display='none'">

      <div class="c-title">FRANCHISE CERTIFICATE</div>
      <div class="c-sub">This is to Certify that</div>

      <div class="nm">${franchisee.business_name}</div>
      ${isSMF ? `<div class="st">${franchisee.state || ''}</div>` : ''}

      <div class="is-reg">Is a Registered</div>
      <div class="tier">${label}</div>
      <div class="nlh-at">New Learning Horizons at</div>
      <div class="addr">${address}</div>
      ${courses ? `<div class="courses">for ${courses}</div>` : ''}

      <div class="ft">
        <div class="sig-blk">
          <img class="sig-img" src="${sigUrl}" alt="Signature" onerror="this.style.display='none'">
          <div class="sig-nm">Dhiral Panchmatia</div>
          <div class="sig-tl">Founder, New Learning Horizons</div>
        </div>
        <div class="vt-blk">
          <div class="vt-val">${till}</div>
          <div class="vt-lbl">Valid Till</div>
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
            borderRadius: 10, overflow: 'hidden',
            border: '1px solid #D6D0C4',
            backgroundImage: 'url(/Franchisee%20Certificate%20Background.png)',
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
              <div style={{ fontSize: 13, fontWeight: 900, letterSpacing: 2, color: '#1A1916', marginBottom: 2 }}>
                FRANCHISE CERTIFICATE
              </div>
              <div style={{ fontSize: 9, fontStyle: 'italic', color: '#555', marginBottom: 8 }}>This is to Certify that</div>

              <div style={{ fontFamily: 'Georgia,serif', fontSize: 20, fontWeight: 700, color: '#CC0000', lineHeight: 1.1, marginBottom: 2 }}>
                {franchisee.business_name}
              </div>
              {franchisee.tier === 'SMF' && (
                <div style={{ fontFamily: 'Georgia,serif', fontSize: 13, color: '#CC0000', marginBottom: 3 }}>
                  {franchisee.state}
                </div>
              )}

              <div style={{ fontSize: 9, color: '#555', marginTop: 6, marginBottom: 1 }}>Is a Registered</div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#CC0000', marginBottom: 4 }}>{label}</div>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#1A1916', marginBottom: 2 }}>New Learning Horizons at</div>
              <div style={{ fontSize: 9, color: '#3A3830', marginBottom: courses ? 3 : 0, lineHeight: 1.4 }}>{address}</div>
              {courses && (
                <div style={{ fontSize: 9, color: '#1A1916', lineHeight: 1.4 }}>for {courses}</div>
              )}

              {/* Footer */}
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
                  <div style={{ fontSize: 10, fontStyle: 'italic', color: '#1A1916', fontWeight: 600 }}>Dhiral Panchmatia</div>
                  <div style={{ fontSize: 8, color: '#3A3830' }}>Founder, NLH</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#1A1916' }}>{till}</div>
                  <div style={{ fontSize: 8, color: '#555', letterSpacing: 1 }}>VALID TILL</div>
                </div>
              </div>
            </div>

            {/* Right sidebar */}
            <div style={{
              width: 80, display: 'flex', flexDirection: 'column',
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
