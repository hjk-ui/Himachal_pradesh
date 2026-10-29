import { prisma } from '@/lib/db/prisma';
import { medicalRoomingHref, medicalProviderVisitHref } from '@/lib/medical/deep-link';
import { scheduleChip, type RoomingStatus } from '@/lib/medical/rooming';

export type MaWorklistItem = {
  id: string;
  clientId?: string;
  appointmentId?: string;
  clientName: string;
  status: 'draft' | 'ready' | 'in_room' | 'waiting';
  label: string;
  waitingMinutes?: number;
  href: string;
};

/**
 * MA worklist from MedicalRooming table (not chart-items).
 * Chips: Rooming in progress / Ready for provider · N min / With provider · N min
 */
export async function buildMaWorklist(organizationId: string): Promise<MaWorklistItem[]> {
  const rows = await prisma.medicalRooming
    .findMany({
      where: {
        organizationId,
        status: { in: ['draft', 'ready', 'in_room'] },
      },
      orderBy: { updatedAt: 'desc' },
      take: 100,
      include: {
        client: { select: { id: true, name: true } },
      },
    })
    .catch(() => []);

  const items: MaWorklistItem[] = rows.map((row) => {
    const status = (row.status as RoomingStatus) || 'draft';
    const record = {
      appointmentId: row.appointmentId,
      clientId: row.clientId,
      status,
      identityConfirmed: row.identityConfirmed,
      chiefComplaint: row.chiefComplaint,
      vitals: row.vitals as never,
      allergyReviewed: row.allergyReviewed,
      medicationReviewed: row.medicationReviewed,
      patientReportedMeds: row.patientReportedMeds,
      pharmacyReview: row.pharmacyReview as never,
      screenings: row.screenings as never,
      careGapActions: row.careGapActions as never,
      pocOrderIds: row.pocOrderIds as never,
      readyAt: row.readyAt?.toISOString() ?? null,
      inRoomAt: row.inRoomAt?.toISOString() ?? null,
      updatedAt: row.updatedAt.toISOString(),
      updatedById: row.updatedById,
    };
    const label = scheduleChip(record);
    const waitingMinutes =
      status === 'ready' && row.readyAt
        ? Math.max(0, Math.round((Date.now() - row.readyAt.getTime()) / 60_000))
        : status === 'in_room' && row.inRoomAt
          ? Math.max(0, Math.round((Date.now() - row.inRoomAt.getTime()) / 60_000))
          : Math.max(0, Math.round((Date.now() - row.updatedAt.getTime()) / 60_000));

    const clientName = row.client?.name || 'Patient';
    const href =
      status === 'ready' || status === 'in_room'
        ? medicalProviderVisitHref({
            appointmentId: row.appointmentId,
            clientId: row.clientId,
            clientName,
          })
        : medicalRoomingHref({
            appointmentId: row.appointmentId,
            clientId: row.clientId,
            clientName,
          });

    const itemStatus: MaWorklistItem['status'] =
      status === 'ready' || status === 'in_room' ? status : 'draft';

    return {
      id: row.id,
      clientId: row.clientId,
      appointmentId: row.appointmentId,
      clientName,
      status: itemStatus,
      label,
      waitingMinutes,
      href,
    };
  });

  return items.sort((a, b) => (b.waitingMinutes || 0) - (a.waitingMinutes || 0));
}
