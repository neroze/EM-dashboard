// Multi-select dropdown with optional search. Empty selection = "All".
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

/** group: options sharing it are listed under one heading (pass them in group order) */
export interface Option { value: string; label: string; hint?: string; group?: string }

export function MultiSelect({ label, options, value, onChange, search = false, width = 220, inline = false, groupLabel }: {
  label: string;
  options: Option[];
  value: string[];
  onChange: (v: string[]) => void;
  search?: boolean;
  width?: number;
  /** expand in place (sidebars: a floating popover would be clipped by the scroller) */
  inline?: boolean;
  /** how a group heading renders (default: its name) */
  groupLabel?: (group: string) => ReactNode;
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
            {shown.map((o, i) => (
              <div key={o.value}>
              {o.group !== undefined && o.group !== shown[i - 1]?.group && (
                <div className="ms-group">
                  {groupLabel ? groupLabel(o.group) : o.group}
                  <button type="button" className="link small" title={`Select everyone in ${o.group}`}
                    onClick={() => {
                      const ids = shown.filter((x) => x.group === o.group).map((x) => x.value);
                      const all = ids.every((id) => selected.has(id));
                      onChange(all ? value.filter((v) => !ids.includes(v)) : [...new Set([...value, ...ids])]);
                    }}>
                    {shown.filter((x) => x.group === o.group).every((x) => selected.has(x.value)) ? 'clear' : 'all'}
                  </button>
                </div>
              )}
              <label className="ms-item">
                <input type="checkbox" checked={selected.has(o.value)} onChange={() => toggle(o.value)} />
                <span>{o.label}</span>
                {o.hint && <span className="muted small">{o.hint}</span>}
              </label>
              </div>
            ))}
            {!shown.length && <div className="muted small pad">No matches</div>}
          </div>
        </div>
      )}
    </div>
  );
}
