import React, { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { sb } from '../supabase'
import { showToast } from '../utils'

export default function LoginPage() {
  const { setScreen, initApp } = useAuth()
  const [email, setEmail] = useState('')
  const [pass, setPass] = useState('')
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)

  async function doLogin(e) {
    e.preventDefault()
    setErr('')
    if (!email || !pass) { setErr('Please enter email and password.'); return }
    setLoading(true)
    const result = await sb.auth.signInWithPassword({ email, password: pass })
    setLoading(false)
    if (result.error) {
      const msg = result.error.message
      if (msg.toLowerCase().includes('invalid') || msg.toLowerCase().includes('credentials') || msg.toLowerCase().includes('not found')) {
        setErr('No account found for this email. Please click "Request platform access" below to register. NLH Admin will approve and send your login details.')
      } else if (msg.toLowerCase().includes('email not confirmed')) {
        setErr('Your email is not confirmed. Please contact NLH Admin on 9373111311.')
      } else {
        setErr(msg)
      }
      return
    }
    if (result.data.user) await initApp(result.data.user)
  }

  async function doForgotPassword() {
    let em = email
    if (!em) { em = prompt('Enter your registered email address:'); if (!em) return }
    if (!em.includes('@')) { showToast('Please enter a valid email', 'warn'); return }
    showToast('Sending reset link to ' + em + '...')
    const { error } = await sb.auth.resetPasswordForEmail(em, {
      redirectTo: 'https://nlh-platform.vercel.app/login'
    })
    if (error) { showToast('Could not send reset email: ' + error.message, 'err'); return }
    showToast('Password reset link sent to ' + em + '. Check your inbox!')
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
        <div className="login-title">Welcome back</div>
        <div className="login-sub">Sign in to your NLH account</div>
        <form onSubmit={doLogin}>
          <div className="form-row">
            <label>Email address</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" />
          </div>
          <div className="form-row">
            <label>Password</label>
            <input type="password" value={pass} onChange={e => setPass(e.target.value)} placeholder="••••••••" autoComplete="current-password" />
          </div>
          {err && <div className="login-err" style={{display:'block'}}>{err}</div>}
          <button type="submit" className="btn-login" disabled={loading}>
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
        <div className="login-toggle" style={{marginTop:12}}>
          <a onClick={doForgotPassword}>Forgot password?</a>
        </div>
        <div className="login-toggle">
          <a onClick={() => setScreen('landing')}>← Back to home</a>
          &nbsp;·&nbsp;
          <a onClick={() => setScreen('request')}>Request platform access</a>
        </div>
        <div className="login-info">
          Admin: dhiral@nlhnagpur.info · 9373111311
        </div>
      </div>
    </div>
  )
}
