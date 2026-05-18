import React, { useState, useEffect } from 'react'
import Sidebar from './Sidebar'
import DashboardPage from '../pages/DashboardPage'
import FranchiseesPage from '../pages/FranchiseesPage'
import OrdersPage from '../pages/OrdersPage'
import PricesPage from '../pages/PricesPage'
import StudentsPage from '../pages/StudentsPage'
import CoursesPage from '../pages/CoursesPage'
import PriceHistoryPage from '../pages/PriceHistoryPage'
import UsersPage from '../pages/UsersPage'
import AccessRequestsPage from '../pages/AccessRequestsPage'
import InstructorsPage from '../pages/InstructorsPage'

const PAGE_MAP = {
  dashboard:       DashboardPage,
  franchisees:     FranchiseesPage,
  orders:          OrdersPage,
  prices:          PricesPage,
  students:        StudentsPage,
  courses:         CoursesPage,
  'price-history': PriceHistoryPage,
  users:           UsersPage,
  requests:        AccessRequestsPage,
  instructors:     InstructorsPage,
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
        <PageComponent onNavigate={handleNavigate} />
      </div>
    </div>
  )
}
