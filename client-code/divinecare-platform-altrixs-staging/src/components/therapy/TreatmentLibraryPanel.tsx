'use client';

/**
 * Treatment plan content libraries (Goal Bank page): the Practice Library (practice leadership
 * maintains it) and the provider's Personal Library. Items are problems, goals, objectives and
 * interventions with the Valant template's fields; the plan editor adds them under the matching
 * level. Valant's library and the Wiley PracticePlanners® library are licensed content and are
 * not included.
 */
import { useEffect, useMemo, useState } from 'react';
import { BookOpen, Lock, Plus, Trash2 } from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import { inputCls, pillBtn, smallBtn } from '@/components/notes/structuredNoteUi';
import { LIBRARY_KINDS, LIBRARY_SOURCES, asSessionCount, newNodeId, sanitizeLibraryItem, type LibraryItem, type LibraryKind } from '@/lib/ehr/therapy/planHierarchy';
import { INTERVENTION_TYPES } from '@/lib/ehr/therapy/widgets';

type Scope = 'practice' | 'personal';
const KIND_LABEL: Record<LibraryKind, string> = { problem: 'Problems', goal: 'Goals', objective: 'Objectives', intervention: 'Interventions' };

type Draft = {
  kind: LibraryKind;
  text: string;
  category: string;
  behavioralDescription: string;
  strengths: string;
  responsibleParty: string;
  targetSessions: string;
  interventionType: string;
  frequency: string;
  length: string;
  duration: string;
  comment: string;
};
const emptyDraft = (kind: LibraryKind): Draft => ({
  kind,
  text: '',
  category: '',
  behavioralDescription: '',
  strengths: '',
  responsibleParty: '',
  targetSessions: '',
  interventionType: '',
  frequency: '',
  length: '',
  duration: '',
  comment: '',
});

export function TreatmentLibraryPanel() {
  const [libs, setLibs] = useState<{ practice: LibraryItem[]; personal: LibraryItem[]; canEditPractice: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>('practice');
  const [kind, setKind] = useState<LibraryKind>('goal');
  const [draft, setDraft] = useState<Draft>(emptyDraft('goal'));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiJson<{ success: true; practice: LibraryItem[]; personal: LibraryItem[]; canEditPractice: boolean }>('/api/ehr/treatment-plans/library')
      .then((r) => setLibs({ practice: r.practice, personal: r.personal, canEditPractice: r.canEditPractice }))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not load the libraries'));
  }, []);

  const items = useMemo(() => (libs ? (scope === 'practice' ? libs.practice : libs.personal).filter((i) => i.kind === kind) : []), [libs, scope, kind]);
  const canEdit = scope === 'personal' || Boolean(libs?.canEditPractice);

  const save = async (next: LibraryItem[]) => {
    setSaving(true);
    setError(null);
    try {
      const res = await apiJson<{ success: true; items: LibraryItem[] }>('/api/ehr/treatment-plans/library', { method: 'PUT', body: JSON.stringify({ scope, items: next }) });
      setLibs((l) => (l ? { ...l, [scope]: res.items } : l));
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the library');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const add = async () => {
    if (!libs) return;
    const item = sanitizeLibraryItem({
      ...draft,
      id: `lib-${newNodeId('I').toLowerCase()}`,
      kind,
      targetSessions: asSessionCount(draft.targetSessions),
      updatedAt: new Date().toISOString(),
    });
    if (!item) return setError('Enter the text.');
    const current = scope === 'practice' ? libs.practice : libs.personal;
    if (await save([...current, item])) setDraft(emptyDraft(kind));
  };

  const remove = async (id: string) => {
    if (!libs || !window.confirm('Remove this item from the library? Plans that already use it keep their text.')) return;
    const current = scope === 'practice' ? libs.practice : libs.personal;
    await save(current.filter((i) => i.id !== id));
  };

  const set = (k: keyof Draft, v: string) => setDraft((d) => ({ ...d, [k]: v }));
  const small = 'min-h-[36px] w-full rounded-lg border border-slate-200 p-1.5 text-xs';

  return (
    <section className="space-y-3 rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <BookOpen size={15} className="text-[#5C2D91]" /> Treatment plan libraries
        </h2>
        <div className="flex gap-1.5">
          <button type="button" aria-pressed={scope === 'practice'} className={pillBtn(scope === 'practice')} onClick={() => setScope('practice')}>
            Practice Library{libs ? ` (${libs.practice.length})` : ''}
          </button>
          <button type="button" aria-pressed={scope === 'personal'} className={pillBtn(scope === 'personal')} onClick={() => setScope('personal')}>
            My Personal Library{libs ? ` (${libs.personal.length})` : ''}
          </button>
        </div>
      </div>
      <ul className="grid gap-1 text-[11px] text-slate-600 sm:grid-cols-2">
        {LIBRARY_SOURCES.filter((s) => s.id !== 'custom').map((s) => (
          <li key={s.id} className="flex items-start gap-1.5">
            {s.available ? <BookOpen size={11} className="mt-0.5 shrink-0 text-teal-600" /> : <Lock size={11} className="mt-0.5 shrink-0 text-slate-400" />}
            <span>
              <strong className="text-slate-800">{s.label}</strong> — {s.note}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-slate-500">
        To bring over the wording your practice wrote itself, add it here (CSV import of a practice library is planned). Text licensed from Valant or
        Wiley cannot be copied in.
      </p>

      <div className="flex flex-wrap gap-1.5">
        {LIBRARY_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={kind === k}
            className={pillBtn(kind === k)}
            onClick={() => {
              setKind(k);
              setDraft(emptyDraft(k));
            }}
          >
            {KIND_LABEL[k]}
          </button>
        ))}
      </div>

      {error ? <p className="text-xs text-rose-700">{error}</p> : null}
      {!libs && !error ? <p className="text-xs text-slate-500">Loading…</p> : null}
      {libs ? (
        <ul className="space-y-1.5">
          {items.length === 0 ? <li className="text-xs text-slate-500">No {KIND_LABEL[kind].toLowerCase()} in this library yet.</li> : null}
          {items.map((i) => (
            <li key={i.id} className="flex items-start justify-between gap-2 rounded-lg border border-slate-200 p-2 text-xs">
              <span className="min-w-0">
                <span className="block font-semibold text-slate-900">{i.text}</span>
                <span className="block text-[11px] text-slate-500">
                  {[
                    i.category,
                    i.behavioralDescription && `Behavioral: ${i.behavioralDescription.slice(0, 80)}`,
                    i.responsibleParty && `Responsible: ${i.responsibleParty}`,
                    i.targetSessions != null && `${i.targetSessions} sessions`,
                    i.interventionType,
                    i.frequency && `Frequency: ${i.frequency}`,
                    i.length && `Length: ${i.length}`,
                    i.duration && `Duration: ${i.duration}`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
              {canEdit ? (
                <button type="button" aria-label={`Remove ${i.text}`} disabled={saving} className={smallBtn} onClick={() => void remove(i.id)}>
                  <Trash2 size={12} />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {libs && canEdit ? (
        <div className="space-y-2 rounded-lg border border-dashed border-slate-300 p-3">
          <p className="text-xs font-semibold text-slate-700">Add to {scope === 'practice' ? 'the Practice Library' : 'my Personal Library'}</p>
          <input value={draft.text} onChange={(e) => set('text', e.target.value)} placeholder={`${KIND_LABEL[kind].slice(0, -1)} text`} className={inputCls} maxLength={600} />
          <div className="grid gap-2 sm:grid-cols-3">
            <input value={draft.category} onChange={(e) => set('category', e.target.value)} placeholder="Category (e.g. Anxiety)" className={small} maxLength={80} />
            {kind === 'problem' ? (
              <>
                <input value={draft.behavioralDescription} onChange={(e) => set('behavioralDescription', e.target.value)} placeholder="Behavioral description" className={small} />
                <input value={draft.strengths} onChange={(e) => set('strengths', e.target.value)} placeholder="Strengths" className={small} />
              </>
            ) : null}
            {kind === 'goal' ? <input value={draft.responsibleParty} onChange={(e) => set('responsibleParty', e.target.value)} placeholder="Responsible party" className={small} /> : null}
            {kind === 'goal' || kind === 'objective' ? (
              <input type="number" min={1} max={999} value={draft.targetSessions} onChange={(e) => set('targetSessions', e.target.value)} placeholder="Target # of sessions" className={small} />
            ) : null}
            {kind === 'intervention' ? (
              <>
                <select value={draft.interventionType} onChange={(e) => set('interventionType', e.target.value)} className={small} aria-label="Modality">
                  <option value="">Modality (optional)</option>
                  {INTERVENTION_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                <input value={draft.frequency} onChange={(e) => set('frequency', e.target.value)} placeholder="Frequency" className={small} />
                <input value={draft.length} onChange={(e) => set('length', e.target.value)} placeholder="Length" className={small} />
                <input value={draft.duration} onChange={(e) => set('duration', e.target.value)} placeholder="Duration" className={small} />
              </>
            ) : null}
            <input value={draft.comment} onChange={(e) => set('comment', e.target.value)} placeholder="Comment" className={small} />
          </div>
          <button type="button" disabled={saving || !draft.text.trim()} className={smallBtn} onClick={() => void add()}>
            <Plus size={12} /> Add
          </button>
        </div>
      ) : libs && scope === 'practice' ? (
        <p className="text-[11px] text-slate-500">Practice leadership maintains the Practice Library. Save your own wording to your Personal Library.</p>
      ) : null}
    </section>
  );
}
