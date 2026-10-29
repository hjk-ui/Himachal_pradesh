import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { listTelehealthSessions } from '@/lib/telehealth/manage';
import { canAccessClientAppointments } from '@/lib/clients/orgScope';
import { createTelehealthSession } from '@/lib/telehealth/manage';
import { z } from 'zod';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { getPracticeTimeZone } from '@/lib/time/practiceTimeServer';

export const runtime = 'nodejs';

const createSchema = z.object({
  clientId: z.string().min(1),
  type: z.string().min(1).max(120),
  sessionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  durationMin: z.number().int().min(15).max(180).optional(),
  platform: z.enum(['chime', 'zoom', 'doxy', 'google', 'teams', 'phone', 'video']),
  clinicianId: z.string().optional().nullable(),
  riskLevel: z.enum(['high', 'medium', 'low']).optional(),
  extraNotes: z.string().max(2000).optional().nullable(),
  emailClient: z.boolean().optional(),
});

export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessClientAppointments(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const scope = new URL(req.url).searchParams.get('scope') || 'all';
    const sessions = await listTelehealthSessions({
      organizationId: gate.organizationId,
      actorRole: gate.role,
      actorUserId: gate.userId,
      scope: scope as 'today' | 'upcoming' | 'history' | 'all',
    });
    await auditPhiAccess({
      gate,
      req,
      action: 'LIST',
      resourceType: 'telehealthSession',
      metadata: { scope, count: Array.isArray(sessions) ? sessions.length : null },
    });
    // sessionDate / startTime in each row are practice wall-clock values in this zone.
    const timeZone = await getPracticeTimeZone(gate.organizationId);
    return NextResponse.json({ success: true, sessions, timeZone });
  } catch (err) {
    console.error('[telehealth/sessions GET]', err);
    return NextResponse.json({ success: false, error: 'Failed to load sessions' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessClientAppointments(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = createSchema.parse(await req.json());
    const result = await createTelehealthSession({
      organizationId: gate.organizationId,
      actorRole: gate.role,
      actorUserId: gate.userId,
      ...body,
    });
    if (!result.ok) {
      if (result.status === 404 || result.status === 403) {
        await auditPhiAccess({
          gate,
          req,
          action: 'CREATE',
          resourceType: 'telehealthSession',
          patientId: body.clientId,
          outcome: 'DENIED',
          metadata: { reason: result.status === 404 ? 'client-not-accessible' : 'forbidden' },
        });
      }
      return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    }
    await auditPhiAccess({
      gate,
      req,
      action: 'CREATE',
      resourceType: 'telehealthSession',
      resourceId: result.session.id,
      patientId: result.session.clientId,
      metadata: {
        fields: Object.keys(body),
        platform: body.platform,
        emailed: Boolean(result.emailed),
      },
    });
    return NextResponse.json(
      {
        success: true,
        session: result.session,
        emailed: result.emailed,
        emailError: result.emailError,
        /** Consent-gated text outcome: { sent, reason?, message } or null (no phone) */
        sms: result.sms,
      },
      { status: 201 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Could not create session';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
