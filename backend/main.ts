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
import * as T from './teams.ts';
import { clientFor, setTeamSetting, teamSetting, resetSyncState, settle, startLoop, stopLoop, syncNow, syncState } from './sync/scheduler.ts';

const DB_FILE = 'leave-radar.sqlite'; // every team's data, one cache
const dbFile = () => DB_FILE;
let ready: Promise<void> | null = null;

const whenReady = () => ready ?? Promise.reject(new Error('backend not initialised'));

type DigestSetting = { enabled: boolean; weekday: number; hour: number; lastSent: string | null };
const DIGEST_DEFAULT: DigestSetting = { enabled: false, weekday: 1, hour: 9, lastSent: null };

async function teamConfigured(app: TinyApp, team: string) {
  return teamSetting(team, 'demo', false) || !!(await getCredentials(app, team));
}
/** at least one selected team has a key (or is demo) */
async function isConfigured(app: TinyApp) {
  for (const t of T.selectedIds()) if (await teamConfigured(app, t)) return true;
  return false;
}

async function status(app: TinyApp) {
  const last = repo.lastSync();
  const good = repo.lastGoodSync();
  const s = syncState();
  const c = repo.counts();
  return {
    configured: await isConfigured(app),
    demo: T.selectedIds().some((t) => teamSetting(t, 'demo', false)),
    companyDomain: teamSetting<string>(T.primaryTeam().id, 'companyDomain', ''),
    syncing: s.syncing,
    lastSyncAt: good?.at ?? null,
    lastAttemptAt: last?.at ?? null,
    lastDurationMs: good?.duration_ms ?? null,
    lastRecords: good?.records ?? null,
    lastError: last && !last.ok ? last.error : null,
    recordCount: c.requests,
    peopleCount: c.people,
    myEmployeeId: teamSetting<string | null>(T.primaryTeam().id, 'myEmployeeId', null),
    team: T.primaryTeam(),
    teams: T.teams(),
    selected: T.selectedIds(),
  };
}

async function writeExport(path: string, filters: Partial<Filters>, sort: Sort | undefined, format: 'csv' | 'xlsx') {
  if (typeof path !== 'string' || !path.startsWith('/')) throw new Error('Choose where to save the file.');
  const rows = sortRecords(Q.leave(filters), sort);
  const bytes = format === 'xlsx' ? toXlsx(rows) : new TextEncoder().encode(toCsv(rows));
  await tjs.writeFile(path, bytes);
  return { path, rows: rows.length };
}

async function deleteCacheFiles(file = dbFile()) {
  for (const suffix of ['', '-wal', '-shm']) {
    try { await tjs.remove(dataPath(file + suffix)); } catch { /* not there */ }
  }
}

/** the selection changed: rescope every view, then sync what's selected */
/** team names + order into the cache (people default to their team's name) */
const syncTeamInfo = () => repo.setTeamInfo([...T.selectedTeams(), ...T.teams().filter((t) => !T.selectedIds().includes(t.id))]);

async function reselect(app: TinyApp, ids: string[]) {
  stopLoop();
  await settle();
  await T.setSelected(ids);
  syncTeamInfo();
  repo.applyScope(T.selectedIds());
  resetSyncState();
  if (await isConfigured(app)) startLoop(app);
  for (const ev of ['status-changed', 'data-changed', 'views-changed']) app.push(ev);
}

/** a team now has a real key: per-team settings + the BambooHR link domain */
function markTeamReal(team: string, domain: string, myEmployeeId: string) {
  if (teamSetting(team, 'demo', false)) { repo.removeTeamData(team); setTeamSetting(team, 'employeesSyncedAt', 0); }
  setTeamSetting(team, 'demo', false);
  setTeamSetting(team, 'companyDomain', domain);
  setTeamSetting(team, 'myEmployeeId', myEmployeeId);
  repo.setSetting('linkDomain', domain);
}

function markTeamDemo(team: string) {
  repo.removeTeamData(team);
  setTeamSetting(team, 'demo', true);
  setTeamSetting(team, 'companyDomain', 'demo');
  setTeamSetting(team, 'employeesSyncedAt', 0);
  setTeamSetting(team, 'demoRoot', ''); // re-picked at the next sync
}

/** forget one team: Keychain entries, membership, per-team settings */
async function dropTeam(app: TinyApp, id: string) {
  await clearAll(app, id);
  repo.removeTeamData(id);
  for (const k of ['demo', 'companyDomain', 'myEmployeeId', 'employeesSyncedAt']) repo.deleteSetting(T.teamKey(id, k));
  await T.removeTeam(id);
}

/** test-call BambooHR with a key; returns the key owner's employee id */
async function checkKey(companyDomain: string, apiKey: string) {
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
  return { domain, key, myEmployeeId };
}

async function postSlack(app: TinyApp, text: string) {
  const hook = await getSlackWebhook(app);
  if (!hook) throw new Error('Add a Slack incoming-webhook URL in Settings first.');
  const res = await fetch(hook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
  if (!res.ok) throw new Error(`Slack returned ${res.status}`);
}

/** squads the user added by hand: drop team names (case-insensitive) and the
 *  old bundled defaults nobody is assigned to */
function manualSquads(list: string[], map: Record<string, string>): string[] {
  const teamNames = new Set(T.teams().map((t) => t.name.trim().toLowerCase()));
  const used = new Set(Object.values(map));
  return [...new Set([...list, ...used])].filter((q) => q && !teamNames.has(q.trim().toLowerCase()));
}

async function settings(app: TinyApp) {
  const squads = await loadSquads();
  return {
    defaultThreshold: repo.getSetting('defaultThreshold', Q.DEFAULT_THRESHOLD),
    thresholds: repo.getSetting<Record<string, number>>('thresholds', {}),
    linkTemplate: repo.getSetting('linkTemplate', Q.DEFAULT_LINK),
    hoursPerDay: repo.getSetting('hoursPerDay', 8),
    // extra squads only — team names are listed as teams, never repeated here
    squads: manualSquads(squads.squads, T.withoutTeamNames(squads.map)),
    squadMap: T.withoutTeamNames(squads.map),
    people: (() => {
      const auto = repo.autoTeams();
      return repo.allEmployees().filter((e) => e.inScope)
        .map((e) => ({ id: e.id, name: e.displayName, team: e.team, autoTeam: auto[e.id] ?? null }))
        .sort((a, b) => (a.autoTeam ?? '').localeCompare(b.autoTeam ?? '') || a.name.localeCompare(b.name));
    })(),
    digest: repo.getSetting<DigestSetting>('digest', DIGEST_DEFAULT),
    hasSlackWebhook: !!(await getSlackWebhook(app)),
  };
}

export const api: Record<string, TinyApiHandler> = {
  // ---- setup / status / sync ----------------------------------------------
  setup: async ({ companyDomain, apiKey, teamName, color }: { companyDomain: string; apiKey: string; teamName?: string; color?: string }, app) => {
    await whenReady();
    const { domain, key, myEmployeeId } = await checkKey(companyDomain, apiKey);
    const team = T.primaryTeam().id;
    if (color) await T.setTeamColor(team, color);
    if (teamName?.trim()) { await T.renameTeam(team, teamName); syncTeamInfo(); }
    stopLoop();
    await settle();
    await setCredentials(app, domain, key, team);
    markTeamReal(team, domain, myEmployeeId);
    resetSyncState();
    startLoop(app);
    return { ok: true, myEmployeeId };
  },

  setupDemo: async ({ teamName, color }: { teamName?: string; color?: string } = {}, app) => {
    await whenReady();
    const team = T.primaryTeam().id;
    if (color) await T.setTeamColor(team, color);
    if (teamName?.trim()) { await T.renameTeam(team, teamName); syncTeamInfo(); }
    stopLoop();
    await settle();
    markTeamDemo(team);
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
  getCapacity: async ({ filters, sprintId, byMonth }: { filters: Partial<Filters>; sprintId?: string | null; byMonth?: boolean }) => {
    await whenReady();
    return Q.capacity(filters, sprintId, byMonth === true);
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
    // approve with the key of a selected team this person belongs to
    const teamIds = repo.teamsOf(req.employeeId, T.selectedIds());
    let c = null;
    for (const t of teamIds) if ((c = await clientFor(app, t))) break;
    if (!c) throw new Error('Not signed in to BambooHR for this person’s team.');
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

  getQuarterCapacity: async ({ filters, year, q }: { filters: Partial<Filters>; year: number; q: number }) => {
    await whenReady(); return Q.quarterCapacity(filters, Number(year), Number(q));
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
      const clean = T.withoutTeamNames(map);
      const squads = manualSquads(Array.isArray(s.squads) ? s.squads.map(String).filter(Boolean) : [], clean);
      await saveSquads(clean, squads);
      repo.applySquads(clean);
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
      try { dbSizeMb += Number((await tjs.stat(dataPath(dbFile() + suffix))).size) / 1048576; } catch { /* none */ }
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

  // ---- teams: one API key per team; view one team or several at once --------
  /** view just this team */
  switchTeam: async ({ id }: { id: string }, app) => {
    await whenReady();
    await reselect(app, [String(id)]);
    return status(app);
  },

  /** view several teams at once (their union) */
  selectTeams: async ({ ids }: { ids: string[] }, app) => {
    await whenReady();
    await reselect(app, Array.isArray(ids) ? ids.map(String) : []);
    return status(app);
  },

  /** new team: check its key first, store it under the new team, then view it */
  addTeam: async ({ name, companyDomain, apiKey, demo, color }: { name: string; companyDomain?: string; apiKey?: string; demo?: boolean; color?: string }, app) => {
    await whenReady();
    const checked = demo ? null : await checkKey(companyDomain ?? '', apiKey ?? '');
    const team = await T.addTeam(name, color);
    try {
      if (checked) {
        await setCredentials(app, checked.domain, checked.key, team.id);
        markTeamReal(team.id, checked.domain, checked.myEmployeeId);
      } else markTeamDemo(team.id);
      await reselect(app, [team.id]);
    } catch (e) {
      await dropTeam(app, team.id).catch(() => {});
      throw e;
    }
    return status(app);
  },

  setTeamColor: async ({ id, color }: { id?: string; color: string }, app) => {
    await whenReady();
    await T.setTeamColor(id ? String(id) : T.primaryTeam().id, String(color ?? ''));
    app.push('status-changed');
    return status(app);
  },

  renameTeam: async ({ id, name }: { id?: string; name: string }, app) => {
    await whenReady();
    await T.renameTeam(id ? String(id) : T.primaryTeam().id, name);
    { const sq = await loadSquads(); const clean = T.withoutTeamNames(sq.map); await saveSquads(clean, manualSquads(sq.squads, clean)); repo.applySquads(clean); }
    syncTeamInfo();
    app.push('status-changed');
    app.push('data-changed'); // people's default squad is the team name
    return status(app);
  },

  /** delete a team (default: the first selected): its key and its people */
  removeTeam: async ({ id }: { id?: string } = {}, app) => {
    await whenReady();
    stopLoop();
    await settle();
    await dropTeam(app, id ? String(id) : T.primaryTeam().id);
    syncTeamInfo();
    repo.applyScope(T.selectedIds());
    resetSyncState();
    if (await isConfigured(app)) startLoop(app);
    for (const ev of ['status-changed', 'data-changed', 'views-changed']) app.push(ev);
    return status(app);
  },

  // ---- sign out = remove the (first selected) team ------------------------------
  signOut: async (_: unknown, app, meta) => api.removeTeam({}, app, meta),
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

/** pre-multi-team installs kept one cache file per extra team: carry its
 *  per-team settings over, then delete it (the next sync refills the data) */
async function migrateLegacyTeamFiles() {
  for (const t of T.teams()) {
    const file = T.legacyDbFileFor(t.id);
    if (!file) continue;
    try { await tjs.stat(dataPath(file)); } catch { continue; }
    const old = repo.readLegacySettings(dataPath(file), ['demo', 'companyDomain', 'myEmployeeId']);
    for (const [k, v] of Object.entries(old)) setTeamSetting(t.id, k, v);
    if (old.companyDomain && old.companyDomain !== 'demo') repo.setSetting('linkDomain', old.companyDomain);
    await deleteCacheFiles(file);
  }
}

export function init(app: TinyApp) {
  ready = (async () => {
    await initConfig(app);
    await T.loadTeams();
    repo.open(dataPath(dbFile()));
    await migrateLegacyTeamFiles();
    syncTeamInfo();
    // only extra-squad overrides stay on people: drop entries naming a team
    // (older builds mapped people to "SOC Workflow" / "Data Platform" / …,
    // which mislabelled them as a team they aren't a member of)
    const sq = await loadSquads();
    const clean = T.withoutTeamNames(sq.map);
    if (Object.keys(clean).length !== Object.keys(sq.map).length) await saveSquads(clean, manualSquads(sq.squads, clean));
    repo.applySquads(clean);
    repo.applyScope(T.selectedIds());
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

