'use client';

/**
 * Problem → Goal → Objective → Intervention editor (the practice's Valant Treatment Plan
 * template), with the content libraries: Practice Library and the provider's Personal Library
 * (Valant's and Wiley PracticePlanners® libraries are licensed content and are not included).
 * Library text is locked when the practice settings say providers cannot edit library items
 * (before the plan is active, or on items copied from the active plan); the server checks again.
 */
import { useState, type ReactNode } from 'react';
import { BookmarkPlus, Lock, Plus, Trash2 } from 'lucide-react';
import { ChoiceChips, smallBtn } from '@/components/notes/structuredNoteUi';
import {
  LIBRARY_SOURCES,
  PLAN_PROGRESS,
  emptyGoal,
  emptyIntervention,
  emptyObjective,
  emptyProblem,
  libraryTextEditable,
  nodeFromLibrary,
  type GoalProgressEntry,
  type LibraryEditSettings,
  type LibraryItem,
  type LibraryKind,
  type PlanGoalNode,
  type PlanIntervention,
  type PlanObjective,
  type PlanProblem,
} from '@/lib/ehr/therapy/planHierarchy';
import { INTERVENTION_FREQUENCIES, INTERVENTION_TYPES, OBJECTIVE_QUICK_FILLS } from '@/lib/ehr/therapy/widgets';

export type PlanLibraries = { practice: LibraryItem[]; personal: LibraryItem[]; canEditPractice: boolean; loaded: boolean; error: string | null };

const field = 'min-h-[36px] w-full rounded-lg border border-slate-200 p-1.5 text-xs disabled:bg-slate-50';
const area = 'w-full rounded-lg border border-slate-200 p-1.5 text-xs';
const KIND_LABEL: Record<LibraryKind, string> = { problem: 'problem', goal: 'goal', objective: 'objective', intervention: 'intervention' };

function SourceBadge({ node }: { node: { source: string; libraryId: string | null; carried: boolean } }) {
  if (node.source === 'custom' && !node.carried) return null;
  return (
    <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-600">
      {node.source === 'practice' ? 'Practice Library' : node.source === 'personal' ? 'Personal Library' : 'Custom'}
      {node.carried ? ' · from active plan' : ''}
    </span>
  );
}

function LibraryPicker({ kind, libraries, onPick }: { kind: LibraryKind; libraries: PlanLibraries; onPick: (item: LibraryItem, source: 'practice' | 'personal') => void }) {
  const practice = libraries.practice.filter((i) => i.kind === kind);
  const personal = libraries.personal.filter((i) => i.kind === kind);
  const unavailable = LIBRARY_SOURCES.filter((s) => !s.available);
  return (
    <select
      aria-label={`Add ${KIND_LABEL[kind]} from a library`}
      value=""
      className="min-h-[36px] max-w-[260px] rounded-lg border border-dashed border-slate-300 bg-white p-1.5 text-xs text-slate-600"
      onChange={(e) => {
        const [source, id] = e.target.value.split('::');
        const item = (source === 'practice' ? practice : personal).find((i) => i.id === id);
        if (item) onPick(item, source as 'practice' | 'personal');
      }}
    >
      <option value="">{libraries.loaded ? `From library… (${practice.length + personal.length})` : 'Library loading…'}</option>
      <optgroup label="Practice Library">
        {practice.length ? practice.map((i) => <option key={i.id} value={`practice::${i.id}`}>{i.category ? `${i.category} — ` : ''}{i.text.slice(0, 90)}</option>) : <option disabled>No {KIND_LABEL[kind]}s yet</option>}
      </optgroup>
      <optgroup label="Provider’s Personal Library">
        {personal.length ? personal.map((i) => <option key={i.id} value={`personal::${i.id}`}>{i.category ? `${i.category} — ` : ''}{i.text.slice(0, 90)}</option>) : <option disabled>No {KIND_LABEL[kind]}s saved</option>}
      </optgroup>
      {unavailable.map((s) => (
        <optgroup key={s.id} label={`${s.label} — licensed content not included`}>
          <option disabled>Not available in Altrixs</option>
        </optgroup>
      ))}
    </select>
  );
}

function History({ entries }: { entries: GoalProgressEntry[] | undefined }) {
  if (!entries?.length) return null;
  return (
    <p className="text-[11px] text-slate-500">
      From progress notes:{' '}
      {entries.map((e, i) => (
        <span key={`${e.noteId}-${i}`}>
          {i ? '; ' : ''}
          {e.date} {e.status}
          {e.level ? ` (${e.level})` : ''}
        </span>
      ))}
    </p>
  );
}

export function PlanHierarchyEditor({
  problems,
  onChange,
  review,
  disabled,
  rules,
  libraries,
  onSaveToLibrary,
  progressHistory,
  clinicianName,
}: {
  problems: PlanProblem[];
  onChange: (next: PlanProblem[]) => void;
  review: boolean;
  disabled: boolean;
  rules: LibraryEditSettings;
  libraries: PlanLibraries;
  onSaveToLibrary: (kind: LibraryKind, node: PlanProblem | PlanGoalNode | PlanObjective | PlanIntervention, scope: 'practice' | 'personal') => Promise<void>;
  progressHistory: Record<string, GoalProgressEntry[]>;
  clinicianName: string | null;
}) {
  const [saved, setSaved] = useState<string | null>(null);
  const updProblem = (pi: number, patch: Partial<PlanProblem>) => onChange(problems.map((p, i) => (i === pi ? { ...p, ...patch } : p)));
  const updGoal = (pi: number, gi: number, patch: Partial<PlanGoalNode>) =>
    updProblem(pi, { goals: problems[pi].goals.map((g, i) => (i === gi ? { ...g, ...patch } : g)) });
  const updObjective = (pi: number, gi: number, oi: number, patch: Partial<PlanObjective>) =>
    updGoal(pi, gi, { objectives: problems[pi].goals[gi].objectives.map((o, i) => (i === oi ? { ...o, ...patch } : o)) });
  const updIntervention = (pi: number, gi: number, oi: number, ii: number, patch: Partial<PlanIntervention>) =>
    updObjective(pi, gi, oi, { interventions: problems[pi].goals[gi].objectives[oi].interventions.map((iv, i) => (i === ii ? { ...iv, ...patch } : iv)) });

  const saveButtons = (kind: LibraryKind, node: PlanProblem | PlanGoalNode | PlanObjective | PlanIntervention) =>
    node.text.trim() && !disabled ? (
      <span className="inline-flex gap-1">
        <button
          type="button"
          className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:underline"
          onClick={() => void onSaveToLibrary(kind, node, 'personal').then(() => setSaved(`Saved to your Personal Library: ${node.text.slice(0, 60)}`))}
        >
          <BookmarkPlus size={11} /> My library
        </button>
        {libraries.canEditPractice ? (
          <button
            type="button"
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:underline"
            onClick={() => void onSaveToLibrary(kind, node, 'practice').then(() => setSaved(`Saved to the Practice Library: ${node.text.slice(0, 60)}`))}
          >
            <BookmarkPlus size={11} /> Practice library
          </button>
        ) : null}
      </span>
    ) : null;

  const textInput = (opts: { label: string; value: string; locked: boolean; onChange: (v: string) => void; placeholder?: string; required?: boolean }): ReactNode => (
    <label className="block text-xs font-semibold text-slate-600">
      <span className="inline-flex items-center gap-1">
        {opts.label}
        {opts.required ? ' *' : ''}
        {opts.locked ? (
          <span className="inline-flex items-center gap-0.5 text-[11px] font-normal text-slate-500">
            <Lock size={10} /> library text (practice setting: not editable)
          </span>
        ) : null}
      </span>
      <input value={opts.value} readOnly={opts.locked} onChange={(e) => opts.onChange(e.target.value)} placeholder={opts.placeholder} className={`mt-1 ${field} ${opts.locked ? 'bg-slate-50' : ''}`} />
    </label>
  );
  const textArea = (label: string, value: string, onValue: (v: string) => void) => (
    <label className="block text-[11px] font-semibold text-slate-600">
      {label}
      <textarea value={value} rows={2} onChange={(e) => onValue(e.target.value)} className={`mt-0.5 ${area}`} />
    </label>
  );
  const sessions = (label: string, value: number | null, onValue: (v: number | null) => void) => (
    <label className="block text-[11px] font-semibold text-slate-600">
      {label}
      <input
        type="number"
        min={1}
        max={999}
        step={1}
        inputMode="numeric"
        value={value ?? ''}
        onChange={(e) => {
          const n = Number(e.target.value);
          onValue(e.target.value === '' || !Number.isInteger(n) || n < 1 ? null : Math.min(999, n));
        }}
        className={`mt-0.5 ${field}`}
      />
    </label>
  );
  const dateInput = (label: string, value: string, onValue: (v: string) => void, required = false) => (
    <label className="block text-[11px] font-semibold text-slate-600">
      {label}
      {required ? ' *' : ''}
      <input type="date" value={value} onChange={(e) => onValue(e.target.value)} className={`mt-0.5 ${field}`} />
    </label>
  );

  const goalNumber = new Map(problems.flatMap((p) => p.goals).map((g, i) => [g.id, i + 1] as const));
  return (
    <div className="space-y-3">
      <p className="text-[11px] text-slate-500">
        Libraries: Practice Library and your Personal Library (Goal Bank page). Valant Library and Wiley PracticePlanners® are licensed content and are
        not included. Custom items can be typed anywhere.
      </p>
      {problems.map((p, pi) => (
        <div key={p.id} className="space-y-2 rounded-xl border border-blue-600/30 bg-blue-50/30 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-2 text-xs font-bold text-blue-600">
              Problem {pi + 1} <SourceBadge node={p} />
            </p>
            <span className="flex items-center gap-2">
              {saveButtons('problem', p)}
              <button type="button" aria-label={`Remove problem ${pi + 1}`} className={smallBtn} onClick={() => onChange(problems.filter((_, i) => i !== pi))}>
                <Trash2 size={12} />
              </button>
            </span>
          </div>
          {textInput({ label: 'Problem', value: p.text, locked: !libraryTextEditable(p, rules), onChange: (v) => updProblem(pi, { text: v }), placeholder: 'e.g. Anxiety', required: true })}
          <div className="grid gap-2 sm:grid-cols-2">
            {textArea('Behavioral Description', p.behavioralDescription, (v) => updProblem(pi, { behavioralDescription: v }))}
            {textArea('Patient Description', p.patientDescription, (v) => updProblem(pi, { patientDescription: v }))}
            {textArea('Strengths', p.strengths, (v) => updProblem(pi, { strengths: v }))}
            {textArea('Comment', p.comment, (v) => updProblem(pi, { comment: v }))}
          </div>

          {p.goals.map((g, gi) => {
            const n = goalNumber.get(g.id) ?? gi + 1;
            return (
              <div key={g.id} className="ml-0 space-y-2 rounded-xl border border-slate-200 bg-white p-3 sm:ml-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="flex items-center gap-2 text-xs font-bold text-slate-800">
                    Goal {n} <SourceBadge node={g} />
                  </p>
                  <span className="flex items-center gap-2">
                    {saveButtons('goal', g)}
                    <button type="button" aria-label={`Remove goal ${n}`} className={smallBtn} onClick={() => updProblem(pi, { goals: p.goals.filter((_, i) => i !== gi) })}>
                      <Trash2 size={12} />
                    </button>
                  </span>
                </div>
                {textInput({ label: 'Goal (client’s words)', value: g.text, locked: !libraryTextEditable(g, rules), onChange: (v) => updGoal(pi, gi, { text: v }), placeholder: '“I want to stop having panic attacks at work.”', required: true })}
                <div className="grid gap-2 sm:grid-cols-3">
                  <label className="block text-[11px] font-semibold text-slate-600">
                    Responsible Party
                    <input value={g.responsibleParty} onChange={(e) => updGoal(pi, gi, { responsibleParty: e.target.value })} placeholder={clinicianName ? `e.g. Client and ${clinicianName}` : 'e.g. Client and therapist'} className={`mt-0.5 ${field}`} />
                  </label>
                  {dateInput('Target Date', g.targetDate, (v) => updGoal(pi, gi, { targetDate: v }))}
                  {sessions('Target # of Sessions', g.targetSessions, (v) => updGoal(pi, gi, { targetSessions: v }))}
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {textArea('Patient’s Description', g.patientDescription, (v) => updGoal(pi, gi, { patientDescription: v }))}
                  {textArea('Comment', g.comment, (v) => updGoal(pi, gi, { comment: v }))}
                </div>
                <div className="space-y-1 rounded-lg bg-slate-50 p-2">
                  <p className="text-[11px] font-semibold text-slate-600">Progress{review ? ' since the last plan *' : ''}</p>
                  <ChoiceChips options={PLAN_PROGRESS} value={g.progress} onChange={(v) => updGoal(pi, gi, { progress: v })} ariaLabel={`Goal ${n} progress`} />
                  {review ? (
                    <input value={g.progressNote} onChange={(e) => updGoal(pi, gi, { progressNote: e.target.value })} placeholder="Progress comment" className={field} />
                  ) : null}
                  <History entries={progressHistory[g.id]} />
                </div>

                {g.objectives.map((o, oi) => (
                  <div key={o.id} className="ml-0 space-y-2 rounded-lg border border-slate-200 p-2.5 sm:ml-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="flex items-center gap-2 text-[11px] font-bold text-slate-700">
                        Objective {n}.{oi + 1} <SourceBadge node={o} />
                      </p>
                      <span className="flex items-center gap-2">
                        {saveButtons('objective', o)}
                        <button type="button" aria-label={`Remove objective ${n}.${oi + 1}`} className={smallBtn} onClick={() => updGoal(pi, gi, { objectives: g.objectives.filter((_, i) => i !== oi) })}>
                          <Trash2 size={12} />
                        </button>
                      </span>
                    </div>
                    {textInput({ label: 'Objective (measurable)', value: o.text, locked: !libraryTextEditable(o, rules), onChange: (v) => updObjective(pi, gi, oi, { text: v }), required: true })}
                    {libraryTextEditable(o, rules) ? (
                      <div className="flex flex-wrap gap-1">
                        {OBJECTIVE_QUICK_FILLS.map((q) => (
                          <button key={q} type="button" className="min-h-[28px] rounded-lg border border-dashed border-slate-300 px-2 text-[11px] text-slate-600 hover:bg-blue-50" onClick={() => updObjective(pi, gi, oi, { text: q })}>
                            {q}
                          </button>
                        ))}
                      </div>
                    ) : null}
                    <div className="grid gap-2 sm:grid-cols-2">
                      {dateInput('Target Date', o.targetDate, (v) => updObjective(pi, gi, oi, { targetDate: v }), true)}
                      {sessions('Target # of Sessions', o.targetSessions, (v) => updObjective(pi, gi, oi, { targetSessions: v }))}
                      {textArea('Patient’s Description', o.patientDescription, (v) => updObjective(pi, gi, oi, { patientDescription: v }))}
                      {textArea('Comment', o.comment, (v) => updObjective(pi, gi, oi, { comment: v }))}
                    </div>
                    <div className="space-y-1">
                      <p className="text-[11px] font-semibold text-slate-600">Progress</p>
                      <ChoiceChips options={PLAN_PROGRESS} value={o.progress} onChange={(v) => updObjective(pi, gi, oi, { progress: v })} ariaLabel={`Objective ${n}.${oi + 1} progress`} />
                    </div>

                    <div className="space-y-1.5">
                      <p className="text-[11px] font-semibold text-slate-600">Interventions *</p>
                      {o.interventions.map((iv, ii) => {
                        const locked = !libraryTextEditable(iv, rules);
                        return (
                          <div key={iv.id} className="space-y-1.5 rounded-lg bg-slate-50 p-2">
                            <div className="flex flex-col gap-1.5 sm:flex-row sm:flex-wrap sm:items-end">
                              <select aria-label="Intervention type" value={iv.type} disabled={locked} onChange={(e) => updIntervention(pi, gi, oi, ii, { type: e.target.value })} className="min-h-[36px] rounded-lg border border-slate-200 p-1.5 text-xs">
                                <option value="">Modality (optional)</option>
                                {INTERVENTION_TYPES.map((t) => (
                                  <option key={t} value={t}>{t}</option>
                                ))}
                              </select>
                              <input aria-label="Intervention" value={iv.text} readOnly={locked} onChange={(e) => updIntervention(pi, gi, oi, ii, { text: e.target.value })} placeholder="Intervention (e.g. thought records)" className={`min-w-[160px] flex-1 ${field}`} />
                              <input aria-label="Frequency" list="tp-frequencies" value={iv.frequency} onChange={(e) => updIntervention(pi, gi, oi, ii, { frequency: e.target.value })} placeholder="Frequency" className="min-h-[36px] w-full rounded-lg border border-slate-200 p-1.5 text-xs sm:w-32" />
                              <input aria-label="Length" value={iv.length} onChange={(e) => updIntervention(pi, gi, oi, ii, { length: e.target.value })} placeholder="Length (e.g. 50 min)" className="min-h-[36px] w-full rounded-lg border border-slate-200 p-1.5 text-xs sm:w-32" />
                              <input aria-label="Duration" value={iv.duration} onChange={(e) => updIntervention(pi, gi, oi, ii, { duration: e.target.value })} placeholder="Duration (e.g. 12 weeks)" className="min-h-[36px] w-full rounded-lg border border-slate-200 p-1.5 text-xs sm:w-36" />
                              <button type="button" aria-label="Remove intervention" className={smallBtn} onClick={() => updObjective(pi, gi, oi, { interventions: o.interventions.filter((_, i) => i !== ii) })}>
                                <Trash2 size={12} />
                              </button>
                            </div>
                            <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center">
                              <input aria-label="Intervention comment" value={iv.comment} onChange={(e) => updIntervention(pi, gi, oi, ii, { comment: e.target.value })} placeholder="Comment" className={`flex-1 ${field}`} />
                              <span className="flex items-center gap-2">
                                <SourceBadge node={iv} />
                                {saveButtons('intervention', iv)}
                              </span>
                            </div>
                            {locked ? <p className="flex items-center gap-1 text-[11px] text-slate-500"><Lock size={10} /> Library text (practice setting: not editable)</p> : null}
                          </div>
                        );
                      })}
                      <div className="flex flex-wrap gap-1.5">
                        <button type="button" className={smallBtn} onClick={() => updObjective(pi, gi, oi, { interventions: [...o.interventions, emptyIntervention()] })}>
                          <Plus size={12} /> Intervention
                        </button>
                        <LibraryPicker kind="intervention" libraries={libraries} onPick={(item, src) => updObjective(pi, gi, oi, { interventions: [...o.interventions.filter((x) => x.text || x.type), nodeFromLibrary(item, src) as PlanIntervention] })} />
                      </div>
                    </div>
                  </div>
                ))}
                <div className="flex flex-wrap gap-1.5">
                  <button type="button" className={smallBtn} onClick={() => updGoal(pi, gi, { objectives: [...g.objectives, emptyObjective()] })}>
                    <Plus size={12} /> Objective
                  </button>
                  <LibraryPicker kind="objective" libraries={libraries} onPick={(item, src) => updGoal(pi, gi, { objectives: [...g.objectives.filter((x) => x.text), nodeFromLibrary(item, src) as PlanObjective] })} />
                </div>
              </div>
            );
          })}
          <div className="flex flex-wrap gap-1.5">
            <button type="button" className={smallBtn} onClick={() => updProblem(pi, { goals: [...p.goals, emptyGoal()] })}>
              <Plus size={12} /> Goal
            </button>
            <LibraryPicker kind="goal" libraries={libraries} onPick={(item, src) => updProblem(pi, { goals: [...p.goals.filter((x) => x.text), nodeFromLibrary(item, src) as PlanGoalNode] })} />
          </div>
        </div>
      ))}
      <div className="flex flex-wrap gap-1.5">
        <button type="button" className={smallBtn} onClick={() => onChange([...problems, emptyProblem()])}>
          <Plus size={12} /> Add problem
        </button>
        <LibraryPicker kind="problem" libraries={libraries} onPick={(item, src) => onChange([...problems.filter((x) => x.text || x.goals.some((g) => g.text)), nodeFromLibrary(item, src) as PlanProblem])} />
      </div>
      <datalist id="tp-frequencies">
        {INTERVENTION_FREQUENCIES.map((f) => (
          <option key={f} value={f} />
        ))}
      </datalist>
      {libraries.error ? <p className="text-[11px] text-amber-700">Libraries could not be loaded ({libraries.error}). Custom items still work.</p> : null}
      {saved ? <p className="text-[11px] font-semibold text-emerald-700">{saved}</p> : null}
    </div>
  );
}
