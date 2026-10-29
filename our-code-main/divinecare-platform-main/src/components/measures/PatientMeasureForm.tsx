'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { INPUT_CLASSES } from '@/components/ui/tokens';
import { CRISIS_BANNER, PATIENT_COPY } from '@/lib/measures/copy';
import type { PatientInstrument } from '@/lib/measures/instruments';

type View =
  | { state: 'invalid' | 'expired' | 'locked' }
  | { state: 'verify'; practiceName: string; attemptsLeft: number }
  | {
      state: 'questions';
      practiceName: string;
      instrument: PatientInstrument;
      answers: Record<string, number>;
      crisis: boolean;
    }
  | { state: 'completed'; crisis: boolean };

type ApiBody = { success?: boolean; view?: View; error?: string; state?: View['state']; attemptsLeft?: number; crisis?: boolean };

function CrisisBanner() {
  return (
    <div
      role="alert"
      className="flex gap-3 rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm font-semibold text-rose-900"
    >
      <AlertTriangle size={18} className="mt-0.5 shrink-0" aria-hidden />
      <p>{CRISIS_BANNER}</p>
    </div>
  );
}

export function PatientMeasureForm({ token }: { token: string }) {
  const url = `/api/measures/public/${encodeURIComponent(token)}`;
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dob, setDob] = useState('');
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [index, setIndex] = useState(0);
  const [reviewing, setReviewing] = useState(false);
  const [doneCrisis, setDoneCrisis] = useState(false);

  const adopt = useCallback((next: View) => {
    setView(next);
    if (next.state === 'questions') {
      setAnswers(next.answers);
      const firstOpen = next.instrument.questions.findIndex((q) => !(q.id in next.answers));
      setIndex(firstOpen === -1 ? 0 : firstOpen);
      setReviewing(firstOpen === -1 && Object.keys(next.answers).length > 0);
    }
  }, []);

  const call = useCallback(
    async (init?: RequestInit): Promise<{ ok: boolean; status: number; body: ApiBody }> => {
      const res = await fetch(url, { cache: 'no-store', credentials: 'same-origin', ...init });
      const body = (await res.json().catch(() => ({}))) as ApiBody;
      return { ok: res.ok, status: res.status, body };
    },
    [url]
  );

  useEffect(() => {
    let live = true;
    call()
      .then((r) => {
        if (!live) return;
        if (r.body.view) adopt(r.body.view);
        else setError(r.body.error || PATIENT_COPY.error);
      })
      .catch(() => live && setError(PATIENT_COPY.error));
    return () => {
      live = false;
    };
  }, [call, adopt]);

  const post = useCallback(
    (payload: unknown) =>
      call({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),
    [call]
  );

  const instrument = view?.state === 'questions' ? view.instrument : null;
  const liveCrisis = useMemo(
    () =>
      Boolean(
        instrument?.questions.some((q) => q.options.some((o) => o.flagged && answers[q.id] === o.score))
      ),
    [instrument, answers]
  );

  async function onVerify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await post({ action: 'verify', dob });
      if (r.body.view) return adopt(r.body.view);
      if (r.body.state === 'locked' || r.body.state === 'expired' || r.body.state === 'invalid') {
        return setView({ state: r.body.state });
      }
      if (r.body.state === 'verify' && typeof r.body.attemptsLeft === 'number') {
        setView((v) => (v?.state === 'verify' ? { ...v, attemptsLeft: r.body.attemptsLeft! } : v));
      }
      setError(r.body.error || PATIENT_COPY.error);
    } catch {
      setError(PATIENT_COPY.error);
    } finally {
      setBusy(false);
    }
  }

  async function persist(action: 'save' | 'complete', next: Record<string, number>) {
    setBusy(true);
    setError(null);
    try {
      const r = await post({ action, answers: next });
      if (r.ok && r.body.success) return r.body;
      if (r.body.state === 'locked' || r.body.state === 'expired' || r.body.state === 'invalid') {
        setView({ state: r.body.state });
      } else if (r.body.state === 'verify') {
        // Session lapsed (2 hours): ask for the date of birth again.
        const fresh = await call();
        if (fresh.body.view) adopt(fresh.body.view);
      } else {
        setError(r.body.error || PATIENT_COPY.error);
      }
      return null;
    } catch {
      setError(PATIENT_COPY.error);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function onNext() {
    if (!instrument) return;
    const ok = await persist('save', answers);
    if (!ok) return;
    if (index >= instrument.questions.length - 1) setReviewing(true);
    else setIndex(index + 1);
  }

  async function onSubmit() {
    const ok = await persist('complete', answers);
    if (!ok) return;
    setDoneCrisis(Boolean(ok.crisis));
    setView({ state: 'completed', crisis: Boolean(ok.crisis) });
  }

  const shell = (children: React.ReactNode) => (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col gap-4 px-4 py-8 font-sans">
      {children}
    </main>
  );

  if (!view) {
    return shell(
      <p className="text-sm text-slate-500" aria-busy="true">
        {error ?? 'Loading…'}
      </p>
    );
  }

  if (view.state === 'invalid' || view.state === 'expired' || view.state === 'locked') {
    return shell(
      <Card>
        <CardBody>
          <p role="alert" className="text-sm text-slate-800">
            {view.state === 'invalid'
              ? PATIENT_COPY.invalid
              : view.state === 'expired'
                ? PATIENT_COPY.expired
                : PATIENT_COPY.locked}
          </p>
        </CardBody>
      </Card>
    );
  }

  if (view.state === 'completed') {
    const crisis = view.crisis || doneCrisis;
    return shell(
      <>
        {crisis ? <CrisisBanner /> : null}
        <Card>
          <CardBody>
            <h1 className="text-lg font-semibold text-slate-900">{PATIENT_COPY.thanksTitle}</h1>
            <p className="mt-2 text-sm text-slate-700">{PATIENT_COPY.thanksBody}</p>
          </CardBody>
        </Card>
      </>
    );
  }

  if (view.state === 'verify') {
    return shell(
      <Card>
        <CardBody>
          <p className="text-[13px] font-medium text-slate-500">{view.practiceName}</p>
          <h1 className="mt-1 text-lg font-semibold text-slate-900">{PATIENT_COPY.verifyTitle}</h1>
          <p className="mt-2 text-sm text-slate-700">{PATIENT_COPY.verifyHelp}</p>
          <form onSubmit={onVerify} className="mt-4 space-y-3">
            <label className="block text-sm font-medium text-slate-800" htmlFor="measure-dob">
              {PATIENT_COPY.verifyLabel}
            </label>
            <input
              id="measure-dob"
              type="date"
              required
              autoComplete="bday"
              value={dob}
              onChange={(e) => setDob(e.target.value)}
              className={INPUT_CLASSES}
              aria-invalid={error ? true : undefined}
            />
            {error ? (
              <p role="alert" className="text-sm text-rose-700">
                {error}
              </p>
            ) : null}
            <Button type="submit" loading={busy} disabled={!dob} className="w-full">
              {PATIENT_COPY.verifyButton}
            </Button>
          </form>
        </CardBody>
      </Card>
    );
  }

  if (view.state !== 'questions') {
    return shell(
      <p role="alert" className="text-sm text-slate-800">
        {PATIENT_COPY.invalid}
      </p>
    );
  }

  const total = view.instrument.questions.length;
  const question = view.instrument.questions[Math.min(index, total - 1)];
  const answeredCount = Object.keys(answers).length;
  const pct = Math.round((answeredCount / total) * 100);

  return shell(
    <>
      {liveCrisis ? <CrisisBanner /> : null}
      <Card>
        <CardBody>
          <p className="text-[13px] font-medium text-slate-500">{view.practiceName}</p>
          <h1 className="mt-1 text-lg font-semibold text-slate-900">{view.instrument.name}</h1>

          {!reviewing ? (
            <>
              <div className="mt-4">
                <p className="text-[13px] font-medium text-slate-600">{PATIENT_COPY.progress(index + 1, total)}</p>
                <div
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={total}
                  aria-valuenow={answeredCount}
                  aria-label={PATIENT_COPY.progress(index + 1, total)}
                  className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100"
                >
                  <div className="h-full rounded-full bg-blue-600 transition-[width] motion-reduce:transition-none" style={{ width: `${pct}%` }} />
                </div>
              </div>

              <fieldset className="mt-5">
                <legend className="text-base font-medium text-slate-900">{question.text}</legend>
                {question.note ? <p className="mt-1 text-[13px] text-slate-500">{question.note}</p> : null}
                <div className="mt-3 space-y-2">
                  {question.options.map((o) => {
                    const selected = answers[question.id] === o.score;
                    return (
                      <label
                        key={`${question.id}-${o.score}`}
                        className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-4 py-2.5 text-sm ${
                          selected ? 'border-blue-600 bg-blue-50 text-slate-900' : 'border-slate-300 bg-white text-slate-800 hover:bg-slate-50'
                        }`}
                      >
                        <input
                          type="radio"
                          name={question.id}
                          checked={selected}
                          onChange={() => setAnswers((a) => ({ ...a, [question.id]: o.score }))}
                          className="h-4 w-4 accent-[#5C2D91]"
                        />
                        {o.label}
                      </label>
                    );
                  })}
                </div>
              </fieldset>

              {error ? (
                <p role="alert" className="mt-3 text-sm text-rose-700">
                  {error}
                </p>
              ) : null}

              <div className="mt-5 flex items-center justify-between gap-2">
                <Button variant="secondary" disabled={index === 0 || busy} onClick={() => setIndex(index - 1)}>
                  {PATIENT_COPY.back}
                </Button>
                <Button loading={busy} disabled={!(question.id in answers)} onClick={onNext}>
                  {PATIENT_COPY.next}
                </Button>
              </div>
            </>
          ) : (
            <>
              <h2 className="mt-4 text-base font-semibold text-slate-900">{PATIENT_COPY.reviewTitle}</h2>
              <p className="mt-1 text-sm text-slate-600">{PATIENT_COPY.reviewHelp}</p>
              <ol className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-200">
                {view.instrument.questions.map((q, i) => (
                  <li key={q.id} className="flex items-start justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="text-sm text-slate-800">{q.text}</p>
                      <p className="mt-0.5 text-[13px] font-semibold text-slate-900">
                        {q.options.find((o) => o.score === answers[q.id])?.label ?? '—'}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="shrink-0 text-[13px] font-semibold text-blue-600 hover:underline"
                      onClick={() => {
                        setIndex(i);
                        setReviewing(false);
                      }}
                    >
                      {PATIENT_COPY.edit}
                    </button>
                  </li>
                ))}
              </ol>
              {error ? (
                <p role="alert" className="mt-3 text-sm text-rose-700">
                  {error}
                </p>
              ) : null}
              <div className="mt-5 flex justify-end">
                <Button loading={busy} disabled={answeredCount < total} onClick={onSubmit}>
                  {PATIENT_COPY.submit}
                </Button>
              </div>
            </>
          )}
        </CardBody>
      </Card>
    </>
  );
}
