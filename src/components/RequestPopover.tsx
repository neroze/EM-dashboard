import { useEffect, useRef } from 'react';
import { fmtDays, fmtRange, STATUS_LABEL } from '../format.ts';
import { openInBamboo } from '../bamboo-link.ts';
import { approveLeave } from '../approve.ts';
import type { LeaveRecord } from '../types.ts';

export function RequestPopover({ rec, x, y, onClose }: { rec: LeaveRecord; x: number; y: number; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) closeRef.current(); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current(); };
    const t = setTimeout(() => document.addEventListener('mousedown', close)); // not the click that opened it
    document.addEventListener('keydown', esc);
    return () => { clearTimeout(t); document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, []);
  const left = Math.min(x + 8, window.innerWidth - 300), top = Math.min(y + 8, window.innerHeight - 220);
  return (
    <div className="popover" ref={ref} style={{ left, top }}>
      <div className="pop-title">{rec.person}</div>
      <div className="muted small">{rec.team} · {rec.location}</div>
      <div className="pop-grid">
        <span>Status</span><span><span className={'badge ' + rec.status}>{STATUS_LABEL[rec.status]}</span></span>
        <span>Type</span><span>{rec.typeName}</span>
        <span>Dates</span><span>{fmtRange(rec.startDate, rec.endDate)}</span>
        <span>Working days</span><span>{fmtDays(rec.days)}</span>
        <span>Requested</span><span>{rec.requestedAt ?? '—'}{rec.requestAgeDays !== null ? ` (${rec.requestAgeDays} d ago)` : ''}</span>
      </div>
      <div className="row">
        {rec.status === 'draft' && (
          <button type="button" className="approve primary" onClick={async () => { if (await approveLeave(rec)) closeRef.current(); }}>✓ Approve</button>
        )}
        {rec.url
          ? <button type="button" className={rec.status === 'draft' ? '' : 'primary'} onClick={() => openInBamboo(rec.url)}>Open in BambooHR ↗</button>
          : rec.status !== 'draft' && <div className="muted small">Approve or deny in BambooHR.</div>}
      </div>
    </div>
  );
}
