// Quick dashboard: fixed windows (today / next week / this month) for two
// kinds of absence — leave and work-from-home. BambooHR has no WFH concept of
// its own; companies book it as a time-off type, so a type whose name reads
// like WFH is classed as WFH and everything else as leave. Pure functions;
// the queries layer feeds them rows from the cache.
import { addDays, addMonths, eachDay, isWeekend, parse } from './dates.ts';
import { isActive } from './status.ts';
import type { AppStatus } from './types.ts';

export const WFH_RE = /work(ing)?[\s_-]*from[\s_-]*home|\bwfh\b|remote|home[\s_-]*office/i;
export const isWfhType = (typeName: string) => WFH_RE.test(typeName || '');

export interface DashRecord {
  id: string; employeeId: string; person: string; team: string;
  status: AppStatus; typeName: string; startDate: string; endDate: string; url?: string;
}
export interface DashDay { requestId: string; employeeId: string; day: string; fraction: number }

export interface DashItem extends DashRecord { days: number /* working days inside the window */ }
export interface DashPeriod {
  from: string; to: string;
  items: DashItem[];
  people: number;
  counts: Record<AppStatus, number>;
}
export interface SameDay { day: string; people: { employeeId: string; person: string; team: string; status: AppStatus; fraction: number }[] }
export interface Ranked {
  employeeId: string; person: string; team: string; days: number; requests: number; planned: number; draft: number;
  byType: Record<string, number>; // days per leave type
}
/** one working day of the month: distinct people away, days by type */
export interface DailyPoint { day: string; people: number; byType: Record<string, number> }
export interface DashSection { today: DashPeriod; nextWeek: DashPeriod; month: DashPeriod; sameDay: SameDay[]; ranking: Ranked[]; daily: DailyPoint[] }
export type SprintRole = 'previous' | 'current' | 'next' | 'upcoming';
export interface SprintPerson {
  employeeId: string; person: string; team: string;
  days: number; planned: number; draft: number;
  first: string; last: string; // first / last leave day inside the sprint
  types: string[];
  requests: { id: string; url?: string }[];
}
export interface SprintLeave {
  name: string; startDate: string; endDate: string; role: SprintRole;
  days: number; planned: number; draft: number;
  byType: Record<string, number>;
  people: SprintPerson[];
}
export interface SprintDef { name: string; startDate: string; endDate: string }

export interface Dashboard {
  today: string;
  nextWeek: { from: string; to: string };
  month: { from: string; to: string };
  leave: DashSection;
  wfh: DashSection;
  wfhTypes: string[];
  /** every type on the dashboard, in a fixed order — colours follow the type */
  types: string[];
  /** leave (not WFH) per sprint: previous, current, next and the one after */
  sprints: SprintLeave[];
  /** leave applied for on days whose WFH is already approved (today → 6 weeks) */
  wfhConflicts?: WfhConflict[];
}

/** a leave request that lands on days the person's WFH is already approved for:
 *  the WFH should be cancelled or the leave questioned. Dates and status only —
 *  never the leave type. */
export interface WfhConflict {
  employeeId: string; person: string; team: string;
  leaveId: string; leaveStatus: 'planned' | 'draft'; url?: string;
  wfhId: string; wfhUrl?: string;
  /** the overlapping days, sorted */
  days: string[];
}

export const WFH_CONFLICT_WEEKS = 6;

/** approved WFH days that also carry a pending or approved leave request, from
 *  `from` to `to`; one entry per leave request, most urgent (earliest) first */
export function wfhConflicts(recs: DashRecord[], days: DashDay[], from: string, to: string): WfhConflict[] {
  const byId = new Map(recs.map((r) => [r.id, r]));
  const wfhOn = new Map<string, string>(); // employee|day → approved WFH request id
  for (const d of days) {
    const r = byId.get(d.requestId);
    if (!r || d.day < from || d.day > to || r.status !== 'planned' || !isWfhType(r.typeName)) continue;
    wfhOn.set(d.employeeId + '|' + d.day, r.id);
  }
  const out = new Map<string, WfhConflict>();
  for (const d of days) {
    const r = byId.get(d.requestId);
    if (!r || d.day < from || d.day > to || isWfhType(r.typeName) || (r.status !== 'planned' && r.status !== 'draft')) continue;
    const wfhId = wfhOn.get(d.employeeId + '|' + d.day);
    if (!wfhId) continue;
    const c = out.get(r.id) ?? { employeeId: r.employeeId, person: r.person, team: r.team, leaveId: r.id, leaveStatus: r.status, url: r.url,
      wfhId, wfhUrl: byId.get(wfhId)?.url, days: [] };
    if (!c.days.includes(d.day)) c.days.push(d.day);
    out.set(r.id, c);
  }
  return [...out.values()].map((c) => ({ ...c, days: c.days.sort() }))
    .sort((a, b) => a.days[0].localeCompare(b.days[0]) || a.person.localeCompare(b.person));
}

/** previous, current, next (+1) around today; with no current sprint the
 *  first future one is "next" */
export function pickSprints(t: string, all: SprintDef[]): (SprintDef & { role: SprintRole })[] {
  const list = [...all].sort((a, b) => a.startDate.localeCompare(b.startDate));
  let cur = list.findIndex((s) => s.startDate <= t && s.endDate >= t);
  const hasCurrent = cur >= 0;
  if (!hasCurrent) {
    const nxt = list.findIndex((s) => s.startDate > t);
    cur = nxt >= 0 ? nxt - 1 : list.length - 1; // treat the last past one as "previous"
  }
  const out: (SprintDef & { role: SprintRole })[] = [];
  const at = (i: number, role: SprintRole) => { if (list[i]) out.push({ ...list[i], role }); };
  if (hasCurrent) { at(cur - 1, 'previous'); at(cur, 'current'); at(cur + 1, 'next'); at(cur + 2, 'upcoming'); }
  else { at(cur, 'previous'); at(cur + 1, 'next'); at(cur + 2, 'upcoming'); }
  return out;
}

function sprintLeave(sp: SprintDef & { role: SprintRole }, byId: Map<string, DashRecord>, days: DashDay[]): SprintLeave {
  const people = new Map<string, SprintPerson & { types: string[] }>();
  const byType: Record<string, number> = {};
  let planned = 0, draft = 0;
  for (const d of days) {
    if (d.day < sp.startDate || d.day > sp.endDate) continue;
    const rec = byId.get(d.requestId);
    if (!rec || !isActive(rec.status)) continue;
    const p = people.get(d.employeeId) ?? {
      employeeId: d.employeeId, person: rec.person, team: rec.team, days: 0, planned: 0, draft: 0,
      first: d.day, last: d.day, types: [], requests: [],
    };
    p.days += d.fraction;
    if (rec.status === 'planned') { p.planned += d.fraction; planned += d.fraction; } else { p.draft += d.fraction; draft += d.fraction; }
    if (d.day < p.first) p.first = d.day;
    if (d.day > p.last) p.last = d.day;
    if (!p.types.includes(rec.typeName)) p.types.push(rec.typeName);
    if (!p.requests.some((x) => x.id === rec.id)) p.requests.push({ id: rec.id, url: rec.url });
    byType[rec.typeName] = (byType[rec.typeName] ?? 0) + d.fraction;
    people.set(d.employeeId, p);
  }
  const list = [...people.values()]
    .map((p) => ({ ...p, days: round(p.days), planned: round(p.planned), draft: round(p.draft) }))
    .sort((a, b) => b.days - a.days || a.person.localeCompare(b.person));
  return {
    name: sp.name, startDate: sp.startDate, endDate: sp.endDate, role: sp.role,
    days: round(planned + draft), planned: round(planned), draft: round(draft),
    byType: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, round(v)])),
    people: list,
  };
}

export function dashRanges(t: string) {
  const wd = new Date(parse(t)).getUTCDay(); // 0 = Sunday
  const nextMon = addDays(t, ((8 - wd) % 7) || 7);
  const monthFrom = t.slice(0, 8) + '01';
  return {
    nextWeek: { from: nextMon, to: addDays(nextMon, 6) },
    month: { from: monthFrom, to: addDays(addMonths(monthFrom, 1), -1) },
  };
}

const ORDER: Record<AppStatus, number> = { planned: 0, draft: 1, denied: 2, canceled: 3 };
const round = (n: number) => Math.round(n * 100) / 100;

function period(from: string, to: string, recs: Map<string, DashRecord>, days: DashDay[], statuses: AppStatus[]): DashPeriod {
  const inWin = new Map<string, number>();
  for (const d of days) if (d.day >= from && d.day <= to) inWin.set(d.requestId, (inWin.get(d.requestId) ?? 0) + d.fraction);
  const items: DashItem[] = [];
  for (const [id, n] of inWin) {
    const r = recs.get(id);
    if (r && statuses.includes(r.status)) items.push({ ...r, days: round(n) });
  }
  items.sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.startDate.localeCompare(b.startDate) || a.person.localeCompare(b.person));
  const counts: Record<AppStatus, number> = { planned: 0, draft: 0, denied: 0, canceled: 0 };
  for (const i of items) counts[i.status]++;
  return { from, to, items, people: new Set(items.filter((i) => isActive(i.status)).map((i) => i.employeeId)).size, counts };
}

function section(t: string, r: ReturnType<typeof dashRanges>, recs: DashRecord[], days: DashDay[]): DashSection {
  const byId = new Map(recs.map((x) => [x.id, x]));
  const mine = days.filter((d) => byId.has(d.requestId));
  const active = mine.filter((d) => isActive(byId.get(d.requestId)!.status) && d.day >= r.month.from && d.day <= r.month.to);

  // days this month with two or more different people away
  const perDay = new Map<string, Map<string, SameDay['people'][number]>>();
  for (const d of active) {
    const rec = byId.get(d.requestId)!;
    const m = perDay.get(d.day) ?? new Map<string, SameDay["people"][number]>();
    const cur = m.get(d.employeeId);
    // one entry per person per day; planned wins over draft
    if (!cur || ORDER[rec.status] < ORDER[cur.status]) {
      m.set(d.employeeId, { employeeId: d.employeeId, person: rec.person, team: rec.team, status: rec.status, fraction: Math.min(1, (cur?.fraction ?? 0) + d.fraction) });
    } else cur.fraction = Math.min(1, cur.fraction + d.fraction);
    perDay.set(d.day, m);
  }
  const sameDay = [...perDay].filter(([, m]) => m.size >= 2)
    .map(([day, m]) => ({ day, people: [...m.values()].sort((a, b) => a.person.localeCompare(b.person)) }))
    .sort((a, b) => a.day.localeCompare(b.day));

  // people ranked by days away this month
  const rank = new Map<string, Ranked & { ids: Set<string> }>();
  for (const d of active) {
    const rec = byId.get(d.requestId)!;
    const x = rank.get(d.employeeId) ?? { employeeId: d.employeeId, person: rec.person, team: rec.team, days: 0, requests: 0, planned: 0, draft: 0, byType: {}, ids: new Set<string>() };
    x.byType[rec.typeName] = (x.byType[rec.typeName] ?? 0) + d.fraction;
    x.days += d.fraction;
    if (rec.status === 'planned') x.planned += d.fraction; else x.draft += d.fraction;
    x.ids.add(d.requestId);
    rank.set(d.employeeId, x);
  }
  const ranking = [...rank.values()]
    .map(({ ids, ...x }) => ({ ...x, requests: ids.size, days: round(x.days), planned: round(x.planned), draft: round(x.draft),
      byType: Object.fromEntries(Object.entries(x.byType).map(([k, v]) => [k, round(v)])) }))
    .sort((a, b) => b.days - a.days || b.requests - a.requests || a.person.localeCompare(b.person));

  // working days of the month: who is away, split by type
  const daily: DailyPoint[] = eachDay(r.month.from, r.month.to).filter((d) => !isWeekend(d))
    .map((day) => ({ day, people: perDay.get(day)?.size ?? 0, byType: {} as Record<string, number> }));
  const di = new Map(daily.map((p, i) => [p.day, i]));
  for (const d of active) {
    const i = di.get(d.day); if (i === undefined) continue;
    const t = byId.get(d.requestId)!.typeName;
    daily[i].byType[t] = round((daily[i].byType[t] ?? 0) + d.fraction);
  }

  return {
    daily,
    today: period(t, t, byId, mine, ['planned', 'draft', 'denied']),
    nextWeek: period(r.nextWeek.from, r.nextWeek.to, byId, mine, ['planned', 'draft']),
    month: period(r.month.from, r.month.to, byId, mine, ['planned', 'draft']),
    sameDay,
    ranking,
  };
}

/** `recs` / `days` must cover today, next week, the whole current month and
 *  the sprints `pickSprints` returns */
export function buildDashboard(t: string, recs: DashRecord[], days: DashDay[], sprints: SprintDef[] = []): Dashboard {
  const r = dashRanges(t);
  const wfh = recs.filter((x) => isWfhType(x.typeName));
  const leave = recs.filter((x) => !isWfhType(x.typeName));
  return {
    today: t, ...r,
    leave: section(t, r, leave, days),
    wfh: section(t, r, wfh, days),
    wfhTypes: [...new Set(wfh.map((x) => x.typeName))].sort(),
    types: [...new Set(recs.map((x) => x.typeName))].sort(),
    sprints: pickSprints(t, sprints).map((sp) => sprintLeave(sp, new Map(leave.map((x) => [x.id, x])), days)),
  };
}

// ---- year summary: months + quarters, leave vs work-from-home ------------------

export interface PersonTotals { person: string; team: string; days: number; requests: number }
export interface KindTotals {
  days: number; requests: number; people: number;
  byType: Record<string, number>;
  byPerson: Record<string, PersonTotals>; // by employee id
}
export interface MonthSummary { month: string /* YYYY-MM */; leave: KindTotals; wfh: KindTotals }
export interface QuarterSummary { q: 1 | 2 | 3 | 4; from: string; to: string; leave: KindTotals; wfh: KindTotals }
export interface YearSummary {
  year: number;
  today: string;
  /** first day the cache holds data for — months before it are incomplete */
  dataFrom: string | null;
  months: MonthSummary[];
  quarters: QuarterSummary[];
}

/** approved + draft days inside each month / quarter. A request is counted in
 *  every month (quarter) it has a working day in. */
export function yearSummary(year: number, t: string, recs: DashRecord[], days: DashDay[], dataFrom: string | null = null): YearSummary {
  const byId = new Map(recs.map((x) => [x.id, x]));
  type PAcc = { person: string; team: string; days: number; req: Set<string> };
  type Acc = { days: number; req: Set<string>; ppl: Set<string>; byType: Record<string, number>; byPerson: Map<string, PAcc> };
  const acc = (): Acc => ({ days: 0, req: new Set(), ppl: new Set(), byType: {}, byPerson: new Map() });
  const m = Array.from({ length: 12 }, () => ({ leave: acc(), wfh: acc() }));
  const q = Array.from({ length: 4 }, () => ({ leave: acc(), wfh: acc() }));
  const y = String(year);
  for (const d of days) {
    if (d.day.slice(0, 4) !== y) continue;
    const rec = byId.get(d.requestId);
    if (!rec || !isActive(rec.status)) continue;
    const kind = isWfhType(rec.typeName) ? 'wfh' : 'leave';
    const mi = Number(d.day.slice(5, 7)) - 1;
    for (const a of [m[mi][kind], q[Math.floor(mi / 3)][kind]]) {
      a.days += d.fraction;
      a.req.add(rec.id);
      a.ppl.add(rec.employeeId);
      a.byType[rec.typeName] = (a.byType[rec.typeName] ?? 0) + d.fraction;
      const p = a.byPerson.get(rec.employeeId) ?? { person: rec.person, team: rec.team, days: 0, req: new Set<string>() };
      p.days += d.fraction;
      p.req.add(rec.id);
      a.byPerson.set(rec.employeeId, p);
    }
  }
  const out = (a: Acc): KindTotals => ({
    days: round(a.days), requests: a.req.size, people: a.ppl.size,
    byType: Object.fromEntries(Object.entries(a.byType).map(([k, v]) => [k, round(v)])),
    byPerson: Object.fromEntries([...a.byPerson].map(([id, p]) => [id, { person: p.person, team: p.team, days: round(p.days), requests: p.req.size }])),
  });
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    year, today: t, dataFrom,
    months: m.map((x, i) => ({ month: `${y}-${pad(i + 1)}`, leave: out(x.leave), wfh: out(x.wfh) })),
    quarters: q.map((x, i) => {
      const from = `${y}-${pad(i * 3 + 1)}-01`;
      return { q: (i + 1) as 1 | 2 | 3 | 4, from, to: addDays(addMonths(from, 3), -1), leave: out(x.leave), wfh: out(x.wfh) };
    }),
  };
}
