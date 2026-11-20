// Talent Grid: the rating framework from the Talent Grid PRD (Nov 2026).
// Pure, no I/O. The backend stores ratings and history; the UI imports this
// same module for live previews, so a box is computed the same way everywhere.
//
// Averages are kept in HUNDREDTHS as integers (weights are whole percents, so
// sum(rating × weight) is exact): 3.49 vs 3.50 and 3.99 vs 4.00 never depend
// on floating-point rounding (PRD §9 "Accuracy").

export type Layout = 3 | 4;
export type Axis = 'perf' | 'pot';
export type Level = 'associate' | 'se' | 'sse' | 'lead';
export type CriterionId =
  | 'goalDelivery' | 'quality' | 'ownership' | 'impact' | 'consistency'
  | 'learningAgility' | 'adaptability' | 'problemSolving' | 'drive' | 'leadership';
export type Ratings = Record<CriterionId, number>;
/** whole percents; the 5 on each axis add up to 100 */
export type Weights = Record<CriterionId, number>;
export type WeightTable = Record<Level, Weights>;
export type ZoneId = 'top' | 'high' | 'core' | 'watch' | 'risk';
export type Cause = 'created' | 'edited' | 'moved' | 'undone' | 'imported' | 'reweighted';

export const LEVELS: { id: Level; label: string; short: string }[] = [
  { id: 'associate', label: 'Associate', short: 'Assoc' },
  { id: 'se', label: 'Software Engineer', short: 'SE' },
  { id: 'sse', label: 'Senior Software Engineer', short: 'SSE' },
  { id: 'lead', label: 'Lead Engineer', short: 'Lead' },
];
export const LEVEL_IDS = LEVELS.map((l) => l.id);
export const levelLabel = (l: Level) => LEVELS.find((x) => x.id === l)?.label ?? l;
export const levelShort = (l: Level) => LEVELS.find((x) => x.id === l)?.short ?? l;
export const isLevel = (v: unknown): v is Level => LEVEL_IDS.includes(v as Level);

export const CRITERIA: { id: CriterionId; axis: Axis; label: string; hint: string }[] = [
  { id: 'goalDelivery', axis: 'perf', label: 'Goal Delivery', hint: 'Delivers agreed goals on time' },
  { id: 'quality', axis: 'perf', label: 'Quality', hint: 'Work is correct, maintainable and needs little rework' },
  { id: 'ownership', axis: 'perf', label: 'Ownership', hint: 'Takes responsibility end to end without being chased' },
  { id: 'impact', axis: 'perf', label: 'Impact', hint: 'Results matter to the team and customers' },
  { id: 'consistency', axis: 'perf', label: 'Consistency', hint: 'Performs reliably across the whole period' },
  { id: 'learningAgility', axis: 'pot', label: 'Learning Agility', hint: 'Picks up new skills and domains quickly' },
  { id: 'adaptability', axis: 'pot', label: 'Adaptability', hint: 'Stays effective when priorities or context change' },
  { id: 'problemSolving', axis: 'pot', label: 'Problem Solving', hint: 'Handles ambiguous, complex problems well' },
  { id: 'drive', axis: 'pot', label: 'Drive & Ambition', hint: 'Wants and seeks bigger scope' },
  { id: 'leadership', axis: 'pot', label: 'Leadership Signals', hint: 'Influences and lifts others without formal authority' },
];
export const CRITERION_IDS = CRITERIA.map((c) => c.id);
export const axisCriteria = (axis: Axis) => CRITERIA.filter((c) => c.axis === axis);
export const SCALE = ['', 'Well below expectations', 'Below expectations', 'Meets expectations', 'Exceeds expectations', 'Exceptional'];

// ---- weights ---------------------------------------------------------------

export const equalWeights = (): Weights => Object.fromEntries(CRITERION_IDS.map((c) => [c, 20])) as Weights;
export const defaultWeightTable = (): WeightTable => Object.fromEntries(LEVEL_IDS.map((l) => [l, equalWeights()])) as WeightTable;

/** null when valid, else what to fix */
export function weightsError(w: Partial<Record<string, unknown>>): string | null {
  for (const c of CRITERIA) {
    const v = w[c.id];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 100) return `${c.label}: enter a whole percent from 0 to 100.`;
  }
  for (const axis of ['perf', 'pot'] as Axis[]) {
    const sum = axisCriteria(axis).reduce((s, c) => s + (w[c.id] as number), 0);
    if (sum !== 100) return `${axis === 'perf' ? 'Performance' : 'Potential'} weights add up to ${sum}%; they must total 100%.`;
  }
  return null;
}

// ---- ratings ---------------------------------------------------------------

export const isRating = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 5;
/** every one of the 10 ratings set (PRD §4.1: all required before placement) */
export const ratingsComplete = (r: Partial<Record<string, unknown>> | null | undefined): r is Ratings =>
  !!r && CRITERION_IDS.every((c) => isRating(r[c]));

/** weighted average × 100 (100…500), exact */
export function avgX100(r: Ratings, w: Weights, axis: Axis): number {
  return axisCriteria(axis).reduce((s, c) => s + r[c.id] * w[c.id], 0);
}
export const fmtAvg = (x100: number) => (x100 / 100).toFixed(2);

// ---- bands (PRD §4.3), highest first ---------------------------------------

export const BANDS: Record<Layout, { name: string; min: number }[]> = {
  3: [{ name: 'High', min: 400 }, { name: 'Medium', min: 300 }, { name: 'Low', min: 100 }],
  4: [{ name: 'Exceptional', min: 425 }, { name: 'High', min: 350 }, { name: 'Moderate', min: 250 }, { name: 'Low', min: 100 }],
};
/** 0 = the highest band */
export function bandIndex(layout: Layout, x100: number): number {
  const i = BANDS[layout].findIndex((b) => x100 >= b.min);
  return i < 0 ? BANDS[layout].length - 1 : i;
}
export const bandName = (layout: Layout, x100: number) => BANDS[layout][bandIndex(layout, x100)].name;
/** inclusive range in hundredths */
export function bandRange(layout: Layout, idx: number): { lo: number; hi: number } {
  const b = BANDS[layout];
  return { lo: b[idx].min, hi: idx === 0 ? 500 : b[idx - 1].min - 1 };
}
export const rangeText = (layout: Layout, idx: number) => {
  const { lo, hi } = bandRange(layout, idx);
  return `${fmtAvg(lo)}–${fmtAvg(hi)}`;
};

// ---- boxes (PRD §4.4) ------------------------------------------------------

const LETTERS = 'ABCD';
export const boxLabel = (perfIdx: number, potIdx: number) => LETTERS[perfIdx] + String(potIdx + 1);
export function parseBox(layout: Layout, label: string): { perfIdx: number; potIdx: number } | null {
  const m = /^([A-D])([1-4])$/.exec(label);
  if (!m) return null;
  const perfIdx = LETTERS.indexOf(m[1]), potIdx = Number(m[2]) - 1;
  return perfIdx < layout && potIdx < layout ? { perfIdx, potIdx } : null;
}
/** every box label of a layout, matrix order: top row (potential 1) first, performance low → high */
export function boxesInMatrixOrder(layout: Layout): string[] {
  const out: string[] = [];
  for (let pot = 0; pot < layout; pot++) for (let perf = layout - 1; perf >= 0; perf--) out.push(boxLabel(perf, pot));
  return out;
}
export const boxRangeText = (layout: Layout, label: string) => {
  const p = parseBox(layout, label);
  return p ? `Perf ${rangeText(layout, p.perfIdx)} · Pot ${rangeText(layout, p.potIdx)}` : '';
};

export interface Placement { perf: number; pot: number; perfIdx: number; potIdx: number; box: string }
export function place(r: Ratings, w: Weights, layout: Layout): Placement {
  const perf = avgX100(r, w, 'perf'), pot = avgX100(r, w, 'pot');
  const perfIdx = bandIndex(layout, perf), potIdx = bandIndex(layout, pot);
  return { perf, pot, perfIdx, potIdx, box: boxLabel(perfIdx, potIdx) };
}

// ---- zones (PRD §4.7) ------------------------------------------------------

export const ZONES: { id: ZoneId; label: string; meaning: string }[] = [
  { id: 'top', label: 'Top talent', meaning: 'Retain and accelerate' },
  { id: 'high', label: 'High value', meaning: 'Develop and stretch' },
  { id: 'core', label: 'Core', meaning: 'Engage and grow in role' },
  { id: 'watch', label: 'Watch', meaning: 'Diagnose and support' },
  { id: 'risk', label: 'Risk', meaning: 'Act decisively' },
];
const ZONE_BOXES: Record<Layout, Record<ZoneId, string[]>> = {
  4: { top: ['A1', 'A2', 'B1'], high: ['A3', 'B2', 'C1'], core: ['A4', 'B3', 'B4', 'C2', 'C3'], watch: ['C4', 'D1', 'D2'], risk: ['D3', 'D4'] },
  3: { top: ['A1', 'A2', 'B1'], high: ['A3', 'B2', 'C1'], core: ['B3'], watch: ['C2'], risk: ['C3'] },
};
export function zoneOf(layout: Layout, box: string): ZoneId {
  for (const z of ZONES) if (ZONE_BOXES[layout][z.id].includes(box)) return z.id;
  return 'core';
}
export const zoneInfo = (id: ZoneId) => ZONES.find((z) => z.id === id)!;

// ---- recommendations (PRD §6) ----------------------------------------------
// The default wording. An EM can replace any of it without a release by
// putting a talent-copy.json beside talent.json (see backend/talent.ts).

export interface BoxCopy { title: string; description: string; actions: string[] }
export type CopyTable = Record<Layout, Record<string, BoxCopy>>;
const bc = (title: string, description: string, actions: string): BoxCopy => ({ title, description, actions: actions.split('; ').map((a) => a[0].toUpperCase() + a.slice(1)) });

export const DEFAULT_COPY: CopyTable = {
  4: {
    A1: bc('Future Leader', 'Top performer with top potential; succession-ready.', 'retention plan and compensation review; enterprise-level stretch role; name in succession plan; assign an executive sponsor; leadership programme'),
    A2: bc('Star Performer', 'Excellent results with strong growth capacity.', 'stretch assignments; retention check-in; leadership exposure; mentor others; plan next-level move in 12 months'),
    A3: bc('Trusted Expert', 'Excellent results, growth mainly within role.', 'recognise mastery; knowledge-sharing role; expert or principal track; protect from burnout; optional growth path'),
    A4: bc('Seasoned Expert', 'Excellent in current role, low desire or capacity to move up.', 'retain as a role model; document critical knowledge; mentoring role; non-promotional rewards; succession backup for their skills'),
    B1: bc('Rising Star', 'Strong performer with exceptional potential.', 'targeted coaching; accelerated development plan; stretch with support; high-visibility project; review for promotion in 6–12 months'),
    B2: bc('High-Potential Performer', 'Strong results and strong growth capacity.', 'close specific skill gaps; stretch assignment; lateral move for breadth; mentor pairing; set clear promotion criteria'),
    B3: bc('Solid Professional', 'Strong results, moderate growth capacity.', 'recognition; cross-training; deepen expertise; set next-level goals; check engagement'),
    B4: bc('Reliable Specialist', 'Strong in role, limited interest or capacity to grow.', 'recognise reliability; keep skills current; specialist track; use as a trainer; review fit if the role changes'),
    C1: bc('Emerging Talent', 'Exceptional potential not yet showing in results.', 'diagnose blockers; clear 90-day goals; frequent coaching; check role fit; re-evaluate in 3–6 months'),
    C2: bc('Growth Employee', 'Meets expectations with real room to grow.', 'development plan; coaching; stretch with support; measurable goals; quarterly progress check'),
    C3: bc('Core Contributor', 'Steady, dependable performance in role.', 'keep engaged; define skill gaps; small stretch tasks; recognition; regular feedback'),
    C4: bc('Effective at Level', 'Adequate performance, limited growth signal.', 'clarify expectations; targeted skill training; check motivation; consider a better-fit role; monitor the trend'),
    D1: bc('Rough Diamond', 'High potential, low results; likely misfit or blocker.', 'find the root cause (role, manager, personal); short improvement plan; reassign if it is a fit issue; weekly check-ins; re-evaluate in 3 months'),
    D2: bc('Inconsistent Player', 'Shows ability but delivers unevenly.', 'identify underlying issues; measurable goals; structured support; clear timeline; review in 3 months'),
    D3: bc('Underperformer', 'Below expectations with modest potential.', 'clear written expectations; performance improvement plan (PIP); skills support; 60–90 day timeline; decide the next step'),
    D4: bc('Talent Risk', 'Low performance and low potential.', 'immediate expectations conversation; formal PIP; consider role transition; decisive timeline; escalate to your own manager'),
  },
  3: {
    A1: bc('Star Performers', 'Top results and top potential.', 'retention plan and compensation review; stretch goals at the next level; name in succession plan; assign an executive sponsor; leadership programme'),
    A2: bc('High Performers', 'Excellent results with solid growth capacity.', 'stretch assignments; lateral move for breadth; retention check-in; leadership exposure; plan next-level move'),
    A3: bc('Trusted Experts', 'Excellent results, growth mainly within role.', 'recognise mastery; knowledge-sharing role; expert track; protect from burnout; optional growth path'),
    B1: bc('Future Stars', 'Meets expectations with high potential.', 'targeted coaching; development plan; stretch with support; high-visibility project; review in 6 months'),
    B2: bc('Core Contributors', 'Solid results and growth capacity.', 'define skill gaps; coaching; lateral or stretch move; measurable goals; quarterly check-in'),
    B3: bc('Solid Performers', 'Reliable in role, limited growth signal.', 'keep engaged; cross-training; recognition; keep skills current; regular feedback'),
    C1: bc('Potential Gems', 'High potential not yet showing in results.', 'diagnose the root cause; short-term improvement plan; check role fit; weekly coaching; re-evaluate in 3–6 months'),
    C2: bc('Development Needed', 'Below expectations with moderate potential.', 'identify underlying issues; measurable goals; structured support; clear timeline; review in 3 months'),
    C3: bc('Action Required', 'Low performance and low potential.', 'clear written expectations; PIP or role transition; decisive timeline; skills support; escalate to your own manager'),
  },
};

/** overlay an override file on the defaults; anything malformed keeps the default */
export function mergeCopy(override: unknown): CopyTable {
  const out: CopyTable = structuredClone(DEFAULT_COPY);
  if (!override || typeof override !== 'object') return out;
  for (const layout of [3, 4] as Layout[]) {
    const o = (override as any)[String(layout)] ?? (override as any)[`${layout}x${layout}`];
    if (!o || typeof o !== 'object') continue;
    for (const box of Object.keys(out[layout])) {
      const b = o[box];
      if (!b || typeof b !== 'object') continue;
      if (typeof b.title === 'string' && b.title.trim()) out[layout][box].title = b.title.trim();
      if (typeof b.description === 'string' && b.description.trim()) out[layout][box].description = b.description.trim();
      if (Array.isArray(b.actions)) {
        const acts = b.actions.filter((a: unknown) => typeof a === 'string' && a.trim()).map((a: string) => a.trim());
        if (acts.length) out[layout][box].actions = acts.slice(0, 5);
      }
    }
  }
  return out;
}

// ---- moving someone to a box (FR-20/21) ------------------------------------

/**
 * New integer ratings for ONE axis whose weighted average lands in the target
 * band, changing as little as possible: fewest total rating points moved, then
 * the fewest criteria touched, then the average nearest the original. The
 * other axis is returned untouched. 5^5 = 3125 combinations: brute force is
 * exact and instant. Every band always contains a reachable average (all-equal
 * ratings give each whole number 1–5, and every band holds one), so this never
 * fails for valid weights.
 */
export function adjustAxis(r: Ratings, w: Weights, axis: Axis, layout: Layout, targetIdx: number): Ratings {
  const { lo, hi } = bandRange(layout, targetIdx);
  const ids = axisCriteria(axis).map((c) => c.id);
  const cur = avgX100(r, w, axis);
  if (cur >= lo && cur <= hi) return { ...r };
  let best: number[] | null = null, bestKey: number[] = [];
  const vals = [0, 0, 0, 0, 0];
  const visit = (i: number) => {
    if (i === ids.length) {
      const avg = ids.reduce((s, id, k) => s + vals[k] * w[id], 0);
      if (avg < lo || avg > hi) return;
      const moved = ids.reduce((s, id, k) => s + Math.abs(vals[k] - r[id]), 0);
      const touched = ids.reduce((s, id, k) => s + (vals[k] !== r[id] ? 1 : 0), 0);
      const key = [moved, touched, Math.abs(avg - cur)];
      if (!best || key[0] < bestKey[0] || (key[0] === bestKey[0] && (key[1] < bestKey[1] || (key[1] === bestKey[1] && key[2] < bestKey[2])))) {
        best = [...vals]; bestKey = key;
      }
      return;
    }
    for (let v = 1; v <= 5; v++) { vals[i] = v; visit(i + 1); }
  };
  visit(0);
  const out = { ...r };
  if (best) ids.forEach((id, k) => { out[id] = best![k]; });
  return out;
}

/** ratings that put someone in `box`: only the axis whose band differs changes */
export function ratingsForBox(r: Ratings, w: Weights, layout: Layout, box: string): Ratings {
  const target = parseBox(layout, box);
  if (!target) throw new Error('Pick a box on the grid.');
  const now = place(r, w, layout);
  let out = { ...r };
  if (now.perfIdx !== target.perfIdx) out = adjustAxis(out, w, 'perf', layout, target.perfIdx);
  if (now.potIdx !== target.potIdx) out = adjustAxis(out, w, 'pot', layout, target.potIdx);
  return out;
}

// ---- records ---------------------------------------------------------------

export interface HistoryEntry {
  at: string;              // ISO time
  by: string;              // who made the change
  cause: Cause;
  layout: Layout;          // the layout the box below was recorded in (FR-15)
  box: string;
  perf: number;            // averages × 100
  pot: number;
  level: Level;
  ratings: Ratings;
  weights: Weights;        // in force for that level at the time (FR-34)
  from?: string;           // moves / undos: the box before
  to?: string;
}

export interface TalentEmployee {
  id: string;
  /** the BambooHR employee this record rates; the name follows BambooHR */
  bambooId?: string;
  name: string;
  role: string;
  level: Level;
  ratings: Ratings;
  notes: string;
  rev: number;             // bumped on every save: stale saves are refused (PRD §8.3)
  createdAt: string;
  updatedAt: string;
  history: HistoryEntry[]; // oldest first; the UI shows newest first
}

export const NAME_MIN = 2, NAME_MAX = 80, NOTES_MAX = 2000, ROLE_MAX = 80;

export interface EmployeeInput { name?: unknown; role?: unknown; level?: unknown; ratings?: unknown; notes?: unknown }
/** field → message; empty when the input can be saved */
export function employeeErrors(e: EmployeeInput): Record<string, string> {
  const err: Record<string, string> = {};
  const name = typeof e.name === 'string' ? e.name.trim() : '';
  if (name.length < NAME_MIN || name.length > NAME_MAX) err.name = `Enter a name of ${NAME_MIN}–${NAME_MAX} characters.`;
  if (typeof e.role === 'string' && e.role.trim().length > ROLE_MAX) err.role = `Keep the role under ${ROLE_MAX} characters.`;
  if (!isLevel(e.level)) err.level = 'Pick a job level.';
  const r = (e.ratings ?? {}) as Record<string, unknown>;
  const missing = CRITERIA.filter((c) => !isRating(r[c.id]));
  if (missing.length) err.ratings = missing.length === CRITERIA.length ? 'Rate all 10 criteria.' : `Still to rate: ${missing.map((c) => c.label).join(', ')}.`;
  if (typeof e.notes === 'string' && e.notes.length > NOTES_MAX) err.notes = `Notes are limited to ${NOTES_MAX.toLocaleString('en')} characters.`;
  return err;
}

export const cleanRatings = (r: Ratings): Ratings => Object.fromEntries(CRITERION_IDS.map((c) => [c, r[c]])) as Ratings;

// ---- CSV export (FR-26) ----------------------------------------------------

const csvSafe = (v: string) => (/^[=+\-@\t\r]/.test(v) ? `'${v}` : v);
const csvCell = (v: string | number) => {
  const s = typeof v === 'number' ? String(v) : csvSafe(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function talentCsv(list: TalentEmployee[], weights: WeightTable, copy: CopyTable = DEFAULT_COPY, teamOf: (e: TalentEmployee) => string = () => ''): string {
  const head = ['Name', 'Team', 'Role', 'Job level',
    'Performance average', 'Performance band (3×3)', 'Performance band (4×4)',
    'Potential average', 'Potential band (3×3)', 'Potential band (4×4)',
    'Box (3×3)', 'Title (3×3)', 'Box (4×4)', 'Title (4×4)',
    ...CRITERIA.map((c) => c.label)];
  const lines = [head.map(csvCell).join(',')];
  for (const e of [...list].sort((a, b) => a.name.localeCompare(b.name))) {
    const w = weights[e.level];
    const p3 = place(e.ratings, w, 3), p4 = place(e.ratings, w, 4);
    lines.push([
      e.name, teamOf(e), e.role, levelLabel(e.level),
      fmtAvg(p3.perf), BANDS[3][p3.perfIdx].name, BANDS[4][p4.perfIdx].name,
      fmtAvg(p3.pot), BANDS[3][p3.potIdx].name, BANDS[4][p4.potIdx].name,
      p3.box, copy[3][p3.box].title, p4.box, copy[4][p4.box].title,
      ...CRITERION_IDS.map((c) => e.ratings[c]),
    ].map(csvCell).join(','));
  }
  return '﻿' + lines.join('\r\n') + '\r\n'; // BOM: Excel reads UTF-8 names correctly
}

// ---- backup (FR-27/28) -----------------------------------------------------

export const BACKUP_KIND = 'talent-grid-backup';

const isIso = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v));

function cleanHistory(h: unknown, fallbackLevel: Level): HistoryEntry[] {
  if (!Array.isArray(h)) return [];
  const out: HistoryEntry[] = [];
  for (const x of h) {
    if (!x || typeof x !== 'object' || !isIso(x.at) || !ratingsComplete(x.ratings)) continue;
    const layout: Layout = x.layout === 4 ? 4 : 3;
    const weights = weightsError(x.weights ?? {}) ? equalWeights() : cleanRatings(x.weights) as Weights;
    const level = isLevel(x.level) ? x.level : fallbackLevel;
    const p = place(x.ratings, weights, layout);
    out.push({
      at: x.at, by: typeof x.by === 'string' ? x.by.slice(0, 120) : '', layout, level,
      cause: (['created', 'edited', 'moved', 'undone', 'imported', 'reweighted'] as Cause[]).includes(x.cause) ? x.cause : 'edited',
      box: typeof x.box === 'string' && parseBox(layout, x.box) ? x.box : p.box,
      perf: Number.isInteger(x.perf) ? x.perf : p.perf, pot: Number.isInteger(x.pot) ? x.pot : p.pot,
      ratings: cleanRatings(x.ratings), weights,
      ...(typeof x.from === 'string' ? { from: x.from } : {}), ...(typeof x.to === 'string' ? { to: x.to } : {}),
    });
  }
  return out;
}

// ---- the BambooHR roster ---------------------------------------------------

/** someone in the selected BambooHR team(s) */
export interface RosterPerson { bambooId: string; name: string; team: string }

/**
 * Tie records to roster people: a record without a bambooId whose name matches
 * exactly one unlinked roster person (case and spacing ignored) is linked to
 * them. Linked records take the BambooHR name. Returns true when anything changed.
 */
export function linkToRoster(list: TalentEmployee[], roster: RosterPerson[]): boolean {
  const norm = (n: string) => n.trim().replace(/\s+/g, ' ').toLowerCase();
  const taken = new Set(list.map((e) => e.bambooId).filter(Boolean));
  let changed = false;
  for (const e of list) {
    if (e.bambooId) continue;
    const hits = roster.filter((r) => !taken.has(r.bambooId) && norm(r.name) === norm(e.name));
    if (hits.length === 1) { e.bambooId = hits[0].bambooId; taken.add(hits[0].bambooId); changed = true; }
  }
  const byId = new Map(roster.map((r) => [r.bambooId, r]));
  for (const e of list) {
    const r = e.bambooId ? byId.get(e.bambooId) : undefined;
    if (r && r.name && r.name !== e.name) { e.name = r.name; changed = true; }
  }
  return changed;
}

/** one backup record → a clean employee, or null when it cannot be imported */
export function parseBackupEmployee(x: unknown): TalentEmployee | null {
  if (!x || typeof x !== 'object') return null;
  const e = x as Record<string, any>;
  if (Object.keys(employeeErrors({ name: e.name, role: e.role ?? '', level: e.level, ratings: e.ratings, notes: e.notes ?? '' })).length) return null;
  const now = new Date().toISOString();
  return {
    id: typeof e.id === 'string' && e.id ? e.id.slice(0, 64) : '',
    ...(typeof e.bambooId === 'string' && e.bambooId ? { bambooId: e.bambooId.slice(0, 64) } : {}),
    name: String(e.name).trim(), role: typeof e.role === 'string' ? e.role.trim() : '', level: e.level,
    ratings: cleanRatings(e.ratings), notes: typeof e.notes === 'string' ? e.notes : '',
    rev: 1, createdAt: isIso(e.createdAt) ? e.createdAt : now, updatedAt: isIso(e.updatedAt) ? e.updatedAt : now,
    history: cleanHistory(e.history, e.level),
  };
}

export function parseBackup(json: unknown): { employees: TalentEmployee[]; skipped: number; weights: WeightTable | null } {
  const root = json as any;
  const list: unknown[] = Array.isArray(root) ? root : Array.isArray(root?.employees) ? root.employees : [];
  if (!Array.isArray(root) && root?.kind !== BACKUP_KIND && !Array.isArray(root?.employees)) throw new Error('That file is not a Talent Grid backup.');
  const employees: TalentEmployee[] = [];
  let skipped = 0;
  for (const x of list) { const e = parseBackupEmployee(x); if (e) employees.push(e); else skipped++; }
  let weights: WeightTable | null = null;
  if (root?.weights && typeof root.weights === 'object') {
    const w = defaultWeightTable();
    let any = false;
    for (const l of LEVEL_IDS) if (root.weights[l] && !weightsError(root.weights[l])) { w[l] = cleanRatings(root.weights[l]) as Weights; any = true; }
    if (any) weights = w;
  }
  return { employees, skipped, weights };
}
