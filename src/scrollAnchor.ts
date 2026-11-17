// Keep the thing you clicked where it was on screen while the page re-renders
// around it. WebKit (the macOS webview) has no CSS scroll anchoring, so a
// save that reloads the board — content above changes height, a card moves in
// the urgency order — would otherwise make the page jump.
//
//   holdPosition(el)      before the change: remember el's spot on screen
//   restorePosition()     after each render: scroll so it's back there

let pending: { anchor: string; top: number; until: number } | null = null;
const HOLD_MS = 1500; // a save and the reloads it triggers land well within this

/** el must carry a data-anchor attribute that is unique on the page and survives the re-render */
export function holdPosition(el: Element) {
  const anchor = el.getAttribute('data-anchor');
  if (!anchor) return;
  pending = { anchor, top: el.getBoundingClientRect().top, until: Date.now() + HOLD_MS };
}

function scroller(el: Element): Element | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight) return p;
  }
  return document.scrollingElement;
}

/** call from a layout effect after the data re-renders; no-op unless a hold is pending */
export function restorePosition() {
  if (!pending) return;
  if (Date.now() > pending.until) { pending = null; return; }
  const el = document.querySelector(`[data-anchor="${CSS.escape(pending.anchor)}"]`);
  if (!el) return;
  const delta = el.getBoundingClientRect().top - pending.top;
  const box = scroller(el);
  if (box && Math.abs(delta) > 0.5) box.scrollTop += delta;
}
