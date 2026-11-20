// Talent Grid store: the EM's direct reports, their 10 ratings, notes and
// change history, the criterion weights per job level and the layout choice.
// Kept in <data>/talent.json (NOT the disposable SQLite cache): these are the
// manager's own data and are only ever removed by an explicit delete.
//
// Box wording can be replaced without a release: put a talent-copy.json in the
// same folder, shaped like DEFAULT_COPY ({"3": {"A1": {"title", "description",
// "actions": [...]}}, "4": {...}}); anything left out keeps the default.
import { dataPath } from './config.ts';
import {
  BACKUP_KIND, cleanRatings, defaultWeightTable, employeeErrors, equalWeights, isLevel, LEVEL_IDS, mergeCopy, parseBackup,
  linkToRoster, parseBox, place, ratingsForBox, talentCsv, weightsError, type RosterPerson,
  type Cause, type CopyTable, type HistoryEntry, type Layout, type Level, type Ratings, type TalentEmployee, type WeightTable, type Weights,
} from './domain/talent.ts';

const FILE = 'talent.json';
const COPY_FILE = 'talent-copy.json';

interface TalentFile { version: 1; employees: TalentEmployee[]; weights: WeightTable; layout: Layout }
let state: TalentFile = { version: 1, employees: [], weights: defaultWeightTable(), layout: 3 };
let copy: CopyTable = mergeCopy(null);

/** a save that lost a race: the caller shows the latest version (PRD §8.3) */
export class ConflictError extends Error {
  constructor() { super('Someone else changed this employee. The latest version is shown; review it and save again.'); }
}

export async function loadTalent(): Promise<void> {
  try {
    const json = JSON.parse(new TextDecoder().decode(await tjs.readFile(dataPath(FILE))));
    const w = defaultWeightTable();
    for (const l of LEVEL_IDS) if (json?.weights?.[l] && !weightsError(json.weights[l])) w[l] = cleanRatings(json.weights[l]) as Weights;
    const { employees } = parseBackup({ kind: BACKUP_KIND, employees: json?.employees ?? [] });
    // keep ids and revisions as stored (parseBackup resets rev)
    const byIdx = Array.isArray(json?.employees) ? json.employees : [];
    for (const e of employees) {
      const raw = byIdx.find((x: any) => x?.id === e.id);
      if (raw && Number.isInteger(raw.rev) && raw.rev > 0) e.rev = raw.rev;
      if (!e.id) e.id = newId();
    }
    state = { version: 1, employees, weights: w, layout: json?.layout === 4 ? 4 : 3 };
  } catch { /* first run: empty team, equal weights, 3×3 */ }
  await reloadCopy();
}

async function reloadCopy() {
  try { copy = mergeCopy(JSON.parse(new TextDecoder().decode(await tjs.readFile(dataPath(COPY_FILE))))); }
  catch { copy = mergeCopy(null); }
}

async function save() {
  await tjs.writeFile(dataPath(FILE), new TextEncoder().encode(JSON.stringify(state, null, 2) + '\n'));
}

/** write, or put the previous state back and rethrow: never half-saved (PRD §9 Reliability) */
async function commit(before: TalentFile) {
  try { await save(); } catch { state = before; throw new Error('Could not save the change. Nothing was changed; try again.'); }
}

const newId = () => 'tg_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const snapshot = (): TalentFile => structuredClone(state);

/** the board's data for the selected BambooHR team(s): `roster` is who is in them */
export async function talentState(roster: RosterPerson[]) {
  await reloadCopy(); // pick up wording edits without a restart
  if (linkToRoster(state.employees, roster)) { try { await save(); } catch { /* relinked again next open */ } }
  return { employees: structuredClone(state.employees), weights: structuredClone(state.weights), layout: state.layout, copy, roster };
}

function entry(e: TalentEmployee, cause: Cause, by: string, extra: Partial<HistoryEntry> = {}): HistoryEntry {
  const weights = { ...state.weights[e.level] };
  const p = place(e.ratings, weights, state.layout);
  return { at: new Date().toISOString(), by, cause, layout: state.layout, box: p.box, perf: p.perf, pot: p.pot, level: e.level, ratings: { ...e.ratings }, weights, ...extra };
}

function find(id: unknown): TalentEmployee {
  const e = state.employees.find((x) => x.id === id);
  if (!e) throw new Error('This employee is no longer on your grid.');
  return e;
}
function checkRev(e: TalentEmployee, rev: unknown) {
  if (rev !== e.rev) throw new ConflictError();
}

/** the people on the grid come from BambooHR: a new record must name a roster
 *  person not yet rated, and a linked record's name always follows BambooHR */
export async function saveEmployee(input: any, by: string, roster: RosterPerson[]): Promise<TalentEmployee> {
  const cur = input?.id ? find(input.id) : null;
  const bambooId = cur ? cur.bambooId : typeof input?.bambooId === 'string' ? input.bambooId : '';
  const person = bambooId ? roster.find((r) => r.bambooId === bambooId) : undefined;
  if (!cur) {
    if (!person) throw new Error('Pick someone from your BambooHR team.');
    if (state.employees.some((x) => x.bambooId === bambooId)) throw new Error(`${person.name} is already on your grid.`);
  }
  const name = person?.name ?? cur?.name ?? '';
  const errs = employeeErrors({ ...(input ?? {}), name });
  if (Object.keys(errs).length) throw new Error(Object.values(errs)[0]);
  const before = snapshot();
  const fields = {
    name, role: typeof input.role === 'string' ? input.role.trim() : '',
    level: input.level as Level, ratings: cleanRatings(input.ratings as Ratings), notes: typeof input.notes === 'string' ? input.notes : '',
  };
  const now = new Date().toISOString();
  let e: TalentEmployee;
  if (input.id) {
    e = find(input.id);
    checkRev(e, input.rev);
    const ratingsChanged = JSON.stringify(e.ratings) !== JSON.stringify(fields.ratings) || e.level !== fields.level;
    Object.assign(e, fields, { rev: e.rev + 1, updatedAt: now });
    if (ratingsChanged) e.history.push(entry(e, 'edited', by));
  } else {
    e = { id: newId(), bambooId, ...fields, rev: 1, createdAt: now, updatedAt: now, history: [] };
    e.history.push(entry(e, 'created', by));
    state.employees.push(e);
  }
  await commit(before);
  return structuredClone(e);
}

export async function deleteEmployee(id: unknown): Promise<void> {
  const before = snapshot();
  find(id);
  state.employees = state.employees.filter((x) => x.id !== id);
  await commit(before);
}

/** FR-20/21: new ratings on the changed axis only; returns the ratings before, for Undo */
export async function moveEmployee(id: unknown, rev: unknown, layout: unknown, box: unknown, by: string) {
  const e = find(id);
  checkRev(e, rev);
  const lay: Layout = layout === 4 ? 4 : 3;
  if (typeof box !== 'string' || !parseBox(lay, box)) throw new Error('Pick a box on the grid.');
  const w = state.weights[e.level];
  const from = place(e.ratings, w, lay).box;
  if (from === box) throw new Error(`${e.name} is already in ${box}.`);
  const before = snapshot();
  const previous = { ...e.ratings };
  e.ratings = ratingsForBox(e.ratings, w, lay, box);
  e.rev++; e.updatedAt = new Date().toISOString();
  e.history.push({ ...entry(e, 'moved', by), layout: lay, box, from, to: box });
  await commit(before);
  return { employee: structuredClone(e), previous, from, to: box };
}

/** FR-22: put back the exact ratings from before a move */
export async function undoMove(id: unknown, rev: unknown, previous: unknown, layout: unknown, by: string) {
  const e = find(id);
  checkRev(e, rev);
  if (!previous || typeof previous !== 'object' || Object.keys(employeeErrors({ name: e.name, level: e.level, ratings: previous })).length) throw new Error('Nothing to undo.');
  const lay: Layout = layout === 4 ? 4 : 3;
  const w = state.weights[e.level];
  const before = snapshot();
  const from = place(e.ratings, w, lay).box;
  e.ratings = cleanRatings(previous as Ratings);
  const to = place(e.ratings, w, lay).box;
  e.rev++; e.updatedAt = new Date().toISOString();
  e.history.push({ ...entry(e, 'undone', by), layout: lay, box: to, from, to });
  await commit(before);
  return structuredClone(e);
}

/** FR-33: re-places everyone at that level (boxes are derived); logs who changed box */
export async function setWeights(level: unknown, weights: unknown, by: string) {
  if (!isLevel(level)) throw new Error('Pick a job level.');
  const err = weightsError((weights ?? {}) as Record<string, unknown>);
  if (err) throw new Error(err);
  const before = snapshot();
  const next = cleanRatings(weights as Ratings) as Weights;
  const old = state.weights[level];
  let changed = 0;
  state.weights[level] = next;
  for (const e of state.employees.filter((x) => x.level === level)) {
    const a = place(e.ratings, old, state.layout).box, b = place(e.ratings, next, state.layout).box;
    if (a !== b) { changed++; e.history.push({ ...entry(e, 'reweighted', by), from: a, to: b }); e.rev++; }
  }
  await commit(before);
  return { changed };
}

export const resetWeights = (level: unknown, by: string) => setWeights(level, equalWeights(), by);

export async function setLayout(layout: unknown) {
  const before = snapshot();
  state.layout = layout === 4 ? 4 : 3;
  await commit(before);
  return state.layout;
}

/** the team's records only (people outside the selected teams stay out of the file) */
export const csv = (roster: RosterPerson[]) => {
  const team = new Map(roster.map((r) => [r.bambooId, r.team]));
  return talentCsv(state.employees.filter((e) => e.bambooId && team.has(e.bambooId)), state.weights, copy, (e) => team.get(e.bambooId!) ?? '');
};

export function backup(): string {
  return JSON.stringify({ kind: BACKUP_KIND, version: 1, exportedAt: new Date().toISOString(), layout: state.layout, weights: state.weights, employees: state.employees }, null, 2) + '\n';
}

/** FR-28: merge (update matching people, add new) or replace (swap the whole team) */
export async function importBackup(text: string, mode: 'merge' | 'replace', by: string) {
  let json: unknown;
  try { json = JSON.parse(text); } catch { throw new Error('That file is not a Talent Grid backup.'); }
  const { employees, skipped, weights } = parseBackup(json);
  const before = snapshot();
  if (mode === 'replace') {
    if (weights) state.weights = weights;
    state.employees = [];
  }
  let imported = 0;
  for (const inc of employees) {
    const match = state.employees.find((x) => (inc.bambooId && x.bambooId === inc.bambooId))
      ?? state.employees.find((x) => (inc.id && x.id === inc.id))
      ?? state.employees.find((x) => x.name.toLowerCase() === inc.name.toLowerCase() && x.level === inc.level);
    if (match) {
      // history only grows: keep ours, add any entries the backup has that we lack
      const seen = new Set(match.history.map((h) => h.at + h.cause));
      const history = [...match.history, ...inc.history.filter((h) => !seen.has(h.at + h.cause))].sort((a, b) => a.at.localeCompare(b.at));
      Object.assign(match, { bambooId: match.bambooId ?? inc.bambooId, name: inc.name, role: inc.role, level: inc.level, ratings: inc.ratings, notes: inc.notes, history, rev: match.rev + 1, updatedAt: new Date().toISOString() });
      match.history.push(entry(match, 'imported', by));
    } else {
      const e: TalentEmployee = { ...inc, id: inc.id && !state.employees.some((x) => x.id === inc.id) ? inc.id : newId(), rev: 1 };
      e.history.push(entry(e, 'imported', by));
      state.employees.push(e);
    }
    imported++;
  }
  await commit(before);
  return { imported, skipped };
}
