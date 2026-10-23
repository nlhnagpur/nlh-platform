import React from 'react'

const SEV = {
  error: { label: 'Fix', color: '#991B1B', bg: '#FEE2E2' },
  warn:  { label: 'Check', color: '#92400E', bg: '#FEF3C7' },
  info:  { label: 'Note', color: '#475569', bg: '#E2E8F0' },
}

// The payroll check: what looks wrong with this CI's month, and what to do about it.
export default function PayrollCheckPanel({ issues }) {
  if (!issues || !issues.length) return null
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, marginBottom: 12, overflow: 'hidden' }}>
      <div style={{ padding: '8px 14px', background: 'var(--bg3)', font: '600 11px var(--font)', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Payroll check</div>
      {issues.map(function (i, n) {
        return (
          <div key={n} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 14px', borderTop: '1px solid var(--border)' }}>
            <span style={{ font: '700 10px var(--mono)', color: SEV[i.severity].color, background: SEV[i.severity].bg, borderRadius: 10, padding: '2px 8px', whiteSpace: 'nowrap', marginTop: 2 }}>{SEV[i.severity].label}</span>
            <div style={{ font: '500 12px var(--font)', color: 'var(--text2)' }}>
              {i.message}
              {i.action && <div style={{ marginTop: 2, color: 'var(--text3)' }}><b style={{ color: 'var(--text2)' }}>What to do:</b> {i.action}</div>}
            </div>
          </div>
        )
      })}
    </div>
  )
}
