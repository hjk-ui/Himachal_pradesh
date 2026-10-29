import { SYSTEMS, fhirDateTime, fhirId, normalizeIcd10, ref, type FhirResource } from './common';
import { finalize, type MapContext } from './meta';
import type { AppointmentRow, MedicalVisitRow } from './types';

const CLASS_AMB = { system: SYSTEMS.actCode, code: 'AMB', display: 'ambulatory' };
const CLASS_VR = { system: SYSTEMS.actCode, code: 'VR', display: 'virtual' };

export function appointmentEncounterStatus(status: string): string {
  switch (status) {
    case 'SCHEDULED':
      return 'planned';
    case 'CHECKED_IN':
      return 'arrived';
    case 'IN_SESSION':
      return 'in-progress';
    case 'COMPLETED':
      return 'finished';
    case 'CANCELLED':
    case 'LATE_CANCEL':
    case 'NO_SHOW':
      return 'cancelled';
    default:
      return 'unknown';
  }
}

export function appointmentEncounterId(appointmentId: string): string {
  return fhirId('appt', appointmentId);
}

/** Appointment -> Encounter (status follows the appointment; no-shows / late cancels are cancelled). */
export function mapAppointmentEncounter(a: AppointmentRow, ctx: MapContext): FhirResource {
  return finalize(
    {
      resourceType: 'Encounter',
      id: appointmentEncounterId(a.id),
      identifier: [{ system: 'urn:altrixs:appointment', value: a.id }],
      status: appointmentEncounterStatus(a.status),
      class: a.isVirtual ? CLASS_VR : CLASS_AMB,
      type: a.type ? [{ text: a.type }] : undefined,
      subject: ref('Patient', a.clientId),
      participant: a.clinicianId ? [{ individual: ref('Practitioner', a.clinicianId) }] : undefined,
      period: { start: fhirDateTime(a.startsAt), end: fhirDateTime(a.endsAt) },
      serviceProvider: ref('Organization', ctx.organizationId),
    },
    ctx
  );
}

/**
 * MedicalVisit -> Encounter. `reasonCodes` is the visit's ICD-10 list after the Part 2 filter
 * (the builder drops SUD codes when Part 2 sync is off).
 */
export function mapMedicalVisitEncounter(v: MedicalVisitRow, reasonCodes: string[], ctx: MapContext): FhirResource {
  const codes = reasonCodes.map((c) => normalizeIcd10(c)).filter((c): c is string => !!c);
  const status = (v.status || '').toUpperCase();
  return finalize(
    {
      resourceType: 'Encounter',
      id: fhirId('mv', v.id),
      identifier: [{ system: 'urn:altrixs:medical-visit', value: v.id }],
      status: status === 'COMPLETED' || status === 'SIGNED' || v.signedAt ? 'finished' : status === 'CANCELLED' ? 'cancelled' : 'in-progress',
      class: CLASS_AMB,
      type: v.visitType ? [{ text: v.visitType }] : undefined,
      serviceType: v.cptCode ? { coding: [{ system: 'http://www.ama-assn.org/go/cpt', code: v.cptCode }] } : undefined,
      subject: ref('Patient', v.clientId),
      participant: v.providerId ? [{ individual: ref('Practitioner', v.providerId) }] : undefined,
      period: { start: fhirDateTime(v.visitDate) },
      reasonCode: codes.map((code) => ({ coding: [{ system: SYSTEMS.icd10cm, code }] })),
      serviceProvider: ref('Organization', ctx.organizationId),
    },
    ctx
  );
}
