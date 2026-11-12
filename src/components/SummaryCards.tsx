import { setFilters } from '../state/filters.ts';
import type { Summary } from '../types.ts';

export function SummaryCards({ s, range }: { s: Summary | null; range: string }) {
  return (
    <div className="cards">
      <div className="card">
        <div className="card-n">{s?.peopleOutToday ?? '–'}</div>
        <div className="card-l">people out today</div>
      </div>
      <button type="button" className="card clickable" title="Show Draft requests only"
        onClick={() => setFilters({ statuses: ['draft'] })}>
        <div className="card-n draft-text">{s?.draftRequests ?? '–'}</div>
        <div className="card-l">Draft requests in range{s && s.draftRequests > 0 ? ` · oldest ${s.oldestDraftDays} d` : ''}</div>
      </button>
      <button type="button" className="card clickable" title="Show overlap days only"
        onClick={() => setFilters({ overlapOnly: true })}>
        <div className={'card-n' + (s && s.overlapDays > 0 ? ' warn-text' : '')}>{s?.overlapDays ?? '–'}</div>
        <div className="card-l">overlap days in range</div>
      </button>
      <div className="card range">
        <div className="card-l">Range</div>
        <div className="card-r">{range}</div>
      </div>
    </div>
  );
}
