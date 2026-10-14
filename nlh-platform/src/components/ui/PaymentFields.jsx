import React from 'react'
import { paymentModes, quickFillOptions, findDuplicatePayment, isFutureDate } from '../../utils/paymentForm'

// The common field block of every payment-entry form: amount received, paid-on
// date, mode, reference (and optional notes), with quick-fill amounts and an
// advisory duplicate warning. It is purely presentational — it holds no state
// and writes nothing; the owning modal keeps its own save logic, validation
// and allocation, so behaviour is unchanged.
//
//   <PaymentFields flow="student" values={{ amount, paidOn, mode, reference, notes }}
//                  onChange={function (patch) { … }}      // patch: { amount? paidOn? mode? reference? notes? }
//                  balance={3500} capAmount today="2026-10-14" existing={payments}
//                  // balance drives the Full/Half quick-fill; capAmount also sets the input's max (student, order)
//                  hint={<p className="hint">…</p>} />
//
// flow: 'student' | 'order' | 'orderMulti' | 'franchisee' (selects the mode list)
export default function PaymentFields({ flow, values, onChange, balance, capAmount, today, existing, hint, showNotes, autoFocus, amountLabel, referenceLabel, amountPlaceholder, disabled }) {
  const v = values || {}
  const quick = balance != null ? quickFillOptions(balance) : []
  const dup = findDuplicatePayment(existing, { amount: v.amount, date: v.paidOn, mode: v.mode })
  const future = isFutureDate(v.paidOn, today)

  return (
    <div>
      <div className="form-grid">
        <label>{amountLabel || 'Amount received (₹)'} *
          <input
            type="number" min="0" inputMode="decimal" autoFocus={!!autoFocus} disabled={disabled}
            value={v.amount} placeholder={amountPlaceholder || 'e.g. 1500'}
            max={capAmount && balance > 0 ? balance : undefined}
            onChange={function (e) { onChange({ amount: e.target.value }) }}
          />
        </label>
        <label>Paid on
          <input
            type="date" disabled={disabled} value={v.paidOn} max={today || undefined}
            title="The day the money was actually received — back-date it if you are entering it later"
            onChange={function (e) { onChange({ paidOn: e.target.value }) }}
          />
        </label>
        <label>Mode
          <select value={v.mode} disabled={disabled} onChange={function (e) { onChange({ mode: e.target.value }) }}>
            {paymentModes(flow).map(function (m) { return <option key={m[0]} value={m[0]}>{m[1]}</option> })}
          </select>
        </label>
        <label>{referenceLabel || 'Reference / UTR (optional)'}
          <input
            disabled={disabled} value={v.reference} placeholder="UTR / cheque no. / note"
            onChange={function (e) { onChange({ reference: e.target.value }) }}
          />
        </label>
        {showNotes && (
          <label className="col-span-2">Notes (optional)
            <input
              disabled={disabled} value={v.notes || ''} placeholder="e.g. Part payment, balance next month"
              onChange={function (e) { onChange({ notes: e.target.value }) }}
            />
          </label>
        )}
      </div>

      {quick.length > 0 && !disabled && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--text3)' }}>Quick fill:</span>
          {quick.map(function (q) {
            return (
              <button key={q.key} type="button" className="btn-s" style={{ fontSize: 11, padding: '3px 10px' }}
                onClick={function () { onChange({ amount: String(q.amount) }) }}>{q.label}</button>
            )
          })}
          <button type="button" className="btn-s" style={{ fontSize: 11, padding: '3px 10px' }}
            onClick={function () { onChange({ amount: '' }) }}>Clear</button>
        </div>
      )}

      {future && (
        <p className="hint" style={{ marginTop: 8, color: 'var(--red)' }}>
          This date is in the future. Paid on is the day the money was received.
        </p>
      )}
      {dup && (
        <div role="alert" style={{ marginTop: 8, padding: '8px 12px', borderRadius: 8, background: '#FFF7DA', border: '1px solid #D97706', fontSize: 12, color: '#92400E' }}>
          <b>Possible duplicate.</b> A payment of the same amount, date and mode is already recorded
          {dup.receipt_no ? ' (' + dup.receipt_no + ')' : ''}. Only continue if this is a different payment.
        </div>
      )}
      {hint}
    </div>
  )
}
