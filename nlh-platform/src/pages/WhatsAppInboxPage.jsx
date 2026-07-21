import React, { useState, useEffect, useRef } from 'react'
import { sb } from '../supabase'
import { showToast } from '../utils'

function timeAgo(ts) {
  const d = new Date(ts)
  const now = new Date()
  const diff = Math.floor((now - d) / 1000)
  if (diff < 60)  return 'just now'
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago'
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago'
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
}

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
}

export default function WhatsAppInboxPage() {
  const [messages,    setMessages]   = useState([])
  const [loading,     setLoading]    = useState(true)
  const [selected,    setSelected]   = useState(null)
  const [reply,       setReply]      = useState('')
  const [sending,     setSending]    = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [isMobile,    setIsMobile]   = useState(window.innerWidth < 768)
  const [directory,   setDirectory]  = useState({})   // phone(last10) → { student, parent, centre, tier }
  const bottomRef = useRef(null)

  useEffect(function () {
    function onResize() { setIsMobile(window.innerWidth < 768) }
    window.addEventListener('resize', onResize)
    return function () { window.removeEventListener('resize', onResize) }
  }, [])

  async function load() {
    const { data } = await sb
      .from('whatsapp_messages')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500)
    setMessages(data || [])
    setLoading(false)
  }

  useEffect(function () { load() }, [])

  // Directory: phone (last 10 digits) → who it is, so an incoming reply shows
  // the parent/student and their centre instead of a bare number.
  useEffect(function () {
    async function loadDirectory() {
      const { data } = await sb.from('students')
        .select('full_name, parent_name, phone, franchisees(business_name, tier, city)')
        .not('phone', 'is', null)
      const dir = {}
      ;(data || []).forEach(function (s) {
        const key = String(s.phone || '').replace(/\D/g, '').slice(-10)
        if (key.length === 10 && !dir[key]) {
          dir[key] = {
            student: s.full_name,
            parent:  s.parent_name,
            centre:  s.franchisees?.business_name,
            tier:    s.franchisees?.tier,
            city:    s.franchisees?.city,
          }
        }
      })
      setDirectory(dir)
    }
    loadDirectory()
  }, [])

  function identify(num) {
    return directory[String(num || '').replace(/\D/g, '').slice(-10)] || null
  }

  useEffect(function () {
    if (!autoRefresh) return
    const t = setInterval(load, 15000)
    return function () { clearInterval(t) }
  }, [autoRefresh])

  useEffect(function () {
    if (bottomRef.current) bottomRef.current.scrollIntoView({ behavior: 'smooth' })
  }, [selected, messages])

  // Group messages by contact number
  const contacts = {}
  messages.forEach(function (m) {
    const num = m.direction === 'inbound' ? m.from_number : m.to_number
    if (!num) return
    if (!contacts[num]) contacts[num] = { number: num, messages: [], lastAt: m.created_at, lastMsg: m.message_body }
    contacts[num].messages.push(m)
    if (m.created_at > contacts[num].lastAt) {
      contacts[num].lastAt  = m.created_at
      contacts[num].lastMsg = m.message_body
    }
  })
  const contactList = Object.values(contacts).sort(function (a, b) {
    return new Date(b.lastAt) - new Date(a.lastAt)
  })

  const thread = selected
    ? (contacts[selected]?.messages || []).slice().sort(function (a, b) {
        return new Date(a.created_at) - new Date(b.created_at)
      })
    : []

  const unreadCount = messages.filter(function (m) { return m.direction === 'inbound' && m.status === 'received' }).length

  async function sendReply() {
    if (!reply.trim() || !selected) return
    setSending(true)
    try {
      const { data: { session: waSession } } = await sb.auth.getSession()
      const res = await fetch('/api/send-whatsapp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(waSession ? { Authorization: `Bearer ${waSession.access_token}` } : {}),
        },
        body: JSON.stringify({ to: selected, text: reply.trim() }),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error || 'Send failed')
      await sb.from('whatsapp_messages').insert({
        direction:     'outbound',
        from_number:   '917123514575',
        to_number:     selected,
        message_type:  'text',
        message_body:  reply.trim(),
        status:        'sent',
        wa_message_id: data?.data?.messages?.[0]?.id || data?.messages?.[0]?.id || null,
      })
      setReply('')
      await load()
      showToast('Message sent')
    } catch (err) {
      showToast('Failed: ' + err.message, 'err')
    }
    setSending(false)
  }

  // On mobile: show thread panel when a contact is selected
  const showList   = !isMobile || !selected
  const showThread = !isMobile || !!selected

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>

      {/* ── Topbar ── */}
      <header className="tb">
        {isMobile && selected ? (
          <button
            onClick={function () { setSelected(null) }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--text2)', padding: '0 8px 0 0', lineHeight: 1 }}
          >
            ←
          </button>
        ) : null}
        <div className="crumb">
          {isMobile && selected
            ? <b style={{ fontFamily: 'var(--mono)', fontSize: 13 }}>+{selected}</b>
            : <><span style={{ color: 'var(--text3)' }}>WhatsApp</span> <span className="sep">›</span> <b>Inbox</b></>
          }
        </div>
        <div className="tb-r" style={{ gap: 8 }}>
          {unreadCount > 0 && (
            <span style={{ background: '#25D366', color: '#fff', borderRadius: 12, padding: '2px 10px', fontSize: 12, fontWeight: 700 }}>
              {unreadCount} new
            </span>
          )}
          {!isMobile && <button className="btn" onClick={load}>↻ Refresh</button>}
          {isMobile && !selected && (
            <button style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--text2)' }} onClick={load}>↻</button>
          )}
        </div>
      </header>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* ── Contact list ── */}
        {showList && (
          <div style={{
            width: isMobile ? '100%' : 300,
            flexShrink: 0,
            borderRight: isMobile ? 'none' : '1px solid var(--border)',
            overflowY: 'auto',
            background: '#fff',
          }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', fontSize: 13, fontWeight: 700, color: 'var(--text)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>💬 Conversations ({contactList.length})</span>
            </div>
            {loading ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text2)' }}>Loading…</div>
            ) : contactList.length === 0 ? (
              <div style={{ padding: '60px 24px', textAlign: 'center', color: 'var(--text2)', fontSize: 13 }}>
                <div style={{ fontSize: 40, marginBottom: 14 }}>💬</div>
                <div style={{ fontWeight: 600, marginBottom: 6, color: 'var(--text)' }}>No messages yet</div>
                <div style={{ fontSize: 12, color: 'var(--text3)', lineHeight: 1.6 }}>
                  Every WhatsApp sent from the platform (receipts, certificates, review requests, order updates…) and every reply received on +91 712 351 4575 appears here.
                </div>
              </div>
            ) : contactList.map(function (c) {
              const isSelected = selected === c.number
              const hasNew = (contacts[c.number]?.messages || []).some(function (m) { return m.direction === 'inbound' && m.status === 'received' })
              return (
                <div
                  key={c.number}
                  onClick={function () { setSelected(c.number) }}
                  style={{
                    padding: '14px 16px',
                    cursor: 'pointer',
                    background: isSelected && !isMobile ? '#f0eeff' : '#fff',
                    borderBottom: '1px solid var(--border)',
                    borderLeft: isSelected && !isMobile ? '3px solid var(--purple)' : '3px solid transparent',
                    transition: 'background .1s',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    {/* Avatar */}
                    <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'linear-gradient(135deg,#25D366,#128C7E)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 18, flexShrink: 0 }}>
                      💬
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
                        <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {(function () {
                            const who = identify(c.number)
                            return who ? (who.parent || who.student) : '+' + c.number
                          })()}
                        </span>
                        <span style={{ fontSize: 10, color: 'var(--text3)', flexShrink: 0 }}>{timeAgo(c.lastAt)}</span>
                      </div>
                      {(function () {
                        const who = identify(c.number)
                        if (!who) return null
                        return (
                          <div style={{ fontSize: 10.5, color: 'var(--text3)', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            🎓 {who.student}
                            {who.centre ? ' · ' + (who.tier === 'NLH' ? '🏛️ ' : '🏢 ') + who.centre : ''}
                          </div>
                        )
                      })()}
                      <div style={{ fontSize: 12, color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 5 }}>
                        {hasNew && <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#25D366', flexShrink: 0, display: 'inline-block' }} />}
                        {/* One-line preview of a multi-line message */}
                        {(c.lastMsg || '—').replace(/\s*\n+\s*/g, ' · ')}
                      </div>
                    </div>
                    <div style={{ fontSize: 16, color: 'var(--text3)', flexShrink: 0 }}>›</div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* ── Message thread ── */}
        {showThread && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#ECE5DD', width: isMobile ? '100%' : undefined }}>
            {!selected ? (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text2)', fontSize: 14, gap: 12 }}>
                <div style={{ fontSize: 48, opacity: 0.3 }}>💬</div>
                <div>Select a conversation</div>
              </div>
            ) : (
              <>
                {/* Thread header (desktop only — mobile uses topbar) */}
                {!isMobile && (
                  <div style={{ padding: '12px 18px', background: '#075E54', borderBottom: '1px solid rgba(0,0,0,.1)', display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#25D366', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 18, flexShrink: 0 }}>
                      💬
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {(function () {
                        const who = identify(selected)
                        return (
                          <>
                            <div style={{ fontWeight: 700, fontSize: 14, color: '#fff' }}>
                              {who ? (who.parent || who.student) : '+' + selected}
                            </div>
                            <div style={{ fontSize: 11, color: 'rgba(255,255,255,.75)' }}>
                              {who
                                ? <>🎓 {who.student}{who.centre ? ' · ' + (who.tier === 'NLH' ? '🏛️ ' : '🏢 ') + who.centre : ''}{who.city ? ' · ' + who.city : ''} · +{selected}</>
                                : <>{thread.length} messages</>}
                            </div>
                          </>
                        )
                      })()}
                    </div>
                  </div>
                )}

                {/* Messages */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '16px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {thread.map(function (m) {
                    const isOut = m.direction === 'outbound'
                    return (
                      <div key={m.id} style={{ display: 'flex', justifyContent: isOut ? 'flex-end' : 'flex-start', marginBottom: 4 }}>
                        <div style={{
                          maxWidth: isMobile ? '82%' : '70%',
                          padding: '8px 12px 6px',
                          borderRadius: isOut ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                          background: isOut ? '#DCF8C6' : '#fff',
                          boxShadow: '0 1px 2px rgba(0,0,0,0.12)',
                          fontSize: 13.5, lineHeight: 1.5,
                        }}>
                          {m.media_url && (
                            <a href={m.media_url} target="_blank" rel="noreferrer" style={{ display: 'block', marginBottom: 6 }}>
                              <img src={m.media_url} alt="attachment"
                                style={{ maxWidth: '100%', borderRadius: 10, display: 'block', border: '1px solid rgba(0,0,0,.08)' }} />
                            </a>
                          )}
                          {/* Templates are multi-line; without this the whole
                              message collapses onto one run-on line. */}
                          <div style={{ color: '#1a1a1a', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                            {m.message_body || '[' + m.message_type + ']'}
                          </div>
                          <div style={{ fontSize: 10, color: '#999', marginTop: 4, textAlign: 'right', display: 'flex', gap: 3, justifyContent: 'flex-end', alignItems: 'center' }}>
                            {fmtTime(m.created_at)}
                            {isOut && (
                              <span style={{ color: m.status === 'read' ? '#34B7F1' : '#aaa' }} title={m.status}>
                                {m.status === 'read' || m.status === 'delivered' ? '✓✓' : '✓'}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                  <div ref={bottomRef} />
                </div>

                {/* Reply bar */}
                <div style={{ padding: '8px 10px', background: '#F0F0F0', borderTop: '1px solid rgba(0,0,0,.08)', display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    style={{
                      flex: 1, padding: '10px 16px', borderRadius: 24,
                      border: '1px solid var(--border)', fontSize: 14,
                      outline: 'none', background: '#fff',
                    }}
                    placeholder="Type a message…"
                    value={reply}
                    onChange={function (e) { setReply(e.target.value) }}
                    onKeyDown={function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply() } }}
                  />
                  <button
                    onClick={sendReply}
                    disabled={sending || !reply.trim()}
                    style={{
                      background: reply.trim() && !sending ? '#25D366' : '#ccc',
                      color: '#fff', border: 'none', borderRadius: '50%',
                      width: 44, height: 44, fontSize: 20, cursor: reply.trim() && !sending ? 'pointer' : 'default',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0, transition: 'background .15s',
                    }}
                  >
                    ➤
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
