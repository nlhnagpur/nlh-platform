import React, { useState, useEffect } from 'react'
import { sb } from '../supabase'
import { useAuth } from '../context/AuthContext'
import { fmtAmt, showToast } from '../utils'
import { isAdminRole } from '../constants/roles'

// ── CoursesPage ────────────────────────────────────────────────────────────────

// Match the CSS breakpoints in globals.css for .progs-grid
function getColCount() {
  if (typeof window === 'undefined') return 4
  if (window.innerWidth > 1200) return 4
  if (window.innerWidth > 768) return 3
  return 2
}

export default function CoursesPage() {
  const { currentRole, currentFranchiseeId } = useAuth()
  const admin = isAdminRole(currentRole)

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [expandedProgram, setExpandedProgram] = useState(null)
  const [colCount, setColCount] = useState(getColCount)

  // Keep colCount in sync with viewport so the row-grouping stays accurate
  useEffect(function () {
    function onResize() { setColCount(getColCount()) }
    window.addEventListener('resize', onResize)
    return function () { window.removeEventListener('resize', onResize) }
  }, [])

  useEffect(() => {
    if (currentRole === null) return   // wait for auth to resolve
    async function load() {
      setLoading(true)

      // Load all SKUs with course info — order by sort_order which encodes program+level sequence
      const { data: skus, error } = await sb
        .from('skus')
        .select('*, courses(id, name, group_name)')
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

  // Build unique programs by group_name — one card per program, sorted by sort_order
  const courseMap = {}
  rows.forEach(function (sku) {
    const c = sku.courses
    if (!c) return
    const key = c.group_name || c.name
    if (!courseMap[key]) {
      courseMap[key] = { ...c, groupName: key, skuCount: 0, minSort: sku.sort_order ?? 9999 }
    }
    courseMap[key].skuCount++
    if ((sku.sort_order ?? 9999) < courseMap[key].minSort) {
      courseMap[key].minSort = sku.sort_order ?? 9999
    }
  })
  const courseCards = Object.values(courseMap).sort(function (a, b) { return a.minSort - b.minSort })

  // Split cards into rows so we can inject the levels panel right after the active row
  const cardRows = []
  for (var i = 0; i < courseCards.length; i += colCount) {
    cardRows.push(courseCards.slice(i, i + colCount))
  }

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

  // ── price columns visible to each role ────────────────────────────────────────
  function getPriceCols() {
    if (admin) return [
      { field: 'uf_rate',     label: 'UF Rate' },
      { field: 'cf_rate',     label: 'CF Rate' },
      { field: 'smf_rate',    label: 'SMF Rate' },
      { field: 'student_fee', label: 'Student Fee' },
    ]
    if (currentRole === 'smf') return [
      { field: 'smf_rate', label: 'My Rate (SMF)' },
      { field: 'cf_rate',  label: 'CF Rate' },
    ]
    if (currentRole === 'cf') return [
      { field: 'cf_rate', label: 'My Rate (CF)' },
      { field: 'uf_rate', label: 'UF Rate' },
    ]
    if (currentRole === 'student') return [
      { field: 'student_fee', label: 'Course Fee' },
    ]
    // UF (default)
    return [
      { field: 'uf_rate',     label: 'Kit Rate' },
      { field: 'student_fee', label: 'Student Fee' },
    ]
  }

  function renderLevelsPanel(groupName) {
    const idx = courseCards.findIndex(function (c) { return c.groupName === groupName })
    const tone = ((idx >= 0 ? idx : 0) % 8) + 1
    const tones = TONE_BG[tone]
    const levelSkus = rows.filter(function (s) {
      return (s.courses?.group_name || s.courses?.name) === groupName
    })
    const priceCols = getPriceCols()
    return (
      <div className="progs-levels" style={{ borderTop: '3px solid ' + tones.color }}>
        <div className="progs-levels-h">
          <div className="progs-levels-title">
            <span style={{ background: tones.bg, color: tones.color, borderRadius: 10, padding: '4px 10px', font: '700 11px var(--mono)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
              {groupName}
            </span>
            <span style={{ font: '500 12px var(--font)', color: 'var(--text2)' }}>{levelSkus.length} level{levelSkus.length !== 1 ? 's' : ''}</span>
          </div>
          <button className="progs-levels-close" onClick={function () { setExpandedProgram(null) }}>✕ Close</button>
        </div>
        <div className="tbl-scroll">
          <table className="big-tbl">
            <thead>
              <tr>
                <th style={{ width: 32 }}>#</th>
                <th>Level / SKU</th>
                {priceCols.map(function (col) {
                  return <th key={col.field} style={{ textAlign: 'right' }}>{col.label}</th>
                })}
              </tr>
            </thead>
            <tbody>
              {levelSkus.map(function (sku, i) {
                return (
                  <tr key={sku.id}>
                    <td style={{ font: '600 10px var(--mono)', color: 'var(--text3)' }}>{String(i + 1).padStart(2, '0')}</td>
                    <td>
                      <div style={{ font: '600 13px var(--font)', color: 'var(--text)' }}>{sku.level_name || '—'}</div>
                      <div style={{ font: '500 10px var(--mono)', color: 'var(--text3)', marginTop: 2, textTransform: 'uppercase', letterSpacing: '.04em' }}>{sku.id.slice(0, 8).toUpperCase()}</div>
                    </td>
                    {priceCols.map(function (col) {
                      const val = sku[col.field]
                      return (
                        <td key={col.field} style={{ textAlign: 'right' }} className="mono">
                          {val != null ? '₹' + fmtAmt(val) : '—'}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {cardRows.map(function (rowCards, rowIdx) {
              const rowHasActive = rowCards.some(function (c) { return c.groupName === expandedProgram })
              return (
                <React.Fragment key={rowIdx}>
                  {/* Card row — same column count as the CSS grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(' + colCount + ', 1fr)', gap: 14 }}>
                    {rowCards.map(function (c) {
                      const globalIdx = courseCards.indexOf(c)
                      const tone = (globalIdx % 8) + 1
                      const tones = TONE_BG[tone]
                      const em = PROGRAM_EMOJIS[globalIdx % PROGRAM_EMOJIS.length]
                      const isOpen = expandedProgram === c.groupName
                      return (
                        <div
                          key={c.groupName}
                          className={'progs-card' + (isOpen ? ' active' : '')}
                          onClick={function () { setExpandedProgram(isOpen ? null : c.groupName) }}
                        >
                          <div className="progs-bgbar" style={{ background: TONE_GRADIENT[tone] }}></div>
                          <span className="progs-active"><span className="d"></span>Active</span>
                          <div className="progs-em pe-" style={{ background: tones.bg, color: tones.color, marginTop: 18 }}>{em}</div>
                          <div className="progs-name">{c.groupName}</div>
                          <div className="progs-ages" style={{ marginTop: 4 }}>{c.skuCount} level{c.skuCount !== 1 ? 's' : ''}</div>
                          <div className="progs-meta">
                            <div className="progs-meta-i">
                              <div className="progs-meta-num">{c.skuCount}</div>
                              <div className="progs-meta-lbl">SKUs</div>
                            </div>
                            <div style={{ alignSelf: 'center', font: '600 10px var(--mono)', color: isOpen ? 'var(--purple)' : 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em' }}>
                              {isOpen ? '▲ Hide' : '▼ Levels'}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  {/* Levels panel — injected immediately after the row that has the active card */}
                  {rowHasActive && renderLevelsPanel(expandedProgram)}
                </React.Fragment>
              )
            })}
          </div>
        )}

        {/* SKU table below cards if search active */}
        {search && filtered.length > 0 && (
          <div className="card tbl-scroll" style={{ marginTop: 14 }}>
            <div className="card-h">
              <div className="card-t">Search results</div>
            </div>
            <table className="big-tbl">
              <thead>
                <tr>
                  <th>Program</th>
                  <th>Level / SKU</th>
                  {getPriceCols().map(function (col) {
                    return <th key={col.field} style={{ textAlign: 'right' }}>{col.label}</th>
                  })}
                </tr>
              </thead>
              <tbody>
                {filtered.map(function (sku) {
                  return (
                    <tr key={sku.id}>
                      <td style={{ font: '500 12px var(--mono)', color: 'var(--text2)' }}>{sku.courses?.group_name || sku.courses?.name || '—'}</td>
                      <td>{sku.level_name || '—'}</td>
                      {getPriceCols().map(function (col) {
                        const val = sku[col.field]
                        return (
                          <td key={col.field} style={{ textAlign: 'right' }} className="mono">
                            {val != null ? '₹' + fmtAmt(val) : '—'}
                          </td>
                        )
                      })}
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
