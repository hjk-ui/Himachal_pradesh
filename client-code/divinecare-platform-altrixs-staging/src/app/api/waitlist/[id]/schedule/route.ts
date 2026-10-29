import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { prisma } from '@/lib/db/prisma';
import { canAccessWaitlist, findDuplicateClients } from '@/lib/waitlist/manage';
import { canManageWaitlist } from '@/lib/waitlist/standard';
import { suggestForEntry } from '@/lib/waitlist/matching';
import { eligibilityAvailableFor, scheduleConversion } from '@/lib/waitlist/convert';
import { conversionSchema } from '@/lib/waitlist/schema';

export const runtime = 'nodejs';

const paramsSchema = z.object({ id: z.string().min(1).max(128) });

/**
 * GET: what the Schedule panel needs: possible existing clients (duplicate check) and suggested
 * clinicians with open slots. Nothing is created.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canAccessWaitlist(gate.role) || !canManageWaitlist(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const { id } = paramsSchema.parse(await ctx.params);
  const row = await prisma.waitlistEntry.findFirst({ where: { id, organizationId: gate.organizationId } });
  if (!row) return NextResponse.json({ success: false, error: 'Waitlist entry not found' }, { status: 404 });
  try {
    const [duplicates, suggestions] = await Promise.all([
      row.convertedClientId
        ? Promise.resolve([])
        : findDuplicateClients(gate.organizationId, {
            firstName: row.firstName,
            lastName: row.lastName,
            name: row.name,
            dateOfBirth: row.dateOfBirth,
            phone: row.phone,
            email: row.email,
          }),
      suggestForEntry(gate.organizationId, row),
    ]);
    await auditPhiAccess({
      gate,
      req,
      action: 'LIST',
      resourceType: 'waitlist_match',
      resourceId: id,
      metadata: { duplicateCount: duplicates.length, duplicateClientIds: duplicates.map((d) => d.clientId), clinicianCount: suggestions.clinicians.length },
    });
    return NextResponse.json({
      success: true,
      duplicates,
      linkedClientId: row.convertedClientId,
      ...suggestions,
      eligibility: eligibilityAvailableFor(gate.role),
    });
  } catch (err) {
    console.error('[waitlist schedule GET]', err);
    return NextResponse.json({ success: false, error: 'Could not load suggestions' }, { status: 500 });
  }
}

/** POST: one confirm step (create / link client, book, intake, eligibility, mark converted). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canAccessWaitlist(gate.role) || !canManageWaitlist(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  try {
    const { id } = paramsSchema.parse(await ctx.params);
    const body = conversionSchema.parse(await req.json());
    const result = await scheduleConversion(gate, id, body, req);
    if (result.ok === false) {
      return NextResponse.json(
        { success: false, error: result.error, code: result.code ?? null, duplicates: result.duplicates ?? null },
        { status: result.status }
      );
    }
    return NextResponse.json({ success: true, ...result });
  } catch (err: any) {
    const message = err instanceof z.ZodError ? 'Please check the scheduling details' : err.message || 'Could not schedule';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
