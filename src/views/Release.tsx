// Release readiness: how ready one release is, live from Jira. One "Release
// Activity" epic in LP per release, picked at the top; every figure is
// computed over that epic's children (backend/domain/release.ts holds the
// definitions from the Requirements Baseline v1). Fetched on every open,
// epic change and Refresh now — nothing is cached.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type RelCat, type RelCounts, type RelEpic, type RelGap, type ReleaseData } from '../api.ts';
import { copyList, type Item } from '../copy.ts';
import { fmtAgo, fmtShort } from '../format.ts';
import { CopyButton } from '../components/CopyButton.tsx';
import { Select } from '../components/Select.tsx';
import { MultiSelect } from '../components/MultiSelect.tsx';
import { Sortable } from '../components/Sortable.tsx';
import { autoLayout, LAYOUT_RESET_EVENT } from '../state/layout.ts';

const EPIC_KEY = 'leave-radar.release.epic';
const NO_FILTER = { artifact: [] as string[], assignee: [] as string[], status: [] as string[] };
const NOBODY = '__none';
const LAYOUT_ID = 'release.widgets';
/** this board's widget order and widths back to default (other boards keep theirs) */
function resetReleaseLayout() {
  try { for (const sfx of ['', ':sizes', ':cols', ':rows']) localStorage.removeItem('layout:' + LAYOUT_ID + sfx); } catch { /* storage unavailable */ }
  window.dispatchEvent(new Event(LAYOUT_RESET_EVENT));
}
const n1 = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1));
const CAT: Record<RelCat, string> = { done: 'Done', inprogress: 'In progress', scheduled: 'Scheduled', todo: 'To do' };
/** open states first (how the task list groups), Done last */
const CAT_ORDER: RelCat[] = ['inprogress', 'scheduled', 'todo', 'done'];
/** "3 done, 2 in progress, 1 scheduled, 4 to do" — scheduled only when there is any */
const catLine = (c: RelCounts, sep = ', ') => [`${c.done} done`, `${c.inprogress} in progress`, ...(c.scheduled ? [`${c.scheduled} scheduled`] : []), `${c.todo} to do`].join(sep);
const STATE = { complete: 'Complete', inprogress: 'In progress', notstarted: 'Not started', none: 'No tasks' } as const;
const GAPS: { id: RelGap; label: string; conv: number; effect: string }[] = [
  { id: 'noBuildTag', label: 'No [Build-N] tag', conv: 3, effect: 'Builds, tasks by build, artifact latest build' },
  { id: 'noEstimate', label: 'No original estimate', conv: 6, effect: 'Overall estimate, scope added hours' },
  { id: 'noDueDate', label: 'No due date', conv: 8, effect: 'Never counted as overdue' },
  { id: 'noAssignee', label: 'No assignee', conv: 9, effect: 'Shows as Unassigned' },
  { id: 'noFixVersion', label: 'No fix version', conv: 10, effect: 'Not counted toward release date' },
  { id: 'otherFixVersion', label: 'Fix version is not the release', conv: 10, effect: 'Release date may be off' },
];

function readEpic(): string | null { try { return JSON.parse(localStorage.getItem(EPIC_KEY) ?? 'null'); } catch { return null; } }
function keepEpic(k: string) { try { localStorage.setItem(EPIC_KEY, JSON.stringify(k)); } catch { /* not remembered */ } }

function JiraKey({ k, site }: { k: string; site: string | null }) {
  if (!site) return <>{k}</>;
  const u = `https://${site}/browse/${encodeURIComponent(k)}`;
  return <a href={u} className="jira-link" title={`Open ${k} in Jira`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); void tiny.app.shell.open(u).catch(() => {}); }}>{k}</a>;
}

function Keys({ keys, site, max = 12 }: { keys: string[]; site: string | null; max?: number }) {
  const [all, setAll] = useState(false);
  const shown = all ? keys : keys.slice(0, max);
  return (
    <span className="rel-keys">
      {shown.map((k, i) => <span key={k}>{i > 0 && ', '}<JiraKey k={k} site={site} /></span>)}
      {keys.length > max && <button type="button" className="link small" onClick={() => setAll(!all)}>{all ? 'fewer' : `+${keys.length - max} more`}</button>}
    </span>
  );
}

/** done / in progress / scheduled / to do, as one stacked bar */
function Stack({ c, wide }: { c: RelCounts; wide?: boolean }) {
  const w = (x: number) => `${c.total ? (x / c.total) * 100 : 0}%`;
  return (
    <div className={'rel-stack' + (wide ? ' wide' : '')} role="img" aria-label={catLine(c)}
      title={catLine(c, ' · ')}>
      <span className="s-done" style={{ width: w(c.done) }} /><span className="s-prog" style={{ width: w(c.inprogress) }} /><span className="s-sched" style={{ width: w(c.scheduled) }} /><span className="s-todo" style={{ width: w(c.todo) }} />
    </div>
  );
}

function Cat({ c }: { c: RelCat }) { return <span className={'rel-cat ' + c}>{CAT[c]}</span>; }

function Section({ title, note, children, className, collapsible, defaultOpen = true }: {
  title: string; note?: React.ReactNode; children: React.ReactNode; className?: string;
  /** the header toggles the body */
  collapsible?: boolean; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const shown = !collapsible || open;
  return (
    <section className={'rel-card' + (className ? ' ' + className : '') + (collapsible ? ' collapsible' : '') + (shown ? '' : ' closed')} data-copy>
      <header className="rel-card-h" onClick={collapsible ? () => setOpen(!open) : undefined} aria-expanded={collapsible ? open : undefined}>
        {collapsible && <span className="caret" aria-hidden="true">{open ? '▾' : '▸'}</span>}
        <h3>{title}</h3>{note && <span className="muted small">{note}</span>}<div className="spacer" /><CopyButton />
      </header>
      {shown && children}
    </section>
  );
}

export function ReleaseBoard() {
  const [epics, setEpics] = useState<RelEpic[] | null>(null);
  const [site, setSite] = useState<string | null>(null);
  const [epic, setEpic] = useState<string | null>(null);
  const [data, setData] = useState<ReleaseData | null>(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  // task groups the viewer has collapsed; Done starts collapsed
  const [closedGroups, setClosedGroups] = useState<Set<RelCat>>(() => new Set(['done']));
  // Tasks filters: empty = all
  const [tf, setTf] = useState<{ artifact: string[]; assignee: string[]; status: string[] }>(NO_FILTER);
  const [burnOff, setBurnOff] = useState<Set<string>>(() => new Set()); // capacity burned: unticked assignees (new people start ticked)
  const toggleGroup = (c: RelCat) => setClosedGroups((s) => { const x = new Set(s); if (x.has(c)) x.delete(c); else x.add(c); return x; });
  const seq = useRef(0); // only the latest fetch may land (epic switched mid-fetch)

  const loadEpics = useCallback(async () => {
    try {
      const r = await api.getReleaseEpics();
      setSite(r.jiraSite); setEpics(r.epics);
      if (!r.jiraSite) { setErr('Connect Jira in Settings to see release readiness.'); return; }
      const keep = readEpic();
      setEpic((cur) => cur ?? (keep && r.epics.some((e) => e.key === keep) ? keep : r.epics[0]?.key ?? null));
      if (!r.epics.length) setErr('No release epics in LP: an Epic whose summary contains “Release” and “Activity” or “Activities”.');
    } catch (e: any) { setEpics([]); setErr(String(e?.message ?? e)); }
  }, []);

  const load = useCallback(async (key: string) => {
    const n = ++seq.current;
    setLoading(true);
    try { const d = await api.getRelease(key); if (n === seq.current) { setData(d); setErr(''); } }
    catch (e: any) { if (n === seq.current) setErr(String(e?.message ?? e)); }
    finally { if (n === seq.current) setLoading(false); }
  }, []);

  useEffect(() => { void loadEpics(); }, [loadEpics]);
  useEffect(() => { if (epic) { keepEpic(epic); setData((d) => (d?.epic.key === epic ? d : null)); void load(epic); } }, [epic, load]);

  const refresh = () => { void loadEpics(); if (epic) void load(epic); };
  const setPlanning = async (date: string | null) => {
    if (!epic) return;
    try { await api.setReleasePlanningDate(epic, date); await load(epic); } catch (e: any) { setErr(String(e?.message ?? e)); }
  };

  const picker = (
    <div className="row wrap rel-bar" data-nocopy>
      <span className="small muted">Release</span>
      {epics?.length ? <Select<string> className="rel-pick" value={epic ?? ''} onChange={(k) => { setEpic(k); setTf(NO_FILTER); setBurnOff(new Set()); }} minWidth={320} title="Pick a release epic"
        options={epics.map((e) => ({ value: e.key, label: <span>{e.summary} <span className="muted small">{e.key}</span></span> }))} /> : <span className="muted small">none</span>}
      {data && <span className="muted small"><JiraKey k={data.epic.key} site={site} /> · {data.epic.status}</span>}
      <div className="spacer" />
      {data && <>
        <button type="button" className="auto-layout" onClick={autoLayout} title="Arrange the widgets to fill this window">Auto layout</button>
        <button type="button" className="link small" onClick={resetReleaseLayout} title="Put the widgets back in their default order and widths">Reset layout</button>
      </>}
      {data && <span className="muted small" title={data.fetchedAt}>Fetched {fmtAgo(data.fetchedAt)}</span>}
      <button type="button" onClick={refresh} disabled={loading}>{loading ? 'Refreshing…' : '⟳ Refresh now'}</button>
    </div>
  );

  if (!epics) return <div className="empty">Loading release epics…</div>;
  if (!data) return <div className="cap-wrap rel-board">{picker}<div className="empty">{err || 'Loading the release from Jira…'}</div></div>;

  const d = data, c = d.counts;
  const filtering = !!(tf.artifact.length || tf.assignee.length || tf.status.length);
  const shownTasks = d.tasks.filter((t) => (!tf.artifact.length || tf.artifact.includes(t.artifact))
    && (!tf.assignee.length || tf.assignee.includes(t.assigneeId ?? NOBODY))
    && (!tf.status.length || tf.status.includes(t.status)));
  const filtered = shownTasks.length;
  const relLine = d.release.date
    ? `${fmtShort(d.release.date)} (${d.release.version!.name}) · ${d.release.daysTo! >= 0 ? `in ${d.release.daysTo} days` : `${-d.release.daysTo!} days ago`}`
    : 'no dated fix version';
  const headline: Item[] = [
    { text: `${d.epic.summary} (${d.epic.key})` },
    { text: `${d.pctDone ?? 0}% done: ${c.done} of ${c.total} tasks done, ${c.inprogress} in progress, ${c.scheduled} scheduled, ${c.todo} to do` },
    { text: `Remaining ${n1(d.hours.remaining)} h (${n1(d.days.remaining)} d) · ${d.overdue.length} overdue` },
    { text: `Release date ${relLine}` },
  ];

  return (
    <div className="cap-wrap rel-board">
      {picker}
      {err && <div className="banner">{err}</div>}
      {d.incomplete && <div className="banner">This epic has more than 100 children: only the first 100 are counted, so every figure below is incomplete.</div>}

      <div data-copy data-copy-list={copyList(headline)}>
        <div className="ov-kpis">
          <div className="ov-kpi">
            <span className="ov-kpi-l">Done</span><span className="ov-kpi-v">{d.pctDone === null ? '—' : `${d.pctDone}%`}</span>
            <span className="ov-kpi-s muted">{c.done} of {c.total} tasks</span>
            <Stack c={c} />
          </div>
          <div className="ov-kpi">
            <span className="ov-kpi-l">Remaining</span><span className="ov-kpi-v">{n1(d.hours.remaining)}<small> h</small></span>
            <span className="ov-kpi-s muted" title={`1 d = 6 h · ${d.days.remainingBy ? `most-loaded: ${d.days.remainingBy}` : ''}`}>
              {n1(d.days.remaining)} d of work · ~{n1(d.days.remainingDuration)} d elapsed</span>
          </div>
          <div className="ov-kpi">
            <span className="ov-kpi-l">Overdue</span>
            <span className={'ov-kpi-v' + (d.overdue.length ? ' warn-text' : '')}>{d.overdue.length}</span>
            <span className="ov-kpi-s muted">open tasks past their due date</span>
          </div>
          <div className="ov-kpi">
            <span className="ov-kpi-l">Release date</span>
            {d.release.date ? <>
              <span className={'ov-kpi-v' + (d.release.daysTo! < 0 && c.done < c.total ? ' warn-text' : '')}>{fmtShort(d.release.date)}</span>
              <span className="ov-kpi-s muted">{d.release.version!.name} · {d.release.daysTo! >= 0 ? `in ${d.release.daysTo} days` : `${-d.release.daysTo!} days ago`}</span>
            </> : <><span className="ov-kpi-v muted">—</span><span className="ov-kpi-s muted">no task has a dated fix version</span></>}
          </div>
        </div>
        <div className="row rel-copy-row" data-nocopy><CopyButton title="Copy the headline as a bullet list" /></div>
      </div>

      <Sortable grid units maxCols={4} minCol={280} id={LAYOUT_ID} className="rel-sort" label="widget" items={[
        { key: 'progress', span: 1, node: (
          <Section title="Progress" note={`${c.total} tasks`}>
            <Stack c={c} wide />
            <div className="rel-scroll"><table className="ov-mini rel-tbl"><tbody>
              <tr><td><span className="rel-sw s-done" /> Done</td><td className="num">{c.done}</td></tr>
              <tr><td><span className="rel-sw s-prog" /> In progress</td><td className="num">{c.inprogress}</td></tr>
              <tr><td><span className="rel-sw s-sched" /> Scheduled</td><td className="num">{c.scheduled}</td></tr>
              <tr><td><span className="rel-sw s-todo" /> To do</td><td className="num">{c.todo}</td></tr>
              <tr><td><b>Total</b></td><td className="num"><b>{c.total}</b></td></tr>
            </tbody></table></div>
          </Section>
        ) },
        { key: 'estimate', span: 1, node: (
          <Section title="Overall estimate" note="1 d = 6 h">
            <div className="rel-scroll"><table className="ov-mini rel-tbl"><tbody>
              <tr><td>Estimate</td><td className="num">{n1(d.hours.estimate)} h</td><td className="num muted">{n1(d.days.estimate)} d</td></tr>
              <tr><td>Logged</td><td className="num">{n1(d.hours.logged)} h</td><td className="num muted">{n1(d.hours.logged / 6)} d</td></tr>
              <tr><td>Remaining <span className="muted small">(open tasks)</span></td><td className="num">{n1(d.hours.remaining)} h</td><td className="num muted">{n1(d.days.remaining)} d</td></tr>
              <tr><td title="People work in parallel: the duration follows the most-loaded assignee, not the sum">Duration <span className="muted small">most-loaded person</span></td>
                <td className="num">{n1(d.days.duration)} d</td><td className="num muted small">{d.days.durationBy ?? ''}</td></tr>
              <tr><td>Remaining duration</td><td className="num">{n1(d.days.remainingDuration)} d</td><td className="num muted small">{d.days.remainingBy ?? ''}</td></tr>
              <tr><td>Tasks without estimate</td><td className={'num' + (d.hours.withoutEstimate ? ' warn-text' : '')}>{d.hours.withoutEstimate}</td><td /></tr>
            </tbody></table></div>
          </Section>
        ) },
        { key: 'artifacts', span: 1, node: (
          <Section title="Artifact build status" note="artifact from words in the summary; first matching rule wins">
            <div className="rel-arts">
              {d.artifacts.filter((a) => a.state !== 'none' || a.artifact !== 'Other release tasks').map((a) => (
                <div key={a.artifact} className={'rel-art st-' + a.state}>
                  <div className="rel-art-h"><b>{a.artifact}</b><span className={'rel-state st-' + a.state}>{STATE[a.state]}</span></div>
                  {a.counts.total > 0 ? <>
                    <Stack c={a.counts} />
                    <div className="small">{a.counts.done}/{a.counts.total} done{a.counts.inprogress ? ` · ${a.counts.inprogress} in progress` : ''}{a.counts.scheduled ? ` · ${a.counts.scheduled} scheduled` : ''}</div>
                    <div className="small muted">{a.latestBuild === null ? 'No build tag' : `Latest build: Build-${a.latestBuild}`}</div>
                  </> : <div className="small muted">none yet</div>}
                </div>
              ))}
            </div>
          </Section>
        ) },
        { key: 'builds', span: 1, node: (
          <Section title="Builds triggered" note="highest [Build-N] in a summary">
            <div className="rel-big"><b>{d.builds.triggered ?? '—'}</b> {d.builds.triggered !== null && <span className="muted">builds</span>}</div>
            {d.builds.rows.length > 0 ? (
              <div className="rel-scroll"><table className="ov-mini rel-tbl">
                <thead><tr><th>Build</th><th className="num">Tasks</th><th className="num">Done</th><th>Artifacts</th></tr></thead>
                <tbody>
                  {d.builds.rows.map((b) => (
                    <tr key={b.build}><td title={b.keys.join(', ')}>Build-{b.build}</td><td className="num">{b.tasks}</td>
                      <td className="num">{b.done}<span className="muted">/{b.tasks}</span></td><td className="small">{b.artifacts.join(', ')}</td></tr>
                  ))}
                </tbody>
              </table></div>
            ) : <p className="muted small">No task carries a [Build-N] tag.</p>}
            {d.builds.untagged.length > 0 && <p className="muted small">{d.builds.untagged.length} without a build tag: <Keys keys={d.builds.untagged} site={site} max={6} /></p>}
          </Section>
        ) },
        { key: 'scope', span: 4, node: (
          <Section title="Scope added" note={d.planning.day ? `after planning day ${fmtShort(d.planning.day)}` : 'no planning day'}>
            <div className="rel-big"><b>{d.scopeAdded.tasks}</b> {d.scopeAdded.tasks === 1 ? 'task' : 'tasks'} <span className="muted">· {n1(d.scopeAdded.hours)} h ({n1(d.scopeAdded.days)} d)</span></div>
            <div className="row wrap small" data-nocopy>
              <label className="muted" htmlFor="rel-plan">Planning date</label>
              <input id="rel-plan" type="date" value={d.planning.manual ?? ''} onChange={(e) => void setPlanning(e.target.value || null)} />
              {d.planning.manual ? <button type="button" className="link" onClick={() => void setPlanning(null)}>Use inferred ({d.planning.inferred ? fmtShort(d.planning.inferred) : '—'})</button>
                : <span className="muted">inferred: {d.planning.inferred ? fmtShort(d.planning.inferred) : '—'} (the day most tasks were created)</span>}
            </div>
            {d.scopeAdded.rows.length > 0 && (
              <div className="rel-scroll"><table className="ov-mini rel-tbl"><tbody>
                {d.scopeAdded.rows.map((r) => (
                  <tr key={r.key}><td><JiraKey k={r.key} site={site} /></td><td className="rel-sum" title={r.summary}>{r.summary}</td>
                    <td className="muted small">{fmtShort(r.created)}</td><td className="num">{r.estimateH === null ? <span className="muted">—</span> : `${n1(r.estimateH)} h`}</td></tr>
                ))}
              </tbody></table></div>
            )}
          </Section>
        ) },
        { key: 'assignees', span: 2, node: (
          <Section title="Progress by assignee">
            <div className="rel-scroll"><table className="ov-mini rel-tbl">
              <thead><tr><th>Assignee</th><th /><th className="num">Done</th><th className="num">In prog.</th><th className="num">Sched.</th><th className="num">To do</th><th className="num" title="Remaining estimate of open tasks">Left</th></tr></thead>
              <tbody>
                {d.assignees.map((a) => (
                  <tr key={a.accountId ?? '-'}><td className={a.accountId ? '' : 'muted'}>{a.name}</td><td className="rel-bar-cell"><Stack c={a} /></td>
                    <td className="num">{a.done}</td><td className="num">{a.inprogress}</td><td className="num">{a.scheduled}</td><td className="num">{a.todo}</td>
                    <td className="num">{n1(a.remainingH)} h <span className="muted small">{n1(a.remainingD)} d</span></td></tr>
                ))}
              </tbody>
            </table></div>
          </Section>
        ) },
        { key: 'overdue', span: 2, node: (
          <Section title="Overdue" note="open tasks whose due date is before today">
            {d.overdue.length ? (
              <div className="rel-scroll"><table className="ov-mini rel-tbl"><tbody>
                {d.overdue.map((t) => (
                  <tr key={t.key}><td><JiraKey k={t.key} site={site} /></td><td className="rel-sum" title={t.summary}>{t.summary}</td>
                    <td className="small">{t.assigneeName ?? <span className="muted">Unassigned</span>}</td>
                    <td className="num warn-text small">{fmtShort(t.dueDate)} · {t.daysLate} d late</td></tr>
                ))}
              </tbody></table></div>
            ) : <p className="muted small">Nothing overdue.</p>}
          </Section>
        ) },
        { key: 'burn', span: 4, node: (
          <Section title="Capacity burned by assignee" note="hours logged against each person’s original estimate · 1 d = 6 h">
            {(() => {
              const idOf = (a: { accountId: string | null }) => a.accountId ?? NOBODY;
              const rows = [...d.assignees].sort((a, b) => b.loggedH - a.loggedH || b.estimateH - a.estimateH);
              const picked = rows.filter((a) => !burnOff.has(idOf(a)));
              const allOn = picked.length === rows.length, noneOn = picked.length === 0;
              const toggle = (id: string) => setBurnOff((s) => { const x = new Set(s); if (x.has(id)) x.delete(id); else x.add(id); return x; });
              const tot = picked.reduce((t, a) => ({ est: t.est + a.estimateH, log: t.log + a.loggedH, rem: t.rem + a.remainingH }), { est: 0, log: 0, rem: 0 });
              const scale = Math.max(0.01, ...rows.map((a) => Math.max(a.estimateH, a.loggedH + a.remainingH)));
              const pctOf = (x: number, of: number) => (of > 0 ? `${Math.round((x / of) * 100)}%` : '—');
              const delta = (log: number, rem: number, est: number) => {
                const x = Math.round((log + rem - est) * 10) / 10;
                return est <= 0 ? <span className="muted">no estimate</span>
                  : Math.abs(x) < 0.05 ? <span className="muted">on estimate</span>
                  : <span className={x > 0 ? 'warn-text' : 'ok-text'}>{x > 0 ? '+' : '−'}{n1(Math.abs(x))} h</span>;
              };
              return (
                <div className="rel-scroll"><table className="ov-mini rel-tbl rel-burn">
                  <thead><tr>
                    <th className="rel-chk" data-nocopy><input type="checkbox" aria-label="Include everyone" checked={allOn}
                      ref={(el) => { if (el) el.indeterminate = !allOn && !noneOn; }}
                      onChange={() => setBurnOff(allOn ? new Set(rows.map(idOf)) : new Set())} /></th>
                    <th>Assignee</th><th className="rel-burn-bar-h" /><th className="num">Logged</th><th className="num">Estimate</th><th className="num" title="Logged ÷ original estimate">Burned</th><th className="num" title="Remaining estimate on open tasks">Remaining</th>
                    <th className="num" title="Logged + remaining, compared with the original estimate">Forecast vs est.</th></tr></thead>
                  <tbody>
                    {rows.map((a) => {
                      const on = !burnOff.has(idOf(a));
                      return (
                      <tr key={idOf(a)} className={on ? '' : 'rel-off'} data-nocopy={on ? undefined : true}>
                        <td className="rel-chk"><input type="checkbox" checked={on} onChange={() => toggle(idOf(a))} aria-label={`Include ${a.name}`} /></td>
                        <td className={a.accountId ? '' : 'muted'}><label className="rel-chk-name" onClick={() => toggle(idOf(a))}>{a.name}</label></td>
                        <td className="rel-burn-bar-c">
                          <div className="rel-burn-track" role="img" aria-label={`${n1(a.loggedH)} h logged, ${n1(a.remainingH)} h remaining, ${n1(a.estimateH)} h estimated`}
                            title={`Logged ${n1(a.loggedH)} h · remaining ${n1(a.remainingH)} h · estimate ${n1(a.estimateH)} h (tick)`}>
                            <span className={'b-log' + (a.estimateH > 0 && a.loggedH > a.estimateH ? ' over' : '')} style={{ width: `${(a.loggedH / scale) * 100}%` }} />
                            <span className="b-rem" style={{ width: `${(a.remainingH / scale) * 100}%` }} />
                            {a.estimateH > 0 && <span className="b-tick" style={{ left: `${Math.min(100, (a.estimateH / scale) * 100)}%` }} />}
                          </div>
                        </td>
                        <td className="num">{n1(a.loggedH)} h <span className="muted small">{n1(a.loggedD)} d</span></td>
                        <td className="num">{n1(a.estimateH)} h <span className="muted small">{n1(a.estimateD)} d</span></td>
                        <td className={'num' + (a.estimateH > 0 && a.loggedH > a.estimateH ? ' warn-text' : '')}>{pctOf(a.loggedH, a.estimateH)}</td>
                        <td className="num">{n1(a.remainingH)} h</td>
                        <td className="num small">{delta(a.loggedH, a.remainingH, a.estimateH)}</td>
                      </tr>
                      );
                    })}
                    <tr className="rel-total">
                      <td data-nocopy /><td><b>{allOn ? 'Total' : `Selected (${picked.length} of ${rows.length})`}</b></td><td />
                      <td className="num"><b>{n1(tot.log)} h</b> <span className="muted small">{n1(tot.log / 6)} d</span></td>
                      <td className="num"><b>{n1(tot.est)} h</b> <span className="muted small">{n1(tot.est / 6)} d</span></td>
                      <td className="num"><b>{pctOf(tot.log, tot.est)}</b></td>
                      <td className="num"><b>{n1(tot.rem)} h</b></td>
                      <td className="num small">{delta(tot.log, tot.rem, tot.est)}</td>
                    </tr>
                  </tbody>
                </table></div>
              );
            })()}
            <div className="row wrap small muted rel-legend" data-nocopy>
              <span><span className="rel-sw b-log" /> logged</span><span><span className="rel-sw b-rem" /> remaining</span><span><span className="rel-sw b-tick-sw" /> original estimate</span>
              <span><span className="rel-sw b-log over" /> logged beyond estimate</span>
            </div>
          </Section>
        ) },
        { key: 'outside', span: 4, node: (
          <Section title="Outside the epic" collapsible
            note={d.outside.version
              ? `fix version ${d.outside.version} · ${d.outside.counts.total} issues: ${catLine(d.outside.counts)}${d.outside.incomplete ? ' (first 200)' : ''}`
              : 'needs a dated fix version on the tasks'}>
            {d.outside.version ? <>
              <div className="row wrap small rel-out-counts">
                <span><b>{d.outside.counts.total}</b> issues</span>
                <span><span className="rel-sw s-done" /> {d.outside.counts.done} done</span>
                <span><span className="rel-sw s-prog" /> {d.outside.counts.inprogress} in progress</span>
                {d.outside.counts.scheduled > 0 && <span><span className="rel-sw s-sched" /> {d.outside.counts.scheduled} scheduled</span>}
                <span><span className="rel-sw s-todo" /> {d.outside.counts.todo} to do</span>
                {d.outside.incomplete && <span className="warn-text">first 200 only</span>}
              </div>
              {d.outside.tickets.length > 0 && (
                <div className="rel-scroll"><table className="ov-mini rel-tbl"><tbody>
                  {d.outside.tickets.map((t) => (
                    <tr key={t.key}><td><JiraKey k={t.key} site={site} /></td><td className="small muted">{t.type}</td><td className="rel-sum" title={t.summary}>{t.summary}</td>
                      <td className="small">{t.assigneeName ?? <span className="muted">Unassigned</span>}</td><td><Cat c={t.cat} /></td></tr>
                  ))}
                </tbody></table></div>
              )}
            </> : <p className="muted small">No task in the epic has a fix version with a release date, so the release’s version is unknown.</p>}
          </Section>
        ) },
        { key: 'conventions', span: 4, node: (
          <Section title="Jira conventions" note="tickets that skew the figures above">
            <div className="rel-scroll"><table className="ov-mini rel-tbl">
              <thead><tr><th>#</th><th>Gap</th><th className="num">Tasks</th><th>Tickets</th><th>Effect</th></tr></thead>
              <tbody>
                {GAPS.map((g) => {
                  const keys = d.gaps[g.id];
                  return (
                    <tr key={g.id} className={keys.length ? '' : 'muted'}><td className="muted">{g.conv}</td><td>{g.label}</td>
                      <td className={'num' + (keys.length ? ' warn-text' : '')}>{keys.length}</td>
                      <td className="small">{keys.length ? <Keys keys={keys} site={site} max={8} /> : '—'}</td><td className="small muted">{g.effect}</td></tr>
                  );
                })}
              </tbody>
            </table></div>
          </Section>
        ) },
        { key: 'tasks', span: 4, node: (
          <Section title="Tasks" note={`${c.inprogress} in progress · ${c.scheduled ? `${c.scheduled} scheduled · ` : ''}${c.todo} to do · ${c.done} done`}>
            <div className="row wrap rel-filters" data-nocopy>
              <MultiSelect label="Artifact" value={tf.artifact} onChange={(artifact) => setTf({ ...tf, artifact })}
                options={d.artifacts.filter((a) => a.counts.total > 0).map((a) => ({ value: a.artifact, label: a.artifact, hint: String(a.counts.total) }))} />
              <MultiSelect label="Assignee" search value={tf.assignee} onChange={(assignee) => setTf({ ...tf, assignee })}
                options={d.assignees.map((a) => ({ value: a.accountId ?? NOBODY, label: a.name, hint: String(a.total) }))} />
              <MultiSelect label="Status" value={tf.status} onChange={(status) => {
                  setTf({ ...tf, status });
                  // picking statuses opens their groups (Done too); clearing goes back to Done collapsed
                  setClosedGroups(new Set(status.length ? [] : ['done']));
                }}
                options={CAT_ORDER.flatMap((cat) => [...new Set(d.tasks.filter((t) => t.cat === cat).map((t) => t.status))].sort()
                  .map((st) => ({ value: st, label: st, group: CAT[cat], hint: String(d.tasks.filter((t) => t.status === st).length) })))} />
              {filtered < c.total && <>
                <span className="muted small">{filtered} of {c.total} tasks</span>
                <button type="button" className="link small" onClick={() => { setTf(NO_FILTER); setClosedGroups(new Set(['done'])); }}>Clear filters</button>
              </>}
            </div>
            <div className="rel-scroll"><table className="ov-mini rel-tbl rel-tasks">
              <thead><tr><th>Key</th><th>Summary</th><th>Artifact</th><th>Build</th><th>Assignee</th><th>Due</th><th className="num">Est.</th><th className="num">Left</th><th>State</th></tr></thead>
              {CAT_ORDER.map((cat) => {
                const rows = shownTasks.filter((t) => t.cat === cat);
                if (filtering && !rows.length) return null;
                const open = !closedGroups.has(cat);
                return (
                  <tbody key={cat}>
                    <tr className="rel-group" onClick={() => toggleGroup(cat)} aria-expanded={open}>
                      <td colSpan={9}><span className="caret" aria-hidden="true">{open ? '▾' : '▸'}</span> <span className={'rel-cat ' + cat}>{CAT[cat]}</span> <span className="muted small">{rows.length}</span></td>
                    </tr>
                    {open && rows.map((t) => (
                      <tr key={t.key}><td><JiraKey k={t.key} site={site} /></td><td className="rel-sum" title={t.summary}>{t.summary}</td>
                        <td className="small">{t.artifact}</td><td className="small">{t.builds.length ? t.builds.join(', ') : <span className="muted">—</span>}</td>
                        <td className="small">{t.assigneeName ?? <span className="muted">Unassigned</span>}</td>
                        <td className={'small' + (t.cat !== 'done' && t.dueDate && t.dueDate < d.today ? ' warn-text' : '')}>{t.dueDate ? fmtShort(t.dueDate) : <span className="muted">—</span>}</td>
                        <td className="num small">{t.origSec === null ? <span className="muted">—</span> : `${n1(t.origSec / 3600)} h`}</td>
                        <td className="num small">{t.cat === 'done' ? <span className="muted">—</span> : `${n1((t.remSec ?? 0) / 3600)} h`}</td>
                        <td><Cat c={t.cat} />{t.status && t.status.toLowerCase() !== CAT[t.cat].toLowerCase() && <div className="muted small">{t.status}</div>}</td></tr>
                    ))}
                    {open && !rows.length && <tr><td colSpan={9} className="muted small">None.</td></tr>}
                  </tbody>
                );
              })}
              {filtering && !filtered && <tbody><tr><td colSpan={9} className="muted small">No task matches these filters.</td></tr></tbody>}
            </table></div>
          </Section>
        ) },
      ]} />
      <p className="muted small">Live from Jira: the release epic’s children only (one level). Build numbers and artifacts are read from task summaries. Estimates in hours; days at 6 h a day.</p>
    </div>
  );
}
