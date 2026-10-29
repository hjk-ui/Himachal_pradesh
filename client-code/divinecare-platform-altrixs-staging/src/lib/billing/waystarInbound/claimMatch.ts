import 'server-only';

/**
 * Finds the claim an inbound reference (277CA TRN02, 277 REF*EJ, 835 CLP01) points at.
 * Not organization-scoped: the Waystar mailbox is shared by the deployment, and each update
 * is applied and audited under the matched claim's own organization.
 *
 * Order:
 *   1. claimByControlNumber() from ../claims: Claim.claimControlNumber, the claim_control_numbers
 *      history (corrected claims), then Claim.id (legacy claims sent with the 25-char cuid)
 *   2. a unique Claim.id prefix of >= 20 chars (payers that truncate a legacy CLM01 to 20)
 */
import { prisma } from '@/lib/db/prisma';
import { claimByControlNumber } from '../claims';
import type { MatchKind } from './eraPosting';

export async function matchClaimReference(ref: string): Promise<{ kind: MatchKind; claimIds: string[] }> {
  const value = ref.trim();
  if (!value) return { kind: 'none', claimIds: [] };

  const hit = await claimByControlNumber(value);
  if (hit) return { kind: hit.id === value ? 'claim_id' : 'control_number', claimIds: [hit.id] };

  if (value.length >= 20) {
    const candidates = await prisma.claim.findMany({ where: { id: { startsWith: value } }, select: { id: true }, take: 2 });
    if (candidates.length === 1) return { kind: 'prefix', claimIds: [candidates[0].id] };
    if (candidates.length > 1) return { kind: 'ambiguous', claimIds: candidates.map((c) => c.id) };
  }
  return { kind: 'none', claimIds: [] };
}

/** The CLM01 a claim was (or will be) sent under, for 276 TRN02 / REF*EJ. */
export function clm01For(claim: { id: string; claimControlNumber?: string | null; submissionData?: unknown }): string {
  const sd = claim.submissionData && typeof claim.submissionData === 'object' ? (claim.submissionData as Record<string, unknown>) : {};
  const sent = sd.waystarSftp && typeof sd.waystarSftp === 'object' ? (sd.waystarSftp as Record<string, unknown>) : {};
  const sentCtrl = typeof sent.claimControlNumber === 'string' ? sent.claimControlNumber : typeof sent.clm01 === 'string' ? sent.clm01 : '';
  if (sentCtrl) return sentCtrl;
  // Claims sent before the control number existed went out with Claim.id as CLM01
  if (sent.batchId && !sentCtrl) return claim.id;
  return claim.claimControlNumber || claim.id;
}
