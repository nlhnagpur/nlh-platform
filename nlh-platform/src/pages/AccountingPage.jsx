import React, { useState, useEffect, useCallback } from 'react'
import { sb } from '../supabase'
import { useAuth } from '../context/AuthContext'
import { fmtAmt, fmtDate, showToast } from '../utils'

// ─── helpers ────────────────────────────────────────────────────────────────
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function fmtMonth(m, y) {
  return MONTHS[(m - 1)] + ' ' + y
}

function currentFY() {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth() + 1
  return m >= 4 ? y : y - 1
}

function rupee(n) {
  if (!n && n !== 0) return '—'
  const abs = Math.abs(Number(n))
  const fmt = abs.toLocaleString('en-IN')
  return (Number(n) < 0 ? '(' : '') + '₹' + fmt + (Number(n) < 0 ? ')' : '')
}

const EXPENSE_CATS = [
  { v: 'salary',           l: 'Staff Salaries' },
  { v: 'rent',             l: 'Rent' },
  { v: 'marketing',        l: 'Marketing' },
  { v: 'software',         l: 'Software & SaaS' },
  { v: 'travel',           l: 'Travel & Conveyance' },
  { v: 'procurement',      l: 'Kit Procurement' },
  { v: 'utilities',        l: 'Utilities' },
  { v: 'professional_fees',l: 'Professional Fees' },
  { v: 'office_supplies',  l: 'Office Supplies' },
  { v: 'other',            l: 'Other' },
]

const PMODES = ['cash','bank_transfer','upi','cheque','card']

// ─── small shared components ─────────────────────────────────────────────────
function Chip({ label, color }) {
  const colors = {
    green:  { bg: 'var(--green-bg)',  color: 'var(--green)' },
    red:    { bg: 'var(--red-bg)',    color: 'var(--red)' },
    amber:  { bg: 'var(--amber-bg)', color: 'var(--amber)' },
    purple: { bg: 'var(--purple-bg)',color: 'var(--purple)' },
    gray:   { bg: 'var(--bg4)',      color: 'var(--text3)' },
  }
  const c = colors[color] || colors.gray
  return (
    <span style={{
      display:'inline-block', padding:'2px 8px', borderRadius:20,
      fontSize:11, fontWeight:600, background:c.bg, color:c.color,
    }}>{label}</span>
  )
}

function StatCard({ label, value, sub, color }) {
  return (
    <div style={{
      background:'var(--bg2)', border:'1px solid var(--border)',
      borderRadius:12, padding:'16px 20px', minWidth:160,
    }}>
      <div style={{ fontSize:12, color:'var(--text3)', marginBottom:4 }}>{label}</div>
      <div style={{ fontSize:22, fontWeight:700, color: color || 'var(--text)', fontFamily:'var(--mono)' }}>{value}</div>
      {sub && <div style={{ fontSize:11, color:'var(--text3)', marginTop:2 }}>{sub}</div>}
    </div>
  )
}

function SplitStatusChip({ status }) {
  const map = {
    pending:  { l:'Pending',  c:'amber' },
    part_paid:{ l:'Part Paid',c:'amber' },
    paid:     { l:'Paid',     c:'green' },
    waived:   { l:'Waived',   c:'gray'  },
  }
  const s = map[status] || { l: status, c: 'gray' }
  return <Chip label={s.l} color={s.c} />
}

// ─── TAB: OVERVIEW / P&L ─────────────────────────────────────────────────────
function OverviewTab() {
  const [loading, setLoading] = useState(true)
  const [month, setMonth]     = useState(new Date().getMonth() + 1)
  const [year, setYear]       = useState(new Date().getFullYear())
  const [data, setData]       = useState(null)

  const load = useCallback(async function() {
    setLoading(true)
    // Income: closed orders this period
    const [ordersRes, enrollRes, expRes, splitsRes] = await Promise.all([
      sb.from('orders')
        .select('amount_paid')
        .eq('status', 'closed')
        .gte('updated_at', new Date(year, month - 1, 1).toISOString())
        .lt('updated_at',  new Date(year, month, 1).toISOString()),
      sb.from('franchisees')
        .select('fee_paid, enrollment_fee')
        .gte('created_at', new Date(year, month - 1, 1).toISOString())
        .lt('created_at',  new Date(year, month, 1).toISOString()),
      sb.from('expenses')
        .select('total_amount, category')
        .gte('date', new Date(year, month - 1, 1).toISOString().slice(0, 10))
        .lte('date', new Date(year, month, 0).toISOString().slice(0, 10)),
      sb.from('revenue_splits')
        .select('amount_owed, amount_paid, status, franchisee_tier')
        .eq('period_year', year)
        .eq('period_month', month),
    ])

    const kitRevenue    = (ordersRes.data || []).reduce((s, r) => s + (r.amount_paid || 0), 0)
    const enrollRevenue = (enrollRes.data  || []).reduce((s, r) => s + (r.fee_paid    || 0), 0)
    const totalIncome   = kitRevenue + enrollRevenue
    const totalExpenses = (expRes.data  || []).reduce((s, r) => s + (r.total_amount || 0), 0)
    const netProfit     = totalIncome - totalExpenses

    const pendingSplits = (splitsRes.data || [])
      .filter(function(s) { return s.status !== 'paid' && s.status !== 'waived' })
      .reduce(function(sum, s) { return sum + (s.amount_owed - s.amount_paid) }, 0)

    const byCategory = {}
    ;(expRes.data || []).forEach(function(e) {
      byCategory[e.category] = (byCategory[e.category] || 0) + (e.total_amount || 0)
    })

    setData({ kitRevenue, enrollRevenue, totalIncome, totalExpenses, netProfit, pendingSplits, byCategory, expenseCount: (expRes.data || []).length })
    setLoading(false)
  }, [month, year])

  useEffect(function() { load() }, [load])

  const years = []
  for (let y = currentFY(); y <= currentFY() + 1; y++) years.push(y)

  return (
    <div>
      {/* Period selector */}
      <div style={{ display:'flex', gap:8, marginBottom:20, flexWrap:'wrap', alignItems:'center' }}>
        <span style={{ color:'var(--text3)', fontSize:13 }}>Period:</span>
        <select className="inp" style={{ width:'auto' }}
          value={month} onChange={function(e) { setMonth(Number(e.target.value)) }}>
          {MONTHS.map(function(m, i) { return <option key={i} value={i+1}>{m}</option> })}
        </select>
        <select className="inp" style={{ width:'auto' }}
          value={year} onChange={function(e) { setYear(Number(e.target.value)) }}>
          {[2024,2025,2026,2027].map(function(y) { return <option key={y} value={y}>{y}</option> })}
        </select>
      </div>

      {loading ? (
        <div style={{ color:'var(--text3)', padding:40, textAlign:'center' }}>Loading P&L…</div>
      ) : (
        <>
          {/* Key metrics */}
          <div style={{ display:'flex', gap:12, flexWrap:'wrap', marginBottom:24 }}>
            <StatCard label="Total Income"    value={rupee(data.totalIncome)}   color="var(--green)" />
            <StatCard label="Total Expenses"  value={rupee(data.totalExpenses)} color="var(--red)" />
            <StatCard label="Net Profit"      value={rupee(data.netProfit)}
              color={data.netProfit >= 0 ? 'var(--green)' : 'var(--red)'} />
            <StatCard label="Pending Payouts" value={rupee(data.pendingSplits)} sub="Owed to CF/SMF" color="var(--amber)" />
          </div>

          {/* P&L breakdown */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
            {/* Income */}
            <div style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:12, padding:20 }}>
              <div style={{ fontWeight:700, marginBottom:12, fontSize:14 }}>📈 Income — {fmtMonth(month,year)}</div>
              <PLRow label="Kit Sales Revenue"       amount={data.kitRevenue} />
              <PLRow label="Franchise Enrollment Fees" amount={data.enrollRevenue} />
              <div style={{ borderTop:'1px solid var(--border)', marginTop:10, paddingTop:10 }}>
                <PLRow label="Total Income" amount={data.totalIncome} bold />
              </div>
            </div>

            {/* Expenses */}
            <div style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:12, padding:20 }}>
              <div style={{ fontWeight:700, marginBottom:12, fontSize:14 }}>📉 Expenses — {fmtMonth(month,year)}</div>
              {data.expenseCount === 0 ? (
                <div style={{ color:'var(--text3)', fontSize:13 }}>No expenses recorded</div>
              ) : (
                Object.entries(data.byCategory).map(function([cat, amt]) {
                  const label = (EXPENSE_CATS.find(function(e) { return e.v === cat }) || { l: cat }).l
                  return <PLRow key={cat} label={label} amount={amt} />
                })
              )}
              <div style={{ borderTop:'1px solid var(--border)', marginTop:10, paddingTop:10 }}>
                <PLRow label="Total Expenses" amount={data.totalExpenses} bold />
              </div>
            </div>
          </div>

          {/* Net profit bar */}
          <div style={{
            marginTop:16, background:'var(--bg2)', border:'1px solid var(--border)',
            borderRadius:12, padding:20, display:'flex', alignItems:'center', gap:20,
          }}>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:13, color:'var(--text3)', marginBottom:4 }}>Net Profit / Loss</div>
              <div style={{ fontSize:28, fontWeight:800, fontFamily:'var(--mono)',
                color: data.netProfit >= 0 ? 'var(--green)' : 'var(--red)' }}>
                {rupee(data.netProfit)}
              </div>
            </div>
            {data.totalIncome > 0 && (
              <div style={{ textAlign:'center' }}>
                <div style={{ fontSize:11, color:'var(--text3)' }}>Profit Margin</div>
                <div style={{ fontSize:20, fontWeight:700, color: data.netProfit >= 0 ? 'var(--green)' : 'var(--red)' }}>
                  {Math.round(data.netProfit / data.totalIncome * 100)}%
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function PLRow({ label, amount, bold }) {
  return (
    <div style={{ display:'flex', justifyContent:'space-between', padding:'4px 0',
      fontWeight: bold ? 700 : 400, fontSize: bold ? 14 : 13 }}>
      <span style={{ color: bold ? 'var(--text)' : 'var(--text2)' }}>{label}</span>
      <span style={{ fontFamily:'var(--mono)' }}>{rupee(amount)}</span>
    </div>
  )
}

// ─── TAB: CHART OF ACCOUNTS ──────────────────────────────────────────────────
function AccountsTab() {
  const [accounts, setAccounts] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [filter,   setFilter]   = useState('all')
  const [showAdd,  setShowAdd]  = useState(false)

  async function load() {
    setLoading(true)
    const { data } = await sb.from('accounts').select('*').order('code')
    setAccounts(data || [])
    setLoading(false)
  }

  useEffect(function() { load() }, [])

  const TYPE_COLORS = {
    asset:     'green',
    liability: 'red',
    equity:    'purple',
    income:    'green',
    expense:   'amber',
  }

  const filtered = filter === 'all' ? accounts : accounts.filter(function(a) { return a.type === filter })

  return (
    <div>
      <div className="tb-r" style={{ marginBottom:16 }}>
        <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
          {['all','asset','liability','equity','income','expense'].map(function(t) {
            return (
              <button key={t} className={'btn btn-s' + (filter === t ? ' btn-primary' : '')}
                style={{ textTransform:'capitalize' }}
                onClick={function() { setFilter(t) }}>
                {t}
              </button>
            )
          })}
        </div>
        <button className="btn btn-primary btn-s" onClick={function() { setShowAdd(true) }}>
          + Add Account
        </button>
      </div>

      {loading ? (
        <div style={{ color:'var(--text3)', textAlign:'center', padding:40 }}>Loading…</div>
      ) : (
        <div className="tbl-scroll">
          <table className="big-tbl" style={{ minWidth:600 }}>
            <thead>
              <tr>
                <th>Code</th><th>Account Name</th><th>Type</th><th>Subtype</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(function(a) {
                return (
                  <tr key={a.id} style={{ opacity: a.is_active ? 1 : 0.5 }}>
                    <td><code style={{ fontFamily:'var(--mono)', fontSize:13 }}>{a.code}</code></td>
                    <td>
                      <span style={{ fontWeight: a.is_system ? 600 : 400 }}>{a.name}</span>
                      {a.is_system && <span style={{ fontSize:10, color:'var(--text3)', marginLeft:6 }}>system</span>}
                    </td>
                    <td><Chip label={a.type} color={TYPE_COLORS[a.type] || 'gray'} /></td>
                    <td style={{ color:'var(--text3)', fontSize:12 }}>{a.subtype || '—'}</td>
                    <td><Chip label={a.is_active ? 'Active' : 'Inactive'} color={a.is_active ? 'green' : 'gray'} /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {showAdd && <AddAccountModal onClose={function() { setShowAdd(false) }} onSaved={function() { setShowAdd(false); load() }} accounts={accounts} />}
    </div>
  )
}

function AddAccountModal({ onClose, onSaved, accounts }) {
  const [form, setForm] = useState({ code:'', name:'', type:'expense', subtype:'opex', parent_id:'', description:'' })
  const [saving, setSaving] = useState(false)

  function set(k, v) { setForm(function(f) { return { ...f, [k]: v } }) }

  async function save() {
    if (!form.code.trim() || !form.name.trim()) { showToast('Code and name required.', 'warn'); return }
    setSaving(true)
    const { error } = await sb.from('accounts').insert({
      code: form.code.trim(),
      name: form.name.trim(),
      type: form.type,
      subtype: form.subtype || null,
      parent_id: form.parent_id || null,
      description: form.description || null,
    })
    if (error) { showToast('Error: ' + error.message, 'err'); setSaving(false); return }
    showToast('Account added.')
    onSaved()
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={function(e) { e.stopPropagation() }}>
        <div className="ch">
          <h3>Add Account</h3>
          <button style={{ background:'none',border:'none',cursor:'pointer',fontSize:18,color:'var(--text3)' }} onClick={onClose}>×</button>
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 2fr', gap:10 }}>
            <div>
              <label className="lbl">Code *</label>
              <input className="inp" placeholder="e.g. 6011" value={form.code} onChange={function(e) { set('code', e.target.value) }} />
            </div>
            <div>
              <label className="lbl">Name *</label>
              <input className="inp" placeholder="Account name" value={form.name} onChange={function(e) { set('name', e.target.value) }} />
            </div>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
            <div>
              <label className="lbl">Type</label>
              <select className="inp" value={form.type} onChange={function(e) { set('type', e.target.value) }}>
                {['asset','liability','equity','income','expense'].map(function(t) { return <option key={t} value={t}>{t}</option> })}
              </select>
            </div>
            <div>
              <label className="lbl">Subtype</label>
              <input className="inp" placeholder="e.g. opex, bank, tax" value={form.subtype} onChange={function(e) { set('subtype', e.target.value) }} />
            </div>
          </div>
          <div>
            <label className="lbl">Parent Account (optional)</label>
            <select className="inp" value={form.parent_id} onChange={function(e) { set('parent_id', e.target.value) }}>
              <option value="">— None —</option>
              {accounts.filter(function(a) { return a.type === form.type }).map(function(a) {
                return <option key={a.id} value={a.id}>{a.code} – {a.name}</option>
              })}
            </select>
          </div>
          <div>
            <label className="lbl">Description</label>
            <input className="inp" placeholder="Optional note" value={form.description} onChange={function(e) { set('description', e.target.value) }} />
          </div>
        </div>
        <div className="ch" style={{ marginTop:16, justifyContent:'flex-end' }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Add Account'}</button>
        </div>
      </div>
    </div>
  )
}

// ─── TAB: EXPENSES ───────────────────────────────────────────────────────────
function ExpensesTab() {
  const { currentUser } = useAuth()
  const [expenses,  setExpenses]  = useState([])
  const [accounts,  setAccounts]  = useState([])
  const [bankAccts, setBankAccts] = useState([])
  const [vendors,   setVendors]   = useState([])
  const [loading,   setLoading]   = useState(true)
  const [showAdd,   setShowAdd]   = useState(false)
  const [filterCat, setFilterCat] = useState('all')
  const [filterMon, setFilterMon] = useState('')

  async function load() {
    setLoading(true)
    const [expRes, accRes, bankRes, venRes] = await Promise.all([
      sb.from('expenses').select('*').order('date', { ascending: false }).limit(200),
      sb.from('accounts').select('id,code,name,type').eq('type','expense').order('code'),
      sb.from('bank_accounts').select('id,name').eq('is_active', true),
      sb.from('vendors').select('id,name').eq('is_active', true),
    ])
    setExpenses(expRes.data || [])
    setAccounts(accRes.data || [])
    setBankAccts(bankRes.data || [])
    setVendors(venRes.data || [])
    setLoading(false)
  }

  useEffect(function() { load() }, [])

  const filtered = expenses.filter(function(e) {
    if (filterCat !== 'all' && e.category !== filterCat) return false
    if (filterMon && !e.date.startsWith(filterMon)) return false
    return true
  })

  const totalFiltered = filtered.reduce(function(s, e) { return s + (e.total_amount || 0) }, 0)

  function exportCSV() {
    const headers = ['Date','Category','Description','Vendor','Amount','GST','Total','Mode','Ref']
    const rows = filtered.map(function(e) {
      const cat = (EXPENSE_CATS.find(function(c) { return c.v === e.category }) || { l: e.category }).l
      return [e.date, cat, e.description, e.vendor_name || '', e.amount, e.gst_amount, e.total_amount, e.payment_mode || '', e.payment_ref || '']
    })
    const csv = [headers, ...rows].map(function(r) { return r.map(function(c) { return '"' + String(c).replace(/"/g, '""') + '"' }).join(',') }).join('\n')
    const blob = new Blob([csv], { type:'text/csv' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
    a.download = 'nlh-expenses-' + (filterMon || 'all') + '.csv'; a.click()
  }

  return (
    <div>
      <div className="tb-r" style={{ marginBottom:16 }}>
        <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
          <select className="inp" style={{ width:'auto' }} value={filterCat}
            onChange={function(e) { setFilterCat(e.target.value) }}>
            <option value="all">All Categories</option>
            {EXPENSE_CATS.map(function(c) { return <option key={c.v} value={c.v}>{c.l}</option> })}
          </select>
          <input type="month" className="inp" style={{ width:'auto' }} value={filterMon}
            onChange={function(e) { setFilterMon(e.target.value) }} />
          {filtered.length > 0 && (
            <span style={{ fontSize:13, color:'var(--text3)', marginLeft:4 }}>
              {filtered.length} entries · <b style={{ fontFamily:'var(--mono)' }}>{rupee(totalFiltered)}</b>
            </span>
          )}
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button className="btn btn-s" onClick={exportCSV}>↓<span className="btn-label"> Export</span></button>
          <button className="btn btn-primary btn-s" onClick={function() { setShowAdd(true) }}>
            + <span className="btn-label">Add Expense</span>
          </button>
        </div>
      </div>


      {loading ? (
        <div style={{ color:'var(--text3)', textAlign:'center', padding:40 }}>Loading…</div>
      ) : filtered.length === 0 ? (
        <div style={{ color:'var(--text3)', textAlign:'center', padding:40 }}>
          No expenses recorded. Click "+ Add Expense" to start.
        </div>
      ) : (
        <div className="tbl-scroll">
          <table className="big-tbl" style={{ minWidth:700 }}>
            <thead>
              <tr><th>Date</th><th>Category</th><th>Description</th><th>Vendor</th><th>Amount</th><th>GST</th><th>Total</th><th>Mode</th></tr>
            </thead>
            <tbody>
              {filtered.map(function(e) {
                const catLabel = (EXPENSE_CATS.find(function(c) { return c.v === e.category }) || { l: e.category }).l
                return (
                  <tr key={e.id}>
                    <td style={{ fontFamily:'var(--mono)', fontSize:12 }}>{e.date}</td>
                    <td><Chip label={catLabel} color="amber" /></td>
                    <td>{e.description}</td>
                    <td style={{ color:'var(--text3)' }}>{e.vendor_name || '—'}</td>
                    <td style={{ fontFamily:'var(--mono)', textAlign:'right' }}>₹{fmtAmt(e.amount)}</td>
                    <td style={{ fontFamily:'var(--mono)', textAlign:'right', color:'var(--text3)' }}>
                      {e.gst_amount ? '₹' + fmtAmt(e.gst_amount) : '—'}
                    </td>
                    <td style={{ fontFamily:'var(--mono)', textAlign:'right', fontWeight:600 }}>₹{fmtAmt(e.total_amount)}</td>
                    <td style={{ color:'var(--text3)', fontSize:12 }}>{e.payment_mode || '—'}</td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr style={{ fontWeight:700, background:'var(--bg3)' }}>
                <td colSpan={4}>Total</td>
                <td style={{ fontFamily:'var(--mono)', textAlign:'right' }}>
                  ₹{fmtAmt(filtered.reduce(function(s,e) { return s + e.amount }, 0))}
                </td>
                <td style={{ fontFamily:'var(--mono)', textAlign:'right' }}>
                  ₹{fmtAmt(filtered.reduce(function(s,e) { return s + (e.gst_amount||0) }, 0))}
                </td>
                <td style={{ fontFamily:'var(--mono)', textAlign:'right' }}>
                  ₹{fmtAmt(totalFiltered)}
                </td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {showAdd && (
        <AddExpenseModal
          accounts={accounts} bankAccts={bankAccts} vendors={vendors} userId={currentUser?.id}
          onClose={function() { setShowAdd(false) }}
          onSaved={function() { setShowAdd(false); load() }}
        />
      )}
    </div>
  )
}

function AddExpenseModal({ accounts, bankAccts, vendors, userId, onClose, onSaved }) {
  const today = new Date().toISOString().slice(0, 10)
  const [form, setForm] = useState({
    date: today, category: 'salary', description: '', vendor_name: '', vendor_id: '',
    amount: '', gst_amount: '0', payment_mode: 'bank_transfer', payment_ref: '',
    bank_account_id: '', expense_account_id: '', is_recurring: false, recurrence: '',
  })
  const [saving, setSaving] = useState(false)

  function set(k, v) { setForm(function(f) { return { ...f, [k]: v } }) }

  const total = (Number(form.amount) || 0) + (Number(form.gst_amount) || 0)

  async function save() {
    if (!form.description.trim())  { showToast('Description required.', 'warn'); return }
    if (!form.amount || Number(form.amount) <= 0) { showToast('Amount must be > 0.', 'warn'); return }
    setSaving(true)

    const fy = await sb.from('fiscal_years').select('id').eq('is_current', true).single()

    // Post journal entry: Dr Expense Account, Cr Bank/Cash
    let journalId = null
    if (fy.data && form.expense_account_id && form.bank_account_id) {
      const bankAcc = await sb.from('bank_accounts').select('account_id').eq('id', form.bank_account_id).single()
      if (bankAcc.data?.account_id) {
        const jeRes = await sb.from('journal_entries').insert({
          entry_no: (await sb.rpc('next_journal_no')).data,
          date: form.date,
          fiscal_year_id: fy.data.id,
          description: 'Expense: ' + form.description,
          source: 'expense',
          source_ref_type: 'expense',
          created_by: userId,
        }).select('id').single()

        if (jeRes.data) {
          journalId = jeRes.data.id
          await sb.from('journal_lines').insert([
            { journal_entry_id: journalId, account_id: form.expense_account_id, debit: total, description: form.description },
            { journal_entry_id: journalId, account_id: bankAcc.data.account_id, credit: total, description: form.description },
          ])
          await sb.from('journal_entries').update({ source_ref_type: 'expense' }).eq('id', journalId)
        }
      }
    }

    const { error } = await sb.from('expenses').insert({
      date:              form.date,
      category:          form.category,
      description:       form.description.trim(),
      vendor_name:       form.vendor_name || null,
      vendor_id:         form.vendor_id   || null,
      amount:            Number(form.amount),
      gst_amount:        Number(form.gst_amount) || 0,
      total_amount:      total,
      payment_mode:      form.payment_mode || null,
      payment_ref:       form.payment_ref  || null,
      bank_account_id:   form.bank_account_id || null,
      expense_account_id:form.expense_account_id || null,
      is_recurring:      form.is_recurring,
      recurrence:        form.recurrence || null,
      journal_entry_id:  journalId,
      created_by:        userId,
    })

    if (error) { showToast('Error: ' + error.message, 'err'); setSaving(false); return }
    showToast('Expense recorded.')
    onSaved()
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" style={{ maxWidth:540 }} onClick={function(e) { e.stopPropagation() }}>
        <div className="ch">
          <h3>Add Expense</h3>
          <button style={{ background:'none',border:'none',cursor:'pointer',fontSize:18,color:'var(--text3)' }} onClick={onClose}>×</button>
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
            <div>
              <label className="lbl">Date *</label>
              <input type="date" className="inp" value={form.date} onChange={function(e) { set('date', e.target.value) }} />
            </div>
            <div>
              <label className="lbl">Category *</label>
              <select className="inp" value={form.category} onChange={function(e) { set('category', e.target.value) }}>
                {EXPENSE_CATS.map(function(c) { return <option key={c.v} value={c.v}>{c.l}</option> })}
              </select>
            </div>
          </div>
          <div>
            <label className="lbl">Description *</label>
            <input className="inp" placeholder="e.g. Office rent for May 2026" value={form.description}
              onChange={function(e) { set('description', e.target.value) }} />
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
            <div>
              <label className="lbl">Vendor Name</label>
              <input className="inp" placeholder="Optional" value={form.vendor_name}
                onChange={function(e) { set('vendor_name', e.target.value) }} />
            </div>
            <div>
              <label className="lbl">Vendor (from list)</label>
              <select className="inp" value={form.vendor_id} onChange={function(e) { set('vendor_id', e.target.value) }}>
                <option value="">— Select —</option>
                {vendors.map(function(v) { return <option key={v.id} value={v.id}>{v.name}</option> })}
              </select>
            </div>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
            <div>
              <label className="lbl">Amount (pre-GST) *</label>
              <input type="number" className="inp" placeholder="₹" value={form.amount}
                onChange={function(e) { set('amount', e.target.value) }} />
            </div>
            <div>
              <label className="lbl">GST Amount</label>
              <input type="number" className="inp" placeholder="0" value={form.gst_amount}
                onChange={function(e) { set('gst_amount', e.target.value) }} />
            </div>
          </div>
          <div style={{ background:'var(--bg3)', borderRadius:8, padding:'8px 12px', fontSize:14 }}>
            Total: <strong style={{ fontFamily:'var(--mono)' }}>₹{fmtAmt(total)}</strong>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
            <div>
              <label className="lbl">Payment Mode</label>
              <select className="inp" value={form.payment_mode} onChange={function(e) { set('payment_mode', e.target.value) }}>
                {PMODES.map(function(m) { return <option key={m} value={m}>{m}</option> })}
              </select>
            </div>
            <div>
              <label className="lbl">UTR / Ref No.</label>
              <input className="inp" placeholder="Optional" value={form.payment_ref}
                onChange={function(e) { set('payment_ref', e.target.value) }} />
            </div>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
            <div>
              <label className="lbl">Paid from Bank Account</label>
              <select className="inp" value={form.bank_account_id} onChange={function(e) { set('bank_account_id', e.target.value) }}>
                <option value="">— Select —</option>
                {bankAccts.map(function(b) { return <option key={b.id} value={b.id}>{b.name}</option> })}
              </select>
            </div>
            <div>
              <label className="lbl">Expense Account (Ledger)</label>
              <select className="inp" value={form.expense_account_id} onChange={function(e) { set('expense_account_id', e.target.value) }}>
                <option value="">— Select —</option>
                {accounts.map(function(a) { return <option key={a.id} value={a.id}>{a.code} – {a.name}</option> })}
              </select>
            </div>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <input type="checkbox" id="rec" checked={form.is_recurring}
              onChange={function(e) { set('is_recurring', e.target.checked) }} />
            <label htmlFor="rec" style={{ fontSize:13, cursor:'pointer' }}>Recurring expense</label>
            {form.is_recurring && (
              <select className="inp" style={{ width:'auto' }} value={form.recurrence}
                onChange={function(e) { set('recurrence', e.target.value) }}>
                <option value="">Frequency…</option>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="annual">Annual</option>
              </select>
            )}
          </div>
        </div>
        <div className="ch" style={{ marginTop:16, justifyContent:'flex-end' }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Record Expense'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── TAB: JOURNAL LEDGER ─────────────────────────────────────────────────────
function JournalTab() {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(null)
  const [filterSrc, setFilterSrc] = useState('all')

  async function load() {
    setLoading(true)
    const { data } = await sb.from('journal_entries')
      .select('*, journal_lines(*, accounts(code, name))')
      .order('date', { ascending: false })
      .limit(150)
    setEntries(data || [])
    setLoading(false)
  }

  useEffect(function() { load() }, [])

  const SOURCES = ['all','manual','order','enrollment','expense','split','bank','opening','adjustment']
  const filtered = filterSrc === 'all' ? entries : entries.filter(function(e) { return e.source === filterSrc })

  function SrcChip({ source }) {
    const map = { manual:'gray', order:'green', enrollment:'purple', expense:'amber', split:'red', bank:'green', opening:'gray', adjustment:'gray' }
    return <Chip label={source} color={map[source] || 'gray'} />
  }

  return (
    <div>
      <div className="tb-r" style={{ marginBottom:16 }}>
        <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
          {SOURCES.map(function(s) {
            return (
              <button key={s} className={'btn btn-s' + (filterSrc === s ? ' btn-primary' : '')}
                style={{ textTransform:'capitalize' }}
                onClick={function() { setFilterSrc(s) }}>
                {s}
              </button>
            )
          })}
        </div>
      </div>

      {loading ? (
        <div style={{ color:'var(--text3)', textAlign:'center', padding:40 }}>Loading journal…</div>
      ) : filtered.length === 0 ? (
        <div style={{ color:'var(--text3)', textAlign:'center', padding:40 }}>No journal entries yet.</div>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          {filtered.map(function(entry) {
            const isOpen = expanded === entry.id
            const lines = entry.journal_lines || []
            const totalDr = lines.reduce(function(s,l) { return s + (l.debit||0) }, 0)
            return (
              <div key={entry.id} style={{
                background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:10,
                overflow:'hidden',
              }}>
                <div
                  style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 16px', cursor:'pointer' }}
                  onClick={function() { setExpanded(isOpen ? null : entry.id) }}
                >
                  <code style={{ fontFamily:'var(--mono)', fontSize:12, color:'var(--purple)', minWidth:120 }}>
                    {entry.entry_no}
                  </code>
                  <span style={{ fontSize:12, color:'var(--text3)', minWidth:90 }}>{entry.date}</span>
                  <SrcChip source={entry.source} />
                  <span style={{ flex:1, fontSize:13, color:'var(--text2)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                    {entry.description}
                  </span>
                  <span style={{ fontFamily:'var(--mono)', fontWeight:600, fontSize:13 }}>₹{fmtAmt(totalDr)}</span>
                  <span style={{ color:'var(--text3)', fontSize:12 }}>{isOpen ? '▲' : '▼'}</span>
                </div>
                {isOpen && (
                  <div style={{ borderTop:'1px solid var(--border)', padding:'12px 16px', background:'var(--bg3)' }}>
                    <table style={{ width:'100%', fontSize:13, borderCollapse:'collapse' }}>
                      <thead>
                        <tr style={{ color:'var(--text3)', fontWeight:600 }}>
                          <th style={{ textAlign:'left', paddingBottom:6 }}>Account</th>
                          <th style={{ textAlign:'right', paddingBottom:6 }}>Debit</th>
                          <th style={{ textAlign:'right', paddingBottom:6 }}>Credit</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lines.map(function(l) {
                          return (
                            <tr key={l.id}>
                              <td style={{ padding:'3px 0' }}>
                                <code style={{ fontFamily:'var(--mono)', fontSize:11, color:'var(--text3)' }}>
                                  {l.accounts?.code}
                                </code>
                                {' '}{l.accounts?.name}
                                {l.description && <span style={{ color:'var(--text3)', fontSize:11 }}> — {l.description}</span>}
                              </td>
                              <td style={{ textAlign:'right', fontFamily:'var(--mono)', color: l.debit ? 'var(--green)' : 'var(--text3)' }}>
                                {l.debit ? '₹' + fmtAmt(l.debit) : '—'}
                              </td>
                              <td style={{ textAlign:'right', fontFamily:'var(--mono)', color: l.credit ? 'var(--red)' : 'var(--text3)' }}>
                                {l.credit ? '₹' + fmtAmt(l.credit) : '—'}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── TAB: REVENUE SPLITS ─────────────────────────────────────────────────────
function SplitsTab() {
  const [splits,   setSplits]   = useState([])
  const [loading,  setLoading]  = useState(true)
  const [showAdd,  setShowAdd]  = useState(false)
  const [paying,   setPaying]   = useState(null)  // split id being paid
  const [filterStatus, setFilterStatus] = useState('pending')

  async function load() {
    setLoading(true)
    const { data } = await sb.from('revenue_splits')
      .select('*, franchisees(business_name, owner_name, tier)')
      .order('created_at', { ascending: false })
      .limit(200)
    setSplits(data || [])
    setLoading(false)
  }

  useEffect(function() { load() }, [])

  const filtered = filterStatus === 'all' ? splits : splits.filter(function(s) { return s.status === filterStatus })

  const totalOwed = filtered.reduce(function(s, r) { return s + (r.amount_owed - r.amount_paid) }, 0)

  async function markPaid(split, ref) {
    const { error } = await sb.from('revenue_splits').update({
      amount_paid: split.amount_owed,
      status: 'paid',
      paid_at: new Date().toISOString(),
      payment_ref: ref || null,
    }).eq('id', split.id)
    if (error) { showToast('Error: ' + error.message, 'err'); return }
    showToast('Marked as paid.')
    setPaying(null)
    load()
  }

  return (
    <div>
      <div style={{ marginBottom:16, padding:'12px 16px', background:'var(--amber-bg)', border:'1px solid var(--amber)', borderRadius:10, fontSize:13 }}>
        <strong>Revenue Split Rules:</strong> When a student pays fees at a UF — CF gets 25%, SMF gets 25%, NLH keeps 25%, UF keeps 50% (UF share stays with them).
        Record splits here when franchisees pay their share to HO.
      </div>

      <div className="tb-r" style={{ marginBottom:16 }}>
        <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
          {['all','pending','part_paid','paid','waived'].map(function(s) {
            return (
              <button key={s} className={'btn btn-s' + (filterStatus === s ? ' btn-primary' : '')}
                style={{ textTransform:'capitalize' }}
                onClick={function() { setFilterStatus(s) }}>
                {s.replace('_',' ')}
              </button>
            )
          })}
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          {totalOwed > 0 && (
            <span style={{ fontSize:13, color:'var(--amber)', fontWeight:600 }}>
              Outstanding: ₹{fmtAmt(totalOwed)}
            </span>
          )}
          <button className="btn btn-primary btn-s" onClick={function() { setShowAdd(true) }}>
            + <span className="btn-label">Add Split</span>
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{ color:'var(--text3)', textAlign:'center', padding:40 }}>Loading…</div>
      ) : filtered.length === 0 ? (
        <div style={{ color:'var(--text3)', textAlign:'center', padding:40 }}>No records.</div>
      ) : (
        <div className="tbl-scroll">
          <table className="big-tbl" style={{ minWidth:720 }}>
            <thead>
              <tr><th>Period</th><th>Franchisee</th><th>Tier</th><th>Total Fee</th><th>Split %</th><th>Owed</th><th>Paid</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {filtered.map(function(s) {
                const outstanding = s.amount_owed - s.amount_paid
                return (
                  <tr key={s.id}>
                    <td style={{ fontFamily:'var(--mono)', fontSize:12 }}>{fmtMonth(s.period_month, s.period_year)}</td>
                    <td>
                      <div style={{ fontWeight:500 }}>{s.franchisees?.business_name || '—'}</div>
                      <div style={{ fontSize:11, color:'var(--text3)' }}>{s.franchisees?.owner_name}</div>
                    </td>
                    <td><Chip label={s.franchisee_tier} color={s.franchisee_tier === 'CF' ? 'green' : 'purple'} /></td>
                    <td style={{ fontFamily:'var(--mono)', textAlign:'right' }}>₹{fmtAmt(s.total_fee_collected)}</td>
                    <td style={{ textAlign:'center' }}>{s.split_percentage}%</td>
                    <td style={{ fontFamily:'var(--mono)', textAlign:'right', fontWeight:600 }}>₹{fmtAmt(s.amount_owed)}</td>
                    <td style={{ fontFamily:'var(--mono)', textAlign:'right', color:'var(--green)' }}>
                      {s.amount_paid ? '₹' + fmtAmt(s.amount_paid) : '—'}
                    </td>
                    <td><SplitStatusChip status={s.status} /></td>
                    <td>
                      {(s.status === 'pending' || s.status === 'part_paid') && (
                        <button className="btn btn-s btn-primary"
                          onClick={function() { setPaying(s) }}>
                          Mark Paid
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {showAdd && <AddSplitModal onClose={function() { setShowAdd(false) }} onSaved={function() { setShowAdd(false); load() }} />}
      {paying   && <MarkPaidModal split={paying} onClose={function() { setPaying(null) }} onPaid={markPaid} />}
    </div>
  )
}

function AddSplitModal({ onClose, onSaved }) {
  const now = new Date()
  const [form, setForm] = useState({
    franchisee_id: '', franchisee_tier: 'CF',
    period_month: now.getMonth() + 1, period_year: now.getFullYear(),
    total_fee_collected: '', split_percentage: '25', notes: '',
  })
  const [franchisees, setFranchisees] = useState([])
  const [saving, setSaving] = useState(false)

  useEffect(function() {
    sb.from('franchisees').select('id,business_name,owner_name,tier')
      .in('tier', ['CF','SMF']).eq('status','active').order('business_name')
      .then(function({ data }) { setFranchisees(data || []) })
  }, [])

  function set(k, v) { setForm(function(f) { return { ...f, [k]: v } }) }

  const amount_owed = Math.round((Number(form.total_fee_collected) || 0) * (Number(form.split_percentage) || 0) / 100)

  async function save() {
    if (!form.franchisee_id) { showToast('Select franchisee.', 'warn'); return }
    if (!form.total_fee_collected) { showToast('Enter fee collected.', 'warn'); return }
    setSaving(true)
    const { error } = await sb.from('revenue_splits').insert({
      franchisee_id:       form.franchisee_id,
      franchisee_tier:     form.franchisee_tier,
      period_month:        Number(form.period_month),
      period_year:         Number(form.period_year),
      total_fee_collected: Number(form.total_fee_collected),
      split_percentage:    Number(form.split_percentage),
      amount_owed,
      notes: form.notes || null,
    })
    if (error) { showToast('Error: ' + error.message, 'err'); setSaving(false); return }
    showToast('Split record added.')
    onSaved()
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={function(e) { e.stopPropagation() }}>
        <div className="ch">
          <h3>Add Revenue Split</h3>
          <button style={{ background:'none',border:'none',cursor:'pointer',fontSize:18,color:'var(--text3)' }} onClick={onClose}>×</button>
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
            <div>
              <label className="lbl">Period Month</label>
              <select className="inp" value={form.period_month} onChange={function(e) { set('period_month', e.target.value) }}>
                {MONTHS.map(function(m,i) { return <option key={i} value={i+1}>{m}</option> })}
              </select>
            </div>
            <div>
              <label className="lbl">Period Year</label>
              <select className="inp" value={form.period_year} onChange={function(e) { set('period_year', e.target.value) }}>
                {[2024,2025,2026,2027].map(function(y) { return <option key={y} value={y}>{y}</option> })}
              </select>
            </div>
          </div>
          <div>
            <label className="lbl">Franchisee</label>
            <select className="inp" value={form.franchisee_id} onChange={function(e) {
              const f = franchisees.find(function(x) { return x.id === e.target.value })
              set('franchisee_id', e.target.value)
              if (f) set('franchisee_tier', f.tier)
            }}>
              <option value="">— Select CF or SMF —</option>
              {franchisees.map(function(f) {
                return <option key={f.id} value={f.id}>[{f.tier}] {f.business_name} — {f.owner_name}</option>
              })}
            </select>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
            <div>
              <label className="lbl">Total Fee Collected (₹)</label>
              <input type="number" className="inp" placeholder="Student fee paid" value={form.total_fee_collected}
                onChange={function(e) { set('total_fee_collected', e.target.value) }} />
            </div>
            <div>
              <label className="lbl">Split % (25 = CF/SMF share)</label>
              <input type="number" className="inp" value={form.split_percentage}
                onChange={function(e) { set('split_percentage', e.target.value) }} />
            </div>
          </div>
          <div style={{ background:'var(--bg3)', borderRadius:8, padding:'10px 14px', fontSize:14 }}>
            Amount owed: <strong style={{ fontFamily:'var(--mono)' }}>₹{fmtAmt(amount_owed)}</strong>
          </div>
          <div>
            <label className="lbl">Notes</label>
            <input className="inp" placeholder="Optional" value={form.notes} onChange={function(e) { set('notes', e.target.value) }} />
          </div>
        </div>
        <div className="ch" style={{ marginTop:16, justifyContent:'flex-end' }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Add Record'}</button>
        </div>
      </div>
    </div>
  )
}

function MarkPaidModal({ split, onClose, onPaid }) {
  const [ref, setRef] = useState('')
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" style={{ maxWidth:380 }} onClick={function(e) { e.stopPropagation() }}>
        <div className="ch">
          <h3>Mark as Paid</h3>
          <button style={{ background:'none',border:'none',cursor:'pointer',fontSize:18,color:'var(--text3)' }} onClick={onClose}>×</button>
        </div>
        <p style={{ fontSize:14, color:'var(--text2)', margin:'8px 0 16px' }}>
          Marking <strong>₹{fmtAmt(split.amount_owed - split.amount_paid)}</strong> as received
          from <strong>{split.franchisees?.business_name}</strong>.
        </p>
        <label className="lbl">Payment Reference (UTR/Cheque)</label>
        <input className="inp" placeholder="Optional" value={ref} onChange={function(e) { setRef(e.target.value) }} />
        <div className="ch" style={{ marginTop:16, justifyContent:'flex-end' }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={function() { onPaid(split, ref) }}>Confirm Paid</button>
        </div>
      </div>
    </div>
  )
}

// ─── TAB: VENDORS ────────────────────────────────────────────────────────────
function VendorsTab() {
  const [vendors,  setVendors]  = useState([])
  const [loading,  setLoading]  = useState(true)
  const [showAdd,  setShowAdd]  = useState(false)
  const [selected, setSelected] = useState(null)

  async function load() {
    setLoading(true)
    const { data } = await sb.from('vendors').select('*').order('name')
    setVendors(data || [])
    setLoading(false)
  }

  useEffect(function() { load() }, [])

  return (
    <div>
      <div className="tb-r" style={{ marginBottom:16 }}>
        <div style={{ fontSize:13, color:'var(--text3)' }}>{vendors.length} vendors</div>
        <button className="btn btn-primary btn-s" onClick={function() { setShowAdd(true) }}>
          + <span className="btn-label">Add Vendor</span>
        </button>
      </div>

      {loading ? (
        <div style={{ color:'var(--text3)', textAlign:'center', padding:40 }}>Loading…</div>
      ) : vendors.length === 0 ? (
        <div style={{ color:'var(--text3)', textAlign:'center', padding:40 }}>No vendors yet.</div>
      ) : (
        <div className="tbl-scroll">
          <table className="big-tbl" style={{ minWidth:640 }}>
            <thead>
              <tr><th>Name</th><th>Contact</th><th>Phone / Email</th><th>City</th><th>GSTIN</th><th>Terms</th><th>Status</th></tr>
            </thead>
            <tbody>
              {vendors.map(function(v) {
                return (
                  <tr key={v.id} style={{ cursor:'pointer' }} onClick={function() { setSelected(v) }}>
                    <td style={{ fontWeight:500 }}>{v.name}</td>
                    <td style={{ color:'var(--text3)' }}>{v.contact_person || '—'}</td>
                    <td>
                      <div style={{ fontSize:12 }}>{v.phone || '—'}</div>
                      <div style={{ fontSize:11, color:'var(--text3)' }}>{v.email || ''}</div>
                    </td>
                    <td style={{ color:'var(--text3)' }}>{v.city || '—'}</td>
                    <td><code style={{ fontFamily:'var(--mono)', fontSize:11 }}>{v.gstin || '—'}</code></td>
                    <td style={{ color:'var(--text3)' }}>{v.payment_terms ? v.payment_terms + 'd' : '—'}</td>
                    <td><Chip label={v.is_active ? 'Active' : 'Inactive'} color={v.is_active ? 'green' : 'gray'} /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {showAdd    && <AddVendorModal onClose={function() { setShowAdd(false) }} onSaved={function() { setShowAdd(false); load() }} />}
      {selected   && <VendorDetailModal vendor={selected} onClose={function() { setSelected(null) }} onUpdated={function() { setSelected(null); load() }} />}
    </div>
  )
}

function AddVendorModal({ onClose, onSaved }) {
  const [form, setForm] = useState({ name:'', contact_person:'', phone:'', email:'', address:'', city:'', state:'', gstin:'', pan:'', payment_terms:'30' })
  const [saving, setSaving] = useState(false)
  function set(k, v) { setForm(function(f) { return { ...f, [k]: v } }) }

  async function save() {
    if (!form.name.trim()) { showToast('Vendor name required.', 'warn'); return }
    setSaving(true)
    const { error } = await sb.from('vendors').insert({
      name: form.name.trim(),
      contact_person: form.contact_person || null,
      phone: form.phone || null,
      email: form.email || null,
      address: form.address || null,
      city: form.city || null,
      state: form.state || null,
      gstin: form.gstin || null,
      pan: form.pan || null,
      payment_terms: Number(form.payment_terms) || 30,
    })
    if (error) { showToast('Error: ' + error.message, 'err'); setSaving(false); return }
    showToast('Vendor added.')
    onSaved()
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" style={{ maxWidth:500 }} onClick={function(e) { e.stopPropagation() }}>
        <div className="ch">
          <h3>Add Vendor</h3>
          <button style={{ background:'none',border:'none',cursor:'pointer',fontSize:18,color:'var(--text3)' }} onClick={onClose}>×</button>
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
            <div>
              <label className="lbl">Vendor Name *</label>
              <input className="inp" placeholder="Company name" value={form.name} onChange={function(e) { set('name', e.target.value) }} />
            </div>
            <div>
              <label className="lbl">Contact Person</label>
              <input className="inp" placeholder="Full name" value={form.contact_person} onChange={function(e) { set('contact_person', e.target.value) }} />
            </div>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
            <div>
              <label className="lbl">Phone</label>
              <input className="inp" value={form.phone} onChange={function(e) { set('phone', e.target.value) }} />
            </div>
            <div>
              <label className="lbl">Email</label>
              <input type="email" className="inp" value={form.email} onChange={function(e) { set('email', e.target.value) }} />
            </div>
          </div>
          <div>
            <label className="lbl">Address</label>
            <input className="inp" value={form.address} onChange={function(e) { set('address', e.target.value) }} />
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10 }}>
            <div>
              <label className="lbl">City</label>
              <input className="inp" value={form.city} onChange={function(e) { set('city', e.target.value) }} />
            </div>
            <div>
              <label className="lbl">State</label>
              <input className="inp" value={form.state} onChange={function(e) { set('state', e.target.value) }} />
            </div>
            <div>
              <label className="lbl">Payment Terms (days)</label>
              <input type="number" className="inp" value={form.payment_terms} onChange={function(e) { set('payment_terms', e.target.value) }} />
            </div>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
            <div>
              <label className="lbl">GSTIN</label>
              <input className="inp" placeholder="22AAAAA0000A1Z5" value={form.gstin} onChange={function(e) { set('gstin', e.target.value) }} />
            </div>
            <div>
              <label className="lbl">PAN</label>
              <input className="inp" placeholder="AAAAA0000A" value={form.pan} onChange={function(e) { set('pan', e.target.value) }} />
            </div>
          </div>
        </div>
        <div className="ch" style={{ marginTop:16, justifyContent:'flex-end' }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Add Vendor'}</button>
        </div>
      </div>
    </div>
  )
}

function VendorDetailModal({ vendor, onClose, onUpdated }) {
  const [deactivating, setDeactivating] = useState(false)

  async function toggleActive() {
    setDeactivating(true)
    await sb.from('vendors').update({ is_active: !vendor.is_active }).eq('id', vendor.id)
    showToast(vendor.is_active ? 'Vendor deactivated.' : 'Vendor reactivated.')
    onUpdated()
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" style={{ maxWidth:420 }} onClick={function(e) { e.stopPropagation() }}>
        <div className="ch">
          <h3>{vendor.name}</h3>
          <button style={{ background:'none',border:'none',cursor:'pointer',fontSize:18,color:'var(--text3)' }} onClick={onClose}>×</button>
        </div>
        <table style={{ width:'100%', fontSize:13, borderCollapse:'collapse' }}>
          <tbody>
            {[
              ['Contact', vendor.contact_person],
              ['Phone',   vendor.phone],
              ['Email',   vendor.email],
              ['City',    vendor.city],
              ['State',   vendor.state],
              ['GSTIN',   vendor.gstin],
              ['PAN',     vendor.pan],
              ['Payment Terms', vendor.payment_terms ? vendor.payment_terms + ' days' : null],
              ['Status',  vendor.is_active ? 'Active' : 'Inactive'],
            ].map(function([k, v]) {
              return (
                <tr key={k} style={{ borderBottom:'1px solid var(--border)' }}>
                  <td style={{ padding:'8px 0', color:'var(--text3)', width:130 }}>{k}</td>
                  <td style={{ padding:'8px 0', fontWeight:500 }}>{v || '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <div className="ch" style={{ marginTop:16, justifyContent:'flex-end' }}>
          <button className="btn" onClick={onClose}>Close</button>
          <button className="btn" style={{ background:'var(--red-bg)', color:'var(--red)', border:'1px solid var(--red)' }}
            onClick={toggleActive} disabled={deactivating}>
            {vendor.is_active ? 'Deactivate' : 'Reactivate'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── TAB: BANK ACCOUNTS ──────────────────────────────────────────────────────
function BankAccountsTab() {
  const [banks,   setBanks]   = useState([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [accounts, setAccounts] = useState([])

  async function load() {
    setLoading(true)
    const [bankRes, accRes] = await Promise.all([
      sb.from('bank_accounts').select('*').order('name'),
      sb.from('accounts').select('id,code,name').eq('subtype','bank'),
    ])
    setBanks(bankRes.data || [])
    setAccounts(accRes.data || [])
    setLoading(false)
  }

  useEffect(function() { load() }, [])

  return (
    <div>
      <div className="tb-r" style={{ marginBottom:16 }}>
        <div style={{ fontSize:13, color:'var(--text3)' }}>{banks.length} bank account{banks.length !== 1 ? 's' : ''}</div>
        <button className="btn btn-primary btn-s" onClick={function() { setShowAdd(true) }}>
          + <span className="btn-label">Add Bank Account</span>
        </button>
      </div>

      {loading ? (
        <div style={{ color:'var(--text3)', textAlign:'center', padding:40 }}>Loading…</div>
      ) : banks.length === 0 ? (
        <div style={{ color:'var(--text3)', textAlign:'center', padding:40 }}>
          No bank accounts yet. Add your NLH HO bank accounts to enable journal auto-posting.
        </div>
      ) : (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))', gap:16 }}>
          {banks.map(function(b) {
            return (
              <div key={b.id} style={{
                background:'var(--bg2)', border:'1px solid var(--border)',
                borderRadius:12, padding:20,
                opacity: b.is_active ? 1 : 0.6,
              }}>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:8 }}>
                  <div style={{ fontWeight:700, fontSize:15 }}>{b.name}</div>
                  <Chip label={b.is_active ? 'Active' : 'Inactive'} color={b.is_active ? 'green' : 'gray'} />
                </div>
                <div style={{ fontSize:12, color:'var(--text3)', marginBottom:4 }}>{b.bank_name}</div>
                <code style={{ fontFamily:'var(--mono)', fontSize:13 }}>{b.account_no}</code>
                {b.ifsc && <div style={{ fontSize:11, color:'var(--text3)', marginTop:4 }}>IFSC: {b.ifsc}</div>}
                {b.opening_balance > 0 && (
                  <div style={{ marginTop:10, fontSize:13 }}>
                    Opening: <span style={{ fontFamily:'var(--mono)', fontWeight:600 }}>₹{fmtAmt(b.opening_balance)}</span>
                    {b.opening_date && <span style={{ color:'var(--text3)', fontSize:11 }}> as of {b.opening_date}</span>}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {showAdd && <AddBankModal accounts={accounts} onClose={function() { setShowAdd(false) }} onSaved={function() { setShowAdd(false); load() }} />}
    </div>
  )
}

function AddBankModal({ accounts, onClose, onSaved }) {
  const [form, setForm] = useState({ name:'', bank_name:'', account_no:'', ifsc:'', branch:'', opening_balance:'0', opening_date:'', account_id:'' })
  const [saving, setSaving] = useState(false)
  function set(k, v) { setForm(function(f) { return { ...f, [k]: v } }) }

  async function save() {
    if (!form.name.trim() || !form.bank_name.trim() || !form.account_no.trim()) {
      showToast('Name, bank, and account number required.', 'warn'); return
    }
    setSaving(true)
    const { error } = await sb.from('bank_accounts').insert({
      name: form.name.trim(),
      bank_name: form.bank_name.trim(),
      account_no: form.account_no.trim(),
      ifsc: form.ifsc || null,
      branch: form.branch || null,
      opening_balance: Number(form.opening_balance) || 0,
      opening_date: form.opening_date || null,
      account_id: form.account_id || null,
    })
    if (error) { showToast('Error: ' + error.message, 'err'); setSaving(false); return }
    showToast('Bank account added.')
    onSaved()
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" style={{ maxWidth:480 }} onClick={function(e) { e.stopPropagation() }}>
        <div className="ch">
          <h3>Add Bank Account</h3>
          <button style={{ background:'none',border:'none',cursor:'pointer',fontSize:18,color:'var(--text3)' }} onClick={onClose}>×</button>
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          <div>
            <label className="lbl">Display Name *</label>
            <input className="inp" placeholder="e.g. HDFC Current – NLH Nagpur" value={form.name} onChange={function(e) { set('name', e.target.value) }} />
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
            <div>
              <label className="lbl">Bank Name *</label>
              <input className="inp" placeholder="HDFC Bank" value={form.bank_name} onChange={function(e) { set('bank_name', e.target.value) }} />
            </div>
            <div>
              <label className="lbl">Account Number *</label>
              <input className="inp" value={form.account_no} onChange={function(e) { set('account_no', e.target.value) }} />
            </div>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
            <div>
              <label className="lbl">IFSC Code</label>
              <input className="inp" placeholder="HDFC0001234" value={form.ifsc} onChange={function(e) { set('ifsc', e.target.value) }} />
            </div>
            <div>
              <label className="lbl">Branch</label>
              <input className="inp" value={form.branch} onChange={function(e) { set('branch', e.target.value) }} />
            </div>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
            <div>
              <label className="lbl">Opening Balance (₹)</label>
              <input type="number" className="inp" value={form.opening_balance} onChange={function(e) { set('opening_balance', e.target.value) }} />
            </div>
            <div>
              <label className="lbl">As of Date</label>
              <input type="date" className="inp" value={form.opening_date} onChange={function(e) { set('opening_date', e.target.value) }} />
            </div>
          </div>
          <div>
            <label className="lbl">Link to Ledger Account</label>
            <select className="inp" value={form.account_id} onChange={function(e) { set('account_id', e.target.value) }}>
              <option value="">— Select bank account in ledger —</option>
              {accounts.map(function(a) { return <option key={a.id} value={a.id}>{a.code} – {a.name}</option> })}
            </select>
          </div>
        </div>
        <div className="ch" style={{ marginTop:16, justifyContent:'flex-end' }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Add Account'}</button>
        </div>
      </div>
    </div>
  )
}

// ─── MAIN PAGE ───────────────────────────────────────────────────────────────
const TABS = [
  { id: 'overview',  l: 'P&L Overview',       icon: '📊' },
  { id: 'expenses',  l: 'Expenses',            icon: '📉' },
  { id: 'splits',    l: 'Revenue Splits',      icon: '🔀' },
  { id: 'journal',   l: 'Journal Ledger',      icon: '📒' },
  { id: 'accounts',  l: 'Chart of Accounts',   icon: '🗂' },
  { id: 'vendors',   l: 'Vendors',             icon: '🏭' },
  { id: 'banks',     l: 'Bank Accounts',       icon: '🏦' },
]

export default function AccountingPage() {
  const { currentRole } = useAuth()
  const [tab, setTab] = useState('overview')

  if (!['owner', 'super_admin', 'admin', 'manager'].includes(currentRole)) {
    return (
      <div style={{ padding:40, textAlign:'center', color:'var(--text3)' }}>
        <div style={{ fontSize:48, marginBottom:12 }}>🔒</div>
        <div style={{ fontSize:16, fontWeight:600 }}>HO Accounting — Restricted</div>
        <div style={{ marginTop:8 }}>This section is only accessible to HO admin team.</div>
      </div>
    )
  }

  return (
    <div style={{ padding:'20px 24px', maxWidth:1100, margin:'0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom:20 }}>
        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:4 }}>
          <span style={{ fontSize:22 }}>📚</span>
          <h2 style={{ margin:0, fontSize:20, fontWeight:700 }}>HO Accounting</h2>
          <span style={{
            fontSize:10, fontWeight:700, letterSpacing:1, padding:'2px 8px',
            background:'var(--purple-bg)', color:'var(--purple)', borderRadius:20
          }}>HEAD OFFICE ONLY</span>
        </div>
        <div style={{ color:'var(--text3)', fontSize:13 }}>
          Double-entry bookkeeping · Income, expenses, P&L, revenue splits, vendor ledger
        </div>
      </div>

      {/* Tab bar */}
      <div style={{
        display:'flex', gap:4, flexWrap:'wrap', marginBottom:24,
        background:'var(--bg2)', padding:4, borderRadius:10,
        border:'1px solid var(--border)',
      }}>
        {TABS.map(function(t) {
          return (
            <button
              key={t.id}
              onClick={function() { setTab(t.id) }}
              style={{
                padding:'6px 14px', borderRadius:8, border:'none', cursor:'pointer',
                fontWeight: tab === t.id ? 700 : 400,
                fontSize:13,
                background: tab === t.id ? 'var(--purple)' : 'transparent',
                color: tab === t.id ? '#fff' : 'var(--text2)',
                display:'flex', alignItems:'center', gap:6,
                transition:'all 0.15s',
              }}
            >
              <span>{t.icon}</span>
              <span className="btn-label">{t.l}</span>
            </button>
          )
        })}
      </div>

      {/* Tab content */}
      <div>
        {tab === 'overview' && <OverviewTab />}
        {tab === 'expenses' && <ExpensesTab />}
        {tab === 'splits'   && <SplitsTab />}
        {tab === 'journal'  && <JournalTab />}
        {tab === 'accounts' && <AccountsTab />}
        {tab === 'vendors'  && <VendorsTab />}
        {tab === 'banks'    && <BankAccountsTab />}
      </div>
    </div>
  )
}
