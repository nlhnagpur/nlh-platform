// Branded NLH modal header — purple gradient + logo, used across entry forms.
export default function ModalHeader({ title, subtitle, onClose }) {
  return (
    <div style={{ background: 'linear-gradient(105deg,#534AB7,#6D28D9)', color: '#fff', padding: '16px 22px', display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0 }}>
      <div style={{ width: 44, height: 44, borderRadius: 11, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,.18)' }}>
        <img src="/NLH%20Logo.png" alt="NLH" style={{ width: '88%', height: '88%', objectFit: 'contain' }} onError={function (e) { e.target.style.display = 'none' }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ font: '800 18px var(--font)', letterSpacing: '-.01em', lineHeight: 1.15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
        <div style={{ font: '600 10px var(--mono)', opacity: .85, letterSpacing: '.1em', textTransform: 'uppercase', marginTop: 3 }}>{subtitle || 'New Learning Horizons'}</div>
      </div>
      <button onClick={onClose} aria-label="Close"
        style={{ background: 'rgba(255,255,255,.18)', border: 'none', color: '#fff', width: 32, height: 32, borderRadius: 9, cursor: 'pointer', fontSize: 15, flexShrink: 0 }}>✕</button>
    </div>
  )
}
