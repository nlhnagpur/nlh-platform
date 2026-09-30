import React, { useState, useRef, useEffect } from 'react'

// A typeahead dropdown for picking one item out of a long list (franchisees,
// orders, ...) — types to filter instead of scrolling a native <select>.
// options: [{ value, label, sublabel? }]. Calls onChange(value) on pick.
export default function SearchSelect({ options, value, onChange, placeholder, className }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)

  const selected = (options || []).find(function (o) { return o.value === value })

  useEffect(function () {
    function onDocClick(e) { if (wrapRef.current && !wrapRef.current.contains(e.target)) { setOpen(false); setQuery('') } }
    document.addEventListener('mousedown', onDocClick)
    return function () { document.removeEventListener('mousedown', onDocClick) }
  }, [])

  const q = query.trim().toLowerCase()
  const filtered = !q ? (options || []) : (options || []).filter(function (o) {
    return (o.label || '').toLowerCase().includes(q) || (o.sublabel || '').toLowerCase().includes(q)
  })

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <input
        className={className || 'inp'}
        value={open ? query : (selected ? selected.label : '')}
        placeholder={placeholder || 'Type to search…'}
        onFocus={function () { setOpen(true); setQuery('') }}
        onChange={function (e) { setQuery(e.target.value); setOpen(true) }}
        style={{ width: '100%' }}
      />
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, zIndex: 500,
          background: '#fff', border: '1px solid var(--border)', borderRadius: 8,
          boxShadow: '0 8px 24px rgba(0,0,0,.14)', maxHeight: 240, overflowY: 'auto',
        }}>
          {filtered.length === 0 ? (
            <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text3)' }}>No matches</div>
          ) : filtered.map(function (o) {
            return (
              <div key={o.value}
                // Select on mousedown, not click — a real click is mousedown
                // then mouseup, and if the option list shifts in between (e.g.
                // it's still loading in another option), the browser can end
                // up not firing click at all, silently swallowing the pick.
                // preventDefault stops the input from blurring first, and
                // firing here (before the document-level outside-click
                // mousedown listener, since bubbling reaches this element
                // before it reaches document) means the pick is never racing
                // against that listener closing the dropdown.
                onMouseDown={function (e) { e.preventDefault(); onChange(o.value); setOpen(false); setQuery('') }}
                style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 13, borderBottom: '1px solid var(--bg)' }}
                onMouseEnter={function (e) { e.currentTarget.style.background = 'var(--purple-bg, #f5f3ff)' }}
                onMouseLeave={function (e) { e.currentTarget.style.background = 'none' }}
              >
                <div style={{ fontWeight: 600, color: 'var(--text)' }}>{o.label}</div>
                {o.sublabel && <div style={{ fontSize: 11, color: 'var(--text3)' }}>{o.sublabel}</div>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
