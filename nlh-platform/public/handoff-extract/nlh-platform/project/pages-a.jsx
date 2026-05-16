// ─────────────────────────────────────────────────────────────────────
// NLH Vibrant Dashboard — pages A: Franchisees, Orders, Invoices
// ─────────────────────────────────────────────────────────────────────

const { useState: useStateA, useMemo: useMemoA } = React;

// ── shared mock data ────────────────────────────────────────────────
const FRANCHISEES = [
  { id: 'f1',  name: 'NLH Sadar (Nagpur)',         owner: 'Dhiral Panchmatia', city: 'Nagpur',     state: 'MH', tier: 'SMF', students: 248, orders: 42, since: 'Mar 2008', active: true,  av: '#534AB7' },
  { id: 'f2',  name: 'Bright Minds Pune',          owner: 'Anjali Sharma',     city: 'Pune',       state: 'MH', tier: 'CF',  students: 186, orders: 38, since: 'Jun 2019', active: true,  av: '#2563EB' },
  { id: 'f3',  name: 'Brain Boosters Mumbai',      owner: 'Rohit Deshmukh',    city: 'Mumbai',     state: 'MH', tier: 'CF',  students: 164, orders: 31, since: 'Jan 2020', active: true,  av: '#16A34A' },
  { id: 'f4',  name: 'Little Genius Aurangabad',   owner: 'Pooja Kulkarni',    city: 'Aurangabad', state: 'MH', tier: 'UF',  students:  84, orders: 24, since: 'Aug 2021', active: true,  av: '#D97706' },
  { id: 'f5',  name: 'Skillsphere Nashik',         owner: 'Salim Ansari',     city: 'Nashik',     state: 'MH', tier: 'UF',  students:  72, orders: 19, since: 'Nov 2021', active: true,  av: '#DB2777' },
  { id: 'f6',  name: 'NLH Bengaluru South',        owner: 'Meera Iyer',        city: 'Bengaluru',  state: 'KA', tier: 'CF',  students: 142, orders: 28, since: 'Feb 2020', active: true,  av: '#7C3AED' },
  { id: 'f7',  name: 'Curious Kids Indore',        owner: 'Vikrant Joshi',     city: 'Indore',     state: 'MP', tier: 'UF',  students:  56, orders: 14, since: 'May 2022', active: true,  av: '#0284C7' },
  { id: 'f8',  name: 'Future Stars Bhopal',        owner: 'Neha Saxena',       city: 'Bhopal',     state: 'MP', tier: 'UF',  students:  48, orders: 11, since: 'Sep 2022', active: true,  av: '#EA580C' },
  { id: 'f9',  name: 'NLH Hyderabad West',         owner: 'Karthik Reddy',     city: 'Hyderabad',  state: 'TG', tier: 'CF',  students: 118, orders: 22, since: 'Oct 2020', active: true,  av: '#E11D48' },
  { id: 'f10', name: 'Learning Tree Coimbatore',   owner: 'Lakshmi Iyer',      city: 'Coimbatore', state: 'TN', tier: 'UF',  students:  38, orders:  8, since: 'Feb 2023', active: false, av: '#5C5A54' },
  { id: 'f11', name: 'Sunrise Skills Jaipur',      owner: 'Manish Agarwal',    city: 'Jaipur',     state: 'RJ', tier: 'CF',  students:  92, orders: 18, since: 'Apr 2021', active: true,  av: '#1A5FA8' },
  { id: 'f12', name: 'NLH Kolhapur',               owner: 'Vinay Patil',       city: 'Kolhapur',   state: 'MH', tier: 'UF',  students:  62, orders: 15, since: 'Jul 2022', active: true,  av: '#16A34A' },
];

const ORDERS_A = [
  { ref: 'ORD-2026-0418', name: 'Anjali Sharma',     loc: 'Pune',       tier: 'UF',  status: 'pending',  amt: '18,450',   items: 3, placed: '15 May', av: '#2563EB' },
  { ref: 'ORD-2026-0417', name: 'Rohit Deshmukh',    loc: 'Mumbai',     tier: 'CF',  status: 'invoiced', amt: '62,000',   items: 8, placed: '15 May', av: '#16A34A' },
  { ref: 'ORD-2026-0416', name: 'Pooja Kulkarni',    loc: 'Aurangabad', tier: 'SMF', status: 'closed',   amt: '1,24,000', items: 14, placed: '15 May', av: '#D97706' },
  { ref: 'ORD-2026-0415', name: 'Salim Ansari',      loc: 'Nashik',     tier: 'UF',  status: 'over',     amt: '8,200',    items: 2, placed: '14 May', av: '#DB2777' },
  { ref: 'ORD-2026-0414', name: 'Meera Iyer',        loc: 'Bengaluru',  tier: 'CF',  status: 'closed',   amt: '42,300',   items: 6, placed: '14 May', av: '#7C3AED' },
  { ref: 'ORD-2026-0413', name: 'Vikrant Joshi',     loc: 'Indore',     tier: 'UF',  status: 'pmt',      amt: '14,750',   items: 4, placed: '13 May', av: '#0284C7' },
  { ref: 'ORD-2026-0412', name: 'Karthik Reddy',     loc: 'Hyderabad',  tier: 'CF',  status: 'invoiced', amt: '38,900',   items: 5, placed: '13 May', av: '#E11D48' },
  { ref: 'ORD-2026-0411', name: 'Manish Agarwal',    loc: 'Jaipur',     tier: 'CF',  status: 'pending',  amt: '26,500',   items: 4, placed: '12 May', av: '#1A5FA8' },
  { ref: 'ORD-2026-0410', name: 'Neha Saxena',       loc: 'Bhopal',     tier: 'UF',  status: 'closed',   amt: '11,200',   items: 3, placed: '11 May', av: '#EA580C' },
  { ref: 'ORD-2026-0409', name: 'Vinay Patil',       loc: 'Kolhapur',   tier: 'UF',  status: 'pmt',      amt: '19,800',   items: 4, placed: '10 May', av: '#16A34A' },
];

const INVOICES = [
  { inv: 'INV-2026-0417', ord: 'ORD-2026-0417', name: 'Rohit Deshmukh',   tier: 'CF',  amt: '62,000',   issued: '15 May', due: '29 May', age: 0,  status: 'unpaid', av: '#16A34A' },
  { inv: 'INV-2026-0416', ord: 'ORD-2026-0416', name: 'Pooja Kulkarni',   tier: 'SMF', amt: '1,24,000', issued: '15 May', due: '29 May', age: 0,  status: 'paid',   av: '#D97706' },
  { inv: 'INV-2026-0414', ord: 'ORD-2026-0414', name: 'Meera Iyer',       tier: 'CF',  amt: '42,300',   issued: '14 May', due: '28 May', age: 1,  status: 'paid',   av: '#7C3AED' },
  { inv: 'INV-2026-0413', ord: 'ORD-2026-0413', name: 'Vikrant Joshi',    tier: 'UF',  amt: '14,750',   issued: '13 May', due: '27 May', age: 2,  status: 'pmt',    av: '#0284C7' },
  { inv: 'INV-2026-0412', ord: 'ORD-2026-0412', name: 'Karthik Reddy',    tier: 'CF',  amt: '38,900',   issued: '13 May', due: '27 May', age: 2,  status: 'unpaid', av: '#E11D48' },
  { inv: 'INV-2026-0410', ord: 'ORD-2026-0410', name: 'Neha Saxena',      tier: 'UF',  amt: '11,200',   issued: '11 May', due: '25 May', age: 4,  status: 'paid',   av: '#EA580C' },
  { inv: 'INV-2026-0409', ord: 'ORD-2026-0409', name: 'Vinay Patil',      tier: 'UF',  amt: '19,800',   issued: '10 May', due: '24 May', age: 5,  status: 'pmt',    av: '#16A34A' },
  { inv: 'INV-2026-0405', ord: 'ORD-2026-0405', name: 'Salim Ansari',     tier: 'UF',  amt:  '8,200',   issued: '15 Apr', due: '29 Apr', age: 16, status: 'over',   av: '#DB2777' },
  { inv: 'INV-2026-0402', ord: 'ORD-2026-0402', name: 'Lakshmi Iyer',     tier: 'UF',  amt: '21,400',   issued: '08 Apr', due: '22 Apr', age: 23, status: 'over',   av: '#5C5A54' },
];

// ── shared topbar (overrides default per page) ──────────────────────
function PageTopbar({ crumb, search, actions }) {
  return (
    <header className="tb">
      <div className="crumb">Operations <span className="sep">›</span> <b>{crumb}</b></div>
      <div className="tb-r">
        {search !== false && <input className="search" placeholder={search || 'Search…'} />}
        {actions}
      </div>
    </header>
  );
}

// ── PageHeader (title strip) ────────────────────────────────────────
function PageHeader({ eyebrow, title, sub, right }) {
  return (
    <div className="ph">
      <div className="ph-l">
        {eyebrow && <div className="ph-eyebrow"><span className="dot"></span>{eyebrow}</div>}
        <h1 className="ph-title">{title}</h1>
        {sub && <div className="ph-sub">{sub}</div>}
      </div>
      {right && <div className="ph-r">{right}</div>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// 1. FRANCHISEES PAGE
// ─────────────────────────────────────────────────────────────────────
function FranchiseesPage() {
  const [filter, setFilter] = useStateA('all');
  const filtered = useMemoA(() =>
    FRANCHISEES.filter(f => filter === 'all' ? true : f.tier === filter.toUpperCase()),
  [filter]);

  const counts = {
    all: FRANCHISEES.length,
    smf: FRANCHISEES.filter(f => f.tier === 'SMF').length,
    cf:  FRANCHISEES.filter(f => f.tier === 'CF').length,
    uf:  FRANCHISEES.filter(f => f.tier === 'UF').length,
  };

  return (
    <>
      <PageTopbar
        crumb="Franchisees"
        search="Search by name, owner, or city…"
        actions={<>
          <button className="btn btn-s">Export CSV</button>
          <button className="btn btn-p">+ Add franchisee</button>
        </>} />
      <div className="content" data-screen-label="02 Franchisees">
        <PageHeader
          eyebrow="Network"
          title="Franchisees"
          sub={<><b>142 active partners</b> across 28 cities. 6 State Master Franchisees, 22 City Franchisees, 114 Urban Franchisees.</>}
        />

        <div className="mini-stats">
          <div className="mini">
            <div className="mini-ic" style={{ background: 'var(--purple-bg)' }}>🏢</div>
            <div className="mini-num">142</div>
            <div className="mini-lbl">Total active</div>
            <div className="mini-delta">▲ +4 this month</div>
          </div>
          <div className="mini">
            <div className="mini-ic" style={{ background: 'var(--sun-bg)' }}>🌟</div>
            <div className="mini-num">6</div>
            <div className="mini-lbl">SMF · State Master</div>
            <div className="mini-delta amber">Avg 23 centres each</div>
          </div>
          <div className="mini">
            <div className="mini-ic" style={{ background: 'var(--green-bg)' }}>🏙️</div>
            <div className="mini-num">22</div>
            <div className="mini-lbl">CF · City</div>
            <div className="mini-delta">▲ +1 this month</div>
          </div>
          <div className="mini">
            <div className="mini-ic" style={{ background: 'var(--blue-bg)' }}>📍</div>
            <div className="mini-num">114</div>
            <div className="mini-lbl">UF · Urban</div>
            <div className="mini-delta">▲ +3 this month</div>
          </div>
        </div>

        <div className="fr-toolbar">
          <input className="fr-search" placeholder="Search by business name, owner, city…" />
          <div className="fr-tabs">
            {[
              { id: 'all', l: 'All' },
              { id: 'smf', l: 'SMF' },
              { id: 'cf',  l: 'CF' },
              { id: 'uf',  l: 'UF' },
            ].map(t => (
              <button key={t.id}
                className={'fr-tab ' + (filter === t.id ? 'on' : '')}
                onClick={() => setFilter(t.id)}>
                {t.l} <span className="ct">{counts[t.id]}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="fr-grid">
          {filtered.map(f => (
            <div key={f.id} className={'fr-card ' + f.tier.toLowerCase()}>
              <div className="fr-head">
                <div className="fr-av" style={{ background: f.av }}>
                  {f.name.replace(/^NLH\s/, '').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="fr-name">{f.name}</div>
                  <div className="fr-loc">{f.city} &middot; {f.state}</div>
                  <div className="fr-badge-row">
                    <span className={'tier t-' + f.tier.toLowerCase()}>{f.tier}</span>
                    <span style={{ font: '500 10px var(--mono)', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.04em', alignSelf: 'center' }}>{f.owner}</span>
                  </div>
                </div>
              </div>
              <div className="fr-stat-row">
                <div className="fr-stat">
                  <div className="fr-stat-num">{f.students}</div>
                  <div className="fr-stat-lbl">Students</div>
                </div>
                <div className="fr-stat">
                  <div className="fr-stat-num">{f.orders}</div>
                  <div className="fr-stat-lbl">Orders</div>
                </div>
                <div className="fr-stat">
                  <div className="fr-stat-num">{f.tier === 'SMF' ? '23' : f.tier === 'CF' ? '4' : '—'}</div>
                  <div className="fr-stat-lbl">Sub-centres</div>
                </div>
              </div>
              <div className="fr-card-foot">
                <div className="fr-since">Since {f.since}</div>
                <div className={'fr-active ' + (f.active ? '' : 'fr-dormant')}>
                  <span className="d"></span>{f.active ? 'Active' : 'Dormant'}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────
// 2. ORDERS PAGE
// ─────────────────────────────────────────────────────────────────────
const ORDER_STATUS_LABEL = {
  pending:  { txt: 'pending',       cls: 'bdg-pend' },
  invoiced: { txt: 'invoiced',      cls: 'bdg-inv'  },
  pmt:      { txt: 'pmt submitted', cls: 'bdg-pmt'  },
  closed:   { txt: 'closed',        cls: 'bdg-paid' },
  over:     { txt: 'overdue',       cls: 'bdg-over' },
};

function OrdersPage() {
  const [filter, setFilter] = useStateA('all');
  const filtered = filter === 'all' ? ORDERS_A : ORDERS_A.filter(o => o.status === filter);
  const counts = {
    all: ORDERS_A.length,
    pending: ORDERS_A.filter(o => o.status === 'pending').length,
    invoiced: ORDERS_A.filter(o => o.status === 'invoiced').length,
    pmt: ORDERS_A.filter(o => o.status === 'pmt').length,
    closed: ORDERS_A.filter(o => o.status === 'closed').length,
    over: ORDERS_A.filter(o => o.status === 'over').length,
  };

  return (
    <>
      <PageTopbar
        crumb="Orders"
        search="Search by order ref or franchisee…"
        actions={<>
          <button className="btn btn-s">Export CSV</button>
          <button className="btn btn-p">+ New order</button>
        </>}
      />
      <div className="content" data-screen-label="03 Orders">
        <PageHeader
          eyebrow="Operations"
          title="Orders"
          sub={<>Tracking <b>{ORDERS_A.length} recent orders</b> across all centres. <b>{counts.pending} pending invoice</b>, <b>{counts.over} overdue</b> &middot; total value <b>₹3.66L</b>.</>}
        />

        <div className="status-pills">
          {[
            { id: 'all',      l: 'All',          cls: 'all' },
            { id: 'pending',  l: 'Pending',      cls: 'pending' },
            { id: 'invoiced', l: 'Invoiced',     cls: 'inv' },
            { id: 'pmt',      l: 'Pmt submitted',cls: 'pmt' },
            { id: 'closed',   l: 'Closed',       cls: 'closed' },
            { id: 'over',     l: 'Overdue',      cls: 'over' },
          ].map(s => (
            <button key={s.id} onClick={() => setFilter(s.id)}
              className={'sp ' + (filter === s.id ? ('on ' + s.cls) : '')}>
              {s.l} <span className="ct">{counts[s.id]}</span>
            </button>
          ))}
        </div>

        <div className="card" style={{ marginBottom: 0 }}>
          <table className="big-tbl">
            <thead>
              <tr>
                <th>Order ref</th>
                <th>Placed by</th>
                <th>Tier</th>
                <th>Items</th>
                <th>Placed</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(o => {
                const s = ORDER_STATUS_LABEL[o.status];
                return (
                  <tr key={o.ref}>
                    <td className="mono">{o.ref}</td>
                    <td>
                      <div className="placer-cell">
                        <div className="placer-av" style={{ background: o.av }}>
                          {o.name.split(' ').map(n => n[0]).join('').slice(0,2)}
                        </div>
                        <div>
                          <div className="placer-name">{o.name}</div>
                          <div className="placer-loc">{o.loc}</div>
                        </div>
                      </div>
                    </td>
                    <td><span className={'tier t-' + o.tier.toLowerCase()}>{o.tier}</span></td>
                    <td className="mono">{o.items} kits</td>
                    <td className="mono">{o.placed}</td>
                    <td><span className={'bdg ' + s.cls}><span className="d"></span>{s.txt}</span></td>
                    <td style={{ textAlign: 'right' }}><div className="amt">₹{o.amt}</div></td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {o.status === 'pending' && <button className="row-action primary">Invoice</button>}
                      {(o.status === 'invoiced' || o.status === 'pmt') && <button className="row-action green">Record pmt</button>}
                      <button className="row-action">View</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────
// 3. INVOICES PAGE
// ─────────────────────────────────────────────────────────────────────
const INV_STATUS = {
  paid:   { txt: 'paid',          cls: 'bdg-paid' },
  unpaid: { txt: 'unpaid',        cls: 'bdg-pend' },
  pmt:    { txt: 'pmt submitted', cls: 'bdg-pmt'  },
  over:   { txt: 'overdue',       cls: 'bdg-over' },
};

function InvoicesPage() {
  const [filter, setFilter] = useStateA('all');
  const filtered = filter === 'all' ? INVOICES : INVOICES.filter(i => i.status === filter);

  const totalOutstanding = INVOICES
    .filter(i => i.status !== 'paid')
    .reduce((s, i) => s + Number(i.amt.replace(/,/g, '')), 0);
  const totalOverdue = INVOICES
    .filter(i => i.status === 'over')
    .reduce((s, i) => s + Number(i.amt.replace(/,/g, '')), 0);
  const totalPaid = INVOICES
    .filter(i => i.status === 'paid')
    .reduce((s, i) => s + Number(i.amt.replace(/,/g, '')), 0);

  const paidCt = INVOICES.filter(i => i.status === 'paid').length;
  const unpaidCt = INVOICES.filter(i => i.status === 'unpaid').length;
  const pmtCt = INVOICES.filter(i => i.status === 'pmt').length;
  const overCt = INVOICES.filter(i => i.status === 'over').length;

  function fmt(n) { return n.toLocaleString('en-IN'); }

  const total = INVOICES.length;
  const pctPaid = Math.round((paidCt / total) * 100);
  const pctUnpaid = Math.round(((unpaidCt + pmtCt) / total) * 100);
  const pctOver = Math.round((overCt / total) * 100);

  return (
    <>
      <PageTopbar
        crumb="Invoices"
        search="Search by INV no or franchisee…"
        actions={<>
          <button className="btn btn-s">Export</button>
          <button className="btn btn-p">+ New invoice</button>
        </>}
      />
      <div className="content" data-screen-label="04 Invoices">
        <PageHeader
          eyebrow="Collections"
          title="Invoices"
          sub={<><b>{total} invoices</b> issued this month &middot; {paidCt} paid, {unpaidCt + pmtCt} pending, <b style={{color:'var(--red)'}}>{overCt} overdue</b>.</>}
        />

        <div className="inv-hero">
          <div className="inv-hero-l">
            <div className="lbl">Total outstanding</div>
            <div className="big"><span className="cur">₹</span>{fmt(totalOutstanding)}</div>
            <div className="sub">{unpaidCt + pmtCt + overCt} invoices unpaid &middot; <b style={{color:'#fff'}}>₹{fmt(totalOverdue)}</b> overdue</div>
            <div className="actions">
              <button className="solid">Send reminders</button>
              <button>Download report</button>
            </div>
          </div>
          <div className="inv-hero-r">
            <div className="h">
              <span>Status breakdown</span>
              <span className="card-link" style={{ background: 'transparent', padding: 0 }}>Audit log →</span>
            </div>
            <div className="inv-bar-row">
              <span className="inv-bar-lbl">Paid</span>
              <span className="inv-bar"><span className="inv-bar-fill paid" style={{ width: pctPaid + '%' }}></span></span>
              <span className="inv-bar-num">{paidCt}</span>
            </div>
            <div className="inv-bar-row">
              <span className="inv-bar-lbl">Unpaid</span>
              <span className="inv-bar"><span className="inv-bar-fill unpaid" style={{ width: pctUnpaid + '%' }}></span></span>
              <span className="inv-bar-num">{unpaidCt + pmtCt}</span>
            </div>
            <div className="inv-bar-row">
              <span className="inv-bar-lbl">Overdue</span>
              <span className="inv-bar"><span className="inv-bar-fill over" style={{ width: pctOver + '%' }}></span></span>
              <span className="inv-bar-num">{overCt}</span>
            </div>
            <div style={{ marginTop: 8, padding: '10px 12px', background: 'var(--green-bg)', borderRadius: 8, font: '600 10.5px var(--mono)', color: 'var(--green)', textTransform: 'uppercase', letterSpacing: '.05em' }}>
              ✓ Collected this month &middot; <span style={{ fontSize: 13, fontWeight: 700 }}>₹{fmt(totalPaid)}</span>
            </div>
          </div>
        </div>

        <div className="status-pills">
          {[
            { id: 'all',    l: 'All',    cls: 'all'     },
            { id: 'paid',   l: 'Paid',   cls: 'closed'  },
            { id: 'unpaid', l: 'Unpaid', cls: 'pending' },
            { id: 'pmt',    l: 'Pmt submitted', cls: 'pmt' },
            { id: 'over',   l: 'Overdue',cls: 'over'    },
          ].map(s => {
            const ct = s.id === 'all' ? total : { paid: paidCt, unpaid: unpaidCt, pmt: pmtCt, over: overCt }[s.id];
            return (
              <button key={s.id} onClick={() => setFilter(s.id)}
                className={'sp ' + (filter === s.id ? ('on ' + s.cls) : '')}>
                {s.l} <span className="ct">{ct}</span>
              </button>
            );
          })}
        </div>

        <div className="card" style={{ marginBottom: 0 }}>
          <table className="big-tbl">
            <thead>
              <tr>
                <th>Invoice no</th>
                <th>Order ref</th>
                <th>Billed to</th>
                <th>Issued</th>
                <th>Due</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(i => {
                const s = INV_STATUS[i.status];
                const ageText = i.status === 'over'
                  ? <span style={{ color: 'var(--red)', fontWeight: 700 }}>{i.due} &middot; +{i.age}d</span>
                  : <span>{i.due}</span>;
                return (
                  <tr key={i.inv}>
                    <td className="mono" style={{ color: 'var(--purple)', fontWeight: 600 }}>{i.inv}</td>
                    <td className="mono">{i.ord}</td>
                    <td>
                      <div className="placer-cell">
                        <div className="placer-av" style={{ background: i.av }}>
                          {i.name.split(' ').map(n => n[0]).join('').slice(0,2)}
                        </div>
                        <div>
                          <div className="placer-name">{i.name}</div>
                          <div className="placer-loc"><span className={'tier t-' + i.tier.toLowerCase()}>{i.tier}</span></div>
                        </div>
                      </div>
                    </td>
                    <td className="mono">{i.issued}</td>
                    <td className="mono">{ageText}</td>
                    <td><span className={'bdg ' + s.cls}><span className="d"></span>{s.txt}</span></td>
                    <td style={{ textAlign: 'right' }}><div className="amt">₹{i.amt}</div></td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {i.status === 'over' && <button className="row-action primary">Remind</button>}
                      {(i.status === 'unpaid' || i.status === 'pmt') && <button className="row-action green">Record pmt</button>}
                      <button className="row-action">PDF</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

Object.assign(window, { FranchiseesPage, OrdersPage, InvoicesPage, PageTopbar, PageHeader });
