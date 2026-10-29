import type { Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import { NOT_IMPORTED_HISTORY } from '@/lib/valant/appointmentHistory';

export type StaffTask = {
  taskId: string;
  type:
    | 'unsigned_note'
    | 'missing_note'
    | 'intake_incomplete'
    | 'waitlist_waiting'
    | 'risk_alert'
    | 'consent_pending'
    | 'expiring_treatment_plan'
    | 'pa_expiring'
    | 'pa_units'
    | 'claim_ready'
    | 'credential_expiring'
    | 'no_show';
  priority: 'urgent' | 'normal' | 'low';
  title: string;
  description: string;
  clientName?: string;
  dueDate?: string;
  daysUntil?: number;
  actionLabel: string;
  actionHref: string;
};

function daysUntil(date: Date) {
  return Math.ceil((date.getTime() - Date.now()) / 86_400_000);
}

async function listCredentialTasks(organizationId: string): Promise<StaffTask[]> {
  const credHorizon = new Date();
  credHorizon.setDate(credHorizon.getDate() + 90);
  credHorizon.setHours(23, 59, 59, 999);

  let expiringCredentials: Array<{
    id: string;
    title: string;
    issuer: string;
    licenseNumber: string;
    expiresAt: Date;
    user: { name: string | null; email: string; status: 'INVITED' | 'ACTIVE' | 'DEACTIVATED' };
  }> = [];
  try {
    expiringCredentials = await prisma.staffCredential.findMany({
      where: {
        organizationId,
        expiresAt: { lte: credHorizon },
      },
      take: 80,
      include: { user: { select: { name: true, email: true, status: true } } },
    });
  } catch (err) {
    console.error('[tasks] staff credentials skipped', err);
  }

  const tasks: StaffTask[] = [];
  for (const cred of expiringCredentials) {
    const remaining = daysUntil(cred.expiresAt);
    const staffName = cred.user.name?.trim() || cred.user.email;
    const deactivated = cred.user.status === 'DEACTIVATED';
    const priority: StaffTask['priority'] =
      remaining <= 14 ? 'urgent' : remaining <= 30 ? 'normal' : 'low';
    tasks.push({
      taskId: `credential-expiring-${cred.id}`,
      type: 'credential_expiring',
      priority,
      title:
        remaining < 0
          ? 'Staff Credential Expired'
          : `Credential Expires in ${Math.max(remaining, 0)} Days`,
      description:
        `${cred.title} (${cred.issuer}` +
        (cred.licenseNumber ? ` · ${cred.licenseNumber}` : '') +
        ')' +
        (remaining < 0
          ? ` expired ${Math.abs(remaining)} day${Math.abs(remaining) === 1 ? '' : 's'} ago.`
          : ` expires in ${remaining} day${remaining === 1 ? '' : 's'}.`) +
        (deactivated ? ' Staff is deactivated.' : ''),
      clientName: staffName,
      dueDate: cred.expiresAt.toISOString().slice(0, 10),
      daysUntil: remaining,
      actionLabel: 'View Credential',
      actionHref: '/dashboard/hr/credentialing',
    });
  }
  return tasks;
}

export async function listStaffTasks(input: {
  organizationId: string;
  actorUserId: string;
  actorRole: Role;
}): Promise<StaffTask[]> {
  // HR has no My To-Do — never load patient or credential task feeds here.
  if (input.actorRole === 'HR') {
    return [];
  }

  const clientWhere = clientAccessWhere(input);
  const orgClients = { client: clientWhere };
  const tasks: StaffTask[] = [];

  const reviewHorizon = new Date();
  reviewHorizon.setDate(reviewHorizon.getDate() + 30);

  const paHorizon = new Date();
  paHorizon.setDate(paHorizon.getDate() + 14);
  paHorizon.setHours(23, 59, 59, 999);

  const [draftNotes, unreviewedAlerts, pendingIntake, waitlist, pendingConsents, recentCompleted, noShows, expiringPlans, priorAuths, readyClaims, openDenials] =
    await Promise.all([
      prisma.progressNoteWorkflow.findMany({
        where: {
          status: 'DRAFT',
          note: { client: clientWhere, dismissedAt: null },
        },
        orderBy: { updatedAt: 'asc' },
        take: 40,
        select: {
          noteId: true,
          clientName: true,
          createdAt: true,
          body: true,
        },
      }),
      prisma.riskAlert.findMany({
        where: { reviewed: false, ...orgClients },
        orderBy: { createdAt: 'desc' },
        take: 40,
        include: { client: { select: { name: true } } },
      }),
      prisma.intakeInvite.findMany({
        where: {
          organizationId: input.organizationId,
          status: 'PENDING',
        },
        orderBy: { createdAt: 'asc' },
        take: 30,
      }),
      prisma.waitlistEntry.findMany({
        where: {
          organizationId: input.organizationId,
          status: 'WAITING',
        },
        orderBy: { createdAt: 'asc' },
        take: 30,
      }),
      prisma.consentForm.findMany({
        where: {
          organizationId: input.organizationId,
          status: 'PENDING',
          client: clientWhere,
        },
        orderBy: { sentAt: 'asc' },
        take: 30,
        include: { client: { select: { name: true } } },
      }),
      prisma.appointment.findMany({
        where: {
          status: 'COMPLETED',
          startsAt: { gte: new Date(Date.now() - 5 * 86_400_000) },
          // Imported Valant history is not work to chase (no "Appointment Without a Note").
          AND: [NOT_IMPORTED_HISTORY],
          OR: [
            { client: clientWhere },
            { clinician: { organizationId: input.organizationId } },
          ],
        },
        include: { client: { select: { id: true, name: true } } },
        take: 40,
      }),
      prisma.appointment.findMany({
        where: {
          status: 'NO_SHOW',
          startsAt: { gte: new Date(Date.now() - 14 * 86_400_000) },
          AND: [NOT_IMPORTED_HISTORY],
          OR: [
            { client: clientWhere },
            { clinician: { organizationId: input.organizationId } },
          ],
        },
        include: { client: { select: { id: true, name: true } } },
        take: 30,
      }),
      prisma.treatmentPlan.findMany({
        where: {
          organizationId: input.organizationId,
          status: 'ACTIVE',
          reviewDueAt: { not: null, lte: reviewHorizon },
          client: clientWhere,
        },
        orderBy: { reviewDueAt: 'asc' },
        take: 40,
        include: { client: { select: { name: true } } },
      }),
      prisma.priorAuth.findMany({
        where: {
          organizationId: input.organizationId,
          status: 'APPROVED',
          client: clientWhere,
        },
        take: 80,
        include: { client: { select: { name: true } } },
      }),
      prisma.claim.findMany({
        where: {
          organizationId: input.organizationId,
          status: { in: ['DRAFT', 'READY'] },
          client: clientWhere,
        },
        take: 40,
        include: { client: { select: { name: true } } },
      }),
      prisma.claimDenial.findMany({
        where: {
          organizationId: input.organizationId,
          status: 'OPEN',
          claim: { client: clientWhere },
        },
        take: 30,
        include: {
          claim: {
            select: {
              cptCode: true,
              client: { select: { name: true } },
            },
          },
        },
      }),
    ]);

  for (const note of draftNotes) {
    const ageDays = Math.floor((Date.now() - note.createdAt.getTime()) / 86_400_000);
    const noteType = /\bDAP\b/i.test(note.body) ? 'DAP' : 'SOAP';
    const timeLabel = note.createdAt.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    });
    const dueLabel =
      ageDays <= 0 ? `Today ${timeLabel}` : ageDays === 1 ? `Yesterday ${timeLabel}` : note.createdAt.toISOString().slice(0, 10);
    // Prefer times embedded in note body (seed screenshot copy)
    const embedded = note.body.match(/\b(Today|Yesterday)\s+(?:session\s+)?(?:at\s+)?(\d{1,2}:\d{2}\s*[AP]M)\b/i);
    const datePart = embedded
      ? `${embedded[1][0].toUpperCase()}${embedded[1].slice(1).toLowerCase()} ${embedded[2].toUpperCase().replace(/\s+/g, ' ')}`
      : dueLabel;
    tasks.push({
      taskId: `note-${note.noteId}`,
      type: 'unsigned_note',
      priority: ageDays >= 1 ? 'urgent' : 'normal',
      title: ageDays >= 8 ? 'Escalated unsigned note' : 'Unsigned Progress Note',
      description: `${datePart} ${noteType}`,
      clientName: note.clientName,
      dueDate: datePart,
      daysUntil: 1 - ageDays,
      actionLabel: 'Sign Note',
      actionHref: '/dashboard/ehr/notes',
    });
  }

  for (const alert of unreviewedAlerts) {
    tasks.push({
      taskId: `alert-${alert.id}`,
      type: 'risk_alert',
      priority: alert.severity === 'HIGH' ? 'urgent' : alert.severity === 'MEDIUM' ? 'normal' : 'low',
      title: 'Unreviewed risk alert',
      description: alert.description || alert.type,
      clientName: alert.client.name,
      actionLabel: 'Review Alert',
      actionHref: '/dashboard/alerts',
    });
  }

  for (const invite of pendingIntake) {
    tasks.push({
      taskId: `intake-${invite.id}`,
      type: 'intake_incomplete',
      priority: invite.expiresAt < new Date() ? 'urgent' : 'normal',
      title: 'Intake Form Not Completed',
      description: `Intake link sent to ${invite.clientEmail}. Status is still pending.`,
      clientName: invite.clientName,
      daysUntil: daysUntil(invite.expiresAt),
      actionLabel: 'Resend Link',
      actionHref: '/dashboard/clients/intake',
    });
  }

  for (const entry of waitlist) {
    tasks.push({
      taskId: `wait-${entry.id}`,
      type: 'waitlist_waiting',
      priority: entry.urgency === 'CRISIS' ? 'urgent' : entry.urgency === 'URGENT' ? 'normal' : 'low',
      title: 'Waitlist follow-up',
      description: `${entry.specialty} · ${entry.urgency.toLowerCase()} acuity`,
      clientName: entry.name,
      actionLabel: 'Open Waitlist',
      actionHref: '/dashboard/clients/waitlist',
    });
  }

  for (const consent of pendingConsents) {
    tasks.push({
      taskId: `consent-${consent.id}`,
      type: 'consent_pending',
      priority: 'normal',
      title: 'Unsigned consent',
      description: `${consent.type} is still pending signature.`,
      clientName: consent.client.name,
      actionLabel: 'Open Consents',
      actionHref: '/dashboard/ehr/consents',
    });
  }

  for (const appt of noShows) {
    const day = appt.startsAt.toISOString().slice(0, 10);
    tasks.push({
      taskId: `noshow-${appt.id}`,
      type: 'no_show',
      priority: 'urgent',
      title: 'No-show follow-up needed',
      description: `Missed appointment on ${day} — outreach still open.`,
      clientName: appt.client.name,
      daysUntil: 0,
      actionLabel: 'Follow Up',
      actionHref: `/dashboard/clients/${appt.client.id}`,
    });
  }

  for (const plan of expiringPlans) {
    if (!plan.reviewDueAt) continue;
    const remaining = daysUntil(plan.reviewDueAt);
    const priority: StaffTask['priority'] =
      remaining <= 7 ? 'urgent' : remaining <= 14 ? 'normal' : 'low';
    tasks.push({
      taskId: `tp-review-${plan.id}`,
      type: 'expiring_treatment_plan',
      priority,
      title:
        remaining < 0
          ? 'Treatment Plan Review Overdue'
          : `Treatment Plan Expiring in ${Math.max(remaining, 0)} Days`,
      description:
        (plan.diagnosisCodes?.length
          ? `${plan.diagnosisCodes[0]}${plan.title ? ` ${plan.title}` : ''}`
          : plan.title) || 'Treatment plan review',
      clientName: plan.client.name,
      dueDate: plan.reviewDueAt.toISOString().slice(0, 10),
      daysUntil: remaining,
      actionLabel: 'Renew Plan',
      actionHref: '/dashboard/ehr/treatment-plans',
    });
  }

  for (const auth of priorAuths) {
    if (auth.endDate && auth.endDate <= paHorizon) {
      const remaining = daysUntil(auth.endDate);
      tasks.push({
        taskId: `pa-expiring-${auth.id}`,
        type: 'pa_expiring',
        priority: remaining <= 7 ? 'urgent' : remaining <= 14 ? 'normal' : 'low',
        title:
          remaining < 0
            ? 'Prior Auth Expired'
            : `Prior Auth Expires in ${Math.max(remaining, 0)} Days`,
        description:
          remaining < 0
            ? `${auth.payer} authorization ended ${Math.abs(remaining)} day${Math.abs(remaining) === 1 ? '' : 's'} ago.`
            : `${auth.payer} authorization ends in ${remaining} day${remaining === 1 ? '' : 's'}.`,
        clientName: auth.client.name,
        dueDate: auth.endDate.toISOString().slice(0, 10),
        daysUntil: remaining,
        actionLabel: 'View PA',
        actionHref: '/dashboard/ehr/prior-auths',
      });
    }

    const unitsLeft = auth.unitsApproved - auth.unitsUsed;
    const usedPct =
      auth.unitsApproved > 0 ? Math.round((auth.unitsUsed / auth.unitsApproved) * 100) : 0;
    if (unitsLeft <= 2 || usedPct >= 90) {
      tasks.push({
        taskId: `pa-units-${auth.id}`,
        type: 'pa_units',
        priority: unitsLeft <= 0 || usedPct >= 95 ? 'urgent' : 'normal',
        title: usedPct >= 90 ? `Prior Auth at ${usedPct}% — Units Low` : 'Prior auth units running low',
        description: `${unitsLeft} of ${auth.unitsApproved} units remaining (${auth.payer}).`,
        clientName: auth.client.name,
        daysUntil: unitsLeft <= 0 ? 0 : undefined,
        actionLabel: 'View PA',
        actionHref: '/dashboard/ehr/prior-auths',
      });
    }
  }

  const readyOnly = readyClaims.filter((c) => c.status === 'READY');
  const draftOnly = readyClaims.filter((c) => c.status === 'DRAFT');
  const claimsInbox =
    input.actorRole === 'ADMIN' ||
    input.actorRole === 'DIRECTOR' ||
    input.actorRole === 'PRACTICE_DIRECTOR' ||
    input.actorRole === 'BILLING';

  if (claimsInbox && readyOnly.length >= 2) {
    const dates = readyOnly
      .slice(0, 3)
      .map((c) => c.createdAt.toISOString().slice(0, 10).slice(5).replace('-', '/'))
      .join(', ');
    tasks.push({
      taskId: `claims-ready-batch`,
      type: 'claim_ready',
      priority: 'normal',
      title: `${readyOnly.length} Claims Ready to Submit`,
      description: `Sessions on ${dates}${readyOnly.length > 3 ? '…' : ''}.`,
      daysUntil: 5,
      actionLabel: 'Submit Claims',
      actionHref: '/dashboard/billing/claims',
    });
  } else if (claimsInbox) {
    for (const claim of readyOnly) {
      tasks.push({
        taskId: `claim-ready-${claim.id}`,
        type: 'claim_ready',
        priority: 'urgent',
        title: 'Claim ready to submit',
        description: `${claim.cptCode} · ${claim.units} unit${claim.units === 1 ? '' : 's'}${claim.payer ? ` · ${claim.payer}` : ''}.`,
        clientName: claim.client.name,
        actionLabel: 'Submit Claims',
        actionHref: '/dashboard/billing/claims',
      });
    }
  }

  if (claimsInbox) {
    for (const claim of draftOnly) {
      tasks.push({
        taskId: `claim-draft-${claim.id}`,
        type: 'claim_ready',
        priority: 'normal',
        title: 'Draft claim needs review',
        description: `${claim.cptCode} · ${claim.units} unit${claim.units === 1 ? '' : 's'}${claim.payer ? ` · ${claim.payer}` : ''}.`,
        clientName: claim.client.name,
        actionLabel: 'Open Claims',
        actionHref: '/dashboard/billing/claims',
      });
    }

    for (const denial of openDenials) {
      tasks.push({
        taskId: `denial-${denial.id}`,
        type: 'claim_ready',
        priority: 'normal',
        title: 'Open claim denial',
        description: `${denial.reasonCode}: ${denial.reasonText.slice(0, 120)}`,
        clientName: denial.claim.client.name,
        actionLabel: 'Review Denial',
        actionHref: '/dashboard/billing/claims',
      });
    }
  }

  if (input.actorRole === 'ADMIN' || input.actorRole === 'DIRECTOR') {
    tasks.push(...(await listCredentialTasks(input.organizationId)));
  }

  const completedClientDays = recentCompleted.map((a) => ({
    clientId: a.clientId,
    day: a.startsAt.toISOString().slice(0, 10),
    clientName: a.client.name,
    appointmentId: a.id,
  }));

  if (completedClientDays.length) {
    const notes = await prisma.progressNote.findMany({
      where: {
        clientId: { in: [...new Set(completedClientDays.map((x) => x.clientId))] },
        createdAt: { gte: new Date(Date.now() - 6 * 86_400_000) },
      },
      select: { clientId: true, createdAt: true },
    });
    const noteDays = new Set(
      notes.map((n) => `${n.clientId}:${n.createdAt.toISOString().slice(0, 10)}`)
    );

    for (const row of completedClientDays) {
      if (noteDays.has(`${row.clientId}:${row.day}`)) continue;
      tasks.push({
        taskId: `missing-${row.appointmentId}`,
        type: 'missing_note',
        priority: 'urgent',
        title: 'Appointment Without a Note',
        description: `Completed session on ${row.day} has no progress note yet.`,
        clientName: row.clientName,
        daysUntil: 3,
        actionLabel: 'Write Note',
        actionHref: `/dashboard/clients/${row.clientId}`,
      });
    }
  }

  const gapCutoff = new Date(Date.now() - 21 * 86_400_000);
  const leadership = input.actorRole === 'ADMIN' || input.actorRole === 'DIRECTOR' || input.actorRole === 'PRACTICE_DIRECTOR';
  const staleClients = await prisma.client.findMany({
    where: {
      AND: [
        clientWhere,
        { status: 'ACTIVE' },
        { appointments: { some: { status: 'COMPLETED' } } },
        { appointments: { none: { status: 'COMPLETED', startsAt: { gte: gapCutoff } } } },
      ],
    },
    select: { id: true, name: true, assignedToId: true },
    take: 20,
  });
  for (const client of staleClients) {
    if (!leadership && client.assignedToId !== input.actorUserId) continue;
    tasks.push({
      taskId: `gap-${client.id}`,
      type: 'expiring_treatment_plan',
      priority: 'normal',
      title: 'Session frequency gap',
      description: 'No completed visit in the last 21 days.',
      clientName: client.name,
      actionLabel: 'Open chart',
      actionHref: `/dashboard/clients/${client.id}`,
    });
  }

  const rank = { urgent: 0, normal: 1, low: 2 };
  tasks.sort((a, b) => rank[a.priority] - rank[b.priority]);
  return tasks.slice(0, 80);
}
