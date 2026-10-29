import 'server-only';
import { prisma } from '@/lib/db/prisma';
import { clientOrgFilter } from '@/lib/clients/orgScope';
import { appointmentOfficeVisit } from '@/lib/drfirst/chartMapping';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { DEMO_MODE } from '@/lib/services/drfirstRcopiaService';
import { sendOfficeVisit } from '@/lib/services/drfirstCommands';

export interface OfficeVisitActor {
  userId: string | null;
  role: string;
  organizationId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export type OfficeVisitResult =
  | { sent: true; rcopiaVisitId: string | null }
  | { sent: false; reason: 'not_configured' | 'not_found' | 'not_completed' | 'not_linked' | 'no_date' | 'rejected'; error?: string };

/**
 * send_patient_office_visits for one COMPLETED appointment of a client that is
 * linked to Rcopia (Client.rcopiaPatientId). Sends the visit date and, when the
 * appointment's clinician has a DrFirst username, the rendering provider; signs
 * as that clinician (else practice-level). The visit's ExternalID is
 * altrixs-appt-<appointment id>, so completing the same visit again updates it
 * in Rcopia instead of adding a second one. Unlinked clients are never sent
 * (staging registration stays off, so real charts are not linked there).
 * Never throws: callers complete the appointment regardless of DrFirst.
 */
export async function sendCompletedVisitToRcopia(appointmentId: string, actor: OfficeVisitActor): Promise<OfficeVisitResult> {
  if (DEMO_MODE) return { sent: false, reason: 'not_configured' };
  try {
    const appt = await prisma.appointment.findFirst({
      where: {
        id: appointmentId,
        OR: [{ organizationId: actor.organizationId }, { client: clientOrgFilter(actor.organizationId) }],
      },
      select: {
        id: true, status: true, startsAt: true, clientId: true,
        client: { select: { id: true, rcopiaPatientId: true } },
        clinician: { select: { rcopiaUsername: true } },
      },
    });
    if (!appt) return { sent: false, reason: 'not_found' };
    if (appt.status !== 'COMPLETED') return { sent: false, reason: 'not_completed' };
    if (!appt.client?.rcopiaPatientId) return { sent: false, reason: 'not_linked' };

    const visit = appointmentOfficeVisit({
      appointmentId: appt.id,
      startsAt: appt.startsAt,
      clinicianRcopiaUsername: appt.clinician?.rcopiaUsername ?? null,
    });
    if (!visit) return { sent: false, reason: 'no_date' };

    const patient = appt.client.rcopiaPatientId !== appt.client.id ? { rcopiaId: appt.client.rcopiaPatientId } : { externalId: appt.client.id };
    const res = await sendOfficeVisit(patient, visit, visit.renderingProviderUsername);

    await writeAuditLog({
      action: 'DRFIRST_SEND_OFFICE_VISIT',
      actorUserId: actor.userId,
      actorRole: actor.role,
      organizationId: actor.organizationId,
      resourceType: 'appointment',
      resourceId: appt.id,
      patientId: appt.clientId,
      outcome: res.ok ? 'SUCCESS' : 'FAILURE',
      ipAddress: actor.ipAddress ?? null,
      userAgent: actor.userAgent ?? null,
      metadata: {
        demo: res.demo,
        renderingProvider: Boolean(visit.renderingProviderUsername),
        itemStatus: res.item?.status ?? null,
        errorCode: res.error?.code ?? null,
      },
    });
    if (!res.ok) return { sent: false, reason: 'rejected', error: res.error?.code || res.status };
    return { sent: true, rcopiaVisitId: res.item?.rcopiaId ?? null };
  } catch (err: unknown) {
    console.error('[drfirst-office-visit] error', JSON.stringify({ appointmentId, error: err instanceof Error ? err.name : 'unknown' }));
    return { sent: false, reason: 'rejected', error: 'internal_error' };
  }
}

