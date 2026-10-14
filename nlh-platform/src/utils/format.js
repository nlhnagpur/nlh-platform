// Shared display formatting — one place for money and date text so every
// screen renders the same value the same way. Pure: no DOM, no Supabase.
// fmtDate/fmtAmt are the long-standing helpers from ./index (unchanged);
// this module adds the ₹ wrapper and re-exports them under one import.
import { fmtAmt, fmtDate } from './index.js'

export { fmtAmt, fmtDate }

// ₹12,34,567 — Indian grouping. A negative amount reads −₹500, never ₹-500.
export function fmtMoney(n) {
  const v = Number(n)
  if (n === null || n === undefined || n === '' || isNaN(v)) return '₹0'
  const abs = Math.abs(v)
  return (v < 0 ? '−' : '') + '₹' + abs.toLocaleString('en-IN')
}

// "3 of 12" / "12" — the count line shown above a filtered list.
export function fmtCount(shown, total) {
  return shown === total ? String(total) : shown + ' of ' + total
}
