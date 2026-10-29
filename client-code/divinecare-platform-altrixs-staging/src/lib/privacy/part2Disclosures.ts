import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { isPart2Classification } from '@/lib/fhir/mapping/privacy';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { assertClientPhiAccess, SensitiveRecordAccessError } from '@/lib/privacy/sensitiveAccess';
import { DISCLOSURE_BASES, DISCLOSURE_METHODS, type Part2DisclosureView } from '@/lib/privacy/part2DisclosureTypes';
import { canReadDisclosures, canRecordDisclosure } from '@/lib/privacy/part2DisclosureAccess';
import { isSensitivePrivilegedRole } from '@/lib/privacy/sensitiveRoles';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import type { Role } from '@prisma/client';

/** Staff who can open the 42 CFR Part 2 page may record disclosures and run the accounting. */
export const PART2_PAGE = '/dashboard/ehr/part2';
export function canUsePart2Page(role: string | null | undefined): boolean {
  return canAccessPath(role ?? null, PART2_PAGE);
}

const basisValues = DISCLOSURE_BASES.map((b) => b.value) as [string, ...string[]];
const methodValues = DISCLOSURE_METHODS.map((m) => m.value) as [string, ...string[]];

/** Body of POST /api/part2/disclosures. Free text is bounded; the disclosure date cannot be in the future. */
export const disclosureInputSchema = z
  .object({
    clientId: z.string().trim().min(1).max(191),
    consentFormId: z.string().trim().max(191).optional().nullable(),
    consentReference: z.string().trim().max(200).optional().nullable(),
    basis: z.enum(basisValues).default('consent'),
    disclosedTo: z.string().trim().min(2).max(300),
    purpose: z.string().trim().min(2).max(1000),
    informationDisclosed: z.string().trim().min(2).max(2000),
    method: z.enum(methodValues),
    disclosedAt: z.coerce.date(),
  })
  .superRefine((v, ctx) => {
    if (v.basis === 'consent' && !v.consentFormId && !v.consentReference) {
      ctx.addIssue({
        code: 'custom',
        path: ['consentReference'],
        message: 'A consent-based disclosure needs the consent on file or a consent reference',
      });
    }
    if (Number.isNaN(v.disclosedAt.getTime()) || v.disclosedAt.getTime() > Date.now() + 5 * 60_000) {
      ctx.addIssue({ code: 'custom', path: ['disclosedAt'], message: 'Disclosure date cannot be in the future' });
    }
  });

export type DisclosureInput = z.infer<typeof disclosureInputSchema>;

/**
 * Part 2 clients of an org: a SensitiveRecord classified Part 2 / 42 CFR / SUD, any progress
 * note flagged Part 2, or any recorded Part 2 disclosure.
 */
export async function part2ClientIds(organizationId: string): Promise<{ ids: string[]; source: Map<string, string[]> }> {
  const [records, notes, disclosures] = await Promise.all([
    prisma.sensitiveRecord.findMany({
      where: { organizationId },
      select: { clientId: true, noteClassification: true },
    }),
    prisma.progressNote.findMany({
      where: { part2: true, client: { organizationId } },
      select: { clientId: true },
      distinct: ['clientId'],
    }),
    prisma.part2Disclosure.findMany({
      where: { organizationId },
      select: { clientId: true },
      distinct: ['clientId'],
    }),
  ]);
  const source = new Map<string, string[]>();
  const add = (id: string, why: string) => {
    const list = source.get(id) ?? [];
    if (!list.includes(why)) list.push(why);
    source.set(id, list);
  };
  for (const r of records) if (isPart2Classification(r.noteClassification)) add(r.clientId, 'Protected record classified Part 2');
  for (const n of notes) add(n.clientId, 'Part 2 progress note');
  for (const d of disclosures) add(d.clientId, 'Part 2 disclosure on file');
  return { ids: [...source.keys()], source };
}

type DisclosureRow = {
  id: string;
  clientId: string;
  consentFormId: string | null;
  consentReference: string | null;
  basis: string;
  disclosedTo: string;
  purpose: string;
  informationDisclosed: string;
  method: string;
  disclosedAt: Date;
  disclosedById: string;
  createdAt: Date;
};

export function disclosureView(r: DisclosureRow, names: Map<string, string | null>): Part2DisclosureView {
  return {
    ...r,
    disclosedAt: r.disclosedAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
    disclosedByName: names.get(r.disclosedById) ?? null,
  };
}

export const DISCLOSURE_SELECT = {
  id: true,
  clientId: true,
  consentFormId: true,
  consentReference: true,
  basis: true,
  disclosedTo: true,
  purpose: true,
  informationDisclosed: true,
  method: true,
  disclosedAt: true,
  disclosedById: true,
  createdAt: true,
} as const;

/**
 * Per-client gate for disclosure routes: Part 2 page role, client in this org, the need-to-know rule
 * (src/lib/privacy/part2DisclosureAccess.ts: `read` = ADMIN / PD or a treating clinician with the
 * client on their caseload; `record` additionally lets Billing / Front Desk / Office Manager record a
 * disclosure for a client they can see) and the protected-record rules (assertClientPhiAccess logs
 * whitelist / break-glass / denied). Every Part 2 client goes through that lock.
 */
export async function checkPart2ClientAccess(input: {
  organizationId: string;
  userId: string;
  role: string;
  clientId: string;
  path: string;
  mode?: 'read' | 'record';
}): Promise<
  | { ok: true; client: { id: string; name: string; mrn: string | null } }
  | { ok: false; status: 403 | 404; error: string; denied: boolean }
> {
  if (!canUsePart2Page(input.role)) {
    return { ok: false, status: 403, error: 'Your role cannot use 42 CFR Part 2 records', denied: true };
  }
  const client = await prisma.client.findFirst({
    where: { id: input.clientId, organizationId: input.organizationId },
    select: { id: true, name: true, mrn: true },
  });
  if (!client) return { ok: false, status: 404, error: 'Client not found', denied: false };
  const inScope = isSensitivePrivilegedRole(input.role)
    ? true
    : Boolean(
        await prisma.client.findFirst({
          where: {
            id: client.id,
            ...clientAccessWhere({ organizationId: input.organizationId, actorUserId: input.userId, actorRole: input.role as Role }),
          },
          select: { id: true },
        })
      );
  const allowed = input.mode === 'record' ? canRecordDisclosure(input.role, inScope) : canReadDisclosures(input.role, inScope);
  if (!allowed) {
    return {
      ok: false,
      status: 403,
      error:
        input.mode === 'record'
          ? 'You can record disclosures only for clients you can see'
          : "Disclosure history is limited to the Practice Director / Admin and the client's treating clinicians",
      denied: true,
    };
  }
  try {
    await assertClientPhiAccess({
      organizationId: input.organizationId,
      userId: input.userId,
      role: input.role,
      clientId: client.id,
      path: input.path,
    });
  } catch (err) {
    if (err instanceof SensitiveRecordAccessError) {
      return { ok: false, status: 403, error: 'Protected record — break-glass or access-list approval required', denied: true };
    }
    throw err;
  }
  return { ok: true, client };
}
