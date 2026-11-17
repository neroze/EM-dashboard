// The epic capacity forecast report: the same three tables, wording and
// arithmetic as the epic-capacity-forecast skill (scripts/compute.py), so a
// run here and a run on the Confluence forecast page can be compared side by
// side, and their snapshots are interchangeable. Pure.
//
// Differences, on purpose:
//  - capacity is each engineer's real availability (working days − their
//    BambooHR leave) instead of a flat days-per-engineer from the registry;
//  - "the last run" is the last refresh on an earlier day (or a snapshot
//    pasted from the forecast page).
import { mapSprint, type CalendarSprint, type ProjectEpic, type Ticket } from './projectHealth.ts';

export const DAY_SECONDS = 21600; // 6-hour estimate day
export const GREEN_PCT = 80, AMBER_PCT = 100;
const CANCELLED = new Set(['duplicate', "won't do", 'wont do', 'won’t do', "won't fix", 'wont fix', 'cannot reproduce',
  'obsolete', 'rejected', 'declined', 'not a bug', 'invalid']);

export type RState = 'open' | 'review' | 'done' | 'cancelled';
/** cancelled: closed as Duplicate / Won't Do / …, or left open under an epic that is closed (closedWithEpic) */
export const isCancelled = (t: Pick<Ticket, 'done' | 'resolution' | 'closedWithEpic'>) =>
  t.closedWithEpic === true || (t.done && CANCELLED.has((t.resolution ?? '').trim().toLowerCase()));
export function ticketState(t: Ticket): RState {
  if (isCancelled(t)) return 'cancelled';
  if (t.done) return 'done';
  return /review/i.test(t.status) ? 'review' : 'open';
}

/** the skill's snapshot format: { t: { key: [origSeconds, remSeconds, state letter] }, rt: remaining total } */
export interface Snapshot { skill?: string; project?: string | null; date: string; rt: number | null; t: Record<string, [number | null, number | null, string]> }
const LETTER: Record<RState, string> = { open: 'o', review: 'r', done: 'd', cancelled: 'c' };
const FROM_LETTER: Record<string, RState> = { o: 'open', r: 'review', d: 'done', c: 'cancelled' };

/** a report sprint: from the current one to the deadline sprint */
export interface ReportSprint { name: string; label: string; days: number; capacity: number }
/** one engineer behind the capacity row: per report sprint, their available days and leave */
export interface EngineerCapacity {
  id: string;
  /** actual = what they can really schedule: available, capped at SPRINT_SCHEDULABLE_DAYS a sprint */
  sprints: { working: number; leave: number; available: number; actual: number; leaveDates: { day: string; out: number }[] }[];
}

// ---- formatting, exactly as compute.py ----------------------------------------
/** round half up to one decimal (35.25 → 35.3) */
export function r1(x: number): string {
  const v = Math.round(x * 1e6) / 1e6;
  const s = Math.sign(v) * Math.round(Math.abs(v) * 10 + 1e-9) / 10;
  return s.toFixed(1);
}
const fmt = (x: number | null, zero = '0') => (x === null ? '–' : Math.abs(x) < 0.05 ? zero : r1(x));
const signed = (x: number) => (Math.abs(x) < 0.05 ? '0' : (x > 0 ? '+' : '−') + r1(Math.abs(x)));
const num = (x: number) => String(Math.round(x * 1e6) / 1e6);
const icon = (p: number) => (p <= GREEN_PCT ? '🟢' : p <= AMBER_PCT ? '🟠' : '🔴');
/** Python's round(): halves go to the even neighbour (112.5 → 112) */
export const pyRound = (x: number) => { const f = Math.floor(x), d = x - f; return d > 0.5 ? f + 1 : d < 0.5 ? f : f % 2 === 0 ? f : f + 1; };
const pctIcon = (p: number) => `${icon(p)} ${pyRound(p)}%`;
const keySort = (a: string, b: string) => {
  const [pa, na] = [a.slice(0, a.lastIndexOf('-')), +a.slice(a.lastIndexOf('-') + 1) || 0];
  const [pb, nb] = [b.slice(0, b.lastIndexOf('-')), +b.slice(b.lastIndexOf('-') + 1) || 0];
  return pa.localeCompare(pb) || na - nb;
};
/** ['LP-1', 'LP-2'] → 'LP-1, 2' */
export function shortKeys(keys: string[]): string {
  let prefix: string | null = null;
  return keys.map((k) => { const i = k.lastIndexOf('-'); const p = k.slice(0, i); const out = p === prefix ? k.slice(i + 1) : k; prefix = p; return out; }).join(', ');
}
/** "Q4 2026 Sprint 4" → "Sprint 4" (the skill's column labels) */
export const sprintLabel = (name: string) => /sprint\s*\d+/i.exec(name)?.[0].replace(/sprint\s*/i, 'Sprint ') ?? name;

export interface EpicRow { key: string; label: string; est: number; done: number; review: number; rem: number; unest: number }
export interface ChangeRow { label: string; count: number; keys: string; effect: number; standard: boolean }
export interface Report {
  epics: EpicRow[]; total: EpicRow;
  sprints: (ReportSprint & { loaded: number; needed: number; utilisation: number | null })[];
  notInSprint: number; engineers: number; totalCapacity: number; totalRemaining: number; totalUtilisation: number | null;
  changes: null | { rows: ChangeRow[]; prevTotal: number; prevDate: string };
  /** remaining work loaded on each person, per report sprint (+ "not in a sprint"); '' = unassigned */
  loadByPerson: Record<string, { sprints: number[]; none: number }>;
  warnings: string[];
  snapshot: Snapshot;
  markdown: string;
}

/**
 * tickets: every ticket under the epics (closed and cancelled too). sprints:
 * the report's sprints in order, the current one first. cal: the calendar,
 * to place Jira sprints. prev: the last run's snapshot, if any.
 */
export function buildReport(args: {
  project: string; date: string; epics: ProjectEpic[]; tickets: Ticket[];
  sprints: ReportSprint[]; engineers: number; cal: CalendarSprint[]; prev: Snapshot | null;
  /** Jira assignee → person id, to split the loaded work by engineer (not part of the skill's tables) */
  personOf?: (assigneeId: string | null) => string | null;
}): Report {
  const { epics, tickets, sprints, cal, prev } = args;
  const D = DAY_SECONDS;
  const names = sprints.map((s) => s.name);
  const epicSet = new Set(epics.map((e) => e.key));

  /** latest report sprint the ticket is in; Jira-active work still sitting in an
   *  older sprint counts as the current one; unplaced future work is "later" */
  const bucket = (t: Ticket): number | 'later' | 'none' => {
    let best = -1, current = false, later = false;
    for (const s of t.sprints?.length ? t.sprints : t.sprint ? [t.sprint] : []) {
      const i = names.indexOf(mapSprint(s, cal) ?? '');
      if (i >= 0) best = Math.max(best, i);
      else if (s.state === 'active') current = true;
      else if (s.state === 'future') later = true;
    }
    return best >= 0 ? best : current && names.length ? 0 : later ? 'later' : 'none';
  };

  const rows = new Map(epics.map((e) => [e.key, { key: e.key, label: e.summary || e.key, est: 0, done: 0, review: 0, rem: 0, unest: 0 } as EpicRow]));
  const load = sprints.map(() => 0);
  let noneRem = 0, laterRem = 0;
  const loadByPerson: Report['loadByPerson'] = {};
  const personLoad = (t: Ticket) => {
    const id = (args.personOf ? args.personOf(t.assigneeId) : t.assigneeId) ?? '';
    return (loadByPerson[id] ??= { sprints: sprints.map(() => 0), none: 0 });
  };
  const snap: Record<string, { orig: number | null; rem: number | null; state: RState }> = {};
  const warnings: string[] = [];
  for (const t of tickets) {
    if (!epicSet.has(t.epicKey)) continue;
    const origSec = t.origSec !== undefined ? t.origSec : t.originalDays === null ? null : t.originalDays * D;
    const remSec = t.remSec !== undefined ? t.remSec : t.remainingDays === null ? null : t.remainingDays * D;
    const o = (origSec ?? 0) / D, r = (remSec ?? 0) / D;
    const state = ticketState(t);
    snap[t.key] = { orig: origSec, rem: remSec, state };
    if (state === 'cancelled') continue;
    const R = rows.get(t.epicKey)!;
    R.est += o;
    if (state === 'done') { R.done += o; continue; }
    if (state === 'review') { R.review += o; continue; }
    if (origSec === null) R.unest++;
    R.rem += r;
    const b = bucket(t);
    const pl = personLoad(t);
    if (b === 'none') { noneRem += r; pl.none += r; } else if (b === 'later') { laterRem += r; pl.none += r; } else { load[b] += r; pl.sprints[b] += r; }
  }
  if (laterRem > 0.05) {
    warnings.push(`${r1(laterRem)} d of remaining work sits in sprints after the deadline; it is counted under 'Not in a sprint'.`);
    noneRem += laterRem;
  }
  const total: EpicRow = { key: '', label: 'Total', est: 0, done: 0, review: 0, rem: 0, unest: 0 };
  for (const R of rows.values()) { total.est += R.est; total.done += R.done; total.review += R.review; total.rem += R.rem; total.unest += R.unest; }

  // ---- remaining work vs capacity: the current sprint needs what is loaded; the rest is split evenly
  const caps = sprints.map((s) => s.capacity);
  const totalCap = caps.reduce((a, b) => a + b, 0);
  const totalRem = total.rem;
  const nFuture = sprints.length - 1;
  const needed = sprints.length ? [load[0], ...Array(Math.max(0, nFuture)).fill(nFuture ? (totalRem - load[0]) / nFuture : 0)] : [];
  const sprintRows = sprints.map((s, i) => ({ ...s, loaded: load[i], needed: needed[i], utilisation: caps[i] ? (100 * needed[i]) / caps[i] : null }));
  const totalUtil = totalCap ? (100 * totalRem) / totalCap : null;

  // ---- what changed since the last run
  let changes: Report['changes'] = null;
  if (prev) {
    const P: Record<string, { orig: number | null; rem: number | null; state: RState }> = {};
    for (const [k, v] of Object.entries(prev.t)) P[k] = { orig: v[0], rem: v[1], state: FROM_LETTER[v[2]] ?? 'open' };
    const counted = (x?: { rem: number | null; state: RState }) => (x && x.state === 'open' ? (x.rem ?? 0) / D : 0);
    const prevTotal = prev.rt !== null && Number.isFinite(prev.rt) ? prev.rt : Object.values(P).reduce((s, x) => s + counted(x), 0);
    type It = { k: string; d: number; o?: number; c?: number };
    const newlyEst: It[] = [], unestClosed: It[] = [], estClosed: It[] = [], reest: It[] = [];
    const delivered: It[] = [], reviewMoves: It[] = [], burn: It[] = [], added: It[] = [], removed: It[] = [];
    for (const k of [...new Set([...Object.keys(P), ...Object.keys(snap)])].sort(keySort)) {
      const p = P[k], c = snap[k];
      if (p && !c) { removed.push({ k, d: -counted(p) }); continue; }
      if (c && !p) { added.push({ k, d: counted(c) }); continue; }
      const d = counted(c) - counted(p);
      if (p.state === 'open' && p.orig === null) {
        if (c.state === 'cancelled') unestClosed.push({ k, d });
        else if (c.orig !== null) newlyEst.push({ k, d });
        else if (Math.abs(d) > 0.001) burn.push({ k, d });
        continue;
      }
      if (c.state === 'cancelled' && p.state !== 'cancelled') { estClosed.push({ k, d, o: (p.orig ?? 0) / D }); continue; }
      if (c.state === 'done' && (p.state === 'open' || p.state === 'review')) { delivered.push({ k, d }); continue; }
      if ((p.state === 'open') !== (c.state === 'open')) { reviewMoves.push({ k, d }); continue; }
      if (p.orig !== c.orig && c.state === 'open') { reest.push({ k, d, o: (p.orig ?? 0) / D, c: (c.orig ?? 0) / D }); continue; }
      if (Math.abs(d) > 0.001) burn.push({ k, d });
    }
    const sum = (xs: It[]) => xs.reduce((s, x) => s + x.d, 0);
    const keysOf = (xs: It[]) => (xs.length ? ` (${shortKeys(xs.map((x) => x.k))})` : '');
    const out: ChangeRow[] = [
      { label: 'Previously unestimated tickets that now have estimates', count: newlyEst.length, keys: '', effect: sum(newlyEst), standard: true },
      { label: 'Previously unestimated tickets closed as Duplicate or Won’t Do', count: unestClosed.length, keys: keysOf(unestClosed), effect: sum(unestClosed), standard: true },
      { label: 'Estimated tickets closed as Duplicate or Won’t Do', count: estClosed.length,
        keys: estClosed.length ? ' (' + estClosed.map((x) => `${x.k} ${num(x.o!)} d`).join(', ') + ')' : '', effect: sum(estClosed), standard: true },
      { label: 'Re-estimates on existing tickets', count: reest.length,
        keys: reest.map((x) => `${x.k} ${num(x.o!)}→${num(x.c!)}`).join(', '), effect: sum(reest), standard: true },
    ];
    for (const [label, xs] of [['Tickets delivered', delivered], ['Tickets moved into or out of review', reviewMoves],
      ['Remaining burned on in-progress tickets', burn], ['New tickets added to the epics', added], ['Tickets moved out of the epics', removed]] as [string, It[]][]) {
      if (xs.length) out.push({ label, count: xs.length, keys: keysOf(xs), effect: sum(xs), standard: false });
    }
    const explained = [newlyEst, unestClosed, estClosed, reest, delivered, reviewMoves, burn, added, removed].reduce((s, xs) => s + sum(xs), 0);
    const gap = (totalRem - prevTotal) - explained;
    if (Math.abs(gap) > 0.05) out.push({ label: 'Other / unexplained', count: 0, keys: '', effect: gap, standard: false });
    changes = { rows: out, prevTotal, prevDate: prev.date };
  }

  const snapshot: Snapshot = {
    skill: 'epic-capacity-forecast', project: args.project, date: args.date, rt: Math.round(totalRem * 100) / 100,
    t: Object.fromEntries(Object.keys(snap).sort(keySort).map((k) => [k, [snap[k].orig, snap[k].rem, LETTER[snap[k].state]]])),
  };

  // ---- markdown, line for line as compute.py writes report.md
  const L: string[] = [];
  L.push('## Epic status (ticket level)\n');
  L.push('| Epic | Estimate, active (d) | Delivered (d) | In review (d) | Remaining (d) | Done % | Unestimated |');
  L.push('|---|---|---|---|---|---|---|');
  const erow = (R: EpicRow, bold = false) => {
    const pct = R.est ? `${pyRound((100 * R.done) / R.est)}%` : '–';
    let cells = [R.label, fmt(R.est), fmt(R.done, '–'), fmt(R.review, '–'), fmt(R.rem), pct, String(R.unest)];
    if (bold) cells = cells.map((c) => `**${c}**`);
    L.push('| ' + cells.join(' | ') + ' |');
  };
  for (const R of rows.values()) erow(R);
  erow(total, true);
  L.push('\n## Remaining work vs capacity\n');
  const hdr = ['', ...sprints.map((s) => `${s.label} (${num(s.days)} d)`), 'Not in a sprint', 'Total'];
  L.push('| ' + hdr.join(' | ') + ' |');
  L.push('|' + '---|'.repeat(hdr.length));
  L.push('| ' + [`Capacity, ${args.engineers} engineers (d)`, ...caps.map(num), '–', num(totalCap)].join(' | ') + ' |');
  L.push('| ' + ['Loaded or scheduled (d)', ...load.map((x) => fmt(x)), fmt(noneRem), fmt(totalRem)].join(' | ') + ' |');
  L.push('| ' + ['Needed to finish (d)', ...needed.map((x) => fmt(x)), '–', fmt(totalRem)].join(' | ') + ' |');
  L.push('| ' + ['Utilisation', ...sprintRows.map((s) => (s.utilisation === null ? '–' : pctIcon(s.utilisation))), '', totalUtil === null ? '–' : pctIcon(totalUtil)].join(' | ') + ' |');
  L.push('\n## What changed since the last run\n');
  if (!changes) L.push('No previous snapshot found, so this run is the baseline. The change table will appear from the next run.');
  else {
    L.push('| Change | Tickets | Effect on remaining (d) |');
    L.push('|---|---|---|');
    for (const c of changes.rows) {
      const tickets = c.label.startsWith('Re-estimates') ? (c.keys || '–')
        : c.label === 'Other / unexplained' ? '–'
        : c.label.startsWith('Previously unestimated tickets that now') ? String(c.count) : `${c.count}${c.keys}`;
      L.push(`| ${c.label} | ${tickets} | ${signed(c.effect)} |`);
    }
    L.push(`| **Net** | | **${r1(changes.prevTotal)} → ${r1(totalRem)}** |`);
  }
  for (const w of warnings) L.push(`\n> ${w}`);

  return {
    epics: [...rows.values()], total, sprints: sprintRows, notInSprint: noneRem, engineers: args.engineers,
    totalCapacity: totalCap, totalRemaining: totalRem, totalUtilisation: totalUtil, changes, loadByPerson, warnings, snapshot,
    markdown: L.join('\n') + '\n',
  };
}

/** a pasted snapshot (from the forecast page or the skill's reply) → Snapshot, or an error */
export function parseSnapshot(text: string): Snapshot {
  let j: any;
  try { j = JSON.parse(String(text).trim().replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { throw new Error('That isn’t valid JSON. Paste the whole “Snapshot for next run” block.'); }
  if (!j || typeof j.t !== 'object' || Array.isArray(j.t)) throw new Error('No ticket list (“t”) in that snapshot.');
  const t: Snapshot['t'] = {};
  for (const [k, v] of Object.entries(j.t)) {
    if (!Array.isArray(v) || v.length < 3 || !FROM_LETTER[String(v[2])]) throw new Error(`Ticket ${k} isn’t in the snapshot format.`);
    t[k] = [typeof v[0] === 'number' ? v[0] : null, typeof v[1] === 'number' ? v[1] : null, String(v[2])];
  }
  const date = typeof j.date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(j.date) ? j.date.slice(0, 10) : '';
  if (!date) throw new Error('The snapshot has no date.');
  return { skill: j.skill, project: j.project ?? null, date, rt: typeof j.rt === 'number' && Number.isFinite(j.rt) ? j.rt : null, t };
}
