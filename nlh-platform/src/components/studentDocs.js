// Branded printable documents for students — Fee Invoice and Payment Receipt.
// Uses the EXACT same design as the franchisee/order invoice (InvoiceView):
// yellow masthead, purple tagline, meta row, From/Bill-to party cards, purple
// items table, bank+QR / summary boxes, thank-you footer. Only the heading and
// the bill-to party differ. Single A4 page, opens a print window.

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

// Shared NLH-branded A4 chrome (matches InvoiceView). opts: { title, sub, meta:[{l,v,status}], party, bodyHTML }
function shell(opts) {
  const metaCells = (opts.meta || []).map(function (m) {
    return `<div><div class="ml">${esc(m.l)}</div><div class="mv"${m.sans ? ' style="font-family:\'DM Sans\'"' : ''}>${esc(m.v)}</div>${
      m.status ? `<span class="pill ${m.status === 'paid' ? 'pp' : m.status === 'part' ? 'pa' : 'pu'}">${m.status === 'paid' ? 'Paid' : m.status === 'part' ? 'Part Paid' : 'Unpaid'}</span>` : ''
    }</div>`
  }).join('')

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(opts.title)}</title>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'DM Sans',system-ui,sans-serif;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .sheet{width:210mm;min-height:297mm;margin:0 auto;background:#fff;display:flex;flex-direction:column;overflow:hidden}
  /* masthead */
  .hd{background:linear-gradient(115deg,#FFF6D9 0%,#FFE89B 45%,#FFD234 80%,#FFB347 100%);padding:10px 20px 0;position:relative;overflow:hidden}
  .hd svg{position:absolute;left:0;right:0;bottom:-1px;width:100%;height:20px;pointer-events:none}
  .hdg{display:grid;grid-template-columns:68px 1fr auto;align-items:center;gap:12px;position:relative;z-index:2}
  .logo{width:68px;height:68px;background:#fff;border-radius:10px;padding:4px;box-shadow:0 3px 10px rgba(217,119,6,.2);display:flex;align-items:center;justify-content:center}
  .logo img{width:100%;height:100%;object-fit:contain}
  .ti{text-align:center}
  .ti .t{font:800 40px 'DM Sans';color:#1E40AF;letter-spacing:-.02em;line-height:1}
  .ti .s{font:700 8px 'DM Mono';color:#D97706;text-transform:uppercase;letter-spacing:.2em;margin-top:2px}
  .ad{text-align:right}
  .ho{display:inline-flex;align-items:center;gap:5px;background:#1E40AF;color:#fff;padding:3px 10px 3px 7px;border-radius:20px;font:700 7.5px 'DM Mono';text-transform:uppercase;letter-spacing:.1em;margin-bottom:4px}
  .ho i{width:5px;height:5px;border-radius:50%;background:#FBBF24;display:inline-block}
  .ad .n{font:700 12px 'DM Sans';color:#1A1916;line-height:1.2}
  .ad .l{font:500 8px 'DM Sans';color:#1A1916;line-height:1.6;margin-top:3px}
  /* tagline + meta */
  .tag{background:linear-gradient(90deg,#534AB7,#6F66CC);color:#fff;text-align:center;padding:5px 20px;font:600 8px 'DM Mono';text-transform:uppercase;letter-spacing:.14em}
  .meta{display:grid;grid-template-columns:repeat(4,1fr);background:#F7F6F3;border-bottom:1px solid #E2E0D8;padding:8px 20px;gap:10px}
  .ml{font:600 7.5px 'DM Mono';color:#9C9A92;text-transform:uppercase;letter-spacing:.07em}
  .mv{font:700 11px 'DM Mono';color:#1A1916}
  .pill{display:inline-flex;align-items:center;padding:2px 8px;border-radius:20px;font:700 8px 'DM Mono';text-transform:uppercase;letter-spacing:.07em;margin-top:2px}
  .pp{background:#E6F5ED;color:#1D7A4F}.pa{background:#FEF3E0;color:#8A5200}.pu{background:rgba(220,38,38,.1);color:#A32D2D}
  /* body */
  .body{flex:1;padding:10px 20px 14px;display:flex;flex-direction:column;gap:8px}
  .party{display:grid;grid-template-columns:1fr 1fr;gap:8px}
  .pcard{border-radius:10px;padding:9px 12px 24px;position:relative;overflow:hidden;min-height:104px}
  .pcard .bl{position:absolute;top:0;bottom:0;left:0;width:3px}
  .pcard .top{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:5px}
  .pcard .lbl{font:700 7.5px 'DM Mono';text-transform:uppercase;letter-spacing:.1em}
  .pcard .ph{font:700 11px 'DM Sans';color:#1A1916;white-space:nowrap}
  .pcard .nmrow{display:flex;align-items:center;gap:6px;margin-bottom:3px;flex-wrap:wrap}
  .pcard .bdg{background:rgba(0,0,0,.08);padding:2px 8px;border-radius:20px;font:700 8px 'DM Mono';text-transform:uppercase;letter-spacing:.04em}
  .pcard .nm{font:700 12px 'DM Sans';color:#1A1916;line-height:1.2}
  .pcard .ad2{font:500 9px 'DM Mono';color:#5C5A54;line-height:1.55}
  .pcard .em{position:absolute;left:12px;bottom:7px;font:500 9px 'DM Mono';color:#5C5A54;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:calc(100% - 18px)}
  /* items */
  .items{border:1px solid #E2E0D8;border-radius:10px;overflow:hidden}
  .ih{background:linear-gradient(90deg,#534AB7,#6F66CC);color:#fff;padding:9px 14px;display:grid;grid-template-columns:30px 1fr 110px;gap:10px;font:700 10px 'DM Mono';text-transform:uppercase;letter-spacing:.07em}
  .ih .r,.ir .r{text-align:right}
  .ir{display:grid;grid-template-columns:30px 1fr 110px;gap:10px;padding:9px 14px;border-bottom:1px solid #E2E0D8;align-items:center}
  .ir:last-child{border-bottom:none}
  .ir .num{font:600 10px 'DM Mono';color:#9C9A92}
  .ir .nm{font:600 13px 'DM Sans';color:#1A1916;line-height:1.25}
  .ir .amt{font:700 13.5px 'DM Mono';color:#1A1916}
  .kit{display:flex;flex-wrap:wrap;gap:4px 6px;margin-top:4px}
  .kit .k1{font:700 9px 'DM Mono';color:#9C8BD9;text-transform:uppercase;letter-spacing:.06em;align-self:center}
  .kit .k2{font:600 10px 'DM Mono';color:#534AB7;background:#EEEDFE;border-radius:4px;padding:2px 7px;white-space:nowrap}
  /* payment + totals */
  /* margin-top:auto pushes the totals/bank block down so it sits against the
     footer however few items there are — a receipt has only one line, and
     without this it floated directly under it leaving the page bottom-heavy. */
  .pt{display:grid;grid-template-columns:1.1fr 1fr;gap:8px;align-items:start;margin-top:auto}
  /* mascot fills the gap the anchoring opens up */
  .mascot{flex:1;display:flex;align-items:center;justify-content:center;pointer-events:none;min-height:0}
  .mascot img{width:44%;max-width:290px;opacity:.16;object-fit:contain}
  .pay{background:linear-gradient(135deg,#FFF7DA,#FFE89B);border-radius:10px;padding:10px 12px;position:relative;overflow:hidden;display:flex;flex-direction:column}
  .pay .bl{position:absolute;top:0;bottom:0;left:0;width:3px;background:#F59E0B}
  .pay .h{font:700 7.5px 'DM Mono';color:#D97706;text-transform:uppercase;letter-spacing:.1em;margin-bottom:3px}
  .pay .sub{font:500 9px 'DM Mono';color:#5C5A54;margin-bottom:8px}
  .pay .card{background:#fff;border-radius:8px;padding:10px 12px;display:grid;grid-template-columns:1fr 100px;gap:12px;box-shadow:0 1px 3px rgba(0,0,0,.06);align-items:center}
  .pay .bank{font:700 12px 'DM Sans';color:#1E40AF;margin-bottom:2px}
  .pay .br{font:500 9.5px 'DM Mono';color:#5C5A54;margin-bottom:7px}
  .pay .grid{display:grid;grid-template-columns:38px 1fr;gap:5px 10px;align-items:center}
  .pay .grid .k{color:#9C9A92;text-transform:uppercase;font:600 9px 'DM Mono'}
  .pay .grid .v{color:#1A1916;font:700 14px 'DM Mono';letter-spacing:.03em}
  .pay .qr{display:flex;flex-direction:column;align-items:center;gap:4px}
  .pay .qr .sp{font:700 8px 'DM Mono';color:#1E40AF;text-transform:uppercase;letter-spacing:.08em}
  .pay .qr img{width:98px;height:98px;background:#fff;border-radius:6px;padding:3px;border:2px solid #1E40AF;object-fit:contain}
  .pay .upi{margin-top:7px;background:#EEEDFE;border-radius:7px;padding:7px 12px;font:700 11px 'DM Mono';color:#534AB7;text-align:center}
  .tot{background:#EEEDFE;border-radius:10px;padding:12px 14px;position:relative;overflow:hidden;display:flex;flex-direction:column}
  .tot .bl{position:absolute;top:0;bottom:0;left:0;width:3px;background:#534AB7}
  .tot .h{font:700 9px 'DM Mono';color:#534AB7;text-transform:uppercase;letter-spacing:.1em;margin-bottom:8px}
  .trow{display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px dashed rgba(83,74,183,.2)}
  .trow .l{font:500 12px 'DM Sans';color:#5C5A54}
  .trow .v{font:600 12px 'DM Mono';color:#1A1916}
  .grand{margin-top:8px;background:linear-gradient(135deg,#534AB7,#6F66CC);border-radius:8px;padding:11px 14px;display:flex;justify-content:space-between;align-items:baseline;color:#fff;box-shadow:0 4px 14px rgba(83,74,183,.2)}
  .grand .gl{font:700 10px 'DM Mono';text-transform:uppercase;letter-spacing:.12em}
  .grand .gv{font:800 23px 'DM Sans';letter-spacing:-.01em;line-height:1}
  .words{margin-top:6px;font:500 9px 'DM Mono';color:#7A75A0;line-height:1.5;text-transform:uppercase;letter-spacing:.03em}
  /* footer */
  .ft{background:linear-gradient(115deg,#FFE89B,#FFD234);padding:10px 20px;display:flex;align-items:center;justify-content:space-between;gap:10px}
  .ft .ty{font:800 15px 'DM Sans';color:#1E40AF;letter-spacing:-.01em}
  .ft .cg{font:600 7.5px 'DM Mono';color:#5B3A00;text-transform:uppercase;letter-spacing:.06em;text-align:right}
  .np{text-align:right;padding:10px 20px;background:#f0f0f0}
  .np button{background:#534AB7;color:#fff;border:none;padding:8px 18px;border-radius:7px;font:600 13px sans-serif;cursor:pointer}
  /* ── A5: literally half an A4 (210 x 148mm), so the full-width design carries
     over unchanged and two receipts fit on one A4 sheet. A receipt is a single
     line, so the chrome tightens to earn back the vertical space. ── */
  .sheet.a5{min-height:148mm}
  .sheet.a5 .body{padding:7px 20px 8px;gap:6px}
  .sheet.a5 .pcard{min-height:0;padding:7px 12px 21px}
  .sheet.a5 .hd{padding:6px 20px 0}
  .sheet.a5 .logo{width:54px;height:54px}
  .sheet.a5 .hdg{grid-template-columns:54px 1fr auto}
  .sheet.a5 .ti .t{font-size:31px}
  .sheet.a5 .meta{padding:6px 20px}
  .sheet.a5 .ft{padding:6px 20px}
  /* Mascot as a true watermark: taken out of flow so it cannot affect the
     148mm height, sitting behind everything. The item rows have no background
     of their own, so it shows through them as well as through the gap. */
  .sheet.a5 .body{position:relative}
  /* Spans the item rows down to just above the summary — measured: items start
     at 23.4% of the body and the two totals boxes begin at 69.5%, and those are
     opaque, so anything lower gets its feet cut off. */
  .sheet.a5 .mascot{position:absolute;left:0;right:0;top:24%;bottom:32%;
    flex:none;height:auto;margin:0;z-index:0}
  .sheet.a5 .mascot img{height:100%;width:auto;max-width:none;opacity:.16}
  .sheet.a5 .party,.sheet.a5 .items,.sheet.a5 .pt{position:relative;z-index:1}
  .sheet.a5 .ir{background:transparent}
  .sheet.a5 .ih{padding:7px 14px}
  .sheet.a5 .ir{padding:6px 14px}
  .sheet.a5 .grand{margin-top:6px;padding:8px 14px}
  .sheet.a5 .grand .gv{font-size:21px}
  .sheet.a5 .words{margin-top:4px}
  /* A receipt has no bank/QR box beside the summary, so the left half sat empty.
     On A5 the summary spans the full width and the three figures read across
     as a row, which balances the page instead of hugging the right edge. */
  .sheet.a5 .pt{grid-template-columns:1fr 1fr;align-items:stretch}
  /* no fee on record — nothing to summarise, so the one box spans the width
     rather than sitting stranded in the right-hand column */
  .sheet.a5 .pt.solo{grid-template-columns:1fr}
  /* The figures and the amount received sit side by side, so the closing block
     is half as tall and the mascot gets the height back. */
  .sheet.a5 .tot{padding:9px 12px 10px 14px}
  .sheet.a5 .trow{padding:4px 0}
  .sheet.a5 .rcv{justify-content:space-between}
  .sheet.a5 .rcv .grand{margin-top:auto}
  @media print{@page{size:A4;margin:0}.np{display:none}.sheet{box-shadow:none}}
  ${opts.size === 'A5' ? '@media print{@page{size:210mm 148mm;margin:0}}' : ''}
  </style></head><body>
  <div class="np"><button onclick="window.print()">Print / Save PDF</button></div>
  <div class="sheet${opts.size === 'A5' ? ' a5' : ''}">
    <div class="hd">
      <svg viewBox="0 0 800 20" preserveAspectRatio="none"><path d="M0 20 L0 12 Q100 2,200 11 T400 11 T600 11 T800 12 L800 20 Z" fill="#fff"/></svg>
      <div class="hdg">
        <div class="logo"><img src="/NLH%20Logo.png" alt="NLH"></div>
        <div class="ti"><div class="t">${esc(opts.title)}</div><div class="s">${esc(opts.sub)}</div></div>
        <div class="ad">
          <span class="ho"><i></i>Head Office</span>
          <div class="n">New Learning Horizons</div>
          <div class="l">9, Anjuman Shopping Complex, Residency Rd, Sadar, Nagpur 440 001<br>☎ +91 9373 111 311 · ✉ dhiral@nlhnagpur.info</div>
        </div>
      </div>
    </div>
    <div class="tag">New Learning Horizons · ISO 9001:2015 Certified · Enriching Children's Future</div>
    <div class="meta">${metaCells}</div>
    <div class="body">
      ${opts.party}
      ${opts.bodyHTML}
    </div>
    <div class="ft"><div class="ty">Thank you!</div><div class="cg">Computer generated ${esc(opts.title.toLowerCase())} · No signature required</div></div>
  </div>
  </body></html>`
}

// { badge, name, sub, phone, email } — whoever the document is billed to.
function partyCards(party) {
  return `<div class="party">
    <div class="pcard" style="background:#EEEDFE"><div class="bl" style="background:#534AB7"></div>
      <div class="top"><span class="lbl" style="color:#534AB7">From</span><span class="ph">☎ 9373 111 311</span></div>
      <div class="nmrow"><span class="bdg" style="color:#534AB7">Head Office</span><span class="nm">New Learning Horizons</span></div>
      <div class="ad2">9, Anjuman Shopping Complex, Residency Rd, Sadar, Nagpur 440 001</div>
      <div class="em">✉ dhiral@nlhnagpur.info</div>
    </div>
    <div class="pcard" style="background:linear-gradient(135deg,#FFF7DA,#FFEAA0)"><div class="bl" style="background:#F59E0B"></div>
      <div class="top"><span class="lbl" style="color:#F59E0B">Bill To</span>${party.phone ? `<span class="ph">☎ ${esc(party.phone)}</span>` : ''}</div>
      <div class="nmrow"><span class="bdg" style="color:#D97706">${esc(party.badge || 'Bill To')}</span><span class="nm">${esc(party.name || '—')}</span></div>
      <div class="ad2">${esc(party.sub || '')}</div>
      ${party.email ? `<div class="em">✉ ${esc(party.email)}</div>` : ''}
    </div>
  </div>`
}

function studentParty(student) {
  return {
    badge: 'Student',
    name:  student.full_name,
    sub:   (student.parent_name ? 'Parent: ' + student.parent_name : '') +
           (student.address ? (student.parent_name ? ' · ' : '') + student.address : ''),
    phone: student.phone,
    email: student.email,
  }
}

const PAY_BOX = `<div class="pt"><div class="pay"><div class="bl"></div>
  <div class="h">Payment Details</div>
  <div class="sub">NEFT / IMPS / UPI accepted</div>
  <div class="card">
    <div>
      <div class="bank">🏦 IDFC First Bank</div>
      <div class="br">Byramji Town Branch, Nagpur</div>
      <div class="grid"><span class="k">A/C</span><span class="v">10278096847</span><span class="k">IFSC</span><span class="v">IDFB0042504</span></div>
    </div>
    <div class="qr"><span class="sp">Scan &amp; Pay</span><img src="/nlh-upi-qr.png" alt="QR"></div>
  </div>
  <div class="upi">📱 UPI: newlearninghorizons@idfcbank</div>
</div>`

// window.open(...) — whether given '' or a blob: URL — is a genuinely
// unreliable way to get a print-preview in front of a user: popup blockers
// kill the empty-URL form silently, and several browsers refuse to
// cross-navigate a blob: URL into a brand new top-level tab even via a
// real click (both confirmed against a real browser, not just this one).
// A hidden iframe on the CURRENT page sidesteps both — no new window or
// tab is ever created, so there's nothing for a blocker to block — and
// calling print() on it goes straight to the OS print dialog, where
// "Save as PDF" is one of the destinations.
function openWin(html) {
  const iframe = document.createElement('iframe')
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden'
  document.body.appendChild(iframe)
  const doc = iframe.contentWindow.document
  doc.open(); doc.write(html); doc.close()
  function cleanup() { if (iframe.parentNode) document.body.removeChild(iframe) }
  iframe.onload = function () {
    setTimeout(function () {
      try {
        iframe.contentWindow.focus()
        iframe.contentWindow.print()
      } finally {
        // afterprint fires once the dialog is dismissed; a timeout is the
        // fallback for browsers that don't fire it reliably for iframes.
        iframe.contentWindow.addEventListener('afterprint', cleanup)
        setTimeout(cleanup, 60000)
      }
    }, 150)
  }
}

// Every document ends here. By default it opens a print window; pass
// ctx.asHtml to get the markup back instead, so the same document can be
// rendered off-screen and captured as a PNG for WhatsApp.
function emit(ctx, html) {
  if (ctx && ctx.asHtml) return html
  openWin(html)
  return html
}

// ── Fee Invoice (same design as the franchisee invoice) ───────────────────────
// ctx.items: [{kind:'course'|'kit', sku_id, name, qty, amount}]  (fallback ctx.lines:[{name,fee,sku_id}])
// ctx.summary: { discount, couponCode, total, paid, balance }
//   `total` is the agreed fee and is what the parent sees. `discount` is used
//   only to net down the line amounts when no total is supplied — it is never
//   printed, and neither is the coupon code.
export function printStudentInvoice(student, ctx) {
  let items = ctx.items
  if (!items && ctx.lines) items = ctx.lines.map(function (l) { return { kind: 'course', sku_id: l.sku_id, name: l.name, amount: l.fee || 0 } })
  items = items || []
  const s = ctx.summary || {}
  const courses = items.filter(function (i) { return i.kind === 'course' })
  const subtotal = courses.reduce(function (a, c) { return a + (c.amount || 0) }, 0)
  const balance = s.balance != null ? s.balance : Math.max(0, (s.total || 0) - (s.paid || 0))

  // The parent is quoted ONE agreed fee. Discounts, list prices and internal
  // adjustments are our business, not theirs — so rather than declaring a
  // discount line, the reduction is folded into the course amounts. The lines
  // then add up to the agreed total, which is what the parent was told.
  const netTotal = (s.total != null) ? s.total : Math.max(0, subtotal - (s.discount || 0))
  const netAmount = (function () {
    if (!courses.length || subtotal <= 0 || netTotal === subtotal) {
      return function (c) { return c.amount || 0 }
    }
    let allocated = 0
    const shares = courses.map(function (c, i) {
      if (i === courses.length - 1) return netTotal - allocated   // last line takes the remainder
      const share = Math.round((c.amount || 0) * netTotal / subtotal)
      allocated += share
      return share
    })
    return function (c, i) { return shares[i] }
  })()

  const rows = courses.length ? courses.map(function (c, i) {
    const kits = items.filter(function (k) { return k.kind === 'kit' && k.sku_id === c.sku_id })
    const kitHtml = kits.length
      ? `<div class="kit"><span class="k1">Kit:</span>${kits.map(function (k) { return `<span class="k2">${esc(k.name)}${k.qty > 1 ? ' ×' + k.qty : ''}</span>` }).join('')}</div>`
      : ''
    return `<div class="ir"><div class="num">${String(i + 1).padStart(2, '0')}</div><div><div class="nm">${esc(c.name)}</div>${kitHtml}</div><div class="amt r">₹${fmtAmt(netAmount(c, i))}</div></div>`
  }).join('') : `<div class="ir"><div></div><div class="nm" style="color:#9C9A92">No courses on this invoice.</div><div></div></div>`

  const trows =
    `<div class="trow"><span class="l">Amount paid</span><span class="v" style="color:${(s.paid || 0) > 0 ? '#1D7A4F' : '#9C9A92'}">${(s.paid || 0) > 0 ? '₹' + fmtAmt(s.paid) : '—'}</span></div>` +
    `<div class="trow" style="border:none"><span class="l">Balance due</span><span class="v" style="color:${balance > 0 ? '#A32D2D' : '#1D7A4F'}">₹${fmtAmt(balance)}</span></div>`

  const body = `
    <div class="items"><div class="ih"><div>#</div><div>Course / Level</div><div class="r">Fee (₹)</div></div>${rows}</div>
    <div class="mascot"><img src="/NLH%20Mascot.png" alt=""></div>
    <div class="pt">
      ${(balance > 0) ? PAY_BOX.replace('<div class="pt">', '') : '<div></div>'}
      <div class="tot"><div class="bl"></div>
        <div class="h">Invoice Summary</div>
        ${trows}
        <div class="grand"><div class="gl">Total Fee</div><div class="gv"><span style="font:700 12px 'DM Sans';margin-right:3px;opacity:.85">₹</span>${fmtAmt(s.total || 0)}</div></div>
        <div class="words">In words: <b style="color:#534AB7">${esc(numToWords(s.total || 0))}</b></div>
      </div>
    </div>`

  return emit(ctx, shell({
    title: 'FEE INVOICE', sub: 'Tax Invoice · Original Copy',
    meta: [
      { l: 'Invoice no.', v: ctx.refVal || '—' },
      { l: 'Date', v: fmtLong(ctx.date || new Date()) },
      { l: 'Status', v: balance > 0 ? ((s.paid || 0) > 0 ? 'Part paid' : 'Unpaid') : 'Paid', status: balance > 0 ? ((s.paid || 0) > 0 ? 'part' : 'unpaid') : 'paid' },
      { l: 'Centre', v: ctx.centre || '—', sans: true },
    ],
    party: partyCards(studentParty(student)), bodyHTML: body,
  }))
}

// ── Payment Receipt (same design, heading 'PAYMENT RECEIPT') ──────────────────
export function printStudentReceipt(student, payment, ctx) {
  const s = ctx.summary || {}
  const bal = (s.balance != null) ? s.balance : Math.max(0, (s.total || 0) - (s.paid || 0))
  const body = `
    <div class="items"><div class="ih"><div>#</div><div>Received with thanks — fee payment</div><div class="r">Amount (₹)</div></div>
      <div class="ir"><div class="num">01</div><div><div class="nm">Fee payment${payment.mode ? ' · ' + esc(String(payment.mode).replace(/_/g, ' ')) : ''}</div>${payment.reference ? `<div class="kit"><span class="k1">Ref:</span><span class="k2">${esc(payment.reference)}</span></div>` : ''}</div><div class="amt r">₹${fmtAmt(payment.amount || 0)}</div></div>
    </div>
${receiptTotals([
      { l: 'Total fee',    v: '&#8377;' + fmtAmt(s.total || 0) },
      { l: 'Paid to date', v: '&#8377;' + fmtAmt(s.paid  || 0), c: '#1D7A4F' },
      { l: 'Balance',      v: bal > 0 ? '&#8377;' + fmtAmt(bal) : 'Cleared &#10003;', c: bal > 0 ? '#A32D2D' : '#1D7A4F' },
    ], payment.amount)}`

  return emit(ctx, shell({
    title: 'PAYMENT RECEIPT', sub: 'Official Receipt', size: 'A5',
    meta: [
      { l: 'Receipt no.', v: payment.receipt_no || '—' },
      { l: 'Date', v: fmtLong(payment.paid_at || new Date()) },
      { l: 'Mode', v: payment.mode ? String(payment.mode).replace(/_/g, ' ') : '—', sans: true },
      { l: 'Centre', v: ctx.centre || '—', sans: true },
    ],
    party: partyCards(studentParty(student)), bodyHTML: body,
  }))
}

// ── Payment Receipt for a franchisee's payment against an order invoice ───────
// Identical chrome to the student receipt — only the bill-to party and the
// wording differ, so both receipts are recognisably the same document.
// order: { invoice_no, order_ref, grand_total, amount_paid, placer }
// payment: a single order_payments row
export function printOrderReceipt(order, payment, ctx) {
  const c        = ctx || {}
  const total    = order.grand_total || 0
  const paid     = c.paidToDate != null ? c.paidToDate : (order.amount_paid || 0)
  const bal      = Math.max(0, total - paid)
  const fr       = order.placer || {}
  const againstT = order.invoice_no || order.order_ref || ''

  const body = `
    <div class="items"><div class="ih"><div>#</div><div>Received with thanks — payment against invoice</div><div class="r">Amount (Rs)</div></div>
      <div class="ir"><div class="num">01</div><div><div class="nm">Payment${payment.mode ? ' &middot; ' + esc(String(payment.mode).replace(/_/g, ' ')) : ''}</div>${
        againstT ? `<div class="kit"><span class="k1">Against:</span><span class="k2">${esc(againstT)}</span></div>` : ''
      }${payment.reference ? `<div class="kit"><span class="k1">Ref:</span><span class="k2">${esc(payment.reference)}</span></div>` : ''}</div><div class="amt r">&#8377;${fmtAmt(payment.amount || 0)}</div></div>
    </div>
${receiptTotals([
      { l: 'Invoice total', v: '&#8377;' + fmtAmt(total) },
      { l: 'Paid to date',  v: '&#8377;' + fmtAmt(paid),  c: '#1D7A4F' },
      { l: 'Balance',       v: bal > 0 ? '&#8377;' + fmtAmt(bal) : 'Cleared &#10003;', c: bal > 0 ? '#A32D2D' : '#1D7A4F' },
    ], payment.amount)}`

  return emit(ctx, shell({
    title: 'PAYMENT RECEIPT', sub: 'Official Receipt', size: 'A5',
    meta: [
      { l: 'Receipt no.', v: payment.receipt_no || '-' },
      { l: 'Date', v: fmtLong(payment.paid_on || payment.paid_at || new Date()) },
      { l: 'Mode', v: payment.mode ? String(payment.mode).replace(/_/g, ' ') : '-', sans: true },
      { l: 'Against', v: againstT || '-' },
    ],
    party: partyCards({
      badge: fr.tier || 'Franchisee',
      name:  fr.business_name,
      sub:   [fr.owner_name, fr.city].filter(Boolean).join(' · '),
      phone: fr.phone,
      email: fr.email,
    }),
    bodyHTML: body,
  }))
}

// ── Payment Receipt for a franchisee's enrolment / franchise fee ──────────────
// Same chrome again — only the bill-to party and the wording change.
// franchisee: { business_name, owner_name, tier, city, phone, email, centre_code }
// payment: a franchisee_payments row
// ctx: { total, paidToDate }  — the franchise fee and the running total as at
//      this payment, so a reprint shows the figures as they stood.
export function printFranchiseeReceipt(franchisee, payment, ctx) {
  const c     = ctx || {}
  const total = c.total || 0
  const paid  = c.paidToDate != null ? c.paidToDate : 0
  const bal   = Math.max(0, total - paid)
  const mode  = payment.payment_mode || payment.mode
  const ref   = payment.reference_no || payment.reference

  const body = `
    <div class="items"><div class="ih"><div>#</div><div>Received with thanks — franchise fee</div><div class="r">Amount (Rs)</div></div>
      <div class="ir"><div class="num">01</div><div><div class="nm">Franchise fee payment${mode ? ' &middot; ' + esc(String(mode).replace(/_/g, ' ')) : ''}</div>${
        ref ? `<div class="kit"><span class="k1">Ref:</span><span class="k2">${esc(ref)}</span></div>` : ''
      }${payment.notes ? `<div class="kit"><span class="k1">Note:</span><span class="k2">${esc(payment.notes)}</span></div>` : ''}</div><div class="amt r">&#8377;${fmtAmt(payment.amount || 0)}</div></div>
    </div>
${receiptTotals(total > 0 ? [
      { l: 'Franchise fee', v: '&#8377;' + fmtAmt(total) },
      { l: 'Paid to date',  v: '&#8377;' + fmtAmt(paid),  c: '#1D7A4F' },
      { l: 'Balance',       v: bal > 0 ? '&#8377;' + fmtAmt(bal) : 'Cleared &#10003;', c: bal > 0 ? '#A32D2D' : '#1D7A4F' },
    ] : [], payment.amount)}`

  return emit(ctx, shell({
    title: 'PAYMENT RECEIPT', sub: 'Official Receipt', size: 'A5',
    meta: [
      { l: 'Receipt no.', v: payment.receipt_no || '-' },
      { l: 'Date', v: fmtLong(payment.payment_date || payment.paid_on || new Date()) },
      { l: 'Mode', v: mode ? String(mode).replace(/_/g, ' ') : '-', sans: true },
      { l: 'Centre', v: franchisee.centre_code || '-' },
    ],
    party: partyCards({
      badge: franchisee.tier || 'Franchisee',
      name:  franchisee.business_name,
      sub:   [franchisee.owner_name, franchisee.city].filter(Boolean).join(' · '),
      phone: franchisee.phone,
      email: franchisee.email,
    }),
    bodyHTML: body,
  }))
}

// ── Franchise Invoice — the very first entry on a franchisee's account ────────
// Same chrome as the Fee Invoice, listing every registered program as a line
// (the enrollment fee is a single lump sum, not priced per program, so lines
// carry no individual amount) with the fee as one grand total.
// franchisee: { business_name, owner_name, tier, city, state, phone, email,
//               enrollment_fee, enrollment_invoice_no, contract_start, created_at }
// courseNames: string[] — unique program names from registered_courses
export function printFranchiseeEnrollmentInvoice(franchisee, courseNames, ctx) {
  const c     = ctx || {}
  const total = c.total != null ? c.total : (franchisee.enrollment_fee || 0)
  const names = (courseNames && courseNames.length) ? courseNames : ['To be assigned']
  const tierLabel = { SMF: 'State Master Franchise', CF: 'City Franchise', UF: 'Unit Franchise' }[franchisee.tier] || franchisee.tier || 'Franchise'

  const rows = names.map(function (n, i) {
    return `<div class="ir"><div class="num">${String(i + 1).padStart(2, '0')}</div><div><div class="nm">${esc(n)}</div></div><div class="amt r"></div></div>`
  }).join('')

  const body = `
    <div class="items"><div class="ih"><div>#</div><div>Registered Program</div><div class="r"></div></div>${rows}</div>
    <div class="mascot"><img src="/NLH%20Mascot.png" alt=""></div>
    <div class="pt">
      <div></div>
      <div class="tot"><div class="bl"></div>
        <div class="h">Invoice Summary</div>
        <div class="trow" style="border:none"><span class="l">${esc(tierLabel)} enrollment fee</span><span class="v">&#8377;${fmtAmt(total)}</span></div>
        <div class="grand"><div class="gl">Total Amount</div><div class="gv"><span style="font:700 12px 'DM Sans';margin-right:3px;opacity:.85">&#8377;</span>${fmtAmt(total)}</div></div>
        <div class="words">In words: <b style="color:#534AB7">${esc(numToWords(total))}</b></div>
      </div>
    </div>`

  return emit(ctx, shell({
    title: 'FRANCHISE INVOICE', sub: 'Enrollment · Original Copy',
    meta: [
      { l: 'Invoice no.', v: franchisee.enrollment_invoice_no || '—' },
      { l: 'Date', v: fmtLong(franchisee.contract_start || franchisee.created_at || new Date()) },
      { l: 'Tier', v: tierLabel, sans: true },
      { l: 'Programs', v: String(names.length), sans: true },
    ],
    party: partyCards({
      badge: franchisee.tier || 'Franchisee',
      name:  franchisee.business_name || franchisee.owner_name,
      sub:   [franchisee.owner_name, franchisee.city, franchisee.state].filter(Boolean).join(' · '),
      phone: franchisee.phone,
      email: franchisee.email,
    }),
    bodyHTML: body,
  }))
}

// ── Statement of Account — the franchisee's full ledger as one document ───────
// Every debit/credit row, oldest first, as a real HTML <table> (not the
// app's usual itemised-invoice divs) specifically so its <thead> repeats on
// every printed page — a statement can run to many rows, unlike a single
// invoice or receipt.
// franchisee: { business_name, owner_name, tier, city, state, phone, email }
// transactions: [{ date, desc, ref, debit, credit, balance }] — already
//   filtered/sorted by the caller (oldest first)
// opts: { from, to, totalDebit, totalCredit, balance }
export function printFranchiseeStatement(franchisee, transactions, opts) {
  const c = opts || {}
  const txns = transactions || []

  const periodLabel = c.from && c.to ? fmtLong(c.from) + ' to ' + fmtLong(c.to)
    : c.from ? 'From ' + fmtLong(c.from)
    : c.to   ? 'Up to ' + fmtLong(c.to)
    : 'All time'

  const rows = txns.length ? txns.map(function (t) {
    return `<tr>
      <td style="padding:8px 10px;font:600 10px 'DM Mono';color:#5C5A54;white-space:nowrap;border-bottom:1px solid #E2E0D8">${fmtLong(t.date)}</td>
      <td style="padding:8px 10px;font:600 11px 'DM Sans';color:#1A1916;border-bottom:1px solid #E2E0D8">${esc(t.desc)}</td>
      <td style="padding:8px 10px;font:600 10px 'DM Mono';color:#9C9A92;white-space:nowrap;border-bottom:1px solid #E2E0D8">${esc(t.ref || '—')}</td>
      <td style="padding:8px 10px;font:700 11px 'DM Mono';color:${t.debit ? '#A32D2D' : '#9C9A92'};text-align:right;white-space:nowrap;border-bottom:1px solid #E2E0D8">${t.debit ? '&#8377;' + fmtAmt(t.debit) : '—'}</td>
      <td style="padding:8px 10px;font:700 11px 'DM Mono';color:${t.credit ? '#1D7A4F' : '#9C9A92'};text-align:right;white-space:nowrap;border-bottom:1px solid #E2E0D8">${t.credit ? '&#8377;' + fmtAmt(t.credit) : '—'}</td>
      <td style="padding:8px 10px;font:700 11px 'DM Mono';color:${t.balance > 0 ? '#A32D2D' : '#1A1916'};text-align:right;white-space:nowrap;border-bottom:1px solid #E2E0D8">&#8377;${fmtAmt(t.balance)}</td>
    </tr>`
  }).join('') : `<tr><td colspan="6" style="padding:20px;text-align:center;color:#9C9A92;font:500 11px 'DM Sans'">No transactions in this period.</td></tr>`

  const body = `
    <div style="font:500 11px 'DM Sans';color:#5C5A54;line-height:1.6;background:#F7F6F3;border-radius:8px;padding:10px 14px">
      This is a statement of account issued by <b style="color:#1A1916">New Learning Horizons</b> for
      <b style="color:#1A1916">${esc(franchisee.business_name || franchisee.owner_name || 'this franchisee')}</b>,
      covering <b style="color:#1A1916">${esc(periodLabel)}</b>. All amounts are in Indian Rupees (&#8377;).
    </div>
    <table style="width:100%;border-collapse:collapse;border:1px solid #E2E0D8;border-radius:10px;overflow:hidden">
      <thead>
        <tr style="background:linear-gradient(90deg,#534AB7,#6F66CC)">
          <th style="padding:9px 10px;text-align:left;font:700 9px 'DM Mono';color:#fff;text-transform:uppercase;letter-spacing:.07em">Date</th>
          <th style="padding:9px 10px;text-align:left;font:700 9px 'DM Mono';color:#fff;text-transform:uppercase;letter-spacing:.07em">Description</th>
          <th style="padding:9px 10px;text-align:left;font:700 9px 'DM Mono';color:#fff;text-transform:uppercase;letter-spacing:.07em">Reference</th>
          <th style="padding:9px 10px;text-align:right;font:700 9px 'DM Mono';color:#fff;text-transform:uppercase;letter-spacing:.07em">Debit</th>
          <th style="padding:9px 10px;text-align:right;font:700 9px 'DM Mono';color:#fff;text-transform:uppercase;letter-spacing:.07em">Credit</th>
          <th style="padding:9px 10px;text-align:right;font:700 9px 'DM Mono';color:#fff;text-transform:uppercase;letter-spacing:.07em">Balance</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="pt">
      <div></div>
      <div class="tot"><div class="bl"></div>
        <div class="h">Statement Summary</div>
        <div class="trow"><span class="l">Total Debit</span><span class="v">&#8377;${fmtAmt(c.totalDebit || 0)}</span></div>
        <div class="trow" style="border:none"><span class="l">Total Credit</span><span class="v" style="color:#1D7A4F">&#8377;${fmtAmt(c.totalCredit || 0)}</span></div>
        <div class="grand"><div class="gl">${(c.balance || 0) > 0 ? 'Balance Due' : 'Balance'}</div><div class="gv">${(c.balance || 0) > 0 ? '<span style="font:700 12px \'DM Sans\';margin-right:3px;opacity:.85">&#8377;</span>' + fmtAmt(c.balance) : 'Cleared &#10003;'}</div></div>
      </div>
    </div>`

  return emit(opts, shell({
    title: 'STATEMENT OF ACCOUNT', sub: 'New Learning Horizons · Franchise Account',
    meta: [
      { l: 'Franchisee', v: franchisee.business_name || franchisee.owner_name || '—', sans: true },
      { l: 'Period', v: periodLabel, sans: true },
      { l: 'Generated', v: fmtLong(new Date()) },
      { l: 'Tier', v: franchisee.tier || '—', sans: true },
    ],
    party: partyCards({
      badge: franchisee.tier || 'Franchisee',
      name:  franchisee.business_name || franchisee.owner_name,
      sub:   [franchisee.owner_name, franchisee.city, franchisee.state].filter(Boolean).join(' · '),
      phone: franchisee.phone,
      email: franchisee.email,
    }),
    bodyHTML: body,
  }))
}

// The two boxes that close a receipt: the running figures on the left, the
// amount received on the right. Side by side they come to roughly half the
// height of one stacked box, which is what leaves room for the mascot between
// the item line and the footer.
// rows: [{ l, v, c }] — v is pre-formatted HTML, c an optional colour.
function receiptTotals(rows, amount) {
  const list  = rows || []
  const trows = list.map(function (r, i) {
    return '<div class="trow"' + (i === list.length - 1 ? ' style="border:none"' : '') + '>' +
      '<span class="l">' + esc(r.l) + '</span>' +
      '<span class="v"' + (r.c ? ' style="color:' + r.c + '"' : '') + '>' + r.v + '</span></div>'
  }).join('')

  return `
    <div class="mascot"><img src="/NLH%20Mascot.png" alt=""></div>
    <div class="pt${trows ? '' : ' solo'}">
      ${trows ? `<div class="tot"><div class="bl"></div>
        <div class="h">Receipt Summary</div>${trows}
      </div>` : ''}
      <div class="tot rcv"><div class="bl"></div>
        <div class="h">Amount Received</div>
        <div class="grand"><div class="gl">Received</div><div class="gv"><span style="font:700 12px 'DM Sans';margin-right:3px;opacity:.85">&#8377;</span>${fmtAmt(amount || 0)}</div></div>
        <div class="words">In words: <b style="color:#534AB7">${esc(numToWords(amount || 0))}</b></div>
      </div>
    </div>`
}

// ── Unit Franchise Agreement — plain-paper legal document, not the yellow/
// purple financial-document chrome above. Deliberately unstyled: NLH logo
// top-left, head-office address top-right, a rule, serif body text, a
// plain-bordered kit table, underline signature lines, "Page 1 of 1" as the
// only footer. Same clause text for every franchisee — only the meta,
// party, course list and Annexure A kit table (a snapshot taken when the
// agreement was generated — franchisee_agreements.courses/.kit) differ.
// franchisee: { business_name, owner_name, tier, city, state, address, email }
// agreement: a franchisee_agreements row — { agreement_no, fee, term_start,
//   term_end, courses, kit, status, signed_at, signed_name, verification_code }
function numberWords(n) {
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']
  function cvt(x) {
    if (x < 20) return ones[x]
    if (x < 100) return tens[Math.floor(x / 10)] + (x % 10 ? ' ' + ones[x % 10] : '')
    if (x < 1000) return ones[Math.floor(x / 100)] + ' Hundred' + (x % 100 ? ' ' + cvt(x % 100) : '')
    if (x < 100000) return cvt(Math.floor(x / 1000)) + ' Thousand' + (x % 1000 ? ' ' + cvt(x % 1000) : '')
    return cvt(Math.floor(x / 100000)) + ' Lakh' + (x % 100000 ? ' ' + cvt(x % 100000) : '')
  }
  return cvt(Math.round(n || 0))
}

const AGREEMENT_CLAUSES = function (termLabel) { return `
  <div class="clauses">
    <div class="clause">The UF agrees to teach the courses to the interested students only in the area of the Unit Franchisee Centre.</div>
    <div class="clause">New Learning Horizons shall coordinate &amp; support the Franchisee Centre owner by providing a one-time training in the courses opted for to the Course Instructor (CI) or Instructors appointed by the UF and monitor their progress from time to time. Any subsequent training required shall be on a chargeable basis.</div>
    <div class="clause">The UF shall purchase all the course material to teach the course to the interested students from New Learning Horizons at the rates fixed, or as may be revised from time to time (see Annexure A). The UF shall not reproduce the course material either by photocopy or duplication, or print in any other form or name for any purpose.</div>
    <div class="clause">New Learning Horizons shall forward a banner (one time), study material, students' admission form and receipt books as and when required, and a Certificate on completion of the course to the Centre as a part of the Kit.
      <div class="sub"><div class="subclause">NLH will also supply on order from the UF, students' study material and a Certificate on completion of the course to the Centres as a part of the Student Kit; the cost of the student kit ordered and courier charges will be paid by the UF.</div></div>
    </div>
    <div class="clause">New Learning Horizons reserves the right to change the cost of training fees and the cost of the student's course material from time to time.</div>
    <div class="clause">The UF shall follow the methods and systems set out in the training by NLH for all the courses opted for, and also ensure the following:
      <div class="sub">
        <div class="subclause">Use and supply only the said course material as received from NLH and shall not conduct any unauthorised or similar type of courses.</div>
        <div class="subclause">Keep and maintain a full and proper student enrolment, attendance, progress and fees register for the students in her area of operation.</div>
        <div class="subclause">Send every month a list of students enrolled and a list of students who drop out during the course of study, in the set formats sent by New Learning Horizons from time to time.</div>
      </div>
    </div>
    <div class="clause">UF shall maintain confidentiality of business methods, pricing, and training content, and shall also be responsible for the data privacy of students and staff.</div>
    <div class="clause">Upon termination of the agreement for any cause, the UF shall:
      <div class="sub">
        <div class="subclause">Promptly pay to New Learning Horizons all money due;</div>
        <div class="subclause">Promptly return all instructional and educational material supplied to them and cease to describe herself as UF of NLH;</div>
        <div class="subclause">Not impart the knowledge gained with respect to the above courses to anyone thereafter.</div>
      </div>
    </div>
    <div class="clause">This agreement shall be for a period of 3 years (${esc(termLabel)}), which may be extendable with the mutual consent of both parties at a nominal renewal amount of 25% of the Franchise amount prevalent at the time. However, either party may terminate the agreement by giving the other party 1 month's prior registered notice in the event of a breach of any term or condition of this agreement. In the event of the agreement herein being terminated, New Learning Horizons shall not be liable to the UF for any compensation or damage of any kind.</div>
    <div class="clause">UF must demonstrate consistent growth and program outreach. NLH reserves the right to terminate the agreement for poor performance.</div>
    <div class="clause">Disputes, if any, shall be resolved amicably; failing which, arbitration shall be held in Nagpur. Jurisdiction will be the Nagpur courts only.</div>
    <div class="clause">The fee structure and sharing ratios of all courses are as per Annexure A and were also explained at the time of signing the contract. These are subject to change from time to time as per changes in the course and course material.</div>
  </div>` }

const AGREEMENT_STYLE = `
  :root{--ink:#111;--muted:#555;--rule:#111;--hair:#bbb}
  *{box-sizing:border-box}
  body{margin:0;background:#fff;color:var(--ink);font-family:Georgia,'Times New Roman',Times,serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .page{max-width:210mm;margin:0 auto;padding:16mm 18mm}
  .letterhead{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;margin-bottom:8px}
  .brand{display:flex;align-items:center;gap:12px}
  .brand img{width:44px;height:44px;object-fit:contain}
  .brand b{font:700 15px Georgia,serif;display:block}
  .brand span{font:italic 10.5px Georgia,serif;color:var(--muted);display:block}
  .addr{text-align:right;font:11px/1.6 Arial,Helvetica,sans-serif;color:var(--muted)}
  .rule{border:none;border-top:1px solid var(--rule);margin:14px 0 22px}
  h1{text-align:center;font:700 16px/1.4 Georgia,serif;text-transform:uppercase;letter-spacing:.04em;margin:0 0 4px}
  .subtitle{text-align:center;font:italic 11.5px Georgia,serif;color:var(--muted);margin:0 0 22px}
  .docmeta{font:11px/1.7 Arial,Helvetica,sans-serif;color:var(--muted);text-align:center;margin-bottom:26px}
  .docmeta b{color:var(--ink)}
  .body{font-size:12.8px;line-height:1.85;text-align:left}
  .body p{margin:0 0 13px}
  h2{font:700 12px Georgia,serif;text-transform:uppercase;letter-spacing:.03em;margin:24px 0 8px}
  .clauses{counter-reset:cl;list-style:none;margin:0;padding:0}
  .clause{counter-increment:cl;position:relative;padding-left:24px;margin-bottom:11px}
  .clause::before{content:counter(cl) '.';position:absolute;left:0;top:0;font-weight:700}
  .sub{counter-reset:scl;list-style:none;margin:6px 0 0;padding:0}
  .subclause{counter-increment:scl;position:relative;padding-left:28px;margin:6px 0 0}
  .subclause::before{content:'(' counter(scl,lower-alpha) ')';position:absolute;left:0;top:0;font-weight:700}
  table.kit{width:100%;border-collapse:collapse;margin:14px 0 4px;font:11.5px/1.5 Arial,Helvetica,sans-serif}
  table.kit caption{caption-side:top;text-align:left;font:italic 11px Georgia,serif;color:var(--muted);margin-bottom:8px}
  table.kit th,table.kit td{border:1px solid var(--ink);padding:6px 10px;text-align:left}
  table.kit th{font-weight:700}
  table.kit td.r,table.kit th.r{text-align:right;font-variant-numeric:tabular-nums}
  .feeline{font:11.5px Arial,Helvetica,sans-serif;color:var(--muted);margin-top:4px}
  .sigblock{margin-top:44px;display:grid;grid-template-columns:1fr 1fr;gap:40px}
  .sigcell .line{border-top:1px solid var(--ink);margin-top:46px;padding-top:6px}
  .sigcell .role{font:11px Arial,Helvetica,sans-serif;color:var(--muted)}
  .sigcell .name{font:700 12.5px Georgia,serif;margin-top:2px}
  .sigcell .place{font:11px Arial,Helvetica,sans-serif;color:var(--muted);margin-top:16px}
  .sigcell .status{font:700 10px Arial,Helvetica,sans-serif;text-transform:uppercase;letter-spacing:.06em;margin-top:8px;color:var(--muted)}
  .consent{border:1px solid var(--hair);border-radius:3px;padding:10px 12px;margin-top:10px;font:11px Arial,Helvetica,sans-serif;color:var(--muted);display:flex;gap:8px;align-items:flex-start}
  .consent .box{width:12px;height:12px;border:1.5px solid var(--muted);flex:none;margin-top:1px}
  .verify{margin-top:30px;padding-top:12px;border-top:1px dotted var(--hair);font:10.5px Arial,Helvetica,sans-serif;color:var(--muted)}
  .verify b{color:var(--ink)}
  .pagefoot{text-align:center;font:10.5px Arial,Helvetica,sans-serif;color:var(--muted);margin-top:34px;padding-top:10px;border-top:1px solid var(--hair)}
  .np{text-align:right;padding:10px 20px;background:#f0f0f0}
  .np button{background:#534AB7;color:#fff;border:none;padding:8px 18px;border-radius:7px;font:600 13px sans-serif;cursor:pointer}
  @media print{@page{size:A4;margin:0}.np{display:none}.page{padding:14mm 16mm}}
`

export function printFranchiseeAgreement(franchisee, agreement, ctx) {
  const a = agreement || {}
  const kit = a.kit || []
  const courses = (a.courses && a.courses.length) ? a.courses : ['To be assigned']
  const courseList = courses.length > 1
    ? courses.slice(0, -1).join(', ') + ' and ' + courses[courses.length - 1]
    : courses[0]
  const execDate = fmtLong(a.generated_at || new Date())
  const termLabel = fmtLong(a.term_start) + ' to ' + fmtLong(a.term_end)
  const address = [franchisee.address, franchisee.city, franchisee.state].filter(Boolean).join(', ')
  const signed = a.status === 'signed'

  const kitRows = kit.length ? kit.map(function (k) {
    return `<tr><td>${esc(k.course)}</td><td>${esc(k.level)}</td><td class="r">${fmtAmt(k.rate)}</td></tr>`
  }).join('') : `<tr><td colspan="3" style="text-align:center;color:var(--muted)">No programmes registered yet.</td></tr>`

  const body = `
    <div class="letterhead">
      <div class="brand">
        <img src="/NLH%20Logo.png" alt="New Learning Horizons">
        <div><b>New Learning Horizons</b><span>ISO 9001:2015 Certified</span></div>
      </div>
      <div class="addr">9, Anjuman Shopping Complex, Sadar<br>Nagpur, Maharashtra 440 001<br>+91 9373 111 311 &middot; dhiral@nlhnagpur.info</div>
    </div>
    <hr class="rule">

    <h1>Agreement for Unit Franchise</h1>
    <div class="subtitle">Agreement No. ${esc(a.agreement_no || '—')}</div>
    <div class="docmeta">Executed on <b>${execDate}</b> at Nagpur &middot; Term: <b>${termLabel}</b></div>

    <div class="body">
      <p>This agreement is made on <b>${execDate}</b> between <b>New Learning Horizons</b>, an ISO 9001&ndash;2015 Certified institute, through its proprietor Mrs. Dhiral Panchmatia, R/o. 9 Anjuman Complex, Sadar, Nagpur, Maharashtra (hereinafter referred to as Party of the 1st Part or "NLH"),</p>
      <p>AND</p>
      <p><b>${esc(franchisee.owner_name || franchisee.business_name)}</b>, R/o. ${esc(address)} (hereinafter referred to as UF or the "Second Party"), and is interested in taking a Unit Franchise centre for <b>${esc(courseList)}</b> at a non-refundable training fee of Rs. ${fmtAmt(a.fee)}/&ndash; (Rupees ${numberWords(a.fee)} only), hereinafter referred to as Party of the 2nd Part or "UF".</p>
      <p>Whereas the 1st party New Learning Horizons is a registered trademarked training institute for imparting training to interested parties to teach ACEM Abacus, Write&ndash;Well Handwriting Improvement &amp; Calligraphy, Easy Math &ndash; Concepts of Vedic Math, Phonics, Montessori and other skill enhancement courses for children. The 1st party has agreed to appoint the 2nd party as the UF imparting training to the interested students for the courses as mentioned above.</p>

      <h2>Definitions</h2>
      <p>NLH: New Learning Horizons. UF: Unit Franchise. CI: Course Instructor.</p>

      <h2>Terms and Conditions</h2>
      ${AGREEMENT_CLAUSES(termLabel)}

      <h2>Annexure A &mdash; Kit Charges as on ${execDate}</h2>
      <table class="kit">
        <caption>Rates apply to the UF's registered programmes and levels only</caption>
        <thead><tr><th>Course Name</th><th>Level</th><th class="r">Kit Charge (Rs.)</th></tr></thead>
        <tbody>${kitRows}</tbody>
      </table>
      <div class="feeline">Note: These kit charges are subject to periodic revision by NLH. Courier charges to be borne by the franchisee.</div>
    </div>

    <div class="sigblock">
      <div class="sigcell">
        <div class="line"><div class="name">Dhiral Panchmatia</div><div class="role">Proprietor, New Learning Horizons</div></div>
        <div class="place">Signed at Nagpur &middot; ${execDate}</div>
        <div class="status">&#10003; Signed for NLH</div>
      </div>
      <div class="sigcell">
        <div class="line"><div class="name">${esc(signed ? a.signed_name : franchisee.owner_name || franchisee.business_name)}</div><div class="role">Unit Franchisee, ${esc(franchisee.city || '')}</div></div>
        ${signed
          ? `<div class="place">Signed &middot; ${fmtLong(a.signed_at)}${a.signed_ip ? ' &middot; IP ' + esc(a.signed_ip) : ''}</div><div class="status" style="color:#1D7A4F">&#10003; Signed</div>`
          : `<div class="place">Awaiting signature${franchisee.email ? ' &middot; link sent to ' + esc(franchisee.email) : ''}</div><div class="status">&#9675; Not yet signed</div><div class="consent"><span class="box"></span> "I have read and agree to the terms of this Agreement, and this typed name is my signature." &mdash; ticked and typed by the UF to sign.</div>`
        }
      </div>
    </div>

    <div class="verify">Verification code: <b>${esc(a.verification_code || '—')}</b>. ${signed ? 'Signed and recorded against this code.' : 'Once signed, the UF\'s name, IP address, timestamp and a hash of this document are recorded against this code and can be checked at any time from the franchisee\'s account.'}</div>

    <div class="pagefoot">Page 1 of 1 &middot; New Learning Horizons &middot; Agreement No. ${esc(a.agreement_no || '—')}</div>`

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Unit Franchise Agreement</title><style>${AGREEMENT_STYLE}</style></head><body>
    <div class="np"><button onclick="window.print()">Print / Save PDF</button></div>
    <div class="page">${body}</div>
  </body></html>`

  return emit(ctx, html)
}
