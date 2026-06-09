const fs = require('fs');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, LevelFormat, HeadingLevel, BorderStyle,
  WidthType, ShadingType, PageNumber, PageBreak, TableOfContents, VerticalAlign,
  ImageRun,
} = require('docx');

const LOGO = fs.readFileSync('D:/Claude/nlh-platform/public/NLH Logo.png');

const PURPLE = '534AB7', GREEN = '1D7A4F', DARK = '1A1916', GREY = '5C5A54', LIGHT = 'F0EEE9';

// ── helpers ─────────────────────────────────────────────────────────────────
function p(text, opts = {}) {
  return new Paragraph({ spacing: { after: 120, line: 276 }, children: [new TextRun({ text, ...opts })] });
}
function h2(text) { return new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(text)] }); }
function bullet(text, level = 0) {
  return new Paragraph({ numbering: { reference: 'bullets', level }, spacing: { after: 60, line: 264 },
    children: typeof text === 'string' ? [new TextRun(text)] : text });
}
function numbered(text) {
  return new Paragraph({ numbering: { reference: 'steps', level: 0 }, spacing: { after: 80, line: 264 },
    children: typeof text === 'string' ? [new TextRun(text)] : text });
}
function note(label, text) {
  return new Paragraph({ spacing: { before: 80, after: 140 },
    shading: { fill: 'FFF8E7', type: ShadingType.CLEAR },
    border: {
      left: { style: BorderStyle.SINGLE, size: 18, color: 'D97706', space: 8 },
      top: { style: BorderStyle.SINGLE, size: 2, color: 'FDE68A', space: 4 },
      bottom: { style: BorderStyle.SINGLE, size: 2, color: 'FDE68A', space: 4 },
      right: { style: BorderStyle.SINGLE, size: 2, color: 'FDE68A', space: 4 },
    },
    children: [new TextRun({ text: label + '  ', bold: true, color: 'B45309' }), new TextRun({ text, color: '7A4A0A' })] });
}
function cell(text, { w, head = false } = {}) {
  return new TableCell({ width: { size: w, type: WidthType.DXA },
    shading: head ? { fill: PURPLE, type: ShadingType.CLEAR } : { fill: 'FFFFFF', type: ShadingType.CLEAR },
    margins: { top: 90, bottom: 90, left: 130, right: 130 }, verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({ children: [new TextRun({ text, bold: head, color: head ? 'FFFFFF' : DARK, size: head ? 19 : 20 })] })] });
}
function table(headers, rows, widths) {
  const b = { style: BorderStyle.SINGLE, size: 1, color: 'D6D0C4' };
  const borders = { top: b, bottom: b, left: b, right: b, insideHorizontal: b, insideVertical: b };
  return new Table({ width: { size: widths.reduce((a, c) => a + c, 0), type: WidthType.DXA }, columnWidths: widths, borders,
    rows: [ new TableRow({ tableHeader: true, children: headers.map((hh, i) => cell(hh, { w: widths[i], head: true })) }),
      ...rows.map(r => new TableRow({ children: r.map((c, i) => cell(c, { w: widths[i] })) })) ] });
}
function spacer() { return new Paragraph({ spacing: { after: 60 }, children: [new TextRun('')] }); }

// ── tier config ───────────────────────────────────────────────────────────────
const TIERS = {
  SMF: {
    full: 'State Master Franchisee', scope: 'your entire state',
    sees: 'all City and Unit franchisees under you, their students and orders, plus the course catalogue.',
    pricing: 'On each level you see four prices: your SMF rate, the CF rate, the UF rate, and the Student Fee (what the parent pays).',
    ordersLabel: 'State orders',
    network: [
      p('As a State Master Franchisee you oversee every City and Unit franchisee in your state.'),
      bullet('See all City and Unit franchisees in your state, with their territory, registered courses and status.'),
      bullet('Drill into any of their students and orders to monitor activity across your region.'),
      note('Territory rule:', 'There is one SMF per state and one CF per city; a city can have many Unit Franchisees. You see your own data and that of everyone beneath you.'),
    ],
  },
  CF: {
    full: 'City Franchisee', scope: 'your city',
    sees: 'the Unit franchisees under you, their students and orders, plus your courses and prices.',
    pricing: 'On each level you see three prices: your CF rate, the UF rate, and the Student Fee (what the parent pays).',
    ordersLabel: 'City orders',
    network: [
      p('As a City Franchisee you oversee the Unit franchisees in your city.'),
      bullet('See the Unit franchisees in your city, with their territory, registered courses and status.'),
      bullet('Drill into their students and orders to monitor activity across your city.'),
      note('Territory rule:', 'There is one CF per city; a city can have many Unit Franchisees. You see your own data and that of the units beneath you.'),
    ],
  },
  UF: {
    full: 'Unit Franchisee', scope: 'your centre',
    sees: 'your own students, your own orders, and your courses and prices.',
    pricing: 'On each level you see your kit rate and the Student Fee (what the parent pays).',
    ordersLabel: 'My orders',
    network: null, // UF has no sub-network
  },
};

// ── body builder ────────────────────────────────────────────────────────────
function buildBody(tierKey) {
  const t = TIERS[tierKey];
  const out = [];
  const titles = [];
  let n = 0;
  const H1 = (title) => { n += 1; titles.push(title); return new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(`${n}. ${title}`)] }); };

  // 1 Welcome
  out.push(H1('Welcome'));
  out.push(p(`Welcome to the New Learning Horizons (NLH) Platform — your workspace for running your franchise as a ${t.full}. From one place you can enrol students, track fees, order kits, view the course catalogue and prices, issue certificates${t.network ? ', and oversee your sub-network' : ''}.`));
  out.push(p(`This manual is written specifically for the ${t.full} (${tierKey}). It covers every feature available to you.`));
  out.push(note('Tip:', 'Keep this manual handy. When the platform gains new features, an updated version will be shared with you.'));

  // 2 Login
  out.push(H1('Your Login & Account'));
  out.push(h2('Signing in'));
  out.push(numbered('Open nlh-platform.vercel.app in any modern browser (Chrome, Edge, Safari) on a computer or phone.'));
  out.push(numbered('Enter your registered email address and password, then click Log In.'));
  out.push(h2('First-time login / forgot password'));
  out.push(p('Your account is created with a temporary password sent by email. To set your own:'));
  out.push(numbered('On the login page, click “Forgot password?”.'));
  out.push(numbered('Enter your registered email and submit.'));
  out.push(numbered('Open the reset link from your inbox and choose a new password.'));
  out.push(note('Security:', 'Never share your password. NLH staff will never ask for it. Your login shows only the data for ' + t.scope + '.'));

  // 3 Dashboard
  out.push(H1('The Dashboard'));
  out.push(p('The Dashboard is your home screen and summarises your operation at a glance.'));
  out.push(bullet('Key numbers — students, orders, fees collected and balance due for ' + t.scope + '.'));
  out.push(bullet('Search — find any student, order' + (t.network ? ' or franchisee' : '') + ' instantly.'));
  out.push(bullet('Follow-ups — one list of students who need attention (see the Follow-ups section). Click an item to jump to the student.'));
  out.push(bullet('Quick actions — shortcuts to place an order, add a student and download this manual.'));

  // 4 Students
  out.push(H1('Students'));
  out.push(h2('The students list'));
  out.push(p('The Students page lists everyone enrolled in ' + t.scope + ', newest joiners first, with course progress, parent contact, fees and status.'));
  out.push(bullet([new TextRun({ text: 'Sessions column ', bold: true }), new TextRun('— per course: “12/24” for session courses (amber when all sessions are done but not yet marked complete), “monthly” for monthly courses (“📅 renew” near month-end), or “✓ done” when completed.')]));
  out.push(bullet([new TextRun({ text: 'Status ', bold: true }), new TextRun('— paid, partial or pending, calculated automatically from the fee ledger.')]));
  out.push(bullet([new TextRun({ text: 'Export ', bold: true }), new TextRun('— download the list as a spreadsheet.')]));
  out.push(h2('Enrolling a new student'));
  out.push(numbered('Click + Enrol Student.'));
  out.push(numbered('Enter name, parent/guardian, gender, date of registration, phone and parent email.'));
  out.push(numbered('For a special camp, set Enrolment Channel to “Camp / Event” and type the camp name — it prints on the certificate.'));
  out.push(numbered('Choose the centre and the course(s) and level(s); optionally assign a batch and joining date.'));
  out.push(numbered('Click Add Student.'));
  out.push(note('Joining date:', 'The batch joining date defaults to the student’s registration date, so attendance counts from when they actually started. You can change it any time.'));
  out.push(h2('Courses & batches for a student'));
  out.push(bullet([new TextRun({ text: '+ Batch / Edit Batch ', bold: true }), new TextRun('— assign or change the student’s batch for that course.')]));
  out.push(bullet([new TextRun({ text: '⇄ Level ', bold: true }), new TextRun('— fix a wrongly-selected course/level. Batch, attendance and certificate history are preserved.')]));
  out.push(bullet([new TextRun({ text: '✓ Complete ', bold: true }), new TextRun('— mark a course complete and choose the actual end date.')]));
  out.push(bullet([new TextRun({ text: '🎓 Cert ', bold: true }), new TextRun('— generate the Certificate of Accomplishment.')]));
  out.push(bullet([new TextRun({ text: '💬 Review ', bold: true }), new TextRun('— once complete, send the parent a Google review request on WhatsApp.')]));
  out.push(h2('Fee tracking & recording payments'));
  out.push(p('Each student has a fee ledger. Fee Total is the agreed fee; Fee Paid is the sum of recorded payments; Balance is the difference.'));
  out.push(numbered('Open the student’s Profile tab → Fee Tracking → + Record Payment.'));
  out.push(numbered('Enter only the amount received now, the date, the mode and an optional reference (UTR / cheque no).'));
  out.push(numbered('Click Record Payment — it is added to the running total and the balance/status update automatically.'));
  out.push(note('Important:', 'You record each instalment; the platform keeps the running total. Every payment is listed in the Payment History.'));

  // 5 Catalogue
  out.push(H1('Course Catalogue & Pricing'));
  out.push(p('The Courses page shows every NLH program as a card. Click a program to expand its levels and prices.'));
  out.push(p(t.pricing));
  out.push(p('Use the search box to find any program or level quickly. The catalogue is maintained centrally by NLH — if a price looks wrong, contact the head office.'));

  // 6 Orders
  out.push(H1('Ordering Kits'));
  out.push(p('Order learning kits through the Orders page (shown to you as “' + t.ordersLabel + '”).'));
  out.push(h2('Placing an order'));
  out.push(numbered('Go to Orders and click + New Order.'));
  out.push(numbered('Select the levels (SKUs) and quantities — you can only order for levels your centre is enabled for.'));
  out.push(numbered('Enter the delivery address and submit. You receive an order confirmation by email.'));
  out.push(h2('Order lifecycle'));
  out.push(table(['Stage', 'What it means'], [
    ['Pending', 'Order placed, awaiting invoice from NLH.'],
    ['Invoiced', 'NLH generated your invoice — review and pay.'],
    ['Payment submitted', 'You entered your payment mode + UTR / reference.'],
    ['Verified / Closed', 'NLH confirmed the payment.'],
    ['Dispatched', 'Kit shipped with an AWB / tracking number (can happen on credit, independent of payment).'],
  ], [2600, 6760]));
  out.push(spacer());
  out.push(h2('Submitting payment for an order'));
  out.push(numbered('Open the invoiced order, choose your payment mode and enter the UTR / reference, then submit.'));
  out.push(note('Bank details:', 'IDFC FIRST Bank, Nagpur – Byramji Town Branch · A/c 10278096847 · IFSC IDFB0042504 · UPI newlearninghorizons@idfcbank'));

  // 7 Network (SMF/CF only)
  if (t.network) {
    out.push(H1('Managing Your Network'));
    t.network.forEach(x => out.push(x));
    out.push(p('Open the Franchisees page to see and monitor your network.'));
  }

  // Certificates
  out.push(H1('Certificates & Parent Communication'));
  out.push(h2('Issuing a certificate'));
  out.push(numbered('Open the student’s Courses & Batches tab → 🎓 Cert.'));
  out.push(numbered('Select the course(s). The certificate shows the student’s name, courses & levels, camp name (if set), centre and date.'));
  out.push(numbered('Print / save as PDF, email it, or send it on WhatsApp.'));
  out.push(h2('WhatsApp & Google reviews'));
  out.push(p('Certificates and review requests are sent from the official NLH WhatsApp number; you can change the recipient before sending. After a course is complete, use 💬 Review to request a Google review from the parent.'));

  // Follow-ups
  out.push(H1('Follow-ups & Reminders'));
  out.push(p('The platform flags students who need attention, both inline and on the Dashboard.'));
  out.push(bullet([new TextRun({ text: '⚠ Review (sessions done) ', bold: true }), new TextRun('— all sessions attended but the course is not marked complete. Finish it and issue the certificate, or check why.')]));
  out.push(bullet([new TextRun({ text: '📅 Renew (month ending) ', bold: true }), new TextRun('— a monthly course is near month-end. Collect next month’s fee if the student is continuing.')]));
  out.push(p('The Dashboard “Follow-ups” card gathers these into one worklist. Clear it weekly to stay on top of completions and collections.'));

  // Best practices
  out.push(H1('Best Practices'));
  out.push(bullet('Record every payment the day you receive it — the ledger keeps balances and status accurate.'));
  out.push(bullet('Set correct registration and batch joining dates so attendance and session counts are right from day one.'));
  out.push(bullet('Mark courses complete promptly and issue certificates — keeps your Follow-ups clean and parents happy.'));
  out.push(bullet('Check the Dashboard Follow-ups card at the start of each week.'));
  out.push(bullet('Keep parent phone numbers and emails up to date so certificates and reminders reach them.'));
  out.push(bullet('Place kit orders ahead of demand so students never wait for materials.'));

  // Support
  out.push(H1('Support & Contacts'));
  out.push(p('For help with the platform, your account, pricing or orders, contact the NLH head office:'));
  out.push(table(['Contact', 'Detail'], [
    ['Head Office', '9, Anjuman Shopping Complex, Residency Road, Sadar, Nagpur – 440 001'],
    ['Phone', '9373111311'],
    ['Email', 'admin@nlhnagpur.info'],
    ['Website', 'www.nlhnagpur.info'],
  ], [2200, 7160]));
  out.push(spacer());
  out.push(p('Thank you for being part of the New Learning Horizons family. Together we are enriching children’s futures.', { italics: true, color: PURPLE }));

  return { out, titles };
}

// ── doc assembly ──────────────────────────────────────────────────────────────
function buildDoc(tierKey) {
  const t = TIERS[tierKey];
  const titlePage = [
    new Paragraph({ spacing: { before: 1400, after: 200 }, alignment: AlignmentType.CENTER,
      children: [new ImageRun({ type: 'png', data: LOGO, transformation: { width: 150, height: 150 },
        altText: { title: 'NLH', description: 'NLH logo', name: 'NLH logo' } })] }),
    new Paragraph({ spacing: { before: 200, after: 0 }, alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: 'NEW LEARNING HORIZONS', bold: true, size: 52, color: PURPLE })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 },
      children: [new TextRun({ text: 'ISO 9001:2015 Certified  ·  Enriching Children’s Future since 2008', size: 20, color: GREY })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 1200, after: 0 },
      children: [new TextRun({ text: 'Platform Operating Manual', bold: true, size: 40, color: DARK })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 120 },
      children: [new TextRun({ text: `${tierKey} Edition — For ${t.full}s`, size: 24, color: PURPLE })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 2000 },
      children: [new TextRun({ text: 'nlh-platform.vercel.app', size: 22, color: PURPLE, bold: true })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 60 },
      children: [new TextRun({ text: 'Version 1.0', size: 18, color: GREY })] }),
    new Paragraph({ children: [new PageBreak()] }),
  ];
  const { out: bodyParas, titles } = buildBody(tierKey);
  const toc = [
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Contents')] }),
    ...titles.map(function (title, i) {
      return new Paragraph({
        spacing: { after: 90, line: 276 },
        children: [
          new TextRun({ text: (i + 1) + '.', bold: true, color: PURPLE, size: 22 }),
          new TextRun({ text: '   ' + title, size: 22, color: DARK }),
        ],
      });
    }),
    new Paragraph({ children: [new PageBreak()] }),
  ];

  return new Document({
    creator: 'New Learning Horizons', title: `NLH Platform Operating Manual — ${tierKey}`,
    styles: {
      default: { document: { run: { font: 'Arial', size: 21, color: DARK } } },
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 30, bold: true, font: 'Arial', color: PURPLE },
          paragraph: { spacing: { before: 320, after: 160 }, outlineLevel: 0,
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: PURPLE, space: 4 } } } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 24, bold: true, font: 'Arial', color: DARK },
          paragraph: { spacing: { before: 220, after: 100 }, outlineLevel: 1 } },
      ],
    },
    numbering: { config: [
      { reference: 'bullets', levels: [
        { level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 280 } } } },
      ] },
      { reference: 'steps', levels: [
        { level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 300 } } } },
      ] },
    ] },
    sections: [{
      properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
      headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT,
        border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: LIGHT, space: 6 } },
        children: [new TextRun({ text: `NLH Platform Operating Manual — ${tierKey} Edition`, size: 16, color: GREY })] })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER,
        children: [ new TextRun({ text: `${t.full} Edition  ·  Page `, size: 16, color: GREY }),
          new TextRun({ children: [PageNumber.CURRENT], size: 16, color: GREY }) ] })] }) },
      children: [...titlePage, ...toc, ...bodyParas],
    }],
  });
}

const OUT_DIR = 'D:/Claude/nlh-platform/public/manuals';
fs.mkdirSync(OUT_DIR, { recursive: true });

(async () => {
  for (const tier of ['SMF', 'CF', 'UF']) {
    const buf = await Packer.toBuffer(buildDoc(tier));
    fs.writeFileSync(`${OUT_DIR}/NLH-Operating-Manual-${tier}.docx`, buf);
    console.log('written', tier);
  }
})();
