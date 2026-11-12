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
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}
function isDate(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}
function addDays(d, n) {
  return fmt(parse(d) + n * DAY_MS);
}
function addMonths(d, n) {
  const [y, m, day] = d.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
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
  const p = (n) => String(n).padStart(2, "0");
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
var SCHEMA_VERSION = 1;
var SCHEMA = `
CREATE TABLE IF NOT EXISTS employee (
  id            TEXT PRIMARY KEY,   -- BambooHR employee id
  display_name  TEXT NOT NULL,
  team          TEXT,               -- squad from the local squads mapping
  location      TEXT,
  reports_to_id TEXT,
  in_scope      INTEGER NOT NULL    -- 1 if in my subtree
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
    db.exec("DROP TABLE IF EXISTS leave_day; DROP TABLE IF EXISTS leave_request; DROP TABLE IF EXISTS employee;DROP TABLE IF EXISTS holiday; DROP TABLE IF EXISTS sprint; DROP TABLE IF EXISTS leave_type; DROP TABLE IF EXISTS sync_log;");
  }
  db.exec(SCHEMA);
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}
function close() {
  for (const s of cache.values()) {
    try {
      s.finalize();
    } catch {
    }
  }
  cache.clear();
  try {
    db?.close();
  } catch {
  }
  db = null;
}
function wipeCache() {
  db.exec(`DELETE FROM leave_day; DELETE FROM leave_request; DELETE FROM employee; DELETE FROM holiday;
    DELETE FROM leave_type; DELETE FROM sync_log;
    DELETE FROM setting WHERE key IN ('employeesSyncedAt', 'metaSyncedAt', 'myEmployeeId');`);
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
function setSetting(key, value) {
  run(
    "INSERT INTO setting(key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json",
    key,
    JSON.stringify(value)
  );
}
function replaceEmployees(list) {
  tx(() => {
    run("CREATE TEMP TABLE IF NOT EXISTS keep_emp (id TEXT PRIMARY KEY)");
    run("DELETE FROM keep_emp");
    for (const e of list) {
      run(
        `INSERT INTO employee(id, display_name, team, location, reports_to_id, in_scope) VALUES (?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name, team=excluded.team,
             location=excluded.location, reports_to_id=excluded.reports_to_id, in_scope=excluded.in_scope`,
        e.id,
        e.displayName,
        e.team,
        e.location,
        e.reportsToId,
        e.inScope ? 1 : 0
      );
      run("INSERT OR IGNORE INTO keep_emp(id) VALUES (?)", e.id);
    }
    run("DELETE FROM leave_request WHERE employee_id NOT IN (SELECT id FROM keep_emp)");
    run("DELETE FROM leave_day WHERE employee_id NOT IN (SELECT id FROM keep_emp)");
    run("DELETE FROM employee WHERE id NOT IN (SELECT id FROM keep_emp)");
  });
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
function replaceRequests(rows, days2, from, to, purgeBefore) {
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
    const gone = "SELECT id FROM leave_request WHERE end_date >= ? AND start_date <= ? AND id NOT IN (SELECT id FROM keep_req)";
    run(`DELETE FROM leave_day WHERE request_id IN (${gone})`, from, to);
    run(`DELETE FROM leave_request WHERE id IN (${gone})`, from, to);
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
  const r = all(`SELECT (SELECT COUNT(*) FROM leave_request) AS requests, (SELECT COUNT(*) FROM leave_day) AS days,
    (SELECT COUNT(*) FROM employee WHERE in_scope = 1) AS people`)[0];
  return { requests: r.requests, days: r.days, people: r.people };
}
function people(f = {}) {
  const where = ["in_scope = 1"];
  const p = [];
  inList(where, p, "id", f.people);
  inList(where, p, "COALESCE(team, 'Unassigned')", f.teams);
  inList(where, p, "COALESCE(location, 'Unknown')", f.locations);
  return all(`SELECT id, display_name AS displayName, COALESCE(team, 'Unassigned') AS team,
      COALESCE(location, 'Unknown') AS location FROM employee WHERE ${where.join(" AND ")}
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
  inList(where, p, "COALESCE(e.team, 'Unassigned')", f.teams);
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
      COALESCE(e.team, 'Unassigned') AS team, COALESCE(e.location, 'Unknown') AS location,
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
    UNION SELECT DISTINCT type_id AS id, type_name AS name FROM leave_request WHERE type_id NOT IN (SELECT id FROM leave_type)
    ORDER BY name`);
}
function distinct(col) {
  const fallback = col === "team" ? "Unassigned" : "Unknown";
  return all(`SELECT DISTINCT COALESCE(${col}, '${fallback}') AS v FROM employee WHERE in_scope = 1 ORDER BY v`).map((r) => r.v);
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
    ...rows.map((r, n) => `<row r="${n + 2}">${EXPORT_COLUMNS.map((c, i) => cell(c.get(r), colName(i) + (n + 2))).join("")}</row>`)
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
    for (let n = 0; n < 256; n++) {
      let c2 = n;
      for (let k = 0; k < 8; k++) c2 = c2 & 1 ? 3988292384 ^ c2 >>> 1 : c2 >>> 1;
      crcTable[n] = c2 >>> 0;
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
var r2 = (n) => Math.round(n * 100) / 100;
function workingDays(from, to, location, isHoliday) {
  let n = 0;
  for (const d of eachDay(from, to)) if (!isWeekend(d) && !isHoliday(d, location)) n++;
  return n;
}
function capacityByTeam(people3, days2, from, to, isHoliday) {
  const per = /* @__PURE__ */ new Map();
  for (const p of people3) {
    const available = workingDays(from, to, p.location, isHoliday);
    per.set(p.id, { id: p.id, displayName: p.displayName, available, plannedOut: 0, draftOut: 0, net: available });
  }
  for (const d of days2) {
    if (d.day < from || d.day > to) continue;
    const pc = per.get(d.employeeId);
    if (!pc) continue;
    if (d.status === "planned") pc.plannedOut += d.fraction;
    else if (d.status === "draft") pc.draftOut += d.fraction;
  }
  const teams = /* @__PURE__ */ new Map();
  for (const p of people3) {
    const pc = per.get(p.id);
    pc.plannedOut = r2(pc.plannedOut);
    pc.draftOut = r2(pc.draftOut);
    pc.net = r2(pc.available - pc.plannedOut - pc.draftOut);
    let t = teams.get(p.team);
    if (!t) {
      t = { team: p.team, headcount: 0, available: 0, plannedOut: 0, draftOut: 0, net: 0, netPlanned: 0, people: [] };
      teams.set(p.team, t);
    }
    t.headcount++;
    t.available += pc.available;
    t.plannedOut += pc.plannedOut;
    t.draftOut += pc.draftOut;
    t.people.push(pc);
  }
  return [...teams.values()].map((t) => ({
    ...t,
    available: r2(t.available),
    plannedOut: r2(t.plannedOut),
    draftOut: r2(t.draftOut),
    net: r2(t.available - t.plannedOut - t.draftOut),
    netPlanned: r2(t.available - t.plannedOut),
    people: t.people.sort((a, b) => a.displayName.localeCompare(b.displayName))
  })).sort((a, b) => a.team.localeCompare(b.team));
}
function teamLoad(people3, days2, from, to, thresholdFor2, minPeople) {
  const teamOf = new Map(people3.map((p) => [p.id, p.team]));
  const size = /* @__PURE__ */ new Map();
  for (const p of people3) size.set(p.team, (size.get(p.team) ?? 0) + 1);
  const byDay = /* @__PURE__ */ new Map();
  for (const d of days2) {
    if (d.day < from || d.day > to || d.status !== "planned" && d.status !== "draft") continue;
    const team = teamOf.get(d.employeeId);
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
    const teams = [];
    let peopleOut = 0;
    for (const [team, pm] of tm) {
      let planned = 0, draft = 0, n = 0;
      for (const v of pm.values()) {
        const p = Math.min(1, v.p), dd = Math.min(1 - p, v.d);
        planned += p;
        draft += dd;
        n++;
      }
      const sz = size.get(team) ?? 0;
      const o = r2(planned + draft);
      const share = sz ? o / sz : 0;
      const flagged = minPeople && minPeople > 0 ? n >= minPeople : sz > 0 && share >= thresholdFor2(team) - 1e-9;
      peopleOut += n;
      teams.push({ team, out: o, planned: r2(planned), draft: r2(draft), size: sz, share: r2(share), flagged });
    }
    teams.sort((a, b) => a.team.localeCompare(b.team));
    out.push({ day, teams, peopleOut, flagged: teams.some((t) => t.flagged) });
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
var round = (n) => Math.round(n * 100) / 100;
function period(from, to, recs, days2, statuses) {
  const inWin = /* @__PURE__ */ new Map();
  for (const d of days2) if (d.day >= from && d.day <= to) inWin.set(d.requestId, (inWin.get(d.requestId) ?? 0) + d.fraction);
  const items = [];
  for (const [id, n] of inWin) {
    const r = recs.get(id);
    if (r && statuses.includes(r.status)) items.push({ ...r, days: round(n) });
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
  const pad = (n) => String(n).padStart(2, "0");
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
var LONG_DAYS = 10;
var MINI_DAYS = 5;
function findRuns(recs, days2, isHoliday) {
  const byId = new Map(recs.map((r) => [r.id, r]));
  const perPerson = /* @__PURE__ */ new Map();
  for (const d of days2) {
    const r = byId.get(d.requestId);
    if (!r || !isActive(r.status) || isWfhType(r.typeName) || d.fraction <= 0) continue;
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
  for (let d = addDays(a, 1), n = 0; d < b; d = addDays(d, 1), n++) {
    if (n > 40) return false;
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
function demoSquads() {
  const m = {};
  for (const p of people2()) if (p.squad) m[p.id] = p.squad;
  return m;
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
    const n = Math.round((4 + Math.floor(rand() * 5)) * span / 450);
    for (let k = 0; k < n; k++) {
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
    const n = Math.floor(rand() * 5) + Math.floor(span / 30);
    for (let k = 0; k < n; k++) {
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
function createDemoClient() {
  const respond = async (path, query) => {
    await new Promise((r) => setTimeout(r, 150));
    if (path.startsWith("employees/0")) return { id: DEMO_ME, displayName: "Demo Manager" };
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
    const n = Number(v);
    if (isDate(d) && Number.isFinite(n)) out[d] = n;
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

// ../../../../../../../Users/nirajmaharjan/sandbox/tinyjsapp-examples/leave-radar/backend/secrets.ts
var KEY = "bamboohr.apiKey";
var DOMAIN = "bamboohr.companyDomain";
var SLACK = "digest.slackWebhook";
async function getCredentials(app) {
  const [apiKey, companyDomain] = await Promise.all([app.secrets.get(KEY), app.secrets.get(DOMAIN)]);
  return apiKey && companyDomain ? { apiKey, companyDomain } : null;
}
async function setCredentials(app, companyDomain, apiKey) {
  await app.secrets.set(DOMAIN, companyDomain);
  await app.secrets.set(KEY, apiKey);
}
async function getSlackWebhook(app) {
  return app.secrets.get(SLACK);
}
async function setSlackWebhook(app, url) {
  if (url) await app.secrets.set(SLACK, url);
  else await app.secrets.delete(SLACK);
}
async function clearAll(app) {
  await Promise.all([app.secrets.delete(KEY), app.secrets.delete(DOMAIN), app.secrets.delete(SLACK)]);
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
async function clientFor(app) {
  if (getSetting("demo", false)) return { client: createDemoClient(), demo: true };
  const creds = await getCredentials(app);
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
  const t0 = Date.now();
  const at = (/* @__PURE__ */ new Date()).toISOString();
  lastRunAt = at;
  const c = await clientFor(app);
  if (!c) {
    lastError = "Not set up";
    return;
  }
  const { client, demo } = c;
  try {
    const now = Date.now();
    const t = today();
    const from = minDate(addMonths(t, -3), t.slice(0, 4) + "-01-01"), to = addMonths(t, 12);
    const empAge = now - getSetting("employeesSyncedAt", 0);
    if (full || empAge > DAILY_MS || counts().people === 0) {
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
      const map = demo ? { ...demoSquads(), ...squads.map } : squads.map;
      const emps = markScope(mapEmployees(raw2, t), myId).map((e) => ({ ...e, team: map[e.id] ?? null }));
      replaceEmployees(emps);
      setSetting("myEmployeeId", myId);
      setSetting("employeesSyncedAt", now);
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
    const scoped = new Map(allEmployees().filter((e) => e.inScope).map((e) => [e.id, e.location ?? ""]));
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
    replaceRequests(rows, days2, from, to, from);
    lastError = null;
    logSync(at, true, rows.length, null, Date.now() - t0);
  } catch (e) {
    lastError = String(e?.message ?? e);
    try {
      logSync(at, false, 0, lastError, Date.now() - t0);
    } catch {
    }
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
  const domain = getSetting("companyDomain", "");
  if (!domain) return "";
  const tpl = getSetting("linkTemplate", DEFAULT_LINK);
  return tpl.replaceAll("{domain}", encodeURIComponent(domain)).replaceAll("{employeeId}", encodeURIComponent(employeeId)).replaceAll("{requestId}", encodeURIComponent(requestId));
}
function load(f) {
  const active = (f.statuses ?? DEFAULT_STATUSES).filter(isActive);
  if (!active.length) return [];
  const people3 = people({ teams: f.teams, locations: f.locations });
  const days2 = days(f.from, f.to, bambooStatusesFor(active)).map((d) => ({ employeeId: d.employeeId, day: d.day, fraction: d.fraction, status: appStatus(d.bambooStatus) }));
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
function capacity(fIn, sprintName) {
  const f = normalize(fIn);
  const sprints2 = uniqueSprints().filter((s) => sprintName ? s.name === sprintName : s.endDate >= f.from && s.startDate <= f.to);
  const periods = sprints2.length ? sprints2.map((s) => ({ id: s.name, name: s.name, from: s.startDate, to: s.endDate })) : [{ id: "range", name: "Selected range", from: f.from, to: f.to }];
  const lo = periods.reduce((a, p) => minDate(a, p.from), periods[0].from);
  const hi = periods.reduce((a, p) => maxDate(a, p.to), periods[0].to);
  const people3 = people(f);
  const typeSet = f.types?.length ? new Set(f.types) : null;
  const reqType = /* @__PURE__ */ new Map();
  if (typeSet) for (const r of requests({ ...f, from: lo, to: hi, statuses: ["planned", "draft"], people: [], types: [] })) reqType.set(r.id, r.typeId);
  const days2 = days(lo, hi, ["approved", "requested"]).filter((d) => !typeSet || typeSet.has(reqType.get(d.requestId) ?? "")).map((d) => ({ employeeId: d.employeeId, day: d.day, fraction: d.fraction, status: appStatus(d.bambooStatus) }));
  const hol = holidayIndex(holidays(lo, hi));
  return periods.map((p) => {
    const ld = load({ ...f, from: p.from, to: p.to, statuses: ["planned", "draft"], overlapOnly: false });
    return {
      ...p,
      teams: capacityByTeam(people3, days2, p.from, p.to, hol).map((t) => ({
        ...t,
        threshold: thresholdFor(t.team),
        overlapDays: ld.filter((d) => d.teams.some((x) => x.team === t.team && x.flagged)).length
      }))
    };
  });
}
function overlaps(fIn, threshold) {
  const f = normalize(fIn);
  const active = (f.statuses ?? DEFAULT_STATUSES).filter(isActive);
  const people3 = people({ teams: f.teams, locations: f.locations });
  const days2 = days(f.from, f.to, bambooStatusesFor(active)).map((d) => ({ employeeId: d.employeeId, day: d.day, fraction: d.fraction, status: appStatus(d.bambooStatus) }));
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
  const recs = requests({ from, to, statuses: ["planned", "draft"], teams: f.teams, people: f.people, locations: f.locations }).map((x) => ({
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
  const runs = findRuns(recs, days(from, to, ["approved", "requested"]), (d, emp) => hol(d, loc.get(emp) ?? ""));
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
  for (const r of recs) {
    lines.push(`\u2022 ${r.person} (${r.team}) \u2014 ${r.typeName}, ${r.startDate}${r.endDate !== r.startDate ? " \u2192 " + r.endDate : ""}, ${r.days} d${r.status === "draft" ? " \u2014 DRAFT, awaiting approval" : ""}`);
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

// ../../../../../../../Users/nirajmaharjan/sandbox/tinyjsapp-examples/leave-radar/backend/main.ts
var DB_FILE = "leave-radar.sqlite";
var ready = null;
var whenReady = () => ready ?? Promise.reject(new Error("backend not initialised"));
var DIGEST_DEFAULT = { enabled: false, weekday: 1, hour: 9, lastSent: null };
async function isConfigured(app) {
  return getSetting("demo", false) || !!await getCredentials(app);
}
async function status(app) {
  const last = lastSync();
  const good = lastGoodSync();
  const s = syncState();
  const c = counts();
  return {
    configured: await isConfigured(app),
    demo: getSetting("demo", false),
    companyDomain: getSetting("companyDomain", ""),
    syncing: s.syncing,
    lastSyncAt: good?.at ?? null,
    lastAttemptAt: last?.at ?? null,
    lastDurationMs: good?.duration_ms ?? null,
    lastRecords: good?.records ?? null,
    lastError: last && !last.ok ? last.error : null,
    recordCount: c.requests,
    peopleCount: c.people,
    myEmployeeId: getSetting("myEmployeeId", null)
  };
}
async function writeExport(path, filters, sort, format) {
  if (typeof path !== "string" || !path.startsWith("/")) throw new Error("Choose where to save the file.");
  const rows = sortRecords(leave(filters), sort);
  const bytes = format === "xlsx" ? toXlsx(rows) : new TextEncoder().encode(toCsv(rows));
  await tjs.writeFile(path, bytes);
  return { path, rows: rows.length };
}
async function deleteCacheFiles() {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      await tjs.remove(dataPath(DB_FILE + suffix));
    } catch {
    }
  }
}
async function postSlack(app, text) {
  const hook = await getSlackWebhook(app);
  if (!hook) throw new Error("Add a Slack incoming-webhook URL in Settings first.");
  const res = await fetch(hook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
  if (!res.ok) throw new Error(`Slack returned ${res.status}`);
}
async function settings(app) {
  const squads = await loadSquads();
  return {
    defaultThreshold: getSetting("defaultThreshold", DEFAULT_THRESHOLD),
    thresholds: getSetting("thresholds", {}),
    linkTemplate: getSetting("linkTemplate", DEFAULT_LINK),
    hoursPerDay: getSetting("hoursPerDay", 8),
    squads: squads.squads.length ? squads.squads : ["SOC Workflow", "Data Platform"],
    squadMap: squads.map,
    people: allEmployees().filter((e) => e.inScope).map((e) => ({ id: e.id, name: e.displayName, team: e.team })),
    digest: getSetting("digest", DIGEST_DEFAULT),
    hasSlackWebhook: !!await getSlackWebhook(app)
  };
}
var api = {
  // ---- setup / status / sync ----------------------------------------------
  setup: async ({ companyDomain, apiKey }, app) => {
    await whenReady();
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
    stopLoop();
    await settle();
    await setCredentials(app, domain, key);
    if (getSetting("demo", false)) wipeCache();
    setSetting("demo", false);
    setSetting("companyDomain", domain);
    setSetting("myEmployeeId", myEmployeeId);
    resetSyncState();
    startLoop(app);
    return { ok: true, myEmployeeId };
  },
  setupDemo: async (_, app) => {
    await whenReady();
    stopLoop();
    await settle();
    wipeCache();
    setSetting("demo", true);
    setSetting("companyDomain", "demo");
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
  getCapacity: async ({ filters, sprintId }) => {
    await whenReady();
    return capacity(filters, sprintId);
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
    const c = await clientFor(app);
    if (!c) throw new Error("Not signed in to BambooHR.");
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
    const n = String(name || "").trim().slice(0, 80);
    if (!n) throw new Error("Give the view a name.");
    saveView(n, filters ?? {});
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
      const n = Number(v);
      return n > 0 && n <= 1 ? n : null;
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
      const squads = Array.isArray(s.squads) ? s.squads.map(String).filter(Boolean) : [...new Set(Object.values(map))];
      await saveSquads(map, squads);
      applySquads(map);
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
        dbSizeMb += Number((await tjs.stat(dataPath(DB_FILE + suffix))).size) / 1048576;
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
  // ---- sign out: Keychain entries + SQLite file deleted -------------------------
  signOut: async (_, app) => {
    await whenReady();
    stopLoop();
    await settle();
    stopSampling(true);
    await clearAll(app);
    close();
    await deleteCacheFiles();
    resetSyncState();
    open(dataPath(DB_FILE));
    app.push("status-changed");
    return { ok: true };
  }
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
function init(app) {
  ready = (async () => {
    await initConfig(app);
    open(dataPath(DB_FILE));
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
