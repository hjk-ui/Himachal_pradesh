import type { StaffRole } from '@/types/roles';

export interface RolePersona {
  role: StaffRole;
  alias: string;
  name: string;
  title: string;
  email: string;
  group: 'administrative' | 'clinical' | 'leadership';
  color: string;
  background: string;
  iconName: 'CreditCard' | 'ClipboardCheck' | string;
  iconEmoji: string;
  coreFocus: string[];
  hipaaGuardrail: string;
  quickActions: { label: string; href: string }[];
}

export const ROLE_PERSONAS: Record<
  'BILLING' | 'OFFICE_MANAGER' | 'PHYSICIAN' | 'MEDICAL_NP' | 'MEDICAL_ASSISTANT' | 'CRISIS_RESPONDER',
  RolePersona
> = {
  BILLING: {
    role: 'BILLING',
    alias: 'billing_specialist',
    name: 'Billing Specialist',
    title: 'Certified Professional Coder',
    email: '',
    group: 'administrative',
    color: '#F57F17',
    background: '#FFFDE7',
    iconName: 'CreditCard',
    iconEmoji: '💳',
    coreFocus: [
      'Claims submission (837P / CMS-1500)',
      'Clearinghouse (Availity) live integration',
      '835 Remittance / ERA auto-posting',
      'Denials management & appeals',
      'Superbills generation',
      'CPT fee schedule management',
      'Patient copays & invoices',
      'Insurance Panels directory',
      'Real-time 270/271 Eligibility verification',
      'Electronic Prior Authorizations',
      'AI Medical Coding & unbundling alerts',
    ],
    hipaaGuardrail:
      'Strictly CANNOT view clinical psychotherapy notes or sensitive clinical evaluations. Has read-only access to client demographics and insurance details.',
    quickActions: [
      { label: 'New Claim', href: '/dashboard/billing' },
      { label: 'Run Eligibility', href: '/dashboard/ehr/eligibility' },
      { label: 'View Denials', href: '/dashboard/billing/denials' },
    ],
  },
  OFFICE_MANAGER: {
    role: 'OFFICE_MANAGER',
    alias: 'office_manager',
    name: 'Office Manager',
    title: 'Office Manager',
    email: '',
    group: 'administrative',
    color: '#37474F',
    background: '#ECEFF1',
    iconName: 'ClipboardCheck',
    iconEmoji: '📋',
    coreFocus: [
      'Multi-provider appointment scheduling',
      'Digital client intake packets & triage',
      'Waitlist capacity triage',
      'Consent forms & Release of Information (ROI) renewals',
      'Patient satisfaction surveys',
      'CARF-compliant incident reporting',
      'Grievances log & resolution tracking',
      'Facility compliance calendar',
    ],
    hipaaGuardrail:
      'Manages administrative records and consent documents, but CANNOT write clinical notes or submit electronic insurance claims.',
    quickActions: [
      { label: 'Schedule Appt', href: '/dashboard/appointments' },
      { label: 'Check Eligibility', href: '/dashboard/ehr/eligibility' },
      { label: 'Send Consent', href: '/dashboard/ehr/consents' },
    ],
  },
  PHYSICIAN: {
    role: 'PHYSICIAN',
    alias: 'physician',
    name: 'Physician',
    title: 'Primary Care Physician / Family Medicine',
    email: '',
    group: 'clinical',
    color: '#0D47A1',
    background: '#E3F2FD',
    iconName: 'Stethoscope',
    iconEmoji: '🩺',
    coreFocus: [
      'Comprehensive primary care encounters & physicals',
      'Chronic disease management (HTN, T2DM, CKD, Dyslipidemia)',
      'USPSTF preventive health maintenance & cancer screenings',
      'Electronic prescriptions & controlled substance prescribing',
      'Diagnostic lab orders & panic value reviews',
      'Specialist consults & diagnostic imaging requisitions',
      'Somatic E&M coding (99212–99215) & charge capture',
    ],
    hipaaGuardrail:
      'Full authority over medical EHR and somatic clinical encounters. Strictly segregated from Behavioral Health psychotherapy notes and psychiatric crisis alerts (42 CFR Part 2 / HIPAA).',
    quickActions: [
      { label: 'Medical Overview', href: '/dashboard/medical' },
      { label: 'New Encounter', href: '/dashboard/medical/visits' },
      { label: 'Patient Roster', href: '/dashboard/medical/patients' },
      { label: 'Review Labs', href: '/dashboard/medical/labs' },
    ],
  },
  MEDICAL_NP: {
    role: 'MEDICAL_NP',
    alias: 'medical_np',
    name: 'Nurse Practitioner',
    title: 'Family Nurse Practitioner',
    email: '',
    group: 'clinical',
    color: '#1565C0',
    background: '#E8EAF6',
    iconName: 'UserCheck',
    iconEmoji: '👩‍⚕️',
    coreFocus: [
      'Adult & family primary care clinical visits',
      'Preventive health maintenance & USPSTF gap closures',
      'Routine and acute illness management',
      'Vitals and chronic condition tracking',
      'Electronic prescribing & medication reconciliation',
      'Specialist referrals & imaging requisitions',
    ],
    hipaaGuardrail:
      'Full authority over medical EHR and somatic encounters. Prohibited from accessing Behavioral Health psychotherapy records (42 CFR Part 2).',
    quickActions: [
      { label: 'Medical Overview', href: '/dashboard/medical' },
      { label: 'New Encounter', href: '/dashboard/medical/visits' },
      { label: 'Preventive Care', href: '/dashboard/medical/preventive-care' },
    ],
  },
  MEDICAL_ASSISTANT: {
    role: 'MEDICAL_ASSISTANT',
    alias: 'medical_assistant',
    name: 'Medical Assistant',
    title: 'Medical Assistant',
    email: '',
    group: 'clinical',
    color: '#00838F',
    background: '#E0F7FA',
    iconName: 'Activity',
    iconEmoji: '🩹',
    coreFocus: [
      'Patient rooming & vitals capture',
      'New patient intake preparation',
      'Medical visits & clinical flowsheet support',
      'Cross-department client roster navigation',
      'Diagnostic lab orders & specimen tracking',
      'Telehealth check-in & clinic communications',
    ],
    hipaaGuardrail:
      'Full access to Medical Department (overview, patients, intake, visits, history, vitals, labs) plus full client list across both departments, My To-Do, Telehealth, and Communications. Cannot prescribe.',
    quickActions: [
      { label: 'Medical Overview', href: '/dashboard/medical' },
      { label: 'Patients', href: '/dashboard/medical/patients' },
      { label: 'Clients Roster', href: '/dashboard/clients' },
      { label: 'Vitals Flowsheet', href: '/dashboard/medical/vitals' },
      { label: 'Labs & Orders', href: '/dashboard/medical/labs' },
    ],
  },
  CRISIS_RESPONDER: {
    role: 'CRISIS_RESPONDER',
    alias: 'crisis_responder',
    name: 'Crisis Responder',
    title: 'Crisis Responder',
    email: '',
    group: 'clinical',
    color: '#C62828',
    background: '#FFEBEE',
    iconName: 'Siren',
    iconEmoji: '🚨',
    coreFocus: [
      'CARF-aligned mobile crisis command center triage',
      'Two-person community field dispatch & response',
      'Mental Status Exam (MSE) & LRA documentation',
      'AWS Pinpoint SMS + Mobile Push + SNS team paging',
      'Suicide risk alerts & safety planning',
      'Urgent telehealth crisis intervention',
      'H2011 specialized billing charge capture',
    ],
    hipaaGuardrail:
      'Dedicated CARF mobile crisis command center, risk alerts, behavioral dashboard, telehealth, and communications. Zero PHI transmitted over paging channels.',
    quickActions: [
      { label: 'Mobile Crisis', href: '/dashboard/crisis' },
      { label: 'Risk Alerts', href: '/dashboard/alerts' },
      { label: 'My To-Do', href: '/dashboard/tasks' },
      { label: 'Telehealth', href: '/dashboard/telehealth' },
      { label: 'Communications', href: '/dashboard/communications' },
    ],
  },
};

/** Normalize any incoming role string (e.g., 'billing_specialist' -> 'BILLING'). */
export function normalizeStaffRole(role: string | null | undefined): StaffRole {
  if (!role) return 'THERAPIST';
  const clean = role.trim().toLowerCase();
  if (clean === 'billing_specialist' || clean === 'billing') return 'BILLING';
  if (clean === 'office_manager') return 'OFFICE_MANAGER';
  if (clean === 'physician') return 'PHYSICIAN';
  if (clean === 'medical_np') return 'MEDICAL_NP';
  if (clean === 'medical_assistant') return 'MEDICAL_ASSISTANT';
  if (clean === 'crisis_responder') return 'CRISIS_RESPONDER';
  const upper = role.trim().toUpperCase();
  if (upper === 'PHYSICIAN') return 'PHYSICIAN';
  if (upper === 'MEDICAL_NP') return 'MEDICAL_NP';
  if (upper === 'MEDICAL_ASSISTANT') return 'MEDICAL_ASSISTANT';
  if (upper === 'CRISIS_RESPONDER') return 'CRISIS_RESPONDER';
  return role as StaffRole;
}
