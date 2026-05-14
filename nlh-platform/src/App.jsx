import React, { lazy, Suspense } from 'react'
import { Routes, Route } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import Toast from './components/Toast'

// Eagerly load auth-critical screens
import LandingPage from './pages/LandingPage'
import LoginPage from './pages/LoginPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import OnboardingPage from './pages/OnboardingPage'

// Lazy-load heavy app screens (code splitting)
const AppShell = lazy(() => import('./components/AppShell'))
const AccessRequestPage = lazy(() => import('./pages/AccessRequestsPage'))

function Spinner() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
      <span className="spinner" />
    </div>
  )
}

function AppContent() {
  const { loading, screen } = useAuth()

  if (loading) return <Spinner />

  if (screen === 'landing')     return <LandingPage />
  if (screen === 'login')       return <LoginPage />
  if (screen === 'reset')       return <ResetPasswordPage />
  if (screen === 'request')     return <Suspense fallback={<Spinner />}><AccessRequestPage standalone /></Suspense>
  if (screen === 'onboarding')  return <OnboardingPage />
  if (screen === 'app')         return <Suspense fallback={<Spinner />}><AppShell /></Suspense>

  return <LandingPage />
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/*" element={<AppContent />} />
      </Routes>
      <Toast />
    </AuthProvider>
  )
}
