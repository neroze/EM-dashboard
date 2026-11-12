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
import { createDemoClient, demoSquads } from '../bamboo/demo.ts';
import { expandDays, mapEmployees, mapHolidays, mapRequest, mapTypes, requestDates } from '../bamboo/mappers.ts';
import { loadLocalHolidays, loadSprints, loadSquads } from '../config.ts';
import * as repo from '../db/repo.ts';
import { addMonths, minDate, today } from '../domain/dates.ts';
import type { Holiday, LeaveDayRow, LeaveRequestRow } from '../domain/types.ts';
import { getCredentials } from '../secrets.ts';
import { markScope } from './orgTree.ts';

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

export async function clientFor(app: TinyApp): Promise<{ client: BambooClient; demo: boolean } | null> {
  if (repo.getSetting('demo', false)) return { client: createDemoClient(), demo: true };
  const creds = await getCredentials(app);
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

async function doSync(app: TinyApp, full: boolean) {
  const t0 = Date.now();
  const at = new Date().toISOString();
  lastRunAt = at;
  const c = await clientFor(app);
  if (!c) { lastError = 'Not set up'; return; }
  const { client, demo } = c;
  try {
    const now = Date.now();
    const t = today();
    // from 1 January (the dashboard's year summary) or 3 months back, whichever is earlier
    const from = minDate(addMonths(t, -3), t.slice(0, 4) + '-01-01'), to = addMonths(t, 12);

    // 2. employees + org tree (daily, or when forced/empty)
    const empAge = now - repo.getSetting('employeesSyncedAt', 0);
    if (full || empAge > DAILY_MS || repo.counts().people === 0) {
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
      const map = demo ? { ...demoSquads(), ...squads.map } : squads.map;
      const emps = markScope(mapEmployees(raw, t), myId).map((e) => ({ ...e, team: map[e.id] ?? null }));
      repo.replaceEmployees(emps);
      repo.setSetting('myEmployeeId', myId);
      repo.setSetting('employeesSyncedAt', now);
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
    const scoped = new Map(repo.allEmployees().filter((e) => e.inScope).map((e) => [e.id, e.location ?? '']));
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
    repo.replaceRequests(rows, days, from, to, from);
    lastError = null;
    repo.logSync(at, true, rows.length, null, Date.now() - t0);
  } catch (e: any) {
    lastError = String(e?.message ?? e);
    try { repo.logSync(at, false, 0, lastError, Date.now() - t0); } catch { /* db gone (sign out) */ }
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
