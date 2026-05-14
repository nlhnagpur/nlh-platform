import React, { useState } from 'react'
import Sidebar from './Sidebar'
import DebugOverlay from './DebugOverlay'
import DashboardPage from '../pages/DashboardPage'
import FranchiseesPage from '../pages/FranchiseesPage'
import OrdersPage from '../pages/OrdersPage'
import PricesPage from '../pages/PricesPage'
import StudentsPage from '../pages/StudentsPage'
import CoursesPage from '../pages/CoursesPage'
import PriceHistoryPage from '../pages/PriceHistoryPage'
import UsersPage from '../pages/UsersPage'
import AccessRequestsPage from '../pages/AccessRequestsPage'

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
}

export default function AppShell() {
  const [currentPage, setCurrentPage] = useState('dashboard')

  const PageComponent = PAGE_MAP[currentPage] || DashboardPage

  return (
    <div className="app">
      <Sidebar currentPage={currentPage} onNavigate={setCurrentPage} />
      <div className="main">
        <PageComponent onNavigate={setCurrentPage} />
      </div>
      <DebugOverlay />
    </div>
  )
}
