/* ============================================================
   NLH Certificate — cert-app.js
   ============================================================ */
'use strict';

const $ = id => document.getElementById(id);

/* ── Programs quick-pick ── */
const PROGRAMS = [
  { e: '🧮', n: 'ACEM Abacus' },
  { e: '✍️', n: 'Write Well' },
  { e: '💻', n: 'Coding' },
  { e: '🎲', n: "Rubik's Cube" },
  { e: '🔤', n: 'Phonics' },
  { e: '🎨', n: 'Art and Craft' },
  { e: '📖', n: 'Storytelling' },
  { e: '🎭', n: 'Public Speaking' },
  { e: '🌟', n: 'Personality Dev' },
  { e: '➗', n: 'Easy Math' },
  { e: '♟', n: 'Chess' },
  { e: '📝', n: 'Creative Writing' },
  { e: '📚', n: 'English Grammar' },
  { e: '🗣', n: 'Reading' },
];

const chipsEl = $('program-chips');
PROGRAMS.forEach(p => {
  const c = document.createElement('button');
  c.className = 'chip';
  c.type = 'button';
  c.textContent = `${p.e} ${p.n}`;
  c.dataset.name = p.n;
  c.addEventListener('click', () => {
    chipsEl.querySelectorAll('.chip').forEach(x => x.classList.remove('active'));
    c.classList.add('active');
    $('f-program').value = p.n;
    render();
  });
  chipsEl.appendChild(c);
});

/* ── Pre-fill from URL params (opened from StudentCertModal) ── */
(function prefillFromUrl() {
  const p = new URLSearchParams(location.search);
  function set(id, val) {
    if (!val) return;
    const el = $(id);
    if (!el) return;
    el.value = val;
  }
  set('f-name',     p.get('name'));
  set('f-parent',   p.get('parent'));
  set('f-location', p.get('location'));
  set('f-program',  p.get('program'));
  set('f-level',    p.get('level'));
  set('f-center',   p.get('center'));
  set('f-date',     p.get('date'));
  set('f-id',       p.get('certid'));

  // Handle select fields
  const titleEl = $('f-title');
  const relEl   = $('f-rel');
  const titleParam = p.get('title');
  const relParam   = p.get('rel');
  if (titleParam) {
    for (const opt of titleEl.options) { if (opt.value === titleParam) { opt.selected = true; break; } }
  }
  if (relParam) {
    for (const opt of relEl.options) { if (opt.value === relParam) { opt.selected = true; break; } }
  }

  // Set default date to today if not provided
  if (!p.get('date')) {
    const d = new Date();
    const iso = d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
    $('f-date').value = iso;
  }

  // Generate cert ID if not provided
  if (!p.get('certid')) {
    const year  = new Date().getFullYear();
    const prog  = (p.get('program') || 'NLH').replace(/[^a-zA-Z]/g, '').slice(0, 4).toUpperCase();
    const lvl   = (p.get('level')   || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 4).toUpperCase() || 'L1';
    const seq   = String(Math.floor(Math.random() * 90000) + 10000);
    $('f-id').value = `NLH-${year}-${prog}-${lvl}-${seq}`;
  }

  // Sync chip highlight
  const progVal = $('f-program').value;
  const match = [...chipsEl.querySelectorAll('.chip')].find(c => c.dataset.name === progVal);
  if (match) match.classList.add('active');
})();

/* ── Date formatter DD.MM.YYYY ── */
function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T12:00:00');
  if (isNaN(d)) return iso;
  return String(d.getDate()).padStart(2, '0') + '.' +
         String(d.getMonth() + 1).padStart(2, '0') + '.' +
         d.getFullYear();
}

/* ── Live render ── */
function render() {
  const title   = $('f-title').value.trim();
  const name    = $('f-name').value.trim();
  const rel     = $('f-rel').value.trim();
  const parent  = $('f-parent').value.trim();
  const loc     = $('f-location').value.trim();
  const prog    = $('f-program').value.trim();
  const level   = $('f-level').value.trim();
  const center  = $('f-center').value.trim();
  const date    = $('f-date').value;
  const certid  = $('f-id').value.trim();

  $('c-name').textContent   = [title, name].filter(Boolean).join(' ');
  $('c-parent').textContent = [rel && parent ? `${rel} ${parent}` : parent, loc ? `R/o. ${loc}` : ''].filter(Boolean).join(', ');

  // Support pipe-separated programs/levels for multi-course certificates
  const progs  = prog.split('|').map(s => s.trim()).filter(Boolean);
  const levels = level.split('|').map(s => s.trim());
  const programEl = $('c-program');
  programEl.innerHTML = '';
  if (progs.length <= 1) {
    programEl.textContent = level ? `${prog} — ${level}` : prog;
  } else {
    progs.forEach(function (p, i) {
      if (i > 0) programEl.appendChild(document.createTextNode(', '));
      const l = levels[i] || '';
      const span = document.createElement('span');
      span.style.whiteSpace = 'nowrap';
      span.textContent = l ? `${p} — ${l}` : p;
      programEl.appendChild(span);
    });
  }

  $('c-center').textContent = center;
  $('c-date').textContent   = fmtDate(date);
  $('c-certid').textContent = certid;

  autoSizeName();
}

function autoSizeName() {
  const el   = $('c-name');
  const maxW = 1840; // cert canvas 2000 - 80px padding each side

  function getScale() {
    const scaler = document.querySelector('.preview-scaler');
    if (!scaler) return 1;
    const m = (scaler.style.transform || '').match(/scale\(([0-9.]+)\)/);
    return m ? parseFloat(m[1]) : 1;
  }

  const range = document.createRange();
  range.selectNodeContents(el);
  function textW() {
    return range.getBoundingClientRect().width / getScale();
  }

  let size = 110;
  el.style.fontSize  = size + 'px';
  el.style.whiteSpace = 'nowrap';

  while (textW() > maxW && size > 56) {
    size -= 3;
    el.style.fontSize = size + 'px';
  }
}

// Wire all inputs
['f-title','f-name','f-rel','f-parent','f-location','f-program','f-level','f-center','f-date','f-id']
  .forEach(id => {
    const el = $(id);
    if (el) { el.addEventListener('input', render); el.addEventListener('change', render); }
  });

render();

/* ── Preview scaling ── */
function fitPreview() {
  const stage  = document.querySelector('.preview-stage');
  const scaler = document.querySelector('.preview-scaler');
  if (!stage || !scaler) return;
  const certW  = 2000, certH = 1414;
  const availW = stage.clientWidth - 48;
  const availH = Math.max(window.innerHeight - 280, 500);
  const scale  = Math.min(availW / certW, availH / certH, 1);
  scaler.style.transform = `scale(${scale})`;
  scaler.style.width     = certW + 'px';
  scaler.style.height    = certH + 'px';
  stage.style.minHeight  = Math.round(certH * scale + 48) + 'px';
}
window.addEventListener('resize', fitPreview);
fitPreview();

/* ── Toast ── */
function toast(msg, dur) {
  const t = $('toast');
  $('toast-msg').textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), dur || 2600);
}

/* ── Print ── */
$('btn-print').addEventListener('click', function () {
  // Remove JS-set inline styles so @media print CSS can take over
  const nameEl = $('c-name');
  const savedFontSize   = nameEl.style.fontSize;
  const savedWhiteSpace = nameEl.style.whiteSpace;
  nameEl.style.removeProperty('font-size');
  nameEl.style.removeProperty('white-space');
  function restoreAfterPrint() {
    nameEl.style.fontSize   = savedFontSize;
    nameEl.style.whiteSpace = savedWhiteSpace;
    window.removeEventListener('afterprint', restoreAfterPrint);
  }
  window.addEventListener('afterprint', restoreAfterPrint);
  window.print();
});

/* ── Download PNG ── */
$('btn-download').addEventListener('click', async function () {
  const cert   = $('cert');
  const scaler = document.querySelector('.preview-scaler');
  const prev   = scaler.style.transform;
  scaler.style.transform = 'scale(1)';
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  try {
    const dataUrl = await htmlToImage.toPng(cert, {
      width: 2000, height: 1414, pixelRatio: 1, cacheBust: true,
    });
    const a = document.createElement('a');
    const safeName = ($('f-name').value || 'certificate')
      .replace(/[^a-z0-9 \-]/gi, '').trim().replace(/\s+/g, '-');
    a.download = `NLH-Certificate-${safeName}.png`;
    a.href = dataUrl;
    a.click();
    toast('Certificate saved as PNG ✓');
  } catch (err) {
    console.error(err);
    toast('Download failed — use Print → Save as PDF instead');
  } finally {
    scaler.style.transform = prev;
  }
});

/* ── Email modal ── */
const modal = document.querySelector('.modal-overlay');
$('btn-email').addEventListener('click',  () => modal.classList.add('open'));
$('em-cancel').addEventListener('click',  () => modal.classList.remove('open'));
modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('open'); });
$('em-send').addEventListener('click', () => {
  const to = $('em-to').value.trim();
  modal.classList.remove('open');
  toast('Certificate emailed to ' + (to || 'student'));
});
