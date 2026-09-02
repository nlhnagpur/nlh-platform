import React, { useState } from 'react'
import ModalHeader from './ModalHeader'

// Shared confirm-before-send step for every WhatsApp send in the platform —
// shows the number it's about to message, lets the admin fix it on the spot
// (a stale/wrong phone on file is common), and only fires on explicit
// confirm. Nothing sends without this passing through it first.
//
// Usage: keep one `waConfirm` state per component — null when closed, or
// `{ label, phone, send }` to open it. `send(phone)` does the actual work
// (call the API, show its own success/failure toast) and does NOT need to
// close the modal itself; this component closes on send start.
//
//   const [waConfirm, setWaConfirm] = useState(null)
//   ...
//   <button onClick={() => setWaConfirm({
//     label: 'Send payment receipt',
//     phone: order.bill_to_fr?.phone || '',
//     send:  (phone) => sendReceiptWA(phone),
//   })}>💬 WhatsApp</button>
//   {waConfirm && <WhatsAppSendConfirm {...waConfirm} onClose={() => setWaConfirm(null)} />}
export default function WhatsAppSendConfirm({ label, phone, send, onClose }) {
  const [value, setValue] = useState(phone || '')
  const [sending, setSending] = useState(false)

  async function handleSend() {
    const trimmed = value.trim()
    if (!trimmed) return
    setSending(true)
    try {
      await send(trimmed)
    } finally {
      setSending(false)
      onClose()
    }
  }

  return (
    <div className="modal-bg" onClick={function (e) { e.target === e.currentTarget && onClose() }}>
      <div className="modal" style={{ maxWidth: 380 }}>
        <ModalHeader flush title={label || 'Send on WhatsApp'} subtitle="Confirm number before sending" onClose={onClose} />
        <div className="fr" style={{ marginBottom: 4 }}>
          <label style={{ fontSize: 11, marginBottom: 4, display: 'block' }}>WhatsApp number</label>
          <input
            type="tel"
            autoFocus
            value={value}
            onChange={function (e) { setValue(e.target.value) }}
            placeholder="e.g. 9876543210"
            style={{ width: '100%' }}
          />
          {!phone && (
            <p className="hint" style={{ color: 'var(--red, #A32D2D)', marginTop: 4 }}>
              No number on file — enter one to send.
            </p>
          )}
        </div>
        <div className="modal-actions">
          <button className="btn-s" onClick={onClose} disabled={sending}>Cancel</button>
          <button className="btn-p" onClick={handleSend} disabled={sending || !value.trim()}>
            {sending ? 'Sending…' : '💬 Send'}
          </button>
        </div>
      </div>
    </div>
  )
}
