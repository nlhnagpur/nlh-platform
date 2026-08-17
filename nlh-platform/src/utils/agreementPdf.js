import { jsPDF } from 'jspdf'

// Builds a REAL text-based PDF of the Unit Franchise Agreement — same
// content and layout as printFranchiseeAgreement() in studentDocs.js, but
// drawn directly with jsPDF's text API rather than rendered from HTML/CSS.
// This matters for BoldSign: a rasterised (screenshotted) PDF has no
// selectable text, so BoldSign's Text Tag auto-detection — the invisible
// `{{sign|1|*|...}}` marker that tells it where to place the signature
// field — would never be found. A jsPDF document has real text, so the tag
// works exactly as BoldSign's docs describe.
//
// Returns a base64 data URL string ready for the BoldSign `Files` field.

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

function numberWords(n) {
  if (!n) return 'Zero'
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

function loadImage(src) {
  return new Promise(function (resolve) {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = function () { resolve(img) }
    img.onerror = function () { resolve(null) }
    img.src = src
  })
}

export async function buildAgreementPdfDataUrl(franchisee, agreement) {
  const a = agreement || {}
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  let y = MARGIN

  function newPage() { doc.addPage(); y = MARGIN }
  function ensure(space) { if (y + space > BOTTOM) newPage() }

  function rule(yy) { doc.setDrawColor(17, 17, 17); doc.setLineWidth(0.25); doc.line(MARGIN, yy, PAGE_W - MARGIN, yy) }

  function para(text, opts) {
    const o = opts || {}
    doc.setFont('times', o.bold ? 'bold' : 'normal')
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
    ensure(10)
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
    const numW = 6
    const lines = doc.splitTextToSize(text, CONTENT_W - numW)
    ensure(5)
    doc.setFont('times', 'bold')
    doc.text(n + '.', MARGIN, y)
    doc.setFont('times', 'normal')
    lines.forEach(function (line, i) {
      ensure(5)
      doc.text(line, MARGIN + numW, y)
      y += 5
    })
    y += 1.5
  }

  function subclause(letter, text) {
    const indent = 12
    doc.setFont('times', 'normal')
    doc.setFontSize(10.5)
    const lines = doc.splitTextToSize(text, CONTENT_W - indent)
    ensure(5)
    doc.setFont('times', 'bold')
    doc.text('(' + letter + ')', MARGIN + indent - 6, y)
    doc.setFont('times', 'normal')
    lines.forEach(function (line) {
      ensure(5)
      doc.text(line, MARGIN + indent, y)
      y += 5
    })
    y += 1
  }

  // ── Letterhead ──────────────────────────────────────────────────────────
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

  // ── Title ───────────────────────────────────────────────────────────────
  doc.setFont('times', 'bold'); doc.setFontSize(15); doc.setTextColor(17, 17, 17)
  doc.text('AGREEMENT FOR UNIT FRANCHISE', PAGE_W / 2, y, { align: 'center' })
  y += 6
  doc.setFont('times', 'italic'); doc.setFontSize(9.5); doc.setTextColor(85, 85, 85)
  doc.text('Agreement No. ' + (a.agreement_no || '—'), PAGE_W / 2, y, { align: 'center' })
  y += 6
  // The agreement's own "made on" date is the term's start date, not
  // whenever this row happened to be generated/regenerated in our system —
  // otherwise a backdated franchisee's term (e.g. starting 2 years ago)
  // reads as beginning before the agreement was even made.
  const execDate = fmtLong(a.term_start || a.generated_at || new Date())
  const termLabel = fmtLong(a.term_start) + ' to ' + fmtLong(a.term_end)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(85, 85, 85)
  doc.text('Executed on ' + execDate + ' at Nagpur · Term: ' + termLabel, PAGE_W / 2, y, { align: 'center' })
  y += 10

  // ── Recitals ────────────────────────────────────────────────────────────
  const courses = (a.courses && a.courses.length) ? a.courses : ['To be assigned']
  const courseList = courses.length > 1 ? courses.slice(0, -1).join(', ') + ' and ' + courses[courses.length - 1] : courses[0]
  const address = [franchisee.address, franchisee.city, franchisee.state].filter(Boolean).join(', ')

  para('This agreement is made on ' + execDate + ' between New Learning Horizons, an ISO 9001–2015 Certified institute, through its proprietor Mrs. Dhiral Panchmatia, R/o. 9 Anjuman Complex, Sadar, Nagpur, Maharashtra (hereinafter referred to as Party of the 1st Part or "NLH"),')
  para('AND', { after: 2 })
  const feeClause = a.fee > 0
    ? ' at a non-refundable training fee of Rs. ' + fmtAmt(a.fee) + '/– (Rupees ' + numberWords(a.fee) + ' only)'
    : ', continuing as an existing NLH franchisee on a no-fee basis in recognition of the relationship already in place'
  para((franchisee.owner_name || franchisee.business_name) + ', R/o. ' + address + ' (hereinafter referred to as Party of the 2nd Part or the "UF"), and is interested in taking a Unit Franchise centre for ' + courseList + feeClause + '.')
  para('Whereas the 1st party New Learning Horizons is a registered trademarked training institute for imparting training to interested parties to teach ACEM Abacus, Write–Well Handwriting Improvement & Calligraphy, Easy Math – Concepts of Vedic Math, Phonics, Montessori and other skill enhancement courses for children. The 1st party has agreed to appoint the 2nd party as the UF imparting training to the interested students for the courses as mentioned above.')

  heading('Definitions')
  para('NLH: New Learning Horizons. UF: Unit Franchise. CI: Course Instructor.')

  heading('Terms and Conditions')
  clause(1, 'The UF agrees to teach the courses to the interested students only in the area of the Unit Franchisee Centre.')
  clause(2, 'New Learning Horizons shall coordinate & support the Franchisee Centre owner by providing a one-time training in the courses opted for to the Course Instructor (CI) or Instructors appointed by the UF and monitor their progress from time to time. Any subsequent training required shall be on a chargeable basis.')
  clause(3, "The UF shall purchase all the course material to teach the course to the interested students from New Learning Horizons at the rates fixed, or as may be revised from time to time (see Annexure A). The UF shall not reproduce the course material either by photocopy or duplication, or print in any other form or name for any purpose.")
  clause(4, "New Learning Horizons shall forward a banner (one time), study material, students' admission form and receipt books as and when required, and a Certificate on completion of the course to the Centre as a part of the Kit.")
  subclause('a', "NLH will also supply on order from the UF, students' study material and a Certificate on completion of the course to the Centres as a part of the Student Kit; the cost of the student kit ordered and courier charges will be paid by the UF.")
  clause(5, "New Learning Horizons reserves the right to change the cost of training fees and the cost of the student's course material from time to time.")
  clause(6, 'The UF shall follow the methods and systems set out in the training by NLH for all the courses opted for, and also ensure the following:')
  subclause('a', 'Use and supply only the said course material as received from NLH and shall not conduct any unauthorised or similar type of courses.')
  subclause('b', "Keep and maintain a full and proper student enrolment, attendance, progress and fees register for the students in the UF's area of operation.")
  subclause('c', 'Send every month a list of students enrolled and a list of students who drop out during the course of study, in the set formats sent by New Learning Horizons from time to time.')
  clause(7, 'UF shall maintain confidentiality of business methods, pricing, and training content, and shall also be responsible for the data privacy of students and staff.')
  clause(8, 'Upon termination of the agreement for any cause, the UF shall:')
  subclause('a', 'Promptly pay to New Learning Horizons all money due;')
  subclause('b', 'Promptly return all instructional and educational material supplied to them and cease to describe itself as UF of NLH;')
  subclause('c', 'Not impart the knowledge gained with respect to the above courses to anyone thereafter.')
  clause(9, 'This agreement shall be for a period of 3 years (' + termLabel + '), which may be extendable with the mutual consent of both parties at a nominal renewal amount of 25% of the Franchise amount prevalent at the time. However, either party may terminate the agreement by giving the other party 1 month\'s prior registered notice in the event of a breach of any term or condition of this agreement. In the event of the agreement herein being terminated, New Learning Horizons shall not be liable to the UF for any compensation or damage of any kind.')
  clause(10, 'UF must demonstrate consistent growth and program outreach. NLH reserves the right to terminate the agreement for poor performance.')
  clause(11, 'Disputes, if any, shall be resolved amicably; failing which, arbitration shall be held in Nagpur. Jurisdiction will be the Nagpur courts only.')
  clause(12, 'The fee structure and sharing ratios of all courses are as per Annexure A and were also explained at the time of signing the contract. These are subject to change from time to time as per changes in the course and course material.')

  // ── Annexure A: kit table ──────────────────────────────────────────────
  heading('Annexure A — Kit Charges as on ' + execDate)
  const kit = a.kit || []
  const colX = [MARGIN, MARGIN + 90, MARGIN + 132]
  const colW = [90, 42, CONTENT_W - 132]
  const rowH = 6.5
  ensure(rowH + 2)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(17, 17, 17)
  doc.rect(MARGIN, y, CONTENT_W, rowH)
  doc.line(colX[1], y, colX[1], y + rowH)
  doc.line(colX[2], y, colX[2], y + rowH)
  doc.text('Course Name', colX[0] + 2, y + rowH - 2)
  doc.text('Level', colX[1] + 2, y + rowH - 2)
  doc.text('Kit Charge (Rs.)', colX[2] + colW[2] - 2, y + rowH - 2, { align: 'right' })
  y += rowH
  doc.setFont('times', 'normal'); doc.setFontSize(9)
  const rows = kit.length ? kit : [{ course: 'No programmes registered yet.', level: '', rate: '' }]
  rows.forEach(function (k) {
    ensure(rowH)
    doc.rect(MARGIN, y, CONTENT_W, rowH)
    doc.line(colX[1], y, colX[1], y + rowH)
    doc.line(colX[2], y, colX[2], y + rowH)
    doc.text(String(k.course || ''), colX[0] + 2, y + rowH - 2)
    doc.text(String(k.level || ''), colX[1] + 2, y + rowH - 2)
    if (k.rate !== '') doc.text(fmtAmt(k.rate), colX[2] + colW[2] - 2, y + rowH - 2, { align: 'right' })
    y += rowH
  })
  y += 4
  para('Note: These kit charges are subject to periodic revision by NLH. Courier charges to be borne by the franchisee.', { size: 8.5, lineHeight: 4, after: 4 })

  // ── Signatures ──────────────────────────────────────────────────────────
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

  // Invisible BoldSign text tag — white-on-white, sits right where the UF
  // signs. BoldSign's UseTextTags parser finds this and turns it into a
  // real signature field for the sole signer (index 1); nothing is visible
  // to a human reading a printed or downloaded copy of this page.
  // The 4th (placeholder-label) section is left empty on purpose — it's
  // documented as valid for TextBox fields only; BoldSign's API rejects
  // the whole send with "Placeholder is only applicable for TextBox field
  // type" if it's set on a `sign` tag (confirmed via a real SendFailed
  // webhook event).
  doc.setTextColor(255, 255, 255); doc.setFontSize(1)
  doc.text('{{sign|1|*||uf_signature}}', rightX + 2, y + 13)

  doc.setFont('times', 'bold'); doc.setFontSize(10.5); doc.setTextColor(17, 17, 17)
  doc.text('Dhiral Panchmatia', leftX, y + 19)
  doc.text(franchisee.owner_name || franchisee.business_name || '', rightX, y + 19)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(85, 85, 85)
  doc.text('Proprietor, New Learning Horizons', leftX, y + 23)
  doc.text('Unit Franchisee, ' + (franchisee.city || ''), rightX, y + 23)
  doc.text('Signed at Nagpur · ' + execDate, leftX, y + 28)
  doc.text('Sign above to accept this Agreement', rightX, y + 28)
  y += 34

  para('Verification code: ' + (a.verification_code || '—') + '. Once signed via BoldSign, the signer\'s identity, timestamp and IP are recorded against this code and can be checked at any time from the franchisee\'s account.', { size: 8, lineHeight: 4 })

  // ── Page numbers ────────────────────────────────────────────────────────
  const pageCount = doc.internal.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(85, 85, 85)
    doc.text('Page ' + i + ' of ' + pageCount + ' · New Learning Horizons · Agreement No. ' + (a.agreement_no || '—'), PAGE_W / 2, PAGE_H - 10, { align: 'center' })
  }

  // NOT doc.output('datauristring') — jsPDF emits
  // "data:application/pdf;filename=generated.pdf;base64,...", and that extra
  // ;filename=...; segment is enough to make BoldSign's API reject the file
  // as invalid. Build the canonical "data:<mime>;base64,<content>" form by
  // hand instead.
  const bytes = doc.output('arraybuffer')
  let binary = ''
  const arr = new Uint8Array(bytes)
  for (let i = 0; i < arr.length; i++) binary += String.fromCharCode(arr[i])
  return 'data:application/pdf;base64,' + btoa(binary)
}
