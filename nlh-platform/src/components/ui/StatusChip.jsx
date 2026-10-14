import React from 'react'
import { TONES, toneForStatus } from './tones'

// Small pill. Pass `tone` explicitly, or `status` to derive it from the word.
export default function StatusChip({ tone, status, children, title }) {
  const t = TONES[tone || toneForStatus(status)] || TONES.neutral
  return (
    <span className="ui-chip" title={title} style={{ color: t.c, background: t.bg, borderColor: t.bd }}>
      {children !== undefined ? children : status}
    </span>
  )
}
