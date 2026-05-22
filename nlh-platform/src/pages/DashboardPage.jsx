import React, { useState, useEffect, useRef } from 'react'
import { sb } from '../supabase'
import { useAuth } from '../context/AuthContext'
import { isAdminRole } from '../constants/roles'
import { fmtAmt, fmtDate, showToast } from '../utils'

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

function initials(name) {
  if (!name) return '?'
  return name.split(' ').map(function(n) { return n[0] }).join('').slice(0, 2).toUpperCase()
}

function relTime(iso) {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1)   return 'Just now'
  if (mins < 60)  return mins + ' min ago'
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)   return hrs + ' hr ago'
  const days = Math.floor(hrs / 24)
  if (days === 1) return 'Yesterday'
  return days + ' days ago'
}

const PROGRAMS_STRIP = [
  { emoji: '🧮', name: 'Abacus',          tone: 1 },
  { emoji: '💻', name: 'Coding',          tone: 2 },
  { emoji: '🔤', name: 'Phonics',         tone: 3 },
  { emoji: '🎨', name: 'Art & Craft',     tone: 4 },
  { emoji: '🎲', name: "Rubik's Cube",    tone: 5 },
  { emoji: '🎭', name: 'Public Speaking', tone: 6 },
  { emoji: '✍️', name: 'Write Well',      tone: 7 },
  { emoji: '📖', name: 'Storytelling',    tone: 8 },
]

const AVATAR_COLORS = ['#2563EB','#16A34A','#D97706','#DB2777','#7C3AED','#0284C7','#EA580C','#E11D48']

// Activity icon/bg per order status
const STATUS_ACT = {
  pending:           { em: '📦', bg: '#DBEAFE', label: 'Order',   verb: 'New order placed' },
  invoiced:          { em: '🧾', bg: '#EEEDFE', label: 'Invoice', verb: 'Invoice generated' },
  payment_submitted: { em: '💸', bg: '#DCFCE7', label: 'Payment', verb: 'Payment submitted' },
  verified:          { em: '✅', bg: '#DCFCE7', label: 'Payment', verb: 'Payment verified' },
  closed:            { em: '✅', bg: '#DCFCE7', label: 'Closed',  verb: 'Order closed' },
  part_paid:         { em: '💸', bg: '#FEF3C7', label: 'Payment', verb: 'Partial payment' },
}

// ── badge ──────────────────────────────────────────────────────────────────────

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
    <span className={'bdg ' + s.cls}>
      <span className="d"></span>{s.txt}
    </span>
  )
}

// ── confetti cross (hero corners) ──────────────────────────────────────────────

function ConfettiCross({ size = 12, color = '#1A237E', opacity = 1 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none">
      <path d="M6 1 L6 11 M1 6 L11 6" stroke={color} strokeWidth="1.8" strokeLinecap="round" opacity={opacity} />
    </svg>
  )
}

// ── SVG chart ─────────────────────────────────────────────────────────────────

function OrdersChart({ chartData }) {
  const [range, setRange] = useState('6m')
  const months = chartData?.labels || ['Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May']
  const values = chartData?.values || [0, 0, 0, 0, 0, 0]
  const total  = values.reduce(function(s, v) { return s + v }, 0)

  // percentage change vs previous half
  const half = Math.floor(values.length / 2)
  const prev = values.slice(0, half).reduce(function(s, v) { return s + v }, 0)
  const curr = values.slice(half).reduce(function(s, v) { return s + v }, 0)
  const pct  = prev > 0 ? ((curr - prev) / prev * 100).toFixed(1) : null

  const w = 640, h = 200, pad = { t: 20, r: 16, b: 28, l: 30 }
  const maxV  = Math.max(...values, 1) * 1.15
  const innerW = w - pad.l - pad.r
  const innerH = h - pad.t - pad.b
  const stepX  = innerW / Math.max(values.length - 1, 1)
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
  const areaPath = linePath
    + ' L ' + points[points.length - 1].x + ' ' + (pad.t + innerH)
    + ' L ' + points[0].x + ' ' + (pad.t + innerH) + ' Z'

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
        {pct !== null && (
          <div className="chart-delta">{Number(pct) >= 0 ? '↗' : '↘'} {pct >= 0 ? '+' : ''}{pct}%</div>
        )}
        <div className="chart-context">vs previous period</div>
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
          return <line key={i} x1={pad.l} y1={y} x2={w - pad.r} y2={y} stroke="#E2E0D8" strokeWidth="1"
            strokeDasharray={i === 4 ? '0' : '3 4'} opacity={i === 4 ? 1 : .6} />
        })}
        {[0, .5, 1].map(function(p, i) {
          const v = Math.round(maxV * p)
          const y = pad.t + innerH * (1 - p)
          return <text key={i} x={pad.l - 8} y={y + 3} textAnchor="end" fontSize="9" fontFamily="DM Mono" fill="#9C9A92">{v}</text>
        })}
        {points.length > 1 && <path d={areaPath} fill="url(#ag)" />}
        {points.length > 1 && <path d={linePath} fill="none" stroke="url(#lg)" strokeWidth="2.5" strokeLinecap="round" />}
        {points.map(function(p, i) {
          const isLast = i === points.length - 1
          return (
            <g key={i}>
              {isLast && (
                <circle cx={p.x} cy={p.y} r="10" fill="#DB2777" opacity=".18">
                  <animate attributeName="r" values="6;14;6" dur="2s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values=".3;0;.3" dur="2s" repeatCount="indefinite" />
                </circle>
              )}
              <circle cx={p.x} cy={p.y} r="5" fill="#fff"
                stroke={isLast ? '#DB2777' : '#534AB7'} strokeWidth="2.2" />
              {isLast && values[i] > 0 && (
                <text x={p.x} y={p.y - 14} textAnchor="middle" fontSize="11" fontWeight="700"
                  fontFamily="DM Sans" fill="#1A1916">{values[i]}</text>
              )}
            </g>
          )
        })}
        {points.map(function(p, i) {
          return <text key={i} x={p.x} y={h - 8} textAnchor="middle" fontSize="10"
            fontFamily="DM Mono" fill="#9C9A92">{months[i]}</text>
        })}
      </svg>
    </div>
  )
}

// ── Tier donut ─────────────────────────────────────────────────────────────────

function TierDonut({ tierBreakdown, total }) {
  const data = [
    { name: 'UF',  fullName: 'UF — Urban',         count: tierBreakdown.UF  || 0, color: '#2563EB' },
    { name: 'CF',  fullName: 'CF — City',           count: tierBreakdown.CF  || 0, color: '#16A34A' },
    { name: 'SMF', fullName: 'SMF — State Master',  count: tierBreakdown.SMF || 0, color: '#F59E0B' },
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
                <circle key={i} cx={cx} cy={cy} r={r} fill="none"
                  stroke={d.color} strokeWidth="14"
                  strokeDasharray={dash + ' ' + (C - dash)}
                  strokeDashoffset={-offset} strokeLinecap="butt" />
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
                  <span className="tier-name" style={{ flex: 'none', fontSize: 11 }}>{d.name}</span>
                  <div className="tier-bar">
                    <div className="tier-bar-fill" style={{ width: pct + '%', background: d.color }}></div>
                  </div>
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

// ── Activity feed (generated from recent orders) ───────────────────────────────

function ActivityFeed({ orders, isAdmin }) {
  const items = orders.slice(0, 6).map(function(o) {
    const act = STATUS_ACT[o.status] || STATUS_ACT.pending
    const name = o.placer?.business_name || o.placer?.city || 'Franchisee'
    return {
      em:    act.em,
      bg:    act.bg,
      label: act.label,
      title: act.verb + (isAdmin ? ' · ' + name : ''),
      ref:   o.invoice_no ? o.invoice_no : ('#' + String(o.id).slice(0, 8)),
      when:  relTime(o.created_at),
      amt:   o.grand_total ? '₹' + fmtAmt(o.grand_total) : null,
    }
  })

  if (items.length === 0) {
    return (
      <div className="card-new">
        <div className="card-h">
          <div>
            <div className="card-t" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              Latest activity <span className="live-dot" title="Live"></span>
            </div>
            <div className="card-ts">Across all centres</div>
          </div>
          <div className="card-link">Audit log →</div>
        </div>
        <div style={{ padding: '24px 18px', color: 'var(--text3)', fontSize: 12 }}>No recent activity.</div>
      </div>
    )
  }

  return (
    <div className="card-new">
      <div className="card-h">
        <div>
          <div className="card-t" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            Latest activity <span className="live-dot" title="Live"></span>
          </div>
          <div className="card-ts">Across all centres</div>
        </div>
        <div className="card-link">Audit log →</div>
      </div>
      <div className="act">
        {items.map(function(a, i) {
          return (
            <div key={i} className="act-i">
              <div className="act-em" style={{ background: a.bg }}>{a.em}</div>
              <div className="act-body">
                <div className="act-title">
                  <b>{a.ref}</b> — {a.title}{a.amt ? ' · ' + a.amt : ''}
                </div>
                <div className="act-meta">
                  <span className="am-pill">{a.label}</span>
                  {a.when}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Franchisee activity card (non-admin role) ──────────────────────────────────

function QuickActions({ onNavigate }) {
  return (
    <div className="card-new">
      <div className="card-h">
        <div>
          <div className="card-t">Quick actions</div>
          <div className="card-ts">Navigate to sections</div>
        </div>
      </div>
      <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {[
          ['orders',  '📦', 'Place New Order',  'Order kits & materials'],
          ['students','🎓', 'My Students',       'View & manage students'],
          ['courses', '📚', 'My Courses',        'Browse course catalog'],
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
    </div>
  )
}

// ── Top franchisees (full-width) ───────────────────────────────────────────────

function TopFranchiseesCard({ topFranchisees, onNavigate }) {
  if (topFranchisees.length === 0) return null
  const max = topFranchisees[0].count

  return (
    <div className="card-new">
      <div className="card-h">
        <div>
          <div className="card-t">Top franchisees</div>
          <div className="card-ts">By orders placed · all time</div>
        </div>
        <div className="card-link" onClick={function() { onNavigate && onNavigate('franchisees') }}>All centres →</div>
      </div>
      <div className="topf">
        {topFranchisees.map(function(f, i) {
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
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function DashboardPage({ onNavigate }) {
  const { currentRole, currentFranchiseeId, currentUser } = useAuth()
  const isAdmin = isAdminRole(currentRole)

  const [loading, setLoading] = useState(true)
  const [franchiseeCount, setFranchiseeCount] = useState(0)
  const [tierBreakdown, setTierBreakdown]     = useState({ SMF: 0, CF: 0, UF: 0 })
  const [studentCount, setStudentCount]       = useState(0)
  const [pendingCount, setPendingCount]       = useState(0)
  const [outstanding, setOutstanding]         = useState(0)
  const [recentOrders, setRecentOrders]       = useState([])
  const [topFranchisees, setTopFranchisees]   = useState([])
  const [chartData, setChartData]             = useState(null)

  // non-admin
  const [ownOrderCount, setOwnOrderCount]     = useState(0)
  const [ownPending, setOwnPending]           = useState(0)
  const [ownOutstanding, setOwnOutstanding]   = useState(0)
  const [ownOrders, setOwnOrders]             = useState([])

  // search & export
  const [searchQ, setSearchQ]               = useState('')
  const [searchRes, setSearchRes]           = useState(null)
  const [searchLoading, setSearchLoading]   = useState(false)
  const [showExportMenu, setShowExportMenu] = useState(false)
  const searchWrapRef = useRef(null)
  const exportRef     = useRef(null)

  useEffect(function() {
    if (currentRole === null) return
    async function load() {
      setLoading(true)
      try {
        if (isAdmin) { await loadAdminData() }
        else { if (currentFranchiseeId) await loadFranchiseeData() }
      } catch (err) { console.error('Dashboard load error:', err) }
      setLoading(false)
    }
    load()
  }, [currentRole, isAdmin, currentFranchiseeId])

  async function loadAdminData() {
    const [fr, frAll, st, orPend, orAll] = await Promise.all([
      sb.from('franchisees').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      sb.from('franchisees').select('tier').eq('status', 'active'),
      sb.from('students').select('id', { count: 'exact', head: true }),
      sb.from('orders').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      sb.from('orders').select('id, status, grand_total, amount_paid, created_at, invoice_no, placer:franchisees!orders_placer_id_fkey(business_name, city, tier)'),
    ])
    setFranchiseeCount(fr.count || 0)
    setStudentCount(st.count || 0)
    setPendingCount(orPend.count || 0)

    const tiers = { SMF: 0, CF: 0, UF: 0 }
    if (frAll.data) frAll.data.forEach(function(f) { if (tiers[f.tier] !== undefined) tiers[f.tier]++ })
    setTierBreakdown(tiers)

    const allOrders = orAll.data || []
    const totalOutstanding = allOrders
      .filter(function(o) { return o.status === 'invoiced' || o.status === 'payment_submitted' })
      .reduce(function(sum, o) { return sum + Math.max(0, (o.grand_total || 0) - (o.amount_paid || 0)) }, 0)
    setOutstanding(totalOutstanding)

    const sorted = [...allOrders]
      .sort(function(a, b) { return new Date(b.created_at) - new Date(a.created_at) })
      .slice(0, 8)
    setRecentOrders(sorted)

    const countMap = {}
    allOrders.forEach(function(o) {
      const name = o.placer?.business_name || 'Unknown'
      const city = o.placer?.city || ''
      const tier = o.placer?.tier || 'UF'
      if (!countMap[name]) countMap[name] = { count: 0, city, tier }
      countMap[name].count++
    })
    setTopFranchisees(
      Object.entries(countMap)
        .sort(function(a, b) { return b[1].count - a[1].count })
        .slice(0, 5)
        .map(function(e) { return { name: e[0], count: e[1].count, city: e[1].city, tier: e[1].tier } })
    )

    buildChartData(allOrders)
  }

  async function loadFranchiseeData() {
    const { data: ownOrds } = await sb.from('orders')
      .select('id, status, grand_total, amount_paid, created_at, invoice_no')
      .eq('placer_id', currentFranchiseeId)
    const orders = ownOrds || []
    setOwnOrderCount(orders.length)
    setOwnOrders([...orders].sort(function(a, b) { return new Date(b.created_at) - new Date(a.created_at) }).slice(0, 8))
    setOwnPending(orders.filter(function(o) { return o.status === 'pending' }).length)
    const outs = orders
      .filter(function(o) { return o.status === 'invoiced' || o.status === 'payment_submitted' })
      .reduce(function(sum, o) { return sum + Math.max(0, (o.grand_total || 0) - (o.amount_paid || 0)) }, 0)
    setOwnOutstanding(outs)
    const { count: sc } = await sb.from('students')
      .select('id', { count: 'exact', head: true })
      .eq('franchisee_id', currentFranchiseeId)
    setStudentCount(sc || 0)
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

  // ── global search (debounced) ──────────────────────────────────────────────────
  useEffect(function() {
    if (!searchQ.trim() || searchQ.trim().length < 2) { setSearchRes(null); return }
    const q    = searchQ.trim()
    const like = '%' + q + '%'
    setSearchLoading(true)
    const timer = setTimeout(async function() {
      const [fr, st, or_, ins] = await Promise.all([
        sb.from('franchisees').select('id,business_name,owner_name,city,tier').or('business_name.ilike.' + like + ',owner_name.ilike.' + like + ',city.ilike.' + like).limit(4),
        sb.from('students').select('id,full_name,parent_name,phone').or('full_name.ilike.' + like + ',parent_name.ilike.' + like + ',phone.ilike.' + like).limit(4),
        sb.from('orders').select('id,invoice_no,status,grand_total').ilike('invoice_no', like).limit(4),
        sb.from('instructors').select('id,full_name,phone').or('full_name.ilike.' + like + ',phone.ilike.' + like).limit(4),
      ])
      setSearchRes({
        franchisees: fr.data  || [],
        students:    st.data  || [],
        orders:      or_.data || [],
        instructors: ins.data || [],
      })
      setSearchLoading(false)
    }, 300)
    return function() { clearTimeout(timer) }
  }, [searchQ])

  // ── click-outside closes search & export menus ──────────────────────────────
  useEffect(function() {
    function handle(e) {
      if (searchWrapRef.current && !searchWrapRef.current.contains(e.target)) {
        setSearchRes(null); setSearchQ('')
      }
      if (exportRef.current && !exportRef.current.contains(e.target)) {
        setShowExportMenu(false)
      }
    }
    document.addEventListener('mousedown', handle)
    return function() { document.removeEventListener('mousedown', handle) }
  }, [])

  // ── CSV export ───────────────────────────────────────────────────────────────
  async function exportCSV(type) {
    setShowExportMenu(false)
    showToast('Preparing export…')
    const date = new Date().toISOString().slice(0, 10)

    function esc(v) {
      if (v == null || v === '') return ''
      const s = String(v)
      return (s.includes(',') || s.includes('"') || s.includes('\n'))
        ? '"' + s.replace(/"/g, '""') + '"'
        : s
    }

    try {
      let headers = [], rows = [], filename = ''

      if (type === 'franchisees') {
        const { data } = await sb.from('franchisees')
          .select('business_name,owner_name,tier,email,phone,city,state,country,status,enrollment_fee,fee_paid')
          .order('tier').order('city').order('business_name')
        headers  = ['Business Name','Owner Name','Tier','Email','Phone','City','State','Country','Status','Enrollment Fee','Fee Paid']
        rows     = (data || []).map(function(r) {
          return [r.business_name, r.owner_name, r.tier, r.email, r.phone, r.city, r.state, r.country, r.status, r.enrollment_fee || 0, r.fee_paid || 0]
        })
        filename = 'nlh-franchisees-' + date + '.csv'

      } else if (type === 'students') {
        const { data } = await sb.from('students')
          .select('full_name,parent_name,phone,email,city,state,payment_status,fee_total,fee_paid,franchisee:franchisees(business_name,city)')
          .order('full_name')
        headers  = ['Student Name','Parent Name','Phone','Email','City','State','Centre','Centre City','Fee Total','Fee Paid','Payment Status']
        rows     = (data || []).map(function(r) {
          return [r.full_name, r.parent_name, r.phone, r.email, r.city, r.state, r.franchisee?.business_name, r.franchisee?.city, r.fee_total || 0, r.fee_paid || 0, r.payment_status]
        })
        filename = 'nlh-students-' + date + '.csv'

      } else if (type === 'orders') {
        const { data } = await sb.from('orders')
          .select('invoice_no,id,status,grand_total,amount_paid,created_at,placer:franchisees!orders_placer_id_fkey(business_name,city,tier)')
          .order('created_at', { ascending: false })
        headers  = ['Invoice / Ref','Franchisee','City','Tier','Status','Total (₹)','Paid (₹)','Balance (₹)','Date']
        rows     = (data || []).map(function(r) {
          const bal = Math.max(0, (r.grand_total || 0) - (r.amount_paid || 0))
          return [r.invoice_no || ('#' + String(r.id).slice(0, 8)), r.placer?.business_name, r.placer?.city, r.placer?.tier, r.status, r.grand_total || 0, r.amount_paid || 0, bal, r.created_at ? r.created_at.slice(0, 10) : '']
        })
        filename = 'nlh-orders-' + date + '.csv'

      } else if (type === 'instructors') {
        const { data } = await sb.from('instructors')
          .select('full_name,phone,email,status,franchisee:franchisees(business_name,city)')
          .order('full_name')
        headers  = ['Name','Phone','Email','Status','Centre','City']
        rows     = (data || []).map(function(r) {
          return [r.full_name, r.phone, r.email, r.status, r.franchisee?.business_name, r.franchisee?.city]
        })
        filename = 'nlh-instructors-' + date + '.csv'
      }

      const csv  = headers.join(',') + '\n' + rows.map(function(r) { return r.map(esc).join(',') }).join('\n')
      const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      showToast(rows.length + ' records exported ✓')
    } catch (err) {
      showToast('Export failed: ' + err.message, 'err')
    }
  }

  // ── derived values ──
  const userName    = currentUser?.user_metadata?.full_name || currentUser?.email?.split('@')[0] || 'Admin'
  const firstName   = userName.split(' ')[0]
  const dateStr     = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  const displayOrders = isAdmin ? recentOrders : ownOrders

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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>

      {/* ── sticky topbar ── */}
      <div className="tb">
        <div className="crumb">Operations <span className="sep">›</span> <b>Dashboard</b></div>
        <div className="tb-r">

          {/* ── global search ── */}
          <div ref={searchWrapRef} style={{ position: 'relative' }}>
            <input
              className="tb-search"
              placeholder="Search franchisees, students, orders…"
              value={searchQ}
              onChange={function(e) { setSearchQ(e.target.value) }}
              onFocus={function() { if (searchQ.length >= 2 && searchRes) setSearchRes(searchRes) }}
            />
            {/* dropdown */}
            {(searchRes !== null || searchLoading) && searchQ.length >= 2 && (
              <div style={{
                position: 'absolute', top: 'calc(100% + 6px)', right: 0,
                width: 340, background: 'var(--bg2)',
                border: '1px solid var(--border)', borderRadius: 12,
                boxShadow: '0 8px 32px rgba(0,0,0,.14)', zIndex: 1000, overflow: 'hidden',
              }}>
                {searchLoading ? (
                  <div style={{ padding: '14px 16px', color: 'var(--text3)', fontSize: 12 }}>Searching…</div>
                ) : (function() {
                  const SECS = [
                    { key: 'franchisees', icon: '🏢', label: 'Franchisees', page: 'franchisees',
                      render: function(f) { return (f.business_name || '?') + (f.city ? ' · ' + f.city : '') + ' [' + f.tier + ']' } },
                    { key: 'students', icon: '🎓', label: 'Students', page: 'students',
                      render: function(s) { return (s.full_name || '?') + (s.parent_name ? ' — ' + s.parent_name : '') } },
                    { key: 'orders', icon: '📦', label: 'Orders', page: 'orders',
                      render: function(o) { return (o.invoice_no || '#' + String(o.id).slice(0, 8)) + ' · ' + o.status } },
                    { key: 'instructors', icon: '👩‍🏫', label: 'Instructors', page: 'instructors',
                      render: function(i) { return (i.full_name || '?') + (i.phone ? ' · ' + i.phone : '') } },
                  ]
                  const hasAny = SECS.some(function(s) { return (searchRes[s.key] || []).length > 0 })
                  if (!hasAny) return (
                    <div style={{ padding: '14px 16px', color: 'var(--text3)', fontSize: 12 }}>
                      No results for "{searchQ}"
                    </div>
                  )
                  return (
                    <div style={{ maxHeight: 380, overflowY: 'auto' }}>
                      {SECS.map(function(sec) {
                        const items = (searchRes || {})[sec.key] || []
                        if (!items.length) return null
                        return (
                          <div key={sec.key}>
                            <div style={{ padding: '8px 14px 3px', fontSize: 10, fontWeight: 700, color: 'var(--text3)', letterSpacing: '.07em', textTransform: 'uppercase', fontFamily: 'var(--mono)' }}>
                              {sec.icon} {sec.label}
                            </div>
                            {items.map(function(item) {
                              return (
                                <div key={item.id}
                                  onClick={function() { setSearchQ(''); setSearchRes(null); onNavigate && onNavigate(sec.page) }}
                                  style={{ padding: '8px 14px', cursor: 'pointer', fontSize: 12, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8, transition: 'background .1s' }}
                                  onMouseEnter={function(e) { e.currentTarget.style.background = 'var(--purple-bg)' }}
                                  onMouseLeave={function(e) { e.currentTarget.style.background = 'none' }}
                                >
                                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--purple)', flexShrink: 0 }} />
                                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sec.render(item)}</span>
                                  <span style={{ fontSize: 10, color: 'var(--text3)', flexShrink: 0 }}>→</span>
                                </div>
                              )
                            })}
                          </div>
                        )
                      })}
                    </div>
                  )
                })()}
              </div>
            )}
          </div>

          {/* ── export dropdown ── */}
          <div ref={exportRef} style={{ position: 'relative' }}>
            <button className="btn" onClick={function() { setShowExportMenu(function(o) { return !o }) }}>
              ↓ Export
            </button>
            {showExportMenu && (
              <div style={{
                position: 'absolute', top: 'calc(100% + 6px)', right: 0,
                width: 210, background: 'var(--bg2)',
                border: '1px solid var(--border)', borderRadius: 12,
                boxShadow: '0 8px 32px rgba(0,0,0,.14)', zIndex: 1000,
                padding: 6,
              }}>
                {[
                  { type: 'franchisees', icon: '🏢', label: 'Franchisee list' },
                  { type: 'students',    icon: '🎓', label: 'Student list' },
                  { type: 'orders',      icon: '📦', label: 'Order list' },
                  { type: 'instructors', icon: '👩‍🏫', label: 'Instructor list' },
                ].map(function(item) {
                  return (
                    <button key={item.type}
                      onClick={function() { exportCSV(item.type) }}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '9px 12px', background: 'none', border: 'none', borderRadius: 8, cursor: 'pointer', font: '500 12px var(--font)', color: 'var(--text)', textAlign: 'left' }}
                      onMouseEnter={function(e) { e.currentTarget.style.background = 'var(--purple-bg)' }}
                      onMouseLeave={function(e) { e.currentTarget.style.background = 'none' }}
                    >
                      <span style={{ fontSize: 14 }}>{item.icon}</span>
                      <span style={{ flex: 1 }}>{item.label}</span>
                      <span style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--mono)' }}>CSV</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          <button className="btn-p" onClick={function() { onNavigate && onNavigate('orders') }}>+ New order</button>
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
                ? <><b>16 programs</b> running, <b>{franchiseeCount}</b> franchisees active, and <b>{studentCount.toLocaleString('en-IN')}</b> students enrolled.</>
                : <>Your centre is active and growing.</>
              }
            </p>
            <div className="hero-chips">
              {isAdmin ? (
                <>
                  <span className="hero-chip"><span className="em">🎓</span><b>{studentCount.toLocaleString('en-IN')}</b>&nbsp;students</span>
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

          {/* hero right — mascot + sparkles + confetti */}
          <div className="hero-r" aria-hidden="true">
            {/* confetti crosses in corners */}
            <div className="hero-confetti c1"><ConfettiCross color="#1A237E" /></div>
            <div className="hero-confetti c2"><ConfettiCross color="#D97706" size={10} /></div>
            <div className="hero-confetti c3"><ConfettiCross color="#1A237E" size={9} /></div>
            <div className="hero-confetti c4"><ConfettiCross color="#DB2777" /></div>
            {/* sparkle stars */}
            <svg className="spk spk-1" width="18" height="18" viewBox="0 0 18 18">
              <path d="M9 0 L10.5 7.5 L18 9 L10.5 10.5 L9 18 L7.5 10.5 L0 9 L7.5 7.5 Z" fill="#fff" opacity=".9" />
            </svg>
            <svg className="spk spk-2" width="14" height="14" viewBox="0 0 18 18">
              <path d="M9 0 L10.5 7.5 L18 9 L10.5 10.5 L9 18 L7.5 10.5 L0 9 L7.5 7.5 Z" fill="#FBBF24" />
            </svg>
            <svg className="spk spk-3" width="12" height="12" viewBox="0 0 18 18">
              <path d="M9 0 L10.5 7.5 L18 9 L10.5 10.5 L9 18 L7.5 10.5 L0 9 L7.5 7.5 Z" fill="#fff" opacity=".8" />
            </svg>
            <svg className="spk spk-4" width="16" height="16" viewBox="0 0 18 18">
              <path d="M9 0 L10.5 7.5 L18 9 L10.5 10.5 L9 18 L7.5 10.5 L0 9 L7.5 7.5 Z" fill="#fff" />
            </svg>
            {/* NLH mascot */}
            <div className="mascot-wrap">
              <img src="/NLH%20Mascot.png" alt="" className="mascot-img" />
            </div>
          </div>
        </div>

        {/* ── KPI cards ── */}
        <div className="kpi">
          {isAdmin ? (
            <>
              <div className="kc kc-1" style={{ cursor: 'pointer' }} onClick={function() { onNavigate && onNavigate('franchisees') }}>
                <div className="kc-top"><div className="kc-ic">🏢</div><div className="kc-arr">↗</div></div>
                <div className="kc-num">{franchiseeCount}</div>
                <div className="kc-lbl">Active franchisees</div>
                <div className="kc-sub">
                  <span className="delta">SMF {tierBreakdown.SMF}</span>
                  CF {tierBreakdown.CF} · UF {tierBreakdown.UF}
                </div>
              </div>
              <div className="kc kc-2" style={{ cursor: 'pointer' }} onClick={function() { onNavigate && onNavigate('students') }}>
                <div className="kc-top"><div className="kc-ic">🎓</div><div className="kc-arr">↗</div></div>
                <div className="kc-num">{studentCount.toLocaleString('en-IN')}</div>
                <div className="kc-lbl">Total students</div>
                <div className="kc-sub"><span className="delta">all centres</span>across network</div>
              </div>
              <div className="kc kc-3" style={{ cursor: 'pointer' }} onClick={function() { onNavigate && onNavigate('orders') }}>
                <div className="kc-top"><div className="kc-ic">📦</div><div className="kc-arr">↗</div></div>
                <div className="kc-num">{pendingCount}</div>
                <div className="kc-lbl">Pending orders</div>
                <div className="kc-sub"><span className="delta">awaiting</span>invoice</div>
              </div>
              <div className="kc kc-4" style={{ cursor: 'pointer' }} onClick={function() { onNavigate && onNavigate('orders') }}>
                <div className="kc-top"><div className="kc-ic">💰</div><div className="kc-arr">↗</div></div>
                <div className="kc-num">{'₹' + fmtAmt(outstanding)}</div>
                <div className="kc-lbl">Outstanding</div>
                <div className="kc-sub"><span className="delta">unpaid</span>invoiced orders</div>
              </div>
            </>
          ) : (
            <>
              <div className="kc kc-1" style={{ cursor: 'pointer' }} onClick={function() { onNavigate && onNavigate('orders') }}>
                <div className="kc-top"><div className="kc-ic">📦</div><div className="kc-arr">↗</div></div>
                <div className="kc-num">{ownOrderCount}</div>
                <div className="kc-lbl">Total orders</div>
                <div className="kc-sub"><span className="delta">all time</span>placed</div>
              </div>
              <div className="kc kc-2" style={{ cursor: 'pointer' }} onClick={function() { onNavigate && onNavigate('students') }}>
                <div className="kc-top"><div className="kc-ic">🎓</div><div className="kc-arr">↗</div></div>
                <div className="kc-num">{studentCount}</div>
                <div className="kc-lbl">My students</div>
                <div className="kc-sub"><span className="delta">active</span>enrollments</div>
              </div>
              <div className="kc kc-3" style={{ cursor: 'pointer' }} onClick={function() { onNavigate && onNavigate('orders') }}>
                <div className="kc-top"><div className="kc-ic">⏳</div><div className="kc-arr">↗</div></div>
                <div className="kc-num">{ownPending}</div>
                <div className="kc-lbl">Pending orders</div>
                <div className="kc-sub"><span className="delta">awaiting</span>invoice</div>
              </div>
              <div className="kc kc-4" style={{ cursor: 'pointer' }} onClick={function() { onNavigate && onNavigate('orders') }}>
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
              <div className="pc-sub">8 of 16 skill-based programs · ranked by enrollment</div>
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
                  { status: 'pending',           label: 'Pending',       color: '#F59E0B' },
                  { status: 'invoiced',          label: 'Invoiced',      color: '#1A5FA8' },
                  { status: 'payment_submitted', label: 'Pmt Submitted', color: '#534AB7' },
                  { status: 'closed',            label: 'Closed',        color: '#16A34A' },
                ].map(function(row) {
                  const cnt = ownOrders.filter(function(o) { return o.status === row.status }).length
                  return (
                    <div key={row.status} className="tier-row">
                      <span className="tier-swatch" style={{ background: row.color }}></span>
                      <span className="tier-name" style={{ fontSize: 11 }}>{row.label}</span>
                      <div className="tier-bar">
                        <div className="tier-bar-fill" style={{ width: (cnt / Math.max(ownOrderCount, 1)) * 100 + '%', background: row.color }}></div>
                      </div>
                      <span className="tier-cnt">{cnt}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* ── orders table + activity feed ── */}
        <div className="row">

          {/* recent orders table */}
          <div className="card-new">
            <div className="card-h">
              <div>
                <div className="card-t">Recent orders</div>
                <div className="card-ts">Latest {displayOrders.length} · {isAdmin ? 'all tiers' : 'your orders'}</div>
              </div>
              <div className="card-link" onClick={function() { onNavigate && onNavigate('orders') }}>View all →</div>
            </div>
            {displayOrders.length === 0 ? (
              <div style={{ padding: '24px 18px', color: 'var(--text3)', fontSize: 12 }}>No orders yet.</div>
            ) : (
              <div className="tbl-scroll"><table className="tbl">
                <thead>
                  <tr>
                    <th>Order</th>
                    {isAdmin && <th>Franchisee</th>}
                    {isAdmin && <th>Tier</th>}
                    <th>Status</th>
                    <th>Date</th>
                    <th style={{ textAlign: 'right' }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {displayOrders.map(function(o, i) {
                    const name = o.placer?.business_name
                    const city = o.placer?.city
                    const tier = o.placer?.tier
                    return (
                      <tr key={o.id || i}>
                        <td className="mono" style={{ fontSize: 11 }}>
                          {o.invoice_no || ('#' + String(o.id).slice(0, 8))}
                        </td>
                        {isAdmin && (
                          <td>
                            {name ? (
                              <div className="placer-cell">
                                <div className="placer-av" style={{ background: AVATAR_COLORS[i % AVATAR_COLORS.length] }}>
                                  {initials(name)}
                                </div>
                                <div>
                                  <div className="placer-name" style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
                                  {city && <div className="placer-loc">{city}</div>}
                                </div>
                              </div>
                            ) : '—'}
                          </td>
                        )}
                        {isAdmin && (
                          <td>
                            {tier ? (
                              <span className={'tier t-' + tier.toLowerCase()}>{tier}</span>
                            ) : '—'}
                          </td>
                        )}
                        <td><OrderBadge status={o.status} /></td>
                        <td className="mono" style={{ color: 'var(--text3)', fontSize: 11 }}>{fmtDate(o.created_at)}</td>
                        <td style={{ textAlign: 'right' }}>
                          <div className="amt">{o.grand_total ? '₹' + fmtAmt(o.grand_total) : '—'}</div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table></div>
            )}
          </div>

          {/* activity feed (admin) / quick actions (franchisee) */}
          {isAdmin
            ? <ActivityFeed orders={displayOrders} isAdmin={isAdmin} />
            : <QuickActions onNavigate={onNavigate} />
          }
        </div>

        {/* ── top franchisees (full-width, admin only) ── */}
        {isAdmin && topFranchisees.length > 0 && (
          <TopFranchiseesCard topFranchisees={topFranchisees} onNavigate={onNavigate} />
        )}

      </div>
    </div>
  )
}
