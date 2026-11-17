// Long leave tab: runs of consecutive working days away, over a chosen month
// range (a preset or any from/to months, crossing years if needed).
// Long = 10+ working days, mini = 5–9. Each kind gets a summary, a month
// chart (approved vs still-planned) and a month-by-month view with a small
// track showing where in the month each run falls.
import { CopyButton } from '../components/CopyButton.tsx';
import { copyTable } from '../copy.ts';
import { useEffect, useState } from 'react';
import { api } from '../api.ts';
import { openInBamboo } from '../bamboo-link.ts';
import { Sortable } from '../components/Sortable.tsx';
import { autoLayout, resetLayouts } from '../state/layout.ts';
import { fmtAgo, fmtDay, fmtShort } from '../format.ts';
import type { LeaveRun, LongLeaveYear, MonthRuns, UiFilters } from '../types.ts';
import { ListModeSwitch, PeopleFlow, TeamFlow } from '../components/PeopleFlow.tsx';
import { useListMode } from '../state/listMode.ts';
import { MonthRangePicker } from '../components/MonthRange.tsx';
import { MONTH_PRESETS, monthName, normRange, rangeLabel, ym, type MonthRange } from '../months.ts';

type Show = 'planned' | 'draft';
const STATUS_TXT: Record<LeaveRun['status'], string> = { planned: 'Approved', draft: 'Planned', mixed: 'Partly approved' };
const n2 = (n: number) => +n.toFixed(2);
const dnum = (d: string) => Number(d.slice(8, 10));
/** "1–14 Jul", or "20 Jul – 4 Aug" across months */
const shortRange = (a: string, b: string) => (a === b ? fmtShort(a)
  : a.slice(0, 7) === b.slice(0, 7) ? `${dnum(a)}–${fmtShort(b)}` : `${fmtShort(a)} – ${fmtShort(b)}`);

/** the board for a range: the year payloads merged and cut to the range */
interface Board { today: string; months: MonthRuns[]; long: LeaveRun[]; mini: LeaveRun[]; label: string; multiYear: boolean }
type Range = MonthRange;
const norm = normRange;
const LL_PRESETS = ['next3', 'next6', 'next12', 'year', 'nextyear'];

const RANGE_KEY = 'longleave:range';
const typesKey = (kind: string) => `longleave:hiddenTypes:${kind}`;
function loadHidden(kind: string): Set<string> {
  try { const a = JSON.parse(localStorage.getItem(typesKey(kind)) ?? '[]'); return new Set(Array.isArray(a) ? a.map(String) : []); } catch { return new Set(); }
}
function saveHidden(kind: string, s: Set<string>) { try { localStorage.setItem(typesKey(kind), JSON.stringify([...s])); } catch { /* private mode */ } }
function loadRange(): Range {
  try {
    const r = JSON.parse(localStorage.getItem(RANGE_KEY) ?? 'null');
    if (r && /^\d{4}-\d{2}$/.test(r.from) && /^\d{4}-\d{2}$/.test(r.to)) return norm(r);
  } catch { /* private mode */ }
  return MONTH_PRESETS.find((p) => p.id === 'year')!.range(new Date().toLocaleDateString('en-CA'));
}
function saveRange(r: Range) { try { localStorage.setItem(RANGE_KEY, JSON.stringify(r)); } catch { /* private mode */ } }

function merge(list: LongLeaveYear[], r: Range): Board {
  const inRange = (x: LeaveRun) => ym(x.end) >= r.from && ym(x.start) <= r.to;
  const uniq = (runs: LeaveRun[]) => [...new Map(runs.filter(inRange).map((x) => [x.id, x])).values()]
    .sort((a, b) => a.start.localeCompare(b.start));
  const multiYear = r.from.slice(0, 4) !== r.to.slice(0, 4);
  const label = rangeLabel(r);
  return {
    today: list[0].today,
    months: list.flatMap((y) => y.months).filter((m) => m.month >= r.from && m.month <= r.to),
    long: uniq(list.flatMap((y) => y.long)),
    mini: uniq(list.flatMap((y) => y.mini)),
    label, multiYear,
  };
}

export function LongLeaveView({ filters, version, typeOrder = [], onRefresh, syncing, lastSyncAt }: {
  filters: UiFilters; typeOrder?: string[]; version: number; onRefresh: () => void; syncing: boolean; lastSyncAt: string | null;
}) {
  const [range, setRangeState] = useState<Range>(loadRange);
  const setRange = (r: Range) => { const v = norm(r); setRangeState(v); saveRange(v); };
  const [show, setShow] = useState<Set<Show>>(() => new Set<Show>(['planned', 'draft']));
  const [data, setData] = useState<Board | null>(null);
  const [years, setYears] = useState<number[]>(() => { const y = new Date().getFullYear(); return [y - 1, y, y + 1]; });
  const who = JSON.stringify([filters.teams, filters.people, filters.locations]);

  // one request per calendar year the range touches, merged into one board
  useEffect(() => {
    let live = true;
    const ys: number[] = [];
    for (let y = Number(range.from.slice(0, 4)); y <= Number(range.to.slice(0, 4)); y++) ys.push(y);
    void Promise.all(ys.map((y) => api.getLongLeave(filters, y))).then((list) => {
      if (!live) return;
      setData(merge(list, range));
      const nowYear = Number(list[0].today.slice(0, 4));
      const first = Math.min(nowYear, Number((list[0].dataFrom ?? '').slice(0, 4)) || nowYear);
      setYears(Array.from({ length: nowYear + 1 - first + 1 }, (_, i) => first + i));
    });
    return () => { live = false; };
  }, [range.from, range.to, who, version]); // eslint-disable-line react-hooks/exhaustive-deps

  const [launchDay] = useState(() => new Date().toLocaleDateString('en-CA'));
  const today = data?.today ?? launchDay;
  const toggle = (s: Show) => setShow((cur) => {
    const n = new Set(cur);
    if (n.has(s)) { if (n.size > 1) n.delete(s); } else n.add(s);
    return n;
  });
  // a run is shown if any of its requests has a shown status
  const keep = (r: LeaveRun) => r.status === 'mixed' || show.has(r.status);

  return (
    <div className="dash-wrap">
      <div className="dash-bar ll-bar">
        <MonthRangePicker value={range} onChange={setRange} today={today} years={years} presets={LL_PRESETS} />
        <div className="seg" role="group" aria-label="Status">
          <button type="button" className={'chip planned' + (show.has('planned') ? ' on' : '')} onClick={() => toggle('planned')}><span className="dot planned" /> Approved</button>
          <button type="button" className={'chip draft' + (show.has('draft') ? ' on' : '')} onClick={() => toggle('draft')}><span className="dot draft" /> Planned</button>
        </div>
        <span className="ll-info" tabIndex={0} title="Only scheduled leave counts: work from home, sick leave and substitute leave are left out, and a day of them breaks a run. Leave is counted in consecutive working days — weekends and holidays don't break a run, and back-to-back scheduled requests join up." aria-label="How leave is counted">i</span>
        <div className="spacer" />
        <button type="button" className="auto-layout" onClick={autoLayout}
            title="Arrange every widget for this window: time order (today → week → month → …), charts wide, rows filled edge to edge">
            <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><rect x="1.5" y="1.5" width="6" height="5" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.4" /><rect x="9" y="1.5" width="5.5" height="8" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.4" /><rect x="1.5" y="8.5" width="6" height="6" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.4" /><rect x="9" y="11.5" width="5.5" height="3" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>
            Auto layout
          </button>
          <button type="button" className="link small" onClick={resetLayouts} title="Put every section and widget back in its default order">Reset layout</button>
        <span className="muted small">{syncing ? 'Fetching the latest from BambooHR…' : `Data from ${fmtAgo(lastSyncAt)}`}</span>
        <button type="button" className={'refresh' + (syncing ? ' spinning' : '')} onClick={onRefresh} disabled={syncing} title="Refresh — sync the latest data from BambooHR (⌘R)">
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            <path d="M12.6 1.6v3.1H9.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>{syncing ? 'Refreshing' : 'Refresh'}</span>
        </button>
      </div>

      {!data ? <div className="empty">Loading…</div> : (
        <Sortable id="ll.sections" label="section" className="dash-sections" items={[
          { key: 'long', node: <KindSection kind="long" title="Long leave" rule="10+ working days in a row" data={data} keep={keep} typeOrder={typeOrder} /> },
          { key: 'mini', node: <KindSection kind="mini" title="Mini leave" rule="5–9 working days in a row" data={data} keep={keep} typeOrder={typeOrder} /> },
        ]} />
      )}
    </div>
  );
}

function KindSection({ kind, title, rule, data, keep, typeOrder }: {
  kind: 'long' | 'mini'; title: string; rule: string; data: Board; keep: (r: LeaveRun) => boolean; typeOrder: string[];
}) {
  const runs = data[kind].filter(keep);
  const months = data.months.map((m) => ({ ...m, runs: m[kind].filter(keep) }));
  const people = new Set(runs.map((r) => r.employeeId)).size;
  const days = runs.reduce((a, r) => a + r.days, 0);
  const counts = { planned: 0, draft: 0, mixed: 0 };
  for (const r of runs) counts[r.status]++;
  // the next leave to start in each team (runs are in start order)
  const nextPerTeam = [...new Map(runs.filter((r) => r.start > data.today).reverse().map((r) => [r.team, r])).values()]
    .sort((a, b) => a.start.localeCompare(b.start));
  const now = runs.filter((r) => r.start <= data.today && r.end >= data.today);
  const curMonth = data.today.slice(0, 7);
  const [sumMode, setSumMode] = useListMode('ll-summary:' + kind);
  const [cardMode, setCardMode] = useListMode('ll-months:' + kind);

  return (
    <section className={'dash-sec ll ' + kind}>
      <div className="dash-sec-head">
        <span className="dash-chip">{kind === 'long' ? '✈︎' : '☀︎'}</span>
        <h2>{title}</h2>
        <span className="muted small">{rule} · {data.label} · scheduled leave only</span>
        <span className="dash-sec-tools"><span className="muted small">Month cards</span><ListModeSwitch mode={cardMode} onChange={setCardMode} /></span>
      </div>

      <Sortable grid minCol={300} id={'ll.' + kind} className="year-grid" items={[
        { key: 'summary', node: (
        <div className="widget" data-copy>
          <div className="w-head"><span className="w-title">{title}</span><span className="w-range">{data.label}</span><CopyButton /></div>
          <div className="yr-totals">
            <div className="yr-total"><span className="w-count">{runs.length}<small> {runs.length === 1 ? 'leave' : 'leaves'}</small></span><span className="muted small">{people} {people === 1 ? 'person' : 'people'}</span></div>
            <div className="yr-total"><span className="w-count">{n2(days)}<small> days</small></span><span className="muted small">working days away</span></div>
          </div>
          <div className="w-pills">
            <span className="pill planned"><span className="dot planned" />Approved <b>{counts.planned}</b></span>
            <span className="pill draft"><span className="dot draft" />Planned <b>{counts.draft}</b></span>
            {counts.mixed > 0 && <span className="pill draft"><span className="dot mixed" />Partly approved <b>{counts.mixed}</b></span>}
          </div>
          {(now.length > 0 || nextPerTeam.length > 0) && <div className="w-tools"><ListModeSwitch mode={sumMode} onChange={setSumMode} /></div>}
          <div className="ll-now">
            <div>
              <div className="ll-now-h">Away now <span className="muted small">{now.length}</span></div>
              {now.length ? <TeamGroups runs={now} rows={sumMode === 'rows'} /> : <div className="w-empty">Nobody</div>}
            </div>
            <div>
              <div className="ll-now-h">Next to start <span className="muted small">per team</span></div>
              {nextPerTeam.length ? <TeamGroups runs={nextPerTeam} rows={sumMode === 'rows'} /> : <div className="w-empty">Nothing booked</div>}
            </div>
          </div>
        </div>
        ) },
        { key: 'chart', className: 'span-2', node: (
        <div className="widget" data-copy>
          <div className="w-head"><span className="w-title">{title} by month</span><span className="w-range">{data.label}</span><CopyButton /></div>
          <div className="legend-row">
            <span className="muted">Leaves starting or running in each month ·</span>
            <span className="lg"><i style={{ background: 'var(--planned-bg)' }} />Approved</span>
            <span className="lg"><i style={{ background: 'var(--draft-bg)' }} />Planned</span>
            <span className="lg"><i className="mixed-sw" />Partly approved</span>
          </div>
          <MonthColumns kind={kind} months={months} curMonth={curMonth} multiYear={data.multiYear} typeOrder={typeOrder} />
        </div>
        ) },
      ]} />

      <div className="month-grid">
        {months.map((m) => (
          <MonthCard key={m.month} m={m} runs={m.runs} name={monthName(m.month, data.multiYear, true)}
            when={m.month === curMonth ? 'current' : m.month < curMonth ? 'past' : 'future'} today={data.today} rows={cardMode === 'rows'} />
        ))}
      </div>
    </section>
  );
}

/** count of runs per month, stacked approved / planned / mixed */
function MonthColumns({ kind, months: allMonths, curMonth, multiYear, typeOrder }: {
  kind: 'long' | 'mini'; months: (MonthRuns & { runs: LeaveRun[] })[]; curMonth: string; multiYear: boolean; typeOrder: string[];
}) {
  const [pick, setPick] = useState<string | null>(null); // one month, or null = every month
  const [mode, setMode] = useListMode('ll-bymonth:' + kind);
  // leave types: every type in these months, in the app's type order (same
  // colours as the Dashboard); unticked types drop out of chart and list
  const [stored, setHidden] = useState<Set<string>>(() => loadHidden(kind));
  const runsAll = [...new Map(allMonths.flatMap((m) => m.runs).map((r) => [r.id, r])).values()];
  const types = [...new Set(runsAll.flatMap((r) => r.types))]
    .sort((a, b) => (typeOrder.indexOf(a) + 1 || 999) - (typeOrder.indexOf(b) + 1 || 999) || a.localeCompare(b));
  // a saved choice that would hide every type here (other months, other data) shows all instead
  const hidden = types.length && types.every((t) => stored.has(t)) ? new Set<string>() : stored;
  const color = (t: string) => { const i = [...new Set([...typeOrder, ...types])].indexOf(t); return i >= 0 && i < 8 ? `var(--c${i + 1})` : 'var(--c-other)'; };
  const shownRun = (r: LeaveRun) => r.types.some((t) => !hidden.has(t));
  const months = allMonths.map((m) => ({ ...m, runs: m.runs.filter(shownRun) }));
  const setTypes = (next: Set<string>) => { setHidden(next); saveHidden(kind, next); };
  const flip = (t: string) => {
    const next = new Set(hidden);
    if (next.has(t)) next.delete(t); else next.add(t);
    if (types.every((x) => next.has(x))) return; // keep at least one type on
    setTypes(next);
  };
  const only = (t: string) => setTypes(new Set(types.filter((x) => x !== t)));
  const perType = (t: string) => runsAll.filter((r) => r.types.includes(t)).length;
  const offCount = types.filter((t) => hidden.has(t)).length;
  const max = Math.max(1, ...months.map((m) => m.runs.length));
  const listed = months.filter((m) => m.runs.length && (!pick || m.month === pick));
  /** leaves that began in an earlier month and run on into this one */
  const carried = (m: MonthRuns & { runs: LeaveRun[] }) => m.runs.filter((r) => r.start < m.from).length;
  return (
    <div className="mcols-wrap">
      {types.length > 0 && (
        <div className="ltypes" role="group" aria-label="Leave types">
          {types.map((t) => (
            <button type="button" key={t} className={'ltype' + (hidden.has(t) ? ' off' : '')} aria-pressed={!hidden.has(t)}
              style={{ '--tc': color(t) } as React.CSSProperties}
              title={`${hidden.has(t) ? 'Show' : 'Hide'} ${t} · double-click: only ${t}`}
              onClick={() => flip(t)} onDoubleClick={() => only(t)}>
              <i />{t}<b>{perType(t)}</b>
            </button>
          ))}
          {offCount > 0 && <button type="button" className="link small" onClick={() => setTypes(new Set())}>Show all types</button>}
        </div>
      )}
      <div className="mcols" data-copy-table={copyTable([['Month', 'Leaves', 'Approved', 'Planned', 'Partly approved'], ...months.map((m) => {
        const c = { planned: 0, draft: 0, mixed: 0 };
        for (const r of m.runs) c[r.status]++;
        return [m.month, m.runs.length, c.planned, c.draft, c.mixed];
      })])}>
        {months.map((m) => {
          const c = { planned: 0, draft: 0, mixed: 0 };
          for (const r of m.runs) c[r.status]++;
          return (
            <button type="button" key={m.month}
              className={'mcol' + (m.month === curMonth ? ' cur' : '') + (pick === m.month ? ' picked' : '') + (pick && pick !== m.month ? ' dim' : '')}
              onClick={() => setPick(pick === m.month ? null : m.month)} aria-pressed={pick === m.month}
              title={`${monthName(m.month, true, true)}: ${m.runs.length} — ${c.planned} approved, ${c.draft} planned${c.mixed ? `, ${c.mixed} partly approved` : ''}${carried(m) ? `\n${carried(m)} started in an earlier month and continue into this one` : ''}\nClick to list only this month`}>
              <span className="mcol-v">{m.runs.length || ''}</span>
              <span className="mcol-stack" style={{ height: `${(m.runs.length / max) * 100}%` }}>
                {c.mixed > 0 && <span className="seg-mixed" style={{ flexGrow: c.mixed }} />}
                {c.draft > 0 && <span className="seg-draft" style={{ flexGrow: c.draft }} />}
                {c.planned > 0 && <span className="seg-planned" style={{ flexGrow: c.planned }} />}
              </span>
              <span className="mcol-l">{monthName(m.month, false)}{multiYear && (m.month.endsWith('-01') || m === months[0]) && <small className="mcol-y">{m.month.slice(2, 4)}</small>}</span>
            </button>
          );
        })}
      </div>

      <div className="mnames-head">
        <span className="w-title">{pick ? `People in ${monthName(pick, multiYear, true)}` : 'People by month'}</span>
        {pick
          ? <button type="button" className="link small" onClick={() => setPick(null)}>Show all months</button>
          : <span className="muted small">click a month to focus it</span>}
        <ListModeSwitch mode={mode} onChange={setMode} />
      </div>
      <PeopleFlow unit="months" detailed rows={mode === 'rows'} blocks={listed.map((m) => ({
        key: m.month,
        // the year goes on the sub-line, so the label column stays narrow
        label: m.month === curMonth ? <span className="month-cur">{monthName(m.month, false)}</span> : monthName(m.month, false),
        sub: <>{multiYear && <>{m.month.slice(0, 4)}<br /></>}{m.runs.length} {m.runs.length === 1 ? 'leave' : 'leaves'}
          {carried(m) > 0 && <><br /><span className="sd-carried" title="Started in an earlier month and continue into this one">↩ {carried(m)} carried</span></>}</>,
        current: m.month === curMonth, past: m.month < curMonth,
        people: m.runs.map((r) => ({
          key: r.id, name: r.person, team: r.team, status: r.status, suffix: `${n2(r.days)}d`,
          detail: <>
            {r.types.filter((t) => !hidden.has(t)).map((t) => <span key={t} className="sd-type" style={{ '--tc': color(t) } as React.CSSProperties}><i />{t}</span>)}
            <span className="sd-when">{shortRange(r.start, r.end)}</span>
            {r.start < m.from && <span className="sd-cont" title={`Started in ${monthName(ym(r.start), true, true)} — shown here for the days in ${monthName(m.month, true, true)}`}>↩ started {monthName(ym(r.start), ym(r.start).slice(0, 4) !== m.month.slice(0, 4))}</span>}
          </>,
          title: `${r.person} · ${r.team}\n${r.types.join(', ')}\n${fmtDay(r.start)} – ${fmtDay(r.end)} · ${n2(r.days)} working days\n${STATUS_TXT[r.status]}${r.start < m.from ? `\nStarted in ${monthName(ym(r.start), true, true)}; continues into ${monthName(m.month, false, true)}` : ''}`,
        })),
      }))} empty={<div className="w-empty">{offCount ? 'Nobody with the selected leave types.' : 'Nobody in these months.'}</div>} />
    </div>
  );
}

function MonthCard({ m, runs, name, when, today, rows }: { m: MonthRuns; runs: LeaveRun[]; name: string; when: 'past' | 'current' | 'future'; today: string; rows?: boolean }) {
  return (
    <div className={'widget month-card ' + when + (runs.length ? '' : ' empty-m')} data-copy>
      <div className="w-head">
        <MonthLabel name={name} current={when === 'current'} />
        <span className="pill">{runs.length} {runs.length === 1 ? 'leave' : 'leaves'}</span>
        {runs.length > 0 && <CopyButton />}
      </div>
      {runs.length ? <TeamGroups runs={runs} month={m} today={today} rows={rows} /> : <div className="w-empty">No one away</div>}
    </div>
  );
}

/** a month's name — the current month as the solid pill, everywhere */
function MonthLabel({ name, current, count }: { name: string; current: boolean; count?: number }) {
  return (
    <span className="month-label">
      {current ? <span className="month-cur">{name}</span> : <span className="w-title">{name}</span>}
      {count !== undefined && <span className="muted small">{count}</span>}
    </span>
  );
}

/** runs in the shared team list; with `month`, each person's detail line
 *  says where the leave sits relative to that month */
function TeamGroups({ runs, month, rows }: { runs: LeaveRun[]; month?: MonthRuns; today?: string; rows?: boolean }) {
  return <TeamFlow counts rows={rows} people={runs.map((r) => ({
    key: r.id, name: r.person, team: r.team, status: r.status, suffix: `${n2(r.days)}d`,
    title: `${r.person} · ${r.team}\n${r.types.join(', ')}\n${fmtDay(r.start)} – ${fmtDay(r.end)} · ${n2(r.days)} working days\n${STATUS_TXT[r.status]}`,
    detail: <>
      <span>{r.types.join(', ')}</span>
      <span className="sd-when">{shortRange(r.start, r.end)}</span>
      {month && r.start < month.from && <span className="sd-cont">↩ started {monthName(ym(r.start), false)}</span>}
      {month && r.end > month.to && <span className="sd-cont">continues →</span>}
      {r.status !== 'planned' && <span className={r.status === 'draft' ? 'draft-text' : ''}>{STATUS_TXT[r.status]}</span>}
    </>,
    actions: r.requests[0]?.url ? <button type="button" className="link small" title="Open in BambooHR" onClick={() => openInBamboo(r.requests[0].url!)}>↗</button> : undefined,
  }))} />;
}
