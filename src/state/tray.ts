// Menu bar (tray) item: "N out" at a glance, with today's people grouped by
// team in its menu plus quick actions. It follows the selected teams (the
// whole team, not the panel's person filters) and refreshes after each sync.
import { useEffect, useRef } from 'react';
import { api } from '../api.ts';
import { approveLeave } from '../approve.ts';
import type { Dashboard, DashItem, LeaveRecord, Status, WfhConflict } from '../types.ts';
import { fmtDays, fmtRange } from '../format.ts';
import { addDays } from '../../backend/domain/dates.ts';
import { defaultFilters, setState, type View } from './filters.ts';
import type { ViewGroup } from '../components/ViewNav.tsx';

export interface TrayActions {
  sync: () => void;
  settings: () => void;
}


function trayIcon(): string | undefined {
  if (tiny.system.isMacOS()) return 'sf:calendar.badge.clock';
  if (tiny.system.isWindows()) return 'emoji:🌴';
  return undefined; // Linux: the app icon
}

/** one entry per person: a person with two requests in the window shows once.
 *  Leave is shown as dates only, never its type. */
interface Who { employeeId: string; person: string; team: string; pending: boolean; half: boolean; from: string; until: string }
function people(items: DashItem[]): Who[] {
  const by = new Map<string, Who>();
  for (const i of items) {
    if (i.status === 'denied') continue;
    const cur = by.get(i.employeeId);
    if (cur) {
      cur.pending = cur.pending && i.status === 'draft';
      cur.half = false;
      if (i.startDate < cur.from) cur.from = i.startDate;
      if (i.endDate > cur.until) cur.until = i.endDate;
      continue;
    }
    by.set(i.employeeId, { employeeId: i.employeeId, person: i.person, team: i.team, pending: i.status === 'draft', half: i.days === 0.5, from: i.startDate, until: i.endDate });
  }
  return [...by.values()].sort((a, b) => a.person.localeCompare(b.person));
}

/** native menus can't tint text: the nearest coloured circle emoji stands in
 *  for the team's colour */
const DOTS: [string, [number, number, number]][] = [
  ['🔵', [59, 130, 246]], ['🟢', [16, 185, 129]], ['🟣', [139, 92, 246]], ['🟡', [234, 179, 8]],
  ['🟠', [249, 115, 22]], ['🔴', [239, 68, 68]], ['🟤', [146, 64, 14]], ['⚫', [71, 85, 105]],
];
function teamDot(hex: string | undefined): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex ?? '');
  if (!m) return '⚪';
  const c = [1, 2, 3].map((i) => parseInt(m[i], 16));
  let best = DOTS[0][0], dist = Infinity;
  for (const [e, rgb] of DOTS) {
    const d = rgb.reduce((a, v, i) => a + (v - c[i]) ** 2, 0);
    if (d < dist) { dist = d; best = e; }
  }
  return best;
}

interface Teams { order: string[]; color: (team: string) => string | undefined }
const byTeam = <T,>(list: T[], teamOf: (x: T) => string, t: Teams) =>
  [...new Set(list.map(teamOf))]
    .sort((a, b) => (t.order.indexOf(a) + 1 || 999) - (t.order.indexOf(b) + 1 || 999) || a.localeCompare(b))
    .map((team) => [team, list.filter((x) => teamOf(x) === team)] as const);

const IND = ' ';        // one em space: an even indent under a heading
const NOOP = (label: string): TinyMenuItem => ({ id: 'noop', label, enabled: false });
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const day = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

/** "until Tue 24 Nov" / "today only" / "½ day" (+ "· pending") */
function whenToday(w: Who, today: string): string {
  const span = w.half ? '½ day' : w.until > today ? `until ${day(w.until)}` : 'today only';
  return w.pending ? `${span} · pending` : span;
}
/** "Mon 23 – Wed 25 Nov" style, for the next-week list */
function whenRange(w: Who): string {
  const r = fmtRange(w.from, w.until);
  return w.pending ? `${r} · pending` : r;
}

const INLINE_MAX = 8; // per section: more than this folds into "+N more"

/** "Mon 23 – Wed 25 Nov, Fri 27 Nov": consecutive weekdays join into one range */
function dayRuns(days: string[]): string {
  const nextWeekday = (d: string) => {
    let t = Date.parse(d + 'T00:00:00Z');
    do t += 86400000; while (new Date(t).getUTCDay() % 6 === 0);
    return new Date(t).toISOString().slice(0, 10);
  };
  const runs: [string, string][] = [];
  for (const d of days) {
    const last = runs[runs.length - 1];
    if (last && nextWeekday(last[1]) === d) last[1] = d; else runs.push([d, d]);
  }
  return runs.map(([a, b]) => fmtRange(a, b)).join(', ');
}
const clashState = (c: WfhConflict) => (c.leaveStatus === 'draft' ? 'leave pending' : 'leave approved');

/** leave applied for on already-approved WFH days: a warning block at the top.
 *  Its rows are clickable (not greyed) so it reads as something to act on. */
function clashSection(list: WfhConflict[]): TinyMenuItem[] {
  if (!list.length) return [];
  const people = new Set(list.map((c) => c.employeeId)).size;
  const out: TinyMenuItem[] = [{ id: 'open:dashboard', label: `⚠️  Leave on approved WFH — ${plural(people, 'person', 'people')}` }];
  for (const c of list.slice(0, INLINE_MAX)) out.push({ id: 'open:dashboard', label: `${IND}${c.person} — ${dayRuns(c.days)} · ${clashState(c)}` });
  if (list.length > INLINE_MAX) out.push({ id: 'open:dashboard', label: `${IND}+${list.length - INLINE_MAX} more…` });
  return [...out, { separator: true }];
}

/** a today section, inline: heading, then people (team rows only when 2+ teams) */
function todaySection(title: string, empty: string, list: Who[], t: Teams, today: string, open: string): TinyMenuItem[] {
  if (!list.length) return [NOOP(empty)];
  const out: TinyMenuItem[] = [NOOP(`${title} · ${list.length}`)];
  const groups = byTeam(list, (p) => p.team, t);
  let shown = 0;
  for (const [team, mine] of groups) {
    if (shown >= INLINE_MAX) break;
    if (groups.length > 1) out.push(NOOP(`${IND}${teamDot(t.color(team))} ${team}`));
    for (const p of mine) {
      if (shown++ >= INLINE_MAX) break;
      out.push({ id: open, label: `${IND}${groups.length > 1 ? IND : ''}${p.person} — ${whenToday(p, today)}` });
    }
  }
  if (list.length > INLINE_MAX) out.push({ id: open, label: `${IND}+${list.length - INLINE_MAX} more…` });
  return out;
}

/** people grouped by team, for a submenu */
function teamList(list: Who[], t: Teams, label: (w: Who) => string, open: string): TinyMenuItem[] {
  const out: TinyMenuItem[] = [];
  for (const [team, mine] of byTeam(list, (p) => p.team, t)) {
    if (out.length) out.push({ separator: true });
    out.push(NOOP(`${teamDot(t.color(team))} ${team} · ${mine.length}`));
    for (const p of mine) out.push({ id: open, label: `${IND}${p.person} — ${label(p)}` });
  }
  return out;
}

/** next week: leave and working from home in one submenu */
function nextWeekMenu(d: Dashboard, t: Teams): TinyMenuItem {
  const leave = people(d.leave.nextWeek.items), wfh = people(d.wfh.nextWeek.items);
  const range = fmtRange(d.nextWeek.from, d.nextWeek.to);
  if (!leave.length && !wfh.length) return NOOP(`Next Week: everyone in`);
  const sub: TinyMenuItem[] = [NOOP(range)];
  if (leave.length) sub.push({ separator: true }, NOOP(`On leave · ${leave.length}`), ...teamList(leave, t, whenRange, 'open:calendar'));
  if (wfh.length) sub.push({ separator: true }, NOOP(`Working from home · ${wfh.length}`), ...teamList(wfh, t, whenRange, 'open:calendar'));
  const bits = [leave.length && `${leave.length} on leave`, wfh.length && `${wfh.length} WFH`].filter(Boolean).join(', ');
  return { id: 'noop', label: `Next Week (${bits})`, submenu: sub };
}

/** the WFH clash block of the copied status (nothing when there are none) */
function clashText(list: WfhConflict[]): string[] {
  if (!list.length) return [];
  const people = new Set(list.map((c) => c.employeeId)).size;
  return [`⚠ Leave on already-approved WFH days — ${plural(people, 'person', 'people')} (next 6 weeks)`,
    ...list.map((c) => `   ◦ ${c.person} (${c.team}) — ${dayRuns(c.days)} · ${clashState(c)}, WFH approved`), ''];
}

/** today's status as plain-text bullets, ready to paste into chat or email:
 *  section → team → person → dates and status (never the leave type) */
function statusText(d: Dashboard, teamOrder: string[]): string {
  const title = new Date(d.today + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const order = (a: string, b: string) => (teamOrder.indexOf(a) + 1 || 999) - (teamOrder.indexOf(b) + 1 || 999) || a.localeCompare(b);
  const block = (heading: string, items: DashItem[], window?: string) => {
    const live = items.filter((i) => i.status !== 'denied');
    const count = new Set(live.map((i) => i.employeeId)).size;
    if (!count) return [`${heading}: nobody`];
    const out = [`${heading} — ${plural(count, 'person', 'people')}`];
    for (const team of [...new Set(live.map((i) => i.team))].sort(order)) {
      const mine = live.filter((i) => i.team === team);
      out.push(`• ${team} (${new Set(mine.map((i) => i.employeeId)).size})`);
      for (const id of [...new Set(mine.sort((x, y) => x.person.localeCompare(y.person) || x.startDate.localeCompare(y.startDate)).map((i) => i.employeeId))]) {
        const reqs = mine.filter((i) => i.employeeId === id);
        const line = (i: DashItem) => [
          fmtRange(i.startDate, i.endDate),
          window ? `${fmtDays(i.days)} ${window}` : i.days === 0.5 ? '½ day' : '',
          i.status === 'draft' ? 'pending approval' : 'approved',
        ].filter(Boolean).join(' · ');
        if (reqs.length === 1) out.push(`   ◦ ${reqs[0].person} — ${line(reqs[0])}`);
        else { out.push(`   ◦ ${reqs[0].person}`); for (const r of reqs) out.push(`       ▪ ${line(r)}`); }
      }
    }
    return out;
  };
  const nw = `next week (${fmtRange(d.nextWeek.from, d.nextWeek.to)})`;
  return [
    `Team status — ${title}`,
    '',
    ...block('On leave today', d.leave.today.items),
    '',
    ...block('Working from home today', d.wfh.today.items),
    '',
    ...clashText(d.wfhConflicts ?? []),
    ...block(`On leave ${nw}`, d.leave.nextWeek.items, 'that week'),
    '',
    ...block(`Working from home ${nw}`, d.wfh.nextWeek.items, 'that week'),
  ].join('\n');
}

const MAX_DRAFTS = 25;

/** upcoming drafts (today → a year out), grouped by team; click one to approve */
function draftsMenu(drafts: LeaveRecord[], t: Teams): TinyMenuItem[] {
  if (!drafts.length) return [];
  const items: TinyMenuItem[] = [NOOP('Click one to review and approve')];
  let shown = 0;
  for (const [team, mine] of byTeam(drafts, (r) => r.team, t)) {
    if (shown >= MAX_DRAFTS) break;
    items.push({ separator: true }, NOOP(`${teamDot(t.color(team))} ${team} · ${mine.length}`));
    for (const r of mine) {
      if (shown++ >= MAX_DRAFTS) break;
      items.push({ id: 'approve:' + r.id, label: `${IND}${r.person} — ${fmtRange(r.startDate, r.endDate)} · ${fmtDays(r.days)}` });
    }
  }
  if (drafts.length > MAX_DRAFTS) items.push({ separator: true }, { id: 'open:list', label: `All ${drafts.length} in the List…` });
  return [{ id: 'noop', label: `Approve Leave (${drafts.length})…`, submenu: items }];
}

/** every board, in the window's groups (the same list the window's nav uses) */
function goTo(groups: ViewGroup[]): TinyMenuItem[] {
  const out: TinyMenuItem[] = [];
  for (const g of groups) {
    if (out.length) out.push({ separator: true });
    out.push(NOOP(g.title), ...g.views.map((v) => ({ id: 'open:' + v.id, label: `${IND}${v.label}` })));
  }
  return out;
}

function menu(d: Dashboard | null, status: Status, drafts: LeaveRecord[], groups: ViewGroup[]): TinyMenuItem[] {
  const colors = new Map(status.teams.map((x) => [x.name.toLowerCase(), x.color]));
  const t: Teams = { order: status.teams.map((x) => x.name), color: (team) => colors.get(team.toLowerCase()) };
  const synced = status.lastSyncAt
    ? `Last synced ${new Date(status.lastSyncAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}${new Date(status.lastSyncAt).toDateString() === new Date().toDateString() ? '' : ` · ${day(status.lastSyncAt.slice(0, 10))}`}`
    : 'Not synced yet';
  let head: TinyMenuItem[] = [];
  if (d) {
    const out = people(d.leave.today.items), wfh = people(d.wfh.today.items);
    const summary = !out.length && !wfh.length ? 'everyone is in'
      : [out.length && `${out.length} on leave`, wfh.length && `${wfh.length} working from home`].filter(Boolean).join(' · ');
    head = [
      NOOP(`${day(d.today)} — ${summary}`),
      { separator: true },
      ...clashSection(d.wfhConflicts ?? []),
      ...todaySection('On Leave Today', 'Nobody on leave today', out, t, d.today, 'open:dashboard'),
      { separator: true },
      ...todaySection('Working From Home Today', 'Nobody working from home today', wfh, t, d.today, 'open:dashboard'),
      { separator: true },
      nextWeekMenu(d, t),
      ...draftsMenu(drafts, t),
      { id: 'copy', label: 'Copy Today’s Status' },
      { separator: true },
    ];
  }
  return [
    ...head,
    { id: 'open:dashboard', label: 'Open Capacity Radar' },
    ...(groups.length ? [{ id: 'noop', label: 'Go To', submenu: goTo(groups) }] : []),
    { separator: true },
    { id: 'sync', label: status.syncing ? 'Syncing…' : 'Sync Now', enabled: status.configured && !status.syncing },
    NOOP(status.syncing ? 'Fetching from BambooHR…' : synced),
    { id: 'settings', label: 'Settings…', enabled: status.configured },
  ];
}

export function useTray(status: Status | null, dataVersion: number, actions: TrayActions, groups: ViewGroup[] = []) {
  const act = useRef(actions);
  useEffect(() => { act.current = actions; });
  const text = useRef('');
  const drafts = useRef<LeaveRecord[]>([]);

  // clicks: bring the window forward, then act
  useEffect(() => {
    const off = tiny.tray.on((id) => {
      if (id === 'noop') return;
      if (id === 'copy') {
        if (!text.current) return;
        void tiny.clipboard.write({ text: text.current })
          .then(() => tiny.notify('Copied today’s status', 'Paste it into chat or email.'))
          .catch(() => { /* clipboard unavailable */ });
        return;
      }
      if (id.startsWith('approve:')) {
        const r = drafts.current.find((x) => x.id === id.slice(8));
        if (r) void tiny.win.show().then(() => approveLeave(r, { notify: true }));
        return;
      }
      void tiny.win.show();
      if (id.startsWith('open:')) setState({ view: id.slice(5) as View });
      else if (id === 'sync') act.current.sync();
      else if (id === 'settings') act.current.settings();
    });
    return () => { off(); void tiny.tray.remove(); };
  }, []);

  // title + menu: today's numbers for the selected teams
  const configured = !!status?.configured;
  useEffect(() => {
    if (!status) return;
    let stale = false;
    const today = new Date().toLocaleDateString('en-CA'); // local YYYY-MM-DD
    const base = defaultFilters(today);
    const load = configured
      ? Promise.all([
        api.getDashboard(base).catch(() => null),
        api.getLeave({ ...base, preset: 'custom', to: addDays(today, 365), statuses: ['draft'] }, { key: 'startDate', dir: 'asc' }).catch(() => []),
      ])
      : Promise.resolve([null, []] as const);
    void load.then(([d, dr]) => {
      if (stale) return;
      drafts.current = dr.filter((r) => r.status === 'draft');
      text.current = d ? statusText(d, status.teams.map((t) => t.name)) : '';
      const out = d ? people(d.leave.today.items).length : 0;
      const wfh = d ? people(d.wfh.today.items).length : 0;
      const clashes = d?.wfhConflicts?.length ?? 0;
      void tiny.tray.set({
        icon: trayIcon(),
        title: d ? `${out} out${clashes ? ' ⚠' : ''}` : '',
        tooltip: d ? `Capacity Radar — ${out} on leave, ${wfh} working from home today${clashes ? ` · ${clashes} leave ${clashes === 1 ? 'request' : 'requests'} on approved WFH days` : ''}` : 'Capacity Radar',
        menu: menu(d, status, drafts.current, groups),
      }).catch(() => { /* no tray on this desktop */ });
    });
    return () => { stale = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configured, dataVersion, status?.syncing, status?.selected, status?.teams, status?.lastSyncAt]);
}
