import React from 'react'
import { PAGE_PERMS, ACTION_PERMS, PRESETS, normalizePerms } from '../constants/permissions'

export default function PermissionsEditor({ value, onChange }) {
  const perms = value || {}

  function set(next) { onChange(normalizePerms(next)) }
  function toggle(key) {
    const next = Object.assign({}, perms)
    if (next[key]) delete next[key]; else next[key] = true
    set(next)
  }
  function activePreset() {
    const on = Object.keys(perms).filter(function (k) { return perms[k] }).sort().join(',')
    const hit = PRESETS.find(function (p) { return Object.keys(p.perms).sort().join(',') === on })
    return hit ? hit.id : null
  }
  const current = activePreset()

  return (
    <div>
      <label className="lbl">Start from a preset</label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 4 }}>
        {PRESETS.map(function (p) {
          return (
            <button key={p.id} type="button" title={p.desc}
              className={current === p.id ? 'btn-p btn-sm' : 'btn-s btn-sm'}
              onClick={function () { set(Object.assign({}, p.perms)) }}>
              {p.label}
            </button>
          )
        })}
        <button type="button" className="btn-s btn-sm" onClick={function () { set({}) }}>Clear all</button>
      </div>
      <div className="hint" style={{ marginBottom: 12 }}>
        {current ? PRESETS.find(function (p) { return p.id === current }).desc : 'Custom selection — tick anything below.'}
      </div>

      <label className="lbl">Pages they can open</label>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(180px,1fr))', gap: '6px 12px', marginBottom: 14 }}>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', opacity: 0.6 }}>
          <input type="checkbox" checked disabled /> Dashboard (always)
        </label>
        {PAGE_PERMS.map(function (p) {
          return (
            <label key={p.key} style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
              <input type="checkbox" checked={!!perms[p.key]} onChange={function () { toggle(p.key) }} /> {p.label}
            </label>
          )
        })}
      </div>

      {ACTION_PERMS.map(function (g) {
        return (
          <div key={g.group} style={{ marginBottom: 10 }}>
            <label className="lbl">{g.group} — what they can do</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(230px,1fr))', gap: '6px 12px' }}>
              {g.items.map(function (a) {
                const off = !perms[a.needs]
                return (
                  <label key={a.key} title={off ? 'Tick the page first' : ''}
                    style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: off ? 'not-allowed' : 'pointer', opacity: off ? 0.45 : 1 }}>
                    <input type="checkbox" disabled={off} checked={!!perms[a.key]} onChange={function () { toggle(a.key) }} /> {a.label}
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
