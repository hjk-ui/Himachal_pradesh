import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { promptCarelonForProgram } from '@/lib/consents/carelon/trigger';
import { invalidateInboxForOrg } from '@/lib/inbox/cacheStore';
import { PROGRAM_META, SERVICE_REFERRAL_ALERT } from '@/lib/clinical/serviceEligibility/criteria';
import { PROGRAMS, ELIGIBILITY_STATUSES } from '@/lib/clinical/serviceEligibility/types';
import { DISMISS_REASONS, SNOOZE_DAYS } from '@/lib/clinical/serviceEligibility/view';
import { resolveProgramLead, scannerClient, SERVICE_SCANNER_PATH } from '@/lib/clinical/serviceEligibility/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DAY = 86_400_000;

const base = { clientId: z.string().min(1).max(64), program: z.enum(PROGRAMS) };
const schema = z.discriminatedUnion('action', [
  z.object({ ...base, action: z.literal('accept'), statusAtDecision: z.enum(ELIGIBILITY_STATUSES).optional() }),
  z
    .object({ ...base, action: z.literal('dismiss'), reason: z.enum(DISMISS_REASONS), note: z.string().trim().max(500).optional(), statusAtDecision: z.enum(ELIGIBILITY_STATUSES).optional() })
    .refine((v) => v.reason !== 'other' || (v.note?.length ?? 0) >= 3, { message: 'Describe the reason (3+ characters) when dismissing for "Other"' }),
  z.object({ ...base, action: z.literal('snooze'), days: z.union([z.literal(SNOOZE_DAYS[0]), z.literal(SNOOZE_DAYS[1]), z.literal(SNOOZE_DAYS[2])]) }),
  z.object({ ...base, action: z.literal('reopen') }),
  z.object({ ...base, action: z.literal('outcome'), outcome: z.enum(['enrolled', 'declined', 'not_enrolled']) }),
]);

/**
 * POST /api/ehr/scanner/service-eligibility/decision — the clinician's workflow on a suggestion.
 *  accept  → referral alert (RiskAlert SERVICE_REFERRAL) routed to the program lead, shown as a To-Do;
 *            outcome "referred" (later "enrolled" automatically when the scan sees the enrollment)
 *  dismiss → reason required (not appropriate / client declined / referred elsewhere / other + note)
 *  snooze  → hidden for 30 / 60 / 90 days
 *  reopen  → clears the decision; outcome → record enrolled / declined / not enrolled
 * Scope and Part 2 lock are checked; every action is audited (ids and enums only).
 */
export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canAccessPath(gate.role, SERVICE_SCANNER_PATH, gate.capabilities)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message || 'Invalid action' }, { status: 400 });
  }
  const b = parsed.data;
  const audit = (outcome: 'SUCCESS' | 'DENIED', metadata: Record<string, unknown>) =>
    auditPhiAccess({ gate, req, action: 'UPDATE', resourceType: 'serviceEligibilityDecision', resourceId: `${b.clientId}:${b.program}`, patientId: b.clientId, outcome, metadata: { operation: b.action, program: b.program, ...metadata } });

  try {
    const access = await scannerClient({ organizationId: gate.organizationId, userId: gate.userId, role: gate.role }, b.clientId);
    if (access.ok === false) {
      await audit('DENIED', { reason: access.reason });
      return NextResponse.json({ success: false, error: access.status === 404 ? 'Client not found' : 'Protected record', reason: access.reason }, { status: access.status });
    }
    const key = { organizationId_clientId_program: { organizationId: gate.organizationId, clientId: b.clientId, program: b.program } };
    const existing = await prisma.serviceEligibilityDecision.findUnique({ where: key });
    const now = new Date();
    const stamp = { decidedById: gate.userId, decidedAt: now };

    if (b.action === 'reopen') {
      if (existing) await prisma.serviceEligibilityDecision.delete({ where: key });
      await audit('SUCCESS', { previous: existing?.action ?? null });
      return NextResponse.json({ success: true, decision: null });
    }

    if (b.action === 'outcome') {
      if (existing?.action !== 'accepted') {
        return NextResponse.json({ success: false, error: 'Record an outcome only on an accepted referral' }, { status: 400 });
      }
      const decision = await prisma.serviceEligibilityDecision.update({ where: key, data: { outcome: b.outcome, outcomeAt: now } });
      await audit('SUCCESS', { outcome: b.outcome });
      return NextResponse.json({ success: true, decision });
    }

    if (b.action === 'accept') {
      // Idempotent: an accepted suggestion with an open referral alert is returned, not duplicated
      if (existing?.action === 'accepted' && existing.referralAlertId) {
        const open = await prisma.riskAlert.findFirst({ where: { id: existing.referralAlertId, organizationId: gate.organizationId, reviewed: false }, select: { id: true } });
        if (open) return NextResponse.json({ success: true, alreadyReferred: true, decision: existing });
      }
      const lead = await resolveProgramLead(gate.organizationId, b.program);
      const meta = PROGRAM_META[b.program];
      const alert = await prisma.riskAlert.create({
        data: {
          organizationId: gate.organizationId,
          clientId: access.client.id,
          clientName: access.client.name,
          type: SERVICE_REFERRAL_ALERT,
          severity: 'MEDIUM',
          description: `Service Eligibility Scanner referral: ${meta.fullName}${b.statusAtDecision ? ` (scanner status: ${b.statusAtDecision.replace('_', ' ')})` : ''}. Review the criteria and evidence in the scanner, then start the program intake.`.slice(0, 1000),
          source: 'service-eligibility',
          sourceId: `${access.client.id}:${b.program}`,
          clinicianId: lead?.userId ?? null,
        },
        select: { id: true },
      });
      const data = {
        action: 'accepted', reason: null, reasonNote: null, snoozeUntil: null,
        referralAlertId: alert.id, recipientUserId: lead?.userId ?? null, outcome: 'referred', outcomeAt: now,
        statusAtDecision: b.statusAtDecision ?? null, ...stamp,
      };
      const decision = await prisma.serviceEligibilityDecision.upsert({
        where: key,
        create: { organizationId: gate.organizationId, clientId: b.clientId, program: b.program, ...data },
        update: data,
      });
      invalidateInboxForOrg(gate.organizationId);
      await audit('SUCCESS', { riskAlertId: alert.id, routed: Boolean(lead), statusAtDecision: b.statusAtDecision ?? null });
      // Maryland Medicaid: a PRP / IOP / residential referral prompts a new Carelon non-overlap attestation
      await promptCarelonForProgram({ gate, req, clientId: access.client.id, program: b.program, trigger: 'service_eligibility_referral' });
      return NextResponse.json({ success: true, decision, recipient: lead ? { userId: lead.userId, name: lead.name } : null });
    }

    const data =
      b.action === 'dismiss'
        ? { action: 'dismissed', reason: b.reason, reasonNote: b.note || null, snoozeUntil: null, statusAtDecision: b.statusAtDecision ?? null }
        : { action: 'snoozed', reason: null, reasonNote: null, snoozeUntil: new Date(now.getTime() + b.days * DAY) };
    const reset = { referralAlertId: null, recipientUserId: null, outcome: null, outcomeAt: null };
    const decision = await prisma.serviceEligibilityDecision.upsert({
      where: key,
      create: { organizationId: gate.organizationId, clientId: b.clientId, program: b.program, ...data, ...reset, ...stamp },
      update: { ...data, ...reset, ...stamp },
    });
    await audit('SUCCESS', b.action === 'dismiss' ? { reason: b.reason, hasNote: Boolean(b.note) } : { days: b.days });
    return NextResponse.json({ success: true, decision });
  } catch (err) {
    console.error('[scanner/service-eligibility decision] failed', err instanceof Error ? err.name : 'unknown');
    return NextResponse.json({ success: false, error: 'Could not save the decision' }, { status: 500 });
  }
}
