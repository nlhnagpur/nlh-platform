import { useState, useEffect } from 'react'
import { sb } from '../supabase'
import { useAuth } from '../context/AuthContext'
import FranchiseeLedgerView from '../components/FranchiseeLedgerView'

// Self-service "My Account" — a franchisee's own combined statement of
// account (franchise fee + every order), same data and same component as
// the admin sees under Franchisees → Accounts, scoped by RLS to their own
// franchisee_id so there's nothing extra to authorize here.
export default function MyAccountPage() {
  const { currentFranchiseeId } = useAuth()
  const [franchisee, setFranchisee] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(function () {
    if (!currentFranchiseeId) { setLoading(false); return }
    sb.from('franchisees')
      .select('id, business_name, owner_name, tier')
      .eq('id', currentFranchiseeId)
      .single()
      .then(function ({ data }) { setFranchisee(data); setLoading(false) })
  }, [currentFranchiseeId])

  if (loading) return <div className="loading"><span className="spinner" />Loading your account…</div>
  if (!currentFranchiseeId) return <div className="empty">No franchisee record is linked to this login.</div>

  return (
    <div className="pg">
      <div className="topbar">
        <h2>My Account</h2>
      </div>
      <p className="hint" style={{ marginTop: -8, marginBottom: 18 }}>
        Statement of account for {franchisee?.business_name || franchisee?.owner_name || 'your centre'} — franchise fee and every order, debits, credits, and running balance.
      </p>
      <FranchiseeLedgerView franchiseeId={currentFranchiseeId} franchiseeName={franchisee?.business_name || franchisee?.owner_name} />
    </div>
  )
}
