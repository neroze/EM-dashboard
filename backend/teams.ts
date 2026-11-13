// Teams: one BambooHR API key per team (e.g. the SOC lead's key and the Data
// Platform lead's key). Every team's people and leave live in ONE cache; a
// team_member table records who belongs to which team, and the SELECTED
// teams decide who is in scope — pick one team or several, every view shows
// their union. Sprints / squads / holidays config stay shared.
//
// <data>/teams.json: { "selected": ["<id>", …], "teams": [{ "id", "name" }] }
// The first team, "default", keeps the pre-teams Keychain + setting names, so
// an existing install carries straight over.
import { dataPath } from './config.ts';

export interface Team { id: string; name: string; color: string }

/** preset team colours (offered in the picker; new teams take the next free one) */
export const TEAM_COLORS = ['#3b82f6', '#10b981', '#8b5cf6', '#f59e0b', '#ec4899', '#14b8a6', '#f97316', '#64748b'];
const HEX = /^#[0-9a-f]{6}$/i;
const nextColor = (used: string[]) => TEAM_COLORS.find((c) => !used.includes(c.toLowerCase())) ?? TEAM_COLORS[used.length % TEAM_COLORS.length];
interface TeamsFile { selected: string[]; teams: Team[] }

const FILE = 'teams.json';
let state: TeamsFile = { selected: ['default'], teams: [{ id: 'default', name: 'My team', color: TEAM_COLORS[0] }] };

export async function loadTeams(): Promise<void> {
  try {
    const json = JSON.parse(new TextDecoder().decode(await tjs.readFile(dataPath(FILE))));
    const teams: Team[] = Array.isArray(json?.teams)
      ? json.teams.filter((t: any) => typeof t?.id === 'string' && /^[a-z0-9-]{1,40}$/.test(t.id))
        .map((t: any) => ({ id: t.id, name: String(t.name || 'Team').slice(0, 60), color: HEX.test(t.color) ? String(t.color).toLowerCase() : '' }))
      : [];
    if (!teams.length) return;
    // teams from before colours: hand out presets in order
    for (const t of teams) if (!t.color) t.color = nextColor(teams.map((x) => x.color).filter(Boolean));
    // pre-multi files had a single "active"
    const raw: string[] = Array.isArray(json.selected) ? json.selected : json.active ? [json.active] : [];
    const selected = raw.filter((id) => teams.some((t) => t.id === id));
    state = { teams, selected: selected.length ? selected : [teams[0].id] };
  } catch { /* first run (or pre-teams install): the default team */ }
}

async function save() {
  await tjs.writeFile(dataPath(FILE), new TextEncoder().encode(JSON.stringify(state, null, 2) + '\n'));
}

export const teams = (): Team[] => state.teams.map((t) => ({ ...t }));
export const selectedIds = (): string[] => [...state.selected];
export const selectedTeams = (): Team[] => state.teams.filter((t) => state.selected.includes(t.id));
/** the first selected team: setup / demo / settings that need one team act on it */
export const primaryTeam = (): Team => selectedTeams()[0] ?? state.teams[0];
export const teamById = (id: string) => state.teams.find((t) => t.id === id) ?? null;

/** pre-multi-team cache file (migrated once, then deleted) */
export const legacyDbFileFor = (id: string) => (id === 'default' ? null : `leave-radar-${id}.sqlite`);
/** per-team name for a Keychain entry or setting — "default" keeps the original */
export const teamKey = (id: string, name: string) => (id === 'default' ? name : `team.${id}.${name}`);
export const secretName = teamKey;

/** squad overrides may only name EXTRA squads: a team's name is always
 *  decided by team membership, so a person can never appear under a team
 *  (selected or not) they don't belong to. Drops entries naming any team. */
export function withoutTeamNames(map: Record<string, string>): Record<string, string> {
  const names = new Set(state.teams.map((t) => t.name.trim().toLowerCase()));
  return Object.fromEntries(Object.entries(map).filter(([, sq]) => !names.has(String(sq).trim().toLowerCase())));
}

export async function setSelected(ids: string[]) {
  const ok = ids.filter((id, i) => ids.indexOf(id) === i && state.teams.some((t) => t.id === id));
  if (!ok.length) throw new Error('Pick at least one team.');
  state.selected = ok;
  await save();
}

export async function setTeamColor(id: string, color: string) {
  const t = state.teams.find((x) => x.id === id);
  if (!t) throw new Error('No such team.');
  if (!HEX.test(color)) throw new Error('Pick a colour like #3b82f6.');
  t.color = color.toLowerCase();
  await save();
}

export async function addTeam(name: string, color?: string): Promise<Team> {
  const clean = cleanName(name);
  if (state.teams.some((t) => t.name.toLowerCase() === clean.toLowerCase())) throw new Error(`There is already a team called “${clean}”.`);
  const base = clean.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'team';
  let id = base, n = 2;
  while (id === 'default' || state.teams.some((t) => t.id === id)) id = `${base}-${n++}`;
  const t = { id, name: clean, color: color && HEX.test(color) ? color.toLowerCase() : nextColor(state.teams.map((x) => x.color)) };
  state.teams.push(t);
  await save();
  return t;
}

export async function renameTeam(id: string, name: string) {
  const t = state.teams.find((x) => x.id === id);
  if (!t) throw new Error('No such team.');
  const clean = cleanName(name);
  if (state.teams.some((x) => x.id !== id && x.name.toLowerCase() === clean.toLowerCase())) throw new Error(`There is already a team called “${clean}”.`);
  t.name = clean;
  await save();
}

/** drops a team; the last one is reset to an empty default */
export async function removeTeam(id: string) {
  state.teams = state.teams.filter((t) => t.id !== id);
  if (!state.teams.length) state.teams = [{ id: 'default', name: 'My team', color: TEAM_COLORS[0] }];
  state.selected = state.selected.filter((s) => state.teams.some((t) => t.id === s));
  if (!state.selected.length) state.selected = [state.teams[0].id];
  await save();
}

function cleanName(name: string) {
  const s = String(name ?? '').trim().replace(/\s+/g, ' ').slice(0, 60);
  if (!s) throw new Error('Give the team a name, e.g. “SOC” or “Data Platform”.');
  return s;
}
