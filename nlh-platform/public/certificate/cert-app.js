;(function () {
  'use strict'

  // ── URL params ──────────────────────────────────────────────────────────────
  var p    = new URLSearchParams(location.search)
  var type = p.get('type') || 'student'   // 'student' | 'franchise'

  // Base path for local assets (e.g. /certificate)
  var base = location.pathname.replace(/\/[^/]+$/, '')

  // ── DOM refs ────────────────────────────────────────────────────────────────
  var cert     = document.getElementById('cert')
  var main     = document.getElementById('cert-main')
  var sidebar  = document.getElementById('cert-sidebar')
  var barLabel = document.getElementById('bar-label')

  // ── Background ──────────────────────────────────────────────────────────────
  cert.style.backgroundImage = "url('" + base + "/assets/cert-bg.png')"

  // ── Sidebar (same for both cert types) ──────────────────────────────────────
  sidebar.innerHTML = [
    '<div class="estd">Estd. 2008</div>',
    '<img class="sb-logo" src="' + base + '/assets/logo-square.jpg" alt="NLH" onerror="this.style.display=\'none\'">',
    '<div class="iso">ISO 9001:2015</div>',
    '<div class="tagline">Enriching Children\'s<br>Future since 2008</div>',
    '<div class="social">',
    '  <span>📸 /newlearninghorizon</span>',
    '  <span>📘 /nlhnag</span>',
    '  <span>🌐 nlhnagpur.info</span>',
    '</div>',
    '<div class="brand-row">',
    '  <img src="/acem-abacus-logo.png" alt="ACEM Abacus" onerror="this.style.display=\'none\'">',
    '  <img src="/writewell-logo.png" alt="WriteWell" onerror="this.style.display=\'none\'">',
    '  <img src="/easy-math-logo.png" alt="Easy Math" onerror="this.style.display=\'none\'">',
    '</div>',
  ].join('\n')

  // ── Dispatch ─────────────────────────────────────────────────────────────────
  if (type === 'franchise') {
    buildFranchiseCert()
  } else {
    buildStudentCert()
  }

  // ── Student certificate ──────────────────────────────────────────────────────
  function buildStudentCert() {
    var name   = p.get('name')   || ''
    var parent = p.get('parent') || ''
    var course = p.get('course') || ''
    var centre = p.get('centre') || ''
    var date   = p.get('date')   || todayDMY()

    document.title = 'Certificate — ' + name
    barLabel.textContent = 'Certificate · ' + name + ' · ' + course

    main.innerHTML = [
      '<img class="nlh-logo" src="' + base + '/assets/logo-square.jpg" alt="NLH" onerror="this.style.display=\'none\'">',
      '<div class="acc">Certificate of Accomplishment</div>',
      '<div class="certify">THIS IS TO CERTIFY THAT</div>',
      '<div class="nm">' + esc(name) + '</div>',
      parent ? '<div class="pr">' + esc(parent) + '</div>' : '',
      '<div class="comp">Has successfully completed</div>',
      '<div class="cr">' + esc(course) + '</div>',
      centre ? '<div class="ct">at ' + esc(centre) + '</div>' : '',
      '<div class="ft">',
      '  <div class="sig-blk">',
      '    <img class="sig-img" src="/DRP%20Signature.png" alt="Signature" onerror="this.style.display=\'none\'">',
      '    <div class="sig-nm">Dhiral Panchmatia</div>',
      '    <div class="sig-tl">Founder, New Learning Horizons</div>',
      '  </div>',
      '  <img class="mascot-img" src="' + base + '/assets/mascot.png" alt="" onerror="this.style.display=\'none\'">',
      '  <div class="dt-blk">',
      '    <div class="dt-val">' + esc(date) + '</div>',
      '    <div class="dt-lbl">Date</div>',
      '  </div>',
      '</div>',
    ].join('\n')
  }

  // ── Franchise certificate ────────────────────────────────────────────────────
  function buildFranchiseCert() {
    var name    = p.get('name')    || ''
    var tier    = p.get('tier')    || 'UF'
    var city    = p.get('city')    || ''
    var state   = p.get('state')   || ''
    var address = p.get('address') || ''
    var courses = p.get('courses') || ''
    var till    = p.get('till')    || ''

    var isSMF  = tier === 'SMF'
    var nameSz = isSMF ? '24pt' : '30pt'
    var label  = tierLabel(tier, city)

    document.title = 'Franchise Certificate — ' + name
    barLabel.textContent = 'Franchise Certificate · ' + name

    main.innerHTML = [
      '<img class="nlh-logo" src="' + base + '/assets/logo-square.jpg" alt="NLH" onerror="this.style.display=\'none\'">',
      '<div class="c-title">FRANCHISE CERTIFICATE</div>',
      '<div class="c-sub">This is to Certify that</div>',
      '<div class="fr-nm" style="font-size:' + nameSz + '">' + esc(name) + '</div>',
      (isSMF && state) ? '<div class="fr-state">' + esc(state) + '</div>' : '',
      '<div class="is-reg">Is a Registered</div>',
      '<div class="tier">' + esc(label) + '</div>',
      '<div class="nlh-at">New Learning Horizons at</div>',
      address ? '<div class="addr">' + esc(address) + '</div>' : '',
      courses ? '<div class="courses">for ' + esc(courses) + '</div>' : '',
      '<div class="ft">',
      '  <div class="sig-blk">',
      '    <img class="sig-img" src="/DRP%20Signature.png" alt="Signature" onerror="this.style.display=\'none\'">',
      '    <div class="sig-nm">Dhiral Panchmatia</div>',
      '    <div class="sig-tl">Founder, New Learning Horizons</div>',
      '  </div>',
      '  <div class="vt-blk">',
      '    <div class="vt-val">' + esc(till) + '</div>',
      '    <div class="vt-lbl">Valid Till</div>',
      '  </div>',
      '</div>',
    ].join('\n')
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────
  function tierLabel(tier, city) {
    if (tier === 'SMF') return 'State Master Franchisee of'
    if (tier === 'CF')  return (city ? city + ' ' : '') + 'City Master Franchisee of'
    return 'Unit Franchisee of'
  }

  function todayDMY() {
    var d = new Date()
    return [
      String(d.getDate()).padStart(2, '0'),
      String(d.getMonth() + 1).padStart(2, '0'),
      d.getFullYear(),
    ].join('.')
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }
})()
