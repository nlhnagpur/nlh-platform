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
  const [messages,   setMessages]   = useState([])
  const [loading,    setLoading]    = useState(true)
  const [selected,   setSelected]   = useState(null)  // selected contact number
  const [reply,      setReply]      = useState('')
  const [sending,    setSending]    = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const bottomRef = useRef(null)

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
      const res = await fetch('/api/send-whatsapp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: selected, text: reply.trim() }),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error || 'Send failed')
      // Log outbound message locally
      await sb.from('whatsapp_messages').insert({
        direction:    'outbound',
        from_number:  '917123514575',
        to_number:    selected,
        message_type: 'text',
        message_body: reply.trim(),
        status:       'sent',
      })
      setReply('')
      await load()
      showToast('Message sent')
    } catch (err) {
      showToast('Failed: ' + err.message, 'err')
    }
    setSending(false)
  }

  return (
    <div className="pg" style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      {/* Topbar */}
      <header className="tb">
        <div className="crumb">Communications <span className="sep">›</span> <b>WhatsApp Inbox</b></div>
        <div className="tb-r" style={{ gap: 10 }}>
          {unreadCount > 0 && (
            <span style={{ background: '#25D366', color: '#fff', borderRadius: 12, padding: '2px 10px', fontSize: 12, fontWeight: 700 }}>
              {unreadCount} new
            </span>
          )}
          <button className="btn" onClick={load}>↻ Refresh</button>
        </div>
      </header>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* ── Contact list ─────────────────────────────────────────────── */}
        <div style={{
          width: 300, flexShrink: 0, borderRight: '1px solid var(--border)',
          overflowY: 'auto', background: '#fff',
        }}>
          <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)', fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
            💬 Conversations ({contactList.length})
          </div>
          {loading ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text2)' }}>Loading…</div>
          ) : contactList.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text2)', fontSize: 13 }}>
              No messages yet.<br />Messages from franchisees will appear here.
            </div>
          ) : contactList.map(function (c) {
            const isSelected = selected === c.number
            const hasNew = (contacts[c.number]?.messages || []).some(function (m) { return m.direction === 'inbound' && m.status === 'received' })
            return (
              <div
                key={c.number}
                onClick={function () { setSelected(c.number) }}
                style={{
                  padding: '12px 14px', cursor: 'pointer',
                  background: isSelected ? '#f0eeff' : '#fff',
                  borderBottom: '1px solid var(--border)',
                  borderLeft: isSelected ? '3px solid var(--purple)' : '3px solid transparent',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 }}>
                  <span style={{ fontWeight: 600, fontSize: 13, fontFamily: 'var(--mono)', color: 'var(--text)' }}>
                    +{c.number}
                  </span>
                  <span style={{ fontSize: 10, color: 'var(--text3)' }}>{timeAgo(c.lastAt)}</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 5 }}>
                  {hasNew && <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#25D366', flexShrink: 0, display: 'inline-block' }} />}
                  {c.lastMsg || '—'}
                </div>
              </div>
            )
          })}
        </div>

        {/* ── Message thread ───────────────────────────────────────────── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#f0f0f0' }}>
          {!selected ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text2)', fontSize: 14 }}>
              ← Select a conversation
            </div>
          ) : (
            <>
              {/* Thread header */}
              <div style={{ padding: '10px 16px', background: '#fff', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#25D366', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 16 }}>
                  💬
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>+{selected}</div>
                  <div style={{ fontSize: 11, color: 'var(--text2)' }}>{thread.length} messages</div>
                </div>
              </div>

              {/* Messages */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {thread.map(function (m) {
                  const isOut = m.direction === 'outbound'
                  return (
                    <div key={m.id} style={{ display: 'flex', justifyContent: isOut ? 'flex-end' : 'flex-start' }}>
                      <div style={{
                        maxWidth: '70%', padding: '8px 12px', borderRadius: isOut ? '14px 14px 2px 14px' : '14px 14px 14px 2px',
                        background: isOut ? '#dcf8c6' : '#fff',
                        boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
                        fontSize: 13, lineHeight: 1.5,
                      }}>
                        <div>{m.message_body || '[' + m.message_type + ']'}</div>
                        <div style={{ fontSize: 10, color: '#999', marginTop: 3, textAlign: 'right', display: 'flex', gap: 4, justifyContent: 'flex-end', alignItems: 'center' }}>
                          {fmtTime(m.created_at)}
                          {isOut && <span title={m.status}>{m.status === 'read' ? '✓✓' : m.status === 'delivered' ? '✓✓' : '✓'}</span>}
                        </div>
                      </div>
                    </div>
                  )
                })}
                <div ref={bottomRef} />
              </div>

              {/* Reply bar */}
              <div style={{ padding: '10px 16px', background: '#fff', borderTop: '1px solid var(--border)', display: 'flex', gap: 8 }}>
                <input
                  style={{ flex: 1, padding: '9px 13px', borderRadius: 22, border: '1px solid var(--border)', fontSize: 13, outline: 'none' }}
                  placeholder="Type a reply… (free-form within 24h window)"
                  value={reply}
                  onChange={function (e) { setReply(e.target.value) }}
                  onKeyDown={function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply() } }}
                />
                <button
                  onClick={sendReply}
                  disabled={sending || !reply.trim()}
                  style={{
                    background: '#25D366', color: '#fff', border: 'none', borderRadius: '50%',
                    width: 40, height: 40, fontSize: 18, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    opacity: (!reply.trim() || sending) ? 0.5 : 1,
                  }}
                >
                  ➤
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
