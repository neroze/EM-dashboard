// The one layout for LONG people lists, used by every widget that lists
// people per date / month ("Leave on the same day", "Long / Mini leave by
// month"): a compact label column (date or month), then per team its pill
// on its own line with that team's names wrapping below — plain text with a
// status dot. Blocks sit side by side when the widget is wide and stack when it is
// narrow; long lists show the first few blocks with "Show all". TeamFlow is the
// same team list without the date column, for every other people list.
import { useState, type ReactNode } from 'react';
import { useTeamGroups } from '../teamColors.ts';
import { TeamTag } from './TeamColor.tsx';

export interface FlowPerson {
  key: string;
  name: string;
  team: string;
  status: string;      // planned | draft | mixed | denied — the dot colour
  suffix?: string;     // e.g. "½" or "10d"
  detail?: ReactNode;  // e.g. the leave type + dates, on a line below the name
  lead?: ReactNode;    // replaces the status dot, e.g. a rank number
  actions?: ReactNode; // small buttons after the name (approve, open)
  meter?: number;      // rows mode: 0..1 bar length (share of the top value)
  meterColor?: string;
  value?: ReactNode;   // rows mode: the figure at the row's end (e.g. "4 d · 2 req")
  title?: string;      // hover detail
}
export interface FlowBlock {
  key: string;
  label: ReactNode;    // e.g. "12 Nov" or a month pill
  sub?: ReactNode;     // e.g. "Thu · 4"
  current?: boolean;
  past?: boolean;
  people: FlowPerson[];
}

export function PeopleFlow({ blocks, show = 6, unit = 'days', empty, detailed, rows }: {
  blocks: FlowBlock[]; show?: number; unit?: string; empty?: ReactNode;
  /** show each person's detail line (type, dates) instead of only on hover */
  detailed?: boolean;
  /** each block's people as rows (see TeamFlow) */
  rows?: boolean;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? blocks : blocks.slice(0, show);
  if (!blocks.length) return <>{empty ?? null}</>;
  return (
    <>
      <div className="sd-list">
        {shown.map((b) => (
          <div key={b.key} className={'sd-day' + (b.current ? ' today' : b.past ? ' past' : '')} data-copy-group>
            <div className="sd-date" data-copy-line>
              <b>{b.label}</b>
              {b.sub !== undefined && <span>{b.sub}</span>}
            </div>
            <TeamFlow people={b.people} detailed={detailed} rows={rows} />
          </div>
        ))}
      </div>
      {blocks.length > show && (
        <button type="button" className="link small sd-more" onClick={() => setAll((a) => !a)}>
          {all ? 'Show fewer' : `Show all ${blocks.length} ${unit}`}
        </button>
      )}
    </>
  );
}

/** THE team list, used by every widget that lists people — the "on the same
 *  day" look: per team its pill (+ count / meta) on its own line, then its
 *  people flowing like text (status dot, name, days, quick buttons). Type and
 *  dates show on hover; `detailed` puts them on a line under each name, in
 *  responsive columns (side by side when wide, one column when narrow). */
export function TeamFlow({ people, counts, meta, empty, detailed, rows }: {
  people: FlowPerson[];
  /** show each team's head count next to its pill */
  counts?: boolean;
  /** extra text after the pill, e.g. the team's total days */
  meta?: (team: string, list: FlowPerson[]) => ReactNode;
  empty?: ReactNode;
  detailed?: boolean;
  /** ranked rows instead of flowing names: one line per person with its detail, a bar and the value */
  rows?: boolean;
}) {
  const teams = useTeamGroups(people, (p) => p.team);
  if (!people.length) return <>{empty ?? null}</>;
  return (
    <div className="sd-flow">
      {teams.map(([team, list]) => (
        <div key={team} className="sd-team" data-copy-group>
          <div className="sd-team-h" data-copy-line>
            <TeamTag name={team} />
            {counts && <span className="muted small">{list.length}</span>}
            {meta?.(team, list)}
          </div>
          {rows ? (
            <div className="sd-rows">{list.map((p) => <FlowRow key={p.key} p={p} team={team} />)}</div>
          ) : (
            <div className={'sd-names' + (detailed && list.some((p) => p.detail) ? ' sd-grid' : '')}>
              {list.map((p) => <FlowName key={p.key} p={p} team={team} detailed={detailed} />)}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/** one ranked row: rank/dot · name, with its bar + detail below · value · buttons */
function FlowRow({ p, team }: { p: FlowPerson; team: string }) {
  return (
    <div className={'sd-row ' + p.status} title={p.title ?? `${p.name} · ${team}`} data-copy-line>
      <span className="sd-row-lead">{p.lead ?? <i className="sd-dot" />}</span>
      <span className="sd-row-main">
        <span className="sd-row-name">{p.name}</span>
        {(p.meter !== undefined || p.detail) && (
          <span className="sd-row-sub">
            {p.meter !== undefined && (
              <span className="sd-row-bar"><span style={{ width: `${Math.max(2, p.meter * 100)}%`, background: p.meterColor ?? 'var(--accent)' }} /></span>
            )}
            {p.detail && <small className="sd-row-detail">{p.detail}</small>}
          </span>
        )}
      </span>
      <span className="sd-row-v">{p.value ?? p.suffix}</span>
      {p.actions && <span className="sd-act">{p.actions}</span>}
    </div>
  );
}

/** the switch between flowing names and ranked rows, for a widget header */
export function ListModeSwitch({ mode, onChange, rowsLabel = 'List' }: { mode: 'flow' | 'rows'; onChange: (m: 'flow' | 'rows') => void; rowsLabel?: string }) {
  return (
    <div className="seg small-seg list-mode" role="group" aria-label="List view">
      <button type="button" className={'chip' + (mode === 'flow' ? ' on' : '')} aria-pressed={mode === 'flow'} title="Compact — names flow under each team" onClick={() => onChange('flow')}>
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><rect x="1.5" y="3" width="5" height="3" rx="1.5" fill="currentColor" /><rect x="8" y="3" width="6.5" height="3" rx="1.5" fill="currentColor" /><rect x="1.5" y="9" width="7" height="3" rx="1.5" fill="currentColor" /><rect x="10" y="9" width="4.5" height="3" rx="1.5" fill="currentColor" /></svg>
        Compact
      </button>
      <button type="button" className={'chip' + (mode === 'rows' ? ' on' : '')} aria-pressed={mode === 'rows'} title={`${rowsLabel} — one row per person with type, dates and days`} onClick={() => onChange('rows')}>
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M2 3.5h2M2 8h2M2 12.5h2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /><path d="M6 3.5h8M6 8h6M6 12.5h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
        {rowsLabel}
      </button>
    </div>
  );
}

function FlowName({ p, team, detailed }: { p: FlowPerson; team: string; detailed?: boolean }) {
  const title = p.title ?? `${p.name} · ${team}`;
  const name = (
    <span className={'sd-name ' + p.status} title={detailed && p.detail ? undefined : title} data-copy-line>
      {p.lead ?? <i />}<span className="sd-n">{p.name}</span>{p.suffix && <small className="sd-suffix">{p.suffix}</small>}
      {p.actions && <span className="sd-act">{p.actions}</span>}
    </span>
  );
  // with detail: name on top, detail (type, dates) on a muted line below
  return detailed && p.detail ? (
    <span className="sd-person" title={title} data-copy-line>
      {name}<small className="sd-detail">{p.detail}</small>
    </span>
  ) : name;
}
