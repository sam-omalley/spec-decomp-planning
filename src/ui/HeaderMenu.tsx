import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

interface HeaderMenuProps {
  label: ReactNode;
  title?: string;
  children: ReactNode;
  /** Which side the dropdown opens from — 'end' (default) anchors to the
   *  trigger's right edge, for a menu near the header's right side; 'start'
   *  anchors to its left edge, for one near the header's left side (a
   *  centred/right-anchored list would otherwise overflow off-screen). */
  align?: 'start' | 'end';
}

/** A small dropdown for header actions (file ops, help, external links) that
 *  would otherwise crowd the header as buttons. Closes on outside click,
 *  Escape, or picking any item (a click anywhere in the list bubbles up). */
export function HeaderMenu({ label, title, children, align = 'end' }: HeaderMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="header-menu" ref={ref}>
      <button
        className="header-menu-trigger"
        aria-expanded={open}
        title={title}
        onClick={() => setOpen((o) => !o)}
      >
        {label}
      </button>
      {open && (
        <div
          className={`header-menu-list${align === 'start' ? ' header-menu-list-start' : ''}`}
          role="menu"
          onClick={() => setOpen(false)}
        >
          {children}
        </div>
      )}
    </div>
  );
}
