// ../../../../../../../Users/nirajmaharjan/sandbox/tinyjsapp-examples/leave-radar/backend/bamboo/client.ts
var BambooError = class extends Error {
  status;
  constructor(message, status2) {
    super(message);
    this.status = status2;
  }
};
var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function b64(s) {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
function cleanDomain(input) {
  let d = String(input || "").trim().toLowerCase();
  d = d.replace(/^https?:\/\//, "").split("/")[0].replace(/\.bamboohr\.com$/, "");
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(d)) throw new Error('Company domain should look like "acme" (from acme.bamboohr.com).');
  return d;
}
function createClient(companyDomain, apiKey, opts = {}) {
  const base2 = `https://api.bamboohr.com/api/gateway.php/${encodeURIComponent(companyDomain)}/v1/`;
  const auth = "Basic " + b64(`${apiKey}:x`);
  const timeoutMs = opts.timeoutMs ?? 3e4;
  async function request(method, path, query, body) {
    const qs = query ? "?" + new URLSearchParams(query).toString() : "";
    const url = base2 + path.replace(/^\//, "") + qs;
    let delay = 1e3;
    for (let attempt = 1; ; attempt++) {
      let res;
      try {
        const ctl = new AbortController();
        const timer3 = setTimeout(() => ctl.abort(), timeoutMs);
        try {
          res = await fetch(url, {
            method,
            headers: {
              Authorization: auth,
              Accept: "application/json",
              ...body !== void 0 ? { "Content-Type": "application/json" } : {}
            },
            body: body !== void 0 ? JSON.stringify(body) : void 0,
            signal: ctl.signal
          });
        } finally {
          clearTimeout(timer3);
        }
      } catch (e) {
        if (attempt < 5) {
          await sleep(delay);
          delay *= 2;
          continue;
        }
        throw new BambooError(`Network error calling BambooHR (${path}): ${e?.name === "AbortError" ? "timed out" : "unreachable"}`, 0);
      }
      if ((res.status === 429 || res.status === 503) && attempt < 5) {
        const ra = Number(res.headers.get("retry-after"));
        await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1e3, 6e4) : delay);
        delay *= 2;
        continue;
      }
      if (!res.ok) {
        const hint = res.status === 401 ? " \u2014 check the API key" : res.status === 403 ? " \u2014 your BambooHR account lacks access to this data" : res.status === 404 ? " \u2014 check the company domain" : "";
        throw new BambooError(`BambooHR ${res.status} on ${path}${hint}`, res.status);
      }
      const text = await res.text();
      if (!text) return null;
      try {
        return JSON.parse(text);
      } catch {
        throw new BambooError(`BambooHR returned non-JSON for ${path}`, res.status);
      }
    }
  }
  return {
    get: (path, query) => request("GET", path, query),
    post: (path, body, query) => request("POST", path, query, body),
    put: (path, body) => request("PUT", path, void 0, body)
  };
}

// ../../../../../../../Users/nirajmaharjan/sandbox/tinyjsapp-examples/leave-radar/backend/domain/dates.ts
var DAY_MS = 864e5;
function parse(d) {
  const [y, m, day] = d.split("-").map(Number);
  return Date.UTC(y, m - 1, day);
}
function fmt(ms) {
  const d = new Date(ms);
  const p = (n2) => String(n2).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}
function isDate(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}
function addDays(d, n2) {
  return fmt(parse(d) + n2 * DAY_MS);
}
function addMonths(d, n2) {
  const [y, m, day] = d.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n2, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return fmt(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), Math.min(day, last)));
}
function diffDays(a, b) {
  return Math.round((parse(b) - parse(a)) / DAY_MS);
}
function eachDay(from, to) {
  const out = [];
  for (let t = parse(from), end = parse(to); t <= end; t += DAY_MS) out.push(fmt(t));
  return out;
}
function isWeekend(d) {
  const wd = new Date(parse(d)).getUTCDay();
  return wd === 0 || wd === 6;
}
function today(now = /* @__PURE__ */ new Date()) {
  const p = (n2) => String(n2).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}
function maxDate(a, b) {
  return a > b ? a : b;
}
function minDate(a, b) {
  return a < b ? a : b;
}

// ../../../../../../../Users/nirajmaharjan/sandbox/tinyjsapp-examples/leave-radar/backend/config.ts
var dataDir = "";
var resourcesDir = null;
async function initConfig(app) {
  const p = await app.paths();
  dataDir = p.data;
  resourcesDir = p.resources;
  await tjs.makeDir(dataDir + "/config", { recursive: true });
}
var dataPath = (name) => `${dataDir}/${name}`;
async function readJson(name) {
  for (const dir of [dataDir + "/config", resourcesDir ? resourcesDir + "/config" : null]) {
    if (!dir) continue;
    try {
      const bytes = await tjs.readFile(`${dir}/${name}`);
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch {
    }
  }
  return null;
}
async function writeJson(name, value) {
  await tjs.writeFile(`${dataDir}/config/${name}`, new TextEncoder().encode(JSON.stringify(value, null, 2) + "\n"));
}
async function loadSprints() {
  const json = await readJson("sprints.json");
  const list = Array.isArray(json?.sprints) ? json.sprints : Array.isArray(json) ? json : [];
  const out = [];
  for (const s of list) {
    if (!s?.name || !isDate(s.start) || !isDate(s.end)) continue;
    const boards = s.boards && typeof s.boards === "object" ? Object.entries(s.boards) : [["", s.id ?? s.name]];
    for (const [board, id] of boards) {
      out.push({ id: `${board || "sprint"}:${id}`, board: String(board), name: String(s.name), startDate: s.start, endDate: s.end });
    }
  }
  return out;
}
async function loadSquads() {
  const json = await readJson("squads.json");
  const map = {};
  const raw = json?.people && typeof json.people === "object" ? json.people : {};
  for (const [id, team] of Object.entries(raw)) if (typeof team === "string" && team) map[id] = team;
  const squads = Array.isArray(json?.squads) ? json.squads.filter((s) => typeof s === "string") : [];
  for (const t of Object.values(map)) if (!squads.includes(t)) squads.push(t);
  return { map, squads };
}
async function saveSquads(map, squads) {
  await writeJson("squads.json", { squads, people: map });
}
async function loadLocalHolidays() {
  const json = await readJson("holidays.json");
  const list = Array.isArray(json) ? json : [];
  const out = [];
  for (const h of list) {
    if (!isDate(h?.date)) continue;
    for (const day of eachDay(h.date, isDate(h.end) && h.end >= h.date ? h.end : h.date)) {
      out.push({ day, location: String(h.location || "*"), name: String(h.name || "Holiday") });
    }
  }
  return out;
}

// ../../../../../../../Users/nirajmaharjan/sandbox/tinyjsapp-examples/leave-radar/backend/db/repo.ts
import { Database } from "tjs:sqlite";

// ../../../../../../../Users/nirajmaharjan/sandbox/tinyjsapp-examples/leave-radar/backend/domain/status.ts
var DEFAULT_STATUSES = ["planned", "draft"];
function appStatus(bamboo) {
  switch ((bamboo || "").toLowerCase()) {
    case "approved":
      return "planned";
    case "requested":
      return "draft";
    case "denied":
      return "denied";
    default:
      return "canceled";
  }
}
function bambooStatusesFor(statuses) {
  const s = statuses && statuses.length ? statuses : DEFAULT_STATUSES;
  const out = [];
  if (s.includes("planned")) out.push("approved");
  if (s.includes("draft")) out.push("requested");
  if (s.includes("denied")) out.push("denied");
  if (s.includes("canceled")) out.push("canceled", "superceded");
  return out;
}
function isActive(s) {
  return s === "planned" || s === "draft";
}

// ../../../../../../../Users/nirajmaharjan/sandbox/tinyjsapp-examples/leave-radar/backend/db/schema.ts
var SCHEMA_VERSION = 2;
var SCHEMA = `
CREATE TABLE IF NOT EXISTS employee (
  id            TEXT PRIMARY KEY,   -- BambooHR employee id
  display_name  TEXT NOT NULL,
  team          TEXT,               -- squad from the local squads mapping
  location      TEXT,
  reports_to_id TEXT,
  in_scope      INTEGER NOT NULL    -- 1 if a member of a SELECTED team (see team_member)
);

-- who belongs to which team: the active reporting line of that team's key
CREATE TABLE IF NOT EXISTS team_member (
  team_id       TEXT NOT NULL,
  employee_id   TEXT NOT NULL,
  PRIMARY KEY (team_id, employee_id)
);

-- team names (mirrors teams.json; ord = selected teams first) so a person's
-- squad can default to their team's name, renames included
CREATE TABLE IF NOT EXISTS team_info (
  team_id       TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  ord           INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS leave_request (
  id            TEXT PRIMARY KEY,   -- BambooHR request id
  employee_id   TEXT NOT NULL REFERENCES employee(id),
  bamboo_status TEXT NOT NULL,      -- approved | requested | denied | canceled | superceded
  type_id       TEXT NOT NULL,
  type_name     TEXT NOT NULL,
  start_date    TEXT NOT NULL,      -- YYYY-MM-DD, employee-local
  end_date      TEXT NOT NULL,
  amount        REAL,
  amount_unit   TEXT,
  requested_at  TEXT,
  synced_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS leave_day (
  request_id    TEXT NOT NULL REFERENCES leave_request(id) ON DELETE CASCADE,
  employee_id   TEXT NOT NULL,
  day           TEXT NOT NULL,
  fraction      REAL NOT NULL,
  PRIMARY KEY (request_id, day)
);

CREATE TABLE IF NOT EXISTS holiday (day TEXT, location TEXT, name TEXT, PRIMARY KEY (day, location));
CREATE TABLE IF NOT EXISTS sprint  (id TEXT PRIMARY KEY, board TEXT, name TEXT, start_date TEXT, end_date TEXT);
CREATE TABLE IF NOT EXISTS leave_type (id TEXT PRIMARY KEY, name TEXT);
CREATE TABLE IF NOT EXISTS saved_view (name TEXT PRIMARY KEY, filters_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sync_log (at TEXT, ok INTEGER, records INTEGER, error TEXT, duration_ms INTEGER);
CREATE TABLE IF NOT EXISTS setting (key TEXT PRIMARY KEY, value_json TEXT NOT NULL);

CREATE INDEX IF NOT EXISTS idx_day_emp ON leave_day(day, employee_id);
CREATE INDEX IF NOT EXISTS idx_req_status ON leave_request(bamboo_status, start_date);
CREATE INDEX IF NOT EXISTS idx_req_emp ON leave_request(employee_id);
`;

// ../../../../../../../Users/nirajmaharjan/sandbox/tinyjsapp-examples/leave-radar/backend/db/repo.ts
var db = null;
var dbPath = "";
var cache = /* @__PURE__ */ new Map();
function q(sql) {
  let s = cache.get(sql);
  if (!s) {
    s = db.prepare(sql);
    cache.set(sql, s);
  }
  return s;
}
var all = (sql, ...p) => q(sql).all(...p);
var teamOf = (t) => `COALESCE(${t}.team, (SELECT ti.name FROM team_member tm JOIN team_info ti ON ti.team_id = tm.team_id
  WHERE tm.employee_id = ${t}.id ORDER BY ti.ord LIMIT 1), 'Unassigned')`;
var run = (sql, ...p) => {
  q(sql).run(...p);
};
function tx(fn) {
  db.exec("BEGIN");
  try {
    const r = fn();
    db.exec("COMMIT");
    return r;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
function open(path) {
  dbPath = path;
  db = new Database(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 2000;");
  const v = db.prepare("PRAGMA user_version").all()[0]?.user_version ?? 0;
  if (v !== 0 && v !== SCHEMA_VERSION) {
    db.exec("DROP TABLE IF EXISTS leave_day; DROP TABLE IF EXISTS leave_request; DROP TABLE IF EXISTS employee; DROP TABLE IF EXISTS team_member;DROP TABLE IF EXISTS holiday; DROP TABLE IF EXISTS sprint; DROP TABLE IF EXISTS leave_type; DROP TABLE IF EXISTS sync_log;");
  }
  db.exec(SCHEMA);
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}
function getSetting(key, fallback) {
  const r = all("SELECT value_json FROM setting WHERE key = ?", key)[0];
  if (!r) return fallback;
  try {
    return JSON.parse(r.value_json);
  } catch {
    return fallback;
  }
}
function deleteSetting(key) {
  run("DELETE FROM setting WHERE key = ?", key);
}
function setSetting(key, value) {
  run(
    "INSERT INTO setting(key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json",
    key,
    JSON.stringify(value)
  );
}
function replaceTeamEmployees(teamId, list) {
  tx(() => {
    for (const e of list) {
      run(
        `INSERT INTO employee(id, display_name, team, location, reports_to_id, in_scope) VALUES (?,?,?,?,?,0)
           ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name, team=excluded.team,
             location=excluded.location, reports_to_id=excluded.reports_to_id`,
        e.id,
        e.displayName,
        e.team,
        e.location,
        e.reportsToId
      );
    }
    run("DELETE FROM team_member WHERE team_id = ?", teamId);
    for (const e of list) if (e.inScope) run("INSERT OR IGNORE INTO team_member(team_id, employee_id) VALUES (?,?)", teamId, e.id);
    dropOrphanLeave();
  });
}
function removeTeamData(teamId) {
  tx(() => {
    run("DELETE FROM team_member WHERE team_id = ?", teamId);
    dropOrphanLeave();
  });
}
function dropOrphanLeave() {
  run("DELETE FROM leave_day WHERE employee_id NOT IN (SELECT employee_id FROM team_member)");
  run("DELETE FROM leave_request WHERE employee_id NOT IN (SELECT employee_id FROM team_member)");
}
function applyScope(teamIds) {
  const ph = teamIds.map(() => "?").join(",") || "''";
  db.prepare(`UPDATE employee SET in_scope = CASE WHEN id IN
    (SELECT employee_id FROM team_member WHERE team_id IN (${ph})) THEN 1 ELSE 0 END`).run(...teamIds);
}
function teamMembers(teamId) {
  return all(`SELECT e.id, COALESCE(e.location, '') AS location FROM team_member m JOIN employee e ON e.id = m.employee_id
    WHERE m.team_id = ?`, teamId);
}
function teamsOf(employeeId, among) {
  return all("SELECT team_id AS t FROM team_member WHERE employee_id = ?", employeeId).map((r) => r.t).filter((t) => among.includes(t));
}
function readLegacySettings(path, keys) {
  const out = {};
  try {
    const other = new Database(path);
    for (const k of keys) {
      const r = other.prepare("SELECT value_json FROM setting WHERE key = ?").all(k)[0];
      if (r) {
        try {
          out[k] = JSON.parse(r.value_json);
        } catch {
        }
      }
    }
    other.close();
  } catch {
  }
  return out;
}
function applySquads(squads) {
  tx(() => {
    run("UPDATE employee SET team = NULL");
    for (const [id, team] of Object.entries(squads)) run("UPDATE employee SET team = ? WHERE id = ?", team, id);
  });
}
function replaceTypes(list) {
  tx(() => {
    run("DELETE FROM leave_type");
    for (const t of list) run("INSERT OR REPLACE INTO leave_type(id, name) VALUES (?, ?)", t.id, t.name);
  });
}
function replaceHolidays(list, from, to) {
  tx(() => {
    run("DELETE FROM holiday WHERE day BETWEEN ? AND ?", from, to);
    for (const h of list) run("INSERT OR REPLACE INTO holiday(day, location, name) VALUES (?,?,?)", h.day, h.location, h.name);
  });
}
function replaceSprints(list) {
  tx(() => {
    run("DELETE FROM sprint");
    for (const s of list) run(
      "INSERT OR REPLACE INTO sprint(id, board, name, start_date, end_date) VALUES (?,?,?,?,?)",
      s.id,
      s.board,
      s.name,
      s.startDate,
      s.endDate
    );
  });
}
function replaceRequests(rows, days2, from, to, purgeBefore, teamId) {
  tx(() => {
    run("CREATE TEMP TABLE IF NOT EXISTS keep_req (id TEXT PRIMARY KEY)");
    run("DELETE FROM keep_req");
    for (const r of rows) {
      run(
        `INSERT INTO leave_request(id, employee_id, bamboo_status, type_id, type_name, start_date, end_date,
             amount, amount_unit, requested_at, synced_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET employee_id=excluded.employee_id, bamboo_status=excluded.bamboo_status,
             type_id=excluded.type_id, type_name=excluded.type_name, start_date=excluded.start_date,
             end_date=excluded.end_date, amount=excluded.amount, amount_unit=excluded.amount_unit,
             requested_at=excluded.requested_at, synced_at=excluded.synced_at`,
        r.id,
        r.employeeId,
        r.bambooStatus,
        r.typeId,
        r.typeName,
        r.startDate,
        r.endDate,
        r.amount,
        r.amountUnit,
        r.requestedAt,
        r.syncedAt
      );
      run("INSERT OR IGNORE INTO keep_req(id) VALUES (?)", r.id);
    }
    const gone = `SELECT id FROM leave_request WHERE end_date >= ? AND start_date <= ? AND id NOT IN (SELECT id FROM keep_req)
      AND employee_id IN (SELECT employee_id FROM team_member WHERE team_id = ?)`;
    run(`DELETE FROM leave_day WHERE request_id IN (${gone})`, from, to, teamId);
    run(`DELETE FROM leave_request WHERE id IN (${gone})`, from, to, teamId);
    run("DELETE FROM leave_day WHERE request_id IN (SELECT id FROM keep_req)");
    for (const d of days2) run(
      "INSERT OR REPLACE INTO leave_day(request_id, employee_id, day, fraction) VALUES (?,?,?,?)",
      d.requestId,
      d.employeeId,
      d.day,
      d.fraction
    );
    run("DELETE FROM leave_day WHERE request_id IN (SELECT id FROM leave_request WHERE end_date < ?)", purgeBefore);
    run("DELETE FROM leave_request WHERE end_date < ?", purgeBefore);
    run("DELETE FROM holiday WHERE day < ?", purgeBefore);
  });
}
function logSync(at, ok, records, error, durationMs) {
  run("INSERT INTO sync_log(at, ok, records, error, duration_ms) VALUES (?,?,?,?,?)", at, ok ? 1 : 0, records, error, durationMs);
  run("DELETE FROM sync_log WHERE rowid NOT IN (SELECT rowid FROM sync_log ORDER BY at DESC LIMIT 200)");
}
function lastSync() {
  return all("SELECT * FROM sync_log ORDER BY at DESC LIMIT 1")[0] ?? null;
}
function lastGoodSync() {
  return all("SELECT * FROM sync_log WHERE ok = 1 ORDER BY at DESC LIMIT 1")[0] ?? null;
}
function syncLog(limit = 20) {
  return all("SELECT at, ok, records, error, duration_ms AS durationMs FROM sync_log ORDER BY at DESC LIMIT ?", limit);
}
function counts() {
  const r = all(`SELECT
      (SELECT COUNT(*) FROM leave_request r JOIN employee e ON e.id = r.employee_id WHERE e.in_scope = 1) AS requests,
      (SELECT COUNT(*) FROM leave_day d JOIN employee e ON e.id = d.employee_id WHERE e.in_scope = 1) AS days,
      (SELECT COUNT(*) FROM employee WHERE in_scope = 1) AS people`)[0];
  return { requests: r.requests, days: r.days, people: r.people };
}
function people(f = {}) {
  const where = ["in_scope = 1"];
  const p = [];
  inList(where, p, "id", f.people);
  inList(where, p, teamOf("e"), f.teams);
  inList(where, p, "COALESCE(location, 'Unknown')", f.locations);
  return all(`SELECT id, display_name AS displayName, ${teamOf("e")} AS team,
      COALESCE(location, 'Unknown') AS location FROM employee e WHERE ${where.join(" AND ")}
      ORDER BY team, display_name`, ...p);
}
function allEmployees() {
  return all(`SELECT id, display_name AS displayName, team, location, reports_to_id AS reportsToId, in_scope AS inScope
    FROM employee ORDER BY display_name`);
}
function inList(where, params, col, vals) {
  if (!vals || !vals.length) return;
  where.push(`${col} IN (${vals.map(() => "?").join(",")})`);
  params.push(...vals);
}
function requests(f) {
  const where = ["e.in_scope = 1", "r.end_date >= ?", "r.start_date <= ?"];
  const p = [f.from, f.to];
  inList(where, p, "r.bamboo_status", bambooStatusesFor(f.statuses));
  inList(where, p, "r.type_id", f.types);
  inList(where, p, "r.employee_id", f.people);
  inList(where, p, teamOf("e"), f.teams);
  inList(where, p, "COALESCE(e.location, 'Unknown')", f.locations);
  if (f.requestedFrom) {
    where.push("r.requested_at >= ?");
    p.push(f.requestedFrom);
  }
  if (f.requestedTo) {
    where.push("r.requested_at <= ?");
    p.push(f.requestedTo);
  }
  return all(`SELECT r.id, r.employee_id AS employeeId, e.display_name AS person,
      ${teamOf("e")} AS team, COALESCE(e.location, 'Unknown') AS location,
      r.bamboo_status AS bambooStatus, r.type_id AS typeId, r.type_name AS typeName,
      r.start_date AS startDate, r.end_date AS endDate, r.amount, r.amount_unit AS amountUnit,
      r.requested_at AS requestedAt,
      (SELECT COALESCE(SUM(d.fraction), 0) FROM leave_day d WHERE d.request_id = r.id) AS days
    FROM leave_request r JOIN employee e ON e.id = r.employee_id
    WHERE ${where.join(" AND ")}
    ORDER BY r.start_date, e.display_name`, ...p);
}
function requestById(id) {
  return all(`SELECT r.id, r.employee_id AS employeeId, r.bamboo_status AS bambooStatus, e.in_scope AS inScope
    FROM leave_request r JOIN employee e ON e.id = r.employee_id WHERE r.id = ?`, id)[0] ?? null;
}
function setRequestStatus(id, bambooStatus) {
  run("UPDATE leave_request SET bamboo_status = ? WHERE id = ?", bambooStatus, id);
}
function days(from, to, bambooStatuses) {
  const where = ["e.in_scope = 1", "d.day BETWEEN ? AND ?"];
  const p = [from, to];
  inList(where, p, "r.bamboo_status", bambooStatuses);
  return all(`SELECT d.request_id AS requestId, d.employee_id AS employeeId, d.day, d.fraction,
      r.bamboo_status AS bambooStatus, r.type_name AS typeName
    FROM leave_day d JOIN leave_request r ON r.id = d.request_id JOIN employee e ON e.id = d.employee_id
    WHERE ${where.join(" AND ")}`, ...p);
}
function earliestDay() {
  return all("SELECT MIN(day) AS d FROM leave_day")[0]?.d ?? null;
}
function holidays(from, to) {
  return all("SELECT day, location, name FROM holiday WHERE day BETWEEN ? AND ? ORDER BY day", from, to);
}
function sprints() {
  return all(`SELECT id, board, name, start_date AS startDate, end_date AS endDate FROM sprint ORDER BY start_date, board`);
}
function leaveTypes() {
  return all(`SELECT id, name FROM leave_type
    UNION SELECT DISTINCT r.type_id AS id, r.type_name AS name FROM leave_request r JOIN employee e ON e.id = r.employee_id
      WHERE e.in_scope = 1 AND r.type_id NOT IN (SELECT id FROM leave_type)
    ORDER BY name`);
}
function distinct(col) {
  const expr = col === "team" ? teamOf("e") : "COALESCE(e.location, 'Unknown')";
  return all(`SELECT DISTINCT ${expr} AS v FROM employee e WHERE e.in_scope = 1 ORDER BY v`).map((r) => r.v);
}
function autoTeams() {
  return Object.fromEntries(all(`SELECT e.id, (SELECT ti.name FROM team_member tm JOIN team_info ti ON ti.team_id = tm.team_id
      WHERE tm.employee_id = e.id ORDER BY ti.ord LIMIT 1) AS t FROM employee e WHERE e.in_scope = 1`).filter((r) => r.t).map((r) => [r.id, r.t]));
}
function teamOrder() {
  return new Map(all("SELECT name, ord FROM team_info").map((r) => [r.name, r.ord]));
}
function setTeamInfo(teams2) {
  tx(() => {
    run("DELETE FROM team_info");
    teams2.forEach((t, i) => run("INSERT INTO team_info(team_id, name, ord) VALUES (?,?,?)", t.id, t.name, i));
  });
}
function listViews() {
  return all("SELECT name, filters_json FROM saved_view ORDER BY name").map((r) => {
    let filters = {};
    try {
      filters = JSON.parse(r.filters_json);
    } catch {
    }
    return { name: r.name, filters };
  });
}
function saveView(name, filters) {
  run(
    "INSERT INTO saved_view(name, filters_json) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET filters_json = excluded.filters_json",
    name,
    JSON.stringify(filters)
  );
}
function deleteView(name) {
  run("DELETE FROM saved_view WHERE name = ?", name);
}

// ../../../../../../../Users/nirajmaharjan/sandbox/tinyjsapp-examples/leave-radar/backend/domain/sort.ts
var DEFAULT_SORT = { key: "startDate", dir: "asc" };
var STATUS_ORDER = { draft: 0, planned: 1, denied: 2, canceled: 3 };
function sortRecords(rows, sort = DEFAULT_SORT) {
  const k = sort.key;
  const m = sort.dir === "desc" ? -1 : 1;
  const val = (r) => k === "status" ? STATUS_ORDER[r.status] ?? 9 : k === "days" ? r.days : k === "requestAgeDays" ? r.requestAgeDays ?? -1 : String(r[k] ?? "");
  return [...rows].sort((a, b) => {
    const x = val(a), y = val(b);
    const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
    return c * m || a.startDate.localeCompare(b.startDate) || a.person.localeCompare(b.person) || a.id.localeCompare(b.id);
  });
}
var STATUS_LABEL = { planned: "Planned", draft: "Draft", denied: "Denied", canceled: "Canceled" };
var EXPORT_COLUMNS = [
  { header: "Person", get: (r) => r.person },
  { header: "Squad", get: (r) => r.team },
  { header: "Location", get: (r) => r.location },
  { header: "Status", get: (r) => STATUS_LABEL[r.status] ?? r.status },
  { header: "Leave type", get: (r) => r.typeName },
  { header: "Start", get: (r) => r.startDate },
  { header: "End", get: (r) => r.endDate },
  { header: "Working days", get: (r) => r.days },
  { header: "Requested", get: (r) => r.requestedAt ?? "" },
  { header: "Request age (days)", get: (r) => r.requestAgeDays ?? "" },
  { header: "BambooHR", get: (r) => r.url }
];

// ../../../../../../../Users/nirajmaharjan/sandbox/tinyjsapp-examples/leave-radar/backend/domain/export.ts
function safeText(v) {
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}
function toCsv(rows) {
  const esc = (v) => {
    const s = typeof v === "number" ? String(v) : safeText(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [EXPORT_COLUMNS.map((c) => esc(c.header)).join(",")];
  for (const r of rows) lines.push(EXPORT_COLUMNS.map((c) => esc(c.get(r))).join(","));
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}
var xml = (s) => s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
function colName(i) {
  let s = "";
  for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + (i - 1) % 26) + s;
  return s;
}
function toXlsx(rows) {
  const cell = (v, ref, bold = false) => typeof v === "number" ? `<c r="${ref}"><v>${v}</v></c>` : `<c r="${ref}" t="inlineStr"${bold ? ' s="1"' : ""}><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
  const sheetRows = [
    `<row r="1">${EXPORT_COLUMNS.map((c, i) => cell(c.header, colName(i) + 1, true)).join("")}</row>`,
    ...rows.map((r, n2) => `<row r="${n2 + 2}">${EXPORT_COLUMNS.map((c, i) => cell(c.get(r), colName(i) + (n2 + 2))).join("")}</row>`)
  ];
  const lastRef = colName(EXPORT_COLUMNS.length - 1) + (rows.length + 1);
  const files = [
    ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`],
    ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Leave" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ["xl/styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf/><xf fontId="1" applyFont="1"/></cellXfs></styleSheet>`],
    ["xl/worksheets/sheet1.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${lastRef}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>${sheetRows.join("")}</sheetData><autoFilter ref="A1:${lastRef}"/></worksheet>`]
  ];
  return zipStored(files.map(([name, text]) => [name, new TextEncoder().encode(text)]));
}
var crcTable = null;
function crc32(b) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n2 = 0; n2 < 256; n2++) {
      let c2 = n2;
      for (let k = 0; k < 8; k++) c2 = c2 & 1 ? 3988292384 ^ c2 >>> 1 : c2 >>> 1;
      crcTable[n2] = c2 >>> 0;
    }
  }
  let c = 4294967295;
  for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 255] ^ c >>> 8;
  return (c ^ 4294967295) >>> 0;
}
function zipStored(entries) {
  const enc = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const nm = enc.encode(name);
    const crc = crc32(data);
    const local = new Uint8Array(30 + nm.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 67324752, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 2048, true);
    lv.setUint16(8, 0, true);
    lv.setUint16(10, 0, true);
    lv.setUint16(12, 33, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nm.length, true);
    lv.setUint16(28, 0, true);
    local.set(nm, 30);
    const cen = new Uint8Array(46 + nm.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 33639248, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 2048, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 33, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nm.length, true);
    cv.setUint32(42, offset, true);
    cen.set(nm, 46);
    chunks.push(local, data);
    central.push(cen);
    offset += local.length + data.length;
  }
  const cenSize = central.reduce((a, c) => a + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 101010256, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cenSize, true);
  ev.setUint32(16, offset, true);
  const all2 = [...chunks, ...central, end];
  const out = new Uint8Array(all2.reduce((a, c) => a + c.length, 0));
  let p = 0;
  for (const c of all2) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

// ../../../../../../../Users/nirajmaharjan/sandbox/tinyjsapp-examples/leave-radar/backend/domain/resources.ts
var dec = new TextDecoder();
async function run2(args) {
  const proc = tjs.spawn(args, { stdout: "pipe", stderr: "ignore", stdin: "ignore" });
  let out = "";
  const reader = proc.stdout.getReader();
  try {
    for (; ; ) {
      const { value, done } = await reader.read();
      if (done) break;
      out += dec.decode(value, { stream: true });
    }
  } catch {
  }
  await proc.wait();
  return out;
}
function parseEtime(s) {
  const [dPart, rest] = s.includes("-") ? s.split("-") : ["0", s];
  const parts = rest.split(":").map(Number).reverse();
  return Number(dPart) * 86400 + (parts[0] || 0) + (parts[1] || 0) * 60 + (parts[2] || 0) * 3600;
}
function parsePs(text) {
  const rows = [];
  for (const line of text.split("\n")) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)\s+(\S+)\s+(.+)$/);
    if (!m) continue;
    rows.push({ pid: +m[1], ppid: +m[2], rssKb: +m[3], cpu: +m[4], etimeS: parseEtime(m[5]), comm: m[6] });
  }
  return rows;
}
var base = (comm) => comm.split("/").pop() || comm;
var NOT_APP = /^(-?zsh|-?bash|sh|fish|login|launchd|node|npm|tinyjs|Terminal|Code Helper.*|Electron|esbuild|vite)$/i;
function roleOf(comm, pid, ownPid) {
  if (pid === ownPid) return "Backend (txiki.js)";
  const b = base(comm);
  if (b.includes("WebKit.WebContent")) return "Web content (UI)";
  if (b.includes("WebKit.Networking")) return "WebKit networking";
  if (b.includes("WebKit.GPU")) return "WebKit GPU";
  return "App window (native)";
}
function parseLaunchctl(text) {
  const out = /* @__PURE__ */ new Set();
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*(\d+)\s+\S+\s+(com\.apple\.WebKit\.\S+)/);
    if (m && +m[1] > 0) out.add(+m[1]);
  }
  return out;
}
async function launchdServices(appPid) {
  try {
    return parseLaunchctl(await run2(["/bin/launchctl", "print", `pid/${appPid}`]));
  } catch {
    return /* @__PURE__ */ new Set();
  }
}
var cachedHelpers = null;
async function sampleProcesses() {
  const ownPid = tjs.pid;
  const rows = parsePs(await run2(["/bin/ps", "-axo", "pid=,ppid=,rss=,%cpu=,etime=,comm="]));
  const byPid = new Map(rows.map((r) => [r.pid, r]));
  const kids = /* @__PURE__ */ new Map();
  for (const r of rows) {
    const l = kids.get(r.ppid);
    if (l) l.push(r);
    else kids.set(r.ppid, [r]);
  }
  const family = /* @__PURE__ */ new Map();
  const walk = (r) => {
    if (r.pid !== ownPid && /(^|\/)(ps|launchctl)$/.test(r.comm)) return;
    family.set(r.pid, r);
    for (const k of kids.get(r.pid) ?? []) walk(k);
  };
  const self = byPid.get(ownPid);
  if (self) {
    walk(self);
    const parent = byPid.get(self.ppid);
    if (parent && parent.pid > 1 && /\.app\/Contents\/MacOS\//.test(parent.comm) && !NOT_APP.test(base(parent.comm))) {
      family.set(parent.pid, parent);
    }
  }
  const candidates = [...family.values()].filter((r) => r.pid !== ownPid).sort((a, b) => Number(/\.app\/Contents\/MacOS\//.test(b.comm)) - Number(/\.app\/Contents\/MacOS\//.test(a.comm)));
  const appProc = candidates[0] ?? self;
  let attribution = "parent chain only";
  if (appProc) {
    if (!cachedHelpers || !family.has(cachedHelpers.appPid) || [...cachedHelpers.pids].some((p) => !byPid.has(p))) {
      let viaLaunchd = /* @__PURE__ */ new Set(), owner = appProc.pid;
      for (const c of candidates.slice(0, 3)) {
        viaLaunchd = await launchdServices(c.pid);
        if (viaLaunchd.size) {
          owner = c.pid;
          break;
        }
      }
      if (viaLaunchd.size) cachedHelpers = { appPid: owner, pids: viaLaunchd, method: "launchd domain of the window process" };
      else {
        const pids = new Set(rows.filter((r) => /com\.apple\.WebKit\./.test(r.comm) && r.ppid === 1 && r.etimeS <= appProc.etimeS && appProc.etimeS - r.etimeS <= 20).map((r) => r.pid));
        cachedHelpers = { appPid: appProc.pid, pids, method: "start-time heuristic (verify)" };
      }
    }
    for (const pid of cachedHelpers.pids) {
      const r = byPid.get(pid);
      if (r) family.set(pid, r);
    }
    attribution = cachedHelpers.method;
  }
  const processes = [...family.values()].map((r) => ({
    name: base(r.comm),
    pid: r.pid,
    role: roleOf(r.comm, r.pid, ownPid),
    rssMb: Math.round(r.rssKb / 102.4) / 10,
    cpuPct: r.cpu,
    uptimeS: r.etimeS
  })).sort((a, b) => b.rssMb - a.rssMb);
  return { processes, attribution };
}
var MAX_SAMPLES = 150;
var history = [];
var timer = null;
var latest = null;
var openCount = 0;
function resourceHistory() {
  return history.slice();
}
function latestSnapshot() {
  return latest;
}
async function tick(onSample) {
  try {
    const { processes, attribution } = await sampleProcesses();
    const totals = {
      rssMb: Math.round(processes.reduce((a, p) => a + p.rssMb, 0) * 10) / 10,
      cpuPct: Math.round(processes.reduce((a, p) => a + p.cpuPct, 0) * 10) / 10,
      count: processes.length
    };
    latest = { at: Date.now(), processes, totals, attribution };
    history.push({ at: latest.at, rssMb: totals.rssMb, cpuPct: totals.cpuPct });
    if (history.length > MAX_SAMPLES) history.splice(0, history.length - MAX_SAMPLES);
    onSample(latest);
  } catch {
  }
}
function startSampling(onSample) {
  openCount++;
  if (timer) return;
  void tick(onSample);
  timer = setInterval(() => void tick(onSample), 2e3);
}
function stopSampling(force = false) {
  openCount = force ? 0 : Math.max(0, openCount - 1);
  if (openCount === 0 && timer) {
    clearInterval(timer);
    timer = null;
  }
}

// ../../../../../../../Users/nirajmaharjan/sandbox/tinyjsapp-examples/leave-radar/backend/domain/capacity.ts
var r2 = (n2) => Math.round(n2 * 100) / 100;
function workingDays(from, to, location, isHoliday) {
  let n2 = 0;
  for (const d of eachDay(from, to)) if (!isWeekend(d) && !isHoliday(d, location)) n2++;
  return n2;
}
function capacityByTeam(people3, days2, from, to, isHoliday) {
  const per = /* @__PURE__ */ new Map();
  for (const p of people3) {
    const available = workingDays(from, to, p.location, isHoliday);
    per.set(p.id, { id: p.id, displayName: p.displayName, available, plannedOut: 0, draftOut: 0, net: available, wfh: 0 });
  }
  for (const d of days2) {
    if (d.day < from || d.day > to) continue;
    const pc = per.get(d.employeeId);
    if (!pc) continue;
    if (d.wfh) {
      if (d.status === "planned" || d.status === "draft") pc.wfh += d.fraction;
      continue;
    }
    if (d.status === "planned") pc.plannedOut += d.fraction;
    else if (d.status === "draft") pc.draftOut += d.fraction;
  }
  const teams2 = /* @__PURE__ */ new Map();
  for (const p of people3) {
    const pc = per.get(p.id);
    pc.plannedOut = r2(pc.plannedOut);
    pc.draftOut = r2(pc.draftOut);
    pc.wfh = r2(pc.wfh);
    pc.net = r2(pc.available - pc.plannedOut - pc.draftOut);
    let t = teams2.get(p.team);
    if (!t) {
      t = { team: p.team, headcount: 0, available: 0, plannedOut: 0, draftOut: 0, wfh: 0, net: 0, netPlanned: 0, people: [] };
      teams2.set(p.team, t);
    }
    t.headcount++;
    t.available += pc.available;
    t.plannedOut += pc.plannedOut;
    t.draftOut += pc.draftOut;
    t.wfh += pc.wfh;
    t.people.push(pc);
  }
  return [...teams2.values()].map((t) => ({
    ...t,
    available: r2(t.available),
    plannedOut: r2(t.plannedOut),
    draftOut: r2(t.draftOut),
    wfh: r2(t.wfh),
    net: r2(t.available - t.plannedOut - t.draftOut),
    netPlanned: r2(t.available - t.plannedOut),
    people: t.people.sort((a, b) => a.displayName.localeCompare(b.displayName))
  })).sort((a, b) => a.team.localeCompare(b.team));
}
function teamLoad(people3, days2, from, to, thresholdFor2, minPeople) {
  const teamOf2 = new Map(people3.map((p) => [p.id, p.team]));
  const size = /* @__PURE__ */ new Map();
  for (const p of people3) size.set(p.team, (size.get(p.team) ?? 0) + 1);
  const byDay = /* @__PURE__ */ new Map();
  for (const d of days2) {
    if (d.wfh || d.day < from || d.day > to || d.status !== "planned" && d.status !== "draft") continue;
    const team = teamOf2.get(d.employeeId);
    if (team === void 0) continue;
    let tm = byDay.get(d.day);
    if (!tm) byDay.set(d.day, tm = /* @__PURE__ */ new Map());
    let pm = tm.get(team);
    if (!pm) tm.set(team, pm = /* @__PURE__ */ new Map());
    const cur = pm.get(d.employeeId) ?? { p: 0, d: 0 };
    if (d.status === "planned") cur.p += d.fraction;
    else cur.d += d.fraction;
    pm.set(d.employeeId, cur);
  }
  const out = [];
  for (const day of eachDay(from, to)) {
    if (isWeekend(day)) continue;
    const tm = byDay.get(day);
    if (!tm) continue;
    const teams2 = [];
    let peopleOut = 0;
    for (const [team, pm] of tm) {
      let planned = 0, draft = 0, n2 = 0;
      for (const v of pm.values()) {
        const p = Math.min(1, v.p), dd = Math.min(1 - p, v.d);
        planned += p;
        draft += dd;
        n2++;
      }
      const sz = size.get(team) ?? 0;
      const o = r2(planned + draft);
      const share = sz ? o / sz : 0;
      const flagged = minPeople && minPeople > 0 ? n2 >= minPeople : sz > 0 && share >= thresholdFor2(team) - 1e-9;
      peopleOut += n2;
      teams2.push({ team, out: o, planned: r2(planned), draft: r2(draft), size: sz, share: r2(share), flagged });
    }
    teams2.sort((a, b) => a.team.localeCompare(b.team));
    out.push({ day, teams: teams2, peopleOut, flagged: teams2.some((t) => t.flagged) });
  }
  return out;
}

// ../../../../../../../Users/nirajmaharjan/sandbox/tinyjsapp-examples/leave-radar/backend/domain/dashboard.ts
var WFH_RE = /work(ing)?[\s_-]*from[\s_-]*home|\bwfh\b|remote|home[\s_-]*office/i;
var isWfhType = (typeName) => WFH_RE.test(typeName || "");
function pickSprints(t, all2) {
  const list = [...all2].sort((a, b) => a.startDate.localeCompare(b.startDate));
  let cur = list.findIndex((s) => s.startDate <= t && s.endDate >= t);
  const hasCurrent = cur >= 0;
  if (!hasCurrent) {
    const nxt = list.findIndex((s) => s.startDate > t);
    cur = nxt >= 0 ? nxt - 1 : list.length - 1;
  }
  const out = [];
  const at = (i, role) => {
    if (list[i]) out.push({ ...list[i], role });
  };
  if (hasCurrent) {
    at(cur - 1, "previous");
    at(cur, "current");
    at(cur + 1, "next");
    at(cur + 2, "upcoming");
  } else {
    at(cur, "previous");
    at(cur + 1, "next");
    at(cur + 2, "upcoming");
  }
  return out;
}
function sprintLeave(sp, byId, days2) {
  const people3 = /* @__PURE__ */ new Map();
  const byType = {};
  let planned = 0, draft = 0;
  for (const d of days2) {
    if (d.day < sp.startDate || d.day > sp.endDate) continue;
    const rec = byId.get(d.requestId);
    if (!rec || !isActive(rec.status)) continue;
    const p = people3.get(d.employeeId) ?? {
      employeeId: d.employeeId,
      person: rec.person,
      team: rec.team,
      days: 0,
      planned: 0,
      draft: 0,
      first: d.day,
      last: d.day,
      types: [],
      requests: []
    };
    p.days += d.fraction;
    if (rec.status === "planned") {
      p.planned += d.fraction;
      planned += d.fraction;
    } else {
      p.draft += d.fraction;
      draft += d.fraction;
    }
    if (d.day < p.first) p.first = d.day;
    if (d.day > p.last) p.last = d.day;
    if (!p.types.includes(rec.typeName)) p.types.push(rec.typeName);
    if (!p.requests.some((x) => x.id === rec.id)) p.requests.push({ id: rec.id, url: rec.url });
    byType[rec.typeName] = (byType[rec.typeName] ?? 0) + d.fraction;
    people3.set(d.employeeId, p);
  }
  const list = [...people3.values()].map((p) => ({ ...p, days: round(p.days), planned: round(p.planned), draft: round(p.draft) })).sort((a, b) => b.days - a.days || a.person.localeCompare(b.person));
  return {
    name: sp.name,
    startDate: sp.startDate,
    endDate: sp.endDate,
    role: sp.role,
    days: round(planned + draft),
    planned: round(planned),
    draft: round(draft),
    byType: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, round(v)])),
    people: list
  };
}
function dashRanges(t) {
  const wd = new Date(parse(t)).getUTCDay();
  const nextMon = addDays(t, (8 - wd) % 7 || 7);
  const monthFrom = t.slice(0, 8) + "01";
  return {
    nextWeek: { from: nextMon, to: addDays(nextMon, 6) },
    month: { from: monthFrom, to: addDays(addMonths(monthFrom, 1), -1) }
  };
}
var ORDER = { planned: 0, draft: 1, denied: 2, canceled: 3 };
var round = (n2) => Math.round(n2 * 100) / 100;
function period(from, to, recs, days2, statuses) {
  const inWin = /* @__PURE__ */ new Map();
  for (const d of days2) if (d.day >= from && d.day <= to) inWin.set(d.requestId, (inWin.get(d.requestId) ?? 0) + d.fraction);
  const items = [];
  for (const [id, n2] of inWin) {
    const r = recs.get(id);
    if (r && statuses.includes(r.status)) items.push({ ...r, days: round(n2) });
  }
  items.sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.startDate.localeCompare(b.startDate) || a.person.localeCompare(b.person));
  const counts2 = { planned: 0, draft: 0, denied: 0, canceled: 0 };
  for (const i of items) counts2[i.status]++;
  return { from, to, items, people: new Set(items.filter((i) => isActive(i.status)).map((i) => i.employeeId)).size, counts: counts2 };
}
function section(t, r, recs, days2) {
  const byId = new Map(recs.map((x) => [x.id, x]));
  const mine = days2.filter((d) => byId.has(d.requestId));
  const active = mine.filter((d) => isActive(byId.get(d.requestId).status) && d.day >= r.month.from && d.day <= r.month.to);
  const perDay = /* @__PURE__ */ new Map();
  for (const d of active) {
    const rec = byId.get(d.requestId);
    const m = perDay.get(d.day) ?? /* @__PURE__ */ new Map();
    const cur = m.get(d.employeeId);
    if (!cur || ORDER[rec.status] < ORDER[cur.status]) {
      m.set(d.employeeId, { employeeId: d.employeeId, person: rec.person, team: rec.team, status: rec.status, fraction: Math.min(1, (cur?.fraction ?? 0) + d.fraction) });
    } else cur.fraction = Math.min(1, cur.fraction + d.fraction);
    perDay.set(d.day, m);
  }
  const sameDay = [...perDay].filter(([, m]) => m.size >= 2).map(([day, m]) => ({ day, people: [...m.values()].sort((a, b) => a.person.localeCompare(b.person)) })).sort((a, b) => a.day.localeCompare(b.day));
  const rank = /* @__PURE__ */ new Map();
  for (const d of active) {
    const rec = byId.get(d.requestId);
    const x = rank.get(d.employeeId) ?? { employeeId: d.employeeId, person: rec.person, team: rec.team, days: 0, requests: 0, planned: 0, draft: 0, byType: {}, ids: /* @__PURE__ */ new Set() };
    x.byType[rec.typeName] = (x.byType[rec.typeName] ?? 0) + d.fraction;
    x.days += d.fraction;
    if (rec.status === "planned") x.planned += d.fraction;
    else x.draft += d.fraction;
    x.ids.add(d.requestId);
    rank.set(d.employeeId, x);
  }
  const ranking = [...rank.values()].map(({ ids, ...x }) => ({
    ...x,
    requests: ids.size,
    days: round(x.days),
    planned: round(x.planned),
    draft: round(x.draft),
    byType: Object.fromEntries(Object.entries(x.byType).map(([k, v]) => [k, round(v)]))
  })).sort((a, b) => b.days - a.days || b.requests - a.requests || a.person.localeCompare(b.person));
  const daily = eachDay(r.month.from, r.month.to).filter((d) => !isWeekend(d)).map((day) => ({ day, people: perDay.get(day)?.size ?? 0, byType: {} }));
  const di = new Map(daily.map((p, i) => [p.day, i]));
  for (const d of active) {
    const i = di.get(d.day);
    if (i === void 0) continue;
    const t2 = byId.get(d.requestId).typeName;
    daily[i].byType[t2] = round((daily[i].byType[t2] ?? 0) + d.fraction);
  }
  return {
    daily,
    today: period(t, t, byId, mine, ["planned", "draft", "denied"]),
    nextWeek: period(r.nextWeek.from, r.nextWeek.to, byId, mine, ["planned", "draft"]),
    month: period(r.month.from, r.month.to, byId, mine, ["planned", "draft"]),
    sameDay,
    ranking
  };
}
function buildDashboard(t, recs, days2, sprints2 = []) {
  const r = dashRanges(t);
  const wfh = recs.filter((x) => isWfhType(x.typeName));
  const leave2 = recs.filter((x) => !isWfhType(x.typeName));
  return {
    today: t,
    ...r,
    leave: section(t, r, leave2, days2),
    wfh: section(t, r, wfh, days2),
    wfhTypes: [...new Set(wfh.map((x) => x.typeName))].sort(),
    types: [...new Set(recs.map((x) => x.typeName))].sort(),
    sprints: pickSprints(t, sprints2).map((sp) => sprintLeave(sp, new Map(leave2.map((x) => [x.id, x])), days2))
  };
}
function yearSummary(year2, t, recs, days2, dataFrom = null) {
  const byId = new Map(recs.map((x) => [x.id, x]));
  const acc = () => ({ days: 0, req: /* @__PURE__ */ new Set(), ppl: /* @__PURE__ */ new Set(), byType: {}, byPerson: /* @__PURE__ */ new Map() });
  const m = Array.from({ length: 12 }, () => ({ leave: acc(), wfh: acc() }));
  const q2 = Array.from({ length: 4 }, () => ({ leave: acc(), wfh: acc() }));
  const y = String(year2);
  for (const d of days2) {
    if (d.day.slice(0, 4) !== y) continue;
    const rec = byId.get(d.requestId);
    if (!rec || !isActive(rec.status)) continue;
    const kind = isWfhType(rec.typeName) ? "wfh" : "leave";
    const mi = Number(d.day.slice(5, 7)) - 1;
    for (const a of [m[mi][kind], q2[Math.floor(mi / 3)][kind]]) {
      a.days += d.fraction;
      a.req.add(rec.id);
      a.ppl.add(rec.employeeId);
      a.byType[rec.typeName] = (a.byType[rec.typeName] ?? 0) + d.fraction;
      const p = a.byPerson.get(rec.employeeId) ?? { person: rec.person, team: rec.team, days: 0, req: /* @__PURE__ */ new Set() };
      p.days += d.fraction;
      p.req.add(rec.id);
      a.byPerson.set(rec.employeeId, p);
    }
  }
  const out = (a) => ({
    days: round(a.days),
    requests: a.req.size,
    people: a.ppl.size,
    byType: Object.fromEntries(Object.entries(a.byType).map(([k, v]) => [k, round(v)])),
    byPerson: Object.fromEntries([...a.byPerson].map(([id, p]) => [id, { person: p.person, team: p.team, days: round(p.days), requests: p.req.size }]))
  });
  const pad = (n2) => String(n2).padStart(2, "0");
  return {
    year: year2,
    today: t,
    dataFrom,
    months: m.map((x, i) => ({ month: `${y}-${pad(i + 1)}`, leave: out(x.leave), wfh: out(x.wfh) })),
    quarters: q2.map((x, i) => {
      const from = `${y}-${pad(i * 3 + 1)}-01`;
      return { q: i + 1, from, to: addDays(addMonths(from, 3), -1), leave: out(x.leave), wfh: out(x.wfh) };
    })
  };
}

// ../../../../../../../Users/nirajmaharjan/sandbox/tinyjsapp-examples/leave-radar/backend/domain/longleave.ts
var UNSCHEDULED_RE = /\bsick|substitut/i;
var countsAsLongLeave = (typeName) => !isWfhType(typeName) && !UNSCHEDULED_RE.test(typeName || "");
var LONG_DAYS = 10;
var MINI_DAYS = 5;
function findRuns(recs, days2, isHoliday) {
  const byId = new Map(recs.map((r) => [r.id, r]));
  const perPerson = /* @__PURE__ */ new Map();
  for (const d of days2) {
    const r = byId.get(d.requestId);
    if (!r || !isActive(r.status) || !countsAsLongLeave(r.typeName) || d.fraction <= 0) continue;
    const m = perPerson.get(d.employeeId) ?? /* @__PURE__ */ new Map();
    const cur = m.get(d.day) ?? { fraction: 0, reqs: /* @__PURE__ */ new Set() };
    cur.fraction = Math.min(1, cur.fraction + d.fraction);
    cur.reqs.add(d.requestId);
    m.set(d.day, cur);
    perPerson.set(d.employeeId, m);
  }
  const out = [];
  for (const [emp, m] of perPerson) {
    const daysSorted = [...m.keys()].sort();
    let run3 = [];
    const flush = () => {
      if (!run3.length) return;
      const total = run3.reduce((a, d) => a + m.get(d).fraction, 0);
      const kind = total >= LONG_DAYS ? "long" : total >= MINI_DAYS ? "mini" : null;
      if (kind) {
        const reqIds = [...new Set(run3.flatMap((d) => [...m.get(d).reqs]))];
        const reqs = reqIds.map((id) => byId.get(id)).sort((a, b) => a.startDate.localeCompare(b.startDate));
        const st = new Set(reqs.map((r) => r.status));
        out.push({
          id: `${reqs[0].id}:${run3[0]}`,
          employeeId: emp,
          person: reqs[0].person,
          team: reqs[0].team,
          kind,
          start: run3[0],
          end: run3[run3.length - 1],
          days: Math.round(total * 100) / 100,
          status: st.size > 1 ? "mixed" : st.has("draft") ? "draft" : "planned",
          types: [...new Set(reqs.map((r) => r.typeName))],
          requests: reqs.map((r) => ({ id: r.id, status: r.status, url: r.url }))
        });
      }
      run3 = [];
    };
    for (const d of daysSorted) {
      if (run3.length && !onlyBreaksBetween(run3[run3.length - 1], d, (x) => isHoliday(x, emp))) flush();
      run3.push(d);
    }
    flush();
  }
  return out.sort((a, b) => a.start.localeCompare(b.start) || a.person.localeCompare(b.person));
}
function onlyBreaksBetween(a, b, isHoliday) {
  for (let d = addDays(a, 1), n2 = 0; d < b; d = addDays(d, 1), n2++) {
    if (n2 > 40) return false;
    if (!isWeekend(d) && !isHoliday(d)) return false;
  }
  return true;
}
function longLeaveYear(year2, t, runs, dataFrom = null) {
  const y = String(year2);
  const inYear = runs.filter((r) => r.end >= `${y}-01-01` && r.start <= `${y}-12-31`);
  const months = Array.from({ length: 12 }, (_, i) => {
    const from = `${y}-${String(i + 1).padStart(2, "0")}-01`;
    const to = addDays(addMonths(from, 1), -1);
    const here = inYear.filter((r) => r.end >= from && r.start <= to);
    return { month: from.slice(0, 7), from, to, long: here.filter((r) => r.kind === "long"), mini: here.filter((r) => r.kind === "mini") };
  });
  return {
    year: year2,
    today: t,
    dataFrom,
    months,
    long: inYear.filter((r) => r.kind === "long"),
    mini: inYear.filter((r) => r.kind === "mini")
  };
}

// ../../../../../../../Users/nirajmaharjan/sandbox/tinyjsapp-examples/leave-radar/backend/bamboo/demo.ts
var DEMO_ME = "9000";
var LOCATIONS = ["Kathmandu", "London", "Copenhagen"];
var TYPES = [
  { id: "1", name: "Vacation" },
  { id: "2", name: "Sick Leave" },
  { id: "3", name: "Personal Day" },
  { id: "4", name: "Parental Leave" },
  { id: "5", name: "Training" },
  { id: "6", name: "Work From Home" }
];
function people2() {
  const out = [
    { id: "9001", displayName: "Demo Lead A", location: "Kathmandu", supervisorEId: DEMO_ME, squad: "SOC Workflow" },
    { id: "9002", displayName: "Demo Lead B", location: "Copenhagen", supervisorEId: DEMO_ME, squad: "Data Platform" },
    // outside my reporting line — must never show up
    { id: "9500", displayName: "Other Org Person", location: "London", supervisorEId: "9999", squad: null },
    { id: "9999", displayName: "Other Manager", location: "London", supervisorEId: "", squad: null }
  ];
  for (let i = 1; i <= 22; i++) {
    const soc = i <= 12;
    out.push({
      id: String(9100 + i),
      displayName: `Demo Person ${String(i).padStart(2, "0")}`,
      location: LOCATIONS[i % 3],
      supervisorEId: soc ? "9001" : "9002",
      squad: soc ? "SOC Workflow" : "Data Platform"
    });
  }
  return out;
}
function rng(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}
var demoStatus = /* @__PURE__ */ new Map();
function requests2() {
  const t = today();
  const rand = rng(Number(t.replace(/-/g, "")));
  const from = minDate(addMonths(t, -3), t.slice(0, 4) + "-01-01"), span = diffDays(from, addMonths(t, 12));
  const out = [];
  let id = 5e4;
  for (const p of people2()) {
    const n2 = Math.round((4 + Math.floor(rand() * 5)) * span / 450);
    for (let k = 0; k < n2; k++) {
      let start = addDays(from, Math.floor(rand() * span));
      while (isWeekend(start)) start = addDays(start, 1);
      const typ = TYPES[rand() < 0.6 ? 0 : Math.floor(rand() * TYPES.length)];
      const long = typ.name === "Parental Leave" ? 20 : typ.name === "Vacation" ? 1 + Math.floor(rand() * 9) : typ.name === "Work From Home" ? 1 + Math.floor(rand() * 3) : 1;
      const half = long === 1 && rand() < 0.25;
      const dates = {};
      let d = start, left = long, end = start;
      while (left > 0) {
        if (!isWeekend(d)) {
          dates[d] = half ? "4" : "8";
          left--;
          end = d;
        }
        d = addDays(d, 1);
      }
      const future = start > t;
      const r = rand();
      const status2 = future ? r < 0.55 ? "approved" : r < 0.88 ? "requested" : r < 0.95 ? "denied" : "canceled" : r < 0.9 ? "approved" : "canceled";
      const created = addDays(start < t ? start : t, -(3 + Math.floor(rand() * 40)));
      out.push({
        id: String(id++),
        employeeId: p.id,
        status: { status: status2, lastChanged: created },
        name: p.displayName,
        start,
        end,
        created,
        type: { id: typ.id, name: typ.name },
        amount: { unit: "hours", amount: String(Object.values(dates).reduce((a, v) => a + Number(v), 0)) },
        dates,
        notes: { employee: "notes are never stored" }
      });
    }
  }
  for (const p of people2()) {
    const n2 = Math.floor(rand() * 5) + Math.floor(span / 30);
    for (let k = 0; k < n2; k++) {
      let d = addDays(from, Math.floor(rand() * span));
      while (isWeekend(d)) d = addDays(d, 1);
      const r = rand();
      out.push({
        id: String(id++),
        employeeId: p.id,
        status: { status: r < 0.75 ? "approved" : r < 0.93 ? "requested" : "denied" },
        start: d,
        end: d,
        created: addDays(d < t ? d : t, -2),
        type: { id: "6", name: "Work From Home" },
        amount: { unit: "hours", amount: "8" },
        dates: { [d]: "8" }
      });
    }
  }
  let o = addDays(t, 7);
  while (isWeekend(o)) o = addDays(o, 1);
  for (const pid of ["9101", "9102", "9103", "9104"]) {
    out.push({
      id: String(id++),
      employeeId: pid,
      status: { status: pid === "9104" ? "requested" : "approved" },
      start: o,
      end: o,
      created: addDays(t, -2),
      type: { id: "1", name: "Vacation" },
      amount: { unit: "hours", amount: "8" },
      dates: { [o]: "8" }
    });
  }
  return out;
}
var HOLIDAYS = [
  { start: "2026-12-25", end: "2026-12-25", name: "Christmas Day" },
  { start: "2027-01-01", end: "2027-01-01", name: "New Year's Day" }
];
function demoRootFor(index, demoTeamCount) {
  if (demoTeamCount <= 1) return DEMO_ME;
  return index % 2 === 0 ? "9001" : "9002";
}
function createDemoClient(root = DEMO_ME) {
  const respond = async (path, query) => {
    await new Promise((r) => setTimeout(r, 150));
    if (path.startsWith("employees/0")) return { id: root, displayName: root === DEMO_ME ? "Demo Manager" : "Demo Lead" };
    if (path.startsWith("reports/custom") || path.startsWith("employees/directory")) {
      return { fields: [], employees: [
        { id: DEMO_ME, displayName: "Demo Manager", location: "London", supervisorEId: "", status: "Active" },
        ...people2().map(({ squad: _s, ...e }) => ({ ...e, status: "Active" })),
        // people who left — must never show up
        { id: "9190", displayName: "Demo Leaver (inactive)", location: "London", supervisorEId: "9001", status: "Inactive", terminationDate: "2026-01-31" },
        { id: "9191", displayName: "Demo Leaver (last day passed)", location: "Kathmandu", supervisorEId: "9002", status: "Active", terminationDate: addDays(today(), -10) }
      ] };
    }
    if (path.startsWith("meta/time_off/types")) return { timeOffTypes: TYPES };
    if (path.startsWith("time_off/requests")) {
      const s = query?.start ?? "0000", e = query?.end ?? "9999";
      const statuses = (query?.status ?? "").split(",");
      return requests2().map((r) => demoStatus.has(r.id) ? { ...r, status: { ...r.status, status: demoStatus.get(r.id) } } : r).filter((r) => r.end >= s && r.start <= e && (!statuses[0] || statuses.includes(r.status.status)));
    }
    if (path.startsWith("time_off/whos_out")) {
      return HOLIDAYS.map((h, i) => ({ id: i + 1, type: "holiday", ...h }));
    }
    throw new Error("demo: unknown path " + path);
  };
  return {
    get: respond,
    post: (path, _body, query) => respond(path, query),
    put: async (path, body) => {
      await new Promise((r) => setTimeout(r, 300));
      const m = /^time_off\/requests\/([^/]+)\/status$/.exec(path);
      if (!m) throw new Error("demo: unknown path " + path);
      demoStatus.set(decodeURIComponent(m[1]), String(body?.status));
      return null;
    }
  };
}

// ../../../../../../../Users/nirajmaharjan/sandbox/tinyjsapp-examples/leave-radar/backend/bamboo/mappers.ts
var str = (v) => v === null || v === void 0 || v === "" ? null : String(v);
function isActiveEmployee(e, t) {
  const status2 = str(e?.status ?? e?.employmentStatus);
  if (status2 && status2.toLowerCase() !== "active") return false;
  const term = str(e?.terminationDate);
  if (term && isDate(term) && term !== "0000-00-00" && term < t) return false;
  return true;
}
function mapEmployees(json, t = today()) {
  const list = Array.isArray(json?.employees) ? json.employees : Array.isArray(json) ? json : [];
  const out = [];
  for (const e of list) {
    const id = str(e?.id);
    if (!id) continue;
    const name = str(e.displayName) ?? ([e.preferredName || e.firstName, e.lastName].filter(Boolean).join(" ") || `Employee ${id}`);
    out.push({
      id,
      displayName: name,
      team: null,
      // squad comes from the local squads mapping, not BambooHR
      location: str(e.location),
      // supervisorEId = the manager's employee id; supervisorId is their
      // employee NUMBER in some tenants, so it is only a fallback (verify)
      reportsToId: str(e.supervisorEId) ?? str(e.supervisorId) ?? null,
      active: isActiveEmployee(e, t),
      inScope: false
    });
  }
  return out;
}
function mapTypes(json) {
  const list = Array.isArray(json?.timeOffTypes) ? json.timeOffTypes : Array.isArray(json) ? json : [];
  return list.filter((t) => str(t?.id) && str(t?.name)).map((t) => ({ id: String(t.id), name: String(t.name) }));
}
function mapRequest(raw, syncedAt) {
  const id = str(raw?.id);
  const employeeId = str(raw?.employeeId);
  const start = raw?.start, end = raw?.end;
  if (!id || !employeeId || !isDate(start) || !isDate(end)) return null;
  const status2 = typeof raw.status === "object" ? raw.status?.status : raw.status;
  const amount = raw.amount && raw.amount.amount !== void 0 ? Number(raw.amount.amount) : null;
  return {
    id,
    employeeId,
    bambooStatus: String(status2 || "requested").toLowerCase(),
    typeId: str(raw.type?.id) ?? "unknown",
    typeName: str(raw.type?.name) ?? "Unknown",
    startDate: start,
    endDate: end < start ? start : end,
    amount: Number.isFinite(amount) ? amount : null,
    amountUnit: str(raw.amount?.unit),
    requestedAt: isDate(raw.created) ? raw.created : null,
    syncedAt
  };
}
function requestDates(raw) {
  if (!raw?.dates || typeof raw.dates !== "object") return null;
  const out = {};
  for (const [d, v] of Object.entries(raw.dates)) {
    const n2 = Number(v);
    if (isDate(d) && Number.isFinite(n2)) out[d] = n2;
  }
  return Object.keys(out).length ? out : null;
}
function expandDays(req, dates, isHoliday, hoursPerDay = 8) {
  const toFraction = (v) => Math.max(0, Math.min(1, req.amountUnit === "hours" ? v / hoursPerDay : v));
  const rows = [];
  const push = (day, fraction) => {
    if (fraction <= 0 || isWeekend(day) || isHoliday(day)) return;
    rows.push({ requestId: req.id, employeeId: req.employeeId, day, fraction: Math.round(fraction * 100) / 100 });
  };
  if (dates) {
    for (const day of Object.keys(dates).sort()) push(day, toFraction(dates[day]));
    return rows;
  }
  const days2 = eachDay(req.startDate, req.endDate);
  if (days2.length === 1 && req.amount !== null && req.amount > 0) {
    push(days2[0], toFraction(req.amount));
    return rows;
  }
  for (const day of days2) push(day, 1);
  return rows;
}
function mapHolidays(json) {
  const list = Array.isArray(json) ? json : [];
  const out = [];
  for (const h of list) {
    if (h?.type !== "holiday" || !isDate(h.start)) continue;
    const end = isDate(h.end) && h.end >= h.start ? h.end : h.start;
    for (const day of eachDay(h.start, end)) {
      out.push({ day, location: "*", name: String(h.name || "Holiday") });
    }
  }
  return out;
}

// ../../../../../../../Users/nirajmaharjan/sandbox/tinyjsapp-examples/leave-radar/backend/teams.ts
var TEAM_COLORS = ["#3b82f6", "#10b981", "#8b5cf6", "#f59e0b", "#ec4899", "#14b8a6", "#f97316", "#64748b"];
var HEX = /^#[0-9a-f]{6}$/i;
var nextColor = (used) => TEAM_COLORS.find((c) => !used.includes(c.toLowerCase())) ?? TEAM_COLORS[used.length % TEAM_COLORS.length];
var FILE = "teams.json";
var state = { selected: ["default"], teams: [{ id: "default", name: "My team", color: TEAM_COLORS[0] }] };
async function loadTeams() {
  try {
    const json = JSON.parse(new TextDecoder().decode(await tjs.readFile(dataPath(FILE))));
    const teams2 = Array.isArray(json?.teams) ? json.teams.filter((t) => typeof t?.id === "string" && /^[a-z0-9-]{1,40}$/.test(t.id)).map((t) => ({ id: t.id, name: String(t.name || "Team").slice(0, 60), color: HEX.test(t.color) ? String(t.color).toLowerCase() : "" })) : [];
    if (!teams2.length) return;
    for (const t of teams2) if (!t.color) t.color = nextColor(teams2.map((x) => x.color).filter(Boolean));
    const raw = Array.isArray(json.selected) ? json.selected : json.active ? [json.active] : [];
    const selected = raw.filter((id) => teams2.some((t) => t.id === id));
    state = { teams: teams2, selected: selected.length ? selected : [teams2[0].id] };
  } catch {
  }
}
async function save() {
  await tjs.writeFile(dataPath(FILE), new TextEncoder().encode(JSON.stringify(state, null, 2) + "\n"));
}
var teams = () => state.teams.map((t) => ({ ...t }));
var selectedIds = () => [...state.selected];
var selectedTeams = () => state.teams.filter((t) => state.selected.includes(t.id));
var primaryTeam = () => selectedTeams()[0] ?? state.teams[0];
var legacyDbFileFor = (id) => id === "default" ? null : `leave-radar-${id}.sqlite`;
var teamKey = (id, name) => id === "default" ? name : `team.${id}.${name}`;
var secretName = teamKey;
function withoutTeamNames(map) {
  const names = new Set(state.teams.map((t) => t.name.trim().toLowerCase()));
  return Object.fromEntries(Object.entries(map).filter(([, sq]) => !names.has(String(sq).trim().toLowerCase())));
}
async function setSelected(ids) {
  const ok = ids.filter((id, i) => ids.indexOf(id) === i && state.teams.some((t) => t.id === id));
  if (!ok.length) throw new Error("Pick at least one team.");
  state.selected = ok;
  await save();
}
async function setTeamColor(id, color) {
  const t = state.teams.find((x) => x.id === id);
  if (!t) throw new Error("No such team.");
  if (!HEX.test(color)) throw new Error("Pick a colour like #3b82f6.");
  t.color = color.toLowerCase();
  await save();
}
async function addTeam(name, color) {
  const clean = cleanName(name);
  if (state.teams.some((t2) => t2.name.toLowerCase() === clean.toLowerCase())) throw new Error(`There is already a team called \u201C${clean}\u201D.`);
  const base2 = clean.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "team";
  let id = base2, n2 = 2;
  while (id === "default" || state.teams.some((t2) => t2.id === id)) id = `${base2}-${n2++}`;
  const t = { id, name: clean, color: color && HEX.test(color) ? color.toLowerCase() : nextColor(state.teams.map((x) => x.color)) };
  state.teams.push(t);
  await save();
  return t;
}
async function renameTeam(id, name) {
  const t = state.teams.find((x) => x.id === id);
  if (!t) throw new Error("No such team.");
  const clean = cleanName(name);
  if (state.teams.some((x) => x.id !== id && x.name.toLowerCase() === clean.toLowerCase())) throw new Error(`There is already a team called \u201C${clean}\u201D.`);
  t.name = clean;
  await save();
}
async function removeTeam(id) {
  state.teams = state.teams.filter((t) => t.id !== id);
  if (!state.teams.length) state.teams = [{ id: "default", name: "My team", color: TEAM_COLORS[0] }];
  state.selected = state.selected.filter((s) => state.teams.some((t) => t.id === s));
  if (!state.selected.length) state.selected = [state.teams[0].id];
  await save();
}
function cleanName(name) {
  const s = String(name ?? "").trim().replace(/\s+/g, " ").slice(0, 60);
  if (!s) throw new Error("Give the team a name, e.g. \u201CSOC\u201D or \u201CData Platform\u201D.");
  return s;
}

// ../../../../../../../Users/nirajmaharjan/sandbox/tinyjsapp-examples/leave-radar/backend/secrets.ts
var KEY = "bamboohr.apiKey";
var DOMAIN = "bamboohr.companyDomain";
var SLACK = "digest.slackWebhook";
var n = (name, team = primaryTeam().id) => secretName(team, name);
async function getCredentials(app, team) {
  const [apiKey, companyDomain] = await Promise.all([app.secrets.get(n(KEY, team)), app.secrets.get(n(DOMAIN, team))]);
  return apiKey && companyDomain ? { apiKey, companyDomain } : null;
}
async function setCredentials(app, companyDomain, apiKey, team) {
  await app.secrets.set(n(DOMAIN, team), companyDomain);
  await app.secrets.set(n(KEY, team), apiKey);
}
async function getSlackWebhook(app) {
  return app.secrets.get(SLACK);
}
async function setSlackWebhook(app, url) {
  if (url) await app.secrets.set(SLACK, url);
  else await app.secrets.delete(SLACK);
}
async function clearAll(app, team) {
  await Promise.all([app.secrets.delete(n(KEY, team)), app.secrets.delete(n(DOMAIN, team))]);
}

// ../../../../../../../Users/nirajmaharjan/sandbox/tinyjsapp-examples/leave-radar/backend/sync/orgTree.ts
function childrenMap(employees) {
  const kids = /* @__PURE__ */ new Map();
  for (const e of employees) {
    if (!e.reportsToId || e.reportsToId === e.id) continue;
    const list = kids.get(e.reportsToId);
    if (list) list.push(e.id);
    else kids.set(e.reportsToId, [e.id]);
  }
  return kids;
}
function subtree(employees, rootId) {
  const kids = childrenMap(employees);
  const seen = /* @__PURE__ */ new Set();
  const stack = [...kids.get(rootId) ?? []];
  while (stack.length) {
    const id = stack.pop();
    if (id === rootId || seen.has(id)) continue;
    seen.add(id);
    for (const k of kids.get(id) ?? []) stack.push(k);
  }
  return seen;
}
function markScope(employees, rootId) {
  const s = subtree(employees, rootId);
  return employees.map((e) => ({ ...e, inScope: s.has(e.id) && e.active !== false }));
}

// ../../../../../../../Users/nirajmaharjan/sandbox/tinyjsapp-examples/leave-radar/backend/sync/scheduler.ts
var SYNC_EVERY_MS = 15 * 6e4;
var DAILY_MS = 24 * 36e5;
var REPORT_FIELDS = ["id", "displayName", "firstName", "lastName", "location", "supervisorEId", "supervisorId", "status", "terminationDate"];
var running = null;
var timer2 = null;
var lastError = null;
var lastRunAt = null;
var syncState = () => ({ syncing: running !== null, lastError, lastRunAt });
var teamSetting = (team, key, fallback) => getSetting(teamKey(team, key), fallback);
var setTeamSetting = (team, key, value) => setSetting(teamKey(team, key), value);
async function clientFor(app, team = primaryTeam().id) {
  if (teamSetting(team, "demo", false)) {
    const demoTeams = teams().filter((t) => teamSetting(t.id, "demo", false)).map((t) => t.id);
    const root = demoRootFor(demoTeams.indexOf(team), demoTeams.length);
    return { client: createDemoClient(root), demo: true, demoRoot: root };
  }
  const creds = await getCredentials(app, team);
  return creds ? { client: createClient(creds.companyDomain, creds.apiKey), demo: false } : null;
}
function resetSyncState() {
  lastError = null;
  lastRunAt = null;
}
function syncNow(app, opts = {}) {
  if (running) return running;
  running = doSync(app, !!opts.full).finally(() => {
    running = null;
    app.push("status-changed");
  });
  app.push("status-changed");
  return running;
}
async function doSync(app, full) {
  lastRunAt = (/* @__PURE__ */ new Date()).toISOString();
  const errors = [];
  let any = false;
  for (const team of selectedTeams()) {
    const c = await clientFor(app, team.id);
    if (!c) continue;
    any = true;
    const err = await syncTeam(team, c.client, c.demo, full, c.demoRoot);
    if (err) errors.push(selectedTeams().length > 1 ? `${team.name}: ${err}` : err);
  }
  applyScope(selectedIds());
  lastError = !any ? "Not set up" : errors.length ? errors.join(" \xB7 ") : null;
}
async function syncTeam(team, client, demo, full, demoRoot) {
  const t0 = Date.now();
  const at = (/* @__PURE__ */ new Date()).toISOString();
  try {
    const now = Date.now();
    const t = today();
    const from = minDate(addMonths(t, -3), t.slice(0, 4) + "-01-01"), to = addMonths(t, 12);
    const empAge = now - teamSetting(team.id, "employeesSyncedAt", 0);
    const rootChanged = demo && teamSetting(team.id, "demoRoot", "") !== demoRoot;
    if (full || rootChanged || empAge > DAILY_MS || teamMembers(team.id).length === 0) {
      const me = await client.get("employees/0", { fields: "id" });
      const myId = String(me?.id ?? "");
      if (!myId) throw new Error("BambooHR did not return your employee id");
      let raw2;
      try {
        raw2 = await client.post("reports/custom", { title: "Leave Radar", fields: REPORT_FIELDS }, { format: "JSON", onlyCurrent: "true" });
      } catch {
        raw2 = await client.get("employees/directory");
      }
      const squads = await loadSquads();
      const map = withoutTeamNames(squads.map);
      const emps = markScope(mapEmployees(raw2, t), myId).map((e) => ({ ...e, team: map[e.id] ?? null }));
      replaceTeamEmployees(team.id, emps);
      setTeamSetting(team.id, "myEmployeeId", myId);
      setTeamSetting(team.id, "employeesSyncedAt", now);
      if (demo) setTeamSetting(team.id, "demoRoot", demoRoot);
    }
    const metaAge = now - getSetting("metaSyncedAt", 0);
    if (full || metaAge > DAILY_MS) {
      replaceTypes(mapTypes(await client.get("meta/time_off/types")));
      const whosOut = await client.get("time_off/whos_out", { start: from, end: to });
      const local = await loadLocalHolidays();
      replaceHolidays([...mapHolidays(whosOut), ...local.filter((h) => h.day >= from && h.day <= to)], from, to);
      setSetting("metaSyncedAt", now);
    }
    replaceSprints(await loadSprints());
    const raw = await client.get("time_off/requests", {
      start: from,
      end: to,
      status: "approved,requested,denied,canceled,superceded"
    });
    const scoped = new Map(teamMembers(team.id).map((e) => [e.id, e.location]));
    const hol = holidayIndex(holidays(from, to));
    const hoursPerDay = getSetting("hoursPerDay", 8);
    const rows = [];
    const days2 = [];
    for (const r of Array.isArray(raw) ? raw : []) {
      const row = mapRequest(r, at);
      if (!row || !scoped.has(row.employeeId)) continue;
      rows.push(row);
      const loc = scoped.get(row.employeeId);
      days2.push(...expandDays(row, requestDates(r), (d) => hol(d, loc), hoursPerDay));
    }
    replaceRequests(rows, days2, from, to, from, team.id);
    logSync(at, true, rows.length, null, Date.now() - t0);
    return null;
  } catch (e) {
    const msg = String(e?.message ?? e);
    try {
      logSync(at, false, 0, `${team.name}: ${msg}`, Date.now() - t0);
    } catch {
    }
    return msg;
  }
}
function holidayIndex(list) {
  const set = new Set(list.map((h) => `${h.day}|${h.location}`));
  return (day, loc) => set.has(`${day}|*`) || set.has(`${day}|${loc}`);
}
function startLoop(app, opts = {}) {
  stopLoop();
  if (opts.immediate !== false) void syncNow(app);
  timer2 = setInterval(() => void syncNow(app), SYNC_EVERY_MS);
}
function stopLoop() {
  if (timer2) clearInterval(timer2);
  timer2 = null;
}
async function settle() {
  try {
    await running;
  } catch {
  }
}

// ../../../../../../../Users/nirajmaharjan/sandbox/tinyjsapp-examples/leave-radar/backend/queries.ts
var MAX_SPAN_DAYS = 400;
var DEFAULT_THRESHOLD = 0.3;
var DEFAULT_LINK = "https://{domain}.bamboohr.com/employees/pto/?id={employeeId}";
function normalize(f) {
  const t = today();
  let from = isDate(f?.from) ? f.from : t;
  let to = isDate(f?.to) ? f.to : addDays(t, 41);
  if (to < from) [from, to] = [to, from];
  if (diffDays(from, to) > MAX_SPAN_DAYS) to = addDays(from, MAX_SPAN_DAYS);
  const arr = (v) => Array.isArray(v) ? v.map(String).filter(Boolean) : [];
  const num = (v) => v === null || v === void 0 || v === "" || !Number.isFinite(Number(v)) ? null : Number(v);
  const statuses = arr(f?.statuses).filter((s) => ["planned", "draft", "denied", "canceled"].includes(s));
  return {
    from,
    to,
    statuses: statuses.length ? statuses : DEFAULT_STATUSES,
    types: arr(f?.types),
    people: arr(f?.people),
    teams: arr(f?.teams),
    locations: arr(f?.locations),
    minDays: num(f?.minDays),
    maxDays: num(f?.maxDays),
    requestedFrom: isDate(f?.requestedFrom) ? f.requestedFrom : null,
    requestedTo: isDate(f?.requestedTo) ? f.requestedTo : null,
    overlapOnly: !!f?.overlapOnly,
    overlapMinPeople: num(f?.overlapMinPeople),
    sprint: typeof f?.sprint === "string" ? f.sprint : null
  };
}
function thresholdFor(team) {
  const per = getSetting("thresholds", {});
  const v = per[team] ?? getSetting("defaultThreshold", DEFAULT_THRESHOLD);
  return v > 0 && v <= 1 ? v : DEFAULT_THRESHOLD;
}
function linkFor(employeeId, requestId) {
  const domain = getSetting("linkDomain", "") || getSetting("companyDomain", "");
  if (!domain) return "";
  const tpl = getSetting("linkTemplate", DEFAULT_LINK);
  return tpl.replaceAll("{domain}", encodeURIComponent(domain)).replaceAll("{employeeId}", encodeURIComponent(employeeId)).replaceAll("{requestId}", encodeURIComponent(requestId));
}
function load(f) {
  const active = (f.statuses ?? DEFAULT_STATUSES).filter(isActive);
  if (!active.length) return [];
  const people3 = people({ teams: f.teams, locations: f.locations });
  const days2 = days(f.from, f.to, bambooStatusesFor(active)).map((d) => ({ employeeId: d.employeeId, day: d.day, fraction: d.fraction, status: appStatus(d.bambooStatus), wfh: isWfhType(d.typeName) }));
  return teamLoad(people3, days2, f.from, f.to, thresholdFor, f.overlapOnly ? f.overlapMinPeople : null);
}
function overlapDaySet(f) {
  return new Set(load(f).filter((d) => d.flagged).map((d) => d.day));
}
function leave(fIn) {
  const f = normalize(fIn);
  const t = today();
  let rows = requests(f);
  if (f.minDays !== null && f.minDays !== void 0) rows = rows.filter((r) => r.days >= f.minDays - 1e-9);
  if (f.maxDays !== null && f.maxDays !== void 0) rows = rows.filter((r) => r.days <= f.maxDays + 1e-9);
  if (f.overlapOnly) {
    const flagged = overlapDaySet(f);
    const byReq = /* @__PURE__ */ new Map();
    for (const d of days(f.from, f.to)) {
      const l = byReq.get(d.requestId);
      if (l) l.push(d.day);
      else byReq.set(d.requestId, [d.day]);
    }
    rows = rows.filter((r) => (byReq.get(r.id) ?? []).some((d) => flagged.has(d)));
  }
  return rows.map((r) => ({
    ...r,
    status: appStatus(r.bambooStatus),
    days: Math.round(r.days * 100) / 100,
    requestAgeDays: r.requestedAt ? Math.max(0, diffDays(r.requestedAt, t)) : null,
    url: linkFor(r.employeeId, r.id)
  }));
}
var CODE = { planned: "P", draft: "D", denied: "X", canceled: "X" };
var RANK = { P: 3, D: 2, X: 1 };
function calendar(fIn) {
  const f = normalize(fIn);
  const records = leave(f);
  const ids = new Set(records.map((r) => r.id));
  const people3 = people(f);
  const dayLoad = load(f);
  const flagged = new Set(dayLoad.filter((d) => d.flagged).map((d) => d.day));
  let days2 = eachDay(f.from, f.to);
  if (f.overlapOnly) days2 = days2.filter((d) => flagged.has(d));
  const col = new Map(days2.map((d, i) => [d, i]));
  const row = new Map(people3.map((p, i) => [p.id, i]));
  const cells = people3.map(() => new Array(days2.length).fill(null));
  for (const d of days(f.from, f.to)) {
    if (!ids.has(d.requestId)) continue;
    const i = row.get(d.employeeId), j = col.get(d.day);
    if (i === void 0 || j === void 0) continue;
    const cell = { s: CODE[appStatus(d.bambooStatus)], f: d.fraction, t: d.typeName, id: d.requestId, w: isWfhType(d.typeName) ? 1 : 0 };
    const cur = cells[i][j];
    if (!cur) {
      cells[i][j] = cell;
      continue;
    }
    const better = RANK[cell.s] > RANK[cur.s] || RANK[cell.s] === RANK[cur.s] && cur.w === 1 && cell.w === 0;
    const sum = Math.min(1, cur.f + cell.f);
    if (better) cells[i][j] = cur.s === cell.s ? { ...cell, f: sum } : cell;
    else if (cur.s === cell.s) cells[i][j] = { ...cur, f: sum };
  }
  return {
    people: people3,
    days: days2,
    cells,
    holidays: holidays(f.from, f.to),
    load: dayLoad.filter((d) => col.has(d.day)),
    requests: Object.fromEntries(records.map((r) => [r.id, r]))
  };
}
function onLeaveIn(rows, from, to, who) {
  const m = /* @__PURE__ */ new Map();
  for (const d of rows) {
    if (d.day < from || d.day > to || isWfhType(d.typeName)) continue;
    const p = who.get(d.employeeId);
    if (!p) continue;
    const x = m.get(d.employeeId) ?? { employeeId: d.employeeId, person: p.name, team: p.team, planned: 0, draft: 0, first: d.day, last: d.day, types: [], url: "" };
    if (appStatus(d.bambooStatus) === "planned") x.planned += d.fraction;
    else x.draft += d.fraction;
    if (d.day < x.first) x.first = d.day;
    if (d.day > x.last) x.last = d.day;
    if (!x.types.includes(d.typeName)) x.types.push(d.typeName);
    if (!x.url) x.url = linkFor(d.employeeId, d.requestId);
    m.set(d.employeeId, x);
  }
  const r22 = (n2) => Math.round(n2 * 100) / 100;
  return [...m.values()].map((x) => ({ ...x, planned: r22(x.planned), draft: r22(x.draft) })).sort((a, b) => b.planned + b.draft - (a.planned + a.draft) || a.person.localeCompare(b.person));
}
function capacity(fIn, sprintName, byMonth = false) {
  const f = normalize(fIn);
  const sprints2 = byMonth ? [] : uniqueSprints().filter((s) => sprintName ? s.name === sprintName : s.endDate >= f.from && s.startDate <= f.to);
  const periods = byMonth ? monthPeriods(f.from, f.to) : sprints2.length ? sprints2.map((s) => ({ id: s.name, name: s.name, from: s.startDate, to: s.endDate })) : [{ id: "range", name: "Selected range", from: f.from, to: f.to }];
  const lo = periods.reduce((a, p) => minDate(a, p.from), periods[0].from);
  const hi = periods.reduce((a, p) => maxDate(a, p.to), periods[0].to);
  const people3 = people(f);
  const typeSet = f.types?.length ? new Set(f.types) : null;
  const reqType = /* @__PURE__ */ new Map();
  if (typeSet) for (const r of requests({ ...f, from: lo, to: hi, statuses: ["planned", "draft"], people: [], types: [] })) reqType.set(r.id, r.typeId);
  const rawDays = days(lo, hi, ["approved", "requested"]).filter((d) => !typeSet || typeSet.has(reqType.get(d.requestId) ?? ""));
  const days2 = rawDays.map((d) => ({ employeeId: d.employeeId, day: d.day, fraction: d.fraction, status: appStatus(d.bambooStatus), wfh: isWfhType(d.typeName) }));
  const hol = holidayIndex(holidays(lo, hi));
  const who = new Map(people3.map((p) => [p.id, { name: p.displayName, team: p.team }]));
  return periods.map((p) => {
    const ld = load({ ...f, from: p.from, to: p.to, statuses: ["planned", "draft"], overlapOnly: false });
    return {
      ...p,
      teams: capacityByTeam(people3, days2, p.from, p.to, hol).map((t) => ({
        ...t,
        threshold: thresholdFor(t.team),
        overlapDays: ld.filter((d) => d.teams.some((x) => x.team === t.team && x.flagged)).length
      })),
      onLeave: onLeaveIn(rawDays, p.from, p.to, who)
    };
  });
}
var capTotals = (teams2) => {
  const s = (k) => Math.round(teams2.reduce((a, t) => a + t[k], 0) * 100) / 100;
  return {
    working: s("available"),
    plannedOut: s("plannedOut"),
    draftOut: s("draftOut"),
    wfh: s("wfh"),
    available: s("netPlanned"),
    ifDrafts: s("net"),
    headcount: teams2.reduce((a, t) => a + t.headcount, 0)
  };
};
function quarterCapacity(fIn, year2, q2) {
  const f = normalize(fIn);
  const t = today();
  const yr = Number.isInteger(year2) && year2 > 1990 && year2 < 2200 ? year2 : Number(t.slice(0, 4));
  const qq = q2 >= 1 && q2 <= 4 ? Math.floor(q2) : Math.floor((Number(t.slice(5, 7)) - 1) / 3) + 1;
  const from = `${yr}-${String((qq - 1) * 3 + 1).padStart(2, "0")}-01`;
  const to = addDays(addMonths(from, 3), -1);
  const people3 = people(f);
  const typeSet = f.types?.length ? new Set(f.types) : null;
  const reqType = /* @__PURE__ */ new Map();
  if (typeSet) for (const r of requests({ ...f, from, to, statuses: ["planned", "draft"], people: [], types: [] })) reqType.set(r.id, r.typeId);
  const days2 = days(from, to, ["approved", "requested"]).filter((d) => !typeSet || typeSet.has(reqType.get(d.requestId) ?? "")).map((d) => ({ employeeId: d.employeeId, day: d.day, fraction: d.fraction, status: appStatus(d.bambooStatus), wfh: isWfhType(d.typeName) }));
  const hol = holidayIndex(holidays(from, to));
  const teams2 = capacityByTeam(people3, days2, from, to, hol);
  const months = [0, 1, 2].map((i) => {
    const mFrom = addMonths(from, i), mTo = addDays(addMonths(from, i + 1), -1);
    return { month: mFrom.slice(0, 7), from: mFrom, to: mTo, ...capTotals(capacityByTeam(people3, days2, mFrom, mTo, hol)) };
  });
  return {
    year: yr,
    q: qq,
    from,
    to,
    today: t,
    total: capTotals(teams2),
    months,
    teams: teams2.map((x) => ({ team: x.team, ...capTotals([x]) }))
  };
}
function overlaps(fIn, threshold) {
  const f = normalize(fIn);
  const active = (f.statuses ?? DEFAULT_STATUSES).filter(isActive);
  const people3 = people({ teams: f.teams, locations: f.locations });
  const days2 = days(f.from, f.to, bambooStatusesFor(active)).map((d) => ({ employeeId: d.employeeId, day: d.day, fraction: d.fraction, status: appStatus(d.bambooStatus), wfh: isWfhType(d.typeName) }));
  const th = threshold && threshold > 0 ? () => threshold : thresholdFor;
  return teamLoad(people3, days2, f.from, f.to, th).filter((d) => d.flagged);
}
function summary(fIn) {
  const f = normalize(fIn);
  const t = today();
  const active = (f.statuses ?? DEFAULT_STATUSES).filter(isActive);
  const todayIds = active.length ? new Set(leave({ ...f, from: t, to: t, overlapOnly: false, statuses: active }).map((r) => r.id)) : /* @__PURE__ */ new Set();
  const outToday = new Set(days(t, t).filter((d) => todayIds.has(d.requestId)).map((d) => d.employeeId));
  const drafts = leave({ ...f, statuses: ["draft"] });
  return {
    peopleOutToday: outToday.size,
    draftRequests: drafts.length,
    oldestDraftDays: drafts.reduce((m, r) => Math.max(m, r.requestAgeDays ?? 0), 0),
    overlapDays: overlapDaySet({ ...f, overlapOnly: false }).size
  };
}
function dashboard(fIn) {
  const f = normalize(fIn);
  const t = today();
  const r = dashRanges(t);
  const sprints2 = uniqueSprints();
  const picked = pickSprints(t, sprints2);
  let lo = minDate(r.month.from, t), hi = maxDate(r.month.to, r.nextWeek.to);
  for (const s of picked) {
    lo = minDate(lo, s.startDate);
    hi = maxDate(hi, s.endDate);
  }
  const recs = requests({ from: lo, to: hi, statuses: ["planned", "draft", "denied"], teams: f.teams, people: f.people, locations: f.locations }).map((x) => ({
    id: x.id,
    employeeId: x.employeeId,
    person: x.person,
    team: x.team,
    status: appStatus(x.bambooStatus),
    typeName: x.typeName,
    startDate: x.startDate,
    endDate: x.endDate,
    url: linkFor(x.employeeId, x.id)
  }));
  return buildDashboard(t, recs, days(lo, hi, ["approved", "requested", "denied"]), sprints2);
}
function year(fIn, y) {
  const f = normalize(fIn);
  const t = today();
  const yr = Number.isInteger(y) && y > 1990 && y < 2200 ? y : Number(t.slice(0, 4));
  const from = `${yr}-01-01`, to = `${yr}-12-31`;
  const recs = requests({ from, to, statuses: ["planned", "draft"], teams: f.teams, people: f.people, locations: f.locations }).map((x) => ({
    id: x.id,
    employeeId: x.employeeId,
    person: x.person,
    team: x.team,
    status: appStatus(x.bambooStatus),
    typeName: x.typeName,
    startDate: x.startDate,
    endDate: x.endDate
  }));
  return yearSummary(yr, t, recs, days(from, to, ["approved", "requested"]), earliestDay());
}
function longLeave(fIn, y) {
  const f = normalize(fIn);
  const t = today();
  const yr = Number.isInteger(y) && y > 1990 && y < 2200 ? y : Number(t.slice(0, 4));
  const from = addDays(`${yr}-01-01`, -45), to = addDays(`${yr}-12-31`, 45);
  const recs = requests({ from, to, statuses: ["planned", "draft"], teams: f.teams, people: f.people, locations: f.locations }).filter((x) => countsAsLongLeave(x.typeName)).map((x) => ({
    id: x.id,
    employeeId: x.employeeId,
    person: x.person,
    team: x.team,
    status: appStatus(x.bambooStatus),
    typeName: x.typeName,
    startDate: x.startDate,
    endDate: x.endDate,
    url: linkFor(x.employeeId, x.id)
  }));
  const loc = new Map(people().map((p) => [p.id, p.location]));
  const hol = holidayIndex(holidays(from, to));
  const days2 = days(from, to, ["approved", "requested"]).filter((d) => countsAsLongLeave(d.typeName));
  const runs = findRuns(recs, days2, (d, emp) => hol(d, loc.get(emp) ?? ""));
  return longLeaveYear(yr, t, runs, earliestDay());
}
function uniqueSprints() {
  const seen = /* @__PURE__ */ new Map();
  for (const s of sprints()) {
    const cur = seen.get(s.name) ?? { name: s.name, startDate: s.startDate, endDate: s.endDate, boards: {} };
    if (s.board) cur.boards[s.board] = s.id.split(":").pop();
    seen.set(s.name, cur);
  }
  return [...seen.values()].sort((a, b) => a.startDate.localeCompare(b.startDate));
}
function lookups() {
  return {
    teams: distinct("team"),
    locations: distinct("location"),
    types: leaveTypes(),
    people: people().map((p) => ({ id: p.id, name: p.displayName, team: p.team, location: p.location })),
    sprints: uniqueSprints()
  };
}
function digest() {
  const t = today();
  const to = addDays(t, 13);
  const recs = leave({ from: t, to, statuses: ["planned", "draft"] }).filter((r) => r.days > 0);
  const flagged = overlaps({ from: t, to });
  const lines = [];
  const title = `Leave Radar \u2014 next two weeks (${t} \u2192 ${to})`;
  lines.push(title, "");
  if (!recs.length) lines.push("Nobody is out or has leave pending.");
  const ord = teamOrder();
  const byTeam = /* @__PURE__ */ new Map();
  for (const r of recs) {
    const l = byTeam.get(r.team);
    if (l) l.push(r);
    else byTeam.set(r.team, [r]);
  }
  const teams2 = [...byTeam].sort((a, b) => (ord.get(a[0]) ?? 1e3) - (ord.get(b[0]) ?? 1e3) || a[0].localeCompare(b[0]));
  for (const [team, list] of teams2) {
    lines.push(`*${team}* (${list.length})`);
    for (const r of list) {
      lines.push(`  \u2022 ${r.person} \u2014 ${r.typeName}, ${r.startDate}${r.endDate !== r.startDate ? " \u2192 " + r.endDate : ""}, ${r.days} d${r.status === "draft" ? " \u2014 DRAFT, awaiting approval" : ""}`);
    }
    lines.push("");
  }
  const drafts = recs.filter((r) => r.status === "draft").length;
  lines.push("", `Draft requests waiting: ${drafts}`);
  if (flagged.length) {
    lines.push("Low-capacity days:");
    for (const d of flagged) {
      for (const tm of d.teams.filter((x) => x.flagged)) lines.push(`  ${d.day}: ${tm.team} ${Math.round(tm.share * 100)}% out (${tm.out}/${tm.size})`);
    }
  } else lines.push("No low-capacity days.");
  return { title, text: lines.join("\n") };
}
var MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function monthPeriods(from, to) {
  const out = [];
  for (let m = from.slice(0, 7) + "-01"; m <= to && out.length < 36; m = addMonths(m, 1)) {
    const end = addDays(addMonths(m, 1), -1);
    out.push({ id: m.slice(0, 7), name: `${MONTH_NAMES[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`, from: maxDate(m, from), to: minDate(end, to) });
  }
  return out;
}

// ../../../../../../../Users/nirajmaharjan/sandbox/tinyjsapp-examples/leave-radar/backend/main.ts
var DB_FILE = "leave-radar.sqlite";
var dbFile = () => DB_FILE;
var ready = null;
var whenReady = () => ready ?? Promise.reject(new Error("backend not initialised"));
var DIGEST_DEFAULT = { enabled: false, weekday: 1, hour: 9, lastSent: null };
async function teamConfigured(app, team) {
  return teamSetting(team, "demo", false) || !!await getCredentials(app, team);
}
async function isConfigured(app) {
  for (const t of selectedIds()) if (await teamConfigured(app, t)) return true;
  return false;
}
async function status(app) {
  const last = lastSync();
  const good = lastGoodSync();
  const s = syncState();
  const c = counts();
  return {
    configured: await isConfigured(app),
    demo: selectedIds().some((t) => teamSetting(t, "demo", false)),
    companyDomain: teamSetting(primaryTeam().id, "companyDomain", ""),
    syncing: s.syncing,
    lastSyncAt: good?.at ?? null,
    lastAttemptAt: last?.at ?? null,
    lastDurationMs: good?.duration_ms ?? null,
    lastRecords: good?.records ?? null,
    lastError: last && !last.ok ? last.error : null,
    recordCount: c.requests,
    peopleCount: c.people,
    myEmployeeId: teamSetting(primaryTeam().id, "myEmployeeId", null),
    team: primaryTeam(),
    teams: teams(),
    selected: selectedIds()
  };
}
async function writeExport(path, filters, sort, format) {
  if (typeof path !== "string" || !path.startsWith("/")) throw new Error("Choose where to save the file.");
  const rows = sortRecords(leave(filters), sort);
  const bytes = format === "xlsx" ? toXlsx(rows) : new TextEncoder().encode(toCsv(rows));
  await tjs.writeFile(path, bytes);
  return { path, rows: rows.length };
}
async function deleteCacheFiles(file = dbFile()) {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      await tjs.remove(dataPath(file + suffix));
    } catch {
    }
  }
}
var syncTeamInfo = () => setTeamInfo([...selectedTeams(), ...teams().filter((t) => !selectedIds().includes(t.id))]);
async function reselect(app, ids) {
  stopLoop();
  await settle();
  await setSelected(ids);
  syncTeamInfo();
  applyScope(selectedIds());
  resetSyncState();
  if (await isConfigured(app)) startLoop(app);
  for (const ev of ["status-changed", "data-changed", "views-changed"]) app.push(ev);
}
function markTeamReal(team, domain, myEmployeeId) {
  if (teamSetting(team, "demo", false)) {
    removeTeamData(team);
    setTeamSetting(team, "employeesSyncedAt", 0);
  }
  setTeamSetting(team, "demo", false);
  setTeamSetting(team, "companyDomain", domain);
  setTeamSetting(team, "myEmployeeId", myEmployeeId);
  setSetting("linkDomain", domain);
}
function markTeamDemo(team) {
  removeTeamData(team);
  setTeamSetting(team, "demo", true);
  setTeamSetting(team, "companyDomain", "demo");
  setTeamSetting(team, "employeesSyncedAt", 0);
  setTeamSetting(team, "demoRoot", "");
}
async function dropTeam(app, id) {
  await clearAll(app, id);
  removeTeamData(id);
  for (const k of ["demo", "companyDomain", "myEmployeeId", "employeesSyncedAt"]) deleteSetting(teamKey(id, k));
  await removeTeam(id);
}
async function checkKey(companyDomain, apiKey) {
  const domain = cleanDomain(companyDomain);
  const key = String(apiKey || "").trim();
  if (key.length < 10) throw new Error("That does not look like a BambooHR API key.");
  let me;
  try {
    me = await createClient(domain, key).get("employees/0", { fields: "id,displayName" });
  } catch (e) {
    throw new Error(e instanceof BambooError ? e.message : "Could not reach BambooHR.");
  }
  const myEmployeeId = String(me?.id ?? "");
  if (!myEmployeeId) throw new Error("BambooHR accepted the key but returned no employee for it.");
  return { domain, key, myEmployeeId };
}
async function postSlack(app, text) {
  const hook = await getSlackWebhook(app);
  if (!hook) throw new Error("Add a Slack incoming-webhook URL in Settings first.");
  const res = await fetch(hook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
  if (!res.ok) throw new Error(`Slack returned ${res.status}`);
}
function manualSquads(list, map) {
  const teamNames = new Set(teams().map((t) => t.name.trim().toLowerCase()));
  const used = new Set(Object.values(map));
  return [.../* @__PURE__ */ new Set([...list, ...used])].filter((q2) => q2 && !teamNames.has(q2.trim().toLowerCase()));
}
async function settings(app) {
  const squads = await loadSquads();
  return {
    defaultThreshold: getSetting("defaultThreshold", DEFAULT_THRESHOLD),
    thresholds: getSetting("thresholds", {}),
    linkTemplate: getSetting("linkTemplate", DEFAULT_LINK),
    hoursPerDay: getSetting("hoursPerDay", 8),
    // extra squads only — team names are listed as teams, never repeated here
    squads: manualSquads(squads.squads, withoutTeamNames(squads.map)),
    squadMap: withoutTeamNames(squads.map),
    people: (() => {
      const auto = autoTeams();
      return allEmployees().filter((e) => e.inScope).map((e) => ({ id: e.id, name: e.displayName, team: e.team, autoTeam: auto[e.id] ?? null })).sort((a, b) => (a.autoTeam ?? "").localeCompare(b.autoTeam ?? "") || a.name.localeCompare(b.name));
    })(),
    digest: getSetting("digest", DIGEST_DEFAULT),
    hasSlackWebhook: !!await getSlackWebhook(app)
  };
}
var api = {
  // ---- setup / status / sync ----------------------------------------------
  setup: async ({ companyDomain, apiKey, teamName, color }, app) => {
    await whenReady();
    const { domain, key, myEmployeeId } = await checkKey(companyDomain, apiKey);
    const team = primaryTeam().id;
    if (color) await setTeamColor(team, color);
    if (teamName?.trim()) {
      await renameTeam(team, teamName);
      syncTeamInfo();
    }
    stopLoop();
    await settle();
    await setCredentials(app, domain, key, team);
    markTeamReal(team, domain, myEmployeeId);
    resetSyncState();
    startLoop(app);
    return { ok: true, myEmployeeId };
  },
  setupDemo: async ({ teamName, color } = {}, app) => {
    await whenReady();
    const team = primaryTeam().id;
    if (color) await setTeamColor(team, color);
    if (teamName?.trim()) {
      await renameTeam(team, teamName);
      syncTeamInfo();
    }
    stopLoop();
    await settle();
    markTeamDemo(team);
    resetSyncState();
    await syncNow(app, { full: true });
    startLoop(app, { immediate: false });
    return status(app);
  },
  getStatus: async (_, app) => {
    await whenReady();
    return status(app);
  },
  syncNow: async (_, app) => {
    await whenReady();
    await syncNow(app, { full: true });
    return status(app);
  },
  getSyncLog: async () => {
    await whenReady();
    return syncLog(20);
  },
  // ---- reads (SQLite only) ----------------------------------------------------
  getLeave: async ({ filters, sort }) => {
    await whenReady();
    return sortRecords(leave(filters), sort);
  },
  getCalendar: async ({ filters }) => {
    await whenReady();
    return calendar(filters);
  },
  getCapacity: async ({ filters, sprintId, byMonth }) => {
    await whenReady();
    return capacity(filters, sprintId, byMonth === true);
  },
  getOverlaps: async ({ filters, threshold }) => {
    await whenReady();
    return overlaps(filters, threshold);
  },
  getDashboard: async ({ filters }) => {
    await whenReady();
    return dashboard(filters);
  },
  getYearSummary: async ({ filters, year: year2 }) => {
    await whenReady();
    return year(filters, Number(year2));
  },
  getLongLeave: async ({ filters, year: year2 }) => {
    await whenReady();
    return longLeave(filters, Number(year2));
  },
  // ---- writes to BambooHR (the only ones) -----------------------------------
  /** approve one draft (requested) leave request. Only for people in my
   *  reporting line, only from "requested"; BambooHR itself decides whether
   *  this account may approve it. */
  approveRequest: async ({ id }, app) => {
    await whenReady();
    const req = requestById(String(id ?? ""));
    if (!req || !req.inScope) throw new Error("That request is not in your team\u2019s leave.");
    if (req.bambooStatus !== "requested") throw new Error("Only draft (requested) leave can be approved \u2014 this one is already " + req.bambooStatus + ".");
    const teamIds = teamsOf(req.employeeId, selectedIds());
    let c = null;
    for (const t of teamIds) if (c = await clientFor(app, t)) break;
    if (!c) throw new Error("Not signed in to BambooHR for this person\u2019s team.");
    try {
      await c.client.put(`time_off/requests/${encodeURIComponent(req.id)}/status`, { status: "approved" });
    } catch (e) {
      const st = e instanceof BambooError ? e.status : 0;
      throw new Error(
        st === 403 ? "BambooHR refused: your account can\u2019t approve this request (only its approver can)." : st === 404 ? "BambooHR no longer has this request \u2014 it may have been cancelled. Refresh to update." : st === 400 || st === 409 ? "BambooHR wouldn\u2019t change it \u2014 it may already be approved or cancelled. Refresh to update." : e instanceof Error ? e.message : "Could not reach BambooHR."
      );
    }
    setRequestStatus(req.id, "approved");
    app.push("data-changed");
    return { ok: true };
  },
  getQuarterCapacity: async ({ filters, year: year2, q: q2 }) => {
    await whenReady();
    return quarterCapacity(filters, Number(year2), Number(q2));
  },
  getSummary: async ({ filters }) => {
    await whenReady();
    return summary(filters);
  },
  getLookups: async () => {
    await whenReady();
    return { ...lookups(), today: today() };
  },
  // ---- saved views --------------------------------------------------------------
  listViews: async () => {
    await whenReady();
    return listViews();
  },
  saveView: async ({ name, filters }, app) => {
    await whenReady();
    const n2 = String(name || "").trim().slice(0, 80);
    if (!n2) throw new Error("Give the view a name.");
    saveView(n2, filters ?? {});
    app.push("views-changed");
    return listViews();
  },
  deleteView: async ({ name }, app) => {
    await whenReady();
    deleteView(String(name));
    app.push("views-changed");
    return listViews();
  },
  // ---- export (the page picks the path with the native save dialog) -----------
  exportCsv: async ({ filters, sort, path }) => {
    await whenReady();
    return writeExport(path, filters, sort, "csv");
  },
  exportXlsx: async ({ filters, sort, path }) => {
    await whenReady();
    return writeExport(path, filters, sort, "xlsx");
  },
  // ---- settings ---------------------------------------------------------------
  getSettings: async (_, app) => {
    await whenReady();
    return settings(app);
  },
  saveSettings: async (s, app) => {
    await whenReady();
    const frac = (v) => {
      const n2 = Number(v);
      return n2 > 0 && n2 <= 1 ? n2 : null;
    };
    if (s.defaultThreshold !== void 0 && frac(s.defaultThreshold)) setSetting("defaultThreshold", frac(s.defaultThreshold));
    if (s.thresholds && typeof s.thresholds === "object") {
      const t = {};
      for (const [k, v] of Object.entries(s.thresholds)) if (frac(v)) t[k] = frac(v);
      setSetting("thresholds", t);
    }
    if (typeof s.linkTemplate === "string" && /^https:\/\//.test(s.linkTemplate)) setSetting("linkTemplate", s.linkTemplate);
    if (s.hoursPerDay !== void 0 && Number(s.hoursPerDay) > 0 && Number(s.hoursPerDay) <= 24) setSetting("hoursPerDay", Number(s.hoursPerDay));
    if (s.digest && typeof s.digest === "object") {
      const cur = getSetting("digest", DIGEST_DEFAULT);
      setSetting("digest", {
        ...cur,
        enabled: !!s.digest.enabled,
        weekday: Math.max(0, Math.min(6, Number(s.digest.weekday ?? cur.weekday) | 0)),
        hour: Math.max(0, Math.min(23, Number(s.digest.hour ?? cur.hour) | 0))
      });
    }
    if (s.slackWebhook !== void 0) {
      const url = String(s.slackWebhook || "").trim();
      if (url && !/^https:\/\/hooks\.slack\.com\//.test(url)) throw new Error("Slack webhook URLs start with https://hooks.slack.com/");
      await setSlackWebhook(app, url || null);
    }
    if (s.squadMap && typeof s.squadMap === "object") {
      const map = {};
      for (const [id, team] of Object.entries(s.squadMap)) if (typeof team === "string" && team) map[id] = team;
      const clean = withoutTeamNames(map);
      const squads = manualSquads(Array.isArray(s.squads) ? s.squads.map(String).filter(Boolean) : [], clean);
      await saveSquads(clean, squads);
      applySquads(clean);
    }
    app.push("data-changed");
    return settings(app);
  },
  // ---- weekly digest -------------------------------------------------------------
  getDigest: async () => {
    await whenReady();
    return digest();
  },
  sendDigest: async (_, app) => {
    await whenReady();
    await postSlack(app, digest().text);
    setSetting("digest", { ...getSetting("digest", DIGEST_DEFAULT), lastSent: today() });
    return { ok: true };
  },
  // ---- resource panel (sampling runs only while it is open) ----------------------
  resourcesOpen: async (_, app) => {
    startSampling((s) => app.push("resources", s));
    return true;
  },
  resourcesClose: async () => {
    stopSampling();
    return true;
  },
  getResourceUsage: async () => {
    await whenReady();
    let dbSizeMb = 0;
    for (const suffix of ["", "-wal"]) {
      try {
        dbSizeMb += Number((await tjs.stat(dataPath(dbFile() + suffix))).size) / 1048576;
      } catch {
      }
    }
    const good = lastGoodSync();
    const s = latestSnapshot();
    const c = counts();
    return {
      processes: s?.processes ?? [],
      totals: s?.totals ?? null,
      attribution: s?.attribution ?? null,
      history: resourceHistory(),
      dbSizeMb: Math.round(dbSizeMb * 100) / 100,
      records: c.requests,
      leaveDays: c.days,
      people: c.people,
      lastSync: good ? { at: good.at, durationMs: good.duration_ms, records: good.records } : null
    };
  },
  // ---- teams: one API key per team; view one team or several at once --------
  /** view just this team */
  switchTeam: async ({ id }, app) => {
    await whenReady();
    await reselect(app, [String(id)]);
    return status(app);
  },
  /** view several teams at once (their union) */
  selectTeams: async ({ ids }, app) => {
    await whenReady();
    await reselect(app, Array.isArray(ids) ? ids.map(String) : []);
    return status(app);
  },
  /** new team: check its key first, store it under the new team, then view it */
  addTeam: async ({ name, companyDomain, apiKey, demo, color }, app) => {
    await whenReady();
    const checked = demo ? null : await checkKey(companyDomain ?? "", apiKey ?? "");
    const team = await addTeam(name, color);
    try {
      if (checked) {
        await setCredentials(app, checked.domain, checked.key, team.id);
        markTeamReal(team.id, checked.domain, checked.myEmployeeId);
      } else markTeamDemo(team.id);
      await reselect(app, [team.id]);
    } catch (e) {
      await dropTeam(app, team.id).catch(() => {
      });
      throw e;
    }
    return status(app);
  },
  setTeamColor: async ({ id, color }, app) => {
    await whenReady();
    await setTeamColor(id ? String(id) : primaryTeam().id, String(color ?? ""));
    app.push("status-changed");
    return status(app);
  },
  renameTeam: async ({ id, name }, app) => {
    await whenReady();
    await renameTeam(id ? String(id) : primaryTeam().id, name);
    {
      const sq = await loadSquads();
      const clean = withoutTeamNames(sq.map);
      await saveSquads(clean, manualSquads(sq.squads, clean));
      applySquads(clean);
    }
    syncTeamInfo();
    app.push("status-changed");
    app.push("data-changed");
    return status(app);
  },
  /** delete a team (default: the first selected): its key and its people */
  removeTeam: async ({ id } = {}, app) => {
    await whenReady();
    stopLoop();
    await settle();
    await dropTeam(app, id ? String(id) : primaryTeam().id);
    syncTeamInfo();
    applyScope(selectedIds());
    resetSyncState();
    if (await isConfigured(app)) startLoop(app);
    for (const ev of ["status-changed", "data-changed", "views-changed"]) app.push(ev);
    return status(app);
  },
  // ---- sign out = remove the (first selected) team ------------------------------
  signOut: async (_, app, meta) => api.removeTeam({}, app, meta)
};
async function maybeSendDigest(app) {
  const d = getSetting("digest", DIGEST_DEFAULT);
  if (!d.enabled || !await getSlackWebhook(app)) return;
  const now = /* @__PURE__ */ new Date();
  if (now.getDay() !== d.weekday || now.getHours() < d.hour || d.lastSent === today()) return;
  try {
    await postSlack(app, digest().text);
    setSetting("digest", { ...d, lastSent: today() });
  } catch {
  }
}
async function migrateLegacyTeamFiles() {
  for (const t of teams()) {
    const file = legacyDbFileFor(t.id);
    if (!file) continue;
    try {
      await tjs.stat(dataPath(file));
    } catch {
      continue;
    }
    const old = readLegacySettings(dataPath(file), ["demo", "companyDomain", "myEmployeeId"]);
    for (const [k, v] of Object.entries(old)) setTeamSetting(t.id, k, v);
    if (old.companyDomain && old.companyDomain !== "demo") setSetting("linkDomain", old.companyDomain);
    await deleteCacheFiles(file);
  }
}
function init(app) {
  ready = (async () => {
    await initConfig(app);
    await loadTeams();
    open(dataPath(dbFile()));
    await migrateLegacyTeamFiles();
    syncTeamInfo();
    const sq = await loadSquads();
    const clean = withoutTeamNames(sq.map);
    if (Object.keys(clean).length !== Object.keys(sq.map).length) await saveSquads(clean, manualSquads(sq.squads, clean));
    applySquads(clean);
    applyScope(selectedIds());
  })();
  ready.then(async () => {
    if (await isConfigured(app)) startLoop(app);
    setInterval(() => void maybeSendDigest(app), 30 * 6e4);
    void maybeSendDigest(app);
  }).catch(() => {
  });
}
function onSystem(kind, _value, app) {
  if (kind === "wake") void ready?.then(async () => {
    if (await isConfigured(app)) void syncNow(app);
  });
}
export {
  api,
  init,
  onSystem
};
