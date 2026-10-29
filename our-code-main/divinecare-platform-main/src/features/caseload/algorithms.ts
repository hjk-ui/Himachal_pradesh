import type { Client, StaffMember, TreatmentTeam } from '@/features/clients/types';
import type { CaseloadStats, MatchScoreResult, TreatmentRoleSlot } from './types';

export const CLINICIAN_ROLES: StaffMember['role'][] = [
  'therapist',
  'psychiatrist',
  'np',
  'prp_specialist',
  'case_manager',
  'peer_support',
];

export const ADMIN_ROLES: StaffMember['role'][] = [
  'practice_director',
  'office_manager',
  'admin',
];

export const ROLE_SLOT_MAP: Record<string, keyof TreatmentTeam> = {
  therapist: 'primaryTherapistId',
  psychiatrist: 'prescriberId',
  np: 'prescriberId',
  case_manager: 'caseManagerId',
  prp_specialist: 'prpSpecialistId',
  peer_support: 'peerSupportId',
  // uppercase platform roles mapping
  THERAPIST: 'primaryTherapistId',
  PSYCHIATRIST: 'prescriberId',
  NP: 'prescriberId',
  CASE_MANAGER: 'caseManagerId',
  PRP_SPECIALIST: 'prpSpecialistId',
  PEER_SUPPORT: 'peerSupportId',
  CLINICIAN: 'primaryTherapistId',
};

export const SLOT_NAME_MAP: Record<keyof TreatmentTeam, keyof TreatmentTeam> = {
  primaryTherapistId: 'primaryTherapistName',
  primaryTherapistName: 'primaryTherapistName',
  prescriberId: 'prescriberName',
  prescriberName: 'prescriberName',
  caseManagerId: 'caseManagerName',
  caseManagerName: 'caseManagerName',
  prpSpecialistId: 'prpSpecialistName',
  prpSpecialistName: 'prpSpecialistName',
  peerSupportId: 'peerSupportName',
  peerSupportName: 'peerSupportName',
  primaryCareId: 'primaryCareName',
  primaryCareName: 'primaryCareName',
  copay: 'copay',
};

export const SLOT_ROLE_MAP: Record<string, StaffMember['role'][]> = {
  primaryTherapistId: ['therapist'],
  prescriberId: ['psychiatrist', 'np'],
  caseManagerId: ['case_manager'],
  prpSpecialistId: ['prp_specialist'],
  peerSupportId: ['peer_support'],
};

export const ROLE_LABEL_MAP: Record<string, string> = {
  primaryTherapistId: 'Primary Therapist',
  prescriberId: 'Prescriber',
  caseManagerId: 'Case Manager',
  prpSpecialistId: 'PRP Specialist',
  peerSupportId: 'Peer Support',
};

export const ROLE_COLORS: Record<string, string> = {
  therapist: '#00897B',
  primaryTherapistId: '#00897B',
  psychiatrist: '#1565C0',
  np: '#1565C0',
  prescriberId: '#1565C0',
  case_manager: '#E65100',
  caseManagerId: '#E65100',
  prp_specialist: '#00695C',
  prpSpecialistId: '#00695C',
  peer_support: '#6D4C41',
  peerSupportId: '#6D4C41',
  admin: '#5C2D91',
  practice_director: '#5C2D91',
  office_manager: '#5C2D91',
};

export const STATUS_COLORS = {
  high: '#DC2626',
  medium: '#D97706',
  low: '#16A34A',
} as const;

/**
 * Dual-metric calculation for Client Acuity Score:
 * Acuity = 10 + RiskWeight + ComplexityWeight
 * Risk: High = 15, Medium = 5, Low = 0
 * Complexity: 3 = 10, 2 = 5, 1 = 0
 */
export function calculateClientAcuity(client: Client): number {
  let riskWeight = 0;
  const risk = (client.risk || '').toLowerCase();
  if (risk === 'high') riskWeight = 15;
  else if (risk === 'medium') riskWeight = 5;

  let complexityWeight = 0;
  const complexity = client.diagnosisComplexity ?? 1;
  if (complexity === 3) complexityWeight = 10;
  else if (complexity === 2) complexityWeight = 5;

  return 10 + riskWeight + complexityWeight;
}

/**
 * Safe Acuity Ceiling = staff.maxCaseload * 15
 */
export function calculateSafeAcuityCeiling(staff: StaffMember): number {
  const max = staff.maxCaseload > 0 ? staff.maxCaseload : 25;
  return max * 15;
}

/**
 * Color and Status label by percentage:
 * Green (< 65%), Amber (65% - 85%), Red (> 85% - Near Limit)
 */
export function getThresholdStatus(percentage: number): {
  status: 'Available' | 'Moderate' | 'Near limit';
  color: 'green' | 'amber' | 'red';
} {
  if (percentage < 65) {
    return { status: 'Available', color: 'green' };
  }
  if (percentage <= 85) {
    return { status: 'Moderate', color: 'amber' };
  }
  return { status: 'Near limit', color: 'red' };
}

/**
 * Check if a client is assigned to a specific staff member
 */
export function isClientAssignedToStaff(client: Client, staff: StaffMember): boolean {
  const team = client.treatmentTeam;
  if (!team) return false;
  return (
    team.primaryTherapistId === staff.id ||
    team.prescriberId === staff.id ||
    team.caseManagerId === staff.id ||
    team.prpSpecialistId === staff.id ||
    team.peerSupportId === staff.id
  );
}

/**
 * Calculate caseload stats and dual capacity utilization for a staff member
 */
export function calculateStaffCaseload(
  staff: StaffMember,
  allClients: Client[]
): CaseloadStats {
  const assignedClients = allClients.filter((c) => isClientAssignedToStaff(c, staff));
  const totalClients = assignedClients.length;
  const maxCaseload = staff.maxCaseload > 0 ? staff.maxCaseload : 25;
  const safeCeiling = calculateSafeAcuityCeiling(staff);

  const totalAcuity = assignedClients.reduce(
    (sum, client) => sum + calculateClientAcuity(client),
    0
  );

  const highRiskCount = assignedClients.filter((c) => (c.risk || '').toLowerCase() === 'high').length;
  const mediumRiskCount = assignedClients.filter((c) => (c.risk || '').toLowerCase() === 'medium').length;
  const lowRiskCount = assignedClients.filter((c) => (c.risk || '').toLowerCase() === 'low').length;

  const upcomingAppointmentsCount = assignedClients.filter((c) => Boolean(c.nextAppointment)).length;

  const headcountPct = Math.round((totalClients / maxCaseload) * 100);
  const acuityPct = Math.round((totalAcuity / safeCeiling) * 100);

  // Highest tier between headcount and acuity determines overall warning state
  const effectivePct = Math.max(headcountPct, acuityPct);
  const { status: statusLabel, color } = getThresholdStatus(effectivePct);

  return {
    staff,
    assignedClients,
    totalClients,
    highRiskCount,
    mediumRiskCount,
    lowRiskCount,
    upcomingAppointmentsCount,
    totalAcuity,
    safeCeiling,
    headcountPct,
    acuityPct,
    statusLabel,
    color,
  };
}

/**
 * License expiry days calculation:
 * (new Date(staff.licenseExpiry).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
 * Returns null if no licenseExpiry provided.
 */
export function getDaysUntilLicenseExpiry(licenseExpiry?: string): number | null {
  if (!licenseExpiry) return null;
  const target = new Date(licenseExpiry).getTime();
  if (Number.isNaN(target)) return null;
  const diffDays = Math.floor((target - Date.now()) / (1000 * 60 * 60 * 24));
  return diffDays;
}

export function isLicenseExpiringSoon(licenseExpiry?: string): boolean {
  const days = getDaysUntilLicenseExpiry(licenseExpiry);
  return days !== null && days >= 0 && days < 90;
}

/**
 * Smart Matching Scoring Engine (scoreMatches)
 * Ranks available clinicians for a given client:
 * - Specialty Alignment: +20 points for every staff specialty that matches keywords in client.diagnosis
 * - Caseload Capacity Tier:
 *     < 50% utilization: +30 points (Plenty of capacity)
 *     50% - 75%: +15 points (Has capacity)
 *     75% - 90%: +5 points (Limited capacity)
 *     > 90%: -10 points (Near capacity penalty)
 * - Insurance / Payer Alignment: +15 points if staff.acceptedPayers includes client.insuranceType (flag "Payer mismatch" if not)
 * - Supervision Penalty: -5 points if isSupervisee === true ("Pre-licensed / Supervised")
 * - Sort descending by total score.
 */
export function scoreMatches(
  client: Partial<Client>,
  staffList: StaffMember[],
  allClients: Client[],
  targetRoleSlot?: keyof TreatmentTeam
): MatchScoreResult[] {
  // Normalize client attributes
  const diagnosisText = [
    client.diagnosis,
    client.primaryDiagnosis,
    client.secondaryDiagnoses,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  const clientPayer = (
    client.insuranceType ||
    client.insurancePayer ||
    ''
  ).toLowerCase().trim();

  const results: MatchScoreResult[] = [];

  // Filter by target role slot if requested
  const allowedRoles = targetRoleSlot ? SLOT_ROLE_MAP[targetRoleSlot] : undefined;

  const eligibleStaff = allowedRoles
    ? staffList.filter((s) => allowedRoles.includes(s.role))
    : staffList.filter((s) => CLINICIAN_ROLES.includes(s.role));

  for (const staff of eligibleStaff) {
    let score = 0;
    const reasons: string[] = [];

    // 1. Specialty Alignment (+20 pts per match)
    const matchedSpecialties: string[] = [];
    for (const spec of staff.specialties) {
      const s = spec.toLowerCase().trim();
      if (diagnosisText.includes(s)) {
        score += 20;
        matchedSpecialties.push(spec.toUpperCase());
      }
    }
    if (matchedSpecialties.length > 0) {
      reasons.push(`Specialty: ${matchedSpecialties.join(', ')}`);
    }

    // 2. Caseload Capacity Tier
    const assignedCount = allClients.filter((c) => isClientAssignedToStaff(c, staff)).length;
    const maxCaseload = staff.maxCaseload > 0 ? staff.maxCaseload : 25;
    const headcountUtilizationPct = Math.round((assignedCount / maxCaseload) * 100);

    const safeCeiling = calculateSafeAcuityCeiling(staff);
    const assignedClients = allClients.filter((c) => isClientAssignedToStaff(c, staff));
    const totalAcuity = assignedClients.reduce(
      (sum, c) => sum + calculateClientAcuity(c),
      0
    );
    const acuityUtilizationPct = Math.round((totalAcuity / safeCeiling) * 100);

    if (headcountUtilizationPct < 50) {
      score += 30;
      reasons.push('Plenty of capacity (<50%)');
    } else if (headcountUtilizationPct <= 75) {
      score += 15;
      reasons.push('Has capacity (50-75%)');
    } else if (headcountUtilizationPct <= 90) {
      score += 5;
      reasons.push('Limited capacity (75-90%)');
    } else {
      score -= 10;
      reasons.push('Near capacity penalty (>90%)');
    }

    // 3. Insurance / Payer Alignment (+15 pts or Payer mismatch) — prefix match
    let payerMismatch = false;
    if (clientPayer) {
      const staffPayers = staff.acceptedPayers || [];
      const isAccepted = staffPayers.some(
        (p) =>
          p.toLowerCase() === clientPayer ||
          p.toLowerCase().startsWith(clientPayer + '-')
      );
      if (isAccepted) {
        score += 15;
        reasons.push(`Accepts payer (${clientPayer})`);
      } else {
        payerMismatch = true;
        reasons.push('Payer mismatch');
      }
    }

    // 4. Supervision Penalty (-5 pts if supervisee)
    if (staff.isSupervisee) {
      score -= 5;
      reasons.push('Pre-licensed / Supervised');
    }

    results.push({
      staff,
      score,
      reasons,
      isBestMatch: false,
      assignedCount,
      maxCaseload,
      headcountUtilizationPct,
      acuityUtilizationPct,
      payerMismatch,
    });
  }

  // Sort descending by total score
  results.sort((a, b) => b.score - a.score);

  if (results.length > 0) {
    results[0].isBestMatch = true;
  }

  return results;
}

/**
 * On a user's caseload = assigned clinician OR any care-team slot/member (mirrors the
 * server's caseloadMemberWhere). Never rely on assignedToId or treatmentTeam alone.
 */
export function isOnMyCaseload(client: Client, userId: string | null | undefined): boolean {
  if (!userId) return false;
  if (client.assignedToId === userId) return true;
  const team = client.treatmentTeam as unknown;
  if (Array.isArray(team)) {
    return team.some(
      (m: { id?: string; providerId?: string } | null) => m?.id === userId || m?.providerId === userId
    );
  }
  if (team && typeof team === 'object') {
    const t = team as TreatmentTeam;
    return [
      t.primaryTherapistId,
      t.prescriberId,
      t.caseManagerId,
      t.prpSpecialistId,
      t.peerSupportId,
    ].includes(userId);
  }
  return false;
}

/**
 * Role-Based Access Control (RBAC) & Supervision Visibility
 * Clinicians: Visible clients = Any client where client.treatmentTeam[userRoleSlot] === user.uid
 * PLUS any client where assigned staff member is supervised by current clinician (staff.supervisorId === user.uid).
 * Admins / Directors: Can view all clients.
 */
export function getVisibleClientsForUser(
  user: { id?: string; uid?: string; role?: string; baseRole?: string } | null,
  clients: Client[],
  staffList: StaffMember[]
): Client[] {
  if (!user) return clients;
  const roleStr = (user.role || '').toLowerCase();
  const baseRoleStr = (user.baseRole || '').toLowerCase();

  const isAdmin =
    roleStr === 'admin' ||
    roleStr === 'director' ||
    roleStr === 'practice_director' ||
    roleStr === 'office_manager' ||
    roleStr === 'super_admin' ||
    baseRoleStr === 'admin';

  if (isAdmin) {
    return clients;
  }

  const userId = user.id || user.uid;
  if (!userId) return clients;

  // Determine user's role slot or staff identity
  const currentStaff = staffList.find(
    (s) => s.id === userId || s.name?.toLowerCase() === (user as any).name?.toLowerCase()
  );

  // Find supervisees of this clinician
  const superviseeIds = staffList
    .filter((s) => s.supervisorId === userId || (currentStaff && s.supervisorId === currentStaff.id))
    .map((s) => s.id);

  const targetSlot = currentStaff ? ROLE_SLOT_MAP[currentStaff.role] : ROLE_SLOT_MAP[user.role || ''];

  return clients.filter((client) => {
    // Assigned clinician or care-team member always sees the client (even without slot JSON).
    if (isOnMyCaseload(client, userId)) return true;

    const team = client.treatmentTeam;
    if (!team) return false;

    // Check direct slot assignment
    if (targetSlot && team[targetSlot] === userId) return true;

    // Check any slot matching userId
    const isDirectlyAssigned =
      team.primaryTherapistId === userId ||
      team.prescriberId === userId ||
      team.caseManagerId === userId ||
      team.prpSpecialistId === userId ||
      team.peerSupportId === userId;

    if (isDirectlyAssigned) return true;

    // Check if any assigned team member is a supervisee
    const teamMemberIds = [
      team.primaryTherapistId,
      team.prescriberId,
      team.caseManagerId,
      team.prpSpecialistId,
      team.peerSupportId,
    ].filter(Boolean) as string[];

    const hasSuperviseeAssigned = teamMemberIds.some((id) => superviseeIds.includes(id));
    return hasSuperviseeAssigned;
  });
}

/**
 * Check if a client is considered on the waitlist
 * (triggered when any client has no therapist, prescriber, or case manager)
 */
export function isClientOnWaitlist(client: Client): boolean {
  const team = client.treatmentTeam;
  if (!team) return true;
  return !team.primaryTherapistId && !team.prescriberId && !team.caseManagerId;
}
