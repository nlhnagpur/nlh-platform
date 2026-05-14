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
        .order('level')

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
      s.name?.toLowerCase().includes(q) ||
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

  return (
    <div className="pg">
      <div className="topbar">
        <h1>Courses &amp; SKUs</h1>
        <div style={{display:"flex",gap:8}}>
          <input
            className="search-inp"
            placeholder="Search course / group / level…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {loading ? (
        <div className="loading">Loading courses…</div>
      ) : filtered.length === 0 ? (
        <div className="empty" style={{ padding: 32 }}>
          {search ? 'No courses match your search.' : 'No courses available.'}
        </div>
      ) : (
        <table className="data-table courses-table">
          <thead>
            <tr>
              <th>Course</th>
              <th>Group</th>
              <th>Level / SKU</th>
              <th>UF Rate (Kit)</th>
              <th>Student Fee</th>
              <th>Sessions</th>
            </tr>
          </thead>
          <tbody>
            {annotated.map(({ sku, isFirst, courseRowSpan }) => (
              <tr key={sku.id} className={isFirst ? 'course-first-row' : 'course-cont-row'}>
                {isFirst ? (
                  <td rowSpan={courseRowSpan} className="course-name-cell">
                    <strong>{sku.courses?.name || '—'}</strong>
                  </td>
                ) : null}
                {isFirst ? (
                  <td rowSpan={courseRowSpan} className="course-group-cell">
                    <span className="tag">{sku.courses?.group_name || '—'}</span>
                  </td>
                ) : null}
                <td className="sku-name-cell">{sku.name || '—'}</td>
                <td>
                  {sku.uf_rate != null
                    ? <span className="mono">₹{fmtAmt(sku.uf_rate)}</span>
                    : <span className="hint">—</span>
                  }
                </td>
                <td>
                  {sku.student_fee != null
                    ? <span className="mono">₹{fmtAmt(sku.student_fee)}</span>
                    : <span className="hint">—</span>
                  }
                </td>
                <td>
                  {sku.sessions != null
                    ? sku.sessions
                    : <span className="hint">—</span>
                  }
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
