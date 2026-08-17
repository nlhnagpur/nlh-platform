import { useState, useEffect } from 'react'
import { fmtAmt, fmtDate, showToast } from '../utils'
import { loadLatestAgreement, signAgreement } from '../utils/franchiseeAgreement'
import { printFranchiseeAgreement } from './studentDocs'

// A franchisee's own Unit Franchise Agreement — view/print it, and sign it
// with a typed legal name + explicit consent checkbox (clickwrap e-sign).
// Shown on MyAccountPage; the admin sees the same document (read-only,
// plus Generate/Regenerate) under Franchisees → Agreement.
export default function FranchiseeAgreementView({ franchisee }) {
  const [loading, setLoading] = useState(true)
  const [agreement, setAgreement] = useState(null)
  const [typedName, setTypedName] = useState('')
  const [agree, setAgree] = useState(false)
  const [signing, setSigning] = useState(false)

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

  async function sign() {
    const name = typedName.trim()
    if (!name) { showToast('Type your full legal name to sign', 'warn'); return }
    if (!agree) { showToast('Please tick the agreement checkbox', 'warn'); return }
    setSigning(true)
    try {
      const updated = await signAgreement(agreement, name)
      setAgreement(updated)
      showToast('Agreement signed ✓')
    } catch (err) {
      showToast('Could not sign: ' + err.message, 'err')
    }
    setSigning(false)
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

  return (
    <div className="card" style={{ padding: 20, marginBottom: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ font: '700 13px var(--font)' }}>📄 Unit Franchise Agreement — {agreement.agreement_no}</div>
        <span className={`badge ${signed ? 'ba' : 'bp'}`}>{signed ? '✓ Signed' : 'Awaiting your signature'}</span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text3)', lineHeight: 1.7, marginBottom: 12 }}>
        Fee: <strong style={{ color: 'var(--text)' }}>₹{fmtAmt(agreement.fee)}</strong> &middot;
        {' '}Term: <strong style={{ color: 'var(--text)' }}>{fmtDate(agreement.term_start)} – {fmtDate(agreement.term_end)}</strong>
      </div>

      <button className="btn-s" onClick={view} style={{ marginBottom: signed ? 0 : 14 }}>🖨️ View / Print Agreement</button>

      {signed && (
        <p className="hint" style={{ marginTop: 10, color: 'var(--green)' }}>
          ✓ Signed by <strong>{agreement.signed_name}</strong> on {fmtDate(agreement.signed_at)}. Verification code: {agreement.verification_code}
        </p>
      )}

      {!signed && (
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14, marginTop: 4 }}>
          <p className="hint" style={{ marginTop: 0, marginBottom: 8 }}>Read the agreement above, then type your full legal name below to sign it.</p>
          <input
            value={typedName}
            onChange={function (e) { setTypedName(e.target.value) }}
            placeholder="Type your full legal name"
            style={{ marginBottom: 8, width: '100%', maxWidth: 360 }}
          />
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12, color: 'var(--text3)', marginBottom: 10, cursor: 'pointer' }}>
            <input type="checkbox" checked={agree} onChange={function (e) { setAgree(e.target.checked) }} style={{ marginTop: 2 }} />
            I have read and agree to the terms of this Agreement, and this typed name is my signature.
          </label>
          <button className="btn-p" onClick={sign} disabled={signing || !typedName.trim() || !agree}>
            {signing ? 'Signing…' : '✍️ Sign Agreement'}
          </button>
        </div>
      )}
    </div>
  )
}
