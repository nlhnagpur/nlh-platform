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
          HERO SECTION
      ══════════════════════════════════════════════════════════════ */}
      <div className="lp-hero">

        {/* Blue sky wave — SVG fills right portion */}
        <svg className="lp-wave" viewBox="0 0 1440 680" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="skyG" x1="0%" y1="0%" x2="30%" y2="100%">
              <stop offset="0%" stopColor="#38BDF8"/>
              <stop offset="100%" stopColor="#0EA5E9"/>
            </linearGradient>
          </defs>
          {/* Main sky area */}
          <path d="M 700,0 C 620,100 700,280 590,680 L 1440,680 L 1440,0 Z" fill="url(#skyG)"/>
          {/* Subtle light rays from sun position */}
          <g opacity="0.12" fill="white">
            <polygon points="1310,60 1440,0 1440,90"/>
            <polygon points="1310,60 1440,90 1440,180"/>
            <polygon points="1310,60 1440,180 1380,280"/>
          </g>
        </svg>

        {/* ── Nav ── */}
        <nav className="lp-nav">
          <NLHBrandLogo />
          <div className="lp-nav-actions">
            <button className="lp-nav-signin" onClick={() => setScreen('login')}>Sign in</button>
            <button className="lp-nav-req" onClick={() => setScreen('request')}>Request Access</button>
          </div>
        </nav>

        {/* ── Hero body ── */}
        <div className="lp-body">

          {/* LEFT — text & CTA */}
          <div className="lp-left">
            {/* Star decorations */}
            <span className="lp-star" style={{top:'4%',right:'10%',fontSize:22}}>✦</span>
            <span className="lp-star" style={{top:'18%',right:'2%',fontSize:13,animationDelay:'.4s'}}>✦</span>
            <span className="lp-star" style={{bottom:'32%',right:'8%',fontSize:17,animationDelay:'.8s'}}>✦</span>
            <span className="lp-star" style={{bottom:'15%',right:'18%',fontSize:11,animationDelay:'1.2s'}}>✦</span>

            <h1 className="lp-h1">
              <span className="lp-h1-navy">Learn Today,</span>
              <br />
              <span className="lp-h1-blue">Lead Tomorrow!</span>
            </h1>

            <p className="lp-sub">
              Inspiring young minds to explore, create<br />
              and grow with confidence.
            </p>

            {/* Feature icons */}
            <div className="lp-feats">
              {FEATURES.map(f => (
                <div key={f.label} className="lp-feat">
                  <div className="lp-feat-ring" style={{ background: f.ring, border: `2px solid ${f.border}` }}>
                    <span>{f.icon}</span>
                  </div>
                  <div className="lp-feat-lbl">{f.label}</div>
                </div>
              ))}
            </div>

            {/* CTA button */}
            <button className="lp-cta" onClick={() => setScreen('login')}>
              Explore Courses <span className="lp-cta-arrow">→</span>
            </button>

            {/* Paper plane */}
            <div className="lp-plane">
              <svg viewBox="0 0 80 50" width="80" xmlns="http://www.w3.org/2000/svg">
                <path d="M 2,25 L 78,2 L 58,25 L 78,48 Z" fill="#1E40AF" opacity="0.75"/>
                <path d="M 58,25 L 78,48 L 38,36 Z" fill="#1D4ED8" opacity="0.6"/>
                <path d="M 2,25 C 15,22 30,26 44,24 C 58,22 68,18 78,2"
                  stroke="#1E40AF" strokeWidth="1.5" fill="none"
                  strokeDasharray="5,4" opacity="0.4"/>
              </svg>
            </div>
          </div>

          {/* RIGHT — illustration */}
          <div className="lp-right">
            {/* Sun */}
            <div className="lp-sun"><SunSVG /></div>

            {/* Clouds */}
            <div className="lp-cloud" style={{top:'6%',left:'4%'}}><CloudSVG width={140} /></div>
            <div className="lp-cloud" style={{top:'1%',right:'3%',opacity:0.85}}><CloudSVG width={105} /></div>

            {/* Speech bubble */}
            <div className="lp-bubble">
              <svg viewBox="0 0 150 115" width="130" xmlns="http://www.w3.org/2000/svg">
                <ellipse cx="75" cy="52" rx="73" ry="48" fill="white" stroke="#E0E0E0" strokeWidth="1.5"/>
                <polygon points="44,95 78,100 62,115" fill="white" stroke="#E0E0E0" strokeWidth="1" strokeLinejoin="round"/>
                <text x="75" y="36" textAnchor="middle" fontSize="13.5" fontWeight="700" fill="#1565C0" fontFamily="DM Sans,sans-serif">You</text>
                <text x="75" y="53" textAnchor="middle" fontSize="13.5" fontWeight="700" fill="#1565C0" fontFamily="DM Sans,sans-serif">can do</text>
                <text x="75" y="70" textAnchor="middle" fontSize="13.5" fontWeight="700" fill="#1565C0" fontFamily="DM Sans,sans-serif">amazing</text>
                <text x="75" y="87" textAnchor="middle" fontSize="13.5" fontWeight="700" fill="#1565C0" fontFamily="DM Sans,sans-serif">things!</text>
              </svg>
              <span className="lp-bubble-star">✦</span>
            </div>

            {/* Floating subject badges */}
            <div className="lp-badge" style={{top:'26%',right:'3%'}}>⚛️</div>
            <div className="lp-badge" style={{top:'44%',right:'6%',background:'#DCFCE7'}}>🧪</div>
            <div className="lp-badge" style={{bottom:'30%',right:'2%'}}>🎤</div>

            {/* Children illustration — emoji scene */}
            <div className="lp-kids">
              <div className="lp-kid-wrap" style={{zIndex:4}}>
                <div className="lp-kid-emoji">👧🏻</div>
                <div className="lp-kid-item">✏️</div>
              </div>
              <div className="lp-kid-wrap" style={{zIndex:3}}>
                <div className="lp-kid-emoji">🧒</div>
                <div className="lp-kid-item">🟧</div>
              </div>
              <div className="lp-kid-wrap" style={{zIndex:2}}>
                <div className="lp-kid-emoji">👧🏿</div>
                <div className="lp-kid-item">🎧</div>
              </div>
              <div className="lp-kid-wrap" style={{zIndex:1}}>
                <div className="lp-kid-emoji">👦🏽</div>
                <div className="lp-kid-item">💻</div>
              </div>
            </div>

            {/* Desk surface */}
            <div className="lp-desk"/>

            {/* Book stack */}
            <div className="lp-books">
              <div className="lp-book" style={{background:'#1565C0'}}>SCIENCE</div>
              <div className="lp-book" style={{background:'#2E7D32'}}>MATH</div>
              <div className="lp-book" style={{background:'#6A1B9A'}}>STORIES</div>
            </div>
          </div>
        </div>

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
            <h4>New Learning Horizons</h4>
            <p>ISO 9001:2015 certified education franchise. Empowering franchisees and enriching children's futures since 2008.</p>
            <p style={{marginTop:10}}>📍 Nagpur, Maharashtra, India</p>
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
            <a>admin@nlhnagpur.info</a>
            <a>+91 93731 11311</a>
            <a>+91 90280 06800</a>
            <p style={{marginTop:8,fontSize:11,opacity:0.6}}>Mon – Sat · 10 am – 6 pm IST</p>
          </div>
        </div>
        <div className="lp-footer-bottom">
          © {new Date().getFullYear()} New Learning Horizons · ISO 9001:2015 Certified · All rights reserved
        </div>
      </footer>
    </div>
  )
}
