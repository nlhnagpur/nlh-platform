import React from 'react'

// "Send the receipt on WhatsApp" opt-in: a checkbox and, when ticked, the
// number to send to. Presentational — the owning form decides what to send.
export default function WhatsAppOptIn({ checked, onChange, phone, onPhoneChange, label, placeholder, children }) {
  return (
    <div style={{ padding: '10px 12px', borderRadius: 10, background: 'var(--green-bg, #f0fdf4)', border: '1px solid var(--green, #1D7A4F)' }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, font: '600 12px var(--font)', color: 'var(--green, #1D7A4F)', cursor: 'pointer' }}>
        <input type="checkbox" checked={!!checked} onChange={function (e) { onChange(e.target.checked) }} />
        {label || '💬 Send WhatsApp receipt'}
      </label>
      {checked && (
        <input
          value={phone} onChange={function (e) { onPhoneChange(e.target.value) }}
          placeholder={placeholder || 'WhatsApp number'}
          style={{ marginTop: 8, fontSize: 13, width: '100%' }}
        />
      )}
      {checked && children}
    </div>
  )
}
