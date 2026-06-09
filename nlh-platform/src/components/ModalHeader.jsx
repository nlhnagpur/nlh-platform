// Branded NLH modal header — purple gradient + logo, used across all dialogs.
//
//  • Default: place as the first child of a flex-column modal whose padding is 0
//    (e.g. the large entry forms). Spans the full width naturally.
//  • flush:   drop-in replacement for the old `.ch` header inside a normally
//    padded `.modal`. Uses negative margins to bleed to the modal edges so the
//    body below keeps its usual padding — no restructuring required.
export default function ModalHeader({ title, subtitle, onClose, flush }) {
  const flushStyle = flush
    ? { margin: '-24px -26px 18px', borderTopLeftRadius: 'var(--r, 14px)', borderTopRightRadius: 'var(--r, 14px)' }
    : {}
  return (
    <div style={Object.assign({
      background: 'linear-gradient(105deg,#534AB7,#6D28D9)', color: '#fff',
      padding: '15px 22px', display: 'flex', alignItems: 'center', gap: 13, flexShrink: 0,
    }, flushStyle)}>
      <div style={{ width: 42, height: 42, borderRadius: 11, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,.18)' }}>
        <img src="/NLH%20Logo.png" alt="NLH" style={{ width: '88%', height: '88%', objectFit: 'contain' }} onError={function (e) { e.target.style.display = 'none' }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ font: '800 17px var(--font)', letterSpacing: '-.01em', lineHeight: 1.15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
        <div style={{ font: '600 10.5px var(--mono)', opacity: .85, letterSpacing: '.03em', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{subtitle || 'New Learning Horizons'}</div>
      </div>
      {onClose && (
        <button onClick={onClose} aria-label="Close"
          style={{ background: 'rgba(255,255,255,.18)', border: 'none', color: '#fff', width: 32, height: 32, borderRadius: 9, cursor: 'pointer', fontSize: 15, flexShrink: 0 }}>✕</button>
      )}
    </div>
  )
}
