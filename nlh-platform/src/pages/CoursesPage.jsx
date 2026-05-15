import React, { useState, useEffect } from 'react'
import { sb } from '../supabase'
import { useAuth } from '../context/AuthContext'
import { fmtAmt, showToast } from '../utils'
import { isAdminRole } from '../constants/roles'

// ── CoursesPage ────────────────────────────────────────────────────────────────

export default function CoursesPage() {
  const { currentRole, currentFranchiseeId } = useAuth()
  const admin = isAdminRole(currentRole)

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (currentRole === null) return   // wait for auth to resolve
    async function load() {
      setLoading(true)

      // Load all SKUs with course info
      const { data: skus, error } = await sb
        .from('skus')
        .select('*, courses(id, name, group_name)')
        .order('course_id')
        .order('sort_order')

      if (error) {
        showToast('Failed to load courses: ' + error.message, 'err')
        setLoading(false)
        return
      }

      if (admin || !currentFranchiseeId) {
        setRows(skus || [])
        setLoading(false)
        return
      }

      // Non-admin: filter by franchisee's registered_skus
      const { data: fr, error: frErr } = await sb
        .from('franchisees')
        .select('registered_skus, registered_courses')
        .eq('id', currentFranchiseeId)
        .single()

      if (frErr || !fr) {
        setRows(skus || [])
        setLoading(false)
        return
      }

      const regSkus = fr.registered_skus || []
      if (regSkus.length === 0) {
        // Fall back to registered_courses filtering
        const regCourses = fr.registered_courses || []
        setRows((skus || []).filter(s => regCourses.includes(s.course_id)))
      } else {
        setRows((skus || []).filter(s => regSkus.includes(s.id)))
      }

      setLoading(false)
    }

    load()
  }, [admin, currentRole, currentFranchiseeId])

  // Filter by search
  const filtered = rows.filter(s => {
    const q = search.toLowerCase()
    return (
      !q ||
      s.level_name?.toLowerCase().includes(q) ||
      s.courses?.name?.toLowerCase().includes(q) ||
      s.courses?.group_name?.toLowerCase().includes(q)
    )
  })

  // Group by course for visual grouping — build a list of {sku, isFirstInCourse}
  const annotated = filtered.map((sku, idx) => ({
    sku,
    isFirst: idx === 0 || filtered[idx - 1].course_id !== sku.course_id,
    courseRowSpan: filtered.filter(s => s.course_id === sku.course_id).length,
  }))

  // Build unique courses with SKU counts
  const courseMap = {}
  rows.forEach(function (sku) {
    const c = sku.courses
    if (!c) return
    if (!courseMap[c.id]) {
      courseMap[c.id] = { ...c, skuCount: 0, totalStudents: 0 }
    }
    courseMap[c.id].skuCount++
  })
  const courseCards = Object.values(courseMap)

  const TONE_GRADIENT = {
    1: 'linear-gradient(90deg,#2563EB,#60A5FA)',
    2: 'linear-gradient(90deg,#16A34A,#6EE7B7)',
    3: 'linear-gradient(90deg,#D97706,#FCD34D)',
    4: 'linear-gradient(90deg,#DB2777,#F472B6)',
    5: 'linear-gradient(90deg,#7C3AED,#A78BFA)',
    6: 'linear-gradient(90deg,#0284C7,#38BDF8)',
    7: 'linear-gradient(90deg,#EA580C,#FB923C)',
    8: 'linear-gradient(90deg,#E11D48,#FB7185)',
  }
  const TONE_BG = {
    1: { bg: '#DBEAFE', color: '#2563EB' },
    2: { bg: '#DCFCE7', color: '#16A34A' },
    3: { bg: '#FEF3C7', color: '#D97706' },
    4: { bg: '#FCE7F3', color: '#DB2777' },
    5: { bg: '#E9D5FF', color: '#7C3AED' },
    6: { bg: '#BAE6FD', color: '#0284C7' },
    7: { bg: '#FED7AA', color: '#EA580C' },
    8: { bg: '#FECDD3', color: '#E11D48' },
  }

  const PROGRAM_EMOJIS = ['🧮','💻','🔤','🎨','🎲','🎭','✍️','📖','🎤','📝','♟️','🧠','🐝','🔬','🤖','🧘']

  return (
    <div className="pg">
      {/* Topbar */}
      <header className="tb">
        <div className="crumb">Catalog <span className="sep">›</span> <b>Programs</b></div>
        <div className="tb-r">
          <input
            className="search tb-search"
            placeholder="Search program / level…"
            value={search}
            onChange={function (e) { setSearch(e.target.value) }}
          />
        </div>
      </header>

      <div className="content">
        {/* Page header */}
        <div className="ph">
          <div className="ph-l">
            <div className="ph-eyebrow"><span className="dot"></span>Catalog</div>
            <h1 className="ph-title">Programs</h1>
            <div className="ph-sub">
              <b>{courseCards.length} skill-based programs</b> for children aged 2–21. <b>{rows.length} SKUs</b> across all levels.
            </div>
          </div>
        </div>

        {loading ? (
          <div className="loading">Loading programs…</div>
        ) : courseCards.length === 0 ? (
          <div className="empty">No programs available.</div>
        ) : (
          <div className="progs-grid">
            {courseCards.map(function (c, idx) {
              const tone = (idx % 8) + 1
              const tones = TONE_BG[tone]
              const em = PROGRAM_EMOJIS[idx % PROGRAM_EMOJIS.length]
              return (
                <div key={c.id} className="progs-card">
                  <div className="progs-bgbar" style={{ background: TONE_GRADIENT[tone] }}></div>
                  <span className="progs-active"><span className="d"></span>Active</span>
                  <div className="progs-em pe-" style={{ background: tones.bg, color: tones.color, marginTop: 18 }}>{em}</div>
                  <div className="progs-name">{c.group_name || c.name}</div>
                  <div className="progs-ages" style={{ marginTop: 4 }}>{c.name}</div>
                  <div className="progs-meta">
                    <div className="progs-meta-i">
                      <div className="progs-meta-num">{c.skuCount}</div>
                      <div className="progs-meta-lbl">SKUs</div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* SKU table below cards if search active */}
        {search && filtered.length > 0 && (
          <div className="card tbl-scroll" style={{ marginTop: 0 }}>
            <div className="card-h">
              <div className="card-t">Search results</div>
            </div>
            <table className="big-tbl">
              <thead>
                <tr>
                  <th>Program</th>
                  <th>Level / SKU</th>
                  <th style={{ textAlign: 'right' }}>UF Rate</th>
                  <th style={{ textAlign: 'right' }}>Student Fee</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(function (sku) {
                  return (
                    <tr key={sku.id}>
                      <td style={{ font: '500 12px var(--mono)', color: 'var(--text2)' }}>{sku.courses?.group_name || sku.courses?.name || '—'}</td>
                      <td>{sku.level_name || '—'}</td>
                      <td style={{ textAlign: 'right' }} className="mono">{sku.uf_rate != null ? '₹' + fmtAmt(sku.uf_rate) : '—'}</td>
                      <td style={{ textAlign: 'right' }} className="mono">{sku.student_fee != null ? '₹' + fmtAmt(sku.student_fee) : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
