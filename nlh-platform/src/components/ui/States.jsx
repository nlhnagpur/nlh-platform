import React from 'react'

export function LoadingState({ label }) {
  return <div className="loading"><span className="spinner" />{label || 'Loading…'}</div>
}

export function EmptyState({ title, hint, action }) {
  return (
    <div className="empty">
      <div style={{ fontWeight: 600, color: 'var(--text2)' }}>{title}</div>
      {hint && <div style={{ marginTop: 4 }}>{hint}</div>}
      {action && <div style={{ marginTop: 12 }}>{action}</div>}
    </div>
  )
}

// A failed load must never look like "no data": say so, and offer Retry.
export function ErrorState({ message, onRetry }) {
  return (
    <div className="ui-error" role="alert">
      <div style={{ fontWeight: 600 }}>Could not load this list</div>
      <div style={{ marginTop: 4 }}>{message || 'Something went wrong. Nothing has been changed.'}</div>
      {onRetry && <button className="btn-s" style={{ marginTop: 12 }} onClick={onRetry}>Try again</button>}
    </div>
  )
}
