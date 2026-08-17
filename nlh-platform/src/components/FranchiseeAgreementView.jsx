import { useState, useEffect } from 'react'
import { fmtAmt, fmtDate } from '../utils'
import { loadLatestAgreement } from '../utils/franchiseeAgreement'
import { printFranchiseeAgreement } from './studentDocs'

// A franchisee's own Unit Franchise Agreement — view/print it, and see its
// signing status. The actual signature is done through BoldSign: once NLH
// sends the agreement, BoldSign emails the franchisee a secure signing
// link directly, so there's no separate sign-in-app step here — this card
// just reflects where things stand (draft / sent / signed).
// Shown on MyAccountPage; the admin sees the same document under
// Franchisees → Agreement, plus the Generate/Send controls.
export default function FranchiseeAgreementView({ franchisee }) {
  const [loading, setLoading] = useState(true)
  const [agreement, setAgreement] = useState(null)

  useEffect(function () {
    if (!franchisee?.id) { setLoading(false); return }
    loadLatestAgreement(franchisee.id).then(function (row) {
      setAgreement(row)
      setLoading(false)
    })
  }, [franchisee?.id])

  function view() {
    if (!agreement) return
    printFranchiseeAgreement(franchisee, agreement)
  }

  if (loading) return null
  if (!agreement) {
    return (
      <div className="card" style={{ padding: 20, marginBottom: 18 }}>
        <div style={{ font: '700 13px var(--font)', marginBottom: 4 }}>📄 Unit Franchise Agreement</div>
        <p className="hint" style={{ margin: 0 }}>Your agreement hasn't been generated yet — it will appear here once NLH prepares it.</p>
      </div>
    )
  }

  const signed = agreement.status === 'signed'
  const sent = agreement.status === 'sent'

  return (
    <div className="card" style={{ padding: 20, marginBottom: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ font: '700 13px var(--font)' }}>📄 Unit Franchise Agreement — {agreement.agreement_no}</div>
        <span className={`badge ${signed ? 'ba' : 'bp'}`}>{signed ? '✓ Signed' : sent ? 'Awaiting your signature' : 'Not sent yet'}</span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text3)', lineHeight: 1.7, marginBottom: 12 }}>
        Fee: <strong style={{ color: 'var(--text)' }}>₹{fmtAmt(agreement.fee)}</strong> &middot;
        {' '}Term: <strong style={{ color: 'var(--text)' }}>{fmtDate(agreement.term_start)} – {fmtDate(agreement.term_end)}</strong>
      </div>

      <button className="btn-s" onClick={view}>🖨️ View / Print Agreement</button>

      {signed && (
        <p className="hint" style={{ marginTop: 10, color: 'var(--green)' }}>
          ✓ Signed by <strong>{agreement.signed_name}</strong> on {fmtDate(agreement.signed_at)} via BoldSign. Verification code: {agreement.verification_code}
        </p>
      )}
      {sent && (
        <p className="hint" style={{ marginTop: 10 }}>
          Check your email at <strong>{franchisee.email}</strong> for a secure link from BoldSign to review and sign this agreement.
        </p>
      )}
    </div>
  )
}
