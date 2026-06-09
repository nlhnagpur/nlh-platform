import { useState } from 'react'
import { sb } from '../supabase'
import { showToast } from '../utils'

// Reusable coupon entry + applied-state chip.
// Props:
//   context      'order' | 'student'
//   amount       base amount the discount applies to (whole rupees)
//   franchiseeId for per-franchisee limit checks (optional)
//   applied      { coupon_id, code, discount } | null
//   onApply(obj) called with the validated coupon
//   onClear()    remove the applied coupon
//   disabled     disable input
export default function CouponField({ context, amount, franchiseeId, applied, onApply, onClear, disabled, compact }) {
  const [code, setCode]         = useState('')
  const [checking, setChecking] = useState(false)

  async function apply() {
    const c = code.trim()
    if (!c) return
    setChecking(true)
    const { data, error } = await sb.rpc('validate_coupon', {
      p_code: c,
      p_context: context,
      p_amount: Math.max(0, Math.round(amount || 0)),
      p_franchisee: franchiseeId || null,
    })
    setChecking(false)
    if (error) { showToast('Coupon check failed: ' + error.message, 'err'); return }
    if (!data || !data.valid) { showToast(data?.message || 'Invalid coupon', 'warn'); return }
    if (!data.discount) { showToast('This coupon gives no discount on this amount', 'warn'); return }
    onApply({
      coupon_id: data.coupon_id, code: data.code, discount: data.discount,
      discount_type: data.discount_type, discount_value: data.discount_value,
    })
    setCode('')
    showToast('Coupon ' + data.code + ' applied — ₹' + data.discount + ' off', 'ok')
  }

  function onKey(e) { if (e.key === 'Enter') { e.preventDefault(); apply() } }

  if (applied) {
    return (
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: 8,
        padding: '6px 10px', borderRadius: 10,
        background: 'var(--green-bg)', border: '1px dashed var(--green, #1D7A4F)',
      }}>
        <span style={{ font: '700 12px var(--mono)', color: 'var(--green, #1D7A4F)', letterSpacing: '.04em' }}>
          🎟️ {applied.code}
        </span>
        <span style={{ font: '600 12px var(--font)', color: 'var(--green, #1D7A4F)' }}>−₹{applied.discount}</span>
        {onClear && !disabled && (
          <span onClick={onClear} title="Remove coupon"
            style={{ cursor: 'pointer', color: 'var(--green, #1D7A4F)', fontWeight: 700, marginLeft: 2 }}>✕</span>
        )}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <input
        value={code}
        disabled={disabled}
        onChange={function (e) { setCode(e.target.value.toUpperCase()) }}
        onKeyDown={onKey}
        placeholder="Coupon code"
        style={{
          width: compact ? 130 : 160, textTransform: 'uppercase',
          font: '600 12px var(--mono)', letterSpacing: '.04em',
          padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border2, #d8d5cc)',
        }}
      />
      <button type="button" className="btn-s" onClick={apply} disabled={disabled || checking || !code.trim()}
        style={{ whiteSpace: 'nowrap' }}>
        {checking ? '…' : 'Apply'}
      </button>
    </div>
  )
}
