import React, { useState, useEffect, lazy, Suspense } from 'react'
import Sidebar from './Sidebar'

// Dashboard is eager — it's the first page after login, spinner would be jarring.
// Everything else is lazy; each page becomes its own JS chunk fetched on first visit.
import DashboardPage from '../pages/DashboardPage'
const FranchiseesPage    = lazy(() => import('../pages/FranchiseesPage'))
const OrdersPage         = lazy(() => import('../pages/OrdersPage'))
const PricesPage         = lazy(() => import('../pages/PricesPage'))
const StudentsPage       = lazy(() => import('../pages/StudentsPage'))
const CoursesPage        = lazy(() => import('../pages/CoursesPage'))
const PriceHistoryPage   = lazy(() => import('../pages/PriceHistoryPage'))
const UsersPage          = lazy(() => import('../pages/UsersPage'))
const AccessRequestsPage = lazy(() => import('../pages/AccessRequestsPage'))
const InstructorsPage    = lazy(() => import('../pages/InstructorsPage'))
const BatchesPage        = lazy(() => import('../pages/BatchesPage'))
const WhatsAppInboxPage  = lazy(() => import('../pages/WhatsAppInboxPage'))
const AccountingPage     = lazy(() => import('../pages/AccountingPage'))
const EmailLogPage       = lazy(() => import('../pages/EmailLogPage'))
const MessagesPage       = lazy(() => import('../pages/MessagesPage'))
const CouponsPage        = lazy(() => import('../pages/CouponsPage'))

const PAGE_MAP = {
  dashboard:        DashboardPage,
  franchisees:      FranchiseesPage,
  orders:           OrdersPage,
  prices:           PricesPage,
  students:         StudentsPage,
  courses:          CoursesPage,
  'price-history':  PriceHistoryPage,
  users:            UsersPage,
  requests:         AccessRequestsPage,
  instructors:      InstructorsPage,
  batches:          BatchesPage,
  'whatsapp-inbox': WhatsAppInboxPage,
  accounting:       AccountingPage,
  'email-log':      EmailLogPage,
  messages:         MessagesPage,
  coupons:          CouponsPage,
}

// Recover gracefully when a lazy page chunk fails to load — almost always
// because a new version was deployed and the old hashed chunk filename no
// longer exists on the server. Instead of a blank screen, reload once to
// fetch the fresh bundle (or show a Reload button as a fallback).
function isChunkError(err) {
  const m = (err && err.message) || ''
  return /loading chunk|dynamically imported module|failed to fetch dynamically|importing a module|ChunkLoadError/i.test(m)
}

class PageErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(error) { return { error } }
  componentDidCatch(error) {
    if (isChunkError(error)) {
      const last = Number(sessionStorage.getItem('nlh-chunk-reload') || 0)
      if (Date.now() - last > 10000) {              // at most once / 10s — avoids reload loops
        sessionStorage.setItem('nlh-chunk-reload', String(Date.now()))
        window.location.reload()
      }
    }
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--text2)' }}>
          <div style={{ fontSize: 34, marginBottom: 10 }}>⚠️</div>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>Couldn’t load this page</div>
          <div style={{ color: 'var(--text3)', fontSize: 13, marginBottom: 18 }}>A new version may have just been released. Reloading usually fixes it.</div>
          <button className="btn-p" onClick={function () { window.location.reload() }}>Reload</button>
        </div>
      )
    }
    return this.props.children
  }
}

function PageSpinner() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
      <span className="spinner" />
    </div>
  )
}

export default function AppShell() {
  const [currentPage, setCurrentPage] = useState('dashboard')
  const [sidebarOpen, setSidebarOpen] = useState(false)

  // Close sidebar when navigating (mobile UX)
  function handleNavigate(page) {
    setCurrentPage(page)
    setSidebarOpen(false)
  }

  // Close sidebar on Escape key
  useEffect(function() {
    function onKey(e) { if (e.key === 'Escape') setSidebarOpen(false) }
    document.addEventListener('keydown', onKey)
    return function() { document.removeEventListener('keydown', onKey) }
  }, [])

  // Prevent body scroll when sidebar is open on mobile
  useEffect(function() {
    if (sidebarOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return function() { document.body.style.overflow = '' }
  }, [sidebarOpen])

  const PageComponent = PAGE_MAP[currentPage] || DashboardPage

  return (
    <div className="app">
      {/* mobile hamburger — fixed, only visible on mobile via CSS */}
      <button
        className="mob-ham"
        onClick={function() { setSidebarOpen(true) }}
        aria-label="Open menu"
      >
        ☰
      </button>

      {/* overlay — tapping it closes the sidebar */}
      <div
        className={'mob-overlay' + (sidebarOpen ? ' open' : '')}
        onClick={function() { setSidebarOpen(false) }}
        aria-hidden="true"
      />

      <Sidebar
        currentPage={currentPage}
        onNavigate={handleNavigate}
        isOpen={sidebarOpen}
        onClose={function() { setSidebarOpen(false) }}
      />

      <div className="main">
        <PageErrorBoundary key={currentPage}>
          <Suspense fallback={<PageSpinner />}>
            <PageComponent onNavigate={handleNavigate} />
          </Suspense>
        </PageErrorBoundary>
      </div>
    </div>
  )
}
