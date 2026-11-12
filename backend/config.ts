// Local config: sprints (seeded from Sprint Mapping - Webx), person -> squad
// mapping, optional per-location holidays. Bundled defaults live in
// resources/config/; an edited copy in <data>/config/ wins. The squads file
// is written by the app's People settings.
import type { Holiday, Sprint } from './domain/types.ts';
import { eachDay, isDate } from './domain/dates.ts';

let dataDir = '';
let resourcesDir: string | null = null;

export async function initConfig(app: TinyApp) {
  const p = await app.paths();
  dataDir = p.data;
  resourcesDir = p.resources;
  await tjs.makeDir(dataDir + '/config', { recursive: true });
}

export const dataPath = (name: string) => `${dataDir}/${name}`;

async function readJson(name: string): Promise<any> {
  for (const dir of [dataDir + '/config', resourcesDir ? resourcesDir + '/config' : null]) {
    if (!dir) continue;
    try {
      const bytes = await tjs.readFile(`${dir}/${name}`);
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch { /* missing or unreadable — try the next location */ }
  }
  return null;
}

async function writeJson(name: string, value: unknown) {
  await tjs.writeFile(`${dataDir}/config/${name}`, new TextEncoder().encode(JSON.stringify(value, null, 2) + '\n'));
}

/**
 * sprints.json: [{ name, start, end, boards: { "SOC Workflow": 8565, ... } }]
 * One sprint row per board (id = the board's sprint id); both boards share
 * the same dates, the UI dedupes by name.
 */
export async function loadSprints(): Promise<Sprint[]> {
  const json = await readJson('sprints.json');
  const list: any[] = Array.isArray(json?.sprints) ? json.sprints : Array.isArray(json) ? json : [];
  const out: Sprint[] = [];
  for (const s of list) {
    if (!s?.name || !isDate(s.start) || !isDate(s.end)) continue;
    const boards = s.boards && typeof s.boards === 'object' ? Object.entries(s.boards) : [['', s.id ?? s.name]];
    for (const [board, id] of boards) {
      out.push({ id: `${board || 'sprint'}:${id}`, board: String(board), name: String(s.name), startDate: s.start, endDate: s.end });
    }
  }
  return out;
}

/** squads.json: { "<employeeId>": "SOC Workflow" | "Data Platform" | … } */
export async function loadSquads(): Promise<{ map: Record<string, string>; squads: string[] }> {
  const json = await readJson('squads.json');
  const map: Record<string, string> = {};
  const raw = json?.people && typeof json.people === 'object' ? json.people : {};
  for (const [id, team] of Object.entries(raw)) if (typeof team === 'string' && team) map[id] = team;
  const squads: string[] = Array.isArray(json?.squads) ? json.squads.filter((s: unknown) => typeof s === 'string') : [];
  for (const t of Object.values(map)) if (!squads.includes(t)) squads.push(t);
  return { map, squads };
}

export async function saveSquads(map: Record<string, string>, squads: string[]) {
  await writeJson('squads.json', { squads, people: map });
}

/** holidays.json: [{ "date": "2026-12-26", "end"?: "...", "location": "London", "name": "Boxing Day" }] */
export async function loadLocalHolidays(): Promise<Holiday[]> {
  const json = await readJson('holidays.json');
  const list: any[] = Array.isArray(json) ? json : [];
  const out: Holiday[] = [];
  for (const h of list) {
    if (!isDate(h?.date)) continue;
    for (const day of eachDay(h.date, isDate(h.end) && h.end >= h.date ? h.end : h.date)) {
      out.push({ day, location: String(h.location || '*'), name: String(h.name || 'Holiday') });
    }
  }
  return out;
}
