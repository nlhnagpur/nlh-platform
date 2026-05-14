import React, { useState } from 'react'
import { sb } from '../supabase'
import { showToast } from '../utils'
import { useAuth } from '../context/AuthContext'

export default function ResetPasswordPage() {
  const { setScreen } = useAuth()
  const [pass1, setPass1] = useState('')
  const [pass2, setPass2] = useState('')
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')

  async function doReset(e) {
    e.preventDefault()
    setErr(''); setOk('')
    if (!pass1 || pass1.length < 6) { setErr('Password must be at least 6 characters.'); return }
    if (pass1 !== pass2) { setErr('Passwords do not match.'); return }
    const { error } = await sb.auth.updateUser({ password: pass1 })
    if (error) { setErr('Error: ' + error.message); return }
    setOk('Password updated successfully! Redirecting to login...')
    setPass1(''); setPass2('')
    setTimeout(async () => {
      await sb.auth.signOut()
      setScreen('login')
      showToast('Password updated. Please log in with your new password.')
    }, 2000)
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-logo">
          <div className="login-icon">N</div>
          <div>
            <div className="login-brand">New Learning Horizons</div>
            <div className="login-brand-sub">ISO 9001:2015 Certified · Franchise Platform</div>
          </div>
        </div>
        <div className="login-title">Set new password</div>
        <div className="login-sub">Enter and confirm your new password</div>
        <form onSubmit={doReset}>
          <div className="form-row">
            <label>New password</label>
            <input type="password" value={pass1} onChange={e => setPass1(e.target.value)} placeholder="At least 6 characters" />
          </div>
          <div className="form-row">
            <label>Confirm password</label>
            <input type="password" value={pass2} onChange={e => setPass2(e.target.value)} placeholder="Repeat password" />
          </div>
          {err && <div className="login-err" style={{display:'block'}}>{err}</div>}
          {ok && (
            <div style={{background:'var(--green-bg)',border:'1px solid rgba(29,122,79,.2)',color:'var(--green)',borderRadius:'var(--r2)',padding:'9px 12px',fontSize:12,marginTop:12}}>
              {ok}
            </div>
          )}
          <button type="submit" className="btn-login">Update password</button>
        </form>
      </div>
    </div>
  )
}
