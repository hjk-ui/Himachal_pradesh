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
  CSSRS_BEHAVIOR,
  CSSRS_IDEATION,
  computeRisk,
  cssrsRiskLabel,
  type CssrsRiskLevel,
} from '@/lib/clinical/cssrsRisk';
import { PageHeader, buttonClasses, type Tone, Alert } from '@/components/ui';
import { TONE_BANNER, TONE_ICON } from '@/components/ui/tokens';

/** Risk tier -> semantic tone (imminent/high = danger). */
const RISK_TONE: Record<CssrsRiskLevel, Tone> = { imminent: 'danger', high: 'danger', moderate: 'warning', low: 'success' };

const IDEATION = CSSRS_IDEATION;

const INTENSITY = [
  { id: 'freq', label: 'Frequency', options: ['Less than once a week', 'Once a week', '2–5 times a week', 'Daily or almost daily', 'Many times each day'] },
  { id: 'duration', label: 'Duration', options: ['Fleeting — few seconds or minutes', 'Less than 1 hour / some of the time', '1–4 hours / a lot of time', '4–8 hours / most of day', 'More than 8 hours / persistent or continuous'] },
  { id: 'control', label: 'Controllability', options: ['Easily able to control thoughts', 'Can control thoughts with little difficulty', 'Can control thoughts with some difficulty', 'Can control thoughts with a lot of difficulty', 'Unable to control thoughts', 'Does not attempt to control thoughts'] },
  { id: 'deterrents', label: 'Deterrents', options: ['Deterrents definitely stopped you', 'Deterrents probably stopped you', 'Uncertain that deterrents stopped you', 'Deterrents most likely did not stop you', 'Deterrents definitely did not stop you', 'Does not apply'] },
  { id: 'reasons', label: 'Reasons for Ideation', options: ['Completely to get attention / revenge / reaction', 'Mostly to get attention / revenge / reaction', 'Equally to get attention and to end / stop the pain', 'Mostly to end or stop the pain', 'Completely to end or stop the pain', 'Does not apply'] },
] as const;

const BEHAVIOR = CSSRS_BEHAVIOR;

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
    if (clients.length && !clientId) {
      // ?clientId= (Visit Guide "Give C-SSRS") preselects that client
      const requested = new URLSearchParams(window.location.search).get('clientId');
      setClientId(clients.find((c) => c.id === requested)?.id ?? clients[0].id);
    }
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
    <div className="mx-auto w-full min-w-0 max-w-4xl space-y-6">
      <header className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs print:border-0 print:shadow-none">
        <PageHeader
        title="C-SSRS (Suicide Scale)"
        description="Columbia-Suicide Severity Rating Scale — ideation, intensity, and behavior wizard."
        actions={<>
          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 print:hidden">
            <User size={16} className="text-slate-500" />
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
        </>}
      />
        {clientsError && <p className="mt-3 text-sm text-rose-700">{clientsError}</p>}

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
                step === key ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'
              }`}
            >
              {label}
            </li>
          ))}
        </ol>
      </header>

      {error && (
        <Alert tone="danger">
          {error}
        </Alert>
      )}
      {notice && (
        <Alert tone="success">
          {notice}
        </Alert>
      )}

      {step === 'ideation' && (
        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
          <h2 className="text-lg font-semibold text-slate-900">Suicidal Ideation (Q1–Q5)</h2>
          {IDEATION.map((q) => (
            <YesNoRow key={q.id} id={q.id} text={q.text} value={answers[q.id]} onChange={setYesNo} />
          ))}
          <div className="flex justify-end gap-2 pt-2 print:hidden">
            <button
              type="button"
              onClick={nextFromIdeation}
              className={buttonClasses({ variant: 'primary' })}
            >
              Continue <ChevronRight size={16} />
            </button>
          </div>
        </section>
      )}

      {step === 'intensity' && (
        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
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
              className={buttonClasses({ variant: 'primary' })}
            >
              Continue <ChevronRight size={16} />
            </button>
          </div>
        </section>
      )}

      {step === 'behavior' && (
        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
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
              className={buttonClasses({ variant: 'primary' })}
            >
              Review summary <ChevronRight size={16} />
            </button>
          </div>
        </section>
      )}

      {step === 'summary' && (
        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
          <h2 className="text-lg font-semibold text-slate-900">Summary & Clinical Sign-Off</h2>
          <div
            className={`flex items-start gap-3 rounded-lg border px-4 py-3 ${TONE_BANNER[RISK_TONE[risk]]}`}
          >
            {(risk === 'high' || risk === 'imminent') && <AlertTriangle aria-hidden className={`mt-0.5 shrink-0 ${TONE_ICON[RISK_TONE[risk]]}`} />}
            {(risk === 'low' || risk === 'moderate') && <CheckCircle2 aria-hidden className={`mt-0.5 shrink-0 ${TONE_ICON[RISK_TONE[risk]]}`} />}
            <div>
              <p className="font-semibold">
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
                className={buttonClasses({ variant: 'primary' })}
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
        <span className="mr-2 font-bold uppercase text-slate-500">{id}</span>
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
                ? 'border-transparent bg-blue-600 text-white'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
            aria-pressed={value === opt.score}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
