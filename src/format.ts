// Display formatting (Intl lives in the page; the backend has none).
const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const shortFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
const wdFmt = new Intl.DateTimeFormat(undefined, { weekday: 'narrow', timeZone: 'UTC' });
const monFmt = new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' });
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const dateTimeFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

const utc = (d: string) => new Date(d + 'T00:00:00Z');

export const fmtDay = (d: string) => dayFmt.format(utc(d));
export const fmtShort = (d: string) => shortFmt.format(utc(d));
export const fmtWeekday = (d: string) => wdFmt.format(utc(d));
export const fmtMonth = (d: string) => monFmt.format(utc(d));
export const dayNum = (d: string) => String(+d.slice(8, 10));

export function fmtRange(a: string, b: string) {
  return a === b ? fmtDay(a) : `${fmtShort(a)} – ${fmtShort(b)}`;
}

export function fmtDays(n: number) {
  return n === 0.5 ? '½ day' : `${+n.toFixed(2)} ${n === 1 ? 'day' : 'days'}`;
}

export function fmtAgo(iso: string | null, now = Date.now()) {
  if (!iso) return 'never';
  const s = Math.round((now - new Date(iso).getTime()) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  const d = new Date(iso);
  return new Date().toDateString() === d.toDateString() ? `today ${timeFmt.format(d)}` : dateTimeFmt.format(d);
}

export function fmtUptime(s: number) {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
}

export const pct = (x: number) => `${Math.round(x * 100)}%`;

export const STATUS_LABEL: Record<string, string> = { planned: 'Planned', draft: 'Draft', denied: 'Denied', canceled: 'Canceled' };

export const isWeekendDay = (d: string) => { const w = utc(d).getUTCDay(); return w === 0 || w === 6; };
