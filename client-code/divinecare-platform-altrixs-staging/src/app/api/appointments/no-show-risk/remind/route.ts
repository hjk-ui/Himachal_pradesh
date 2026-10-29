import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessClientAppointments } from '@/lib/clients/orgScope';
import { appointmentScopeWhere, formatClinicDateTime } from '@/lib/appointments/noShowRisk';
import { sendEmail } from '@/lib/email/smtp';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { PRACTICE } from '@/lib/practice';

export const runtime = 'nodejs';

const schema = z.object({
  appointmentIds: z.array(z.string().min(1).max(128)).min(1).max(50),
});

type ReminderResult = {
  appointmentId: string;
  result: 'sent' | 'no_email' | 'not_found' | 'not_scheduled' | 'error';
  error?: string;
};

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * POST /api/appointments/no-show-risk/remind { appointmentIds[] }
 * Email-only reminder (SMS is pending carrier verification). The message has no
 * clinical detail: no clinician, visit type, diagnosis, or client name.
 */
export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessClientAppointments(gate.role)) {
    return NextResponse.json(
      { success: false, error: 'Not allowed to send appointment reminders' },
      { status: 403 }
    );
  }

  let body: z.infer<typeof schema>;
  try {
    body = schema.parse(await req.json());
  } catch {
    return NextResponse.json(
      { success: false, error: 'Send 1 to 50 appointmentIds' },
      { status: 400 }
    );
  }

  const ids = [...new Set(body.appointmentIds)];
  const actor = { id: gate.userId, role: gate.role, organizationId: gate.organizationId };
  const rows = await prisma.appointment.findMany({
    where: { AND: [appointmentScopeWhere(actor), { id: { in: ids } }] },
    select: {
      id: true,
      clientId: true,
      status: true,
      startsAt: true,
      client: { select: { email: true } },
    },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const now = Date.now();

  const results: ReminderResult[] = [];
  for (const id of ids) {
    const appt = byId.get(id);
    if (!appt) {
      results.push({ appointmentId: id, result: 'not_found' });
      continue;
    }
    if (appt.status !== 'SCHEDULED' || appt.startsAt.getTime() < now) {
      results.push({ appointmentId: id, result: 'not_scheduled' });
      continue;
    }
    const to = appt.client.email?.trim();
    if (!to) {
      results.push({ appointmentId: id, result: 'no_email' });
      continue;
    }

    const { date, time } = formatClinicDateTime(appt.startsAt);
    const text = [
      'Hello,',
      '',
      `This is a reminder from ${PRACTICE.name}. You have an appointment on ${date} at ${time}.`,
      '',
      `To reschedule, call ${PRACTICE.mainPhone}.`,
      '',
      'Please do not reply to this email.',
    ].join('\n');
    const html = `<p>Hello,</p><p>This is a reminder from ${escapeHtml(PRACTICE.name)}. You have an appointment on <strong>${escapeHtml(date)}</strong> at <strong>${escapeHtml(time)}</strong>.</p><p>To reschedule, call ${escapeHtml(PRACTICE.mainPhone)}.</p><p style="color:#64748b;font-size:12px">Please do not reply to this email.</p>`;

    try {
      await sendEmail({
        to,
        subject: 'Appointment reminder',
        text,
        html,
        context: 'appointment-reminder',
      });
      results.push({ appointmentId: id, result: 'sent' });
    } catch (err) {
      console.error('[no-show-risk remind] send failed', id, err instanceof Error ? err.message : err);
      results.push({ appointmentId: id, result: 'error', error: 'Email could not be sent' });
    }
  }

  await writeAuditLog({
    action: 'appointment.reminder.email',
    actorUserId: gate.userId,
    organizationId: gate.organizationId,
    resourceType: 'Appointment',
    metadata: {
      results: results.map((r) => ({ appointmentId: r.appointmentId, result: r.result })),
    },
  });

  const summary = {
    sent: results.filter((r) => r.result === 'sent').length,
    noEmail: results.filter((r) => r.result === 'no_email').length,
    failed: results.filter((r) => r.result !== 'sent' && r.result !== 'no_email').length,
  };
  return NextResponse.json({ success: true, results, summary });
}
