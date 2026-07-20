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
     at 23% of the body and the summary box begins at 63.5%, and that box is
     opaque, so anything lower gets its feet cut off. */
  .sheet.a5 .mascot{position:absolute;left:0;right:0;top:26%;bottom:38.5%;
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
  .sheet.a5 .pt{grid-template-columns:1fr}
  .sheet.a5 .pt>div:first-child{display:none}
  /* max-content columns keep the three figures as a tight group instead of
     spreading them across the full width; the trailing 1fr absorbs the slack
     while the header, grand-total bar and words still span edge to edge. */
  .sheet.a5 .tot{display:grid;grid-template-columns:repeat(3,max-content) 1fr;
    column-gap:26px;align-items:center;padding:10px 14px 11px 16px}
  .sheet.a5 .tot .h{grid-column:1/-1;margin-bottom:5px}
  .sheet.a5 .trow{flex-direction:column;align-items:flex-start;gap:2px;
    padding:2px 0;border-bottom:none}
  .sheet.a5 .trow+.trow{border-left:1px dashed rgba(83,74,183,.25);padding-left:16px}
  .sheet.a5 .trow .l{font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#7A75A0}
  .sheet.a5 .trow .v{font-size:14px}
  .sheet.a5 .grand{grid-column:1/-1}
  .sheet.a5 .words{grid-column:1/-1}
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

function openWin(html) {
  const w = window.open('', '_blank', 'width=900,height=800')
  if (!w) return
  w.document.write(html); w.document.close()
}

// ── Fee Invoice (same design as the franchisee invoice) ───────────────────────
// ctx.items: [{kind:'course'|'kit', sku_id, name, qty, amount}]  (fallback ctx.lines:[{name,fee,sku_id}])
// ctx.summary: { discount, couponCode, total, paid, balance }
export function printStudentInvoice(student, ctx) {
  let items = ctx.items
  if (!items && ctx.lines) items = ctx.lines.map(function (l) { return { kind: 'course', sku_id: l.sku_id, name: l.name, amount: l.fee || 0 } })
  items = items || []
  const s = ctx.summary || {}
  const courses = items.filter(function (i) { return i.kind === 'course' })
  const subtotal = courses.reduce(function (a, c) { return a + (c.amount || 0) }, 0)
  const balance = s.balance != null ? s.balance : Math.max(0, (s.total || 0) - (s.paid || 0))

  const rows = courses.length ? courses.map(function (c, i) {
    const kits = items.filter(function (k) { return k.kind === 'kit' && k.sku_id === c.sku_id })
    const kitHtml = kits.length
      ? `<div class="kit"><span class="k1">Kit:</span>${kits.map(function (k) { return `<span class="k2">${esc(k.name)}${k.qty > 1 ? ' ×' + k.qty : ''}</span>` }).join('')}</div>`
      : ''
    return `<div class="ir"><div class="num">${String(i + 1).padStart(2, '0')}</div><div><div class="nm">${esc(c.name)}</div>${kitHtml}</div><div class="amt r">₹${fmtAmt(c.amount || 0)}</div></div>`
  }).join('') : `<div class="ir"><div></div><div class="nm" style="color:#9C9A92">No courses on this invoice.</div><div></div></div>`

  const trows =
    `<div class="trow"><span class="l">Subtotal</span><span class="v">₹${fmtAmt(subtotal)}</span></div>` +
    (s.discount > 0 ? `<div class="trow"><span class="l">Discount${s.couponCode ? ' (' + esc(s.couponCode) + ')' : ''}</span><span class="v" style="color:#1D7A4F">− ₹${fmtAmt(s.discount)}</span></div>` : '') +
    `<div class="trow"><span class="l">Amount paid</span><span class="v" style="color:${(s.paid || 0) > 0 ? '#1D7A4F' : '#9C9A92'}">${(s.paid || 0) > 0 ? '₹' + fmtAmt(s.paid) : '—'}</span></div>` +
    `<div class="trow" style="border:none"><span class="l">Balance due</span><span class="v" style="color:${balance > 0 ? '#A32D2D' : '#1D7A4F'}">₹${fmtAmt(balance)}</span></div>`

  const body = `
    <div class="items"><div class="ih"><div>#</div><div>Course / Level</div><div class="r">Fee (₹)</div></div>${rows}</div>
    <div class="pt">
      ${(balance > 0) ? PAY_BOX.replace('<div class="pt">', '') : '<div></div>'}
      <div class="tot"><div class="bl"></div>
        <div class="h">Invoice Summary</div>
        ${trows}
        <div class="grand"><div class="gl">Total Fee</div><div class="gv"><span style="font:700 12px 'DM Sans';margin-right:3px;opacity:.85">₹</span>${fmtAmt(s.total || 0)}</div></div>
        <div class="words">In words: <b style="color:#534AB7">${esc(numToWords(s.total || 0))}</b></div>
      </div>
    </div>`

  openWin(shell({
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
    <div class="mascot"><img src="/NLH%20Mascot.png" alt=""></div>
    <div class="pt"><div></div>
      <div class="tot"><div class="bl"></div>
        <div class="h">Receipt Summary</div>
        <div class="trow"><span class="l">Total fee</span><span class="v">₹${fmtAmt(s.total || 0)}</span></div>
        <div class="trow"><span class="l">Paid to date</span><span class="v" style="color:#1D7A4F">₹${fmtAmt(s.paid || 0)}</span></div>
        <div class="trow" style="border:none"><span class="l">Balance</span><span class="v" style="color:${bal > 0 ? '#A32D2D' : '#1D7A4F'}">${bal > 0 ? '₹' + fmtAmt(bal) : 'Cleared ✓'}</span></div>
        <div class="grand"><div class="gl">Amount Received</div><div class="gv"><span style="font:700 12px 'DM Sans';margin-right:3px;opacity:.85">₹</span>${fmtAmt(payment.amount || 0)}</div></div>
        <div class="words">In words: <b style="color:#534AB7">${esc(numToWords(payment.amount || 0))}</b></div>
      </div>
    </div>`

  openWin(shell({
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
    <div class="mascot"><img src="/NLH%20Mascot.png" alt=""></div>
    <div class="pt"><div></div>
      <div class="tot"><div class="bl"></div>
        <div class="h">Receipt Summary</div>
        <div class="trow"><span class="l">Invoice total</span><span class="v">&#8377;${fmtAmt(total)}</span></div>
        <div class="trow"><span class="l">Paid to date</span><span class="v" style="color:#1D7A4F">&#8377;${fmtAmt(paid)}</span></div>
        <div class="trow" style="border:none"><span class="l">Balance</span><span class="v" style="color:${bal > 0 ? '#A32D2D' : '#1D7A4F'}">${bal > 0 ? '&#8377;' + fmtAmt(bal) : 'Cleared &#10003;'}</span></div>
        <div class="grand"><div class="gl">Amount Received</div><div class="gv"><span style="font:700 12px 'DM Sans';margin-right:3px;opacity:.85">&#8377;</span>${fmtAmt(payment.amount || 0)}</div></div>
        <div class="words">In words: <b style="color:#534AB7">${esc(numToWords(payment.amount || 0))}</b></div>
      </div>
    </div>`

  openWin(shell({
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
    <div class="mascot"><img src="/NLH%20Mascot.png" alt=""></div>
    <div class="pt"><div></div>
      <div class="tot"><div class="bl"></div>
        <div class="h">Receipt Summary</div>
        ${total > 0 ? `<div class="trow"><span class="l">Franchise fee</span><span class="v">&#8377;${fmtAmt(total)}</span></div>
        <div class="trow"><span class="l">Paid to date</span><span class="v" style="color:#1D7A4F">&#8377;${fmtAmt(paid)}</span></div>
        <div class="trow" style="border:none"><span class="l">Balance</span><span class="v" style="color:${bal > 0 ? '#A32D2D' : '#1D7A4F'}">${bal > 0 ? '&#8377;' + fmtAmt(bal) : 'Cleared &#10003;'}</span></div>` : ''}
        <div class="grand"><div class="gl">Amount Received</div><div class="gv"><span style="font:700 12px 'DM Sans';margin-right:3px;opacity:.85">&#8377;</span>${fmtAmt(payment.amount || 0)}</div></div>
        <div class="words">In words: <b style="color:#534AB7">${esc(numToWords(payment.amount || 0))}</b></div>
      </div>
    </div>`

  openWin(shell({
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
