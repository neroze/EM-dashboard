// This viewer's remembered Projects-board state (localStorage), and wiping a
// removed project's share of it.
export const PROJECT_OPEN_KEY = 'leave-radar.projects.open';       // the one expanded card (accordion)
export const BURN_OFF_KEY = 'leave-radar.projects.burnbar.off';    // project ids left out of the side bar

/** a removed project leaves nothing behind in this viewer's storage */
export function forgetProjectUi(id: string) {
  try {
    if (JSON.parse(localStorage.getItem(PROJECT_OPEN_KEY) ?? 'null') === id) localStorage.removeItem(PROJECT_OPEN_KEY);
    const off = JSON.parse(localStorage.getItem(BURN_OFF_KEY) ?? '[]');
    if (Array.isArray(off)) localStorage.setItem(BURN_OFF_KEY, JSON.stringify(off.filter((x) => x !== id)));
  } catch { /* storage unavailable: nothing kept */ }
}
