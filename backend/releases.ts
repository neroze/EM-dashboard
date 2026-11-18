// Release board settings the manager sets by hand: each release epic's
// planning date (baseline decision 4). Kept in <data>/releases.json beside
// projects.json — the SQLite cache is disposable, this is the manager's data.
// Jira data itself is never stored: the board fetches it on every open.
import { dataPath } from './config.ts';
import { isDate } from './domain/dates.ts';
import { RELEASE_EPIC_KEY } from './domain/release.ts';

const FILE = 'releases.json';
let planning: Record<string, string> = {};

export async function loadReleases(): Promise<void> {
  try {
    const json = JSON.parse(new TextDecoder().decode(await tjs.readFile(dataPath(FILE))));
    const p = json?.planningDates && typeof json.planningDates === 'object' ? json.planningDates : {};
    planning = Object.fromEntries(Object.entries(p).filter(([k, v]) => RELEASE_EPIC_KEY.test(k) && isDate(v))) as Record<string, string>;
  } catch { /* first run */ }
}

export const planningDate = (epic: string): string | null => planning[epic] ?? null;

/** '' or null clears it (back to the inferred day) */
export async function setPlanningDate(epic: string, date: string | null): Promise<void> {
  if (!RELEASE_EPIC_KEY.test(epic)) throw new Error('A release epic key looks like LP-12345.');
  if (date && !isDate(date)) throw new Error('Pick a planning date.');
  if (date) planning[epic] = date; else delete planning[epic];
  await tjs.writeFile(dataPath(FILE), new TextEncoder().encode(JSON.stringify({ planningDates: planning }, null, 2) + '\n'));
}
