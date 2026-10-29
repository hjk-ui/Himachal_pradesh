import type { Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { canWriteClientChartNotes, clientAccessWhere } from '@/lib/clients/orgScope';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { loadNotePolicy } from '@/lib/notes/policy';
import { openNoteHref, ownClinicalWork, unsignedNoteUrgency, visitNoteHref } from '@/lib/tasks/visitTaskLinks';
import { toPracticeWallTime } from '@/lib/time/practiceTime';
import { ownCaseloadClientWhere, routesPlanReviewTo, routesPriorAuthTo } from '@/lib/worklists/ownership';
import { NOT_IMPORTED_HISTORY } from '@/lib/appointments/importedHistory';

export type StaffTask = {
  taskId: string;
  type:
    | 'unsigned_note'
    | 'missing_note'
    | 'intake_incomplete'
    | 'waitlist_waiting'
    | 'risk_alert'
    | 'sud_referral'
    | 'service_referral'
    | 'consent_pending'
    | 'expiring_treatment_plan'
    | 'pa_expiring'
    | 'pa_units'
    | 'claim_ready'
    | 'credential_expiring'
    | 'no_show'
    | 'scribe_follow_up'
    | 'bh_handoff'
    | 'tms_billing_handoff';
  priority: 'urgent' | 'normal' | 'low';
  title: string;
  description: string;
  clientName?: string;
  /** Client the task is about (absent for staff, prospect and batch tasks); used for Part 2 masking */
  clientId?: string;
  dueDate?: string;
  daysUntil?: number;
  actionLabel: string;
  actionHref: string;
  /**
   * Belongs to the signed-in user: about one of their own patients (caseload / care team) or
   * assigned / routed to them; tasks about no client (intake, waitlist, claim batches) are true.
   * The To-Do "My patients only" toggle and the clinical inbox show only these.
   */
  mine?: boolean;
};

/**
 * Part 2 / protected records: a task about a client the viewer cannot open keeps its type and
 * priority but loses the name, the detail text and the client link (same rule as the inbox).
 * locked === null means the lookup failed: every client-linked task is masked (fail closed).
 */
export function maskLockedTasks(tasks: StaffTask[], locked: Set<string> | null): StaffTask[] {
  return tasks.map((t) => {
    if (!t.clientId) return t;
    if (locked && !locked.has(t.clientId)) return t;
    return {
      ...t,
      clientName: 'Protected Client',
      clientId: undefined,
      description: 'Protected record: open it from the client list if you have access.',
      actionHref: '/dashboard/clients',
    };
  });
}

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

/** True count of unsigned (DRAFT) progress notes in the actor's scope; the task list is capped. */
export async function countUnsignedNotes(input: {
  organizationId: string;
  actorUserId: string;
  actorRole: Role;
}): Promise<number> {
  if (input.actorRole === 'HR' || !taskSourcesForRole(input.actorRole).draftNotes) return 0;
  // Unsigned = no workflow row yet (drafts only get one when signed) or a DRAFT row
  return prisma.progressNote.count({
    where: {
      client: clientAccessWhere(input),
      // Dismissed drafts (created in error / not needed) never count
      dismissedAt: null,
      OR: [{ workflow: { is: null } }, { workflow: { is: { status: 'DRAFT' } } }],
    },
  });
}

/**
 * Which task feeds a role gets: each feed follows the page its task links to, so a task never shows
 * a role text it could not open (risk alert descriptions, treatment-plan diagnosis codes, claims,
 * intake / waitlist entries outside the role's work). Row scope is still clientAccessWhere.
 */
export function taskSourcesForRole(role: Role | string) {
  const can = (path: string) => canAccessPath(role, path);
  return {
    draftNotes: can('/dashboard/ehr/notes'),
    riskAlerts: can('/dashboard/alerts'),
    // Intake / waitlist follow-ups: the roles that work the list (clinicians only read the waitlist)
    intakeAndWaitlist: can('/dashboard/clients/intake'),
    consents: can('/dashboard/ehr/consents'),
    noShows: can('/dashboard/appointments'),
    missingNotes: canWriteClientChartNotes(role) && can('/dashboard/ehr/notes'),
    treatmentPlans: can('/dashboard/ehr/treatment-plans'),
    priorAuths: can('/dashboard/billing/authorizations'),
    claims: can('/dashboard/billing/claims'),
    denials: can('/dashboard/billing/denials'),
  };
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
  const src = taskSourcesForRole(input.actorRole);
  // Clinicians: their own notes and their own visits (not every visit of a shared care-team client)
  const own = ownClinicalWork(input.actorRole) && canWriteClientChartNotes(input.actorRole);
  const policy = src.draftNotes ? await loadNotePolicy(input.organizationId).catch(() => null) : null;
  const when = <T,>(on: boolean, load: () => Promise<T[]>): Promise<T[]> => (on ? load() : Promise.resolve([]));
  const tasks: StaffTask[] = [];

  const reviewHorizon = new Date();
  reviewHorizon.setDate(reviewHorizon.getDate() + 45);

  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);

  const paHorizon = new Date();
  paHorizon.setDate(paHorizon.getDate() + 14);
  paHorizon.setHours(23, 59, 59, 999);

  const [draftNotes, unreviewedAlerts, pendingIntake, waitlist, pendingConsents, recentCompleted, noShows, expiringPlans, priorAuths, readyClaims, openDenials] =
    await Promise.all([
      when(src.draftNotes, () =>
        prisma.progressNoteWorkflow.findMany({
        where: {
          status: 'DRAFT',
          note: { client: clientWhere, dismissedAt: null, ...(own ? { clinicianId: input.actorUserId } : {}) },
        },
        orderBy: { updatedAt: 'asc' },
        take: 40,
        select: {
          noteId: true,
          clientId: true,
          clientName: true,
          createdAt: true,
          body: true,
          note: { select: { noteType: true, dateOfService: true } },
        },
      })),
      when(src.riskAlerts, () =>
        prisma.riskAlert.findMany({
        where: { reviewed: false, ...orgClients },
        orderBy: { createdAt: 'desc' },
        take: 40,
        include: { client: { select: { name: true } } },
      })),
      when(src.intakeAndWaitlist, () =>
        prisma.intakeInvite.findMany({
        where: {
          organizationId: input.organizationId,
          status: 'PENDING',
        },
        orderBy: { createdAt: 'asc' },
        take: 30,
      })),
      when(src.intakeAndWaitlist, () =>
        // Waitlist work for today: follow-ups due (contact log), urgent / positive safety screen,
        // and new entries nobody has contacted yet (src/lib/waitlist/standard.ts)
        prisma.waitlistEntry.findMany({
        where: {
          organizationId: input.organizationId,
          status: { in: ['WAITING', 'MATCHED'] },
          OR: [
            { nextFollowUpAt: { lte: endOfToday } },
            { urgency: { in: ['URGENT', 'CRISIS'] } },
            { safetyScreen: 'yes' },
            { nextFollowUpAt: null, OR: [{ stage: null }, { stage: 'NEW' }] },
          ],
        },
        orderBy: { createdAt: 'asc' },
        take: 40,
      })),
      when(src.consents, () =>
        prisma.consentForm.findMany({
        where: {
          organizationId: input.organizationId,
          status: 'PENDING',
          // Carelon attestations have their own inbox section ("Medicaid attestations to complete")
          formKey: null,
          client: clientWhere,
        },
        orderBy: { sentAt: 'asc' },
        take: 30,
        include: { client: { select: { name: true } } },
      })),
      when(src.missingNotes, () =>
        prisma.appointment.findMany({
        where: {
          status: 'COMPLETED',
          startsAt: { gte: new Date(Date.now() - 5 * 86_400_000) },
          // Client scope only (the clinician-in-org branch listed every org client to caseload roles)
          client: clientWhere,
          // The visit's own live note (same rule as the Notes "To write" tab; a dismissed note does not
          // count), and only the clinician's own visits
          progressNotes: { none: { dismissedAt: null } },
          groupSessionId: null,
          // Visits imported from Valant were documented in Valant
          ...NOT_IMPORTED_HISTORY,
          ...(own ? { clinicianId: input.actorUserId } : {}),
        },
        include: { client: { select: { id: true, name: true } } },
        take: 40,
      })),
      when(src.noShows, () =>
        prisma.appointment.findMany({
        where: {
          status: 'NO_SHOW',
          startsAt: { gte: new Date(Date.now() - 14 * 86_400_000) },
          // Client scope only (the clinician-in-org branch listed every org client to caseload roles)
          client: clientWhere,
          // Outreach closes when the No-Show note is written (a dismissed note does not close it);
          // clinicians follow up their own missed visits
          progressNotes: { none: { dismissedAt: null } },
          ...NOT_IMPORTED_HISTORY,
          ...(own ? { clinicianId: input.actorUserId } : {}),
        },
        include: { client: { select: { id: true, name: true } } },
        take: 30,
      })),
      when(src.treatmentPlans, () =>
        prisma.treatmentPlan.findMany({
        where: {
          organizationId: input.organizationId,
          status: 'ACTIVE',
          reviewDueAt: { not: null, lte: reviewHorizon },
          client: clientWhere,
        },
        orderBy: { reviewDueAt: 'asc' },
        take: 80,
        include: { client: { select: { name: true, assignedToId: true } } },
      })),
      when(src.priorAuths, () =>
        prisma.priorAuth.findMany({
        where: {
          organizationId: input.organizationId,
          status: 'APPROVED',
          client: clientWhere,
        },
        // Soonest-ending first so the expiry tasks see the auths that matter when there are many
        orderBy: { endDate: 'asc' },
        take: 80,
        include: { client: { select: { name: true } } },
      })),
      when(src.claims, () =>
        prisma.claim.findMany({
        where: {
          organizationId: input.organizationId,
          status: { in: ['DRAFT', 'READY'] },
          client: clientWhere,
        },
        take: 40,
        include: { client: { select: { name: true } } },
      })),
      when(src.denials, () =>
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
              clientId: true,
              client: { select: { name: true } },
            },
          },
        },
      })),
    ]);

  // Warm handoffs from primary care to the practice behavioral health team (medical_referrals,
  // kind internal_bh): open until a BH appointment is booked after the handoff. The intake /
  // waitlist roles see them for the clients in their scope; only the primary care screen reason
  // travels (no BH content goes back to primary care).
  if (src.intakeAndWaitlist) {
    try {
      const handoffs = await prisma.medicalReferral.findMany({
        where: { organizationId: input.organizationId, kind: 'internal_bh', status: 'sent' },
        orderBy: { sentAt: 'asc' },
        take: 40,
      });
      const ids = [...new Set(handoffs.map((h) => h.clientId))];
      const inScope = ids.length
        ? await prisma.client.findMany({ where: { AND: [clientWhere, { id: { in: ids } }] }, select: { id: true, name: true } })
        : [];
      const names = new Map(inScope.map((c) => [c.id, c.name]));
      const booked = inScope.length
        ? await prisma.appointment.findMany({
            where: {
              clientId: { in: inScope.map((c) => c.id) },
              status: { in: ['SCHEDULED', 'CHECKED_IN', 'IN_SESSION', 'COMPLETED'] },
              clinician: { NOT: { OR: [{ role: { in: ['PHYSICIAN', 'MEDICAL_NP', 'MEDICAL_ASSISTANT'] } }] } },
              createdAt: { gte: handoffs[0]?.sentAt ?? new Date() },
            },
            select: { clientId: true, createdAt: true },
            take: 500,
          })
        : [];
      for (const h of handoffs) {
        if (!names.has(h.clientId)) continue;
        if (booked.some((b) => b.clientId === h.clientId && b.createdAt.getTime() >= h.sentAt.getTime())) continue;
        const ageDays = Math.floor((Date.now() - h.sentAt.getTime()) / 86_400_000);
        tasks.push({
          taskId: `bh-handoff-${h.id}`,
          type: 'bh_handoff',
          priority: h.urgency === 'routine' ? (ageDays >= 3 ? 'urgent' : 'normal') : 'urgent',
          title: 'Primary care warm handoff',
          description: `${h.reason} Referred by ${h.orderedByName || 'primary care'}; schedule a behavioral health intake.`,
          clientName: names.get(h.clientId),
          clientId: h.clientId,
          dueDate: h.sentAt.toISOString().slice(0, 10),
          daysUntil: -ageDays,
          actionLabel: 'Schedule intake',
          actionHref: `/dashboard/appointments?new=1&client=${encodeURIComponent(h.clientId)}`,
        });
      }
    } catch (err) {
      console.error('[tasks] primary care handoffs skipped', err instanceof Error ? err.name : 'error');
    }
  }

  // SUD screener referral prompts routed to this prescriber. Queried by recipient rather
  // than caseload — the prescriber is often not the client's assigned clinician.
  const sudReferrals = await prisma.riskAlert.findMany({
    where: {
      organizationId: input.organizationId,
      // + Service Eligibility Scanner referrals routed to this program lead
      type: { in: ['SUD_REFERRAL_PROMPT', 'SERVICE_REFERRAL'] },
      reviewed: false,
      clinicianId: input.actorUserId,
    },
    orderBy: { createdAt: 'desc' },
    take: 40,
    include: { client: { select: { name: true } } },
  });
  const sudReferralIds = new Set(sudReferrals.map((a) => a.id));
  // Tasks routed to this user by name (not just by client): always "mine"
  const assignedToMe = new Set<string>();

  // Treatment plan reviews go to the plan owner and their supervisor (not prescribers on the care team)
  const supervisees = expiringPlans.length
    ? new Set(
        await prisma.supervisionTrack
          .findMany({ where: { organizationId: input.organizationId, supervisorId: input.actorUserId }, select: { superviseeId: true } })
          .then((rows) => rows.map((r) => r.superviseeId))
          .catch(() => [] as string[])
      )
    : new Set<string>();

  for (const note of draftNotes) {
    const ageDays = Math.floor((Date.now() - note.createdAt.getTime()) / 86_400_000);
    // The note's recorded type; only fall back to a format named in the body. Never a default "SOAP".
    const noteType =
      note.note?.noteType?.trim() || (/\bDAP\b/i.test(note.body) ? 'DAP' : /\bSOAP\b/i.test(note.body) ? 'SOAP' : '');
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
    // Urgency follows the practice sign deadline from the date of service (not "older than a day")
    const dos = (note.note?.dateOfService ?? note.createdAt).toISOString().slice(0, 10);
    const urgency = policy
      ? unsignedNoteUrgency({ dateOfService: dos, deadlineHours: policy.deadlineHours, timeZone: policy.timeZone, now: new Date() })
      : { priority: (ageDays >= 1 ? 'urgent' : 'normal') as 'urgent' | 'normal', daysUntil: 1 - ageDays };
    tasks.push({
      taskId: `note-${note.noteId}`,
      type: 'unsigned_note',
      priority: urgency.priority,
      title: 'Unsigned Progress Note',
      description: noteType ? `${datePart} ${noteType}` : datePart,
      clientName: note.clientName,
      clientId: note.clientId,
      dueDate: datePart,
      daysUntil: urgency.daysUntil ?? undefined,
      actionLabel: 'Sign Note',
      actionHref: openNoteHref(note.noteId),
    });
  }

  for (const alert of sudReferrals) {
    if (alert.type === 'SERVICE_REFERRAL') {
      assignedToMe.add(`service-referral-${alert.id}`);
      tasks.push({
        taskId: `service-referral-${alert.id}`,
        type: 'service_referral',
        priority: 'normal',
        title: 'Program Referral (Scanner)',
        description: alert.description || 'Service Eligibility Scanner referral — review criteria and start intake.',
        clientName: alert.client.name,
        clientId: alert.clientId,
        actionLabel: 'Open Scanner',
        actionHref: `/dashboard/ehr/scanner?clientId=${encodeURIComponent(alert.clientId)}`,
      });
      continue;
    }
    assignedToMe.add(`sud-referral-${alert.id}`);
    tasks.push({
      taskId: `sud-referral-${alert.id}`,
      type: 'sud_referral',
      priority: alert.severity === 'HIGH' ? 'urgent' : 'normal',
      title: 'SUD Referral Review',
      description: alert.description || 'Positive SUD screen — prescriber review for referral.',
      clientName: alert.client.name,
      clientId: alert.clientId,
      actionLabel: 'Review Alert',
      actionHref: '/dashboard/alerts',
    });
  }

  for (const alert of unreviewedAlerts) {
    if (sudReferralIds.has(alert.id)) continue;
    tasks.push({
      taskId: `alert-${alert.id}`,
      type: 'risk_alert',
      priority: alert.severity === 'HIGH' ? 'urgent' : alert.severity === 'MEDIUM' ? 'normal' : 'low',
      title: 'Unreviewed risk alert',
      description: alert.description || alert.type,
      clientName: alert.client.name,
      clientId: alert.clientId,
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
    const safety = entry.safetyScreen === 'yes';
    const due = entry.nextFollowUpAt ? entry.nextFollowUpAt.getTime() <= endOfToday.getTime() : false;
    tasks.push({
      taskId: `wait-${entry.id}`,
      type: 'waitlist_waiting',
      priority: safety || entry.urgency === 'CRISIS' ? 'urgent' : entry.urgency === 'URGENT' || due ? 'normal' : 'low',
      title: safety
        ? 'Waitlist: positive safety screen - same-day triage'
        : due
          ? 'Waitlist follow-up due'
          : entry.lastContactAt
            ? 'Waitlist follow-up'
            : 'New waitlist entry - first contact',
      description: `${entry.specialty} · ${entry.urgency.toLowerCase()} acuity${entry.noResponseCount ? ` · ${entry.noResponseCount} unanswered attempt${entry.noResponseCount === 1 ? '' : 's'}` : ''}`,
      clientName: entry.name,
      ...(entry.nextFollowUpAt ? { dueDate: entry.nextFollowUpAt.toISOString(), daysUntil: daysUntil(entry.nextFollowUpAt) } : {}),
      actionLabel: 'Open Waitlist',
      actionHref: `/dashboard/clients/waitlist?entry=${encodeURIComponent(entry.id)}`,
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
      clientId: consent.clientId,
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
      description: `Missed appointment on ${day} — document outreach and the risk review (No-Show note).`,
      clientName: appt.client.name,
      clientId: appt.client.id,
      dueDate: day,
      daysUntil: 0,
      actionLabel: 'Document no-show',
      // Clinicians open the No-Show note for that visit; front office roles (no chart notes) the client
      actionHref: canWriteClientChartNotes(input.actorRole)
        ? visitNoteHref({ clientId: appt.client.id, appointmentId: appt.id, startsAt: appt.startsAt, timeZone: policy?.timeZone })
        : `/dashboard/clients/${appt.client.id}`,
    });
  }

  for (const plan of expiringPlans) {
    if (!plan.reviewDueAt) continue;
    if (!routesPlanReviewTo(input.actorRole, input.actorUserId, { clinicianId: plan.clinicianId, clientAssignedToId: plan.client.assignedToId }, supervisees)) continue;
    if ((plan.clinicianId ?? plan.client.assignedToId) === input.actorUserId) assignedToMe.add(`tp-review-${plan.id}`);
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
      // Plan title only: no diagnosis code in a task line (tasks surface on home / inbox widgets)
      description: plan.title || 'Treatment plan review',
      clientName: plan.client.name,
      clientId: plan.clientId,
      dueDate: plan.reviewDueAt.toISOString().slice(0, 10),
      daysUntil: remaining,
      actionLabel: 'Review Plan',
      actionHref: `/dashboard/ehr/treatment-plans/${encodeURIComponent(plan.id)}`,
    });
  }

  for (const auth of priorAuths) {
    // Billing / front desk / office manager / leadership work authorizations; others only their own requests
    if (!routesPriorAuthTo(input.actorRole, input.actorUserId, { createdById: auth.createdById })) continue;
    if (auth.createdById === input.actorUserId) {
      assignedToMe.add(`pa-expiring-${auth.id}`);
      assignedToMe.add(`pa-units-${auth.id}`);
    }
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
        clientId: auth.clientId,
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
        clientId: auth.clientId,
        daysUntil: unitsLeft <= 0 ? 0 : undefined,
        actionLabel: 'View PA',
        actionHref: '/dashboard/ehr/prior-auths',
      });
    }
  }

  const readyOnly = readyClaims.filter((c) => c.status === 'READY');
  const draftOnly = readyClaims.filter((c) => c.status === 'DRAFT');

  if (readyOnly.length >= 2) {
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
  } else {
    for (const claim of readyOnly) {
      tasks.push({
        taskId: `claim-ready-${claim.id}`,
        type: 'claim_ready',
        priority: 'urgent',
        title: 'Claim ready to submit',
        description: `${claim.cptCode} · ${claim.units} unit${claim.units === 1 ? '' : 's'}${claim.payer ? ` · ${claim.payer}` : ''}.`,
        clientName: claim.client.name,
        clientId: claim.clientId,
        actionLabel: 'Submit Claims',
        actionHref: '/dashboard/billing/claims',
      });
    }
  }

  for (const claim of draftOnly) {
    tasks.push({
      taskId: `claim-draft-${claim.id}`,
      type: 'claim_ready',
      priority: 'normal',
      title: 'Draft claim needs review',
      description: `${claim.cptCode} · ${claim.units} unit${claim.units === 1 ? '' : 's'}${claim.payer ? ` · ${claim.payer}` : ''}.`,
      clientName: claim.client.name,
      clientId: claim.clientId,
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
      clientId: denial.claim.clientId,
      actionLabel: 'Review Denial',
      actionHref: '/dashboard/billing/claims',
    });
  }

  // TMS: insurance sent to billing, not yet verified (src/lib/tms/workflowDb.ts sendToBilling). Billing /
  // authorization roles only; the task carries no clinical content.
  if (src.priorAuths) {
    try {
      const handoffs = await prisma.tmsCaseWorkflow.findMany({
        where: { organizationId: input.organizationId, stage: { in: ['insurance_sent', 'verification'] }, NOT: { verificationStatus: 'verified' } },
        select: { courseId: true, clientId: true, insuranceSentAt: true },
        orderBy: { insuranceSentAt: 'asc' },
        take: 50,
      });
      if (handoffs.length) {
        const clients = await prisma.client.findMany({ where: { AND: [clientWhere, { id: { in: handoffs.map((h) => h.clientId) } }] }, select: { id: true, name: true } });
        const nameOf = new Map(clients.map((c) => [c.id, c.name]));
        for (const h of handoffs) {
          if (!nameOf.has(h.clientId)) continue;
          const days = h.insuranceSentAt ? Math.floor((Date.now() - h.insuranceSentAt.getTime()) / 86_400_000) : 0;
          tasks.push({
            taskId: `tms-billing-${h.courseId}`,
            type: 'tms_billing_handoff',
            priority: days >= 3 ? 'urgent' : 'normal',
            title: 'TMS: verify insurance and authorization',
            description: `Insurance sent to billing${days ? ` ${days} day${days === 1 ? '' : 's'} ago` : ' today'}. Verify coverage and record the authorization (or not required).`,
            clientName: nameOf.get(h.clientId) ?? undefined,
            clientId: h.clientId,
            actionLabel: 'Verify',
            actionHref: `/dashboard/billing/authorizations?tms=${encodeURIComponent(h.courseId)}`,
          });
        }
      }
    } catch (err) {
      console.error('[tasks] TMS hand-offs skipped', err instanceof Error ? err.name : 'unknown');
    }
  }

  if (input.actorRole === 'ADMIN' || input.actorRole === 'DIRECTOR') {
    tasks.push(...(await listCredentialTasks(input.organizationId)));
  }

  // AI Scribe follow-ups the clinician accepted (their own; client must still be in scope)
  try {
    const followUps = await prisma.scribeFollowUp.findMany({
      where: { organizationId: input.organizationId, ownerId: input.actorUserId, status: 'OPEN' },
      orderBy: { createdAt: 'asc' },
      take: 30,
    });
    if (followUps.length) {
      const clients = await prisma.client.findMany({
        where: { id: { in: [...new Set(followUps.map((f) => f.clientId))] }, ...clientWhere },
        select: { id: true, name: true },
      });
      const nameOf = new Map(clients.map((c) => [c.id, c.name]));
      for (const f of followUps) {
        if (!nameOf.has(f.clientId)) continue;
        assignedToMe.add(`scribe-follow-up-${f.id}`);
        tasks.push({
          taskId: `scribe-follow-up-${f.id}`,
          type: 'scribe_follow_up',
          priority: 'normal',
          title: f.title,
          description: f.detail || 'Follow-up accepted from an AI Scribe session.',
          clientName: nameOf.get(f.clientId) ?? undefined,
          clientId: f.clientId,
          actionLabel: 'Open',
          actionHref: f.href || `/dashboard/clients/${encodeURIComponent(f.clientId)}`,
        });
      }
    }
  } catch (err) {
    console.error('[tasks] scribe follow-ups skipped', err instanceof Error ? err.name : 'unknown');
  }

  // Completed visits with no note linked to them (query: progressNotes none): open the note for that visit
  for (const a of recentCompleted) {
    const day = toPracticeWallTime(a.startsAt, policy?.timeZone || undefined).date;
    tasks.push({
      taskId: `missing-${a.id}`,
      type: 'missing_note',
      priority: 'urgent',
      title: 'Appointment Without a Note',
      description: `Completed session on ${day} has no progress note yet.`,
      clientName: a.client.name,
      clientId: a.clientId,
      dueDate: day,
      daysUntil: policy
        ? unsignedNoteUrgency({ dateOfService: day, deadlineHours: policy.deadlineHours, timeZone: policy.timeZone, now: new Date() }).daysUntil ?? undefined
        : undefined,
      actionLabel: 'Write Note',
      actionHref: visitNoteHref({ clientId: a.clientId, appointmentId: a.id, startsAt: a.startsAt, timeZone: policy?.timeZone, virtual: Boolean(a.isVirtual || a.audioOnly) }),
    });
  }

  // "Mine": the user's own caseload / care team (not a wider leadership or Medical Director scope)
  const taskClientIds = [...new Set(tasks.map((t) => t.clientId).filter((x): x is string => Boolean(x)))];
  const myClients = taskClientIds.length
    ? await prisma.client
        .findMany({
          where: { AND: [clientWhere, ownCaseloadClientWhere(input.actorRole, input.actorUserId), { id: { in: taskClientIds } }] },
          select: { id: true },
        })
        .then((rows) => new Set(rows.map((r) => r.id)))
    : new Set<string>();
  for (const t of tasks) {
    // Own drafts / own visits (clinicians' note queries are already limited to their own notes)
    const ownNote = own && (t.type === 'unsigned_note' || t.type === 'missing_note' || t.type === 'no_show');
    t.mine = !t.clientId || myClients.has(t.clientId) || assignedToMe.has(t.taskId) || ownNote;
  }

  const rank = { urgent: 0, normal: 1, low: 2 };
  tasks.sort((a, b) => rank[a.priority] - rank[b.priority]);
  return tasks.slice(0, 80);
}
