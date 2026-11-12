// Multi-select dropdown with optional search. Empty selection = "All".
import { useEffect, useMemo, useRef, useState } from 'react';

export interface Option { value: string; label: string; hint?: string }

export function MultiSelect({ label, options, value, onChange, search = false, width = 220, inline = false }: {
  label: string;
  options: Option[];
  value: string[];
  onChange: (v: string[]) => void;
  search?: boolean;
  width?: number;
  /** expand in place (sidebars: a floating popover would be clipped by the scroller) */
  inline?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? options.filter((o) => o.label.toLowerCase().includes(s) || o.hint?.toLowerCase().includes(s)) : options;
  }, [options, q]);

  const selected = new Set(value);
  const summary = value.length === 0 ? 'All'
    : value.length === 1 ? (options.find((o) => o.value === value[0])?.label ?? '1 selected')
      : `${value.length} selected`;
  const toggle = (v: string) => onChange(selected.has(v) ? value.filter((x) => x !== v) : [...value, v]);

  return (
    <div className={'ms' + (inline ? ' inline' : '')} ref={ref}>
      <button type="button" className={'ms-btn' + (value.length ? ' active' : '')} onClick={() => setOpen((o) => !o)}>
        <span className="ms-label">{label}</span> <span className="ms-val">{summary}</span> <span className="caret">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className={'ms-pop' + (inline ? ' inline' : '')} style={inline ? undefined : { width }}>
          {search && (
            <input autoFocus className="ms-search" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
          )}
          <div className="ms-actions">
            <button type="button" className="link" onClick={() => onChange([])}>All</button>
            {shown.length > 0 && shown.length < 200 && (
              <button type="button" className="link" onClick={() => onChange([...new Set([...value, ...shown.map((o) => o.value)])])}>Select shown</button>
            )}
          </div>
          <div className="ms-list">
            {shown.map((o) => (
              <label key={o.value} className="ms-item">
                <input type="checkbox" checked={selected.has(o.value)} onChange={() => toggle(o.value)} />
                <span>{o.label}</span>
                {o.hint && <span className="muted small">{o.hint}</span>}
              </label>
            ))}
            {!shown.length && <div className="muted small pad">No matches</div>}
          </div>
        </div>
      )}
    </div>
  );
}
