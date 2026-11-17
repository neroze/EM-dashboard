// Capacity burn across several projects, sprint by sprint — the Projects
// board's side bar. Pure (no DOM), so the tests can load it.
//
// A sprint's capacity = the available days of everyone with a ticket in it in
// any selected project, each person counted ONCE (someone on two projects
// doesn't bring their days twice). Burned = estimate done on the sprint's
// tickets; in Jira = done + remaining. Time passed = capacity already elapsed.

interface SprintPersonIn { id: string; working: number; leave: number; available: number; elapsed: number; assigned: boolean }
export interface SprintIn {
  name: string; startDate: string; endDate: string; state: 'past' | 'active' | 'future';
  available: number; done: number; committed: number; remaining: number; tickets: number; open: number; assignedPeople: number;
  people: SprintPersonIn[];
}
export interface BurnProjectIn { id: string; name: string; sprints: SprintIn[] }

export interface BurnPart { id: string; name: string; people: number; available: number; done: number; committed: number; remaining: number; tickets: number; open: number }
export interface BurnSprint {
  name: string; startDate: string; endDate: string; state: 'past' | 'active' | 'future';
  people: number; working: number; leave: number; available: number; elapsed: number;
  done: number; committed: number; remaining: number; tickets: number; open: number;
  burnedPct: number | null;  // done ÷ available
  elapsedPct: number | null; // elapsed ÷ available
  load: number | null;       // in Jira ÷ available (null: work but no capacity)
  pace: 'ahead' | 'on-pace' | 'behind' | null; // active sprint: burned vs time passed (10-point margin)
  parts: BurnPart[];         // per project, biggest first
}
export interface BurnTotal {
  sprints: number; available: number; elapsed: number; done: number; committed: number; remaining: number;
  burnedPct: number | null; elapsedPct: number | null; load: number | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const ratio = (a: number, b: number) => (b > 0 ? a / b : a > 0 ? null : 0);

export function mergeBurn(projects: BurnProjectIn[]): { sprints: BurnSprint[]; total: BurnTotal } {
  const by = new Map<string, { s: SprintIn; parts: BurnPart[]; people: Map<string, SprintPersonIn>; done: number; committed: number; remaining: number; tickets: number; open: number }>();
  for (const p of projects) {
    for (const s of p.sprints) {
      if (!s.tickets) continue; // nothing of this project's in the sprint
      let g = by.get(s.name);
      if (!g) by.set(s.name, (g = { s, parts: [], people: new Map(), done: 0, committed: 0, remaining: 0, tickets: 0, open: 0 }));
      for (const x of s.people) if (x.assigned && !g.people.has(x.id)) g.people.set(x.id, x);
      g.done += s.done; g.committed += s.committed; g.remaining += s.remaining; g.tickets += s.tickets; g.open += s.open;
      g.parts.push({ id: p.id, name: p.name, people: s.assignedPeople, available: s.available, done: s.done, committed: s.committed, remaining: s.remaining, tickets: s.tickets, open: s.open });
    }
  }
  const sprints = [...by.values()].sort((a, b) => a.s.startDate.localeCompare(b.s.startDate)).map(({ s, parts, people, ...w }): BurnSprint => {
    const ps = [...people.values()];
    const available = r2(ps.reduce((a, x) => a + x.available, 0));
    const elapsed = r2(ps.reduce((a, x) => a + x.elapsed, 0));
    const done = r2(w.done), committed = r2(w.committed);
    const burnedPct = ratio(done, available), elapsedPct = ratio(elapsed, available);
    const pace = s.state !== 'active' || elapsed <= 0 || burnedPct === null || elapsedPct === null ? null
      : burnedPct < elapsedPct - 0.1 ? 'behind' : burnedPct > elapsedPct + 0.1 ? 'ahead' : 'on-pace';
    return {
      name: s.name, startDate: s.startDate, endDate: s.endDate, state: s.state,
      people: ps.length, working: ps.reduce((a, x) => a + x.working, 0), leave: r2(ps.reduce((a, x) => a + x.leave, 0)), available, elapsed,
      done, committed, remaining: r2(w.remaining), tickets: w.tickets, open: w.open,
      burnedPct, elapsedPct, load: ratio(committed, available), pace,
      parts: parts.sort((a, b) => b.committed - a.committed || a.name.localeCompare(b.name)),
    };
  });
  const sum = (k: 'available' | 'elapsed' | 'done' | 'committed' | 'remaining') => r2(sprints.reduce((a, x) => a + x[k], 0));
  const t = { available: sum('available'), elapsed: sum('elapsed'), done: sum('done'), committed: sum('committed'), remaining: sum('remaining') };
  return {
    sprints,
    total: { sprints: sprints.length, ...t, burnedPct: ratio(t.done, t.available), elapsedPct: ratio(t.elapsed, t.available), load: ratio(t.committed, t.available) },
  };
}

// ---- the wording, shared by the card headers, the tiles and the side bar ----
// Three different measures, never mixed:
//   progress  = estimate done ÷ the tickets' estimate now
//   baseline  = the project's high-level original estimate; the tickets' estimate vs it = scope drift
//   capacity  = estimate done ÷ team time (available person-days) in the sprints the work sat in
const d = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1));
const p = (x: number | null) => (x === null ? 'no capacity' : `${Math.round(x * 100)}%`);

export interface BaselineIn { days: number | null; source: 'project' | 'epics' | null; tickets: number; growth: number | null; growthPct: number | null; fetched: boolean }

export const progressText = (done: number, estimate: number) =>
  `Done ${d(done)} of ${d(estimate)} d estimate · ${estimate > 0 ? p(done / estimate) : '—'}`;

export const capacityText = (done: number, available: number) =>
  `Capacity used: ${d(done)} d of work in ${d(available)} d of team time · ${p(ratio(done, available))}`;

/** "Baseline 47 d · estimate now 75.3 d, +28.3 d (+60%)" */
export function baselineText(b: BaselineIn, key?: string): string {
  if (b.days === null) return b.fetched ? 'No baseline: no original estimate on the project or its epics in Jira' : 'Baseline: refresh from Jira to read it';
  const from = b.source === 'project' ? (key ? `${key} estimate` : 'project estimate') : 'epics’ own estimates';
  const g = b.growth ?? 0;
  const drift = Math.abs(g) < 0.05 ? 'estimate now matches it'
    : `estimate now ${d(b.tickets)} d, ${g > 0 ? '+' : '−'}${d(Math.abs(g))} d (${g > 0 ? '+' : '−'}${Math.round(Math.abs(b.growthPct ?? 0) * 100)}%)`;
  return `Baseline ${d(b.days)} d (${from}) · ${drift}`;
}
/** scope drift worth flagging: more than 10% over the baseline */
export const driftWarn = (b: BaselineIn) => b.growthPct !== null && b.growthPct > 0.1;

/** the active sprint's pace: share of its work done vs share of its time passed (10-point margin) */
export function sprintPace(s: { done: number; committed: number; elapsedPct: number } | null | undefined): 'behind' | 'on pace' | 'ahead' | null {
  if (!s || s.committed <= 0 || s.elapsedPct <= 0) return null;
  const work = s.done / s.committed;
  return work < s.elapsedPct - 0.1 ? 'behind' : work > s.elapsedPct + 0.1 ? 'ahead' : 'on pace';
}
