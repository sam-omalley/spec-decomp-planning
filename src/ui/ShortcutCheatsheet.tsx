import { useEffect } from 'react';
import type { ShortcutGroup } from './shortcuts.ts';

interface ShortcutCheatsheetProps {
  open: boolean;
  onClose: () => void;
  groups: ShortcutGroup[];
}

/** `?`-triggered overlay listing the keyboard shortcuts for the current view. */
export function ShortcutCheatsheet({ open, onClose, groups }: ShortcutCheatsheetProps) {
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="shortcut-overlay" onClick={onClose}>
      <div
        className="shortcut-card"
        role="dialog"
        aria-label="Keyboard shortcuts"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shortcut-card-header">
          <h2>Keyboard shortcuts</h2>
          <button className="shortcut-close" onClick={onClose} title="Close (Esc)">
            ×
          </button>
        </div>
        {groups.map((group) => (
          <section className="shortcut-group" key={group.heading}>
            <h3>{group.heading}</h3>
            {group.entries.map((entry) => (
              <div className="shortcut-row" key={entry.keys + entry.description}>
                <span className="shortcut-keys">
                  {entry.keys.split(' / ').map((alt, i) => (
                    <span key={alt}>
                      {i > 0 && ' / '}
                      <kbd>{alt}</kbd>
                    </span>
                  ))}
                </span>
                <span className="shortcut-description">{entry.description}</span>
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
