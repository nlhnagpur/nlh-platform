// One semantic status palette for the whole product (see ux-improvement-plan §B):
//   success  = settled / done          attention = needs action soon
//   danger   = overdue / rejected      neutral   = inactive / closed
//   info     = information             accent / ochre = category colours
// Pure data so it can be unit-tested and reused by documents.
export const TONES = {
  success:   { c: '#16A34A', bg: '#f0fdf4', bd: '#bbf7d0' },
  attention: { c: '#92400E', bg: '#FFF7DA', bd: '#D97706' },
  danger:    { c: '#991b1b', bg: '#fef2f2', bd: '#fecaca' },
  neutral:   { c: '#5C5A54', bg: '#F4F3EF', bd: '#DDDBD3' },
  info:      { c: '#1A5FA8', bg: '#eff6ff', bd: '#bfdbfe' },
  accent:    { c: '#6D28D9', bg: '#f5f3ff', bd: '#ddd6fe' },
  ochre:     { c: '#8A5200', bg: '#fff7ed', bd: '#fed7aa' },
}

const WORDS = {
  success:   ['paid', 'approved', 'recorded', 'active', 'settled', 'complete', 'completed', 'verified', 'closed', 'done', 'issued'],
  attention: ['pending', 'partial', 'part_paid', 'part paid', 'soon', 'due', 'unpaid', 'proforma', 'invoiced', 'draft', 'waiting'],
  danger:    ['rejected', 'overdue', 'cancelled', 'canceled', 'failed', 'blocked', 'expired', 'error'],
  neutral:   ['inactive', 'none', 'dropped', 'withdrawn', 'archived'],
}

// Map a free-text status onto a tone; anything unknown is neutral, never green.
export function toneForStatus(status) {
  const s = String(status || '').trim().toLowerCase()
  if (!s) return 'neutral'
  const keys = Object.keys(WORDS)
  for (let i = 0; i < keys.length; i++) {
    if (WORDS[keys[i]].indexOf(s) !== -1) return keys[i]
  }
  return 'neutral'
}
