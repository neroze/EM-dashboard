// Team colour constants + lookup (components live in components/TeamColor.tsx).
import { createContext, useContext } from 'react';

/** keep in step with backend/teams.ts TEAM_COLORS */
export const TEAM_COLORS = ['#3b82f6', '#10b981', '#8b5cf6', '#f59e0b', '#ec4899', '#14b8a6', '#f97316', '#64748b'];

/** team name -> colour (undefined for a label that isn't a team) */
export const TeamColorCtx = createContext<(name: string) => string | undefined>(() => undefined);
export const useTeamColor = () => useContext(TeamColorCtx);

/** team name -> sort position (your team list order; other labels after, A–Z) */
export const TeamOrderCtx = createContext<(name: string) => number>(() => 0);
export const useTeamOrder = () => useContext(TeamOrderCtx);

/** [team, items] groups in the app-wide team order */
export function groupByTeam<T>(items: T[], teamOf: (x: T) => string, order: (name: string) => number): [string, T[]][] {
  const g = new Map<string, T[]>();
  for (const x of items) { const t = teamOf(x) || 'Unassigned'; const l = g.get(t); if (l) l.push(x); else g.set(t, [x]); }
  return [...g].sort((a, b) => order(a[0]) - order(b[0]) || a[0].localeCompare(b[0]));
}

/** items grouped by team in the app-wide team order */
export function useTeamGroups<T>(items: T[], teamOf: (x: T) => string): [string, T[]][] {
  return groupByTeam(items, teamOf, useTeamOrder());
}
