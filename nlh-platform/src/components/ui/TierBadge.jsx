import React from 'react'

// NLH / SMF / CF / UF pill (classes .tier .t-* live in globals.css).
export default function TierBadge({ tier }) {
  if (!tier) return null
  const cls = { NLH: 't-nlh', SMF: 't-smf', CF: 't-cf', UF: 't-uf' }[tier] || ''
  return <span className={'tier ' + cls}>{tier}</span>
}
