// In-DOM single-select dropdown, a drop-in for native <select>.
// Native <select> popups are drawn by AppKit at screen coordinates WebKit
// computes; in a fullscreen window that math is off (no titlebar / menu bar
// offset) and the menu opens detached from its control. This one is a plain
// DOM popover anchored to its button, so it lines up in every window mode.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

export interface SelectOption<V extends string | number = string> { value: V; label: ReactNode }

export function Select<V extends string | number>({ value, options, onChange, title, className, display, minWidth }: {
  value: V;
  options: SelectOption<V>[];
  onChange: (v: V) => void;
  title?: string;
  className?: string;
  /** trigger content override (defaults to the selected option's label) */
  display?: ReactNode;
  minWidth?: number;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ left: number; top: number; minWidth: number; maxHeight: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);

  const selIdx = options.findIndex((o) => o.value === value);
  const shown = display ?? (selIdx >= 0 ? options[selIdx].label : '');

  // anchor to the button (fixed, so scroll containers / sheets never clip it)
  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const below = vh - r.bottom - 8, above = r.top - 8;
    const flip = below < 160 && above > below;
    const maxHeight = Math.min(320, flip ? above : below);
    const w = Math.max(r.width, minWidth ?? 0);
    const popW = pop.current?.offsetWidth ?? w;
    const left = Math.max(8, Math.min(r.left, vw - popW - 8));
    const popH = Math.min(pop.current?.scrollHeight ?? 0, maxHeight);
    setPos({ left, top: flip ? r.top - 4 - popH : r.bottom + 4, minWidth: w, maxHeight });
  }, [open, minWidth, options.length]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!btn.current?.contains(t) && !pop.current?.contains(t)) setOpen(false);
    };
    const dismiss = (e: Event) => { if (!pop.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    window.addEventListener('resize', dismiss);
    document.addEventListener('scroll', dismiss, true);
    return () => {
      document.removeEventListener('mousedown', close);
      window.removeEventListener('resize', dismiss);
      document.removeEventListener('scroll', dismiss, true);
      setPos(null);
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (open) pop.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active, pos]);

  const openMenu = () => { setActive(Math.max(0, selIdx)); setOpen(true); };

  const pick = (i: number) => {
    const o = options[i];
    setOpen(false);
    btn.current?.focus();
    if (o && o.value !== value) onChange(o.value);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); openMenu(); }
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(options.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(active); }
    else if (e.key === 'Tab') setOpen(false);
  };

  return (
    <>
      <button type="button" ref={btn} title={title} className={'sel-btn' + (className ? ' ' + className : '')}
        aria-haspopup="listbox" aria-expanded={open} onClick={() => (open ? setOpen(false) : openMenu())} onKeyDown={onKey}>
        <span className="sel-val">{shown}</span> <span className="caret">▾</span>
      </button>
      {open && (
        <div ref={pop} className="sel-pop" role="listbox"
          style={pos ? { left: pos.left, top: pos.top, minWidth: pos.minWidth, maxHeight: pos.maxHeight } : { visibility: 'hidden', left: 0, top: 0 }}>
          {options.map((o, i) => (
            <div key={String(o.value)} data-i={i} role="option" aria-selected={i === selIdx}
              className={'sel-item' + (i === selIdx ? ' on' : '') + (i === active ? ' active' : '')}
              onMouseEnter={() => setActive(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(i)}>
              <span className="sel-check">{i === selIdx ? '✓' : ''}</span>{o.label}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
