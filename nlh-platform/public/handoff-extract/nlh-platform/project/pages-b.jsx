// ─────────────────────────────────────────────────────────────────────
// NLH Vibrant Dashboard — pages B: Students, Kit prices, Programs
// ─────────────────────────────────────────────────────────────────────

const { useState: useStateB } = React;
const { PageTopbar, PageHeader } = window;

// ── full 16-program catalog ─────────────────────────────────────────
const ALL_PROGRAMS = [
  { id: 'abc', em: '🧮', name: 'ACEM Abacus',     ages: '4–14',  levels: 9,  skus: 12, students: 312, tone: 1, active: true },
  { id: 'cod', em: '💻', name: 'Coding',           ages: '8–18',  levels: 6,  skus: 8,  students: 248, tone: 2, active: true },
  { id: 'pho', em: '🔤', name: 'Phonics',          ages: '3–7',   levels: 4,  skus: 6,  students: 196, tone: 3, active: true },
  { id: 'art', em: '🎨', name: 'Art & Craft',      ages: '2–12',  levels: 5,  skus: 7,  students: 174, tone: 4, active: true },
  { id: 'rub', em: '🎲', name: "Rubik's Cube",     ages: '6–18',  levels: 3,  skus: 4,  students: 142, tone: 5, active: true },
  { id: 'spk', em: '🎭', name: 'Public Speaking',  ages: '8–21',  levels: 3,  skus: 4,  students: 108, tone: 6, active: true },
  { id: 'wri', em: '✍️', name: 'Write Well',       ages: '6–14',  levels: 4,  skus: 5,  students:  84, tone: 7, active: true },
  { id: 'sto', em: '📖', name: 'Storytelling',     ages: '4–12',  levels: 2,  skus: 3,  students:  60, tone: 8, active: true },
  { id: 'voc', em: '🎤', name: 'Vocal Music',      ages: '6–18',  levels: 4,  skus: 5,  students:  52, tone: 1, active: true },
  { id: 'hmw', em: '📝', name: 'Handwriting',      ages: '5–14',  levels: 3,  skus: 4,  students:  48, tone: 2, active: true },
  { id: 'che', em: '♟️', name: 'Chess',            ages: '6–18',  levels: 4,  skus: 5,  students:  42, tone: 3, active: true },
  { id: 'mat', em: '🧠', name: 'Vedic Maths',      ages: '8–16',  levels: 3,  skus: 4,  students:  38, tone: 4, active: true },
  { id: 'spe', em: '🐝', name: 'Spelling Bee',     ages: '6–12',  levels: 2,  skus: 3,  students:  34, tone: 5, active: true },
  { id: 'sci', em: '🔬', name: 'Science Lab',      ages: '8–14',  levels: 3,  skus: 4,  students:  28, tone: 6, active: true },
  { id: 'rob', em: '🤖', name: 'Robotics',         ages: '10–18', levels: 4,  skus: 6,  students:  22, tone: 7, active: false },
  { id: 'yog', em: '🧘', name: 'Yoga & Mindful',   ages: '5–18',  levels: 2,  skus: 3,  students:  18, tone: 8, active: true },
];

// ── students mock ──────────────────────────────────────────────────
const STUDENTS = [
  { name: 'Aarav Mehta',    age: 7,  enrolled: ['abc', 'pho'],        fr: 'NLH Sadar (Nagpur)',     joined: '12 May', av: '#2563EB' },
  { name: 'Diya Kapoor',    age: 9,  enrolled: ['art', 'sto'],        fr: 'Bright Minds Pune',      joined: '11 May', av: '#DB2777' },
  { name: 'Ishaan Verma',   age: 11, enrolled: ['cod', 'rub', 'che'], fr: 'Brain Boosters Mumbai',  joined: '10 May', av: '#16A34A' },
  { name: 'Saanvi Patel',   age: 6,  enrolled: ['pho', 'hmw'],        fr: 'NLH Sadar (Nagpur)',     joined: '10 May', av: '#D97706' },
  { name: 'Reyansh Singh',  age: 12, enrolled: ['cod', 'rob'],        fr: 'NLH Hyderabad West',     joined: '09 May', av: '#7C3AED' },
  { name: 'Anaya Sharma',   age: 8,  enrolled: ['abc', 'wri'],        fr: 'Skillsphere Nashik',     joined: '09 May', av: '#0284C7' },
  { name: 'Arjun Nair',     age: 14, enrolled: ['spk', 'che'],        fr: 'NLH Bengaluru South',    joined: '08 May', av: '#E11D48' },
  { name: 'Myra Iyer',      age: 5,  enrolled: ['pho', 'art'],        fr: 'NLH Bengaluru South',    joined: '08 May', av: '#EA580C' },
  { name: 'Vivaan Joshi',   age: 10, enrolled: ['rub', 'mat'],        fr: 'Curious Kids Indore',    joined: '07 May', av: '#1A5FA8' },
  { name: 'Aadhya Reddy',   age: 13, enrolled: ['spk', 'wri', 'voc'], fr: 'Future Stars Bhopal',    joined: '06 May', av: '#16A34A' },
];

function StudentsPage() {
  return (
    <>
      <PageTopbar
        crumb="Students"
        search="Search students by name or franchisee…"
        actions={<>
          <button className="btn btn-s">Export</button>
          <button className="btn btn-p">+ Enroll student</button>
        </>}
      />
      <div className="content" data-screen-label="05 Students">
        <PageHeader
          eyebrow="Enrollment"
          title="Students"
          sub={<><b>1,284 students</b> enrolled across <b>16 programs</b>. <b>+118 new this month</b> &middot; ABC Abacus and Coding are the most popular.</>}
        />

        <div className="mini-stats">
          <div className="mini">
            <div className="mini-ic" style={{ background: 'var(--purple-bg)' }}>🎓</div>
            <div className="mini-num">1,284</div>
            <div className="mini-lbl">Total enrolled</div>
            <div className="mini-delta">▲ +118 this month</div>
          </div>
          <div className="mini">
            <div className="mini-ic" style={{ background: 'var(--sun-bg)' }}>📅</div>
            <div className="mini-num">38</div>
            <div className="mini-lbl">Avg students / centre</div>
            <div className="mini-delta">▲ +2 vs last month</div>
          </div>
          <div className="mini">
            <div className="mini-ic" style={{ background: 'var(--green-bg)' }}>📚</div>
            <div className="mini-num">2.4</div>
            <div className="mini-lbl">Avg programs / student</div>
            <div className="mini-delta">▲ Up from 2.1</div>
          </div>
          <div className="mini">
            <div className="mini-ic" style={{ background: 'rgba(219,39,119,.12)' }}>🌟</div>
            <div className="mini-num">94%</div>
            <div className="mini-lbl">Retention rate</div>
            <div className="mini-delta">Last 12 months</div>
          </div>
        </div>

        <div className="programs-card">
          <div className="pc-head">
            <div>
              <div className="pc-title">Enrollment by program</div>
              <div className="pc-sub">Top 8 of 16 programs · click to filter</div>
            </div>
            <div className="pc-link">View all 16 →</div>
          </div>
          <div className="prog-rail">
            {ALL_PROGRAMS.slice(0, 8).map(p => (
              <div key={p.id} className="prog-mini">
                <div className={'prog-mini-em pe-' + p.tone}>{p.em}</div>
                <div className="prog-mini-name">{p.name}</div>
                <div className="prog-mini-cnt">{p.students}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="card" style={{ marginBottom: 0 }}>
          <div className="card-h">
            <div>
              <div className="card-t">Recent enrollments</div>
              <div className="card-ts">Last 10 students · all centres</div>
            </div>
            <div className="card-link">View all →</div>
          </div>
          <table className="big-tbl">
            <thead>
              <tr>
                <th>Student</th>
                <th>Age</th>
                <th>Enrolled in</th>
                <th>Centre</th>
                <th>Joined</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {STUDENTS.map(s => (
                <tr key={s.name}>
                  <td>
                    <div className="placer-cell">
                      <div className="placer-av" style={{ background: s.av }}>
                        {s.name.split(' ').map(n => n[0]).join('').slice(0,2)}
                      </div>
                      <div>
                        <div className="placer-name">{s.name}</div>
                        <div className="placer-loc">Student ID NLH-{Math.floor(10000 + Math.random()*89999)}</div>
                      </div>
                    </div>
                  </td>
                  <td className="mono">{s.age} yrs</td>
                  <td>
                    {s.enrolled.map(pid => {
                      const p = ALL_PROGRAMS.find(pp => pp.id === pid);
                      return (
                        <span key={pid} className={'stu-chip stu-chip-' + p.tone}>
                          <span>{p.em}</span>{p.name}
                        </span>
                      );
                    })}
                  </td>
                  <td style={{ font: '500 12px var(--font)', color: 'var(--text)' }}>{s.fr}</td>
                  <td className="mono">{s.joined}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button className="row-action">View</button>
                    <button className="row-action">Progress</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────
// KIT PRICES PAGE
// ─────────────────────────────────────────────────────────────────────
const PRICE_DATA = {
  abc: [
    { sku: 'ABC-L1-KIT', name: 'Level 1 — starter kit',     uf: 1250, cf: 1150, smf: 1000 },
    { sku: 'ABC-L2-KIT', name: 'Level 2 — intermediate',    uf: 1550, cf: 1450, smf: 1300 },
    { sku: 'ABC-L3-KIT', name: 'Level 3 — advanced',        uf: 2100, cf: 1950, smf: 1800, changed: true },
    { sku: 'ABC-L4-KIT', name: 'Level 4 — pro',             uf: 2400, cf: 2250, smf: 0 },
    { sku: 'ABC-L5-KIT', name: 'Level 5 — grand master',    uf: 2750, cf: 2500, smf: 2300 },
    { sku: 'ABC-WBK-1', name: 'Workbook set Level 1–3',     uf:  450, cf:  400, smf:  350 },
  ],
  cod: [
    { sku: 'COD-JR-KIT', name: 'Junior coder kit',          uf: 2100, cf: 1900, smf: 1750 },
    { sku: 'COD-SR-KIT', name: 'Senior coder kit',          uf: 2800, cf: 2600, smf: 2400 },
    { sku: 'COD-PY-KIT', name: 'Python starter pack',       uf: 1800, cf: 1650, smf: 1500 },
  ],
  pho: [
    { sku: 'PHO-L1-WBK', name: 'Level 1 workbook set',      uf:  240, cf:  220, smf:  200 },
    { sku: 'PHO-L2-WBK', name: 'Level 2 workbook set',      uf:  320, cf:  290, smf:  260 },
    { sku: 'PHO-FCD-KIT', name: 'Phonics flashcard kit',    uf:  450, cf:  410, smf:  380 },
  ],
  art: [
    { sku: 'ART-TOD-KIT', name: 'Toddler art bundle',       uf:  850, cf:  780, smf:  700 },
    { sku: 'ART-JR-KIT',  name: 'Junior art bundle',        uf: 1100, cf: 1000, smf:  920 },
  ],
  rub: [
    { sku: 'RUB-L1-KIT', name: 'Level 1 cube + manual',     uf:  680, cf:  620, smf:  560 },
    { sku: 'RUB-L2-KIT', name: 'Level 2 speedcube pack',    uf:  920, cf:  840, smf:  760 },
  ],
};
const RECENT_CHANGES = [
  { sku: 'ABC-L3-KIT', tier: 'UF',  from: '1,850', to: '2,100', by: 'Dhiral P', when: '1 hr ago' },
  { sku: 'COD-PY-KIT', tier: 'CF',  from: '1,500', to: '1,650', by: 'Dhiral P', when: '3 hr ago' },
  { sku: 'PHO-L2-WBK', tier: 'SMF', from: '240',  to: '260',   by: 'Dhiral P', when: 'Yesterday' },
  { sku: 'ART-JR-KIT', tier: 'UF',  from: '950',  to: '1,100', by: 'Dhiral P', when: '2 days ago' },
];

function PricesPage() {
  const [active, setActive] = useStateB('abc');
  const rows = PRICE_DATA[active] || [];

  return (
    <>
      <PageTopbar
        crumb="Kit prices"
        search="Search by SKU code…"
        actions={<>
          <button className="btn btn-s">Change log</button>
          <button className="btn btn-p">+ New SKU</button>
        </>}
      />
      <div className="content" data-screen-label="06 Kit prices">
        <PageHeader
          eyebrow="Catalog"
          title="Kit prices"
          sub={<><b>57 SKUs</b> across 16 programs &middot; tier-specific rates for UF, CF, and SMF. Zero is allowed &mdash; renders as <b>Price TBD</b> in the order form.</>}
        />

        <div className="prices-layout">
          <div className="prices-rail">
            <div className="prices-rail-h">Programs</div>
            {ALL_PROGRAMS.slice(0, 12).map(p => (
              <div key={p.id} className={'prices-rail-i ' + (active === p.id ? 'on' : '')}
                onClick={() => setActive(p.id)}>
                <div className={'prices-rail-em pe-' + p.tone}>{p.em}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="prices-rail-name">{p.name}</div>
                  <div className="prices-rail-sub">{p.skus} SKUs &middot; {p.levels} levels</div>
                </div>
              </div>
            ))}
          </div>

          <div className="prices-main">
            <div className="card-h" style={{ borderBottom: '1px solid var(--border)' }}>
              <div>
                <div className="card-t">{ALL_PROGRAMS.find(p => p.id === active)?.name} &middot; price matrix</div>
                <div className="card-ts">All edits auto-logged &middot; orange highlight = recent change</div>
              </div>
              <div className="card-link">View change log →</div>
            </div>
            <div className="prices-notice">
              <span>💡</span>
              <span><b>Heads up.</b> Prices are live &mdash; changes immediately affect what franchisees see when ordering. A zero rate renders as <b>Price TBD</b>.</span>
            </div>
            <table className="prices-tbl">
              <thead>
                <tr>
                  <th>SKU / kit</th>
                  <th className="r">UF rate</th>
                  <th className="r">CF rate</th>
                  <th className="r">SMF rate</th>
                  <th className="r" style={{ width: 60 }}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.sku}>
                    <td>
                      <div className="prices-sku-cell">
                        <div className="prices-sku-name">{r.name}</div>
                        <div className="prices-sku-code">{r.sku}</div>
                      </div>
                    </td>
                    <td>
                      <div className="pinp-wrap">
                        <span className="pinp-cur">₹</span>
                        <input className={'pinp' + (r.changed ? ' ch' : '') + (r.uf === 0 ? ' zero' : '')}
                          defaultValue={r.uf === 0 ? 'TBD' : r.uf.toLocaleString('en-IN')} />
                      </div>
                    </td>
                    <td>
                      <div className="pinp-wrap">
                        <span className="pinp-cur">₹</span>
                        <input className={'pinp' + (r.cf === 0 ? ' zero' : '')}
                          defaultValue={r.cf === 0 ? 'TBD' : r.cf.toLocaleString('en-IN')} />
                      </div>
                    </td>
                    <td>
                      <div className="pinp-wrap">
                        <span className="pinp-cur">₹</span>
                        <input className={'pinp' + (r.smf === 0 ? ' zero' : '')}
                          defaultValue={r.smf === 0 ? 'TBD' : r.smf.toLocaleString('en-IN')} />
                      </div>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="row-action">⋯</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card" style={{ marginBottom: 0 }}>
          <div className="card-h">
            <div>
              <div className="card-t">Recent price changes</div>
              <div className="card-ts">Last 4 edits · auto-logged</div>
            </div>
            <div className="card-link">Full change log →</div>
          </div>
          <table className="big-tbl">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Tier</th>
                <th>From</th>
                <th>To</th>
                <th>Changed by</th>
                <th style={{ textAlign: 'right' }}>When</th>
              </tr>
            </thead>
            <tbody>
              {RECENT_CHANGES.map(c => (
                <tr key={c.sku + c.tier + c.when}>
                  <td className="mono" style={{ color: 'var(--purple)', fontWeight: 600 }}>{c.sku}</td>
                  <td><span className={'tier t-' + c.tier.toLowerCase()}>{c.tier}</span></td>
                  <td className="mono" style={{ color: 'var(--text3)', textDecoration: 'line-through' }}>₹{c.from}</td>
                  <td><span style={{ display:'inline-flex', alignItems:'center', gap:6, font:'600 12px var(--mono)', color:'var(--amber)' }}>↗ ₹{c.to}</span></td>
                  <td style={{ font: '500 12px var(--font)' }}>{c.by}</td>
                  <td className="mono" style={{ textAlign: 'right', color: 'var(--text3)' }}>{c.when}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────
// PROGRAMS PAGE — 16 program cards
// ─────────────────────────────────────────────────────────────────────
const TONE_GRADIENT = {
  1: 'linear-gradient(90deg, #2563EB, #60A5FA)',
  2: 'linear-gradient(90deg, #16A34A, #6EE7B7)',
  3: 'linear-gradient(90deg, #D97706, #FCD34D)',
  4: 'linear-gradient(90deg, #DB2777, #F472B6)',
  5: 'linear-gradient(90deg, #7C3AED, #A78BFA)',
  6: 'linear-gradient(90deg, #0284C7, #38BDF8)',
  7: 'linear-gradient(90deg, #EA580C, #FB923C)',
  8: 'linear-gradient(90deg, #E11D48, #FB7185)',
};

function ProgramsPage() {
  const totalStudents = ALL_PROGRAMS.reduce((s, p) => s + p.students, 0);
  const totalSkus = ALL_PROGRAMS.reduce((s, p) => s + p.skus, 0);

  return (
    <>
      <PageTopbar
        crumb="Programs"
        search="Search programs…"
        actions={<>
          <button className="btn btn-s">Export catalog</button>
          <button className="btn btn-p">+ New program</button>
        </>}
      />
      <div className="content" data-screen-label="07 Programs">
        <PageHeader
          eyebrow="Catalog"
          title="Programs"
          sub={<><b>16 skill-based programs</b> for children aged 2–21. <b>{totalStudents.toLocaleString('en-IN')} students</b> enrolled across <b>{totalSkus} SKUs</b>.</>}
          right={<>
            <span style={{ font: '500 11px var(--mono)', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em', marginRight: 6 }}>15 active &middot; 1 draft</span>
          </>}
        />

        <div className="progs-grid">
          {ALL_PROGRAMS.map(p => (
            <div key={p.id} className="progs-card">
              <div className="progs-bgbar" style={{ background: TONE_GRADIENT[p.tone] }}></div>
              {p.active
                ? <span className="progs-active"><span className="d"></span>Active</span>
                : <span className="progs-active" style={{ background: 'var(--bg3)', color: 'var(--text3)' }}><span className="d" style={{ background: 'var(--text3)' }}></span>Draft</span>
              }
              <div className={'progs-em pe-' + p.tone}>{p.em}</div>
              <div className="progs-name">{p.name}</div>
              <div className="progs-ages">Ages {p.ages}</div>
              <div className="progs-meta">
                <div className="progs-meta-i">
                  <div className="progs-meta-num">{p.students}</div>
                  <div className="progs-meta-lbl">Students</div>
                </div>
                <div className="progs-meta-i">
                  <div className="progs-meta-num">{p.levels}</div>
                  <div className="progs-meta-lbl">Levels</div>
                </div>
                <div className="progs-meta-i">
                  <div className="progs-meta-num">{p.skus}</div>
                  <div className="progs-meta-lbl">SKUs</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

Object.assign(window, { StudentsPage, PricesPage, ProgramsPage });
