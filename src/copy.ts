// Copy a widget's data as a bullet list: what's on screen, one bullet per
// table row ("label — Column: value; …") or list entry, nested rows and
// grouped entries as sub-bullets. Goes
// on the clipboard as "- " text and as an HTML <ul>, so it pastes as real
// bullets in Confluence, Docs, Slack and as a plain list anywhere else.
// Reads the rendered DOM so every widget copies exactly what it shows —
// collapsed rows stay out, expanded ones come along.

const GLYPHS = /[▸▾●▲■⧉✓]/g;

/** controls aren't data: pickers, inputs, switches, the copy button, and
 *  link-style actions outside tables ("Collapse all"). Other buttons carry
 *  data (epic keys, quarter cards) and are kept. Charts give their numbers
 *  through data-copy-table instead (see blocks). */
function skip(el: Element): boolean {
  if (el.closest('[data-nocopy]') || el.matches('select, input, textarea, svg, [aria-hidden="true"], .copy-btn, .chip, .seg, .sel-btn, .sel-pop')) return true;
  if (el.tagName === 'BUTTON' && el.classList.contains('link') && !el.hasAttribute('data-copy-keep') && !el.closest('td, th, h1, h2, h3, h4')) return true;
  const s = getComputedStyle(el);
  return s.display === 'none' || s.visibility === 'hidden';
}

const isBlock = (el: Element) => { const d = getComputedStyle(el).display; return !d.startsWith('inline') && d !== 'contents'; };

/** visible text, block children on their own lines */
function textOf(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  if (!(node instanceof Element) || skip(node) || node.tagName === 'TABLE' || node.hasAttribute('data-copy-table') || node.hasAttribute('data-copy-list')) return '';
  if (node.tagName === 'BR') return '\n';
  const inner = [...node.childNodes].map(textOf).join('');
  const d = getComputedStyle(node).display;
  if (d === 'inline-block' || d === 'inline-flex') return ` ${inner} `; // pills / badges: keep them apart from their neighbours
  return isBlock(node) ? `\n${inner}\n` : inner;
}
const lines = (s: string) => s.replace(GLYPHS, '').replace(/ /g, ' ').split('\n').map((x) => x.replace(/[ \t]+/g, ' ').trim()).filter(Boolean);
const cellText = (el: Element) => lines(textOf(el)).join(' · ');

/** a bullet; kids are its sub-bullets */
export interface Item { text: string; kids?: Item[] }
type Block = { kind: 'h'; text: string } | { kind: 'p'; text: string } | { kind: 'l'; items: Item[] };

const EMPTY = new Set(['', '—', '–', '-']);
const INLINE_MAX = 110; // a row longer than this splits its columns into sub-bullets

/** one row → one bullet: the first value is the label, the rest "Column: value" */
function rowItem(values: string[], headers: string[]): Item | null {
  const at = values.findIndex((v) => !EMPTY.has(v));
  if (at < 0) return null;
  const label = values[at];
  const fields = values.flatMap((v, i) => (i <= at || EMPTY.has(v) ? [] : [headers[i] ? `${headers[i]}: ${v}` : v]));
  if (!fields.length) return { text: label };
  const inline = `${label} — ${fields.join('; ')}`;
  return inline.length <= INLINE_MAX ? { text: inline } : { text: label, kids: fields.map((text) => ({ text })) };
}

/** a table's rows as bullets; an expanded detail table inside a row becomes its sub-bullets */
function tableItems(t: HTMLTableElement): Item[] {
  const out: Item[] = [];
  let headers: string[] = [];
  for (const tr of [...t.rows]) {
    if (skip(tr)) continue;
    const cells = [...tr.cells];
    const nested = tr.querySelector(':scope > td table, :scope > th table') as HTMLTableElement | null;
    if (nested) {
      const kids = tableItems(nested);
      const lead = cells.map((c) => cellText(c)).filter(Boolean).join(' · ');
      if (lead) out.push({ text: lead, kids });
      else if (out.length) { const last = out[out.length - 1]; last.kids = [...(last.kids ?? []), ...kids]; }
      else out.push(...kids);
      continue;
    }
    // expand colspans so values line up with their column names
    const values = cells.flatMap((c) => [skip(c) ? '' : cellText(c), ...Array<string>((c.colSpan || 1) - 1).fill('')]);
    if (cells.length && cells.every((c) => c.tagName === 'TH')) { headers = values; continue; } // the header row names the columns
    const it = rowItem(values, headers);
    if (it) out.push(it);
  }
  return out;
}

/** a chart's own rows: data-copy-table = [[header…], [row…], …] */
function dataTable(el: Element): Block[] {
  try {
    const [headers, ...rows] = (JSON.parse(el.getAttribute('data-copy-table') ?? '') as (string | number)[][]).map((r) => r.map(String));
    const items = rows.map((r) => rowItem(r, headers ?? [])).filter((x): x is Item => !!x);
    return items.length ? [{ kind: 'l', items }] : [];
  } catch { return []; } // malformed: leave it out
}
/** a board's own bullets: data-copy-list = Item[] */
function dataList(el: Element): Block[] {
  try { const items = JSON.parse(el.getAttribute('data-copy-list') ?? '') as Item[]; return items.length ? [{ kind: 'l', items }] : []; } catch { return []; }
}

// ---- non-table content: layout → bullets ----------------------------------
// A one-line row (a pill, a name with its days, a tile's label) is one bullet;
// a wrapping list (pills, names, legend) is a bullet per entry; a label with
// content under it (a team and its people, a tile and its figures) is a
// bullet with sub-bullets. Headings stay plain lines. Where layout can't
// tell, components say so: data-copy-line (one bullet), data-copy-group
// (first part = parent bullet, the rest = its sub-bullets).
const HEADING = 'h1, h2, h3, h4, h5, h6, header, .w-head, .pg-title, .mnames-head, .ll-now-h';
const SPECIAL = 'table, [data-copy-table], [data-copy-list]';
const LABEL_MAX = 60; // a first line this short can head the lines after it

const style = (el: Element) => getComputedStyle(el);
const flexRow = (el: Element) => { const s = style(el); return (s.display === 'flex' || s.display === 'inline-flex') && !s.flexDirection.startsWith('column'); };
const wraps = (el: Element) => { const s = style(el); return (s.display.includes('flex') && s.flexWrap !== 'nowrap') || s.display.includes('grid'); };
/** a figure: "24", "5d", "67%", "½", "120 days", "80 of 120 days" */
const FIGURE = /^[−+-]?[\d.,½]+(\s*(%|d|h|days?|requests?|people|person|tickets?|leaves?)\b|%)?(\s+of\s+[\d.,]+(\s*\w+)?)?$/i;
/** "Approved" + "24" → "Approved: 24"; other parts join with " · " */
const lineOf = (n: Node) => {
  const ps = lines(textOf(n));
  return ps.length === 2 && !FIGURE.test(ps[0]) && FIGURE.test(ps[1]) ? `${ps[0]}: ${ps[1]}` : ps.join(' · ');
};
const hasText = (n: Node) => lineOf(n) !== '';

/** direct children as layout units: box children on their own, runs of
 *  inline content / text joined into one unit */
function units(el: Element): (Element | Node[])[] {
  const out: (Element | Node[])[] = [];
  let run: Node[] = [];
  const flush = () => { if (run.some(hasText)) out.push(run); run = []; };
  const blockified = style(el).display.includes('flex') || style(el).display.includes('grid');
  for (const c of [...el.childNodes]) {
    if (c instanceof Element) {
      if (skip(c)) continue;
      const d = style(c).display;
      if (blockified || c.matches(SPECIAL) || !(d === 'inline' || d === 'contents')) { flush(); if (c.matches(SPECIAL) || hasText(c) || c.querySelector(SPECIAL)) out.push(c); continue; }
    }
    run.push(c);
  }
  flush();
  return out;
}

function nodeItems(el: Element): Item[] {
  if (skip(el)) return [];
  if (el.tagName === 'TABLE') return tableItems(el as HTMLTableElement);
  if (el.hasAttribute('data-copy-table')) return dataTable(el).flatMap((b) => (b.kind === 'l' ? b.items : []));
  if (el.hasAttribute('data-copy-list')) return dataList(el).flatMap((b) => (b.kind === 'l' ? b.items : []));
  const special = !!el.querySelector(SPECIAL);
  const one = (): Item[] => { const t = lineOf(el); return t ? [{ text: t }] : []; };
  if (el.hasAttribute('data-copy-line')) return one(); // marked: one bullet
  if (!special && flexRow(el) && !wraps(el)) return one(); // a row reads as one line
  const us = units(el);
  if (!special && us.every((u) => Array.isArray(u))) return one(); // only text inside
  const parts = us.map((u): Item[] => {
    if (!Array.isArray(u)) return nodeItems(u);
    const t = u.map(lineOf).filter(Boolean).join(' ');
    return t ? [{ text: t }] : [];
  });
  const flat = parts.flat();
  // marked group: the first part is the parent, the rest its sub-bullets (a team and its people)
  if (el.hasAttribute('data-copy-group') && parts.length >= 2 && parts[0].length >= 1) {
    const [head, ...rest] = parts[0];
    return [{ text: head.text, kids: [...(head.kids ?? []), ...rest, ...parts.slice(1).flat()] }];
  }
  // a short first line heads what follows (a team and its people, a tile and its figures)
  if (!wraps(el) && parts.length >= 2 && parts[0].length === 1 && !parts[0][0].kids && parts[0][0].text.length <= LABEL_MAX && flat.length > 1) {
    const kids = parts.slice(1).flat();
    // a tile: its label + headline figure on one line, the detail below
    if (!kids[0].kids && FIGURE.test(kids[0].text)) {
      const [fig, ...rest] = kids;
      return [rest.length ? { text: `${parts[0][0].text}: ${fig.text}`, kids: rest } : { text: `${parts[0][0].text}: ${fig.text}` }];
    }
    return [{ text: parts[0][0].text, kids }];
  }
  return flat;
}

function blocks(root: Element, out: Block[] = []): Block[] {
  const add = (items: Item[]) => {
    if (!items.length) return;
    const last = out[out.length - 1];
    if (last?.kind === 'l') last.items.push(...items); else out.push({ kind: 'l', items });
  };
  for (const u of units(root)) {
    if (Array.isArray(u)) { const t = u.map(lineOf).filter(Boolean).join(' '); if (t) add([{ text: t }]); continue; }
    if (u.matches(HEADING)) { const t = lineOf(u); if (t) out.push({ kind: 'h', text: t }); continue; }
    if (u.querySelector(HEADING) && !u.matches(SPECIAL)) { blocks(u, out); continue; } // a sub-section: keep its heading
    add(nodeItems(u));
  }
  return out;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const textList = (items: Item[], depth = 0): string[] =>
  items.flatMap((i) => [`${'  '.repeat(depth)}- ${i.text}`, ...textList(i.kids ?? [], depth + 1)]);
const htmlList = (items: Item[]): string =>
  '<ul>' + items.map((i) => `<li>${esc(i.text)}${i.kids?.length ? htmlList(i.kids) : ''}</li>`).join('') + '</ul>';

export function serialise(root: Element): { text: string; html: string } {
  const bs = root.hasAttribute('data-copy-list') ? dataList(root) : root.hasAttribute('data-copy-table') ? dataTable(root) : blocks(root);
  // headings and notes on their own lines, a blank line around each list
  const text = bs.map((b, i) => {
    const s = b.kind === 'l' ? textList(b.items).join('\n') : b.text;
    return i === 0 ? s : (b.kind === 'l' || bs[i - 1].kind === 'l' || b.kind === 'h' ? '\n\n' : '\n') + s;
  }).join('');
  const html = bs.map((b) => (b.kind === 'h' ? `<h3>${esc(b.text)}</h3>` : b.kind === 'p' ? `<p>${esc(b.text)}</p>` : htmlList(b.items))).join('\n');
  return { text, html };
}

/** rows for a chart's data-copy-table attribute (header row first) */
export const copyTable = (rows: (string | number)[][]) => JSON.stringify(rows);
/** bullets for a board's data-copy-list attribute */
export const copyList = (items: Item[]) => JSON.stringify(items);

/** copy the element's data to the clipboard (native when available) */
export async function copyElement(root: Element): Promise<void> {
  const { text, html } = serialise(root);
  try { await tiny.clipboard.write({ text, html }); return; } catch { /* outside tinyjs: fall back */ }
  try { await navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob([text], { type: 'text/plain' }), 'text/html': new Blob([html], { type: 'text/html' }) })]); return; } catch { /* fall back */ }
  await navigator.clipboard.writeText(text);
}
