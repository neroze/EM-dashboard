// Project health: a project (a Jira idea) → its epics → their tickets.
// Work comes from Jira (original / remaining estimate, assignee, sprint);
// availability from BambooHR leave. Pure.
//
// Everyone works at 100%: a person-day = 1 − leave fraction on their working
// days (weekends and their location's holidays = 0). Estimates are 6-hour days.
//
//  original   = Σ original estimate                 (the plan)
//  remaining  = Σ remaining estimate of open tickets (done tickets = 0)
//  done       = burned estimate: done tickets in full, open ones original − remaining
//  current    = done + remaining  (> original when estimates grew)
//  capacity   = working days − booked leave, project start → deadline
//  burned     = capacity already elapsed (start → yesterday)
//  forecast   = each person works through their open tickets in sprint order
//               (active sprint, then future sprints, then backlog, by rank)
//               on the days they are not on leave; unassigned tickets go to
//               whoever frees up first. The project finishes with its last ticket.
//
// Nothing here knows a leave TYPE — only "days unavailable".
import { addDays, eachDay, isWeekend } from './dates.ts';

export type Band = 'green' | 'amber' | 'red';
/** one person-day: is it a working day for them, and how much of it is leave */
export type DayFn = (personId: string, day: string) => { working: boolean; out: number };

/** a Jira sprint. Future sprints have no dates until someone starts them in Jira. */
export interface Sprint { id?: string | null; name: string; state: 'active' | 'future' | 'closed'; startDate: string | null; endDate: string | null }
export interface Ticket {
  key: string; summary: string; status: string; done: boolean; epicKey: string;
  assigneeId: string | null; assigneeName: string | null;
  originalDays: number | null; remainingDays: number | null;
  sprint: Sprint | null; rank: number;
  /** when Jira resolved it (done tickets); older snapshots don't have it */
  resolvedDate?: string | null;
  /** Jira resolution name (e.g. "Done", "Duplicate", "Won't Do") */
  resolution?: string | null;
  /** raw time-tracking seconds of THIS ticket (not its sub-tasks) — what the
   *  forecast report and its snapshots use, exactly like the skill */
  origSec?: number | null; remSec?: number | null;
  /** every sprint the ticket has been in (the report buckets by the latest) */
  sprints?: Sprint[];
  /** a sub-task: its epic is its story's epic */
  subtask?: boolean;
  /** Jira issue type name: Story, Task, Bug, Sub-task… (absent on older snapshots) */
  type?: string;
  /** a sub-task: its story's key (absent on older snapshots) */
  parentKey?: string;
  /** still open in Jira, but its epic — or, for a sub-task, its story — is closed: nothing left to deliver.
   *  Counted like a cancelled ticket (see closeWithEpics); closedBy says which closed it. */
  closedWithEpic?: boolean;
  closedBy?: 'epic' | 'story';
}
export interface ProjectEpic {
  key: string; summary: string; status: string; done: boolean; dueDate: string | null;
  /** the original estimate set on the epic itself (not its tickets' sum); absent on snapshots fetched before it was read */
  estimateDays?: number | null;
  /** quarter labels on the epic ("Q3-2026"), date order; absent on older snapshots */
  quarters?: string[];
}

export const GREEN_MAX = 0.8;
export const AMBER_MAX = 1.0;
const EPS = 1e-9;
const HORIZON_DAYS = 730;
export const r2 = (n: number) => Math.round(n * 100) / 100;

export function band(util: number): Band {
  if (util <= GREEN_MAX + EPS) return 'green';
  if (util <= AMBER_MAX + EPS) return 'amber';
  return 'red';
}
const RANK: Record<Band, number> = { green: 0, amber: 1, red: 2 };
export const worse = (a: Band, b: Band): Band => (RANK[a] >= RANK[b] ? a : b);

/** need ÷ capacity; nothing available but something needed = Infinity */
export function utilisation(need: number, capacity: number): number {
  if (need <= EPS) return 0;
  return capacity <= EPS ? Infinity : need / capacity;
}

export const remainingOf = (t: Ticket) => (t.done ? 0 : Math.max(0, t.remainingDays ?? t.originalDays ?? 0));
export const doneOf = (t: Ticket) =>
  t.done ? Math.max(0, t.originalDays ?? 0) : Math.max(0, (t.originalDays ?? 0) - (t.remainingDays ?? t.originalDays ?? 0));

export interface WorkTotals { original: number; current: number; done: number; remaining: number; tickets: number; open: number; unestimated: number }
export function workTotals(ts: Ticket[]): WorkTotals {
  let original = 0, done = 0, remaining = 0, open = 0, unestimated = 0;
  for (const t of ts) {
    original += t.originalDays ?? 0;
    done += doneOf(t);
    remaining += remainingOf(t);
    if (!t.done) open++;
    if (!t.done && t.originalDays === null && t.remainingDays === null) unestimated++;
  }
  return { original: r2(original), current: r2(done + remaining), done: r2(done), remaining: r2(remaining), tickets: ts.length, open, unestimated };
}

/** working days, leave days and available days for a person in [from, to] */
export function windowDays(id: string, from: string, to: string, day: DayFn) {
  let working = 0, unavailable = 0;
  if (to >= from) for (const d of eachDay(from, to)) {
    const x = day(id, d);
    if (!x.working) continue;
    working++;
    unavailable += Math.min(1, Math.max(0, x.out));
  }
  return { working, unavailable: r2(unavailable), available: r2(working - unavailable) };
}

/** the person's leave days in [from, to] (working days only): date + fraction */
export function leaveDates(id: string, from: string, to: string, day: DayFn): { day: string; out: number }[] {
  const out: { day: string; out: number }[] = [];
  if (to >= from) for (const d of eachDay(from, to)) {
    const x = day(id, d);
    if (x.working && x.out > EPS) out.push({ day: d, out: r2(Math.min(1, x.out)) });
  }
  return out;
}

/** weekdays strictly after `due` up to and including `finish` */
export function workingDaysLate(due: string, finish: string): number {
  if (finish <= due) return 0;
  return eachDay(addDays(due, 1), finish).filter((d) => !isWeekend(d)).length;
}

/** sprint order: active, then future by start date, then backlog; rank within */
export function queueOrder(a: Ticket, b: Ticket): number {
  const k = (t: Ticket) => (t.sprint?.state === 'active' ? 0 : t.sprint?.state === 'future' ? 1 : 2);
  return k(a) - k(b)
    || (a.sprint?.startDate ?? '9999').localeCompare(b.sprint?.startDate ?? '9999')
    || a.rank - b.rank;
}

/** one person working through tickets at 100% of their non-leave days */
class Worker {
  id: string; day: string; used = 0; // fraction of `day` already spent
  log = new Map<string, number>(); // day → forecast work done that day
  private dayFn: DayFn;
  constructor(id: string, from: string, dayFn: DayFn) { this.id = id; this.day = from; this.dayFn = dayFn; }
  /** the date the person runs out of capacity on (null = never within horizon) */
  free(): string | null { return this.seek() ? this.day : null; }
  private seek(): boolean {
    for (let i = 0; i < HORIZON_DAYS; i++) {
      const x = this.dayFn(this.id, this.day);
      const cap = x.working ? 1 - Math.min(1, Math.max(0, x.out)) : 0;
      if (cap - this.used > EPS) return true;
      this.day = addDays(this.day, 1); this.used = 0;
    }
    return false;
  }
  /** spend `need` days; returns the finish date, or 'never' */
  work(need: number): string | 'never' {
    let left = need, last = this.day;
    if (left <= EPS) return last;
    for (let i = 0; i < HORIZON_DAYS * 2; i++) {
      if (!this.seek()) return 'never';
      const x = this.dayFn(this.id, this.day);
      const cap = 1 - Math.min(1, Math.max(0, x.out)) - this.used;
      const take = Math.min(cap, left);
      left -= take; this.used += take; last = this.day;
      if (take > EPS) this.log.set(this.day, (this.log.get(this.day) ?? 0) + take);
      if (left <= EPS) return last;
    }
    return 'never';
  }
}

export interface PersonResult {
  id: string;
  working: number; leave: number; available: number;          // start → deadline
  burned: number;                                               // available start → yesterday
  workingAhead: number; leaveAhead: number; availableAhead: number; // today (or start) → deadline: workingAhead − leaveAhead = availableAhead
  leaveDatesAhead: { day: string; out: number }[];              // the dates behind leaveAhead
  remaining: number; done: number; openTickets: number;         // their tickets
  /** has open tickets. Only these people count as capacity from today on and
   *  can pick up unassigned work; others have finished their part. */
  active: boolean;
  utilisation: number; band: Band; finish: string | null | 'never';
  lateDays: number | null; // working days their last ticket lands after the deadline
}
export interface EpicResult {
  key: string; totals: WorkTotals; finish: string | null | 'never'; dueDate: string;
  lateDays: number | null; health: Band;
}
export interface ProjectResult {
  totals: WorkTotals;
  scopeGrowth: number;
  working: number; leave: number; available: number;
  burned: number; availableAhead: number; leaveAhead: number;
  /**
   * Progress, all measured up to the START OF TODAY, over one team: the people
   * with work in the window (an open ticket, or one delivered since the start).
   *  capacityUsed  = their available days, start → yesterday   (= `burned`)
   *  workDone      = estimate DELIVERED (done tickets' original estimate) start → yesterday
   *  workTaken     = estimate the window took on: everything not delivered before the start
   * Partial progress on open tickets isn't counted: Jira can't say when it happened
   * (the same rule as the forecast report's "Delivered").
   */
  capacityUsedPct: number; windowDonePct: number;
  workDone: number; workTaken: number; deliveredToday: number; team: number;
  /** the progress window's first day: the earlier of the project start and the given progressFrom */
  progressFrom: string;
  /** overall: delivered ÷ all estimate, whenever delivered */
  workDonePct: number; delivered: number; estimate: number;
  /** estimate already delivered when the project started: done tickets resolved
   *  before the start date (or, without a resolved date, whose sprint ended before it) */
  carriedIn: number;
  /** earliest sprint start of any burned work (a better start date when earlier than the project's) */
  firstWorkDate: string | null;
  utilisation: number; band: Band;
  pace: { rate: number; capacityNeeded: number } | null;
  finish: string | null | 'never'; lateDays: number | null;
  /** if the remaining work could be spread over everyone */
  pooledFinish: string | null | 'never';
  status: Band;
  people: PersonResult[];
  unassigned: { remaining: number; tickets: number };
  epics: EpicResult[];
  ticketFinish: Record<string, string | 'never'>;
  /** person → day → forecast work (days) scheduled that day */
  forecastLog: Map<string, Map<string, number>>;
}

/**
 * people: the person id for each ticket assignee (BambooHR employee id, or a
 * placeholder for someone unmatched); tickets whose assignee maps to nothing
 * count as unassigned.
 */
export function evaluateProject(
  p: { startDate: string; deadline: string },
  epics: ProjectEpic[],
  tickets: Ticket[],
  personOf: (assigneeId: string | null) => string | null,
  day: DayFn,
  today: string,
  /** where progress is measured from (e.g. the calendar's Sprint 1) when that's
   *  earlier than the project start; the forecast still runs from today */
  opts: { progressFrom?: string | null } = {},
): ProjectResult {
  const totals = workTotals(tickets);
  const ps = opts.progressFrom && opts.progressFrom < p.startDate ? opts.progressFrom : p.startDate;
  const from = today > p.startDate ? today : p.startDate; // forecast starts here
  const yesterday = addDays(today, -1);

  // the team: everyone with a ticket in the project
  const byPerson = new Map<string, Ticket[]>();
  const unassigned: Ticket[] = [];
  for (const t of tickets) {
    const id = personOf(t.assigneeId);
    if (!id) { if (!t.done) unassigned.push(t); continue; }
    const l = byPerson.get(id); if (l) l.push(t); else byPerson.set(id, [t]);
  }

  // forecast: own queues first, then unassigned to whoever frees up first
  const workers = new Map([...byPerson.keys()].map((id) => [id, new Worker(id, from, day)]));
  const ticketFinish: Record<string, string | 'never'> = {};
  const personFinish = new Map<string, string | 'never' | null>();
  for (const [id, ts] of byPerson) {
    const w = workers.get(id)!;
    let f: string | 'never' | null = null;
    for (const t of ts.filter((x) => !x.done).sort(queueOrder)) {
      const r = remainingOf(t);
      if (r <= EPS) continue;
      f = w.work(r);
      ticketFinish[t.key] = f;
      if (f === 'never') break;
    }
    personFinish.set(id, f);
  }
  const hasOpen = (id: string) => (byPerson.get(id) ?? []).some((t) => !t.done && remainingOf(t) > EPS);
  const activeWorkers = [...workers.values()].filter((w) => hasOpen(w.id));
  for (const t of unassigned.sort(queueOrder)) {
    const r = remainingOf(t);
    if (r <= EPS) continue;
    let best: Worker | null = null, bestDay = '';
    for (const w of activeWorkers) {
      const d = w.free();
      if (d && (!best || d < bestDay)) { best = w; bestDay = d; }
    }
    ticketFinish[t.key] = best ? best.work(r) : 'never';
  }
  const latest = (fs: (string | 'never' | null | undefined)[]): string | null | 'never' =>
    fs.includes('never') ? 'never' : fs.reduce<string | null>((m, f) => (f && f !== 'never' && (!m || f > m) ? f : m), null);
  const finish = totals.remaining <= EPS ? null : latest(Object.values(ticketFinish));

  // pooled: all remaining work against everyone's combined days
  let pooledFinish: string | null | 'never' = null;
  if (totals.remaining > EPS) {
    pooledFinish = 'never';
    let acc = 0;
    for (let i = 0, d = from; i < HORIZON_DAYS; i++, d = addDays(d, 1)) {
      for (const w of activeWorkers) { const x = day(w.id, d); if (x.working) acc += 1 - Math.min(1, Math.max(0, x.out)); }
      if (acc >= totals.remaining - EPS) { pooledFinish = d; break; }
    }
  }

  const people: PersonResult[] = [...byPerson.entries()].map(([id, ts]) => {
    const all = windowDays(id, ps, p.deadline, day);
    const burned = windowDays(id, ps, yesterday < p.deadline ? yesterday : p.deadline, day);
    const ahead = windowDays(id, from, p.deadline, day);
    const wt = workTotals(ts);
    const active = wt.remaining > EPS;
    const u = utilisation(wt.remaining, ahead.available);
    const f = active ? personFinish.get(id) ?? null : null;
    return {
      id, working: all.working, leave: all.unavailable, available: all.available, burned: burned.available,
      workingAhead: ahead.working, leaveAhead: ahead.unavailable, availableAhead: ahead.available,
      leaveDatesAhead: leaveDates(id, from, p.deadline, day),
      remaining: wt.remaining, done: wt.done, openTickets: wt.open, active,
      utilisation: u, band: band(u), finish: f,
      lateDays: f === 'never' ? null : f ? workingDaysLate(p.deadline, f) : 0,
    };
  }).sort((a, b) => Number(b.active) - Number(a.active) || b.utilisation - a.utilisation);

  // ---- progress: one cut-off (start of today), one team, delivered estimate
  const est = (t: Ticket) => Math.max(0, t.originalDays ?? 0);
  const before = (t: Ticket) => t.done && (t.resolvedDate ? t.resolvedDate < ps : !!t.sprint?.endDate && t.sprint.endDate < ps);
  const today_ = (t: Ticket) => t.done && !before(t) && !!t.resolvedDate && t.resolvedDate >= today;
  const sumEst = (ts: Ticket[]) => r2(ts.reduce((s, t) => s + est(t), 0));
  const carriedIn = sumEst(tickets.filter(before));
  const deliveredToday = sumEst(tickets.filter(today_));
  const workDone = sumEst(tickets.filter((t) => t.done && !before(t) && !today_(t)));
  const estimate = sumEst(tickets), delivered = sumEst(tickets.filter((t) => t.done));
  const workTaken = r2(estimate - carriedIn);
  const firstWorkDate = tickets.filter((t) => t.done && t.sprint?.startDate).map((t) => t.sprint!.startDate!).sort()[0] ?? null;
  // the window's team: anyone with an open ticket or one delivered since the start
  const teamIds = new Set<string>();
  for (const [id, ts] of byPerson) if (ts.some((t) => !t.done || !before(t))) teamIds.add(id);

  const sum = (k: keyof PersonResult, set: 'team' | 'active') =>
    r2(people.filter((x) => (set === 'active' ? x.active : teamIds.has(x.id))).reduce((s, x) => s + (x[k] as number), 0));
  // the window counts its team; from today on, only people with open tickets
  const available = sum('available', 'team'), burned = sum('burned', 'team'), availableAhead = sum('availableAhead', 'active');
  const util = utilisation(totals.remaining, availableAhead);
  const rate = burned > EPS && workDone > EPS ? workDone / burned : null;
  const lateDays = finish === 'never' ? null : finish ? workingDaysLate(p.deadline, finish) : 0;
  const b = band(util);

  const epicResults: EpicResult[] = epics.map((e) => {
    const ts = tickets.filter((t) => t.epicKey === e.key);
    const et = workTotals(ts);
    const f = et.remaining <= EPS ? null : latest(ts.filter((t) => !t.done).map((t) => ticketFinish[t.key]));
    const due = e.dueDate ?? p.deadline;
    const late = f === 'never' ? null : f ? workingDaysLate(due, f) : 0;
    return {
      key: e.key, totals: et, finish: f, dueDate: due, lateDays: late,
      health: f === 'never' || (late ?? 0) > 0 ? 'red' : et.unestimated ? 'amber' : 'green',
    };
  });

  return {
    totals, scopeGrowth: r2(totals.current - totals.original),
    working: sum('working', 'team'), leave: sum('leave', 'team'), available,
    burned, availableAhead, leaveAhead: sum('leaveAhead', 'active'),
    capacityUsedPct: available > EPS ? r2(burned / available) : 0,
    windowDonePct: workTaken > EPS ? r2(workDone / workTaken) : 0,
    workDone, workTaken, deliveredToday, team: teamIds.size, progressFrom: ps,
    workDonePct: estimate > EPS ? r2(delivered / estimate) : 0, delivered, estimate,
    carriedIn, firstWorkDate,
    utilisation: util, band: b,
    pace: rate ? { rate: r2(rate), capacityNeeded: r2(totals.remaining / rate) } : null,
    finish, lateDays, pooledFinish,
    status: finish === 'never' || (lateDays ?? 0) > 0 ? 'red' : b,
    people,
    unassigned: { remaining: r2(unassigned.reduce((s, t) => s + remainingOf(t), 0)), tickets: unassigned.length },
    epics: epicResults,
    ticketFinish,
    forecastLog: new Map([...workers].map(([id, w]) => [id, w.log])),
  };
}

// ---- matching Jira assignees to BambooHR people ----------------------------------

export const normName = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** manual link wins, then work email, then a unique name. Unmatched people
 *  still count (weekdays, no leave known) — the caller gives them a placeholder id. */
export function matchPerson(
  a: { accountId: string; name: string | null; email: string | null },
  people: { id: string; displayName: string; email: string | null }[],
  manual: Record<string, string>,
): { id: string | null; how: 'manual' | 'email' | 'name' | 'none' } {
  if (manual[a.accountId] && people.some((p) => p.id === manual[a.accountId])) return { id: manual[a.accountId], how: 'manual' };
  if (a.email) {
    const m = people.find((p) => p.email && p.email.toLowerCase() === a.email!.toLowerCase());
    if (m) return { id: m.id, how: 'email' };
  }
  if (a.name) {
    const n = normName(a.name);
    const ms = people.filter((p) => normName(p.displayName) === n);
    if (ms.length === 1) return { id: ms[0].id, how: 'name' };
  }
  return { id: null, how: 'none' };
}

// ---- per sprint: the team's sprint calendar ------------------------------------

/** boards: the Jira sprint id of this sprint on each board (from sprints.json) */
export interface CalendarSprint { name: string; startDate: string; endDate: string; boards?: Record<string, string | number> }

/** year / quarter / sprint number read from a sprint name. Handles
 *  "Q4 2026 Sprint 4", "Data_Platform_2026_Q4_Sprint4", "DI_Q4_26Sprint4" */
export function sprintParts(name: string): { year: number | null; quarter: number; num: number } | null {
  const q = /q([1-4])/i.exec(name);
  const n = /sprint[\s_-]*(\d{1,2})(?!\d)/i.exec(name);
  if (!q || !n) return null;
  const y4 = /(?<!\d)(20\d\d)(?!\d)/.exec(name);
  const y2 = /q[1-4][\s_-]*(\d{2})(?!\d)/i.exec(name);
  return { year: y4 ? +y4[1] : y2 ? 2000 + +y2[1] : null, quarter: +q[1], num: +n[1] };
}

/**
 * Which calendar sprint a Jira sprint is. In order: its Jira id is one of the
 * calendar sprint's board ids; the same name; the same year/quarter/number in
 * the name (boards name sprints differently); the calendar sprint its dates
 * fall in. Future Jira sprints have no dates, so the first three matter.
 */
export function mapSprint(s: Sprint | null, cal: CalendarSprint[]): string | null {
  if (!s) return null;
  if (s.id) {
    const byId = cal.find((c) => Object.values(c.boards ?? {}).some((v) => String(v) === String(s.id)));
    if (byId) return byId.name;
  }
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const byName = cal.find((c) => norm(c.name) === norm(s.name));
  if (byName) return byName.name;
  const sp = sprintParts(s.name);
  if (sp) {
    const hits = cal.filter((c) => {
      const cp = sprintParts(c.name);
      return cp && cp.quarter === sp.quarter && cp.num === sp.num && (cp.year === null || sp.year === null || cp.year === sp.year);
    });
    if (hits.length === 1) return hits[0].name;
  }
  if (s.startDate) {
    const mid = s.endDate && s.endDate > s.startDate ? addDays(s.startDate, Math.floor(eachDay(s.startDate, s.endDate).length / 2)) : s.startDate;
    const hit = cal.find((c) => c.startDate <= mid && c.endDate >= mid);
    if (hit) return hit.name;
  }
  return null;
}

export interface SprintPerson {
  id: string; working: number; leave: number; available: number; committed: number; remaining: number;
  done: number; burnedPct: number; // estimate burned on their tickets in this sprint ÷ their available days
  elapsed: number; // their available days already passed in this sprint (to the end of yesterday)
  forecast: number; // remaining work the forecast has them doing inside this sprint
  leaveDates: { day: string; out: number }[]; // the dates behind `leave`
  /** has at least one ticket in this sprint. Only assigned people count
   *  towards the sprint's capacity; others appear only if the forecast has
   *  them working in it ("forecast only") */
  assigned: boolean;
  utilisation: number; band: Band;
}
export interface SprintRow {
  name: string; startDate: string; endDate: string; state: 'past' | 'active' | 'future';
  working: number; leave: number; available: number;
  elapsed: number;     // available days already passed
  elapsedPct: number;  // elapsed ÷ available
  burnedPct: number;   // capacity burned by estimate: done ÷ available
  pace: 'ahead' | 'on-pace' | 'behind' | null; // active sprint: estimate burned vs time passed
  committed: number;   // Jira: estimate of tickets in this sprint (done + remaining)
  done: number; remaining: number; tickets: number; open: number;
  forecast: number;    // forecast work by the sprint's assigned people inside it
  forecastOthers: number; // forecast work by people with no ticket in the sprint (not in its capacity)
  assignedPeople: number; // people with a ticket in the sprint — the capacity counts only them
  utilisation: number; band: Band; // committed ÷ available (active: remaining ÷ available ahead)
  forecastUtilisation: number;
  afterDeadline: boolean;
  beforeStart: boolean; // ends before the project starts (shown for look-back)
  people: SprintPerson[];
}
export interface SprintBreakdown {
  sprints: SprintRow[];
  backlog: { remaining: number; tickets: number };  // open, not in any sprint
  unmapped: { remaining: number; tickets: number; names: string[] }; // in a Jira sprint not on the calendar
}

/**
 * Every calendar sprint from the first (Sprint 1) through the later of the
 * deadline and the forecast finish — the page picks where to start reading.
 * Each sprint counts its full dates. A sprint's capacity counts ONLY the people
 * with a ticket assigned to them in that sprint.
 */
export function sprintBreakdown(
  p: { startDate: string; deadline: string },
  cal: CalendarSprint[],
  tickets: Ticket[],
  personOf: (assigneeId: string | null) => string | null,
  result: ProjectResult,
  day: DayFn,
  today: string,
): SprintBreakdown {
  const end = result.finish && result.finish !== 'never' && result.finish > p.deadline ? result.finish : p.deadline;
  const span = cal.filter((c) => c.startDate <= end).sort((a, b) => a.startDate.localeCompare(b.startDate));
  const ids = result.people.map((x) => x.id);
  const yesterday = addDays(today, -1);

  const inSprint = new Map<string, Ticket[]>();
  const backlog: Ticket[] = [], unmapped: Ticket[] = [], unmappedNames = new Set<string>();
  for (const t of tickets) {
    const m = mapSprint(t.sprint, cal);
    if (m) { const l = inSprint.get(m); if (l) l.push(t); else inSprint.set(m, [t]); }
    else if (t.sprint) { unmapped.push(t); unmappedNames.add(t.sprint.name); }
    else backlog.push(t);
  }

  const sprints = span.map((c): SprintRow => {
    const from = c.startDate;
    const state = c.endDate < today ? 'past' : c.startDate > today ? 'future' : 'active';
    const ts = inSprint.get(c.name) ?? [];
    const wt = workTotals(ts);
    let working = 0, leave = 0, available = 0, elapsed = 0, forecast = 0, forecastOthers = 0, assignedPeople = 0;
    const people = ids.flatMap((id): SprintPerson[] => {
      const mine = ts.filter((t) => personOf(t.assigneeId) === id);
      const assigned = mine.length > 0;
      const log = result.forecastLog.get(id);
      let mineForecast = 0;
      if (log) for (const [d, w] of log) if (d >= from && d <= c.endDate) mineForecast += w;
      if (!assigned && mineForecast <= EPS) return []; // not in this sprint at all
      const wd = windowDays(id, from, c.endDate, day);
      const passed = yesterday >= from ? windowDays(id, from, yesterday < c.endDate ? yesterday : c.endDate, day).available : 0;
      if (assigned) {
        assignedPeople++;
        working += wd.working; leave += wd.unavailable; available += wd.available;
        elapsed += passed;
        forecast += mineForecast;
      } else forecastOthers += mineForecast;
      const committed = r2(mine.reduce((s, t) => s + doneOf(t) + remainingOf(t), 0));
      const remaining = r2(mine.reduce((s, t) => s + remainingOf(t), 0));
      const done = r2(mine.reduce((s, t) => s + doneOf(t), 0));
      // active sprint: what's left vs the days left; otherwise the whole sprint
      const u = state === 'active'
        ? utilisation(remaining, windowDays(id, today > from ? today : from, c.endDate, day).available)
        : utilisation(committed, wd.available);
      return [{ id, working: wd.working, leave: wd.unavailable, leaveDates: leaveDates(id, from, c.endDate, day), available: wd.available, elapsed: passed, committed, remaining, done, forecast: r2(mineForecast),
        burnedPct: wd.available > EPS ? r2(done / wd.available) : 0, utilisation: u, band: band(u), assigned }];
    });
    const ahead = state === 'active' ? r2(available - elapsed) : available;
    const u = state === 'active' ? utilisation(wt.remaining, ahead) : utilisation(wt.current, available);
    const burnedPct = available > EPS ? r2(wt.done / available) : 0;
    const elapsedPct = available > EPS ? r2(elapsed / available) : 0;
    // active sprint: has the estimate burned kept up with the capacity used? (10-point margin)
    const pace = state !== 'active' || !wt.tickets || elapsed <= EPS ? null
      : burnedPct < elapsedPct - 0.1 ? 'behind' : burnedPct > elapsedPct + 0.1 ? 'ahead' : 'on-pace';
    return {
      name: c.name, startDate: from, endDate: c.endDate, state,
      working, leave: r2(leave), available: r2(available), elapsed: r2(elapsed), elapsedPct, burnedPct, pace,
      committed: wt.current, done: wt.done, remaining: wt.remaining, tickets: wt.tickets, open: wt.open,
      forecast: r2(forecast), forecastOthers: r2(forecastOthers), assignedPeople,
      utilisation: u, band: band(u),
      forecastUtilisation: utilisation(forecast, state === 'active' ? ahead : available),
      afterDeadline: c.startDate > p.deadline,
      beforeStart: c.endDate < p.startDate,
      people,
    };
  });
  const rem = (ts: Ticket[]) => r2(ts.reduce((s, t) => s + remainingOf(t), 0));
  return {
    sprints,
    backlog: { remaining: rem(backlog), tickets: backlog.filter((t) => !t.done).length },
    unmapped: { remaining: rem(unmapped), tickets: unmapped.filter((t) => !t.done).length, names: [...unmappedNames] },
  };
}

/** give each ticket's sprint the calendar's dates when Jira has none (future
 *  sprints are undated until started) — keeps the forecast's sprint order right */
export function withCalendarDates(tickets: Ticket[], cal: CalendarSprint[]): Ticket[] {
  return tickets.map((t) => {
    if (!t.sprint || (t.sprint.startDate && t.sprint.endDate)) return t;
    const c = cal.find((x) => x.name === mapSprint(t.sprint, cal));
    return c ? { ...t, sprint: { ...t.sprint, startDate: t.sprint.startDate ?? c.startDate, endDate: t.sprint.endDate ?? c.endDate } } : t;
  });
}

/** The measurement baseline: the original estimate on the project's own Jira
 *  issue (its high-level estimate); without one, the epics' own estimates
 *  added up. Compared with the tickets' estimate now (done + remaining).
 *  `fetched` = false: the snapshot predates reading estimates — refresh. */
export function baselineOf(snap: { estimateDays?: number | null }, epics: { estimateDays?: number | null }[], tickets: number) {
  const fetched = snap.estimateDays !== undefined || epics.some((e) => e.estimateDays !== undefined);
  const epicSum = epics.some((e) => e.estimateDays != null) ? Math.round(epics.reduce((a, e) => a + (e.estimateDays ?? 0), 0) * 100) / 100 : null;
  const days = snap.estimateDays ?? epicSum;
  const source: 'project' | 'epics' | null = snap.estimateDays != null ? 'project' : epicSum != null ? 'epics' : null;
  const growth = days != null ? Math.round((tickets - days) * 100) / 100 : null;
  return { days, source, epicSum, tickets, growth, growthPct: days ? Math.round(((tickets - days) / days) * 1000) / 1000 : null, fetched };
}

// ---- estimate by quarter label ---------------------------------------------------
export interface QuarterTotal { quarter: string | null; epics: string[]; tickets: number; estimate: number; done: number; remaining: number }

const qOrder = (a: string, b: string) => a.slice(3).localeCompare(b.slice(3)) || a.localeCompare(b);
/** the quarter a ticket's sprint belongs to ("Q4-2026"): from its name, else its dates */
function sprintQuarter(s: Sprint | null): string | null {
  if (!s) return null;
  const p = sprintParts(s.name);
  const y = p?.year ?? (s.startDate ? +s.startDate.slice(0, 4) : null);
  if (p && y) return `Q${p.quarter}-${y}`;
  if (s.startDate) return `Q${Math.floor((+s.startDate.slice(5, 7) - 1) / 3) + 1}-${s.startDate.slice(0, 4)}`;
  return null;
}

/**
 * The tickets' estimate (done + remaining) split by the epics' quarter labels.
 * One label: the whole epic is that quarter. Several (the epic runs across
 * quarters): each ticket goes to its sprint's quarter when that is one of the
 * labels, else to the epic's latest label (unscheduled work comes later).
 * No label: the "no quarter" bucket (quarter null), so the parts add up to the total.
 * Empty when no epic has a quarter label.
 */
export function quarterTotals(epics: ProjectEpic[], tickets: Ticket[]): QuarterTotal[] {
  if (!epics.some((e) => e.quarters?.length)) return [];
  const qsOf = new Map(epics.map((e) => [e.key, e.quarters ?? []]));
  const by = new Map<string | null, QuarterTotal>();
  const at = (q: string | null) => { let x = by.get(q); if (!x) by.set(q, (x = { quarter: q, epics: [], tickets: 0, estimate: 0, done: 0, remaining: 0 })); return x; };
  for (const e of epics) for (const q of (e.quarters?.length ? e.quarters : [null])) { const x = at(q); if (!x.epics.includes(e.key)) x.epics.push(e.key); }
  for (const t of tickets) {
    const qs = qsOf.get(t.epicKey) ?? [];
    const sq = sprintQuarter(t.sprint);
    const q = !qs.length ? null : qs.length === 1 ? qs[0] : sq && qs.includes(sq) ? sq : qs[qs.length - 1];
    const x = at(q);
    x.tickets++; x.done += doneOf(t); x.remaining += remainingOf(t);
  }
  return [...by.values()]
    .map((x) => ({ ...x, done: r2(x.done), remaining: r2(x.remaining), estimate: r2(x.done + x.remaining) }))
    .filter((x) => x.tickets > 0 || x.quarter !== null)
    .sort((a, b) => (a.quarter === null ? 1 : b.quarter === null ? -1 : qOrder(a.quarter, b.quarter)));
}

// ---- closed epics close their open tickets ------------------------------------------
/**
 * An epic that is closed has nothing left to deliver, even when some of its
 * tickets were left open in Jira. Those tickets are marked closedWithEpic and
 * count like cancelled ones everywhere: not remaining, not delivered, not in
 * the forecast — so the epic reads 0 remaining and 100% done.
 */
export function closeWithEpics<T extends Ticket>(epics: ProjectEpic[], tickets: T[]): T[] {
  const closed = new Set(epics.filter((e) => e.done).map((e) => e.key));
  // a sub-task left open under a closed (or cancelled) story is closed out with it too
  const doneStory = new Set(tickets.filter((t) => t.done && !t.subtask).map((t) => t.key));
  return tickets.map((t) => {
    if (t.done) return t;
    if (closed.has(t.epicKey)) return { ...t, closedWithEpic: true, closedBy: 'epic' as const };
    if (t.subtask && t.parentKey && doneStory.has(t.parentKey)) return { ...t, closedWithEpic: true, closedBy: 'story' as const };
    return t;
  });
}
export interface ClosedOut { tickets: number; days: number; keys: string[]; subtasks: number; parents: string[] }
/** per epic: the open tickets closed out with their epic or story (count, estimate, which) */
export function closedOutByEpic(tickets: Ticket[]): Map<string, ClosedOut> {
  const m = new Map<string, ClosedOut>();
  for (const t of tickets) {
    if (!t.closedWithEpic) continue;
    const x = m.get(t.epicKey) ?? { tickets: 0, days: 0, keys: [], subtasks: 0, parents: [] };
    x.tickets++; x.days = r2(x.days + Math.max(0, t.remainingDays ?? t.originalDays ?? 0)); x.keys.push(t.key);
    if (t.subtask) x.subtasks++;
    if (t.subtask && t.parentKey && !x.parents.includes(t.parentKey)) x.parents.push(t.parentKey);
    m.set(t.epicKey, x);
  }
  return m;
}

// ---- actual available capacity: what a person can really schedule -------------------
/** the most a person schedules in one sprint, in estimate days (the rest goes to
 *  meetings, reviews, support…) */
export const SPRINT_SCHEDULABLE_DAYS = 8;
const weekdays = (from: string, to: string) => (to >= from ? eachDay(from, to).filter((d) => !isWeekend(d)).length : 0);
/**
 * A person's actual available capacity in [from, to] of a sprint: their available
 * days (working − own leave), but never more than SPRINT_SCHEDULABLE_DAYS a
 * sprint — scaled down for the part of the sprint left when it's under way
 * (half the sprint left → at most 4).
 */
export function schedulable(available: number, from: string, to: string, sprintStart: string, sprintEnd: string, cap = SPRINT_SCHEDULABLE_DAYS): number {
  const all = weekdays(sprintStart, sprintEnd);
  const part = weekdays(from, to);
  const limit = all > 0 ? (cap * part) / all : 0;
  return r2(Math.max(0, Math.min(available, limit)));
}
