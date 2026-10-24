import React, { useState, useEffect } from 'react'
import { sb } from '../supabase'
import { useAuth } from '../context/AuthContext'
import { fmtDate, showToast } from '../utils'
import { cleanLines, sumLines, linesFromCalc, lineEdited, monthLabel, lastDayOf } from '../utils/ciPayrollRun'
import { postPayrollAccrual, voidPayrollAccrual } from '../utils/ciAccounting'
import CiBankPaymentDialog from './CiBankPaymentDialog'
import { recountLine, nextCycleStart, sheetRowFor } from '../utils/ciPayroll'
import { printCiPaymentSheet } from './ciPaymentSheet'

function rupees(n) {
  const v = Math.round(Number(n) || 0)
  return (v < 0 ? '−₹' : '₹') + Math.abs(v).toLocaleString('en-IN')
}

// The month's payroll for one CI: every line's amount can be edited (or added),
// saved as the month's payroll, posted to the books (Dr Staff Salaries / Cr the CI),
// and paid by a bank payment (Dr the CI / Cr the bank).
//   calcLines: [{ key, label, amount }] — what the system calculated
//   run:       the saved ci_payroll_runs row for this CI + month, or null
export default function CiPayrollRun({ instructor, month, calcLines, run, canEdit, onChanged, datesBySid, shareDates }) {
  const { currentUser } = useAuth()
  const calcSig = JSON.stringify(calcLines || [])
  const [lines, setLines] = useState([])
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [payOpen, setPayOpen] = useState(false)       // the bank payment dialog
  const [confirmPost, setConfirmPost] = useState(false)
  const [entryNos, setEntryNos] = useState({})          // journal entry id -> JV number

  useEffect(function () {
    setLines(run && Array.isArray(run.lines) && run.lines.length ? run.lines.map(function (l) { return { ...l } }) : linesFromCalc(calcLines))
    setNotes((run && run.notes) || '')
  }, [month, run && run.id, run && run.updated_at, calcSig])   // eslint-disable-line react-hooks/exhaustive-deps

  const paid = !!run && run.status === 'paid'
  const posted = !!run && run.status === 'posted'
  const locked = paid || posted
  const editable = canEdit && !locked

  useEffect(function () {
    const ids = [run && run.accrual_journal_id, run && run.payment_journal_id].filter(Boolean)
    if (!ids.length) { setEntryNos({}); return }
    sb.from('journal_entries').select('id, entry_no').in('id', ids).then(function (res) {
      const m = {}
      ;(res.data || []).forEach(function (e) { m[e.id] = e.entry_no })
      setEntryNos(m)
    })
  }, [run && run.accrual_journal_id, run && run.payment_journal_id])
  const total = sumLines(lines)
  const calcTotal = sumLines(linesFromCalc(calcLines))
  const savedTotal = run ? run.total : null
  const dirty = !run || savedTotal !== total || JSON.stringify(cleanLines(lines)) !== JSON.stringify(cleanLines(run.lines || [])) || (run.notes || '') !== notes

  function setAmount(i, v) { setLines(function (ls) { return ls.map(function (l, j) { return j === i ? { ...l, amount: v === '' ? '' : Number(v) } : l }) }) }
  function setLabel(i, v) { setLines(function (ls) { return ls.map(function (l, j) { return j === i ? { ...l, label: v } : l }) }) }
  function addLine() { setLines(function (ls) { return ls.concat([{ key: 'add' + Date.now(), label: '', calc: null, amount: 0, added: true }]) }) }
  function removeLine(i) { setLines(function (ls) { return ls.filter(function (_, j) { return j !== i }) }) }
  function resetToCalc() { setLines(linesFromCalc(calcLines)) }

  // Change the dates a student's line covers: the classes taught in that range are
  // counted again and the amount follows (full rate for a whole cycle, pro-rata
  // otherwise); the amount can still be typed over afterwards.
  function setRange(i, from, to) {
    setLines(function (ls) {
      return ls.map(function (l, j) { return j === i ? recountLine(l, from, to, { datesBySid: datesBySid, shareDates: shareDates }) : l })
    })
  }

  function onPrint() {
    const clean = cleanLines(lines)
    const rows = clean.map(function (l) { return sheetRowFor(l, { datesBySid: datesBySid, shareDates: shareDates }) }).filter(function (r) { return r.amount })
    printCiPaymentSheet({ ciName: instructor.full_name, monthLabel: monthLabel(month), date: (run && run.paid_on) || new Date(), rows: rows })
  }

  async function saveRun(extra) {
    const clean = cleanLines(lines)
    const row = {
      instructor_id: instructor.id, month: month, lines: clean, calculated_total: calcTotal, total: sumLines(clean),
      notes: notes.trim() || null, status: 'draft', updated_at: new Date().toISOString(),
    }
    if (extra) Object.assign(row, extra)
    const res = await sb.from('ci_payroll_runs').upsert(row, { onConflict: 'instructor_id,month' }).select('*').single()
    if (res.error) throw res.error
    return res.data
  }

  async function onSave() {
    if (total < 0) { showToast('The total cannot be negative', 'warn'); return }
    setSaving(true)
    try {
      const saved = await saveRun()
      showToast('Payroll saved for ' + monthLabel(month) + ' ✓')
      onChanged && onChanged(saved)
    } catch (e) { showToast('Save failed: ' + e.message, 'err') }
    setSaving(false)
  }

  // Post the month's payroll to the books: Dr 6001 Staff Salaries / Cr the CI's account.
  async function onPost() {
    if (total <= 0) { showToast('There is nothing to post — the total is ₹0', 'warn'); return }
    setSaving(true)
    try {
      const saved = await saveRun()
      const posting = await postPayrollAccrual({
        runId: saved.id, instructor: instructor, amount: saved.total, date: lastDayOf(month), monthLabel: monthLabel(month), userId: currentUser && currentUser.id,
      })
      const upd = await sb.from('ci_payroll_runs').update({
        status: 'posted', accrual_journal_id: posting.journalId, expense_id: posting.expenseId, accrued_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }).eq('id', saved.id).select('*').single()
      if (upd.error) throw upd.error
      showToast(monthLabel(month) + ' posted to accounts as ' + posting.entryNo + ' ✓')
      setConfirmPost(false)
      onChanged && onChanged(upd.data)
    } catch (e) { showToast('Posting failed: ' + e.message, 'err') }
    setSaving(false)
  }

  // Undo a posting that has not been paid: the journal entry is voided and the payroll can be edited again.
  async function reopen() {
    if (!run || run.status !== 'posted') return
    setSaving(true)
    try {
      await voidPayrollAccrual(run, 'Payroll reopened for ' + monthLabel(month), currentUser && currentUser.id)
      const upd = await sb.from('ci_payroll_runs').update({ status: 'draft', accrual_journal_id: null, expense_id: null, accrued_at: null, updated_at: new Date().toISOString() }).eq('id', run.id).select('*').single()
      if (upd.error) throw upd.error
      showToast('Posting reversed — payroll is open for editing')
      onChanged && onChanged(upd.data)
    } catch (e) { showToast('Failed: ' + e.message, 'err') }
    setSaving(false)
  }

  const headerStyle = { padding: '8px 14px', background: 'var(--bg3)', font: '600 11px var(--font)', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', marginTop: 4 }}>
      <div style={headerStyle}>
        <span>Payment for {monthLabel(month)}</span>
        <span style={{ textTransform: 'none', letterSpacing: 0 }}>
          {paid ? <span style={{ color: 'var(--green)' }}>● Paid</span> : posted ? <span style={{ color: '#92400e' }}>● Posted to accounts — unpaid</span> : run ? <span style={{ color: '#92400e' }}>● Saved, not posted</span> : <span>Not saved yet — amounts below are the calculation</span>}
        </span>
      </div>

      {lines.map(function (l, i) {
        return (
          <div key={l.key + i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderTop: i > 0 ? '1px solid var(--border)' : 'none' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              {editable && l.added
                ? <input value={l.label} placeholder="What is this for?" onChange={function (e) { setLabel(i, e.target.value) }} style={{ width: '100%', fontSize: 13 }} />
                : <div style={{ font: '600 13px var(--font)', color: 'var(--text)' }}>{l.label}</div>}
              {l.detail && <div style={{ font: '500 11px var(--font)', color: 'var(--text3)', marginTop: 3 }}>{l.detail}</div>}
              {l.meta && (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 4, font: '500 11px var(--font)', color: 'var(--text3)' }}>
                  {editable
                    ? <>
                        <input type="date" value={l.meta.from} onChange={function (e) { setRange(i, e.target.value, l.meta.to) }} style={{ fontSize: 11 }} />
                        <span>to</span>
                        <input type="date" value={l.meta.to} onChange={function (e) { setRange(i, l.meta.from, e.target.value) }} style={{ fontSize: 11 }} />
                      </>
                    : <span>{fmtDate(l.meta.from)} to {fmtDate(l.meta.to)}</span>}
                  <span style={{ color: 'var(--text2)', fontWeight: 600 }}>
                    {l.meta.kind === 'share' ? '· ' + l.meta.count + ' of ' + l.meta.total + ' classes taken by the CI'
                      : l.meta.kind === 'session' ? '· ' + l.meta.count + ' class' + (l.meta.count !== 1 ? 'es' : '') + ' taken'
                      : l.meta.kind === 'fixed' ? '· fixed monthly'
                      : '· ' + l.meta.count + ' of ' + l.meta.perCycle + ' classes'}
                  </span>
                </div>
              )}
              {lineEdited(l) && <div style={{ font: '500 10px var(--font)', color: '#92400e', marginTop: 2 }}>edited — calculated {rupees(l.calc)}{l.meta && l.meta.origFrom && (l.meta.from !== l.meta.origFrom || l.meta.to !== l.meta.origTo) ? ' for ' + fmtDate(l.meta.origFrom) + ' to ' + fmtDate(l.meta.origTo) : ''}</div>}
            </div>
            {editable
              ? <input type="number" value={l.amount} onChange={function (e) { setAmount(i, e.target.value) }}
                  style={{ width: 110, textAlign: 'right', fontSize: 14, fontWeight: 700, background: lineEdited(l) ? '#FFFBEB' : undefined }} />
              : <div style={{ font: '700 14px var(--font)', color: 'var(--text)' }}>{rupees(l.amount)}</div>}
            {editable && l.added && <button className="btn" style={{ fontSize: 10, padding: '2px 7px', color: 'var(--red)' }} onClick={function () { removeLine(i) }}>✕</button>}
          </div>
        )
      })}
      {lines.length === 0 && <div className="hint" style={{ padding: '12px 14px' }}>Nothing calculated for this month. Add a line to record a payment.</div>}

      {editable && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: '8px 14px', borderTop: '1px solid var(--border)', background: 'var(--bg2)' }}>
          <button className="btn" style={{ fontSize: 11 }} onClick={addLine}>+ Add line</button>
          <button className="btn" style={{ fontSize: 11 }} onClick={resetToCalc}>↺ Reset to calculated</button>
          <button className="btn" style={{ fontSize: 11 }} onClick={onPrint}>🖨 Payment sheet</button>
          <input value={notes} onChange={function (e) { setNotes(e.target.value) }} placeholder="Note for this month (optional)" style={{ flex: 1, minWidth: 160, fontSize: 12 }} />
        </div>
      )}
      {locked && run.notes && <div style={{ padding: '8px 14px', borderTop: '1px solid var(--border)', font: '500 12px var(--font)', color: 'var(--text3)' }}>{run.notes}</div>}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', background: paid ? 'var(--green)' : 'var(--purple)', color: '#fff' }}>
        <span style={{ font: '700 14px var(--font)' }}>{paid ? 'Paid' : 'Payable'} — {monthLabel(month)}</span>
        <span style={{ font: '700 20px var(--font)' }}>{rupees(paid ? run.paid_amount : locked ? run.total : total)}</span>
      </div>
      {(function () {
        const ends = lines.filter(function (l) { return l.meta && l.meta.to }).map(function (l) { return l.meta.to }).sort()
        if (!ends.length) return null
        const last = ends[ends.length - 1]
        return (
          <div style={{ padding: '6px 16px', font: '500 11px var(--font)', color: 'var(--text2)', background: 'var(--bg2)' }}>
            {instructor.full_name} is paid up to <b>{fmtDate(last)}</b>. Next pay starts <b>{fmtDate(nextCycleStart(last))}</b>
            {' '}(the 1st of the next month if paid to the 30th/31st, otherwise the next day).
          </div>
        )
      })()}
      {total !== calcTotal && !paid && (
        <div style={{ padding: '6px 16px', font: '500 11px var(--font)', color: '#92400e', background: '#FFFBEB' }}>
          Differs from the calculated {rupees(calcTotal)} by {rupees(total - calcTotal)}.
        </div>
      )}

      {locked && (
        <div style={{ padding: '10px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, background: paid ? '#f0fdf4' : '#FFFBEB' }}>
          <div style={{ font: '500 12px var(--font)', color: 'var(--text2)', lineHeight: 1.6 }}>
            Posted to accounts as <b>{entryNos[run.accrual_journal_id] || 'a journal entry'}</b>: Dr Staff Salaries / Cr CI – {instructor.full_name}.
            {paid
              ? <> Paid on <b>{fmtDate(run.paid_on)}</b>{run.paid_mode ? ' by ' + run.paid_mode.replace('_', ' ') : ''}{run.paid_ref ? ' · Ref ' + run.paid_ref : ''}
                  {' '}— bank payment <b>{entryNos[run.payment_journal_id] || ''}</b>: Dr CI – {instructor.full_name} / Cr bank.</>
              : <> Payment is recorded as a bank payment: Dr CI – {instructor.full_name} / Cr bank.</>}
          </div>
          <span style={{ display: 'flex', gap: 8 }}>
            <button className="btn" style={{ fontSize: 11 }} onClick={onPrint}>🖨 Payment sheet</button>
            {canEdit && posted && <button className="btn" style={{ fontSize: 11 }} disabled={saving} onClick={reopen}>Reopen</button>}
            {canEdit && posted && <button className="btn-p" style={{ fontSize: 12 }} onClick={function () { setPayOpen(true) }}>Record bank payment…</button>}
          </span>
        </div>
      )}
      {!locked && canEdit && !confirmPost && (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', padding: '10px 16px', borderTop: '1px solid var(--border)' }}>
          <button className="btn" style={{ fontSize: 12 }} disabled={saving || !dirty} onClick={onSave}>{saving ? 'Saving…' : 'Save payroll'}</button>
          <button className="btn-p" style={{ fontSize: 12 }} disabled={saving} onClick={function () { setConfirmPost(true) }}>Post to accounts…</button>
        </div>
      )}
      {!locked && canEdit && confirmPost && (
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', background: 'var(--bg2)' }}>
          <div style={{ font: '600 13px var(--font)', marginBottom: 6 }}>Post {monthLabel(month)} payroll of {rupees(total)}?</div>
          <div style={{ font: '500 12px var(--font)', color: 'var(--text2)', marginBottom: 10 }}>
            Entry dated {fmtDate(lastDayOf(month))}: <b>Dr 6001 Staff Salaries</b> {rupees(total)} · <b>Cr CI – {instructor.full_name}</b> {rupees(total)}.
            The amounts above are locked once posted (you can reopen it until it is paid). The payment itself is recorded afterwards as a bank payment.
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn" style={{ fontSize: 12 }} disabled={saving} onClick={function () { setConfirmPost(false) }}>Cancel</button>
            <button className="btn-p" style={{ fontSize: 12 }} disabled={saving} onClick={onPost}>{saving ? 'Posting…' : 'Post to accounts'}</button>
          </div>
        </div>
      )}

      {payOpen && (
        <CiBankPaymentDialog instructor={instructor}
          onClose={function () { setPayOpen(false) }}
          onDone={function () {
            setPayOpen(false)
            sb.from('ci_payroll_runs').select('*').eq('id', run.id).single().then(function (res) { if (res.data) onChanged && onChanged(res.data) })
          }} />
      )}
    </div>
  )
}
