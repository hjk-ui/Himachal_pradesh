import { prisma } from '@/lib/db/prisma';
import { clientOrgFilter } from '@/lib/clients/orgScope';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { programCaseloadClientIds } from '@/lib/programs/caseloadRows';

/**
 * AOT clinical content (physician affidavit / MSE, diagnosis, eligibility criteria, non-adherence
 * events, MDH form bodies, AI eval-basis and court-report drafts): the EHR clinical roles only
 * (leadership + THERAPIST / CLINICIAN / PSYCHIATRIST / NP, same rule as /dashboard/ehr). Case
 * Manager, PRP, Peer Support and Crisis Responder keep the board's non-clinical fields (name,
 * status, county, dates, deadlines, team) for participants on their caseload.
 */
export function canSeeAotClinical(role: string | null | undefined): boolean {
  return canAccessPath(role, '/dashboard/ehr');
}

/** Participant columns that carry clinical content (blanked for non-clinical roles). */
export const AOT_CLINICAL_FIELDS = ['diagnosis', 'eligibilityData', 'psychiatristAffidavit', 'escalationEvents'] as const;
export const AOT_RESTRICTED_LABEL = 'Restricted: clinical detail limited to the treating clinicians';

/**
 * Participant row for this role: clinical columns blanked unless canSeeAotClinical. The MDH
 * petition checklist and referral source kind (operational, not clinical) stay in eligibilityData.
 */
export function redactAotParticipant<T extends Record<string, unknown>>(p: T, role: string | null | undefined): T {
  if (canSeeAotClinical(role)) return p;
  const elig = p.eligibilityData && typeof p.eligibilityData === 'object' && !Array.isArray(p.eligibilityData)
    ? (p.eligibilityData as Record<string, unknown>)
    : null;
  const keptElig: Record<string, unknown> = {};
  if (elig?.petitionChecklist !== undefined) keptElig.petitionChecklist = elig.petitionChecklist;
  if (elig?.sourceKind !== undefined) keptElig.sourceKind = elig.sourceKind;
  return {
    ...p,
    diagnosis: AOT_RESTRICTED_LABEL,
    eligibilityData: elig ? keptElig : null,
    psychiatristAffidavit: null,
    escalationEvents: [],
    clinicalRestricted: true,
  };
}

/**
 * Caseload rule for one participant (same as the participants list: programCaseloadClientIds /
 * filterRowsToCaseload): Peer Support, Case Manager and PRP see only participants linked to a
 * client on their caseload; unlinked participants are hidden from them.
 */
export async function participantOnCaseload(
  actor: { organizationId: string; userId: string; role: string },
  participant: { clientId?: string | null },
): Promise<boolean> {
  const allowed = await programCaseloadClientIds({ organizationId: actor.organizationId, userId: actor.userId, role: String(actor.role) });
  if (!allowed) return true;
  return Boolean(participant.clientId) && allowed.has(participant.clientId as string);
}

/**
 * AOT tenant scope. A participant belongs to an org when AotParticipant.organizationId matches
 * (set on every create since 20261018_prp_attendance.sql). Older rows with no organizationId
 * count only when linked to a client chart in the org; unlinked legacy rows are hidden from every org.
 */
export async function findParticipantInOrg(id: string, organizationId: string) {
  const participant = await prisma.aotParticipant.findUnique({ where: { id } });
  if (!participant) return null;
  if (participant.organizationId) return participant.organizationId === organizationId ? participant : null;
  if (!participant.clientId) return null;
  const client = await prisma.client.findFirst({
    where: { id: participant.clientId, AND: [clientOrgFilter(organizationId)] },
    select: { id: true },
  });
  return client ? participant : null;
}

/** All participants visible to the org (optional status / county filter). */
export async function listParticipantsInOrg(
  organizationId: string,
  filters: { status?: string | null; county?: string | null } = {},
) {
  const rows = await prisma.aotParticipant.findMany({
    where: {
      ...(filters.status && filters.status !== 'all' ? { status: filters.status } : {}),
      ...(filters.county && filters.county !== 'all' ? { county: filters.county } : {}),
      OR: [{ organizationId }, { organizationId: null, clientId: { not: null } }],
    },
    orderBy: { createdAt: 'desc' },
  });
  const legacyLinked = [...new Set(rows.filter((p) => !p.organizationId && p.clientId).map((p) => p.clientId as string))];
  const inOrg = legacyLinked.length
    ? new Set(
        (
          await prisma.client.findMany({
            where: { id: { in: legacyLinked }, AND: [clientOrgFilter(organizationId)] },
            select: { id: true },
          })
        ).map((c) => c.id),
      )
    : new Set<string>();
  return rows.filter(
    (p) => p.organizationId === organizationId || (!p.organizationId && !!p.clientId && inOrg.has(p.clientId)),
  );
}

/** A client id supplied on create must be a chart in the org: id, null (none given) or false (not in org). */
export async function clientIdInOrg(clientId: unknown, organizationId: string): Promise<string | null | false> {
  if (clientId == null || clientId === '') return null;
  if (typeof clientId !== 'string') return false;
  const c = await prisma.client.findFirst({
    where: { id: clientId, AND: [clientOrgFilter(organizationId)] },
    select: { id: true },
  });
  return c ? c.id : false;
}

/** Roles that may draft the AOT court status report (clinical AOT team; not admin, office or peer staff). */
export const AOT_COURT_REPORT_ROLES = new Set([
  'PSYCHIATRIST',
  'NP',
  'THERAPIST',
  'CLINICIAN',
  'CASE_MANAGER',
  'PRACTICE_DIRECTOR',
  'DIRECTOR',
]);
