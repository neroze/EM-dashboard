// Release readiness: one "Release Activity" epic in Jira project LP, and every
// issue whose parent is that epic. Pure — the Jira client feeds it mapped
// tasks, the board renders what it returns. Definitions follow the
// "Release Readiness Dashboard: Requirements Baseline" (v1, 2026-11-17),
// including its decisions: estimates also in 6-hour working days, with the
// duration following the most-loaded assignee (3); a hand-picked planning
// date wins over the inferred one (4); fix-version tickets outside the epic
// are counted separately (5).

export const RELEASE_EPIC_KEY = /^LP-\d{1,7}$/;
export const RELEASE_TASK_LIMIT = 100;
export const RELEASE_EPIC_LIMIT = 30;
export const HOURS_PER_DAY = 6;

export type Cat = 'todo' | 'inprogress' | 'done';

export interface FixVersion { id: string; name: string; releaseDate: string | null; released: boolean }
export interface ReleaseTask {
  key: string; summary: string; status: string; cat: Cat; type: string;
  assigneeId: string | null; assigneeName: string | null;
  created: string | null; dueDate: string | null; resolved: string | null;
  origSec: number | null; remSec: number | null; spentSec: number | null;
  fixVersions: FixVersion[];
}
export interface ReleaseEpic { key: string; summary: string; status: string; cat: Cat; created: string | null; dueDate: string | null }
export interface OutsideTicket { key: string; summary: string; status: string; cat: Cat; type: string; assigneeName: string | null }

export const ARTIFACTS = ['Azure', 'AMI', 'SaaS', 'OVA', 'Plugins', 'ISO', 'Patch'] as const;
export const OTHER = 'Other release tasks';
export type Artifact = (typeof ARTIFACTS)[number] | typeof OTHER;

/** the first rule whose words appear in the summary wins (case does not matter) */
const RULES: [Artifact, RegExp][] = [
  ['Azure', /azure|\bvhd\b/i],
  ['AMI', /\bami\b/i],
  ['SaaS', /saas/i],
  ['OVA', /\bova\b/i],
  ['Plugins', /plugin/i],
  ['ISO', /\biso\b/i],
  ['Patch', /patch/i],
];
export function artifactOf(summary: string): Artifact {
  for (const [a, re] of RULES) if (re.test(summary)) return a;
  return OTHER;
}

/** "[Build-3]" → [3]; "[Build-3, 4, 5]" → [3, 4, 5]; none → [] */
export function buildsOf(summary: string): number[] {
  const out = new Set<number>();
  for (const m of summary.matchAll(/\[\s*build\s*-\s*([\d,\s]+)\]/gi)) {
    for (const x of m[1].split(',')) { const v = Number(x.trim()); if (x.trim() && Number.isInteger(v) && v >= 0) out.add(v); }
  }
  return [...out].sort((a, b) => a - b);
}

/** Jira status category key → the dashboard's state */
export function catOf(key: unknown): Cat {
  return key === 'done' ? 'done' : key === 'indeterminate' ? 'inprogress' : 'todo';
}

const h1 = (sec: number) => Math.round((sec / 3600) * 10) / 10;
const d1 = (hours: number) => Math.round((hours / HOURS_PER_DAY) * 10) / 10;
const day = (iso: string | null) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : null);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);

/** the day the most tasks were created; the earliest such day on a tie */
export function inferPlanningDay(tasks: ReleaseTask[]): string | null {
  const n = new Map<string, number>();
  for (const t of tasks) { const d = day(t.created); if (d) n.set(d, (n.get(d) ?? 0) + 1); }
  let best: string | null = null, max = 0;
  for (const [d, c] of [...n].sort((a, b) => a[0].localeCompare(b[0]))) if (c > max) { best = d; max = c; }
  return best;
}

export interface Counts { total: number; done: number; inprogress: number; todo: number }
const count = (ts: { cat: Cat }[]): Counts => ({
  total: ts.length,
  done: ts.filter((t) => t.cat === 'done').length,
  inprogress: ts.filter((t) => t.cat === 'inprogress').length,
  todo: ts.filter((t) => t.cat === 'todo').length,
});

export type BuildState = 'complete' | 'inprogress' | 'notstarted' | 'none';
export interface ArtifactRow { artifact: Artifact; counts: Counts; state: BuildState; latestBuild: number | null; keys: string[] }
export interface BuildRow { build: number; tasks: number; done: number; artifacts: Artifact[]; keys: string[] }
export interface AssigneeRow extends Counts { name: string; accountId: string | null; estimateH: number; remainingH: number; estimateD: number; remainingD: number; loggedH: number; loggedD: number }
export type Gap = 'noFixVersion' | 'otherFixVersion' | 'noBuildTag' | 'noDueDate' | 'noEstimate' | 'noAssignee';

export interface ReleaseView {
  epic: ReleaseEpic; today: string; incomplete: boolean;
  counts: Counts; pctDone: number | null;
  hours: { estimate: number; remaining: number; logged: number; withoutEstimate: number };
  /** decision 3: 1 d = 6 h; duration = the most-loaded assignee's load */
  days: { estimate: number; remaining: number; duration: number; remainingDuration: number; durationBy: string | null; remainingBy: string | null };
  planning: { day: string | null; inferred: string | null; manual: string | null };
  scopeAdded: { tasks: number; hours: number; days: number; rows: { key: string; summary: string; created: string; estimateH: number | null; cat: Cat }[] };
  builds: { triggered: number | null; rows: BuildRow[]; untagged: string[] };
  overdue: { key: string; summary: string; dueDate: string; daysLate: number; assigneeName: string | null; cat: Cat }[];
  release: { date: string | null; version: FixVersion | null; daysTo: number | null };
  artifacts: ArtifactRow[];
  assignees: AssigneeRow[];
  gaps: Record<Gap, string[]>;
  tasks: (ReleaseTask & { artifact: Artifact; builds: number[] })[];
}

export function releaseView(epic: ReleaseEpic, raw: ReleaseTask[], today: string, opts: { incomplete?: boolean; planningDate?: string | null } = {}): ReleaseView {
  const tasks = raw.map((t) => ({ ...t, artifact: artifactOf(t.summary), builds: buildsOf(t.summary) }));
  const counts = count(tasks);
  const open = tasks.filter((t) => t.cat !== 'done');
  const sum = (ts: typeof tasks, f: (t: ReleaseTask) => number | null) => ts.reduce((a, t) => a + (f(t) ?? 0), 0);
  const estSec = sum(tasks, (t) => t.origSec), remSec = sum(open, (t) => t.remSec), spentSec = sum(tasks, (t) => t.spentSec);

  // planning day: hand-picked (decision 4), else inferred
  const inferred = inferPlanningDay(tasks);
  const manual = opts.planningDate && /^\d{4}-\d{2}-\d{2}$/.test(opts.planningDate) ? opts.planningDate : null;
  const planDay = manual ?? inferred;
  const added = planDay ? tasks.filter((t) => { const d = day(t.created); return !!d && d > planDay; }) : [];

  // builds
  const byBuild = new Map<number, typeof tasks>();
  for (const t of tasks) for (const b of t.builds) byBuild.set(b, [...(byBuild.get(b) ?? []), t]);
  const buildRows: BuildRow[] = [...byBuild].sort((a, b) => a[0] - b[0]).map(([build, ts]) => ({
    build, tasks: ts.length, done: ts.filter((t) => t.cat === 'done').length,
    artifacts: [...new Set(ts.map((t) => t.artifact))], keys: ts.map((t) => t.key),
  }));
  const allBuilds = tasks.flatMap((t) => t.builds);

  // release date: the latest release date among the tasks' FIRST fix versions
  let version: FixVersion | null = null;
  for (const t of tasks) { const v = t.fixVersions[0]; if (v?.releaseDate && (!version || v.releaseDate > version.releaseDate!)) version = v; }
  // a task with no dated first fix version still names the release when its version matches by name
  const relName = version?.name ?? null;

  // artifacts, in rule order, then Other
  const artifacts: ArtifactRow[] = [...ARTIFACTS, OTHER].map((a) => {
    const ts = tasks.filter((t) => t.artifact === a);
    const c = count(ts);
    const bs = ts.flatMap((t) => t.builds);
    const state: BuildState = !c.total ? 'none' : c.done === c.total ? 'complete' : c.todo === c.total ? 'notstarted' : 'inprogress';
    return { artifact: a as Artifact, counts: c, state, latestBuild: bs.length ? Math.max(...bs) : null, keys: ts.map((t) => t.key) };
  });

  // assignees: decision 3's duration = the most-loaded person, not the sum
  const people = new Map<string, AssigneeRow>();
  for (const t of tasks) {
    const id = t.assigneeId ?? '';
    const r = people.get(id) ?? { name: t.assigneeName ?? (id ? id : 'Unassigned'), accountId: t.assigneeId, total: 0, done: 0, inprogress: 0, todo: 0, estimateH: 0, remainingH: 0, estimateD: 0, remainingD: 0, loggedH: 0, loggedD: 0 };
    r.total++; r[t.cat]++;
    r.estimateH += (t.origSec ?? 0) / 3600;
    r.loggedH += (t.spentSec ?? 0) / 3600;
    if (t.cat !== 'done') r.remainingH += (t.remSec ?? 0) / 3600;
    people.set(id, r);
  }
  const assignees = [...people.values()].map((r) => ({ ...r, estimateH: Math.round(r.estimateH * 10) / 10, remainingH: Math.round(r.remainingH * 10) / 10, estimateD: d1(r.estimateH), remainingD: d1(r.remainingH), loggedH: Math.round(r.loggedH * 10) / 10, loggedD: d1(r.loggedH) }))
    .sort((a, b) => (a.accountId ? 0 : 1) - (b.accountId ? 0 : 1) || b.total - a.total || a.name.localeCompare(b.name));
  const top = (f: (r: AssigneeRow) => number) => assignees.reduce<AssigneeRow | null>((m, r) => (f(r) > (m ? f(m) : 0) ? r : m), null);
  const durTop = top((r) => r.estimateH), remTop = top((r) => r.remainingH);

  const gaps: Record<Gap, string[]> = {
    noFixVersion: tasks.filter((t) => !t.fixVersions.length).map((t) => t.key),
    otherFixVersion: relName ? tasks.filter((t) => t.fixVersions.length && t.fixVersions[0].name !== relName).map((t) => t.key) : [],
    noBuildTag: tasks.filter((t) => !t.builds.length).map((t) => t.key),
    noDueDate: tasks.filter((t) => !t.dueDate).map((t) => t.key),
    noEstimate: tasks.filter((t) => t.origSec === null).map((t) => t.key),
    noAssignee: tasks.filter((t) => !t.assigneeId).map((t) => t.key),
  };

  return {
    epic, today, incomplete: !!opts.incomplete,
    counts, pctDone: counts.total ? Math.round((counts.done / counts.total) * 100) : null,
    hours: { estimate: h1(estSec), remaining: h1(remSec), logged: h1(spentSec), withoutEstimate: gaps.noEstimate.length },
    days: {
      estimate: d1(estSec / 3600), remaining: d1(remSec / 3600),
      duration: durTop?.estimateD ?? 0, remainingDuration: remTop?.remainingD ?? 0,
      durationBy: durTop?.name ?? null, remainingBy: remTop?.name ?? null,
    },
    planning: { day: planDay, inferred, manual },
    scopeAdded: {
      tasks: added.length, hours: h1(sum(added, (t) => t.origSec)), days: d1(sum(added, (t) => t.origSec) / 3600),
      rows: added.map((t) => ({ key: t.key, summary: t.summary, created: day(t.created)!, estimateH: t.origSec === null ? null : h1(t.origSec), cat: t.cat })),
    },
    builds: { triggered: allBuilds.length ? Math.max(...allBuilds) : null, rows: buildRows, untagged: gaps.noBuildTag },
    overdue: open.filter((t) => t.dueDate && t.dueDate < today)
      .map((t) => ({ key: t.key, summary: t.summary, dueDate: t.dueDate!, daysLate: daysBetween(t.dueDate!, today), assigneeName: t.assigneeName, cat: t.cat }))
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    release: { date: version?.releaseDate ?? null, version, daysTo: version?.releaseDate ? daysBetween(today, version.releaseDate) : null },
    artifacts, assignees, gaps, tasks,
  };
}

/** decision 5: fix-version tickets outside the epic, by state */
export function outsideCounts(ts: OutsideTicket[]): Counts { return count(ts); }
