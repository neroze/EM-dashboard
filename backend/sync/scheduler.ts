// Sync: on launch and every 15 minutes while the app is open; never two at
// once. A failed sync keeps the previous data and records lastError.
//
//  1. key from Keychain (missing -> the UI shows setup)
//  2. employees -> reports-to tree -> in_scope for my ACTIVE subtree (daily)
//  3. leave types                                                  (daily)
//     holidays from Who's Out                                       (daily)
//  4. requests for today−3 months … today+12 months, scoped to my subtree
//  5. upsert in one transaction; drop requests BambooHR no longer returns
//  6. expand into leave_day rows, skipping weekends + location holidays
//  7. sync_log row
import { createClient, type BambooClient } from '../bamboo/client.ts';
import { createDemoClient, demoRootFor } from '../bamboo/demo.ts';
import { expandDays, mapEmployees, mapHolidays, mapRequest, mapTypes, requestDates } from '../bamboo/mappers.ts';
import { loadLocalHolidays, loadSprints, loadSquads } from '../config.ts';
import * as repo from '../db/repo.ts';
import { addMonths, minDate, today } from '../domain/dates.ts';
import type { Holiday, LeaveDayRow, LeaveRequestRow } from '../domain/types.ts';
import { getCredentials } from '../secrets.ts';
import { markScope } from './orgTree.ts';
import * as T from '../teams.ts';

export const SYNC_EVERY_MS = 15 * 60_000;
const DAILY_MS = 24 * 3600_000;
// status + terminationDate: the custom report also returns people who have
// left (onlyCurrent is about field history, not employment), so we filter.
const REPORT_FIELDS = ['id', 'displayName', 'firstName', 'lastName', 'location', 'supervisorEId', 'supervisorId', 'status', 'terminationDate'];

let running: Promise<void> | null = null;
let timer: any = null;
let lastError: string | null = null;
let lastRunAt: string | null = null;

export const syncState = () => ({ syncing: running !== null, lastError, lastRunAt });

/** per-team setting (the "default" team keeps the original key names) */
export const teamSetting = <V>(team: string, key: string, fallback: V): V => repo.getSetting<V>(T.teamKey(team, key), fallback);
export const setTeamSetting = (team: string, key: string, value: unknown) => repo.setSetting(T.teamKey(team, key), value);

/** BambooHR client for one team (its own key), or the demo client */
export async function clientFor(app: TinyApp, team = T.primaryTeam().id): Promise<{ client: BambooClient; demo: boolean; demoRoot?: string } | null> {
  if (teamSetting(team, 'demo', false)) {
    const demoTeams = T.teams().filter((t) => teamSetting(t.id, 'demo', false)).map((t) => t.id);
    const root = demoRootFor(demoTeams.indexOf(team), demoTeams.length);
    return { client: createDemoClient(root), demo: true, demoRoot: root };
  }
  const creds = await getCredentials(app, team);
  return creds ? { client: createClient(creds.companyDomain, creds.apiKey), demo: false } : null;
}

export function resetSyncState() { lastError = null; lastRunAt = null; }

/** runs a sync, or joins the one already running */
export function syncNow(app: TinyApp, opts: { full?: boolean } = {}): Promise<void> {
  if (running) return running;
  running = doSync(app, !!opts.full).finally(() => {
    running = null;
    app.push('status-changed');
  });
  app.push('status-changed');
  return running;
}

/** sync every selected team in turn, each with its own key */
async function doSync(app: TinyApp, full: boolean) {
  lastRunAt = new Date().toISOString();
  const errors: string[] = [];
  let any = false;
  for (const team of T.selectedTeams()) {
    const c = await clientFor(app, team.id);
    if (!c) continue; // a team without a key yet
    any = true;
    const err = await syncTeam(team, c.client, c.demo, full, c.demoRoot);
    if (err) errors.push(T.selectedTeams().length > 1 ? `${team.name}: ${err}` : err);
  }
  repo.applyScope(T.selectedIds());
  lastError = !any ? 'Not set up' : errors.length ? errors.join(' · ') : null;
}

async function syncTeam(team: T.Team, client: BambooClient, demo: boolean, full: boolean, demoRoot?: string): Promise<string | null> {
  const t0 = Date.now();
  const at = new Date().toISOString();
  try {
    const now = Date.now();
    const t = today();
    // from 1 January (the dashboard's year summary) or 3 months back, whichever is earlier
    const from = minDate(addMonths(t, -3), t.slice(0, 4) + '-01-01'), to = addMonths(t, 12);

    // 2. employees + org tree (daily, or when forced/empty)
    const empAge = now - teamSetting(team.id, 'employeesSyncedAt', 0);
    // a demo team's reporting line can change (another demo team added/removed)
    const rootChanged = demo && teamSetting(team.id, 'demoRoot', '') !== demoRoot;
    if (full || rootChanged || empAge > DAILY_MS || repo.teamMembers(team.id).length === 0) {
      const me = await client.get('employees/0', { fields: 'id' });
      const myId = String(me?.id ?? '');
      if (!myId) throw new Error('BambooHR did not return your employee id');
      let raw: any;
      try {
        raw = await client.post('reports/custom', { title: 'Leave Radar', fields: REPORT_FIELDS }, { format: 'JSON', onlyCurrent: 'true' });
      } catch {
        raw = await client.get('employees/directory'); // no manager ids here: scoping may come up empty (verify)
      }
      const squads = await loadSquads();
      const map = T.withoutTeamNames(squads.map); // extra-squad overrides only; otherwise the team's name
      const emps = markScope(mapEmployees(raw, t), myId).map((e) => ({ ...e, team: map[e.id] ?? null }));
      repo.replaceTeamEmployees(team.id, emps);
      setTeamSetting(team.id, 'myEmployeeId', myId);
      setTeamSetting(team.id, 'employeesSyncedAt', now);
      if (demo) setTeamSetting(team.id, 'demoRoot', demoRoot);
    }

    // 3. types + holidays (daily)
    const metaAge = now - repo.getSetting('metaSyncedAt', 0);
    if (full || metaAge > DAILY_MS) {
      repo.replaceTypes(mapTypes(await client.get('meta/time_off/types')));
      const whosOut = await client.get('time_off/whos_out', { start: from, end: to });
      const local = await loadLocalHolidays();
      repo.replaceHolidays([...mapHolidays(whosOut), ...local.filter((h) => h.day >= from && h.day <= to)], from, to);
      repo.setSetting('metaSyncedAt', now);
    }
    repo.replaceSprints(await loadSprints());

    // 4–6. requests in the window, scoped, expanded to days
    const raw = await client.get('time_off/requests', {
      start: from, end: to, status: 'approved,requested,denied,canceled,superceded',
    });
    const scoped = new Map(repo.teamMembers(team.id).map((e) => [e.id, e.location]));
    const hol = holidayIndex(repo.holidays(from, to));
    const hoursPerDay = repo.getSetting('hoursPerDay', 8);
    const rows: LeaveRequestRow[] = [];
    const days: LeaveDayRow[] = [];
    for (const r of Array.isArray(raw) ? raw : []) {
      const row = mapRequest(r, at);
      if (!row || !scoped.has(row.employeeId)) continue; // out of my reporting line: dropped
      rows.push(row);
      const loc = scoped.get(row.employeeId)!;
      days.push(...expandDays(row, requestDates(r), (d) => hol(d, loc), hoursPerDay));
    }
    repo.replaceRequests(rows, days, from, to, from, team.id);
    repo.logSync(at, true, rows.length, null, Date.now() - t0);
    return null;
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    try { repo.logSync(at, false, 0, `${team.name}: ${msg}`, Date.now() - t0); } catch { /* db gone */ }
    return msg;
  }
}

export function holidayIndex(list: Holiday[]): (day: string, location: string) => boolean {
  const set = new Set(list.map((h) => `${h.day}|${h.location}`));
  return (day, loc) => set.has(`${day}|*`) || set.has(`${day}|${loc}`);
}

export function startLoop(app: TinyApp, opts: { immediate?: boolean } = {}) {
  stopLoop();
  if (opts.immediate !== false) void syncNow(app);
  timer = setInterval(() => void syncNow(app), SYNC_EVERY_MS);
}
export function stopLoop() {
  if (timer) clearInterval(timer);
  timer = null;
}
/** wait out an in-flight sync (sign-out must not race it) */
export async function settle() { try { await running; } catch { /* logged already */ } }
