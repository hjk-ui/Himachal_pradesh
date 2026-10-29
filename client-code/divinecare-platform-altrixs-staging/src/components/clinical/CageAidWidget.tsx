'use client';

import { useMemo } from 'react';

const QUESTIONS = [
  { id: 'cut', label: 'C — Have you ever felt you should Cut down on your drinking or drug use?' },
  { id: 'annoyed', label: 'A — Have people Annoyed you by criticizing your drinking or drug use?' },
  { id: 'guilty', label: 'G — Have you ever felt bad or Guilty about your drinking or drug use?' },
  { id: 'eye', label: 'E — Have you ever had a drink or used drugs first thing in the morning (Eye-opener)?' },
] as const;

export type CageAidAnswers = Record<(typeof QUESTIONS)[number]['id'], boolean | null>;

export function emptyCageAid(): CageAidAnswers {
  return { cut: null, annoyed: null, guilty: null, eye: null };
}

export function scoreCageAid(answers: CageAidAnswers): number {
  return QUESTIONS.reduce((n, q) => n + (answers[q.id] === true ? 1 : 0), 0);
}

type Props = {
  value: CageAidAnswers;
  onChange: (next: CageAidAnswers) => void;
};

export function CageAidWidget({ value, onChange }: Props) {
  const score = useMemo(() => scoreCageAid(value), [value]);
  const tone =
    score >= 2 ? 'bg-red-50 text-red-700 border-red-200' : score === 1 ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200';

  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-slate-900">CAGE-AID</h3>
          <p className="text-xs text-slate-500">Score ≥ 2 suggests further SUD assessment</p>
        </div>
        <span className={`rounded-full border px-3 py-1 text-xs font-bold ${tone}`}>
          Score {score} / 4
        </span>
      </div>
      <div className="space-y-2">
        {QUESTIONS.map((q) => (
          <div
            key={q.id}
            className="flex flex-col gap-2 rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
          >
            <p className="text-sm font-medium text-slate-800">{q.label}</p>
            <div className="flex gap-2">
              {([true, false] as const).map((yn) => (
                <button
                  key={String(yn)}
                  type="button"
                  onClick={() => onChange({ ...value, [q.id]: yn })}
                  className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                    value[q.id] === yn
                      ? 'text-white shadow-sm'
                      : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-100'
                  }`}
                  style={
                    value[q.id] === yn
                      ? { background: 'linear-gradient(135deg, #5C2D91, #7C3AED)' }
                      : undefined
                  }
                >
                  {yn ? 'Yes' : 'No'}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
