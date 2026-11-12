// People × days grid, grouped by squad. Virtualised by rows: only the rows in
// (or near) the viewport are in the DOM, so 50 people × 90 days stays smooth.
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { dayNum, fmtDay, fmtMonth, fmtWeekday, isWeekendDay, pct } from '../format.ts';
import { setState, useUi, type Zoom } from '../state/filters.ts';
import type { CalendarCell, CalendarData, LeaveRecord, OverlapDay } from '../types.ts';
import { RequestPopover } from '../components/RequestPopover.tsx';

const ROW_H = 30;
const TEAM_H = 26;
const NAME_W = 210;
const HEAD_H = 46;
const COL_W: Record<Zoom, number> = { week: 104, sprint: 46, month: 26 };

type Row =
  | { kind: 'team'; team: string; count: number; top: number; h: number }
  | { kind: 'person'; idx: number; top: number; h: number };

export function CalendarView({ data, today }: { data: CalendarData | null; today: string }) {
  const { zoom } = useUi();
  const scroller = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState({ top: 0, height: 600 });
  const [pop, setPop] = useState<{ rec: LeaveRecord; x: number; y: number } | null>(null);
  const colW = COL_W[zoom];

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScroll({ top: el.scrollTop, height: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // scroll today into view when the range changes
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !data) return;
    const i = data.days.indexOf(today);
    el.scrollLeft = i > 3 ? (i - 2) * colW : 0;
  }, [data?.days[0], data?.days.length, colW]); // eslint-disable-line react-hooks/exhaustive-deps

  const { rows, total } = useMemo(() => {
    const rows: Row[] = [];
    let top = 0, last = '';
    data?.people.forEach((p, idx) => {
      if (p.team !== last) {
        rows.push({ kind: 'team', team: p.team, count: data.people.filter((x) => x.team === p.team).length, top, h: TEAM_H });
        top += TEAM_H; last = p.team;
      }
      rows.push({ kind: 'person', idx, top, h: ROW_H });
      top += ROW_H;
    });
    return { rows, total: top };
  }, [data]);

  const holidayAt = useMemo(() => {
    const m = new Map<string, string>();
    for (const h of data?.holidays ?? []) m.set(`${h.day}|${h.location}`, h.name);
    return (day: string, loc: string) => m.get(`${day}|*`) ?? m.get(`${day}|${loc}`);
  }, [data]);

  const loadByDay = useMemo(() => new Map((data?.load ?? []).map((d) => [d.day, d])), [data]);

  if (!data) return <div className="empty">Loading…</div>;
  if (!data.people.length) return <div className="empty">Nobody in scope matches these filters.</div>;
  if (!data.days.length) return <div className="empty">No days match — with “Overlap only” on, no day in this range crosses the threshold.</div>;

  const width = NAME_W + data.days.length * colW;
  const over = 8;
  const lo = scroll.top - over * ROW_H, hi = scroll.top + scroll.height + over * ROW_H;
  const visible = rows.filter((r) => r.top + r.h >= lo && r.top <= hi);
  const padTop = visible.length ? visible[0].top : 0;
  const padBottom = visible.length ? total - (visible[visible.length - 1].top + visible[visible.length - 1].h) : 0;

  const openCell = (c: CalendarCell, e: React.MouseEvent) => {
    const rec = data.requests[c.id];
    if (rec) setPop({ rec, x: e.clientX, y: e.clientY });
  };

  return (
    <div className="cal-wrap">
      <div className="cal-tools">
        <div className="seg">
          {(['week', 'sprint', 'month'] as Zoom[]).map((z) => (
            <button type="button" key={z} className={'chip' + (zoom === z ? ' on' : '')} onClick={() => setState({ zoom: z })}>
              {z[0].toUpperCase() + z.slice(1)}
            </button>
          ))}
        </div>
        <div className="legend">
          <span><i className="sw planned" /> Planned</span>
          <span><i className="sw draft" /> Draft</span>
          <span><i className="sw wfh" /> Work from home</span>
          <span><i className="sw wfh-draft" /> WFH draft</span>
          <span><i className="sw denied" /> Denied/Canceled</span>
          <span><i className="sw holiday" /> Public holiday</span>
          <span><i className="sw flagged" /> Overlap day</span>
        </div>
      </div>
      <div className="cal" ref={scroller} onScroll={(e) => {
        const el = e.currentTarget;
        if (Math.abs(el.scrollTop - scroll.top) > ROW_H / 2) setScroll({ top: el.scrollTop, height: el.clientHeight });
        if (pop) setPop(null);
      }}>
        <div style={{ width, position: 'relative' }}>
          <div className="cal-head" style={{ height: HEAD_H, width }}>
            <div className="cal-name head" style={{ width: NAME_W }}>
              <span className="muted small">{data.people.length} people · {fmtMonth(data.days[0])}</span>
            </div>
            {data.days.map((d, j) => {
              const l = loadByDay.get(d);
              const first = j === 0 || d.endsWith('-01');
              return (
                <div key={d} title={fmtDay(d) + (l?.flagged ? ' — overlap day' : '')}
                  className={'cal-dh' + (isWeekendDay(d) ? ' we' : '') + (d === today ? ' today' : '') + (l?.flagged ? ' flagged' : '')}
                  style={{ width: colW }}>
                  {first && zoom !== 'week' && <span className="mon">{fmtMonth(d).split(' ')[0]}</span>}
                  <span className="wd">{zoom === 'week' ? fmtDay(d) : fmtWeekday(d)}</span>
                  {zoom !== 'week' && <span className="dn">{dayNum(d)}</span>}
                </div>
              );
            })}
          </div>
          <div style={{ height: padTop }} />
          {visible.map((r) => r.kind === 'team'
            ? <TeamRow key={'t:' + r.team} team={r.team} count={r.count} days={data.days} colW={colW} load={loadByDay} />
            : (
              <PersonRow key={data.people[r.idx].id} person={data.people[r.idx]} cells={data.cells[r.idx]} days={data.days}
                colW={colW} zoom={zoom} today={today} holidayAt={holidayAt} load={loadByDay} onCell={openCell} />
            ))}
          <div style={{ height: padBottom }} />
        </div>
      </div>
      {pop && <RequestPopover rec={pop.rec} x={pop.x} y={pop.y} onClose={() => setPop(null)} />}
    </div>
  );
}

function TeamRow({ team, count, days, colW, load }: {
  team: string; count: number; days: string[]; colW: number; load: Map<string, OverlapDay>;
}) {
  return (
    <div className="cal-row team" style={{ height: TEAM_H }}>
      <div className="cal-name team" style={{ width: NAME_W }}>{team} <span className="muted small">· {count}</span></div>
      {days.map((d) => {
        const t = load.get(d)?.teams.find((x) => x.team === team);
        return (
          <div key={d} className={'cal-load' + (isWeekendDay(d) ? ' we' : '') + (t?.flagged ? ' flagged' : '')} style={{ width: colW }}
            title={t ? `${team}: ${t.out}/${t.size} out (${pct(t.share)}) — planned ${t.planned}, draft ${t.draft}` : undefined}>
            {t && t.out > 0 ? (colW >= 40 ? pct(t.share) : Math.round(t.share * 100)) : ''}
          </div>
        );
      })}
    </div>
  );
}

function PersonRow({ person, cells, days, colW, zoom, today, holidayAt, load, onCell }: {
  person: CalendarData['people'][number];
  cells: (CalendarCell | null)[];
  days: string[];
  colW: number;
  zoom: Zoom;
  today: string;
  holidayAt: (day: string, loc: string) => string | undefined;
  load: Map<string, OverlapDay>;
  onCell: (c: CalendarCell, e: React.MouseEvent) => void;
}) {
  return (
    <div className="cal-row" style={{ height: ROW_H }}>
      <div className="cal-name" style={{ width: NAME_W }} title={`${person.displayName} · ${person.location}`}>
        <span className="nm">{person.displayName}</span>
        <span className="loc">{person.location}</span>
      </div>
      {days.map((d, j) => {
        const c = cells[j];
        const hol = holidayAt(d, person.location);
        const flagged = load.get(d)?.teams.some((t) => t.team === person.team && t.flagged);
        const cls = 'cal-cell' + (isWeekendDay(d) ? ' we' : '') + (hol ? ' hol' : '') + (d === today ? ' today' : '') + (flagged ? ' flagged' : '');
        return (
          <div key={d} className={cls} style={{ width: colW }} title={hol}>
            {c && (
              <button type="button"
                className={'blk ' + (c.s === 'P' ? 'planned' : c.s === 'D' ? 'draft' : 'denied') + (c.w && c.s !== 'X' ? ' wfh' : '') + (c.f < 1 ? ' half' : '')}
                title={`${c.t} — ${c.s === 'P' ? 'Planned' : c.s === 'D' ? 'Draft' : 'Denied/Canceled'}${c.f < 1 ? ' (½ day)' : ''}`}
                onClick={(e) => onCell(c, e)}>
                {zoom === 'week' ? <span className="blk-t">{c.f < 1 ? '½ ' : ''}{c.t}</span> : c.f < 1 ? '½' : ''}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
