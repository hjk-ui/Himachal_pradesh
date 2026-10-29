'use client';

import { useEffect, useState } from 'react';
import { apiJson } from '@/lib/api-client';
import type { VisitWorkflowPayload } from '@/lib/medical/visit-workflow';

type Props = {
  appointmentId?: string;
  clientId?: string;
  clientName?: string;
  /** When true (deep-link), auto-load workflow → ready rooming becomes in_room */
  autoOpen?: boolean;
};

export function ProviderVisitWorkflow({
  appointmentId: apptProp,
  clientId: clientProp,
  clientName: nameProp,
  autoOpen = false,
}: Props) {
  const [appointmentId, setAppointmentId] = useState(apptProp || '');
  const [clientId, setClientId] = useState(clientProp || '');
  const [clientName, setClientName] = useState(nameProp || '');
  const [phq9, setPhq9] = useState('');
  const [gad7, setGad7] = useState('');
  const [workflow, setWorkflow] = useState<VisitWorkflowPayload | null>(null);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [tab, setTab] = useState<'prepare' | 'during' | 'wrap'>('prepare');
  const [message, setMessage] = useState('');
  const [taskTitle, setTaskTitle] = useState('');

  useEffect(() => {
    if (apptProp) setAppointmentId(apptProp);
  }, [apptProp]);
  useEffect(() => {
    if (clientProp) setClientId(clientProp);
  }, [clientProp]);
  useEffect(() => {
    if (nameProp) setClientName(nameProp);
  }, [nameProp]);

  useEffect(() => {
    if (!clientId || apptProp) return;
    let cancelled = false;
    const today = new Date().toISOString().slice(0, 10);
    apiJson<{
      success: boolean;
      appointments?: Array<{ id: string }>;
    }>(`/api/appointments?clientId=${encodeURIComponent(clientId)}&date=${today}`)
      .then((res) => {
        if (cancelled || !res.success) return;
        const first = res.appointments?.[0]?.id;
        if (first && !appointmentId) setAppointmentId(first);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [clientId, apptProp, appointmentId]);

  useEffect(() => {
    if (!autoOpen || !appointmentId || !clientId || workflow) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deep-link one-shot open
  }, [autoOpen, appointmentId, clientId]);

  async function load() {
    if (!appointmentId || !clientId) {
      setMessage('Appointment and patient IDs required');
      return;
    }
    const qs = new URLSearchParams({
      appointmentId,
      clientId,
      clientName: clientName || 'Patient',
    });
    if (phq9 !== '') qs.set('phq9', phq9);
    if (gad7 !== '') qs.set('gad7', gad7);
    const res = await apiJson<{ success: boolean; workflow?: VisitWorkflowPayload; error?: string }>(
      `/api/medical/visit-workflow?${qs.toString()}`
    );
    if (!res.success || !res.workflow) {
      setMessage(res.error || 'Unable to load visit workflow');
      return;
    }
    setWorkflow(res.workflow);
    setSelectedCode(null);
    setMessage('');
  }

  async function createMaTask() {
    if (!workflow || !taskTitle.trim()) return;
    const res = await apiJson<{ success: boolean; error?: string }>('/api/medical/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: workflow.clientId,
        clientName: workflow.clientName,
        title: taskTitle.trim(),
        assignedToRole: 'MEDICAL_ASSISTANT',
        appointmentId: workflow.appointmentId,
      }),
    });
    setMessage(res.success ? 'Task sent to MA.' : res.error || 'Task failed');
    if (res.success) {
      setTaskTitle('');
      await load();
    }
  }

  async function providerGap(gapId: string, action: string) {
    if (!workflow) return;
    const res = await apiJson<{ success: boolean; error?: string }>('/api/medical/care-gaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: workflow.clientId, gapId, action }),
    });
    setMessage(res.success ? 'Care gap updated.' : res.error || 'Update failed');
    if (res.success) await load();
  }

  async function warmHandoffReferral() {
    if (!workflow) return;
    const res = await apiJson<{ success: boolean; error?: string }>('/api/medical/referrals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: workflow.clientId,
        clientName: workflow.clientName,
        specialty: 'Behavioral health (warm handoff)',
        reason: 'Internal BH warm handoff',
        internalBhWarmHandoff: true,
        phq9: phq9 !== '' ? Number(phq9) : null,
        gad7: gad7 !== '' ? Number(gad7) : null,
      }),
    });
    setMessage(res.success ? 'Warm handoff referral created.' : res.error || 'Referral failed');
    if (res.success) await load();
  }

  return (
    <section
      className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
      data-testid="provider-visit-workflow"
    >
      <h2 className="text-sm font-bold text-slate-900">Provider visit workflow</h2>
      <p className="mt-1 text-xs text-slate-500">Prepare · During · Wrap-up (beside SOAP / medical visits)</p>

      {!workflow ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <input
            className="rounded-lg border px-2 py-1.5 text-sm"
            placeholder="Appointment ID"
            value={appointmentId}
            onChange={(e) => setAppointmentId(e.target.value)}
          />
          <input
            className="rounded-lg border px-2 py-1.5 text-sm"
            placeholder="Patient ID"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
          />
          <input
            className="rounded-lg border px-2 py-1.5 text-sm"
            placeholder="Patient name"
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
          />
          <div className="flex gap-2">
            <input
              className="w-20 rounded-lg border px-2 py-1.5 text-sm"
              placeholder="PHQ-9"
              value={phq9}
              onChange={(e) => setPhq9(e.target.value)}
            />
            <input
              className="w-20 rounded-lg border px-2 py-1.5 text-sm"
              placeholder="GAD-7"
              value={gad7}
              onChange={(e) => setGad7(e.target.value)}
            />
          </div>
          <button
            type="button"
            className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-semibold text-white sm:col-span-2"
            onClick={() => void load()}
          >
            Open visit
          </button>
        </div>
      ) : (
        <>
          <div className="mt-3 flex gap-2">
            {(['prepare', 'during', 'wrap'] as const).map((t) => (
              <button
                key={t}
                type="button"
                className={`rounded-lg px-3 py-1 text-xs font-semibold ${
                  tab === t ? 'bg-sky-700 text-white' : 'border border-slate-200 text-slate-700'
                }`}
                onClick={() => setTab(t)}
              >
                {t === 'prepare' ? 'Prepare' : t === 'during' ? 'During' : 'Wrap-up'}
              </button>
            ))}
          </div>

          {tab === 'prepare' ? (
            <div className="mt-3 space-y-2 text-sm">
              <p>
                Chip: {workflow.prepare.scheduleChip || 'none on file'}
              </p>
              <p>Chief complaint: {workflow.prepare.chiefComplaint || 'none on file'}</p>
              <p>
                Reviews — allergy {workflow.prepare.reviews.allergyReviewed ? 'yes' : 'no'} · meds{' '}
                {workflow.prepare.reviews.medicationReviewed ? 'yes' : 'no'} · pharmacy{' '}
                {workflow.prepare.reviews.pharmacyReview || 'none on file'}
              </p>
              {workflow.prepare.reviews.pharmacyChangedCopy ? (
                <p className="font-medium text-amber-900">{workflow.prepare.reviews.pharmacyChangedCopy}</p>
              ) : null}
              {workflow.prepare.vitalFlags.length > 0 ? (
                <ul className="text-rose-800">
                  {workflow.prepare.vitalFlags.map((f) => (
                    <li key={f.id}>
                      {f.label} — {f.action}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-slate-500">No vital flags</p>
              )}
              <p>
                BH signal:{' '}
                {workflow.prepare.bhSignal.warmHandoff
                  ? workflow.prepare.bhSignal.reason
                  : workflow.prepare.bhSignal.reason || 'none on file'}
              </p>
              <p>
                Approved POC:{' '}
                {workflow.prepare.approvedPoc.length
                  ? workflow.prepare.approvedPoc.map((p) => p.name).join(', ')
                  : 'none on file'}
              </p>
              <p>
                Results awaiting:{' '}
                {workflow.prepare.resultsAwaiting.length
                  ? workflow.prepare.resultsAwaiting.join(', ')
                  : 'none on file'}
              </p>
            </div>
          ) : null}

          {tab === 'during' ? (
            <div className="mt-3 space-y-3 text-sm">
              <div>
                <p className="text-xs font-semibold uppercase text-slate-500">Care gaps</p>
                <ul className="mt-1 space-y-1">
                  {workflow.during.careGaps.map((g) => (
                    <li key={g.gapId} className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        {g.label} · {g.status} · {g.lastDoneAt || 'none on file'}
                      </span>
                      <select
                        className="rounded border px-1 py-0.5 text-xs"
                        defaultValue=""
                        onChange={(e) => {
                          if (e.target.value) void providerGap(g.gapId, e.target.value);
                        }}
                      >
                        <option value="">Action…</option>
                        <option value="completed">completed</option>
                        <option value="ordered">ordered</option>
                        <option value="done_elsewhere">done elsewhere</option>
                        <option value="refused">refused</option>
                        <option value="not_applicable">not applicable</option>
                        <option value="reopened">reopened</option>
                      </select>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase text-slate-500">Warm handoff</p>
                <p>
                  {workflow.during.warmHandoff
                    ? 'Indicated (PHQ-9 or GAD-7 ≥10)'
                    : 'Not indicated / scores none on file'}
                </p>
                {workflow.during.warmHandoff ? (
                  <button
                    type="button"
                    className="mt-1 rounded border px-2 py-1 text-xs font-semibold"
                    onClick={() => void warmHandoffReferral()}
                  >
                    Create internal BH warm handoff
                  </button>
                ) : null}
              </div>
              <div>
                <p className="text-xs font-semibold uppercase text-slate-500">Referrals / imaging</p>
                {workflow.during.referrals.length === 0 ? (
                  <p className="text-slate-500">none on file</p>
                ) : (
                  <ul>
                    {workflow.during.referrals.map((r) => (
                      <li key={r.id}>
                        {r.specialty} · {r.status}
                        {r.internalBhWarmHandoff ? ' · warm handoff (no consult report)' : ''}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <p className="rounded-lg bg-slate-50 p-2 text-xs">{workflow.during.drFirstPdmpPrompt}</p>
              <div>
                <p className="text-xs font-semibold uppercase text-slate-500">Task to MA</p>
                <div className="mt-1 flex gap-2">
                  <input
                    className="flex-1 rounded-lg border px-2 py-1 text-sm"
                    value={taskTitle}
                    onChange={(e) => setTaskTitle(e.target.value)}
                    placeholder="Task title"
                  />
                  <button
                    type="button"
                    className="rounded-lg bg-slate-800 px-2 py-1 text-xs font-semibold text-white"
                    onClick={() => void createMaTask()}
                  >
                    Send
                  </button>
                </div>
                <ul className="mt-2 space-y-1">
                  {workflow.during.tasks.map((t) => (
                    <li key={t.id}>
                      {t.title} · {t.status}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}

          {tab === 'wrap' ? (
            <div className="mt-3 space-y-2 text-sm">
              <p className="text-xs font-semibold uppercase text-slate-500">
                E/M suggestions (2021 MDM/time · preventive · Medicare AWV) — provider picks
              </p>
              <ul className="space-y-1">
                {workflow.wrapUp.emSuggestions.map((s, i) => (
                  <li key={`${s.code}-${s.basis}-${i}`}>
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="radio"
                        name="em"
                        checked={selectedCode === s.code}
                        onChange={() => setSelectedCode(s.code)}
                      />
                      {s.code} — {s.label} ({s.basis})
                    </label>
                  </li>
                ))}
              </ul>
              <p className="text-slate-600">
                Selected: {selectedCode || 'none — provider must pick'}
              </p>
            </div>
          ) : null}
        </>
      )}
      {message ? <p className="mt-2 text-sm text-slate-700">{message}</p> : null}
    </section>
  );
}
