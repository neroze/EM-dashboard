// Long leave tab: runs of consecutive working days away, a year at a time.
// Long = 10+ working days, mini = 5–9. Each kind gets a summary, a month
// chart (approved vs still-planned) and a month-by-month view with a small
// track showing where in the month each run falls.
import { useEffect, useState } from 'react';
import { api } from '../api.ts';
import { openInBamboo } from '../bamboo-link.ts';
import { Select } from '../components/Select.tsx';
import { Sortable } from '../components/Sortable.tsx';
import { resetLayouts } from '../state/layout.ts';
import { fmtAgo, fmtDay, fmtShort } from '../format.ts';
import type { LeaveRun, LongLeaveYear, MonthRuns, UiFilters } from '../types.ts';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
type Show = 'planned' | 'draft';
const STATUS_TXT: Record<LeaveRun['status'], string> = { planned: 'Approved', draft: 'Planned', mixed: 'Partly approved' };
const n2 = (n: number) => +n.toFixed(2);
const dnum = (d: string) => Number(d.slice(8, 10));

export function LongLeaveView({ filters, version, onRefresh, syncing, lastSyncAt }: {
  filters: UiFilters; version: number; onRefresh: () => void; syncing: boolean; lastSyncAt: string | null;
}) {
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [show, setShow] = useState<Set<Show>>(() => new Set<Show>(['planned', 'draft']));
  const [data, setData] = useState<LongLeaveYear | null>(null);
  const who = JSON.stringify([filters.teams, filters.people, filters.locations]);

  useEffect(() => {
    let live = true;
    void api.getLongLeave(filters, year).then((d) => { if (live) setData(d); });
    return () => { live = false; };
  }, [year, who, version]); // eslint-disable-line react-hooks/exhaustive-deps

  const nowYear = Number((data?.today ?? '').slice(0, 4)) || year;
  const firstYear = Math.min(nowYear, Number((data?.dataFrom ?? '').slice(0, 4)) || nowYear);
  const years = Array.from({ length: nowYear + 1 - firstYear + 1 }, (_, i) => firstYear + i);
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
        <Select title="Year" value={year} onChange={setYear} options={years.map((y) => ({ value: y, label: String(y) }))} />
        <div className="seg" role="group" aria-label="Status">
          <button type="button" className={'chip planned' + (show.has('planned') ? ' on' : '')} onClick={() => toggle('planned')}><span className="dot planned" /> Approved</button>
          <button type="button" className={'chip draft' + (show.has('draft') ? ' on' : '')} onClick={() => toggle('draft')}><span className="dot draft" /> Planned</button>
        </div>
        <span className="muted small">Consecutive working days — weekends and holidays don't break a run; back-to-back requests join up.</span>
        <div className="spacer" />
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
          { key: 'long', node: <KindSection kind="long" title="Long leave" rule="10+ working days in a row" data={data} keep={keep} /> },
          { key: 'mini', node: <KindSection kind="mini" title="Mini leave" rule="5–9 working days in a row" data={data} keep={keep} /> },
        ]} />
      )}
    </div>
  );
}

function KindSection({ kind, title, rule, data, keep }: {
  kind: 'long' | 'mini'; title: string; rule: string; data: LongLeaveYear; keep: (r: LeaveRun) => boolean;
}) {
  const runs = data[kind].filter(keep);
  const months = data.months.map((m) => ({ ...m, runs: m[kind].filter(keep) }));
  const people = new Set(runs.map((r) => r.employeeId)).size;
  const days = runs.reduce((a, r) => a + r.days, 0);
  const counts = { planned: 0, draft: 0, mixed: 0 };
  for (const r of runs) counts[r.status]++;
  const next = runs.find((r) => r.start > data.today);
  const now = runs.filter((r) => r.start <= data.today && r.end >= data.today);
  const curMonth = data.today.slice(0, 7);

  return (
    <section className={'dash-sec ll ' + kind}>
      <div className="dash-sec-head">
        <span className="dash-chip">{kind === 'long' ? '✈︎' : '☀︎'}</span>
        <h2>{title}</h2>
        <span className="muted small">{rule} · {data.year}</span>
      </div>

      <Sortable id={'ll.' + kind} className="year-grid" items={[
        { key: 'summary', node: (
        <div className="widget">
          <div className="w-head"><span className="w-title">{title} in {data.year}</span><span className="w-range">{rule}</span></div>
          <div className="yr-totals">
            <div className="yr-total"><span className="w-count">{runs.length}<small> {runs.length === 1 ? 'leave' : 'leaves'}</small></span><span className="muted small">{people} {people === 1 ? 'person' : 'people'}</span></div>
            <div className="yr-total"><span className="w-count">{n2(days)}<small> days</small></span><span className="muted small">working days away</span></div>
          </div>
          <div className="w-pills">
            <span className="pill"><span className="dot planned" />Approved <b>{counts.planned}</b></span>
            <span className="pill"><span className="dot draft" />Planned <b>{counts.draft}</b></span>
            {counts.mixed > 0 && <span className="pill"><span className="dot mixed" />Partly approved <b>{counts.mixed}</b></span>}
          </div>
          <div className="ll-now">
            <div><span className="muted small">Away now</span>
              <div>{now.length ? now.map((r) => r.person).join(', ') : <span className="muted">Nobody</span>}</div></div>
            <div><span className="muted small">Next to start</span>
              <div>{next ? <>{next.person} <span className="muted small">· {fmtDay(next.start)} · {n2(next.days)} d</span></> : <span className="muted">Nothing booked</span>}</div></div>
          </div>
        </div>
        ) },
        { key: 'chart', className: 'span-2', node: (
        <div className="widget">
          <div className="w-head"><span className="w-title">{title} by month</span><span className="w-range">leaves starting or running in each month</span></div>
          <div className="legend-row">
            <span className="lg"><i style={{ background: 'var(--planned-bg)' }} />Approved</span>
            <span className="lg"><i style={{ background: 'var(--draft-bg)' }} />Planned</span>
            <span className="lg"><i className="mixed-sw" />Partly approved</span>
          </div>
          <MonthColumns months={months} curMonth={curMonth} />
        </div>
        ) },
      ]} />

      <div className="month-grid">
        {months.map((m, i) => (
          <MonthCard key={m.month} m={m} runs={m.runs} name={MONTHS_LONG[i]}
            when={m.month === curMonth ? 'current' : m.month < curMonth ? 'past' : 'future'} today={data.today} />
        ))}
      </div>
    </section>
  );
}

/** count of runs per month, stacked approved / planned / mixed */
function MonthColumns({ months, curMonth }: { months: (MonthRuns & { runs: LeaveRun[] })[]; curMonth: string }) {
  const [pick, setPick] = useState<string | null>(null); // one month, or null = every month
  const max = Math.max(1, ...months.map((m) => m.runs.length));
  const listed = months.map((m, i) => ({ ...m, i })).filter((m) => m.runs.length && (!pick || m.month === pick));
  return (
    <div className="mcols-wrap">
      <div className="mcols">
        {months.map((m, i) => {
          const c = { planned: 0, draft: 0, mixed: 0 };
          for (const r of m.runs) c[r.status]++;
          return (
            <button type="button" key={m.month}
              className={'mcol' + (m.month === curMonth ? ' cur' : '') + (pick === m.month ? ' picked' : '') + (pick && pick !== m.month ? ' dim' : '')}
              onClick={() => setPick(pick === m.month ? null : m.month)} aria-pressed={pick === m.month}
              title={`${MONTHS_LONG[i]}: ${m.runs.length} — ${c.planned} approved, ${c.draft} planned${c.mixed ? `, ${c.mixed} partly approved` : ''}\nClick to list only this month`}>
              <span className="mcol-v">{m.runs.length || ''}</span>
              <span className="mcol-stack" style={{ height: `${(m.runs.length / max) * 100}%` }}>
                {c.mixed > 0 && <span className="seg-mixed" style={{ flexGrow: c.mixed }} />}
                {c.draft > 0 && <span className="seg-draft" style={{ flexGrow: c.draft }} />}
                {c.planned > 0 && <span className="seg-planned" style={{ flexGrow: c.planned }} />}
              </span>
              <span className="mcol-l">{MONTHS[i]}</span>
            </button>
          );
        })}
      </div>

      <div className="mnames-head">
        <span className="w-title">{pick ? `People in ${MONTHS_LONG[Number(pick.slice(5, 7)) - 1]}` : 'People by month'}</span>
        {pick
          ? <button type="button" className="link small" onClick={() => setPick(null)}>Show all months</button>
          : <span className="muted small">click a month to focus it</span>}
      </div>
      <div className="mnames">
        {listed.map((m) => (
          <div key={m.month} className={'mname' + (m.month === curMonth ? ' cur' : '')}>
            <div className="mname-h"><b className={m.month === curMonth ? 'month-cur' : ''}>{MONTHS[m.i]}</b><span className="muted small">{m.runs.length}</span></div>
            {m.runs.map((r) => (
              <div key={r.id} className="mname-r" title={`${r.person} · ${r.team}\n${r.types.join(', ')}\n${fmtDay(r.start)} – ${fmtDay(r.end)} · ${n2(r.days)} working days\n${STATUS_TXT[r.status]}`}>
                <span className={'dot ' + r.status} />
                <span className="w-name">{r.person}</span>
                <span className="muted small nowrap">{fmtShort(r.start)}–{fmtShort(r.end)} · {n2(r.days)} d</span>
              </div>
            ))}
          </div>
        ))}
        {!listed.length && <div className="w-empty">Nobody this year.</div>}
      </div>
    </div>
  );
}

function MonthCard({ m, runs, name, when, today }: { m: MonthRuns; runs: LeaveRun[]; name: string; when: 'past' | 'current' | 'future'; today: string }) {
  const len = dnum(m.to);
  return (
    <div className={'widget month-card ' + when + (runs.length ? '' : ' empty-m')}>
      <div className="w-head">
        <span className="w-title"><span className={when === 'current' ? 'month-cur' : ''}>{name}</span>{when === 'current' && <span className="role-badge current">This month</span>}</span>
        <span className="mc-n">{runs.length}</span>
      </div>
      {runs.map((r) => {
        const s = r.start < m.from ? 1 : dnum(r.start);
        const e = r.end > m.to ? len : dnum(r.end);
        return (
          <div key={r.id} className="run" title={`${r.person} · ${r.team}\n${r.types.join(', ')}\n${fmtDay(r.start)} – ${fmtDay(r.end)} · ${n2(r.days)} working days\n${STATUS_TXT[r.status]}`}>
            <div className="run-h">
              <span className={'dot ' + r.status} />
              <span className="w-name">{r.person}<span className="muted small"> · {r.team}</span></span>
              <span className="small nowrap"><b>{n2(r.days)}</b> d</span>
              {r.requests[0]?.url && <button type="button" className="link small" title="Open in BambooHR" onClick={() => openInBamboo(r.requests[0].url!)}>↗</button>}
            </div>
            <div className="run-track">
              <span className={'run-seg ' + r.status + (r.start < m.from ? ' cont-l' : '') + (r.end > m.to ? ' cont-r' : '')}
                style={{ left: `${((s - 1) / len) * 100}%`, width: `${((e - s + 1) / len) * 100}%` }} />
              {today >= m.from && today <= m.to && <span className="run-today" style={{ left: `${((dnum(today) - 0.5) / len) * 100}%` }} />}
            </div>
            <div className="muted small run-d">
              {r.start < m.from && '← '}{fmtShort(r.start)} – {fmtShort(r.end)}{r.end > m.to && ' →'} · {r.types.join(', ')}
              {r.status !== 'planned' && <> · <span className={r.status === 'draft' ? 'draft-text' : ''}>{STATUS_TXT[r.status]}</span></>}
            </div>
          </div>
        );
      })}
      {!runs.length && <div className="muted small">None</div>}
    </div>
  );
}
