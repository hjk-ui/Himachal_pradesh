'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Printer,
  ShieldAlert,
  User,
} from 'lucide-react';
import { useClients } from '@/features/clients';
import { apiJson } from '@/lib/api-client';
import {
  computeRisk,
  cssrsRiskColor,
  cssrsRiskLabel,
  type CssrsRiskLevel,
} from '@/lib/clinical/cssrsRisk';

const PURPLE = '#5C2D91';
const GRADIENT = 'linear-gradient(135deg, #5C2D91, #7C3AED)';

const IDEATION = [
  { id: 'q1', text: 'Wish to be Dead — Have you wished you were dead or wished you could go to sleep and not wake up?' },
  { id: 'q2', text: 'Non-Specific Active Suicidal Thoughts — Have you actually had any thoughts of killing yourself?' },
  { id: 'q3', text: 'Active Suicidal Ideation with Any Methods (Not Plan) without Intent — Have you been thinking about how you might do this?' },
  { id: 'q4', text: 'Active Suicidal Ideation with Some Intent to Act, without Specific Plan — Have you had these thoughts and had some intention of acting on them?' },
  { id: 'q5', text: 'Active Suicidal Ideation with Specific Plan and Intent — Have you started to work out or worked out the details of how to kill yourself? Do you intend to carry out this plan?' },
] as const;

const INTENSITY = [
  { id: 'freq', label: 'Frequency', options: ['Less than once a week', 'Once a week', '2–5 times a week', 'Daily or almost daily', 'Many times each day'] },
  { id: 'duration', label: 'Duration', options: ['Fleeting — few seconds or minutes', 'Less than 1 hour / some of the time', '1–4 hours / a lot of time', '4–8 hours / most of day', 'More than 8 hours / persistent or continuous'] },
  { id: 'control', label: 'Controllability', options: ['Easily able to control thoughts', 'Can control thoughts with little difficulty', 'Can control thoughts with some difficulty', 'Can control thoughts with a lot of difficulty', 'Unable to control thoughts', 'Does not attempt to control thoughts'] },
  { id: 'deterrents', label: 'Deterrents', options: ['Deterrents definitely stopped you', 'Deterrents probably stopped you', 'Uncertain that deterrents stopped you', 'Deterrents most likely did not stop you', 'Deterrents definitely did not stop you', 'Does not apply'] },
  { id: 'reasons', label: 'Reasons for Ideation', options: ['Completely to get attention / revenge / reaction', 'Mostly to get attention / revenge / reaction', 'Equally to get attention and to end / stop the pain', 'Mostly to end or stop the pain', 'Completely to end or stop the pain', 'Does not apply'] },
] as const;

const BEHAVIOR = [
  { id: 'q6', text: 'Actual Attempt — Have you made a suicide attempt?' },
  { id: 'q7', text: 'Interrupted Attempt — Has there been a time when you started to do something to end your life but someone or something stopped you before you actually did anything?' },
  { id: 'q8', text: 'Aborted / Self-Interrupted Attempt — Has there been a time when you started to do something to try to end your life but you stopped yourself before you actually did anything?' },
  { id: 'q9', text: 'Preparatory Acts or Behavior — Have you taken any steps toward making a suicide attempt or preparing to kill yourself (such as collecting pills, getting a gun, giving valuables away, writing a suicide note)?' },
  { id: 'q10', text: 'Non-Suicidal Self-Injurious Behavior — Have you done anything to hurt yourself without intending to kill yourself?' },
] as const;

type Step = 'ideation' | 'intensity' | 'behavior' | 'summary';

export default function CssrsPage() {
  const { clients, loading: clientsLoading, error: clientsError } = useClients();
  const [clientId, setClientId] = useState('');
  const [step, setStep] = useState<Step>('ideation');
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [intensity, setIntensity] = useState<Record<string, string>>({});
  const [signed, setSigned] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (clients.length && !clientId) setClientId(clients[0].id);
  }, [clients, clientId]);

  const client = clients.find((c) => c.id === clientId);
  const hasIdeation = ['q1', 'q2', 'q3', 'q4', 'q5'].some((k) => answers[k] === 1);
  const risk: CssrsRiskLevel = useMemo(() => computeRisk(answers), [answers]);

  const ideationComplete = IDEATION.every((q) => answers[q.id] === 0 || answers[q.id] === 1);
  const behaviorComplete = BEHAVIOR.every((q) => answers[q.id] === 0 || answers[q.id] === 1);

  function setYesNo(id: string, value: number) {
    setAnswers((prev) => ({ ...prev, [id]: value }));
  }

  function nextFromIdeation() {
    if (!ideationComplete) {
      setError('Answer all ideation items (Q1–Q5) before continuing.');
      return;
    }
    setError(null);
    setStep(hasIdeation ? 'intensity' : 'behavior');
  }

  async function handleSave() {
    if (!clientId || !client) {
      setError('Select a client.');
      return;
    }
    if (!ideationComplete || !behaviorComplete) {
      setError('Complete ideation and behavior sections before saving.');
      return;
    }
    if (!signed) {
      setError('Clinician signature confirmation is required to save.');
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const riskScore = risk === 'imminent' ? 5 : risk === 'high' ? 4 : risk === 'moderate' ? 2 : answers.q1 === 1 ? 1 : 0;
      await apiJson('/api/clinical/assessments', {
        method: 'POST',
        body: JSON.stringify({
          clientId,
          instrumentId: 'c-ssrs-brief',
          administrationType: 'Manual',
          respondentType: 'Clinician',
          totalScore: riskScore,
          severity: cssrsRiskLabel(risk),
          interpretation: `C-SSRS risk: ${cssrsRiskLabel(risk)}. Ideation Q1–Q5 and behavior Q6–Q10 completed.`,
          safetyFlagged: risk === 'high' || risk === 'imminent' || risk === 'moderate',
          safetyNotes:
            risk === 'imminent' || risk === 'high'
              ? 'Elevated C-SSRS risk — initiate safety protocol and crisis response as indicated.'
              : undefined,
          clinicianVerified: true,
          notes: JSON.stringify({ answers, intensity, risk, instrument: 'C-SSRS Lifetime/Recent' }),
          answers,
        }),
      });

      if (risk === 'high' || risk === 'imminent') {
        await apiJson('/api/events/crisis-flag', {
          method: 'POST',
          body: JSON.stringify({
            clientId,
            clientName: client.name,
            riskLevel: risk,
            keywords: Object.entries(answers)
              .filter(([, v]) => v === 1)
              .map(([k]) => k),
          }),
        });
        setNotice(`Saved. Crisis flag recorded (${cssrsRiskLabel(risk)}).`);
      } else {
        setNotice('C-SSRS assessment saved.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save C-SSRS');
    } finally {
      setSaving(false);
    }
  }

  function handlePrint() {
    window.print();
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6 print:p-0">
      <header className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm print:border-0 print:shadow-none">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded-xl p-2" style={{ background: '#F3E8FF', color: PURPLE }}>
                <ShieldAlert size={22} />
              </span>
              <h1 className="text-2xl font-bold text-slate-900">C-SSRS (Suicide Scale)</h1>
            </div>
            <p className="mt-1 text-sm text-slate-500">
              Columbia-Suicide Severity Rating Scale — ideation, intensity, and behavior wizard.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 print:hidden">
            <User size={16} className="text-slate-400" />
            <select
              aria-label="C-SSRS client"
              className="bg-transparent text-sm font-medium text-slate-800 outline-none"
              value={clientId}
              disabled={clientsLoading}
              onChange={(e) => setClientId(e.target.value)}
            >
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        {clientsError && <p className="mt-3 text-sm text-red-700">{clientsError}</p>}

        <ol className="mt-5 flex flex-wrap gap-2 print:hidden">
          {(
            [
              ['ideation', '1. Ideation'],
              ['intensity', '2. Intensity'],
              ['behavior', '3. Behavior'],
              ['summary', '4. Summary'],
            ] as const
          ).map(([key, label]) => (
            <li
              key={key}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                step === key ? 'text-white' : 'bg-slate-100 text-slate-600'
              }`}
              style={step === key ? { background: GRADIENT } : undefined}
            >
              {label}
            </li>
          ))}
        </ol>
      </header>

      {error && (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {notice}
        </p>
      )}

      {step === 'ideation' && (
        <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">Suicidal Ideation (Q1–Q5)</h2>
          {IDEATION.map((q) => (
            <YesNoRow key={q.id} id={q.id} text={q.text} value={answers[q.id]} onChange={setYesNo} />
          ))}
          <div className="flex justify-end gap-2 pt-2 print:hidden">
            <button
              type="button"
              onClick={nextFromIdeation}
              className="inline-flex items-center gap-1 rounded-xl px-4 py-2 text-sm font-semibold text-white"
              style={{ background: GRADIENT }}
            >
              Continue <ChevronRight size={16} />
            </button>
          </div>
        </section>
      )}

      {step === 'intensity' && (
        <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">Intensity of Ideation (optional)</h2>
          <p className="text-sm text-slate-500">Complete when any ideation item is endorsed. You may skip if not clinically indicated.</p>
          {INTENSITY.map((item) => (
            <label key={item.id} className="block space-y-1">
              <span className="text-sm font-medium text-slate-800">{item.label}</span>
              <select
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                value={intensity[item.id] ?? ''}
                onChange={(e) => setIntensity((prev) => ({ ...prev, [item.id]: e.target.value }))}
              >
                <option value="">— Select —</option>
                {item.options.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <div className="flex justify-between gap-2 pt-2 print:hidden">
            <button type="button" onClick={() => setStep('ideation')} className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium">
              <ChevronLeft size={16} /> Back
            </button>
            <button
              type="button"
              onClick={() => setStep('behavior')}
              className="inline-flex items-center gap-1 rounded-xl px-4 py-2 text-sm font-semibold text-white"
              style={{ background: GRADIENT }}
            >
              Continue <ChevronRight size={16} />
            </button>
          </div>
        </section>
      )}

      {step === 'behavior' && (
        <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">Suicidal Behavior (Q6–Q10)</h2>
          {BEHAVIOR.map((q) => (
            <YesNoRow key={q.id} id={q.id} text={q.text} value={answers[q.id]} onChange={setYesNo} />
          ))}
          <div className="flex justify-between gap-2 pt-2 print:hidden">
            <button
              type="button"
              onClick={() => setStep(hasIdeation ? 'intensity' : 'ideation')}
              className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium"
            >
              <ChevronLeft size={16} /> Back
            </button>
            <button
              type="button"
              disabled={!behaviorComplete}
              onClick={() => {
                if (!behaviorComplete) {
                  setError('Answer all behavior items (Q6–Q10).');
                  return;
                }
                setError(null);
                setStep('summary');
              }}
              className="inline-flex items-center gap-1 rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              style={{ background: GRADIENT }}
            >
              Review summary <ChevronRight size={16} />
            </button>
          </div>
        </section>
      )}

      {step === 'summary' && (
        <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">Summary & Clinical Sign-Off</h2>
          <div
            className="flex items-start gap-3 rounded-xl border px-4 py-3"
            style={{ borderColor: cssrsRiskColor(risk), background: `${cssrsRiskColor(risk)}14` }}
          >
            {(risk === 'high' || risk === 'imminent') && <AlertTriangle className="mt-0.5 shrink-0" style={{ color: cssrsRiskColor(risk) }} />}
            {(risk === 'low' || risk === 'moderate') && <CheckCircle2 className="mt-0.5 shrink-0" style={{ color: cssrsRiskColor(risk) }} />}
            <div>
              <p className="font-bold" style={{ color: cssrsRiskColor(risk) }}>
                {cssrsRiskLabel(risk)}
              </p>
              <p className="text-sm text-slate-700">
                Client: <strong>{client?.name ?? '—'}</strong>
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Rule: q5+behavior → imminent · q3/q4/q5 or behavior → high · q2 → moderate · else low
              </p>
            </div>
          </div>

          <div className="grid gap-2 text-sm sm:grid-cols-2">
            {[...IDEATION, ...BEHAVIOR].map((q) => (
              <div key={q.id} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                <span className="font-semibold uppercase text-slate-500">{q.id}</span>:{' '}
                {answers[q.id] === 1 ? 'Yes' : answers[q.id] === 0 ? 'No' : '—'}
              </div>
            ))}
          </div>

          <label className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm print:hidden">
            <input type="checkbox" checked={signed} onChange={(e) => setSigned(e.target.checked)} className="mt-1" />
            <span>
              I confirm I administered the C-SSRS and the risk determination above is accurate. This serves as my clinician signature for the chart.
            </span>
          </label>

          <div className="flex flex-wrap justify-between gap-2 print:hidden">
            <button type="button" onClick={() => setStep('behavior')} className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium">
              <ChevronLeft size={16} /> Back
            </button>
            <div className="flex gap-2">
              <button type="button" onClick={handlePrint} className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium">
                <Printer size={16} /> Print
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={handleSave}
                className="inline-flex items-center gap-1 rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                style={{ background: GRADIENT }}
              >
                {saving ? 'Saving…' : 'Save to chart'}
              </button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

function YesNoRow({
  id,
  text,
  value,
  onChange,
}: {
  id: string;
  text: string;
  value?: number;
  onChange: (id: string, value: number) => void;
}) {
  return (
    <div className="rounded-xl border border-slate-200 p-4">
      <p className="text-sm font-medium text-slate-800">
        <span className="mr-2 font-bold uppercase text-slate-400">{id}</span>
        {text}
      </p>
      <div className="mt-3 flex gap-2">
        {[
          { label: 'No', score: 0 },
          { label: 'Yes', score: 1 },
        ].map((opt) => (
          <button
            key={opt.label}
            type="button"
            onClick={() => onChange(id, opt.score)}
            className={`rounded-lg border px-4 py-1.5 text-sm font-semibold ${
              value === opt.score
                ? 'border-transparent text-white'
                : 'border-slate-200 bg-white text-slate-700'
            }`}
            style={value === opt.score ? { background: GRADIENT } : undefined}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
