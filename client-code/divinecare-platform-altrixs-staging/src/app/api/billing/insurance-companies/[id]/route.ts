import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { canEditValantPayers } from '@/lib/billing/valantPayersDb';
import { normalizePayerName } from '@/lib/billing/valantPayers';

export const runtime = 'nodejs';

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('link_registry'), payerRegistryId: z.string().trim().min(1).max(64) }),
  z.object({ action: z.literal('unlink_registry') }),
  z.object({
    action: z.literal('create_registry'),
    /** The payer ID staff entered / confirmed for the clearinghouse. Required; never defaulted from Valant silently. */
    payerId: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,15}$/, 'Payer IDs are 2-15 letters, digits or dashes'),
    name: z.string().trim().min(2).max(200),
    clearinghouse: z.enum(['Waystar', 'Availity', 'Other']).default('Waystar'),
    claimsAddress: z.string().trim().max(300).optional().nullable(),
    phone: z.string().trim().max(30).optional().nullable(),
    timelyFilingDays: z.number().int().min(1).max(3650).optional(),
  }),
  z.object({ action: z.literal('confirm_alias'), name: z.string().trim().min(1).max(200) }),
  z.object({ action: z.literal('remove_alias'), name: z.string().trim().min(1).max(200) }),
]);

/**
 * POST /api/billing/insurance-companies/[id] — explicit staff actions on one Valant payer:
 *   link_registry / unlink_registry: confirm (or undo) a payer registry match;
 *   create_registry: create a PayerRegistry entry prefilled from this payer, with the payer ID the
 *     user entered (required), and link it;
 *   confirm_alias / remove_alias: count a client insurance payer name as this payer.
 * Leadership + billing. Never writes the Waystar payer mapping. Audited (no PHI).
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canEditValantPayers(gate.role)) {
    return NextResponse.json({ success: false, error: 'Only billing or practice leadership can change insurance companies' }, { status: 403 });
  }
  const { id } = await ctx.params;
  try {
    const body = actionSchema.parse(await req.json().catch(() => ({})));
    const payer = await prisma.valantPayer.findFirst({ where: { id, organizationId: gate.organizationId } });
    if (!payer) return NextResponse.json({ success: false, error: 'Insurance company not found' }, { status: 404 });

    const audit = (metadata: Record<string, string | number | boolean | null>) =>
      auditPhiAccess({ gate, req, action: 'UPDATE', resourceType: 'valantPayer', resourceId: payer.id, metadata: { payer: payer.name, ...metadata } });
    const now = new Date();

    if (body.action === 'link_registry') {
      const reg = await prisma.payerRegistry.findFirst({ where: { id: body.payerRegistryId, organizationId: gate.organizationId } });
      if (!reg) return NextResponse.json({ success: false, error: 'Payer registry entry not found' }, { status: 404 });
      await prisma.valantPayer.update({ where: { id: payer.id }, data: { payerRegistryId: reg.id, linkedById: gate.userId, linkedAt: now } });
      await audit({ change: 'link_registry', payerRegistryId: reg.id, registryPayerId: reg.payerId });
      return NextResponse.json({ success: true });
    }

    if (body.action === 'unlink_registry') {
      await prisma.valantPayer.update({ where: { id: payer.id }, data: { payerRegistryId: null, linkedById: gate.userId, linkedAt: now } });
      await audit({ change: 'unlink_registry', previousRegistryId: payer.payerRegistryId });
      return NextResponse.json({ success: true });
    }

    if (body.action === 'create_registry') {
      const clash = await prisma.payerRegistry.findFirst({ where: { organizationId: gate.organizationId, payerId: body.payerId } });
      if (clash) {
        return NextResponse.json(
          { success: false, error: `Payer ID ${body.payerId} is already in the registry as "${clash.name}". Link that entry instead.`, existingId: clash.id },
          { status: 409 }
        );
      }
      const reg = await prisma.$transaction(async (tx) => {
        const created = await tx.payerRegistry.create({
          data: {
            organizationId: gate.organizationId,
            payerId: body.payerId,
            name: body.name,
            clearinghouse: body.clearinghouse,
            claimsAddress: body.claimsAddress || null,
            phone: body.phone || null,
            ...(body.timelyFilingDays ? { timelyFilingDays: body.timelyFilingDays } : {}),
          },
        });
        await tx.valantPayer.update({ where: { id: payer.id }, data: { payerRegistryId: created.id, linkedById: gate.userId, linkedAt: now } });
        return created;
      });
      await audit({
        change: 'create_registry', payerRegistryId: reg.id, registryPayerId: reg.payerId, clearinghouse: reg.clearinghouse,
        sameAsValantEdi: Boolean(payer.ediPayerId) && payer.ediPayerId === reg.payerId,
      });
      return NextResponse.json({ success: true, registry: { id: reg.id, payerId: reg.payerId, name: reg.name } });
    }

    const key = normalizePayerName(body.name);
    if (!key) return NextResponse.json({ success: false, error: 'Enter a payer name' }, { status: 400 });
    const current = payer.confirmedAliases ?? [];
    const next =
      body.action === 'confirm_alias'
        ? current.some((a) => normalizePayerName(a) === key) ? current : [...current, body.name]
        : current.filter((a) => normalizePayerName(a) !== key);
    await prisma.valantPayer.update({ where: { id: payer.id }, data: { confirmedAliases: next, linkedById: gate.userId, linkedAt: now } });
    await audit({ change: body.action, aliasCount: next.length });
    return NextResponse.json({ success: true, confirmedAliases: next });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: error.issues[0]?.message || 'Invalid request' }, { status: 400 });
    }
    console.error('[insurance-companies POST]', error instanceof Error ? error.message : 'unknown error');
    return NextResponse.json({ success: false, error: 'Could not update the insurance company' }, { status: 500 });
  }
}
