/**
 * Linking provider labels from a source EHR ("Kumutha Daniel, CRNP-PMH", "Mackenzie Goaneh LCPC",
 * "Dr. Gbadehan") to staff users. Shared by the Valant client and treatment plan imports.
 */

import { mappedUserId, type ProviderCodeMap } from '@/lib/migration/valantProviderMap';
import { isCaseloadAssignee } from '@/lib/clients/careTeam';

export const CREDENTIAL_RE = /,?\s*\b(MD|DO|CRNP(-PMH)?|PMHNP(-BC)?|DNP|NP|FNP|APRN|Nurse Practitioner|LCSW-?C|LCSW|LCPC(-S)?|LGPC|LPC|LMSW|MSW|LMFT|PsyD|PhD|RN|ADT|CPRS|CAC-?AD)\b.*$/i;

export type StaffRef = { id: string; name: string | null; role: string };

export function teamRole(credentials: string, staffRole?: string): string {
  if (/\b(MD|DO)\b/i.test(credentials) || staffRole === 'PSYCHIATRIST' || staffRole === 'PHYSICIAN') return 'Psychiatrist';
  if (/CRNP|PMHNP|DNP|\bNP\b|FNP|APRN|Nurse Practitioner/i.test(credentials) || staffRole === 'NP' || staffRole === 'MEDICAL_NP') return 'Nurse Practitioner';
  if (/LCSW|LCPC|LGPC|LPC|LMSW|MSW|LMFT|PsyD|PhD/i.test(credentials) || staffRole === 'THERAPIST') return 'Therapist';
  return 'Clinician';
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z\s-]/g, ' ').replace(/\s+/g, ' ').trim();

/** Link a source provider label ("Kumutha Daniel, CRNP-PMH", "Dr. Gbadehan") to one staff user, if unambiguous */
export function resolveProvider(raw: string, staff: StaffRef[]) {
  const m = raw.match(CREDENTIAL_RE);
  const credentials = m ? m[0].replace(/^,?\s*/, '').trim() : '';
  const clean = raw.replace(CREDENTIAL_RE, '').replace(/^dr\.?\s+/i, '').trim();
  const n = norm(clean);
  const parts = n.split(' ').filter(Boolean);
  const people = staff.map((s) => ({ s, p: norm(s.name || '').split(' ').filter(Boolean) })).filter((x) => x.p.length);
  let hits = people.filter((x) => x.p.join(' ') === n);
  if (!hits.length && parts.length >= 2) {
    hits = people.filter((x) => x.p[0] === parts[0] && x.p[x.p.length - 1] === parts[parts.length - 1]);
  }
  if (!hits.length && parts.length === 1) {
    // "Dr. Gbadehan": a unique last name
    hits = people.filter((x) => x.p[x.p.length - 1] === parts[0]);
  }
  const staffRef = hits.length === 1 ? hits[0].s : null;
  return { name: clean || raw.trim(), credentials, staff: staffRef, role: teamRole(credentials, staffRef?.role) };
}

/** A segment that is only a credential ("CRNP-PMH", "Nurse Practitioner"), not a person */
function isCredentialOnly(segment: string) {
  const m = segment.match(CREDENTIAL_RE);
  return !!m && m.index === 0;
}

/**
 * Split a multi-provider cell into one label per person. Commas also separate a name from its
 * credentials ("Kumutha Daniel, CRNP-PMH"), so a credential-only segment stays with the name before it.
 */
export function splitProviderList(raw: string): string[] {
  const out: string[] = [];
  for (const piece of String(raw ?? '').split(/[;\n|]+/)) {
    for (const seg of piece.split(',').map((s) => s.trim()).filter(Boolean)) {
      if (out.length && isCredentialOnly(seg)) out[out.length - 1] += `, ${seg}`;
      else out.push(seg);
    }
  }
  return out;
}

/** Staff for the client import: roles[] lets a leadership account with a clinical role be a primary. */
export type ImportStaffRef = StaffRef & { roles?: string[] | null };

/**
 * Link one provider label for the client import: a person-made ValantProviderMap mapping wins
 * (src/lib/migration/valantProviderMap.ts; the label or its name without credentials as the code),
 * then the unambiguous name match (resolveProvider).
 */
export function resolveImportProvider(raw: string, staff: ImportStaffRef[], codeMap?: ProviderCodeMap | null) {
  const r = resolveProvider(raw, staff);
  if (codeMap && codeMap.size) {
    const mapped = mappedUserId(raw, codeMap) ?? mappedUserId(r.name, codeMap);
    const hit = mapped ? staff.find((s) => s.id === mapped) : undefined;
    if (hit) return { ...r, staff: hit, role: teamRole(r.credentials, hit.role) };
  }
  return r;
}

/**
 * Client.assignedToId for an imported chart: the first linked provider with a caseload role, else
 * NULL. Never the importing user: a chart Valant sent without a (linkable) provider stays unassigned
 * so it shows in "No clinician" instead of on an admin's caseload.
 */
export function importAssigneeId(
  members: readonly { providerId: string | null }[],
  staff: readonly ImportStaffRef[]
): string | null {
  const byId = new Map(staff.map((s) => [s.id, s]));
  for (const m of members) {
    const s = m.providerId ? byId.get(m.providerId) : undefined;
    if (s && isCaseloadAssignee(s)) return s.id;
  }
  return null;
}
