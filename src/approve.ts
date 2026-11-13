// Approve a draft (requested) leave request in BambooHR — the app's only
// write. Always asks first; the result shows as a toast (App listens for the
// event). On success the backend updates its cache and pushes data-changed,
// so every view refreshes on its own.
import { api } from './api.ts';
import { fmtDays, fmtRange } from './format.ts';

export const TOAST_EVENT = 'leave-radar:toast';
export const toast = (text: string) => window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: text }));

const pending = new Set<string>();

/** opts.notify: also post a system notification (for actions taken from the
 *  menu bar, where the window and its toasts may not be in view) */
export async function approveLeave(r: { id: string; person: string; typeName: string; startDate: string; endDate: string; days?: number }, opts: { notify?: boolean } = {}): Promise<boolean> {
  const say = (title: string, text: string) => {
    toast(text);
    if (opts.notify) void tiny.notify(title, text);
  };
  if (pending.has(r.id)) return false;
  const what = `${r.typeName}, ${fmtRange(r.startDate, r.endDate)}${r.days ? ` (${fmtDays(r.days)})` : ''}`;
  const ok = await tiny.dialog.confirm(`Approve ${r.person}’s leave?`, {
    detail: `${what}\n\nThis approves the request in BambooHR — ${r.person} and anyone notified by BambooHR will see it.`,
    ok: 'Approve', cancel: 'Cancel',
  });
  if (!ok) return false;
  pending.add(r.id);
  try {
    await api.approveRequest(r.id);
    say('Leave approved', `Approved ${r.person}’s ${r.typeName.toLowerCase()} (${fmtRange(r.startDate, r.endDate)})`);
    return true;
  } catch (e: any) {
    say('Leave not approved', String(e?.message ?? e).replace(/^Error:\s*/, ''));
    return false;
  } finally {
    pending.delete(r.id);
  }
}
