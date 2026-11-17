// One store for filter + view state. Every api call is made from this state;
// a saved view is `filters` as JSON; the URL hash mirrors the whole state so
// reloading (or pasting the hash) reproduces the view.
import { useSyncExternalStore } from 'react';
import { addDays, addMonths, isDate, parse } from '../../backend/domain/dates.ts';
import type { SprintInfo, Sort, UiFilters } from '../types.ts';

export type View = 'dashboard' | 'longleave' | 'calendar' | 'list' | 'capacity' | 'projects' | 'people' | 'overview';
export type Zoom = 'week' | 'sprint' | 'month';

export interface UiState {
  view: View;
  zoom: Zoom;
  sort: Sort;
  filters: UiFilters;
}

export const PRESETS: { id: string; label: string }[] = [
  { id: 'this-week', label: 'This week' },
  { id: 'this-sprint', label: 'This sprint' },
  { id: 'next-sprint', label: 'Next sprint' },
  { id: 'next-6-weeks', label: 'Next 6 weeks' },
  { id: 'next-30', label: 'Next 30 days' },
  { id: 'next-90', label: 'Next 90 days' },
  { id: 'quarter', label: 'This quarter' },
  { id: 'custom', label: 'Custom' },
];

export function defaultFilters(today: string): UiFilters {
  return {
    preset: 'next-6-weeks', from: today, to: addDays(today, 41),
    statuses: ['planned', 'draft'], types: [], people: [], teams: [], locations: [],
    duration: '', requestedFrom: '', requestedTo: '', overlapOnly: false, overlapMinPeople: null,
  };
}

/** a relative preset -> concrete dates for today (saved views stay relative) */
export function resolvePreset(preset: string, today: string, sprints: SprintInfo[], cur?: { from: string; to: string }): { from: string; to: string } {
  const current = sprints.find((s) => s.startDate <= today && s.endDate >= today);
  const twoWeeks = (start: string) => ({ from: start, to: addDays(start, 13) });
  switch (true) {
    case preset === 'this-week': {
      const wd = (new Date(parse(today)).getUTCDay() + 6) % 7; // Monday = 0
      const mon = addDays(today, -wd);
      return { from: mon, to: addDays(mon, 6) };
    }
    case preset === 'this-sprint':
      return current ? { from: current.startDate, to: current.endDate } : twoWeeks(today);
    case preset === 'next-sprint': {
      const next = sprints.find((s) => s.startDate > (current?.endDate ?? today));
      return next ? { from: next.startDate, to: next.endDate } : twoWeeks(current ? addDays(current.endDate, 1) : addDays(today, 14));
    }
    case preset === 'next-6-weeks': return { from: today, to: addDays(today, 41) };
    case preset === 'next-30': return { from: today, to: addDays(today, 29) };
    case preset === 'next-90': return { from: today, to: addDays(today, 89) };
    case preset === 'quarter': {
      const y = today.slice(0, 4), q = Math.floor((+today.slice(5, 7) - 1) / 3);
      const from = `${y}-${String(q * 3 + 1).padStart(2, '0')}-01`;
      return { from, to: addDays(addMonths(from, 3), -1) };
    }
    case preset.startsWith('sprint:'): {
      const s = sprints.find((x) => x.name === preset.slice(7));
      if (s) return { from: s.startDate, to: s.endDate };
      return cur ?? { from: today, to: addDays(today, 41) };
    }
    default: return cur ?? { from: today, to: addDays(today, 41) };
  }
}

// ---- store ------------------------------------------------------------------

let state: UiState = {
  view: 'dashboard', zoom: 'sprint', sort: { key: 'startDate', dir: 'asc' },
  filters: defaultFilters(new Date().toISOString().slice(0, 10)),
};
const subs = new Set<() => void>();
const emit = () => { for (const s of subs) s(); };

export function getState() { return state; }
export function setState(patch: Partial<UiState>) {
  state = { ...state, ...patch };
  writeHash();
  emit();
}
export function setFilters(patch: Partial<UiFilters>) {
  setState({ filters: { ...state.filters, ...patch } });
}
export function useUi(): UiState {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => state);
}

/** load a filter object (saved view / hash) and re-resolve its relative dates */
export function applyFilters(f: Partial<UiFilters>, today: string, sprints: SprintInfo[]) {
  const base = defaultFilters(today);
  const merged: UiFilters = { ...base, ...sanitize(f) };
  const dates = resolvePreset(merged.preset, today, sprints, { from: merged.from, to: merged.to });
  setFilters({ ...merged, ...dates });
}

function sanitize(f: Partial<UiFilters>): Partial<UiFilters> {
  const out: Partial<UiFilters> = {};
  const arr = (v: unknown) => (Array.isArray(v) ? v.map(String) : undefined);
  if (typeof f.preset === 'string') out.preset = f.preset;
  if (isDate(f.from)) out.from = f.from;
  if (isDate(f.to)) out.to = f.to;
  const st = arr(f.statuses)?.filter((s) => ['planned', 'draft', 'denied', 'canceled'].includes(s));
  if (st?.length) out.statuses = st as UiFilters['statuses'];
  for (const k of ['types', 'people', 'teams', 'locations'] as const) { const a = arr(f[k]); if (a) out[k] = a; }
  if (f.duration === '' || f.duration === 'half' || f.duration === 'full' || f.duration === 'week') out.duration = f.duration;
  if (typeof f.requestedFrom === 'string') out.requestedFrom = isDate(f.requestedFrom) ? f.requestedFrom : '';
  if (typeof f.requestedTo === 'string') out.requestedTo = isDate(f.requestedTo) ? f.requestedTo : '';
  if (typeof f.overlapOnly === 'boolean') out.overlapOnly = f.overlapOnly;
  if (f.overlapMinPeople === null || typeof f.overlapMinPeople === 'number') out.overlapMinPeople = f.overlapMinPeople;
  return out;
}

// ---- URL hash ---------------------------------------------------------------

function writeHash() {
  const p = new URLSearchParams();
  p.set('v', state.view);
  p.set('z', state.zoom);
  p.set('s', `${state.sort.key}:${state.sort.dir}`);
  p.set('f', JSON.stringify(state.filters));
  const h = '#' + p.toString();
  if (location.hash !== h) history.replaceState(null, '', h);
}

/** state from the hash, if any (called once lookups are known) */
export function readHash(today: string, sprints: SprintInfo[]): boolean {
  if (location.hash.length < 2) return false;
  const p = new URLSearchParams(location.hash.slice(1));
  const v = p.get('v'), z = p.get('z'), s = p.get('s');
  const patch: Partial<UiState> = {};
  if (v === 'dashboard' || v === 'longleave' || v === 'calendar' || v === 'list' || v === 'capacity' || v === 'projects' || v === 'people' || v === 'overview') patch.view = v;
  if (z === 'week' || z === 'sprint' || z === 'month') patch.zoom = z;
  if (s) {
    const [key, dir] = s.split(':');
    patch.sort = { key: key as Sort['key'], dir: dir === 'desc' ? 'desc' : 'asc' };
  }
  state = { ...state, ...patch };
  try {
    const f = JSON.parse(p.get('f') || '{}');
    applyFilters(f, today, sprints);
  } catch { setState({}); }
  return true;
}
