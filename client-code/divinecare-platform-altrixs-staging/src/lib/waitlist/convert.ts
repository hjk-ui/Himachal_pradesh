import type { Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { createClient } from '@/lib/clients/manage';
import { createAppointment } from '@/lib/appointments/manage';
import { createIntakeInvite } from '@/lib/intake/manage';
import { canAccessEligibility, runEligibilityCheck } from '@/lib/eligibility/manage';
import { eligibilityChannels } from '@/lib/eligibility/waystar';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { auditPhiAccess, type AuditGate } from '@/lib/audit/requestMeta';
import { toPracticeWallTime } from '@/lib/time/practiceTime';
import { getPracticeTimeZone } from '@/lib/time/practiceTimeServer';
import { deriveStage, runConversion, statusForStage, type ConversionRequest, type ConversionResult } from './standard';
import { entryInclude, findDuplicateClients, serializeEntry } from './manage';

/**
 * One-click waitlist conversion (Schedule panel): duplicate check → create or link the client with
 * everything captured → book the first visit through createAppointment (the same function behind
 * POST /api/appointments: license block, duplicate / overlap guards, telehealth room, confirmation
 * text) → optional intake invite (IntakeInvite, linked to the new chart) → optional eligibility
 * (Waystar / Availity when configured) → entry SCHEDULED / CONVERTED. Every step is audited with
 * ids and field names only.
 */

type Gate = AuditGate & { role: Role };

export function eligibilityAvailableFor(role: Role) {
  const ch = eligibilityChannels();
  return ch.channels.length > 0 && canAccessEligibility(role) && canAccessPath(role, '/dashboard/ehr/eligibility');
}

export async function scheduleConversion(
  gate: Gate,
  entryId: string,
  req: ConversionRequest,
  httpReq?: Request
): Promise<ConversionResult & { entry?: ReturnType<typeof serializeEntry> }> {
  const organizationId = gate.organizationId;
  const row = await prisma.waitlistEntry.findFirst({ where: { id: entryId, organizationId } });
  if (!row) return { ok: false, status: 404, error: 'Waitlist entry not found' };
  const stage = deriveStage(row);

  const audit = (action: string, resourceType: string, resourceId: string | null, patientId: string | null, metadata: Record<string, unknown>) =>
    auditPhiAccess({ gate, req: httpReq, action, resourceType, resourceId, patientId, metadata: { source: 'waitlist', waitlistEntryId: entryId, ...metadata } });

  // Clinician double-booking is refused before any chart is created
  if (req.appointment) {
    const start = new Date(req.appointment.startsAt);
    const end = new Date(req.appointment.endsAt);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      return { ok: false, status: 400, error: 'Pick a valid time' };
    }
    if (start.getTime() < Date.now() - 5 * 60_000) return { ok: false, status: 400, error: 'That time has passed' };
    const clash = await prisma.appointment.findFirst({
      where: {
        organizationId,
        clinicianId: req.appointment.clinicianId,
        status: { notIn: ['CANCELLED', 'NO_SHOW', 'LATE_CANCEL'] },
        startsAt: { lt: end },
        endsAt: { gt: start },
      },
      select: { id: true },
    });
    if (clash) return { ok: false, status: 409, error: 'That time was just taken for this clinician. Pick another slot.' };
  }

  const wantsEligibility = Boolean(req.runEligibility) && eligibilityAvailableFor(gate.role);
  const timeZone = await getPracticeTimeZone(organizationId);

  const result = await runConversion({ stage, convertedClientId: row.convertedClientId }, { ...req, runEligibility: wantsEligibility }, {
    findDuplicates: () =>
      findDuplicateClients(organizationId, {
        firstName: row.firstName,
        lastName: row.lastName,
        name: row.name,
        dateOfBirth: row.dateOfBirth,
        phone: row.phone,
        email: row.email,
      }),
    verifyClient: async (clientId) =>
      Boolean(await prisma.client.findFirst({ where: { id: clientId, organizationId, status: { not: 'DISCHARGED' } }, select: { id: true } })),
    createClient: async () => {
      // Chosen site, else the first preferred site (createClient checks it belongs to the org)
      const locationId = req.locationId || row.preferredLocationIds[0] || null;
      const base = {
        name: row.name,
        legalFirstName: row.firstName,
        legalLastName: row.lastName,
        email: row.email,
        phone: row.phone,
        dateOfBirth: row.dateOfBirth ? row.dateOfBirth.toISOString().slice(0, 10) : null,
        guardianName: row.guardianName,
        guardianPhone: row.guardianPhone,
        guardianRelationship: row.guardianRelationship,
        insurancePayer: row.insurancePayer,
        insuranceMemberId: row.insuranceMemberId,
        locationId,
        assignedToId: req.appointment?.clinicianId ?? req.assignedToId ?? row.clinicianId ?? null,
        status: 'ACTIVE' as const,
      };
      let created = await createClient(base, gate.userId, organizationId, gate.role);
      let emailHeld = false;
      if (created.ok === false && created.status === 409 && row.email) {
        // Client.email is unique across the database: create the chart without it and flag the
        // email for identity review (same rule as public intake / online booking)
        emailHeld = true;
        created = await createClient({ ...base, email: null }, gate.userId, organizationId, gate.role);
      }
      if (created.ok === false) return { ok: false, error: created.error, status: created.status };
      if (emailHeld) {
        await prisma.client.update({
          where: { id: created.client.id },
          data: { unverifiedEmail: row.email, identityVerifyRequired: true, identityVerifyReason: 'possible_duplicate_email' },
        });
      }
      return { ok: true, clientId: created.client.id };
    },
    book: async (clientId) => {
      const a = req.appointment!;
      const r = await createAppointment(
        { clientId, type: a.type, startsAt: a.startsAt, endsAt: a.endsAt, isVirtual: a.isVirtual, clinicianId: a.clinicianId, notes: null },
        gate.userId,
        organizationId,
        gate.role
      );
      if (r.ok === false) return { ok: false, error: r.error, status: r.status };
      return { ok: true, appointmentId: r.appointment.id };
    },
    sendIntake: async (clientId) => {
      if (!row.email) return { ok: false, error: 'No email on file: copy the intake link from Intake instead' };
      const wall = req.appointment ? toPracticeWallTime(req.appointment.startsAt, timeZone) : null;
      const r = await createIntakeInvite(organizationId, gate.userId, {
        clientName: row.name,
        clientEmail: row.email,
        clientPhone: row.phone,
        firstAppointment: wall ? wall.date : null,
        assignedToId: req.appointment?.clinicianId ?? req.assignedToId ?? row.clinicianId ?? null,
        waitlistEntryId: row.id,
        insurancePayer: row.insurancePayer,
        appointmentType: req.appointment ? (req.appointment.isVirtual ? 'Telehealth' : 'In Office') : null,
        clientId,
      });
      if (r.ok === false) return { ok: false, error: r.error };
      await auditPhiAccess({ gate, req: httpReq, action: 'CREATE', resourceType: 'intake_invite', resourceId: r.invite.id, patientId: clientId, metadata: { source: 'waitlist', waitlistEntryId: entryId } });
      return { ok: true, token: r.invite.token };
    },
    runEligibility: async (clientId) => {
      const r = await runEligibilityCheck({
        organizationId,
        actorUserId: gate.userId,
        actorRole: gate.role,
        clientId,
        payerName: row.insurancePayer,
        memberId: row.insuranceMemberId,
        dos: req.appointment ? toPracticeWallTime(req.appointment.startsAt, timeZone).date : null,
      });
      if (r.ok === false) return { ok: false, error: r.error };
      await auditPhiAccess({ gate, req: httpReq, action: 'SUBMIT', resourceType: 'eligibilityCheck', resourceId: r.check.id, patientId: clientId, metadata: { source: 'waitlist', status: r.check.status, mode: r.mode } });
      return { ok: true, status: r.check.status };
    },
    markConverted: async ({ clientId, appointmentId, stage: next, clinicianId }) => {
      const done = next !== 'READY';
      await prisma.waitlistEntry.update({
        where: { id: row.id },
        data: {
          convertedClientId: clientId,
          stage: next,
          status: statusForStage(next, clinicianId ?? row.clinicianId),
          ...(clinicianId ? { clinicianId } : {}),
          ...(done ? { convertedAt: new Date(), convertedAppointmentId: appointmentId, nextFollowUpAt: null } : {}),
        },
      });
      await audit('UPDATE', 'waitlist_entry', row.id, clientId, {
        fields: ['stage', 'status', 'convertedClientId', ...(done ? ['convertedAt', 'convertedAppointmentId'] : [])],
        stage: next,
        appointmentId,
      });
    },
    audit: async (step, detail) => {
      const clientId = typeof detail.clientId === 'string' ? detail.clientId : null;
      if (step === 'create_client') {
        await audit('CREATE', 'patient', clientId, clientId, {
          fields: ['name', 'legalFirstName', 'legalLastName', 'email', 'phone', 'dateOfBirth', 'guardian', 'insurancePayer', 'insuranceMemberId', 'locationId', 'assignedToId'],
          duplicatesOverridden: detail.duplicatesOverridden ?? null,
        });
      } else if (step === 'link_client') {
        await audit('LINK', 'patient', clientId, clientId, { linkedExisting: true });
      } else if (step === 'book') {
        await audit('CREATE', 'appointment', String(detail.appointmentId), clientId, {
          fields: ['clientId', 'clinicianId', 'type', 'startsAt', 'endsAt', 'isVirtual'],
          isVirtual: req.appointment?.isVirtual ?? null,
        });
      }
    },
  });

  if (result.ok === false) {
    if (result.code === 'POSSIBLE_DUPLICATE') {
      await audit('LIST', 'duplicate_check', row.id, null, { count: result.duplicates?.length ?? 0, clientIds: result.duplicates?.map((d) => d.clientId) ?? [] });
    }
    return result;
  }
  const fresh = await prisma.waitlistEntry.findFirst({ where: { id: row.id }, include: entryInclude });
  return { ...result, entry: fresh ? serializeEntry(fresh) : undefined };
}
