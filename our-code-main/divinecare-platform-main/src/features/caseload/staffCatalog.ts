import type { Client, StaffMember } from '@/features/clients/types';
import { STAFF_ACCEPTED_PAYERS } from '@/lib/constants/payers';

// In 55 days from now for David Kim's license (triggers <90 days compliance warning)
const nearExpiryDate = new Date(Date.now() + 55 * 24 * 60 * 60 * 1000)
  .toISOString()
  .split('T')[0];

export const INITIAL_STAFF_MEMBERS: StaffMember[] = [
  {
    id: 'staff-therapist-1',
    name: 'Marcus Reed',
    role: 'therapist',
    credential: 'LCSW-C, BCD',
    color: '#00897B',
    maxCaseload: 25,
    specialties: ['trauma', 'ptsd', 'cbt', 'depression', 'anxiety'],
    languages: ['English', 'Spanish'],
    acceptedPayers: [...STAFF_ACCEPTED_PAYERS.therapist],
    isSupervisee: false,
    licenseExpiry: '2027-11-15',
  },
  {
    id: 'staff-therapist-2',
    name: 'David Kim',
    role: 'therapist',
    credential: 'MSW Intern, LGPC',
    color: '#00897B',
    maxCaseload: 15,
    specialties: ['cbt', 'anxiety', 'depression', 'adhd'],
    languages: ['English', 'Korean'],
    acceptedPayers: [...STAFF_ACCEPTED_PAYERS.peer_support],
    isSupervisee: true,
    supervisorId: 'staff-therapist-1',
    supervisorName: 'Marcus Reed, LCSW-C',
    licenseExpiry: nearExpiryDate, // < 90 days warning!
  },
  {
    id: 'staff-therapist-3',
    name: 'Sarah Lin',
    role: 'therapist',
    credential: 'LPC, NCC',
    color: '#00897B',
    maxCaseload: 22,
    specialties: ['depression', 'anxiety', 'bipolar', 'grief'],
    languages: ['English', 'Mandarin'],
    acceptedPayers: [...STAFF_ACCEPTED_PAYERS.therapist],
    isSupervisee: false,
    licenseExpiry: '2028-05-30',
  },
  {
    id: 'staff-psychiatrist-1',
    name: 'Dr. Julian Martinez',
    role: 'psychiatrist',
    credential: 'MD, Board Certified',
    color: '#1565C0',
    maxCaseload: 30,
    specialties: ['bipolar', 'depression', 'adhd', 'sud', 'schizophrenia'],
    languages: ['English', 'Spanish'],
    acceptedPayers: [...STAFF_ACCEPTED_PAYERS.psychiatrist],
    isSupervisee: false,
    licenseExpiry: '2027-08-20',
  },
  {
    id: 'staff-np-1',
    name: 'Elena Rostova',
    role: 'np',
    credential: 'PMHNP-BC',
    color: '#1565C0',
    maxCaseload: 28,
    specialties: ['ptsd', 'depression', 'anxiety', 'bipolar', 'adhd'],
    languages: ['English', 'Russian'],
    acceptedPayers: [...STAFF_ACCEPTED_PAYERS.np],
    isSupervisee: false,
    licenseExpiry: '2027-04-12',
  },
  {
    id: 'staff-cm-1',
    name: 'Maya Lin',
    role: 'case_manager',
    credential: 'CCM, MSW',
    color: '#E65100',
    maxCaseload: 35,
    specialties: ['sud', 'housing', 'crisis', 'resources', 'advocacy'],
    languages: ['English', 'Mandarin'],
    acceptedPayers: [...STAFF_ACCEPTED_PAYERS.case_manager],
    isSupervisee: false,
    licenseExpiry: '2028-01-15',
  },
  {
    id: 'staff-prp-1',
    name: 'Tyrone Washington',
    role: 'prp_specialist',
    credential: 'PRP, CPRP',
    color: '#00695C',
    maxCaseload: 30,
    specialties: ['rehabilitation', 'daily_living', 'vocational', 'trauma', 'wellness'],
    languages: ['English'],
    acceptedPayers: [...STAFF_ACCEPTED_PAYERS.prp_specialist],
    isSupervisee: false,
    licenseExpiry: '2027-06-12',
  },
  {
    id: 'staff-peer-1',
    name: 'Jasmine Patel',
    role: 'peer_support',
    credential: 'CPRS, CRSS',
    color: '#6D4C41',
    maxCaseload: 25,
    specialties: ['sud', 'recovery', 'harm_reduction', 'community', 'advocacy'],
    languages: ['English', 'Hindi', 'Gujarati'],
    acceptedPayers: [...STAFF_ACCEPTED_PAYERS.peer_support],
    isSupervisee: false,
    licenseExpiry: '2027-09-05',
  },
  {
    id: 'staff-director-1',
    name: 'Dr. Patricia Vance',
    role: 'practice_director',
    credential: 'MD, FAPA',
    color: '#5C2D91',
    maxCaseload: 10,
    specialties: ['leadership', 'psychiatry', 'clinical_governance'],
    languages: ['English'],
    acceptedPayers: [...STAFF_ACCEPTED_PAYERS.psychiatrist],
    isSupervisee: false,
    licenseExpiry: '2027-12-31',
  },
  {
    id: 'staff-office-1',
    name: 'Alicia Gomez',
    role: 'office_manager',
    credential: 'MBA, CMPE',
    color: '#5C2D91',
    maxCaseload: 0,
    specialties: ['operations', 'intake', 'compliance', 'billing'],
    languages: ['English', 'Spanish'],
    acceptedPayers: [...STAFF_ACCEPTED_PAYERS.therapist],
    isSupervisee: false,
    licenseExpiry: '2030-01-01',
  },
  {
    id: 'staff-admin-1',
    name: 'Robert Vance',
    role: 'admin',
    credential: 'MHA',
    color: '#5C2D91',
    maxCaseload: 0,
    specialties: ['administration', 'health_informatics'],
    languages: ['English'],
    acceptedPayers: [...STAFF_ACCEPTED_PAYERS.therapist],
    isSupervisee: false,
    licenseExpiry: '2030-01-01',
  },
];

export const INITIAL_CLIENTS: Client[] = [];

export function staffUserToStaffMember(u: {
  id: string;
  name?: string | null;
  email: string;
  role: string;
  status?: string;
}): StaffMember {
  const roleUpper = (u.role || '').toUpperCase();
  const roleLower = (u.role || '').toLowerCase() as any;

  const roleMeta: Record<
    string,
    { cred: string; color: string; specialties: string[] }
  > = {
    PSYCHIATRIST: {
      cred: 'MD, Board Certified',
      color: '#1565C0',
      specialties: ['bipolar', 'depression', 'adhd', 'sud', 'schizophrenia', 'med-mgmt'],
    },
    NP: {
      cred: 'PMHNP-BC',
      color: '#0284C7',
      specialties: ['med-mgmt', 'depression', 'anxiety', 'adhd', 'mood-disorders'],
    },
    THERAPIST: {
      cred: 'LCSW-C',
      color: '#00897B',
      specialties: ['trauma', 'ptsd', 'cbt', 'depression', 'anxiety'],
    },
    PRACTICE_DIRECTOR: {
      cred: 'LCSW-C, Director',
      color: '#5C2D91',
      specialties: ['general', 'depression', 'anxiety', 'complex-trauma'],
    },
    DIRECTOR: {
      cred: 'Clinical Director',
      color: '#5C2D91',
      specialties: ['general', 'depression', 'anxiety'],
    },
    CASE_MANAGER: {
      cred: 'CCM',
      color: '#E65100',
      specialties: ['housing', 'entitlements', 'care-coordination', 'crisis-planning'],
    },
    PRP_SPECIALIST: {
      cred: 'PRP Specialist',
      color: '#6A1B9A',
      specialties: ['independent-living', 'social-skills', 'community-integration'],
    },
    PEER_SUPPORT: {
      cred: 'CRPS',
      color: '#2E7D32',
      specialties: ['recovery-coaching', 'lived-experience', 'harm-reduction'],
    },
    CLINICIAN: {
      cred: 'Clinician',
      color: '#00897B',
      specialties: ['general', 'cbt', 'depression', 'anxiety'],
    },
  };

  const meta = roleMeta[roleUpper] || {
    cred: (u.role || 'Staff').replace(/_/g, ' '),
    color: '#5C2D91',
    specialties: ['general', 'depression', 'anxiety'],
  };

  const payerKey =
    roleUpper === 'PSYCHIATRIST'
      ? 'psychiatrist'
      : roleUpper === 'NP'
        ? 'np'
        : roleUpper === 'CASE_MANAGER'
          ? 'case_manager'
          : roleUpper === 'PRP_SPECIALIST'
            ? 'prp_specialist'
            : roleUpper === 'PEER_SUPPORT'
              ? 'peer_support'
              : 'therapist';

  return {
    id: u.id,
    name: u.name || u.email,
    role: roleLower,
    credential: meta.cred,
    color: meta.color,
    maxCaseload: 30,
    specialties: meta.specialties,
    languages: ['English'],
    acceptedPayers: [...STAFF_ACCEPTED_PAYERS[payerKey]],
  };
}
