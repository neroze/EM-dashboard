// Saved widget / section order per grid id (localStorage — a per-viewer
// convenience; when storage is unavailable the order just isn't remembered).
const STORE = 'layout:';
export const LAYOUT_RESET_EVENT = 'leave-radar:layout-reset';

export function loadLayout(id: string): string[] {
  try { const v = JSON.parse(localStorage.getItem(STORE + id) || '[]'); return Array.isArray(v) ? v.map(String) : []; } catch { return []; }
}

export function saveLayout(id: string, order: string[]) {
  try { localStorage.setItem(STORE + id, JSON.stringify(order)); } catch { /* storage unavailable */ }
}

/** forget every saved layout (all Sortables re-render in default order) */
export function resetLayouts() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(STORE)) localStorage.removeItem(k);
  } catch { /* storage unavailable */ }
  window.dispatchEvent(new Event(LAYOUT_RESET_EVENT));
}
