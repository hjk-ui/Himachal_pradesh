'use client';

import { useState } from 'react';
import { courseTargetLabel } from '@/lib/tms/workflow';
import Link from 'next/link';
import { AlertTriangle, ClipboardList, MessageSquare, Users } from 'lucide-react';
import { ImportedPlanNotice } from '@/features/ehr/ImportedPlanNotice';
import type { ImportedPlanSource } from '@/lib/migration/valantTreatmentPlans';
import { AUTH_ENDING_DAYS, AUTH_LOW_VISITS, type AuthSummary } from '@/lib/clients/chartBanner';
import { ChartSection, DataNote, Pill, SectionState, fmtDate, fmtDateTime } from './ChartSection';
import { useChartSection } from './useChartSection';
import { AuthForecastDetail, useAuthForecasts } from '@/components/ai/AuthForecastClient';
import { AuthForecastRenewalButton } from '@/components/ai/AuthForecastRenewalDialog';
import { actionLabel, describeResource, outcomeLabel, sensitiveAccessLabel } from '@/lib/audit/auditLabels';

const q = (clientId: string) => `?clientId=${encodeURIComponent(clientId)}`;

// ─── Treatment plan ──────────────────────────────────────────────────────────

type Plan = {
  id: string;
  title?: string;
  status?: string;
  reviewDueAt?: string | null;
  diagnosisCodes?: string[];
  goals?: unknown;
  updatedAt?: string;
  source?: ImportedPlanSource | null;
  supersedesId?: string | null;
};

function goalCount(goals: unknown): number {
  if (Array.isArray(goals)) return goals.length;
  if (goals && typeof goals === 'object' && Array.isArray((goals as { goals?: unknown[] }).goals)) return (goals as { goals: unknown[] }).goals.length;
  return 0;
}

/** Plans come from GET /api/ehr/treatment-plans?clientId= (already loaded by the chart) */
export function TreatmentPlanTab({ clientId, plans }: { clientId: string; plans: Plan[] }) {
  const [now] = useState(() => Date.now());
  return (
    <ChartSection title="Treatment plan" subtitle="Treatment plans on file for this client" fullListHref={`/dashboard/ehr/treatment-plans${q(clientId)}`} fullListLabel="Open treatment plans">
      {!plans.length ? <p className="text-sm text-slate-500">No treatment plan on file.</p> : null}
      {plans.map((p) => {
        const overdue = p.reviewDueAt ? new Date(p.reviewDueAt).getTime() < now && p.status !== 'CLOSED' : false;
        return (
          <div key={p.id} className="space-y-1.5 rounded-xl border border-slate-200 p-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <ClipboardList size={14} className="text-[#5C2D91]" />
              <span className="font-semibold text-slate-900">{p.title || 'Treatment plan'}</span>
              {p.status ? <Pill tone={p.status === 'ACTIVE' ? 'emerald' : 'slate'}>{p.status.toLowerCase()}</Pill> : null}
              {overdue ? <Pill tone="rose">Review overdue</Pill> : null}
              <span className="text-xs text-slate-500">
                {p.source && !p.reviewDueAt ? 'Next review: not in Valant export' : `Review due ${fmtDate(p.reviewDueAt ?? null)}`} ·{' '}
                {p.source && !goalCount(p.goals) ? 'goals in Valant' : `${goalCount(p.goals)} goal${goalCount(p.goals) === 1 ? '' : 's'}`}
                {p.diagnosisCodes?.length ? ` · ${p.diagnosisCodes.join(', ')}` : ''}
              </span>
            </div>
            {p.source ? <ImportedPlanNotice source={p.source} reviewDueAt={p.reviewDueAt ?? null} status={p.status} clientId={clientId} planId={p.id} rewriteDraftId={plans.find((x) => x.supersedesId === p.id && x.status !== 'CLOSED')?.id ?? null} /> : null}
          </div>
        );
      })}
    </ChartSection>
  );
}

// ─── Authorizations ──────────────────────────────────────────────────────────

type AuthData = { authorizations: (AuthSummary & { status: string; notes: string | null; active: boolean })[] };

export function AuthorizationsTab({ clientId }: { clientId: string }) {
  const { data, error, loading } = useChartSection<AuthData>(clientId, 'authorizations');
  const forecast = useAuthForecasts(clientId);
  return (
    <ChartSection title="Authorizations" subtitle="Prior authorizations for this client: visits used and remaining" fullListHref="/dashboard/billing/authorizations?tab=tracking">
      <SectionState loading={loading} error={error} empty={Boolean(data && !data.authorizations.length)} emptyText="No prior authorizations on file." />
      {data?.authorizations.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 font-semibold uppercase text-slate-600">
                <th className="px-3 py-2">Payer / auth #</th>
                <th className="px-3 py-2">CPT</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Used / approved</th>
                <th className="px-3 py-2">Remaining</th>
                <th className="px-3 py-2">Dates</th>
                <th className="px-3 py-2">Forecast</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.authorizations.map((a) => (
                <tr key={a.id} className={a.active && a.warn ? 'bg-amber-50/50' : ''}>
                  <td className="px-3 py-2 font-semibold text-slate-900">
                    {a.payer}
                    {a.authNumber ? <span className="ml-1 font-mono text-[11px] text-slate-500">#{a.authNumber}</span> : null}
                  </td>
                  <td className="px-3 py-2 font-mono">{a.cptCodes.join(', ') || '—'}</td>
                  <td className="px-3 py-2">
                    <Pill tone={a.active ? 'emerald' : a.status === 'DENIED' ? 'rose' : 'slate'}>{a.active ? 'active' : a.status.toLowerCase()}</Pill>
                  </td>
                  <td className="px-3 py-2">
                    {a.unitsUsed} / {a.unitsApproved}
                  </td>
                  <td className="px-3 py-2 font-semibold">
                    {a.unitsRemaining}
                    {a.active && a.warn ? (
                      <span className="ml-1 inline-flex items-center gap-0.5 text-amber-700">
                        <AlertTriangle size={11} />
                        {a.lowVisits ? `under ${AUTH_LOW_VISITS} left` : ''}
                        {a.lowVisits && a.endingSoon ? ' · ' : ''}
                        {a.endingSoon ? (a.daysToEnd != null && a.daysToEnd < 0 ? 'ended' : `ends in ${a.daysToEnd} d`) : ''}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    {fmtDate(a.startDate)} to {a.endDate ? fmtDate(a.endDate) : 'open'}
                  </td>
                  <td className="px-3 py-2">
                    {forecast.byId.get(a.id) ? (
                      <div className="space-y-1">
                        <AuthForecastDetail forecast={forecast.byId.get(a.id)!} />
                        <AuthForecastRenewalButton priorAuthId={a.id} compact onRecorded={forecast.reload} />
                      </div>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <p className="text-[11px] text-slate-500">
        Warning when fewer than {AUTH_LOW_VISITS} visits remain or the authorization ends within {AUTH_ENDING_DAYS} days. Units used are as recorded on the authorization.
        Forecast: visits used = the higher of units recorded and attended visits since the start; run-out projects the 8-week pace and scheduled visits.
      </p>
    </ChartSection>
  );
}

// ─── Eligibility (inside Billing & insurance) ────────────────────────────────

type EligData = { checks: { id: string; payerName: string; memberIdLast4: string | null; dos: string | null; status: string; checkedAt: string | null; checkedBy: string | null }[] };

export function EligibilityPanel({ clientId }: { clientId: string }) {
  const { data, error, loading } = useChartSection<EligData>(clientId, 'eligibility');
  return (
    <ChartSection title="Eligibility checks (270/271)" subtitle="Recorded eligibility inquiries for this client" fullListHref={`/dashboard/ehr/eligibility${q(clientId)}`} fullListLabel="Run or view eligibility">
      <SectionState loading={loading} error={error} empty={Boolean(data && !data.checks.length)} emptyText="No eligibility check recorded for this client yet." />
      {data?.checks.map((c) => (
        <div key={c.id} className="flex flex-wrap items-center gap-2 text-sm">
          <Pill tone={c.status === 'ELIGIBLE' ? 'emerald' : c.status === 'INELIGIBLE' || c.status === 'ERROR' ? 'rose' : 'amber'}>{c.status.toLowerCase()}</Pill>
          <span className="font-semibold text-slate-800">{c.payerName}</span>
          <span className="text-xs text-slate-500">
            {c.memberIdLast4 ? `member •••• ${c.memberIdLast4} · ` : ''}DOS {fmtDate(c.dos)} · checked {fmtDateTime(c.checkedAt)}
            {c.checkedBy ? ` by ${c.checkedBy}` : ''}
          </span>
        </div>
      ))}
    </ChartSection>
  );
}

// ─── Care team & referrals ───────────────────────────────────────────────────

type CareData = {
  team: { id: string; name: string; role: string; credentials: string | null; isPrimary: boolean }[];
  prpReferrals: { id: string; displayId: string | null; diagnosisCode: string; prescriberName: string; referralDate: string | null; recommendedDomains: string[] }[];
};

export function CareTeamReferralsTab({ clientId, assignedClinician }: { clientId: string; assignedClinician: string | null }) {
  const { data, error, loading } = useChartSection<CareData>(clientId, 'care-team');
  return (
    <div className="space-y-4">
      <ChartSection title="Care team" subtitle="Assigned clinician and treatment team for this client" fullListHref="/dashboard/clients" fullListLabel="Open client roster">
        <SectionState loading={loading} error={error} />
        <p className="text-sm text-slate-700">
          <span className="text-xs font-semibold text-slate-500">Assigned clinician: </span>
          {assignedClinician || 'Unassigned'}
        </p>
        {data && !data.team.length ? <p className="text-sm text-slate-500">No treatment team members recorded. Add them from the Summary tab.</p> : null}
        <ul className="space-y-1.5">
          {data?.team.map((m) => (
            <li key={m.id} className="flex items-center gap-2 text-sm">
              <Users size={13} className="text-[#5C2D91]" />
              <span className="font-semibold text-slate-900">{m.name}</span>
              {m.credentials ? <span className="text-xs text-slate-500">{m.credentials}</span> : null}
              <span className="text-xs text-slate-600">{m.role}</span>
              {m.isPrimary ? <Pill tone="purple">Primary</Pill> : null}
            </li>
          ))}
        </ul>
      </ChartSection>
      <ChartSection title="Referrals" subtitle="PRP referrals linked to this chart" fullListHref="/dashboard/prp" fullListLabel="Open PRP">
        {data && !data.prpReferrals.length ? <p className="text-sm text-slate-500">No PRP referrals linked to this chart.</p> : null}
        {data?.prpReferrals.map((r) => (
          <div key={r.id} className="text-sm text-slate-700">
            <span className="font-semibold">{r.displayId || 'PRP referral'}</span> · {fmtDate(r.referralDate)} · {r.diagnosisCode} · {r.prescriberName}
            {r.recommendedDomains.length ? <span className="text-xs text-slate-500"> · {r.recommendedDomains.join(', ')}</span> : null}
          </div>
        ))}
        <DataNote>
          Community / outside referrals (Community &gt; Referrals) are stored by patient name only with no chart link, so they are not listed here.{' '}
          <Link href="/dashboard/community" className="font-semibold text-[#5C2D91] hover:underline">
            Open community referrals
          </Link>
        </DataNote>
      </ChartSection>
    </div>
  );
}

// ─── Messages ────────────────────────────────────────────────────────────────

type MsgData = { threads: { id: string; topic: string; status: string; risk: string; assignedStaff: string | null; lastMessageAt: string | null; unreadCount: number }[] };

export function MessagesTab({ clientId }: { clientId: string }) {
  const { data, error, loading } = useChartSection<MsgData>(clientId, 'messages');
  return (
    <ChartSection title="Messages" subtitle="Secure message threads with this client" fullListHref={`/dashboard/messages?client=${encodeURIComponent(clientId)}`} fullListLabel="Open conversation">
      <SectionState loading={loading} error={error} empty={Boolean(data && !data.threads.length)} emptyText="No message threads with this client." />
      {data?.threads.map((t) => (
        <div key={t.id} className="flex flex-wrap items-center gap-2 text-sm">
          <MessageSquare size={13} className="text-teal-700" />
          <span className="font-semibold capitalize text-slate-900">{t.topic.toLowerCase().replace(/_/g, ' ')}</span>
          <Pill tone={t.status === 'RESOLVED' ? 'slate' : 'sky'}>{t.status.toLowerCase().replace(/_/g, ' ')}</Pill>
          {t.risk === 'HIGH' ? <Pill tone="rose">high risk</Pill> : null}
          {t.unreadCount ? <Pill tone="amber">{t.unreadCount} unread</Pill> : null}
          <span className="text-xs text-slate-500">
            last {fmtDateTime(t.lastMessageAt)}
            {t.assignedStaff ? ` · ${t.assignedStaff}` : ''}
          </span>
        </div>
      ))}
      <p className="text-[11px] text-slate-500">Message text opens in the inbox; opening it here would mark messages read.</p>
    </ChartSection>
  );
}

// ─── Programs ────────────────────────────────────────────────────────────────

type ProgData = {
  prp: { id: string; displayId: string | null; status: string; diagnosisCode: string; startDate: string | null }[];
  tms: { id: string; status: string; targetSessions: number | null; createdAt: string | null }[];
  spravato: { id: string; phase: string; doseCount: number; enrolledAt: string | null }[];
};

export function ProgramsTab({ clientId }: { clientId: string }) {
  const { data, error, loading } = useChartSection<ProgData>(clientId, 'programs');
  const none = data && !data.prp.length && !data.tms.length && !data.spravato.length;
  return (
    <ChartSection title="Programs" subtitle="PRP, TMS and Spravato enrollments for this client" fullListHref="/dashboard/prp" fullListLabel="Open PRP">
      <SectionState loading={loading} error={error} empty={Boolean(none)} emptyText="Not enrolled in a program." />
      {data?.prp.map((p) => (
        <div key={p.id} className="text-sm text-slate-700">
          <Pill tone="purple">PRP</Pill> <span className="font-semibold">{p.displayId || 'Enrollment'}</span> · {p.status} · {p.diagnosisCode} · start {fmtDate(p.startDate)}
        </div>
      ))}
      {data?.tms.map((t) => (
        <div key={t.id} className="text-sm text-slate-700">
          <Pill tone="sky">TMS</Pill> course · {t.status} · target {courseTargetLabel(t.targetSessions)} · opened {fmtDate(t.createdAt)}
        </div>
      ))}
      {data?.spravato.map((s) => (
        <div key={s.id} className="text-sm text-slate-700">
          <Pill tone="sky">Spravato</Pill> {s.phase} · {s.doseCount} doses · enrolled {fmtDate(s.enrolledAt)}
        </div>
      ))}
      {data && (data.tms.length || data.spravato.length) ? (
        <Link href="/dashboard/ehr/tms-spravato" className="text-xs font-semibold text-[#5C2D91] hover:underline">
          Open TMS / Spravato
        </Link>
      ) : null}
    </ChartSection>
  );
}

// ─── Discharge ───────────────────────────────────────────────────────────────

type DischargeData = {
  clientStatus: string;
  cases: { id: string; status?: string; reason?: string; targetDischarge?: string; admitDate?: string; clinician?: string; aftercare?: string[]; followUpAppt?: string }[] | null;
};

export function DischargeTab({ clientId }: { clientId: string }) {
  const { data, error, loading } = useChartSection<DischargeData>(clientId, 'discharge');
  return (
    <ChartSection title="Discharge" subtitle="Discharge planning and aftercare for this client" fullListHref={`/dashboard/ehr/discharge${q(clientId)}`}>
      <SectionState loading={loading} error={error} />
      {data ? (
        <>
          <p className="text-sm text-slate-700">
            <span className="text-xs font-semibold text-slate-500">Chart status: </span>
            <Pill tone={data.clientStatus === 'DISCHARGED' ? 'slate' : 'emerald'}>{data.clientStatus.toLowerCase()}</Pill>
          </p>
          {data.cases === null ? <p className="text-sm text-slate-500">Your role cannot view discharge planning.</p> : null}
          {data.cases && !data.cases.length ? <p className="text-sm text-slate-500">No discharge plan for this client.</p> : null}
          {data.cases?.map((c) => (
            <div key={c.id} className="rounded-xl border border-slate-200 p-3 text-sm text-slate-700">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-slate-900">Discharge plan</span>
                {c.status ? <Pill>{c.status.replace(/_/g, ' ')}</Pill> : null}
                <span className="text-xs text-slate-500">
                  {c.reason ? `${c.reason} · ` : ''}target {fmtDate(c.targetDischarge)}
                  {c.clinician ? ` · ${c.clinician}` : ''}
                </span>
              </div>
              {c.aftercare?.length ? <p className="mt-1 text-xs">Aftercare: {c.aftercare.join(', ')}</p> : null}
            </div>
          ))}
          <DataNote>Discharge plans are saved by client name and date of birth (no chart link), so they are matched here on both. Check them against this chart.</DataNote>
        </>
      ) : null}
    </ChartSection>
  );
}

// ─── Access log ──────────────────────────────────────────────────────────────

type AccessData = {
  events: { id: string; actorName: string | null; actorRole: string | null; action: string; resourceType: string | null; outcome: string; createdAt: string }[];
  sensitiveAccess: { id: string; userName: string | null; accessType: string; path: string | null; timestamp: string }[];
};

export function AccessLogTab({ clientId }: { clientId: string }) {
  const { data, error, loading } = useChartSection<AccessData>(clientId, 'access-log');
  return (
    <ChartSection title="Access log" subtitle="HIPAA audit trail for this chart (latest 200 events)" fullListHref={`/dashboard/admin/audit-log?patientId=${encodeURIComponent(clientId)}`} fullListLabel="Full audit log for this client">
      <SectionState loading={loading} error={error} empty={Boolean(data && !data.events.length && !data.sensitiveAccess.length)} emptyText="No access recorded." />
      {data?.sensitiveAccess.length ? (
        <div>
          <p className="mb-1.5 text-xs font-bold uppercase tracking-wider text-slate-500">Protected record access</p>
          <ul className="space-y-1 text-xs text-slate-700">
            {data.sensitiveAccess.map((s) => (
              <li key={s.id}>
                {fmtDateTime(s.timestamp)} · <span className="font-semibold">{s.userName || 'Unknown user'}</span> ·{' '}
                <Pill tone={s.accessType === 'denied' ? 'rose' : s.accessType === 'break_the_glass' ? 'amber' : 'slate'}>{sensitiveAccessLabel(s.accessType)}</Pill>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {data?.events.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 font-semibold uppercase text-slate-600">
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Who</th>
                <th className="px-3 py-2">Action</th>
                <th className="px-3 py-2">Record</th>
                <th className="px-3 py-2">Outcome</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.events.map((e) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap px-3 py-1.5">{fmtDateTime(e.createdAt)}</td>
                  <td className="px-3 py-1.5">
                    {e.actorName || '—'} <span className="text-slate-500">{e.actorRole || ''}</span>
                  </td>
                  <td className="px-3 py-1.5" title={e.action}>{actionLabel(e.action)}</td>
                  <td className="px-3 py-1.5">{describeResource(e.resourceType)}</td>
                  <td className="px-3 py-1.5">
                    <Pill tone={e.outcome === 'SUCCESS' ? 'emerald' : 'rose'}>{outcomeLabel(e.outcome)}</Pill>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </ChartSection>
  );
}
