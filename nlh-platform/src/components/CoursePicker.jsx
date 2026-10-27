import React from 'react'
import { fmtAmt } from '../utils'

// Pastel, as on the dashboard: programmes take the colours in turn, so neighbouring cards never match.
const PAL = [
  { bg: '#EDE9FE', fg: '#5B21B6', line: '#C4B5FD' }, { bg: '#DCFCE7', fg: '#166534', line: '#86EFAC' },
  { bg: '#FEF3C7', fg: '#92400E', line: '#FCD34D' }, { bg: '#FCE7F3', fg: '#9D174D', line: '#F9A8D4' },
  { bg: '#DBEAFE', fg: '#1E40AF', line: '#93C5FD' }, { bg: '#CCFBF1', fg: '#115E59', line: '#5EEAD4' },
  { bg: '#FFEDD5', fg: '#9A3412', line: '#FDBA74' }, { bg: '#ECFCCB', fg: '#3F6212', line: '#BEF264' },
  { bg: '#FAE8FF', fg: '#86198F', line: '#F0ABFC' }, { bg: '#E0F2FE', fg: '#075985', line: '#7DD3FC' },
  { bg: '#FFE4E6', fg: '#9F1239', line: '#FDA4AF' }, { bg: '#FEF9C3', fg: '#854D0E', line: '#FDE047' },
]

const chip = { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 14, font: '500 11.5px var(--font)', whiteSpace: 'nowrap', lineHeight: 1.5 }

// One card per programme, every level a chip — all programmes visible together. Used by both the New Student
// form and the Add Course panel so a course is picked the same way everywhere.
//   groups:   [{ name, skus: [{ id, level_name, student_fee }] }]   levels in curriculum order
//   selected: the sku objects ticked now          onToggle(sku): tick / untick
//   enrolled: optional { [sku_id]: 'Completed 13 Oct 2026' | 'Discontinued' | 'Enrolled' } — levels the student already has
//             (shown as green pills, not tickable); the first level after the furthest one reached is marked NEXT and
//             a level before it is marked as an earlier level.
export default function CoursePicker({ groups, selected, onToggle, enrolled }) {
  const have = enrolled || {}
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
      {(groups || []).map(function (g, gi) {
        const T = PAL[gi % PAL.length]
        const idxOf = function (id) { return g.skus.findIndex(function (x) { return x.id === id }) }
        const enrolledHere = g.skus.filter(function (s) { return have[s.id] })
        const reachedIdx = enrolledHere.reduce(function (m, e) { return Math.max(m, idxOf(e.id)) }, -1)
        const nextId = (g.skus.filter(function (x) { return !have[x.id] && idxOf(x.id) > reachedIdx })[0] || {}).id
        if (!g.skus.length) return null
        return (
          <div key={g.name} style={{ border: '1px solid ' + T.line, borderRadius: 10, overflow: 'hidden', background: T.bg + '55' }}>
            <div style={{ background: T.bg, color: T.fg, borderBottom: '1px solid ' + T.line, font: '700 11px var(--font)', letterSpacing: '0.06em', textTransform: 'uppercase', padding: '6px 12px' }}>{g.name}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, padding: '10px 12px' }}>
              {g.skus.map(function (sku) {
                if (have[sku.id]) {
                  return (
                    <span key={sku.id} title={have[sku.id]} style={{ ...chip, background: '#dcfce7', border: '1px solid #bbf7d0', color: '#166534' }}>
                      ✓ {sku.level_name}<span style={{ font: '500 9.5px var(--mono)', opacity: 0.8 }}>{have[sku.id]}</span>
                    </span>
                  )
                }
                const checked = (selected || []).some(function (x) { return x.id === sku.id })
                const isNext = sku.id === nextId && enrolledHere.length > 0
                const isEarlier = enrolledHere.length > 0 && idxOf(sku.id) < reachedIdx
                return (
                  <label key={sku.id} title={isEarlier ? 'Earlier level — not needed' : (isNext ? 'Next level' : '')} style={{
                    ...chip, cursor: 'pointer', position: 'relative',
                    background: checked ? T.fg : 'var(--card)',
                    color: checked ? '#fff' : (isEarlier ? 'var(--text3)' : 'var(--text)'),
                    border: checked ? '1px solid ' + T.fg : (isNext ? '1.5px solid ' + T.fg : (isEarlier ? '1px dashed var(--border)' : '1px solid ' + T.line)),
                  }}>
                    <input type="checkbox" checked={checked} onChange={function () { onToggle(sku) }} style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }} />
                    {checked ? '✓ ' : ''}{sku.level_name}
                    {sku.student_fee ? <span style={{ font: '500 9.5px var(--mono)', opacity: 0.75 }}>₹{fmtAmt(sku.student_fee)}</span> : null}
                    {isNext && !checked && <span style={{ font: '700 9px var(--mono)', color: T.fg }}>→ NEXT</span>}
                  </label>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
