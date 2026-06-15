// Branded printable documents for students — Fee Invoice and Payment Receipt.
// Opens a print window styled to match the NLH order invoice (yellow masthead,
// purple tagline, bank/UPI box, thank-you footer). Single A4 page.

import { fmtAmt } from '../utils'

function numToWords(num) {
  if (!num || num === 0) return 'Zero Rupees Only'
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']
  function cvt(n) {
    if (n < 20) return ones[n]
    if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '')
    if (n < 1000) return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + cvt(n % 100) : '')
    if (n < 100000) return cvt(Math.floor(n / 1000)) + ' Thousand' + (n % 1000 ? ' ' + cvt(n % 1000) : '')
    if (n < 10000000) return cvt(Math.floor(n / 100000)) + ' Lakh' + (n % 100000 ? ' ' + cvt(n % 100000) : '')
    return cvt(Math.floor(n / 10000000)) + ' Crore' + (n % 10000000 ? ' ' + cvt(n % 10000000) : '')
  }
  return cvt(Math.round(num)) + ' Rupees Only'
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
  })
}

function fmtLong(d) {
  if (!d) return ''
  try {
    const dt = new Date(String(d).length <= 10 ? d + 'T00:00:00' : d)
    return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  } catch (e) { return String(d) }
}

// Shared chrome: masthead + tagline + party block + footer, with a body slot.
function docShell(opts) {
  // opts: { docTitle, sub, refLabel, refVal, dateStr, party, bodyHTML }
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(opts.docTitle)} ${esc(opts.refVal)}</title>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'DM Sans',system-ui,sans-serif;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .sheet{width:210mm;min-height:297mm;margin:0 auto;display:flex;flex-direction:column}
  .hd{background:linear-gradient(115deg,#FFF6D9 0%,#FFE89B 45%,#FFD234 80%,#FFB347 100%);padding:14px 22px;display:grid;grid-template-columns:64px 1fr auto;gap:14px;align-items:center}
  .hd .logo{width:64px;height:64px;background:#fff;border-radius:10px;padding:4px;display:flex;align-items:center;justify-content:center}
  .hd .logo img{width:100%;height:100%;object-fit:contain}
  .hd .t{text-align:center}
  .hd .t .ti{font:800 34px 'DM Sans';color:#1E40AF;letter-spacing:-.02em;line-height:1}
  .hd .t .ts{font:700 8px 'DM Mono';color:#D97706;text-transform:uppercase;letter-spacing:.2em;margin-top:3px}
  .hd .a{text-align:right;font:500 8.5px 'DM Sans';color:#1A1916;line-height:1.6}
  .hd .a b{font:700 12px 'DM Sans'}
  .tag{background:linear-gradient(90deg,#534AB7,#6F66CC);color:#fff;text-align:center;padding:5px;font:600 8px 'DM Mono';text-transform:uppercase;letter-spacing:.14em}
  .meta{display:grid;grid-template-columns:repeat(3,1fr);background:#F7F6F3;border-bottom:1px solid #E2E0D8;padding:9px 22px;gap:10px}
  .meta .l{font:600 7.5px 'DM Mono';color:#9C9A92;text-transform:uppercase;letter-spacing:.07em}
  .meta .v{font:700 12px 'DM Mono';color:#1A1916}
  .body{flex:1;padding:14px 22px}
  .party{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px}
  .box{border-radius:10px;padding:10px 14px;position:relative;overflow:hidden}
  .box .bl{position:absolute;top:0;bottom:0;left:0;width:3px}
  .box .lbl{font:700 7.5px 'DM Mono';text-transform:uppercase;letter-spacing:.1em;margin-bottom:4px}
  .box .nm{font:700 13px 'DM Sans';color:#1A1916;margin-bottom:2px}
  .box .sb{font:500 10px 'DM Mono';color:#5C5A54;line-height:1.6}
  table.it{width:100%;border-collapse:collapse;margin-top:4px}
  table.it th{background:linear-gradient(90deg,#534AB7,#6F66CC);color:#fff;font:700 9px 'DM Mono';text-transform:uppercase;letter-spacing:.06em;padding:9px 12px;text-align:left}
  table.it th.r,table.it td.r{text-align:right}
  table.it td{padding:10px 12px;border-bottom:1px solid #E2E0D8;font:600 12px 'DM Sans';color:#1A1916}
  table.it td .mut{font:500 10px 'DM Mono';color:#9C9A92}
  .tot{display:flex;justify-content:flex-end;margin-top:12px}
  .totbox{width:300px;background:#EEEDFE;border-radius:10px;padding:12px 14px;position:relative;overflow:hidden}
  .totbox .bl{position:absolute;top:0;bottom:0;left:0;width:3px;background:#534AB7}
  .trow{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px dashed rgba(83,74,183,.25);font:500 12px 'DM Sans';color:#5C5A54}
  .trow .v{font:600 12px 'DM Mono';color:#1A1916}
  .grand{margin-top:8px;background:linear-gradient(135deg,#534AB7,#6F66CC);border-radius:8px;padding:12px 14px;display:flex;justify-content:space-between;align-items:baseline;color:#fff}
  .grand .gl{font:700 9px 'DM Mono';text-transform:uppercase;letter-spacing:.1em}
  .grand .gv{font:800 22px 'DM Sans'}
  .words{margin-top:8px;font:500 9px 'DM Mono';color:#7A75A0;text-transform:uppercase;letter-spacing:.03em}
  .pay{margin-top:12px;background:linear-gradient(135deg,#FFF7DA,#FFE89B);border-radius:10px;padding:10px 14px;position:relative;overflow:hidden}
  .pay .bl{position:absolute;top:0;bottom:0;left:0;width:3px;background:#F59E0B}
  .pay .lbl{font:700 7.5px 'DM Mono';color:#D97706;text-transform:uppercase;letter-spacing:.1em;margin-bottom:6px}
  .pay .card{background:#fff;border-radius:8px;padding:10px 12px;display:grid;grid-template-columns:1fr 96px;gap:12px;align-items:center}
  .pay .bank{font:700 12px 'DM Sans';color:#1E40AF;margin-bottom:6px}
  .pay .grid{display:grid;grid-template-columns:38px 1fr;gap:4px 8px;font:700 13px 'DM Mono';color:#1A1916}
  .pay .grid .k{font:600 8px 'DM Mono';color:#9C9A92;text-transform:uppercase;align-self:center}
  .pay .qr img{width:92px;height:92px;border:2px solid #1E40AF;border-radius:6px;padding:3px;object-fit:contain}
  .upi{margin-top:8px;background:#EEEDFE;border-radius:7px;padding:7px 12px;text-align:center;font:700 11px 'DM Mono';color:#534AB7}
  .ft{background:linear-gradient(115deg,#FFE89B,#FFD234);padding:10px 22px;display:flex;justify-content:space-between;align-items:center}
  .ft .ty{font:800 15px 'DM Sans';color:#1E40AF}
  .ft .cg{font:600 7.5px 'DM Mono';color:#5B3A00;text-transform:uppercase;letter-spacing:.06em;text-align:right}
  .np{text-align:right;padding:10px 22px;background:#f0f0f0}
  .np button{background:#534AB7;color:#fff;border:none;padding:8px 18px;border-radius:7px;font:600 13px sans-serif;cursor:pointer}
  @media print{@page{size:A4;margin:0}.np{display:none}}
  </style></head><body>
  <div class="np"><button onclick="window.print()">Print / Save PDF</button></div>
  <div class="sheet">
    <div class="hd">
      <div class="logo"><img src="/NLH%20Logo.png" alt="NLH"></div>
      <div class="t"><div class="ti">${esc(opts.docTitle)}</div><div class="ts">${esc(opts.sub)}</div></div>
      <div class="a"><b>New Learning Horizons</b><div>9, Anjuman Shopping Complex, Residency Rd, Sadar, Nagpur 440 001</div><div>☎ +91 9373 111 311 · ✉ dhiral@nlhnagpur.info</div></div>
    </div>
    <div class="tag">New Learning Horizons · ISO 9001:2015 Certified · Enriching Children's Future</div>
    <div class="meta">
      <div><div class="l">${esc(opts.refLabel)}</div><div class="v">${esc(opts.refVal)}</div></div>
      <div><div class="l">Date</div><div class="v">${esc(opts.dateStr)}</div></div>
      <div><div class="l">Centre</div><div class="v" style="font-family:'DM Sans';font-size:12px">${esc(opts.centre || '—')}</div></div>
    </div>
    <div class="body">
      ${opts.party}
      ${opts.bodyHTML}
    </div>
    <div class="ft"><div class="ty">Thank you!</div><div class="cg">Computer generated ${esc(opts.docTitle.toLowerCase())} · No signature required</div></div>
  </div>
  </body></html>`
}

function partyBlock(student) {
  return `<div class="party">
    <div class="box" style="background:#EEEDFE"><div class="bl" style="background:#534AB7"></div>
      <div class="lbl" style="color:#534AB7">From</div>
      <div class="nm">New Learning Horizons</div>
      <div class="sb">9, Anjuman Shopping Complex, Residency Rd, Sadar, Nagpur 440 001<br>☎ 9373 111 311</div>
    </div>
    <div class="box" style="background:linear-gradient(135deg,#FFF7DA,#FFEAA0)"><div class="bl" style="background:#F59E0B"></div>
      <div class="lbl" style="color:#F59E0B">Student / Parent</div>
      <div class="nm">${esc(student.full_name || '—')}</div>
      <div class="sb">${esc(student.parent_name ? 'Parent: ' + student.parent_name : '')}${student.phone ? ' · ☎ ' + esc(student.phone) : ''}${student.email ? '<br>✉ ' + esc(student.email) : ''}</div>
    </div>
  </div>`
}

const PAY_BOX = `<div class="pay"><div class="bl"></div>
  <div class="lbl">Payment Details · NEFT / IMPS / UPI accepted</div>
  <div class="card">
    <div>
      <div class="bank">🏦 IDFC First Bank · Byramji Town Branch, Nagpur</div>
      <div class="grid"><span class="k">A/C</span><span>10278096847</span><span class="k">IFSC</span><span>IDFB0042504</span></div>
    </div>
    <div class="qr"><img src="/nlh-upi-qr.png" alt="QR"></div>
  </div>
  <div class="upi">📱 UPI: newlearninghorizons@idfcbank</div>
</div>`

function openWin(html) {
  const w = window.open('', '_blank', 'width=900,height=800')
  if (!w) return
  w.document.write(html)
  w.document.close()
}

// ── Fee Invoice ──────────────────────────────────────────────────────────────
// ctx.items: [{ kind:'course'|'kit', sku_id, name, qty, amount }]  (stored invoice format)
//   — fallback ctx.lines: [{ name, fee, sku_id }] for the simpler caller.
// ctx.summary: { discount, couponCode, total, paid, balance }
export function printStudentInvoice(student, ctx) {
  let items = ctx.items
  if (!items && ctx.lines) {
    items = ctx.lines.map(function (l) { return { kind: 'course', sku_id: l.sku_id, name: l.name, qty: 1, amount: l.fee || 0 } })
  }
  items = items || []
  const s = ctx.summary || {}
  const courses = items.filter(function (i) { return i.kind === 'course' })
  const rows = courses.length
    ? courses.map(function (c) {
        const kits = items.filter(function (i) { return i.kind === 'kit' && i.sku_id === c.sku_id })
        const kitTxt = kits.length
          ? 'Kit: ' + kits.map(function (k) { return esc(k.name) + (k.qty > 1 ? ' ×' + k.qty : '') }).join(' · ')
          : 'Course fee · kit included'
        return `<tr><td>${esc(c.name)}<div class="mut">${kitTxt}</div></td><td class="r">₹${fmtAmt(c.amount || 0)}</td></tr>`
      }).join('')
    : `<tr><td colspan="2" style="color:#9C9A92">No courses on this invoice.</td></tr>`

  const totRows =
    (s.discount > 0 ? `<div class="trow"><span>Discount${s.couponCode ? ' (' + esc(s.couponCode) + ')' : ''}</span><span class="v" style="color:#1D7A4F">− ₹${fmtAmt(s.discount)}</span></div>` : '') +
    `<div class="trow"><span>Paid</span><span class="v" style="color:#1D7A4F">₹${fmtAmt(s.paid || 0)}</span></div>` +
    `<div class="trow" style="border:none"><span>Balance due</span><span class="v" style="color:${(s.balance || 0) > 0 ? '#A32D2D' : '#1D7A4F'}">₹${fmtAmt(s.balance || 0)}</span></div>`

  const body = `
    <table class="it"><thead><tr><th>Course / Level</th><th class="r">Fee (₹)</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="tot"><div class="totbox"><div class="bl"></div>
      ${totRows}
      <div class="grand"><div class="gl">Total Fee</div><div class="gv">₹${fmtAmt(s.total || 0)}</div></div>
      <div class="words">In words: <b style="color:#534AB7">${esc(numToWords(s.total || 0))}</b></div>
    </div></div>
    ${(s.balance || 0) > 0 ? PAY_BOX : ''}`

  openWin(docShell({
    docTitle: 'FEE INVOICE', sub: 'Tax Invoice · Original Copy',
    refLabel: 'Invoice no.', refVal: ctx.refVal || ('STU-' + String(student.id).slice(0, 8).toUpperCase()),
    dateStr: fmtLong(ctx.date || new Date()), centre: ctx.centre,
    party: partyBlock(student), bodyHTML: body,
  }))
}

// ── Payment Receipt ──────────────────────────────────────────────────────────
// payment: { amount, mode, reference, paid_at, receipt_no }
// ctx.summary: { total, paid, balance }
export function printStudentReceipt(student, payment, ctx) {
  const s = ctx.summary || {}
  const body = `
    <table class="it"><thead><tr><th>Received with thanks</th><th class="r">Amount (₹)</th></tr></thead><tbody>
      <tr><td>Fee payment${payment.mode ? ' · ' + esc(String(payment.mode).replace(/_/g, ' ')) : ''}${payment.reference ? '<div class="mut">Ref: ' + esc(payment.reference) + '</div>' : ''}</td><td class="r">₹${fmtAmt(payment.amount || 0)}</td></tr>
    </tbody></table>
    <div class="tot"><div class="totbox"><div class="bl"></div>
      <div class="trow"><span>Total fee</span><span class="v">₹${fmtAmt(s.total || 0)}</span></div>
      <div class="trow"><span>Paid to date</span><span class="v" style="color:#1D7A4F">₹${fmtAmt(s.paid || 0)}</span></div>
      <div class="trow" style="border:none"><span>Balance</span><span class="v" style="color:${(s.balance || 0) > 0 ? '#A32D2D' : '#1D7A4F'}">${(s.balance || 0) > 0 ? '₹' + fmtAmt(s.balance) : 'Cleared ✓'}</span></div>
      <div class="grand"><div class="gl">Amount Received</div><div class="gv">₹${fmtAmt(payment.amount || 0)}</div></div>
      <div class="words">In words: <b style="color:#534AB7">${esc(numToWords(payment.amount || 0))}</b></div>
    </div></div>`

  openWin(docShell({
    docTitle: 'PAYMENT RECEIPT', sub: 'Official Receipt',
    refLabel: 'Receipt no.', refVal: payment.receipt_no || ('RCT-' + String(payment.id || '').slice(0, 8).toUpperCase()),
    dateStr: fmtLong(payment.paid_at || new Date()), centre: ctx.centre,
    party: partyBlock(student), bodyHTML: body,
  }))
}
