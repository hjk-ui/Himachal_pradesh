'use client';

import { useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Lock, Tablet, X } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  AHC_SOURCE,
  AHC_QUESTIONS,
  CARD_META,
  cardsFor,
  type AhcAnswers,
  type AhcCard,
  type AhcQuestion,
} from '@/lib/sdoh/ahcHrsn';
import { sdohApi, type SdohScreeningDto } from '../api';
import { primaryBtn, secondaryBtn, inputCls } from './ui';

type Phase = 'setup' | 'questions' | 'handback' | 'review';

export interface WizardResult {
  screening: SdohScreeningDto;
  riskAlertCreated: boolean;
  safetyItemEndorsed: boolean;
}

function newSubmissionId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

function AnswerButton({ selected, label, onClick, multi }: { selected: boolean; label: string; onClick: () => void; multi?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`flex min-h-[56px] w-full items-center gap-3 rounded-2xl border-2 px-4 py-3 text-left text-base transition ${
        selected ? 'border-[#5C2D91] bg-[#5C2D91]/5 font-semibold text-[#3d1d61]' : 'border-slate-200 bg-white text-slate-800 hover:border-slate-300'
      }`}
    >
      <span
        className={`grid h-6 w-6 shrink-0 place-items-center border-2 ${multi ? 'rounded-md' : 'rounded-full'} ${
          selected ? 'border-[#5C2D91] bg-[#5C2D91] text-white' : 'border-slate-300'
        }`}
      >
        {selected && <Check size={14} strokeWidth={3} />}
      </span>
      <span>{label}</span>
    </button>
  );
}

function QuestionBlock({ q, value, onChange }: { q: AhcQuestion; value: string | string[] | null | undefined; onChange: (v: string | string[] | null) => void }) {
  const list = Array.isArray(value) ? value : [];
  function toggle(v: string) {
    if (v === 'none') return onChange(list.includes('none') ? [] : ['none']);
    const next = list.filter((x) => x !== 'none');
    onChange(next.includes(v) ? next.filter((x) => x !== v) : [...next, v]);
  }
  return (
    <fieldset className="space-y-3">
      <legend className="text-lg font-semibold leading-snug text-slate-900">
        <span className="mr-2 text-slate-400">{q.number}.</span>
        {q.text}
      </legend>
      <div className="grid gap-2">
        {q.options.map((o) => (
          <AnswerButton
            key={o.value}
            multi={q.multi}
            label={o.label}
            selected={q.multi ? list.includes(o.value) : value === o.value}
            onClick={() => (q.multi ? toggle(o.value) : onChange(value === o.value ? null : o.value))}
          />
        ))}
      </div>
      <button
        type="button"
        onClick={() => onChange(null)}
        className={`text-sm font-medium underline-offset-2 hover:underline ${value === null ? 'text-[#5C2D91]' : 'text-slate-500'}`}
      >
        {value === null ? 'Marked as prefer not to answer' : 'Prefer not to answer'}
      </button>
    </fieldset>
  );
}

/**
 * AHC HRSN screening, one domain per card. Staff can read the questions aloud, or turn on
 * "client completes on this device" — the client then hands the tablet back before results show.
 */
export function ScreeningWizard({ client, onDone, onCancel }: { client: { id: string; name: string }; onDone: (r: WizardResult) => void; onCancel: () => void }) {
  const [phase, setPhase] = useState<Phase>('setup');
  const [includeSupplemental, setIncludeSupplemental] = useState(false);
  const [respondent, setRespondent] = useState<'self' | 'caregiver'>('self');
  const [selfComplete, setSelfComplete] = useState(false);
  const [answers, setAnswers] = useState<AhcAnswers>({});
  const [step, setStep] = useState(0);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const submissionId = useRef(newSubmissionId());

  const cards = useMemo(() => cardsFor(includeSupplemental), [includeSupplemental]);
  const card: AhcCard | undefined = cards[step];
  const cardQuestions = AHC_QUESTIONS.filter((q) => q.card === card);
  const allQuestions = AHC_QUESTIONS.filter((q) => includeSupplemental || !q.supplemental);
  const answered = allQuestions.filter((q) => answers[q.id] !== undefined && answers[q.id] !== null && !(Array.isArray(answers[q.id]) && !(answers[q.id] as string[]).length)).length;
  const progress = phase === 'questions' ? Math.round((step / cards.length) * 100) : phase === 'setup' ? 0 : 100;

  function next() {
    if (step < cards.length - 1) setStep(step + 1);
    else setPhase(selfComplete ? 'handback' : 'review');
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function submit() {
    setSaving(true);
    try {
      const res = await sdohApi.submitScreening({
        submissionId: submissionId.current,
        clientId: client.id,
        answers,
        includeSupplemental,
        respondent,
        notes: notes.trim() || null,
      });
      onDone(res);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Screening could not be saved');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">AHC Health-Related Social Needs screening</p>
          <p className="text-base font-semibold text-slate-900">{client.name}</p>
        </div>
        {phase !== 'handback' && (
          <button type="button" onClick={onCancel} className="rounded-xl p-2 text-slate-500 hover:bg-slate-100" aria-label="Cancel screening">
            <X size={20} />
          </button>
        )}
      </div>

      <div className="h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full bg-[#5C2D91] transition-all" style={{ width: `${progress}%` }} />
      </div>

      {phase === 'setup' && (
        <div className="space-y-5 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Before you start</h2>
            <p className="mt-1 text-sm text-slate-600">
              10 questions about housing, food, transportation, utilities and safety. Takes about 3 minutes. The client can skip any question.
            </p>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-semibold text-slate-800">Who is answering?</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <AnswerButton selected={respondent === 'self'} label="The client" onClick={() => setRespondent('self')} />
              <AnswerButton selected={respondent === 'caregiver'} label="Parent or caregiver for the client" onClick={() => setRespondent('caregiver')} />
            </div>
          </div>
          <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 p-4">
            <input type="checkbox" className="mt-1 h-5 w-5 accent-[#5C2D91]" checked={includeSupplemental} onChange={(e) => setIncludeSupplemental(e.target.checked)} />
            <span>
              <span className="block text-sm font-semibold text-slate-800">Add the supplemental questions (6 more)</span>
              <span className="block text-sm text-slate-500">Financial strain, employment, family & community support, education.</span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 p-4">
            <input type="checkbox" className="mt-1 h-5 w-5 accent-[#5C2D91]" checked={selfComplete} onChange={(e) => setSelfComplete(e.target.checked)} />
            <span>
              <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
                <Tablet size={15} /> Client completes on this device
              </span>
              <span className="block text-sm text-slate-500">Hand the tablet to the client. Results stay hidden until it is handed back to staff.</span>
            </span>
          </label>
          <button type="button" className={`${primaryBtn} w-full py-3.5 text-base`} onClick={() => { setStep(0); setPhase('questions'); }}>
            Start <ArrowRight size={18} />
          </button>
        </div>
      )}

      {phase === 'questions' && card && (
        <div className="space-y-5 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-xl font-bold text-slate-900">{CARD_META[card].title}</h2>
            <span className="text-sm font-medium text-slate-500">
              {step + 1} of {cards.length}
            </span>
          </div>
          {card === 'safety' && !selfComplete && (
            <p className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <Lock size={15} className="mt-0.5 shrink-0" /> Ask these questions in private, with no partner or family member in the room.
            </p>
          )}
          {CARD_META[card].intro && <p className="text-sm text-slate-600">{CARD_META[card].intro}</p>}
          <div className="space-y-6">
            {cardQuestions.map((q) => (
              <QuestionBlock key={q.id} q={q} value={answers[q.id]} onChange={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))} />
            ))}
          </div>
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              className={`${secondaryBtn} flex-1 py-3.5 text-base`}
              onClick={() => (step === 0 ? setPhase('setup') : setStep(step - 1))}
            >
              <ArrowLeft size={18} /> Back
            </button>
            <button type="button" className={`${primaryBtn} flex-[2] py-3.5 text-base`} onClick={next}>
              {step < cards.length - 1 ? 'Next' : 'Finish'} <ArrowRight size={18} />
            </button>
          </div>
        </div>
      )}

      {phase === 'handback' && (
        <div className="space-y-5 rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <Check size={40} className="mx-auto text-emerald-600" />
          <h2 className="text-2xl font-bold text-slate-900">Thank you</h2>
          <p className="text-base text-slate-600">Please hand this device back to staff.</p>
          <button type="button" className={`${secondaryBtn} mx-auto`} onClick={() => setPhase('review')}>
            Staff: continue
          </button>
        </div>
      )}

      {phase === 'review' && (
        <div className="space-y-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <h2 className="text-lg font-semibold text-slate-900">Review and save</h2>
          <p className="text-sm text-slate-600">
            {answered} of {allQuestions.length} questions answered.{' '}
            {answered < allQuestions.length && 'Skipped questions are saved as not answered.'}
          </p>
          <div className="flex flex-wrap gap-2">
            {cards.map((c, i) => (
              <button
                key={c}
                type="button"
                className="rounded-full border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                onClick={() => { setStep(i); setPhase('questions'); }}
              >
                Edit {CARD_META[c].title.toLowerCase()}
              </button>
            ))}
          </div>
          <label className="block space-y-1.5 text-sm">
            <span className="font-medium text-slate-700">Staff notes (optional)</span>
            <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} />
          </label>
          <button type="button" className={`${primaryBtn} w-full py-3.5 text-base`} disabled={saving || answered === 0} onClick={submit}>
            {saving ? 'Saving…' : 'Save screening and see results'}
          </button>
        </div>
      )}

      <p className="px-1 text-[11px] leading-relaxed text-slate-400">
        Questions: {AHC_SOURCE.tool}{' '}
        <a href={AHC_SOURCE.toolUrl} target="_blank" rel="noreferrer" className="underline">
          Source
        </a>
      </p>
    </div>
  );
}
