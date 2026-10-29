import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { clientOrgFilter } from '@/lib/clients/orgScope';
import { cptByCode } from '@/lib/constants/cpt';
import {
  editorLines,
  parseIcd10List,
  renderingNpiFrom,
  type ClaimEditorInput,
  type LineMeta,
} from '@/lib/billing/claimLines';

/**
 * Census-driven residential per-diem charges (SpecializedBillingCharge,
 * category "residential_per_diem"). One charge per resident per date of
 * service per code, scoped to the caller's organization through the
 * resident's linked client. Rows without organizationId are legacy and are
 * never read or written here.
 *
 * Charge status: held (compliance block) → ready → approved → routed (claim created).
 */

export const PER_DIEM_CATEGORY = 'residential_per_diem';
export const PER_DIEM_POS = '55';

export type Program = '3.1' | '3.5';
export type BlockReason = 'csr_overdue' | 'pa_missing' | 'pa_exhausted';

const CODE_BY_PROGRAM: Record<Program, string> = { '3.5': 'H0018', '3.1': 'H0019' };

export function perDiemFor(program: string) {
  const p: Program = program === '3.5' ? '3.5' : '3.1';
  const code = CODE_BY_PROGRAM[p];
  return { program: p, code, rate: cptByCode(code)?.rate ?? 0, pos: PER_DIEM_POS };
}

/** YYYY-MM-DD → midnight UTC (the stored serviceDate for a calendar day). */
export function serviceDay(date: string) {
  return new Date(`${date}T00:00:00.000Z`);
}

export function isoDay(d: Date) {
  return d.toISOString().slice(0, 10);
}

type ResidentGate = {
  nextCsrDate: Date | null;
  paNumber: string | null;
  paUnitsRemaining: number;
};

/** Same precedence as the charge scrubber: review lapse, then PA missing, then PA exhausted. */
export function perDiemBlock(r: ResidentGate, day: Date): BlockReason | null {
  if (r.nextCsrDate && r.nextCsrDate.getTime() < day.getTime()) return 'csr_overdue';
  if (!r.paNumber) return 'pa_missing';
  if (r.paUnitsRemaining <= 0) return 'pa_exhausted';
  return null;
}

/** Active residents whose linked client belongs to the organization. */
export async function orgResidents(organizationId: string) {
  const clients = await prisma.client.findMany({
    where: clientOrgFilter(organizationId),
    select: { id: true, insurancePayer: true },
  });
  const payerByClient = new Map(clients.map((c) => [c.id, c.insurancePayer]));
  const residents = await prisma.residentialResident.findMany({
    where: { active: true, clientId: { in: clients.map((c) => c.id) } },
    orderBy: { room: 'asc' },
  });
  return { residents, payerByClient };
}

export type GenerateResult = {
  serviceDate: string;
  residents: number;
  created: number;
  released: number;
  held: number;
  alreadyCharged: number;
};

/**
 * Create (or release) per-diem charges for every active resident in the
 * organization for one date of service. Idempotent per resident + date + code:
 * an existing ready/approved/routed charge is left alone; a held charge is
 * released to ready once its block clears. PA units are consumed once, when a
 * charge first becomes ready.
 */
export async function generatePerDiems(organizationId: string, date: string): Promise<GenerateResult> {
  const day = serviceDay(date);
  const { residents, payerByClient } = await orgResidents(organizationId);
  const result: GenerateResult = {
    serviceDate: date,
    residents: residents.length,
    created: 0,
    released: 0,
    held: 0,
    alreadyCharged: 0,
  };
  if (!residents.length) return result;

  await prisma.$transaction(
    async (tx) => {
      // Serialize generation per organization so double-clicks cannot duplicate charges.
      // (cast to text: Prisma cannot deserialize the function's void result)
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`per_diem:${organizationId}`}))::text AS locked`;

      for (const r of residents) {
        if (!r.clientId) continue;
        const { code, rate } = perDiemFor(r.program);
        // Re-read inside the lock so PA units reflect earlier iterations / requests.
        const fresh = await tx.residentialResident.findUnique({
          where: { id: r.id },
          select: { nextCsrDate: true, paNumber: true, paUnitsRemaining: true },
        });
        if (!fresh) continue;
        const block = perDiemBlock(fresh, day);

        const existing = await tx.specializedBillingCharge.findFirst({
          where: {
            organizationId,
            category: PER_DIEM_CATEGORY,
            referenceId: r.id,
            serviceDate: day,
            code,
          },
          select: { id: true, status: true },
        });

        if (existing && existing.status !== 'held') {
          result.alreadyCharged++;
          continue;
        }

        if (block) {
          if (existing) {
            await tx.specializedBillingCharge.update({ where: { id: existing.id }, data: { blockReason: block } });
          } else {
            await tx.specializedBillingCharge.create({
              data: {
                organizationId,
                clientId: r.clientId,
                category: PER_DIEM_CATEGORY,
                referenceId: r.id,
                clientName: r.name,
                serviceDate: day,
                code,
                units: 1,
                rate,
                totalAmount: rate,
                pos: PER_DIEM_POS,
                payer: payerByClient.get(r.clientId)?.trim() || '',
                status: 'held',
                blockReason: block,
              },
            });
          }
          result.held++;
          continue;
        }

        const consumed = await tx.residentialResident.updateMany({
          where: { id: r.id, paUnitsRemaining: { gt: 0 } },
          data: { paUnitsRemaining: { decrement: 1 } },
        });
        if (!consumed.count) {
          result.held++;
          continue;
        }
        if (existing) {
          await tx.specializedBillingCharge.update({
            where: { id: existing.id },
            data: { status: 'ready', blockReason: null },
          });
          result.released++;
        } else {
          await tx.specializedBillingCharge.create({
            data: {
              organizationId,
              clientId: r.clientId,
              category: PER_DIEM_CATEGORY,
              referenceId: r.id,
              clientName: r.name,
              serviceDate: day,
              code,
              units: 1,
              rate,
              totalAmount: rate,
              pos: PER_DIEM_POS,
              payer: payerByClient.get(r.clientId)?.trim() || '',
              status: 'ready',
              blockReason: null,
            },
          });
          result.created++;
        }
      }
    },
    { timeout: 60_000, maxWait: 10_000 }
  );

  return result;
}

export type PerDiemChargeItem = {
  id: string;
  residentId: string;
  clientId: string | null;
  clientName: string;
  serviceDate: string;
  code: string;
  units: number;
  rate: number;
  totalAmount: number;
  pos: string;
  payer: string;
  status: string;
  blockReason: string | null;
  claimId: string | null;
  authNumber: string | null;
  createdAt: string;
};

/** Organization's per-diem charges for the last `days` days, newest first. */
export async function listPerDiemCharges(organizationId: string, days = 45): Promise<PerDiemChargeItem[]> {
  const from = new Date(Date.now() - days * 86_400_000);
  const rows = await prisma.specializedBillingCharge.findMany({
    where: { organizationId, category: PER_DIEM_CATEGORY, serviceDate: { gte: from } },
    orderBy: [{ serviceDate: 'desc' }, { clientName: 'asc' }],
    take: 500,
  });
  const residentIds = Array.from(new Set(rows.map((r) => r.referenceId)));
  const residents = residentIds.length
    ? await prisma.residentialResident.findMany({
        where: { id: { in: residentIds } },
        select: { id: true, paNumber: true },
      })
    : [];
  const paById = new Map(residents.map((r) => [r.id, r.paNumber]));
  return rows.map((r) => ({
    id: r.id,
    residentId: r.referenceId,
    clientId: r.clientId,
    clientName: r.clientName,
    serviceDate: isoDay(r.serviceDate),
    code: r.code,
    units: r.units,
    rate: r.rate,
    totalAmount: r.totalAmount,
    pos: r.pos,
    payer: r.payer,
    status: r.status,
    blockReason: r.blockReason,
    claimId: r.claimId,
    authNumber: paById.get(r.referenceId) ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}

/** ready → approved. Returns how many charges changed. */
export async function approvePerDiemCharges(organizationId: string, chargeIds: string[]) {
  const updated = await prisma.specializedBillingCharge.updateMany({
    where: {
      id: { in: chargeIds },
      organizationId,
      category: PER_DIEM_CATEGORY,
      status: 'ready',
      claimId: null,
    },
    data: { status: 'approved' },
  });
  return updated.count;
}

export class ChargeClaimError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
  }
}

/**
 * Create a claim from an approved per-diem charge using the claim editor's
 * values, then link the charge (claimId, status "routed"). Both happen in one
 * transaction; a charge can only ever be linked to one claim.
 */
export async function createClaimFromCharge(
  actor: { organizationId: string; userId: string },
  chargeId: string,
  input: ClaimEditorInput
) {
  const charge = await prisma.specializedBillingCharge.findFirst({
    where: { id: chargeId, organizationId: actor.organizationId, category: PER_DIEM_CATEGORY },
  });
  if (!charge) throw new ChargeClaimError('Charge not found', 404);
  if (charge.claimId) throw new ChargeClaimError('A claim already exists for this charge', 409);
  if (charge.status !== 'approved') {
    throw new ChargeClaimError('Approve the charge before creating its claim', 409);
  }
  if (!charge.clientId) throw new ChargeClaimError('This charge is not linked to a client', 409);

  const client = await prisma.client.findFirst({
    where: { AND: [{ id: charge.clientId }, clientOrgFilter(actor.organizationId)] },
    select: { id: true, insuranceMemberId: true, insuranceGroupNumber: true },
  });
  if (!client) throw new ChargeClaimError('Client not found', 404);

  const dx = parseIcd10List(input.icd10);
  if (!dx.ok) throw new ChargeClaimError(dx.error, 400);
  if (!dx.codes.length) throw new ChargeClaimError('At least one ICD-10 diagnosis code is required', 400);

  const lines = editorLines(input.lines);
  const totalCents = lines.reduce((t, l) => t + l.lineCents, 0);
  const first = lines[0];
  const cptCode = first.mods[0] ? `${first.cpt}-${first.mods[0]}` : first.cpt;
  const dos = input.dos || isoDay(charge.serviceDate);
  const pos = input.pos || charge.pos || PER_DIEM_POS;

  return prisma.$transaction(async (tx) => {
    const claim = await tx.claim.create({
      data: {
        organizationId: actor.organizationId,
        clientId: client.id,
        cptCode,
        units: first.units,
        amountCents: totalCents,
        payer: input.payer?.trim() || charge.payer || null,
        status: 'READY',
        icd10Codes: dx.codes,
        priorAuthNumber: input.authNumber?.trim() || null,
        placeOfService: pos,
        renderingNpi: renderingNpiFrom(input.renderingProvider),
        billingNpi: input.billingProvider?.trim() || null,
      },
    });

    const lineMeta: Record<string, LineMeta> = {};
    for (const line of lines) {
      const sl = await tx.claimServiceLine.create({
        data: {
          claimId: claim.id,
          cptCode: line.cpt,
          modifier: line.mods.length ? line.mods.join(':') : null,
          units: line.units,
          unitCharge: line.unitCharge,
          totalCharge: line.totalCharge,
        },
      });
      lineMeta[sl.id] = { serviceDate: dos, diagnosisPointers: [1] };
    }

    const submissionData = {
      payerId: '',
      diagnosisCodes: dx.codes,
      placeOfService: pos,
      claimFilingCode: 'CI',
      modifiers: first.mods,
      memberId: client.insuranceMemberId || null,
      groupNumber: client.insuranceGroupNumber || null,
      serviceDate: dos,
      source: 'residential_per_diem',
      specializedChargeId: charge.id,
      lineMeta,
    } as Prisma.InputJsonValue;
    await tx.claim.update({ where: { id: claim.id }, data: { submissionData } });

    const linked = await tx.specializedBillingCharge.updateMany({
      where: { id: charge.id, organizationId: actor.organizationId, claimId: null, status: 'approved' },
      data: { claimId: claim.id, status: 'routed' },
    });
    if (!linked.count) throw new ChargeClaimError('This charge was claimed by someone else. Reload and try again.', 409);

    return { claimId: claim.id, chargeId: charge.id, amountCents: totalCents };
  });
}
