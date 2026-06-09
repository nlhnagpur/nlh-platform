import { useState, useEffect } from 'react'
import { sb } from '../supabase'
import { useAuth } from '../context/AuthContext'
import { isManagerOrAbove } from '../constants/roles'
import { fmtAmt, fmtDate, showToast } from '../utils'

const APPLIES_LABEL = { orders: 'Orders only', students: 'Admissions only', both: 'Orders + Admissions' }

function discountLabel(c) {
  return c.discount_type === 'percent'
    ? c.discount_value + '% off' + (c.max_discount ? ' (max ₹' + fmtAmt(c.max_discount) + ')' : '')
    : '₹' + fmtAmt(c.discount_value) + ' off'
}

function statusOf(c) {
  if (!c.active) return { label: 'Inactive', color: 'var(--text3)', bg: 'var(--bg4, #EFEEE9)' }
  const now = new Date()
  if (c.valid_from && now < new Date(c.valid_from))  return { label: 'Scheduled', color: '#1D4ED8', bg: '#DBEAFE' }
  if (c.valid_until && now > new Date(c.valid_until)) return { label: 'Expired', color: 'var(--red, #dc2626)', bg: '#FEE2E2' }
  if (c.usage_limit != null && c.used_count >= c.usage_limit) return { label: 'Used up', color: '#B45309', bg: '#FEF3C7' }
  return { label: 'Active', color: 'var(--green, #1D7A4F)', bg: 'var(--green-bg)' }
}

// ── Create / edit modal ────────────────────────────────────────────────────
function CouponModal({ coupon, currentUserId, onClose, onSaved }) {
  const editing = !!coupon
  const [f, setF] = useState(function () {
    return {
      code: coupon?.code || '',
      description: coupon?.description || '',
      discount_type: coupon?.discount_type || 'percent',
      discount_value: coupon?.discount_value ?? '',
      applies_to: coupon?.applies_to || 'both',
      min_amount: coupon?.min_amount ?? '',
      max_discount: coupon?.max_discount ?? '',
      usage_limit: coupon?.usage_limit ?? '',
      per_franchisee_limit: coupon?.per_franchisee_limit ?? '',
      valid_from: coupon?.valid_from ? coupon.valid_from.slice(0, 10) : '',
      valid_until: coupon?.valid_until ? coupon.valid_until.slice(0, 10) : '',
      active: coupon?.active ?? true,
    }
  })
  const [saving, setSaving] = useState(false)
  function set(k, v) { setF(function (p) { return Object.assign({}, p, { [k]: v }) }) }

  async function save() {
    const code = (f.code || '').trim().toUpperCase()
    if (!code) { showToast('Enter a coupon code', 'warn'); return }
    if (!f.discount_value || Number(f.discount_value) <= 0) { showToast('Enter a discount value', 'warn'); return }
    if (f.discount_type === 'percent' && Number(f.discount_value) > 100) { showToast('Percentage cannot exceed 100', 'warn'); return }
    const row = {
      code: code,
      description: f.description || null,
      discount_type: f.discount_type,
      discount_value: Number(f.discount_value),
      applies_to: f.applies_to,
      min_amount: f.min_amount === '' ? 0 : Math.round(Number(f.min_amount)),
      max_discount: f.max_discount === '' ? null : Math.round(Number(f.max_discount)),
      usage_limit: f.usage_limit === '' ? null : Math.round(Number(f.usage_limit)),
      per_franchisee_limit: f.per_franchisee_limit === '' ? null : Math.round(Number(f.per_franchisee_limit)),
      valid_from: f.valid_from || null,
      valid_until: f.valid_until || null,
      active: !!f.active,
    }
    setSaving(true)
    let error
    if (editing) {
      ({ error } = await sb.from('coupons').update(row).eq('id', coupon.id))
    } else {
      row.created_by = currentUserId || null
      ;({ error } = await sb.from('coupons').insert(row))
    }
    setSaving(false)
    if (error) {
      showToast(/duplicate|unique/i.test(error.message) ? 'That code already exists' : 'Save failed: ' + error.message, 'err')
      return
    }
    showToast(editing ? 'Coupon updated' : 'Coupon created', 'ok')
    onSaved()
  }

  const isPct = f.discount_type === 'percent'

  return (
    <div className="modal-bg" onClick={function (e) { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ width: 560, maxWidth: '96vw' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <h3 style={{ margin: 0, font: '800 16px var(--font)' }}>{editing ? 'Edit coupon' : 'New coupon'}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text3)' }}>✕</button>
        </div>

        <div className="form-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label className="col-span-2" style={{ gridColumn: 'span 2' }}>
            <span style={lbl}>Code</span>
            <input value={f.code} onChange={function (e) { set('code', e.target.value.toUpperCase()) }}
              placeholder="e.g. WELCOME10" style={Object.assign({}, inp, { textTransform: 'uppercase', fontFamily: 'var(--mono)', letterSpacing: '.05em' })} />
          </label>
          <label className="col-span-2" style={{ gridColumn: 'span 2' }}>
            <span style={lbl}>Description (internal)</span>
            <input value={f.description} onChange={function (e) { set('description', e.target.value) }}
              placeholder="e.g. New admission festive offer" style={inp} />
          </label>

          <label>
            <span style={lbl}>Discount type</span>
            <select value={f.discount_type} onChange={function (e) { set('discount_type', e.target.value) }} style={inp}>
              <option value="percent">Percentage (%)</option>
              <option value="flat">Flat amount (₹)</option>
            </select>
          </label>
          <label>
            <span style={lbl}>{isPct ? 'Percent off' : 'Amount off (₹)'}</span>
            <input type="number" value={f.discount_value} onChange={function (e) { set('discount_value', e.target.value) }}
              placeholder={isPct ? '10' : '500'} style={inp} />
          </label>

          <label>
            <span style={lbl}>Applies to</span>
            <select value={f.applies_to} onChange={function (e) { set('applies_to', e.target.value) }} style={inp}>
              <option value="both">Orders + Admissions</option>
              <option value="orders">Orders only</option>
              <option value="students">Admissions only</option>
            </select>
          </label>
          <label>
            <span style={lbl}>Min. amount (₹)</span>
            <input type="number" value={f.min_amount} onChange={function (e) { set('min_amount', e.target.value) }}
              placeholder="0" style={inp} />
          </label>

          {isPct && (
            <label>
              <span style={lbl}>Max discount cap (₹)</span>
              <input type="number" value={f.max_discount} onChange={function (e) { set('max_discount', e.target.value) }}
                placeholder="no cap" style={inp} />
            </label>
          )}
          <label>
            <span style={lbl}>Total usage limit</span>
            <input type="number" value={f.usage_limit} onChange={function (e) { set('usage_limit', e.target.value) }}
              placeholder="unlimited" style={inp} />
          </label>
          <label>
            <span style={lbl}>Per-franchisee limit</span>
            <input type="number" value={f.per_franchisee_limit} onChange={function (e) { set('per_franchisee_limit', e.target.value) }}
              placeholder="unlimited" style={inp} />
          </label>

          <label>
            <span style={lbl}>Valid from</span>
            <input type="date" value={f.valid_from} onChange={function (e) { set('valid_from', e.target.value) }} style={inp} />
          </label>
          <label>
            <span style={lbl}>Valid until</span>
            <input type="date" value={f.valid_until} onChange={function (e) { set('valid_until', e.target.value) }} style={inp} />
          </label>

          <label className="col-span-2" style={{ gridColumn: 'span 2', display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
            <input type="checkbox" checked={f.active} onChange={function (e) { set('active', e.target.checked) }} />
            <span style={{ font: '600 13px var(--font)', color: 'var(--text)' }}>Active</span>
          </label>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn-p" onClick={save} disabled={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Create coupon'}</button>
        </div>
      </div>
    </div>
  )
}

const lbl = { display: 'block', font: '600 11px var(--font)', color: 'var(--text2)', marginBottom: 4 }
const inp = { width: '100%', font: '500 13px var(--font)', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border2, #d8d5cc)', boxSizing: 'border-box' }

export default function CouponsPage() {
  const { currentRole, currentUser } = useAuth()
  const canManage = isManagerOrAbove(currentRole)

  const [rows, setRows]     = useState([])
  const [loading, setLoad]  = useState(true)
  const [search, setSearch] = useState('')
  const [modal, setModal]   = useState(null)  // null | 'new' | coupon object

  useEffect(function () { load() }, [])
  async function load() {
    setLoad(true)
    const { data, error } = await sb.from('coupons').select('*').order('created_at', { ascending: false })
    if (error) showToast('Failed to load coupons: ' + error.message, 'err')
    setRows(data || [])
    setLoad(false)
  }

  async function toggleActive(c) {
    const { error } = await sb.from('coupons').update({ active: !c.active }).eq('id', c.id)
    if (error) { showToast('Update failed: ' + error.message, 'err'); return }
    showToast(c.active ? 'Coupon deactivated' : 'Coupon activated')
    load()
  }

  async function remove(c) {
    if (c.used_count > 0) {
      showToast('This coupon has been redeemed — deactivate it instead of deleting (keeps records intact).', 'warn')
      return
    }
    if (!window.confirm('Delete coupon ' + c.code + '? This cannot be undone.')) return
    const { error } = await sb.from('coupons').delete().eq('id', c.id)
    if (error) { showToast('Delete failed: ' + error.message, 'err'); return }
    showToast('Coupon deleted')
    load()
  }

  const q = search.trim().toLowerCase()
  const filtered = rows.filter(function (c) {
    return !q || (c.code || '').toLowerCase().includes(q) || (c.description || '').toLowerCase().includes(q)
  })

  const activeCount = rows.filter(function (c) { return statusOf(c).label === 'Active' }).length
  const totalRedeems = rows.reduce(function (s, c) { return s + (c.used_count || 0) }, 0)

  return (
    <div className="pg">
      <header className="tb">
        <div className="crumb">Settings <span className="sep">›</span> <b>Discount coupons</b></div>
        <div className="tb-r">
          <input className="search tb-search" placeholder="Search code…" value={search}
            onChange={function (e) { setSearch(e.target.value) }} />
          {canManage && <button className="btn-p" onClick={function () { setModal('new') }}>+ New coupon</button>}
        </div>
      </header>

      <div className="content">
        <div className="ph">
          <div className="ph-l">
            <div className="ph-eyebrow"><span className="dot"></span>Promotions</div>
            <h1 className="ph-title">Discount coupons</h1>
            <div className="ph-sub">
              <b>{rows.length} coupons</b> · {activeCount} active · {totalRedeems} redemptions.
              {' '}Codes can be applied on franchisee orders and on student admissions.
            </div>
          </div>
        </div>

        {loading ? (
          <div className="loading"><span className="spinner" />Loading coupons…</div>
        ) : filtered.length === 0 ? (
          <div className="empty">
            No coupons yet.{canManage && ' Create your first one with “+ New coupon”.'}
          </div>
        ) : (
          <div className="card tbl-scroll" style={{ padding: 0, overflow: 'hidden' }}>
            <table className="big-tbl">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Discount</th>
                  <th className="hide-mobile">Applies to</th>
                  <th>Usage</th>
                  <th className="hide-mobile">Validity</th>
                  <th>Status</th>
                  {canManage && <th style={{ textAlign: 'right' }}>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {filtered.map(function (c) {
                  const st = statusOf(c)
                  return (
                    <tr key={c.id}>
                      <td>
                        <div style={{ font: '700 13px var(--mono)', color: 'var(--text)', letterSpacing: '.04em' }}>{c.code}</div>
                        {c.description && <div style={{ font: '500 11px var(--font)', color: 'var(--text3)' }}>{c.description}</div>}
                      </td>
                      <td style={{ font: '600 12px var(--font)', color: 'var(--purple)' }}>{discountLabel(c)}
                        {c.min_amount > 0 && <div style={{ font: '500 10px var(--font)', color: 'var(--text3)' }}>min ₹{fmtAmt(c.min_amount)}</div>}
                      </td>
                      <td className="hide-mobile" style={{ fontSize: 12, color: 'var(--text2)' }}>{APPLIES_LABEL[c.applies_to]}</td>
                      <td style={{ fontSize: 12 }}>
                        <span style={{ font: '700 12px var(--mono)', color: 'var(--text)' }}>{c.used_count || 0}</span>
                        <span style={{ color: 'var(--text3)' }}> / {c.usage_limit == null ? '∞' : c.usage_limit}</span>
                      </td>
                      <td className="hide-mobile" style={{ fontSize: 11, color: 'var(--text3)' }}>
                        {c.valid_from || c.valid_until
                          ? (c.valid_from ? fmtDate(c.valid_from) : '…') + ' → ' + (c.valid_until ? fmtDate(c.valid_until) : '…')
                          : 'Always'}
                      </td>
                      <td>
                        <span style={{ font: '600 10px var(--font)', color: st.color, background: st.bg, borderRadius: 20, padding: '2px 9px', whiteSpace: 'nowrap' }}>{st.label}</span>
                      </td>
                      {canManage && (
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <button className="btn-s" style={{ padding: '4px 9px', marginRight: 4 }} onClick={function () { setModal(c) }}>Edit</button>
                          <button className="btn-s" style={{ padding: '4px 9px', marginRight: 4 }} onClick={function () { toggleActive(c) }}>{c.active ? 'Deactivate' : 'Activate'}</button>
                          <button className="btn-s" style={{ padding: '4px 9px', color: 'var(--red, #dc2626)' }} onClick={function () { remove(c) }}>Delete</button>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modal && (
        <CouponModal
          coupon={modal === 'new' ? null : modal}
          currentUserId={currentUser?.id}
          onClose={function () { setModal(null) }}
          onSaved={function () { setModal(null); load() }}
        />
      )}
    </div>
  )
}
