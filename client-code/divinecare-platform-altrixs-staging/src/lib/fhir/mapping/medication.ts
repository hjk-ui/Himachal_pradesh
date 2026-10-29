import {
  SOURCE_DRFIRST,
  SYSTEMS,
  fhirDate,
  fhirDateTime,
  fhirId,
  ref,
  text,
  type FhirResource,
} from './common';
import { finalize, type MapContext } from './meta';
import type { MedicationRow } from './types';

export function medicationStatementStatus(m: Pick<MedicationRow, 'status' | 'active' | 'endDate' | 'stopDate'>): string {
  const s = (m.status || '').trim().toLowerCase();
  if (s === 'entered in error' || s === 'entered-in-error' || s === 'deleted') return 'entered-in-error';
  if (s === 'completed') return 'completed';
  if (s === 'on-hold' || s === 'on hold' || s === 'hold') return 'on-hold';
  if (s === 'stopped' || s === 'discontinued' || s === 'inactive' || !m.active || m.stopDate) return 'stopped';
  return 'active';
}

/** ClientMedication -> MedicationStatement (RxNorm / NDC codings when present, otherwise text only). */
export function mapMedicationStatement(m: MedicationRow, ctx: MapContext): FhirResource {
  const name = text(m.drugName) || text(m.medicationName) || text(m.genericName) || text(m.brandName) || 'Medication';
  const coding: unknown[] = [];
  if (m.rxnormId && /^\d{1,10}$/.test(m.rxnormId.trim())) coding.push({ system: SYSTEMS.rxnorm, code: m.rxnormId.trim(), display: name });
  if (m.ndcCode && /^[\d-]{10,13}$/.test(m.ndcCode.trim())) coding.push({ system: SYSTEMS.ndc, code: m.ndcCode.trim(), display: name });
  const dosageText =
    text(m.dosageText) || [text(m.dosage), text(m.route), text(m.frequency)].filter(Boolean).join(' ') || undefined;
  const fromDrFirst = (m.source || '').toLowerCase() === 'drfirst' || !!m.rcopiaMedId;
  const end = m.stopDate || m.endDate;
  return finalize(
    {
      resourceType: 'MedicationStatement',
      id: fhirId('med', m.id),
      identifier: m.rcopiaMedId ? [{ system: SYSTEMS.rcopiaMedication, value: m.rcopiaMedId }] : undefined,
      status: medicationStatementStatus(m),
      medicationCodeableConcept: { coding, text: name },
      subject: ref('Patient', m.clientId),
      effectivePeriod: { start: fhirDate(m.startDate), end: fhirDate(end) },
      dateAsserted: fhirDateTime(m.createdAt),
      informationSource: m.prescribedById ? ref('Practitioner', m.prescribedById) : undefined,
      reasonCode: m.indication ? [{ text: m.indication.trim() }] : undefined,
      dosage: dosageText || m.asNeeded
        ? [
            {
              text: dosageText,
              asNeededBoolean: m.asNeeded && !m.prnReason ? true : undefined,
              asNeededCodeableConcept: m.asNeeded && m.prnReason ? { text: m.prnReason.trim() } : undefined,
            },
          ]
        : undefined,
    },
    ctx,
    fromDrFirst ? SOURCE_DRFIRST : undefined
  );
}
