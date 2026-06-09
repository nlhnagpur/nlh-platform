import { useState, useEffect, useRef, useCallback } from 'react'
import { sb } from '../supabase'
import { useAuth } from '../context/AuthContext'
import { isAdminRole, isManagerOrAbove } from '../constants/roles'
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

function humanSize(b) {
  if (!b && b !== 0) return ''
  if (b < 1024) return b + ' B'
  if (b < 1024 * 1024) return (b / 1024).toFixed(0) + ' KB'
  return (b / 1024 / 1024).toFixed(1) + ' MB'
}

const MAX_FILE = 15 * 1024 * 1024 // 15 MB

// Upload a file to the chat-attachments bucket; returns attachment metadata.
async function uploadAttachment(file, folder) {
  const ext  = (file.name.split('.').pop() || '').toLowerCase()
  const rand = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()))
  const path = (folder || 'misc') + '/' + rand + (ext ? '.' + ext : '')
  const { error } = await sb.storage.from('chat-attachments').upload(path, file, {
    contentType: file.type || 'application/octet-stream', upsert: false,
  })
  if (error) throw error
  const { data } = sb.storage.from('chat-attachments').getPublicUrl(path)
  return { url: data.publicUrl, name: file.name, type: file.type || '', size: file.size }
}

function isImageType(t) { return /^image\//.test(t || '') }

// Renders an attachment inside a message bubble.
function AttachmentView({ m, mine }) {
  if (!m.attachment_url) return null
  const img = isImageType(m.attachment_type)
  if (img) {
    return (
      <a href={m.attachment_url} target="_blank" rel="noreferrer" style={{ display: 'block', marginTop: m.body ? 6 : 0 }}>
        <img src={m.attachment_url} alt={m.attachment_name || 'image'}
          style={{ maxWidth: '100%', maxHeight: 240, borderRadius: 10, display: 'block' }} />
      </a>
    )
  }
  return (
    <a href={m.attachment_url} target="_blank" rel="noreferrer" download={m.attachment_name}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, marginTop: m.body ? 6 : 0,
        padding: '8px 10px', borderRadius: 10, textDecoration: 'none',
        background: mine ? 'rgba(255,255,255,.16)' : 'var(--bg2, #F5F4F0)',
        border: '1px solid ' + (mine ? 'rgba(255,255,255,.25)' : 'var(--border)'),
        color: mine ? '#fff' : 'var(--text)',
      }}>
      <span style={{ fontSize: 20, flexShrink: 0 }}>📄</span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', font: '600 12px var(--font)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.attachment_name || 'Attachment'}</span>
        <span style={{ display: 'block', font: '500 10px var(--font)', opacity: .7 }}>{humanSize(m.attachment_size)} · Download</span>
      </span>
    </a>
  )
}

// ── A single conversation (list of bubbles + composer) ────────────────────
function ChatThread({ franchiseeId, messages, peerName, peerSub, onSend, sending }) {
  const [body, setBody] = useState('')
  const [file, setFile] = useState(null)
  const scrollRef = useRef(null)
  const endRef = useRef(null)
  const fileRef = useRef(null)

  useEffect(function () {
    if (endRef.current) endRef.current.scrollIntoView({ block: 'end' })
  }, [messages.length, franchiseeId])

  function pickFile(e) {
    const f = e.target.files && e.target.files[0]
    if (!f) return
    if (f.size > MAX_FILE) { showToast('File too large (max 15 MB)', 'err'); e.target.value = ''; return }
    setFile(f)
  }

  function submit(e) {
    if (e) e.preventDefault()
    const text = body.trim()
    if ((!text && !file) || sending) return
    setBody('')
    const sent = file
    setFile(null)
    if (fileRef.current) fileRef.current.value = ''
    onSend({ body: text, file: sent })
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
                  {m.broadcast_id && (
                    <div style={{ font: '700 9px var(--font)', letterSpacing: '.04em', marginBottom: 3, opacity: .85 }}>📢 BROADCAST</div>
                  )}
                  {m.body && <div style={{ font: '500 13px var(--font)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.4 }}>{m.body}</div>}
                  <AttachmentView m={m} mine={m._mine} />
                  <div style={{ font: '500 9px var(--font)', textAlign: 'right', marginTop: 3, opacity: 0.6 }}>{fmtTime(m.created_at)}</div>
                </div>
              </div>
            </div>
          )
        })}
        <div ref={endRef} />
      </div>

      <div style={{ borderTop: '1px solid var(--border)', background: '#fff' }}>
        {file && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px 0' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px', borderRadius: 8, background: 'var(--bg2, #F5F4F0)', border: '1px solid var(--border)', maxWidth: '100%' }}>
              <span style={{ fontSize: 16 }}>{isImageType(file.type) ? '🖼️' : '📄'}</span>
              <span style={{ font: '600 12px var(--font)', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 }}>{file.name}</span>
              <span style={{ font: '500 10px var(--font)', color: 'var(--text3)' }}>{humanSize(file.size)}</span>
              <span onClick={function () { setFile(null); if (fileRef.current) fileRef.current.value = '' }}
                style={{ cursor: 'pointer', color: 'var(--text3)', fontWeight: 700, marginLeft: 2 }}>✕</span>
            </span>
          </div>
        )}
        <form onSubmit={submit} style={{ display: 'flex', gap: 8, padding: 12, alignItems: 'flex-end' }}>
          <input ref={fileRef} type="file" onChange={pickFile} style={{ display: 'none' }}
            accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.csv,.ppt,.pptx,.txt,.zip" />
          <button type="button" title="Attach file" onClick={function () { fileRef.current && fileRef.current.click() }}
            style={{ flexShrink: 0, width: 38, height: 38, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg2, #F5F4F0)', cursor: 'pointer', fontSize: 17 }}>📎</button>
          <textarea
            value={body}
            onChange={function (e) { setBody(e.target.value) }}
            onKeyDown={onKeyDown}
            placeholder={'Message ' + (peerName || '') + '…'}
            rows={1}
            style={{ flex: 1, resize: 'none', maxHeight: 120, font: '500 13px var(--font)', padding: '9px 12px', borderRadius: 10, border: '1px solid var(--border)' }}
          />
          <button type="submit" className="btn-p" disabled={sending || (!body.trim() && !file)} style={{ whiteSpace: 'nowrap' }}>
            {sending ? '…' : 'Send'}
          </button>
        </form>
      </div>
    </div>
  )
}

// ── Broadcast composer (HO only) ──────────────────────────────────────────
function BroadcastModal({ franchisees, onClose, onSend, sending }) {
  const [body, setBody]   = useState('')
  const [file, setFile]   = useState(null)
  const [search, setSearch] = useState('')
  const [tier, setTier]   = useState('ALL')      // ALL | SMF | CF | UF
  const [picked, setPicked] = useState({})        // id -> true
  const fileRef = useRef(null)

  const pool = franchisees.filter(function (f) {
    if (tier !== 'ALL' && (f.tier || '').toUpperCase() !== tier) return false
    const q = search.trim().toLowerCase()
    if (!q) return true
    return (f.business_name || '').toLowerCase().includes(q) ||
           (f.owner_name || '').toLowerCase().includes(q) ||
           (f.city || '').toLowerCase().includes(q)
  })

  const pickedIds = Object.keys(picked).filter(function (k) { return picked[k] })
  const allPoolPicked = pool.length > 0 && pool.every(function (f) { return picked[f.id] })

  function toggle(id) {
    setPicked(function (p) { const n = Object.assign({}, p); if (n[id]) delete n[id]; else n[id] = true; return n })
  }
  function toggleAllPool() {
    setPicked(function (p) {
      const n = Object.assign({}, p)
      if (allPoolPicked) pool.forEach(function (f) { delete n[f.id] })
      else pool.forEach(function (f) { n[f.id] = true })
      return n
    })
  }
  function pickFile(e) {
    const f = e.target.files && e.target.files[0]
    if (!f) return
    if (f.size > MAX_FILE) { showToast('File too large (max 15 MB)', 'err'); e.target.value = ''; return }
    setFile(f)
  }
  function submit() {
    onSend({ body: body, file: file, recipientIds: pickedIds })
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" style={{ width: 640, maxWidth: '96vw' }} onClick={function (e) { e.stopPropagation() }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h3 style={{ margin: 0, font: '800 16px var(--font)' }}>📢 Broadcast to franchisees</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text3)' }}>✕</button>
        </div>

        {/* recipient filters */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
          {['ALL', 'SMF', 'CF', 'UF'].map(function (t) {
            return (
              <button key={t} onClick={function () { setTier(t) }}
                className={'sp' + (tier === t ? ' on on-pend' : '')}
                style={{ fontSize: 12 }}>{t === 'ALL' ? 'All tiers' : t}</button>
            )
          })}
          <input className="search" placeholder="Search…" value={search}
            onChange={function (e) { setSearch(e.target.value) }} style={{ flex: 1, minWidth: 120, fontSize: 13 }} />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 2px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', font: '600 12px var(--font)', color: 'var(--text2)' }}>
            <input type="checkbox" checked={allPoolPicked} onChange={toggleAllPool} />
            Select all shown ({pool.length})
          </label>
          <span style={{ font: '700 12px var(--font)', color: 'var(--purple)' }}>{pickedIds.length} selected</span>
        </div>

        <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 10, marginBottom: 12 }}>
          {pool.length === 0 ? (
            <div style={{ padding: 16, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>No franchisees match.</div>
          ) : pool.map(function (f) {
            const name = f.business_name || f.owner_name || 'Franchisee'
            return (
              <label key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid var(--bg4, #F1F0EC)' }}>
                <input type="checkbox" checked={!!picked[f.id]} onChange={function () { toggle(f.id) }} />
                <span style={{ font: '700 13px var(--font)', color: 'var(--text)' }}>{name}</span>
                <span style={{ font: '600 9px var(--font)', color: 'var(--text3)', background: 'var(--bg4, #EFEEE9)', borderRadius: 20, padding: '1px 7px' }}>{f.tier || '—'}</span>
                {f.city && <span style={{ font: '500 11px var(--font)', color: 'var(--text3)' }}>{f.city}</span>}
              </label>
            )
          })}
        </div>

        <textarea value={body} onChange={function (e) { setBody(e.target.value) }}
          placeholder="Write your announcement…" rows={4}
          style={{ width: '100%', resize: 'vertical', font: '500 13px var(--font)', padding: 10, borderRadius: 10, border: '1px solid var(--border)', marginBottom: 10 }} />

        <input ref={fileRef} type="file" onChange={pickFile} style={{ display: 'none' }}
          accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.csv,.ppt,.pptx,.txt,.zip" />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <button type="button" onClick={function () { fileRef.current && fileRef.current.click() }}
            className="btn" style={{ fontSize: 13 }}>📎 Attach file</button>
          {file && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, font: '600 12px var(--font)', color: 'var(--text2)' }}>
              {isImageType(file.type) ? '🖼️' : '📄'} {file.name} <span style={{ color: 'var(--text3)' }}>({humanSize(file.size)})</span>
              <span onClick={function () { setFile(null); if (fileRef.current) fileRef.current.value = '' }} style={{ cursor: 'pointer', color: 'var(--text3)', fontWeight: 700 }}>✕</span>
            </span>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn-p" onClick={submit}
            disabled={sending || pickedIds.length === 0 || (!body.trim() && !file)}>
            {sending ? 'Sending…' : 'Send to ' + pickedIds.length + ' franchisee' + (pickedIds.length === 1 ? '' : 's')}
          </button>
        </div>
      </div>
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
  const [showBroadcast, setShowBroadcast] = useState(false)
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
  async function handleSend(payload) {
    const text = (payload && payload.body) || ''
    const file = payload && payload.file
    const fid = activeIdRef.current
    if (!fid) return
    setSending(true)
    let attach = {}
    if (file) {
      try {
        const a = await uploadAttachment(file, fid)
        attach = { attachment_url: a.url, attachment_name: a.name, attachment_type: a.type, attachment_size: a.size }
      } catch (err) {
        setSending(false)
        showToast('Upload failed: ' + (err.message || err), 'err')
        return
      }
    }
    const row = Object.assign({
      franchisee_id: fid,
      sender_id: currentUser?.id || null,
      sender_name: senderName,
      from_ho: isHO,
      body: text,
      read_by_ho: isHO,
      read_by_franchisee: !isHO,
    }, attach)
    const { data, error } = await sb.from('messages').insert(row).select().single()
    setSending(false)
    if (error) { showToast('Could not send: ' + error.message, 'err'); return }
    setMessages(function (prev) { return prev.concat(data) })
  }

  // ── Broadcast: one message fanned out to many franchisee threads ──
  async function handleBroadcast(payload) {
    const text = (payload.body || '').trim()
    const file = payload.file
    const ids  = payload.recipientIds || []
    if (!ids.length) { showToast('Pick at least one recipient', 'warn'); return }
    if (!text && !file) { showToast('Add a message or attachment', 'warn'); return }
    setSending(true)
    let attach = {}
    if (file) {
      try {
        const a = await uploadAttachment(file, 'broadcast')
        attach = { attachment_url: a.url, attachment_name: a.name, attachment_type: a.type, attachment_size: a.size }
      } catch (err) { setSending(false); showToast('Upload failed: ' + (err.message || err), 'err'); return }
    }
    const bid = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()))
    const rows = ids.map(function (fid) {
      return Object.assign({
        franchisee_id: fid, sender_id: currentUser?.id || null, sender_name: senderName,
        from_ho: true, body: text, read_by_ho: true, read_by_franchisee: false, broadcast_id: bid,
      }, attach)
    })
    const { data, error } = await sb.from('messages').insert(rows).select()
    setSending(false)
    if (error) { showToast('Broadcast failed: ' + error.message, 'err'); return }
    setMessages(function (prev) { return prev.concat(data || []) })
    setShowBroadcast(false)
    showToast('📢 Broadcast sent to ' + ids.length + ' franchisee' + (ids.length > 1 ? 's' : ''), 'ok')
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
        {isManagerOrAbove(currentRole) && (
          <div className="tb-r">
            <button className="btn-p" onClick={function () { setShowBroadcast(true) }} style={{ whiteSpace: 'nowrap' }}>📢 Broadcast</button>
          </div>
        )}
      </header>

      {showBroadcast && (
        <BroadcastModal franchisees={franchisees} sending={sending}
          onClose={function () { setShowBroadcast(false) }} onSend={handleBroadcast} />
      )}

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
