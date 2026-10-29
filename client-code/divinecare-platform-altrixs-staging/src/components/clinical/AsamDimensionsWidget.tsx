'use client';

const DIMENSIONS = [
  { id: 'dim1', label: 'Dimension 1 — Acute Intoxication / Withdrawal' },
  { id: 'dim2', label: 'Dimension 2 — Biomedical Conditions' },
  { id: 'dim3', label: 'Dimension 3 — Emotional / Behavioral / Cognitive' },
  { id: 'dim4', label: 'Dimension 4 — Readiness to Change' },
  { id: 'dim5', label: 'Dimension 5 — Relapse / Continued Use Potential' },
  { id: 'dim6', label: 'Dimension 6 — Recovery Environment' },
] as const;

export type AsamScores = Record<(typeof DIMENSIONS)[number]['id'], number>;

export function emptyAsam(): AsamScores {
  return { dim1: 0, dim2: 0, dim3: 0, dim4: 0, dim5: 0, dim6: 0 };
}

type Props = {
  value: AsamScores;
  onChange: (next: AsamScores) => void;
};

export function AsamDimensionsWidget({ value, onChange }: Props) {
  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
      <div>
        <h3 className="text-sm font-bold text-slate-900">ASAM Dimensions (0–4)</h3>
        <p className="text-xs text-slate-500">
          Rate each dimension; higher scores indicate greater severity / need
        </p>
      </div>
      <div className="space-y-3">
        {DIMENSIONS.map((d) => (
          <div key={d.id} className="rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2.5">
            <p className="mb-2 text-sm font-semibold text-slate-800">{d.label}</p>
            <div className="flex flex-wrap gap-2">
              {[0, 1, 2, 3, 4].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => onChange({ ...value, [d.id]: n })}
                  className={`h-9 w-9 rounded-lg text-sm font-bold transition ${
                    value[d.id] === n
                      ? 'text-white shadow-sm'
                      : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-100'
                  }`}
                  style={
                    value[d.id] === n
                      ? { background: 'linear-gradient(135deg, #5C2D91, #7C3AED)' }
                      : undefined
                  }
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
