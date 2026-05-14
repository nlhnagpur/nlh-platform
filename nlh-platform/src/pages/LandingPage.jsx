import React from 'react'
import { useAuth } from '../context/AuthContext'

const COURSES = [
  { icon: '🧮', name: 'Abacus Mental Maths', desc: 'Build lightning-fast calculation skills', bg: '#DBEAFE', color: '#2563EB' },
  { icon: '✍️', name: 'Creative Writing',    desc: 'Express ideas with confidence & clarity', bg: '#FCE7F3', color: '#DB2777' },
  { icon: '📝', name: 'Handwriting',         desc: 'Neat, confident penmanship for life', bg: '#DCFCE7', color: '#16A34A' },
  { icon: '🔢', name: 'Vedic Maths',         desc: 'Ancient techniques for modern speed', bg: '#FEF3C7', color: '#D97706' },
  { icon: '🎤', name: 'Public Speaking',     desc: 'Speak with poise in any situation', bg: '#EDE9FE', color: '#7C3AED' },
  { icon: '🎨', name: 'Art & Craft',         desc: 'Creativity and fine motor development', bg: '#FFE4E6', color: '#E11D48' },
  { icon: '📖', name: 'Phonics Reading',     desc: 'Strong foundations for early readers', bg: '#ECFDF5', color: '#059669' },
  { icon: '📚', name: 'Speed Reading',       desc: 'Read faster, retain more information', bg: '#FFF7ED', color: '#EA580C' },
]

const FEATURES = [
  { icon: '🏢', label: 'Franchise Management', bg: '#DBEAFE', color: '#2563EB' },
  { icon: '👨‍🎓', label: 'Student Tracking',    bg: '#DCFCE7', color: '#16A34A' },
  { icon: '📦', label: 'Kit Ordering',          bg: '#FEF3C7', color: '#D97706' },
  { icon: '📊', label: 'Revenue Analytics',     bg: '#EDE9FE', color: '#7C3AED' },
]

export default function LandingPage() {
  const { setScreen } = useAuth()

  return (
    <div className="landing-screen">
      {/* ── Nav ── */}
      <nav className="land-nav">
        <div className="land-nav-logo">
          <div className="login-icon" style={{ width: 36, height: 36, borderRadius: 9, fontSize: 16 }}>N</div>
          <div>
            <div className="name">New Learning Horizons</div>
            <div className="tag">ISO 9001:2015 Certified</div>
          </div>
        </div>
        <div className="land-nav-actions">
          <button className="land-btn land-btn-ghost" onClick={() => setScreen('login')}>Sign in</button>
          <button className="land-btn land-btn-primary" onClick={() => setScreen('request')}>Request Access</button>
        </div>
      </nav>

      {/* ── Hero ── */}
      <div className="land-hero">
        <div className="land-hero-text">
          <div className="land-features">
            {FEATURES.map(function(f) {
              return (
                <div key={f.label} className="land-feat">
                  <div className="land-feat-icon" style={{ background: f.bg, color: f.color }}>{f.icon}</div>
                  <div className="land-feat-label">{f.label}</div>
                </div>
              )
            })}
          </div>
          <h1>
            Empowering Franchisees,
            <span className="accent"> Enriching Children's Future</span>
          </h1>
          <p>
            India's leading skill-based education network — 16 programs for children aged 2–21.
            Manage your franchise, track students, and grow your centre all from one platform.
          </p>
          <div className="land-cta">
            <button className="land-cta-primary" onClick={() => setScreen('request')}>
              Get Started Today
              <span className="land-cta-arrow">→</span>
            </button>
            <button className="land-btn land-btn-ghost" onClick={() => setScreen('login')}>
              Already have an account
            </button>
          </div>
        </div>

        <div className="land-hero-illust">
          <div className="land-hero-bubbles">
            <div className="land-bubble bubble-1">
              <div className="ic">🧮</div> Abacus Speed
            </div>
            <div className="land-bubble bubble-2">
              <div className="ic">🎤</div> Public Speaking
            </div>
            <div className="land-bubble bubble-3">
              <div className="ic">📊</div> Live Analytics
            </div>
            <div className="land-bubble bubble-4">
              <div className="ic">📦</div> Kit Orders
            </div>
          </div>
          <div className="land-hero-kid">🎒</div>
        </div>
      </div>

      {/* ── Stats bar ── */}
      <div className="land-stats-bar" style={{ margin: '-40px auto 0', maxWidth: 1100 }}>
        <div className="land-stat land-stat-1">
          <div className="land-stat-icon">📚</div>
          <div>
            <div className="land-stat-num">16+</div>
            <div className="land-stat-lbl">Courses</div>
          </div>
        </div>
        <div className="land-stat land-stat-2">
          <div className="land-stat-icon">👨‍🎓</div>
          <div>
            <div className="land-stat-num">1000+</div>
            <div className="land-stat-lbl">Students</div>
          </div>
        </div>
        <div className="land-stat land-stat-3">
          <div className="land-stat-icon">🏢</div>
          <div>
            <div className="land-stat-num">50+</div>
            <div className="land-stat-lbl">Centres</div>
          </div>
        </div>
        <div className="land-stat land-stat-4">
          <div className="land-stat-icon">🏆</div>
          <div>
            <div className="land-stat-num">15+</div>
            <div className="land-stat-lbl">Years</div>
          </div>
        </div>
      </div>

      {/* ── Courses section ── */}
      <div className="land-section" style={{ paddingTop: 100 }}>
        <h2>Our <span className="accent">Skill Programmes</span></h2>
        <p className="sub">Holistic skill development across 16 programmes — from mental maths to public speaking, designed for children aged 2 to 21.</p>
        <div className="land-courses">
          {COURSES.map(function(c) {
            return (
              <div key={c.name} className="land-course-card">
                <div className="land-course-icon" style={{ background: c.bg, color: c.color }}>{c.icon}</div>
                <h3>{c.name}</h3>
                <p>{c.desc}</p>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── CTA section ── */}
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 5vw 80px' }}>
        <div className="land-cta-section">
          <h2>Ready to grow your franchise?</h2>
          <p>Join the NLH network and bring quality skill education to your community.</p>
          <button className="land-btn-white" onClick={() => setScreen('request')}>
            Request Platform Access
            <span className="land-cta-arrow" style={{ background: 'rgba(37,99,235,0.12)' }}>→</span>
          </button>
        </div>
      </div>

      {/* ── Footer ── */}
      <footer className="land-footer">
        <div className="land-footer-inner">
          <div>
            <h4>New Learning Horizons</h4>
            <p>ISO 9001:2015 certified education franchise platform. Empowering franchisees and enriching children's futures since 2008.</p>
            <p style={{ marginTop: 12 }}>📍 Nagpur, Maharashtra, India</p>
          </div>
          <div>
            <h4>Platform</h4>
            <a onClick={() => setScreen('login')} style={{ cursor: 'pointer' }}>Franchise Portal</a>
            <a onClick={() => setScreen('request')} style={{ cursor: 'pointer' }}>Request Access</a>
            <a onClick={() => setScreen('login')} style={{ cursor: 'pointer' }}>Sign In</a>
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
            <p style={{ marginTop: 8, fontSize: 11, opacity: 0.7 }}>Mon – Sat · 10 am – 6 pm IST</p>
          </div>
        </div>
        <div className="land-footer-bottom">
          © {new Date().getFullYear()} New Learning Horizons · ISO 9001:2015 Certified · All rights reserved
        </div>
      </footer>
    </div>
  )
}
