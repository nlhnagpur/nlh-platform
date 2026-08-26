import React from 'react'
import { useAuth } from '../context/AuthContext'

// ── NLH Brand Logo Box ─────────────────────────────────────────────────────
function NLHBrandLogo() {
  return (
    <div className="nlh-logo-box">
      <div className="nlh-logo-estd">Estd. 2008 &nbsp;☀️</div>
      <div className="nlh-logo-lines">
        <span className="nlh-logo-new">new</span>
        <span className="nlh-logo-learning">Learning</span>
        <span className="nlh-logo-horizons">HORIZONS<sup>®</sup></span>
      </div>
      <div className="nlh-logo-iso">ISO 9001 : 2015</div>
      <div className="nlh-logo-tag">Enriching Children's Future</div>
    </div>
  )
}

// ── Decorative SVG Sun ─────────────────────────────────────────────────────
function SunSVG() {
  return (
    <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" width="90" height="90">
      {[0,30,60,90,120,150,180,210,240,270,300,330].map(a => (
        <line key={a} x1="50" y1="19" x2="50" y2="8"
          stroke="#FFC107" strokeWidth="4" strokeLinecap="round"
          transform={`rotate(${a} 50 50)`} />
      ))}
      <circle cx="50" cy="50" r="26" fill="#FFD234" stroke="#FFC107" strokeWidth="1.5"/>
      <circle cx="42" cy="46" r="3.5" fill="#4E342E"/>
      <circle cx="58" cy="46" r="3.5" fill="#4E342E"/>
      <circle cx="43.5" cy="44.5" r="1.2" fill="white"/>
      <circle cx="59.5" cy="44.5" r="1.2" fill="white"/>
      <path d="M 40,59 Q 50,68 60,59" stroke="#4E342E" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
      <circle cx="38" cy="56" r="4" fill="#FF8A65" opacity="0.5"/>
      <circle cx="62" cy="56" r="4" fill="#FF8A65" opacity="0.5"/>
    </svg>
  )
}

// ── Cloud SVG ──────────────────────────────────────────────────────────────
function CloudSVG({ width = 130 }) {
  return (
    <svg viewBox="0 0 140 65" width={width} xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="50" cy="44" rx="33" ry="19" fill="white" opacity="0.95"/>
      <ellipse cx="82" cy="44" rx="42" ry="23" fill="white" opacity="0.95"/>
      <ellipse cx="105" cy="42" rx="27" ry="17" fill="white" opacity="0.95"/>
      <ellipse cx="68" cy="30" rx="38" ry="22" fill="white" opacity="0.95"/>
    </svg>
  )
}

const FEATURES = [
  { icon: '📋', label: 'Engaging\nLessons',   ring: '#DBEAFE', border: '#93C5FD' },
  { icon: '💡', label: 'Creative\nThinking',   ring: '#FFFDE7', border: '#FDE68A' },
  { icon: '🎓', label: 'Build\nConfidence',    ring: '#DCFCE7', border: '#86EFAC' },
  { icon: '⭐', label: 'Bright\nFutures',      ring: '#EDE9FE', border: '#C4B5FD' },
]

const COURSES = [
  { icon: '🧮', name: 'Abacus Mental Maths',  desc: 'Lightning-fast calculation skills',     bg: '#DBEAFE', color: '#1D4ED8' },
  { icon: '✍️', name: 'Creative Writing',      desc: 'Express ideas with confidence',         bg: '#FCE7F3', color: '#BE185D' },
  { icon: '📝', name: 'Handwriting',           desc: 'Neat, confident penmanship for life',   bg: '#DCFCE7', color: '#15803D' },
  { icon: '🔢', name: 'Vedic Maths',           desc: 'Ancient techniques, modern speed',      bg: '#FEF3C7', color: '#B45309' },
  { icon: '🎤', name: 'Public Speaking',       desc: 'Speak with poise in any situation',     bg: '#EDE9FE', color: '#6D28D9' },
  { icon: '🎨', name: 'Art & Craft',           desc: 'Creativity & fine motor development',   bg: '#FFE4E6', color: '#BE123C' },
  { icon: '📖', name: 'Phonics & Reading',     desc: 'Strong foundations for early readers',  bg: '#ECFDF5', color: '#047857' },
  { icon: '🎲', name: 'Rubik\'s Cube',         desc: 'Spatial reasoning & problem solving',   bg: '#FFF7ED', color: '#C2410C' },
]

export default function LandingPage() {
  const { setScreen } = useAuth()

  return (
    <div className="lp-wrap">

      {/* ══════════════════════════════════════════════════════════════
          HERO SECTION — real hero image + logo
      ══════════════════════════════════════════════════════════════ */}
      <div className="lp-hero" style={{ padding: 0, display: 'flex', flexDirection: 'column', minHeight: 'unset' }}>

        {/* ── Nav ── */}
        <nav className="lp-nav" style={{ position: 'relative', zIndex: 10 }}>
          <img
            src="/NLH Logo.png"
            alt="New Learning Horizons"
            style={{ height: 64, objectFit: 'contain', borderRadius: 6, background: 'white', padding: '3px 8px' }}
          />
          <div className="lp-nav-actions">
            <button className="lp-nav-signin" onClick={() => setScreen('login')}>Sign in</button>
            <button className="lp-nav-req" onClick={() => setScreen('request')}>Request Access</button>
          </div>
        </nav>

        {/* ── Hero image — full width ── */}
        <img
          src="/website hero (1).png"
          alt="Learn Today, Lead Tomorrow — New Learning Horizons"
          style={{ width: '100%', display: 'block', maxHeight: 580, objectFit: 'cover', objectPosition: 'center top' }}
        />

        {/* ── Bottom bar ── */}
        <div className="lp-bar">
          <div className="lp-bar-item">
            <span className="lp-bar-icon" style={{color:'#1D4ED8'}}>👥</span>
            <span className="lp-bar-txt">For Ages 2 – 21</span>
          </div>
          <div className="lp-bar-div"/>
          <div className="lp-bar-item">
            <span className="lp-bar-icon" style={{color:'#15803D'}}>🌍</span>
            <span className="lp-bar-txt">Learn Anywhere</span>
          </div>
          <div className="lp-bar-div"/>
          <div className="lp-bar-item">
            <span className="lp-bar-icon" style={{color:'#15803D'}}>🛡️</span>
            <span className="lp-bar-txt">Safe &amp; Supportive</span>
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════
          COURSES SECTION
      ══════════════════════════════════════════════════════════════ */}
      <div className="lp-section">
        <h2 className="lp-section-h2">Our <span style={{color:'#1565C0'}}>Skill Programmes</span></h2>
        <p className="lp-section-sub">
          16 holistic programmes for children aged 2–21 — from mental maths to public speaking.
        </p>
        <div className="lp-courses">
          {COURSES.map(c => (
            <div key={c.name} className="lp-course-card">
              <div className="lp-course-icon" style={{background: c.bg, color: c.color}}>{c.icon}</div>
              <h3>{c.name}</h3>
              <p>{c.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════
          CTA SECTION
      ══════════════════════════════════════════════════════════════ */}
      <div style={{maxWidth:1200, margin:'0 auto', padding:'0 5vw 80px'}}>
        <div className="lp-cta-section">
          <h2>Ready to grow your franchise?</h2>
          <p>Join the NLH network and bring quality skill education to your community.</p>
          <button className="lp-cta-white" onClick={() => setScreen('request')}>
            Request Platform Access <span style={{marginLeft:8}}>→</span>
          </button>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════
          FOOTER
      ══════════════════════════════════════════════════════════════ */}
      <footer className="lp-footer">
        <div className="lp-footer-inner">
          <div>
            <img src="/NLH Logo.png" alt="New Learning Horizons" style={{height:80, objectFit:'contain', marginBottom:12, borderRadius:6, background:'white', padding:'4px 8px'}} />
            <p>ISO 9001:2015 certified education franchise.<br/>Empowering franchisees and enriching<br/>children's futures since 2008.</p>
            <p style={{marginTop:10}}>📍 9, Anjuman Shopping Complex,<br/>Residency Road, Sadar, Nagpur 440 001</p>
            {/* Social media */}
            <div style={{display:'flex', gap:10, marginTop:14, alignItems:'center', flexWrap:'wrap'}}>
              <a href="https://instagram.com/newlearninghorizons" target="_blank" rel="noreferrer"
                style={{display:'flex',alignItems:'center',gap:5,color:'#E1306C',fontWeight:600,fontSize:13,textDecoration:'none'}}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>
                @newlearninghorizons
              </a>
              <a href="https://facebook.com/nlhnag" target="_blank" rel="noreferrer"
                style={{display:'flex',alignItems:'center',gap:5,color:'#1877F2',fontWeight:600,fontSize:13,textDecoration:'none'}}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
                nlhnag
              </a>
              <a href="https://linkedin.com/company/newlearninghorizons" target="_blank" rel="noreferrer"
                style={{display:'flex',alignItems:'center',gap:5,color:'#0A66C2',fontWeight:600,fontSize:13,textDecoration:'none'}}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
                newlearninghorizons
              </a>
            </div>
          </div>
          <div>
            <h4>Platform</h4>
            <a onClick={() => setScreen('login')} style={{cursor:'pointer'}}>Franchise Portal</a>
            <a onClick={() => setScreen('request')} style={{cursor:'pointer'}}>Request Access</a>
            <a onClick={() => setScreen('login')} style={{cursor:'pointer'}}>Sign In</a>
          </div>
          <div>
            <h4>Programmes</h4>
            <a>Abacus Mental Maths</a>
            <a>Creative Writing</a>
            <a>Vedic Maths</a>
            <a>Public Speaking</a>
            <a>Art &amp; Craft</a>
          </div>
          <div>
            <h4>Contact</h4>
            <a href="mailto:admin@nlhnagpur.info">admin@nlhnagpur.info</a>
            <a href="tel:+919373111311">+91 93731 11311</a>
            <a href="tel:+919028006800">+91 90280 06800</a>
            <p style={{marginTop:8,fontSize:11,opacity:0.6}}>Mon – Sat · 10 am – 6 pm IST</p>
            {/* Google QR */}
            <div style={{marginTop:14}}>
              <img
                src="/New Learning Horizons_GoogleQR & Social media.png"
                alt="Find us on Google"
                style={{width:130, borderRadius:8, boxShadow:'0 2px 8px rgba(0,0,0,0.15)'}}
                onError={e => { e.target.style.display = 'none' }}
              />
            </div>
          </div>
        </div>
        <div className="lp-footer-bottom">
          © {new Date().getFullYear()} New Learning Horizons · ISO 9001:2015 Certified · All rights reserved
        </div>
      </footer>
    </div>
  )
}
