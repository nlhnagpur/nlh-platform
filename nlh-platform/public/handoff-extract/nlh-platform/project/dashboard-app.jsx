// ─────────────────────────────────────────────────────────────────────
// NLH Vibrant Dashboard — admin view
// Built around the actual DashboardPage.jsx in the codebase, but
// re-skinned with landing-page warmth and a rainbow programs strip.
// ─────────────────────────────────────────────────────────────────────

const { useState, useEffect, useMemo } = React;
// Other-tab page components live in pages-a.jsx / pages-b.jsx (loaded first
// in the HTML) and reach this file via window.
const {
  FranchiseesPage, OrdersPage, InvoicesPage,
  StudentsPage, PricesPage, ProgramsPage,
  PageTopbar,
} = window;

// ── Mock data shaped to mirror the live Supabase tables ──────────────
const ADMIN = {
  name: 'Dhiral Panchmatia',
  initials: 'DP',
  role: 'NLH Admin',
  today: new Date('2026-05-15'),
};

const KPIS = {
  franchisees: { num: 142, delta: '+4 this month', sub: 'SMF 6 · CF 22 · UF 114', icon: '🏢' },
  students:    { num: '1,284', delta: '+118 this month', sub: 'Across all centres', icon: '🎓' },
  pending:     { num: 24, delta: '6 awaiting dispatch', sub: 'Awaiting invoice', icon: '📦' },
  outstanding: { num: '₹4.2L', delta: '−₹84k vs Apr', sub: 'Invoiced · unpaid', icon: '💰' },
};

const PROGRAMS = [
  { id: 'abc', emoji: '🧮', name: 'Abacus',         students: 312, kits: 9,  tone: 1 },
  { id: 'cod', emoji: '💻', name: 'Coding',         students: 248, kits: 6,  tone: 2 },
  { id: 'pho', emoji: '🔤', name: 'Phonics',        students: 196, kits: 4,  tone: 3 },
  { id: 'art', emoji: '🎨', name: 'Art & Craft',    students: 174, kits: 5,  tone: 4 },
  { id: 'rub', emoji: '🎲', name: "Rubik's Cube",   students: 142, kits: 3,  tone: 5 },
  { id: 'spk', emoji: '🎭', name: 'Public Speaking',students: 108, kits: 3,  tone: 6 },
  { id: 'wri', emoji: '✍️', name: 'Write Well',     students:  84, kits: 4,  tone: 7 },
  { id: 'sto', emoji: '📖', name: 'Storytelling',   students:  60, kits: 2,  tone: 8 },
];

const ORDERS = [
  { ref: 'ORD-2026-0418', name: 'Anjali Sharma',   city: 'Pune',     tier: 'UF',  status: 'pending',  amt: '18,450',   placed: '12 min ago', av: '#2563EB' },
  { ref: 'ORD-2026-0417', name: 'Rohit Deshmukh',  city: 'Mumbai',   tier: 'CF',  status: 'invoiced', amt: '62,000',   placed: '1 hr ago',   av: '#16A34A' },
  { ref: 'ORD-2026-0416', name: 'Pooja Kulkarni',  city: 'Aurangabad', tier:'SMF', status: 'paid',     amt: '1,24,000', placed: '3 hr ago',   av: '#D97706' },
  { ref: 'ORD-2026-0415', name: 'Salim Ansari',    city: 'Nashik',   tier: 'UF',  status: 'overdue',  amt: '8,200',    placed: 'Yesterday',  av: '#DB2777' },
  { ref: 'ORD-2026-0414', name: 'Meera Iyer',      city: 'Bengaluru',tier: 'CF',  status: 'paid',     amt: '42,300',   placed: 'Yesterday',  av: '#7C3AED' },
  { ref: 'ORD-2026-0413', name: 'Vikrant Joshi',   city: 'Indore',   tier: 'UF',  status: 'pmt',      amt: '14,750',   placed: '2 days ago', av: '#0284C7' },
];

const STATUS_LABEL = {
  paid:    { txt: 'paid',         cls: 'bdg-paid' },
  pending: { txt: 'pending',      cls: 'bdg-pend' },
  invoiced:{ txt: 'invoiced',     cls: 'bdg-inv'  },
  overdue: { txt: 'overdue',      cls: 'bdg-over' },
  pmt:     { txt: 'pmt submitted',cls: 'bdg-pmt'  },
};

const ACTIVITY = [
  { em: '💸', bg: '#DCFCE7', title: ['', <b key="a">Pooja Kulkarni</b>, ' paid invoice ', <b key="b">INV-0416</b>, ' · ₹1,24,000'], meta: ['Payment', '12 min ago'] },
  { em: '🏷️', bg: '#EEEDFE', title: ['You updated kit price ', <b key="a">ABC-L3-KIT</b>, ' · ₹1,850 → ₹2,100'], meta: ['Pricing', '1 hr ago'] },
  { em: '🤝', bg: '#FEF3C7', title: ['New franchisee request from ', <b key="a">Aarav Mehta</b>, ' · Pune'], meta: ['Onboarding', '3 hr ago'] },
  { em: '📦', bg: '#DBEAFE', title: [<b key="a">ORD-2026-0417</b>, ' invoiced · ready for dispatch'], meta: ['Order', 'Yesterday'] },
  { em: '🎓', bg: '#FCE7F3', title: ['8 students enrolled at ', <b key="a">NLH Sadar (Nagpur)</b>], meta: ['Enrollment', 'Yesterday'] },
  { em: '⚠️', bg: '#FCEAEA', title: [<b key="a">ORD-2026-0415</b>, ' marked overdue · 30 days past due'], meta: ['Collections', '2 days ago'] },
];

const TOP_FRANCHISEES = [
  { name: 'NLH Sadar (Nagpur)',     city: 'Nagpur',     orders: 42, tier: 'SMF' },
  { name: 'Bright Minds Pune',      city: 'Pune',       orders: 38, tier: 'CF' },
  { name: 'Brain Boosters Mumbai',  city: 'Mumbai',     orders: 31, tier: 'CF' },
  { name: 'Little Genius Aurangabad', city: 'Aurangabad', orders: 24, tier: 'UF' },
  { name: 'Skillsphere Nashik',     city: 'Nashik',     orders: 19, tier: 'UF' },
];

// ── chart data (orders per month, last 6 months) ────────────────────
const CHART_MONTHS = ['Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May'];
const CHART_VALUES = [38, 52, 47, 71, 84, 92];

// ── small SVG helpers ───────────────────────────────────────────────
function Confetti({ size = 12, color = '#1A237E' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none">
      <path d="M6 1 L6 11 M1 6 L11 6" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function Sparkle({ x, y, size = 12, color = '#fff', delay = 0 }) {
  return (
    <g style={{ animation: `lp-twinkle 2s ease-in-out ${delay}s infinite alternate`, transformOrigin: `${x}px ${y}px` }}>
      <path d={`M${x} ${y - size/2} L${x + 2} ${y - 2} L${x + size/2} ${y} L${x + 2} ${y + 2} L${x} ${y + size/2} L${x - 2} ${y + 2} L${x - size/2} ${y} L${x - 2} ${y - 2} Z`}
        fill={color} opacity=".95" />
    </g>
  );
}

// ── NLH mascot (real character art) ──────────────────────────────────
function NlhMascot() {
  return (
    <div className="mascot-wrap" aria-hidden="true">
      <svg className="spk spk-1" width="18" height="18" viewBox="0 0 18 18">
        <path d="M9 0 L10.5 7.5 L18 9 L10.5 10.5 L9 18 L7.5 10.5 L0 9 L7.5 7.5 Z" fill="#fff" />
      </svg>
      <svg className="spk spk-2" width="14" height="14" viewBox="0 0 18 18">
        <path d="M9 0 L10.5 7.5 L18 9 L10.5 10.5 L9 18 L7.5 10.5 L0 9 L7.5 7.5 Z" fill="#FBBF24" />
      </svg>
      <svg className="spk spk-3" width="12" height="12" viewBox="0 0 18 18">
        <path d="M9 0 L10.5 7.5 L18 9 L10.5 10.5 L9 18 L7.5 10.5 L0 9 L7.5 7.5 Z" fill="#fff" />
      </svg>
      <svg className="spk spk-4" width="16" height="16" viewBox="0 0 18 18">
        <path d="M9 0 L10.5 7.5 L18 9 L10.5 10.5 L9 18 L7.5 10.5 L0 9 L7.5 7.5 Z" fill="#fff" />
      </svg>
      <img src="assets/nlh-mascot.png" alt="" className="mascot-img" />
    </div>
  );
}

// ── sidebar ──────────────────────────────────────────────────────────
function Sidebar({ active, onNav }) {
  const ops = [
    { id: 'dashboard', l: 'Dashboard',   ic: '📊' },
    { id: 'franchisees', l: 'Franchisees', ic: '🏢' },
    { id: 'orders', l: 'Orders',         ic: '📦', bdg: 3 },
    { id: 'students', l: 'Students',     ic: '🎓' },
    { id: 'invoices', l: 'Invoices',     ic: '🧾' },
  ];
  const cat = [
    { id: 'kits', l: 'Kit prices',       ic: '🏷️' },
    { id: 'programs', l: 'Programs',     ic: '🎯' },
  ];
  const set = [
    { id: 'team', l: 'Team & access',    ic: '🔑' },
    { id: 'audit', l: 'Audit log',       ic: '📜' },
  ];
  function NavItem({ item }) {
    return (
      <div className={'nav ' + (active === item.id ? 'on' : '')} onClick={() => onNav(item.id)}>
        <span className="nav-ic">{item.ic}</span>
        <span>{item.l}</span>
        {item.bdg ? <span className="nav-bdg">{item.bdg}</span> : null}
      </div>
    );
  }
  return (
    <aside className="sb">
      <div className="sb-top">
        <div className="sb-logo"><img src="assets/logo-mini.jpg" alt="NLH" /></div>
        <div className="sb-brand">
          <div className="sb-name">NLH Platform</div>
          <div className="sb-trust">Est. 2008 &middot; <b>ISO 9001:2015</b></div>
        </div>
        <span className="sb-env">Admin</span>
      </div>
      <nav className="sb-nav">
        <div className="sect">Operations</div>
        {ops.map(it => <NavItem key={it.id} item={it} />)}
        <div className="sect">Catalog</div>
        {cat.map(it => <NavItem key={it.id} item={it} />)}
        <div className="sect">Settings</div>
        {set.map(it => <NavItem key={it.id} item={it} />)}
      </nav>
      <div className="sb-watermark">
        <div className="sb-wm-ic">☀️</div>
        <div className="sb-wm-text">Enriching <b>children's future</b><br/>since 2008</div>
      </div>
      <div className="sb-foot">
        <div className="av">{ADMIN.initials}</div>
        <div>
          <div className="av-name">{ADMIN.name}</div>
          <div className="av-role">{ADMIN.role}</div>
        </div>
      </div>
    </aside>
  );
}

// ── topbar ───────────────────────────────────────────────────────────
function Topbar() {
  return (
    <header className="tb">
      <div className="crumb">Operations <span className="sep">›</span> <b>Dashboard</b></div>
      <div className="tb-r">
        <input className="search" placeholder="Search orders, franchisees, students…" />
        <button className="btn btn-s">Export</button>
        <button className="btn btn-p">+ New order</button>
      </div>
    </header>
  );
}

// ── hero greeting strip ──────────────────────────────────────────────
function HeroGreeting({ showSun }) {
  const dateStr = ADMIN.today.toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
  return (
    <div className="hero">
      <div className="hero-l">
        <div className="hero-eyebrow"><span className="dot"></span>Live · {dateStr}</div>
        <h1 className="hero-title">Good morning, Dhiral!</h1>
        <p className="hero-sub">
          Here is what is happening across your network today. <b>16 programs</b> running, <b>142 franchisees</b> active, and <b>6 new students</b> enrolled in the last hour.
        </p>
        <div className="hero-chips">
          <span className="hero-chip"><span className="em">🎓</span><b>+118</b>&nbsp;students this month</span>
          <span className="hero-chip"><span className="em">📦</span><b>24</b>&nbsp;orders awaiting dispatch</span>
          <span className="hero-chip"><span className="em">🤝</span><b>3</b>&nbsp;franchisee requests</span>
        </div>
      </div>
      {showSun && (
        <div className="hero-r" aria-hidden="true">
          {/* twinkling stars */}
          <div className="hero-confetti c1"><Confetti color="#1A237E" /></div>
          <div className="hero-confetti c2"><Confetti color="#D97706" size={10} /></div>
          <div className="hero-confetti c3"><Confetti color="#1A237E" size={9} /></div>
          <div className="hero-confetti c4"><Confetti color="#DB2777" /></div>
          {/* sun mascot */}
          <svg viewBox="0 0 200 140" width="200" height="140" style={{ position: 'absolute' }}>
            {/* sun rays */}
            {[...Array(12)].map((_, i) => {
              const angle = (i / 12) * Math.PI * 2;
              const cx = 100, cy = 70;
              const r1 = 60, r2 = 72;
              const x1 = cx + Math.cos(angle) * r1;
              const y1 = cy + Math.sin(angle) * r1;
              const x2 = cx + Math.cos(angle) * r2;
              const y2 = cy + Math.sin(angle) * r2;
              return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#EA580C" strokeWidth="3" strokeLinecap="round" opacity=".9" />;
            })}
            {/* sun body */}
            <defs>
              <radialGradient id="sg" cx="35%" cy="35%">
                <stop offset="0%" stopColor="#FFF9D6" />
                <stop offset="40%" stopColor="#FFD234" />
                <stop offset="100%" stopColor="#F59E0B" />
              </radialGradient>
            </defs>
            <circle cx="100" cy="70" r="48" fill="url(#sg)" />
            {/* smile */}
            <circle cx="86" cy="62" r="4" fill="#1A237E" />
            <circle cx="114" cy="62" r="4" fill="#1A237E" />
            <path d="M82 80 Q100 96 118 80" stroke="#1A237E" strokeWidth="3.5" strokeLinecap="round" fill="none" />
            {/* cheek blush */}
            <circle cx="78" cy="76" r="4" fill="#F472B6" opacity=".6" />
            <circle cx="122" cy="76" r="4" fill="#F472B6" opacity=".6" />
            {/* sparkles */}
            <Sparkle x={30} y={28} size={11} color="#fff" delay={0} />
            <Sparkle x={172} y={32} size={9} color="#fff" delay={.4} />
            <Sparkle x={22} y={106} size={7} color="#fff" delay={.8} />
            <Sparkle x={178} y={108} size={10} color="#fff" delay={1.2} />
          </svg>
        </div>
      )}
    </div>
  );
}

// ── KPI cards ────────────────────────────────────────────────────────
function KpiGrid({ palette }) {
  const cards = [
    { k: KPIS.franchisees, cls: 'kc-1', label: 'Active franchisees', page: 'franchisees' },
    { k: KPIS.students,    cls: 'kc-2', label: 'Total students',     page: 'students' },
    { k: KPIS.pending,     cls: 'kc-3', label: 'Pending orders',     page: 'orders' },
    { k: KPIS.outstanding, cls: 'kc-4', label: 'Outstanding',        page: 'orders' },
  ];
  return (
    <div className="kpi">
      {cards.map(c => (
        <div key={c.label} className={'kc ' + c.cls}>
          <div className="kc-top">
            <div className="kc-ic">{c.k.icon}</div>
            <div className="kc-arr">↗</div>
          </div>
          <div className="kc-num">{c.k.num}</div>
          <div className="kc-lbl">{c.label}</div>
          <div className="kc-sub"><span className="delta">{c.k.delta.split(' ')[0]}</span>{c.k.delta.split(' ').slice(1).join(' ')}</div>
        </div>
      ))}
    </div>
  );
}

// ── programs strip ───────────────────────────────────────────────────
function ProgramsStrip() {
  return (
    <div className="programs-card">
      <div className="pc-head">
        <div>
          <div className="pc-title">Programs at a glance</div>
          <div className="pc-sub">8 of 16 skill-based programs · ranked by enrollment</div>
        </div>
        <div className="pc-link">View all 16 →</div>
      </div>
      <div className="programs">
        {PROGRAMS.map(p => (
          <div key={p.id} className="prog">
            <div className={'prog-em pe-' + p.tone}>{p.emoji}</div>
            <div className="prog-name">{p.name}</div>
            <div className="prog-count"><b>{p.students}</b> &middot; {p.kits} kits</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── orders chart card ────────────────────────────────────────────────
function OrdersChart() {
  const [range, setRange] = useState('6m');
  const w = 640, h = 200, pad = { t: 20, r: 16, b: 28, l: 30 };
  const max = Math.max(...CHART_VALUES) * 1.15;
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;
  const stepX = innerW / (CHART_VALUES.length - 1);
  const points = CHART_VALUES.map((v, i) => ({
    x: pad.l + i * stepX,
    y: pad.t + innerH - (v / max) * innerH,
  }));
  // smooth path
  function smoothPath(pts) {
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i];
      const p1 = pts[i + 1];
      const cx = (p0.x + p1.x) / 2;
      d += ` C ${cx} ${p0.y}, ${cx} ${p1.y}, ${p1.x} ${p1.y}`;
    }
    return d;
  }
  const linePath = smoothPath(points);
  const areaPath = linePath + ` L ${points[points.length-1].x} ${pad.t + innerH} L ${points[0].x} ${pad.t + innerH} Z`;

  const total = CHART_VALUES.reduce((s, v) => s + v, 0);
  return (
    <div className="card chart-card">
      <div className="card-h" style={{ padding: 0, border: 'none', marginBottom: 0 }}>
        <div>
          <div className="card-t">Order volume</div>
          <div className="card-ts">Last 6 months · orders placed</div>
        </div>
        <div className="chart-tabs">
          {['6m', '12m', 'YTD'].map(r => (
            <button key={r} className={'chart-tab ' + (range === r ? 'on' : '')} onClick={() => setRange(r)}>{r}</button>
          ))}
        </div>
      </div>
      <div className="chart-stats">
        <div className="chart-big">{total}</div>
        <div className="chart-delta">↗ +18.6%</div>
        <div className="chart-context">vs previous period</div>
      </div>
      <svg className="chart-svg" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
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
        {/* grid lines */}
        {[0, .25, .5, .75, 1].map((p, i) => {
          const y = pad.t + innerH * (1 - p);
          return <line key={i} x1={pad.l} y1={y} x2={w - pad.r} y2={y} stroke="#E2E0D8" strokeWidth="1" strokeDasharray={i === 4 ? '0' : '3 4'} opacity={i === 4 ? 1 : .6} />;
        })}
        {/* y-axis labels */}
        {[0, .5, 1].map((p, i) => {
          const v = Math.round(max * p);
          const y = pad.t + innerH * (1 - p);
          return <text key={i} x={pad.l - 8} y={y + 3} textAnchor="end" fontSize="9" fontFamily="DM Mono" fill="#9C9A92">{v}</text>;
        })}
        {/* area */}
        <path d={areaPath} fill="url(#ag)" />
        {/* line */}
        <path d={linePath} fill="none" stroke="url(#lg)" strokeWidth="2.5" strokeLinecap="round" />
        {/* points */}
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r="5" fill="#fff" stroke={i === points.length - 1 ? '#DB2777' : '#534AB7'} strokeWidth="2.2" />
            {i === points.length - 1 && (
              <g>
                <circle cx={p.x} cy={p.y} r="10" fill="#DB2777" opacity=".18">
                  <animate attributeName="r" values="6;14;6" dur="2s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values=".3;0;.3" dur="2s" repeatCount="indefinite" />
                </circle>
                <text x={p.x} y={p.y - 14} textAnchor="middle" fontSize="11" fontWeight="700" fontFamily="DM Sans" fill="#1A1916">{CHART_VALUES[i]}</text>
              </g>
            )}
          </g>
        ))}
        {/* x-axis labels */}
        {points.map((p, i) => (
          <text key={i} x={p.x} y={h - 8} textAnchor="middle" fontSize="10" fontFamily="DM Mono" fill="#9C9A92">{CHART_MONTHS[i]}</text>
        ))}
      </svg>
    </div>
  );
}

// ── tier donut + breakdown ───────────────────────────────────────────
function TierDonut() {
  const data = [
    { name: 'UF — Urban',         count: 114, color: '#2563EB' },
    { name: 'CF — City',          count: 22,  color: '#16A34A' },
    { name: 'SMF — State Master', count: 6,   color: '#F59E0B' },
  ];
  const total = data.reduce((s, d) => s + d.count, 0);
  const r = 50, cx = 62, cy = 62;
  const C = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="card tier-card">
      <div className="card-h" style={{ padding: 0, border: 'none', marginBottom: 4 }}>
        <div>
          <div className="card-t">Franchisee tiers</div>
          <div className="card-ts">142 active · split by tier</div>
        </div>
      </div>
      <div className="donut-wrap">
        <div className="donut">
          <svg viewBox="0 0 124 124">
            <circle cx={cx} cy={cy} r={r} fill="none" stroke="#F0EEE9" strokeWidth="14" />
            {data.map((d, i) => {
              const dash = (d.count / total) * C;
              const seg = <circle
                key={i}
                cx={cx} cy={cy} r={r}
                fill="none"
                stroke={d.color}
                strokeWidth="14"
                strokeDasharray={`${dash} ${C - dash}`}
                strokeDashoffset={-offset}
                strokeLinecap="butt"
              />;
              offset += dash;
              return seg;
            })}
          </svg>
          <div className="donut-center">
            <div className="donut-big">{total}</div>
            <div className="donut-lbl">Total</div>
          </div>
        </div>
        <div className="donut-side">
          <div className="tier-rows">
            {data.map(d => {
              const pct = Math.round((d.count / total) * 100);
              return (
                <div key={d.name} className="tier-row">
                  <span className="tier-swatch" style={{ background: d.color }}></span>
                  <span className="tier-name" style={{ flex: 'none' }}>{d.name.split(' — ')[0]}</span>
                  <span className="tier-cnt">{d.count}</span>
                  <span className="tier-pct">{pct}%</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── activity feed ────────────────────────────────────────────────────
function ActivityFeed() {
  return (
    <div className="card">
      <div className="card-h">
        <div>
          <div className="card-t" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            Latest activity
            <span className="live-dot" title="Live"></span>
          </div>
          <div className="card-ts">Across all centres</div>
        </div>
        <div className="card-link">Audit log →</div>
      </div>
      <div className="act">
        {ACTIVITY.map((a, i) => (
          <div key={i} className="act-i">
            <div className="act-em" style={{ background: a.bg }}>{a.em}</div>
            <div className="act-body">
              <div className="act-title">{a.title}</div>
              <div className="act-meta">
                <span className="am-pill">{a.meta[0]}</span>
                {a.meta[1]}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── recent orders table ──────────────────────────────────────────────
function OrdersTable() {
  return (
    <div className="card">
      <div className="card-h">
        <div>
          <div className="card-t">Recent orders</div>
          <div className="card-ts">Last 6 orders · all tiers</div>
        </div>
        <div className="card-link">View all →</div>
      </div>
      <table className="tbl">
        <thead>
          <tr>
            <th>Order ref</th>
            <th>Placed by</th>
            <th>Tier</th>
            <th>Status</th>
            <th>Placed</th>
            <th style={{ textAlign: 'right' }}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {ORDERS.map(o => {
            const st = STATUS_LABEL[o.status];
            return (
              <tr key={o.ref}>
                <td className="mono">{o.ref}</td>
                <td>
                  <div className="placer-cell">
                    <div className="placer-av" style={{ background: o.av }}>
                      {o.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                    </div>
                    <div>
                      <div className="placer-name">{o.name}</div>
                      <div className="placer-loc">{o.city}</div>
                    </div>
                  </div>
                </td>
                <td><span className={'tier t-' + o.tier.toLowerCase()}>{o.tier}</span></td>
                <td><span className={'bdg ' + st.cls}><span className="d"></span>{st.txt}</span></td>
                <td className="mono">{o.placed}</td>
                <td style={{ textAlign: 'right' }}>
                  <div className="amt">₹{o.amt}</div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── top franchisees ──────────────────────────────────────────────────
function TopFranchisees() {
  const max = Math.max(...TOP_FRANCHISEES.map(f => f.orders));
  return (
    <div className="card">
      <div className="card-h">
        <div>
          <div className="card-t">Top franchisees</div>
          <div className="card-ts">By orders placed · last 30 days</div>
        </div>
        <div className="card-link">All centres →</div>
      </div>
      <div className="topf">
        {TOP_FRANCHISEES.map((f, i) => {
          const pct = Math.round((f.orders / max) * 100);
          return (
            <div key={f.name} className={'topf-i topf-r' + (i + 1)}>
              <div className={'topf-rank r' + (i + 1)}>{i === 0 ? '🥇' : '#' + (i + 1)}</div>
              <div className="topf-body">
                <div className="topf-name">{f.name}</div>
                <div className="topf-bar"><div className="topf-bar-fill" style={{ width: pct + '%' }}></div></div>
                <div className="topf-meta">{f.tier} · {f.city}</div>
              </div>
              <div className="topf-num">{f.orders}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── tweaks ───────────────────────────────────────────────────────────
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "showSun": true,
  "density": "cozy",
  "kpiStyle": "gradient",
  "greeting": ""
}/*EDITMODE-END*/;

// Time-of-day greeting — used when the tweak override is empty
function timeOfDayGreeting(name) {
  const h = new Date().getHours();
  let salutation;
  if (h < 5)       salutation = 'Burning the midnight oil';
  else if (h < 12) salutation = 'Good morning';
  else if (h < 17) salutation = 'Good afternoon';
  else if (h < 21) salutation = 'Good evening';
  else             salutation = 'Working late';
  return `${salutation}, ${name}!`;
}

function TweaksUI({ t, setTweak }) {
  return (
    <TweaksPanel>
      <TweakSection label="Greeting">
        <TweakToggle label="Show NLH mascot" value={t.showSun} onChange={v => setTweak('showSun', v)} />
        <TweakText label="Headline" value={t.greeting} placeholder="Auto (time of day)" onChange={v => setTweak('greeting', v)} />
      </TweakSection>
      <TweakSection label="Layout">
        <TweakRadio label="Density" value={t.density} onChange={v => setTweak('density', v)}
          options={[
            { value: 'cozy',    label: 'Cozy' },
            { value: 'compact', label: 'Compact' },
          ]} />
      </TweakSection>
      <TweakSection label="KPI cards">
        <TweakRadio label="Style" value={t.kpiStyle} onChange={v => setTweak('kpiStyle', v)}
          options={[
            { value: 'gradient', label: 'Vivid' },
            { value: 'pastel',   label: 'Pastel' },
            { value: 'mono',     label: 'Mono' },
          ]} />
      </TweakSection>
    </TweaksPanel>
  );
}

// ── density + KPI variant overrides ──────────────────────────────────
function ApplyOverrides({ density, kpiStyle }) {
  return (
    <style>{`
      ${density === 'compact' ? `
        .content { padding: 16px 22px 32px; gap: 14px; }
        .hero { padding: 18px 22px; min-height: 110px; }
        .hero-title { font-size: 22px; }
        .hero-sub { font-size: 12.5px; }
        .hero-r { width: 160px; height: 110px; }
        .kc { padding: 14px 16px 16px; min-height: 138px; }
        .kc-num { font-size: 26px; }
        .programs-card { padding: 14px 18px 16px; }
        .prog { padding: 12px 8px 10px; }
        .prog-em { width: 36px; height: 36px; font-size: 18px; }
        .card-h { padding: 12px 16px; }
        .tbl th, .tbl td { padding: 8px 14px; }
      ` : ''}

      ${kpiStyle === 'pastel' ? `
        .kc-1 { background: linear-gradient(135deg, #EEEDFE 0%, #DDD9F8 100%) !important; color: #3D35A0 !important; }
        .kc-2 { background: linear-gradient(135deg, #DCFCE7 0%, #BBF7D0 100%) !important; color: #14532D !important; }
        .kc-3 { background: linear-gradient(135deg, #FEF3C7 0%, #FDE68A 100%) !important; color: #5B3A00 !important; }
        .kc-4 { background: linear-gradient(135deg, #FCE7F3 0%, #FBCFE8 100%) !important; color: #831843 !important; }
        .kc .kc-ic { background: rgba(255,255,255,.6) !important; }
        .kc .kc-arr { background: rgba(255,255,255,.6) !important; }
        .kc .kc-sub .delta { background: rgba(0,0,0,.06) !important; color: inherit !important; }
        .kc::before, .kc::after { background: rgba(255,255,255,.45) !important; }
      ` : ''}

      ${kpiStyle === 'mono' ? `
        .kc-1, .kc-2, .kc-3, .kc-4 { background: #fff !important; color: #1A1916 !important; border: 1px solid #E2E0D8 !important; box-shadow: 0 1px 3px rgba(0,0,0,.05); }
        .kc::before, .kc::after { display: none; }
        .kc-1 .kc-ic { background: #EEEDFE !important; }
        .kc-2 .kc-ic { background: #DCFCE7 !important; }
        .kc-3 .kc-ic { background: #FEF3C7 !important; }
        .kc-4 .kc-ic { background: #FCE7F3 !important; }
        .kc .kc-arr { background: #F0EEE9 !important; color: #5C5A54; }
        .kc-lbl { color: #5C5A54 !important; opacity: 1; }
        .kc-sub { color: #9C9A92 !important; opacity: 1; }
        .kc-sub .delta { background: #DCFCE7 !important; color: #1D7A4F !important; }
      ` : ''}
    `}</style>
  );
}

// ── root ─────────────────────────────────────────────────────────────
function DashboardPage({ greeting, showSun }) {
  return (
    <>
      <Topbar />
      <div className="content" data-screen-label="01 Admin dashboard">
        <HeroOverride greeting={greeting} showSun={showSun} />
        <KpiGrid />
        <ProgramsStrip />
        <div className="row">
          <OrdersChart />
          <TierDonut />
        </div>
        <div className="row" style={{ gridTemplateColumns: '1.55fr 1fr' }}>
          <OrdersTable />
          <ActivityFeed />
        </div>
        <TopFranchisees />
      </div>
    </>
  );
}

function ComingSoon({ page }) {
  const labels = { team: 'Team & access', audit: 'Audit log' };
  return (
    <>
      <PageTopbar crumb={labels[page] || page} search={false} actions={null} />
      <div className="content" style={{ alignItems: 'center', justifyContent: 'center', minHeight: 'calc(100vh - 60px)' }}>
        <div style={{ textAlign: 'center', maxWidth: 460, padding: 40, marginTop: 40, alignSelf: 'center' }}>
          <img src="assets/nlh-mascot.png" alt="" style={{ width: 140, height: 140, objectFit: 'contain', marginBottom: 18, filter: 'drop-shadow(0 8px 20px rgba(217,119,6,.3))' }} />
          <h2 style={{ font: '700 22px var(--font)', color: 'var(--text)', letterSpacing: '-.01em' }}>{labels[page] || 'Coming soon'}</h2>
          <p style={{ font: '500 13px var(--font)', color: 'var(--text2)', marginTop: 8, lineHeight: 1.5 }}>
            This section hasn&rsquo;t been redesigned yet. Pick another tab from the sidebar to keep exploring.
          </p>
        </div>
      </div>
    </>
  );
}

function App() {
  const [active, setActive] = useState('dashboard');
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);

  let pageNode;
  if (active === 'dashboard')        pageNode = <DashboardPage greeting={t.greeting} showSun={t.showSun} />;
  else if (active === 'franchisees') pageNode = <FranchiseesPage />;
  else if (active === 'orders')      pageNode = <OrdersPage />;
  else if (active === 'invoices')    pageNode = <InvoicesPage />;
  else if (active === 'students')    pageNode = <StudentsPage />;
  else if (active === 'kits')        pageNode = <PricesPage />;
  else if (active === 'programs')    pageNode = <ProgramsPage />;
  else                                pageNode = <ComingSoon page={active} />;

  return (
    <div className="app">
      <ApplyOverrides density={t.density} kpiStyle={t.kpiStyle} />
      <Sidebar active={active} onNav={setActive} />
      <div className="main">
        {pageNode}
      </div>
      <TweaksUI t={t} setTweak={setTweak} />
    </div>
  );
}

// HeroOverride lets us update greeting text from tweaks
function HeroOverride({ greeting, showSun }) {
  const headline = (greeting && greeting.trim()) || timeOfDayGreeting(ADMIN.name.split(' ')[0]);
  return (
    <div className="hero">
      <div className="hero-l">
        <div className="hero-eyebrow">
          <span className="dot"></span>
          Live · {ADMIN.today.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </div>
        <h1 className="hero-title">{headline}</h1>
        <p className="hero-sub">
          Here is what is happening across your network today. <b>16 programs</b> running, <b>142 franchisees</b> active, and <b>6 new students</b> enrolled in the last hour.
        </p>
        <div className="hero-chips">
          <span className="hero-chip"><span className="em">🎓</span><b>+118</b>&nbsp;students this month</span>
          <span className="hero-chip"><span className="em">📦</span><b>24</b>&nbsp;orders awaiting dispatch</span>
          <span className="hero-chip"><span className="em">🤝</span><b>3</b>&nbsp;franchisee requests</span>
        </div>
      </div>
      {showSun && (
        <div className="hero-r" aria-hidden="true">
          <NlhMascot />
        </div>
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
