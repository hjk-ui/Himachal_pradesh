/**
 * Provider pickers on the schedule (booking form, block time, calendar columns, provider filter):
 * grouped by role in a fixed order, A–Z by name inside each group, so staff find a provider fast.
 */
const GROUPS: { label: string; roles: string[] }[] = [
  { label: 'Psychiatrists', roles: ['PSYCHIATRIST'] },
  { label: 'Psychiatric NPs', roles: ['NP', 'NURSE_PRACTITIONER'] },
  { label: 'Therapists', roles: ['THERAPIST', 'CLINICIAN', 'CLINICAL_SUPERVISOR'] },
  { label: 'Primary care physicians', roles: ['PHYSICIAN'] },
  { label: 'Primary care NPs', roles: ['MEDICAL_NP'] },
  { label: 'PRP specialists', roles: ['PRP_SPECIALIST'] },
  { label: 'Case managers', roles: ['CASE_MANAGER'] },
  { label: 'Peer support', roles: ['PEER_SUPPORT'] },
  { label: 'Leadership', roles: ['PRACTICE_DIRECTOR', 'DIRECTOR', 'ADMIN'] },
];
const OTHER = 'Other staff';

export function providerGroupLabel(role: string | null | undefined): string {
  const r = String(role ?? '').toUpperCase();
  return GROUPS.find((g) => g.roles.includes(r))?.label ?? OTHER;
}

function groupRank(label: string): number {
  const i = GROUPS.findIndex((g) => g.label === label);
  return i < 0 ? GROUPS.length : i;
}

/** Role group order, then name A–Z (case-insensitive). */
export function sortProviders<T extends { name: string; role?: string | null }>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    const ga = groupRank(providerGroupLabel(a.role));
    const gb = groupRank(providerGroupLabel(b.role));
    return ga - gb || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
}

/** Sorted providers split into their non-empty role groups, in order. */
export function groupProviders<T extends { name: string; role?: string | null }>(list: T[]): { label: string; items: T[] }[] {
  const out: { label: string; items: T[] }[] = [];
  for (const p of sortProviders(list)) {
    const label = providerGroupLabel(p.role);
    const last = out.at(-1);
    if (last && last.label === label) last.items.push(p);
    else out.push({ label, items: [p] });
  }
  return out;
}
