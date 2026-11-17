// Projects: a Jira idea key + start date + deadline, the last Jira snapshot
// (epics + tickets), and manual Jira-assignee → BambooHR person links.
// Kept in <data>/projects.json, NOT the SQLite cache: the cache is disposable
// and rebuilt from BambooHR, these are the manager's own data.
import { dataPath } from './config.ts';
import { isDate } from './domain/dates.ts';
import type { ProjectSnapshot, ProjectTrack } from './jira/client.ts';
import type { Snapshot } from './domain/forecastReport.ts';
import { JIRA_KEY } from './jira/mappers.ts';

export interface Project {
  id: string; key: string; name: string; startDate: string; deadline: string;
  jira: ProjectSnapshot | null; error: string | null;
  /** forecast-report snapshots, newest first, one per day (the skill's format) */
  runs?: Snapshot[];
  /** linked epics left out of this project (other teams', finished phases…) */
  excludedEpics?: string[];
  /** what to pull: the key's linked epics ('idea'), its own tasks ('epic'), or by issue type ('auto') */
  track?: ProjectTrack;
}
interface ProjectsFile { projects: Project[]; links: Record<string, string> }

const FILE = 'projects.json';
let state: ProjectsFile = { projects: [], links: {} };

export async function loadProjects(): Promise<void> {
  try {
    const json = JSON.parse(new TextDecoder().decode(await tjs.readFile(dataPath(FILE))));
    state = {
      projects: (Array.isArray(json?.projects) ? json.projects : []).filter((p: any) => typeof p?.id === 'string' && isDate(p.startDate) && isDate(p.deadline)),
      links: json?.links && typeof json.links === 'object' ? json.links : {},
    };
    // earlier Edit saves stored the idea's Jira title as a typed name; drop those so
    // the title follows Jira again (and can't stick when the key changes)
    for (const p of state.projects) if (p.name && p.jira?.summary && p.name === p.jira.summary.trim().replace(/\s+/g, ' ').slice(0, 120)) p.name = '';
  } catch { /* first run */ }
}

async function save() {
  await tjs.writeFile(dataPath(FILE), new TextEncoder().encode(JSON.stringify(state, null, 2) + '\n'));
}

export const projects = (): Project[] => structuredClone(state.projects);
export const projectById = (id: string): Project | null => structuredClone(state.projects.find((p) => p.id === id) ?? null);
export const links = (): Record<string, string> => ({ ...state.links });

/** "prod-276", " PROD-276 ", or a pasted …/browse/PROD-276 link → "PROD-276" */
export function parseJiraKey(raw: unknown): string {
  const s = String(raw ?? '').trim().toUpperCase();
  if (JIRA_KEY.test(s)) return s;
  const m = /(?:BROWSE\/|SELECTEDISSUE=)([A-Z][A-Z0-9_]{0,19}-\d{1,9})\b/.exec(s) ?? /^\S*?\b([A-Z][A-Z0-9_]{0,19}-\d{1,9})\b\S*$/.exec(s);
  return m ? m[1] : s;
}

export async function saveProject(input: any): Promise<Project> {
  const cur = typeof input?.id === 'string' ? state.projects.find((p) => p.id === input.id) : undefined;
  if (typeof input?.id === 'string' && input.id && !cur) throw new Error('This project was removed from the board.');
  const key = parseJiraKey(input?.key);
  if (!JIRA_KEY.test(key)) throw new Error('Enter the Jira idea key, e.g. IDEA-42 (or paste its Jira link).');
  const dup = state.projects.find((p) => p.key === key && p.id !== cur?.id);
  if (dup) throw new Error(`${key} is already on the board${dup.name ? ` as “${dup.name}”` : ''}.`);
  const track: ProjectTrack = input?.track === 'idea' || input?.track === 'epic' ? input.track
    : input?.track === 'auto' || !cur ? 'auto' : cur.track ?? 'auto';
  // a different key or a different way of reading it: the old snapshot doesn't apply
  const sameKey = !!cur && cur.key === key && (cur.track ?? 'auto') === track;
  // a new idea: the old idea's title must not stick as this project's name
  let name = String(input?.name ?? '').trim().replace(/\s+/g, ' ').slice(0, 120);
  if (cur && !sameKey && cur.jira?.summary && name === cur.jira.summary.trim().replace(/\s+/g, ' ').slice(0, 120)) name = '';
  const { startDate, deadline } = input ?? {};
  if (!isDate(startDate)) throw new Error('Pick a start date.');
  if (!isDate(deadline)) throw new Error('Pick a deadline.');
  if (deadline < startDate) throw new Error('The deadline is before the start date.');
  const p: Project = {
    id: cur?.id ?? `pr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    key, name, track,
    startDate, deadline,
    jira: sameKey ? cur!.jira : null,
    error: sameKey ? cur!.error : null,
    runs: sameKey ? cur!.runs ?? [] : [],
    // the left-out list names the OLD idea's epics: a new key starts with all in
    excludedEpics: !sameKey && cur ? []
      : Array.isArray(input?.excludedEpics)
        ? [...new Set<string>(input.excludedEpics.map((k: unknown) => String(k).toUpperCase()).filter((k: string) => JIRA_KEY.test(k)))]
        : cur?.excludedEpics ?? [],
  };
  // edit in place: keeps the card's position and any open state
  state.projects = cur ? state.projects.map((x) => (x.id === p.id ? p : x)) : [...state.projects, p];
  await save();
  return structuredClone(p);
}

/** removes the project with everything kept for it: its Jira snapshot (epics,
 *  tickets, assignees), its run history, its left-out epics, and the
 *  assignee → person links nobody else on the board uses. Re-adding the same
 *  key starts from a fresh pull. */
export async function deleteProject(id: string): Promise<boolean> {
  const gone = state.projects.find((p) => p.id === id);
  if (!gone) return false;
  state.projects = state.projects.filter((p) => p.id !== id);
  const stillUsed = new Set(state.projects.flatMap((p) => p.jira?.assignees.map((a) => a.accountId) ?? []));
  for (const a of gone.jira?.assignees ?? []) if (!stillUsed.has(a.accountId)) delete state.links[a.accountId];
  await save();
  return true;
}

/** a failed refresh keeps the last good snapshot and records the error.
 *  key = the key the pull was for: a pull that started before the project was
 *  re-keyed (or removed) must not land its old idea's data on it. */
export async function setSnapshot(id: string, snap: ProjectSnapshot | null, error: string | null, key?: string): Promise<boolean> {
  const p = state.projects.find((x) => x.id === id);
  if (!p || (key && p.key !== key) || (snap && snap.key !== p.key)) return false;
  if (snap) p.jira = snap;
  p.error = error;
  await save();
  return true;
}

const MAX_RUNS = 60;
/** keep this run as that day's snapshot (a later refresh the same day replaces it) */
export async function saveRun(id: string, run: Snapshot) {
  const p = state.projects.find((x) => x.id === id);
  if (!p) throw new Error('This project was removed from the board.');
  p.runs = [run, ...(p.runs ?? []).filter((r) => r.date !== run.date)].sort((a, b) => b.date.localeCompare(a.date)).slice(0, MAX_RUNS);
  await save();
}
export async function deleteRun(id: string, date: string) {
  const p = state.projects.find((x) => x.id === id);
  if (!p) return;
  p.runs = (p.runs ?? []).filter((r) => r.date !== date);
  await save();
}

/** link a Jira account to a BambooHR employee ('' removes the link) */
export async function setLink(accountId: string, employeeId: string) {
  if (employeeId) state.links[accountId] = employeeId; else delete state.links[accountId];
  await save();
}
