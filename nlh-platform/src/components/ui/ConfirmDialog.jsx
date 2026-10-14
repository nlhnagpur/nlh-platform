import React, { useState, useEffect, useRef } from 'react'

// The one confirmation dialog (replaces window.confirm).
//
//   <ConfirmDialog
//     title="Remove this payment?"
//     message="The order total will be recalculated."
//     details={[['Receipt', 'OR-HO-2026-0012'], ['Amount', '₹2,000']]}
//     confirmLabel="Remove payment" tone="danger"
//     onConfirm={async function () { … }}   // may be async; the dialog locks while it runs
//     onCancel={function () { … }} />
//
// Safety behaviour: Cancel has the initial focus; Esc and the backdrop cancel
// (not while a confirm is running); the confirm button locks after one click so
// a double-click can never run the action twice; `requireText` makes the user
// type a word/number before an irreversible action is enabled.
export default function ConfirmDialog({ title, message, details, confirmLabel, cancelLabel, tone, requireText, onConfirm, onCancel }) {
  const [busy, setBusy] = useState(false)
  const [typed, setTyped] = useState('')
  const cancelRef = useRef(null)
  const busyRef = useRef(false)

  useEffect(function () {
    if (cancelRef.current) cancelRef.current.focus()
  }, [])

  useEffect(function () {
    function onKey(e) { if (e.key === 'Escape' && !busyRef.current) onCancel() }
    document.addEventListener('keydown', onKey)
    return function () { document.removeEventListener('keydown', onKey) }
  }, [onCancel])

  const needsText = !!requireText
  const typedOk = !needsText || typed.trim().toLowerCase() === String(requireText).trim().toLowerCase()

  async function go() {
    if (busyRef.current || !typedOk) return
    busyRef.current = true
    setBusy(true)
    try {
      await onConfirm()
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const danger = tone === 'danger'
  return (
    <div className="modal-bg" onClick={function (e) { if (e.target === e.currentTarget && !busyRef.current) onCancel() }}>
      <div className="modal ui-confirm" role="dialog" aria-modal="true" aria-labelledby="ui-confirm-title">
        <div id="ui-confirm-title" className="ui-confirm-title">{title}</div>
        {message && <div className="ui-confirm-msg">{message}</div>}
        {details && details.length > 0 && (
          <dl className="ui-confirm-details">
            {details.map(function (d, i) {
              return (
                <div key={i} className="ui-confirm-row">
                  <dt>{d[0]}</dt>
                  <dd>{d[1]}</dd>
                </div>
              )
            })}
          </dl>
        )}
        {needsText && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>
              Type <b>{requireText}</b> to confirm
            </div>
            <input className="inp" value={typed} onChange={function (e) { setTyped(e.target.value) }} autoComplete="off" />
          </div>
        )}
        <div className="modal-actions">
          <button ref={cancelRef} className="btn-s" disabled={busy} onClick={onCancel}>{cancelLabel || 'Cancel'}</button>
          <button
            className={danger ? 'ui-btn-danger' : 'btn-p'}
            disabled={busy || !typedOk}
            onClick={go}
          >{busy ? 'Working…' : (confirmLabel || 'Confirm')}</button>
        </div>
      </div>
    </div>
  )
}
