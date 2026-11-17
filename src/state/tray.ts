// Menu bar (tray) item: "N out" at a glance, with today's people grouped by
// team in its menu plus quick actions. It follows the selected teams (the
// whole team, not the panel's person filters) and refreshes after each sync.
import { useEffect, useRef } from 'react';
import { api } from '../api.ts';
import { approveLeave } from '../approve.ts';
import type { Dashboard, DashItem, LeaveRecord, Status } from '../types.ts';
import { fmtDays, fmtRange } from '../format.ts';
import { addDays } from '../../backend/domain/dates.ts';
import { defaultFilters, setState, type View } from './filters.ts';

export interface TrayActions {
  sync: () => void;
  settings: () => void;
}

const MAX_NAMES = 15;

function trayIcon(): string | undefined {
  if (tiny.system.isMacOS()) return 'sf:calendar.badge.clock';
  if (tiny.system.isWindows()) return 'emoji:🌴';
  return undefined; // Linux: the app icon
}

/** one line per person (a person with two requests today shows once) */
function people(items: DashItem[]) {
  const by = new Map<string, { person: string; team: string; draft: boolean; type: string }>();
  for (const i of items) {
    if (i.status === 'denied') continue;
    const cur = by.get(i.employeeId);
    if (cur) { cur.draft = cur.draft && i.status === 'draft'; continue; }
    by.set(i.employeeId, { person: i.person, team: i.team, draft: i.status === 'draft', type: i.typeName });
  }
  return [...by.values()];
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
const teamHead = (team: string, n: number, t: Teams): TinyMenuItem =>
  ({ id: 'noop', label: `${teamDot(t.color(team))}  ${team} · ${n}`, enabled: false });

/** a heading, then per team: "🔵 SOC · 2" and that team's people under it */
function section(title: string, list: ReturnType<typeof people>, t: Teams): TinyMenuItem[] {
  if (!list.length) return [{ id: 'noop', label: `${title}: nobody`, enabled: false }];
  const out: TinyMenuItem[] = [{ id: 'noop', label: `${title} — ${list.length}`, enabled: false }];
  let shown = 0;
  for (const [team, mine] of byTeam(list, (p) => p.team, t)) {
    if (shown >= MAX_NAMES) break;
    out.push(teamHead(team, mine.length, t));
    for (const p of [...mine].sort((a, b) => a.person.localeCompare(b.person))) {
      if (shown++ >= MAX_NAMES) break;
      out.push({ id: 'open:dashboard', label: `      ${p.person} — ${p.type}${p.draft ? ' (draft)' : ''}` });
    }
  }
  if (list.length > MAX_NAMES) out.push({ id: 'open:dashboard', label: `      … ${list.length - MAX_NAMES} more` });
  return out;
}

/** next week's leave as a submenu: per team, each person with type + dates */
function nextWeekMenu(d: Dashboard, t: Teams): TinyMenuItem[] {
  const items = d.leave.nextWeek.items.filter((i) => i.status !== 'denied');
  const count = new Set(items.map((i) => i.employeeId)).size;
  if (!count) return [{ id: 'noop', label: 'Leave next week: nobody', enabled: false }];
  const sub: TinyMenuItem[] = [];
  for (const [team, mine] of byTeam(items, (i) => i.team, t)) {
    if (sub.length) sub.push({ separator: true });
    sub.push(teamHead(team, new Set(mine.map((i) => i.employeeId)).size, t));
    for (const i of [...mine].sort((a, b) => a.person.localeCompare(b.person) || a.startDate.localeCompare(b.startDate))) {
      sub.push({ id: 'open:calendar', label: `      ${i.person} — ${i.typeName} · ${fmtRange(i.startDate, i.endDate)}${i.status === 'draft' ? ' (draft)' : ''}` });
    }
  }
  return [{ id: 'noop', label: `Leave next week — ${count} ${count === 1 ? 'person' : 'people'}`, submenu: sub }];
}

/** today's status as plain-text bullets, ready to paste into chat or email:
 *  section → team → person → each request with type, dates and status */
function statusText(d: Dashboard, teamOrder: string[]): string {
  const day = new Date(d.today + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const order = (a: string, b: string) => (teamOrder.indexOf(a) + 1 || 999) - (teamOrder.indexOf(b) + 1 || 999) || a.localeCompare(b);
  const block = (title: string, items: DashItem[], window?: string) => {
    const live = items.filter((i) => i.status !== 'denied');
    const count = new Set(live.map((i) => i.employeeId)).size;
    if (!count) return [`${title}: nobody`];
    const out = [`${title} — ${count} ${count === 1 ? 'person' : 'people'}`];
    for (const team of [...new Set(live.map((i) => i.team))].sort(order)) {
      const mine = live.filter((i) => i.team === team);
      out.push(`• ${team} (${new Set(mine.map((i) => i.employeeId)).size})`);
      for (const id of [...new Set(mine.sort((x, y) => x.person.localeCompare(y.person) || x.startDate.localeCompare(y.startDate)).map((i) => i.employeeId))]) {
        const reqs = mine.filter((i) => i.employeeId === id);
        const line = (i: DashItem) => [
          i.typeName,
          fmtRange(i.startDate, i.endDate),
          window ? `${fmtDays(i.days)} ${window}` : i.days === 0.5 ? '½ day' : '',
          i.status === 'draft' ? 'draft — awaiting approval' : 'approved',
        ].filter(Boolean).join(' · ');
        if (reqs.length === 1) out.push(`   ◦ ${reqs[0].person} — ${line(reqs[0])}`);
        else { out.push(`   ◦ ${reqs[0].person}`); for (const r of reqs) out.push(`       ▪ ${line(r)}`); }
      }
    }
    return out;
  };
  const nw = `next week (${fmtRange(d.nextWeek.from, d.nextWeek.to)})`;
  return [
    `Team status — ${day}`,
    '',
    ...block('On leave today', d.leave.today.items),
    '',
    ...block('Working from home today', d.wfh.today.items),
    '',
    ...block(`On leave ${nw}`, d.leave.nextWeek.items, 'that week'),
    '',
    ...block(`Working from home ${nw}`, d.wfh.nextWeek.items, 'that week'),
  ].join('\n');
}

const MAX_DRAFTS = 25;

/** upcoming drafts (today → a year out), grouped by team, each one approvable */
function draftsMenu(drafts: LeaveRecord[], t: Teams): TinyMenuItem[] {
  if (!drafts.length) return [{ id: 'noop', label: 'No drafts to approve', enabled: false }];
  const items: TinyMenuItem[] = [];
  let shown = 0;
  for (const [team, mine] of byTeam(drafts, (r) => r.team, t)) {
    if (shown >= MAX_DRAFTS) break;
    if (items.length) items.push({ separator: true });
    items.push(teamHead(team, mine.length, t));
    for (const r of mine) {
      if (shown++ >= MAX_DRAFTS) break;
      items.push({ id: 'approve:' + r.id, label: `      ${r.person} — ${r.typeName} · ${fmtRange(r.startDate, r.endDate)} · ${fmtDays(r.days)}` });
    }
  }
  if (drafts.length > MAX_DRAFTS) items.push({ separator: true }, { id: 'open:list', label: `All ${drafts.length} drafts in the List…` });
  return [{ id: 'noop', label: `Approve Drafts (${drafts.length})`, submenu: items }];
}

function menu(d: Dashboard | null, status: Status, drafts: LeaveRecord[]): TinyMenuItem[] {
  const colors = new Map(status.teams.map((x) => [x.name.toLowerCase(), x.color]));
  const t: Teams = { order: status.teams.map((x) => x.name), color: (team) => colors.get(team.toLowerCase()) };
  const head: TinyMenuItem[] = d
    ? [...section('On leave today', people(d.leave.today.items), t),
      { separator: true },
      ...section('Working from home today', people(d.wfh.today.items), t),
      { separator: true },
      ...nextWeekMenu(d, t),
      ...draftsMenu(drafts, t),
      { id: 'copy', label: "Copy Today's Status" },
      { separator: true }]
    : [];
  return [
    ...head,
    { id: 'open:dashboard', label: 'Open Dashboard' },
    { id: 'open:calendar', label: 'Open Calendar' },
    { id: 'open:capacity', label: 'Open Capacity' },
    { separator: true },
    { id: 'sync', label: status.syncing ? 'Syncing…' : 'Sync Now', enabled: status.configured && !status.syncing },
    { id: 'settings', label: 'Settings…', enabled: status.configured },
  ];
}

export function useTray(status: Status | null, dataVersion: number, actions: TrayActions) {
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
      void tiny.tray.set({
        icon: trayIcon(),
        title: d ? `${out} out` : '',
        tooltip: d ? `Capacity Radar — ${out} on leave, ${wfh} working from home today` : 'Capacity Radar',
        menu: menu(d, status, drafts.current),
      }).catch(() => { /* no tray on this desktop */ });
    });
    return () => { stale = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configured, dataVersion, status?.syncing, status?.selected, status?.teams, status?.lastSyncAt]);
}
