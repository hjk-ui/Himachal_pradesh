import type { RiskLevel } from '@/types/common';
import type { SeenByProvider } from '@/lib/clients/careTeamSummary';

export type ClientStatus = 'ACTIVE' | 'INACTIVE' | 'DISCHARGED';

export interface ClientCheckIn {
  id?: string;
  date: string;
  dateKey?: string;
  mood: number;
  stress: number;
  /** Sleep quality 1–10 when reported (patient app or staff log) */
  sleep?: number | null;
  note?: string | null;
  createdAt?: string;
}

export interface CopayValue {
  amount: number;
  unit: 'USD';
}

export type TreatmentTeamStaffSlot =
  | 'primaryTherapistId'
  | 'prescriberId'
  | 'caseManagerId'
  | 'prpSpecialistId'
  | 'peerSupportId';

// 5-Slot Multi-Disciplinary Treatment Team
export interface TreatmentTeam {
  primaryTherapistId?:  string; primaryTherapistName?:  string;
  prescriberId?:        string; prescriberName?:        string;
  caseManagerId?:       string; caseManagerName?:       string;
  prpSpecialistId?:     string; prpSpecialistName?:     string;
  peerSupportId?:       string; peerSupportName?:       string;
  /** Primary care provider (PCP) — set from the chart via PUT /api/clients/[id]/pcp. */
  primaryCareId?:       string; primaryCareName?:       string;
  copay?:               CopayValue;
}

export interface TreatmentTeamMember {
  id: string;
  name: string;
  role: string;
  initials: string;
  color: string;
  primary: boolean;
}

// Staff Member with Specialties, Payer Acceptance, Supervision & Licensing
export interface StaffMember {
  id: string;
  name: string;
  role: 'therapist' | 'psychiatrist' | 'np' | 'prp_specialist' | 'case_manager' | 'peer_support' | 'admin' | 'practice_director' | 'office_manager';
  credential: string; // e.g. LCSW, MD, PMHNP-BC, PRP, CCM, MSW Intern
  color: string;
  maxCaseload: number;
  specialties: string[]; // e.g. ['trauma', 'ptsd', 'cbt', 'depression', 'anxiety', 'adhd', 'sud', 'bipolar']
  languages: string[];
  acceptedPayers: string[]; // ['medicaid', 'medicare', 'commercial', 'self-pay']
  isSupervisee?: boolean;
  supervisorId?: string;
  supervisorName?: string;
  licenseExpiry?: string; // ISO date 'YYYY-MM-DD'
}

export interface Client {
  id: string;
  /** Clinic Medical Record Number (unique per organization) */
  mrn?: string | null;
  name: string;
  email: string;
  phone: string;
  image?: string | null;
  assignedSince: string;
  lastCheckIn: string;
  avgMood: number | null;
  avgStress: number | null;
  avgSleep?: number | null;
  streak: number;
  risk: RiskLevel;
  totalSessions: number;
  nextAppointment?: string;
  treatmentTeam?: TreatmentTeam;
  diagnosis?: string;
  insuranceType?: string;
  diagnosisComplexity?: 1 | 2 | 3;
  status?: ClientStatus;
  primaryDiagnosis?: string | null;
  primaryDiagnosisCode?: string | null;
  secondaryDiagnoses?: string | null;
  insurancePayer?: string | null;
  insuranceMemberId?: string | null;
  insuranceGroupNumber?: string | null;
  dateOfBirth?: string | null;
  gender?: string | null;
  addressLine1?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  locationName?: string | null;
  primaryLocationId?: string | null;
  assignedToName?: string | null;
  /** Staff role of the assigned user — a non-clinical assignee is not shown as the clinician. */
  assignedToRole?: string | null;
  /** Providers with a COMPLETED visit in the last 18 months. */
  seenBy?: SeenByProvider[];
  appAccess?: 'none' | 'invite_sent' | 'active';
  patientAccount?: {
    id: string;
    email: string;
    status: 'INVITED' | 'ACTIVE' | 'DISABLED';
    isInvited: boolean;
    isActive: boolean;
    inviteExpired?: boolean;
  } | null;
  hieLastQueryAt?: string | null;
  assignedToId?: string | null;
  checkInStreak?: number;
  checkIns?: ClientCheckIn[];
  /** Protected / sensitive record (Part 2 / VIP / employee, etc.) */
  isSensitive?: boolean;
  sensitiveReason?: string | null;
  /** When false, show lock card — no PHI in list payload */
  canAccessSensitive?: boolean;
}

export interface ClientProgressNote {
  id: string;
  body: string;
  createdAt: string;
  clinicianName?: string | null;
  clinicianEmail?: string | null;
  clinicianImage?: string | null;
  workflowStatus?: 'Draft' | 'Signed' | 'Locked';
  signedAt?: string | null;
  lockedAt?: string | null;
  noteType?: string | null;
  billingCode?: string | null;
  telehealth?: boolean;
  placeOfService?: string | null;
  sudConfidential?: boolean;
  durationMinutes?: number | null;
  dismissedAt?: string | null;
  dismissReason?: string | null;
}

export interface EhrProgressNote extends ClientProgressNote {
  clientId: string;
  clientName: string;
  clientImage?: string | null;
}

export type CreateClientInput = {
  name: string;
  email?: string | null;
  phone?: string | null;
  dateOfBirth?: string | null;
  gender?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  insurancePayer?: string | null;
  insuranceMemberId?: string | null;
  insuranceGroupNumber?: string | null;
  primaryDiagnosis?: string | null;
  primaryDiagnosisCode?: string | null;
  secondaryDiagnoses?: string | null;
  legalFirstName?: string | null;
  middleInitial?: string | null;
  legalLastName?: string | null;
  locationId?: string | null;
  assignedToId?: string | null;
  status?: ClientStatus;
};

export type UpdateClientInput = {
  name?: string;
  email?: string | null;
  phone?: string | null;
  dateOfBirth?: string | null;
  gender?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  insurancePayer?: string | null;
  insuranceMemberId?: string | null;
  insuranceGroupNumber?: string | null;
  primaryDiagnosis?: string | null;
  primaryDiagnosisCode?: string | null;
  secondaryDiagnoses?: string | null;
  assignedToId?: string | null;
  status?: ClientStatus;
  riskLevel?: RiskLevel | string;
};

export type UpdateClientInsuranceInput = {
  insurancePayer?: string | null;
  insuranceMemberId?: string | null;
  insuranceGroupNumber?: string | null;
};

export type CreateCheckInInput = {
  mood: number;
  stress: number;
  sleep?: number | null;
  note?: string | null;
};
