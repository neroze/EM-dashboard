// Filter panel — a collapsible sidebar on the right. All filters combine:
// AND across fields, OR within a field. On the dashboard (fixed windows) only
// the who-filters apply, so the date / status / type controls are hidden.
import { useState } from 'react';
import { applyFilters, defaultFilters, PRESETS, resolvePreset, setFilters, useUi } from '../state/filters.ts';
import type { Lookups, SavedView, UiFilters } from '../types.ts';
import { MultiSelect } from './MultiSelect.tsx';
import { Select } from './Select.tsx';
import { sprintName } from '../format.ts';
import { TeamTag } from './TeamColor.tsx';
import { groupByTeam, useTeamOrder } from '../teamColors.ts';

const DURATIONS: { value: UiFilters['duration']; label: string }[] = [
  { value: '', label: 'Any duration' },
  { value: 'half', label: 'Half day' },
  { value: 'full', label: 'Full day +' },
  { value: 'week', label: '≥ 5 days' },
];

/** how many filters differ from "everything" — shown on the collapsed strip */
function activeFilterCount(f: UiFilters, dashboard: boolean) {
  const who = [f.teams, f.people, f.locations].filter((a) => a.length).length;
  if (dashboard) return who;
  return who + (f.types.length ? 1 : 0) + (f.duration ? 1 : 0) + (f.overlapOnly ? 1 : 0)
    + (f.requestedFrom || f.requestedTo ? 1 : 0);
}

export function FilterBar({ lookups, views, onSaveView, onDeleteView, dashboard, collapsed, onToggle }: {
  lookups: Lookups;
  views: SavedView[];
  onSaveView: () => void;
  onDeleteView: (name: string) => void;
  dashboard: boolean;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const { filters: f } = useUi();
  const teamOrder = useTeamOrder();
  const [more, setMore] = useState(false);
  const showResolved = f.statuses.includes('denied') || f.statuses.includes('canceled');
  const count = activeFilterCount(f, dashboard);

  if (collapsed) {
    return (
      <aside className="side collapsed">
        <button type="button" className="side-toggle" onClick={onToggle} title="Show filters (⌘B)" aria-label="Show filters">‹</button>
        <button type="button" className="side-vlabel" onClick={onToggle} title="Show filters (⌘B)">
          Filters{count ? <span className="side-badge">{count}</span> : null}
        </button>
      </aside>
    );
  }

  const setPreset = (preset: string) => {
    const dates = resolvePreset(preset, lookups.today, lookups.sprints, { from: f.from, to: f.to });
    setFilters({ preset, ...dates });
  };
  const toggleStatus = (s: UiFilters['statuses'][number]) => {
    const next = f.statuses.includes(s) ? f.statuses.filter((x) => x !== s) : [...f.statuses, s];
    setFilters({ statuses: next.length ? next : [s] }); // never empty: empty would mean "default"
  };
  const sprintValue = f.preset.startsWith('sprint:') ? f.preset.slice(7) : '';
  const moreCount = (f.requestedFrom || f.requestedTo ? 1 : 0);

  return (
    <aside className="side">
      <div className="side-head">
        <span className="side-title">Filters{count ? <span className="side-badge">{count}</span> : null}</span>
        <button type="button" className="link small" onClick={() => applyFilters(defaultFilters(lookups.today), lookups.today, lookups.sprints)}>Reset</button>
        <button type="button" className="side-toggle" onClick={onToggle} title="Hide filters (⌘B)" aria-label="Hide filters">›</button>
      </div>

      <div className="side-body">
        {dashboard && <div className="muted small side-note">This view picks its own dates. Only these filters apply.</div>}

        {!dashboard && (
          <div className="side-sec">
            <div className="side-h">Date range</div>
            <Select title="Date range preset" value={PRESETS.some((p) => p.id === f.preset) || f.preset === 'months' ? f.preset : 'custom'} onChange={setPreset}
              options={[...PRESETS.map((p) => ({ value: p.id, label: p.label })), ...(f.preset === 'months' ? [{ value: 'months', label: 'Month range' }] : [])]} />
            <Select title="Sprint (Sprint Mapping - Webx)" value={sprintValue}
              onChange={(v) => (v ? setPreset('sprint:' + v) : setPreset('this-sprint'))}
              options={[{ value: '', label: 'Sprint…' }, ...lookups.sprints.map((s) => ({
                value: s.name,
                label: sprintName(s.name) + (s.startDate <= lookups.today && s.endDate >= lookups.today ? ' (current)' : ''),
              }))]} />
            <div className="side-dates">
              <input type="date" value={f.from} max={f.to} aria-label="From" onChange={(e) => e.target.value && setFilters({ from: e.target.value, preset: 'custom' })} />
              <span className="muted">→</span>
              <input type="date" value={f.to} min={f.from} aria-label="To" onChange={(e) => e.target.value && setFilters({ to: e.target.value, preset: 'custom' })} />
            </div>
          </div>
        )}

        {!dashboard && (
          <div className="side-sec">
            <div className="side-h">Status</div>
            <div className="seg wrap" role="group" aria-label="Status">
              <button type="button" className={'chip planned' + (f.statuses.includes('planned') ? ' on' : '')} onClick={() => toggleStatus('planned')}>Planned</button>
              <button type="button" className={'chip draft' + (f.statuses.includes('draft') ? ' on' : '')} onClick={() => toggleStatus('draft')}>Draft</button>
              {showResolved && (
                <>
                  <button type="button" className={'chip denied' + (f.statuses.includes('denied') ? ' on' : '')} onClick={() => toggleStatus('denied')}>Denied</button>
                  <button type="button" className={'chip denied' + (f.statuses.includes('canceled') ? ' on' : '')} onClick={() => toggleStatus('canceled')}>Canceled</button>
                </>
              )}
            </div>
            <label className="toggle small" title="Show denied / canceled requests">
              <input type="checkbox" checked={showResolved}
                onChange={(e) => setFilters({ statuses: e.target.checked ? [...new Set([...f.statuses, 'denied', 'canceled'] as const)] : f.statuses.filter((s) => s === 'planned' || s === 'draft').length ? f.statuses.filter((s) => s === 'planned' || s === 'draft') : ['planned', 'draft'] })} />
              Show denied / canceled
            </label>
          </div>
        )}

        <div className="side-sec">
          <div className="side-h">Who</div>
          <MultiSelect inline label="Squad" value={f.teams} onChange={(teams) => setFilters({ teams })}
            options={lookups.teams.map((t) => ({ value: t, label: t }))} />
          <MultiSelect inline label="Person" search value={f.people} onChange={(people) => setFilters({ people })}
            groupLabel={(g) => <TeamTag name={g} />}
            options={groupByTeam(lookups.people, (p) => p.team, teamOrder)
              .flatMap(([team, list]) => list.map((p) => ({ value: p.id, label: p.name, group: team })))} />
          <MultiSelect inline label="Location" value={f.locations} onChange={(locations) => setFilters({ locations })}
            options={lookups.locations.map((l) => ({ value: l, label: l }))} />
        </div>

        {!dashboard && (
          <div className="side-sec">
            <div className="side-h">Leave</div>
            <MultiSelect inline label="Type" value={f.types} onChange={(types) => setFilters({ types })}
              options={lookups.types.map((t) => ({ value: t.id, label: t.name }))} />
            <Select title="Duration" value={f.duration} onChange={(duration) => setFilters({ duration })} options={DURATIONS} />
            <label className="toggle" title="Only days where the squad's out-share reaches its threshold (or ≥ N people)">
              <input type="checkbox" checked={f.overlapOnly} onChange={(e) => setFilters({ overlapOnly: e.target.checked })} />
              Overlap only
            </label>
            {f.overlapOnly && (
              <label className="small muted">≥
                <input type="number" min={1} max={50} className="num" placeholder="thr."
                  value={f.overlapMinPeople ?? ''} onChange={(e) => setFilters({ overlapMinPeople: e.target.value ? Math.max(1, +e.target.value) : null })} />
                people
              </label>
            )}
            <button type="button" className={'link side-more' + (moreCount ? ' strong' : '')} onClick={() => setMore((m) => !m)}>
              {more ? '▾ Less' : '▸ More'}{moreCount ? ` (${moreCount})` : ''}
            </button>
            {more && (
              <>
                <span className="small muted">Requested between</span>
                <div className="side-dates">
                  <input type="date" value={f.requestedFrom} aria-label="Requested from" onChange={(e) => setFilters({ requestedFrom: e.target.value })} />
                  <span className="muted">→</span>
                  <input type="date" value={f.requestedTo} aria-label="Requested to" onChange={(e) => setFilters({ requestedTo: e.target.value })} />
                </div>
                <div className="row wrap">
                  <button type="button" className="link small" title="Draft requests waiting more than a week"
                    onClick={() => {
                      const d = new Date(lookups.today + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 7);
                      setFilters({ statuses: ['draft'], requestedFrom: '', requestedTo: d.toISOString().slice(0, 10) });
                    }}>Drafts waiting &gt; 7 days</button>
                  {(f.requestedFrom || f.requestedTo) && <button type="button" className="link small" onClick={() => setFilters({ requestedFrom: '', requestedTo: '' })}>Clear</button>}
                </div>
              </>
            )}
          </div>
        )}

        <div className="side-sec">
          <div className="side-h">Saved views</div>
          <Select title="Saved views" value="" display="Open a saved view…"
            onChange={(name) => {
              const v = views.find((x) => x.name === name);
              if (v) applyFilters(v.filters, lookups.today, lookups.sprints);
            }}
            options={views.length ? views.map((v) => ({ value: v.name, label: v.name })) : [{ value: '', label: 'No saved views yet' }]} />
          <div className="row">
            <button type="button" className="grow-btn" onClick={onSaveView} title="Save the current filters as a view (⌘S)">Save view</button>
            {views.length > 0 && (
              <Select title="Delete a saved view" value="" display="🗑" minWidth={180}
                onChange={(name) => name && onDeleteView(name)}
                options={views.map((v) => ({ value: v.name, label: `Delete “${v.name}”` }))} />
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}
