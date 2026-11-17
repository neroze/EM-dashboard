// Team colours: each team (API key) has a colour, chosen when it is added and
// editable later. Wherever a team's name shows — the title, the picker, every
// "· team" label — it carries that colour as a dot/tint. Labels that aren't a
// team (a manual squad override) stay neutral.
import type { ReactNode } from 'react';
import { TEAM_COLORS, TeamColorCtx as Ctx, TeamOrderCtx, useTeamColor } from '../teamColors.ts';
import type { Team } from '../types.ts';

export function TeamColorProvider({ teams, children }: { teams: Team[]; children: ReactNode }) {
  const map = new Map(teams.map((t) => [t.name.toLowerCase(), t.color]));
  const pos = new Map(teams.map((t, i) => [t.name.toLowerCase(), i]));
  return (
    <Ctx.Provider value={(name) => map.get(String(name ?? '').toLowerCase())}>
      <TeamOrderCtx.Provider value={(name) => pos.get(String(name ?? '').toLowerCase()) ?? 1000}>{children}</TeamOrderCtx.Provider>
    </Ctx.Provider>
  );
}

/** one team's block in any people list: the team pill + count (+ extra), then its rows */
export function TeamGroup({ team, count, meta, children, className, style }: { team: string; count?: number; meta?: ReactNode; children: ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <div className={'tgroup' + (className ? ' ' + className : '')} style={style} data-copy-group>
      <div className="tgroup-h" data-copy-line><TeamTag name={team} />{count !== undefined && <span className="muted small">{count}</span>}{meta}</div>
      {children}
    </div>
  );
}



/** a team name with its colour: a dot + tinted pill (neutral when not a team) */
export function TeamTag({ name, plain }: { name: string; plain?: boolean }) {
  const color = useTeamColor()(name);
  if (plain) {
    return <span className="team-tag-plain" style={color ? { '--tc': color } as React.CSSProperties : undefined}>{color && <i />}{name}</span>;
  }
  return (
    <span className={'team-tag' + (color ? '' : ' neutral')} style={color ? { '--tc': color } as React.CSSProperties : undefined}>
      {color && <i />}{name}
    </span>
  );
}

/** a person's name + their team, for list rows. The team never truncates:
 *  extra text gives way first, then the name (full name on hover). */
export function PersonTeam({ person, team, extra, inline }: { person: ReactNode; team?: string; extra?: ReactNode; inline?: boolean }) {
  return (
    <span className="pt" title={typeof person === 'string' ? (team ? `${person} · ${team}` : person) : team}>
      <span className="pt-name">{person}</span>
      {team && (inline ? <TeamName name={team} /> : <TeamTag name={team} plain />)}
      {extra && <span className="pt-extra">{extra}</span>}
    </span>
  );
}

/** team name as coloured text — for inside another pill, where a nested pill would be too busy */
export function TeamName({ name }: { name: string }) {
  const color = useTeamColor()(name);
  return <span className="team-name-inline" style={color ? { '--tc': color } as React.CSSProperties : undefined}>{name}</span>;
}

/** preset swatches + a custom colour */
export function ColorPicker({ value, onChange, label = 'Team colour' }: { value: string; onChange: (c: string) => void; label?: string }) {
  const custom = !TEAM_COLORS.includes(value.toLowerCase());
  return (
    <div className="color-pick" role="radiogroup" aria-label={label}>
      {TEAM_COLORS.map((c) => (
        <button key={c} type="button" role="radio" aria-checked={value.toLowerCase() === c} aria-label={c}
          className={'swatch' + (value.toLowerCase() === c ? ' on' : '')} style={{ background: c }} onClick={() => onChange(c)} />
      ))}
      <label className={'swatch custom' + (custom ? ' on' : '')} title="Custom colour" style={custom ? { background: value } : undefined}>
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Custom colour" />
        {!custom && <span aria-hidden="true">+</span>}
      </label>
    </div>
  );
}
