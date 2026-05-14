import React, { useState, useEffect, useRef } from 'react'
import Chart from 'chart.js/auto'
import { sb } from '../supabase'
import { useAuth } from '../context/AuthContext'
import { isAdminRole } from '../constants/roles'
import { fmtAmt, fmtDate } from '../utils'

// ── helpers ────────────────────────────────────────────────────────────────

function orderStatusBadge(status) {
  const map = {
    pending:           { cls: 'bp', txt: 'Pending' },
    invoiced:          { cls: 'br', txt: 'Invoiced' },
    payment_submitted: { cls: 'bpu', txt: 'Pmt Submitted' },
    verified:          { cls: 'ba',  txt: 'Verified' },
    closed:            { cls: 'ba',  txt: 'Closed' },
    part_paid:         { cls: 'bp',  txt: 'Part Paid' },
  }
  const s = map[status] || { cls: 'bd', txt: status || '—' }
  return <span className={`badge ${s.cls}`}>{s.txt}</span>
}

function getLastSixMonths() {
  const months = []
  const now = new Date()
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push({
      label: d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }),
      year:  d.getFullYear(),
      month: d.getMonth(),
    })
  }
  return months
}

// ── component ──────────────────────────────────────────────────────────────

export default function DashboardPage({ onNavigate }) {
  const { currentRole, currentFranchiseeId } = useAuth()
  const isAdmin = isAdminRole(currentRole)
  const chartRef = useRef(null)
  const chartInstance = useRef(null)

  const [loading, setLoading] = useState(true)

  // admin metrics
  const [franchiseeCount, setFranchiseeCount] = useState(0)
  const [tierBreakdown, setTierBreakdown] = useState({ SMF: 0, CF: 0, UF: 0 })
  const [studentCount, setStudentCount] = useState(0)
  const [pendingCount, setPendingCount] = useState(0)
  const [outstanding, setOutstanding] = useState(0)
  const [recentOrders, setRecentOrders] = useState([])
  const [topFranchisees, setTopFranchisees] = useState([])

  // non-admin metrics
  const [ownOrderCount, setOwnOrderCount] = useState(0)
  const [ownPending, setOwnPending] = useState(0)
  const [ownOutstanding, setOwnOutstanding] = useState(0)
  const [ownOrders, setOwnOrders] = useState([])

  // chart data (both roles)
  const [chartData, setChartData] = useState([])

  // ── data load ──────────────────────────────────────────────────────────

  useEffect(function() {
    if (currentRole === null) return   // wait for auth to resolve
    async function load() {
      setLoading(true)
      try {
        if (isAdmin) {
          await loadAdminData()
        } else {
          if (!currentFranchiseeId) { setLoading(false); return }
          await loadFranchiseeData()
        }
      } catch (err) {
        console.error('Dashboard load error:', err)
      }
      setLoading(false)
    }
    load()
  }, [currentRole, isAdmin, currentFranchiseeId])

  async function loadAdminData() {
    const [fr, frAll, st, or_, orAll] = await Promise.all([
      sb.from('franchisees').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      sb.from('franchisees').select('tier'),
      sb.from('students').select('id', { count: 'exact', head: true }),
      sb.from('orders').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      sb.from('orders').select('id, status, placer_id, courier_charges, created_at, franchisees(name)'),
    ])

    setFranchiseeCount(fr.count || 0)
    setStudentCount(st.count || 0)
    setPendingCount(or_.count || 0)

    // tier breakdown
    const tiers = { SMF: 0, CF: 0, UF: 0 }
    if (frAll.data) {
      frAll.data.forEach(function(f) { if (tiers[f.tier] !== undefined) tiers[f.tier]++ })
    }
    setTierBreakdown(tiers)

    const allOrders = orAll.data || []

    // outstanding: sum courier_charges + order_items rates for invoiced orders
    const invoicedIds = allOrders
      .filter(function(o) { return o.status === 'invoiced' || o.status === 'payment_submitted' })
      .map(function(o) { return o.id })

    let totalOutstanding = allOrders
      .filter(function(o) { return invoicedIds.includes(o.id) })
      .reduce(function(sum, o) { return sum + (o.courier_charges || 0) }, 0)

    if (invoicedIds.length > 0) {
      const { data: items } = await sb
        .from('order_items')
        .select('ordered_qty, rate')
        .in('order_id', invoicedIds)
      if (items) {
        items.forEach(function(it) { totalOutstanding += (it.ordered_qty || 0) * (it.rate || 0) })
      }
    }
    setOutstanding(totalOutstanding)

    // recent orders (last 10)
    const sorted = [...allOrders].sort(function(a, b) {
      return new Date(b.created_at) - new Date(a.created_at)
    }).slice(0, 10)
    setRecentOrders(sorted)

    // top franchisees by order count
    const countMap = {}
    allOrders.forEach(function(o) {
      const name = o.franchisees?.name || 'Unknown'
      countMap[name] = (countMap[name] || 0) + 1
    })
    const topList = Object.entries(countMap)
      .sort(function(a, b) { return b[1] - a[1] })
      .slice(0, 5)
      .map(function(e) { return { name: e[0], count: e[1] } })
    setTopFranchisees(topList)

    // chart: orders per month last 6 months
    buildChartData(allOrders)
  }

  async function loadFranchiseeData() {
    if (!currentFranchiseeId) return
    const { data: ownOrds } = await sb
      .from('orders')
      .select('id, status, courier_charges, created_at')
      .eq('placer_id', currentFranchiseeId)

    const orders = ownOrds || []
    setOwnOrderCount(orders.length)
    setOwnOrders([...orders].sort(function(a, b) {
      return new Date(b.created_at) - new Date(a.created_at)
    }).slice(0, 10))

    const pending = orders.filter(function(o) { return o.status === 'pending' }).length
    setOwnPending(pending)

    const invoicedOrds = orders.filter(function(o) {
      return o.status === 'invoiced' || o.status === 'payment_submitted'
    })
    let outstanding = invoicedOrds.reduce(function(s, o) { return s + (o.courier_charges || 0) }, 0)

    const invoicedIds = invoicedOrds.map(function(o) { return o.id })
    if (invoicedIds.length > 0) {
      const { data: items } = await sb
        .from('order_items')
        .select('ordered_qty, rate')
        .in('order_id', invoicedIds)
      if (items) {
        items.forEach(function(it) { outstanding += (it.ordered_qty || 0) * (it.rate || 0) })
      }
    }
    setOwnOutstanding(outstanding)
    buildChartData(orders)
  }

  function buildChartData(orders) {
    const months = getLastSixMonths()
    const counts = months.map(function(m) {
      return orders.filter(function(o) {
        const d = new Date(o.created_at)
        return d.getFullYear() === m.year && d.getMonth() === m.month
      }).length
    })
    setChartData({ labels: months.map(function(m) { return m.label }), values: counts })
  }

  // ── chart render ───────────────────────────────────────────────────────

  useEffect(function() {
    if (!chartRef.current || !chartData.labels) return
    if (chartInstance.current) chartInstance.current.destroy()

    chartInstance.current = new Chart(chartRef.current, {
      type: 'line',
      data: {
        labels: chartData.labels,
        datasets: [{
          label: 'Orders',
          data: chartData.values,
          borderColor: '#534AB7',
          backgroundColor: 'rgba(83,74,183,0.08)',
          borderWidth: 2.5,
          pointBackgroundColor: '#534AB7',
          pointRadius: 4,
          pointHoverRadius: 6,
          fill: true,
          tension: 0.35,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function(ctx) { return ' ' + ctx.parsed.y + ' orders' },
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { font: { size: 11, family: 'DM Mono' }, color: '#9C9A92' },
          },
          y: {
            beginAtZero: true,
            grid: { color: 'rgba(0,0,0,0.04)' },
            ticks: {
              font: { size: 11, family: 'DM Mono' },
              color: '#9C9A92',
              stepSize: 1,
              precision: 0,
            },
          },
        },
      },
    })

    return function() {
      if (chartInstance.current) chartInstance.current.destroy()
    }
  }, [chartData])

  // ── render helpers ─────────────────────────────────────────────────────

  function DashCard({ num, lbl, sub, icon, colorClass, page }) {
    return (
      <div
        className={`dash-card ${colorClass}`}
        onClick={function() { if (page && onNavigate) onNavigate(page) }}
      >
        <div className="dash-card-top">
          <div className="dash-card-icon">{icon}</div>
          <div className="dash-card-arrow">↗</div>
        </div>
        <div className="dash-card-num">{num}</div>
        <div className="dash-card-lbl">{lbl}</div>
        {sub && <div className="dash-card-sub">{sub}</div>}
      </div>
    )
  }

  // ── loading state ──────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="pg">
        <div className="loading">
          <span className="spinner" />
          Loading dashboard…
        </div>
      </div>
    )
  }

  // ── render ─────────────────────────────────────────────────────────────

  return (
    <div className="pg">
      <div className="topbar">
        <div>
          <div className="pt">Dashboard</div>
          <div className="ps">Welcome back · {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>
        </div>
      </div>

      {/* ── Metric cards ── */}
      <div className="dash-cards">
        {isAdmin ? (
          <>
            <DashCard
              colorClass="dash-card-1"
              icon="🏢"
              num={franchiseeCount}
              lbl="Active Franchisees"
              sub={`SMF ${tierBreakdown.SMF} · CF ${tierBreakdown.CF} · UF ${tierBreakdown.UF}`}
              page="franchisees"
            />
            <DashCard
              colorClass="dash-card-2"
              icon="👨‍🎓"
              num={studentCount}
              lbl="Total Students"
              sub="Across all centres"
              page="students"
            />
            <DashCard
              colorClass="dash-card-3"
              icon="📦"
              num={pendingCount}
              lbl="Pending Orders"
              sub="Awaiting invoice"
              page="orders"
            />
            <DashCard
              colorClass="dash-card-4"
              icon="₹"
              num={'₹' + fmtAmt(outstanding)}
              lbl="Outstanding"
              sub="Invoiced · unpaid"
              page="orders"
            />
          </>
        ) : (
          <>
            <DashCard
              colorClass="dash-card-1"
              icon="📦"
              num={ownOrderCount}
              lbl="Total Orders"
              sub="All time"
              page="orders"
            />
            <DashCard
              colorClass="dash-card-2"
              icon="⏳"
              num={ownPending}
              lbl="Pending Orders"
              sub="Awaiting invoice"
              page="orders"
            />
            <DashCard
              colorClass="dash-card-3"
              icon="₹"
              num={'₹' + fmtAmt(ownOutstanding)}
              lbl="Outstanding"
              sub="Invoiced · unpaid"
              page="orders"
            />
            <DashCard
              colorClass="dash-card-4"
              icon="👨‍🎓"
              num={studentCount}
              lbl="My Students"
              sub="Active enrollments"
              page="students"
            />
          </>
        )}
      </div>

      {/* ── Charts row ── */}
      <div className="dash-charts">
        <div className="dash-chart-main">
          <div className="dash-chart-head">
            <div>
              <div className="dash-chart-title">Orders Trend</div>
              <div className="dash-chart-sub">Last 6 months</div>
            </div>
          </div>
          <div style={{ height: 200 }}>
            <canvas ref={chartRef} />
          </div>
        </div>

        <div className="dash-chart-side">
          <div className="dash-chart-head">
            <div>
              <div className="dash-chart-title">Quick Actions</div>
              <div className="dash-chart-sub">Navigate to sections</div>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
            {isAdmin ? (
              <>
                {[
                  ['orders', '📦', 'Manage Orders'],
                  ['franchisees', '🏢', 'Franchisees'],
                  ['students', '👨‍🎓', 'Students'],
                  ['courses', '📚', 'Courses & SKUs'],
                ].map(function([page, icon, label]) {
                  return (
                    <button
                      key={page}
                      onClick={function() { onNavigate && onNavigate(page) }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                        background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: 10, padding: '10px 12px', cursor: 'pointer',
                        color: '#fff', fontSize: 12, fontFamily: 'var(--font)', textAlign: 'left',
                        transition: 'background 0.15s',
                      }}
                      onMouseEnter={function(e) { e.currentTarget.style.background = 'rgba(255,255,255,0.15)' }}
                      onMouseLeave={function(e) { e.currentTarget.style.background = 'rgba(255,255,255,0.08)' }}
                    >
                      <span style={{ fontSize: 16 }}>{icon}</span> {label}
                    </button>
                  )
                })}
              </>
            ) : (
              <>
                {[
                  ['orders', '📦', 'Place New Order'],
                  ['students', '👨‍🎓', 'My Students'],
                  ['courses', '📚', 'My Courses'],
                ].map(function([page, icon, label]) {
                  return (
                    <button
                      key={page}
                      onClick={function() { onNavigate && onNavigate(page) }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                        background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: 10, padding: '10px 12px', cursor: 'pointer',
                        color: '#fff', fontSize: 12, fontFamily: 'var(--font)', textAlign: 'left',
                        transition: 'background 0.15s',
                      }}
                      onMouseEnter={function(e) { e.currentTarget.style.background = 'rgba(255,255,255,0.15)' }}
                      onMouseLeave={function(e) { e.currentTarget.style.background = 'rgba(255,255,255,0.08)' }}
                    >
                      <span style={{ fontSize: 16 }}>{icon}</span> {label}
                    </button>
                  )
                })}
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Bottom row ── */}
      <div className="dash-bottom">
        {/* Recent orders */}
        <div className="card" style={{ marginBottom: 0 }}>
          <div className="ch">
            Recent Orders
            <button className="btn-s btn-sm" onClick={function() { onNavigate && onNavigate('orders') }}>View all →</button>
          </div>
          {(isAdmin ? recentOrders : ownOrders).length === 0 ? (
            <div className="empty">No orders yet</div>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Order</th>
                  {isAdmin && <th>Franchisee</th>}
                  <th>Status</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {(isAdmin ? recentOrders : ownOrders).map(function(o, i) {
                  return (
                    <tr key={o.id || i}>
                      <td className="mono" style={{ fontSize: 11 }}>#{String(o.id).slice(0, 8)}</td>
                      {isAdmin && (
                        <td style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {o.franchisees?.name || '—'}
                        </td>
                      )}
                      <td>{orderStatusBadge(o.status)}</td>
                      <td className="muted">{fmtDate(o.created_at)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Top franchisees (admin) / order summary (non-admin) */}
        <div className="card" style={{ marginBottom: 0 }}>
          {isAdmin ? (
            <>
              <div className="ch">Top Franchisees by Orders</div>
              {topFranchisees.length === 0 ? (
                <div className="empty">No data yet</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {topFranchisees.map(function(f, i) {
                    return (
                      <div key={f.name} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{
                          width: 26, height: 26, borderRadius: 8, flexShrink: 0,
                          background: ['#DBEAFE','#DCFCE7','#FEF3C7','#EDE9FE','#FFE4E6'][i] || '#F3F4F6',
                          color:      ['#2563EB','#16A34A','#D97706','#7C3AED','#E11D48'][i] || '#6B7280',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 12, fontWeight: 700, fontFamily: 'var(--mono)',
                        }}>
                          {i + 1}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {f.name}
                          </div>
                          <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--mono)', marginTop: 1 }}>
                            {f.count} {f.count === 1 ? 'order' : 'orders'}
                          </div>
                        </div>
                        <div style={{
                          background: 'var(--purple-bg)', color: 'var(--purple)',
                          fontSize: 11, fontWeight: 600, padding: '2px 10px',
                          borderRadius: 20, fontFamily: 'var(--mono)', flexShrink: 0,
                        }}>
                          {f.count}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="ch">Order Status Summary</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[
                  { status: 'pending',           label: 'Pending',          cls: 'bp' },
                  { status: 'invoiced',           label: 'Invoiced',         cls: 'br' },
                  { status: 'payment_submitted',  label: 'Payment Submitted',cls: 'bpu' },
                  { status: 'closed',             label: 'Closed',           cls: 'ba' },
                ].map(function(row) {
                  const cnt = ownOrders.filter(function(o) { return o.status === row.status }).length
                  return (
                    <div key={row.status} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span className={`badge ${row.cls}`}>{row.label}</span>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{cnt}</span>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
