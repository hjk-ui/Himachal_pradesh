'use client';

export type Vitals = {
  bpSystolic: string;
  bpDiastolic: string;
  heartRate: string;
  weightLbs: string;
  bmi: string;
  tempF: string;
  o2Sat: string;
};

export function emptyVitals(): Vitals {
  return { bpSystolic: '', bpDiastolic: '', heartRate: '', weightLbs: '', bmi: '', tempF: '', o2Sat: '' };
}

/** Readable one-line summary stored alongside the structured values, e.g. "BP 120/80 mmHg · HR 72 bpm" */
export function formatVitals(v: Vitals) {
  const parts: string[] = [];
  if (v.bpSystolic || v.bpDiastolic) parts.push(`BP ${v.bpSystolic || '?'}/${v.bpDiastolic || '?'} mmHg`);
  if (v.heartRate) parts.push(`HR ${v.heartRate} bpm`);
  if (v.weightLbs) parts.push(`Wt ${v.weightLbs} lbs`);
  if (v.bmi) parts.push(`BMI ${v.bmi}`);
  if (v.tempF) parts.push(`Temp ${v.tempF} °F`);
  if (v.o2Sat) parts.push(`O2 sat ${v.o2Sat}%`);
  return parts.join(' · ');
}

const FIELDS: { key: keyof Vitals; label: string; placeholder: string; unit: string }[] = [
  { key: 'heartRate', label: 'Heart rate', placeholder: '72', unit: 'bpm' },
  { key: 'weightLbs', label: 'Weight', placeholder: '165', unit: 'lbs' },
  { key: 'bmi', label: 'BMI', placeholder: '24.5', unit: '' },
  { key: 'tempF', label: 'Temp', placeholder: '98.6', unit: '°F' },
  { key: 'o2Sat', label: 'O2 sat', placeholder: '98', unit: '%' },
];

const numeric = (s: string) => s.replace(/[^\d.]/g, '').slice(0, 6);

type Props = { value: Vitals; onChange: (next: Vitals) => void };

export function VitalsInput({ value, onChange }: Props) {
  const set = (key: keyof Vitals, raw: string) => onChange({ ...value, [key]: numeric(raw) });
  const box = 'w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-[#5C2D91]';
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <div className="col-span-2 sm:col-span-1">
        <p className="mb-1 text-[11px] font-bold uppercase text-slate-500">Blood pressure</p>
        <div className="flex items-center gap-1">
          <input inputMode="decimal" aria-label="Systolic" placeholder="120" value={value.bpSystolic} onChange={(e) => set('bpSystolic', e.target.value)} className={`${box} text-center`} />
          <span className="font-bold text-slate-400">/</span>
          <input inputMode="decimal" aria-label="Diastolic" placeholder="80" value={value.bpDiastolic} onChange={(e) => set('bpDiastolic', e.target.value)} className={`${box} text-center`} />
        </div>
        <p className="mt-0.5 text-[11px] text-slate-400">mmHg</p>
      </div>
      {FIELDS.map((f) => (
        <div key={f.key}>
          <p className="mb-1 text-[11px] font-bold uppercase text-slate-500">{f.label}</p>
          <input inputMode="decimal" placeholder={f.placeholder} value={value[f.key]} onChange={(e) => set(f.key, e.target.value)} className={box} />
          {f.unit ? <p className="mt-0.5 text-[11px] text-slate-400">{f.unit}</p> : null}
        </div>
      ))}
    </div>
  );
}
