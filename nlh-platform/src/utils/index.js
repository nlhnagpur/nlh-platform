export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function fmtDate(d) {
  if (!d) return '—'
  const dt = new Date(d)
  if (isNaN(dt)) return d
  return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function fmtAmt(n) {
  if (n === null || n === undefined) return '0'
  return Number(n).toLocaleString('en-IN')
}

export function fmtDateTime(d) {
  if (!d) return '—'
  const dt = new Date(d)
  if (isNaN(dt)) return d
  return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function orderStatusLabel(status) {
  const map = {
    pending:           { cls: 'bp', txt: 'Pending' },
    invoiced:          { cls: 'br', txt: 'Invoiced' },
    payment_submitted: { cls: 'bpu', txt: 'Pmt Submitted' },
    verified:          { cls: 'ba', txt: 'Verified' },
    closed:            { cls: 'ba', txt: 'Closed' },
    part_paid:         { cls: 'bp', txt: 'Part Paid' },
  }
  const s = map[status] || { cls: 'bd', txt: status || '—' }
  return `<span class="badge ${s.cls}">${s.txt}</span>`
}

export function orderPaymentBadge(order) {
  if (!order.amount_paid || order.amount_paid === 0) return ''
  if (order.payment_verified_at) return '<span class="badge ba">Paid ✓</span>'
  if (order.payment_submitted_at) return '<span class="badge bpu">Pmt Submitted</span>'
  return '<span class="badge bp">Part Paid</span>'
}

export function statusBadge(status) {
  if (!status) return ''
  const s = status.toLowerCase()
  if (s === 'active')   return '<span class="badge ba">Active</span>'
  if (s === 'inactive') return '<span class="badge bd">Inactive</span>'
  if (s === 'pending')  return '<span class="badge bp">Pending</span>'
  if (s === 'approved') return '<span class="badge ba">Approved</span>'
  if (s === 'rejected') return '<span class="badge bd">Rejected</span>'
  return `<span class="badge br">${status}</span>`
}

let _toastTimer = null
export function showToast(msg, type = 'ok') {
  const el = document.getElementById('toast')
  if (!el) return
  el.textContent = msg
  el.className = 'toast' + (type === 'warn' ? ' warn' : type === 'err' ? ' err' : '')
  el.style.display = 'block'
  clearTimeout(_toastTimer)
  _toastTimer = setTimeout(() => { el.style.display = 'none' }, 3500)
}
