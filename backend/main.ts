// Leave Radar backend — owns BambooHR access, the SQLite cache and the
// Keychain. The UI calls these through tiny.api.call(name, args); everything
// except setup / syncNow / sendDigest reads the local cache only.
import { BambooError, cleanDomain, createClient } from './bamboo/client.ts';
import { dataPath, initConfig, loadSquads, saveSquads } from './config.ts';
import * as repo from './db/repo.ts';
import { today } from './domain/dates.ts';
import { toCsv, toXlsx } from './domain/export.ts';
import { latestSnapshot, resourceHistory, startSampling, stopSampling } from './domain/resources.ts';
import { sortRecords, type Sort } from './domain/sort.ts';
import type { Filters } from './domain/types.ts';
import * as Q from './queries.ts';
import { clearAll, getCredentials, getSlackWebhook, setCredentials, setSlackWebhook } from './secrets.ts';
import { clientFor, resetSyncState, settle, startLoop, stopLoop, syncNow, syncState } from './sync/scheduler.ts';

const DB_FILE = 'leave-radar.sqlite';
let ready: Promise<void> | null = null;

const whenReady = () => ready ?? Promise.reject(new Error('backend not initialised'));

type DigestSetting = { enabled: boolean; weekday: number; hour: number; lastSent: string | null };
const DIGEST_DEFAULT: DigestSetting = { enabled: false, weekday: 1, hour: 9, lastSent: null };

async function isConfigured(app: TinyApp) {
  return repo.getSetting('demo', false) || !!(await getCredentials(app));
}

async function status(app: TinyApp) {
  const last = repo.lastSync();
  const good = repo.lastGoodSync();
  const s = syncState();
  const c = repo.counts();
  return {
    configured: await isConfigured(app),
    demo: repo.getSetting('demo', false),
    companyDomain: repo.getSetting<string>('companyDomain', ''),
    syncing: s.syncing,
    lastSyncAt: good?.at ?? null,
    lastAttemptAt: last?.at ?? null,
    lastDurationMs: good?.duration_ms ?? null,
    lastRecords: good?.records ?? null,
    lastError: last && !last.ok ? last.error : null,
    recordCount: c.requests,
    peopleCount: c.people,
    myEmployeeId: repo.getSetting<string | null>('myEmployeeId', null),
  };
}

async function writeExport(path: string, filters: Partial<Filters>, sort: Sort | undefined, format: 'csv' | 'xlsx') {
  if (typeof path !== 'string' || !path.startsWith('/')) throw new Error('Choose where to save the file.');
  const rows = sortRecords(Q.leave(filters), sort);
  const bytes = format === 'xlsx' ? toXlsx(rows) : new TextEncoder().encode(toCsv(rows));
  await tjs.writeFile(path, bytes);
  return { path, rows: rows.length };
}

async function deleteCacheFiles() {
  for (const suffix of ['', '-wal', '-shm']) {
    try { await tjs.remove(dataPath(DB_FILE + suffix)); } catch { /* not there */ }
  }
}

async function postSlack(app: TinyApp, text: string) {
  const hook = await getSlackWebhook(app);
  if (!hook) throw new Error('Add a Slack incoming-webhook URL in Settings first.');
  const res = await fetch(hook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
  if (!res.ok) throw new Error(`Slack returned ${res.status}`);
}

async function settings(app: TinyApp) {
  const squads = await loadSquads();
  return {
    defaultThreshold: repo.getSetting('defaultThreshold', Q.DEFAULT_THRESHOLD),
    thresholds: repo.getSetting<Record<string, number>>('thresholds', {}),
    linkTemplate: repo.getSetting('linkTemplate', Q.DEFAULT_LINK),
    hoursPerDay: repo.getSetting('hoursPerDay', 8),
    squads: squads.squads.length ? squads.squads : ['SOC Workflow', 'Data Platform'],
    squadMap: squads.map,
    people: repo.allEmployees().filter((e) => e.inScope).map((e) => ({ id: e.id, name: e.displayName, team: e.team })),
    digest: repo.getSetting<DigestSetting>('digest', DIGEST_DEFAULT),
    hasSlackWebhook: !!(await getSlackWebhook(app)),
  };
}

export const api: Record<string, TinyApiHandler> = {
  // ---- setup / status / sync ----------------------------------------------
  setup: async ({ companyDomain, apiKey }: { companyDomain: string; apiKey: string }, app) => {
    await whenReady();
    const domain = cleanDomain(companyDomain);
    const key = String(apiKey || '').trim();
    if (key.length < 10) throw new Error('That does not look like a BambooHR API key.');
    let me: any;
    try {
      me = await createClient(domain, key).get('employees/0', { fields: 'id,displayName' });
    } catch (e) {
      throw new Error(e instanceof BambooError ? e.message : 'Could not reach BambooHR.');
    }
    const myEmployeeId = String(me?.id ?? '');
    if (!myEmployeeId) throw new Error('BambooHR accepted the key but returned no employee for it.');
    stopLoop();
    await settle();
    await setCredentials(app, domain, key);
    if (repo.getSetting('demo', false)) repo.wipeCache();
    repo.setSetting('demo', false);
    repo.setSetting('companyDomain', domain);
    repo.setSetting('myEmployeeId', myEmployeeId);
    resetSyncState();
    startLoop(app);
    return { ok: true, myEmployeeId };
  },

  setupDemo: async (_: unknown, app) => {
    await whenReady();
    stopLoop();
    await settle();
    repo.wipeCache();
    repo.setSetting('demo', true);
    repo.setSetting('companyDomain', 'demo');
    resetSyncState();
    await syncNow(app, { full: true });
    startLoop(app, { immediate: false });
    return status(app);
  },

  getStatus: async (_: unknown, app) => { await whenReady(); return status(app); },

  syncNow: async (_: unknown, app) => {
    await whenReady();
    await syncNow(app, { full: true });
    return status(app);
  },

  getSyncLog: async () => { await whenReady(); return repo.syncLog(20); },

  // ---- reads (SQLite only) ----------------------------------------------------
  getLeave: async ({ filters, sort }: { filters: Partial<Filters>; sort?: Sort }) => {
    await whenReady();
    return sortRecords(Q.leave(filters), sort);
  },
  getCalendar: async ({ filters }: { filters: Partial<Filters> }) => { await whenReady(); return Q.calendar(filters); },
  getCapacity: async ({ filters, sprintId }: { filters: Partial<Filters>; sprintId?: string | null }) => {
    await whenReady();
    return Q.capacity(filters, sprintId);
  },
  getOverlaps: async ({ filters, threshold }: { filters: Partial<Filters>; threshold?: number }) => {
    await whenReady();
    return Q.overlaps(filters, threshold);
  },
  getDashboard: async ({ filters }: { filters: Partial<Filters> }) => { await whenReady(); return Q.dashboard(filters); },
  getYearSummary: async ({ filters, year }: { filters: Partial<Filters>; year: number }) => { await whenReady(); return Q.year(filters, Number(year)); },
  getLongLeave: async ({ filters, year }: { filters: Partial<Filters>; year: number }) => { await whenReady(); return Q.longLeave(filters, Number(year)); },
  // ---- writes to BambooHR (the only ones) -----------------------------------
  /** approve one draft (requested) leave request. Only for people in my
   *  reporting line, only from "requested"; BambooHR itself decides whether
   *  this account may approve it. */
  approveRequest: async ({ id }: { id: string }, app) => {
    await whenReady();
    const req = repo.requestById(String(id ?? ''));
    if (!req || !req.inScope) throw new Error('That request is not in your team’s leave.');
    if (req.bambooStatus !== 'requested') throw new Error('Only draft (requested) leave can be approved — this one is already ' + req.bambooStatus + '.');
    const c = await clientFor(app);
    if (!c) throw new Error('Not signed in to BambooHR.');
    try {
      await c.client.put(`time_off/requests/${encodeURIComponent(req.id)}/status`, { status: 'approved' });
    } catch (e) {
      const st = e instanceof BambooError ? e.status : 0;
      throw new Error(
        st === 403 ? 'BambooHR refused: your account can’t approve this request (only its approver can).'
          : st === 404 ? 'BambooHR no longer has this request — it may have been cancelled. Refresh to update.'
          : st === 400 || st === 409 ? 'BambooHR wouldn’t change it — it may already be approved or cancelled. Refresh to update.'
          : e instanceof Error ? e.message : 'Could not reach BambooHR.');
    }
    repo.setRequestStatus(req.id, 'approved');
    app.push('data-changed');
    return { ok: true };
  },

  getSummary: async ({ filters }: { filters: Partial<Filters> }) => { await whenReady(); return Q.summary(filters); },
  getLookups: async () => { await whenReady(); return { ...Q.lookups(), today: today() }; },

  // ---- saved views --------------------------------------------------------------
  listViews: async () => { await whenReady(); return repo.listViews(); },
  saveView: async ({ name, filters }: { name: string; filters: unknown }, app) => {
    await whenReady();
    const n = String(name || '').trim().slice(0, 80);
    if (!n) throw new Error('Give the view a name.');
    repo.saveView(n, filters ?? {});
    app.push('views-changed');
    return repo.listViews();
  },
  deleteView: async ({ name }: { name: string }, app) => {
    await whenReady();
    repo.deleteView(String(name));
    app.push('views-changed');
    return repo.listViews();
  },

  // ---- export (the page picks the path with the native save dialog) -----------
  exportCsv: async ({ filters, sort, path }: { filters: Partial<Filters>; sort?: Sort; path: string }) => {
    await whenReady();
    return writeExport(path, filters, sort, 'csv');
  },
  exportXlsx: async ({ filters, sort, path }: { filters: Partial<Filters>; sort?: Sort; path: string }) => {
    await whenReady();
    return writeExport(path, filters, sort, 'xlsx');
  },

  // ---- settings ---------------------------------------------------------------
  getSettings: async (_: unknown, app) => { await whenReady(); return settings(app); },
  saveSettings: async (s: any, app) => {
    await whenReady();
    const frac = (v: unknown) => { const n = Number(v); return n > 0 && n <= 1 ? n : null; };
    if (s.defaultThreshold !== undefined && frac(s.defaultThreshold)) repo.setSetting('defaultThreshold', frac(s.defaultThreshold));
    if (s.thresholds && typeof s.thresholds === 'object') {
      const t: Record<string, number> = {};
      for (const [k, v] of Object.entries(s.thresholds)) if (frac(v)) t[k] = frac(v)!;
      repo.setSetting('thresholds', t);
    }
    if (typeof s.linkTemplate === 'string' && /^https:\/\//.test(s.linkTemplate)) repo.setSetting('linkTemplate', s.linkTemplate);
    if (s.hoursPerDay !== undefined && Number(s.hoursPerDay) > 0 && Number(s.hoursPerDay) <= 24) repo.setSetting('hoursPerDay', Number(s.hoursPerDay));
    if (s.digest && typeof s.digest === 'object') {
      const cur = repo.getSetting<DigestSetting>('digest', DIGEST_DEFAULT);
      repo.setSetting('digest', {
        ...cur, enabled: !!s.digest.enabled,
        weekday: Math.max(0, Math.min(6, Number(s.digest.weekday ?? cur.weekday) | 0)),
        hour: Math.max(0, Math.min(23, Number(s.digest.hour ?? cur.hour) | 0)),
      });
    }
    if (s.slackWebhook !== undefined) {
      const url = String(s.slackWebhook || '').trim();
      if (url && !/^https:\/\/hooks\.slack\.com\//.test(url)) throw new Error('Slack webhook URLs start with https://hooks.slack.com/');
      await setSlackWebhook(app, url || null);
    }
    if (s.squadMap && typeof s.squadMap === 'object') {
      const map: Record<string, string> = {};
      for (const [id, team] of Object.entries(s.squadMap)) if (typeof team === 'string' && team) map[id] = team;
      const squads = Array.isArray(s.squads) ? s.squads.map(String).filter(Boolean) : [...new Set(Object.values(map))];
      await saveSquads(map, squads);
      repo.applySquads(map);
    }
    app.push('data-changed');
    return settings(app);
  },

  // ---- weekly digest -------------------------------------------------------------
  getDigest: async () => { await whenReady(); return Q.digest(); },
  sendDigest: async (_: unknown, app) => {
    await whenReady();
    await postSlack(app, Q.digest().text);
    repo.setSetting('digest', { ...repo.getSetting<DigestSetting>('digest', DIGEST_DEFAULT), lastSent: today() });
    return { ok: true };
  },

  // ---- resource panel (sampling runs only while it is open) ----------------------
  resourcesOpen: async (_: unknown, app) => {
    startSampling((s) => app.push('resources', s));
    return true;
  },
  resourcesClose: async () => { stopSampling(); return true; },
  getResourceUsage: async () => {
    await whenReady();
    let dbSizeMb = 0;
    for (const suffix of ['', '-wal']) {
      try { dbSizeMb += Number((await tjs.stat(dataPath(DB_FILE + suffix))).size) / 1048576; } catch { /* none */ }
    }
    const good = repo.lastGoodSync();
    const s = latestSnapshot();
    const c = repo.counts();
    return {
      processes: s?.processes ?? [],
      totals: s?.totals ?? null,
      attribution: s?.attribution ?? null,
      history: resourceHistory(),
      dbSizeMb: Math.round(dbSizeMb * 100) / 100,
      records: c.requests,
      leaveDays: c.days,
      people: c.people,
      lastSync: good ? { at: good.at, durationMs: good.duration_ms, records: good.records } : null,
    };
  },

  // ---- sign out: Keychain entries + SQLite file deleted -------------------------
  signOut: async (_: unknown, app) => {
    await whenReady();
    stopLoop();
    await settle();
    stopSampling(true);
    await clearAll(app);
    repo.close();
    await deleteCacheFiles();
    resetSyncState();
    repo.open(dataPath(DB_FILE)); // fresh, empty cache
    app.push('status-changed');
    return { ok: true };
  },
};

async function maybeSendDigest(app: TinyApp) {
  const d = repo.getSetting<DigestSetting>('digest', DIGEST_DEFAULT);
  if (!d.enabled || !(await getSlackWebhook(app))) return;
  const now = new Date();
  if (now.getDay() !== d.weekday || now.getHours() < d.hour || d.lastSent === today()) return;
  try {
    await postSlack(app, Q.digest().text);
    repo.setSetting('digest', { ...d, lastSent: today() });
  } catch { /* try again on the next check */ }
}

export function init(app: TinyApp) {
  ready = (async () => {
    await initConfig(app);
    repo.open(dataPath(DB_FILE));
  })();
  ready.then(async () => {
    if (await isConfigured(app)) startLoop(app); // launch sync; offline = cached data stays
    setInterval(() => void maybeSendDigest(app), 30 * 60_000);
    void maybeSendDigest(app);
  }).catch(() => { /* surfaced through getStatus */ });
}

export function onSystem(kind: string, _value: unknown, app: TinyApp) {
  // back from sleep: the cache is probably stale
  if (kind === 'wake') void ready?.then(async () => { if (await isConfigured(app)) void syncNow(app); });
}

