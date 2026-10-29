'use client';

/**
 * MA rooming panel for one primary care appointment (GET / PUT /api/medical/rooming/[id]).
 * Identity (two identifiers), chief complaint, vitals with flags ("Notify provider" only) and the
 * BP recheck, allergy / medication / pharmacy review, screenings due, care gaps (patient-reported
 * only), point-of-care tests from the practice standing-order list, then "Ready for provider".
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, BellRing, CheckCircle2, ClipboardCheck, HeartPulse, Loader2, Pill, Plus, ShieldCheck, Trash2, X } from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import { useAuth } from '@/features/auth';
import { canAccessPath } from '@/lib/auth/roleAccess';
import {
  allowedGapActions,
  bmiFromImperial,
  bpRecheckState,
  phq2Positive,
  phqTotal,
  ROOMING_SAFETY_PROMPT,
  screeningSafetyFlags,
  vitalFlags,
  type CareGap,
  type PocStandingOrder,
  type RoomingVitals,
  type ScreeningDue,
  type VitalFlag,
} from '@/lib/medical/primaryCareWorkflow';
import { CareGapActionForm } from './CareGapActionForm';
import { buttonClasses } from '@/components/ui';
import { ChartHistoryCard } from '@/components/ai/ChartHistoryCard';
import { canSeeMedicalHistoryTab } from '@/lib/ai/chartDigest/panelOrder';

type Screen = { items: number[]; total?: number | null; recordId?: string | null; positive?: boolean };
type Checks = {
  allergies?: { status: 'no_changes' | 'updated' } | null;
  meds?: { reviewed: boolean; reported: { name: string; dose?: string | null; frequency?: string | null; note?: string | null }[] } | null;
  pharmacy?: { status: 'confirmed' | 'changed' | 'none'; name?: string | null } | null;
  screenings?: {
    phq2?: Screen | null;
    phq9?: Screen | null;
    gad7?: Screen | null;
    auditC?: Screen | null;
    tobacco?: { status: string } | null;
    falls?: { fell: boolean; unsteady: boolean; worried: boolean } | null;
    declined?: string[];
  } | null;
  poc?: { key: string; result: string }[];
};

type RoomingResponse = {
  appointment: { id: string; clientId: string; time: string; type: string; status: string; isVirtual: boolean; clinician: string | null };
  patient: { name: string; dob: string | null; mrn: string | null; ageYears: number | null; sex: 'F' | 'M' | null };
  rooming: {
    status: string;
    identityConfirmed: boolean;
    identifiers: string[];
    chiefComplaint: string | null;
    vitals: RoomingVitals | null;
    checks: Checks | null;
    vitalsWritten: number;
    roomedByName: string | null;
    roomedAt: string | null;
  } | null;
  allergies: { id: string; allergen: string; reaction: string | null; severity: string }[];
  medications: { id: string; medicationName: string; dosage: string; frequency: string | null }[];
  pharmacyOnFile: { name: string; from: string } | null;
  screenings: ScreeningDue[];
  careGaps: CareGap[];
  standingOrders: PocStandingOrder[];
  canEdit: boolean;
};

const IDENTIFIERS: { id: string; label: string }[] = [
  { id: 'name', label: 'Full name' },
  { id: 'dob', label: 'Date of birth' },
  { id: 'phone', label: 'Phone' },
  { id: 'address', label: 'Address' },
  { id: 'photo_id', label: 'Photo ID' },
];
const VITAL_FIELDS: { key: keyof RoomingVitals; label: string; unit: string; step?: string }[] = [
  { key: 'systolic', label: 'BP systolic', unit: 'mmHg' },
  { key: 'diastolic', label: 'BP diastolic', unit: 'mmHg' },
  { key: 'heartRate', label: 'Heart rate', unit: '/min' },
  { key: 'respRate', label: 'Resp. rate', unit: '/min' },
  { key: 'temperatureF', label: 'Temp', unit: '°F', step: '0.1' },
  { key: 'spO2', label: 'SpO2', unit: '%' },
  { key: 'heightIn', label: 'Height', unit: 'in', step: '0.1' },
  { key: 'weightLbs', label: 'Weight', unit: 'lb', step: '0.1' },
  { key: 'pain', label: 'Pain', unit: '0–10' },
];
const PHQ_ITEMS = [
  'Little interest or pleasure in doing things',
  'Feeling down, depressed, or hopeless',
  'Trouble falling or staying asleep, or sleeping too much',
  'Feeling tired or having little energy',
  'Poor appetite or overeating',
  'Feeling bad about yourself, or that you are a failure',
  'Trouble concentrating on things',
  'Moving or speaking slowly, or being fidgety / restless',
  'Thoughts that you would be better off dead or of hurting yourself',
];
const GAD_ITEMS = [
  'Feeling nervous, anxious, or on edge',
  'Not being able to stop or control worrying',
  'Worrying too much about different things',
  'Trouble relaxing',
  'Being so restless that it is hard to sit still',
  'Becoming easily annoyed or irritable',
  'Feeling afraid, as if something awful might happen',
];
const FREQ = ['Not at all', 'Several days', 'More than half the days', 'Nearly every day'];
const AUDIT_C = [
  { q: 'How often do you have a drink containing alcohol?', o: ['Never', 'Monthly or less', '2–4 times a month', '2–3 times a week', '4+ times a week'] },
  { q: 'How many drinks on a typical day when drinking?', o: ['1 or 2', '3 or 4', '5 or 6', '7 to 9', '10 or more'] },
  { q: 'How often 6 or more drinks on one occasion?', o: ['Never', 'Less than monthly', 'Monthly', 'Weekly', 'Daily or almost daily'] },
];

const n = (v: string): number | null => (v.trim() === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const cls = {
  input: 'w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-blue-600 disabled:bg-slate-100',
  section: 'rounded-xl border border-slate-200 bg-white p-4',
  h: 'flex items-center gap-2 text-sm font-semibold text-slate-900',
};

function ItemSelects({ items, labels, options, value, onChange, disabled }: { items: number; labels: string[]; options: string[]; value: number[]; onChange: (v: number[]) => void; disabled?: boolean }) {
  return (
    <ol className="mt-2 space-y-1.5">
      {Array.from({ length: items }).map((_, i) => (
        <li key={i} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-xs text-slate-700">
            {i + 1}. {labels[i]}
          </span>
          <select
            aria-label={labels[i]}
            disabled={disabled}
            value={value[i] ?? ''}
            onChange={(e) => {
              const next = [...value];
              next[i] = Number(e.target.value);
              onChange(next);
            }}
            className="rounded-lg border border-slate-200 px-2 py-1 text-xs disabled:bg-slate-100"
          >
            <option value="">Select</option>
            {options.map((o, s) => (
              <option key={o} value={s}>
                {s} · {o}
              </option>
            ))}
          </select>
        </li>
      ))}
    </ol>
  );
}

/** Positive safety screen: immediate prompt to the MA (fixed text only, minimum necessary) */
function SafetyPrompt({ alertSent }: { alertSent?: boolean }) {
  return (
    <div role="alert" data-testid="rooming-safety-prompt" className="mt-2 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-900">
      <p className="flex items-start gap-2">
        <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden /> {ROOMING_SAFETY_PROMPT}
      </p>
      {alertSent ? <p className="mt-1 pl-6 text-xs font-normal">A high-priority alert was sent to the provider.</p> : null}
    </div>
  );
}

function Flags({ flags }: { flags: VitalFlag[] }) {
  if (!flags.length) return null;
  return (
    <ul className="mt-3 space-y-1" role="alert">
      {flags.map((f) => (
        <li key={f.key} className="flex flex-wrap items-center gap-2 rounded-lg bg-rose-50 px-3 py-1.5 text-xs text-rose-800">
          <BellRing size={13} aria-hidden /> <strong>{f.label}</strong> <span>({f.value})</span> <span className="font-semibold">· {f.action}</span>
        </li>
      ))}
    </ul>
  );
}

export function RoomingPanel({ appointmentId, onClose, onSaved }: { appointmentId: string; onClose: () => void; onSaved?: () => void }) {
  const { user } = useAuth();
  const role = String(user?.role || '');
  const [data, setData] = useState<RoomingResponse | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [notice, setNotice] = useState('');
  const [alertSent, setAlertSent] = useState(false);
  const [now, setNow] = useState(() => new Date());

  const [identifiers, setIdentifiers] = useState<string[]>([]);
  const [cc, setCc] = useState('');
  const [vitals, setVitals] = useState<Record<string, string>>({});
  const [takenAt, setTakenAt] = useState<string | null>(null);
  const [recheck, setRecheck] = useState<{ s: string; d: string }>({ s: '', d: '' });
  const [recheckSaved, setRecheckSaved] = useState(false);
  const [checks, setChecks] = useState<Checks>({});
  const [showGad, setShowGad] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const d = await apiJson<RoomingResponse & { success: boolean }>(`/api/medical/rooming/${encodeURIComponent(appointmentId)}`, { cache: 'no-store' });
      setData(d);
      const r = d.rooming;
      setIdentifiers(r?.identifiers ?? []);
      setCc(r?.chiefComplaint ?? '');
      const v = r?.vitals ?? null;
      setVitals(Object.fromEntries(VITAL_FIELDS.map((f) => [f.key, v?.[f.key] != null ? String(v[f.key]) : ''])));
      setTakenAt(v?.takenAt ?? null);
      setRecheck({ s: v?.recheck?.systolic != null ? String(v.recheck.systolic) : '', d: v?.recheck?.diastolic != null ? String(v.recheck.diastolic) : '' });
      setRecheckSaved(Boolean(v?.recheck));
      setChecks((r?.checks as Checks) ?? {});
      setShowGad(Boolean((r?.checks as Checks | null)?.screenings?.gad7));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load rooming');
    }
  }, [appointmentId]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);

  const filed = (data?.rooming?.vitalsWritten ?? 0) > 0;
  const canEdit = Boolean(data?.canEdit);
  const currentVitals: RoomingVitals = useMemo(() => {
    const v: RoomingVitals = {};
    for (const f of VITAL_FIELDS) (v as Record<string, unknown>)[f.key] = n(vitals[f.key] ?? '');
    v.takenAt = takenAt;
    const rs = n(recheck.s);
    const rd = n(recheck.d);
    v.recheck = rs != null && rd != null ? { systolic: rs, diastolic: rd, takenAt: data?.rooming?.vitals?.recheck?.takenAt ?? null } : null;
    return v;
  }, [vitals, takenAt, recheck, data]);
  const bmi = bmiFromImperial(currentVitals.weightLbs, currentVitals.heightIn);
  const safetyFlags = screeningSafetyFlags(checks.screenings ?? null);
  const flags = [...vitalFlags(currentVitals), ...safetyFlags];
  // Recheck timing counts from the saved first reading (or from now when it has not been saved yet)
  const rc = bpRecheckState({ ...currentVitals, recheck: recheckSaved ? currentVitals.recheck : null, takenAt: takenAt ?? now.toISOString() }, now);

  const scr = checks.screenings ?? {};
  const setScr = (patch: Partial<NonNullable<Checks['screenings']>>) => setChecks((c) => ({ ...c, screenings: { ...(c.screenings ?? {}), ...patch } }));
  const phq2Items = scr.phq2?.items ?? [];
  const phq2Score = phqTotal(phq2Items, 2);
  const phq9Needed = phq2Positive(phq2Score);
  const declined = new Set(scr.declined ?? []);
  const toggleDecline = (k: string) => setScr({ declined: declined.has(k) ? [...declined].filter((x) => x !== k) : [...declined, k] });
  const due = (key: string) => data?.screenings.find((s) => s.key === key);

  const payload = (action: 'save' | 'ready') => {
    const s = checks.screenings;
    const complete = (x: Screen | null | undefined, len: number) => (x && x.items.length === len && x.items.every((i) => Number.isInteger(i)) ? { items: x.items } : null);
    return {
      action,
      identityConfirmed: new Set(identifiers).size >= 2,
      identifiers,
      chiefComplaint: cc.trim() || null,
      vitals: Object.values(currentVitals).some((x) => x != null) ? { ...currentVitals, recheck: currentVitals.recheck ? { systolic: currentVitals.recheck.systolic, diastolic: currentVitals.recheck.diastolic, takenAt: currentVitals.recheck.takenAt ?? null } : null } : null,
      checks: {
        allergies: checks.allergies ?? null,
        meds: checks.meds ? { reviewed: checks.meds.reviewed, reported: checks.meds.reported.filter((m) => m.name.trim()) } : null,
        pharmacy: checks.pharmacy ?? null,
        screenings: s
          ? {
              phq2: complete(s.phq2, 2),
              phq9: complete(s.phq9, 9),
              gad7: complete(s.gad7, 7),
              auditC: s.auditC && s.auditC.items.length === 3 && s.auditC.items.every((i) => Number.isInteger(i)) ? { items: s.auditC.items } : null,
              tobacco: s.tobacco ?? null,
              falls: s.falls ?? null,
              declined: s.declined ?? [],
            }
          : null,
        poc: (checks.poc ?? []).filter((p) => p.result.trim()),
      },
    };
  };

  const save = async (action: 'save' | 'ready') => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const res = await apiJson<{ warnings: string[]; status: string; safety?: { prompt: string; alertSent: boolean } | null }>(`/api/medical/rooming/${encodeURIComponent(appointmentId)}`, { method: 'PUT', body: JSON.stringify(payload(action)) });
      setWarnings(res.warnings ?? []);
      if (res.safety?.alertSent) setAlertSent(true);
      setNotice(action === 'ready' ? 'Ready for provider. Vitals and screenings are filed to the chart.' : 'Saved.');
      await load();
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  const gapActions = allowedGapActions(role).filter((a) => a === 'reported_elsewhere');
  const sdohHref = data ? `/dashboard/sdoh?clientId=${encodeURIComponent(data.appointment.clientId)}` : '';

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40" role="dialog" aria-modal="true" aria-label="Room patient">
      <div className="flex h-full w-full max-w-3xl flex-col bg-slate-50 shadow-xs">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 bg-white px-5 py-4">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
              <ClipboardCheck size={18} className="text-blue-600" /> Room patient
            </h2>
            {data ? (
              <p className="text-xs text-slate-500">
                {data.patient.name} · {data.appointment.time} · {data.appointment.type}
                {data.appointment.clinician ? ` · ${data.appointment.clinician}` : ''}
                {data.rooming?.status === 'ready' ? ' · Ready for provider' : data.rooming?.status === 'in_room' ? ' · With provider' : ''}
              </p>
            ) : null}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {!data && !error ? (
            <p className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 size={14} className="animate-spin" /> Loading…
            </p>
          ) : null}
          {error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-800">{error}</p> : null}
          {data ? (
            <>
              {/* Identity */}
              <section className={cls.section}>
                <h3 className={cls.h}>
                  <ShieldCheck size={15} className="text-blue-600" /> Identity (two identifiers)
                </h3>
                <p className="mt-1 text-xs text-slate-500">
                  On file: {data.patient.name}
                  {data.patient.dob ? ` · DOB ${data.patient.dob}` : ' · DOB not on file'}
                  {data.patient.mrn ? ` · MRN ${data.patient.mrn}` : ''}. Ask the patient to state them; do not read them out.
                </p>
                <div className="mt-2 flex flex-wrap gap-3">
                  {IDENTIFIERS.map((i) => (
                    <label key={i.id} className="flex items-center gap-1.5 text-xs text-slate-700">
                      <input
                        type="checkbox"
                        disabled={!canEdit}
                        checked={identifiers.includes(i.id)}
                        onChange={(e) => setIdentifiers((cur) => (e.target.checked ? [...cur, i.id] : cur.filter((x) => x !== i.id)))}
                      />
                      {i.label} confirmed
                    </label>
                  ))}
                </div>
                {new Set(identifiers).size >= 2 ? (
                  <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-emerald-700">
                    <CheckCircle2 size={12} /> Identity confirmed
                  </p>
                ) : null}
              </section>

              {/* Chief complaint */}
              <section className={cls.section}>
                <label className={cls.h} htmlFor="rooming-cc">
                  Chief complaint / reason for visit
                </label>
                <textarea id="rooming-cc" disabled={!canEdit} value={cc} onChange={(e) => setCc(e.target.value)} rows={2} maxLength={500} className={`${cls.input} mt-2`} placeholder="In the patient's words" />
              </section>

              {/* Vitals */}
              <section className={cls.section}>
                <h3 className={cls.h}>
                  <HeartPulse size={15} className="text-blue-600" /> Vitals
                  {filed ? <span className="text-[11px] font-normal text-slate-500">(filed to the flowsheet)</span> : null}
                </h3>
                {data.appointment.isVirtual ? <p className="mt-1 text-xs text-slate-500">Telehealth visit: record only what the patient measured and reports.</p> : null}
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {VITAL_FIELDS.map((f) => (
                    <label key={f.key} className="text-[11px] font-semibold text-slate-600">
                      {f.label} <span className="font-normal text-slate-500">({f.unit})</span>
                      <input
                        type="number"
                        inputMode="decimal"
                        step={f.step ?? '1'}
                        disabled={!canEdit || filed}
                        value={vitals[f.key] ?? ''}
                        onChange={(e) => {
                          setVitals((cur) => ({ ...cur, [f.key]: e.target.value }));
                          if (!takenAt) setTakenAt(new Date().toISOString());
                        }}
                        className={cls.input}
                      />
                    </label>
                  ))}
                  <div className="text-[11px] font-semibold text-slate-600">
                    BMI
                    <p className="mt-1 rounded-lg bg-slate-100 px-2 py-1.5 text-sm text-slate-800">{bmi ?? '—'}</p>
                  </div>
                </div>
                {rc.state !== 'not_needed' ? (
                  <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                    <p className="font-semibold">
                      BP 140/90 or higher:{' '}
                      {rc.state === 'wait'
                        ? `recheck in ${Math.ceil(rc.secondsLeft / 60)} min (patient seated, at rest)`
                        : rc.state === 'due'
                          ? 'recheck now and record it'
                          : rc.stillElevated
                            ? 'recheck recorded, still elevated'
                            : 'recheck recorded'}
                    </p>
                    <div className="mt-2 flex flex-wrap items-end gap-2">
                      <label className="text-[11px]">
                        Recheck systolic
                        <input type="number" disabled={!canEdit || recheckSaved} value={recheck.s} onChange={(e) => setRecheck((r) => ({ ...r, s: e.target.value }))} className={`${cls.input} w-24`} />
                      </label>
                      <label className="text-[11px]">
                        Recheck diastolic
                        <input type="number" disabled={!canEdit || recheckSaved} value={recheck.d} onChange={(e) => setRecheck((r) => ({ ...r, d: e.target.value }))} className={`${cls.input} w-24`} />
                      </label>
                    </div>
                  </div>
                ) : null}
                <Flags flags={flags} />
              </section>

              {/* AI medical history (minimum necessary for the MA: allergies, medications, vitals, preventive due) */}
              {canSeeMedicalHistoryTab(role) ? <ChartHistoryCard kind="medical" clientId={data.appointment.clientId} role={role} /> : null}

              {/* Allergies */}
              <section className={cls.section}>
                <h3 className={cls.h}>Allergies</h3>
                {data.allergies.length ? (
                  <ul className="mt-1 flex flex-wrap gap-1.5">
                    {data.allergies.map((a) => (
                      <li key={a.id} className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-800">
                        {a.allergen}
                        {a.reaction ? ` (${a.reaction})` : ''}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-xs text-slate-500">No allergies on file (ask; record any in the chart).</p>
                )}
                <div className="mt-2 flex flex-wrap gap-4 text-xs">
                  {(['no_changes', 'updated'] as const).map((s) => (
                    <label key={s} className="flex items-center gap-1.5">
                      <input type="radio" name="allergies" disabled={!canEdit} checked={checks.allergies?.status === s} onChange={() => setChecks((c) => ({ ...c, allergies: { status: s } }))} />
                      {s === 'no_changes' ? 'Reviewed with patient, no changes' : 'Reviewed and updated in the chart'}
                    </label>
                  ))}
                  <Link href={`/dashboard/medical/history?patient=${encodeURIComponent(data.appointment.clientId)}`} className="font-semibold text-blue-600 hover:underline">
                    Open allergies
                  </Link>
                </div>
              </section>

              {/* Medications */}
              <section className={cls.section}>
                <h3 className={cls.h}>
                  <Pill size={15} className="text-blue-600" /> Medications
                </h3>
                {data.medications.length ? (
                  <ul className="mt-1 space-y-0.5 text-xs text-slate-700">
                    {data.medications.map((m) => (
                      <li key={m.id}>
                        {m.medicationName} {m.dosage}
                        {m.frequency ? `, ${m.frequency}` : ''}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-xs text-slate-500">No active medications on file.</p>
                )}
                <label className="mt-2 flex items-center gap-1.5 text-xs">
                  <input
                    type="checkbox"
                    disabled={!canEdit}
                    checked={Boolean(checks.meds?.reviewed)}
                    onChange={(e) => setChecks((c) => ({ ...c, meds: { reviewed: e.target.checked, reported: c.meds?.reported ?? [] } }))}
                  />
                  Reviewed the list with the patient
                </label>
                <p className="mt-2 text-[11px] font-semibold text-slate-600">Outside medications the patient reports (the provider reconciles)</p>
                {(checks.meds?.reported ?? []).map((m, i) => (
                  <div key={i} className="mt-1 flex flex-wrap items-center gap-2">
                    {(['name', 'dose', 'frequency'] as const).map((k) => (
                      <input
                        key={k}
                        aria-label={`Reported medication ${k}`}
                        placeholder={k === 'name' ? 'Medication' : k === 'dose' ? 'Dose' : 'How often'}
                        disabled={!canEdit}
                        value={m[k] ?? ''}
                        onChange={(e) =>
                          setChecks((c) => {
                            const reported = [...(c.meds?.reported ?? [])];
                            reported[i] = { ...reported[i], [k]: e.target.value };
                            return { ...c, meds: { reviewed: c.meds?.reviewed ?? false, reported } };
                          })
                        }
                        className={`${cls.input} ${k === 'name' ? 'w-44' : 'w-28'}`}
                      />
                    ))}
                    <button
                      type="button"
                      aria-label="Remove reported medication"
                      disabled={!canEdit}
                      onClick={() => setChecks((c) => ({ ...c, meds: { reviewed: c.meds?.reviewed ?? false, reported: (c.meds?.reported ?? []).filter((_, j) => j !== i) } }))}
                      className="rounded p-1 text-slate-500 hover:text-rose-600"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
                {canEdit ? (
                  <button
                    type="button"
                    onClick={() => setChecks((c) => ({ ...c, meds: { reviewed: c.meds?.reviewed ?? false, reported: [...(c.meds?.reported ?? []), { name: '' }] } }))}
                    className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-blue-600"
                  >
                    <Plus size={12} /> Add reported medication
                  </button>
                ) : null}
              </section>

              {/* Pharmacy */}
              <section className={cls.section}>
                <h3 className={cls.h}>Preferred pharmacy</h3>
                <p className="mt-1 text-xs text-slate-500">{data.pharmacyOnFile ? `${data.pharmacyOnFile.name} (${data.pharmacyOnFile.from})` : 'No pharmacy on file.'}</p>
                <div className="mt-2 flex flex-wrap items-center gap-4 text-xs">
                  {(['confirmed', 'changed', 'none'] as const).map((s) => (
                    <label key={s} className="flex items-center gap-1.5">
                      <input type="radio" name="pharmacy" disabled={!canEdit} checked={checks.pharmacy?.status === s} onChange={() => setChecks((c) => ({ ...c, pharmacy: { status: s, name: c.pharmacy?.name ?? null } }))} />
                      {s === 'confirmed' ? 'Confirmed' : s === 'changed' ? 'Patient wants a different pharmacy' : 'Patient has no pharmacy'}
                    </label>
                  ))}
                  {checks.pharmacy?.status === 'changed' ? (
                    <input
                      aria-label="New pharmacy"
                      placeholder="Pharmacy name and location"
                      disabled={!canEdit}
                      value={checks.pharmacy.name ?? ''}
                      onChange={(e) => setChecks((c) => ({ ...c, pharmacy: { status: 'changed', name: e.target.value } }))}
                      className={`${cls.input} w-64`}
                    />
                  ) : null}
                </div>
                {checks.pharmacy?.status === 'changed' ? <p className="mt-1 text-[11px] text-slate-500">Update it in DrFirst before the provider prescribes.</p> : null}
              </section>

              {/* Screenings */}
              <section className={cls.section}>
                <h3 className={cls.h}>Screenings due</h3>
                <p className="mt-1 text-[11px] text-slate-500">By age and the last date on file (primary care screenings). Results go to the provider; no interpretation here.</p>
                {data.screenings.filter((s) => s.due).length === 0 ? <p className="mt-2 text-xs text-slate-500">No screening due today.</p> : null}
                <div className="mt-2 space-y-3">
                  {due('depression')?.due ? (
                    <div className="rounded-lg border border-slate-100 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-slate-800">Depression: PHQ-2{phq9Needed ? ' → PHQ-9' : ''}</p>
                        <label className="flex items-center gap-1 text-[11px] text-slate-500">
                          <input type="checkbox" disabled={!canEdit} checked={declined.has('depression')} onChange={() => toggleDecline('depression')} /> Patient declined
                        </label>
                      </div>
                      <p className="text-[11px] text-slate-500">{due('depression')!.reason}</p>
                      <ItemSelects items={2} labels={PHQ_ITEMS} options={FREQ} value={phq2Items} disabled={!canEdit || Boolean(scr.phq2?.recordId)} onChange={(items) => setScr({ phq2: { items } })} />
                      {phq2Score != null ? <p className="mt-1 text-xs font-semibold text-slate-700">PHQ-2 total {phq2Score}{phq9Needed ? ': positive, give the PHQ-9' : ''}</p> : null}
                      {phq9Needed ? (
                        <>
                          <ItemSelects
                            items={9}
                            labels={PHQ_ITEMS}
                            options={FREQ}
                            value={scr.phq9?.items ?? [phq2Items[0], phq2Items[1]]}
                            disabled={!canEdit || Boolean(scr.phq9?.recordId)}
                            onChange={(items) => setScr({ phq9: { items } })}
                          />
                          {phqTotal(scr.phq9?.items ?? [], 9) != null ? <p className="mt-1 text-xs font-semibold text-slate-700">PHQ-9 total {phqTotal(scr.phq9?.items ?? [], 9)}</p> : null}
                          {safetyFlags.length ? <SafetyPrompt alertSent={alertSent} /> : null}
                          <label className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-600">
                            <input type="checkbox" disabled={!canEdit || Boolean(scr.gad7?.recordId)} checked={showGad} onChange={(e) => setShowGad(e.target.checked)} /> Also give the GAD-7
                          </label>
                          {showGad ? (
                            <ItemSelects items={7} labels={GAD_ITEMS} options={FREQ} value={scr.gad7?.items ?? []} disabled={!canEdit || Boolean(scr.gad7?.recordId)} onChange={(items) => setScr({ gad7: { items } })} />
                          ) : null}
                        </>
                      ) : null}
                    </div>
                  ) : null}
                  {due('tobacco')?.due ? (
                    <div className="rounded-lg border border-slate-100 p-3">
                      <p className="text-xs font-semibold text-slate-800">Tobacco use</p>
                      <select
                        aria-label="Tobacco use status"
                        disabled={!canEdit}
                        value={scr.tobacco?.status ?? ''}
                        onChange={(e) => setScr({ tobacco: e.target.value ? { status: e.target.value } : null })}
                        className="mt-1 rounded-lg border border-slate-200 px-2 py-1 text-xs"
                      >
                        <option value="">Select</option>
                        <option value="never">Never</option>
                        <option value="former">Former</option>
                        <option value="current_every_day">Current, every day</option>
                        <option value="current_some_days">Current, some days</option>
                        <option value="declined">Declined to answer</option>
                      </select>
                    </div>
                  ) : null}
                  {due('alcohol')?.due ? (
                    <div className="rounded-lg border border-slate-100 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-slate-800">Alcohol: AUDIT-C</p>
                        <label className="flex items-center gap-1 text-[11px] text-slate-500">
                          <input type="checkbox" disabled={!canEdit} checked={declined.has('alcohol')} onChange={() => toggleDecline('alcohol')} /> Patient declined
                        </label>
                      </div>
                      <ol className="mt-1 space-y-1.5">
                        {AUDIT_C.map((q, i) => (
                          <li key={q.q} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                            <span className="text-xs text-slate-700">
                              {i + 1}. {q.q}
                            </span>
                            <select
                              aria-label={q.q}
                              disabled={!canEdit || Boolean(scr.auditC?.recordId)}
                              value={scr.auditC?.items?.[i] ?? ''}
                              onChange={(e) => {
                                const items = [...(scr.auditC?.items ?? [])];
                                items[i] = Number(e.target.value);
                                setScr({ auditC: { items } });
                              }}
                              className="rounded-lg border border-slate-200 px-2 py-1 text-xs"
                            >
                              <option value="">Select</option>
                              {q.o.map((o, s) => (
                                <option key={o} value={s}>
                                  {s} · {o}
                                </option>
                              ))}
                            </select>
                          </li>
                        ))}
                      </ol>
                    </div>
                  ) : null}
                  {due('falls')?.due ? (
                    <div className="rounded-lg border border-slate-100 p-3">
                      <p className="text-xs font-semibold text-slate-800">Falls (STEADI)</p>
                      {(
                        [
                          ['fell', 'Fallen in the past year?'],
                          ['unsteady', 'Feels unsteady when standing or walking?'],
                          ['worried', 'Worries about falling?'],
                        ] as const
                      ).map(([k, label]) => (
                        <label key={k} className="mt-1 flex items-center gap-1.5 text-xs text-slate-700">
                          <input
                            type="checkbox"
                            disabled={!canEdit}
                            checked={Boolean(scr.falls?.[k])}
                            onChange={(e) => setScr({ falls: { fell: false, unsteady: false, worried: false, ...(scr.falls ?? {}), [k]: e.target.checked } })}
                          />
                          {label} (checked = yes)
                        </label>
                      ))}
                    </div>
                  ) : null}
                  {due('sdoh')?.due ? (
                    <div className="rounded-lg border border-slate-100 p-3 text-xs">
                      <p className="font-semibold text-slate-800">Social needs (SDOH)</p>
                      <p className="text-slate-500">{due('sdoh')!.reason}</p>
                      {canAccessPath(role, '/dashboard/sdoh') ? (
                        <Link href={sdohHref} className="font-semibold text-blue-600 hover:underline">
                          Open SDOH screen
                        </Link>
                      ) : (
                        <p className="text-slate-500">Front desk or the provider completes the SDOH screen.</p>
                      )}
                    </div>
                  ) : null}
                </div>
              </section>

              {/* Care gaps */}
              <section className={cls.section}>
                <h3 className={cls.h}>Care gaps (screening guidance)</h3>
                {data.careGaps.length === 0 ? (
                  <p className="mt-1 text-xs text-slate-500">No care gap due.</p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {data.careGaps.map((g) => (
                      <li key={g.key} className="rounded-lg border border-slate-100 p-2.5">
                        <p className="text-xs font-semibold text-slate-800">
                          {g.label} <span className={`ml-1 rounded-full px-1.5 py-0.5 text-[11px] ${g.status === 'overdue' ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-900'}`}>{g.status}</span>
                        </p>
                        <p className="text-[11px] text-slate-500">
                          {g.reason} · {g.basis}
                        </p>
                        {g.patientReported ? (
                          <p className="text-[11px] text-sky-800">
                            Patient reports done {g.patientReported.date ?? '(date unknown)'} at {g.patientReported.source}; waiting for provider verification.
                          </p>
                        ) : null}
                        {canEdit ? <CareGapActionForm clientId={data.appointment.clientId} appointmentId={appointmentId} gapKey={g.key} actions={gapActions} onSaved={() => void load()} /> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* POC tests */}
              <section className={cls.section}>
                <h3 className={cls.h}>Point-of-care tests (standing orders)</h3>
                {data.standingOrders.length === 0 ? (
                  <p className="mt-1 text-xs text-slate-500">No standing orders configured. The practice must add signed point-of-care standing orders in primary care settings before the MA performs tests without a provider order.</p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {data.standingOrders.map((o) => {
                      const cur = (checks.poc ?? []).find((p) => p.key === o.key);
                      return (
                        <li key={o.key} className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="w-full font-semibold text-slate-800 sm:w-48">{o.name}</span>
                          <span className="text-[11px] text-slate-500">{o.criteria}</span>
                          {o.resultType === 'pos_neg' ? (
                            <select
                              aria-label={`${o.name} result`}
                              disabled={!canEdit}
                              value={cur?.result ?? ''}
                              onChange={(e) => setChecks((c) => ({ ...c, poc: [...(c.poc ?? []).filter((p) => p.key !== o.key), ...(e.target.value ? [{ key: o.key, result: e.target.value }] : [])] }))}
                              className="rounded-lg border border-slate-200 px-2 py-1"
                            >
                              <option value="">Not done</option>
                              <option value="Positive">Positive</option>
                              <option value="Negative">Negative</option>
                              <option value="Invalid">Invalid / repeat</option>
                            </select>
                          ) : (
                            <input
                              aria-label={`${o.name} result`}
                              disabled={!canEdit}
                              value={cur?.result ?? ''}
                              placeholder={o.unit ? `Result (${o.unit})` : 'Result'}
                              onChange={(e) => setChecks((c) => ({ ...c, poc: [...(c.poc ?? []).filter((p) => p.key !== o.key), ...(e.target.value ? [{ key: o.key, result: e.target.value }] : [])] }))}
                              className={`${cls.input} w-32`}
                            />
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            </>
          ) : null}
        </div>

        {data && canEdit ? (
          <div className="space-y-2 border-t border-slate-200 bg-white px-5 py-3">
            {safetyFlags.length ? <SafetyPrompt alertSent={alertSent} /> : null}
            {warnings.length ? (
              <ul className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                {warnings.map((w) => (
                  <li key={w} className="flex items-center gap-1.5">
                    <AlertTriangle size={12} /> {w}
                  </li>
                ))}
              </ul>
            ) : null}
            {notice ? <p className="text-xs font-semibold text-emerald-700">{notice}</p> : null}
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" disabled={busy} onClick={() => void save('save')} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                Save draft
              </button>
              <button type="button" disabled={busy} onClick={() => void save('ready')} className={buttonClasses()}>
                {busy ? 'Saving…' : data.rooming?.status === 'ready' || data.rooming?.status === 'in_room' ? 'Update' : 'Ready for provider'}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
