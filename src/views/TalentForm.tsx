// Add / edit one direct report (FR-01, FR-02, FR-04): name, role, job level,
// the 10 ratings and notes, with a live preview of the box they will land in.
import { useEffect, useRef, useState } from 'react';
import { api, type TalentInput, type TalentState } from '../api.ts';
import {
  axisCriteria, BANDS, employeeErrors, fmtAvg, LEVELS, NOTES_MAX, place, ratingsComplete, SCALE, zoneOf, zoneInfo,
  type Axis, type CriterionId, type Layout, type RosterPerson, type TalentEmployee,
} from '../../backend/domain/talent.ts';

export const CONFLICT = /someone else changed/i;
const errText = (e: unknown) => String((e as any)?.message ?? e).replace(/^Error:\s*/, '');

export function TalentForm({ data, layout, employee, person, onClose, onSaved, onConflict }: {
  data: TalentState; layout: Layout; employee: TalentEmployee | null;
  /** a BambooHR team member being rated for the first time */
  person: RosterPerson | null;
  onClose: () => void; onSaved: (e: TalentEmployee, created: boolean) => void;
  /** a stale save: reload the board, then show the latest version */
  onConflict: () => Promise<TalentEmployee | null>;
}) {
  const blank: TalentInput = { bambooId: person?.bambooId, name: person?.name ?? '', role: '', level: 'se', ratings: {}, notes: '' };
  const [f, setF] = useState<TalentInput>(() => employee
    ? { id: employee.id, rev: employee.rev, name: employee.name, role: employee.role, level: employee.level, ratings: { ...employee.ratings }, notes: employee.notes }
    : blank);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveErr, setSaveErr] = useState('');
  const first = useRef<HTMLInputElement>(null);
  const team = data.roster.find((r) => r.bambooId === (employee?.bambooId ?? person?.bambooId))?.team ?? '';
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    first.current?.focus();
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, []);

  const errors = employeeErrors(f);
  const valid = Object.keys(errors).length === 0;
  const preview = ratingsComplete(f.ratings) ? place(f.ratings, data.weights[f.level], layout) : null;
  const upd = (patch: Partial<TalentInput>) => { setF((x) => ({ ...x, ...patch })); setSaveErr(''); };
  const rate = (c: CriterionId, v: number) => upd({ ratings: { ...f.ratings, [c]: v } });

  const save = async () => {
    setTouched(true);
    if (!valid || busy) return;
    setBusy(true); setSaveErr('');
    try {
      const e = await api.saveTalentEmployee(f);
      onSaved(e, !f.id);
    } catch (x) {
      const msg = errText(x);
      if (CONFLICT.test(msg)) {
        const latest = await onConflict();
        if (latest) setF({ id: latest.id, rev: latest.rev, name: latest.name, role: latest.role, level: latest.level, ratings: { ...latest.ratings }, notes: latest.notes });
        setSaveErr(latest ? msg : 'Someone else deleted this employee.');
      } else setSaveErr(msg);
    } finally { setBusy(false); }
  };

  const show = (k: string) => touched && errors[k];
  const axisBlock = (axis: Axis) => (
    <fieldset className="tg-axis">
      <legend>{axis === 'perf' ? 'Performance' : 'Potential'}</legend>
      {axisCriteria(axis).map((c) => (
        <div key={c.id} className="tg-rate-row" role="radiogroup" aria-label={`${c.label}: ${c.hint}`}>
          <div className="tg-rate-l">
            <span>{c.label}</span>
            <span className="muted small">{c.hint} · weight {data.weights[f.level][c.id]}%</span>
          </div>
          <div className="seg tg-rate-seg">
            {[1, 2, 3, 4, 5].map((v) => (
              <button key={v} type="button" role="radio" aria-checked={f.ratings[c.id] === v} title={SCALE[v]}
                className={'chip' + (f.ratings[c.id] === v ? ' on' : '')} onClick={() => rate(c.id, v)}>{v}</button>
            ))}
          </div>
        </div>
      ))}
    </fieldset>
  );

  return (
    <div className="sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet wide tg-sheet" role="dialog" aria-modal="true" aria-labelledby="tg-form-title">
        <header className="sheet-head">
          <h2 id="tg-form-title">{employee ? `Edit ${f.name}` : `Rate ${f.name}`}{team && <span className="muted small"> · {team}</span>}</h2>
          <div className="spacer" />
          <button type="button" className="primary" onClick={save} disabled={busy || (touched && !valid)}>{busy ? 'Saving…' : 'Save'}</button>
          <button type="button" onClick={onClose}>Cancel</button>
        </header>

        {saveErr && (
          <div className="banner tg-banner" role="alert">
            {saveErr}
            {!CONFLICT.test(saveErr) && <button type="button" className="link" onClick={save}>Retry</button>}
          </div>
        )}

        <section className="tg-form-top">
          <label className="block">Name
            <input value={f.name} readOnly aria-readonly="true" title="Names come from BambooHR" className="tg-readonly" />
            <span className="muted small">From BambooHR</span>
          </label>
          <label className="block">Role
            <input ref={first} value={f.role} placeholder="e.g. Backend engineer" onChange={(e) => upd({ role: e.target.value })} />
            {show('role') && <span className="error small">{errors.role}</span>}
          </label>
          <label className="block">Job level
            <select value={f.level} onChange={(e) => upd({ level: e.target.value as TalentInput['level'] })}>
              {LEVELS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
            </select>
          </label>
          <div className={'tg-preview' + (preview ? ' z-' + zoneOf(layout, preview.box) : '')} aria-live="polite">
            {preview ? (
              <>
                <span className="tg-box-tag">{preview.box}</span>
                <div>
                  <b>{data.copy[layout][preview.box].title}</b>
                  <div className="small">Perf {fmtAvg(preview.perf)} {BANDS[layout][preview.perfIdx].name} · Pot {fmtAvg(preview.pot)} {BANDS[layout][preview.potIdx].name}</div>
                  <div className="small muted">{zoneInfo(zoneOf(layout, preview.box)).label} · {layout}×{layout}</div>
                </div>
              </>
            ) : <span className="muted small">Rate all 10 criteria to see where they land.</span>}
          </div>
        </section>

        <section className="tg-axes">
          {axisBlock('perf')}
          {axisBlock('pot')}
        </section>
        {show('ratings') && <p className="error small" role="alert">{errors.ratings}</p>}
        <p className="muted small">1 well below · 2 below · 3 meets · 4 exceeds · 5 exceptional</p>

        <section>
          <label className="block">Notes
            <textarea rows={4} value={f.notes} maxLength={NOTES_MAX} onChange={(e) => upd({ notes: e.target.value })} />
            <span className={'small ' + (f.notes.length > NOTES_MAX * 0.9 ? 'warn-text' : 'muted')}>{f.notes.length.toLocaleString('en')} / {NOTES_MAX.toLocaleString('en')}</span>
          </label>
        </section>
      </div>
    </div>
  );
}
