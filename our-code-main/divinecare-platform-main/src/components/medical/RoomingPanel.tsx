'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiJson } from '@/lib/api-client';
import {
  PHARMACY_CHANGED_COPY,
  type RoomingRecord,
  type VitalFlag,
} from '@/lib/medical/rooming';
import type { CareGapRow } from '@/lib/medical/care-gaps';

type ApprovedPoc = { id: string; name: string; cpt: string };

type Props = {
  appointmentId?: string;
  clientId?: string;
};

const SCREENING_KEYS = [
  { key: 'depression', label: 'Depression (PHQ-2→PHQ-9)' },
  { key: 'tobacco', label: 'Tobacco' },
  { key: 'alcohol', label: 'Alcohol (AUDIT-C)' },
  { key: 'falls', label: 'Falls (STEADI 65+)' },
  { key: 'sdoh', label: 'SDOH' },
] as const;

function numOrNull(v: string): number | null {
  if (v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function RoomingPanel({ appointmentId: appointmentIdProp, clientId: clientIdProp }: Props) {
  const [appointmentId, setAppointmentId] = useState(appointmentIdProp || '');
  const [clientId, setClientId] = useState(clientIdProp || '');
  const [appointmentOptions, setAppointmentOptions] = useState<
    Array<{ id: string; label: string }>
  >([]);
  const [rooming, setRooming] = useState<RoomingRecord | null>(null);
  const [flags, setFlags] = useState<VitalFlag[]>([]);
  const [bmi, setBmi] = useState<number | null>(null);
  const [needsBpRecheck, setNeedsBpRecheck] = useState(false);
  const [chip, setChip] = useState('Rooming in progress');
  const [approvedPoc, setApprovedPoc] = useState<ApprovedPoc[]>([]);
  const [careGaps, setCareGaps] = useState<CareGapRow[]>([]);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (appointmentIdProp) setAppointmentId(appointmentIdProp);
  }, [appointmentIdProp]);
  useEffect(() => {
    if (clientIdProp) setClientId(clientIdProp);
  }, [clientIdProp]);

  /** Resolve today's (or upcoming) appointments for patient when parent only passes clientId */
  useEffect(() => {
    if (!clientId || appointmentIdProp) return;
    let cancelled = false;
    const today = new Date().toISOString().slice(0, 10);
    apiJson<{
      success: boolean;
      appointments?: Array<{ id: string; startsAt?: string; type?: string; status?: string }>;
    }>(`/api/appointments?clientId=${encodeURIComponent(clientId)}&date=${today}`)
      .then((res) => {
        if (cancelled || !res.success) return;
        const opts = (res.appointments || []).map((a) => ({
          id: a.id,
          label: `${a.type || 'Visit'} · ${a.startsAt ? new Date(a.startsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''} · ${a.status || ''}`,
        }));
        setAppointmentOptions(opts);
        if (!appointmentId && opts[0]) setAppointmentId(opts[0].id);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [clientId, appointmentIdProp, appointmentId]);

  const load = useCallback(async () => {
    if (!appointmentId || !clientId) return;
    const res = await apiJson<{
      success: boolean;
      rooming?: RoomingRecord;
      flags?: VitalFlag[];
      bmi?: number | null;
      needsBpRecheck?: boolean;
      scheduleChip?: string;
      approvedPoc?: ApprovedPoc[];
      error?: string;
    }>(`/api/medical/rooming/${encodeURIComponent(appointmentId)}?clientId=${encodeURIComponent(clientId)}`);
    if (!res.success) {
      setMessage(res.error || 'Unable to load rooming');
      return;
    }
    setRooming(res.rooming || null);
    setFlags(res.flags || []);
    setBmi(res.bmi ?? null);
    setNeedsBpRecheck(Boolean(res.needsBpRecheck));
    setChip(res.scheduleChip || 'Rooming in progress');
    setApprovedPoc(res.approvedPoc || []);

    const gapsRes = await apiJson<{ success: boolean; gaps?: CareGapRow[] }>(
      `/api/medical/care-gaps?clientId=${encodeURIComponent(clientId)}`
    );
    if (gapsRes.success) setCareGaps(gapsRes.gaps || []);
  }, [appointmentId, clientId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(transition: 'save' | 'ready') {
    if (!appointmentId || !clientId || !rooming) {
      setMessage('Enter appointment and patient IDs, then load rooming.');
      return;
    }
    setSaving(true);
    setMessage('');
    try {
      const res = await apiJson<{
        success: boolean;
        rooming?: RoomingRecord;
        flags?: VitalFlag[];
        bmi?: number | null;
        needsBpRecheck?: boolean;
        scheduleChip?: string;
        error?: string;
      }>(`/api/medical/rooming/${encodeURIComponent(appointmentId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId,
          transition,
          identityConfirmed: rooming.identityConfirmed,
          chiefComplaint: rooming.chiefComplaint,
          vitals: rooming.vitals,
          allergyReviewed: rooming.allergyReviewed,
          medicationReviewed: rooming.medicationReviewed,
          patientReportedMeds: rooming.patientReportedMeds,
          pharmacyReview: rooming.pharmacyReview,
          screenings: rooming.screenings,
          careGapActions: rooming.careGapActions,
          pocOrderIds: rooming.pocOrderIds,
        }),
      });
      if (!res.success) {
        setMessage(res.error || 'Save failed');
        return;
      }
      setRooming(res.rooming || null);
      setFlags(res.flags || []);
      setBmi(res.bmi ?? null);
      setNeedsBpRecheck(Boolean(res.needsBpRecheck));
      setChip(res.scheduleChip || 'Rooming in progress');
      setMessage(transition === 'ready' ? 'Marked ready for provider.' : 'Rooming saved.');
    } finally {
      setSaving(false);
    }
  }

  function patchVitals(key: keyof RoomingRecord['vitals'], raw: string) {
    if (!rooming) return;
    setRooming({
      ...rooming,
      vitals: { ...rooming.vitals, [key]: numOrNull(raw) },
    });
  }

  async function maGapAction(gapId: string, action: 'reported_elsewhere' | 'outreach') {
    if (!clientId) return;
    const res = await apiJson<{ success: boolean; gaps?: CareGapRow[]; error?: string }>(
      '/api/medical/care-gaps',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, gapId, action }),
      }
    );
    if (!res.success) {
      setMessage(res.error || 'Care gap action failed');
      return;
    }
    setCareGaps(res.gaps || []);
    setMessage(action === 'outreach' ? 'Outreach logged.' : 'Reported done elsewhere (MA cannot close gap).');
  }

  if (!clientId) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" data-testid="rooming-panel">
        <h2 className="text-sm font-bold text-slate-900">Rooming</h2>
        <p className="mt-1 text-xs text-slate-500">Select a patient on the visit to open MA rooming.</p>
      </section>
    );
  }

  if (!appointmentId) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" data-testid="rooming-panel">
        <h2 className="text-sm font-bold text-slate-900">Rooming</h2>
        <p className="mt-1 text-xs text-slate-500">
          No appointment on file for today — schedule a visit first (rooming is appointment-scoped).
        </p>
        {appointmentOptions.length > 0 ? (
          <select
            className="mt-3 w-full rounded-lg border px-2 py-1.5 text-sm"
            value=""
            onChange={(e) => setAppointmentId(e.target.value)}
          >
            <option value="">Select appointment…</option>
            {appointmentOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        ) : null}
      </section>
    );
  }

  if (!rooming) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" data-testid="rooming-panel">
        <p className="text-sm text-slate-600">Loading rooming…</p>
      </section>
    );
  }

  const v = rooming.vitals;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" data-testid="rooming-panel">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold text-slate-900">Rooming</h2>
          <p className="mt-1 text-xs text-slate-500">MA intake · draft → ready → in room</p>
        </div>
        <span
          className="rounded-full bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-900"
          data-testid="rooming-chip"
        >
          {chip}
        </span>
      </div>

      {/* 1. Identity */}
      <fieldset className="mt-4 space-y-2">
        <legend className="text-xs font-semibold uppercase tracking-wide text-slate-500">1. Identity confirmation</legend>
        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={rooming.identityConfirmed}
            onChange={(e) => setRooming({ ...rooming, identityConfirmed: e.target.checked })}
          />
          Identity confirmed
        </label>
      </fieldset>

      {/* 2. Chief complaint */}
      <fieldset className="mt-4">
        <legend className="text-xs font-semibold uppercase tracking-wide text-slate-500">2. Chief complaint</legend>
        <textarea
          className="mt-1 w-full rounded-lg border px-2 py-1.5 text-sm"
          rows={2}
          value={rooming.chiefComplaint}
          onChange={(e) => setRooming({ ...rooming, chiefComplaint: e.target.value })}
        />
      </fieldset>

      {/* 3. Vitals */}
      <fieldset className="mt-4">
        <legend className="text-xs font-semibold uppercase tracking-wide text-slate-500">3. Vitals</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {(
            [
              ['systolic', 'Systolic BP', v.systolic],
              ['diastolic', 'Diastolic BP', v.diastolic],
              ['hr', 'HR', v.hr],
              ['rr', 'RR', v.rr],
              ['tempF', 'Temp °F', v.tempF],
              ['spo2', 'SpO2', v.spo2],
              ['heightIn', 'Height (in)', v.heightIn],
              ['weightLb', 'Weight (lb)', v.weightLb],
              ['pain', 'Pain 0–10', v.pain],
            ] as const
          ).map(([key, label, val]) => (
            <label key={key} className="text-xs font-semibold text-slate-600">
              {label}
              <input
                className="mt-1 block w-full rounded-lg border px-2 py-1.5 text-sm"
                value={val ?? ''}
                onChange={(e) => patchVitals(key, e.target.value)}
              />
            </label>
          ))}
        </div>
        <p className="mt-2 text-sm text-slate-700">BMI: {bmi != null ? bmi : 'none on file'}</p>
        {needsBpRecheck ? (
          <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="text-xs font-semibold text-amber-900">BP ≥140/90 — recheck after 5 min</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <label className="text-xs font-semibold text-slate-600">
                Recheck systolic
                <input
                  className="mt-1 block w-full rounded-lg border px-2 py-1.5 text-sm"
                  value={v.bpRecheckSystolic ?? ''}
                  onChange={(e) => patchVitals('bpRecheckSystolic', e.target.value)}
                />
              </label>
              <label className="text-xs font-semibold text-slate-600">
                Recheck diastolic
                <input
                  className="mt-1 block w-full rounded-lg border px-2 py-1.5 text-sm"
                  value={v.bpRecheckDiastolic ?? ''}
                  onChange={(e) => patchVitals('bpRecheckDiastolic', e.target.value)}
                />
              </label>
            </div>
          </div>
        ) : null}
        {flags.length > 0 ? (
          <ul className="mt-2 space-y-1">
            {flags.map((f) => (
              <li key={f.id} className="text-sm text-rose-800">
                {f.label} — <span className="font-semibold">{f.action}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </fieldset>

      {/* 4. Reviews */}
      <fieldset className="mt-4 space-y-2">
        <legend className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          4. Allergy · medication · pharmacy review
        </legend>
        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={rooming.allergyReviewed}
            onChange={(e) => setRooming({ ...rooming, allergyReviewed: e.target.checked })}
          />
          Allergy review
        </label>
        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={rooming.medicationReviewed}
            onChange={(e) => setRooming({ ...rooming, medicationReviewed: e.target.checked })}
          />
          Medication review
        </label>
        <label className="block text-xs font-semibold text-slate-600">
          Patient-reported meds
          <textarea
            className="mt-1 w-full rounded-lg border px-2 py-1.5 text-sm"
            rows={2}
            value={rooming.patientReportedMeds}
            onChange={(e) => setRooming({ ...rooming, patientReportedMeds: e.target.value })}
          />
        </label>
        <div className="flex flex-wrap gap-3 text-sm">
          <label className="inline-flex items-center gap-2">
            <input
              type="radio"
              name="pharmacy"
              checked={rooming.pharmacyReview === 'unchanged'}
              onChange={() => setRooming({ ...rooming, pharmacyReview: 'unchanged' })}
            />
            Pharmacy unchanged
          </label>
          <label className="inline-flex items-center gap-2">
            <input
              type="radio"
              name="pharmacy"
              checked={rooming.pharmacyReview === 'changed'}
              onChange={() => setRooming({ ...rooming, pharmacyReview: 'changed' })}
            />
            Pharmacy changed
          </label>
        </div>
        {rooming.pharmacyReview === 'changed' ? (
          <p className="text-sm font-medium text-amber-900">{PHARMACY_CHANGED_COPY}</p>
        ) : null}
      </fieldset>

      {/* 5. Screenings */}
      <fieldset className="mt-4 space-y-2">
        <legend className="text-xs font-semibold uppercase tracking-wide text-slate-500">5. Screenings due</legend>
        {SCREENING_KEYS.map(({ key, label }) => (
          <label key={key} className="flex items-center justify-between gap-2 text-sm">
            <span>{label}</span>
            <select
              className="rounded-lg border px-2 py-1 text-sm"
              value={rooming.screenings[key]}
              onChange={(e) =>
                setRooming({
                  ...rooming,
                  screenings: {
                    ...rooming.screenings,
                    [key]: e.target.value as RoomingRecord['screenings']['depression'],
                  },
                })
              }
            >
              <option value="due">due</option>
              <option value="done">done</option>
              <option value="deferred">deferred</option>
              <option value="not_applicable">not_applicable</option>
            </select>
          </label>
        ))}
        <label className="block text-xs font-semibold text-slate-600">
          PHQ-9 item 9 (0–3)
          <input
            className="mt-1 block w-32 rounded-lg border px-2 py-1.5 text-sm"
            value={rooming.screenings.phq9Item9 ?? ''}
            onChange={(e) =>
              setRooming({
                ...rooming,
                screenings: { ...rooming.screenings, phq9Item9: numOrNull(e.target.value) },
              })
            }
          />
        </label>
      </fieldset>

      {/* 6. Care gaps — MA cannot close */}
      <fieldset className="mt-4 space-y-2">
        <legend className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          6. Care gaps (MA: done elsewhere / outreach only)
        </legend>
        {careGaps.length === 0 ? (
          <p className="text-sm text-slate-500">none on file</p>
        ) : (
          <ul className="space-y-2">
            {careGaps.map((g) => (
              <li key={g.gapId} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>
                  {g.label} · {g.status} · last done {(g as CareGapRow & { lastDoneDisplay?: string }).lastDoneDisplay || g.lastDoneAt || 'none on file'}
                </span>
                <span className="flex gap-1">
                  <button
                    type="button"
                    className="rounded border px-2 py-0.5 text-xs"
                    onClick={() => void maGapAction(g.gapId, 'reported_elsewhere')}
                  >
                    done elsewhere
                  </button>
                  <button
                    type="button"
                    className="rounded border px-2 py-0.5 text-xs"
                    onClick={() => void maGapAction(g.gapId, 'outreach')}
                  >
                    outreach
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </fieldset>

      {/* 7. POC — approved only */}
      <fieldset className="mt-4 space-y-2">
        <legend className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          7. POC standing-order tests (approved only)
        </legend>
        {approvedPoc.length === 0 ? (
          <p className="text-sm text-slate-500">No approved standing orders — drafts hidden</p>
        ) : (
          <ul className="space-y-1">
            {approvedPoc.map((o) => {
              const checked = rooming.pocOrderIds.includes(o.id);
              return (
                <li key={o.id}>
                  <label className="inline-flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setRooming({
                          ...rooming,
                          pocOrderIds: checked
                            ? rooming.pocOrderIds.filter((id) => id !== o.id)
                            : [...rooming.pocOrderIds, o.id],
                        })
                      }
                    />
                    {o.name} ({o.cpt})
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </fieldset>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={saving}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-800"
          onClick={() => void save('save')}
        >
          Save
        </button>
        <button
          type="button"
          disabled={saving}
          className="rounded-lg bg-blue-700 px-3 py-1.5 text-sm font-semibold text-white"
          onClick={() => void save('ready')}
        >
          {rooming.status === 'ready' || rooming.status === 'in_room'
            ? 'Update'
            : 'Ready for provider'}
        </button>
      </div>
      {message ? <p className="mt-2 text-sm text-slate-700">{message}</p> : null}
    </section>
  );
}
