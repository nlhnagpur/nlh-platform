import React, { useState } from 'react'
import { sb } from '../supabase'
import { showToast } from '../utils'
import { sendFranchiseeCertEmail } from '../services/email'
import ModalHeader from './ModalHeader'

// ── helpers ────────────────────────────────────────────────────────────────────

function tierLabel(fr) {
  if (fr.tier === 'SMF') return 'State Master Franchisee of'
  if (fr.tier === 'CF')  return `${fr.city || ''} City Master Franchisee of`
  return 'Unit Franchisee of'
}

// A school's authorization runs to the end of the current academic year
// (30 April), not the 3-year franchise term — re-issued fresh each year the
// school continues with NLH, rather than renewed for another multi-year span.
function schoolAcademicYearEnd() {
  const now = new Date()
  const aprilThisYear = new Date(now.getFullYear(), 3, 30)   // month 3 = April
  return now <= aprilThisYear ? aprilThisYear : new Date(now.getFullYear() + 1, 3, 30)
}

function validTill(fr) {
  // Use stored valid_till if admin has set it, otherwise compute the default
  // for this franchisee type — 3 years from onboarding, or (for a school)
  // the end of the current academic year.
  const d = fr.valid_till
    ? new Date(fr.valid_till)
    : fr.tier === 'SCHOOL'
      ? schoolAcademicYearEnd()
      : (() => { const x = new Date(fr.created_at || Date.now()); x.setFullYear(x.getFullYear() + 3); return x })()
  return [
    String(d.getDate()).padStart(2, '0'),
    String(d.getMonth() + 1).padStart(2, '0'),
    d.getFullYear(),
  ].join('.')
}

// "the X Program" / "the X & Y Programs" — matches franchise-cert.html's
// buildAuthorisationText so the modal preview and the printable page agree.
function authorisationText(courseNames) {
  if (!courseNames.length) return 'and is authorized to conduct programs at its school premises.'
  const named = courseNames.length === 1 ? courseNames[0] : courseNames.slice(0, -1).join(', ') + ' & ' + courseNames[courseNames.length - 1]
  const word  = courseNames.length === 1 ? 'Program' : 'Programs'
  return `and is authorized to conduct the ${named} ${word} at its school premises.`
}

function buildAddress(fr) {
  return [fr.address, fr.area, fr.city, fr.state,
    fr.country && fr.country !== 'India' ? fr.country : null]
    .filter(Boolean).join(', ')
}

// ── print window ───────────────────────────────────────────────────────────────

export function printFranchiseeCert(franchisee, courseNames) {
  const params = new URLSearchParams({
    type:    'franchise',
    name:    franchisee.business_name,
    tier:    franchisee.tier || 'UF',
    city:    franchisee.city || '',
    state:   franchisee.state || '',
    address: buildAddress(franchisee),
    courses: courseNames.join(', '),
    till:    validTill(franchisee),
  })
  window.open(`/certificate/franchise-cert.html?${params}`, '_blank', 'width=1120,height=820')
}

// ── modal component ────────────────────────────────────────────────────────────

export default function FranchiseeCertModal({ franchisee, courseNames, onClose }) {
  const [emailing, setEmailing] = useState(false)
  const [emailed,  setEmailed]  = useState(!!franchisee.cert_emailed_at)

  const isSchool = franchisee.tier === 'SCHOOL'
  const label   = tierLabel(franchisee)
  const till    = validTill(franchisee)
  const address = buildAddress(franchisee)
  const courses = courseNames.join(', ')
  const authText = authorisationText(courseNames)
  const location = [franchisee.city, franchisee.state].filter(Boolean).join(', ')

  async function handleEmail() {
    if (!franchisee.email) {
      showToast('No email address on file for this franchisee', 'warn')
      return
    }
    setEmailing(true)
    try {
      const res = await sendFranchiseeCertEmail(franchisee)
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
        <ModalHeader flush title={isSchool ? 'Certificate of Authorisation' : 'Franchise Certificate'} subtitle="New Learning Horizons" onClose={onClose} />

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
                {isSchool ? 'CERTIFICATE OF AUTHORISATION' : 'FRANCHISE CERTIFICATE'}
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
              {isSchool && location && (
                <div style={{ fontSize: 13, fontWeight: 700, color: '#1A1916', marginBottom: 3 }}>{location}</div>
              )}

              {isSchool ? (
                <>
                  <div style={{ fontSize: 9, color: '#555', marginTop: 6, marginBottom: 1 }}>is an Authorized</div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#CC0000', marginBottom: 4 }}>Program Partner of</div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#1A1916', marginBottom: 4 }}>New Learning Horizons</div>
                  <div style={{ fontSize: 9, color: '#1A1916', lineHeight: 1.4 }}>{authText}</div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 9, color: '#555', marginTop: 6, marginBottom: 1 }}>Is a Registered</div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#CC0000', marginBottom: 4 }}>{label}</div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#1A1916', marginBottom: 2 }}>New Learning Horizons at</div>
                  <div style={{ fontSize: 9, color: '#3A3830', marginBottom: courses ? 3 : 0, lineHeight: 1.4 }}>{address}</div>
                  {courses && (
                    <div style={{ fontSize: 9, color: '#1A1916', lineHeight: 1.4 }}>for {courses}</div>
                  )}
                </>
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
