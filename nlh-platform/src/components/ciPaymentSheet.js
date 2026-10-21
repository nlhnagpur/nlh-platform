// The "CI Payment Sheet" — one line per student cycle paid, an Extra line for
// incentive / misc, the total and the total in words. Plain monospace sheet.

import { datesByMonth } from '../utils/ciPayroll.js'
import { numToWords, printHtmlDoc } from './studentDocs.js'

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
  })
}
function money(n) { return Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }
function dmy(d) {
  const t = d instanceof Date ? d : new Date(d)
  return String(t.getDate()).padStart(2, '0') + '.' + String(t.getMonth() + 1).padStart(2, '0') + '.' + t.getFullYear()
}

// sheet: { ciName, date, rows:[{ name, course, blocks:[{dates,count,perCycle,amount,partial}] }], extra, extraNote }
export function ciPaymentSheetHtml(sheet) {
  let n = 0
  let total = 0
  const lines = []
  ;(sheet.rows || []).forEach(function (r) {
    r.blocks.forEach(function (b) {
      n++
      total += b.amount
      lines.push('<tr><td class="c">' + n + '</td><td>' + esc(r.name) + ' ' + esc(datesByMonth(b.dates)) + '</td>' +
        '<td class="c">' + esc((r.course || 'Sessions') + '- Sessions-' + b.perCycle + (b.partial ? ' (' + b.count + ' taught)' : '')) + '</td>' +
        '<td class="r">' + money(b.amount) + '</td></tr>')
    })
  })
  const extra = Math.round(Number(sheet.extra) || 0)
  if (extra) {
    n++
    total += extra
    lines.push('<tr><td class="c">' + n + '</td><td>' + (extra < 0 ? 'Deduction' : 'Extra') + (sheet.extraNote ? ' — ' + esc(sheet.extraNote) : '') + '</td><td></td><td class="r">' + money(extra) + '</td></tr>')
  }
  const html = '<!doctype html><html><head><meta charset="utf-8"><title>CI Payment Sheet</title><style>' +
    '@page{size:A4;margin:12mm}body{font:12px "Courier New",monospace;color:#111;margin:0}' +
    'table{border-collapse:collapse;width:100%}td,th{border:1px solid #bbb;padding:5px 7px;vertical-align:middle}' +
    '.t{text-align:center;font-weight:700;font-size:16px;letter-spacing:.06em}.s{text-align:center;font-weight:700;font-size:15px}' +
    'th{background:#eee;letter-spacing:.08em}.c{text-align:center}.r{text-align:right;white-space:nowrap}' +
    '.tot td{background:#eee;font-weight:700;font-size:13px}.w td{border-top:2px solid #999}' +
    '</style></head><body><table>' +
    '<tr><td class="t" colspan="4">NEW LEARNING HORIZONS</td></tr>' +
    '<tr><td class="s" colspan="4">CI Payment Sheet</td></tr>' +
    '<tr><td colspan="4" style="border-bottom:0">CI Name :-&nbsp; ' + esc(sheet.ciName) + '</td></tr>' +
    '<tr><td colspan="4" style="border-top:0">Date&nbsp;&nbsp;&nbsp;:-&nbsp; ' + esc(dmy(sheet.date || new Date())) + '</td></tr>' +
    '<tr><th style="width:48px">Sr.No.</th><th>Particular</th><th style="width:170px">Description</th><th style="width:110px">Amount</th></tr>' +
    lines.join('') +
    '<tr class="tot"><td colspan="3"></td><td class="r">' + money(total) + '</td></tr>' +
    '<tr class="w"><td>IN WORDS:</td><td colspan="3">' + esc(numToWords(total)) + '</td></tr>' +
    '</table></body></html>'
  return { html: html, total: total }
}

export function printCiPaymentSheet(sheet) {
  const out = ciPaymentSheetHtml(sheet)
  printHtmlDoc(out.html)
  return out.total
}
