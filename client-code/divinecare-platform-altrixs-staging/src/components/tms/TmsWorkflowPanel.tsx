'use client';

/**
 * TMS case workflow on the TMS page (src/lib/tms/workflow.ts): stage tracker with owner and days in
 * stage, referral + intake packet, billing hand-off status, payer prescriber rule, structured
 * evaluation & safety screening, and "Schedule TMS course" (5 days a week x 20 minutes for the
 * authorized number of sessions). The help panel summarizes the owner's steps.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CalendarPlus, CheckCircle2, ChevronDown, ChevronRight, ClipboardCheck, Info, Send, ShieldCheck, Users } from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import { useAuth } from '@/features/auth';
import { bookFollowUpHref } from '@/components/visits/visitGuideHelpers';
import {
  TMS_BASELINE_INSTRUMENTS,
  TMS_CRITERIA_DX,
  TMS_DEVICES,
  TMS_DEVICE_CLEARANCE_LABEL,
  TMS_DEVICE_OTHER,
  TMS_INDICATIONS,
  TMS_PACKET_ITEMS,
  TMS_PREGNANCY,
  TMS_PRESCRIBER_RULES,
  TMS_STAGES,
  TMS_SUICIDE_RISK,
  TMS_WORKFLOW_HELP,
  TMS_SESSION_MINUTES,
  courseTargetLabel,
  daysInStage,
  devicePickValue,
  evaluationMissing,
  isTmsPrescriber,
  prescriberRuleLabel,
  referralNextStep,
  stageDurations,
  stageLabel,
  type TmsEvaluation,
  type TmsPrescriberRule,
  type TmsStage,
} from '@/lib/tms/workflow';
import type { TmsPayerRuleView, TmsWorkflowView } from '@/lib/tms/workflowDb';

const kindLabel = (k: string) => (k === 'psychiatrist' ? 'Psychiatrist' : 'NP');

/** Payer medical-necessity checklist: shown for every payer, required when the payer rule is plan specific. */
function CriteriaList({ wf, compact }: { wf: TmsWorkflowView; compact?: boolean }) {
  const open = wf.criteria.filter((c) => !c.ok);
  if (compact) {
    if (!open.length) return null;
    return (
      <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900" role="status" aria-label="Medical-necessity checklist warnings">
        <p className="flex items-center gap-1.5 font-semibold">
          <AlertTriangle size={12} aria-hidden /> Medical-necessity checklist: {open.length} item{open.length === 1 ? '' : 's'} incomplete{wf.criteriaRequired ? ' (required: plan specific)' : ''}
        </p>
        <ul className="mt-1 list-disc pl-5">
          {open.map((c) => <li key={c.key}>{c.label}</li>)}
        </ul>
      </div>
    );
  }
  return (
    <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200" aria-label="Payer medical-necessity checklist">
      {wf.criteria.map((c) => (
        <li key={c.key} className="flex items-start gap-2 p-2 text-xs">
          {c.ok ? <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-emerald-600" aria-label="Complete" /> : <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-600" aria-label="Incomplete" />}
          <span className="min-w-0 break-words">
            <span className="font-semibold text-slate-800">{c.label}</span>
            <span className="block text-slate-600">
              {c.detail}
              {c.key === 'safety' && !c.ok ? (
                <>
                  {' '}
                  <a href="#tms-safety-screening" className="font-semibold text-[#5C2D91] underline">Go to safety screening</a>
                </>
              ) : null}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

const card = 'rounded-xl border border-slate-200 bg-white p-3 sm:p-4';
const h3 = 'flex items-center gap-1.5 text-sm font-bold text-slate-800';
const lbl = 'block text-xs font-semibold text-slate-600';
const inp = 'mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 text-sm disabled:opacity-60';
const btn = 'inline-flex min-h-[38px] items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-semibold disabled:opacity-50';
const primary = `${btn} bg-[#5C2D91] text-white hover:bg-[#4a2475]`;
const secondary = `${btn} border border-slate-200 bg-white text-slate-700 hover:bg-slate-50`;

export function TmsWorkflowHelp() {
  const [open, setOpen] = useState(false);
  return (
    <section className="rounded-xl border border-sky-200 bg-sky-50/60 p-3" aria-label="TMS workflow help">
      <button type="button" className="flex w-full items-center gap-1.5 text-left text-sm font-bold text-sky-900" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
        <Info size={14} aria-hidden /> TMS workflow
      </button>
      {open ? (
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-sky-950">
          {TMS_WORKFLOW_HELP.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}

function Check({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <label className="flex min-h-[36px] items-start gap-2 text-sm text-slate-700">
      <input type="checkbox" className="mt-1 accent-[#5C2D91]" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="min-w-0 break-words">{label}</span>
    </label>
  );
}

export function TmsWorkflowPanel({ courseId, clientId, canWrite, onScheduled }: { courseId: string; clientId: string; canWrite: boolean; onScheduled?: () => void }) {
  const { user } = useAuth();
  // Any of the user's roles counts (primary role + assigned roles)
  const isPrescriber = isTmsPrescriber({ role: user?.role ? String(user.role) : null, roles: (user?.roles ?? []).map(String) });
  const [wf, setWf] = useState<TmsWorkflowView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [evalDraft, setEvalDraft] = useState<TmsEvaluation>({});
  const [evalDirty, setEvalDirty] = useState(false);
  const [sched, setSched] = useState({ startDate: '', startTime: '09:00', clinicianId: '', sessions: '', location: '' });
  const [rules, setRules] = useState<TmsPayerRuleView[] | null>(null);
  const [showRules, setShowRules] = useState(false);
  const [newRule, setNewRule] = useState({ payerLabel: '', matchTerms: '', payerTypes: '', rule: 'plan_specific' as TmsPrescriberRule, note: '' });
  const [deviceOther, setDeviceOther] = useState(false);

  const apply = useCallback((w: TmsWorkflowView) => {
    setWf(w);
    setDeviceOther(devicePickValue(w.deviceName) === TMS_DEVICE_OTHER);
    setEvalDraft(w.evaluation || {});
    setEvalDirty(false);
    setSched((s) => ({
      ...s,
      clinicianId: s.clinicianId || w.orderingProviderId || '',
      sessions: s.sessions || (w.defaultSessions ? String(w.defaultSessions) : ''),
    }));
  }, []);

  const load = useCallback(async () => {
    try {
      const r = await apiJson<{ success: true; workflow: TmsWorkflowView }>(`/api/tms/workflow/${encodeURIComponent(courseId)}`);
      apply(r.workflow);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the TMS workflow');
    }
  }, [courseId, apply]);

  useEffect(() => {
    setWf(null);
    setSched({ startDate: '', startTime: '09:00', clinicianId: '', sessions: '', location: '' });
    void load();
  }, [load]);

  const patch = async (body: Record<string, unknown>, done?: string) => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await apiJson<{ success: true; workflow: TmsWorkflowView }>(`/api/tms/workflow/${encodeURIComponent(courseId)}`, { method: 'PATCH', body: JSON.stringify(body) });
      apply(r.workflow);
      setError(null);
      if (done) setMsg(done);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  const post = async (path: string, body: Record<string, unknown> | null, done: (r: Record<string, unknown>) => string) => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await apiJson<{ success: true; workflow: TmsWorkflowView } & Record<string, unknown>>(`/api/tms/workflow/${encodeURIComponent(courseId)}/${path}`, {
        method: 'POST',
        body: JSON.stringify(body ?? {}),
      });
      apply(r.workflow);
      setError(null);
      setMsg(done(r));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not complete the action');
    } finally {
      setBusy(false);
    }
  };

  const loadRules = async () => {
    try {
      const r = await apiJson<{ success: true; rules: TmsPayerRuleView[] }>('/api/tms/payer-rules');
      setRules(r.rules);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load payer rules');
    }
  };

  const saveDefaultDevice = async () => {
    if (!wf) return;
    setBusy(true);
    setMsg(null);
    try {
      await apiJson('/api/tms/practice-defaults', { method: 'PUT', body: JSON.stringify({ deviceName: wf.deviceName, deviceDetail: wf.deviceDetail }) });
      await load();
      setMsg('Saved as the clinic default device: new TMS cases prefill it.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the default device');
    } finally {
      setBusy(false);
    }
  };

  const ruleBody = (r: TmsPayerRuleView) => ({ payerKey: r.payerKey, payerLabel: r.payerLabel, matchTerms: r.matchTerms, payerTypes: r.payerTypes, rule: r.rule, note: r.note, active: r.active, minFailedTrials: r.minFailedTrials ?? null });

  const saveRule = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      const r = await apiJson<{ success: true; rules: TmsPayerRuleView[] }>('/api/tms/payer-rules', { method: 'PUT', body: JSON.stringify(body) });
      setRules(r.rules);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the rule');
    } finally {
      setBusy(false);
    }
  };

  if (!wf) {
    return (
      <section className={card} aria-label="TMS workflow">
        {error ? <p className="text-sm text-rose-700">{error}</p> : <p className="text-sm text-slate-500">Loading the TMS workflow…</p>}
      </section>
    );
  }

  const ro = !canWrite || busy;
  const setEval = <K extends keyof TmsEvaluation>(k: K, v: TmsEvaluation[K]) => {
    setEvalDraft((d) => ({ ...d, [k]: v }));
    setEvalDirty(true);
  };
  const missing = evaluationMissing(evalDraft);
  const stageIndex = TMS_STAGES.findIndex((s) => s.value === wf.stage);
  const days = daysInStage(wf.stageEnteredAt);
  const ordering = wf.providers.find((p) => p.id === wf.orderingProviderId);
  const medMgmtHref = bookFollowUpHref({ clientId, days: null, from: new Date().toISOString().slice(0, 10), type: 'Medication Management' });
  const sessionsNum = Number(sched.sessions);
  const canSchedule = canWrite && !wf.startBlockers.length && sched.startDate && sched.clinicianId && sessionsNum > 0;
  const manualStages: TmsStage[] = ['referral', 'intake_packet', 'verification', 'evaluation', 'in_treatment', 'completed', 'discontinued'];

  return (
    <section className="space-y-3" aria-label="TMS workflow">
      {error ? (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800" role="alert">{error}</p>
      ) : null}
      {msg ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800" role="status">{msg}</p>
      ) : null}

      {/* Stage tracker */}
      <div className={card}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className={h3}>
            <ClipboardCheck size={15} aria-hidden /> TMS case: {stageLabel(wf.stage)}
          </h3>
          <p className="text-xs text-slate-500">
            Entered {new Date(wf.stageEnteredAt).toLocaleDateString()} · {days ?? 0} day{days === 1 ? '' : 's'} in stage
          </p>
        </div>
        <ol className="mt-3 flex flex-wrap gap-1.5" aria-label="Stages">
          {TMS_STAGES.map((s, i) => (
            <li
              key={s.value}
              aria-current={s.value === wf.stage ? 'step' : undefined}
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                s.value === wf.stage ? 'bg-[#5C2D91] text-white' : i < stageIndex && wf.stage !== 'discontinued' ? 'bg-violet-100 text-violet-800' : 'bg-slate-100 text-slate-500'
              }`}
            >
              {s.label}
            </li>
          ))}
        </ol>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className={lbl}>
            Owner
            <select className={inp} disabled={ro} value={wf.ownerId ?? ''} onChange={(e) => void patch({ ownerId: e.target.value || null }, 'Owner updated')}>
              <option value="">Unassigned</option>
              {user?.id && !wf.providers.some((p) => p.id === user.id) ? <option value={user.id}>Me</option> : null}
              {wf.ownerId && !wf.providers.some((p) => p.id === wf.ownerId) && wf.ownerId !== user?.id ? <option value={wf.ownerId}>{wf.ownerName ?? 'Current owner'}</option> : null}
              {wf.providers.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
          <label className={lbl}>
            Move to stage
            <select className={inp} disabled={ro} value="" onChange={(e) => e.target.value && void patch({ stage: e.target.value }, `Moved to ${stageLabel(e.target.value)}`)}>
              <option value="">Choose…</option>
              {manualStages.filter((s) => s !== wf.stage).map((s) => (
                <option key={s} value={s}>{stageLabel(s)}</option>
              ))}
            </select>
          </label>
        </div>
        {wf.stageHistory.length > 1 ? (
          <details className="mt-2 text-xs text-slate-600">
            <summary className="cursor-pointer font-semibold">Days in each stage</summary>
            <ul className="mt-1 space-y-0.5">
              {stageDurations(wf.stageHistory).map((d, i) => (
                <li key={`${d.stage}-${i}`}>
                  {stageLabel(d.stage)}: {new Date(d.enteredAt).toLocaleDateString()} · {d.days} day{d.days === 1 ? '' : 's'}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>

      {/* Steps 1-3: referral, packet, send to billing */}
      <div className={card}>
        <h3 className={h3}>1-3. Referral, intake packet, insurance to billing</h3>
        <div className="mt-2 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Referral">
          {(
            [
              ['external', 'Referral + intake packet from another provider'],
              ['none', 'No referral / no intake packet'],
            ] as const
          ).map(([v, l]) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={wf.referralSource === v}
              disabled={ro}
              onClick={() => void patch({ referralSource: v })}
              className={`${btn} ${wf.referralSource === v ? 'bg-[#5C2D91] text-white' : 'border border-slate-200 bg-white text-slate-700'}`}
            >
              {l}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-600">{referralNextStep(wf.referralSource, Boolean(wf.medMgmtAppointment))}</p>
        {wf.referralSource === 'external' ? (
          <label className={`${lbl} mt-2`}>
            Referring provider
            <input className={inp} disabled={ro} maxLength={200} defaultValue={wf.referringProvider ?? ''} onBlur={(e) => e.target.value !== (wf.referringProvider ?? '') && void patch({ referringProvider: e.target.value || null })} />
          </label>
        ) : null}
        {wf.referralSource === 'none' ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Link href={medMgmtHref} className={primary}>
              <CalendarPlus size={13} aria-hidden /> Schedule medication management
            </Link>
            {wf.medMgmtAppointment ? (
              <span className="text-xs text-slate-600">Booked: {new Date(wf.medMgmtAppointment.startsAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span>
            ) : null}
          </div>
        ) : null}
        <fieldset className="mt-3">
          <legend className={lbl}>Intake packet</legend>
          <div className="mt-1 grid gap-x-4 sm:grid-cols-2">
            {TMS_PACKET_ITEMS.map((i) => (
              <Check key={i.key} label={i.label} disabled={ro} checked={Boolean(wf.packet[i.key])} onChange={(v) => void patch({ packet: { [i.key]: v } })} />
            ))}
          </div>
          {wf.packetMissing.length ? <p className="text-xs text-amber-800">Missing: {wf.packetMissing.join(', ')}</p> : <p className="flex items-center gap-1 text-xs text-emerald-700"><CheckCircle2 size={12} aria-hidden /> Packet complete</p>}
          <p className="mt-1 text-xs text-slate-600">
            Consent forms: <Link href={wf.consentHref} className="font-semibold text-[#5C2D91] underline">TMS informed consent (consent library)</Link>
          </p>
        </fieldset>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={primary}
            disabled={ro || ['insurance_sent', 'verification'].includes(wf.stage) && wf.verificationStatus === 'pending'}
            onClick={() => void post('send-to-billing', null, () => 'Insurance sent to billing: billing has a To-Do to verify it.')}
          >
            <Send size={13} aria-hidden /> Send insurance to billing
          </button>
          <span className="text-xs text-slate-600">
            Payer: {wf.payer.name || '—'}{wf.payer.type ? ` (${wf.payer.type})` : ''}
            {wf.insuranceSentAt ? ` · sent ${new Date(wf.insuranceSentAt).toLocaleDateString()}` : ''}
          </span>
        </div>
        <CriteriaList wf={wf} compact />
      </div>

      {/* Step 4: verification */}
      <div className={card}>
        <h3 className={h3}>
          <ShieldCheck size={15} aria-hidden /> 4. Verification &amp; authorization (billing)
        </h3>
        <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
          <div><dt className="inline text-slate-500">Verification: </dt><dd className="inline font-semibold">{wf.verificationStatus === 'verified' ? 'Verified' : wf.verificationStatus === 'pending' ? 'Waiting on billing' : 'Not sent'}</dd></div>
          <div><dt className="inline text-slate-500">Authorization: </dt><dd className="inline font-semibold">{wf.authStatus === 'approved' ? 'Approved' : wf.authStatus === 'not_required' ? 'Not required' : wf.authStatus === 'denied' ? 'Denied / not covered' : wf.authStatus === 'pending' ? 'Requested (pending)' : '—'}</dd></div>
          <div><dt className="inline text-slate-500">Authorized sessions: </dt><dd className="inline font-semibold">{wf.authorizedSessions ?? '—'}</dd></div>
          <div><dt className="inline text-slate-500">Course target: </dt><dd className="inline font-semibold">{courseTargetLabel(wf.targetSessions)}</dd></div>
          {wf.priorAuth ? (
            <div><dt className="inline text-slate-500">Prior auth on file: </dt><dd className="inline">{wf.priorAuth.authNumber || 'no number'} · {wf.priorAuth.unitsApproved} units{wf.priorAuth.endDate ? ` · to ${wf.priorAuth.endDate}` : ''}</dd></div>
          ) : null}
        </dl>
        {wf.billingNote ? <p className="mt-1 text-xs text-slate-600">Billing note: {wf.billingNote}</p> : null}
      </div>

      {/* Payer prescriber rule */}
      <div className={card}>
        <h3 className={h3}>
          <Users size={15} aria-hidden /> Who may order / supervise (payer rule)
        </h3>
        <p className="mt-1 text-xs text-slate-600">
          {wf.matchedRules.length ? wf.matchedRules.map((r) => `${r.payerLabel}: ${prescriberRuleLabel(r.rule)}`).join(' · ') : 'No TMS payer rule matches this client’s payer.'}
        </p>
        {wf.matchedRules.filter((r) => r.hint).map((r) => (
          <p key={r.payerKey} className="mt-1 flex items-start gap-1.5 text-xs text-sky-900">
            <Info size={12} className="mt-0.5 shrink-0" aria-hidden /> {r.payerLabel}: {r.hint}
          </p>
        ))}
        <label className={`${lbl} mt-2`}>
          Ordering / supervising provider
          <select className={inp} disabled={ro} value={wf.orderingProviderId ?? ''} onChange={(e) => void patch({ orderingProviderId: e.target.value || null })}>
            <option value="">Choose a psychiatrist or NP…</option>
            {wf.providers.map((p) => (
              <option key={p.id} value={p.id}>{p.name} ({kindLabel(p.kind)})</option>
            ))}
          </select>
        </label>
        <p className={`mt-2 flex items-start gap-1.5 text-xs ${wf.prescriber.ok && !wf.prescriber.needsVerification ? 'text-emerald-700' : 'text-amber-800'}`}>
          {wf.prescriber.ok && !wf.prescriber.needsVerification ? <CheckCircle2 size={13} className="mt-0.5 shrink-0" aria-hidden /> : <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden />}
          {wf.prescriber.message}
        </p>
        {wf.prescriber.needsVerification ? (
          <div className="mt-2 grid gap-2 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center">
            <Check label="Verified with plan" disabled={ro} checked={Boolean(wf.payerVerified)} onChange={(v) => void patch({ payerVerified: v })} />
            <input
              aria-label="Plan verification note"
              placeholder="Who you spoke with, date, reference number"
              maxLength={500}
              disabled={ro}
              className={inp}
              defaultValue={wf.payerVerifyNote ?? ''}
              onBlur={(e) => e.target.value !== (wf.payerVerifyNote ?? '') && void patch({ payerVerifyNote: e.target.value || null })}
            />
          </div>
        ) : null}
        <button type="button" className="mt-2 text-xs font-semibold text-[#5C2D91] underline" onClick={() => { setShowRules((v) => !v); if (!rules) void loadRules(); }}>
          {showRules ? 'Hide' : 'Edit'} payer rules
        </button>
        {showRules && rules ? (
          <div className="mt-2 space-y-2">
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {rules.map((r) => (
                <li key={r.id} className="grid gap-2 p-2 text-xs sm:grid-cols-[minmax(0,1fr)_12rem_7rem_auto] sm:items-center">
                  <span className="min-w-0 break-words">
                    <span className="font-semibold">{r.payerLabel}</span> · matches {[...r.matchTerms, ...r.payerTypes.map((t) => `type ${t}`)].join(', ') || '—'}
                    {r.source !== 'staff' ? <span className="ml-1 text-slate-500">(owner-provided)</span> : null}
                    {r.hint ? <span className="block text-sky-900">{r.hint}</span> : null}
                  </span>
                  <select aria-label={`Rule for ${r.payerLabel}`} className="rounded-lg border border-slate-200 px-2 py-1.5" disabled={ro} value={r.rule} onChange={(e) => void saveRule({ ...ruleBody(r), rule: e.target.value })}>
                    {TMS_PRESCRIBER_RULES.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  <label className="text-[11px] text-slate-600">
                    Payer minimum failed trials
                    <input
                      type="number"
                      min={1}
                      max={20}
                      placeholder="__"
                      aria-label={`Payer minimum failed trials for ${r.payerLabel}`}
                      className="mt-0.5 w-full rounded-lg border border-slate-200 px-2 py-1.5"
                      disabled={ro}
                      defaultValue={r.minFailedTrials ?? ''}
                      onBlur={(e) => {
                        const n = e.target.value === '' ? null : Math.floor(Number(e.target.value));
                        if (n !== (r.minFailedTrials ?? null) && (n === null || (n >= 1 && n <= 20))) void saveRule({ ...ruleBody(r), minFailedTrials: n });
                      }}
                    />
                  </label>
                  <Check label="Active" disabled={ro} checked={r.active !== false} onChange={(v) => void saveRule({ ...ruleBody(r), active: v })} />
                </li>
              ))}
            </ul>
            <div className="grid gap-2 rounded-lg border border-dashed border-slate-300 p-2 sm:grid-cols-2">
              <input aria-label="Payer name" placeholder="Payer name" className={inp} value={newRule.payerLabel} onChange={(e) => setNewRule({ ...newRule, payerLabel: e.target.value })} />
              <input aria-label="Match terms" placeholder="Name terms, comma separated" className={inp} value={newRule.matchTerms} onChange={(e) => setNewRule({ ...newRule, matchTerms: e.target.value })} />
              <input aria-label="Payer types" placeholder="Payer types (e.g. medicaid), optional" className={inp} value={newRule.payerTypes} onChange={(e) => setNewRule({ ...newRule, payerTypes: e.target.value })} />
              <select aria-label="Rule" className={inp} value={newRule.rule} onChange={(e) => setNewRule({ ...newRule, rule: e.target.value as TmsPrescriberRule })}>
                {TMS_PRESCRIBER_RULES.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <button
                type="button"
                className={secondary}
                disabled={ro || newRule.payerLabel.trim().length < 2}
                onClick={() => {
                  const split = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
                  void saveRule({ payerLabel: newRule.payerLabel, matchTerms: split(newRule.matchTerms), payerTypes: split(newRule.payerTypes), rule: newRule.rule, note: newRule.note || null }).then(() =>
                    setNewRule({ payerLabel: '', matchTerms: '', payerTypes: '', rule: 'plan_specific', note: '' })
                  );
                }}
              >
                Add rule
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {/* Evaluation & safety screening */}
      <div className={card}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className={h3}>5. Evaluation, safety screening &amp; consent</h3>
          <span className={`text-xs font-semibold ${missing.length ? 'text-amber-800' : 'text-emerald-700'}`}>{missing.length ? `${missing.length} item${missing.length === 1 ? '' : 's'} to complete` : 'Screening complete'}</span>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className={lbl}>
            Indication
            <select className={inp} disabled={ro} value={wf.indication ?? ''} onChange={(e) => void patch({ indication: e.target.value || null })}>
              <option value="">Choose…</option>
              {TMS_INDICATIONS.map((i) => (
                <option key={i.value} value={i.value}>{i.label}</option>
              ))}
            </select>
          </label>
          <label className={lbl}>
            TMS device (FDA-cleared system)
            <select
              className={inp}
              disabled={ro}
              value={deviceOther ? TMS_DEVICE_OTHER : devicePickValue(wf.deviceName)}
              onChange={(e) => {
                const v = e.target.value;
                if (v === TMS_DEVICE_OTHER) {
                  setDeviceOther(true);
                  return;
                }
                setDeviceOther(false);
                void patch({ deviceName: v || null });
              }}
            >
              <option value="">Choose…</option>
              {TMS_DEVICES.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
              <option value={TMS_DEVICE_OTHER}>Other (specify)</option>
            </select>
          </label>
          {deviceOther ? (
            <label className={lbl}>
              Other device (make / model)
              <input
                className={inp}
                disabled={ro}
                maxLength={120}
                defaultValue={devicePickValue(wf.deviceName) === TMS_DEVICE_OTHER ? wf.deviceName ?? '' : ''}
                onBlur={(e) => e.target.value.trim() && e.target.value !== (wf.deviceName ?? '') && void patch({ deviceName: e.target.value })}
              />
            </label>
          ) : null}
          <label className={`${lbl} sm:col-span-2`}>
            Cleared indications / coil (per the device&apos;s labeling)
            <input
              className={inp}
              disabled={ro}
              maxLength={500}
              key={`detail-${wf.deviceDetail ?? ''}`}
              defaultValue={wf.deviceDetail ?? ''}
              onBlur={(e) => e.target.value !== (wf.deviceDetail ?? '') && void patch({ deviceDetail: e.target.value || null })}
            />
          </label>
        </div>
        <p className="mt-1 text-xs text-slate-600">
          {wf.deviceFromPracticeDefault ? 'Prefilled from the clinic default device. ' : ''}
          Clinic default: {wf.practiceDevice.deviceName ?? 'not set'}
          {wf.deviceName && wf.deviceName !== wf.practiceDevice.deviceName ? (
            <button type="button" className="ml-2 font-semibold text-[#5C2D91] underline disabled:opacity-50" disabled={ro} onClick={() => void saveDefaultDevice()}>
              Set this device as the clinic default
            </button>
          ) : null}
        </p>
        <Check
          disabled={ro || !wf.indication || !wf.deviceName}
          checked={Boolean(wf.deviceClearedForIndication)}
          onChange={(v) => void patch({ deviceClearedForIndication: v })}
          label={`${TMS_DEVICE_CLEARANCE_LABEL} (${wf.indication === 'ocd' ? 'OCD' : wf.indication === 'mdd' ? 'MDD' : 'choose the indication'}).`}
        />

        <fieldset className="mt-3 space-y-2">
          <legend className={lbl}>Diagnosis and presentation</legend>
          <Check label="Diagnosis confirmed" disabled={ro} checked={Boolean(evalDraft.dxConfirmed)} onChange={(v) => setEval('dxConfirmed', v)} />
          <div className="grid gap-2 sm:grid-cols-2">
            <label className={lbl}>Current symptoms<textarea rows={2} className={inp} disabled={ro} value={evalDraft.symptoms ?? ''} onChange={(e) => setEval('symptoms', e.target.value)} /></label>
            <label className={lbl}>Functional impact<textarea rows={2} className={inp} disabled={ro} value={evalDraft.functionalImpact ?? ''} onChange={(e) => setEval('functionalImpact', e.target.value)} /></label>
          </div>
        </fieldset>

        <fieldset className="mt-3 space-y-2">
          <legend className={lbl}>History and current treatment</legend>
          <Check label="Prior antidepressant trials reviewed (medication, dose, duration, response, tolerability) in the ADT table under Contraindication Screening" disabled={ro} checked={Boolean(evalDraft.adtReviewed)} onChange={(v) => setEval('adtReviewed', v)} />
          <div className="grid gap-2 sm:grid-cols-2">
            <label className={lbl}>Psychiatric history<textarea rows={2} className={inp} disabled={ro} value={evalDraft.psychHistory ?? ''} onChange={(e) => setEval('psychHistory', e.target.value)} /></label>
            <label className={lbl}>Current treatment<textarea rows={2} className={inp} disabled={ro} value={evalDraft.currentTreatment ?? ''} onChange={(e) => setEval('currentTreatment', e.target.value)} /></label>
            <label className={lbl}>Current medications<textarea rows={2} className={inp} disabled={ro} value={evalDraft.currentMedications ?? ''} onChange={(e) => setEval('currentMedications', e.target.value)} /></label>
            <label className={lbl}>Substance use<textarea rows={2} className={inp} disabled={ro} value={evalDraft.substanceUse ?? ''} onChange={(e) => setEval('substanceUse', e.target.value)} /></label>
          </div>
        </fieldset>

        <fieldset className="mt-3 scroll-mt-20 space-y-2" id="tms-safety-screening">
          <legend className={lbl}>Safety screening</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className={lbl}>
              Active psychosis
              <select className={inp} disabled={ro} value={evalDraft.activePsychosis ?? ''} onChange={(e) => setEval('activePsychosis', (e.target.value || undefined) as TmsEvaluation['activePsychosis'])}>
                <option value="">Choose…</option>
                <option value="none">None</option>
                <option value="present">Present</option>
              </select>
            </label>
            <span />
            <label className={lbl}>
              Seizure risk
              <select className={inp} disabled={ro} value={evalDraft.seizureRisk ?? ''} onChange={(e) => setEval('seizureRisk', (e.target.value || undefined) as TmsEvaluation['seizureRisk'])}>
                <option value="">Choose…</option>
                <option value="none">None identified</option>
                <option value="present">Risk factor present</option>
              </select>
            </label>
            {evalDraft.seizureRisk === 'present' ? (
              <label className={lbl}>Seizure risk detail<input className={inp} disabled={ro} value={evalDraft.seizureDetail ?? ''} onChange={(e) => setEval('seizureDetail', e.target.value)} /></label>
            ) : <span />}
            <label className={lbl}>
              Implanted devices / metal
              <select className={inp} disabled={ro} value={evalDraft.implantsMetal ?? ''} onChange={(e) => setEval('implantsMetal', (e.target.value || undefined) as TmsEvaluation['implantsMetal'])}>
                <option value="">Choose…</option>
                <option value="none">None</option>
                <option value="present">Present</option>
              </select>
            </label>
            {evalDraft.implantsMetal === 'present' ? (
              <label className={lbl}>Device / metal detail<input className={inp} disabled={ro} value={evalDraft.implantsDetail ?? ''} onChange={(e) => setEval('implantsDetail', e.target.value)} /></label>
            ) : <span />}
            <label className={lbl}>Neurological history<textarea rows={2} className={inp} disabled={ro} value={evalDraft.neuroHistory ?? ''} onChange={(e) => setEval('neuroHistory', e.target.value)} /></label>
            <label className={lbl}>
              Pregnancy
              <select className={inp} disabled={ro} value={evalDraft.pregnancy ?? ''} onChange={(e) => setEval('pregnancy', (e.target.value || undefined) as TmsEvaluation['pregnancy'])}>
                <option value="">Choose…</option>
                {TMS_PREGNANCY.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </label>
            <label className={`${lbl} sm:col-span-2`}>Other medical considerations<textarea rows={2} className={inp} disabled={ro} value={evalDraft.otherMedical ?? ''} onChange={(e) => setEval('otherMedical', e.target.value)} /></label>
          </div>
          <Check label="Device-specific contraindication screen completed (manufacturer's screening form)" disabled={ro} checked={Boolean(evalDraft.deviceScreenDone)} onChange={(v) => setEval('deviceScreenDone', v)} />
        </fieldset>

        <fieldset className="mt-3 space-y-2">
          <legend className={lbl}>Risk assessment</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className={lbl}>
              Suicide risk
              <select className={inp} disabled={ro} value={evalDraft.suicideRisk ?? ''} onChange={(e) => setEval('suicideRisk', (e.target.value || undefined) as TmsEvaluation['suicideRisk'])}>
                <option value="">Choose…</option>
                {TMS_SUICIDE_RISK.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </label>
            <label className={lbl}>Escalation plan<textarea rows={2} className={inp} disabled={ro} value={evalDraft.escalationPlan ?? ''} onChange={(e) => setEval('escalationPlan', e.target.value)} /></label>
          </div>
        </fieldset>

        <fieldset className="mt-3 space-y-2">
          <legend className={lbl}>
            Payer medical-necessity documentation {wf.criteriaRequired ? '(required: plan specific)' : '(common payer criteria; plan specifics vary)'}
          </legend>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className={lbl}>
              Diagnosis
              <select className={inp} disabled={ro} value={evalDraft.criteriaDx ?? ''} onChange={(e) => setEval('criteriaDx', (e.target.value || undefined) as TmsEvaluation['criteriaDx'])}>
                <option value="">Choose…</option>
                {TMS_CRITERIA_DX.map((d) => (
                  <option key={d.value} value={d.value}>{d.label}</option>
                ))}
              </select>
            </label>
            <div className="text-xs text-slate-700">
              <span className={lbl}>Prior antidepressant trials</span>
              <p className="mt-1">
                {wf.failedTrials} listed in the ADT table · Payer minimum: {wf.payerMinimum ?? '__'}
              </p>
            </div>
          </div>
          <Check label="Trials span at least 2 antidepressant classes, each at adequate dose and duration (failed or not tolerated)" disabled={ro} checked={Boolean(evalDraft.adtAdequacyConfirmed)} onChange={(v) => setEval('adtAdequacyConfirmed', v)} />
          <div className="grid gap-2 sm:grid-cols-2">
            <label className={lbl}>
              Trial of evidence-based psychotherapy
              <select className={inp} disabled={ro} value={evalDraft.psychotherapyTrial ?? ''} onChange={(e) => setEval('psychotherapyTrial', (e.target.value || undefined) as TmsEvaluation['psychotherapyTrial'])}>
                <option value="">Choose…</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </label>
            <label className={lbl}>Psychotherapy dates / type<input className={inp} disabled={ro} maxLength={300} value={evalDraft.psychotherapyDates ?? ''} onChange={(e) => setEval('psychotherapyDates', e.target.value)} /></label>
            <label className={lbl}>
              Baseline standardized score (score only)
              <select className={inp} disabled={ro} value={evalDraft.baselineInstrument ?? ''} onChange={(e) => setEval('baselineInstrument', (e.target.value || undefined) as TmsEvaluation['baselineInstrument'])}>
                <option value="">Choose…</option>
                {TMS_BASELINE_INSTRUMENTS.map((b) => (
                  <option key={b.value} value={b.value}>{b.label}</option>
                ))}
              </select>
            </label>
            <label className={lbl}>
              Baseline total
              <input
                type="number"
                min={0}
                max={TMS_BASELINE_INSTRUMENTS.find((b) => b.value === evalDraft.baselineInstrument)?.max ?? 60}
                className={inp}
                disabled={ro || !evalDraft.baselineInstrument}
                value={evalDraft.baselineScore ?? ''}
                onChange={(e) => setEval('baselineScore', e.target.value === '' ? undefined : Math.floor(Number(e.target.value)))}
              />
            </label>
            <label className={lbl}>
              Planned sessions (treatment plan)
              <input type="number" min={1} max={200} className={inp} disabled={ro} placeholder="Not set" value={evalDraft.planSessions ?? ''} onChange={(e) => setEval('planSessions', e.target.value === '' ? undefined : Math.floor(Number(e.target.value)))} />
            </label>
            <label className={lbl}>Taper plan<input className={inp} disabled={ro} maxLength={500} value={evalDraft.planTaper ?? ''} onChange={(e) => setEval('planTaper', e.target.value)} /></label>
          </div>
          <CriteriaList wf={wf} />
          {evalDirty ? <p className="text-xs text-slate-500">Save the evaluation to update the checklist.</p> : null}
        </fieldset>

        <fieldset className="mt-3 space-y-1">
          <legend className={lbl}>Consent and plan</legend>
          <Check label="Explained the protocol, frequency, benefits, risks, alternatives and follow-up" disabled={ro} checked={Boolean(evalDraft.protocolExplained)} onChange={(v) => setEval('protocolExplained', v)} />
          <div className="grid gap-2 sm:grid-cols-[auto_12rem] sm:items-center">
            <Check label="Informed consent obtained" disabled={ro} checked={Boolean(evalDraft.consentObtained)} onChange={(v) => setEval('consentObtained', v)} />
            <input type="date" aria-label="Consent date" className={inp} disabled={ro || !evalDraft.consentObtained} value={evalDraft.consentDate ?? ''} onChange={(e) => setEval('consentDate', e.target.value || undefined)} />
          </div>
          <p className="text-xs text-slate-600">
            Consent form: <Link href={wf.consentHref} className="font-semibold text-[#5C2D91] underline">TMS informed consent (consent library)</Link>
          </p>
          <Check label="TMS treatment plan documented" disabled={ro} checked={Boolean(evalDraft.treatmentPlanDocumented)} onChange={(v) => setEval('treatmentPlanDocumented', v)} />
          <Check label="Monitoring plan: symptoms, response, adverse effects, attendance and risk changes reviewed through the course" disabled={ro} checked={Boolean(evalDraft.monitoringPlan)} onChange={(v) => setEval('monitoringPlan', v)} />
          <Check
            label={`Prescriber determination: TMS is indicated${evalDraft.determinationBy ? ` (recorded by ${evalDraft.determinationBy}${evalDraft.determinationAt ? `, ${new Date(evalDraft.determinationAt).toLocaleDateString()}` : ''})` : isPrescriber ? '' : ' (psychiatrist / NP only)'}`}
            disabled={ro || !isPrescriber}
            checked={Boolean(evalDraft.prescriberDetermination)}
            onChange={(v) => setEval('prescriberDetermination', v)}
          />
        </fieldset>
        {missing.length ? (
          <details className="mt-2 text-xs text-amber-900">
            <summary className="cursor-pointer font-semibold">Still to complete ({missing.length})</summary>
            <ul className="mt-1 list-disc pl-5">
              {missing.map((m) => <li key={m}>{m}</li>)}
            </ul>
          </details>
        ) : null}
        <div className="mt-3">
          <button
            type="button"
            className={primary}
            disabled={ro || !evalDirty}
            onClick={() => {
              const { determinationBy: _b, determinationAt: _a, ...body } = evalDraft;
              void _b;
              void _a;
              void patch({ evaluation: body }, 'Evaluation saved');
            }}
          >
            Save evaluation
          </button>
        </div>
      </div>

      {/* Schedule course */}
      <div className={card}>
        <h3 className={h3}>
          <CalendarPlus size={15} aria-hidden /> 6. Schedule TMS course
        </h3>
        <p className="mt-1 text-xs text-slate-600">
          5 days a week (Mon-Fri), {TMS_SESSION_MINUTES} minutes a day. Weekly {wf.weeklyMeasure.label}
          {wf.weeklyMeasure.instrumentId ? ' is assigned through Measures when the course is booked.' : '.'}
          {wf.weeklyMeasure.note ? ` ${wf.weeklyMeasure.note}` : ''}
        </p>
        {wf.scheduledSessions ? (
          <p className="mt-1 text-xs font-semibold text-emerald-700">Course booked: {wf.scheduledSessions} sessions.</p>
        ) : (
          <p className="mt-1 text-xs text-slate-600">Course target: {courseTargetLabel(wf.targetSessions)}</p>
        )}
        <CriteriaList wf={wf} compact />
        {wf.startBlockers.length ? (
          <ul className="mt-2 space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900" aria-label="Before the course can start">
            {wf.startBlockers.map((b) => (
              <li key={b} className="flex items-start gap-1.5"><AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden /> {b}</li>
            ))}
          </ul>
        ) : null}
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className={lbl}>Start date<input type="date" className={inp} disabled={ro} value={sched.startDate} onChange={(e) => setSched({ ...sched, startDate: e.target.value })} /></label>
          <label className={lbl}>Time<input type="time" className={inp} disabled={ro} value={sched.startTime} onChange={(e) => setSched({ ...sched, startTime: e.target.value })} /></label>
          <label className={lbl}>
            Provider
            <select className={inp} disabled={ro} value={sched.clinicianId} onChange={(e) => setSched({ ...sched, clinicianId: e.target.value })}>
              <option value="">Choose…</option>
              {wf.providers.map((p) => (
                <option key={p.id} value={p.id}>{p.name} ({kindLabel(p.kind)})</option>
              ))}
            </select>
          </label>
          <label className={lbl}>
            Sessions {wf.authorizedSessions ? `(authorized ${wf.authorizedSessions})` : '(from the order)'}
            <input type="number" min={1} max={wf.authorizedSessions ?? 200} required className={inp} disabled={ro} value={sched.sessions} placeholder="Required" onChange={(e) => setSched({ ...sched, sessions: e.target.value })} />
          </label>
        </div>
        {ordering && sched.clinicianId && sched.clinicianId !== ordering.id ? (
          <p className="mt-1 text-xs text-slate-600">The scheduled provider differs from the ordering provider; the payer rule is checked for both.</p>
        ) : null}
        <button
          type="button"
          className={`${primary} mt-3`}
          disabled={!canSchedule || busy}
          onClick={() =>
            void post('schedule', { startDate: sched.startDate, startTime: sched.startTime, clinicianId: sched.clinicianId, sessions: sessionsNum, location: sched.location || null }, (r) => {
              onScheduled?.();
              const skipped = Array.isArray(r.skipped) ? r.skipped.length : 0;
              return `Booked ${r.booked} of ${r.requested} sessions${skipped ? `; ${skipped} not booked (conflicts / past dates): add them from the schedule` : ''}.${r.measureNote ? ` ${r.measureNote}` : ''}`;
            })
          }
        >
          <CalendarPlus size={13} aria-hidden /> Schedule TMS course
        </button>
      </div>
    </section>
  );
}
