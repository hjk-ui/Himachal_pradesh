'use client';

import React from 'react';
import { CalendarDays } from 'lucide-react';
import type { Client } from '@/features/clients/types';

export interface FrequencySuggestion {
  label: '2x / week' | 'Weekly' | 'Bi-weekly' | 'Monthly';
  sessionsPerMonth: number; // 8, 4, 2, 1
  rationale: string;
  loc: string;              // Level of Care descriptor
  color: string;            // '#DC2626' (urgent), '#D97706' (priority), '#059669' (routine)
  urgency: 'routine' | 'priority' | 'urgent';
  cadenceRule: string;
  clinicalRationale: string;
  levelOfCare: string;
  isUrgent: boolean;
}

/**
 * Derives clinical session frequency recommendations based on
 * APA Practice Guidelines 2023, SAMHSA TIPs, and NICE NG113.
 */
export function getSuggestedFrequency(client: Partial<Client> & Record<string, any>): FrequencySuggestion {
  let spm = 4;
  let loc = 'Standard Outpatient';
  let rationale = 'Weekly individual therapy — general outpatient standard';
  let urgency: 'routine' | 'priority' | 'urgent' = 'routine';

  const dxText = [
    client.diagnosis,
    client.primaryDiagnosis,
    client.secondaryDiagnoses,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  const isSud = dxText.includes('sud') || dxText.includes('aud') || dxText.includes('substance') || dxText.includes('alcohol');
  const isPtsd = dxText.includes('ptsd') || dxText.includes('trauma');
  const isBipolar = dxText.includes('bipolar');
  const isPsychosis = dxText.includes('schizophrenia') || dxText.includes('psychosis') || dxText.includes('schizoaffective');
  const isMdd = dxText.includes('mdd') || dxText.includes('depression') || dxText.includes('depressive');
  const isGad = dxText.includes('gad') || dxText.includes('anxiety') || dxText.includes('panic');
  const isAdhd = dxText.includes('adhd') || dxText.includes('attention deficit');
  const isSocialNeeds = dxText.includes('housing') || dxText.includes('social determinant') || dxText.includes('homeless');

  if (isSud) {
    spm = 8;
    loc = 'IOP / Enhanced';
    rationale = 'SUD/AUD: 2x/week therapy + daily living recovery (SAMHSA TIP 35)';
    urgency = 'priority';
  } else if (isPtsd && isMdd) {
    spm = 4;
    loc = 'Outpatient OP';
    rationale = 'Comorbid MDD+PTSD: Weekly trauma-focused CBT addresses both (APA 2023)';
  } else if (isPtsd) {
    spm = 4;
    loc = 'Outpatient OP';
    rationale = 'PTSD: Weekly trauma processing (CPT or EMDR — APA 2023 Grade A)';
  } else if (isBipolar) {
    spm = 4;
    loc = 'Outpatient + Psychiatry';
    rationale = 'Bipolar: Weekly psychotherapy + monthly psychiatric follow-up (CANMAT 2023)';
  } else if (isPsychosis) {
    spm = 4;
    loc = 'ACT / Supported Employment';
    rationale = 'Schizophrenia: Weekly therapy + monthly psychiatry + case management (APA 2020)';
  } else if (isMdd) {
    spm = 4;
    loc = 'Outpatient OP';
    rationale = 'MDD: Weekly CBT/IPT — APA Practice Guideline; consider adjunct medication';
  } else if (isAdhd && (isGad || isMdd)) {
    spm = 4;
    loc = 'Outpatient OP';
    rationale = 'ADHD+comorbidity: Weekly; address both conditions simultaneously';
  } else if (isAdhd) {
    spm = 2;
    loc = 'Routine OP';
    rationale = 'ADHD: Bi-weekly therapy + monthly medication management (AAP 2019)';
  } else if (isGad) {
    spm = 2;
    loc = 'Routine OP';
    rationale = 'GAD: Bi-weekly CBT; step up to weekly if no improvement after 6 sessions (NICE NG113)';
  } else if (isSocialNeeds) {
    spm = 4;
    loc = 'Case Management + Therapy';
    rationale = 'Complex social needs: Weekly case management + bi-weekly therapy';
  }

  // Risk Modifiers
  const rawRisk = client.risk || client.riskLevel || 'low';
  const risk = String(rawRisk).toLowerCase();
  if (risk === 'high') {
    spm = Math.max(spm, 8);
    urgency = 'urgent';
    loc = 'IOP / Enhanced';
    rationale = `HIGH RISK: minimum 2x/week — Active safety planning required each session. ${rationale}`;
  } else if (risk === 'medium' && spm < 4) {
    spm = 4;
    urgency = 'priority';
  }

  // New Client Modifier (< 4 sessions)
  const totalSessions = client.totalSessions ?? client.sessionCount ?? (client.sessionsCompleted ?? 10);
  if (totalSessions < 4 && spm < 4) {
    spm = 4;
    rationale += ' · New client: initial intake/diagnostic stabilization';
  }

  // Complexity Modifier
  const complexityScore = client.diagnosisComplexity ?? client.complexity ?? 0;
  if (complexityScore >= 3 && spm < 4) {
    spm = 4;
    rationale += ' · High complexity caseload score';
  }

  // Final Label & Color derivation
  let label: FrequencySuggestion['label'] = 'Weekly';
  if (spm >= 8) label = '2x / week';
  else if (spm >= 4) label = 'Weekly';
  else if (spm >= 2) label = 'Bi-weekly';
  else label = 'Monthly';

  let color = '#059669'; // routine
  if (urgency === 'urgent') color = '#DC2626';
  else if (urgency === 'priority') color = '#D97706';

  return {
    label,
    sessionsPerMonth: spm,
    rationale,
    loc,
    color,
    urgency,
    cadenceRule: label === '2x / week' ? '2x/week' : label,
    clinicalRationale: rationale,
    levelOfCare: loc,
    isUrgent: urgency === 'urgent',
  };
}

/**
 * FrequencyChip Component:
 * Displays suggested frequency with color-tinted badge and optional clinical rationale.
 */
export function FrequencyChip({
  client,
  showRationale = false,
  compact = false,
}: {
  client: Partial<Client>;
  showRationale?: boolean;
  compact?: boolean;
}) {
  const freq = getSuggestedFrequency(client);

  return (
    <div
      className={`rounded-xl border transition-all ${compact ? 'px-2 py-1' : 'p-2.5'}`}
      style={{
        borderColor: `${freq.color}35`,
        backgroundColor: `${freq.color}0a`,
      }}
    >
      <div className="flex flex-wrap items-center gap-1.5 text-xs font-bold">
        <span
          className="inline-flex items-center gap-1"
          style={{ color: freq.color }}
        >
          <CalendarDays size={compact ? 12 : 13} className="shrink-0" />
          <span>Suggested: {freq.label}</span>
        </span>
        <span
          className="rounded-full px-1.5 py-0.5 text-[11px] font-semibold"
          style={{
            backgroundColor: `${freq.color}15`,
            color: freq.color,
          }}
        >
          · {freq.loc}
        </span>
      </div>
      {showRationale && (
        <p
          className="mt-1 text-[11px] font-medium leading-relaxed opacity-90"
          style={{ color: freq.color }}
        >
          {freq.rationale}
        </p>
      )}
    </div>
  );
}
