'use client';

/**
 * Patient questionnaire link (/m/<token>): no login. Date of birth first (3 tries, then the link
 * locks), then each question one at a time with a progress bar and large tap targets. Answers save
 * as the patient goes (they can close and come back within 2 hours of the DOB check, or check the
 * DOB again). The 988 crisis banner is always visible; a safety answer ends on the crisis resources
 * page. API: /api/measures/public/[token].
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { CheckCircle2, ChevronLeft, Loader2, Lock, Phone, Shield } from 'lucide-react';
import { CRISIS_RESOURCES } from '@/lib/ai/riskWatch/crisisResources';

type Question = { id: string; text: string; options: { label: string; score: number }[] };
type Instrument = { id: string; title: string; prompt: string | null; questions: Question[] };
type Answers = Record<string, Record<string, number>>;
type Phase = 'loading' | 'verify' | 'questions' | 'review' | 'done' | 'crisis' | 'closed';

const CLOSED_TEXT: Record<string, string> = {
  invalid: 'This link is not valid. Please use the most recent message from your care team.',
  expired: 'This link has expired. Please contact the office for a new one.',
  locked: 'This link is locked after too many date-of-birth attempts. Please contact the office for a new link.',
  completed: 'This questionnaire is already complete. Thank you.',
  cancelled: 'This link was replaced by a newer one, or the questionnaire was already completed.',
  not_sent: 'This link is not active. Please contact the office.',
};

function CrisisBanner() {
  return (
    <div role="region" aria-label="Crisis help" className="sticky top-0 z-20 bg-rose-700 px-4 py-2 text-center text-sm font-semibold text-white">
      In crisis? Call or text <a href="tel:988" className="inline-block px-1 py-1.5 underline">988</a> any time · Emergency: <a href="tel:911" className="inline-block px-1 py-1.5 underline">911</a>
    </div>
  );
}

function CrisisResources() {
  const r = CRISIS_RESOURCES;
  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-bold text-slate-900">Help is available right now</h1>
      <p className="text-base text-slate-700">
        Thank you for your answers. Your care team will see them, but they are not monitored around the clock. If you are thinking about hurting
        yourself or you are not safe, please reach out now:
      </p>
      <a href={r.lifeline.tel} className="flex min-h-14 items-center gap-3 rounded-2xl bg-rose-700 px-5 py-4 text-lg font-bold text-white">
        <Phone className="h-6 w-6" aria-hidden /> Call or text 988
      </a>
      <p className="text-sm text-slate-600">
        {r.lifeline.label}: {r.lifeline.detail}
      </p>
      <a href={r.textLine.sms} className="flex min-h-14 items-center gap-3 rounded-2xl border-2 border-slate-300 px-5 py-4 text-lg font-semibold text-slate-900">
        Text HOME to 741741
      </a>
      <p className="text-sm text-slate-600">
        {r.textLine.label}: {r.textLine.detail}
      </p>
      <a href={r.emergency.tel} className="flex min-h-14 items-center gap-3 rounded-2xl border-2 border-rose-300 px-5 py-4 text-lg font-semibold text-rose-800">
        Call 911
      </a>
      <p className="text-sm text-slate-600">{r.emergency.detail}</p>
    </div>
  );
}

export default function MeasureLinkPage() {
  const { token } = useParams<{ token: string }>();
  const api = `/api/measures/public/${encodeURIComponent(token)}`;
  const [phase, setPhase] = useState<Phase>('loading');
  const [closed, setClosed] = useState<string>('invalid');
  const [practice, setPractice] = useState<string | null>(null);
  const [dob, setDob] = useState('');
  const [dobError, setDobError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [answers, setAnswers] = useState<Answers>({});
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flat = useMemo(() => instruments.flatMap((i) => i.questions.map((q) => ({ inst: i, q }))), [instruments]);

  const post = useCallback(
    async (body: unknown) => {
      const res = await fetch(api, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' });
      return { status: res.status, data: await res.json().catch(() => ({})) };
    },
    [api]
  );

  const start = useCallback((q: { instruments: Instrument[]; answers: Answers }) => {
    setInstruments(q.instruments);
    setAnswers(q.answers || {});
    const all = q.instruments.flatMap((i) => i.questions.map((x) => ({ i: i.id, q: x.id })));
    const firstOpen = all.findIndex((x) => q.answers?.[x.i]?.[x.q] === undefined);
    setStep(firstOpen === -1 ? Math.max(0, all.length - 1) : firstOpen);
    setPhase(firstOpen === -1 && all.length ? 'review' : 'questions');
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await fetch(api, { cache: 'no-store' });
        const data = await res.json();
        if (!live) return;
        setPractice(data.practiceName ?? null);
        if (data.state !== 'verify') {
          setClosed(data.state || 'invalid');
          setPhase('closed');
          return;
        }
        // A session from a DOB check in the last 2 hours picks up where the patient left off
        const r = await post({ action: 'resume' });
        if (!live) return;
        if (r.data.success) start(r.data.questionnaire);
        else setPhase('verify');
      } catch {
        if (live) {
          setClosed('invalid');
          setPhase('closed');
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [api, post, start]);

  const verify = async () => {
    setBusy(true);
    setDobError(null);
    try {
      const r = await post({ action: 'verify', dob });
      if (r.data.success) {
        setError(null);
        start(r.data.questionnaire);
      } else if (r.data.state === 'wrong_dob') {
        const left = Number(r.data.remaining ?? 0);
        setDobError(`That date of birth does not match our records. ${left} ${left === 1 ? 'try' : 'tries'} left.`);
      } else {
        setClosed(r.data.state || 'invalid');
        setPhase('closed');
      }
    } catch {
      setDobError('Could not check right now. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const queueSave = (next: Answers) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void post({ action: 'save', answers: next }).catch(() => undefined);
    }, 400);
  };

  const choose = (instId: string, qId: string, score: number) => {
    const next = { ...answers, [instId]: { ...(answers[instId] || {}), [qId]: score } };
    setAnswers(next);
    queueSave(next);
    if (step < flat.length - 1) setTimeout(() => setStep((s) => Math.min(s + 1, flat.length - 1)), 150);
    else setPhase('review');
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      const r = await post({ action: 'complete', answers });
      if (r.data.success) setPhase(r.data.crisis ? 'crisis' : 'done');
      else if (r.data.state === 'incomplete') {
        const idx = flat.findIndex((x) => answers[x.inst.id]?.[x.q.id] === undefined);
        setStep(idx === -1 ? 0 : idx);
        setPhase('questions');
        setError('Please answer every question.');
      } else if (r.data.state === 'session') {
        setPhase('verify');
        setError('For your privacy, please enter your date of birth again. Your answers are saved.');
      } else {
        setClosed(r.data.state || 'invalid');
        setPhase('closed');
      }
    } catch {
      setError('Could not send right now. Your answers are saved; please try again.');
    } finally {
      setBusy(false);
    }
  };

  const answeredCount = flat.filter((x) => answers[x.inst.id]?.[x.q.id] !== undefined).length;
  const pct = flat.length ? Math.round((answeredCount / flat.length) * 100) : 0;
  const cur = flat[step];

  return (
    <div className="min-h-[100dvh] bg-slate-50">
      <CrisisBanner />
      <main className="mx-auto w-full min-w-0 max-w-lg px-4 pb-[calc(4rem+env(safe-area-inset-bottom))] pt-6">
        <div className="mb-5 flex items-center gap-2 text-sm font-semibold text-slate-600">
          <Shield className="h-4 w-4 text-[#5C2D91]" aria-hidden />
          {practice || 'Your care team'}
        </div>

        {phase === 'loading' && (
          <div className="flex items-center gap-2 text-slate-600">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> Loading…
          </div>
        )}

        {phase === 'closed' && (
          <div className="rounded-2xl bg-white p-5 shadow-sm sm:p-6">
            <Lock className="mb-3 h-8 w-8 text-slate-400" aria-hidden />
            <p className="text-lg text-slate-800">{CLOSED_TEXT[closed] ?? CLOSED_TEXT.invalid}</p>
          </div>
        )}

        {phase === 'verify' && (
          <form
            className="space-y-4 rounded-2xl bg-white p-5 shadow-sm sm:p-6"
            onSubmit={(e) => {
              e.preventDefault();
              void verify();
            }}
          >
            <h1 className="text-2xl font-bold text-slate-900">A short questionnaire before your visit</h1>
            <p className="text-base text-slate-700">For your privacy, please enter your date of birth.</p>
            {error ? <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{error}</p> : null}
            <label className="block text-base font-semibold text-slate-800" htmlFor="dob">
              Date of birth
            </label>
            <input
              id="dob"
              type="date"
              autoComplete="bday"
              required
              value={dob}
              onChange={(e) => setDob(e.target.value)}
              className="min-h-14 w-full rounded-xl border-2 border-slate-300 px-4 text-lg focus:border-[#5C2D91] focus:outline-none"
            />
            {dobError ? (
              <p role="alert" className="text-base font-semibold text-rose-700">
                {dobError}
              </p>
            ) : null}
            <button type="submit" disabled={busy || !dob} className="min-h-14 w-full rounded-xl bg-[#5C2D91] text-lg font-bold text-white disabled:opacity-50">
              {busy ? 'Checking…' : 'Continue'}
            </button>
          </form>
        )}

        {(phase === 'questions' || phase === 'review') && flat.length > 0 && (
          <div className="space-y-4">
            <div>
              <div className="mb-1 flex justify-between text-sm text-slate-600">
                <span>
                  {answeredCount} of {flat.length} answered
                </span>
                <span>{pct}%</span>
              </div>
              <div className="h-3 w-full overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Progress">
                <div className="h-full rounded-full bg-[#5C2D91] transition-all" style={{ width: `${pct}%` }} />
              </div>
            </div>
            {error ? (
              <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                {error}
              </p>
            ) : null}

            {phase === 'questions' && cur ? (
              <div className="rounded-2xl bg-white p-5 shadow-sm">
                <p className="text-sm font-semibold text-slate-500">{cur.inst.title}</p>
                {cur.inst.prompt ? <p className="mt-1 text-sm text-slate-600">{cur.inst.prompt}</p> : null}
                <h1 className="mt-3 break-words text-xl font-bold leading-snug text-slate-900">{cur.q.text}</h1>
                <div className="mt-4 space-y-3" role="radiogroup" aria-label={cur.q.text}>
                  {cur.q.options.map((o) => {
                    const selected = answers[cur.inst.id]?.[cur.q.id] === o.score;
                    return (
                      <button
                        key={`${o.label}-${o.score}`}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => choose(cur.inst.id, cur.q.id, o.score)}
                        className={`flex min-h-14 w-full items-center rounded-xl border-2 px-4 py-3 text-left text-lg ${
                          selected ? 'border-[#5C2D91] bg-purple-50 font-semibold text-[#5C2D91]' : 'border-slate-200 bg-white text-slate-800'
                        }`}
                      >
                        {o.label}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-5 flex items-center justify-between gap-3">
                  <button
                    type="button"
                    disabled={step === 0}
                    onClick={() => setStep((s) => Math.max(0, s - 1))}
                    className="flex min-h-12 items-center gap-1 px-2 text-base font-semibold text-slate-600 disabled:opacity-30"
                  >
                    <ChevronLeft className="h-5 w-5" aria-hidden /> Back
                  </button>
                  <span className="self-center text-sm text-slate-500">
                    Question {step + 1} of {flat.length}
                  </span>
                </div>
              </div>
            ) : null}

            {phase === 'review' ? (
              <div className="space-y-4 rounded-2xl bg-white p-5 shadow-sm sm:p-6">
                <h1 className="text-xl font-bold text-slate-900">All done?</h1>
                <p className="text-base text-slate-700">You answered every question. Send your answers to your care team.</p>
                <button type="button" onClick={() => void submit()} disabled={busy} className="min-h-14 w-full rounded-xl bg-[#5C2D91] text-lg font-bold text-white disabled:opacity-50">
                  {busy ? 'Sending…' : 'Send my answers'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setStep(flat.length - 1);
                    setPhase('questions');
                  }}
                  className="min-h-12 w-full text-base font-semibold text-slate-600"
                >
                  Go back and change an answer
                </button>
              </div>
            ) : null}
          </div>
        )}

        {phase === 'done' && (
          <div className="rounded-2xl bg-white p-6 text-center shadow-sm">
            <CheckCircle2 className="mx-auto mb-3 h-12 w-12 text-emerald-600" aria-hidden />
            <h1 className="text-2xl font-bold text-slate-900">Thank you</h1>
            <p className="mt-2 text-base text-slate-700">Your answers were sent to your care team. You can close this page.</p>
          </div>
        )}

        {phase === 'crisis' && (
          <div className="rounded-2xl bg-white p-5 shadow-sm sm:p-6">
            <CrisisResources />
          </div>
        )}
      </main>
    </div>
  );
}
