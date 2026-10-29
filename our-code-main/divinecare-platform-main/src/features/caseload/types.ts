import type { Client, StaffMember, TreatmentTeam, TreatmentTeamStaffSlot } from '@/features/clients/types';

export type TreatmentRoleSlot = TreatmentTeamStaffSlot;

export type HandoffType = 'permanent' | 'co_treatment' | 'temporary_coverage';

export const HANDOFF_TYPES = [
  {
    id: 'permanent' as const,
    title: 'Permanent Transfer',
    description: 'Receiving clinician becomes primary owner for this role',
  },
  {
    id: 'co_treatment' as const,
    title: 'Co-treatment',
    description: 'Both clinicians work concurrently across complementary roles',
  },
  {
    id: 'temporary_coverage' as const,
    title: 'Temporary Coverage',
    description: 'Short-term coverage; original provider resumes upon return',
  },
];

export const TRANSFER_REASONS = [
  'Clinician departure / leave of absence',
  'Client request',
  'Specialty mismatch — needs different expertise',
  'Caseload balancing',
  'Schedule / location conflict',
  'Level of care change',
  'Supervisee graduated to licensed clinician',
  'Other',
] as const;

export type TransferReason = (typeof TRANSFER_REASONS)[number];

export interface MatchScoreResult {
  staff: StaffMember;
  score: number;
  reasons: string[];
  isBestMatch: boolean;
  assignedCount: number;
  maxCaseload: number;
  headcountUtilizationPct: number;
  acuityUtilizationPct: number;
  payerMismatch: boolean;
}

export interface CaseloadStats {
  staff: StaffMember;
  assignedClients: Client[];
  totalClients: number;
  highRiskCount: number;
  mediumRiskCount: number;
  lowRiskCount: number;
  upcomingAppointmentsCount: number;
  totalAcuity: number;
  safeCeiling: number;
  headcountPct: number;
  acuityPct: number;
  statusLabel: 'Available' | 'Moderate' | 'Near limit';
  color: 'green' | 'amber' | 'red';
}
