import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { sb } from '../supabase'
import { isAdminRole } from '../constants/roles'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null)
  const [currentRole, setCurrentRole] = useState(null)
  const [currentFranchiseeId, setCurrentFranchiseeId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [screen, setScreen] = useState('loading') // 'loading'|'landing'|'login'|'reset'|'onboarding'|'app'

  const initApp = useCallback(async (user) => {
    setCurrentUser(user)
    let role = 'student'
    let franchiseeId = null
    console.log('[initApp] start — email:', user.email)

    try {
      const { data, error: userErr } = await sb.from('users').select('*').ilike('email', user.email).single()
      console.log('[initApp] users query →', { data, error: userErr })

      if (data) {
        role = data.role || 'uf'
        franchiseeId = data.franchisee_id

        if (!franchiseeId && ['smf', 'cf', 'uf'].includes(role)) {
          const { data: fr } = await sb.from('franchisees').select('id').ilike('email', user.email).single()
          if (fr) {
            franchiseeId = fr.id
            await sb.from('users').update({ franchisee_id: fr.id }).ilike('email', user.email)
          }
        }
      } else {
        const { data: frMatch } = await sb.from('franchisees').select('id, tier').ilike('email', user.email).single()
        if (frMatch) {
          role = { SMF: 'smf', CF: 'cf', UF: 'uf' }[frMatch.tier] || 'uf'
          franchiseeId = frMatch.id
          await sb.from('users').upsert({
            email: user.email,
            full_name: user.user_metadata?.full_name || user.email.split('@')[0],
            role,
            franchisee_id: frMatch.id,
          }, { onConflict: 'email' })
        } else {
          role = 'student'
          await sb.from('users').upsert({
            email: user.email,
            full_name: user.user_metadata?.full_name || user.email.split('@')[0],
            role: 'student',
          }, { onConflict: 'email' })
        }
      }
    } catch (err) {
      console.error('User lookup error:', err)
      role = 'student'
    }

    console.log('[initApp] resolved →', { role, franchiseeId })
    setCurrentRole(role)
    setCurrentFranchiseeId(franchiseeId)

    // Check if onboarding needed
    let needsOnboarding = false
    if (!isAdminRole(role)) {
      if (role === 'student') {
        needsOnboarding = true // simplified; page will check student_id
      } else if (!franchiseeId) {
        needsOnboarding = true
      }
    }

    setScreen(needsOnboarding ? 'onboarding' : 'app')
    setLoading(false)
  }, [])

  const signOut = useCallback(async () => {
    await sb.auth.signOut()
    setCurrentUser(null)
    setCurrentRole(null)
    setCurrentFranchiseeId(null)
    setScreen('landing')
  }, [])

  // Boot: check URL for PKCE code or existing session
  useEffect(() => {
    async function boot() {
      // PKCE recovery code
      const urlParams = new URLSearchParams(window.location.search)
      const pkceCode = urlParams.get('code')
      if (pkceCode) {
        try {
          const { data, error } = await sb.auth.exchangeCodeForSession(pkceCode)
          history.replaceState(null, '', '/login')
          if (!error && data?.session) {
            setScreen('reset')
            setLoading(false)
            return
          }
        } catch (e) { console.error('PKCE exchange error:', e) }
      }

      // Hash-based implicit recovery (fallback)
      const hash = window.location.hash
      if (hash && hash.includes('type=recovery')) {
        const params = new URLSearchParams(hash.substring(1))
        const accessToken = params.get('access_token')
        const refreshToken = params.get('refresh_token')
        if (accessToken) {
          await sb.auth.setSession({ access_token: accessToken, refresh_token: refreshToken || '' })
          history.replaceState(null, '', '/login')
          setScreen('reset')
          setLoading(false)
          return
        }
      }

      // Existing session
      const { data: { session } } = await sb.auth.getSession()
      if (session?.user) {
        const { data: { user }, error: userErr } = await sb.auth.getUser()
        if (user && !userErr) {
          await initApp(user)
          return
        }
        await sb.auth.signOut()
      }

      // No session — show landing or login based on URL
      const path = window.location.pathname
      setScreen(path === '/login' ? 'login' : 'landing')
      setLoading(false)
    }

    // Listen for password recovery event
    const { data: { subscription } } = sb.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        history.replaceState(null, '', '/login')
        setScreen('reset')
        setLoading(false)
      }
    })

    boot()
    return () => subscription.unsubscribe()
  }, [initApp])

  return (
    <AuthContext.Provider value={{
      currentUser, currentRole, currentFranchiseeId,
      loading, screen, setScreen,
      initApp, signOut,
      setCurrentFranchiseeId,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
