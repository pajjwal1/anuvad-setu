import { langName } from '../lib/languages.js';

export default function History({ items, onSelect, onToggleStar, onDelete, onClear, onClose }) {
  const sorted = [...items].sort((a, b) => Number(b.starred) - Number(a.starred));
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="History" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <header className="sheet-head">
          <h2>History &amp; saved</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        {sorted.length === 0 ? (
          <p className="muted">Your translations will appear here. They are stored only on this device.</p>
        ) : (
          <>
            <ul className="history-list">
              {sorted.map((h) => (
                <li key={h.id} className="history-item">
                  <button className="history-main" onClick={() => onSelect(h)}>
                    <span className="muted small">
                      {langName(h.source)} → {langName(h.target)}
                    </span>
                    <span className="clamp">{h.text}</span>
                    <span className="clamp accent">{h.result}</span>
                  </button>
                  <button
                    className="icon-btn"
                    onClick={() => onToggleStar(h.id)}
                    aria-label={h.starred ? 'Remove from saved' : 'Save'}
                    aria-pressed={h.starred}
                  >
                    {h.starred ? '★' : '☆'}
                  </button>
                  <button className="icon-btn" onClick={() => onDelete(h.id)} aria-label="Delete">
                    🗑
                  </button>
                </li>
              ))}
            </ul>
            <button className="btn ghost" onClick={onClear}>
              Clear all
            </button>
          </>
        )}
      </div>
    </div>
  );
}
