'use client';
// ─── PRP shared workflow module ───────────────────────────────────────────────
// Single source of truth for the PRP forms chain:
//   Referral → Enrollment → Rehab Assessment → IRP → Active
// One client roster, one qualifying-code list, one regulatory line, and a
// localStorage draft that carries data forward so nothing is retyped between
// steps. Every PRP form imports from here instead of keeping its own copies.

import Link from 'next/link';
import { CheckCircle, ChevronRight } from 'lucide-react';

export const PRP_REG_LINE = 'COMAR 10.63 · Maryland PBHS — Optum Maryland (Incedo)';

export interface PrpClient {
  id: string;
  name: string;
  dob: string;
  medicaidId: string;
  plan: string;
  medicaid: boolean;
}

// Unified roster — empty by default in production, populated from live client records.
export const PRP_CLIENTS: readonly PrpClient[] = [];

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
  { group: 'Mood Disorders', color: '#00897B', bg: '#E0F2F1', strength: 'strong' as const, codes: [
    { code: 'F31.13', label: 'Bipolar I, manic, severe' },
    { code: 'F31.4',  label: 'Bipolar I, depressed, severe' },
    { code: 'F31.81', label: 'Bipolar II disorder' },
    { code: 'F33.2',  label: 'MDD, recurrent, severe without psychosis' },
    { code: 'F33.3',  label: 'MDD, recurrent, severe with psychosis' },
  ]},
  { group: 'Anxiety Disorders', color: '#D4A017', bg: '#FEF9E7', strength: 'conditional' as const, warn: true, codes: [
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

export function savePrpDraft(patch: Partial<PrpDraft> & { stage: PrpStage }) {
  try {
    const current = loadPrpDraft() ?? {};
    const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(next));

    // Optional background sync with PostgreSQL workflow endpoint
    if (next.clientId) {
      fetch('/api/prp/workflow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: next.clientId,
          stage: next.stage,
          referralData: next,
          qualifyingIcd10: next.dxCode,
          recommendedDomains: next.recommendedDomains,
        }),
      }).catch(() => {});
    }
  } catch { /* storage unavailable — workflow still works, just without prefill */ }
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
    <div className="bg-white border border-purple-100 rounded-xl px-4 py-3 mb-6 shadow-sm">
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
                    active ? 'bg-purple-700 text-white'
                    : done ? 'text-green-700 hover:bg-green-50'
                    : 'text-gray-400 hover:bg-gray-50 hover:text-gray-600'
                  }`}
                >
                  {done && <CheckCircle size={12} />}
                  {s.label}
                </Link>
                {i < WORKFLOW_STEPS.length - 1 && <ChevronRight size={13} className="text-gray-300" />}
              </div>
            );
          })}
        </div>
        {draft?.clientName && (
          <span className="text-xs text-purple-700 bg-purple-50 border border-purple-100 rounded-full px-2.5 py-1 font-medium">
            In progress: {draft.clientName}{draft.referralId ? ` · ${draft.referralId}` : ''}
          </span>
        )}
      </div>
    </div>
  );
}
