import type { Role } from '@prisma/client';

/**
 * Free-text job titles → Prisma Role (exactly 36 aliases per migration spec).
 */
export const ROLE_ALIASES: Record<string, Role> = {
  // therapist (6)
  therapist: 'THERAPIST',
  lcsw: 'THERAPIST',
  lpc: 'THERAPIST',
  lmft: 'THERAPIST',
  counselor: 'THERAPIST',
  clinician: 'THERAPIST',

  // psychiatrist (3)
  psychiatrist: 'PSYCHIATRIST',
  md: 'PSYCHIATRIST',
  physician: 'PSYCHIATRIST',

  // np (6)
  'nurse practitioner': 'NP',
  np: 'NP',
  arnp: 'NP',
  aprn: 'NP',
  fnp: 'NP',
  pmhnp: 'NP',

  // prp (2)
  'prp specialist': 'PRP_SPECIALIST',
  prp: 'PRP_SPECIALIST',

  // case manager (2)
  'case manager': 'CASE_MANAGER',
  case_manager: 'CASE_MANAGER',

  // peer (3)
  'peer support': 'PEER_SUPPORT',
  peer_support: 'PEER_SUPPORT',
  'peer specialist': 'PEER_SUPPORT',

  // practice director (2)
  'practice director': 'PRACTICE_DIRECTOR',
  director: 'PRACTICE_DIRECTOR',

  // office manager (4)
  'office manager': 'OFFICE_MANAGER',
  office_manager: 'OFFICE_MANAGER',
  receptionist: 'OFFICE_MANAGER',
  'front desk': 'OFFICE_MANAGER',

  // billing (4)
  'billing specialist': 'BILLING',
  billing: 'BILLING',
  billing_specialist: 'BILLING',
  rcm: 'BILLING',

  // hr (2)
  'hr manager': 'HR',
  hr: 'HR',

  // admin (2)
  admin: 'ADMIN',
  administrator: 'ADMIN',
};

const PRISMA_ROLES = new Set<string>([
  'THERAPIST',
  'PSYCHIATRIST',
  'NP',
  'PRP_SPECIALIST',
  'CASE_MANAGER',
  'PEER_SUPPORT',
  'PRACTICE_DIRECTOR',
  'OFFICE_MANAGER',
  'BILLING',
  'HR',
  'ADMIN',
  'CLINICIAN',
  'FRONT_DESK',
  'DIRECTOR',
]);

export function resolveRoleAlias(raw: string | null | undefined): Role | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const asEnum = trimmed.toUpperCase().replace(/\s+/g, '_');
  if (PRISMA_ROLES.has(asEnum)) {
    if (asEnum === 'DIRECTOR') return 'PRACTICE_DIRECTOR';
    if (asEnum === 'CLINICIAN') return 'THERAPIST';
    if (asEnum === 'FRONT_DESK') return 'OFFICE_MANAGER';
    return asEnum as Role;
  }

  const key = trimmed.toLowerCase().replace(/\s+/g, ' ').trim();
  if (ROLE_ALIASES[key]) return ROLE_ALIASES[key];

  const underscored = key.replace(/\s+/g, '_');
  if (ROLE_ALIASES[underscored]) return ROLE_ALIASES[underscored];

  for (const [alias, role] of Object.entries(ROLE_ALIASES)) {
    if (key.includes(alias) || underscored.includes(alias.replace(/\s+/g, '_'))) {
      return role;
    }
  }

  return null;
}

export const ROLE_ALIAS_COUNT = Object.keys(ROLE_ALIASES).length;
