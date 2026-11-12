// Read side: everything the views show, built from the SQLite cache only.
import * as repo from './db/repo.ts';
import { capacityByTeam, teamLoad, type CapDay, type OverlapDay, type TeamCapacity } from './domain/capacity.ts';
import { buildDashboard, dashRanges, isWfhType, pickSprints, yearSummary } from './domain/dashboard.ts';
import { findRuns, longLeaveYear } from './domain/longleave.ts';
import { addDays, diffDays, eachDay, isDate, maxDate, minDate, today } from './domain/dates.ts';
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
  const domain = repo.getSetting<string>('companyDomain', '');
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
    .map((d) => ({ employeeId: d.employeeId, day: d.day, fraction: d.fraction, status: appStatus(d.bambooStatus) }));
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

export interface CapacityPeriod { id: string; name: string; from: string; to: string; teams: (TeamCapacity & { overlapDays: number; threshold: number })[] }

/** capacity per team for each sprint in the range (or the one sprint asked for) */
export function capacity(fIn: Partial<Filters>, sprintName?: string | null): CapacityPeriod[] {
  const f = normalize(fIn);
  const sprints = uniqueSprints().filter((s) => (sprintName ? s.name === sprintName : s.endDate >= f.from && s.startDate <= f.to));
  const periods = sprints.length
    ? sprints.map((s) => ({ id: s.name, name: s.name, from: s.startDate, to: s.endDate }))
    : [{ id: 'range', name: 'Selected range', from: f.from, to: f.to }];
  const lo = periods.reduce((a, p) => minDate(a, p.from), periods[0].from);
  const hi = periods.reduce((a, p) => maxDate(a, p.to), periods[0].to);
  const people = repo.people(f);
  const typeSet = f.types?.length ? new Set(f.types) : null;
  const reqType = new Map<string, string>();
  if (typeSet) for (const r of repo.requests({ ...f, from: lo, to: hi, statuses: ['planned', 'draft'], people: [], types: [] })) reqType.set(r.id, r.typeId);
  const days: CapDay[] = repo.days(lo, hi, ['approved', 'requested'])
    .filter((d) => !typeSet || typeSet.has(reqType.get(d.requestId) ?? ''))
    .map((d) => ({ employeeId: d.employeeId, day: d.day, fraction: d.fraction, status: appStatus(d.bambooStatus) }));
  const hol = holidayIndex(repo.holidays(lo, hi));
  return periods.map((p) => {
    const ld = load({ ...f, from: p.from, to: p.to, statuses: ['planned', 'draft'], overlapOnly: false });
    return {
      ...p,
      teams: capacityByTeam(people, days, p.from, p.to, hol).map((t) => ({
        ...t,
        threshold: thresholdFor(t.team),
        overlapDays: ld.filter((d) => d.teams.some((x) => x.team === t.team && x.flagged)).length,
      })),
    };
  });
}

export function overlaps(fIn: Partial<Filters>, threshold?: number | null) {
  const f = normalize(fIn);
  const active = (f.statuses ?? DEFAULT_STATUSES).filter(isActive);
  const people = repo.people({ teams: f.teams, locations: f.locations });
  const days: CapDay[] = repo.days(f.from, f.to, bambooStatusesFor(active))
    .map((d) => ({ employeeId: d.employeeId, day: d.day, fraction: d.fraction, status: appStatus(d.bambooStatus) }));
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
  return buildDashboard(t, recs, repo.days(lo, hi, ['approved', 'requested', 'denied']), sprints);
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
  const recs = repo.requests({ from, to, statuses: ['planned', 'draft'], teams: f.teams, people: f.people, locations: f.locations })
    .map((x) => ({
      id: x.id, employeeId: x.employeeId, person: x.person, team: x.team, status: appStatus(x.bambooStatus),
      typeName: x.typeName, startDate: x.startDate, endDate: x.endDate, url: linkFor(x.employeeId, x.id),
    }));
  const loc = new Map(repo.people().map((p) => [p.id, p.location]));
  const hol = holidayIndex(repo.holidays(from, to));
  const runs = findRuns(recs, repo.days(from, to, ['approved', 'requested']), (d, emp) => hol(d, loc.get(emp) ?? ''));
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
  const title = `Leave Radar — next two weeks (${t} → ${to})`;
  lines.push(title, '');
  if (!recs.length) lines.push('Nobody is out or has leave pending.');
  for (const r of recs) {
    lines.push(`• ${r.person} (${r.team}) — ${r.typeName}, ${r.startDate}${r.endDate !== r.startDate ? ' → ' + r.endDate : ''}, ${r.days} d${r.status === 'draft' ? ' — DRAFT, awaiting approval' : ''}`);
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
