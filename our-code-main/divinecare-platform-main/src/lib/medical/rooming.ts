import { prisma } from '@/lib/db/prisma';
import type { Prisma } from '@prisma/client';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';

export type RoomingStatus = 'draft' | 'ready' | 'in_room';

export const PHARMACY_CHANGED_COPY =
  'Update it in DrFirst before the provider prescribes.';

export type RoomingVitals = {
  systolic: number | null;
  diastolic: number | null;
  hr: number | null;
  rr: number | null;
  tempF: number | null;
  spo2: number | null;
  heightIn: number | null;
  weightLb: number | null;
  pain: number | null;
  bpRecheckSystolic: number | null;
  bpRecheckDiastolic: number | null;
  bpRecheckAt: string | null;
};

export type ScreeningStatus = 'due' | 'done' | 'not_applicable' | 'deferred';

export type RoomingRecord = {
  appointmentId: string;
  clientId: string;
  status: RoomingStatus;
  identityConfirmed: boolean;
  chiefComplaint: string;
  vitals: RoomingVitals;
  allergyReviewed: boolean;
  medicationReviewed: boolean;
  patientReportedMeds: string;
  pharmacyReview: 'unchanged' | 'changed' | null;
  screenings: {
    depression: ScreeningStatus;
    tobacco: ScreeningStatus;
    alcohol: ScreeningStatus;
    falls: ScreeningStatus;
    sdoh: ScreeningStatus;
    phq9Item9: number | null;
  };
  careGapActions: Array<{
    gapId: string;
    action: 'reported_elsewhere' | 'outreach';
    note: string;
    at: string;
  }>;
  pocOrderIds: string[];
  readyAt: string | null;
  inRoomAt: string | null;
  updatedAt: string;
  updatedById: string | null;
};

export type VitalFlag = {
  id: string;
  label: string;
  action: 'Notify provider';
};

export function emptyVitals(): RoomingVitals {
  return {
    systolic: null,
    diastolic: null,
    hr: null,
    rr: null,
    tempF: null,
    spo2: null,
    heightIn: null,
    weightLb: null,
    pain: null,
    bpRecheckSystolic: null,
    bpRecheckDiastolic: null,
    bpRecheckAt: null,
  };
}

export function emptyRooming(appointmentId: string, clientId: string): RoomingRecord {
  return {
    appointmentId,
    clientId,
    status: 'draft',
    identityConfirmed: false,
    chiefComplaint: '',
    vitals: emptyVitals(),
    allergyReviewed: false,
    medicationReviewed: false,
    patientReportedMeds: '',
    pharmacyReview: null,
    screenings: {
      depression: 'due',
      tobacco: 'due',
      alcohol: 'due',
      falls: 'due',
      sdoh: 'due',
      phq9Item9: null,
    },
    careGapActions: [],
    pocOrderIds: [],
    readyAt: null,
    inRoomAt: null,
    updatedAt: new Date().toISOString(),
    updatedById: null,
  };
}

export function computeBmi(heightIn: number | null, weightLb: number | null): number | null {
  if (!heightIn || !weightLb || heightIn <= 0 || weightLb <= 0) return null;
  const bmi = (weightLb / (heightIn * heightIn)) * 703;
  return Math.round(bmi * 10) / 10;
}

export function needsBpRecheck(vitals: RoomingVitals): boolean {
  return (
    typeof vitals.systolic === 'number' &&
    typeof vitals.diastolic === 'number' &&
    (vitals.systolic >= 140 || vitals.diastolic >= 90)
  );
}

export function computeVitalFlags(record: RoomingRecord): VitalFlag[] {
  const v = record.vitals;
  const flags: VitalFlag[] = [];
  const bpHigh =
    (typeof v.systolic === 'number' && v.systolic >= 140) ||
    (typeof v.diastolic === 'number' && v.diastolic >= 90) ||
    (typeof v.bpRecheckSystolic === 'number' && v.bpRecheckSystolic >= 140) ||
    (typeof v.bpRecheckDiastolic === 'number' && v.bpRecheckDiastolic >= 90);
  if (bpHigh) flags.push({ id: 'bp', label: 'BP ≥140/90', action: 'Notify provider' });
  if (typeof v.spo2 === 'number' && v.spo2 < 92) {
    flags.push({ id: 'spo2', label: 'SpO2 <92%', action: 'Notify provider' });
  }
  if (typeof v.tempF === 'number' && v.tempF >= 100.4) {
    flags.push({ id: 'temp', label: 'Temp ≥100.4°F', action: 'Notify provider' });
  }
  if (typeof v.hr === 'number' && (v.hr > 100 || v.hr < 50)) {
    flags.push({ id: 'hr', label: 'HR >100 or <50', action: 'Notify provider' });
  }
  if (typeof record.screenings.phq9Item9 === 'number' && record.screenings.phq9Item9 > 0) {
    flags.push({ id: 'phq9_i9', label: 'PHQ-9 item 9 >0', action: 'Notify provider' });
  }
  return flags;
}

export function scheduleChip(record: RoomingRecord, now = Date.now()): string {
  if (record.status === 'in_room') {
    const mins = record.inRoomAt
      ? Math.max(0, Math.round((now - Date.parse(record.inRoomAt)) / 60_000))
      : 0;
    return `With provider · ${mins} min`;
  }
  if (record.status === 'ready') {
    const mins = record.readyAt
      ? Math.max(0, Math.round((now - Date.parse(record.readyAt)) / 60_000))
      : 0;
    return `Ready for provider · ${mins} min waiting`;
  }
  return 'Rooming in progress';
}

function asVitals(raw: unknown): RoomingVitals {
  const base = emptyVitals();
  if (!raw || typeof raw !== 'object') return base;
  return { ...base, ...(raw as Partial<RoomingVitals>) };
}

function asScreenings(raw: unknown): RoomingRecord['screenings'] {
  const base = emptyRooming('', '').screenings;
  if (!raw || typeof raw !== 'object') return base;
  return { ...base, ...(raw as Partial<RoomingRecord['screenings']>) };
}

function asCareGapActions(raw: unknown): RoomingRecord['careGapActions'] {
  return Array.isArray(raw) ? (raw as RoomingRecord['careGapActions']) : [];
}

function asPocIds(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
}

function rowToRecord(row: {
  appointmentId: string;
  clientId: string;
  status: string;
  identityConfirmed: boolean;
  chiefComplaint: string;
  vitals: unknown;
  allergyReviewed: boolean;
  medicationReviewed: boolean;
  patientReportedMeds: string;
  pharmacyReview: string | null;
  screenings: unknown;
  careGapActions: unknown;
  pocOrderIds: unknown;
  readyAt: Date | null;
  inRoomAt: Date | null;
  updatedAt: Date;
  updatedById: string | null;
}): RoomingRecord {
  return {
    appointmentId: row.appointmentId,
    clientId: row.clientId,
    status: (row.status as RoomingStatus) || 'draft',
    identityConfirmed: row.identityConfirmed,
    chiefComplaint: row.chiefComplaint,
    vitals: asVitals(row.vitals),
    allergyReviewed: row.allergyReviewed,
    medicationReviewed: row.medicationReviewed,
    patientReportedMeds: row.patientReportedMeds,
    pharmacyReview:
      row.pharmacyReview === 'unchanged' || row.pharmacyReview === 'changed'
        ? row.pharmacyReview
        : null,
    screenings: asScreenings(row.screenings),
    careGapActions: asCareGapActions(row.careGapActions),
    pocOrderIds: asPocIds(row.pocOrderIds),
    readyAt: row.readyAt?.toISOString() ?? null,
    inRoomAt: row.inRoomAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
    updatedById: row.updatedById,
  };
}

export async function getRooming(
  organizationId: string,
  appointmentId: string
): Promise<RoomingRecord | null> {
  const row = await prisma.medicalRooming.findFirst({
    where: { organizationId, appointmentId },
  });
  return row ? rowToRecord(row) : null;
}

export type RoomingPatch = Partial<
  Omit<RoomingRecord, 'vitals' | 'screenings' | 'careGapActions'>
> & {
  vitals?: Partial<RoomingVitals>;
  screenings?: Partial<RoomingRecord['screenings']>;
  careGapActions?: RoomingRecord['careGapActions'];
};

export async function upsertRooming(
  organizationId: string,
  appointmentId: string,
  clientId: string,
  patch: RoomingPatch,
  actorUserId: string,
  transition?: 'save' | 'ready' | 'in_room'
): Promise<RoomingRecord> {
  const existing = await getRooming(organizationId, appointmentId);
  const base = existing || emptyRooming(appointmentId, clientId);
  let next: RoomingRecord = {
    ...base,
    ...patch,
    appointmentId,
    clientId: patch.clientId || base.clientId || clientId,
    vitals: { ...base.vitals, ...(patch.vitals || {}) },
    screenings: { ...base.screenings, ...(patch.screenings || {}) },
  };

  if (transition === 'ready') {
    next.status = 'ready';
    next.readyAt = next.readyAt || new Date().toISOString();
  } else if (transition === 'in_room') {
    next.status = 'in_room';
    next.inRoomAt = next.inRoomAt || new Date().toISOString();
  }

  const data = {
    organizationId,
    appointmentId,
    clientId: next.clientId,
    status: next.status,
    identityConfirmed: next.identityConfirmed,
    chiefComplaint: next.chiefComplaint,
    vitals: next.vitals as Prisma.InputJsonValue,
    allergyReviewed: next.allergyReviewed,
    medicationReviewed: next.medicationReviewed,
    patientReportedMeds: next.patientReportedMeds,
    pharmacyReview: next.pharmacyReview,
    screenings: next.screenings as Prisma.InputJsonValue,
    careGapActions: next.careGapActions as Prisma.InputJsonValue,
    pocOrderIds: next.pocOrderIds as Prisma.InputJsonValue,
    readyAt: next.readyAt ? new Date(next.readyAt) : null,
    inRoomAt: next.inRoomAt ? new Date(next.inRoomAt) : null,
    updatedById: actorUserId,
  };

  const row = await prisma.medicalRooming.upsert({
    where: { appointmentId },
    create: data,
    update: {
      ...data,
      // Never allow clientId swap on an existing appointment rooming (no cross-patient overwrite)
      clientId: undefined,
    },
  });

  if (transition === 'ready' || transition === 'in_room') {
    await writeAuditLog({
      action: transition === 'ready' ? 'medical.rooming.ready' : 'medical.rooming.in_room',
      actorUserId: actorUserId,
      organizationId,
      resourceType: 'appointment',
      resourceId: appointmentId,
      metadata: { clientId: row.clientId, status: row.status },
    });
  }

  return rowToRecord(row);
}

/** Opening a visit when rooming is ready → auto in_room */
export async function openVisitSetsInRoom(
  organizationId: string,
  appointmentId: string,
  actorUserId: string
): Promise<RoomingRecord | null> {
  const current = await getRooming(organizationId, appointmentId);
  if (!current) return null;
  if (current.status !== 'ready') return current;
  return upsertRooming(
    organizationId,
    appointmentId,
    current.clientId,
    {},
    actorUserId,
    'in_room'
  );
}

export const ROOMING_ROLES = new Set(['MEDICAL_ASSISTANT', 'PHYSICIAN', 'MEDICAL_NP']);
