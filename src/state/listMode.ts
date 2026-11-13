// Per-widget choice between the compact team list and ranked rows.
import { useState } from 'react';

export type ListMode = 'flow' | 'rows';
const key = (id: string) => `listMode:${id}`;

export function useListMode(id: string, fallback: ListMode = 'flow'): [ListMode, (m: ListMode) => void] {
  const [mode, setMode] = useState<ListMode>(() => {
    try { const v = localStorage.getItem(key(id)); return v === 'rows' || v === 'flow' ? v : fallback; } catch { return fallback; }
  });
  const set = (m: ListMode) => { setMode(m); try { localStorage.setItem(key(id), m); } catch { /* private mode */ } };
  return [mode, set];
}
