'use client';

/**
 * Provider side of a primary care visit (beside the medical visit editor):
 * Prepare: MA intake (vitals with flags, chief complaint, reviews, screenings, POC), the BH
 * involvement signal (yes / last date only), results awaiting review.
 * During / orders: care gaps (each due gap addressed), BH warm handoff, referrals / imaging
 * tracking, DrFirst prescribe with the PDMP prompt, tasks to the MA.
 * Wrap-up: E/M suggestion (2021 MDM / time; preventive by age; Medicare AWV), suggestions only.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { BellRing, ClipboardCheck, ExternalLink, FlaskConical, HeartHandshake, Pill, Send, Stethoscope, UserCheck } from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import { openDrFirst } from '@/components/visits/VisitGuidePanel';
import {
  GAP_ACTION_LABEL,
  REFERRAL_STATUS_LABEL,
  isPreventiveVisitType,
  referralNextStatuses,
  suggestEmCodes,
  type CareGap,
  type GapAction,
  type Mdm,
  type RoomingVitals,
  type VitalFlag,
} from '@/lib/medical/primaryCareWorkflow';
import { CareGapActionForm } from './CareGapActionForm';
import { buttonClasses } from '@/components/ui';

type Score = { score: number; date: string } | null;
type Referral = { id: string; kind: string; target: string; facility: string | null; reason: string; urgency: string; status: string; statusDate: string | null; sentAt: string; orderedByName: string | null };
type Workflow = {
  canAct: boolean;
  intake: {
    status: string;
    chiefComplaint: string | null;
    identityConfirmed: boolean;
    vitals: RoomingVitals | null;
    bmi: number | null;
    flags: VitalFlag[];
    recheck: { state: string; stillElevated?: boolean };
    checks: {
      allergies?: { status: string } | null;
      meds?: { reviewed: boolean; reported: { name: string; dose?: string | null; frequency?: string | null }[] } | null;
      pharmacy?: { status: string; name?: string | null } | null;
      screenings?: { tobacco?: { status: string } | null; falls?: { positive: boolean } | null; auditC?: { total: number; positive: boolean } | null; declined?: string[] } | null;
      poc?: { name: string; result: string; unit: string | null }[];
    } | null;
    vitalsFiled: boolean;
    roomedByName: string | null;
    roomedAt: string | null;
    inRoomAt: string | null;
  } | null;
  scores: { phq2: Score; phq9: (Score & { item9?: number | null }) | null; gad7: Score; auditC: Score };
  careGaps: CareGap[];
  openGapKeys: string[];
  thisVisitActions: { gapKey: string; action: string; performedOn: string | null; source: string | null; reason: string | null; by: string | null }[];
  bhHandoff: { suggested: boolean; reasons: string[]; open: Referral | null };
  bhInvolvement: { involved: boolean; lastSeen: string | null };
  referrals: Referral[];
  resultsAwaitingReview: number;
  prescribing: { controlledMeds: string[]; lastPdmp: string | null };
  em: { ageYears: number | null; medicare: boolean; lastAwv: string | null; newPatient: boolean; newPatientBasis: string; visitType: string | null };
};

const MDM_MAP: Record<string, Mdm> = { Straightforward: 'straightforward', Low: 'low', Moderate: 'moderate', High: 'high' };
const card = 'rounded-xl border border-slate-200 bg-white p-5 shadow-xs';
const h2 = 'flex items-center gap-2 text-sm font-semibold text-slate-900';
const input = 'rounded-lg border border-slate-200 px-2 py-1 text-xs outline-none focus:border-blue-600';
const PROVIDER_ACTIONS: GapAction[] = ['completed', 'ordered', 'done_elsewhere', 'refused', 'not_applicable'];

export function PrimaryCareVisitWorkflow({
  clientId,
  appointmentId,
  visitType,
  mdm,
  icd10Codes,
  locked,
  onUseCode,
  onIntake,
  onChanged,
}: {
  clientId: string;
  appointmentId: string | null;
  visitType: string;
  mdm: string;
  icd10Codes: string[];
  locked: boolean;
  onUseCode: (code: string) => void;
  onIntake: (intake: { vitals: RoomingVitals | null; filed: boolean; chiefComplaint: string | null }) => void;
  onChanged: () => void;
}) {
  const [wf, setWf] = useState<Workflow | null>(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [minutes, setMinutes] = useState('');
  const [controlledToday, setControlledToday] = useState(false);
  const [ref, setRef] = useState({ kind: 'specialist', target: '', facility: '', reason: '', urgency: 'routine', cpt: '' });
  const [task, setTask] = useState({ title: '', detail: '', assignedToId: '' });
  const [assignees, setAssignees] = useState<{ id: string; name: string | null }[]>([]);
  const [handoffReason, setHandoffReason] = useState('');
  const [busy, setBusy] = useState(false);
  const inRoomSent = useRef(false);
  const intakeSent = useRef('');

  const load = useCallback(async () => {
    setError('');
    try {
      const qs = new URLSearchParams({ clientId });
      if (appointmentId) qs.set('appointmentId', appointmentId);
      const d = await apiJson<Workflow>(`/api/medical/visit-workflow?${qs.toString()}`, { cache: 'no-store' });
      setWf(d);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the visit workflow');
    }
  }, [clientId, appointmentId]);
  useEffect(() => {
    void load();
  }, [load]);

  // Provider opened the visit: mark the patient "with provider" (stops the waiting clock)
  useEffect(() => {
    if (!wf || !appointmentId || !wf.canAct || inRoomSent.current) return;
    if (wf.intake?.status !== 'ready') return;
    inRoomSent.current = true;
    void apiJson(`/api/medical/rooming/${encodeURIComponent(appointmentId)}`, { method: 'PUT', body: JSON.stringify({ action: 'in_room' }) }).catch(() => undefined);
  }, [wf, appointmentId]);

  useEffect(() => {
    if (!wf) return;
    const key = JSON.stringify([wf.intake?.vitals ?? null, wf.intake?.vitalsFiled ?? false, wf.intake?.chiefComplaint ?? null]);
    if (intakeSent.current === key) return;
    intakeSent.current = key;
    onIntake({ vitals: wf.intake?.vitals ?? null, filed: Boolean(wf.intake?.vitalsFiled), chiefComplaint: wf.intake?.chiefComplaint ?? null });
  }, [wf, onIntake]);

  useEffect(() => {
    if (!wf?.canAct) return;
    apiJson<{ assignees?: { id: string; name: string | null }[] }>('/api/medical/tasks?assignees=1', { cache: 'no-store' })
      .then((d) => setAssignees(d.assignees ?? []))
      .catch(() => undefined);
  }, [wf?.canAct]);

  const refresh = async (note?: string) => {
    if (note) setMsg(note);
    await load();
    onChanged();
  };

  const em = useMemo(() => {
    if (!wf) return null;
    return suggestEmCodes({
      preventive: isPreventiveVisitType(visitType),
      newPatient: wf.em.newPatient,
      ageYears: wf.em.ageYears,
      medicare: wf.em.medicare,
      lastAwv: wf.em.lastAwv ? new Date(wf.em.lastAwv) : null,
      now: new Date(),
      mdm: MDM_MAP[mdm] ?? null,
      totalMinutes: minutes.trim() ? Number(minutes) : null,
    });
  }, [wf, visitType, mdm, minutes]);

  const post = async (url: string, body: unknown, note: string) => {
    setBusy(true);
    setError('');
    setMsg('');
    try {
      await apiJson(url, { method: 'POST', body: JSON.stringify(body) });
      await refresh(note);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (error && !wf) return <p className="rounded-xl bg-rose-50 px-4 py-2 text-sm text-rose-800">{error}</p>;
  if (!wf) return <p className="text-sm text-slate-500">Loading the primary care workflow…</p>;

  const open = wf.careGaps.filter((g) => wf.openGapKeys.includes(g.key));
  const actionsFor = (key: string) => wf.thisVisitActions.filter((a) => a.gapKey === key);
  const i = wf.intake;
  const v = i?.vitals ?? null;
  const showPdmp = wf.prescribing.controlledMeds.length > 0 || controlledToday;
  const canAct = wf.canAct && !locked;

  return (
    <div className="space-y-4">
      {error ? <p className="rounded-xl bg-rose-50 px-4 py-2 text-sm text-rose-800">{error}</p> : null}
      {msg ? <p className="text-xs font-semibold text-emerald-700">{msg}</p> : null}

      {/* Prepare: MA intake */}
      <section className={card}>
        <h2 className={h2}>
          <ClipboardCheck size={16} className="text-blue-600" /> MA intake
          {i?.roomedAt ? (
            <span className="text-[11px] font-normal text-slate-500">
              ready {new Date(i.roomedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
              {i.roomedByName ? ` by ${i.roomedByName}` : ''}
            </span>
          ) : null}
        </h2>
        {!i ? (
          <p className="mt-1 text-xs text-slate-500">{appointmentId ? 'The patient has not been roomed for this appointment.' : 'Open the visit from the schedule to see the MA intake.'}</p>
        ) : (
          <div className="mt-2 grid gap-3 text-xs text-slate-700 md:grid-cols-2">
            <div>
              <p>
                <strong>Chief complaint:</strong> {i.chiefComplaint || 'not recorded'}
              </p>
              <p className="mt-1">
                <strong>Identity:</strong> {i.identityConfirmed ? 'two identifiers confirmed' : 'not confirmed'}
              </p>
              {v ? (
                <p className="mt-1">
                  <strong>Vitals:</strong> BP {v.systolic ?? '?'}/{v.diastolic ?? '?'}
                  {v.recheck ? ` (recheck ${v.recheck.systolic}/${v.recheck.diastolic})` : ''}, HR {v.heartRate ?? '—'}, RR {v.respRate ?? '—'}, T {v.temperatureF ?? '—'} °F, SpO2{' '}
                  {v.spO2 ?? '—'}%, Ht {v.heightIn ?? '—'} in, Wt {v.weightLbs ?? '—'} lb, BMI {i.bmi ?? '—'}, pain {v.pain ?? '—'}/10
                </p>
              ) : (
                <p className="mt-1">
                  <strong>Vitals:</strong> none recorded at rooming
                </p>
              )}
              {i.recheck.state === 'due' || i.recheck.state === 'wait' ? <p className="mt-1 font-semibold text-amber-800">Elevated BP: no recheck recorded.</p> : null}
              {i.flags.length ? (
                <ul className="mt-2 space-y-1" role="alert">
                  {i.flags.map((f) => (
                    <li key={f.key} className="flex items-center gap-1.5 rounded-lg bg-rose-50 px-2 py-1 font-semibold text-rose-800">
                      <BellRing size={12} /> {f.label} ({f.value})
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            <div>
              <p>
                <strong>Allergies:</strong> {i.checks?.allergies ? (i.checks.allergies.status === 'no_changes' ? 'reviewed, no changes' : 'reviewed and updated') : 'not reviewed'}
              </p>
              <p className="mt-1">
                <strong>Medications:</strong> {i.checks?.meds?.reviewed ? 'reviewed with the patient' : 'not reviewed'}
              </p>
              {i.checks?.meds?.reported?.length ? (
                <div className="mt-1 rounded-lg bg-sky-50 p-2 text-sky-900">
                  <p className="font-semibold">Patient-reported outside medications (reconcile):</p>
                  <ul className="list-disc pl-4">
                    {i.checks.meds.reported.map((m, k) => (
                      <li key={k}>
                        {m.name}
                        {m.dose ? ` ${m.dose}` : ''}
                        {m.frequency ? `, ${m.frequency}` : ''}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <p className="mt-1">
                <strong>Pharmacy:</strong>{' '}
                {i.checks?.pharmacy ? (i.checks.pharmacy.status === 'changed' ? `patient wants ${i.checks.pharmacy.name || 'a different pharmacy'}` : i.checks.pharmacy.status === 'none' ? 'none' : 'confirmed') : 'not confirmed'}
              </p>
              {i.checks?.poc?.length ? (
                <p className="mt-1">
                  <strong>Point-of-care:</strong> {i.checks.poc.map((p) => `${p.name} ${p.result}${p.unit ? ` ${p.unit}` : ''}`).join('; ')}
                </p>
              ) : null}
            </div>
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-3 border-t border-slate-100 pt-3 text-xs text-slate-700">
          <span>
            <strong>Screens (primary care):</strong>{' '}
            {[
              wf.scores.phq2 ? `PHQ-2 ${wf.scores.phq2.score} (${wf.scores.phq2.date})` : null,
              wf.scores.phq9 ? `PHQ-9 ${wf.scores.phq9.score} (${wf.scores.phq9.date})` : null,
              wf.scores.gad7 ? `GAD-7 ${wf.scores.gad7.score} (${wf.scores.gad7.date})` : null,
              wf.scores.auditC ? `AUDIT-C ${wf.scores.auditC.score} (${wf.scores.auditC.date})` : null,
              i?.checks?.screenings?.tobacco ? `tobacco: ${i.checks.screenings.tobacco.status.replace(/_/g, ' ')}` : null,
              i?.checks?.screenings?.falls ? `falls screen ${i.checks.screenings.falls.positive ? 'positive' : 'negative'}` : null,
            ]
              .filter(Boolean)
              .join(' · ') || 'none on file'}
          </span>
          <span>
            <strong>Behavioral health:</strong> {wf.bhInvolvement.involved ? `seen by the practice's behavioral health team (last ${wf.bhInvolvement.lastSeen})` : 'no recent behavioral health visit at this practice'}
          </span>
          {wf.resultsAwaitingReview ? (
            <Link href="/dashboard/medical/labs" className="inline-flex items-center gap-1 font-semibold text-blue-600 hover:underline">
              <FlaskConical size={12} /> {wf.resultsAwaitingReview} result(s) awaiting review
            </Link>
          ) : null}
        </div>
      </section>

      {/* Care gaps */}
      <section className={card}>
        <h2 className={h2}>
          <UserCheck size={16} className="text-blue-600" /> Care gaps (screening guidance)
        </h2>
        <p className="text-[11px] text-slate-500">Each due gap: done today, ordered, done elsewhere (date + source), declined, or not applicable (reason).</p>
        {open.length === 0 ? <p className="mt-2 text-xs text-slate-500">No care gap due.</p> : null}
        <ul className="mt-2 space-y-2">
          {open.map((g) => {
            const acts = actionsFor(g.key).filter((a) => PROVIDER_ACTIONS.includes(a.action as GapAction));
            return (
              <li key={g.key} className={`rounded-lg border p-2.5 ${acts.length ? 'border-emerald-200 bg-emerald-50/40' : 'border-amber-200 bg-amber-50/40'}`}>
                <p className="text-xs font-semibold text-slate-800">
                  {g.label} <span className="font-normal text-slate-500">· {g.reason} · {g.basis}</span>
                </p>
                {g.patientReported ? (
                  <p className="text-[11px] text-sky-800">
                    Patient reports done {g.patientReported.date ?? '(date unknown)'} at {g.patientReported.source}: verify, then record &ldquo;done elsewhere&rdquo;.
                  </p>
                ) : null}
                {acts.map((a, k) => (
                  <p key={k} className="text-[11px] font-semibold text-emerald-800">
                    {GAP_ACTION_LABEL[a.action as GapAction]}
                    {a.performedOn ? ` ${a.performedOn}` : ''}
                    {a.source ? ` at ${a.source}` : ''}
                    {a.reason ? `: ${a.reason}` : ''}
                    {a.by ? ` (${a.by})` : ''}
                  </p>
                ))}
                {canAct ? <CareGapActionForm clientId={clientId} appointmentId={appointmentId} gapKey={g.key} actions={PROVIDER_ACTIONS} onSaved={() => void refresh('Care gap updated.')} /> : null}
              </li>
            );
          })}
        </ul>
        {wf.careGaps.some((g) => g.status === 'met' || g.status === 'not_applicable') ? (
          <details className="mt-2 text-[11px] text-slate-600">
            <summary className="cursor-pointer font-semibold">Up to date / not applicable</summary>
            <ul className="mt-1 space-y-0.5">
              {wf.careGaps
                .filter((g) => g.status === 'met' || g.status === 'not_applicable')
                .map((g) => (
                  <li key={g.key}>
                    {g.label}: {g.reason}
                  </li>
                ))}
            </ul>
          </details>
        ) : null}
      </section>

      {/* BH warm handoff */}
      {wf.bhHandoff.suggested || wf.bhHandoff.open ? (
        <section className={card}>
          <h2 className={h2}>
            <HeartHandshake size={16} className="text-blue-600" /> Behavioral health warm handoff
          </h2>
          {wf.bhHandoff.open ? (
            <p className="mt-1 text-xs text-slate-700">
              Handoff sent {wf.bhHandoff.open.sentAt.slice(0, 10)}: {REFERRAL_STATUS_LABEL[wf.bhHandoff.open.status as keyof typeof REFERRAL_STATUS_LABEL] ?? wf.bhHandoff.open.status}
              {wf.bhHandoff.open.statusDate ? ` (${wf.bhHandoff.open.statusDate})` : ''}. Only the status comes back to primary care.
            </p>
          ) : (
            <>
              <p className="mt-1 text-xs text-slate-700">Suggested: {wf.bhHandoff.reasons.join('; ')}. Offer the practice behavioral health team; the patient decides.</p>
              {canAct ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input aria-label="Handoff note" placeholder="Note for the BH intake team (optional)" value={handoffReason} onChange={(e) => setHandoffReason(e.target.value)} className={`${input} w-80`} />
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void post(
                        '/api/medical/referrals',
                        { clientId, kind: 'internal_bh', appointmentId, reason: handoffReason.trim() ? `Primary care screen: ${wf.bhHandoff.reasons.join('; ')}. ${handoffReason.trim()}` : null },
                        'Warm handoff sent to the behavioral health team.'
                      )
                    }
                    className={buttonClasses({ size: 'sm' })}
                  >
                    Request warm handoff
                  </button>
                </div>
              ) : null}
            </>
          )}
        </section>
      ) : null}

      {/* Orders */}
      <section className={card}>
        <h2 className={h2}>
          <Stethoscope size={16} className="text-blue-600" /> Orders
        </h2>
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          <Link href={`/dashboard/medical/labs?clientId=${encodeURIComponent(clientId)}`} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 font-semibold text-slate-700 hover:bg-slate-50">
            <FlaskConical size={12} /> Order labs
          </Link>
          {canAct ? (
            <button
              type="button"
              onClick={async () => setError((await openDrFirst(clientId, 'patient')) ?? '')}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 font-semibold text-slate-700 hover:bg-slate-50"
            >
              <Pill size={12} /> Prescribe in DrFirst <ExternalLink size={11} />
            </button>
          ) : null}
          <label className="flex items-center gap-1.5 text-slate-600">
            <input type="checkbox" checked={controlledToday} onChange={(e) => setControlledToday(e.target.checked)} /> Prescribing a controlled substance today
          </label>
        </div>
        {showPdmp ? (
          <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Maryland PDMP (CRISP): query before prescribing an opioid or benzodiazepine and at least every 90 days while it continues. Last query on file: {wf.prescribing.lastPdmp ?? 'none'}.
            {wf.prescribing.controlledMeds.length ? ` Active controlled medications: ${wf.prescribing.controlledMeds.join(', ')}.` : ''}
          </p>
        ) : null}

        <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Referrals and imaging (tracked until the report is back)</h3>
        <ul className="mt-1 divide-y divide-slate-100">
          {wf.referrals
            .filter((r) => r.kind !== 'internal_bh')
            .map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-xs">
                <span>
                  <strong>{r.kind === 'imaging' ? 'Imaging' : 'Referral'}:</strong> {r.target}
                  {r.facility ? ` at ${r.facility}` : ''} · {REFERRAL_STATUS_LABEL[r.status as keyof typeof REFERRAL_STATUS_LABEL] ?? r.status}
                  {r.statusDate ? ` ${r.statusDate}` : ''} · sent {r.sentAt.slice(0, 10)}
                </span>
                {canAct ? <ReferralStatusControl referral={r} onDone={() => void refresh('Referral updated.')} /> : null}
              </li>
            ))}
        </ul>
        {canAct ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <select aria-label="Referral type" value={ref.kind} onChange={(e) => setRef((x) => ({ ...x, kind: e.target.value }))} className={input}>
              <option value="specialist">Specialist referral</option>
              <option value="imaging">Imaging</option>
            </select>
            <input aria-label="Specialty or study" placeholder={ref.kind === 'imaging' ? 'Study (e.g. Chest X-ray 2 views)' : 'Specialty'} value={ref.target} onChange={(e) => setRef((x) => ({ ...x, target: e.target.value }))} className={`${input} w-48`} />
            <input aria-label="Facility" placeholder="Facility / clinician" value={ref.facility} onChange={(e) => setRef((x) => ({ ...x, facility: e.target.value }))} className={`${input} w-40`} />
            {ref.kind === 'imaging' ? <input aria-label="CPT" placeholder="CPT" value={ref.cpt} onChange={(e) => setRef((x) => ({ ...x, cpt: e.target.value }))} className={`${input} w-20`} /> : null}
            <input aria-label="Reason" placeholder="Reason / question" value={ref.reason} onChange={(e) => setRef((x) => ({ ...x, reason: e.target.value }))} className={`${input} w-64`} />
            <select aria-label="Urgency" value={ref.urgency} onChange={(e) => setRef((x) => ({ ...x, urgency: e.target.value }))} className={input}>
              <option value="routine">Routine</option>
              <option value="urgent">Urgent</option>
              <option value="stat">STAT</option>
            </select>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                const ok = await post(
                  '/api/medical/referrals',
                  { clientId, appointmentId, kind: ref.kind, target: ref.target, facility: ref.facility || null, reason: ref.reason, urgency: ref.urgency, cpt: ref.cpt || null, icd10Codes: icd10Codes.filter(Boolean).slice(0, 12) },
                  'Referral recorded and tracked.'
                );
                if (ok) setRef({ kind: ref.kind, target: '', facility: '', reason: '', urgency: 'routine', cpt: '' });
              }}
              className={buttonClasses({ size: 'sm' })}
            >
              <Send size={12} /> Send
            </button>
          </div>
        ) : null}

        {canAct ? (
          <>
            <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Task for the Medical Assistant</h3>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <input aria-label="Task" placeholder="What needs to be done" value={task.title} onChange={(e) => setTask((t) => ({ ...t, title: e.target.value }))} className={`${input} w-64`} />
              <input aria-label="Task detail" placeholder="Detail (optional)" value={task.detail} onChange={(e) => setTask((t) => ({ ...t, detail: e.target.value }))} className={`${input} w-56`} />
              <select aria-label="Assign to" value={task.assignedToId} onChange={(e) => setTask((t) => ({ ...t, assignedToId: e.target.value }))} className={input}>
                <option value="">Any MA</option>
                {assignees.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name || 'Medical Assistant'}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={busy || task.title.trim().length < 3}
                onClick={async () => {
                  const ok = await post('/api/medical/tasks', { clientId, title: task.title, detail: task.detail || null, assignedToId: task.assignedToId || null }, 'Task sent to the MA.');
                  if (ok) setTask({ title: '', detail: '', assignedToId: '' });
                }}
                className={buttonClasses({ size: 'sm' })}
              >
                Route task
              </button>
            </div>
          </>
        ) : null}
      </section>

      {/* E/M suggestion */}
      {em ? (
        <section className={card}>
          <h2 className={h2}>E/M suggestion (provider selects the code)</h2>
          <p className="text-[11px] text-slate-500">
            {isPreventiveVisitType(visitType) ? 'Preventive visit' : 'Problem-oriented visit'} · {wf.em.newPatient ? 'new patient' : 'established patient'} ({wf.em.newPatientBasis}) ·{' '}
            {wf.em.medicare ? 'Medicare payer on file' : 'payer is not Medicare'} · MDM {mdm.toLowerCase()}
          </p>
          <label className="mt-2 flex items-center gap-2 text-xs text-slate-600">
            Total time on the date of service (min)
            <input type="number" min={0} value={minutes} onChange={(e) => setMinutes(e.target.value)} className={`${input} w-20`} />
          </label>
          <ul className="mt-2 space-y-1.5">
            {em.suggestions.map((s) => (
              <li key={s.code} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs">
                <span>
                  <strong className="font-mono">{s.code}</strong> {s.label} · <span className="text-slate-500">{s.reason}</span>
                </span>
                {!locked ? (
                  <button type="button" onClick={() => onUseCode(s.code)} className="rounded-lg border border-blue-600/30 px-2 py-0.5 font-semibold text-blue-600">
                    Use {s.code}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          {em.notes.map((n) => (
            <p key={n} className="mt-1 text-[11px] text-slate-500">
              {n}
            </p>
          ))}
        </section>
      ) : null}
    </div>
  );
}

function ReferralStatusControl({ referral, onDone }: { referral: Referral; onDone: () => void }) {
  const next = referralNextStatuses(referral.kind, referral.status);
  const [status, setStatus] = useState('');
  const [date, setDate] = useState('');
  const [error, setError] = useState('');
  if (!next.length) return null;
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <select aria-label="Update referral" value={status} onChange={(e) => setStatus(e.target.value)} className={input}>
        <option value="">Update…</option>
        {next.map((s) => (
          <option key={s} value={s}>
            {REFERRAL_STATUS_LABEL[s as keyof typeof REFERRAL_STATUS_LABEL] ?? s}
          </option>
        ))}
      </select>
      {status === 'scheduled' || status === 'seen' || status === 'report_received' ? (
        <input type="date" aria-label="Date" value={date} onChange={(e) => setDate(e.target.value)} className={input} />
      ) : null}
      {status ? (
        <button
          type="button"
          onClick={async () => {
            setError('');
            try {
              await apiJson(`/api/medical/referrals/${encodeURIComponent(referral.id)}`, { method: 'PATCH', body: JSON.stringify({ status, date: date || null }) });
              setStatus('');
              setDate('');
              onDone();
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Could not update');
            }
          }}
          className="rounded-lg bg-slate-800 px-2 py-0.5 text-[11px] font-semibold text-white"
        >
          Save
        </button>
      ) : null}
      {error ? <span className="text-[11px] text-rose-700">{error}</span> : null}
    </span>
  );
}
