import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import {
  canAccessConsents,
  CONSENT_TYPE_OPTIONS,
  createConsents,
  listConsents,
} from '@/lib/consents/manage';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { lockedSensitiveClientIds } from '@/lib/privacy/sensitiveAccess';

export const runtime = 'nodejs';

const createSchema = z.object({
  clientId: z.string().min(1).max(128),
  types: z.array(z.enum(CONSENT_TYPE_OPTIONS)).min(1).max(10),
  method: z
    .enum(['Email', 'Patient Portal', 'In-Person', 'DocuSign'])
    .optional()
    .default('In-Person'),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessConsents(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const url = new URL(req.url);
    const clientId = url.searchParams.get('clientId') || undefined;
    const all = await listConsents(
      gate.organizationId,
      { userId: gate.userId, role: gate.role },
      clientId
    );
    // 42 CFR Part 2 / sensitive clients the caller may not open are dropped (same as the library lists)
    const locked = all.length
      ? await lockedSensitiveClientIds({ organizationId: gate.organizationId, userId: gate.userId, role: gate.role, clientIds: all.map((c) => c.clientId) })
      : new Set<string>();
    const consents = all.filter((c) => !locked.has(c.clientId));
    await auditPhiAccess({
      gate,
      req,
      action: 'LIST',
      resourceType: 'consent',
      resourceId: clientId ?? null,
      patientId: clientId ?? null,
      metadata: {
        count: consents.length,
        sensitiveHidden: all.length - consents.length,
        filters: { clientId: clientId ?? null },
        clientIds: clientId ? undefined : [...new Set(consents.map((c) => c.clientId))].slice(0, 50),
      },
    });
    return NextResponse.json({ success: true, consents });
  } catch (err) {
    console.error('[consents GET]', err);
    return NextResponse.json(
      { success: false, error: 'Could not load consents' },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessConsents(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = createSchema.parse(await req.json());
    // Retired: simple consent records had no text, signature or evidence (see manage.ts)
    const result = await createConsents(gate.organizationId, gate.userId, gate.role, body);
    await auditPhiAccess({ gate, req, action: 'CREATE', resourceType: 'consent', resourceId: body.clientId, patientId: body.clientId, outcome: 'DENIED', metadata: { status: result.status, legacy: true } });
    return NextResponse.json({ success: false, error: result.error }, { status: result.status });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || 'Could not create consent' },
      { status: 400 }
    );
  }
}
