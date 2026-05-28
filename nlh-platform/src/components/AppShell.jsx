import React, { useState, useEffect, lazy, Suspense } from 'react'
import Sidebar from './Sidebar'

// Lazy-load every page so each is its own JS chunk.
// The shell + sidebar loads instantly; page code is fetched only when first visited.
const DashboardPage      = lazy(() => import('../pages/DashboardPage'))
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
        <Suspense fallback={<PageSpinner />}>
          <PageComponent onNavigate={handleNavigate} />
        </Suspense>
      </div>
    </div>
  )
}
