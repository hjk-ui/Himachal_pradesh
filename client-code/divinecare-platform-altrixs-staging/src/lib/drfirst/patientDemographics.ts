import type { DemographicPatient } from '@/lib/services/drfirstRcopiaService';
import {
  administrativeSexCode,
  describeGaps,
  drfirstReadiness,
  isPlaceholderPhone,
  normalizeStateCode,
  normalizeUsPhone,
  zipDigits,
  type DemographicGap,
} from '@/lib/clients/demographics';
import { normalizeMiddleInitial } from '@/lib/clients/legalName';

/** Client columns the Rcopia patient is built from (select these). */
export const RCOPIA_PATIENT_SELECT = {
  id: true,
  legalFirstName: true,
  middleInitial: true,
  legalMiddleName: true,
  legalLastName: true,
  nameSuffix: true,
  needsNameReview: true,
  dateOfBirth: true,
  administrativeSex: true,
  gender: true,
  addressLine1: true,
  addressLine2: true,
  addressStatus: true,
  rcopiaPatientId: true,
  location: { select: { city: true, state: true, postalCode: true } },
  city: true,
  state: true,
  postalCode: true,
  phone: true,
  phoneType: true,
  phoneSecondary: true,
  phoneSecondaryType: true,
} as const;

export type RcopiaPatientSource = {
  id: string;
  legalFirstName: string | null;
  middleInitial: string | null;
  legalMiddleName?: string | null;
  legalLastName: string | null;
  nameSuffix?: string | null;
  needsNameReview?: boolean | null;
  dateOfBirth: Date | null;
  administrativeSex?: string | null;
  gender: string | null;
  addressLine1: string | null;
  addressLine2?: string | null;
  /** 'homeless' | 'unknown' (PDUM2) */
  addressStatus?: string | null;
  /** Set when the chart is linked to an Rcopia patient; a value other than the client id = a pre-existing Rcopia patient */
  rcopiaPatientId?: string | null;
  /** The client's clinic; its city / state / ZIP stand in when there is no fixed address (PDUM2) */
  location?: { city: string | null; state: string | null; postalCode: string | null } | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  phone: string | null;
  phoneType?: string | null;
  phoneSecondary?: string | null;
  phoneSecondaryType?: string | null;
};

export type RcopiaPatientBuild =
  | { ok: true; patient: DemographicPatient; warnings: DemographicGap[] }
  | { ok: false; missing: DemographicGap[]; reason: string };

/**
 * Rcopia send_patient demographics from the chart. Uses the structured legal name (never a split of
 * Client.name), the recorded administrative sex (never defaulted), a valid ZIP / state and typed
 * phones. Returns ok:false with the missing items when the chart is not ready for e-prescribing.
 */
export function buildRcopiaPatient(
  c: RcopiaPatientSource,
  now = new Date(),
  /** The practice's primary location, used when the client has no clinic of its own */
  practiceAddress?: { city: string | null; state: string | null; postalCode: string | null } | null,
): RcopiaPatientBuild {
  const readiness = drfirstReadiness(c, now);
  if (!readiness.ready) {
    return {
      ok: false,
      missing: readiness.missing.filter((g) => g.severity === 'required'),
      reason: `Demographics incomplete for e-prescribing: ${describeGaps(readiness.missing)}. Update the client profile, then try again.`,
    };
  }
  // PDUM2: no fixed address -> "HOMELESS" / "UNKNOWN" with the clinic's (else the practice's) city / state / ZIP
  const noFixedAddress = Boolean((c.addressStatus === 'homeless' || c.addressStatus === 'unknown') && !c.addressLine1?.trim());
  const site = [c.location, practiceAddress].find(
    (l) => l && l.city?.trim() && normalizeStateCode(l.state) && zipDigits(l.postalCode),
  );
  if (noFixedAddress && !site) {
    const gap = { field: 'addressStatus', label: 'Clinic address (city, state, ZIP) for a client with no fixed address', severity: 'required' as const };
    return { ok: false, missing: [gap], reason: `Demographics incomplete for e-prescribing: ${gap.label}. Set the clinic location's address, then try again.` };
  }
  const address = noFixedAddress
    ? { addressLine1: c.addressStatus === 'homeless' ? 'HOMELESS' : 'UNKNOWN', city: site!.city!.trim(), state: normalizeStateCode(site!.state)!, zipCode: zipDigits(site!.postalCode)! }
    : { addressLine1: c.addressLine1!.trim(), ...(c.addressLine2?.trim() ? { addressLine2: c.addressLine2.trim() } : {}), city: c.city!.trim(), state: normalizeStateCode(c.state)!, zipCode: zipDigits(c.postalCode)! };

  const phones: Pick<DemographicPatient, 'homePhone' | 'mobilePhone' | 'workPhone'> = {};
  const addPhone = (raw: string | null | undefined, type: string | null | undefined) => {
    const p = normalizeUsPhone(raw);
    // PDUR2: placeholder numbers (all one digit, 555-01xx, N11 codes ...) are never sent
    if (!p || isPlaceholderPhone(p.digits)) return;
    const key = type === 'mobile' ? 'mobilePhone' : type === 'work' ? 'workPhone' : 'homePhone';
    if (!phones[key]) phones[key] = p.digits;
  };
  addPhone(c.phone, c.phoneType);
  addPhone(c.phoneSecondary, c.phoneSecondaryType);

  const middle = (c.legalMiddleName ?? '').trim() || normalizeMiddleInitial(c.middleInitial) || '';
  return {
    ok: true,
    warnings: readiness.missing,
    patient: {
      // A chart linked to a pre-existing Rcopia patient is updated by that patient's RcopiaID (GM1);
      // a chart Altrixs registered carries our client id as its ExternalID (PDUR1)
      ...(linkedRcopiaId(c) ? { externalId: '', rcopiaId: linkedRcopiaId(c)! } : { externalId: c.id }),
      firstName: c.legalFirstName!.trim(),
      // '' when cleared, so send_patient sends an empty <MiddleName/> and Rcopia drops the old one
      middleName: middle,
      lastName: c.legalLastName!.trim(),
      ...(c.nameSuffix?.trim() ? { suffix: c.nameSuffix.trim() } : {}),
      dob: c.dateOfBirth!.toISOString().slice(0, 10),
      gender: administrativeSexCode(c)!,
      ...address,
      ...phones,
    },
  };
}

/** Rcopia id of a chart linked to a pre-existing Rcopia patient (not the client-id placeholder), else null. */
export function linkedRcopiaId(c: { id: string; rcopiaPatientId?: string | null }): string | null {
  const v = c.rcopiaPatientId?.trim();
  return v && v !== c.id ? v : null;
}
