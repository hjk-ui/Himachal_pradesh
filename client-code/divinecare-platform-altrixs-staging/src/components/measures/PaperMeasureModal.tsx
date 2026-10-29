'use client';

/**
 * "Upload paper measure" (chart Assessments & outcomes): a completed paper form. Choose the
 * measure and the date on the form, attach the scan, and enter the item responses (instruments
 * with items in the catalog) or the total (copyrighted forms with no items stored: Y-BOCS, HAM-D,
 * MADRS ...). Scored server-side with the same scoring as the in-session form and patient links;
 * the scan is filed to Chart > Documents > Measures (POST /api/clinical/measure-results/paper).
 */
import { useMemo, useState } from 'react';
import { Upload } from 'lucide-react';
import { Button, Modal, cx, inputClasses } from '@/components/ui';
import { ASSESSMENT_CATALOG } from '@/features/ehr/assessments/catalog';
import { SAFETY_ITEMS } from '@/lib/measures/instruments';
import { paperEntryMode } from '@/lib/measures/guide';

const today = () => new Date().toLocaleDateString('en-CA');
const RESPONDENTS = ['Self', 'Parent / guardian', 'Teacher', 'Clinician'] as const;

export function PaperMeasureModal({ clientId, onClose, onSaved }: { clientId: string; onClose: () => void; onSaved: (message: string, ok: boolean) => void }) {
  const options = useMemo(() => ASSESSMENT_CATALOG.filter((i) => paperEntryMode(i.id) !== 'none'), []);
  const [instrumentId, setInstrumentId] = useState('');
  const [date, setDate] = useState(today());
  const [modeChoice, setModeChoice] = useState<'items' | 'total'>('items');
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [total, setTotal] = useState('');
  const [safety, setSafety] = useState('');
  const [respondent, setRespondent] = useState<(typeof RESPONDENTS)[number]>('Self');
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inst = options.find((i) => i.id === instrumentId) ?? null;
  const entry = inst ? paperEntryMode(inst.id) : 'none';
  const mode: 'items' | 'total' = entry === 'total_only' ? 'total' : entry === 'items_only' ? 'items' : modeChoice;
  const safetyItem = inst ? SAFETY_ITEMS[inst.id] : undefined;
  const safetyQuestion = safetyItem ? inst?.questions?.find((q) => q.id === safetyItem) : undefined;
  const answered = inst?.questions?.filter((q) => answers[q.id] !== undefined).length ?? 0;
  const ready =
    Boolean(inst && date && file) &&
    (mode === 'items' ? answered === (inst?.questions?.length ?? -1) : total.trim() !== '' && (!safetyQuestion || safety !== ''));

  async function save() {
    if (!inst || !file) return;
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.set('clientId', clientId);
    fd.set('instrumentId', inst.id);
    fd.set('administeredOn', date);
    fd.set('mode', mode);
    fd.set('respondentType', respondent);
    if (notes.trim()) fd.set('notes', notes.trim());
    if (mode === 'items') fd.set('answers', JSON.stringify(answers));
    else {
      fd.set('totalScore', total.trim());
      if (safetyQuestion) fd.set('safetyItemScore', safety);
    }
    fd.set('file', file);
    try {
      const res = await fetch('/api/clinical/measure-results/paper', { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (data.success) {
        onSaved(data.message || 'Saved.', !data.safetyFlagged);
        onClose();
      } else setError(data.error || `Could not save (${res.status})`);
    } catch {
      setError('Could not save (network error).');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Upload paper measure"
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button icon={<Upload />} onClick={() => void save()} disabled={busy || !ready}>
            {busy ? 'Saving…' : 'Save and score'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium text-slate-700">Measure</span>
            <select
              value={instrumentId}
              onChange={(e) => {
                setInstrumentId(e.target.value);
                setAnswers({});
                setTotal('');
                setSafety('');
              }}
              className={inputClasses}
            >
              <option value="">Choose…</option>
              {options.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} — {i.fullName}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium text-slate-700">Date on the form</span>
            <input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} className={inputClasses} />
          </label>
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium text-slate-700">Completed by</span>
            <select value={respondent} onChange={(e) => setRespondent(e.target.value as (typeof RESPONDENTS)[number])} className={inputClasses}>
              {RESPONDENTS.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium text-slate-700">Scan of the form (PDF, JPEG or PNG)</span>
            <input type="file" accept="application/pdf,image/jpeg,image/png" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block w-full text-sm" />
          </label>
        </div>

        {inst && entry === 'items_or_total' ? (
          <div className="flex flex-wrap gap-2 text-sm" role="radiogroup" aria-label="Entry">
            {(['items', 'total'] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                onClick={() => setModeChoice(m)}
                className={cx('rounded-lg border px-3 py-1.5 font-semibold', mode === m ? 'border-blue-300 bg-blue-50 text-blue-800' : 'border-slate-300 text-slate-700')}
              >
                {m === 'items' ? 'Enter each item' : 'Enter the total only'}
              </button>
            ))}
          </div>
        ) : null}
        {inst && entry === 'total_only' ? <p className="text-xs text-slate-600">Licensed form: the items are not stored in Altrixs. Enter the total from the scored form.</p> : null}
        {inst && entry === 'items_only' ? <p className="text-xs text-slate-600">Read by item, not by total: enter every item.</p> : null}

        {inst && mode === 'items' ? (
          <ol className="space-y-2">
            {inst.questions!.map((q, idx) => (
              <li key={q.id} className="rounded-lg border border-slate-200 p-2 text-sm">
                <div className="text-slate-900">
                  <span className="font-semibold">{idx + 1}.</span> {q.text}
                </div>
                <select
                  aria-label={`Item ${idx + 1} response`}
                  value={answers[q.id] ?? ''}
                  onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: Number(e.target.value) }))}
                  className={cx(inputClasses, 'mt-1')}
                >
                  <option value="">Response…</option>
                  {q.options.map((o) => (
                    <option key={`${o.label}-${o.score}`} value={o.score}>
                      {o.label} ({o.score})
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ol>
        ) : null}

        {inst && mode === 'total' ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1.5 block font-medium text-slate-700">Total score (0–{inst.maxScore ?? '?'})</span>
              <input inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} className={inputClasses} />
            </label>
            {safetyQuestion ? (
              <label className="block text-sm">
                <span className="mb-1.5 block font-medium text-slate-700">Item {safetyItem!.replace(/^q/, '')} (safety item) answer</span>
                <select value={safety} onChange={(e) => setSafety(e.target.value)} className={inputClasses}>
                  <option value="">Choose…</option>
                  {safetyQuestion.options.map((o) => (
                    <option key={o.score} value={o.score}>
                      {o.label} ({o.score})
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
        ) : null}

        <label className="block text-sm">
          <span className="mb-1.5 block font-medium text-slate-700">Note (optional)</span>
          <input value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} className={inputClasses} />
        </label>
        <p className="text-xs text-slate-500">Saved as &quot;Paper — entered by you&quot; on the date of the form. A positive safety item raises a risk alert to the treating clinician.</p>
        {error ? <p className="text-sm text-rose-700">{error}</p> : null}
      </div>
    </Modal>
  );
}
