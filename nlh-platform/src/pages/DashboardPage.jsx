import React, { useState, useEffect } from 'react'
import { sb } from '../supabase'
import { useAuth } from '../context/AuthContext'
import { isAdminRole } from '../constants/roles'
import { fmtAmt, fmtDate } from '../utils'

// ── helpers ────────────────────────────────────────────────────────────────────

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

function timeGreeting(name) {
  const h = new Date().getHours()
  let g
  if (h < 5)       g = 'Burning the midnight oil'
  else if (h < 12) g = 'Good morning'
  else if (h < 17) g = 'Good afternoon'
  else if (h < 21) g = 'Good evening'
  else             g = 'Working late'
  return g + ', ' + name + '!'
}

const PROGRAMS_STRIP = [
  { emoji: '🧮', name: 'Abacus',       tone: 1 },
  { emoji: '💻', name: 'Coding',       tone: 2 },
  { emoji: '🔤', name: 'Phonics',      tone: 3 },
  { emoji: '🎨', name: 'Art & Craft',  tone: 4 },
  { emoji: '🎲', name: "Rubik's Cube", tone: 5 },
  { emoji: '🎭', name: 'Public Speaking', tone: 6 },
  { emoji: '✍️', name: 'Write Well',   tone: 7 },
  { emoji: '📖', name: 'Storytelling', tone: 8 },
]

const AVATAR_COLORS = ['#2563EB','#16A34A','#D97706','#DB2777','#7C3AED','#0284C7','#EA580C','#E11D48']

function initials(name) {
  if (!name) return '?'
  return name.split(' ').map(function(n) { return n[0] }).join('').slice(0, 2).toUpperCase()
}

function OrderBadge({ status }) {
  const map = {
    pending:           { cls: 'bdg-pend', txt: 'pending' },
    invoiced:          { cls: 'bdg-inv',  txt: 'invoiced' },
    payment_submitted: { cls: 'bdg-pmt',  txt: 'pmt submitted' },
    verified:          { cls: 'bdg-paid', txt: 'verified' },
    closed:            { cls: 'bdg-paid', txt: 'closed' },
    part_paid:         { cls: 'bdg-pend', txt: 'part paid' },
  }
  const s = map[status] || { cls: 'bdg-inv', txt: status || '—' }
  return (
    <span className={'bdg-new ' + s.cls}>
      <span className="d"></span>{s.txt}
    </span>
  )
}

// ── SVG chart ─────────────────────────────────────────────────────────────────

function OrdersChart({ chartData }) {
  const [range, setRange] = useState('6m')
  const months = chartData?.labels || ['Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May']
  const values = chartData?.values || [0, 0, 0, 0, 0, 0]
  const total = values.reduce(function(s, v) { return s + v }, 0)
  const w = 640, h = 200, pad = { t: 20, r: 16, b: 28, l: 30 }
  const maxV = Math.max(...values, 1) * 1.15
  const innerW = w - pad.l - pad.r
  const innerH = h - pad.t - pad.b
  const stepX = innerW / Math.max(values.length - 1, 1)
  const points = values.map(function(v, i) {
    return { x: pad.l + i * stepX, y: pad.t + innerH - (v / maxV) * innerH }
  })

  function smoothPath(pts) {
    if (pts.length === 0) return ''
    let d = 'M ' + pts[0].x + ' ' + pts[0].y
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i], p1 = pts[i + 1]
      const cx = (p0.x + p1.x) / 2
      d += ' C ' + cx + ' ' + p0.y + ', ' + cx + ' ' + p1.y + ', ' + p1.x + ' ' + p1.y
    }
    return d
  }

  const linePath = smoothPath(points)
  const areaPath = linePath + ' L ' + points[points.length - 1].x + ' ' + (pad.t + innerH) + ' L ' + points[0].x + ' ' + (pad.t + innerH) + ' Z'

  return (
    <div className="card-new chart-card">
      <div className="card-h" style={{ padding: 0, border: 'none', marginBottom: 0 }}>
        <div>
          <div className="card-t">Order volume</div>
          <div className="card-ts">Last 6 months · orders placed</div>
        </div>
        <div className="chart-tabs">
          {['6m', '12m', 'YTD'].map(function(r) {
            return (
              <button key={r} className={'chart-tab ' + (range === r ? 'on' : '')} onClick={function() { setRange(r) }}>{r}</button>
            )
          })}
        </div>
      </div>
      <div className="chart-stats">
        <div className="chart-big">{total}</div>
        <div className="chart-delta">↗ orders</div>
        <div className="chart-context">last 6 months</div>
      </div>
      <svg className="chart-svg" viewBox={'0 0 ' + w + ' ' + h} preserveAspectRatio="none">
        <defs>
          <linearGradient id="ag" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#534AB7" stopOpacity=".28" />
            <stop offset="100%" stopColor="#534AB7" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="lg" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#534AB7" />
            <stop offset="100%" stopColor="#DB2777" />
          </linearGradient>
        </defs>
        {[0, .25, .5, .75, 1].map(function(p, i) {
          const y = pad.t + innerH * (1 - p)
          return <line key={i} x1={pad.l} y1={y} x2={w - pad.r} y2={y} stroke="#E2E0D8" strokeWidth="1" strokeDasharray={i === 4 ? '0' : '3 4'} opacity={i === 4 ? 1 : .6} />
        })}
        {[0, .5, 1].map(function(p, i) {
          const v = Math.round(maxV * p)
          const y = pad.t + innerH * (1 - p)
          return <text key={i} x={pad.l - 8} y={y + 3} textAnchor="end" fontSize="9" fontFamily="DM Mono" fill="#9C9A92">{v}</text>
        })}
        {points.length > 1 && <path d={areaPath} fill="url(#ag)" />}
        {points.length > 1 && <path d={linePath} fill="none" stroke="url(#lg)" strokeWidth="2.5" strokeLinecap="round" />}
        {points.map(function(p, i) {
          return (
            <g key={i}>
              <circle cx={p.x} cy={p.y} r="5" fill="#fff" stroke={i === points.length - 1 ? '#DB2777' : '#534AB7'} strokeWidth="2.2" />
              {i === points.length - 1 && values[i] > 0 && (
                <text x={p.x} y={p.y - 14} textAnchor="middle" fontSize="11" fontWeight="700" fontFamily="DM Sans" fill="#1A1916">{values[i]}</text>
              )}
            </g>
          )
        })}
        {points.map(function(p, i) {
          return <text key={i} x={p.x} y={h - 8} textAnchor="middle" fontSize="10" fontFamily="DM Mono" fill="#9C9A92">{months[i]}</text>
        })}
      </svg>
    </div>
  )
}

// ── Tier donut ─────────────────────────────────────────────────────────────────

function TierDonut({ tierBreakdown, total }) {
  const data = [
    { name: 'UF',  count: tierBreakdown.UF  || 0, color: '#2563EB' },
    { name: 'CF',  count: tierBreakdown.CF  || 0, color: '#16A34A' },
    { name: 'SMF', count: tierBreakdown.SMF || 0, color: '#F59E0B' },
  ]
  const tot = data.reduce(function(s, d) { return s + d.count }, 0) || 1
  const r = 50, cx = 62, cy = 62
  const C = 2 * Math.PI * r
  let offset = 0

  return (
    <div className="card-new tier-card">
      <div className="card-h" style={{ padding: 0, border: 'none', marginBottom: 4 }}>
        <div>
          <div className="card-t">Franchisee tiers</div>
          <div className="card-ts">{total} active · split by tier</div>
        </div>
      </div>
      <div className="donut-wrap">
        <div className="donut">
          <svg viewBox="0 0 124 124">
            <circle cx={cx} cy={cy} r={r} fill="none" stroke="#F0EEE9" strokeWidth="14" />
            {data.map(function(d, i) {
              const dash = (d.count / tot) * C
              const seg = (
                <circle
                  key={i}
                  cx={cx} cy={cy} r={r}
                  fill="none"
                  stroke={d.color}
                  strokeWidth="14"
                  strokeDasharray={dash + ' ' + (C - dash)}
                  strokeDashoffset={-offset}
                  strokeLinecap="butt"
                />
              )
              offset += dash
              return seg
            })}
          </svg>
          <div className="donut-center">
            <div className="donut-big">{tot}</div>
            <div className="donut-lbl">Total</div>
          </div>
        </div>
        <div className="donut-side">
          <div className="tier-rows">
            {data.map(function(d) {
              const pct = Math.round((d.count / tot) * 100)
              return (
                <div key={d.name} className="tier-row">
                  <span className="tier-swatch" style={{ background: d.color }}></span>
                  <span className="tier-name">{d.name}</span>
                  <div className="tier-bar"><div className="tier-bar-fill" style={{ width: pct + '%', background: d.color }}></div></div>
                  <span className="tier-cnt">{d.count}</span>
                  <span className="tier-pct">{pct}%</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function DashboardPage({ onNavigate }) {
  const { currentRole, currentFranchiseeId, currentUser } = useAuth()
  const isAdmin = isAdminRole(currentRole)

  const [loading, setLoading] = useState(true)
  const [franchiseeCount, setFranchiseeCount] = useState(0)
  const [tierBreakdown, setTierBreakdown] = useState({ SMF: 0, CF: 0, UF: 0 })
  const [studentCount, setStudentCount] = useState(0)
  const [pendingCount, setPendingCount] = useState(0)
  const [outstanding, setOutstanding] = useState(0)
  const [recentOrders, setRecentOrders] = useState([])
  const [topFranchisees, setTopFranchisees] = useState([])
  const [chartData, setChartData] = useState(null)

  // non-admin
  const [ownOrderCount, setOwnOrderCount] = useState(0)
  const [ownPending, setOwnPending] = useState(0)
  const [ownOutstanding, setOwnOutstanding] = useState(0)
  const [ownOrders, setOwnOrders] = useState([])

  useEffect(function() {
    if (currentRole === null) return
    async function load() {
      setLoading(true)
      try {
        if (isAdmin) {
          await loadAdminData()
        } else {
          if (currentFranchiseeId) await loadFranchiseeData()
        }
      } catch (err) { console.error('Dashboard load error:', err) }
      setLoading(false)
    }
    load()
  }, [currentRole, isAdmin, currentFranchiseeId])

  async function loadAdminData() {
    const [fr, frAll, st, or_, orAll] = await Promise.all([
      sb.from('franchisees').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      sb.from('franchisees').select('tier').eq('status', 'active'),
      sb.from('students').select('id', { count: 'exact', head: true }),
      sb.from('orders').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      sb.from('orders').select('id, status, grand_total, amount_paid, created_at, franchisees(business_name, city, tier)'),
    ])
    setFranchiseeCount(fr.count || 0)
    setStudentCount(st.count || 0)
    setPendingCount(or_.count || 0)

    const tiers = { SMF: 0, CF: 0, UF: 0 }
    if (frAll.data) frAll.data.forEach(function(f) { if (tiers[f.tier] !== undefined) tiers[f.tier]++ })
    setTierBreakdown(tiers)

    const allOrders = orAll.data || []
    const totalOutstanding = allOrders
      .filter(function(o) { return o.status === 'invoiced' || o.status === 'payment_submitted' })
      .reduce(function(sum, o) { return sum + Math.max(0, (o.grand_total || 0) - (o.amount_paid || 0)) }, 0)
    setOutstanding(totalOutstanding)

    const sorted = [...allOrders].sort(function(a, b) { return new Date(b.created_at) - new Date(a.created_at) }).slice(0, 8)
    setRecentOrders(sorted)

    const countMap = {}
    allOrders.forEach(function(o) {
      const name = o.franchisees?.business_name || 'Unknown'
      const city = o.franchisees?.city || ''
      const tier = o.franchisees?.tier || 'UF'
      if (!countMap[name]) countMap[name] = { count: 0, city, tier }
      countMap[name].count++
    })
    const topList = Object.entries(countMap)
      .sort(function(a, b) { return b[1].count - a[1].count })
      .slice(0, 5)
      .map(function(e) { return { name: e[0], count: e[1].count, city: e[1].city, tier: e[1].tier } })
    setTopFranchisees(topList)

    buildChartData(allOrders)
  }

  async function loadFranchiseeData() {
    const { data: ownOrds } = await sb.from('orders')
      .select('id, status, grand_total, amount_paid, created_at')
      .eq('placer_id', currentFranchiseeId)
    const orders = ownOrds || []
    setOwnOrderCount(orders.length)
    setOwnOrders([...orders].sort(function(a, b) { return new Date(b.created_at) - new Date(a.created_at) }).slice(0, 8))
    setOwnPending(orders.filter(function(o) { return o.status === 'pending' }).length)
    const outstanding = orders
      .filter(function(o) { return o.status === 'invoiced' || o.status === 'payment_submitted' })
      .reduce(function(sum, o) { return sum + Math.max(0, (o.grand_total || 0) - (o.amount_paid || 0)) }, 0)
    setOwnOutstanding(outstanding)

    const { data: st } = await sb.from('students').select('id', { count: 'exact', head: true }).eq('franchisee_id', currentFranchiseeId)
    setStudentCount(st?.count || 0)
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

  // ── hero data ──
  const userName = currentUser?.user_metadata?.full_name || currentUser?.email?.split('@')[0] || 'Admin'
  const firstName = userName.split(' ')[0]
  const dateStr = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const userInitials = initials(userName)
  const roleLabel = { owner: 'Owner', super_admin: 'Super Admin', admin: 'Admin', manager: 'Manager', staff: 'Staff', smf: 'State Master', cf: 'City Franchisee', uf: 'Unit Franchisee' }[currentRole] || 'User'

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div className="tb">
          <div className="crumb">Operations <span className="sep">›</span> <b>Dashboard</b></div>
        </div>
        <div className="content" style={{ alignItems: 'center', justifyContent: 'center', flex: 1 }}>
          <div className="loading"><span className="spinner" /> Loading dashboard…</div>
        </div>
      </div>
    )
  }

  const displayOrders = isAdmin ? recentOrders : ownOrders

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      {/* sticky topbar */}
      <div className="tb">
        <div className="crumb">Operations <span className="sep">›</span> <b>Dashboard</b></div>
        <div className="tb-r">
          <button className="btn-s btn-sm" onClick={function() { onNavigate && onNavigate('orders') }}>📦 New order</button>
          <button className="btn-p btn-sm" onClick={function() { onNavigate && onNavigate('franchisees') }}>+ Franchisee</button>
        </div>
      </div>

      <div className="content">
        {/* ── hero ── */}
        <div className="hero">
          <div className="hero-l">
            <div className="hero-eyebrow">
              <span className="dot"></span>
              Live · {dateStr}
            </div>
            <h1 className="hero-title">{timeGreeting(firstName)}</h1>
            <p className="hero-sub">
              Here is what is happening across your network today.{' '}
              {isAdmin
                ? <><b>16 programs</b> running, <b>{franchiseeCount}</b> franchisees active.</>
                : <>Your centre is active and growing.</>
              }
            </p>
            <div className="hero-chips">
              {isAdmin ? (
                <>
                  <span className="hero-chip"><span className="em">🎓</span><b>{studentCount}</b>&nbsp;students</span>
                  <span className="hero-chip"><span className="em">📦</span><b>{pendingCount}</b>&nbsp;pending orders</span>
                  <span className="hero-chip"><span className="em">🏢</span><b>{franchiseeCount}</b>&nbsp;franchisees</span>
                </>
              ) : (
                <>
                  <span className="hero-chip"><span className="em">🎓</span><b>{studentCount}</b>&nbsp;students</span>
                  <span className="hero-chip"><span className="em">📦</span><b>{ownPending}</b>&nbsp;pending orders</span>
                  <span className="hero-chip"><span className="em">💰</span>₹<b>{fmtAmt(ownOutstanding)}</b>&nbsp;outstanding</span>
                </>
              )}
            </div>
          </div>
          <div className="hero-r" aria-hidden="true">
            <svg className="spk spk-1" width="18" height="18" viewBox="0 0 18 18">
              <path d="M9 0 L10.5 7.5 L18 9 L10.5 10.5 L9 18 L7.5 10.5 L0 9 L7.5 7.5 Z" fill="#1A237E" opacity=".6" />
            </svg>
            <svg className="spk spk-2" width="14" height="14" viewBox="0 0 18 18">
              <path d="M9 0 L10.5 7.5 L18 9 L10.5 10.5 L9 18 L7.5 10.5 L0 9 L7.5 7.5 Z" fill="#FBBF24" />
            </svg>
            <svg className="spk spk-3" width="12" height="12" viewBox="0 0 18 18">
              <path d="M9 0 L10.5 7.5 L18 9 L10.5 10.5 L9 18 L7.5 10.5 L0 9 L7.5 7.5 Z" fill="#1A237E" opacity=".5" />
            </svg>
            <svg className="spk spk-4" width="16" height="16" viewBox="0 0 18 18">
              <path d="M9 0 L10.5 7.5 L18 9 L10.5 10.5 L9 18 L7.5 10.5 L0 9 L7.5 7.5 Z" fill="#DB2777" opacity=".7" />
            </svg>
            <div className="mascot-wrap">
              <img src="/NLH%20Mascot.png" alt="" className="mascot-img" />
            </div>
          </div>
        </div>

        {/* ── KPI cards ── */}
        <div className="kpi">
          {isAdmin ? (
            <>
              <div className="kc kc-1" onClick={function() { onNavigate && onNavigate('franchisees') }}>
                <div className="kc-top">
                  <div className="kc-ic">🏢</div>
                  <div className="kc-arr">↗</div>
                </div>
                <div className="kc-num">{franchiseeCount}</div>
                <div className="kc-lbl">Active franchisees</div>
                <div className="kc-sub"><span className="delta">SMF {tierBreakdown.SMF}</span>CF {tierBreakdown.CF} · UF {tierBreakdown.UF}</div>
              </div>
              <div className="kc kc-2" onClick={function() { onNavigate && onNavigate('students') }}>
                <div className="kc-top">
                  <div className="kc-ic">🎓</div>
                  <div className="kc-arr">↗</div>
                </div>
                <div className="kc-num">{studentCount.toLocaleString('en-IN')}</div>
                <div className="kc-lbl">Total students</div>
                <div className="kc-sub"><span className="delta">all centres</span>across network</div>
              </div>
              <div className="kc kc-3" onClick={function() { onNavigate && onNavigate('orders') }}>
                <div className="kc-top">
                  <div className="kc-ic">📦</div>
                  <div className="kc-arr">↗</div>
                </div>
                <div className="kc-num">{pendingCount}</div>
                <div className="kc-lbl">Pending orders</div>
                <div className="kc-sub"><span className="delta">awaiting</span>invoice</div>
              </div>
              <div className="kc kc-4" onClick={function() { onNavigate && onNavigate('orders') }}>
                <div className="kc-top">
                  <div className="kc-ic">💰</div>
                  <div className="kc-arr">↗</div>
                </div>
                <div className="kc-num">{'₹' + fmtAmt(outstanding)}</div>
                <div className="kc-lbl">Outstanding</div>
                <div className="kc-sub"><span className="delta">unpaid</span>invoiced orders</div>
              </div>
            </>
          ) : (
            <>
              <div className="kc kc-1" onClick={function() { onNavigate && onNavigate('orders') }}>
                <div className="kc-top"><div className="kc-ic">📦</div><div className="kc-arr">↗</div></div>
                <div className="kc-num">{ownOrderCount}</div>
                <div className="kc-lbl">Total orders</div>
                <div className="kc-sub"><span className="delta">all time</span>placed</div>
              </div>
              <div className="kc kc-2" onClick={function() { onNavigate && onNavigate('students') }}>
                <div className="kc-top"><div className="kc-ic">🎓</div><div className="kc-arr">↗</div></div>
                <div className="kc-num">{studentCount}</div>
                <div className="kc-lbl">My students</div>
                <div className="kc-sub"><span className="delta">active</span>enrollments</div>
              </div>
              <div className="kc kc-3" onClick={function() { onNavigate && onNavigate('orders') }}>
                <div className="kc-top"><div className="kc-ic">⏳</div><div className="kc-arr">↗</div></div>
                <div className="kc-num">{ownPending}</div>
                <div className="kc-lbl">Pending orders</div>
                <div className="kc-sub"><span className="delta">awaiting</span>invoice</div>
              </div>
              <div className="kc kc-4" onClick={function() { onNavigate && onNavigate('orders') }}>
                <div className="kc-top"><div className="kc-ic">💰</div><div className="kc-arr">↗</div></div>
                <div className="kc-num">{'₹' + fmtAmt(ownOutstanding)}</div>
                <div className="kc-lbl">Outstanding</div>
                <div className="kc-sub"><span className="delta">unpaid</span>invoiced</div>
              </div>
            </>
          )}
        </div>

        {/* ── programs strip ── */}
        <div className="programs-card">
          <div className="pc-head">
            <div>
              <div className="pc-title">Programs at a glance</div>
              <div className="pc-sub">16 skill-based programs · NLH</div>
            </div>
            <div className="pc-link" onClick={function() { onNavigate && onNavigate('courses') }}>View all 16 →</div>
          </div>
          <div className="programs">
            {PROGRAMS_STRIP.map(function(p) {
              return (
                <div key={p.name} className="prog">
                  <div className={'prog-em pe-' + p.tone}>{p.emoji}</div>
                  <div className="prog-name">{p.name}</div>
                  <div className="prog-count">Active</div>
                </div>
              )
            })}
          </div>
        </div>

        {/* ── chart + donut row ── */}
        <div className="row">
          <OrdersChart chartData={chartData} />
          {isAdmin ? (
            <TierDonut tierBreakdown={tierBreakdown} total={franchiseeCount} />
          ) : (
            <div className="card-new tier-card">
              <div className="card-h" style={{ padding: 0, border: 'none', marginBottom: 12 }}>
                <div>
                  <div className="card-t">Order status</div>
                  <div className="card-ts">Your orders breakdown</div>
                </div>
              </div>
              <div className="tier-rows">
                {[
                  { status: 'pending', label: 'Pending', color: '#F59E0B' },
                  { status: 'invoiced', label: 'Invoiced', color: '#1A5FA8' },
                  { status: 'payment_submitted', label: 'Pmt Submitted', color: '#534AB7' },
                  { status: 'closed', label: 'Closed', color: '#16A34A' },
                ].map(function(row) {
                  const cnt = ownOrders.filter(function(o) { return o.status === row.status }).length
                  return (
                    <div key={row.status} className="tier-row">
                      <span className="tier-swatch" style={{ background: row.color }}></span>
                      <span className="tier-name" style={{ fontSize: 11 }}>{row.label}</span>
                      <div className="tier-bar"><div className="tier-bar-fill" style={{ width: (cnt / Math.max(ownOrderCount, 1)) * 100 + '%', background: row.color }}></div></div>
                      <span className="tier-cnt">{cnt}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* ── orders table + top franchisees ── */}
        <div className="row">
          {/* recent orders */}
          <div className="card-new">
            <div className="card-h">
              <div>
                <div className="card-t">Recent orders</div>
                <div className="card-ts">Latest {displayOrders.length} · {isAdmin ? 'all tiers' : 'your orders'}</div>
              </div>
              <div className="card-link" onClick={function() { onNavigate && onNavigate('orders') }}>View all →</div>
            </div>
            {displayOrders.length === 0 ? (
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
                  {displayOrders.map(function(o, i) {
                    const name = o.franchisees?.business_name
                    const city = o.franchisees?.city
                    const tier = o.franchisees?.tier
                    return (
                      <tr key={o.id || i}>
                        <td className="mono" style={{ fontSize: 11 }}>#{String(o.id).slice(0, 8)}</td>
                        {isAdmin && (
                          <td>
                            {name ? (
                              <div className="placer-cell">
                                <div className="placer-av" style={{ background: AVATAR_COLORS[i % AVATAR_COLORS.length] }}>
                                  {initials(name)}
                                </div>
                                <div>
                                  <div className="placer-name" style={{ maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
                                  {city && <div className="placer-loc">{tier} · {city}</div>}
                                </div>
                              </div>
                            ) : '—'}
                          </td>
                        )}
                        <td><OrderBadge status={o.status} /></td>
                        <td className="muted">{fmtDate(o.created_at)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* top franchisees / my summary */}
          <div className="card-new">
            {isAdmin ? (
              <>
                <div className="card-h">
                  <div>
                    <div className="card-t">Top franchisees</div>
                    <div className="card-ts">By orders placed · all time</div>
                  </div>
                  <div className="card-link" onClick={function() { onNavigate && onNavigate('franchisees') }}>All →</div>
                </div>
                {topFranchisees.length === 0 ? (
                  <div className="empty">No data yet</div>
                ) : (
                  <div className="topf">
                    {topFranchisees.map(function(f, i) {
                      const max = topFranchisees[0].count
                      const pct = Math.round((f.count / max) * 100)
                      return (
                        <div key={f.name} className={'topf-i topf-r' + (i + 1)}>
                          <div className={'topf-rank r' + (i + 1)}>{i === 0 ? '🥇' : '#' + (i + 1)}</div>
                          <div className="topf-body">
                            <div className="topf-name">{f.name}</div>
                            <div className="topf-bar"><div className="topf-bar-fill" style={{ width: pct + '%' }}></div></div>
                            <div className="topf-meta">{f.tier || 'UF'}{f.city ? ' · ' + f.city : ''}</div>
                          </div>
                          <div className="topf-num">{f.count}</div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="card-h">
                  <div>
                    <div className="card-t">Quick actions</div>
                    <div className="card-ts">Navigate to sections</div>
                  </div>
                </div>
                <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {[
                    ['orders', '📦', 'Place New Order', 'Order kits & materials'],
                    ['students', '🎓', 'My Students', 'View & manage students'],
                    ['courses', '📚', 'My Courses', 'Browse course catalog'],
                  ].map(function(item) {
                    return (
                      <button key={item[0]} onClick={function() { onNavigate && onNavigate(item[0]) }}
                        style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px', cursor: 'pointer', textAlign: 'left', transition: 'all .15s' }}
                        onMouseEnter={function(e) { e.currentTarget.style.background = 'var(--purple-bg)'; e.currentTarget.style.borderColor = 'rgba(83,74,183,.2)' }}
                        onMouseLeave={function(e) { e.currentTarget.style.background = 'var(--bg)'; e.currentTarget.style.borderColor = 'var(--border)' }}
                      >
                        <span style={{ fontSize: 18 }}>{item[1]}</span>
                        <div>
                          <div style={{ font: '600 12px var(--font)', color: 'var(--text)' }}>{item[2]}</div>
                          <div style={{ font: '500 10px var(--mono)', color: 'var(--text3)', marginTop: 2 }}>{item[3]}</div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}
