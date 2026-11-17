// The Projects board's right bar: capacity burn across the projects you pick,
// in total and sprint by sprint (each sprint opens to its per-project split).
// Collapsible; which projects are left out and whether it's open are
// remembered per viewer.
import { useState } from 'react';
import type { BandName, ProjectHealth } from '../api.ts';
import { baselineText, capacityText, driftWarn, mergeBurn, progressText, type BaselineIn, type BurnSprint } from '../burn.ts';
import { copyList, type Item } from '../copy.ts';
import { fmtRange, sprintName } from '../format.ts';
import { CopyButton } from '../components/CopyButton.tsx';
import { BURN_OFF_KEY } from '../state/projectUi.ts';

const OPEN_KEY = 'leave-radar.projects.burnbar';
const OFF_KEY = BURN_OFF_KEY; // project ids left out (new projects start included)
const read = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v === null ? d : (JSON.parse(v) as T); } catch { return d; } };
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* not remembered */ } };

const n = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1));
const pct = (x: number | null) => (x === null ? 'no capacity' : `${Math.round(x * 100)}%`);
const ICON = { green: '●', amber: '▲', red: '■' } as const;
const bandOf = (u: number | null): BandName => (u === null || u > 1 ? 'red' : u > 0.8 ? 'amber' : 'green');
const STATE = { past: 'done', active: 'active', future: '' } as const;

function Track({ burned, elapsed }: { burned: number | null; elapsed?: number | null }) {
  return (
    <div className="burn-track wide" role="img" aria-label={`${pct(burned)} of capacity burned${elapsed != null ? `, ${pct(elapsed)} of the time passed` : ''}`}>
      <div className="mini-fill" style={{ width: `${Math.min(100, (burned ?? 0) * 100)}%` }} />
      {elapsed != null && <div className="burn-tick" style={{ left: `${Math.min(100, elapsed * 100)}%` }} />}
    </div>
  );
}

function SprintCard({ s, open, onToggle }: { s: BurnSprint; open: boolean; onToggle: () => void }) {
  const PACE = { behind: 'behind', 'on-pace': 'on pace', ahead: 'ahead' } as const;
  return (
    <div className={'burn-sprint' + (s.state === 'active' ? ' active' : '')}>
      <button type="button" className="burn-sprint-head" aria-expanded={open} onClick={onToggle}>
        <span>{open ? '▾' : '▸'} <b title={s.name}>{sprintName(s.name)}</b> {STATE[s.state] && <span className="tag">{STATE[s.state]}</span>}</span>
        <span className="muted small">{fmtRange(s.startDate, s.endDate)}</span>
      </button>
      <Track burned={s.burnedPct} elapsed={s.state === 'active' ? s.elapsedPct : undefined} />
      <div className="small">{capacityText(s.done, s.available)}</div>
      {s.state === 'active' && <div className="small muted">{pct(s.elapsedPct)} of the time passed{s.pace && <> · <span className={s.pace === 'behind' ? 'warn-text' : 'ok-text'}>{PACE[s.pace]}</span></>}</div>}
      <div className="small">
        <span className={'band ' + bandOf(s.load)}><span aria-hidden="true">{ICON[bandOf(s.load)]}</span> {pct(s.load)}</span>
        <span className="muted"> {n(s.committed)} d in Jira · {n(s.remaining)} d left · {s.people} {s.people === 1 ? 'person' : 'people'}</span>
      </div>
      {open && (
        <table className="burn-parts">
          <thead><tr><th>Project</th><th className="num">Avail.</th><th className="num">Burned</th><th className="num">In Jira</th></tr></thead>
          <tbody>
            {s.parts.map((p) => (
              <tr key={p.id}>
                <td title={p.name}>{p.name}<div className="muted small">{p.people} {p.people === 1 ? 'person' : 'people'} · {p.open}/{p.tickets} open</div></td>
                <td className="num">{n(p.available)}</td>
                <td className="num">{n(p.done)}</td>
                <td className="num">{n(p.committed)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {open && s.parts.length > 1 && <div className="muted small">Total counts each person once, so it can be less than the projects’ sum.</div>}
    </div>
  );
}

export function BurnBar({ projects }: { projects: ProjectHealth[] }) {
  const [open, setOpenState] = useState<boolean>(() => read(OPEN_KEY, true));
  const [off, setOffState] = useState<string[]>(() => read(OFF_KEY, [] as string[]));
  const [cards, setCards] = useState<Record<string, boolean>>({}); // sprint → per-project split shown (default: the active one)
  const setOpen = (v: boolean) => { setOpenState(v); write(OPEN_KEY, v); };
  // only ids still on the board are remembered (a removed project drops out)
  const setOff = (v: string[]) => { const keep = v.filter((id) => projects.some((p) => p.id === id)); setOffState(keep); write(OFF_KEY, keep); };

  const withData = projects.filter((p) => p.health);
  const chosen = withData.filter((p) => !off.includes(p.id));
  const { sprints, total } = mergeBurn(chosen.map((p) => ({ id: p.id, name: p.name, sprints: p.health!.sprints.sprints })));

  if (!open) {
    return (
      <aside className="burn-bar collapsed">
        <button type="button" className="burn-tab" onClick={() => setOpen(true)} title="Show capacity burn">◂ Capacity burn</button>
      </aside>
    );
  }

  const active = sprints.find((s) => s.state === 'active');
  // progress and baseline for the chosen projects (whole projects, not only their sprint work)
  const estDone = chosen.reduce((a, p) => a + p.health!.totals.done, 0), estNow = chosen.reduce((a, p) => a + p.health!.totals.current, 0);
  const based = chosen.filter((p) => p.health!.baseline.days !== null);
  const baseDays = based.reduce((a, p) => a + p.health!.baseline.days!, 0), baseTickets = based.reduce((a, p) => a + p.health!.baseline.tickets, 0);
  const baseAll: BaselineIn = { days: based.length ? baseDays : null, source: 'project', tickets: baseTickets, growth: baseTickets - baseDays,
    growthPct: baseDays ? (baseTickets - baseDays) / baseDays : null, fetched: chosen.some((p) => p.health!.baseline.fetched) };
  const baseLine = chosen.length === 1 ? baselineText(chosen[0].health!.baseline, chosen[0].key)
    : baselineText(baseAll).replace('(project estimate)', `(${based.length} of ${chosen.length} projects have one)`);
  // estimate by quarter label across the chosen projects (same buckets as each card)
  const qMap = new Map<string | null, { quarter: string | null; done: number; estimate: number }>();
  for (const p of chosen) for (const q of p.health!.quarters ?? []) {
    const x = qMap.get(q.quarter) ?? { quarter: q.quarter, done: 0, estimate: 0 };
    x.done += q.done; x.estimate += q.estimate; qMap.set(q.quarter, x);
  }
  const quarters = [...qMap.values()].sort((a, b) => (a.quarter === null ? 1 : b.quarter === null ? -1 : a.quarter.slice(3).localeCompare(b.quarter.slice(3)) || a.quarter.localeCompare(b.quarter)));
  const qText = quarters.map((q) => `${q.quarter ?? 'no label'} ${n(q.done)}/${n(q.estimate)} d`).join(' · ');
  const isOpen = (s: BurnSprint) => cards[s.name] ?? s.state === 'active';
  // the bullets Copy puts on the clipboard
  const bullets: Item[] = [
    { text: `Projects: ${chosen.map((p) => p.name).join(', ') || 'none'}` },
    { text: progressText(estDone, estNow) },
    ...(quarters.length ? [{ text: `By quarter: ${qText}` }] : []),
    { text: baseLine },
    { text: `${capacityText(total.done, total.available)} (over ${total.sprints} ${total.sprints === 1 ? 'sprint' : 'sprints'}) · ${pct(total.elapsedPct)} of the team time passed · ${n(total.committed)} d in Jira (load ${pct(total.load)}) · ${n(total.remaining)} d left` },
    ...sprints.map((s) => ({
      text: `${sprintName(s.name)}${s.state === 'active' ? ' (active)' : s.state === 'past' ? ' (done)' : ''}, ${fmtRange(s.startDate, s.endDate)}: ${capacityText(s.done, s.available)}${s.state === 'active' ? ` · ${pct(s.elapsedPct)} of the time passed` : ''} · ${n(s.committed)} d in Jira (load ${pct(s.load)}) · ${s.people} people`,
      kids: s.parts.map((p) => ({ text: `${p.name}: ${n(p.done)} d of work in ${n(p.available)} d of team time · ${n(p.committed)} d in Jira · ${p.open}/${p.tickets} open` })),
    })),
  ];

  return (
    <aside className="burn-bar" data-copy data-copy-list={copyList(bullets)}>
      <div className="burn-head">
        <h3>Capacity burn</h3>
        <CopyButton title="Copy the capacity burn as a bullet list" />
        <button type="button" className="link small" onClick={() => setOpen(false)} title="Hide this bar">Hide ▸</button>
      </div>

      <div className="burn-projects">
        <div className="row">
          <span className="small muted">{chosen.length} of {withData.length} projects</span>
          <div className="spacer" />
          <button type="button" className="link small" disabled={!off.length} onClick={() => setOff([])}>All</button>
          <button type="button" className="link small" disabled={!chosen.length} onClick={() => setOff(withData.map((p) => p.id))}>None</button>
        </div>
        {withData.map((p) => (
          <label key={p.id} className="burn-pick" title={`${p.name} · ${{ green: 'on track', amber: 'at risk', red: 'off track' }[p.health!.status]}`}>
            <input type="checkbox" checked={!off.includes(p.id)} onChange={(e) => setOff(e.target.checked ? off.filter((x) => x !== p.id) : [...off, p.id])} />
            <span className={'band-dot ' + p.health!.status} aria-hidden="true" />
            <span className="burn-pick-name">{p.name}</span>
          </label>
        ))}
        {projects.length > withData.length && <div className="muted small">{projects.length - withData.length} without Jira data yet</div>}
      </div>

      {!chosen.length ? <div className="muted small burn-empty">Pick a project to see its capacity burn.</div>
        : !sprints.length ? <div className="muted small burn-empty">No tickets in any calendar sprint for these projects.</div> : <>
        <div className="burn-total">
          <div className="burn-label">Total <span className="muted">· {sprints.length === 1 ? sprintName(sprints[0].name) : `${sprintName(sprints[0].name)} → ${sprintName(sprints[sprints.length - 1].name).replace(/^Q\d /, '')}`}</span></div>
          <div className="small">{progressText(estDone, estNow)}</div>
          {quarters.length > 0 && <div className="small quarter-line" title="Done / estimate by the epics’ quarter labels">
            {quarters.map((q, i) => <span key={q.quarter ?? 'none'}>{i > 0 && <span className="muted"> · </span>}{q.quarter ? <span className="qtag">{q.quarter}</span> : <span className="muted">no label </span>}<span className="muted"> {n(q.done)}/{n(q.estimate)} d</span></span>)}
          </div>}
          <div className={'small ' + (driftWarn(baseAll) ? 'warn-text' : 'muted')}>{baseLine}</div>
          <Track burned={total.burnedPct} elapsed={total.elapsedPct} />
          <div className="small">{capacityText(total.done, total.available)}</div>
          <div className="small muted">{n(total.elapsed)} d of the team time passed · {pct(total.elapsedPct)}</div>
          <div className="small">
            <span className={'band ' + bandOf(total.load)}><span aria-hidden="true">{ICON[bandOf(total.load)]}</span> {pct(total.load)}</span>
            <span className="muted"> {n(total.committed)} d in Jira · {n(total.remaining)} d left</span>
          </div>
          {active && <div className="small muted">Now: {sprintName(active.name)}, {pct(active.burnedPct)} burned with {pct(active.elapsedPct)} of its time passed</div>}
        </div>

        <div className="burn-label">By sprint</div>
        {sprints.map((s) => <SprintCard key={s.name} s={s} open={isOpen(s)} onToggle={() => setCards({ ...cards, [s.name]: !isOpen(s) })} />)}
        <p className="muted small">Done = estimate of finished work ÷ the tickets’ estimate now. Baseline = the original estimate on each project’s own Jira issue (else its epics’ own estimates). Capacity used = work done ÷ team time: the available days (working − own leave) of the people with tickets in the sprint, each counted once; the tick marks the time passed.</p>
      </>}
    </aside>
  );
}
