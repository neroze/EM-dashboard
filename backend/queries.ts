// Read side: everything the views show, built from the SQLite cache only.
import * as repo from './db/repo.ts';
import { capacityByTeam, teamLoad, type CapDay, type OverlapDay, type TeamCapacity } from './domain/capacity.ts';
import { buildDashboard, dashRanges, isWfhType, pickSprints, wfhConflicts, WFH_CONFLICT_WEEKS, yearSummary } from './domain/dashboard.ts';
import { baselineOf, closedOutByEpic, schedulable, SPRINT_SCHEDULABLE_DAYS, closeWithEpics, evaluateProject, quarterTotals, leaveDates, matchPerson, sprintBreakdown, windowDays, withCalendarDates, type DayFn, type PersonResult } from './domain/projectHealth.ts';
import { allocation } from './domain/allocation.ts';
import { buildReport, isCancelled, sprintLabel, type EngineerCapacity, type ReportSprint, type Snapshot } from './domain/forecastReport.ts';
import type { Project } from './projects.ts';
import { countsAsLongLeave, findRuns, longLeaveYear } from './domain/longleave.ts';
import { addDays, addMonths, diffDays, eachDay, isDate, isWeekend, maxDate, minDate, today } from './domain/dates.ts';
import { appStatus, bambooStatusesFor, DEFAULT_STATUSES, isActive } from './domain/status.ts';
import type { AppStatus, Filters, Holiday, LeaveRecord } from './domain/types.ts';
import { holidayIndex } from './sync/scheduler.ts';

const MAX_SPAN_DAYS = 400;
export const DEFAULT_THRESHOLD = 0.3;
export const DEFAULT_LINK = 'https://{domain}.bamboohr.com/employees/pto/?id={employeeId}';

/** validate + clamp whatever the page sent */
export function normalize(f: Partial<Filters> | undefined): Filters {
  const t = today();
  let from = isDate(f?.from) ? f!.from! : t;
  let to = isDate(f?.to) ? f!.to! : addDays(t, 41);
  if (to < from) [from, to] = [to, from];
  if (diffDays(from, to) > MAX_SPAN_DAYS) to = addDays(from, MAX_SPAN_DAYS);
  const arr = (v: unknown) => (Array.isArray(v) ? v.map(String).filter(Boolean) : []);
  const num = (v: unknown) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  const statuses = arr(f?.statuses).filter((s) => ['planned', 'draft', 'denied', 'canceled'].includes(s)) as AppStatus[];
  return {
    from, to,
    statuses: statuses.length ? statuses : DEFAULT_STATUSES,
    types: arr(f?.types), people: arr(f?.people), teams: arr(f?.teams), locations: arr(f?.locations),
    minDays: num(f?.minDays), maxDays: num(f?.maxDays),
    requestedFrom: isDate(f?.requestedFrom) ? f!.requestedFrom : null,
    requestedTo: isDate(f?.requestedTo) ? f!.requestedTo : null,
    overlapOnly: !!f?.overlapOnly,
    overlapMinPeople: num(f?.overlapMinPeople),
    sprint: typeof f?.sprint === 'string' ? f.sprint : null,
  };
}

export function thresholdFor(team: string): number {
  const per = repo.getSetting<Record<string, number>>('thresholds', {});
  const v = per[team] ?? repo.getSetting('defaultThreshold', DEFAULT_THRESHOLD);
  return v > 0 && v <= 1 ? v : DEFAULT_THRESHOLD;
}

export function linkFor(employeeId: string, requestId: string): string {
  const domain = repo.getSetting<string>('linkDomain', '') || repo.getSetting<string>('companyDomain', '');
  if (!domain) return '';
  const tpl = repo.getSetting('linkTemplate', DEFAULT_LINK);
  return tpl.replaceAll('{domain}', encodeURIComponent(domain))
    .replaceAll('{employeeId}', encodeURIComponent(employeeId))
    .replaceAll('{requestId}', encodeURIComponent(requestId));
}

/** per-day team load for the overlap signal: whole teams (team size is
 *  never shrunk by a person filter), active statuses from the filter only */
export function load(f: Filters): OverlapDay[] {
  const active = (f.statuses ?? DEFAULT_STATUSES).filter(isActive);
  if (!active.length) return [];
  const people = repo.people({ teams: f.teams, locations: f.locations });
  const days: CapDay[] = repo.days(f.from, f.to, bambooStatusesFor(active))
    .map((d) => ({ employeeId: d.employeeId, day: d.day, fraction: d.fraction, status: appStatus(d.bambooStatus), wfh: isWfhType(d.typeName) }));
  return teamLoad(people, days, f.from, f.to, thresholdFor, f.overlapOnly ? f.overlapMinPeople : null);
}

export function overlapDaySet(f: Filters): Set<string> {
  return new Set(load(f).filter((d) => d.flagged).map((d) => d.day));
}

export function leave(fIn: Partial<Filters>): LeaveRecord[] {
  const f = normalize(fIn);
  const t = today();
  let rows = repo.requests(f);
  if (f.minDays !== null && f.minDays !== undefined) rows = rows.filter((r) => r.days >= f.minDays! - 1e-9);
  if (f.maxDays !== null && f.maxDays !== undefined) rows = rows.filter((r) => r.days <= f.maxDays! + 1e-9);
  if (f.overlapOnly) {
    const flagged = overlapDaySet(f);
    const byReq = new Map<string, string[]>();
    for (const d of repo.days(f.from, f.to)) {
      const l = byReq.get(d.requestId); if (l) l.push(d.day); else byReq.set(d.requestId, [d.day]);
    }
    rows = rows.filter((r) => (byReq.get(r.id) ?? []).some((d) => flagged.has(d)));
  }
  return rows.map((r) => ({
    ...r,
    status: appStatus(r.bambooStatus),
    days: Math.round(r.days * 100) / 100,
    requestAgeDays: r.requestedAt ? Math.max(0, diffDays(r.requestedAt, t)) : null,
    url: linkFor(r.employeeId, r.id),
  }));
}

/** w = 1 for a work-from-home type (drawn in its own colour) */
export interface CalendarCell { s: 'P' | 'D' | 'X'; f: number; t: string; id: string; w: 0 | 1 }
const CODE: Record<AppStatus, CalendarCell['s']> = { planned: 'P', draft: 'D', denied: 'X', canceled: 'X' };
const RANK = { P: 3, D: 2, X: 1 };

export function calendar(fIn: Partial<Filters>) {
  const f = normalize(fIn);
  const records = leave(f);
  const ids = new Set(records.map((r) => r.id));
  const people = repo.people(f);
  const dayLoad = load(f);
  const flagged = new Set(dayLoad.filter((d) => d.flagged).map((d) => d.day));
  let days = eachDay(f.from, f.to);
  if (f.overlapOnly) days = days.filter((d) => flagged.has(d));
  const col = new Map(days.map((d, i) => [d, i]));
  const row = new Map(people.map((p, i) => [p.id, i]));
  const cells: (CalendarCell | null)[][] = people.map(() => new Array(days.length).fill(null));
  for (const d of repo.days(f.from, f.to)) {
    if (!ids.has(d.requestId)) continue;
    const i = row.get(d.employeeId), j = col.get(d.day);
    if (i === undefined || j === undefined) continue;
    const cell: CalendarCell = { s: CODE[appStatus(d.bambooStatus)], f: d.fraction, t: d.typeName, id: d.requestId, w: isWfhType(d.typeName) ? 1 : 0 };
    const cur = cells[i][j];
    if (!cur) { cells[i][j] = cell; continue; }
    // one block per day: the stronger status wins; on a tie, leave beats WFH
    const better = RANK[cell.s] > RANK[cur.s] || (RANK[cell.s] === RANK[cur.s] && cur.w === 1 && cell.w === 0);
    const sum = Math.min(1, cur.f + cell.f);
    if (better) cells[i][j] = cur.s === cell.s ? { ...cell, f: sum } : cell;
    else if (cur.s === cell.s) cells[i][j] = { ...cur, f: sum };
  }
  return {
    people, days, cells,
    holidays: repo.holidays(f.from, f.to),
    load: dayLoad.filter((d) => col.has(d.day)),
    requests: Object.fromEntries(records.map((r) => [r.id, r])),
  };
}

export interface CapOnLeave {
  employeeId: string; person: string; team: string;
  planned: number; draft: number; // leave days in the period (WFH excluded)
  first: string; last: string; types: string[]; url: string;
}
export interface CapacityPeriod {
  id: string; name: string; from: string; to: string;
  teams: (TeamCapacity & { overlapDays: number; threshold: number })[];
  onLeave: CapOnLeave[];
}

/** who is on leave (not WFH) in [from, to], most days first */
function onLeaveIn(rows: { requestId: string; employeeId: string; day: string; fraction: number; bambooStatus: string; typeName: string }[],
  from: string, to: string, who: Map<string, { name: string; team: string }>): CapOnLeave[] {
  const m = new Map<string, CapOnLeave>();
  for (const d of rows) {
    if (d.day < from || d.day > to || isWfhType(d.typeName)) continue;
    const p = who.get(d.employeeId);
    if (!p) continue;
    const x = m.get(d.employeeId) ?? { employeeId: d.employeeId, person: p.name, team: p.team, planned: 0, draft: 0, first: d.day, last: d.day, types: [], url: '' };
    if (appStatus(d.bambooStatus) === 'planned') x.planned += d.fraction; else x.draft += d.fraction;
    if (d.day < x.first) x.first = d.day;
    if (d.day > x.last) x.last = d.day;
    if (!x.types.includes(d.typeName)) x.types.push(d.typeName);
    if (!x.url) x.url = linkFor(d.employeeId, d.requestId);
    m.set(d.employeeId, x);
  }
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return [...m.values()].map((x) => ({ ...x, planned: r2(x.planned), draft: r2(x.draft) }))
    .sort((a, b) => b.planned + b.draft - (a.planned + a.draft) || a.person.localeCompare(b.person));
}

/** capacity per team for each sprint in the range (or the one sprint asked for) */
/** byMonth: one period per calendar month of the range (clipped to it)
 *  instead of one per sprint */
export function capacity(fIn: Partial<Filters>, sprintName?: string | null, byMonth = false): CapacityPeriod[] {
  const f = normalize(fIn);
  const sprints = byMonth ? [] : uniqueSprints().filter((s) => (sprintName ? s.name === sprintName : s.endDate >= f.from && s.startDate <= f.to));
  const periods = byMonth
    ? monthPeriods(f.from, f.to)
    : sprints.length
    ? sprints.map((s) => ({ id: s.name, name: s.name, from: s.startDate, to: s.endDate }))
    : [{ id: 'range', name: 'Selected range', from: f.from, to: f.to }];
  const lo = periods.reduce((a, p) => minDate(a, p.from), periods[0].from);
  const hi = periods.reduce((a, p) => maxDate(a, p.to), periods[0].to);
  const people = repo.people(f);
  const typeSet = f.types?.length ? new Set(f.types) : null;
  const reqType = new Map<string, string>();
  if (typeSet) for (const r of repo.requests({ ...f, from: lo, to: hi, statuses: ['planned', 'draft'], people: [], types: [] })) reqType.set(r.id, r.typeId);
  const rawDays = repo.days(lo, hi, ['approved', 'requested'])
    .filter((d) => !typeSet || typeSet.has(reqType.get(d.requestId) ?? ''));
  const days: CapDay[] = rawDays
    .map((d) => ({ employeeId: d.employeeId, day: d.day, fraction: d.fraction, status: appStatus(d.bambooStatus), wfh: isWfhType(d.typeName) }));
  const hol = holidayIndex(repo.holidays(lo, hi));
  const who = new Map(people.map((p) => [p.id, { name: p.displayName, team: p.team }]));
  return periods.map((p) => {
    const ld = load({ ...f, from: p.from, to: p.to, statuses: ['planned', 'draft'], overlapOnly: false });
    return {
      ...p,
      teams: capacityByTeam(people, days, p.from, p.to, hol).map((t) => ({
        ...t,
        threshold: thresholdFor(t.team),
        overlapDays: ld.filter((d) => d.teams.some((x) => x.team === t.team && x.flagged)).length,
      })),
      onLeave: onLeaveIn(rawDays, p.from, p.to, who),
    };
  });
}

export interface CapTotals { working: number; plannedOut: number; draftOut: number; wfh: number; available: number; ifDrafts: number; headcount: number }
const capTotals = (teams: TeamCapacity[]): CapTotals => {
  const s = (k: 'available' | 'plannedOut' | 'draftOut' | 'wfh' | 'netPlanned' | 'net') => Math.round(teams.reduce((a, t) => a + t[k], 0) * 100) / 100;
  return { working: s('available'), plannedOut: s('plannedOut'), draftOut: s('draftOut'), wfh: s('wfh'),
    available: s('netPlanned'), ifDrafts: s('net'), headcount: teams.reduce((a, t) => a + t.headcount, 0) };
};

/** capacity for one calendar quarter: totals, per month, per squad. Same
 *  rules as the sprint table (WFH counts as available). */
export function quarterCapacity(fIn: Partial<Filters>, year: number, q: number) {
  const f = normalize(fIn);
  const t = today();
  const yr = Number.isInteger(year) && year > 1990 && year < 2200 ? year : Number(t.slice(0, 4));
  const qq = q >= 1 && q <= 4 ? Math.floor(q) : Math.floor((Number(t.slice(5, 7)) - 1) / 3) + 1;
  const from = `${yr}-${String((qq - 1) * 3 + 1).padStart(2, '0')}-01`;
  const to = addDays(addMonths(from, 3), -1);
  const people = repo.people(f);
  const typeSet = f.types?.length ? new Set(f.types) : null;
  const reqType = new Map<string, string>();
  if (typeSet) for (const r of repo.requests({ ...f, from, to, statuses: ['planned', 'draft'], people: [], types: [] })) reqType.set(r.id, r.typeId);
  const days: CapDay[] = repo.days(from, to, ['approved', 'requested'])
    .filter((d) => !typeSet || typeSet.has(reqType.get(d.requestId) ?? ''))
    .map((d) => ({ employeeId: d.employeeId, day: d.day, fraction: d.fraction, status: appStatus(d.bambooStatus), wfh: isWfhType(d.typeName) }));
  const hol = holidayIndex(repo.holidays(from, to));
  const teams = capacityByTeam(people, days, from, to, hol);
  const months = [0, 1, 2].map((i) => {
    const mFrom = addMonths(from, i), mTo = addDays(addMonths(from, i + 1), -1);
    return { month: mFrom.slice(0, 7), from: mFrom, to: mTo, ...capTotals(capacityByTeam(people, days, mFrom, mTo, hol)) };
  });
  return {
    year: yr, q: qq, from, to, today: t,
    total: capTotals(teams),
    months,
    teams: teams.map((x) => ({ team: x.team, ...capTotals([x]) })),
  };
}

export function overlaps(fIn: Partial<Filters>, threshold?: number | null) {
  const f = normalize(fIn);
  const active = (f.statuses ?? DEFAULT_STATUSES).filter(isActive);
  const people = repo.people({ teams: f.teams, locations: f.locations });
  const days: CapDay[] = repo.days(f.from, f.to, bambooStatusesFor(active))
    .map((d) => ({ employeeId: d.employeeId, day: d.day, fraction: d.fraction, status: appStatus(d.bambooStatus), wfh: isWfhType(d.typeName) }));
  const th = threshold && threshold > 0 ? () => threshold : thresholdFor;
  return teamLoad(people, days, f.from, f.to, th).filter((d) => d.flagged);
}

export function summary(fIn: Partial<Filters>) {
  const f = normalize(fIn);
  const t = today();
  // people with a leave DAY today (not just a request spanning it — weekends,
  // holidays) among today's requests matching the filters
  const active = (f.statuses ?? DEFAULT_STATUSES).filter(isActive);
  const todayIds = active.length
    ? new Set(leave({ ...f, from: t, to: t, overlapOnly: false, statuses: active }).map((r) => r.id))
    : new Set<string>();
  const outToday = new Set(repo.days(t, t).filter((d) => todayIds.has(d.requestId)).map((d) => d.employeeId));
  const drafts = leave({ ...f, statuses: ['draft'] });
  return {
    peopleOutToday: outToday.size,
    draftRequests: drafts.length,
    oldestDraftDays: drafts.reduce((m, r) => Math.max(m, r.requestAgeDays ?? 0), 0),
    overlapDays: overlapDaySet({ ...f, overlapOnly: false }).size,
  };
}

/** quick dashboard: today / next week / this month, leave vs work-from-home.
 *  Fixed windows — only the squad / person / location filters apply. */
export function dashboard(fIn: Partial<Filters>) {
  const f = normalize(fIn);
  const t = today();
  const r = dashRanges(t);
  const sprints = uniqueSprints();
  const picked = pickSprints(t, sprints);
  let lo = minDate(r.month.from, t), hi = maxDate(r.month.to, r.nextWeek.to);
  for (const s of picked) { lo = minDate(lo, s.startDate); hi = maxDate(hi, s.endDate); }
  const recs = repo.requests({ from: lo, to: hi, statuses: ['planned', 'draft', 'denied'], teams: f.teams, people: f.people, locations: f.locations })
    .map((x) => ({
      id: x.id, employeeId: x.employeeId, person: x.person, team: x.team, status: appStatus(x.bambooStatus),
      typeName: x.typeName, startDate: x.startDate, endDate: x.endDate, url: linkFor(x.employeeId, x.id),
    }));
  // leave applied for on already-approved WFH days, today → 6 weeks out
  const cTo = addDays(t, WFH_CONFLICT_WEEKS * 7 - 1);
  const cRecs = repo.requests({ from: t, to: cTo, statuses: ['planned', 'draft'], teams: f.teams, people: f.people, locations: f.locations })
    .map((x) => ({ id: x.id, employeeId: x.employeeId, person: x.person, team: x.team, status: appStatus(x.bambooStatus),
      typeName: x.typeName, startDate: x.startDate, endDate: x.endDate, url: linkFor(x.employeeId, x.id) }));
  return {
    ...buildDashboard(t, recs, repo.days(lo, hi, ['approved', 'requested', 'denied']), sprints),
    wfhConflicts: wfhConflicts(cRecs, repo.days(t, cTo, ['approved', 'requested']), t, cTo),
  };
}

/** the dashboard's quarter summary for one calendar year */
export function year(fIn: Partial<Filters>, y: number) {
  const f = normalize(fIn);
  const t = today();
  const yr = Number.isInteger(y) && y > 1990 && y < 2200 ? y : Number(t.slice(0, 4));
  const from = `${yr}-01-01`, to = `${yr}-12-31`;
  const recs = repo.requests({ from, to, statuses: ['planned', 'draft'], teams: f.teams, people: f.people, locations: f.locations })
    .map((x) => ({
      id: x.id, employeeId: x.employeeId, person: x.person, team: x.team, status: appStatus(x.bambooStatus),
      typeName: x.typeName, startDate: x.startDate, endDate: x.endDate,
    }));
  return yearSummary(yr, t, recs, repo.days(from, to, ['approved', 'requested']), repo.earliestDay());
}

/** the Long leave tab: runs of 10+ / 5–9 consecutive working days in a year */
export function longLeave(fIn: Partial<Filters>, y: number) {
  const f = normalize(fIn);
  const t = today();
  const yr = Number.isInteger(y) && y > 1990 && y < 2200 ? y : Number(t.slice(0, 4));
  // a margin either side so runs crossing New Year are measured whole
  const from = addDays(`${yr}-01-01`, -45), to = addDays(`${yr}-12-31`, 45);
  // scheduled leave only: work from home, sick and substitute leave (and
  // their days) never reach the runs
  const recs = repo.requests({ from, to, statuses: ['planned', 'draft'], teams: f.teams, people: f.people, locations: f.locations })
    .filter((x) => countsAsLongLeave(x.typeName))
    .map((x) => ({
      id: x.id, employeeId: x.employeeId, person: x.person, team: x.team, status: appStatus(x.bambooStatus),
      typeName: x.typeName, startDate: x.startDate, endDate: x.endDate, url: linkFor(x.employeeId, x.id),
    }));
  const loc = new Map(repo.people().map((p) => [p.id, p.location]));
  const hol = holidayIndex(repo.holidays(from, to));
  const days = repo.days(from, to, ['approved', 'requested']).filter((d) => countsAsLongLeave(d.typeName));
  const runs = findRuns(recs, days, (d, emp) => hol(d, loc.get(emp) ?? ''));
  return longLeaveYear(yr, t, runs, repo.earliestDay());
}

/** one entry per sprint name (both boards share dates) */
export function uniqueSprints() {
  const seen = new Map<string, { name: string; startDate: string; endDate: string; boards: Record<string, string> }>();
  for (const s of repo.sprints()) {
    const cur = seen.get(s.name) ?? { name: s.name, startDate: s.startDate, endDate: s.endDate, boards: {} };
    if (s.board) cur.boards[s.board] = s.id.split(':').pop()!;
    seen.set(s.name, cur);
  }
  return [...seen.values()].sort((a, b) => a.startDate.localeCompare(b.startDate));
}

export function lookups() {
  return {
    teams: repo.distinct('team'),
    locations: repo.distinct('location'),
    types: repo.leaveTypes(),
    people: repo.people().map((p) => ({ id: p.id, name: p.displayName, team: p.team, location: p.location })),
    sprints: uniqueSprints(),
  };
}

/** plain-text digest of the next two weeks, for Slack / email */
export function digest(): { title: string; text: string } {
  const t = today();
  const to = addDays(t, 13);
  const recs = leave({ from: t, to, statuses: ['planned', 'draft'] }).filter((r) => r.days > 0);
  const flagged = overlaps({ from: t, to });
  const lines: string[] = [];
  const title = `Capacity Radar — next two weeks (${t} → ${to})`;
  lines.push(title, '');
  if (!recs.length) lines.push('Nobody is out or has leave pending.');
  // grouped by team, in the app's team order
  const ord = repo.teamOrder();
  const byTeam = new Map<string, LeaveRecord[]>();
  for (const r of recs) { const l = byTeam.get(r.team); if (l) l.push(r); else byTeam.set(r.team, [r]); }
  const teams = [...byTeam].sort((a, b) => (ord.get(a[0]) ?? 1000) - (ord.get(b[0]) ?? 1000) || a[0].localeCompare(b[0]));
  for (const [team, list] of teams) {
    lines.push(`*${team}* (${list.length})`);
    for (const r of list) {
      lines.push(`  • ${r.person} — ${r.typeName}, ${r.startDate}${r.endDate !== r.startDate ? ' → ' + r.endDate : ''}, ${r.days} d${r.status === 'draft' ? ' — DRAFT, awaiting approval' : ''}`);
    }
    lines.push('');
  }
  const drafts = recs.filter((r) => r.status === 'draft').length;
  lines.push('', `Draft requests waiting: ${drafts}`);
  if (flagged.length) {
    lines.push('Low-capacity days:');
    for (const d of flagged) {
      for (const tm of d.teams.filter((x) => x.flagged)) lines.push(`  ${d.day}: ${tm.team} ${Math.round(tm.share * 100)}% out (${tm.out}/${tm.size})`);
    }
  } else lines.push('No low-capacity days.');
  return { title, text: lines.join('\n') };
}

export type { Holiday };

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** calendar months covering from..to, each clipped to the range */
function monthPeriods(from: string, to: string) {
  const out: { id: string; name: string; from: string; to: string }[] = [];
  for (let m = from.slice(0, 7) + '-01'; m <= to && out.length < 36; m = addMonths(m, 1)) {
    const end = addDays(addMonths(m, 1), -1);
    out.push({ id: m.slice(0, 7), name: `${MONTH_NAMES[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`, from: maxDate(m, from), to: minDate(end, to) });
  }
  return out;
}

// ---- project health board ------------------------------------------------------
// Returns days unavailable only — never a leave type (sick leave is sensitive).

/** person-day lookup over [from, to]: working day for their location, and
 *  approved non-WFH leave. "jira:<id>" = a Jira assignee not matched to
 *  BambooHR: weekdays, no leave known. */
export function dayFn(from: string, to: string): DayFn {
  const loc = new Map(repo.people().map((p) => [p.id, p.location]));
  const hol = holidayIndex(repo.holidays(from, to));
  const out = new Map<string, number>();
  for (const d of repo.days(from, to, ['approved'])) {
    if (isWfhType(d.typeName)) continue;
    const k = d.employeeId + '|' + d.day;
    out.set(k, (out.get(k) ?? 0) + d.fraction);
  }
  return (id, day) => {
    if (isWeekend(day)) return { working: false, out: 0 };
    if (id.startsWith('jira:')) return { working: true, out: 0 };
    const l = loc.get(id);
    if (l === undefined || hol(day, l)) return { working: false, out: 0 };
    return { working: true, out: out.get(id + '|' + day) ?? 0 };
  };
}

/** the run to compare with: the chosen date, else the newest from an earlier day */
function prevRun(p: Project, today: string, compareWith?: string | null): Snapshot | null {
  const runs = p.runs ?? [];
  if (compareWith) return runs.find((r) => r.date === compareWith) ?? null;
  return runs.find((r) => r.date < today) ?? null;
}

/** the forecast report's sprints: the current calendar sprint through the
 *  deadline sprint. Capacity = Σ each engineer's available days (after their
 *  own leave) — from today in the current sprint; days = an engineer's
 *  working days in it (the most common across the team). */
function reportSprints(p: Project, cal: ReturnType<typeof uniqueSprints>, engineers: string[], day: DayFn, today: string): { sprints: ReportSprint[]; perEngineer: EngineerCapacity[] } {
  const first = cal.findIndex((c) => c.endDate >= today);
  if (first < 0) return { sprints: [], perEngineer: [] };
  let last = cal.findIndex((c) => c.endDate >= p.deadline);
  if (last < 0) last = cal.length - 1;
  const span = cal.slice(first, Math.max(first, last) + 1);
  const fromOf = (c: (typeof cal)[number], i: number) => (i === 0 && today > c.startDate ? today : c.startDate);
  const perEngineer: EngineerCapacity[] = engineers.map((id) => ({
    id,
    sprints: span.map((c, i) => {
      const w = windowDays(id, fromOf(c, i), c.endDate, day);
      return { working: w.working, leave: w.unavailable, available: w.available, actual: schedulable(w.available, fromOf(c, i), c.endDate, c.startDate, c.endDate),
        leaveDates: leaveDates(id, fromOf(c, i), c.endDate, day) };
    }),
  }));
  const sprints = span.map((c, i) => {
    const per = perEngineer.map((e) => e.sprints[i]);
    const counts = new Map<number, number>();
    for (const w of per) counts.set(w.working, (counts.get(w.working) ?? 0) + 1);
    const days = [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? 0;
    return { name: c.name, label: sprintLabel(c.name), days, capacity: Math.round(per.reduce((s, w) => s + w.available, 0) * 100) / 100 };
  });
  return { sprints, perEngineer };
}

/** the report for one project — compareWith picks the earlier run (default: the last earlier day) */
export function forecastReport(p: Project, links: Record<string, string>, compareWith?: string | null) {
  const h = projectHealth(p, links, compareWith);
  return h.report;
}

/** the project's epics and tickets, minus the epics it leaves out */
function scoped(p: Project) {
  const out = new Set(p.excludedEpics ?? []);
  const epics = (p.jira?.epics ?? []).filter((e) => !out.has(e.key));
  const keep = new Set(epics.map((e) => e.key));
  // a closed epic closes its tickets still open in Jira (nothing left to deliver)
  return { epics, tickets: closeWithEpics(epics, (p.jira?.tickets ?? []).filter((t) => keep.has(t.epicKey))) };
}

/** Epic status rows for the epics the project leaves out, so an unticked epic still shows its figures */
function excludedReportRows(p: Project) {
  const out = new Set(p.excludedEpics ?? []);
  const epics = (p.jira?.epics ?? []).filter((e) => out.has(e.key));
  if (!epics.length) return [];
  const keys = new Set(epics.map((e) => e.key));
  const tickets = closeWithEpics(epics, (p.jira?.tickets ?? []).filter((t) => keys.has(t.epicKey)));
  return buildReport({ project: p.name || p.key, date: today(), epics, tickets, sprints: [], engineers: 0, cal: [], prev: null }).epics;
}

/** today's snapshot for the run history (independent of capacity) */
export function reportSnapshot(p: Project): Snapshot | null {
  if (!p.jira) return null;
  const sc = scoped(p);
  return buildReport({ project: p.name || p.jira.summary || p.key, date: today(), epics: sc.epics, tickets: sc.tickets,
    sprints: [], engineers: 0, cal: [], prev: null }).snapshot;
}

export function projectHealth(p: Project, links: Record<string, string>, compareWith?: string | null) {
  const t = today();
  const snap = p.jira;
  const base = {
    id: p.id, key: p.key, name: p.name || snap?.summary || p.key, ownName: p.name, track: p.track ?? 'auto', tracked: snap?.tracked ?? null, issueType: snap?.issueType ?? null, startDate: p.startDate, deadline: p.deadline,
    ideaStatus: snap?.status ?? null, fetchedAt: snap?.fetchedAt ?? null, error: p.error, today: t,
  };
  const runs = (p.runs ?? []).map((r) => ({ date: r.date, rt: r.rt, tickets: Object.keys(r.t).length }));
  // every linked epic, for the editor's include/leave-out list
  const linkedEpics = (snap?.epics ?? []).map((e) => ({ key: e.key, summary: e.summary, status: e.status, done: e.done, estimateDays: e.estimateDays ?? null, quarters: e.quarters ?? [], excluded: (p.excludedEpics ?? []).includes(e.key) }));
  if (!snap) return { ...base, runs, linkedEpics, health: null, report: null };
  const sc = scoped(p);

  // Jira assignee → BambooHR person (or a placeholder that still counts)
  const people = repo.peopleWithEmail();
  const match = new Map(snap.assignees.map((a) => [a.accountId, { ...a, ...matchPerson(a, people, links) }]));
  const personOf = (accountId: string | null) => {
    if (!accountId) return null;
    return match.get(accountId)?.id ?? 'jira:' + accountId;
  };
  // leave + holidays from the earliest of: project start, today, the calendar's
  // first sprint (the sprint table looks back to Sprint 1)
  const cal = uniqueSprints();
  const lo = [p.startDate, t, cal[0]?.startDate ?? t].reduce(minDate);
  const day = dayFn(lo, addDays(maxDate(p.deadline, t), 730));
  const allTickets = withCalendarDates(sc.tickets, cal); // undated future Jira sprints get the calendar's dates
  // tickets closed as Duplicate / Won't Do / … are left out of every figure
  const tickets = allTickets.filter((x) => !isCancelled(x));
  // progress reads from Sprint 1 of the calendar (like the Sprints section), or the project start if earlier
  const { forecastLog: _log, ...h } = evaluateProject(p, sc.epics, tickets, personOf, day, t, { progressFrom: cal[0]?.startDate ?? null });
  const engineers = h.people.filter((x: PersonResult) => x.active).map((x: PersonResult) => x.id);
  const prev = prevRun(p, t, compareWith);
  const rs = reportSprints(p, cal, engineers, day, t);
  const report = buildReport({
    project: p.name || snap.summary || p.key, date: t, epics: sc.epics, tickets: allTickets,
    sprints: rs.sprints, engineers: engineers.length, cal, prev, personOf,
  });
  const sp = sprintBreakdown(p, cal, tickets, personOf, { ...h, forecastLog: _log }, day, t);
  const nameOf = new Map(people.map((x) => [x.id, x.displayName]));
  const accountOf = new Map([...match.values()].map((m) => [m.id ?? 'jira:' + m.accountId, m]));
  const fin = (u: number) => (Number.isFinite(u) ? Math.round(u * 1000) / 1000 : null);
  const baseline = baselineOf(snap, sc.epics, h.totals.current);
  const closedOut = closedOutByEpic(sc.tickets);

  return {
    ...base,
    runs, linkedEpics,
    report: {
      ...report, compareWith: prev?.date ?? null,
      // actual available capacity per sprint: each engineer's available days, capped at what one schedules in a sprint
      schedulableCap: SPRINT_SCHEDULABLE_DAYS,
      // the epics left out (unticked): their own rows, for display only — not in any total
      excludedRows: excludedReportRows(p),
      actualBySprint: rs.sprints.map((_, i) => Math.round(rs.perEngineer.reduce((a, e) => a + e.sprints[i].actual, 0) * 100) / 100),
      // the engineers behind "Capacity, N engineers": name, leave known or not, per-sprint days
      engineerRows: rs.perEngineer.map((e) => {
        const m = accountOf.get(e.id);
        return { ...e, name: nameOf.get(e.id) ?? m?.name ?? 'Unknown', leaveKnown: !!m && m.how !== 'none' };
      }),
    },
    health: {
      ...h,
      baseline,
      quarters: quarterTotals(sc.epics, tickets),
      utilisation: fin(h.utilisation),
      people: h.people.map((x) => {
        const m = accountOf.get(x.id);
        return {
          ...x, utilisation: fin(x.utilisation),
          name: nameOf.get(x.id) ?? m?.name ?? 'Unknown',
          accountId: m?.accountId ?? null,
          matched: m?.how ?? 'none', // 'none' = no BambooHR person: leave unknown
        };
      }),
      epics: sc.epics.map((e) => ({ ...e, ...h.epics.find((r) => r.key === e.key)!, closedOut: closedOut.get(e.key) ?? null })),
      tickets: tickets.map((tk) => ({ ...tk, finish: h.ticketFinish[tk.key] ?? null })),
      sprints: {
        ...sp,
        sprints: sp.sprints.map((x) => ({
          ...x, utilisation: fin(x.utilisation), forecastUtilisation: fin(x.forecastUtilisation),
          people: x.people.map((q) => ({ ...q, utilisation: fin(q.utilisation) })),
        })),
      },
    },
  };
}

/** People board: every person's capacity across all projects' epics, per
 *  calendar sprint — working, available (after their own leave), days in Jira.
 *  Days of leave only, never the type. */
export function peopleAllocation(projects: Project[], links: Record<string, string>) {
  const t = today();
  const withJira = projects.filter((p) => p.jira);
  const cal = uniqueSprints();
  const people = repo.peopleWithEmail();
  const assignees = new Map(withJira.flatMap((p) => p.jira!.assignees).map((a) => [a.accountId, a]));
  const match = new Map([...assignees.values()].map((a) => [a.accountId, { ...a, ...matchPerson(a, people, links) }]));
  const personOf = (accountId: string | null) => (accountId ? match.get(accountId)?.id ?? 'jira:' + accountId : null);
  const until = withJira.map((p) => p.deadline).reduce(maxDate, t);
  const lo = [t, cal[0]?.startDate ?? t, ...withJira.map((p) => p.startDate)].reduce(minDate);
  const day = dayFn(lo, addDays(until, 730));
  const sources = withJira.map((p) => {
    const sc = scoped(p);
    return {
      projectId: p.id, projectName: p.name || p.jira!.summary || p.key, epics: sc.epics,
      tickets: withCalendarDates(sc.tickets, cal).filter((x) => !isCancelled(x)),
    };
  });
  const a = allocation(sources, cal, personOf, day, t, until);
  const nameOf = new Map(people.map((x) => [x.id, x.displayName]));
  const accountOf = new Map([...match.values()].map((m) => [m.id ?? 'jira:' + m.accountId, m]));
  const fin = (u: number | null) => (u === null ? null : Number.isFinite(u) ? Math.round(u * 1000) / 1000 : null);
  return {
    today: t,
    projects: withJira.map((p) => ({ id: p.id, name: p.name || p.jira!.summary || p.key, deadline: p.deadline })),
    missing: projects.filter((p) => !p.jira).map((p) => p.name || p.key),
    ...a,
    people: a.people.map((x) => {
      const m = accountOf.get(x.id);
      return {
        ...x,
        name: nameOf.get(x.id) ?? m?.name ?? 'Unknown',
        leaveKnown: !!m && m.how !== 'none',
        cells: x.cells.map((c) => ({ ...c, load: fin(c.load), loadAhead: fin(c.loadAhead) })),
      };
    }).sort((p, q) => p.name.localeCompare(q.name)),
  };
}

/** BambooHR people a Jira assignee can be linked to */
export const linkablePeople = () => repo.peopleWithEmail().map((p) => ({ id: p.id, name: p.displayName }));
