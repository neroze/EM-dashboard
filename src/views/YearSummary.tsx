// Dashboard: quarter summary for a calendar year. Pick a year and any set of
// quarters; the totals, the type breakdown and the highlighted bands on the
// month chart follow the selection. Approved + draft, in working days.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api } from '../api.ts';
import { copyTable } from '../copy.ts';
import { CopyButton } from '../components/CopyButton.tsx';
import { fmtDays, fmtShort } from '../format.ts';
import type { KindTotals, MonthSummary, PersonTotals, UiFilters, YearSummary } from '../types.ts';
import { Select } from '../components/Select.tsx';
import { Sortable } from '../components/Sortable.tsx';
import { ListModeSwitch, TeamFlow } from '../components/PeopleFlow.tsx';
import { useListMode } from '../state/listMode.ts';

type Q = 1 | 2 | 3 | 4;
type Metric = 'days' | 'requests';
const QS: Q[] = [1, 2, 3, 4];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SERIES = [
  { key: 'leave' as const, label: 'Leave', color: 'var(--c1)' },
  { key: 'wfh' as const, label: 'Work from home', color: 'var(--c3)' },
];
const n2 = (n: number) => +n.toFixed(2);

export function YearSection({ filters, version, color }: { filters: UiFilters; version: number; color: (type: string) => string }) {
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [sel, setSel] = useState<Set<Q>>(() => new Set(QS));
  const [metric, setMetric] = useState<Metric>('days');
  const [data, setData] = useState<YearSummary | null>(null);
  const who = JSON.stringify([filters.teams, filters.people, filters.locations]);

  useEffect(() => {
    let live = true;
    void api.getYearSummary(filters, year).then((d) => { if (live) setData(d); });
    return () => { live = false; };
  }, [year, who, version]); // eslint-disable-line react-hooks/exhaustive-deps

  const nowYear = Number((data?.today ?? '').slice(0, 4)) || year;
  const firstYear = Math.min(nowYear, Number((data?.dataFrom ?? '').slice(0, 4)) || nowYear);
  const years = Array.from({ length: nowYear + 1 - firstYear + 1 }, (_, i) => firstYear + i);

  const toggle = (q: Q) => setSel((s) => {
    const n = new Set(s);
    if (n.has(q)) { if (n.size > 1) n.delete(q); } else n.add(q);
    return n;
  });
  const quarters = data?.quarters ?? [];
  const chosen = quarters.filter((q) => sel.has(q.q));
  const sum = (k: 'leave' | 'wfh'): KindTotals => {
    const byType: Record<string, number> = {};
    for (const q of chosen) for (const [t, v] of Object.entries(q[k].byType)) byType[t] = n2((byType[t] ?? 0) + v);
    const byPerson: Record<string, PersonTotals> = {};
    for (const q of chosen) {
      for (const [id, p] of Object.entries(q[k].byPerson)) {
        const cur = byPerson[id];
        byPerson[id] = cur ? { ...cur, days: n2(cur.days + p.days), requests: cur.requests + p.requests } : { ...p };
      }
    }
    return {
      byPerson,
      days: n2(chosen.reduce((a, q) => a + q[k].days, 0)),
      requests: chosen.reduce((a, q) => a + q[k].requests, 0),
      people: Object.keys(byPerson).length,
      byType,
    };
  };
  const leave = sum('leave'), wfh = sum('wfh');
  const selLabel = sel.size === 4 ? 'Full year' : QS.filter((q) => sel.has(q)).map((q) => 'Q' + q).join(' + ');
  const partial = data?.dataFrom && data.dataFrom > `${year}-01-01` && data.dataFrom.slice(0, 4) === String(year);

  return (
    <section className="dash-sec year">
      <div className="dash-sec-head">
        <span className="dash-chip">▦</span>
        <h2>Quarter summary</h2>
        <Select title="Year" value={year} onChange={setYear} options={years.map((y) => ({ value: y, label: String(y) }))} />
        <div className="seg" role="group" aria-label="Quarters">
          {QS.map((q) => (
            <button type="button" key={q} className={'chip' + (sel.has(q) ? ' on' : '')} aria-pressed={sel.has(q)} onClick={() => toggle(q)}>Q{q}</button>
          ))}
        </div>
        <button type="button" className="link small" onClick={() => setSel(new Set(QS))} disabled={sel.size === 4}>All</button>
        {partial && <span className="muted small">Cache starts {fmtShort(data!.dataFrom!)} — earlier months are incomplete.</span>}
      </div>

      {!data ? <div className="widget"><div className="w-empty">Loading…</div></div> : (
        <Sortable grid units maxCols={4} minCol={290} id="dash.year" className="year-grid" items={[
          { key: 'totals', node: (
          <div className="widget" data-copy>
            <div className="w-head"><span className="w-title">Selected quarters</span><span className="w-range">{selLabel} {year}</span><CopyButton /></div>
            <div className="yr-totals">
              <Total label="Leave" color={SERIES[0].color} t={leave} />
              <Total label="Work from home" color={SERIES[1].color} t={wfh} />
            </div>
            <div className="q-cards">
              {quarters.map((q) => (
                <button type="button" key={q.q} className={'q-card' + (sel.has(q.q) ? ' on' : '')} onClick={() => toggle(q.q)}
                  title={`${sel.has(q.q) ? 'Remove' : 'Add'} Q${q.q}`}>
                  <span className="q-h"><b>Q{q.q}</b><span className="muted small">{MONTHS[(q.q - 1) * 3]}–{MONTHS[(q.q - 1) * 3 + 2]}</span></span>
                  <span className="q-v"><i style={{ background: SERIES[0].color }} />{n2(q.leave.days)} d<span className="muted"> · {q.leave.requests} req</span></span>
                  <span className="q-v"><i style={{ background: SERIES[1].color }} />{n2(q.wfh.days)} d<span className="muted"> · {q.wfh.requests} req</span></span>
                </button>
              ))}
            </div>
          </div>
          ) },
          { key: 'chart', className: 'span-2', node: (
          <div className="widget" data-copy>
            <div className="w-head">
              <span className="w-title">Leave and work from home by month</span>
              <CopyButton />
              <div className="seg small-seg" role="group" aria-label="Measure">
                {(['days', 'requests'] as Metric[]).map((m) => (
                  <button type="button" key={m} className={'chip' + (metric === m ? ' on' : '')} onClick={() => setMetric(m)}>{m === 'days' ? 'Days' : 'Requests'}</button>
                ))}
              </div>
            </div>
            <div className="legend-row">
              {SERIES.map((s) => <span key={s.key} className="lg"><i className="lg-line" style={{ background: s.color }} />{s.label}</span>)}
              <span className="lg"><i className="lg-band" />Selected quarters</span>
            </div>
            <LineChart months={data.months} metric={metric} sel={sel} year={year} today={data.today} />
          </div>
          ) },
          { key: 'leavePeople', node: (
          <PersonWidget title="Leave by person" range={selLabel} t={leave} color={SERIES[0].color} empty="Nobody took leave in the selected quarters." />
          ) },
          { key: 'wfhPeople', node: (
          <PersonWidget title="Work from home by person" range={selLabel} t={wfh} color={SERIES[1].color} empty="Nobody worked from home in the selected quarters." />
          ) },
          { key: 'types', node: (
          <div className="widget" data-copy>
            <div className="w-head"><span className="w-title">Leave by type</span><span className="w-range">{selLabel}</span><CopyButton /></div>
            <TypeMeters byType={leave.byType} color={color} />
            {Object.keys(wfh.byType).length > 0 && (
              <>
                <div className="w-head"><span className="w-title">Work from home by type</span></div>
                <TypeMeters byType={wfh.byType} color={color} />
              </>
            )}
          </div>
          ) },
        ]} />
      )}
    </section>
  );
}

type SortBy = 'days' | 'requests';

/** people ranked over the selected quarters; bars on a shared scale */
function PersonWidget({ title, range, t, color, empty }: { title: string; range: string; t: KindTotals; color: string; empty: string }) {
  const [by, setBy] = useState<SortBy>('days');
  const [mode, setMode] = useListMode('year:' + title, 'rows');
  const rows = Object.entries(t.byPerson)
    .sort((a, b) => b[1][by] - a[1][by] || b[1][by === 'days' ? 'requests' : 'days'] - a[1][by === 'days' ? 'requests' : 'days'] || a[1].person.localeCompare(b[1].person));
  const max = rows[0]?.[1][by] ?? 0;
  const rankOf = new Map(rows.map(([id], i) => [id, i]));
  return (
    <div className="widget" data-copy>
      <div className="w-head">
        <span className="w-title">{title}</span>
        <span className="w-range">{range}</span>
        <CopyButton />
      </div>
      <div className="w-count">{rows.length}<small> {rows.length === 1 ? 'person' : 'people'}</small></div>
      <div className="w-pills">
        <span className="muted small">{n2(t.days)} days · {t.requests} requests · sort by</span>
        <div className="seg small-seg" role="group" aria-label="Sort by">
          {(['days', 'requests'] as SortBy[]).map((k) => (
            <button type="button" key={k} className={'chip' + (by === k ? ' on' : '')} onClick={() => setBy(k)}>{k === 'days' ? 'Days' : 'Requests'}</button>
          ))}
        </div>
        {rows.length > 0 && <ListModeSwitch mode={mode} onChange={setMode} rowsLabel="Ranked" />}
      </div>
      <div className="w-list">
        <TeamFlow counts rows={mode === 'rows'} people={rows.map(([id, p]) => ({
          key: id, name: p.person, team: p.team, status: 'planned',
          meter: max ? p[by] / max : 0, meterColor: color,
          value: by === 'days' ? <>{n2(p.days)} d<span className="muted"> · {p.requests} req</span></> : <>{p.requests} req<span className="muted"> · {n2(p.days)} d</span></>,
          lead: <span className="sd-lead">{rankOf.get(id)! + 1}</span>,
          suffix: by === 'days' ? `${n2(p.days)}d` : `${p.requests} req`,
          title: `${p.person} · ${p.team}: ${fmtDays(p.days)}, ${p.requests} request${p.requests === 1 ? '' : 's'}`,
          detail: mode === 'rows' ? undefined : <>
            <span className="sd-meter"><span style={{ width: `${max ? (p[by] / max) * 100 : 0}%`, background: color }} /></span>
            <span>{by === 'days' ? `${p.requests} req` : `${n2(p.days)} d`}</span>
          </>,
        }))} meta={(team) => {
          const list = rows.filter(([, p]) => p.team === team);
          return <span className="muted small">· {n2(list.reduce((a, [, p]) => a + p.days, 0))} d · {list.reduce((a, [, p]) => a + p.requests, 0)} req</span>;
        }} />
        {!rows.length && <div className="w-empty">{empty}</div>}
      </div>
    </div>
  );
}

function Total({ label, color, t }: { label: string; color: string; t: KindTotals }) {
  return (
    <div className="yr-total">
      <span className="lg"><i style={{ background: color }} />{label}</span>
      <span className="w-count">{n2(t.days)}<small> days</small></span>
      <span className="muted small">{t.requests} request{t.requests === 1 ? '' : 's'}</span>
    </div>
  );
}

/** meter list: one row per type, bars on a shared scale */
function TypeMeters({ byType, color }: { byType: Record<string, number>; color: (t: string) => string }) {
  const rows = Object.entries(byType).sort((a, b) => b[1] - a[1]);
  const max = rows[0]?.[1] ?? 0;
  if (!rows.length) return <div className="w-empty">Nothing in the selected quarters.</div>;
  return (
    <div className="meters">
      {rows.map(([t, v]) => (
        <div key={t} className="meter" title={`${t}: ${fmtDays(v)}`}>
          <span className="meter-n">{t}</span>
          <span className="meter-bar"><span style={{ width: `${(v / max) * 100}%`, background: color(t) }} /></span>
          <span className="meter-v">{n2(v)} d</span>
        </div>
      ))}
    </div>
  );
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** two series on one days (or requests) axis; hover = crosshair + tooltip */
function LineChart({ months, metric, sel, year, today }: { months: MonthSummary[]; metric: Metric; sel: Set<Q>; year: number; today: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const H = 200, P = { l: 34, r: 12, t: 12, b: 24 };
  const W = Math.max(width, 280);
  const iw = W - P.l - P.r, ih = H - P.t - P.b;
  const val = (m: MonthSummary, k: 'leave' | 'wfh') => (metric === 'days' ? m[k].days : m[k].requests);
  const rawMax = Math.max(1, ...months.flatMap((m) => [val(m, 'leave'), val(m, 'wfh')]));
  const step = niceStep(rawMax / 4);
  const yMax = Math.ceil(rawMax / step) * step;
  const ticks = Array.from({ length: Math.round(yMax / step) + 1 }, (_, i) => i * step);
  const bw = iw / 12;
  const x = (i: number) => P.l + bw * i + bw / 2;
  const y = (v: number) => P.t + ih - (v / yMax) * ih;
  const path = (k: 'leave' | 'wfh') => months.map((m, i) => `${i ? 'L' : 'M'}${x(i)},${y(val(m, k))}`).join(' ');
  const nowYear = Number(today.slice(0, 4)), nowMonth = Number(today.slice(5, 7)) - 1;
  const todayX = nowYear === year ? P.l + bw * nowMonth + bw * ((Number(today.slice(8, 10)) - 1) / 31) : null;

  return (
    <div className="line-chart" ref={ref} onMouseLeave={() => setHover(null)}
      data-copy-table={copyTable([['Month', 'Leave days', 'Leave requests', 'WFH days', 'WFH requests'], ...months.map((m) => [m.month, m.leave.days, m.leave.requests, m.wfh.days, m.wfh.requests])])}>
      {width > 0 && (
        <svg width={W} height={H} role="img" aria-label={`Leave and work from home ${metric} per month, ${year}`}>
          {QS.filter((q) => sel.has(q)).map((q) => (
            <rect key={q} className="q-band" x={P.l + bw * (q - 1) * 3} y={P.t} width={bw * 3} height={ih} />
          ))}
          {ticks.map((t) => (
            <g key={t}>
              <line className="grid" x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} />
              <text className="tick" x={P.l - 6} y={y(t)} dy="0.32em" textAnchor="end">{t}</text>
            </g>
          ))}
          {MONTHS.map((m, i) => {
            const cur = nowYear === year && i === nowMonth;
            return (
              <g key={m}>
                {cur && <rect className="tick-cur-bg" x={x(i) - 17} y={H - 18} width={34} height={16} rx={8} />}
                <text className={'tick' + (cur ? ' tick-cur' : '')} x={x(i)} y={H - 6} textAnchor="middle">{m}</text>
              </g>
            );
          })}
          {[1, 2, 3].map((q) => <line key={q} className="q-sep" x1={P.l + bw * q * 3} x2={P.l + bw * q * 3} y1={P.t} y2={P.t + ih} />)}
          {todayX !== null && (
            <g>
              <line className="today-line" x1={todayX} x2={todayX} y1={P.t} y2={P.t + ih} />
              <text className="tick today-t" x={todayX + 3} y={P.t + 8}>today</text>
            </g>
          )}
          {hover !== null && <line className="crosshair" x1={x(hover)} x2={x(hover)} y1={P.t} y2={P.t + ih} />}
          {SERIES.map((s) => (
            <g key={s.key}>
              <path d={path(s.key)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              {months.map((m, i) => (
                <circle key={i} cx={x(i)} cy={y(val(m, s.key))} r={hover === i ? 4.5 : 3} fill={s.color} className="pt" />
              ))}
            </g>
          ))}
          {months.map((_, i) => (
            <rect key={i} x={P.l + bw * i} y={P.t} width={bw} height={ih} fill="transparent" onMouseEnter={() => setHover(i)} />
          ))}
        </svg>
      )}
      {hover !== null && width > 0 && (
        <div className="chart-tip" style={{ left: Math.min(x(hover) + 10, W - 170), top: 10 }}>
          <b>{MONTHS[hover]} {year}</b>
          {SERIES.map((s) => (
            <div key={s.key} className="tip-row">
              <i style={{ background: s.color }} />{s.label}
              <span>{n2(months[hover][s.key].days)} d · {months[hover][s.key].requests} req</span>
            </div>
          ))}
          <div className="muted small">{months[hover].leave.people} on leave · {months[hover].wfh.people} WFH</div>
        </div>
      )}
    </div>
  );
}

function niceStep(raw: number) {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 0.5))));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}
