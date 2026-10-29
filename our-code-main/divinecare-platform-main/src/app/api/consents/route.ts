import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import {
  canAccessConsents,
  CONSENT_TYPE_OPTIONS,
  createConsents,
  listConsents,
} from '@/lib/consents/manage';

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
    const consents = await listConsents(
      gate.organizationId,
      { userId: gate.userId, role: gate.role },
      clientId
    );
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
    const result = await createConsents(gate.organizationId, gate.userId, gate.role, body);
    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status }
      );
    }
    return NextResponse.json({ success: true, consents: result.consents }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || 'Could not create consent' },
      { status: 400 }
    );
  }
}
