// Project health: a Jira idea → its epics → their tickets, measured against
// the team's real availability (BambooHR leave). Everyone works at 100%;
// estimates are 6-hour days. Shows only "days of leave" per person — never
// the leave type.
import { Fragment, useEffect, useLayoutEffect, useState, type MouseEvent, type ReactNode } from 'react';
import { holdPosition, restorePosition } from '../scrollAnchor.ts';
import { api, type BandName, type Finish, type ForecastReport, type LeaveDate, type ProjectHealth, type ProjectInput, type ProjectsData, type ProjectTrack, type ReportEpicRow } from '../api.ts';
import { fmtAgo, fmtRange, fmtShort, leaveRanges, sprintName } from '../format.ts';
import { Select } from '../components/Select.tsx';
import { CopyButton } from '../components/CopyButton.tsx';
import { BurnBar } from './BurnBar.tsx';
import { forgetProjectUi, PROJECT_OPEN_KEY } from '../state/projectUi.ts';
import { baselineText, driftWarn, progressText, sprintPace } from '../burn.ts';

const n = (x: number | null | undefined) => (x === null || x === undefined ? '—' : Number.isInteger(x) ? String(x) : x.toFixed(1));
const pct = (x: number | null) => (x === null ? '—' : `${Math.round(x * 100)}%`);
const STATUS = { green: 'On track', amber: 'At risk', red: 'Off track' } as const;
const ICON = { green: '●', amber: '▲', red: '■' } as const;
const open = (url: string) => { if (url) void tiny.app.shell.open(url).catch(() => {}); };

const OPEN_KEY = PROJECT_OPEN_KEY; // per-viewer: the one expanded project (accordion)
const RANK = { red: 0, amber: 1, green: 2 } as const;
/** off track first, then at risk, then by deadline */
const byUrgency = (a: ProjectHealth, b: ProjectHealth) =>
  (RANK[a.health?.status ?? 'green'] - RANK[b.health?.status ?? 'green']) || a.deadline.localeCompare(b.deadline);

/** the dates under a leave total; long lists fold into "+N more" (all in the tooltip) */
function LeaveDates({ list, max = 3 }: { list: LeaveDate[]; max?: number }) {
  if (!list.length) return null;
  const r = leaveRanges(list);
  return (
    <div className="leave-dates" title={r.join('\n')}>
      {r.slice(0, max).join(' · ')}{r.length > max && <span className="muted"> · +{r.length - max} more</span>}
    </div>
  );
}

/** status is never colour alone: icon + word */
function Status({ b, text }: { b: BandName; text?: string }) {
  return <span className={'band ' + b}><span aria-hidden="true">{ICON[b]}</span> {text ?? STATUS[b]}</span>;
}
function Util({ b, u }: { b: BandName; u: number | null }) {
  return <span className={'band ' + b} title={STATUS[b]}><span aria-hidden="true">{ICON[b]}</span> {u === null ? 'no capacity' : pct(u)}</span>;
}
function FinishCell({ f, due, late }: { f: Finish; due: string; late: number | null }) {
  if (f === null) return <span className="muted">done</span>;
  if (f === 'never') return <Status b="red" text="can’t finish" />;
  return <span>{fmtShort(f)} {late ? <Status b="red" text={`${late}d late`} /> : <span className="muted small">by {fmtShort(due)}</span>}</span>;
}
function Bar({ label, value, sub, tone }: { label: string; value: number; sub: string; tone: 'time' | 'work' }) {
  return (
    <div className="pg-row">
      <div className="pg-head"><span>{label}</span><b>{pct(value)}</b></div>
      <div className="pg-track"><div className={'pg-fill ' + tone} style={{ width: `${Math.min(100, Math.max(0, value * 100))}%` }} /></div>
      <div className="muted small">{sub}</div>
    </div>
  );
}

export function ProjectHealthView({ version, onRed }: { version: number; onRed?: (n: number) => void }) {
  const [data, setData] = useState<ProjectsData | null>(null);
  // undefined = never chosen (first visit), null = all closed, else the open project's id.
  // Older versions stored { id: open } for several cards: keep the first open one.
  const [openId, setOpenId] = useState<string | null | undefined>(() => {
    try {
      const v = JSON.parse(localStorage.getItem(OPEN_KEY) ?? '"__unset"');
      if (v === '__unset') return undefined;
      if (v && typeof v === 'object') return Object.keys(v).find((k) => v[k]) ?? null;
      return typeof v === 'string' ? v : null;
    } catch { return undefined; }
  });
  const [edit, setEdit] = useState<ProjectInput | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => api.getProjects().then((d) => {
    setData(d);
    onRed?.(d.projects.filter((p) => p.health?.status === 'red').length);
  }).catch((e) => setErr(String(e?.message ?? e)));
  useEffect(() => { void load(); }, [version]); // eslint-disable-line react-hooks/exhaustive-deps
  // after a reload, put a clicked control back where it was on screen (WebKit has no scroll anchoring)
  useLayoutEffect(() => { restorePosition(); }, [data]);

  if (!data) return <div className="empty">{err || 'Loading…'}</div>;
  // one card open at a time. First visit: the most urgent project open; afterwards whatever the viewer left
  const sorted = [...data.projects].sort(byUrgency);
  const current = openId === undefined ? sorted[0]?.id ?? null : openId;
  const isOpen = (id: string) => current === id;
  const openOnly = (id: string | null) => {
    setOpenId(id);
    try { localStorage.setItem(OPEN_KEY, JSON.stringify(id)); } catch { /* private window: not remembered */ }
    // the card above may have just folded: bring the opened card's header into view
    if (id) requestAnimationFrame(() => document.getElementById('project-' + id)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  };
  const offTrack = data.projects.filter((x) => x.health?.status === 'red').length;
  const jiraUrl = (key: string) => (data.jiraSite ? `https://${data.jiraSite}/browse/${encodeURIComponent(key)}` : '');

  const refresh = async (id?: string) => {
    setBusy(true); setErr('');
    try { const r = await api.refreshProjects(id); if (r.errors.length) setErr(r.errors.join(' · ')); await load(); }
    catch (e: any) { setErr(String(e?.message ?? e)); }
    finally { setBusy(false); }
  };
  const remove = async (x: ProjectHealth) => {
    if (!(await tiny.dialog.confirm(`Remove “${x.name}” from this board?`, { detail: 'Jira is not touched.', ok: 'Remove', cancel: 'Cancel' }))) return;
    setErr('');
    try {
      await api.deleteProject(x.id);
      forgetProjectUi(x.id);
      if (isOpen(x.id)) openOnly(null);
      if (edit?.id === x.id) setEdit(null);
    } catch (e: any) { setErr(String(e?.message ?? e)); }
    await load();
  };

  return (
    <div className="project-layout">
    <div className="cap-wrap project-board">
      <div className="row wrap">
        <span className="small"><b>{data.projects.length}</b> {data.projects.length === 1 ? 'project' : 'projects'}
          {offTrack > 0 && <span className="warn-text"> · {offTrack} off track</span>}</span>
        {current && data.projects.length > 1 && (
          <button type="button" className="link small" onClick={() => openOnly(null)}>Collapse</button>
        )}
        <div className="spacer" />
        {data.jiraSite
          ? <button type="button" disabled={busy || !data.projects.length} onClick={() => refresh()}>{busy ? 'Refreshing…' : '⟳ Refresh from Jira'}</button>
          : <span className="muted small">Connect Jira in Settings first</span>}
        <button type="button" className="primary" onClick={() => setEdit({ key: '', name: '', startDate: new Date().toISOString().slice(0, 10), deadline: '' })}>Add project</button>
      </div>
      {err && <div className="banner">{err}</div>}

      {!data.projects.length ? (
        <div className="empty">Add a project: its Jira idea key (the idea the epics are linked to), a start date and a deadline.</div>
      ) : sorted.map((p) => (
        <ProjectPanel key={p.id} p={p} people={data.people} jiraUrl={jiraUrl}
          isOpen={isOpen(p.id)} onToggle={() => openOnly(isOpen(p.id) ? null : p.id)}
          onEdit={() => setEdit({ id: p.id, key: p.key, name: p.ownName, track: p.track, tracked: p.tracked, issueType: p.issueType, startDate: p.startDate, deadline: p.deadline,
            excludedEpics: p.linkedEpics.filter((e) => e.excluded).map((e) => e.key), linkedEpics: p.linkedEpics })}
          onRemove={() => remove(p)} onRefresh={() => refresh(p.id)} onChanged={load} />
      ))}

      {edit && <ProjectEditor value={edit} onCancel={() => setEdit(null)} onSave={async (v) => {
        const { linkedEpics: _l, tracked: _t, issueType: _i, ...input } = v;
        const r = await api.saveProject(input);
        setEdit(null); openOnly(r.id);
        if (r.warning) setErr(r.warning);
        await load();
      }} />}
    </div>
    {data.projects.length > 0 && <BurnBar projects={data.projects} />}
    </div>
  );
}

/** the calendar sprints the project window falls in: "Q4 Sprint 4", or "Q4 Sprint 1 → Sprint 4" */
function windowSprints(p: ProjectHealth): string | null {
  const cal = p.health?.sprints.sprints ?? [];
  const at = (d: string) => cal.find((s) => s.startDate <= d && s.endDate >= d);
  const a = at(p.startDate), b = at(p.deadline);
  if (!a && !b) return null;
  if (!a || !b) return sprintName((a ?? b)!.name);
  if (a.name === b.name) return sprintName(a.name);
  const bn = sprintName(b.name);
  return `${sprintName(a.name)} → ${bn.slice(0, 2) === sprintName(a.name).slice(0, 2) ? bn.replace(/^Q\d /, '') : bn}`;
}

function ProjectPanel(props: {
  p: ProjectHealth; people: ProjectsData['people']; jiraUrl: (k: string) => string; isOpen: boolean; onToggle: () => void;
  onEdit: () => void; onRemove: () => void; onRefresh: () => void; onChanged: () => void;
}) {
  const { p, jiraUrl, isOpen, onToggle, onEdit, onRemove, onRefresh } = props;
  const h = p.health;
  const stop = (fn: () => void) => (e: MouseEvent) => { e.stopPropagation(); fn(); };
  return (
    <section id={'project-' + p.id} className={'project-card' + (h ? ' status-' + h.status : ' status-none') + (isOpen ? ' open' : '')} data-copy>
      <header className="project-card-head" onClick={onToggle} aria-expanded={isOpen}>
        <span className="caret" aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
        <div className="pc-title">
          <h3>{p.name}</h3>
          <div className="muted small">
            <button type="button" className="link small" data-copy-keep onClick={stop(() => open(jiraUrl(p.key)))}>{p.key} ↗</button>
            {p.ideaStatus && <> · {p.ideaStatus}</>} · <span className="nowrap" title="Project window: start → deadline (set in Edit)">{fmtRange(p.startDate, p.deadline)}{windowSprints(p) && <> ({windowSprints(p)})</>}</span>
            {h && <> · {h.epics.length} epics · {h.totals.open} open tickets</>}
          </div>
        </div>
        {h ? (
          <div className="pc-summary">
            <Status b={h.status} />
            <span className="small">
              {h.finish === null ? 'all done' : h.finish === 'never' ? 'can’t finish'
                : <>finish <b>{fmtShort(h.finish)}</b>{h.lateDays ? <span className="warn-text"> · {h.lateDays}d late</span> : <span className="muted"> · on time</span>}</>}
            </span>
          </div>
        ) : <div className="pc-summary muted small">{p.error ?? 'No Jira data yet'}</div>}
        {h ? <CardBurn p={p} /> : <div className="pc-burn" />}
      </header>
      {isOpen && (
        <div className="project-card-body">
          {p.error && <div className="banner">{p.error}</div>}
          {h ? <ProjectBody {...props} /> : <div className="empty">No Jira data yet — refresh once Jira is connected.</div>}
        </div>
      )}
      <footer className="project-card-foot" data-nocopy>
        <span className="muted small" title={p.fetchedAt ? new Date(p.fetchedAt).toLocaleString() : undefined}>{p.fetchedAt ? `Synced from Jira ${fmtAgo(p.fetchedAt)}` : 'Not synced from Jira yet'}</span>
        <div className="pc-actions">
          <button type="button" className="link small" onClick={onRefresh}>Refresh</button>
          <button type="button" className="link small" onClick={onEdit}>Edit</button>
          <button type="button" className="link small" onClick={onRemove}>Remove</button>
          <CopyButton />
        </div>
      </footer>
    </section>
  );
}

/** the project's measures, in its card header — the same three lines on every
 *  card, all in estimate days (no team-time ratio here: it reads as progress
 *  and isn't): progress against the tickets' estimate, the bar's tick = the
 *  baseline; scope vs the baseline; the active sprint's work vs its time */
/** tickets left open in Jira under a closed epic or story: closed out with it, so not remaining and not delivered */
function ClosedOut({ c }: { c: { tickets: number; days: number; keys?: string[]; subtasks?: number; parents?: string[] } }) {
  const plural = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
  const detail = [c.keys?.join(', '), c.days > 0 ? `${n(c.days)} d` : ''].filter(Boolean).join(', ');
  const what = c.subtasks === c.tickets ? plural(c.tickets, 'open sub-task', 'open sub-tasks') : plural(c.tickets, 'open ticket', 'open tickets');
  // sub-tasks of a closed story don't show in Jira's epic view — say where they are
  const where = c.subtasks === c.tickets && c.parents?.length
    ? `of closed ${c.parents.length === 1 ? 'story' : 'stories'} ${c.parents.join(', ')}`
    : 'left in Jira under closed work';
  const text = `${what} ${where}${detail ? ` (${detail})` : ''}`;
  return (
    <div className="small closed-out" title="Their epic or story is closed, so nothing is left to deliver: they count neither as remaining nor as delivered. Sub-tasks don’t show in Jira’s epic view — open the parent story to find them, then close them to tidy up.">
      {text} — not counted
    </div>
  );
}

/** the tickets' estimate by the epics' quarter labels: "Q3-2026 40/45 d · Q4-2026 13/30.3 d" */
function QuarterLine({ q }: { q: NonNullable<ProjectHealth['health']>['quarters'] }) {
  if (!q.length) return <div className="small muted">No quarter labels on the epics</div>;
  return (
    <div className="small quarter-line" title="Done / estimate of the tickets, by the epics’ quarter labels">
      {q.map((x, i) => (
        <span key={x.quarter ?? 'none'}>{i > 0 && <span className="muted"> · </span>}
          {x.quarter ? <span className="qtag">{x.quarter}</span> : <span className="muted">no label </span>}
          <span className="muted"> {n(x.done)}/{n(x.estimate)} d</span></span>
      ))}
    </div>
  );
}

function CardBurn({ p }: { p: ProjectHealth }) {
  const h = p.health!;
  const b = h.baseline;
  const cur = h.sprints.sprints.find((s) => s.state === 'active' && s.tickets > 0);
  const scale = Math.max(h.totals.current, b.days ?? 0, 0.01);
  const pace = sprintPace(cur);
  return (
    <div className="pc-burn">
      <div className="small" title="Estimate of finished work ÷ the tickets’ estimate now (done + remaining)">{progressText(h.totals.done, h.totals.current)}</div>
      <div className="burn-track pc-burn-track" role="img" aria-label={`${n(h.totals.done)} of ${n(h.totals.current)} days done${b.days !== null ? `; baseline ${n(b.days)} days` : ''}`}>
        <div className="mini-fill" style={{ width: `${Math.min(100, (h.totals.done / scale) * 100)}%` }} />
        {h.totals.current < scale && <div className="burn-rest" style={{ left: `${(h.totals.current / scale) * 100}%` }} />}
        {b.days !== null && <div className="burn-tick" style={{ left: `${Math.min(100, (b.days / scale) * 100)}%` }} title={`baseline ${n(b.days)} d`} />}
      </div>
      <QuarterLine q={h.quarters} />
      <div className={'small ' + (driftWarn(b) ? 'warn-text' : 'muted')} title="The baseline is the original estimate on the project’s own Jira issue (else its epics’ own estimates). The tick on the bar marks it.">{baselineText(b, p.key)}</div>
      <div className="small muted" title="The active sprint: estimate done of the work in it, against how much of its time has passed">
        {cur ? <>{sprintName(cur.name)}: {n(cur.done)} of {n(cur.committed)} d done · {pct(cur.elapsedPct)} of time passed
          {pace && <> · <span className={pace === 'behind' ? 'warn-text' : 'ok-text'}>{pace}</span></>}</>
          : 'No work in the active sprint'}
      </div>
    </div>
  );
}

function ProjectBody({ p, people, jiraUrl, onChanged }: {
  p: ProjectHealth; people: ProjectsData['people']; jiraUrl: (k: string) => string; onChanged: () => void;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const h = p.health!;

  const t = h.totals;
  const bottleneck = h.people.find((x) => x.finish === h.finish && h.finish && h.finish !== 'never');
  const spare = h.finish && h.finish !== 'never' && !h.lateDays;
  // the People table's period and sprint, consistent with the tiles and the Sprints section
  const aheadFrom = p.today > p.startDate ? p.today : p.startDate;
  const curSprint = h.sprints.sprints.find((x) => x.state === 'active') ?? h.sprints.sprints.find((x) => x.state === 'future') ?? null;
  const active = h.people.filter((x) => x.active);
  // Progress: from Sprint 1 (or the project start if earlier) to the start of today, one team, delivered estimate
  const pf = h.progressFrom;
  const nothingElapsed = h.burned <= 0;
  const gap = Math.round((h.capacityUsedPct - h.windowDonePct) * 100);
  const verdict = nothingElapsed ? 'nothing to compare yet: no capacity has been used in this window'
    : gap > 10 ? `delivered work trails capacity used by ${gap} points`
    : gap < -10 ? `delivered work is ahead of capacity used by ${-gap} points` : 'delivered work is keeping up with capacity used';
  const suggestStart = !!h.firstWorkDate && h.firstWorkDate < pf && h.carriedIn > 0;

  return (
    <>

      <div className="copy-group" data-copy>
      <div className={'verdict ' + h.status}>
        <Status b={h.status} />
        <CopyButton className="float" />
        <span>
          {h.finish === null ? 'All estimated work is done.'
            : h.finish === 'never' ? 'Can’t finish — some work has nobody available to do it.'
            : <>Forecast finish <b>{fmtShort(h.finish)}</b>{h.lateDays ? <> — <b>{h.lateDays} working days after</b> the {fmtShort(p.deadline)} deadline</> : <> — on time for {fmtShort(p.deadline)}</>}.</>}
          {bottleneck && !spare && <> Last to finish: {bottleneck.name}.</>}
          {h.pooledFinish && h.pooledFinish !== 'never' && h.pooledFinish !== h.finish && h.finish !== 'never' &&
            <> If the remaining work were shared across the team: {fmtShort(h.pooledFinish)}.</>}
        </span>
      </div>

      <div className="cap-sum">
        <div className="cap-tile">
          <span className="cap-l">Team available</span><span className="cap-v">{n(h.available)}<small> days</small></span>
          <span className="muted small">{fmtShort(pf)} → {fmtShort(p.deadline)} · {h.working} working − {n(h.leave)} leave · {h.team} people</span>
        </div>
        <div className="cap-tile">
          <span className="cap-l">Capacity used</span><span className="cap-v">{n(h.burned)}<small> of {n(h.available)} days</small></span>
          <span className="muted small">since {fmtShort(pf)} · {n(h.availableAhead)} left to the deadline{h.leaveAhead ? `, after ${n(h.leaveAhead)} more leave` : ''}</span>
        </div>
        <div className="cap-tile">
          <span className="cap-l">Delivered</span><span className="cap-v">{n(h.delivered)}<small> of {n(h.estimate)} days</small></span>
          <span className="muted small">estimate of finished tickets{h.scopeGrowth > 0.005 ? <span className="warn-text"> · scope +{n(h.scopeGrowth)} since first estimates</span> : ''}</span>
          <span className={'small ' + (driftWarn(h.baseline) ? 'warn-text' : 'muted')}>{baselineText(h.baseline, p.key)}</span>
        </div>
        <div className="cap-tile">
          <span className="cap-l">Remaining work</span><span className="cap-v">{n(t.remaining)}<small> days</small></span>
          <span className="small"><Util b={h.band} u={h.utilisation} /> <span className="muted">of the {n(h.availableAhead)} days left</span></span>
        </div>
        <div className="cap-tile">
          <span className="cap-l">At the pace so far</span>
          {h.pace ? <>
            <span className="cap-v">{n(h.pace.capacityNeeded)}<small> days needed</small></span>
            <span className={'small ' + (h.pace.capacityNeeded > h.availableAhead ? 'warn-text' : 'muted')}>
              {h.pace.capacityNeeded > h.availableAhead ? `${n(h.pace.capacityNeeded - h.availableAhead)} more than the ${n(h.availableAhead)} left` : `fits in the ${n(h.availableAhead)} left`}</span>
            <span className="muted small">{n(h.workDone)} d delivered in {n(h.burned)} d of capacity since {fmtShort(pf)} ({pct(h.pace.rate)})</span>
          </> : <span className="muted small">{nothingElapsed
            ? 'Needs some of the window to pass: it compares delivered work with capacity used.'
            : `Nothing delivered since ${fmtShort(pf)} yet.`}</span>}
        </div>
      </div>
      </div>

      {suggestStart && (
        <div className="hint-bar">
          <span>Work on these tickets began <b>{fmtShort(h.firstWorkDate!)}</b>, before {fmtShort(pf)} where progress is measured from,
            so {n(h.carriedIn)} d delivered earlier sit outside the window. Start the project then to measure capacity and pace over the whole period.</span>
          <button type="button" onClick={async () => {
            await api.saveProject({ id: p.id, key: p.key, name: p.ownName, track: p.track, startDate: h.firstWorkDate!, deadline: p.deadline });
            onChanged();
          }}>Start on {fmtShort(h.firstWorkDate!)}</button>
        </div>
      )}

      <div className="pg-card" data-copy>
        <div className="pg-title">Progress since {fmtShort(pf)}{pf < p.startDate ? ' (Sprint 1)' : ''}
          <span className={'small ' + (gap > 10 ? 'warn-text' : 'muted')}> · {verdict}</span><CopyButton /></div>
        <div className="pg-rows">
          <Bar tone="time" label="Capacity used" value={h.capacityUsedPct}
            sub={nothingElapsed
              ? `Nothing used yet: counting starts ${p.today <= pf ? (p.today === pf ? 'tomorrow' : fmtShort(pf)) : 'tomorrow'} · ${n(h.available)} available days to the deadline`
              : `${n(h.burned)} of ${n(h.available)} available days passed (to the end of yesterday) · ${h.team} people`} />
          <Bar tone="work" label="Work delivered" value={h.windowDonePct}
            sub={`${n(h.workDone)} of ${n(h.workTaken)} estimate-days delivered since ${fmtShort(pf)}${h.deliveredToday > 0 ? ` · +${n(h.deliveredToday)} d delivered today, counted from tomorrow` : ''}${t.unestimated ? ` · ${t.unestimated} open tickets unestimated` : ''}`} />
        </div>
        <div className="muted small pg-foot">
          Both bars stop at the start of today and count the same {h.team} people. Delivered = estimate of finished tickets (as in the forecast report);
          partly done tickets count once they’re finished.
          {h.carriedIn > 0 && <> Already delivered before {fmtShort(pf)}: {n(h.carriedIn)} d.</>} Overall {pct(h.workDonePct)} of the {n(h.estimate)} d is delivered.
        </div>
      </div>

      {p.report && <ReportSection key={`${p.fetchedAt}|${p.runs.map((x) => x.date).join(',')}|${p.linkedEpics.filter((x) => x.excluded).map((x) => x.key).join(',')}`} p={p} onChanged={onChanged} jiraUrl={jiraUrl} />}

      {h.status === 'red' && <OpenWork h={h} deadline={p.deadline} jiraUrl={jiraUrl} />}

      <Sprints h={h} deadline={p.deadline} />

      {p.tracked === 'epic' && h.epics.length === 1 && h.tickets.some((t) => t.key !== h.epics[0].key) && <TasksByType h={h} jiraUrl={jiraUrl} />}

      <Section title="Epics" note={`${h.epics.length} epics · click one for its tickets`}>
      <table className="list cap project-table">
        <thead>
          <tr>
            <th>Epic</th><th className="num" title="The original estimate set on the epic itself in Jira">Epic estimate (d)</th><th className="num" title="Σ its tickets’ estimates (original → now when they changed)">Tickets estimate (d)</th><th className="num">Done</th><th className="num">Remaining</th>
            <th>Progress</th><th>Forecast finish</th><th>Health</th>
          </tr>
        </thead>
        <tbody>
          {h.epics.map((e) => {
            const done = e.totals.current > 0 ? e.totals.done / e.totals.current : 0;
            const ts = h.tickets.filter((x) => x.epicKey === e.key);
            return (
              <Fragment key={e.key}>
                <tr className="cap-team" onClick={() => setExpanded({ ...expanded, [e.key]: !expanded[e.key] })}>
                  <td>{expanded[e.key] ? '▾' : '▸'}{' '}
                    <button type="button" className="link" onClick={(ev) => { ev.stopPropagation(); open(jiraUrl(e.key)); }}>{e.key}</button> {e.summary}
                    {(e.quarters ?? []).map((q) => <span key={q} className="qtag" title={`Quarter label ${q}`}>{q}</span>)}
                    <div className="muted small">{e.status} · {e.totals.open} of {e.totals.tickets} tickets open
                      {e.totals.unestimated ? <span className="warn-text"> · {e.totals.unestimated} unestimated</span> : ''}</div>
                    {e.closedOut && <ClosedOut c={e.closedOut} />}</td>
                  <td className="num">{e.estimateDays != null ? n(e.estimateDays) : <span className="muted">—</span>}</td>
                  <td className="num">{e.totals.original !== e.totals.current ? <><span className="muted">{n(e.totals.original)} → </span>{n(e.totals.current)}</> : n(e.totals.current)}</td>
                  <td className="num">{n(e.totals.done)}</td>
                  <td className="num">{n(e.totals.remaining)}</td>
                  <td><div className="mini-track" title={pct(done)}><div className="mini-fill" style={{ width: `${done * 100}%` }} /></div><span className="muted small">{pct(done)}</span></td>
                  <td><FinishCell f={e.finish} due={e.dueDate} late={e.lateDays} /></td>
                  <td><Status b={e.health} text={e.health === 'amber' ? 'Estimates missing' : undefined} /></td>
                </tr>
                {expanded[e.key] && (
                  <tr className="epic-detail"><td colSpan={8}>
                    <table className="list sub">
                      <thead><tr><th>Ticket</th><th>Status</th><th>Assignee</th><th>Sprint</th><th className="num">Original (d)</th><th className="num">Remaining (d)</th><th>Forecast done</th></tr></thead>
                      <tbody>
                        {ts.map((x) => (
                          <tr key={x.key} className={x.done ? 'muted' : ''}>
                            <td><button type="button" className="link" onClick={() => open(jiraUrl(x.key))}>{x.key}</button> {x.summary}</td>
                            <td>{x.status}</td>
                            <td>{x.assigneeName ?? <span className="warn-text">unassigned</span>}</td>
                            <td title={x.sprint?.name}>{x.sprint ? `${sprintName(x.sprint.name)}${x.sprint.state === 'active' ? ' (active)' : ''}` : <span className="muted">backlog</span>}</td>
                            <td className="num">{x.originalDays === null ? <span className="warn-text">none</span> : n(x.originalDays)}</td>
                            <td className="num">{x.done ? '0' : n(x.remainingDays ?? x.originalDays)}</td>
                            <td>{x.done ? <span className="muted">done</span> : x.finish === 'never' ? <Status b="red" text="can’t finish" /> : x.finish ? fmtShort(x.finish) : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </td></tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
        {h.quarters.length > 0 && (
          <tfoot>
            {h.quarters.map((q) => (
              <tr key={q.quarter ?? 'none'} className="quarter-total">
                <td>{q.quarter ? <span className="qtag">{q.quarter}</span> : <span className="muted">No quarter label</span>}
                  <span className="muted small"> {q.epics.length} {q.epics.length === 1 ? 'epic' : 'epics'} · {q.tickets} tickets</span></td>
                <td className="num" />
                <td className="num"><b>{n(q.estimate)}</b></td>
                <td className="num">{n(q.done)}</td>
                <td className="num">{n(q.remaining)}</td>
                <td colSpan={3}><span className="muted small">{q.estimate > 0 ? pct(q.done / q.estimate) : '—'} done</span></td>
              </tr>
            ))}
          </tfoot>
        )}
      </table>
      {h.quarters.some((q) => q.epics.some((k) => (h.epics.find((e) => e.key === k)?.quarters?.length ?? 0) > 1)) &&
        <p className="muted small">An epic with two quarter labels runs across them: each ticket counts in its sprint’s quarter (no sprint yet: the later quarter).</p>}

      </Section>

      <Section title="People" note={`${h.people.filter((x) => x.active).length} with open tickets · leave in days only, never the type`}>
      <table className="list cap project-table people-table">
        <thead>
          <tr className="group-head">
            <th colSpan={3} />
            <th colSpan={4} className="grp">{fmtShort(aheadFrom)} → {fmtShort(p.deadline)} (deadline) · working − leave = available</th>
            <th>{curSprint ? (curSprint.state === 'active' ? 'Current sprint' : 'Next sprint') : ''}</th>
            <th />
          </tr>
          <tr>
            <th>Person</th><th className="num">Open tickets</th><th className="num">Work left (d)</th>
            <th className="num">Working</th><th className="num">Leave</th><th className="num">Available</th>
            <th title="Work left ÷ available days to the deadline">Load</th>
            <th title="Their work in the sprint (Jira) ÷ their available days in it — only if they have tickets there">{curSprint ? sprintName(curSprint.name) : '—'}</th>
            <th>Done by</th>
          </tr>
        </thead>
        <tbody>
          {h.people.map((x) => {
            const sc = curSprint?.people.find((q) => q.id === x.id && q.assigned);
            const unknown = x.matched === 'none';
            return (
              <tr key={x.id} className={x.active ? '' : 'inactive'}>
                <td>{x.name}
                  {unknown && x.accountId && (
                    <div className="small"><span className="warn-text">Not linked to BambooHR, so leave is unknown. </span>
                      <Select value="" display="Link…" minWidth={200} options={people.map((q) => ({ value: q.id, label: q.name }))}
                        onChange={async (id) => { await api.linkPerson(x.accountId!, id); onChanged(); }} /></div>
                  )}
                  {x.matched === 'manual' && x.accountId && <button type="button" className="link small" data-nocopy onClick={async () => { await api.linkPerson(x.accountId!, ''); onChanged(); }}>unlink</button>}
                  {!x.active && <div className="muted small">no open tickets: finished their part ({n(x.done)} d burned), not counted from today</div>}
                </td>
                <td className="num">{x.openTickets || <span className="muted">0</span>}</td>
                <td className="num">{n(x.remaining)}</td>
                {x.active ? <>
                  <td className="num">{x.workingAhead}</td>
                  <td className="num leave-cell">{unknown ? <span className="warn-text small">unknown</span> : x.leaveAhead ? <>
                    <span className="leave-pill">−{n(x.leaveAhead)}</span><LeaveDates list={x.leaveDatesAhead} />
                  </> : '0'}</td>
                  <td className="num"><b>{n(x.availableAhead)}</b></td>
                  <td><Util b={x.band} u={x.utilisation} /></td>
                  <td>{sc ? <><Util b={sc.band} u={sc.utilisation} /> <span className="muted small">{n(curSprint!.state === 'active' ? sc.remaining : sc.committed)} of {n(sc.available)} d</span></>
                    : <span className="muted small">no tickets</span>}</td>
                  <td><FinishCell f={x.finish} due={p.deadline} late={x.lateDays} /></td>
                </> : <td colSpan={6} />}
              </tr>
            );
          })}
          {h.unassigned.tickets > 0 && (
            <tr>
              <td className="warn-text">Unassigned</td>
              <td className="num">{h.unassigned.tickets}</td>
              <td className="num">{n(h.unassigned.remaining)}</td>
              <td colSpan={6} className="muted small">no capacity of its own: the forecast gives it to whoever with open tickets frees up first</td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr>
            <td>Team</td>
            <td className="num">{t.open}</td>
            <td className="num">{n(t.remaining)}</td>
            <td className="num">{active.reduce((s, x) => s + x.workingAhead, 0)}</td>
            <td className="num">{n(h.leaveAhead)}{active.some((x) => x.matched === 'none') && <span className="warn-text small"> + unknown</span>}</td>
            <td className="num">{n(h.availableAhead)}</td>
            <td><Util b={h.band} u={h.utilisation} /></td>
            <td />
            <td><FinishCell f={h.finish} due={p.deadline} late={h.lateDays} /></td>
          </tr>
        </tfoot>
      </table>
      </Section>
    </>
  );
}

// ---- forecast report: the epic-capacity-forecast skill's three tables ----------
/** round half up to one decimal, as the skill does (35.25 → 35.3) */
const r1 = (x: number) => (Math.sign(x) * Math.round(Math.abs(Math.round(x * 1e6) / 1e6) * 10 + 1e-9) / 10).toFixed(1);
const rf = (x: number | null, zero = '0') => (x === null ? '–' : Math.abs(x) < 0.05 ? zero : r1(x));
const d1 = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1));
const rs = (x: number) => (Math.abs(x) < 0.05 ? '0' : (x > 0 ? '+' : '−') + r1(Math.abs(x)));
const pyRound = (x: number) => { const f = Math.floor(x), d = x - f; return d > 0.5 ? f + 1 : d < 0.5 ? f : f % 2 === 0 ? f : f + 1; };
const uBand = (p: number): BandName => (p <= 80 ? 'green' : p <= 100 ? 'amber' : 'red');
function UtilPct({ p }: { p: number | null }) {
  if (p === null) return <span className="muted">–</span>;
  const b = uBand(p);
  return <span className={'band ' + b} title={STATUS[b]}><span aria-hidden="true">{ICON[b]}</span> {pyRound(p)}%</span>;
}

/** copy text: the clipboard API, else a hidden textarea */
async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); return; } catch { /* fall back */ }
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); } finally { ta.remove(); }
}

function ReportSection({ p, onChanged, jiraUrl }: { p: ProjectHealth; onChanged: () => void; jiraUrl: (k: string) => string }) {
  const [compare, setCompare] = useState<string>(''); // '' = the default: last run before today
  const [r, setR] = useState<ForecastReport>(p.report!);
  const [msg, setMsg] = useState('');
  const [importing, setImporting] = useState(false);
  const [showEng, setShowEng] = useState(false); // the engineers behind the capacity row: folded until clicked
  const [saving, setSaving] = useState(false); // an epic tick being saved
  const pick = async (date: string) => {
    setCompare(date);
    try { setR(await api.getForecastReport(p.id, date || null)); } catch (e: any) { setMsg(String(e?.message ?? e)); }
  };
  const earlier = p.runs.filter((x) => x.date < p.today);
  const flash = (t: string) => { setMsg(t); setTimeout(() => setMsg(''), 2500); };
  const t = r.total;
  const quartersOf = new Map<string, string[]>([...p.linkedEpics.map((e) => [e.key, e.quarters ?? []] as const), ...(p.health?.epics ?? []).map((e) => [e.key, e.quarters ?? []] as const)]); // the epics' quarter labels
  const closedOf = new Map((p.health?.epics ?? []).flatMap((e) => (e.closedOut ? [[e.key, e.closedOut] as const] : [])));
  // Jira status + the epic's own estimate, for every linked epic (ticked or not)
  const epicOf = new Map<string, { status: string; done?: boolean; estimateDays?: number | null }>([...p.linkedEpics.map((e) => [e.key, e] as const), ...(p.health?.epics ?? []).map((e) => [e.key, e] as const)]);
  // the tick column: every linked epic in Jira order, ticked = counted (the project's epic selection)
  const outKeys = p.linkedEpics.filter((e) => e.excluded).map((e) => e.key);
  const anyOut = outKeys.length > 0;
  const rowOf = new Map<string, { e: ReportEpicRow; inc: boolean }>([...r.epics.map((e) => [e.key, { e, inc: true }] as const), ...(r.excludedRows ?? []).map((e) => [e.key, { e, inc: false }] as const)]);
  const rows = p.linkedEpics.length ? p.linkedEpics.flatMap((l) => (rowOf.get(l.key) ? [rowOf.get(l.key)!] : [])) : r.epics.map((e) => ({ e, inc: true }));
  const setOut = async (keys: string[]) => {
    if (keys.length >= p.linkedEpics.length) { flash('Keep at least one epic ticked.'); return; }
    setSaving(true);
    try {
      await api.saveProject({ id: p.id, key: p.key, name: p.ownName, track: p.track, startDate: p.startDate, deadline: p.deadline, excludedEpics: keys });
      onChanged();
    } catch (err: any) { setMsg(String(err?.message ?? err)); } finally { setSaving(false); }
  };
  // actual available capacity (absent on reports from before it existed)
  const actual = r.actualBySprint?.length === r.sprints.length ? r.actualBySprint : null;
  const actualTotal = actual ? Math.round(actual.reduce((a, x) => a + x, 0) * 100) / 100 : 0;
  const vsActual = (need: number, cap: number) => (need <= 0 ? 0 : cap > 0 ? (100 * need) / cap : null);
  const doneEpics = r.epics.filter((e) => epicOf.get(e.key)?.done).length;
  const epicEstTotal = r.epics.some((e) => epicOf.get(e.key)?.estimateDays != null) ? r.epics.reduce((a, e) => a + (epicOf.get(e.key)?.estimateDays ?? 0), 0) : null;
  const pct = (x: { est: number; done: number }) => (x.est ? `${pyRound((100 * x.done) / x.est)}%` : '–');

  return (
    <Section title="Forecast report" note="the epic-capacity-forecast tables: same wording and arithmetic, capacity from each engineer’s actual leave">
      <div className="row wrap report-bar" data-nocopy>
        <span className="small">Compare with</span>
        <Select value={compare} minWidth={200} onChange={pick}
          options={[{ value: '', label: earlier.length ? `Last run (${fmtShort(earlier[0].date)})` : 'Last run (none yet)' },
            ...earlier.map((x) => ({ value: x.date, label: `${fmtShort(x.date)} · ${x.rt === null ? '?' : r1(x.rt)} d remaining` }))]} />
        <button type="button" className="link small" onClick={() => setImporting(true)}>Import snapshot…</button>
        <div className="spacer" />
        {msg && <span className="muted small">{msg}</span>}
        <button type="button" onClick={async () => { await copyText(r.markdown); flash('Report copied as Markdown.'); }}>Copy report</button>
        <button type="button" onClick={async () => { await copyText(JSON.stringify(r.snapshot)); flash('Snapshot copied.'); }}
          title="This run’s snapshot, in the skill’s format (for the forecast page’s “Snapshot for next run”)">Copy snapshot</button>
      </div>

      <h4 className="grid-title">Epic status (ticket level)</h4>
      <table className="list cap report-table">
        <thead><tr><th className="pick-col" title="Ticked epics count in the totals and in every figure of this project (same as Edit → epics)">
          <input type="checkbox" aria-label="Include all epics" disabled={saving || !anyOut} checked={!anyOut} data-anchor={`epic-pick-all:${p.id}`}
            onChange={(ev) => { holdPosition(ev.currentTarget); void setOut([]); }} /></th>
          <th>Epic</th><th>Status</th><th className="num" title="The original estimate set on the epic itself in Jira: what was estimated">Epic estimate (d)</th>
          <th className="num" title="Σ the estimates of its tickets still in play (cancelled ones, and open ones under a closed epic, left out)">Estimate, active (d)</th><th className="num">Delivered (d)</th><th className="num">In review (d)</th>
          <th className="num">Remaining (d)</th><th className="num">Done %</th><th className="num">Unestimated</th></tr></thead>
        <tbody>
          {rows.map(({ e, inc }) => (
            <tr key={e.key} className={inc ? '' : 'excluded-row'} title={inc ? undefined : 'Left out of the totals and of every figure of this project'}>
              <td className="pick-col"><input type="checkbox" aria-label={`Include ${e.key}`} checked={inc} disabled={saving}
                data-anchor={`epic-pick:${p.id}:${e.key}`}
                onChange={(ev) => { holdPosition(ev.currentTarget); void setOut(inc ? [...outKeys, e.key] : outKeys.filter((k) => k !== e.key)); }} /></td>
              <td>{e.label} {jiraUrl(e.key)
                ? <button type="button" className="link small" title={`Open ${e.key} in Jira`} onClick={() => open(jiraUrl(e.key))}>{e.key} ↗</button>
                : <span className="muted small">{e.key}</span>}
              {(quartersOf.get(e.key) ?? []).map((q) => <span key={q} className="qtag" title={`Quarter label ${q}`}>{q}</span>)}
              {closedOf.get(e.key) && <ClosedOut c={closedOf.get(e.key)!} />}</td>
              <td>{epicOf.get(e.key) ? <span className={'epic-status' + (epicOf.get(e.key)!.done ? ' done' : '')}>{epicOf.get(e.key)!.done ? '✓ ' : ''}{epicOf.get(e.key)!.status}</span> : '–'}</td>
              <td className="num">{epicOf.get(e.key)?.estimateDays != null ? rf(epicOf.get(e.key)!.estimateDays!) : <span className="muted">–</span>}</td>
              <td className="num">{rf(e.est)}</td><td className="num">{rf(e.done, '–')}</td>
              <td className="num">{rf(e.review, '–')}</td><td className="num">{rf(e.rem)}</td><td className="num">{pct(e)}</td>
              <td className={'num' + (e.unest ? ' warn-text' : '')}>{e.unest}</td></tr>
          ))}
        </tbody>
        <tfoot><tr><td /><td>Total{anyOut && <span className="muted small"> · {r.epics.length} of {rows.length} epics</span>}</td><td className="muted small">{doneEpics} of {r.epics.length} closed</td>
          <td className="num">{epicEstTotal === null ? <span className="muted">–</span> : rf(epicEstTotal)}</td><td className="num">{rf(t.est)}</td><td className="num">{rf(t.done, '–')}</td><td className="num">{rf(t.review, '–')}</td>
          <td className="num">{rf(t.rem)}</td><td className="num">{pct(t)}</td><td className="num">{t.unest}</td></tr></tfoot>
      </table>

      <h4 className="grid-title">Remaining work vs capacity</h4>
      {!r.sprints.length ? <p className="muted small">No calendar sprints from today to the deadline — add them to sprints.json.</p> : (
        <table className="list cap report-table">
          <thead><tr><th />{r.sprints.map((s) => <th key={s.name} className="num" title={s.name}>{sprintName(s.name)} ({s.days} d)</th>)}
            <th className="num">Not in a sprint</th><th className="num">Total</th></tr></thead>
          <tbody>
            <tr className="cap-team" onClick={() => setShowEng(!showEng)} aria-expanded={showEng}
              title="Σ each engineer’s working days minus their own leave (from today in the current sprint). Click to show or hide the engineers.">
              <td>{showEng ? '▾' : '▸'} Capacity, {r.engineers} engineers (d)</td>
              {r.sprints.map((s) => <td key={s.name} className="num"><b>{d1(s.capacity)}</b></td>)}
              <td className="num">–</td><td className="num"><b>{d1(r.totalCapacity)}</b></td></tr>
            {showEng && [...r.engineerRows].sort((a, b) => a.name.localeCompare(b.name)).map((e) => {
              const ld = r.loadByPerson[e.id];
              const total = e.sprints.reduce((a, x) => a + x.available, 0);
              return (
                <tr key={e.id} className="cap-person engineer-row">
                  <td>&nbsp;&nbsp;&nbsp;&nbsp;{e.name}{!e.leaveKnown && <span className="warn-text small"> · leave unknown</span>}</td>
                  {e.sprints.map((x, i) => (
                    <td key={i} className="num">
                      <b>{d1(x.available)}</b><span className="muted"> of {x.working}</span>
                      {x.leave > 0 && <span className="leave-pill" title={leaveRanges(x.leaveDates).join('\n')}>−{d1(x.leave)}</span>}
                      <div className="small" title={`What they can actually schedule: ${d1(x.available)} available, at most ${r.schedulableCap} d a sprint`}>actual <b>{d1(x.actual ?? x.available)}</b></div>
                      <div className="muted small">{ld && ld.sprints[i] > 0.05 ? `loaded ${rf(ld.sprints[i])}` : 'nothing loaded'}</div>
                    </td>
                  ))}
                  <td className="num">{ld && ld.none > 0.05 ? <span className="muted small">{rf(ld.none)}</span> : <span className="muted">–</span>}</td>
                  <td className="num"><b>{d1(total)}</b><div className="small">actual <b>{d1(e.sprints.reduce((a, x) => a + (x.actual ?? x.available), 0))}</b></div><div className="muted small">loaded {rf(ld ? ld.sprints.reduce((a, x) => a + x, 0) + ld.none : 0)}</div></td>
                </tr>
              );
            })}
            {showEng && r.loadByPerson[''] && (
              <tr className="cap-person engineer-row">
                <td className="warn-text">&nbsp;&nbsp;&nbsp;&nbsp;Unassigned</td>
                {r.sprints.map((s, i) => <td key={s.name} className="num muted small">{r.loadByPerson[''].sprints[i] > 0.05 ? `loaded ${rf(r.loadByPerson[''].sprints[i])}` : ''}</td>)}
                <td className="num muted small">{r.loadByPerson[''].none > 0.05 ? rf(r.loadByPerson[''].none) : ''}</td>
                <td className="num muted small">no capacity</td>
              </tr>
            )}
            {actual && (
              <tr className="actual-row" title={`What the team can really schedule: each engineer’s available days, capped at ${r.schedulableCap} d per sprint (scaled down for the part of the current sprint left)`}>
                <td>Actual available, max {r.schedulableCap} d per person a sprint (d)</td>
                {r.sprints.map((s, i) => <td key={s.name} className="num"><b>{d1(actual[i])}</b></td>)}
                <td className="num">–</td><td className="num"><b>{d1(actualTotal)}</b></td></tr>
            )}
            <tr><td>Loaded or scheduled (d)</td>{r.sprints.map((s) => <td key={s.name} className="num">{rf(s.loaded)}</td>)}
              <td className="num">{rf(r.notInSprint)}</td><td className="num">{rf(r.totalRemaining)}</td></tr>
            <tr><td title="The current sprint needs what is already loaded; the rest is split evenly across the later sprints">Needed to finish (d)</td>
              {r.sprints.map((s) => <td key={s.name} className="num">{rf(s.needed)}</td>)}<td className="num">–</td><td className="num">{rf(r.totalRemaining)}</td></tr>
            <tr><td>Utilisation</td>{r.sprints.map((s) => <td key={s.name} className="num"><UtilPct p={s.utilisation} /></td>)}
              <td /><td className="num"><UtilPct p={r.totalUtilisation} /></td></tr>
            {actual && (
              <tr className="actual-row" title="Needed to finish ÷ actual available capacity">
                <td>Utilisation vs actual</td>
                {r.sprints.map((s, i) => <td key={s.name} className="num"><UtilPct p={vsActual(s.needed, actual[i])} /></td>)}
                <td /><td className="num"><UtilPct p={vsActual(r.totalRemaining, actualTotal)} /></td></tr>
            )}
          </tbody>
        </table>
      )}

      <h4 className="grid-title">What changed since the last run{r.changes && <span className="muted small"> · compared with {fmtShort(r.changes.prevDate)}</span>}</h4>
      {!r.changes ? (
        <p className="muted small">No previous snapshot found, so this run is the baseline. The change table will appear from the next run
          (each day’s refresh is kept), or import the last snapshot from the forecast page.</p>
      ) : (
        <table className="list cap report-table">
          <thead><tr><th>Change</th><th>Tickets</th><th className="num">Effect on remaining (d)</th></tr></thead>
          <tbody>
            {r.changes.rows.map((c) => (
              <tr key={c.label}><td>{c.label}</td>
                <td>{c.label.startsWith('Re-estimates') ? (c.keys || '–') : c.label === 'Other / unexplained' ? '–'
                  : c.label.startsWith('Previously unestimated tickets that now') ? c.count : `${c.count}${c.keys}`}</td>
                <td className={'num' + (c.effect > 0.05 ? ' warn-text' : '')}>{rs(c.effect)}</td></tr>
            ))}
          </tbody>
          <tfoot><tr><td>Net</td><td /><td className="num">{r1(r.changes.prevTotal)} → {r1(r.totalRemaining)}</td></tr></tfoot>
        </table>
      )}
      {r.warnings.map((w) => <p key={w} className="warn-text small">{w}</p>)}

      {importing && <ImportSnapshot onCancel={() => setImporting(false)} onSave={async (text) => {
        const x = await api.importRun(p.id, text);
        setImporting(false); flash(`Imported the ${fmtShort(x.date)} snapshot (${x.tickets} tickets).`);
        onChanged();
      }} />}
    </Section>
  );
}

function ImportSnapshot({ onCancel, onSave }: { onCancel: () => void; onSave: (text: string) => Promise<void> }) {
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  return (
    <div className="sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="sheet">
        <header className="sheet-head">
          <h2>Import a snapshot</h2>
          <div className="spacer" />
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="button" className="primary" disabled={!text.trim()} onClick={async () => {
            setErr('');
            try { await onSave(text); } catch (e: any) { setErr(String(e?.message ?? e)); }
          }}>Import</button>
        </header>
        <section>
          <p className="muted small">Paste the “Snapshot for next run” JSON from the project’s Confluence forecast page (or the skill’s reply).
            It becomes a run you can compare with; a run on the same date is replaced.</p>
          <textarea className="snapshot-input" value={text} onChange={(e) => setText(e.target.value)} placeholder='{"skill":"epic-capacity-forecast","date":"2026-11-06","rt":78.5,"t":{…}}' />
        </section>
        {err && <div className="banner">{err}</div>}
      </div>
    </div>
  );
}

/** a section heading that folds its content away */
/** a one-epic project (tracked as an epic with its own tasks): its tasks by
 *  Jira issue type — stories, tasks, bugs… — with each group's totals */
const TYPE_ORDER = ['Story', 'Task', 'Bug', 'Spike', 'Improvement'];
function typeOf(t: { type?: string; subtask?: boolean }): string {
  return t.type || (t.subtask ? 'Sub-task' : 'Other (refresh to see the type)');
}
function TasksByType({ h, jiraUrl }: { h: NonNullable<ProjectHealth['health']>; jiraUrl: (k: string) => string }) {
  const [shut, setShut] = useState<Record<string, boolean>>({});
  const by = new Map<string, typeof h.tickets>();
  for (const t of h.tickets) { const k = typeOf(t); by.set(k, [...(by.get(k) ?? []), t]); }
  const rank = (k: string) => { const i = TYPE_ORDER.indexOf(k); return i >= 0 ? i : /sub-?task/i.test(k) ? 98 : /^Other/.test(k) ? 99 : 50; };
  const groups = [...by.entries()].sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b));
  const est = (t: (typeof h.tickets)[number]) => (t.done ? (t.originalDays ?? 0) : (t.remainingDays ?? t.originalDays ?? 0));
  const sum = (ts: typeof h.tickets, f: (t: (typeof h.tickets)[number]) => number) => ts.reduce((a, t) => a + f(t), 0);
  return (
    <Section title="Tasks" note={`${h.tickets.length} under ${h.epics[0].key}, by type · ${groups.map(([k, ts]) => `${ts.length} ${k.toLowerCase()}`).join(' · ')}`}>
      <table className="list cap project-table">
        <thead><tr><th>Ticket</th><th>Status</th><th>Assignee</th><th>Sprint</th><th className="num">Original (d)</th><th className="num">Done (d)</th><th className="num">Remaining (d)</th><th>Forecast done</th></tr></thead>
        <tbody>
          {groups.map(([k, ts]) => {
            const openN = ts.filter((t) => !t.done).length;
            return (
              <Fragment key={k}>
                <tr className="cap-team" onClick={() => setShut({ ...shut, [k]: !shut[k] })}>
                  <td colSpan={4}>{shut[k] ? '▸' : '▾'} <b>{k}</b> <span className="muted small">· {ts.length} · {openN} open</span></td>
                  <td className="num">{n(sum(ts, (t) => t.originalDays ?? 0))}</td>
                  <td className="num">{n(sum(ts.filter((t) => t.done), est))}</td>
                  <td className="num">{n(sum(ts.filter((t) => !t.done), est))}</td>
                  <td />
                </tr>
                {!shut[k] && ts.map((x) => (
                  <tr key={x.key} className={x.done ? 'muted' : ''}>
                    <td>&nbsp;&nbsp;<button type="button" className="link" onClick={() => open(jiraUrl(x.key))}>{x.key}</button> {x.summary}</td>
                    <td>{x.status}</td>
                    <td>{x.assigneeName ?? <span className="warn-text">unassigned</span>}</td>
                    <td title={x.sprint?.name}>{x.sprint ? `${sprintName(x.sprint.name)}${x.sprint.state === 'active' ? ' (active)' : ''}` : <span className="muted">backlog</span>}</td>
                    <td className="num">{x.originalDays === null ? <span className="warn-text">none</span> : n(x.originalDays)}</td>
                    <td className="num">{x.done ? n(est(x)) : '0'}</td>
                    <td className="num">{x.done ? '0' : n(est(x))}</td>
                    <td>{x.done ? <span className="muted">done</span> : x.finish === 'never' ? <Status b="red" text="can’t finish" /> : x.finish ? fmtShort(x.finish) : '—'}</td>
                  </tr>
                ))}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </Section>
  );
}

function Section({ title, note, children, initiallyOpen = true }: { title: string; note?: ReactNode; children: ReactNode; initiallyOpen?: boolean }) {
  const [openState, setOpen] = useState(initiallyOpen);
  return (
    <div className="copy-group" data-copy>
      <h3 className="sec">
        <button type="button" className="section-toggle" aria-expanded={openState} onClick={() => setOpen(!openState)}>{openState ? '▾' : '▸'} {title}</button>
        {note && <span className="muted small"> {note}</span>}
        {openState && <CopyButton />}
      </h3>
      {openState && children}
    </div>
  );
}

/** the sprint calendar across the project: capacity, how much has burned,
 *  the work Jira has in each sprint and what the forecast puts there */
function Sprints({ h, deadline }: { h: NonNullable<ProjectHealth['health']>; deadline: string }) {
  const { backlog, unmapped } = h.sprints;
  const all = h.sprints.sprints;
  const [from, setFrom] = useState(all[0]?.name ?? ''); // default: Sprint 1 of the calendar
  const [openRows, setOpenRows] = useState<Record<string, boolean>>({}); // sprint → assignees shown (default: the active one)
  const fromIdx = Math.max(0, all.findIndex((s) => s.name === from));
  const sprints = all.slice(fromIdx);
  if (!all.length) {
    return <Section title="Sprints" note="no sprints in the calendar cover this project — add them to sprints.json"><span /></Section>;
  }
  const nameOf = new Map(h.people.map((x) => [x.id, x.name]));
  const STATE = { past: 'done', active: 'active', future: '' } as const;
  return (
    <Section title="Sprints" note={`${sprints.length} of ${all.length} sprints · capacity counts only the people with tickets in each sprint: their working days minus their own approved leave and holidays`}>
      <div className="row wrap" data-nocopy>
        <span className="small">From</span>
        <Select value={all[fromIdx].name} minWidth={180} onChange={setFrom}
          options={all.map((s) => ({ value: s.name, label: `${sprintName(s.name)} · ${fmtShort(s.startDate)}` }))} />
        {fromIdx > 0 && <button type="button" className="link small" onClick={() => setFrom(all[0].name)}>Back to {sprintName(all[0].name)}</button>}
        <div className="spacer" />
        <span className="muted small">Click a sprint to see each assignee’s working vs available days</span>
        {(() => {
          const allOpen = sprints.every((s) => openRows[s.name] ?? s.state === 'active');
          return <button type="button" className="link small" onClick={() => setOpenRows(Object.fromEntries(sprints.map((s) => [s.name, !allOpen])))}>
            {allOpen ? 'Collapse all' : 'Show all assignees'}</button>;
        })()}
      </div>
      <table className="list cap project-table sprint-table">
        <thead>
          <tr>
            <th>Sprint</th>
            <th className="num" title="Σ each person’s working days (weekdays minus their location’s holidays)">Working</th>
            <th className="num" title="Σ each person’s approved leave, in days">Leave</th>
            <th className="num" title="Working − leave, person by person">Available</th>
            <th title="Estimate burned on this sprint’s tickets ÷ available days. The tick marks how much of the sprint’s time has passed.">Capacity burned (by estimate)</th>
            <th className="num" title="Estimate of the Jira tickets in this sprint (done + remaining)">In sprint (Jira)</th>
            <th className="num">Remaining</th>
            <th title="In-sprint work ÷ available (active sprint: remaining ÷ days left)">Load</th>
            <th title="Remaining work the forecast schedules into this sprint, by assignee, around their leave">Forecast load</th>
          </tr>
        </thead>
        <tbody>
          {sprints.map((s) => {
            const PACE = { behind: <Status b="red" text="behind" />, 'on-pace': <Status b="green" text="on pace" />, ahead: <Status b="green" text="ahead" /> };
            const isOpen = openRows[s.name] ?? s.state === 'active';
            return (
              <Fragment key={s.name}>
              <tr className={'cap-team ' + (s.state === 'active' ? 'sprint-active ' : '') + (s.afterDeadline ? 'sprint-over ' : '') + (s.beforeStart ? 'sprint-before' : '')}
                onClick={() => setOpenRows({ ...openRows, [s.name]: !isOpen })} aria-expanded={isOpen}>
                <td title={s.name}>{isOpen ? '▾' : '▸'} <b>{sprintName(s.name)}</b> {STATE[s.state] && <span className="tag">{STATE[s.state]}</span>}
                  <div className="muted small">{fmtRange(s.startDate, s.endDate)}{s.beforeStart ? ' · before the project start' : ''}{s.afterDeadline ? <span className="warn-text"> · after the deadline</span> : ''}</div></td>
                {s.assignedPeople === 0 ? <>
                  <td className="num muted">—</td><td className="num muted">—</td><td className="num muted">—</td>
                  <td><span className="muted small">nobody has tickets in this sprint</span></td>
                </> : <>
                <td className="num">{s.working}<div className="muted small">{s.assignedPeople} {s.assignedPeople === 1 ? 'person' : 'people'}</div></td>
                <td className="num">{n(s.leave)}</td>
                <td className="num">{n(s.available)}</td>
                <td>
                  <div className="burn-track" title={`${n(s.done)} estimate-days burned of ${n(s.available)} available${s.state === 'active' ? ` · ${pct(s.elapsedPct)} of the sprint has passed` : ''}`}>
                    <div className="mini-fill" style={{ width: `${Math.min(100, s.burnedPct * 100)}%` }} />
                    {s.state === 'active' && <div className="burn-tick" style={{ left: `${Math.min(100, s.elapsedPct * 100)}%` }} />}
                  </div>
                  <span className="small"><b>{n(s.done)}</b><span className="muted"> of {n(s.available)} d · {pct(s.burnedPct)}</span></span>
                  {s.state === 'active' && <div className="small"><span className="muted">{pct(s.elapsedPct)} of time passed </span>{s.pace && PACE[s.pace]}</div>}
                </td>
                </>}
                <td className="num">{s.tickets ? <>{n(s.committed)}<div className="muted small">{s.open}/{s.tickets} open</div></> : <span className="muted">—</span>}</td>
                <td className="num">{s.tickets ? n(s.remaining) : ''}</td>
                <td>{s.tickets ? <Util b={s.band} u={s.utilisation} /> : <span className="muted small">nothing planned</span>}</td>
                <td>{s.state === 'past' ? <span className="muted small">—</span>
                  : s.forecast > 0 ? <><Util b={s.forecastUtilisation === null ? 'red' : s.forecastUtilisation > 1 ? 'red' : s.forecastUtilisation > 0.8 ? 'amber' : 'green'} u={s.forecastUtilisation} />
                    <span className="muted small"> {n(s.forecast)} d</span></> : s.assignedPeople ? <span className="muted small">free</span> : null}
                  {s.state !== 'past' && s.forecastOthers > 0 && <div className="muted small">+{n(s.forecastOthers)} d by people with no ticket here</div>}</td>
              </tr>
              {isOpen && !s.people.length && (
                <tr className="cap-person assignee-row"><td colSpan={9} className="muted">&nbsp;&nbsp;&nbsp;&nbsp;No tickets assigned to anyone in this sprint.</td></tr>
              )}
              {isOpen && [...s.people].sort((a, b) => Number(b.assigned) - Number(a.assigned) || (b.utilisation ?? 99) - (a.utilisation ?? 99) || (nameOf.get(a.id) ?? '').localeCompare(nameOf.get(b.id) ?? '')).map((c) => {
                const fu = c.available > 0 ? c.forecast / c.available : c.forecast > 0 ? null : 0;
                if (!c.assigned) return (
                  <tr key={c.id} className="cap-person assignee-row forecast-only">
                    <td>&nbsp;&nbsp;&nbsp;&nbsp;{nameOf.get(c.id)} <span className="small">· not assigned — forecast only</span></td>
                    <td colSpan={7} className="small">no ticket in this sprint, so their days aren’t in its capacity</td>
                    <td className="small">{n(c.forecast)} d</td>
                  </tr>
                );
                return (
                  <tr key={c.id} className="cap-person assignee-row">
                    <td>&nbsp;&nbsp;&nbsp;&nbsp;{nameOf.get(c.id)}{h.people.find((x) => x.id === c.id)?.matched === 'none' && <span className="warn-text small"> · leave unknown</span>}</td>
                    <td className="num">{c.working}</td>
                    <td className="num leave-cell">{c.leave > 0 ? <><span className="leave-pill">−{n(c.leave)}</span><LeaveDates list={c.leaveDates} max={2} /></> : '0'}</td>
                    <td className="num"><b>{n(c.available)}</b></td>
                    <td>{c.committed > 0 ? <span className="small"><b>{n(c.done)}</b><span className="muted"> of {n(c.available)} d · {pct(c.burnedPct)}</span></span> : <span className="muted small">—</span>}</td>
                    <td className="num">{c.committed > 0 ? n(c.committed) : <span className="muted">—</span>}</td>
                    <td className="num">{c.committed > 0 ? n(c.remaining) : ''}</td>
                    <td>{c.committed > 0 ? <Util b={c.band} u={c.utilisation} /> : <span className="muted small">no work</span>}</td>
                    <td>{s.state === 'past' ? <span className="muted small">—</span>
                      : c.forecast > 0 ? <><Util b={fu === null || fu > 1 ? 'red' : fu > 0.8 ? 'amber' : 'green'} u={fu} /><span className="muted small"> {n(c.forecast)} d</span></>
                      : <span className="muted small">free</span>}</td>
                  </tr>
                );
              })}
              </Fragment>
            );
          })}
          {(backlog.tickets > 0 || unmapped.tickets > 0) && (
            <tr className="muted">
              <td colSpan={6} className="small">
                {backlog.tickets > 0 && <>Not in any sprint: <b>{n(backlog.remaining)} d</b> in {backlog.tickets} open tickets. </>}
                {unmapped.tickets > 0 && <>In Jira sprints not on the calendar ({unmapped.names.map(sprintName).join(', ')}): <b>{n(unmapped.remaining)} d</b> in {unmapped.tickets} tickets.</>}
              </td>
              <td colSpan={3} />
            </tr>
          )}
        </tbody>
      </table>

      <h4 className="grid-title">Per person <span className="muted small">shown only for sprints they have tickets in · available = their working days − their own leave · load = their Jira work ÷ their available days · burned = estimate done</span></h4>
      <div className="grid-scroll">
        <table className="list cap sprint-grid">
          <thead>
            <tr><th>Person</th>{sprints.map((s) => <th key={s.name} className={s.state === 'active' ? 'sprint-active' : ''} title={s.name}>{sprintName(s.name)}</th>)}</tr>
          </thead>
          <tbody>
            {h.people.map((x) => (
              <tr key={x.id}>
                <td>{nameOf.get(x.id)}</td>
                {sprints.map((s) => {
                  const c = s.people.find((q) => q.id === x.id);
                  if (!c || !c.assigned) return (
                    <td key={s.name} className={'not-in-sprint ' + (s.state === 'active' ? 'sprint-active' : '')}>
                      <span className="muted small">no tickets</span>
                      {c && c.forecast > 0 && s.state !== 'past' && <div className="muted small">forecast {n(c.forecast)} d</div>}
                    </td>
                  );
                  return (
                    <td key={s.name} className={s.state === 'active' ? 'sprint-active' : ''}>
                      <div className="cell-avail" title={`${c.working} working days − ${n(c.leave)} days of their leave = ${n(c.available)} available`}>
                        <b>{n(c.available)}</b><span className="muted"> of {c.working} d</span>
                        {c.leave > 0 && <span className="leave-pill" title={leaveRanges(c.leaveDates).join('\n')}>−{n(c.leave)} leave</span>}
                      </div>
                      <div className="small"><Util b={c.band} u={c.utilisation} />
                        <span className="muted"> {n(s.state === 'active' ? c.remaining : c.committed)} d {s.state === 'active' ? 'left' : 'work'}</span></div>
                      <div className="muted small">burned {n(c.done)} d · {pct(c.burnedPct)}</div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">Deadline {fmtShort(deadline)}. Tickets are placed in calendar sprints by Jira sprint name, or by date when the names differ. Leave is counted in days only.</p>
    </Section>
  );
}

/** Off track: every ticket still to close, grouped by assignee — the person
 *  finishing last first, tickets in the order they'll be worked on */
function OpenWork({ h, deadline, jiraUrl }: { h: NonNullable<ProjectHealth['health']>; deadline: string; jiraUrl: (k: string) => string }) {
  const [shut, setShut] = useState<Record<string, boolean>>({});
  const [collapsed, setCollapsed] = useState(true); // starts folded: the header line already says how many are open and late
  const order =(f: Finish) => (f === 'never' ? '~' : f ?? '');
  const groups = new Map<string, { key: string; name: string; person: (typeof h.people)[number] | null; tickets: typeof h.tickets }>();
  for (const t of h.tickets) {
    if (t.done) continue;
    const key = t.assigneeId ?? '';
    let g = groups.get(key);
    if (!g) {
      const person = key ? h.people.find((x) => x.accountId === key) ?? null : null;
      g = { key, name: key ? person?.name ?? t.assigneeName ?? 'Unknown' : 'Unassigned', person, tickets: [] };
      groups.set(key, g);
    }
    g.tickets.push(t);
  }
  const list = [...groups.values()].map((g) => {
    g.tickets.sort((a, b) => order(a.finish).localeCompare(order(b.finish)) || a.rank - b.rank);
    const last = g.tickets.reduce<Finish>((m, t) => (order(t.finish) > order(m) ? t.finish : m), null);
    const remaining = g.tickets.reduce((s, t) => s + (t.remainingDays ?? t.originalDays ?? 0), 0);
    const late = g.tickets.filter((t) => t.finish === 'never' || (t.finish !== null && t.finish > deadline)).length;
    return { ...g, last, remaining, late };
  }).sort((a, b) => order(b.last).localeCompare(order(a.last)) || b.remaining - a.remaining);
  const lateTotal = list.reduce((s, g) => s + g.late, 0);
  const allShut = list.every((g) => shut[g.key]);

  return (
    <div className="copy-group" data-copy>
      <h3 className="sec">
        <button type="button" className="section-toggle" aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)}>
          {collapsed ? '▸' : '▾'} Open tickets by assignee
        </button>
        <span className="muted small"> {list.reduce((s, g) => s + g.tickets.length, 0)} still to close · {lateTotal} forecast after the {fmtShort(deadline)} deadline</span>
        {!collapsed && (
          <button type="button" className="link small" data-nocopy onClick={() => setShut(allShut ? {} : Object.fromEntries(list.map((g) => [g.key, true])))}>
            {allShut ? 'Expand all' : 'Collapse all'}
          </button>
        )}
        {!collapsed && <CopyButton />}
      </h3>
      {!collapsed && <table className="list cap project-table">
        <thead>
          <tr><th>Ticket</th><th>Epic</th><th>Status</th><th>Sprint</th><th className="num">Remaining (d)</th><th>Forecast done</th></tr>
        </thead>
        <tbody>
          {list.map((g) => (
            <Fragment key={g.key || 'unassigned'}>
              <tr className="cap-team group-row" onClick={() => setShut({ ...shut, [g.key]: !shut[g.key] })}>
                <td colSpan={4}>
                  {shut[g.key] ? '▸' : '▾'} <b className={g.key ? '' : 'warn-text'}>{g.name}</b>
                  <span className="muted small"> · {g.tickets.length} open{g.person ? ` · ${n(g.person.availableAhead)} d available to the deadline` : g.key ? '' : ' · picked up by whoever frees up first'}</span>
                  {g.person?.matched === 'none' && <span className="warn-text small"> · leave unknown</span>}
                </td>
                <td className="num"><b>{n(g.remaining)}</b></td>
                <td>{g.late ? <Status b="red" text={`${g.late} late`} /> : <Status b="green" text="in time" />}</td>
              </tr>
              {!shut[g.key] && g.tickets.map((t) => {
                const late = t.finish === 'never' || (t.finish !== null && t.finish > deadline);
                return (
                  <tr key={t.key} className="cap-person">
                    <td>&nbsp;&nbsp;&nbsp;<button type="button" className="link" onClick={() => open(jiraUrl(t.key))}>{t.key}</button> {t.summary}</td>
                    <td>{t.epicKey}</td>
                    <td>{t.status}</td>
                    <td title={t.sprint?.name}>{t.sprint ? `${sprintName(t.sprint.name)}${t.sprint.state === 'active' ? ' (active)' : ''}` : 'backlog'}</td>
                    <td className="num">{t.originalDays === null && t.remainingDays === null ? <span className="warn-text">no estimate</span> : n(t.remainingDays ?? t.originalDays)}</td>
                    <td>{t.finish === 'never' ? <Status b="red" text="can’t finish" />
                      : t.finish ? <span className={late ? 'warn-text' : ''}>{fmtShort(t.finish)}{late ? ' · after deadline' : ''}</span> : '—'}</td>
                  </tr>
                );
              })}
            </Fragment>
          ))}
        </tbody>
      </table>}
    </div>
  );
}

function ProjectEditor({ value, onCancel, onSave }: { value: ProjectInput; onCancel: () => void; onSave: (v: ProjectInput) => Promise<void> }) {
  const [v, setV] = useState<ProjectInput>(value);
  // a different idea: the listed epics (and what was left out) belong to the old one
  const rekeyed = !!value.id && (v.key.trim() !== value.key || (v.track ?? 'auto') !== (value.track ?? 'auto'));
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  return (
    <div className="sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="sheet">
        <header className="sheet-head">
          <h2>{v.id ? 'Edit project' : 'Add project'}</h2>
          <div className="spacer" />
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="button" className="primary" disabled={saving} onClick={async () => {
            setErr(''); setSaving(true);
            try { await onSave(rekeyed ? { ...v, excludedEpics: undefined, linkedEpics: undefined } : v); } catch (e: any) { setErr(String(e?.message ?? e)); } finally { setSaving(false); }
          }}>{saving ? 'Fetching from Jira…' : 'Save'}</button>
        </header>
        <section>
          <label>Jira idea <input placeholder="IDEA-42" value={v.key} onChange={(e) => setV({ ...v, key: e.target.value.toUpperCase() })} /></label>
          <p className="muted small">The idea the project’s epics are linked to (its key, or paste its Jira link). Its linked epics and their tickets are pulled from Jira. A single epic key works too.</p>
          <label className="block">Track <Select value={v.track ?? 'auto'} onChange={(t: ProjectTrack) => setV({ ...v, track: t })} options={[
            { value: 'auto', label: 'Auto — by the issue’s type in Jira' },
            { value: 'idea', label: 'Idea — its linked epics and their tasks' },
            { value: 'epic', label: 'Epic — its own tasks (or the issue itself)' },
          ]} /></label>
          <p className="muted small">
            Auto: an Idea follows its linked epics; an Epic uses its own tasks (an epic with no tasks of its own falls back to its linked epics);
            a Task or Story counts on its own. Progress always comes from the tasks’ estimates and time.
            {!rekeyed && value.tracked && <> Last pull: <b>{value.issueType || 'issue'}</b>, read as {value.tracked === 'idea' ? 'an idea (linked epics)' : 'an epic (its own tasks)'}.</>}
          </p>
          {rekeyed && <p className="muted small">Changed: what was pulled for {value.key} is dropped and {v.key.trim() || 'the new key'} is pulled from Jira again on save.</p>}
          <label className="block">Name <input value={v.name} placeholder="Optional — defaults to the idea’s title" onChange={(e) => setV({ ...v, name: e.target.value })} /></label>
          <div className="row wrap">
            <label>Start <input type="date" value={v.startDate} onChange={(e) => setV({ ...v, startDate: e.target.value })} /></label>
            <label>Deadline <input type="date" value={v.deadline} min={v.startDate} onChange={(e) => setV({ ...v, deadline: e.target.value })} /></label>
          </div>
        </section>
        {!rekeyed && !!v.linkedEpics?.length && (
          <section>
            <h3>Epics in this project <span className="muted small">· {v.linkedEpics.length - (v.excludedEpics?.length ?? 0)} of {v.linkedEpics.length}</span></h3>
            <p className="muted small">Capacity is for one team: leave out epics owned by other teams, or phases you don’t want in this forecast.
              Left-out epics drop out of every figure.</p>
            <div className="epic-pick">
              {v.linkedEpics.map((e) => {
                const on = !(v.excludedEpics ?? []).includes(e.key);
                return (
                  <label key={e.key} className="epic-pick-row">
                    <input type="checkbox" checked={on} onChange={() => setV({ ...v,
                      excludedEpics: on ? [...(v.excludedEpics ?? []), e.key] : (v.excludedEpics ?? []).filter((k) => k !== e.key) })} />
                    <span><b>{e.key}</b> {e.summary} <span className="muted small">· {e.status}</span></span>
                  </label>
                );
              })}
            </div>
          </section>
        )}
        {err && <div className="banner">{err}</div>}
      </div>
    </div>
  );
}
