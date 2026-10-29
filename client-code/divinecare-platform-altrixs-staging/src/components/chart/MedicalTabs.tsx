'use client';

import { useState } from 'react';
import toast from 'react-hot-toast';
import { FlaskConical, HeartPulse, Plus, Sparkles, Stethoscope } from 'lucide-react';
import { AllergenInput, DrugCodeFixer, type AllergenPick } from '@/components/ui/DrugPicker';
import { ALLERGEN_TYPE_LABEL, allergyNeedsCode, type AllergenType } from '@/lib/drugs/types';
import type { MedicalTabKey } from '@/lib/medical/medicalProgram';
import type { ChartTabKey } from './chartTabs';
import { ChartSection, DataNote, Pill, SectionState, fmtDate, fmtDateTime } from './ChartSection';
import { useChartSection } from './useChartSection';

/**
 * Client chart, Medical tab group (primary care / Family Practice). Real data only, from
 * GET /api/clients/[id]/chart?section=medical-*. Areas Altrixs does not store yet say so.
 */

type Props = {
  tab: MedicalTabKey;
  clientId: string;
  canOpenDiagnoses: boolean;
  canOpenLabs: boolean;
  onOpenTab: (tab: ChartTabKey) => void;
};

const patientQ = (clientId: string) => `?patient=${encodeURIComponent(clientId)}`;

function TabLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="font-semibold text-[#5C2D91] underline-offset-2 hover:underline">
      {label}
    </button>
  );
}

export function MedicalTab(props: Props) {
  switch (props.tab) {
    case 'medical-visits':
      return <VisitsTab clientId={props.clientId} />;
    case 'medical-vitals':
      return <VitalsTab clientId={props.clientId} />;
    case 'medical-preventive':
      return <PreventiveTab />;
    case 'medical-history':
      return <HistoryTab {...props} />;
    case 'medical-orders':
      return <OrdersTab {...props} />;
    case 'medical-ai':
      return <MedicalAiTab />;
  }
}

// ─── Visits & SOAP ───────────────────────────────────────────────────────────

type VisitData = {
  visits: {
    id: string; visitDate: string | null; visitType: string; chiefComplaint: string | null; providerName: string | null;
    status: string; signedAt: string | null; subjective: string | null; objective: string | null; assessment: string | null;
    plan: string | null; cptCode: string | null; cptModifiers: string[]; icd10Codes: string[];
  }[];
};

function VisitsTab({ clientId }: { clientId: string }) {
  const { data, error, loading } = useChartSection<VisitData>(clientId, 'medical-visits');
  return (
    <ChartSection
      title="Visits & SOAP"
      subtitle="Primary care encounters for this client, newest first"
      fullListHref={`/dashboard/medical/visits${patientQ(clientId)}`}
      fullListLabel="Start or sign a visit"
    >
      <SectionState loading={loading} error={error} empty={Boolean(data && !data.visits.length)} emptyText="No primary care visits recorded." />
      {data?.visits.length ? (
        <ul className="space-y-3">
          {data.visits.map((v) => (
            <li key={v.id} className="rounded-xl border border-slate-200 p-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Stethoscope size={14} className="text-[#5C2D91]" />
                <span className="font-semibold text-slate-900">{fmtDate(v.visitDate)}</span>
                <span className="text-slate-700">{v.visitType}</span>
                {v.providerName ? <span className="text-xs text-slate-500">{v.providerName}</span> : null}
                <Pill tone={v.signedAt ? 'emerald' : 'amber'}>{v.signedAt ? `Signed ${fmtDateTime(v.signedAt)}` : v.status}</Pill>
                {v.cptCode ? (
                  <span className="font-mono text-xs text-slate-600">
                    {v.cptCode}
                    {v.cptModifiers.length ? `-${v.cptModifiers.join('-')}` : ''}
                  </span>
                ) : null}
                {v.icd10Codes.length ? <span className="font-mono text-xs text-slate-500">{v.icd10Codes.join(', ')}</span> : null}
              </div>
              {v.chiefComplaint ? <p className="mt-1 text-xs text-slate-600">CC: {v.chiefComplaint}</p> : null}
              <details className="mt-2 text-xs text-slate-700">
                <summary className="cursor-pointer font-semibold text-slate-600">SOAP note</summary>
                <dl className="mt-2 space-y-2">
                  {(
                    [
                      ['Subjective', v.subjective],
                      ['Objective', v.objective],
                      ['Assessment', v.assessment],
                      ['Plan', v.plan],
                    ] as const
                  ).map(([label, text]) => (
                    <div key={label}>
                      <dt className="font-bold uppercase tracking-wider text-slate-500">{label}</dt>
                      <dd className="whitespace-pre-wrap">{text || 'Not documented'}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            </li>
          ))}
        </ul>
      ) : null}
    </ChartSection>
  );
}

// ─── Vitals flowsheet ────────────────────────────────────────────────────────

type VitalData = {
  vitals: {
    id: string; recordedAt: string; recordedBy: string | null; systolic: number | null; diastolic: number | null;
    heartRate: number | null; respRate: number | null; temperatureF: number | null; spO2: number | null;
    weightLbs: number | null; heightInches: number | null; bmi: number | null;
  }[];
};

const v = (n: number | null, unit = '') => (n == null ? '—' : `${n}${unit}`);

function VitalsTab({ clientId }: { clientId: string }) {
  const { data, error, loading } = useChartSection<VitalData>(clientId, 'medical-vitals');
  return (
    <ChartSection
      title="Vitals flowsheet"
      subtitle="Recorded vital signs, newest first (up to 100)"
      fullListHref={`/dashboard/medical/vitals${patientQ(clientId)}`}
      fullListLabel="Record vitals"
    >
      <SectionState loading={loading} error={error} empty={Boolean(data && !data.vitals.length)} emptyText="No vitals recorded." />
      {data?.vitals.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 font-semibold uppercase text-slate-600">
                <th className="px-3 py-2">Recorded</th>
                <th className="px-3 py-2">BP</th>
                <th className="px-3 py-2">HR</th>
                <th className="px-3 py-2">RR</th>
                <th className="px-3 py-2">Temp</th>
                <th className="px-3 py-2">SpO2</th>
                <th className="px-3 py-2">Weight</th>
                <th className="px-3 py-2">BMI</th>
                <th className="px-3 py-2">By</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.vitals.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-2">{fmtDateTime(r.recordedAt)}</td>
                  <td className="px-3 py-2 font-semibold">{r.systolic != null && r.diastolic != null ? `${r.systolic}/${r.diastolic}` : '—'}</td>
                  <td className="px-3 py-2">{v(r.heartRate)}</td>
                  <td className="px-3 py-2">{v(r.respRate)}</td>
                  <td className="px-3 py-2">{v(r.temperatureF, ' °F')}</td>
                  <td className="px-3 py-2">{v(r.spO2, '%')}</td>
                  <td className="px-3 py-2">{v(r.weightLbs, ' lb')}</td>
                  <td className="px-3 py-2">{v(r.bmi)}</td>
                  <td className="px-3 py-2 text-slate-500">{r.recordedBy || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </ChartSection>
  );
}

// ─── Preventive care ─────────────────────────────────────────────────────────

function PreventiveTab() {
  return (
    <ChartSection title="Preventive care" subtitle="Screenings and immunizations due" fullListHref="/dashboard/medical/preventive-care">
      <p className="text-sm text-slate-500">No preventive care items on file.</p>
      <DataNote>
        Altrixs does not store preventive care schedules, completions or immunizations yet, so nothing is shown as due or
        done. Document screenings in the visit note and order them from Labs.
      </DataNote>
    </ChartSection>
  );
}

// ─── Medical history ─────────────────────────────────────────────────────────

type HistoryData = {
  allergies: {
    id: string; allergen: string; reaction: string | null; severity: string; status: string; source: string | null; createdAt: string;
    allergenType?: string | null; rxnormId?: string | null; rxnormName?: string | null;
  }[];
  pastProblems: { id: string; icd10Code: string | null; needsCoding?: boolean; name: string; status: string; onsetDate: string | null; resolvedDate: string | null; source: string | null }[];
  activeProblemCount: number;
};

async function sendJson(url: string, method: 'POST' | 'PATCH', body: unknown) {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) throw new Error(data.error || `Could not save (${res.status})`);
  return data as { warning?: string };
}

const EMPTY_ALLERGEN: AllergenPick = { text: '', rxcui: null, tty: null, allergenType: 'drug' };

/** Add an allergy from the chart: drug allergies are RxNorm-coded in the typeahead (DrFirst AUM2). */
function AddAllergyForm({ clientId, onSaved }: { clientId: string; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [allergen, setAllergen] = useState<AllergenPick>(EMPTY_ALLERGEN);
  const [reaction, setReaction] = useState('');
  const [severity, setSeverity] = useState<'Mild' | 'Moderate' | 'Severe/Anaphylaxis'>('Moderate');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[#5C2D91] hover:underline">
        <Plus size={12} /> Add allergy
      </button>
    );
  }
  const save = async () => {
    if (!allergen.text.trim()) return setMsg('Enter the allergen');
    setBusy(true);
    setMsg(null);
    try {
      const res = await sendJson(`/api/medical/patients/${encodeURIComponent(clientId)}/allergies`, 'POST', {
        substance: allergen.text.trim(),
        allergenType: allergen.allergenType,
        ...(allergen.allergenType === 'drug' && allergen.rxcui ? { rxcui: allergen.rxcui } : {}),
        reaction: reaction.trim() || null,
        severity,
      });
      setAllergen(EMPTY_ALLERGEN);
      setReaction('');
      setOpen(false);
      if (res.warning) toast(res.warning);
      onSaved();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Could not save allergy');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-3 space-y-2 rounded-xl border border-slate-200 p-3">
      <AllergenInput value={allergen} onChange={setAllergen} disabled={busy} />
      <div className="flex flex-col gap-2 sm:flex-row">
        <input value={reaction} onChange={(e) => setReaction(e.target.value)} placeholder="Reaction (e.g. hives)" className="clinic-input" aria-label="Reaction" disabled={busy} />
        <select value={severity} onChange={(e) => setSeverity(e.target.value as typeof severity)} className="clinic-input sm:w-48" aria-label="Severity" disabled={busy}>
          <option value="Mild">Mild</option>
          <option value="Moderate">Moderate</option>
          <option value="Severe/Anaphylaxis">Severe / anaphylaxis</option>
        </select>
      </div>
      <div className="flex items-center gap-2">
        <button type="button" onClick={save} disabled={busy} className="clinic-btn-primary">
          {busy ? 'Saving…' : 'Save allergy'}
        </button>
        <button type="button" onClick={() => setOpen(false)} disabled={busy} className="text-xs font-semibold text-slate-500">
          Cancel
        </button>
        {msg ? <span className="text-xs text-rose-700" role="alert">{msg}</span> : null}
      </div>
    </div>
  );
}

function HistoryTab({ clientId, canOpenDiagnoses, onOpenTab }: Props) {
  const { data, error, loading, reload } = useChartSection<HistoryData>(clientId, 'medical-history');
  const allergyUrl = (id: string) => `/api/medical/patients/${encodeURIComponent(clientId)}/allergies/${encodeURIComponent(id)}`;
  return (
    <ChartSection title="Medical history" subtitle="Allergies and past medical history" fullListHref="/dashboard/medical/history">
      <SectionState loading={loading} error={error} />
      {data ? (
        <>
          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">Allergies & adverse reactions</p>
            {data.allergies.length ? (
              <ul className="space-y-1.5 text-sm text-slate-800">
                {data.allergies.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{a.allergen}</span>
                    {a.reaction ? <span className="text-slate-600">{a.reaction}</span> : null}
                    <Pill tone={/severe|anaphyl/i.test(a.severity) ? 'rose' : 'slate'}>{a.severity}</Pill>
                    {a.status !== 'Active' ? <Pill>{a.status}</Pill> : null}
                    {a.allergenType ? <Pill tone="sky">{ALLERGEN_TYPE_LABEL[a.allergenType as AllergenType] || a.allergenType}</Pill> : null}
                    {a.rxnormId ? (
                      <span className="text-[11px] font-semibold text-emerald-700" title={a.rxnormName || undefined}>RxNorm {a.rxnormId}</span>
                    ) : null}
                    <span className="text-[11px] text-slate-500">{a.source === 'drfirst' ? 'DrFirst' : 'Altrixs'}</span>
                    {allergyNeedsCode(a) ? (
                      <DrugCodeFixer
                        kind="allergy"
                        text={a.allergen}
                        onCode={async (rxcui) => {
                          await sendJson(allergyUrl(a.id), 'PATCH', { action: 'code', rxcui });
                          reload();
                        }}
                        onClassify={async (allergenType) => {
                          await sendJson(allergyUrl(a.id), 'PATCH', { action: 'classify', allergenType });
                          reload();
                        }}
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">No allergies recorded (this is not the same as NKDA).</p>
            )}
            <AddAllergyForm clientId={clientId} onSaved={reload} />
          </div>
          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">Past medical history (resolved problems)</p>
            {data.pastProblems.length ? (
              <ul className="space-y-1 text-sm text-slate-700">
                {data.pastProblems.map((p) => (
                  <li key={p.id}>
                    {p.needsCoding ? <Pill tone="amber">Needs coding</Pill> : <span className="font-mono text-xs font-semibold">{p.icd10Code}</span>} {p.name}
                    <span className="ml-1 text-xs text-slate-500">
                      {p.onsetDate ? `onset ${fmtDate(p.onsetDate)}` : ''}
                      {p.resolvedDate ? ` · resolved ${fmtDate(p.resolvedDate)}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">No resolved problems recorded.</p>
            )}
          </div>
          <DataNote>
            {data.activeProblemCount} active problem{data.activeProblemCount === 1 ? '' : 's'}{' '}
            {canOpenDiagnoses ? (
              <>
                are in <TabLink label="Diagnoses & problems" onClick={() => onOpenTab('diagnoses')} />
              </>
            ) : (
              'are on the problem list'
            )}
            . Surgical, family and social history and immunizations are not stored in Altrixs yet.
          </DataNote>
        </>
      ) : null}
    </ChartSection>
  );
}

// ─── Orders & referrals ──────────────────────────────────────────────────────

function OrdersTab({ canOpenLabs, onOpenTab }: Props) {
  return (
    <ChartSection title="Orders & referrals" subtitle="Lab orders, specialist referrals and imaging" fullListHref="/dashboard/medical/referrals">
      <p className="flex items-center gap-2 text-sm text-slate-700">
        <FlaskConical size={14} className="text-[#5C2D91]" />
        Lab orders and results:{' '}
        {canOpenLabs ? <TabLink label="open the Labs tab" onClick={() => onOpenTab('labs')} /> : 'not available to your role'}
      </p>
      <DataNote>
        Specialist referrals and imaging orders are not stored or transmitted by Altrixs yet. The referrals page prepares a
        printable letter only; document the referral in the visit note.
      </DataNote>
    </ChartSection>
  );
}

// ─── Medical AI ──────────────────────────────────────────────────────────────

function MedicalAiTab() {
  return (
    <ChartSection title="Medical AI" subtitle="SOAP drafting and ICD-10 / entity extraction" fullListHref="/dashboard/medical/ai" fullListLabel="Open Medical AI Suite">
      <p className="flex items-start gap-2 text-sm text-slate-700">
        <Sparkles size={14} className="mt-0.5 shrink-0 text-[#5C2D91]" />
        The Medical AI Suite works on text you paste or dictate. It does not read this chart automatically, and nothing it
        drafts is saved until a provider signs the visit.
      </p>
      <p className="flex items-center gap-2 text-xs text-slate-500">
        <HeartPulse size={12} /> AI drafts must be reviewed by the treating provider.
      </p>
    </ChartSection>
  );
}
