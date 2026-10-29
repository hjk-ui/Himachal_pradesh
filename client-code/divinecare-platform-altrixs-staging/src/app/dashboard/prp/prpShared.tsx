'use client';
// ─── PRP shared workflow module ───────────────────────────────────────────────
// Single source of truth for the PRP forms chain:
//   Referral → Enrollment → Rehab Assessment → IRP → Active
// One client roster, one qualifying-code list, one regulatory line, and a
// localStorage draft that carries data forward so nothing is retyped between
// steps. Every PRP form imports from here instead of keeping its own copies.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CheckCircle, ChevronRight } from 'lucide-react';
import { apiJson } from '@/lib/api-client';

export const PRP_REG_LINE = 'COMAR 10.63 · Maryland PBHS — ASO: Carelon Behavioral Health of Maryland (Optum Maryland until Dec 31 2024)';

// Unified roster shape shared by every PRP form. Populated from live client
// records — no hardcoded participants.
export interface PrpClient {
  id: string;
  name: string;
  dob: string;
  medicaidId: string;
  plan: string;
  medicaid: boolean;
}

type ClientListRow = {
  id: string;
  name: string;
  dateOfBirth: string | null;
  insuranceMemberId: string | null;
  insurancePayer: string | null;
};

// Live roster from /api/clients (org-scoped server side).
export function usePrpClients() {
  const [clients, setClients] = useState<PrpClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    apiJson<{ clients: ClientListRow[] }>('/api/clients?limit=500')
      .then((data) => {
        if (cancelled) return;
        setClients(
          (data.clients || []).map((c) => ({
            id: c.id,
            name: c.name,
            dob: c.dateOfBirth || '',
            medicaidId: c.insuranceMemberId || '',
            plan: c.insurancePayer || '',
            medicaid: /medicaid|optum|maryland/i.test(c.insurancePayer || ''),
          }))
        );
      })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load clients'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);
  return { clients, loading, error };
}

// Qualifying diagnoses. Adult PRP medical necessity under the Maryland PBHS
// centers on serious mental illness; anxiety-spectrum codes are conditional
// and routinely denied without exceptional functional-impairment documentation.
export const QUALIFYING_CODE_GROUPS = [
  { group: 'Schizophrenia Spectrum', color: '#5C2D91', bg: '#EDE9F7', strength: 'strong' as const, codes: [
    { code: 'F20.0', label: 'Paranoid schizophrenia' },
    { code: 'F20.9', label: 'Schizophrenia, unspecified' },
    { code: 'F22',   label: 'Delusional disorders' },
    { code: 'F25.0', label: 'Schizoaffective disorder, bipolar type' },
    { code: 'F25.1', label: 'Schizoaffective disorder, depressive type' },
    { code: 'F29',   label: 'Unspecified psychosis' },
  ]},
  { group: 'Mood Disorders', color: '#15803D', bg: '#E0F2F1', strength: 'strong' as const, codes: [
    { code: 'F31.13', label: 'Bipolar I, manic, severe' },
    { code: 'F31.4',  label: 'Bipolar I, depressed, severe' },
    { code: 'F31.81', label: 'Bipolar II disorder' },
    { code: 'F33.2',  label: 'MDD, recurrent, severe without psychosis' },
    { code: 'F33.3',  label: 'MDD, recurrent, severe with psychosis' },
  ]},
  { group: 'Anxiety Disorders', color: '#B45309', bg: '#FEF9E7', strength: 'conditional' as const, warn: true, codes: [
    { code: 'F41.1',  label: 'Generalized Anxiety Disorder' },
    { code: 'F41.0',  label: 'Panic disorder' },
    { code: 'F40.10', label: 'Social anxiety disorder' },
    { code: 'F43.22', label: 'Adjustment disorder with anxiety' },
    { code: 'F41.9',  label: 'Anxiety disorder, unspecified', highRisk: true },
  ]},
];

export const ALL_QUALIFYING_CODES = QUALIFYING_CODE_GROUPS.flatMap(g =>
  g.codes.map(c => ({ ...c, group: g.group, strength: g.strength, warn: (g as any).warn === true }))
);

export const PRP_DOMAINS = [
  'Daily Living & Self-Care',
  'Medication Self-Management',
  'Community Navigation & Transportation',
  'Social & Interpersonal Skills',
  'Prevocational / Educational Readiness',
  'Financial Management Basics',
  'Symptom Self-Management & Coping',
  'Crisis Prevention & Safety Planning',
];

// ─── Workflow draft (carries data from one form to the next) ─────────────────
export type PrpStage = 'referral' | 'enrolled' | 'assessed' | 'irp';

export interface PrpDraft {
  stage: PrpStage;
  referralId?: string;
  /** PrpReferral.id (cuid) from /api/prp/referrals — referralId is the display ID. */
  referralRecordId?: string;
  clientId?: string;
  clientName?: string;
  clientDob?: string;
  medicaidId?: string;
  dxCode?: string;
  dxLabel?: string;
  recommendedDomains?: string[];
  functionalNarrative?: string;
  prescriberName?: string;
  specialist?: string;
  startDate?: string;
  updatedAt?: string;
}

const DRAFT_KEY = 'prp_workflow_draft';

// Extra structured payloads persisted on the PrpWorkflow row (Json columns).
export interface PrpWorkflowExtras {
  enrollmentData?: Record<string, unknown>;
  assessmentData?: Record<string, unknown>;
  irpData?: Record<string, unknown>;
  irpEffectiveDate?: string;
  irpReviewDueDate?: string;
}

export type PrpSaveResult = { ok: boolean; error?: string };

/**
 * Keeps a local prefill copy and persists the workflow (including any form body
 * in `extras`) to /api/prp/workflow. Resolves ok only after the server 2xx —
 * callers must not show "saved" otherwise.
 */
export async function savePrpDraft(
  patch: Partial<PrpDraft> & { stage: PrpStage },
  extras?: PrpWorkflowExtras
): Promise<PrpSaveResult> {
  const current: Partial<PrpDraft> = loadPrpDraft() ?? {};
  const next: PrpDraft = { ...current, ...patch, updatedAt: new Date().toISOString() };
  // Same client: the stage only moves forward (the server enforces this too).
  const order: PrpStage[] = ['referral', 'enrolled', 'assessed', 'irp'];
  if (current.stage && current.clientId === next.clientId && order.indexOf(current.stage) > order.indexOf(patch.stage)) {
    next.stage = current.stage;
  }
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(next));
  } catch { /* storage unavailable — workflow still works, just without prefill */ }

  if (!next.clientId) {
    return { ok: false, error: 'Select a client from the roster before saving.' };
  }
  try {
    await apiJson('/api/prp/workflow', {
      method: 'POST',
      body: JSON.stringify({
        clientId: next.clientId,
        stage: next.stage,
        referralData: next,
        qualifyingIcd10: next.dxCode,
        recommendedDomains: next.recommendedDomains,
        ...extras,
      }),
    });
    return { ok: true };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : 'Save failed' };
  }
}

export function loadPrpDraft(): PrpDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as PrpDraft) : null;
  } catch { return null; }
}

export function clearPrpDraft() {
  try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
}

// ─── Workflow bar — shown at the top of every PRP form ───────────────────────
const WORKFLOW_STEPS: { key: PrpStage | 'start'; label: string; href: string }[] = [
  { key: 'start',    label: 'Referral',          href: '/dashboard/prp/referral' },
  { key: 'referral', label: 'Enrollment',        href: '/dashboard/prp/enroll' },
  { key: 'enrolled', label: 'Rehab Assessment',  href: '/dashboard/prp/assessment' },
  { key: 'assessed', label: 'IRP',               href: '/dashboard/prp/irp' },
];

const STAGE_ORDER: Record<string, number> = { start: 0, referral: 1, enrolled: 2, assessed: 3, irp: 4 };

export function PrpWorkflowBar({ current, draft }: { current: 'referral' | 'enroll' | 'assessment' | 'irp'; draft?: PrpDraft | null }) {
  const currentIdx = { referral: 0, enroll: 1, assessment: 2, irp: 3 }[current];
  const doneThrough = draft ? STAGE_ORDER[draft.stage] ?? 0 : 0;
  return (
    <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 mb-6 shadow-xs">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-1 flex-wrap">
          {WORKFLOW_STEPS.map((s, i) => {
            const done = doneThrough > i;
            const active = currentIdx === i;
            return (
              <div key={s.label} className="flex items-center">
                <Link
                  href={s.href}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                    active ? 'bg-blue-700 text-white'
                    : done ? 'text-emerald-700 hover:bg-emerald-50'
                    : 'text-slate-500 hover:bg-slate-50 hover:text-slate-600'
                  }`}
                >
                  {done && <CheckCircle size={12} />}
                  {s.label}
                </Link>
                {i < WORKFLOW_STEPS.length - 1 && <ChevronRight size={13} className="text-slate-500" />}
              </div>
            );
          })}
        </div>
        {draft?.clientName && (
          <span className="text-xs text-blue-700 bg-blue-50 border border-blue-100 rounded-full px-2.5 py-1 font-medium">
            In progress: {draft.clientName}{draft.referralId ? ` · ${draft.referralId}` : ''}
          </span>
        )}
      </div>
    </div>
  );
}
