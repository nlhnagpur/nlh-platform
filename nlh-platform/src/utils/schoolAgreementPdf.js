import { jsPDF } from 'jspdf'

// School Program Partnership Agreement — same letterhead, type and signature
// block as the Unit Franchise Agreement (agreementPdf.js), drawn as real text
// so BoldSign's text tag works. Two variants from one function:
//   service_model 'inhouse'      -> no Full-Service clause, billing clause or Annexure B
//                                    at all (a school that will never use NLH's trainer
//                                    must not be shown terms that don't apply to it)
//   service_model 'full_service' -> adds the training-model choice, monthly trainer
//                                    billing clause and Annexure B (instructor charges)

const MARGIN = 18
const PAGE_W = 210
const PAGE_H = 297
const CONTENT_W = PAGE_W - MARGIN * 2
const BOTTOM = PAGE_H - 20

function fmtAmt(n) { return Number(n || 0).toLocaleString('en-IN') }

function fmtLong(d) {
  if (!d) return ''
  try {
    const dt = new Date(String(d).length <= 10 ? d + 'T00:00:00' : d)
    return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  } catch (e) { return String(d) }
}

function loadImage(src) {
  return new Promise(function (resolve) {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = function () { resolve(img) }
    img.onerror = function () { resolve(null) }
    img.src = src
  })
}

export async function buildSchoolAgreementPdfDoc(school, agreement) {
  const a = agreement || {}
  const extra = a.extra || {}
  const full = a.service_model === 'full_service'
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  let y = MARGIN

  function newPage() { doc.addPage(); y = MARGIN }
  function ensure(space) { if (y + space > BOTTOM) newPage() }
  function rule(yy) { doc.setDrawColor(17, 17, 17); doc.setLineWidth(0.25); doc.line(MARGIN, yy, PAGE_W - MARGIN, yy) }

  function para(text, opts) {
    const o = opts || {}
    doc.setFont('times', o.bold ? 'bold' : (o.italic ? 'italic' : 'normal'))
    doc.setFontSize(o.size || 10.5)
    doc.setTextColor(17, 17, 17)
    const lines = doc.splitTextToSize(text, o.width || CONTENT_W)
    const lh = o.lineHeight || 5
    lines.forEach(function (line) {
      ensure(lh)
      doc.text(line, o.x || MARGIN, y)
      y += lh
    })
    y += o.after != null ? o.after : 2
  }

  function heading(text) {
    ensure(12)
    y += 2
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9.5)
    doc.setTextColor(17, 17, 17)
    doc.text(text.toUpperCase(), MARGIN, y)
    y += 4
  }

  function clause(n, text) {
    doc.setFont('times', 'normal')
    doc.setFontSize(10.5)
    const numW = 7
    const lines = doc.splitTextToSize(text, CONTENT_W - numW)
    ensure(5)
    doc.setFont('times', 'bold')
    doc.text(n + '.', MARGIN, y)
    doc.setFont('times', 'normal')
    lines.forEach(function (line) {
      ensure(5)
      doc.text(line, MARGIN + numW, y)
      y += 5
    })
    y += 1.5
  }

  function subclause(letter, text) {
    const indent = 13
    doc.setFont('times', 'normal')
    doc.setFontSize(10.5)
    const lines = doc.splitTextToSize(text, CONTENT_W - indent)
    ensure(5)
    doc.setFont('times', 'bold')
    doc.text('(' + letter + ')', MARGIN + indent - 7, y)
    doc.setFont('times', 'normal')
    lines.forEach(function (line) {
      ensure(5)
      doc.text(line, MARGIN + indent, y)
      y += 5
    })
    y += 1
  }

  // Bordered table with wrapped cells; row height follows the tallest cell.
  function table(headers, widths, rows, alignRight) {
    const pad = 2
    const lh = 4.2
    const xs = [MARGIN]
    widths.forEach(function (w, i) { xs.push(xs[i] + w) })

    function drawRow(cells, bold, bg) {
      doc.setFont(bold ? 'helvetica' : 'times', bold ? 'bold' : 'normal')
      doc.setFontSize(bold ? 8.5 : 9)
      const wrapped = cells.map(function (c, i) { return doc.splitTextToSize(String(c == null ? '' : c), widths[i] - pad * 2) })
      const h = Math.max(6.5, Math.max.apply(null, wrapped.map(function (w) { return w.length })) * lh + 2.4)
      ensure(h)
      if (bg) { doc.setFillColor(238, 236, 250); doc.rect(MARGIN, y, CONTENT_W, h, 'F') }
      doc.setDrawColor(17, 17, 17); doc.setLineWidth(0.25)
      doc.rect(MARGIN, y, CONTENT_W, h)
      for (let i = 1; i < widths.length; i++) doc.line(xs[i], y, xs[i], y + h)
      doc.setTextColor(17, 17, 17)
      wrapped.forEach(function (lines, i) {
        lines.forEach(function (line, k) {
          const ty = y + 4.6 + k * lh
          if (alignRight && alignRight.includes(i)) doc.text(line, xs[i + 1] - pad, ty, { align: 'right' })
          else doc.text(line, xs[i] + pad, ty)
        })
      })
      y += h
    }

    drawRow(headers, true, true)
    rows.forEach(function (r) { drawRow(r, false, false) })
  }

  // ── Letterhead (identical to the Unit Franchise Agreement) ──
  const logo = await loadImage('/NLH%20Logo.png')
  if (logo) doc.addImage(logo, 'PNG', MARGIN, y - 2, 14, 14)
  doc.setFont('times', 'bold'); doc.setFontSize(12); doc.setTextColor(17, 17, 17)
  doc.text('New Learning Horizons', MARGIN + 17, y + 4)
  doc.setFont('times', 'italic'); doc.setFontSize(8.5); doc.setTextColor(85, 85, 85)
  doc.text('ISO 9001:2015 Certified', MARGIN + 17, y + 8.5)

  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(85, 85, 85)
  doc.text('9, Anjuman Shopping Complex, Sadar', PAGE_W - MARGIN, y, { align: 'right' })
  doc.text('Nagpur, Maharashtra 440 001', PAGE_W - MARGIN, y + 4, { align: 'right' })
  doc.text('+91 9373 111 311 · dhiral@nlhnagpur.info', PAGE_W - MARGIN, y + 8, { align: 'right' })

  y += 16
  rule(y)
  y += 10

  // ── Title ──
  const execDate = fmtLong(a.signed_at || a.generated_at || new Date())
  const termLabel = fmtLong(a.term_start) + ' to ' + fmtLong(a.term_end)
  doc.setFont('times', 'bold'); doc.setFontSize(15); doc.setTextColor(17, 17, 17)
  doc.text('SCHOOL PROGRAM PARTNERSHIP AGREEMENT', PAGE_W / 2, y, { align: 'center' })
  y += 6
  doc.setFont('times', 'italic'); doc.setFontSize(9.5); doc.setTextColor(85, 85, 85)
  doc.text('Agreement No. ' + (a.agreement_no || '—'), PAGE_W / 2, y, { align: 'center' })
  y += 6
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5)
  doc.text('Executed on ' + execDate + ' at Nagpur · Term: ' + termLabel, PAGE_W / 2, y, { align: 'center' })
  y += 10

  // ── Recitals ──
  const repName = extra.rep_name || school.owner_name || school.business_name || ''
  const repTitle = extra.rep_title || 'Principal'
  const address = [school.address, school.area, school.city, school.state, school.pincode].filter(Boolean).join(', ')
  const schoolName = school.business_name || school.owner_name || ''

  para('This Agreement is made and entered into on ' + execDate + ', at Nagpur, by and between:')
  para('NEW LEARNING HORIZONS, an ISO 9001:2015 Certified institute, through its proprietor Mrs. Dhiral Panchmatia, R/o. 9, Anjuman Shopping Complex, Residency Road, Sadar, Nagpur – 440001, Maharashtra (hereinafter referred to as "NLH" or the "First Party", which expression shall, unless repugnant to the context, include its successors and permitted assigns),')
  para('AND', { after: 2, bold: true })
  para(schoolName + ', a school / educational institution situated at ' + address + ', represented by its ' + repTitle + ', ' + repName + ' (hereinafter referred to as the "School" or the "Second Party", which expression shall, unless repugnant to the context, include its successors and permitted assigns).')
  para('NLH and the School are hereinafter individually referred to as a "Party" and collectively as the "Parties".')
  para('WHEREAS NLH is a registered institute engaged in providing skill-based, curriculum-aligned after-school programs – including but not limited to ACEM Abacus, Write Well (Handwriting & Calligraphy), Easy Math (Vedic Mathematics), Chess Training, Computer Training, Personality Development, Public Speaking, English Grammar, and Creative Writing – for students across India since 2008;')
  para('AND WHEREAS the School is desirous of offering the following program/s to its enrolled students, and has approached NLH for the supply of program material, teacher training, and related support;')
  para('AND WHEREAS NLH has agreed to make available the Program(s), training and material to the School on the terms and conditions recorded in this Agreement;')
  para('NOW THEREFORE, in consideration of the mutual covenants contained herein, the Parties agree as follows:')

  const termNo = full ? 10 : 9
  const termEndNo = full ? 11 : 10
  const pricingNo = full ? 12 : 11
  const disputeNo = full ? 13 : 12

  heading('Definitions')
  para('"NLH" means New Learning Horizons. "School" means the second party to this Agreement. "Program" or "Program(s)" means the skill-based course(s) the School has opted for under this Agreement. "Kit" means the workbook(s), tools and other study material prescribed by NLH for a given Program level. "Course Instructor" or "CI" means the teacher – nominated by the School and certified by NLH – who delivers a Program to students. "Academic Year" means the School\'s own academic year as per its calendar, used to compute the term and renewal of this Agreement under Clause ' + termNo + '.')

  heading('Terms and Conditions')
  clause(1, 'Scope of Engagement. The School shall offer the Program(s) opted for under this Agreement to its own enrolled students only. The School shall not use NLH\'s name, trademarks, or branding for any purpose beyond the scope of this Agreement. It shall not offer the Program(s) to any student, batch, or institution outside its own premises.')

  if (full) {
    clause(2, 'Training Model. For each Program, the School shall select one of the following models, as recorded against that Program in Annexure A:')
    subclause('a', 'In-house Model – NLH shall provide free online training and certification to one teacher nominated by the School per Program. The certified teacher shall thereafter be qualified to deliver that Program independently at the School. Any further / refresher training beyond the initial certification shall be chargeable.')
    subclause('b', 'Full-Service Model – NLH shall supply its own trainer to deliver the Program at the School\'s premises. The trainer charge for each Program under this model is set out in Annexure B, and is billed separately under Clause 3.')
    clause(3, 'Billing for the Full-Service Model. Where the Full-Service Model is selected for a Program, NLH shall raise a monthly invoice on the School for the trainer charge applicable to that Program under Annexure B, payable by the School within 7 (seven) days of the invoice date. This charge is in addition to, and billed separately from, the Kit charges and payment terms under Clauses 5 and 6.')
    clause(4, 'Kit Material. The School shall procure all Program material (workbooks, tools and other Kit components) exclusively from NLH, at the rates agreed upon, which are mentioned in Annexure A, and may be revised by NLH from time to time under Clause ' + pricingNo + '. The School shall not reproduce, photocopy, duplicate, or print the said material in any form for any purpose.')
    clause(5, 'Payment Terms – Kit Orders. Unless otherwise agreed in writing, payment for each Kit order shall be made as 50% (fifty percent) advance at the time of placing the order, and the balance 50% (fifty percent) on or before delivery of the Kit. Trainer charges under the Full-Service Model are billed separately under Clause 3.')
    clause(6, 'Certification. On successful completion of a Program level, NLH shall issue each student a Certificate of Accomplishment, based on the completion / assessment record submitted by the School and reviewed by NLH before the certificate is released.')
    clause(7, 'Support Provided by NLH. Any promotional Flex banner provided by NLH will be prominently displayed on the premises.')
    clause(8, 'Obligations of the School. The School shall:')
    subclause('a', 'Maintain a full and proper record of student enrolment, attendance, and progress for each Program conducted at its premises;')
    subclause('b', 'Ensure that each Program is delivered only by a teacher certified by NLH under the In-house Model, or by NLH\'s own trainer under the Full-Service Model, and by no other person;')
    subclause('c', 'Not conduct, under the NLH name or using NLH material, any course or program not expressly covered by this Agreement.')
    clause(9, 'Confidentiality & Data Privacy. Each Party shall maintain the confidentiality of the other\'s business methods, pricing, and training content shared under this Agreement, and shall be responsible for the data privacy of students and staff under its own control.')
  } else {
    clause(2, 'Training Model. NLH shall provide free online training and certification to one teacher nominated by the School per Program. The certified teacher shall thereafter be qualified to deliver that Program independently at the School. Any further / refresher training beyond the initial certification shall be chargeable.')
    clause(3, 'Kit Material. The School shall procure all Program material (workbooks, tools and other Kit components) exclusively from NLH, at the rates agreed upon, which are mentioned in Annexure A, and may be revised by NLH from time to time under Clause ' + pricingNo + '. The School shall not reproduce, photocopy, duplicate, or print the said material in any form for any purpose.')
    clause(4, 'Payment Terms. Unless otherwise agreed in writing, payment for each order shall be made as 50% (fifty percent) advance at the time of placing the order, and the balance 50% (fifty percent) on or before delivery of the Kit.')
    clause(5, 'Certification. On successful completion of a Program level, NLH shall issue each student a Certificate of Accomplishment, based on the completion / assessment record submitted by the School and reviewed by NLH before the certificate is released.')
    clause(6, 'Support Provided by NLH. Any promotional Flex banner provided by NLH will be prominently displayed on the premises.')
    clause(7, 'Obligations of the School. The School shall:')
    subclause('a', 'Maintain a full and proper record of student enrolment, attendance, and progress for each Program conducted at its premises;')
    subclause('b', 'Ensure that each Program is delivered only by a teacher certified by NLH, and by no other person;')
    subclause('c', 'Not conduct, under the NLH name or using NLH material, any course or program not expressly covered by this Agreement.')
    clause(8, 'Confidentiality & Data Privacy. Each Party shall maintain the confidentiality of the other\'s business methods, pricing, and training content shared under this Agreement, and shall be responsible for the data privacy of students and staff under its own control.')
  }

  clause(termNo, 'Term & Renewal. This Agreement shall be valid for one Academic Year, commencing from the date of execution of this Agreement and ending on 30th April of the following calendar year (or such other date as the Parties may agree in writing), and shall stand renewed automatically for each succeeding Academic Year on the same terms, unless (a) either Party gives the other at least 1 (one) month\'s prior written notice of its intention not to renew, or (b) the terms are revised by mutual written consent of the Parties before the start of the succeeding Academic Year.')
  clause(termEndNo, 'Termination. Either Party may terminate this Agreement by giving the other Party 1 (one) month\'s prior written notice in the event of a breach of any term or condition of this Agreement that remains unremedied at the end of such notice period. Upon termination of this Agreement for any cause, the School shall:')
  subclause('a', 'Promptly pay NLH all amounts due and outstanding under this Agreement;')
  subclause('b', 'Cease using NLH\'s name, trademarks, and branding, and cease describing itself as a partner school of NLH;')
  subclause('c', 'Not use any training, material, or knowledge received under this Agreement for any purpose beyond completing delivery of the Program(s) to students already enrolled as on the date of termination.')
  para('In the event of termination, NLH shall not be liable to the School for any compensation or damages of any kind arising from such termination.', { x: MARGIN + 7, width: CONTENT_W - 7 })
  clause(pricingNo, 'Pricing Revision. NLH reserves the right to revise the Kit charges (Annexure A)' + (full ? ' and trainer charges (Annexure B)' : '') + ' from time to time. Any such revision shall apply prospectively, to orders placed' + (full ? ' or invoices raised' : '') + ' after the revised rates are communicated to the School, and shall not affect orders' + (full ? ' or invoices' : '') + ' already confirmed.')
  clause(disputeNo, 'Dispute Resolution & Jurisdiction. Any dispute arising out of or in connection with this Agreement shall first be resolved amicably between the Parties; failing which, it shall be referred to arbitration to be held at Nagpur, in accordance with the Arbitration and Conciliation Act, 1996 (as amended). The courts at Nagpur alone shall have exclusive jurisdiction over all matters arising out of this Agreement.')

  // ── Annexure A ──
  const charges = (extra.full_service_charges || []).filter(function (c) { return c && c.course })
  function isFullService(k) {
    return charges.some(function (c) {
      return c.course === k.course && (!c.level || String(c.level).trim().toLowerCase() === String(k.level || '').trim().toLowerCase())
    })
  }
  ensure(24 + Math.min(((a.kit || []).length || 1), 8) * 7)
  heading('Annexure A – Programs, Kit Charges')
  para(full
    ? 'The following table sets out the Kit charge per student for each Program level. Rates are as on the date of this Agreement and are subject to revision under Clause ' + pricingNo + '. "Model Selected" shows whether the School (In-house) or NLH (Full-Service) delivers that level – Full-Service levels are also billed under Annexure B.'
    : 'The following table sets out the Kit charge per student for each Program level. Rates are as on the date of this Agreement and are subject to revision under Clause ' + pricingNo + '.')
  const kit = a.kit || []
  const rowsA = kit.length ? kit.map(function (k, i) {
    const base = [String(i + 1), k.course || '', k.level || '', k.rate !== '' && k.rate != null ? 'Rs. ' + fmtAmt(k.rate) : '', k.age || '']
    return full ? base.concat([isFullService(k) ? 'Full-Service' : 'In-house']) : base
  }) : [full ? ['', 'No programs registered yet', '', '', '', ''] : ['', 'No programs registered yet', '', '', '']]
  if (full) table(['#', 'Program', 'Level', 'Kit Price / Student', 'Class / Age Level', 'Model Selected'], [8, 44, 34, 30, 30, 28], rowsA, [3])
  else table(['#', 'Program', 'Level', 'Kit Price / Student', 'Class / Age Level'], [10, 56, 40, 34, 34], rowsA, [3])
  y += 5
  para('Note: Courier / freight charges to be borne by the School, over and above the Kit charges above.', { size: 8.5, lineHeight: 4, after: 4, italic: true })

  // ── Annexure B (Full-Service only) ──
  if (full) {
    ensure(36 + Math.min(charges.length || 1, 6) * 7)
    heading('Annexure B – Full-Service Model: Instructor Charges')
    para('Applicable only to the Program level(s) marked "Full-Service" in Annexure A, where NLH supplies its own instructor under Clause 2(b). These charges are billed to the School monthly, separately from Kit orders, under Clause 3.')
    const rowsB = charges.length ? charges.map(function (c) {
      return [c.course || '', c.level || 'All levels', c.charge ? 'Rs. ' + fmtAmt(c.charge) : '', c.frequency || 'Monthly']
    }) : [['Not applicable – In-house for all programs', '', '', '']]
    table(['Program', 'Level', 'Instructor Charge', 'Billing Frequency'], [56, 40, 42, 36], rowsB, [2])
    y += 5
  }

  const programList = (a.courses && a.courses.length) ? a.courses.join(', ') : 'To be assigned'
  para('Programs opted for by the School under this Agreement: ' + programList, { after: 6 })

  // ── Signatures (same shape as the Unit Franchise Agreement) ──
  ensure(45)
  y += 6
  heading('Signatures')
  y += 4
  const sigColW = (CONTENT_W - 10) / 2
  const leftX = MARGIN
  const rightX = MARGIN + sigColW + 10

  doc.setDrawColor(17, 17, 17); doc.setLineWidth(0.25)
  doc.line(leftX, y + 14, leftX + sigColW, y + 14)
  doc.line(rightX, y + 14, rightX + sigColW, y + 14)

  const sig = await loadImage('/DRP%20Signature.png')
  if (sig) {
    const sigH = 9
    const sigW = sigH * (sig.naturalWidth / sig.naturalHeight)
    doc.addImage(sig, 'PNG', leftX, y + 14 - sigH - 1, sigW, sigH)
  }

  // Invisible BoldSign text tag where the School signs (see agreementPdf.js)
  doc.setTextColor(255, 255, 255); doc.setFontSize(1)
  doc.text('{{sign|1|*||uf_signature}}', rightX + 2, y + 13)

  doc.setFont('times', 'bold'); doc.setFontSize(10.5); doc.setTextColor(17, 17, 17)
  doc.text('Dhiral Panchmatia', leftX, y + 19)
  doc.text(repName, rightX, y + 19)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(85, 85, 85)
  doc.text('Proprietor, New Learning Horizons', leftX, y + 23)
  doc.text(repTitle + ', ' + schoolName, rightX, y + 23, { maxWidth: sigColW })
  doc.text('Signed at Nagpur · ' + execDate, leftX, y + 28)
  doc.text('Sign above to accept this Agreement', rightX, y + 28)
  y += 34

  para('Verification code: ' + (a.verification_code || '—') + '. Once signed via BoldSign, the signer\'s identity, timestamp and IP are recorded against this code.', { size: 8, lineHeight: 4 })

  const pageCount = doc.internal.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(85, 85, 85)
    doc.text('Page ' + i + ' of ' + pageCount + ' · New Learning Horizons · Agreement No. ' + (a.agreement_no || '—'), PAGE_W / 2, PAGE_H - 10, { align: 'center' })
  }
  return doc
}
