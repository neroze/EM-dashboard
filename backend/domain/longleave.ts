// Long / mini leave: runs of consecutive working days away. A run is one
// person's leave days where nothing but weekends / their holidays sits
// between one leave day and the next — so back-to-back requests join into a
// single run. Long = 10+ working days, mini = 5–9. Approved and draft (still
// planned) only, and only SCHEDULED leave: work from home, sick leave and
// substitute leave never count — and a day of them breaks a run. Pure functions.
import { addDays, addMonths, isWeekend } from './dates.ts';
import { isActive } from './status.ts';
import type { AppStatus } from './types.ts';
import { isWfhType, type DashDay, type DashRecord } from './dashboard.ts';

/** types that are not scheduled time off (besides work from home) */
export const UNSCHEDULED_RE = /\bsick|substitut/i;
/** does this leave type count toward long / mini leave? */
export const countsAsLongLeave = (typeName: string) => !isWfhType(typeName) && !UNSCHEDULED_RE.test(typeName || '');

export const LONG_DAYS = 10;
export const MINI_DAYS = 5;

export type RunKind = 'long' | 'mini';
export interface LeaveRun {
  id: string; // first request id + start day
  employeeId: string; person: string; team: string;
  kind: RunKind;
  start: string; end: string;
  days: number; // working days (half days count ½)
  status: 'planned' | 'draft' | 'mixed'; // approved / requested / some of each
  types: string[];
  requests: { id: string; status: AppStatus; url?: string }[];
}

/** split each person's leave days into runs of consecutive working days */
export function findRuns(recs: DashRecord[], days: DashDay[], isHoliday: (day: string, employeeId: string) => boolean): LeaveRun[] {
  const byId = new Map(recs.map((r) => [r.id, r]));
  const perPerson = new Map<string, Map<string, { fraction: number; reqs: Set<string> }>>();
  for (const d of days) {
    const r = byId.get(d.requestId);
    if (!r || !isActive(r.status) || !countsAsLongLeave(r.typeName) || d.fraction <= 0) continue;
    const m = perPerson.get(d.employeeId) ?? new Map();
    const cur = m.get(d.day) ?? { fraction: 0, reqs: new Set<string>() };
    cur.fraction = Math.min(1, cur.fraction + d.fraction);
    cur.reqs.add(d.requestId);
    m.set(d.day, cur);
    perPerson.set(d.employeeId, m);
  }

  const out: LeaveRun[] = [];
  for (const [emp, m] of perPerson) {
    const daysSorted = [...m.keys()].sort();
    let run: string[] = [];
    const flush = () => {
      if (!run.length) return;
      const total = run.reduce((a, d) => a + m.get(d)!.fraction, 0);
      const kind: RunKind | null = total >= LONG_DAYS ? 'long' : total >= MINI_DAYS ? 'mini' : null;
      if (kind) {
        const reqIds = [...new Set(run.flatMap((d) => [...m.get(d)!.reqs]))];
        const reqs = reqIds.map((id) => byId.get(id)!).sort((a, b) => a.startDate.localeCompare(b.startDate));
        const st = new Set(reqs.map((r) => r.status));
        out.push({
          id: `${reqs[0].id}:${run[0]}`, employeeId: emp, person: reqs[0].person, team: reqs[0].team,
          kind, start: run[0], end: run[run.length - 1], days: Math.round(total * 100) / 100,
          status: st.size > 1 ? 'mixed' : st.has('draft') ? 'draft' : 'planned',
          types: [...new Set(reqs.map((r) => r.typeName))],
          requests: reqs.map((r) => ({ id: r.id, status: r.status, url: r.url })),
        });
      }
      run = [];
    };
    for (const d of daysSorted) {
      if (run.length && !onlyBreaksBetween(run[run.length - 1], d, (x) => isHoliday(x, emp))) flush();
      run.push(d);
    }
    flush();
  }
  return out.sort((a, b) => a.start.localeCompare(b.start) || a.person.localeCompare(b.person));
}

/** true when every day strictly between a and b is a weekend or holiday */
function onlyBreaksBetween(a: string, b: string, isHoliday: (d: string) => boolean): boolean {
  for (let d = addDays(a, 1), n = 0; d < b; d = addDays(d, 1), n++) {
    if (n > 40) return false; // nobody has a 6-week holiday gap
    if (!isWeekend(d) && !isHoliday(d)) return false;
  }
  return true;
}

export interface MonthRuns { month: string /* YYYY-MM */; from: string; to: string; long: LeaveRun[]; mini: LeaveRun[] }
export interface LongLeaveYear {
  year: number;
  today: string;
  dataFrom: string | null;
  months: MonthRuns[];
  long: LeaveRun[]; // every run touching the year
  mini: LeaveRun[];
}

/** runs placed in every month of `year` they overlap */
export function longLeaveYear(year: number, t: string, runs: LeaveRun[], dataFrom: string | null = null): LongLeaveYear {
  const y = String(year);
  const inYear = runs.filter((r) => r.end >= `${y}-01-01` && r.start <= `${y}-12-31`);
  const months = Array.from({ length: 12 }, (_, i) => {
    const from = `${y}-${String(i + 1).padStart(2, '0')}-01`;
    const to = addDays(addMonths(from, 1), -1);
    const here = inYear.filter((r) => r.end >= from && r.start <= to);
    return { month: from.slice(0, 7), from, to, long: here.filter((r) => r.kind === 'long'), mini: here.filter((r) => r.kind === 'mini') };
  });
  return {
    year, today: t, dataFrom, months,
    long: inYear.filter((r) => r.kind === 'long'),
    mini: inYear.filter((r) => r.kind === 'mini'),
  };
}
