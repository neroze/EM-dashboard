// The month range picker, one look on every board that uses it (Long leave,
// List, Capacity):  ‹  [📅 Nov 2026 – Feb 2027 ▾]  ›
// The arrows step the whole range back / forward by its own length. The
// button opens a popover: quick presets on the left, a year of months on the
// right — click a start month, then an end month (hover previews the span).
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MONTH_PRESETS, MONTHS, normRange, rangeLabel, shiftMonth, type MonthRange } from '../months.ts';

const span = (r: MonthRange) => {
  const n = (m: string) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7));
  return n(r.to) - n(r.from) + 1;
};
const key = (y: number, i: number) => `${y}-${String(i + 1).padStart(2, '0')}`;

export function MonthRangePicker({ value, onChange, today, years, presets = MONTH_PRESETS.map((p) => p.id), custom }: {
  value: MonthRange; onChange: (r: MonthRange) => void; today: string;
  /** the years that can be picked (earliest synced data … next year) */
  years: number[];
  /** which presets to offer (ids from MONTH_PRESETS) */
  presets?: string[];
  /** true: the current range isn't whole months (exact dates set elsewhere) */
  custom?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(Number(value.from.slice(0, 4)));
  const [start, setStart] = useState<string | null>(null); // first click, waiting for the end
  const [hover, setHover] = useState<string | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);

  const minM = `${years[0]}-01`, maxM = `${years[years.length - 1]}-12`;
  const offered = MONTH_PRESETS.filter((p) => presets.includes(p.id));
  const hit = custom ? undefined : offered.find((p) => { const r = p.range(today); return r.from === value.from && r.to === value.to; });
  const curM = today.slice(0, 7);
  const len = span(value);
  const canBack = shiftMonth(value.from, -len) >= minM;
  const canFwd = shiftMonth(value.to, len) <= maxM;

  const close = () => { setOpen(false); setStart(null); setHover(null); };
  const toggle = () => {
    if (open) { close(); return; }
    setYear(Number(value.from.slice(0, 4)));
    setOpen(true);
  };
  const choose = (r: MonthRange) => { close(); btn.current?.focus(); onChange(normRange(r)); };

  // anchor under the button (fixed: scroll containers never clip it)
  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const w = pop.current?.offsetWidth ?? 420;
    setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - w - 8)), top: r.bottom + 6 });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!btn.current?.contains(t) && !pop.current?.contains(t)) close();
    };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(); btn.current?.focus(); } };
    const dismiss = (e: Event) => { if (!pop.current?.contains(e.target as Node)) close(); };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key, true);
    window.addEventListener('resize', dismiss);
    document.addEventListener('scroll', dismiss, true);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key, true);
      window.removeEventListener('resize', dismiss);
      document.removeEventListener('scroll', dismiss, true);
    };
  }, [open]);

  // the span to paint: a pending pick previews to the hovered month
  const shown = start ? normRange({ from: start, to: hover ?? start }) : value;
  const clickMonth = (m: string) => {
    if (!start) { setStart(m); setHover(m); return; }
    choose({ from: start, to: m });
  };

  return (
    <div className="mr">
      <button type="button" className="mr-step" aria-label={`Previous ${len === 1 ? 'month' : len + ' months'}`}
        title={`Back ${len === 1 ? 'a month' : len + ' months'}`} disabled={!canBack}
        onClick={() => onChange({ from: shiftMonth(value.from, -len), to: shiftMonth(value.to, -len) })}>‹</button>
      <button type="button" ref={btn} className={'mr-btn' + (open ? ' open' : '')} aria-haspopup="dialog" aria-expanded={open} onClick={toggle}
        title="Choose months">
        <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><rect x="1.75" y="2.75" width="12.5" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M1.75 6.25h12.5M5 1.5v2.5M11 1.5v2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
        <span className="mr-label">{custom ? 'Custom dates' : rangeLabel(value)}</span>
        {hit && !custom && <span className="mr-tag">{hit.label}</span>}
        <span className="caret">▾</span>
      </button>
      <button type="button" className="mr-step" aria-label={`Next ${len === 1 ? 'month' : len + ' months'}`}
        title={`Forward ${len === 1 ? 'a month' : len + ' months'}`} disabled={!canFwd}
        onClick={() => onChange({ from: shiftMonth(value.from, len), to: shiftMonth(value.to, len) })}>›</button>

      {open && (
        <div ref={pop} className="mr-pop" role="dialog" aria-label="Choose months"
          style={pos ? { left: pos.left, top: pos.top } : { visibility: 'hidden' }}>
          <div className="mr-presets">
            {offered.map((p) => (
              <button type="button" key={p.id} className={'mr-preset' + (!start && hit?.id === p.id ? ' on' : '')} onClick={() => choose(p.range(today))}>{p.label}</button>
            ))}
          </div>
          <div className="mr-cal">
            <div className="mr-year">
              <button type="button" className="mr-nav" aria-label="Previous year" disabled={year <= years[0]} onClick={() => setYear(year - 1)}>‹</button>
              <b>{year}</b>
              <button type="button" className="mr-nav" aria-label="Next year" disabled={year >= years[years.length - 1]} onClick={() => setYear(year + 1)}>›</button>
            </div>
            <div className="mr-grid" onMouseLeave={() => start && setHover(start)}>
              {MONTHS.map((name, i) => {
                const m = key(year, i);
                const inR = m >= shown.from && m <= shown.to;
                const cls = ['mr-m', inR && 'in', m === shown.from && 'first', m === shown.to && 'last', m === curM && 'now', start && 'picking'].filter(Boolean).join(' ');
                return (
                  <button type="button" key={m} className={cls} disabled={m < minM || m > maxM}
                    aria-pressed={inR} onMouseEnter={() => start && setHover(m)} onClick={() => clickMonth(m)}>{name}</button>
                );
              })}
            </div>
            <div className="mr-hint muted small">
              {start ? <>From <b>{rangeLabel({ from: start, to: start })}</b> — now pick the last month</> : 'Click a start month, then an end month (the same month twice for one month)'}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
