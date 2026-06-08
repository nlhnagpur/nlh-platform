import { useState, useEffect, useRef, useCallback } from 'react'
import { sb } from '../supabase'
import { useAuth } from '../context/AuthContext'
import { isAdminRole } from '../constants/roles'
import { showToast } from '../utils'

// ── Internal chat between Head Office (any admin) and each franchisee.
// One thread per franchisee. HO sees every thread in an inbox; a franchisee
// sees only their own conversation with HO. Auto-refreshes every few seconds.

const POLL_MS = 5000

function fmtTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function dayLabel(ts) {
  const d = new Date(ts)
  const now = new Date()
  const y = new Date(now); y.setDate(now.getDate() - 1)
  if (d.toDateString() === now.toDateString()) return 'Today'
  if (d.toDateString() === y.toDateString()) return 'Yesterday'
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function avColor(seed) {
  const palette = [
    ['#EEF2FF', '#534AB7'], ['#ECFDF5', '#1D7A4F'], ['#FFF7ED', '#8A5200'],
    ['#EFF6FF', '#1A5FA8'], ['#F5F3FF', '#6D28D9'], ['#F0FDFA', '#0F766E'],
  ]
  let h = 0
  const s = seed || '?'
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return palette[h % palette.length]
}

// ── A single conversation (list of bubbles + composer) ────────────────────
function ChatThread({ franchiseeId, messages, peerName, peerSub, onSend, sending }) {
  const [body, setBody] = useState('')
  const scrollRef = useRef(null)
  const endRef = useRef(null)

  useEffect(function () {
    if (endRef.current) endRef.current.scrollIntoView({ block: 'end' })
  }, [messages.length, franchiseeId])

  function submit(e) {
    if (e) e.preventDefault()
    const text = body.trim()
    if (!text || sending) return
    setBody('')
    onSend(text)
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
  }

  // group consecutive messages by day for date separators
  let lastDay = null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '14px 16px', background: 'var(--bg2, #FAFAF8)' }}>
        {messages.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--text3)', fontSize: 13, marginTop: 40 }}>
            No messages yet. Say hello 👋
          </div>
        ) : messages.map(function (m) {
          const d = dayLabel(m.created_at)
          const showDay = d !== lastDay
          lastDay = d
          return (
            <div key={m.id}>
              {showDay && (
                <div style={{ textAlign: 'center', margin: '10px 0' }}>
                  <span style={{ font: '600 10px var(--font)', color: 'var(--text3)', background: 'var(--bg4, #EFEEE9)', padding: '2px 10px', borderRadius: 20 }}>{d}</span>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: m._mine ? 'flex-end' : 'flex-start', marginBottom: 6 }}>
                <div style={{
                  maxWidth: '74%', padding: '8px 12px', borderRadius: 14,
                  borderBottomRightRadius: m._mine ? 4 : 14,
                  borderBottomLeftRadius: m._mine ? 14 : 4,
                  background: m._mine ? 'var(--purple, #534AB7)' : '#fff',
                  color: m._mine ? '#fff' : 'var(--text)',
                  border: m._mine ? 'none' : '1px solid var(--border, #E5E3DC)',
                  boxShadow: '0 1px 1px rgba(0,0,0,0.03)',
                }}>
                  {!m._mine && m.sender_name && (
                    <div style={{ font: '700 10px var(--font)', color: 'var(--purple)', marginBottom: 2 }}>{m.sender_name}</div>
                  )}
                  <div style={{ font: '500 13px var(--font)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.4 }}>{m.body}</div>
                  <div style={{ font: '500 9px var(--font)', textAlign: 'right', marginTop: 3, opacity: 0.6 }}>{fmtTime(m.created_at)}</div>
                </div>
              </div>
            </div>
          )
        })}
        <div ref={endRef} />
      </div>

      <form onSubmit={submit} style={{ display: 'flex', gap: 8, padding: 12, borderTop: '1px solid var(--border)', background: '#fff' }}>
        <textarea
          value={body}
          onChange={function (e) { setBody(e.target.value) }}
          onKeyDown={onKeyDown}
          placeholder={'Message ' + (peerName || '') + '…'}
          rows={1}
          style={{ flex: 1, resize: 'none', maxHeight: 120, font: '500 13px var(--font)', padding: '9px 12px', borderRadius: 10, border: '1px solid var(--border)' }}
        />
        <button type="submit" className="btn-p" disabled={sending || !body.trim()} style={{ alignSelf: 'flex-end', whiteSpace: 'nowrap' }}>
          {sending ? '…' : 'Send'}
        </button>
      </form>
    </div>
  )
}

export default function MessagesPage() {
  const { currentRole, currentFranchiseeId, currentUser } = useAuth()
  const isHO = isAdminRole(currentRole)

  const [franchisees, setFranchisees] = useState([])
  const [messages, setMessages]       = useState([])
  const [activeId, setActiveId]       = useState(isHO ? null : currentFranchiseeId)
  const [loading, setLoading]         = useState(true)
  const [search, setSearch]           = useState('')
  const [sending, setSending]         = useState(false)
  const activeIdRef = useRef(activeId)
  activeIdRef.current = activeId

  const senderName = (currentUser && (currentUser.user_metadata?.full_name || currentUser.email)) || 'NLH'

  // ── Load franchisee directory (HO only) ──
  useEffect(function () {
    if (!isHO) return
    sb.from('franchisees')
      .select('id, business_name, owner_name, tier, city, email')
      .order('business_name', { ascending: true })
      .then(function (res) { setFranchisees(res.data || []) })
  }, [isHO])

  // ── Load messages (scoped automatically by RLS) ──
  const loadMessages = useCallback(async function () {
    let q = sb.from('messages').select('*').order('created_at', { ascending: true }).limit(3000)
    if (!isHO) q = q.eq('franchisee_id', currentFranchiseeId)
    const { data, error } = await q
    if (!error) setMessages(data || [])
    setLoading(false)
  }, [isHO, currentFranchiseeId])

  useEffect(function () {
    loadMessages()
    const t = setInterval(loadMessages, POLL_MS)
    return function () { clearInterval(t) }
  }, [loadMessages])

  // ── Mark the open thread as read ──
  const markRead = useCallback(async function (fid) {
    if (!fid) return
    const col = isHO ? 'read_by_ho' : 'read_by_franchisee'
    const fromHoWanted = !isHO // franchisee reads HO messages; HO reads franchisee messages
    await sb.from('messages').update({ [col]: true })
      .eq('franchisee_id', fid).eq('from_ho', fromHoWanted).eq(col, false)
  }, [isHO])

  useEffect(function () {
    if (activeId) markRead(activeId)
  }, [activeId, messages.length, markRead])

  // ── Send ──
  async function handleSend(text) {
    const fid = activeIdRef.current
    if (!fid) return
    setSending(true)
    const row = {
      franchisee_id: fid,
      sender_id: currentUser?.id || null,
      sender_name: senderName,
      from_ho: isHO,
      body: text,
      read_by_ho: isHO,
      read_by_franchisee: !isHO,
    }
    const { data, error } = await sb.from('messages').insert(row).select().single()
    setSending(false)
    if (error) { showToast('Could not send: ' + error.message, 'err'); return }
    setMessages(function (prev) { return prev.concat(data) })
  }

  // messages for the active thread, tagged with _mine for bubble alignment
  const threadMsgs = messages
    .filter(function (m) { return m.franchisee_id === activeId })
    .map(function (m) { return Object.assign({}, m, { _mine: isHO ? m.from_ho : !m.from_ho }) })

  // ── Franchisee (single-thread) view ──
  if (!isHO) {
    if (!currentFranchiseeId) {
      return (
        <div className="pg"><div className="content"><div className="empty">No franchise linked to your account yet. Contact Head Office.</div></div></div>
      )
    }
    return (
      <div className="pg">
        <header className="tb">
          <div className="crumb">Communication <span className="sep">›</span> <b>Head Office chat</b></div>
        </header>
        <div className="content" style={{ paddingTop: 12 }}>
          <div className="card" style={{ padding: 0, overflow: 'hidden', height: 'calc(100vh - 150px)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: '1px solid var(--border)', background: '#fff' }}>
              <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'var(--purple)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', font: '700 15px var(--font)' }}>HO</div>
              <div>
                <div style={{ font: '700 14px var(--font)', color: 'var(--text)' }}>New Learning Horizons — Head Office</div>
                <div style={{ font: '500 11px var(--font)', color: 'var(--text3)' }}>Typically replies within a day · {threadMsgs.length} messages</div>
              </div>
            </div>
            {loading ? (
              <div className="loading" style={{ margin: 'auto' }}><span className="spinner" />Loading…</div>
            ) : (
              <ChatThread franchiseeId={currentFranchiseeId} messages={threadMsgs} peerName="Head Office" onSend={handleSend} sending={sending} />
            )}
          </div>
        </div>
      </div>
    )
  }

  // ── HO (inbox) view ──
  // Build thread summaries from the franchisee directory + message activity.
  const byFr = {}
  messages.forEach(function (m) {
    const a = byFr[m.franchisee_id] || (byFr[m.franchisee_id] = { last: null, unread: 0 })
    if (!a.last || new Date(m.created_at) > new Date(a.last.created_at)) a.last = m
    if (!m.from_ho && !m.read_by_ho) a.unread++
  })

  const q = search.trim().toLowerCase()
  const threads = franchisees
    .map(function (f) {
      const a = byFr[f.id] || { last: null, unread: 0 }
      return { f: f, last: a.last, unread: a.unread }
    })
    .filter(function (t) {
      if (!q) return true
      return (t.f.business_name || '').toLowerCase().includes(q) ||
             (t.f.owner_name || '').toLowerCase().includes(q) ||
             (t.f.city || '').toLowerCase().includes(q)
    })
    .sort(function (a, b) {
      if (a.unread !== b.unread) return b.unread - a.unread
      const at = a.last ? new Date(a.last.created_at).getTime() : 0
      const bt = b.last ? new Date(b.last.created_at).getTime() : 0
      if (at !== bt) return bt - at
      return (a.f.business_name || '').localeCompare(b.f.business_name || '')
    })

  const totalUnread = threads.reduce(function (s, t) { return s + t.unread }, 0)
  const activeFr = franchisees.find(function (f) { return f.id === activeId })

  return (
    <div className="pg">
      <header className="tb">
        <div className="crumb">Communication <span className="sep">›</span> <b>Franchisee chat</b>{totalUnread > 0 && <span style={{ marginLeft: 8, font: '700 11px var(--font)', color: '#fff', background: 'var(--red, #dc2626)', borderRadius: 20, padding: '1px 8px' }}>{totalUnread} new</span>}</div>
      </header>

      <div className="content" style={{ paddingTop: 12 }}>
        <div className="card" style={{ padding: 0, overflow: 'hidden', height: 'calc(100vh - 150px)', display: 'flex' }}>

          {/* Thread list */}
          <div style={{ width: 300, minWidth: 240, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', background: '#fff' }}>
            <div style={{ padding: 10, borderBottom: '1px solid var(--border)' }}>
              <input className="search" placeholder="Search franchisee…" value={search}
                onChange={function (e) { setSearch(e.target.value) }} style={{ width: '100%', fontSize: 13 }} />
            </div>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {threads.length === 0 ? (
                <div className="empty" style={{ margin: 16, fontSize: 13 }}>No franchisees.</div>
              ) : threads.map(function (t) {
                const f = t.f
                const name = f.business_name || f.owner_name || 'Franchisee'
                const [bg, col] = avColor(name)
                const active = f.id === activeId
                return (
                  <div key={f.id} onClick={function () { setActiveId(f.id) }}
                    style={{ display: 'flex', gap: 10, padding: '10px 12px', cursor: 'pointer', borderBottom: '1px solid var(--bg4, #F1F0EC)', background: active ? 'var(--bg2, #F5F4F0)' : 'transparent' }}>
                    <div style={{ width: 36, height: 36, borderRadius: '50%', background: bg, color: col, display: 'flex', alignItems: 'center', justifyContent: 'center', font: '700 13px var(--font)', flexShrink: 0 }}>
                      {name.slice(0, 1).toUpperCase()}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                        <span style={{ font: '700 13px var(--font)', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                        {t.last && <span style={{ font: '500 9px var(--font)', color: 'var(--text3)', whiteSpace: 'nowrap' }}>{fmtTime(t.last.created_at)}</span>}
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, alignItems: 'center' }}>
                        <span style={{ font: '500 11px var(--font)', color: 'var(--text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                          {t.last ? (t.last.from_ho ? 'You: ' : '') + t.last.body : (f.tier || '') + (f.city ? ' · ' + f.city : '')}
                        </span>
                        {t.unread > 0 && <span style={{ font: '700 10px var(--font)', color: '#fff', background: 'var(--green, #1D7A4F)', borderRadius: 20, padding: '0 7px', minWidth: 18, textAlign: 'center' }}>{t.unread}</span>}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Conversation */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            {!activeFr ? (
              <div style={{ margin: 'auto', textAlign: 'center', color: 'var(--text3)', padding: 24 }}>
                <div style={{ fontSize: 34, marginBottom: 8 }}>💬</div>
                <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text2)' }}>Select a franchisee</div>
                <div style={{ fontSize: 12, marginTop: 4 }}>Pick a conversation on the left, or search to start a new one.</div>
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: '1px solid var(--border)', background: '#fff' }}>
                  {(function () {
                    const name = activeFr.business_name || activeFr.owner_name || 'Franchisee'
                    const [bg, col] = avColor(name)
                    return <div style={{ width: 38, height: 38, borderRadius: '50%', background: bg, color: col, display: 'flex', alignItems: 'center', justifyContent: 'center', font: '700 15px var(--font)' }}>{name.slice(0, 1).toUpperCase()}</div>
                  })()}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ font: '700 14px var(--font)', color: 'var(--text)' }}>{activeFr.business_name || activeFr.owner_name}</div>
                    <div style={{ font: '500 11px var(--font)', color: 'var(--text3)' }}>
                      {[activeFr.tier, activeFr.city, activeFr.email].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                </div>
                <ChatThread franchiseeId={activeId} messages={threadMsgs} peerName={activeFr.business_name || 'franchisee'} onSend={handleSend} sending={sending} />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
