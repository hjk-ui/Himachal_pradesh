import 'server-only';

/**
 * Work queue: claims not yet accepted (DRAFT / READY / DENIED, primary or secondary) whose date of
 * service is within 30 days of, or past, the payer's timely filing limit (Waystar payer mapping
 * filing_limit_days; starting values to verify against each payer contract). Date of service =
 * the note's practice date. Payers without a configured limit are not listed.
 */
import type { Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import { loadPayerMappings } from './waystarConfig';
import { findPayerMapping } from './waystarSftpClaims';
import { notePracticeDate, timelyFiling } from './claimRules';

export type TimelyFilingRow = {
  claimId: string;
  clientId: string;
  clientName: string;
  payer: string;
  serviceDate: string;
  limitDays: number;
  daysLeft: number;
};

export async function loadTimelyFilingQueue(
  actor: { organizationId: string; actorUserId: string; actorRole: Role },
  now = new Date()
): Promise<TimelyFilingRow[]> {
  const mappings = (await loadPayerMappings(actor.organizationId).catch(() => [])).filter((m) => m.filingLimitDays);
  if (!mappings.length) return [];
  const claims = await prisma.claim.findMany({
    where: {
      organizationId: actor.organizationId,
      status: { in: ['DRAFT', 'READY', 'DENIED'] },
      frequencyCode: { not: '8' },
      client: clientAccessWhere(actor),
    },
    select: {
      id: true,
      clientId: true,
      payer: true,
      submissionData: true,
      client: { select: { name: true } },
      progressNote: { select: { dateOfService: true } },
    },
    take: 1000,
  });
  const out: TimelyFilingRow[] = [];
  for (const c of claims) {
    const mapping = findPayerMapping(mappings, c.payer);
    if (!mapping?.filingLimitDays) continue;
    const sd = c.submissionData && typeof c.submissionData === 'object' && !Array.isArray(c.submissionData) ? (c.submissionData as Record<string, unknown>) : {};
    const dos = notePracticeDate(c.progressNote?.dateOfService) ?? (typeof sd.serviceDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(sd.serviceDate) ? sd.serviceDate : null);
    const tf = timelyFiling(dos, mapping.filingLimitDays, now);
    if (!tf || tf.status === 'ok') continue;
    out.push({ claimId: c.id, clientId: c.clientId, clientName: c.client.name, payer: mapping.payerName, serviceDate: dos!, limitDays: tf.limitDays, daysLeft: tf.daysLeft });
  }
  return out.sort((a, b) => a.daysLeft - b.daysLeft);
}
