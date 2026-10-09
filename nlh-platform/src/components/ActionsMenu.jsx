import React, { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

// Every per-order row action (Record Pmt, Remind, Edit, PDF, Dispatch,
// Cancel, Invoice, Proforma, Verify, Reopen, Receipts, Raise Credit Note…)
// used to be its own always-visible button — up to 6 at once. Folded into
// one "Actions ▾" button with a dropdown menu; the button itself is only
// highlighted (purple) when a "primary" item is in the list, so the single
// most urgent next step is still visible at a glance without a wall of
// buttons. Module-level (not nested in OrdersPage) so its own open/closed
// state survives unrelated re-renders of the orders table.
// items: [{ key, label, onClick, cls?: 'primary'|'green'|'danger', disabled?, title? }]
// info: [{ key, text, color? }] — non-clickable context lines (payment/
// dispatch/reminder details) shown above the actions instead of sitting as
// their own cluttered lines under the button on the row itself.
//
// The panel itself is rendered through a portal into document.body rather
// than as a child of the button — every order row lives inside a
// horizontally-scrollable table (.tbl-scroll), and a dropdown "embedded" in
// that DOM subtree is at the mercy of that ancestor's own overflow/stacking
// (exactly the overflow-y clipping bug fixed earlier). Positioning it via
// the button's live on-screen coordinates instead means it always floats
// cleanly on top, regardless of what table or container it's opened from.
export default function ActionsMenu({ items, info }) {
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState(null)   // { top, bottom, right } of the button, in viewport pixels
  const [pos, setPos] = useState(null)         // { top, right } the panel actually renders at
  const btnRef = useRef(null)
  const menuRef = useRef(null)

  useEffect(function () {
    if (!open) return
    function onDocClick(e) {
      if (btnRef.current && btnRef.current.contains(e.target)) return
      if (menuRef.current && menuRef.current.contains(e.target)) return
      setOpen(false)
    }
    // A stale-positioned panel floating over the wrong row is worse than no
    // panel — close instead of trying to track scroll/resize.
    function onScrollOrResize() { setOpen(false) }
    document.addEventListener('mousedown', onDocClick)
    window.addEventListener('scroll', onScrollOrResize, true)
    window.addEventListener('resize', onScrollOrResize)
    return function () {
      document.removeEventListener('mousedown', onDocClick)
      window.removeEventListener('scroll', onScrollOrResize, true)
      window.removeEventListener('resize', onScrollOrResize)
    }
  }, [open])

  function toggle() {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      const a = { top: r.top, bottom: r.bottom, right: window.innerWidth - r.right }
      setAnchor(a)
      setPos({ top: a.bottom + 4, right: a.right })   // provisional — flips above in the layout effect below once the panel's real height is known
    }
    setOpen(function (o) { return !o })
  }

  // A row near the bottom of the screen (last row of a table, a short
  // window, the OS taskbar eating into viewport height) would otherwise
  // always open the panel downward and clip it — the exact bug seen on the
  // Orders Actions menu. Measure the panel's actual height once it's
  // rendered and flip it above the button when there isn't room below.
  useLayoutEffect(function () {
    if (!open || !anchor || !menuRef.current) return
    const h = menuRef.current.getBoundingClientRect().height
    const margin = 8
    const fitsBelow = anchor.bottom + 4 + h <= window.innerHeight - margin
    if (!fitsBelow) {
      const top = Math.max(margin, anchor.top - 4 - h)
      setPos(function (p) { return (p && p.top === top) ? p : { top: top, right: anchor.right } })
    }
  }, [open, anchor, items, info])

  const clsColor = { primary: 'var(--purple)', green: 'var(--green)', danger: '#dc2626' }
  const list = (items || []).filter(Boolean)
  const infoList = (info || []).filter(Boolean)
  if (list.length === 0 && infoList.length === 0) return null
  const hasPrimary = list.some(function (it) { return it.cls === 'primary' })

  return (
    <>
      <button ref={btnRef} className={'row-action' + (hasPrimary ? ' primary' : '')} onClick={toggle}>
        Actions ▾
      </button>
      {open && pos && createPortal(
        <div ref={menuRef} style={{ position: 'fixed', top: pos.top, right: pos.right, background: '#fff', border: '1px solid var(--border)', borderRadius: 8, boxShadow: '0 4px 14px rgba(0,0,0,.12)', zIndex: 1000, minWidth: 220, maxHeight: 'calc(100vh - 16px)', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          {infoList.length > 0 && (
            <div style={{ padding: '8px 12px', borderBottom: list.length > 0 ? '1px solid var(--border)' : 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {infoList.map(function (row) {
                return (
                  <span key={row.key} style={{ fontSize: 10.5, color: row.color || 'var(--text3)', fontFamily: 'var(--mono)' }}>
                    {row.text}
                  </span>
                )
              })}
            </div>
          )}
          {list.map(function (it) {
            return (
              <button key={it.key} className="row-action" disabled={it.disabled} title={it.title}
                style={{ border: 'none', borderRadius: 0, textAlign: 'left', color: clsColor[it.cls] || 'var(--text2)', fontWeight: it.cls ? 700 : 600 }}
                onClick={function () { setOpen(false); it.onClick() }}>
                {it.label}
              </button>
            )
          })}
        </div>,
        document.body
      )}
    </>
  )
}
