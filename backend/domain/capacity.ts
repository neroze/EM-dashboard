// Person-days and overlap detection. Pure.
//
//  available  = working days in the period − holidays for the person's location
//  plannedOut = Σ leave_day.fraction of approved requests in the period
//  draftOut   = Σ leave_day.fraction of requested (draft) requests
//  overlap day = out-people ÷ team size ≥ threshold (half day = 0.5 person)
import { eachDay, isWeekend } from './dates.ts';
import type { AppStatus } from './types.ts';

export interface CapPerson { id: string; displayName: string; team: string; location: string }
export interface CapDay { employeeId: string; day: string; fraction: number; status: AppStatus }
export type HolidayFn = (day: string, location: string) => boolean;

export interface PersonCapacity {
  id: string; displayName: string;
  available: number; plannedOut: number; draftOut: number; net: number;
}
export interface TeamCapacity {
  team: string;
  headcount: number;
  available: number;
  plannedOut: number;
  draftOut: number;
  net: number; // available − planned − draft (worst case)
  netPlanned: number; // available − planned (best case)
  people: PersonCapacity[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function workingDays(from: string, to: string, location: string, isHoliday: HolidayFn): number {
  let n = 0;
  for (const d of eachDay(from, to)) if (!isWeekend(d) && !isHoliday(d, location)) n++;
  return n;
}

export function capacityByTeam(
  people: CapPerson[],
  days: CapDay[],
  from: string,
  to: string,
  isHoliday: HolidayFn,
): TeamCapacity[] {
  const per = new Map<string, PersonCapacity>();
  for (const p of people) {
    const available = workingDays(from, to, p.location, isHoliday);
    per.set(p.id, { id: p.id, displayName: p.displayName, available, plannedOut: 0, draftOut: 0, net: available });
  }
  for (const d of days) {
    if (d.day < from || d.day > to) continue;
    const pc = per.get(d.employeeId);
    if (!pc) continue;
    if (d.status === 'planned') pc.plannedOut += d.fraction;
    else if (d.status === 'draft') pc.draftOut += d.fraction;
  }
  const teams = new Map<string, TeamCapacity>();
  for (const p of people) {
    const pc = per.get(p.id)!;
    pc.plannedOut = r2(pc.plannedOut); pc.draftOut = r2(pc.draftOut);
    pc.net = r2(pc.available - pc.plannedOut - pc.draftOut);
    let t = teams.get(p.team);
    if (!t) {
      t = { team: p.team, headcount: 0, available: 0, plannedOut: 0, draftOut: 0, net: 0, netPlanned: 0, people: [] };
      teams.set(p.team, t);
    }
    t.headcount++;
    t.available += pc.available; t.plannedOut += pc.plannedOut; t.draftOut += pc.draftOut;
    t.people.push(pc);
  }
  return [...teams.values()]
    .map((t) => ({
      ...t,
      available: r2(t.available), plannedOut: r2(t.plannedOut), draftOut: r2(t.draftOut),
      net: r2(t.available - t.plannedOut - t.draftOut),
      netPlanned: r2(t.available - t.plannedOut),
      people: t.people.sort((a, b) => a.displayName.localeCompare(b.displayName)),
    }))
    .sort((a, b) => a.team.localeCompare(b.team));
}

export interface TeamDayLoad { team: string; out: number; planned: number; draft: number; size: number; share: number; flagged: boolean }
export interface OverlapDay { day: string; teams: TeamDayLoad[]; peopleOut: number; flagged: boolean }

/**
 * Per working day, how much of each team is out. A team-day is flagged when
 * out ÷ size ≥ that team's threshold, or — when minPeople is given — when at
 * least minPeople people are out.
 */
export function teamLoad(
  people: CapPerson[],
  days: CapDay[],
  from: string,
  to: string,
  thresholdFor: (team: string) => number,
  minPeople?: number | null,
): OverlapDay[] {
  const teamOf = new Map(people.map((p) => [p.id, p.team]));
  const size = new Map<string, number>();
  for (const p of people) size.set(p.team, (size.get(p.team) ?? 0) + 1);

  // day -> team -> { planned, draft } (a person counts at most 1 per day)
  const byDay = new Map<string, Map<string, Map<string, { p: number; d: number }>>>();
  for (const d of days) {
    if (d.day < from || d.day > to || (d.status !== 'planned' && d.status !== 'draft')) continue;
    const team = teamOf.get(d.employeeId);
    if (team === undefined) continue;
    let tm = byDay.get(d.day); if (!tm) byDay.set(d.day, (tm = new Map()));
    let pm = tm.get(team); if (!pm) tm.set(team, (pm = new Map()));
    const cur = pm.get(d.employeeId) ?? { p: 0, d: 0 };
    if (d.status === 'planned') cur.p += d.fraction; else cur.d += d.fraction;
    pm.set(d.employeeId, cur);
  }

  const out: OverlapDay[] = [];
  for (const day of eachDay(from, to)) {
    if (isWeekend(day)) continue;
    const tm = byDay.get(day);
    if (!tm) continue;
    const teams: TeamDayLoad[] = [];
    let peopleOut = 0;
    for (const [team, pm] of tm) {
      let planned = 0, draft = 0, n = 0;
      for (const v of pm.values()) {
        const p = Math.min(1, v.p), dd = Math.min(1 - p, v.d);
        planned += p; draft += dd; n++;
      }
      const sz = size.get(team) ?? 0;
      const o = r2(planned + draft);
      const share = sz ? o / sz : 0;
      const flagged = minPeople && minPeople > 0 ? n >= minPeople : sz > 0 && share >= thresholdFor(team) - 1e-9;
      peopleOut += n;
      teams.push({ team, out: o, planned: r2(planned), draft: r2(draft), size: sz, share: r2(share), flagged });
    }
    teams.sort((a, b) => a.team.localeCompare(b.team));
    out.push({ day, teams, peopleOut, flagged: teams.some((t) => t.flagged) });
  }
  return out;
}
