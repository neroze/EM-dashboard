// Appearance: follow macOS (System), or force Light / Dark. Sets
// <html data-theme>, which index.css's dark rules honour. Remembered per
// viewer in localStorage; applied before the first render (main.tsx).
import { useEffect, useState } from 'react';

export type Theme = 'system' | 'light' | 'dark';
export const THEMES: { id: Theme; label: string; icon: string }[] = [
  { id: 'system', label: 'System', icon: '◐' },
  { id: 'light', label: 'Light', icon: '☀' },
  { id: 'dark', label: 'Dark', icon: '☾' },
];
const KEY = 'leave-radar.theme';
const EVENT = 'leave-radar:theme';

export function getTheme(): Theme {
  try { const v = localStorage.getItem(KEY); return v === 'light' || v === 'dark' ? v : 'system'; } catch { return 'system'; }
}

export function applyTheme(t: Theme = getTheme()) {
  const root = document.documentElement;
  if (t === 'system') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', t);
}

export function setTheme(t: Theme) {
  try { if (t === 'system') localStorage.removeItem(KEY); else localStorage.setItem(KEY, t); } catch { /* not remembered */ }
  applyTheme(t);
  window.dispatchEvent(new Event(EVENT));
}

/** System → Light → Dark → System */
export const nextTheme = (t: Theme): Theme => (t === 'system' ? 'light' : t === 'light' ? 'dark' : 'system');

export function useTheme(): Theme {
  const [t, set] = useState(getTheme);
  useEffect(() => {
    const on = () => set(getTheme());
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  return t;
}
