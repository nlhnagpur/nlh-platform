import React, { useState } from 'react'
import ActionsMenu from './ActionsMenu'
import { StatusChip, PageHeader, LoadingState, EmptyState, ErrorState, useMediaQuery } from './ui'
import TierBadge from './ui/TierBadge'
import { fmtDate, fmtMoney, fmtCount } from '../utils/format'
import { matchesSearch } from '../utils/search'

// The Receipts register: order receipts (OR-), franchise-fee receipts (FR-) and
// credit notes (CN-) in one list. Presentational — data loading and every
// action stay in OrdersPage; this component only shows records and reports
// what the user clicked. Built from the shared UI kit (Increment 1 pilot).
//
// records: [{ type: 'payment'|'fee'|'credit_note', id, no, date, paidOn, amount,
//             fr: { business_name, tier, phone }, forLabel, status, raw }]

const TYPE_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'payment', label: 'Invoice payments' },
  { id: 'fee', label: 'Franchise fees' },
  { id: 'credit_note', label: 'Credit notes' },
]

function typeLabelOf(rec) { return rec.type === 'payment' ? 'Invoice Payment' : rec.type === 'fee' ? 'Franchise Fee' : 'Credit Note' }
function typeToneOf(rec) { return rec.type === 'payment' ? 'info' : rec.type === 'fee' ? 'ochre' : 'accent' }

function StatusOf({ rec }) {
  if (rec.type !== 'credit_note') return <StatusChip tone="success">Recorded</StatusChip>
  const st = String(rec.status || '')
  return <StatusChip status={st}>{st.charAt(0).toUpperCase() + st.slice(1)}</StatusChip>
}

function paidNote(rec) {
  return rec.paidOn && String(rec.paidOn).slice(0, 10) !== String(rec.date).slice(0, 10)
    ? 'paid ' + fmtDate(rec.paidOn) : ''
}

export default function ReceiptsRegister({ records, loading, error, onRetry, actionLoading, onCreditNote, onView, onWhatsApp, onEdit }) {
  const [search, setSearch] = useState('')
  const [type, setType] = useState('all')
  const narrow = useMediaQuery('(max-width: 640px)')

  function countOf(t) {
    return t === 'all' ? records.length : records.filter(function (r) { return r.type === t }).length
  }
  const visible = records.filter(function (r) {
    if (type !== 'all' && r.type !== type) return false
    return matchesSearch([r.no, r.forLabel, r.fr && r.fr.business_name, r.fr && r.fr.phone, r.amount, r.status, fmtDate(r.date)], search)
  })
  const filtered = search.trim() !== '' || type !== 'all'
  function clearFilters() { setSearch(''); setType('all') }

  function actionsOf(rec) {
    if (rec.type === 'credit_note') {
      const busy = actionLoading === 'cn_' + rec.id
      return rec.status === 'pending'
        ? <>
            <button className="row-action green" disabled={busy} onClick={function () { onCreditNote('approve', rec.raw) }}>{busy ? '…' : 'Approve'}</button>{' '}
            <button className="row-action danger" disabled={busy} onClick={function () { onCreditNote('reject', rec.raw) }}>Reject</button>
          </>
        : <span style={{ color: 'var(--text3)' }}>{rec.raw.reason || '—'}</span>
    }
    return (
      <ActionsMenu items={[
        { key: 'view', label: 'View / Print', onClick: function () { onView(rec) } },
        { key: 'wa', label: '💬 WhatsApp', onClick: function () { onWhatsApp(rec) } },
        { key: 'edit', label: '✎ Edit', onClick: function () { onEdit(rec) } },
      ]} />
    )
  }

  return (
    <div className="card tbl-scroll" style={{ marginBottom: 0 }}>
      <PageHeader
        title="Receipts register"
        count={loading || error ? undefined : fmtCount(visible.length, records.length)}
        subtitle="Newest recorded first · order receipts, franchise fees and credit notes together"
      />
      <div className="ui-toolbar">
        <input
          className="inp ui-search"
          type="search"
          placeholder="Search receipt, franchisee, invoice…"
          value={search}
          onChange={function (e) { setSearch(e.target.value) }}
          aria-label="Search receipts"
        />
        <div className="ui-filters">
          {TYPE_FILTERS.map(function (f) {
            return (
              <button key={f.id} className={'ui-filter' + (type === f.id ? ' on' : '')} onClick={function () { setType(f.id) }}>
                {f.label}<span className="n">{countOf(f.id)}</span>
              </button>
            )
          })}
        </div>
        {filtered && <button className="ui-clear" onClick={clearFilters}>Clear filters</button>}
      </div>

      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} onRetry={onRetry} />
      ) : records.length === 0 ? (
        <EmptyState title="No receipts or credit notes yet." hint="Use the + buttons above to record one." />
      ) : visible.length === 0 ? (
        <EmptyState
          title="No receipts match your search."
          action={<button className="btn-s" onClick={clearFilters}>Clear filters</button>}
        />
      ) : narrow ? (
        <div className="ui-cards">
          {visible.map(function (rec) {
            const note = paidNote(rec)
            return (
              <div className="ui-card-row" key={rec.type + rec.id}>
                <div className="ui-card-top">
                  <div style={{ minWidth: 0 }}>
                    <div className="ui-card-no">{rec.no || '—'}</div>
                    <div className="ui-card-date">{fmtDate(rec.date)}{note ? ' · ' + note : ''}</div>
                  </div>
                  <div className="ui-card-amt">{fmtMoney(rec.amount)}</div>
                </div>
                <div className="ui-card-mid">
                  <div style={{ fontWeight: 600 }}>{(rec.fr && rec.fr.business_name) || '—'}</div>
                </div>
                <div className="ui-card-meta">
                  <StatusChip tone={typeToneOf(rec)}>{typeLabelOf(rec)}</StatusChip>
                  <StatusOf rec={rec} />
                  {rec.fr && rec.fr.tier && <TierBadge tier={rec.fr.tier} />}
                </div>
                {rec.forLabel && rec.forLabel !== '—' && <div className="ui-card-for">For: {rec.forLabel}</div>}
                <div className="ui-card-foot">{actionsOf(rec)}</div>
              </div>
            )
          })}
        </div>
      ) : (
        <table className="big-tbl">
          <thead>
            <tr>
              <th>No.</th>
              <th className="hide-mobile">Date</th>
              <th>Type</th>
              <th>Franchisee</th>
              <th className="hide-mobile">For</th>
              <th style={{ textAlign: 'right' }}>Amount</th>
              <th>Status</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(function (rec) {
              const note = paidNote(rec)
              return (
                <tr key={rec.type + rec.id}>
                  <td className="mono" style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{rec.no || '—'}</td>
                  <td className="mono hide-mobile" style={{ whiteSpace: 'nowrap' }}>
                    {fmtDate(rec.date)}
                    {note && <div style={{ font: '500 10px var(--font)', color: 'var(--text3)' }}>{note}</div>}
                  </td>
                  <td><StatusChip tone={typeToneOf(rec)}>{typeLabelOf(rec)}</StatusChip></td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{(rec.fr && rec.fr.business_name) || '—'}</div>
                    <TierBadge tier={rec.fr && rec.fr.tier} />
                  </td>
                  <td className="mono hide-mobile">{rec.forLabel}</td>
                  <td style={{ textAlign: 'right' }}><div className="amt">{fmtMoney(rec.amount)}</div></td>
                  <td><StatusOf rec={rec} /></td>
                  <td style={{ textAlign: 'right' }}>{actionsOf(rec)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
