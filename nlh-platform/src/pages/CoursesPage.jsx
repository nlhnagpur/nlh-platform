import React, { useState, useEffect, useCallback } from 'react'
import { sb } from '../supabase'
import { useAuth } from '../context/AuthContext'
import { fmtAmt, showToast } from '../utils'
import { isAdminRole, isManagerOrAbove } from '../constants/roles'

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
  const canEdit = isManagerOrAbove(currentRole)

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [expandedProgram, setExpandedProgram] = useState(null)
  const [colCount, setColCount] = useState(getColCount)

  // Catalog-edit modal state (manager and above)
  const [levelModal,  setLevelModal]  = useState(null)  // { mode:'add'|'edit', groupName, course, sku }
  const [renameModal, setRenameModal] = useState(null)  // { groupName }
  const [busyId,      setBusyId]      = useState(null)   // sku id mid-mutation
  const [confirmDel,  setConfirmDel]  = useState(null)   // sku id pending delete confirm

  // Keep colCount in sync with viewport so the row-grouping stays accurate
  useEffect(function () {
    function onResize() { setColCount(getColCount()) }
    window.addEventListener('resize', onResize)
    return function () { window.removeEventListener('resize', onResize) }
  }, [])

  const load = useCallback(async function () {
    setLoading(true)

    // Load all SKUs with course info — order by sort_order which encodes program+level sequence
    const { data: skus, error } = await sb
      .from('skus')
      .select('*, courses(id, name, group_name, billing_type, age_min, age_max, description, is_active, sort_order)')
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
  }, [admin, currentFranchiseeId])

  useEffect(() => {
    if (currentRole === null) return   // wait for auth to resolve
    load()
  }, [currentRole, load])

  // ── Catalog mutations (manager and above) ─────────────────────────────────────

  // Delete a level (course + its SKU). Blocked if any student is enrolled.
  async function deleteLevel(sku) {
    const courseId = sku.course_id
    setBusyId(sku.id)
    try {
      const { count } = await sb.from('enrollments')
        .select('*', { count: 'exact', head: true })
        .eq('sku_id', sku.id)
      if (count && count > 0) {
        showToast('Cannot delete — ' + count + ' student(s) enrolled. Deactivate it instead.', 'warn')
        return
      }
      const { error: e1 } = await sb.from('skus').delete().eq('id', sku.id)
      if (e1) {
        const inUse = e1.code === '23503' || /foreign key/i.test(e1.message || '')
        showToast(inUse
          ? 'Cannot delete — this level is referenced by existing records. Deactivate it instead.'
          : 'Delete failed: ' + e1.message, 'warn')
        return
      }
      await sb.from('courses').delete().eq('id', courseId)
      showToast('Level deleted ✓')
      await load()
    } finally {
      setBusyId(null)
    }
  }

  // Toggle a single level (course + sku) active/inactive
  async function toggleLevelActive(sku) {
    const next = !(sku.is_active !== false && sku.courses?.is_active !== false)
    setBusyId(sku.id)
    try {
      await sb.from('skus').update({ is_active: next }).eq('id', sku.id)
      await sb.from('courses').update({ is_active: next }).eq('id', sku.course_id)
      showToast(next ? 'Level activated ✓' : 'Level deactivated ✓')
      await load()
    } finally {
      setBusyId(null)
    }
  }

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
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {canEdit && (
              <>
                <button className="btn" style={{ fontSize: 11 }}
                  onClick={function () { setRenameModal({ groupName: groupName }) }}>✏ Rename</button>
                <button className="btn-s" style={{ fontSize: 11 }}
                  onClick={function () {
                    setLevelModal({ mode: 'add', groupName: groupName, course: null, sku: null, newProgram: false })
                  }}>+ Add Level</button>
              </>
            )}
            <button className="progs-levels-close" onClick={function () { setExpandedProgram(null) }}>✕ Close</button>
          </div>
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
                {canEdit && <th style={{ textAlign: 'right', width: 200 }}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {levelSkus.map(function (sku, i) {
                const inactive = sku.is_active === false || sku.courses?.is_active === false
                return (
                  <tr key={sku.id} style={inactive ? { opacity: 0.5 } : null}>
                    <td style={{ font: '600 10px var(--mono)', color: 'var(--text3)' }}>{String(i + 1).padStart(2, '0')}</td>
                    <td>
                      <div style={{ font: '600 13px var(--font)', color: 'var(--text)' }}>
                        {sku.level_name || '—'}
                        {inactive && <span style={{ marginLeft: 6, font: '600 9px var(--font)', color: 'var(--text3)', border: '1px solid var(--border)', borderRadius: 10, padding: '1px 6px' }}>INACTIVE</span>}
                      </div>
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
                    {canEdit && (
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <button className="btn" style={{ fontSize: 10, padding: '2px 7px' }}
                          disabled={busyId === sku.id}
                          onClick={function () { setLevelModal({ mode: 'edit', groupName: groupName, course: sku.courses, sku: sku, newProgram: false }) }}>
                          Edit
                        </button>
                        <button className="btn" style={{ fontSize: 10, padding: '2px 7px', marginLeft: 4 }}
                          disabled={busyId === sku.id}
                          onClick={function () { toggleLevelActive(sku) }}>
                          {inactive ? 'Activate' : 'Deactivate'}
                        </button>
                        {confirmDel === sku.id ? (
                          <>
                            <button className="btn" style={{ fontSize: 10, padding: '2px 7px', marginLeft: 4, background: '#dc2626', borderColor: '#dc2626', color: '#fff' }}
                              disabled={busyId === sku.id}
                              onClick={function () { setConfirmDel(null); deleteLevel(sku) }}>
                              {busyId === sku.id ? '…' : 'Confirm'}
                            </button>
                            <button className="btn" style={{ fontSize: 10, padding: '2px 7px', marginLeft: 4 }}
                              onClick={function () { setConfirmDel(null) }}>✕</button>
                          </>
                        ) : (
                          <button className="btn" style={{ fontSize: 10, padding: '2px 7px', marginLeft: 4, color: 'var(--red, #dc2626)', borderColor: 'var(--red, #dc2626)' }}
                            disabled={busyId === sku.id}
                            onClick={function () { setConfirmDel(sku.id) }}>
                            Delete
                          </button>
                        )}
                      </td>
                    )}
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
          {canEdit && (
            <button
              className="btn-p"
              style={{ fontSize: 13, alignSelf: 'center' }}
              onClick={function () {
                setLevelModal({ mode: 'add', groupName: '', course: null, sku: null, newProgram: true })
              }}>
              + New Program
            </button>
          )}
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

      {levelModal && (
        <LevelModal
          spec={levelModal}
          existingGroups={Array.from(new Set(rows.map(function (s) { return s.courses?.group_name || s.courses?.name }).filter(Boolean)))}
          onClose={function () { setLevelModal(null) }}
          onSaved={function () { setLevelModal(null); load() }}
        />
      )}

      {renameModal && (
        <RenameProgramModal
          groupName={renameModal.groupName}
          onClose={function () { setRenameModal(null) }}
          onSaved={function (newName) {
            setRenameModal(null)
            if (expandedProgram === renameModal.groupName) setExpandedProgram(newName)
            load()
          }}
        />
      )}
    </div>
  )
}

// ── LevelModal — add/edit a level (one course row + its SKU) ────────────────────
function LevelModal({ spec, existingGroups, onClose, onSaved }) {
  const isEdit = spec.mode === 'edit'
  const course = spec.course || {}
  const sku    = spec.sku || {}

  const [f, setF] = useState({
    group_name:   spec.newProgram ? '' : (spec.groupName || ''),
    level_name:   sku.level_name || course.name || '',
    billing_type: course.billing_type || 'session',
    age_min:      course.age_min ?? '',
    age_max:      course.age_max ?? '',
    age_range:    sku.age_range || '',
    total_sessions: sku.total_sessions ?? '',
    sessions:     sku.sessions || '',
    uf_rate:      sku.uf_rate ?? '',
    cf_rate:      sku.cf_rate ?? '',
    smf_rate:     sku.smf_rate ?? '',
    student_fee:  sku.student_fee ?? '',
    min_qty:      sku.min_qty ?? 1,
    uf_share:     sku.uf_share ?? 0,
    warehouse_qty: sku.warehouse_qty ?? 0,
    sort_order:   sku.sort_order ?? course.sort_order ?? '',
  })
  const [saving, setSaving] = useState(false)

  function set(k) { return function (e) { const v = e.target.value; setF(function (p) { return { ...p, [k]: v } }) } }
  function numOrNull(v) { return v === '' || v == null ? null : Number(v) }
  function intOr(v, dflt) { return v === '' || v == null ? dflt : Number(v) }

  async function save() {
    if (!f.group_name.trim()) { showToast('Program name is required', 'warn'); return }
    if (!f.level_name.trim()) { showToast('Level name is required', 'warn'); return }
    setSaving(true)
    try {
      const coursePayload = {
        group_name:   f.group_name.trim(),
        name:         f.level_name.trim(),
        billing_type: f.billing_type || 'session',
        age_min:      numOrNull(f.age_min),
        age_max:      numOrNull(f.age_max),
        sort_order:   numOrNull(f.sort_order),
        is_active:    true,
      }
      const skuPayload = {
        level_name:    f.level_name.trim(),
        age_range:     f.age_range.trim() || null,
        total_sessions: numOrNull(f.total_sessions),
        sessions:      f.sessions.trim() || null,
        uf_rate:       intOr(f.uf_rate, 0),
        cf_rate:       intOr(f.cf_rate, 0),
        smf_rate:      intOr(f.smf_rate, 0),
        student_fee:   intOr(f.student_fee, 0),
        min_qty:       intOr(f.min_qty, 1),
        uf_share:      intOr(f.uf_share, 0),
        warehouse_qty: intOr(f.warehouse_qty, 0),
        sort_order:    numOrNull(f.sort_order),
        is_active:     true,
      }

      if (isEdit) {
        const { error: e1 } = await sb.from('courses').update(coursePayload).eq('id', course.id)
        if (e1) { showToast('Save failed: ' + e1.message, 'err'); setSaving(false); return }
        const { error: e2 } = await sb.from('skus').update(skuPayload).eq('id', sku.id)
        if (e2) { showToast('Save failed: ' + e2.message, 'err'); setSaving(false); return }
        showToast('Level updated ✓')
      } else {
        const { data: newCourse, error: e1 } = await sb.from('courses').insert(coursePayload).select('id').single()
        if (e1) { showToast('Create failed: ' + e1.message, 'err'); setSaving(false); return }
        const { error: e2 } = await sb.from('skus').insert({ ...skuPayload, course_id: newCourse.id })
        if (e2) {
          await sb.from('courses').delete().eq('id', newCourse.id)  // rollback orphan course
          showToast('Create failed: ' + e2.message, 'err'); setSaving(false); return
        }
        showToast(spec.newProgram ? 'Program created ✓' : 'Level added ✓')
      }
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-bg" onClick={function (e) { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ maxWidth: 560, width: '94vw' }}>
        <div className="ch">
          <div style={{ fontWeight: 700, fontSize: 14 }}>
            {isEdit ? 'Edit Level' : spec.newProgram ? 'New Program' : 'Add Level — ' + spec.groupName}
          </div>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>
        <div style={{ padding: '4px 20px 16px', maxHeight: '70vh', overflowY: 'auto' }}>
          <div className="form-grid">
            <label className={spec.newProgram ? '' : 'col-span-2'}>Program{spec.newProgram ? ' name' : ''}
              {spec.newProgram
                ? <input value={f.group_name} onChange={set('group_name')} placeholder="e.g. Robotics" list="existing-groups" />
                : <input value={f.group_name} disabled />}
              <datalist id="existing-groups">
                {existingGroups.map(function (g) { return <option key={g} value={g} /> })}
              </datalist>
            </label>
            {spec.newProgram && <div />}
            <label className="col-span-2">Level name *
              <input value={f.level_name} onChange={set('level_name')} placeholder="e.g. Level 1 / Junior / Basic" />
            </label>
            <label>Billing type
              <select value={f.billing_type} onChange={set('billing_type')}>
                <option value="session">Per session / kit</option>
                <option value="monthly">Monthly</option>
                <option value="one_time">One-time</option>
              </select>
            </label>
            <label>Total sessions
              <input type="number" value={f.total_sessions} onChange={set('total_sessions')} placeholder="e.g. 24" />
            </label>
            <label>Age min
              <input type="number" value={f.age_min} onChange={set('age_min')} placeholder="e.g. 5" />
            </label>
            <label>Age max
              <input type="number" value={f.age_max} onChange={set('age_max')} placeholder="e.g. 14" />
            </label>
            <label>UF rate (₹)
              <input type="number" value={f.uf_rate} onChange={set('uf_rate')} />
            </label>
            <label>CF rate (₹)
              <input type="number" value={f.cf_rate} onChange={set('cf_rate')} />
            </label>
            <label>SMF rate (₹)
              <input type="number" value={f.smf_rate} onChange={set('smf_rate')} />
            </label>
            <label>Student fee (₹)
              <input type="number" value={f.student_fee} onChange={set('student_fee')} />
            </label>
            <label>Min qty
              <input type="number" value={f.min_qty} onChange={set('min_qty')} />
            </label>
            <label>Sort order
              <input type="number" value={f.sort_order} onChange={set('sort_order')} placeholder="catalogue order" />
            </label>
          </div>
          <p className="hint" style={{ marginTop: 8 }}>
            Rates are stored as whole rupees. A level maps to one course row and one SKU.
          </p>
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn-p" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : isEdit ? 'Save Level' : spec.newProgram ? 'Create Program' : 'Add Level'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── RenameProgramModal — rename a group_name across all its course rows ──────────
function RenameProgramModal({ groupName, onClose, onSaved }) {
  const [name, setName] = useState(groupName)
  const [saving, setSaving] = useState(false)

  async function save() {
    const next = name.trim()
    if (!next) { showToast('Program name is required', 'warn'); return }
    if (next === groupName) { onClose(); return }
    setSaving(true)
    const { error } = await sb.from('courses').update({ group_name: next }).eq('group_name', groupName)
    setSaving(false)
    if (error) { showToast('Rename failed: ' + error.message, 'err'); return }
    showToast('Program renamed ✓')
    onSaved(next)
  }

  return (
    <div className="modal-bg" onClick={function (e) { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ maxWidth: 380 }}>
        <div className="ch">
          <div style={{ fontWeight: 700, fontSize: 14 }}>Rename Program</div>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>
        <div style={{ padding: '4px 20px 16px' }}>
          <label style={{ font: '600 12px var(--font)', color: 'var(--text2)' }}>Program name
            <input value={name} onChange={function (e) { setName(e.target.value) }} style={{ marginTop: 6 }} />
          </label>
          <p className="hint" style={{ marginTop: 8 }}>Applies to all levels under this program.</p>
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn-p" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Rename'}</button>
        </div>
      </div>
    </div>
  )
}
