import type { Client, StaffMember } from '@/features/clients/types';
import { STAFF_ACCEPTED_PAYERS } from '@/lib/constants/payers';

// No hardcoded sample staff or clients — real records come from the API.
export const INITIAL_STAFF_MEMBERS: StaffMember[] = [];

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
      color: '#15803D',
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
      color: '#15803D',
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
