'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ShieldAlert, Stethoscope } from 'lucide-react';
import { AssessmentTrends } from '@/components/clinical/AssessmentTrends';
import { RecordedMeasures } from '@/components/clinical/RecordedMeasures';
import { MeasuresCard } from '@/components/measures/MeasuresCard';
import { Icd10CodeInput } from '@/components/clinical/Icd10Picker';
import { ChartSection, DataNote, Pill, SectionState, fmtDate, fmtDateTime } from './ChartSection';
import { useChartSection } from './useChartSection';
import { DiagnosisListPanel } from './DiagnosisListPanel';

const q = (clientId: string) => `?clientId=${encodeURIComponent(clientId)}`;

// ─── Assessments & outcomes ──────────────────────────────────────────────────

export function AssessmentsTab({ clientId }: { clientId: string }) {
  return (
    <ChartSection
      title="Assessments & outcomes"
      subtitle="Recorded instruments for this client (PHQ-9, GAD-7, C-SSRS and others) with score trends"
      fullListHref={`/dashboard/ehr/assessments${q(clientId)}`}
    >
      <MeasuresCard clientId={clientId} />
      <AssessmentTrends clientId={clientId} />
      <RecordedMeasures clientId={clientId} />
    </ChartSection>
  );
}

// ─── Diagnoses & problems ────────────────────────────────────────────────────

type DxData = {
  /** true for primary care roles: problem list only, no BH chart / plan diagnoses */
  problemsOnly?: boolean;
  chart: null | { primaryDiagnosisCode: string | null; primaryDiagnosis: string | null; secondaryDiagnoses: string | null };
  problems: {
    id: string;
    /** null / '' = needs coding (intake history stored uncoded, or a DrFirst ICD-9 / SNOMED-only problem) */
    icd10Code: string | null;
    needsCoding?: boolean;
    name: string;
    status: string;
    category: string | null;
    isChronic: boolean;
    onsetDate: string | null;
    resolvedDate: string | null;
    source: string | null;
  }[];
  planDiagnoses: { id: string; title: string; status: string; diagnosisCodes: string[] }[];
  practiceListEntries: { id?: string; primaryDx?: string; icd10?: string; status?: string; severity?: string; onset?: string; clinician?: string }[] | null;
};

/**
 * Inline "set code" for an uncoded problem. PATCH /api/medical/patients/[clientId]/problems/[id]
 * validates the code against the FY2027 ICD-10-CM set and runs the same chart access check. The
 * input searches the code set as you type (codes or words).
 */
function SetProblemCode({ clientId, problemId, onSaved }: { clientId: string; problemId: string; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="ml-2 text-[11px] font-bold text-[#5C2D91] hover:underline">
        Set code
      </button>
    );
  }
  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/medical/patients/${encodeURIComponent(clientId)}/problems/${encodeURIComponent(problemId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ icd10: code.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success) {
        setErr(body.error || `Could not save (${res.status})`);
        return;
      }
      setOpen(false);
      onSaved();
    } catch {
      setErr('Could not save (network error)');
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="mt-1 flex flex-wrap items-center gap-1.5">
      <Icd10CodeInput
        value={code}
        onChange={(c) => setCode(c)}
        context="any"
        autoFocus
        placeholder="ICD-10-CM code or words"
        className="w-72 max-w-full"
        inputClassName="w-full rounded-md border border-slate-300 py-0.5 pl-7 pr-1.5 text-[11px]"
      />
      <button type="button" disabled={busy || !code.trim()} onClick={() => void save()} className="rounded-md bg-[#5C2D91] px-2 py-0.5 text-[11px] font-bold text-white disabled:opacity-50">
        Save
      </button>
      <button type="button" onClick={() => setOpen(false)} className="text-[11px] text-slate-500 hover:underline">
        Cancel
      </button>
      {err ? <span className="w-full text-[11px] text-rose-700">{err}</span> : null}
    </span>
  );
}

export function DiagnosesTab({ clientId, canSetCode = false }: { clientId: string; /** physician / NP / psychiatrist / leadership */ canSetCode?: boolean }) {
  const { data, error, loading, reload } = useChartSection<DxData>(clientId, 'diagnoses');
  return (
    <ChartSection
      title="Diagnoses & problems"
      subtitle={
        data?.problemsOnly
          ? 'Medical problem list (incl. DrFirst-synced problems). Behavioral-health diagnoses are not shown to your role.'
          : 'Diagnosis list (rank, status, review), problem list (incl. DrFirst-synced problems) and treatment plan codes'
      }
      fullListHref={data?.problemsOnly ? '/dashboard/medical/problem-list' : `/dashboard/ehr/diagnoses${q(clientId)}`}
    >
      <SectionState loading={loading} error={error} />
      {data ? (
        <>
          {/* Behavioral-health diagnosis list: ranked, status, history, review (src/lib/diagnoses) */}
          {data.problemsOnly ? null : <DiagnosisListPanel clientId={clientId} onChanged={reload} />}

          <div>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-500">
              <Stethoscope size={13} /> Problem list
            </p>
            {data.problems.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 font-semibold uppercase text-slate-600">
                      <th className="px-3 py-2">ICD-10</th>
                      <th className="px-3 py-2">Problem</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Onset</th>
                      <th className="px-3 py-2">Source</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.problems.map((p) => (
                      <tr key={p.id}>
                        <td className="px-3 py-2 font-mono font-semibold">
                          {p.needsCoding || !(p.icd10Code ?? '').trim() ? (
                            <>
                              <Pill tone="amber">Needs coding</Pill>
                              {canSetCode ? <SetProblemCode clientId={clientId} problemId={p.id} onSaved={reload} /> : null}
                            </>
                          ) : (
                            p.icd10Code
                          )}
                        </td>
                        <td className="px-3 py-2 text-slate-800">
                          {p.name}
                          {p.isChronic ? <span className="ml-1 text-[11px] text-slate-500">(chronic)</span> : null}
                        </td>
                        <td className="px-3 py-2">
                          <Pill tone={/active/i.test(p.status) ? 'sky' : 'slate'}>{p.status}</Pill>
                        </td>
                        <td className="px-3 py-2">{fmtDate(p.onsetDate)}</td>
                        <td className="px-3 py-2">{p.source === 'drfirst' ? 'DrFirst' : 'Altrixs'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-slate-500">No problems recorded.</p>
            )}
          </div>

          {data.planDiagnoses.length ? (
            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">Treatment plan diagnosis codes</p>
              <ul className="space-y-1 text-sm text-slate-700">
                {data.planDiagnoses.map((p) => (
                  <li key={p.id}>
                    <span className="font-semibold">{p.title}</span> <span className="text-xs text-slate-500">({p.status.toLowerCase()})</span>: {p.diagnosisCodes.join(', ')}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {data.practiceListEntries && data.practiceListEntries.length ? (
            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">Practice diagnosis list entries</p>
              <ul className="space-y-1 text-sm text-slate-700">
                {data.practiceListEntries.map((r, i) => (
                  <li key={String(r.id ?? i)}>
                    <span className="font-mono text-xs font-semibold">{r.icd10 || '—'}</span> {r.primaryDx || ''} {r.status ? <Pill>{r.status}</Pill> : null}
                    {r.onset ? <span className="ml-1 text-xs text-slate-500">onset {fmtDate(r.onset)}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {data.problemsOnly ? null : (
            <DataNote>
              Practice diagnosis list entries are saved with the client&apos;s name, not a chart link, so they are matched here by exact name. Check them against this chart.
            </DataNote>
          )}
        </>
      ) : null}
    </ChartSection>
  );
}

// ─── Labs ────────────────────────────────────────────────────────────────────
// Orders, results, trends, standing orders and "Order labs": src/components/chart/LabChartTab.tsx

export { LabChartTab as LabsTab } from './LabChartTab';

// ─── Safety plan & risk ──────────────────────────────────────────────────────

type SafetyData = {
  alerts: { id: string; type: string; severity: string; description: string | null; source: string; reviewed: boolean; reviewNote: string | null; reviewedAt: string | null; createdAt: string }[];
  cssrs: { id: string; instrumentName: string; totalScore: number | null; severity: string | null; safetyFlagged: boolean; createdAt: string }[];
  safetyPlans: { id: string; risk?: string | null; lastUpdated?: string; lastReviewed?: string; clientSigned?: boolean; clinicianSigned?: boolean; clinician?: string; withoutPlan?: boolean; steps?: { content?: string }[] }[] | null;
  unlinkedSafetyPlans: number | null;
};

const sevTone = (s: string) => (/high/i.test(s) ? 'rose' : /medium|moderate/i.test(s) ? 'amber' : 'sky') as 'rose' | 'amber' | 'sky';

export function SafetyRiskTab({ clientId }: { clientId: string }) {
  const { data, error, loading } = useChartSection<SafetyData>(clientId, 'safety');
  return (
    <div className="space-y-4">
      <ChartSection title="Safety plan" subtitle="Stanley-Brown safety plans linked to this chart" fullListHref={`/dashboard/ehr/safety-plan${q(clientId)}`}>
        <SectionState loading={loading} error={error} />
        {data && data.safetyPlans === null ? <p className="text-sm text-slate-500">Your role cannot view safety plans.</p> : null}
        {data?.safetyPlans && !data.safetyPlans.length ? <p className="text-sm text-slate-500">No safety plan linked to this chart.</p> : null}
        {data?.safetyPlans?.map((p) => {
          const steps = (p.steps || []).filter((s) => s.content?.trim()).length;
          return (
            <div key={p.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 p-3 text-sm">
              <ShieldAlert size={14} className="text-[#5C2D91]" />
              <span className="font-semibold text-slate-900">{p.withoutPlan ? 'Risk record (no plan)' : 'Safety plan'}</span>
              {p.risk ? <Pill tone={sevTone(p.risk)}>{p.risk} risk</Pill> : null}
              <span className="text-xs text-slate-500">
                {steps} of 6 steps · updated {fmtDate(p.lastUpdated)} · reviewed {fmtDate(p.lastReviewed)}
                {p.clinician ? ` · ${p.clinician}` : ''}
              </span>
              <Pill tone={p.clientSigned && p.clinicianSigned ? 'emerald' : 'amber'}>
                {p.clientSigned && p.clinicianSigned ? 'Signed' : 'Signature pending'}
              </Pill>
            </div>
          );
        })}
        {data?.unlinkedSafetyPlans ? (
          <DataNote>
            {data.unlinkedSafetyPlans} practice safety plan{data.unlinkedSafetyPlans === 1 ? ' is' : 's are'} saved without a chart link (older entries), so they cannot be shown here. Open the full list to find them.
          </DataNote>
        ) : null}
      </ChartSection>

      <ChartSection title="C-SSRS screens" subtitle="Columbia suicide severity screens recorded for this client" fullListHref={`/dashboard/ehr/assessments${q(clientId)}`}>
        {data && !data.cssrs.length ? <p className="text-sm text-slate-500">No C-SSRS screens recorded.</p> : null}
        {data?.cssrs.map((c) => (
          <div key={c.id} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold text-slate-800">{c.instrumentName}</span>
            <span className="text-xs text-slate-500">{fmtDate(c.createdAt)}</span>
            <span className="text-xs">score {c.totalScore ?? '—'}</span>
            {c.severity ? <Pill tone={sevTone(c.severity)}>{c.severity}</Pill> : null}
            {c.safetyFlagged ? (
              <Pill tone="rose">
                <AlertTriangle size={10} className="mr-0.5" /> Safety flag
              </Pill>
            ) : null}
          </div>
        ))}
      </ChartSection>

      <ChartSection title="Risk alerts" subtitle="Clinical risk alerts and documented responses for this client" fullListHref="/dashboard/alerts" fullListLabel="Open Alerts Center">
        {data && !data.alerts.length ? <p className="text-sm text-slate-500">No risk alerts on file for this client.</p> : null}
        <div className="divide-y divide-slate-100">
          {data?.alerts.map((a) => (
            <div key={a.id} className="py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Pill tone={sevTone(a.severity)}>{a.severity.toLowerCase()}</Pill>
                  <span className="text-sm font-semibold capitalize text-slate-900">{a.type.replace(/_/g, ' ')}</span>
                  {a.reviewed ? <Pill tone="emerald">Reviewed</Pill> : <Pill tone="rose">Action required</Pill>}
                </div>
                <time className="text-xs text-slate-500">{fmtDateTime(a.createdAt)}</time>
              </div>
              {a.description ? <p className="mt-1 text-sm text-slate-600">{a.description}</p> : null}
              {a.reviewNote ? (
                <p className="mt-1.5 rounded-xl bg-slate-50 p-2 text-xs text-slate-700">
                  <span className="font-semibold text-slate-500">Documented response:</span> {a.reviewNote}
                </p>
              ) : null}
            </div>
          ))}
        </div>
        <p className="text-[11px] text-slate-500">
          Crisis: call or text 988. <Link href="/dashboard/crisis" className="font-semibold text-[#5C2D91] hover:underline">Crisis workflow</Link>
        </p>
      </ChartSection>
    </div>
  );
}
