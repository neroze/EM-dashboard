// Overview: the Projects board, reduced to what decides the next action.
// Four headline tiles, one row per project (status · progress · scope vs
// baseline · this sprint · remaining), and on click a compact detail: what
// needs attention, the epics, the sprints ahead against actual capacity.
// Everything else stays on the full Projects board, one click away.
// Same data and arithmetic as the Projects board; leave in days only.
import { Fragment, useEffect, useState } from 'react';
import { PROJECT_OPEN_KEY } from '../state/projectUi.ts';
import { api, type BandName, type ProjectHealth, type ProjectsData } from '../api.ts';
import { sprintPace } from '../burn.ts';
import { copyList, type Item } from '../copy.ts';
import { fmtShort, sprintName } from '../format.ts';
import { CopyButton } from '../components/CopyButton.tsx';

const n = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1));
const pct = (x: number | null) => (x === null ? '—' : `${Math.round(x * 100)}%`);
const STATUS = { green: 'On track', amber: 'At risk', red: 'Off track' } as const;
const ICON = { green: '●', amber: '▲', red: '■' } as const;
const RANK = { red: 0, amber: 1, green: 2 } as const;
const OPEN_KEY = PROJECT_OPEN_KEY; // the Projects board's expanded card
type Health = NonNullable<ProjectHealth['health']>;
type Filter = 'all' | BandName;

const ratio = (a: number, b: number) => (b > 0 ? a / b : null);
const uBand = (u: number | null): BandName => (u === null || u > 1 ? 'red' : u > 0.8 ? 'amber' : 'green');
const daysTo = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 864e5);

function Chip({ b, text }: { b: BandName; text?: string }) {
  return <span className={'band ' + b}><span aria-hidden="true">{ICON[b]}</span> {text ?? STATUS[b]}</span>;
}

/** what needs a decision, most serious first (at most `max`) */
function attention(p: ProjectHealth, max = 4): { b: BandName; text: string }[] {
  const h = p.health!, out: { b: BandName; text: string }[] = [];
  if (h.finish === 'never') out.push({ b: 'red', text: 'Some work has nobody available to do it' });
  else if (h.lateDays) out.push({ b: 'red', text: `Forecast ${fmtShort(h.finish!)}, ${h.lateDays} working days after the ${fmtShort(p.deadline)} deadline` });
  const r = p.report;
  if (r && r.actualBySprint?.length === r.sprints.length) {
    const over = r.sprints.map((s, i) => ({ s, cap: r.actualBySprint[i] })).find(({ s, cap }) => s.needed > cap + 0.05);
    if (over) out.push({ b: 'red', text: `${sprintName(over.s.name)} needs ${n(over.s.needed)} d; the team can schedule ${n(over.cap)} d` });
  }
  const cur = h.sprints.sprints.find((s) => s.state === 'active' && s.tickets > 0);
  if (sprintPace(cur) === 'behind') out.push({ b: 'amber', text: `${sprintName(cur!.name)} is behind: ${n(cur!.done)} of ${n(cur!.committed)} d done with ${pct(cur!.elapsedPct)} of its time passed` });
  const b = h.baseline;
  if (b.days !== null && b.growthPct !== null && b.growthPct > 0.1) out.push({ b: 'amber', text: `Estimate ${n(b.tickets)} d is ${Math.round(b.growthPct * 100)}% over the ${n(b.days)} d baseline` });
  if (h.unassigned.tickets > 0) out.push({ b: 'amber', text: `${h.unassigned.tickets} open ${h.unassigned.tickets === 1 ? 'ticket' : 'tickets'} unassigned (${n(h.unassigned.remaining)} d)` });
  if (h.totals.unestimated > 0) out.push({ b: 'amber', text: `${h.totals.unestimated} open ${h.totals.unestimated === 1 ? 'ticket has' : 'tickets have'} no estimate` });
  const unknown = h.people.filter((x) => x.active && x.matched === 'none').length;
  if (unknown > 0) out.push({ b: 'amber', text: `${unknown} ${unknown === 1 ? 'person is' : 'people are'} not linked to BambooHR, so their leave is unknown` });
  const closed = h.epics.reduce((a, e) => a + (e.closedOut?.tickets ?? 0), 0);
  if (closed > 0) out.push({ b: 'green', text: `${closed} ${closed === 1 ? 'ticket' : 'tickets'} left open under closed work in Jira (not counted)` });
  return out.slice(0, max);
}

/** progress bar: done of the tickets' estimate, tick = baseline */
function Progress({ h }: { h: Health }) {
  const scale = Math.max(h.totals.current, h.baseline.days ?? 0, 0.01);
  return (
    <div className="ov-prog" title={`${n(h.totals.done)} of ${n(h.totals.current)} d done${h.baseline.days !== null ? ` · baseline ${n(h.baseline.days)} d (tick)` : ''}`}>
      <div className="ov-prog-text"><b>{pct(ratio(h.totals.done, h.totals.current))}</b><span className="muted"> {n(h.totals.done)}/{n(h.totals.current)} d</span></div>
      <div className="burn-track ov-track" role="img" aria-label={`${pct(ratio(h.totals.done, h.totals.current))} done`}>
        <div className="mini-fill" style={{ width: `${Math.min(100, (h.totals.done / scale) * 100)}%` }} />
        {h.baseline.days !== null && <div className="burn-tick" style={{ left: `${Math.min(100, (h.baseline.days / scale) * 100)}%` }} />}
      </div>
    </div>
  );
}

function Scope({ h }: { h: Health }) {
  const b = h.baseline;
  if (b.days === null) return <span className="muted small" title="No original estimate on the project or its epics in Jira">no baseline</span>;
  const g = b.growthPct ?? 0;
  return (
    <span className={'small ' + (g > 0.1 ? 'warn-text' : 'muted')} title={`Baseline ${n(b.days)} d (${b.source === 'project' ? 'project estimate' : 'epics’ own estimates'}) · estimate now ${n(b.tickets)} d`}>
      {Math.abs(g) < 0.005 ? 'on baseline' : `${g > 0 ? '+' : '−'}${Math.round(Math.abs(g) * 100)}%`}
      <span className="muted"> of {n(b.days)} d</span>
    </span>
  );
}

function ThisSprint({ h }: { h: Health }) {
  const cur = h.sprints.sprints.find((s) => s.state === 'active' && s.tickets > 0);
  if (!cur) return <span className="muted small">nothing this sprint</span>;
  const pace = sprintPace(cur);
  return (
    <span className="small" title={`${cur.name}: ${n(cur.done)} of ${n(cur.committed)} d done · ${pct(cur.elapsedPct)} of its time passed`}>
      {n(cur.done)}/{n(cur.committed)} d
      {pace && <span className={pace === 'behind' ? 'warn-text' : 'ok-text'}> · {pace}</span>}
      <div className="muted small">{sprintName(cur.name)} · {pct(cur.elapsedPct)} of time</div>
    </span>
  );
}

/** a Jira key that opens the issue (plain text when Jira isn't connected); never toggles the row it sits in */
function JiraLink({ k, url, children }: { k: string; url: (k: string) => string; children?: React.ReactNode }) {
  const u = url(k);
  if (!u) return <>{children ?? k}</>;
  return <a href={u} className="jira-link" title={`Open ${k} in Jira`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); void tiny.app.shell.open(u).catch(() => {}); }}>{children ?? k}</a>;
}

function Detail({ p, onOpen, jiraUrl }: { p: ProjectHealth; onOpen: () => void; jiraUrl: (k: string) => string }) {
  const h = p.health!;
  const [showClosed, setShowClosed] = useState(false);
  const items = attention(p);
  const live = h.epics.filter((e) => !e.done), closed = h.epics.filter((e) => e.done);
  const r = p.report;
  const actual = r && r.actualBySprint?.length === r.sprints.length ? r.actualBySprint : null;
  return (
    <div className="ov-detail">
      <section>
        <h4>Needs attention</h4>
        {items.length ? <ul className="ov-attn">{items.map((x, i) => <li key={i}><span className={'ov-dot ' + x.b} aria-hidden="true" />{x.text}</li>)}</ul>
          : <p className="muted small">Nothing stands out: on time, within capacity.</p>}
      </section>
      <section>
        <h4>Epics <span className="muted small">{live.length} open · {closed.length} closed</span></h4>
        <table className="ov-mini">
          <tbody>
            {[...live, ...(showClosed ? closed : [])].map((e) => {
              const done = ratio(e.totals.done, e.totals.current);
              return (
                <tr key={e.key} className={e.done ? 'muted' : ''}>
                  <td className="ov-epic" title={`${e.key} · ${e.summary}`}><JiraLink k={e.key} url={jiraUrl} /> {e.summary}{(e.quarters ?? []).map((q) => <span key={q} className="qtag">{q}</span>)}</td>
                  <td className="ov-bar-cell"><div className="mini-track"><div className="mini-fill" style={{ width: `${(done ?? 0) * 100}%` }} /></div></td>
                  <td className="num">{pct(done)}</td>
                  <td className="num muted">{e.done ? 'closed' : `${n(e.totals.remaining)} d left`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {closed.length > 0 && <button type="button" className="link small" onClick={() => setShowClosed(!showClosed)}>{showClosed ? 'Hide closed epics' : `Show ${closed.length} closed`}</button>}
      </section>
      <section>
        <h4>Sprints ahead <span className="muted small">work needed vs what the team can schedule</span></h4>
        {!r || !r.sprints.length ? <p className="muted small">No calendar sprints from today to the deadline.</p> : (
          <table className="ov-mini">
            <tbody>
              {r.sprints.map((s, i) => {
                const cap = actual ? actual[i] : s.capacity;
                const u = s.needed <= 0 ? 0 : cap > 0 ? s.needed / cap : null;
                return (
                  <tr key={s.name}>
                    <td title={s.name}>{sprintName(s.name)}</td>
                    <td className="num">{n(s.needed)}<span className="muted"> / {n(cap)} d</span></td>
                    <td className="num"><Chip b={uBand(u)} text={u === null ? 'no capacity' : pct(u)} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <p className="muted small">{actual ? `Capacity = each person’s available days after leave, at most ${r!.schedulableCap} d a sprint.` : 'Capacity = available days after leave.'}</p>
      </section>
      <div className="ov-detail-foot"><button type="button" className="link small" onClick={onOpen}>Open on the Projects board →</button></div>
    </div>
  );
}

export function OverviewView({ version, onOpenProject }: { version: number; onOpenProject: (id: string) => void }) {
  const [data, setData] = useState<ProjectsData | null>(null);
  const [err, setErr] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api.getProjects().then((d) => { if (live) { setData(d); setErr(''); } }).catch((e) => live && setErr(String(e?.message ?? e)));
    return () => { live = false; };
  }, [version]);

  if (!data) return <div className="empty">{err || 'Loading…'}</div>;
  const all = data.projects.filter((p) => p.health);
  const jiraUrl = (k: string) => (data.jiraSite ? `https://${data.jiraSite}/browse/${encodeURIComponent(k)}` : '');
  const missing = data.projects.length - all.length;
  if (!all.length) return <div className="empty">No project has Jira data yet. Add projects on the Projects board, then refresh them from Jira.</div>;

  const sorted = [...all].sort((a, b) => RANK[a.health!.status] - RANK[b.health!.status] || a.deadline.localeCompare(b.deadline));
  const shown = filter === 'all' ? sorted : sorted.filter((p) => p.health!.status === filter);
  const count = (b: BandName) => all.filter((p) => p.health!.status === b).length;
  const remaining = all.reduce((a, p) => a + p.health!.totals.remaining, 0);
  const done = all.reduce((a, p) => a + p.health!.totals.done, 0), est = all.reduce((a, p) => a + p.health!.totals.current, 0);
  const today = all[0].today;
  const next = [...all].filter((p) => p.deadline >= today).sort((a, b) => a.deadline.localeCompare(b.deadline))[0];

  const bullets: Item[] = [
    { text: `${all.length} projects: ${count('red')} off track, ${count('amber')} at risk, ${count('green')} on track` },
    { text: `Delivered ${n(done)} of ${n(est)} d (${pct(ratio(done, est))}) · ${n(remaining)} d remaining` },
    ...shown.map((p) => {
      const h = p.health!;
      return {
        text: `${p.name} (${p.key}) — ${STATUS[h.status]} · ${pct(ratio(h.totals.done, h.totals.current))} done (${n(h.totals.done)}/${n(h.totals.current)} d) · ${n(h.totals.remaining)} d left · deadline ${fmtShort(p.deadline)}${h.finish && h.finish !== 'never' ? `, forecast ${fmtShort(h.finish)}` : ''}`,
        kids: attention(p).map((x) => ({ text: x.text })),
      };
    }),
  ];

  return (
    <div className="cap-wrap ov-board" data-copy data-copy-list={copyList(bullets)}>
      <div className="ov-kpis">
        <div className="ov-kpi">
          <span className="ov-kpi-l">Projects</span><span className="ov-kpi-v">{all.length}</span>
          <span className="ov-kpi-s">{count('red') > 0 && <Chip b="red" text={`${count('red')} off`} />} {count('amber') > 0 && <Chip b="amber" text={`${count('amber')} at risk`} />} {count('green') > 0 && <Chip b="green" text={`${count('green')} on track`} />}</span>
        </div>
        <div className="ov-kpi">
          <span className="ov-kpi-l">Delivered</span><span className="ov-kpi-v">{pct(ratio(done, est))}</span>
          <span className="ov-kpi-s muted">{n(done)} of {n(est)} estimate days</span>
        </div>
        <div className="ov-kpi">
          <span className="ov-kpi-l">Remaining</span><span className="ov-kpi-v">{n(remaining)}<small> d</small></span>
          <span className="ov-kpi-s muted">open estimate across all projects</span>
        </div>
        <div className="ov-kpi">
          <span className="ov-kpi-l">Next deadline</span>
          {next ? <><span className="ov-kpi-v">{fmtShort(next.deadline)}</span>
            <span className="ov-kpi-s muted">{next.name} · in {daysTo(today, next.deadline)} days</span></> : <span className="ov-kpi-v muted">—</span>}
        </div>
      </div>

      <div className="row wrap ov-bar" data-nocopy>
        <div className="seg" role="group" aria-label="Filter by status">
          {(['all', 'red', 'amber', 'green'] as Filter[]).map((f) => (
            <button key={f} type="button" className={'chip' + (filter === f ? ' on' : '')} onClick={() => setFilter(f)}>
              {f === 'all' ? `All ${all.length}` : `${STATUS[f]} ${count(f)}`}
            </button>
          ))}
        </div>
        <div className="spacer" />
        {missing > 0 && <span className="muted small">{missing} without Jira data</span>}
        <CopyButton title="Copy the overview as a bullet list" />
      </div>

      <table className="ov-table">
        <thead>
          <tr><th>Project</th><th>Status</th><th>Progress</th><th title="Tickets’ estimate now vs the baseline (the project’s high-level original estimate)">Scope</th><th>This sprint</th><th className="num">Remaining</th></tr>
        </thead>
        <tbody>
          {shown.map((p) => {
            const h = p.health!;
            const isOpen = open === p.id;
            return (
              <Fragment key={p.id}>
                <tr className={'ov-row status-' + h.status + (isOpen ? ' open' : '')} onClick={() => setOpen(isOpen ? null : p.id)} aria-expanded={isOpen}>
                  <td><span className="caret" aria-hidden="true">{isOpen ? '▾' : '▸'}</span> <b>{p.name}</b>
                    <div className="muted small"><JiraLink k={p.key} url={jiraUrl} /> · due {fmtShort(p.deadline)}</div></td>
                  <td><Chip b={h.status} />
                    <div className="small">{h.finish === null ? <span className="muted">all done</span> : h.finish === 'never' ? <span className="warn-text">can’t finish</span>
                      : h.lateDays ? <span className="warn-text">{h.lateDays}d late · {fmtShort(h.finish)}</span> : <span className="muted">on time · {fmtShort(h.finish)}</span>}</div></td>
                  <td><Progress h={h} /></td>
                  <td><Scope h={h} /></td>
                  <td><ThisSprint h={h} /></td>
                  <td className="num"><b>{n(h.totals.remaining)}</b><span className="muted"> d</span></td>
                </tr>
                {isOpen && <tr className="ov-detail-row"><td colSpan={6}><Detail p={p} jiraUrl={jiraUrl} onOpen={() => { rememberOpenProject(p.id); onOpenProject(p.id); }} /></td></tr>}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      <p className="muted small">Progress = estimate done of the tickets’ estimate now; the tick on the bar is the baseline. Click a project for what needs attention, its epics and the sprints ahead.</p>
    </div>
  );
}

/** for the Projects board: open this project's card when switching there */
function rememberOpenProject(id: string) {
  try {
    localStorage.setItem(OPEN_KEY, JSON.stringify(id)); // the board opens one card at a time
  } catch { /* not remembered */ }
}
