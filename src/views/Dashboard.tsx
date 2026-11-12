// Quick dashboard: the same five widgets for leave and for work-from-home —
// today, next week, this month, same-day clashes this month, and people
// ranked by days this month. Lists are grouped by leave type; each type keeps
// one colour everywhere (fixed categorical order from the full type list, so
// a filter never repaints the survivors). Fixed windows; only squad / person
// / location filters apply.
import { createContext, useContext, useMemo, useState } from 'react';
import { openInBamboo } from '../bamboo-link.ts';
import { approveLeave } from '../approve.ts';
import { fmtAgo, fmtDay, fmtDays, fmtMonth, fmtRange, fmtShort, STATUS_LABEL } from '../format.ts';
import { Sortable } from '../components/Sortable.tsx';
import { resetLayouts } from '../state/layout.ts';
import { YearSection } from './YearSummary.tsx';
import type { UiFilters, AppStatus, DailyPoint, Dashboard, DashItem, DashPeriod, DashSection, Ranked, SameDay, SprintLeave } from '../types.ts';

const monthLong = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
const SLOTS = 8; // categorical slots in index.css (--c1..--c8); past that, "other" grey
const TypeColors = createContext<(type: string) => string>(() => 'var(--c-other)');
const useColor = () => useContext(TypeColors);
const n2 = (n: number) => +n.toFixed(2);

export function DashboardView({ data, typeOrder, onRefresh, syncing, lastSyncAt, filters, version }: {
  data: Dashboard | null;
  filters: UiFilters;
  version: number;
  typeOrder: string[];
  onRefresh: () => void;
  syncing: boolean;
  lastSyncAt: string | null;
}) {
  const color = useMemo(() => {
    const order = [...new Set([...typeOrder, ...(data?.types ?? [])])];
    const idx = new Map(order.map((t, i) => [t, i]));
    return (t: string) => { const i = idx.get(t) ?? SLOTS; return i < SLOTS ? `var(--c${i + 1})` : 'var(--c-other)'; };
  }, [typeOrder, data?.types]);

  if (!data) return <div className="empty">Loading…</div>;
  return (
    <TypeColors.Provider value={color}>
      <div className="dash-wrap">
        <div className="dash-bar">
          <button type="button" className="link small" onClick={resetLayouts} title="Put every section and widget back in its default order">Reset layout</button>
          <span className="muted small">{syncing ? 'Fetching the latest from BambooHR…' : `Data from ${fmtAgo(lastSyncAt)}`}</span>
          <button type="button" className={'refresh' + (syncing ? ' spinning' : '')} onClick={onRefresh} disabled={syncing}
            title="Refresh — sync the latest data from BambooHR (⌘R)" aria-label="Refresh data">
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              <path d="M12.6 1.6v3.1H9.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>{syncing ? 'Refreshing' : 'Refresh'}</span>
          </button>
        </div>
        <Sortable id="dash.sections" label="section" className="dash-sections" items={[
          { key: 'leave', node: <Section title="Leave" kind="leave" s={data.leave} d={data} /> },
          { key: 'sprint', node: <SprintSection sprints={data.sprints} /> },
          { key: 'wfh', node: <Section title="Work from home" kind="wfh" s={data.wfh} d={data}
            note={data.wfhTypes.length ? data.wfhTypes.join(', ') : 'No work-from-home type found — book WFH in BambooHR as a time-off type named like “Work From Home” or “WFH”.'} /> },
          { key: 'year', node: <YearSection filters={filters} version={version} color={color} /> },
        ]} />
      </div>
    </TypeColors.Provider>
  );
}

function Section({ title, kind, s, d, note }: { title: string; kind: 'leave' | 'wfh'; s: DashSection; d: Dashboard; note?: string }) {
  const month = fmtMonth(d.month.from);
  const k = kind === 'leave' ? 'Leave' : 'WFH';
  return (
    <section className={'dash-sec ' + kind}>
      <div className="dash-sec-head">
        <span className="dash-chip">{kind === 'leave' ? '☀︎' : '⌂'}</span>
        <h2>{title} <span className="h2-sep">·</span> <span className="month-cur h2-month">{monthLong.format(new Date(d.month.from + 'T00:00:00Z'))}</span></h2>
        {note && <span className="muted small">{note}</span>}
      </div>
      <Sortable id={'dash.' + kind} className="dash-grid" items={[
        { key: 'today', node: <PeriodWidget title={`${k} today`} range={fmtDay(d.today)} p={s.today} statuses={['planned', 'draft', 'denied']} /> },
        { key: 'nextWeek', node: <PeriodWidget title={`${k} next week`} range={fmtRange(d.nextWeek.from, d.nextWeek.to)} p={s.nextWeek} statuses={['planned', 'draft']} /> },
        { key: 'month', node: <PeriodWidget title={`${k} this month`} range={month} p={s.month} statuses={['planned', 'draft']} /> },
        { key: 'sameDay', node: <SameDayWidget title={`${k} on the same day`} range={month} days={s.sameDay} daily={s.daily} today={d.today} /> },
        { key: 'ranking', node: <RankWidget title={`${k} by person`} range={month} rows={s.ranking} /> },
      ]} />
    </section>
  );
}

function Widget({ title, range, count, unit, children, extra, className, badge }: {
  title: string; range: string; count: number; unit: string; children: React.ReactNode; extra?: React.ReactNode;
  className?: string; badge?: React.ReactNode;
}) {
  return (
    <div className={'widget' + (className ? ' ' + className : '')}>
      <div className="w-head">
        <span className="w-title">{title}{badge}</span>
        <span className="w-range">{range}</span>
      </div>
      <div className="w-count">{count}<small> {unit}</small></div>
      {extra}
      <div className="w-list">{children}</div>
    </div>
  );
}

// ---- charts ------------------------------------------------------------------

/** one whole split by type: a thin segmented bar + a legend that carries the numbers */
function TypeSplit({ parts, unit }: { parts: [string, number][]; unit: (n: number) => string }) {
  const color = useColor();
  const total = parts.reduce((a, [, v]) => a + v, 0);
  if (!total) return null;
  return (
    <div className="split">
      <div className="split-bar" role="img" aria-label={parts.map(([t, v]) => `${t} ${unit(v)}`).join(', ')}>
        {parts.map(([t, v]) => (
          <span key={t} className="split-seg" style={{ flexGrow: v, background: color(t) }} title={`${t}: ${unit(v)} (${Math.round((v / total) * 100)}%)`} />
        ))}
      </div>
      <div className="legend-row">
        {parts.map(([t, v]) => (
          <span key={t} className="lg"><i style={{ background: color(t) }} />{t} <b>{n2(v)}</b></span>
        ))}
      </div>
    </div>
  );
}

/** working days of the month, people away per day; clash days (2+) in the accent */
function DailyColumns({ daily, today }: { daily: DailyPoint[]; today: string }) {
  const max = Math.max(2, ...daily.map((d) => d.people));
  return (
    <div className="cols-wrap">
      <div className="cols" role="img" aria-label="People away per working day">
        <span className="cols-ref" style={{ bottom: `${(2 / max) * 100}%` }} title="2 people" />
        {daily.map((d) => (
          <span key={d.day} className={'col-hit' + (d.day === today ? ' today' : '')}
            title={`${fmtDay(d.day)} · ${d.people} ${d.people === 1 ? 'person' : 'people'} away` +
              (d.people ? '\n' + Object.entries(d.byType).map(([t, v]) => `${t}: ${fmtDays(v)}`).join('\n') : '')}>
            <span className={'col' + (d.people >= 2 ? ' clash' : '')} style={{ height: d.people ? `${(d.people / max) * 100}%` : 0 }} />
          </span>
        ))}
      </div>
      <div className="cols-axis small muted">
        <span>{daily[0] ? fmtShort(daily[0].day) : ''}</span>
        <span>max {max}</span>
        <span>{daily.length ? fmtShort(daily[daily.length - 1].day) : ''}</span>
      </div>
    </div>
  );
}

// ---- widgets -----------------------------------------------------------------

function groupByType(items: DashItem[]) {
  const g = new Map<string, DashItem[]>();
  for (const i of items) { const l = g.get(i.typeName); if (l) l.push(i); else g.set(i.typeName, [i]); }
  return [...g].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
}

function PeriodWidget({ title, range, p, statuses }: { title: string; range: string; p: DashPeriod; statuses: AppStatus[] }) {
  const color = useColor();
  const [only, setOnly] = useState<AppStatus | null>(null);
  const items = only ? p.items.filter((i) => i.status === only) : p.items;
  const groups = groupByType(items);
  return (
    <Widget title={title} range={range} count={p.items.length} unit={p.items.length === 1 ? 'request' : 'requests'}
      extra={(
        <>
          <div className="w-pills">
            {statuses.map((st) => (
              <button type="button" key={st} className={'pill ' + st + (only === st ? ' on' : '')}
                title={`Show ${STATUS_LABEL[st]} only`} onClick={() => setOnly(only === st ? null : st)}>
                <span className={'dot ' + st} />{st === 'planned' ? 'Approved' : st === 'denied' ? 'Declined' : STATUS_LABEL[st]} <b>{p.counts[st]}</b>
              </button>
            ))}
            <span className="muted small">{p.people} {p.people === 1 ? 'person' : 'people'}</span>
          </div>
          <TypeSplit parts={groups.map(([t, l]) => [t, l.length])} unit={(n) => `${n} request${n === 1 ? '' : 's'}`} />
        </>
      )}>
      {groups.map(([type, list]) => (
        <div key={type} className="grp">
          <div className="grp-h" style={{ '--tc': color(type) } as React.CSSProperties}>
            <i />{type}<span className="grp-n">{list.length}</span>
          </div>
          {list.map((i) => (
            <div key={i.id} className="w-row">
              <span className={'dot ' + i.status} title={STATUS_LABEL[i.status]} />
              <span className="w-name">{i.person}<span className="muted small"> · {i.team}</span></span>
              <span className="muted small nowrap">
                {fmtShort(i.startDate)}{i.endDate !== i.startDate ? `–${fmtShort(i.endDate)}` : ''} · {fmtDays(i.days)}
              </span>
              {i.status === 'draft' && (
                <button type="button" className="approve icon" title="Approve in BambooHR" aria-label={`Approve ${i.person}’s leave`}
                  onClick={() => approveLeave(i)}>✓</button>
              )}
              {i.url && <button type="button" className="link small" title="Open in BambooHR" onClick={() => openInBamboo(i.url!)}>↗</button>}
            </div>
          ))}
        </div>
      ))}
      {!items.length && <div className="w-empty">Nobody.</div>}
    </Widget>
  );
}

function SameDayWidget({ title, range, days, daily, today }: { title: string; range: string; days: SameDay[]; daily: DailyPoint[]; today: string }) {
  const people = new Set(days.flatMap((d) => d.people.map((p) => p.employeeId))).size;
  return (
    <Widget title={title} range={range} count={days.length} unit={days.length === 1 ? 'day' : 'days'}
      extra={(
        <>
          <div className="w-pills"><span className="muted small">days with 2+ people away · {people} {people === 1 ? 'person' : 'people'} involved</span></div>
          <DailyColumns daily={daily} today={today} />
        </>
      )}>
      {days.map((d) => (
        <div key={d.day} className="w-day">
          <div className="w-day-h"><b>{fmtDay(d.day)}</b> <span className="muted small">{d.people.length} people</span></div>
          <div className="w-day-p">
            {d.people.map((p) => (
              <span key={p.employeeId} className={'tag-p ' + p.status} title={`${p.team} · ${STATUS_LABEL[p.status]}${p.fraction < 1 ? ' · half day' : ''}`}>
                {p.person}{p.fraction < 1 ? ' ½' : ''}
              </span>
            ))}
          </div>
        </div>
      ))}
      {!days.length && <div className="w-empty">No days with two or more people away.</div>}
    </Widget>
  );
}

const PIE_SLICES = 7; // top people get a slot each; the rest fold into "Others"

/** share of the month's days by person: a pie, slices separated by a surface gap */
function Pie({ slices, size = 132 }: { slices: { key: string; label: string; value: number; color: string }[]; size?: number }) {
  const total = slices.reduce((a, x) => a + x.value, 0);
  if (!total) return null;
  const r = size / 2, c = r;
  const arcs = slices.reduce<{ a0: number; a1: number }[]>((acc, x) => {
    const a0 = acc.length ? acc[acc.length - 1].a1 : -Math.PI / 2;
    return [...acc, { a0, a1: a0 + (x.value / total) * Math.PI * 2 }];
  }, []);
  return (
    <svg className="pie" width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img"
      aria-label={slices.map((x) => `${x.label} ${x.value}`).join(', ')}>
      {slices.length === 1
        ? <circle cx={c} cy={c} r={r - 1} fill={slices[0].color}><title>{slices[0].label}: {fmtDays(slices[0].value)} (100%)</title></circle>
        : slices.map((x, i) => {
          const { a0, a1 } = arcs[i];
          const large = a1 - a0 > Math.PI ? 1 : 0;
          const d = `M${c},${c} L${c + r * Math.cos(a0)},${c + r * Math.sin(a0)} A${r},${r} 0 ${large} 1 ${c + r * Math.cos(a1)},${c + r * Math.sin(a1)} Z`;
          return (
            <path key={x.key} d={d} fill={x.color} className="pie-slice">
              <title>{x.label}: {fmtDays(x.value)} ({Math.round((x.value / total) * 100)}%)</title>
            </path>
          );
        })}
    </svg>
  );
}

function RankWidget({ title, range, rows }: { title: string; range: string; rows: Ranked[] }) {
  const total = rows.reduce((a, r) => a + r.days, 0);
  const top = rows.slice(0, PIE_SLICES);
  const rest = rows.slice(PIE_SLICES);
  const restDays = rest.reduce((a, r) => a + r.days, 0);
  const swatch = (i: number) => (i < PIE_SLICES ? `var(--c${i + 1})` : 'var(--c-other)');
  const slices = [
    ...top.map((r, i) => ({ key: r.employeeId, label: r.person, value: r.days, color: swatch(i) })),
    ...(restDays ? [{ key: 'other', label: `Others (${rest.length})`, value: n2(restDays), color: 'var(--c-other)' }] : []),
  ];
  return (
    <Widget title={title} range={range} count={rows.length} unit={rows.length === 1 ? 'person' : 'people'}
      extra={rows.length ? (
        <div className="pie-row">
          <Pie slices={slices} />
          <div className="pie-key">
            {slices.map((x) => (
              <span key={x.key} className="lg"><i style={{ background: x.color }} /><span className="pie-key-n">{x.label}</span>
                <b>{Math.round((x.value / total) * 100)}%</b></span>
            ))}
            <span className="muted small">{fmtDays(n2(total))} in total</span>
          </div>
        </div>
      ) : undefined}>
      {rows.map((r, i) => (
        <div key={r.employeeId} className="w-row rank" title={Object.entries(r.byType).map(([t, v]) => `${t}: ${fmtDays(v)}`).join('\n') + (r.draft ? `\n(${fmtDays(r.draft)} still draft)` : '')}>
          <span className="w-rank">{i + 1}</span>
          <i className="sw-sq" style={{ background: swatch(i) }} />
          <span className="w-name">{r.person}<span className="muted small"> · {Object.keys(r.byType).join(', ')}</span></span>
          <span className="nowrap small w-num">{n2(r.days)} d<span className="muted"> · {r.requests}</span></span>
        </div>
      ))}
      {!rows.length && <div className="w-empty">Nobody this month.</div>}
    </Widget>
  );
}

// ---- sprints -------------------------------------------------------------------

const ROLE_LABEL: Record<SprintLeave['role'], string> = { previous: 'Previous', current: 'Current', next: 'Next', upcoming: 'Upcoming' };
const RoleBadge = ({ role }: { role: SprintLeave['role'] }) => <span className={'role-badge ' + role}>{ROLE_LABEL[role]}</span>;

function SprintSection({ sprints }: { sprints: SprintLeave[] }) {
  return (
    <section className="dash-sec sprint">
      <div className="dash-sec-head">
        <span className="dash-chip">⟲</span>
        <h2>Leave by sprint</h2>
        <span className="muted small">Approved + draft leave (work from home excluded), counted in working days inside each sprint</span>
      </div>
      {!sprints.length
        ? <div className="widget"><div className="w-empty">No sprints configured — add them to sprints.json (Sprint Mapping) to see leave per sprint.</div></div>
        : (
          <Sortable id="dash.sprint" className="dash-grid" items={[
            { key: 'overview', node: <SprintOverview sprints={sprints} /> },
            // keyed by role, so the order survives the sprint rolling over
            ...sprints.map((sp) => ({ key: sp.role, node: <SprintWidget sp={sp} /> })),
          ]} />
        )}
    </section>
  );
}

/** one row per sprint: total days, bar split by type on a shared scale */
function SprintOverview({ sprints }: { sprints: SprintLeave[] }) {
  const color = useColor();
  const max = Math.max(...sprints.map((s) => s.days), 0);
  const types = [...new Set(sprints.flatMap((s) => Object.keys(s.byType)))].sort();
  const total = sprints.reduce((a, s) => a + s.days, 0);
  return (
    <Widget title="Leave per sprint" range={`${sprints.length} sprints`} count={n2(total)} unit="days"
      className="sprint-overview"
      extra={types.length > 1 ? (
        <div className="legend-row">{types.map((t) => <span key={t} className="lg"><i style={{ background: color(t) }} />{t}</span>)}</div>
      ) : undefined}>
      {sprints.map((sp) => (
        <div key={sp.name} className={'sp-row ' + sp.role}>
          <div className="sp-row-h">
            <span className="w-name"><b>{sp.name}</b> <RoleBadge role={sp.role} /></span>
            <span className="nowrap small"><b>{n2(sp.days)}</b> d · {sp.people.length} {sp.people.length === 1 ? 'person' : 'people'}</span>
          </div>
          <div className="sp-bar" title={Object.entries(sp.byType).map(([t, v]) => `${t}: ${fmtDays(v)}`).join('\n') || 'No leave'}>
            {Object.entries(sp.byType).sort((a, b) => b[1] - a[1]).map(([t, v]) => (
              <span key={t} style={{ width: `${max ? (v / max) * 100 : 0}%`, background: color(t) }} />
            ))}
          </div>
          <div className="muted small">{fmtRange(sp.startDate, sp.endDate)}{sp.draft ? ` · ${n2(sp.draft)} d draft` : ''}</div>
          {sp.people.length > 0 ? (
            <div className="sp-people">
              {sp.people.map((p) => (
                <span key={p.employeeId} className={'sp-person' + (p.draft && !p.planned ? ' draft' : p.draft ? ' mixed' : '')}
                  title={`${p.person} · ${p.team}\n${p.types.join(', ')}\n${p.first === p.last ? fmtDay(p.first) : `${fmtDay(p.first)} – ${fmtDay(p.last)}`} · ${fmtDays(p.days)}` +
                    (p.draft ? `\n${fmtDays(p.draft)} still draft` : '')}>
                  <i style={{ background: color(p.types[0]) }} />{p.person}<b>{n2(p.days)}d</b>
                </span>
              ))}
            </div>
          ) : <div className="muted small">Nobody on leave.</div>}
        </div>
      ))}
    </Widget>
  );
}

/** people on leave in one sprint */
function SprintWidget({ sp }: { sp: SprintLeave }) {
  const hl = sp.role === 'current' || sp.role === 'next';
  return (
    <Widget title={sp.name} badge={<RoleBadge role={sp.role} />} range={fmtRange(sp.startDate, sp.endDate)}
      count={sp.people.length} unit={sp.people.length === 1 ? 'person on leave' : 'people on leave'}
      className={'sprint-w ' + sp.role + (hl ? ' hl' : '')}
      extra={(
        <>
          <div className="w-pills">
            <span className="pill"><b>{n2(sp.days)}</b> days</span>
            <span className="pill"><span className="dot planned" />Approved <b>{n2(sp.planned)}</b></span>
            <span className="pill"><span className="dot draft" />Draft <b>{n2(sp.draft)}</b></span>
          </div>
          <TypeSplit parts={Object.entries(sp.byType).sort((a, b) => b[1] - a[1])} unit={fmtDays} />
        </>
      )}>
      {sp.people.map((p) => (
        <div key={p.employeeId} className="w-row">
          <span className={'dot ' + (p.draft && !p.planned ? 'draft' : 'planned')} title={p.draft ? `${fmtDays(p.draft)} draft` : 'Approved'} />
          <span className="w-name">{p.person}<span className="muted small"> · {p.team} · {p.types.join(', ')}</span></span>
          <span className="muted small nowrap">{p.first === p.last ? fmtShort(p.first) : `${fmtShort(p.first)}–${fmtShort(p.last)}`}</span>
          <span className="small nowrap w-num">{n2(p.days)} d</span>
          {p.requests[0]?.url && <button type="button" className="link small" title="Open in BambooHR" onClick={() => openInBamboo(p.requests[0].url!)}>↗</button>}
        </div>
      ))}
      {!sp.people.length && <div className="w-empty">Nobody on leave this sprint.</div>}
    </Widget>
  );
}
