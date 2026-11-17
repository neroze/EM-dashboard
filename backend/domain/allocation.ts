// People allocation: one person's capacity split across every epic they hold
// tickets in, over all projects, sprint by sprint. Pure.
//
// Per person, per calendar sprint:
//   working   = their working days (weekdays − their location's holidays)
//   leave     = their approved leave in those days (fractions count)
//   available = working − leave          (everyone works at 100%)
//   jira      = estimate of their tickets in that sprint (done + remaining),
//               split by epic — the "days in Jira"
//   load      = jira ÷ available
// Active sprint also carries what's left: remaining ÷ available from today.
//
// A ticket linked to more than one project is counted once. Nothing here
// knows a leave TYPE — only days unavailable.
import {
  band, doneOf, leaveDates, mapSprint, r2, remainingOf, utilisation, windowDays,
  type Band, type CalendarSprint, type DayFn, type ProjectEpic, type Ticket,
} from './projectHealth.ts';

export interface AllocSource { projectId: string; projectName: string; epics: ProjectEpic[]; tickets: Ticket[] }

export interface AllocItem { epicKey: string; jira: number; done: number; remaining: number; tickets: number; open: number }
export interface AllocCell {
  working: number; leave: number; available: number; leaveDates: { day: string; out: number }[];
  jira: number; done: number; remaining: number; tickets: number; open: number;
  load: number; band: Band;
  /** active sprint only: available days from today, and remaining ÷ that */
  availableAhead: number | null; loadAhead: number | null;
  items: AllocItem[];
}
export interface AllocPerson {
  id: string;
  cells: AllocCell[]; // one per sprint, same order as Allocation.sprints
  backlog: { remaining: number; tickets: number; items: AllocItem[] }; // open, not in a calendar sprint
  epics: string[];    // their epics, most days first (the colour order)
  projects: string[]; // project ids they hold work in
}
export interface AllocEpic { key: string; summary: string; status: string; done: boolean; projects: { id: string; name: string }[] }
export interface Allocation {
  sprints: { name: string; startDate: string; endDate: string; state: 'past' | 'active' | 'future' }[];
  people: AllocPerson[];
  epics: AllocEpic[];
  unassigned: { jira: number; remaining: number; tickets: number }[]; // per sprint
  unassignedBacklog: { remaining: number; tickets: number };
}

function itemsOf(ts: Ticket[]): AllocItem[] {
  const by = new Map<string, AllocItem>();
  for (const t of ts) {
    let it = by.get(t.epicKey);
    if (!it) by.set(t.epicKey, (it = { epicKey: t.epicKey, jira: 0, done: 0, remaining: 0, tickets: 0, open: 0 }));
    it.done += doneOf(t); it.remaining += remainingOf(t); it.tickets++;
    if (!t.done) it.open++;
  }
  return [...by.values()].map((i) => ({ ...i, done: r2(i.done), remaining: r2(i.remaining), jira: r2(i.done + i.remaining) }))
    .sort((a, b) => b.jira - a.jira || a.epicKey.localeCompare(b.epicKey));
}
const sum = (xs: AllocItem[], k: 'jira' | 'done' | 'remaining' | 'tickets' | 'open') => r2(xs.reduce((s, x) => s + x[k], 0));

/**
 * Calendar sprints from the first through `until` (or the last sprint holding
 * an open ticket, if later). People = everyone with a ticket in one of those
 * sprints, or an open ticket outside them.
 */
export function allocation(
  sources: AllocSource[],
  cal: CalendarSprint[],
  personOf: (assigneeId: string | null) => string | null,
  day: DayFn,
  today: string,
  until: string,
): Allocation {
  // tickets once each; an epic remembers every project it belongs to
  const tickets = new Map<string, Ticket>();
  const epics = new Map<string, AllocEpic>();
  for (const s of sources) {
    for (const e of s.epics) {
      const x = epics.get(e.key);
      if (x) { if (!x.projects.some((p) => p.id === s.projectId)) x.projects.push({ id: s.projectId, name: s.projectName }); }
      else epics.set(e.key, { key: e.key, summary: e.summary, status: e.status, done: e.done, projects: [{ id: s.projectId, name: s.projectName }] });
    }
    for (const t of s.tickets) if (!tickets.has(t.key)) tickets.set(t.key, t);
  }

  const sorted = [...cal].sort((a, b) => a.startDate.localeCompare(b.startDate));
  const placed = new Map<string, string | null>(); // ticket → calendar sprint
  let end = until;
  for (const t of tickets.values()) {
    const m = mapSprint(t.sprint, sorted);
    placed.set(t.key, m);
    const c = m ? sorted.find((x) => x.name === m) : null;
    if (c && !t.done && c.startDate > end) end = c.startDate;
  }
  const span = sorted.filter((c) => c.startDate <= end);
  const idx = new Map(span.map((c, i) => [c.name, i]));

  // person → sprint index (-1 = backlog) → tickets
  const byPerson = new Map<string, Map<number, Ticket[]>>();
  const unassigned = span.map(() => [] as Ticket[]);
  const unBacklog: Ticket[] = [];
  for (const t of tickets.values()) {
    const m = placed.get(t.key);
    const i = m != null && idx.has(m) ? idx.get(m)! : -1;
    if (i < 0 && t.done) continue; // finished outside the span: not part of anyone's load
    const id = personOf(t.assigneeId);
    if (!id) { (i < 0 ? unBacklog : unassigned[i]).push(t); continue; }
    let pm = byPerson.get(id);
    if (!pm) byPerson.set(id, (pm = new Map()));
    const l = pm.get(i); if (l) l.push(t); else pm.set(i, [t]);
  }

  const people = [...byPerson].map(([id, pm]): AllocPerson => {
    const cells = span.map((c, i): AllocCell => {
      const w = windowDays(id, c.startDate, c.endDate, day);
      const items = itemsOf(pm.get(i) ?? []);
      const jira = sum(items, 'jira'), remaining = sum(items, 'remaining');
      const active = c.startDate <= today && c.endDate >= today;
      const ahead = active ? windowDays(id, today, c.endDate, day).available : null;
      const load = utilisation(jira, w.available);
      return {
        working: w.working, leave: w.unavailable, available: w.available, leaveDates: leaveDates(id, c.startDate, c.endDate, day),
        jira, done: sum(items, 'done'), remaining, tickets: sum(items, 'tickets'), open: sum(items, 'open'),
        load, band: band(load),
        availableAhead: ahead, loadAhead: ahead === null ? null : utilisation(remaining, ahead),
        items,
      };
    });
    const backlogItems = itemsOf(pm.get(-1) ?? []);
    // colour order: most days across the span first, backlog after
    const total = new Map<string, number>();
    for (const c of cells) for (const it of c.items) total.set(it.epicKey, (total.get(it.epicKey) ?? 0) + it.jira);
    for (const it of backlogItems) total.set(it.epicKey, (total.get(it.epicKey) ?? 0) + it.remaining);
    const mine = [...total].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k]) => k);
    const projects = [...new Set(mine.flatMap((k) => epics.get(k)?.projects.map((p) => p.id) ?? []))];
    return {
      id, cells,
      backlog: { remaining: sum(backlogItems, 'remaining'), tickets: sum(backlogItems, 'open'), items: backlogItems },
      epics: mine, projects,
    };
  });

  const rem = (ts: Ticket[]) => r2(ts.reduce((s, t) => s + remainingOf(t), 0));
  return {
    sprints: span.map((c) => ({
      name: c.name, startDate: c.startDate, endDate: c.endDate,
      state: c.endDate < today ? 'past' : c.startDate > today ? 'future' : 'active',
    })),
    people,
    epics: [...epics.values()],
    unassigned: unassigned.map((ts) => ({ jira: r2(ts.reduce((s, t) => s + doneOf(t) + remainingOf(t), 0)), remaining: rem(ts), tickets: ts.length })),
    unassignedBacklog: { remaining: rem(unBacklog), tickets: unBacklog.filter((t) => !t.done).length },
  };
}
