/**
 * Comprehensive Valant Ingestion Audit, Reconciliation & Repair Logic
 *
 * Core Tenets:
 * 1. Deterministic matching by verified source identifiers (never array position).
 * 2. Strict 1-to-1 appointment matching; quarantine ambiguous/duplicate records.
 * 3. Validation of all 4 CSV row widths and duplicate headers by position.
 * 4. Optimistic concurrency control via audited updatedAt.
 * 5. Source verification for COPAY-*, email aliases, and guessed payers.
 * 6. Never convert missing/invalid copay to zero.
 * 7. Do not clear legitimate Self-Pay or real payers based on text alone.
 * 8. Strict TreatmentTeam typing; preserve existing JSON slots; handle Prisma.DbNull.
 * 9. America/New_York timezone validation with DST nonexistent/ambiguous detection.
 * 10. Zero PHI in all outputs.
 */

import * as fs from 'fs';
import { execSync } from 'child_process';
import { Prisma } from '@prisma/client';

export const ORIGINAL_IMPORT_TIMEZONE = 'Asia/Kolkata'; // UTC+05:30 (initial import execution environment)
export const CLINIC_TIMEZONE = 'America/New_York';

export interface ParsedAppointmentTime {
  start: Date;
  end: Date;
  durationMinutes: number;
}

/**
 * Computes the legacy local-start ISO string that was saved during the initial import.
 * Explicitly converts from ORIGINAL_IMPORT_TIMEZONE (Asia/Kolkata, UTC+05:30) to UTC,
 * making timestamp matching 100% independent of whether Node is running on Windows,
 * Ubuntu, local time, or UTC.
 */
export function computeLegacyLocalStart(dateStr: string, timeRangeStr: string): string | null {
  const m = timeRangeStr.trim().match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return null;

  const [, sHStr, sMStr, eHStr, , merRaw] = m;
  const sH = parseInt(sHStr, 10);
  const sM = parseInt(sMStr, 10);
  const eH = parseInt(eHStr, 10);
  const mer = (merRaw || '').toUpperCase();

  let startHours = sH;
  if (mer === 'PM') {
    if ((sH > eH || eH === 12) && sH >= 6 && sH < 12) {
      startHours = sH;
    } else if (sH < 12) {
      startHours += 12;
    }
  } else {
    if (sH === 12) startHours = 0;
  }

  let year: number;
  let month: number;
  let day: number;

  const cleanDate = dateStr.trim();
  const dateParts = cleanDate.split('/');
  if (dateParts.length === 3) {
    month = parseInt(dateParts[0], 10);
    day = parseInt(dateParts[1], 10);
    year = parseInt(dateParts[2].split(' ')[0], 10);
    if (year < 100) year += year < 30 ? 2000 : 1900;
  } else {
    const d = new Date(cleanDate);
    if (isNaN(d.getTime())) return null;
    year = d.getFullYear();
    month = d.getMonth() + 1;
    day = d.getDate();
  }

  // Explicit calculation for Asia/Kolkata (+05:30 fixed offset without DST)
  // Date.UTC(year, month - 1, day, startHours - 5, sM - 30)
  // Completely deterministic and independent of the host OS local timezone
  const utcDate = new Date(Date.UTC(year, month - 1, day, startHours - 5, sM - 30, 0));
  return utcDate.toISOString();
}

/**
 * Validates whether a wall-clock date and time exists unambiguously in the clinic timezone.
 * Rejects:
 * 1. Invalid calendar dates
 * 2. Nonexistent times during DST spring forward (e.g. 2:30 AM on spring-forward Sunday)
 * 3. Ambiguous times during DST fall back (e.g. 1:30 AM occurring twice without offset)
 */
export function isValidWallClockTime(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string = CLINIC_TIMEZONE
): boolean {
  if (timeZone !== CLINIC_TIMEZONE) {
    throw new Error(`Invalid clinic timezone: ${timeZone}. Expected ${CLINIC_TIMEZONE}.`);
  }
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return false;
  }

  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  });

  const formatMatches = (utcMs: number): boolean => {
    const parts = dtf.formatToParts(new Date(utcMs));
    const getPart = (type: string) => parseInt(parts.find((p) => p.type === type)!.value, 10);
    let nyH = getPart('hour');
    if (nyH === 24) nyH = 0;
    return (
      getPart('year') === year &&
      getPart('month') === month &&
      getPart('day') === day &&
      nyH === hour &&
      getPart('minute') === minute
    );
  };

  // Test across offsets in Eastern Time (EDT is UTC-4, EST is UTC-5)
  const matches: number[] = [];
  for (let offset = 4; offset <= 5; offset += 0.5) {
    const candidateUtcMs = Date.UTC(year, month - 1, day, hour + offset, minute, 0);
    if (formatMatches(candidateUtcMs) && !matches.includes(candidateUtcMs)) {
      matches.push(candidateUtcMs);
    }
  }

  // If 0 matches: nonexistent wall-clock time (e.g. DST spring-forward)
  // If > 1 match: ambiguous wall-clock time (e.g. DST fall-back repeat)
  // Exactly 1 match is required for valid, unambiguous wall-clock time
  return matches.length === 1;
}

/**
 * Validates appointment dates, times, duration, midnight/noon, and DST ambiguous/nonexistent times
 * in America/New_York and converts to exact UTC Date.
 */
export function parseEasternDateTime(
  dateStr: string,
  timeRangeStr: string,
  timeZone: string = CLINIC_TIMEZONE
): ParsedAppointmentTime | null {
  if (!dateStr || !timeRangeStr) return null;
  if (timeZone !== CLINIC_TIMEZONE) {
    throw new Error(`Clinic timezone must be ${CLINIC_TIMEZONE}`);
  }

  let year: number;
  let month: number;
  let day: number;

  const cleanDate = dateStr.trim();
  const dateParts = cleanDate.split('/');
  if (dateParts.length === 3) {
    month = parseInt(dateParts[0], 10);
    day = parseInt(dateParts[1], 10);
    year = parseInt(dateParts[2].split(' ')[0], 10);
    if (year < 100) year += year < 30 ? 2000 : 1900;
  } else {
    const d = new Date(cleanDate);
    if (isNaN(d.getTime())) return null;
    year = d.getFullYear();
    month = d.getMonth() + 1;
    day = d.getDate();
  }

  const m = timeRangeStr.trim().match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return null;

  let [, sHStr, sMStr, eHStr, eMStr, mer] = m;
  let sH = parseInt(sHStr, 10);
  const sM = parseInt(sMStr, 10);
  let eH = parseInt(eHStr, 10);
  const eM = parseInt(eMStr, 10);
  mer = mer.toUpperCase();

  let startHours = sH;
  let endHours = eH;

  // Midnight / Noon handling:
  // "12:00 AM" -> hour 0
  // "12:00 PM" -> hour 12
  if (mer === 'PM') {
    if (eH < 12) endHours += 12;
    // Cross-noon (e.g. 10:00 AM - 1:00 PM, 11:00 AM - 12:00 PM, or 11:30 AM - 12:30 PM)
    if ((sH > eH || eH === 12) && sH >= 6 && sH < 12) {
      startHours = sH; // morning start
    } else if (sH < 12) {
      startHours += 12; // afternoon start
    }
  } else {
    // AM
    if (sH === 12) startHours = 0; // midnight
    if (eH === 12) endHours = 0;
  }

  // Duration in minutes
  const startTotalMinutes = startHours * 60 + sM;
  const endTotalMinutes = endHours * 60 + eM;
  const durationMinutes = endTotalMinutes - startTotalMinutes;

  // Duration must be positive and reasonable (<= 12 hours)
  if (durationMinutes <= 0 || durationMinutes > 720) {
    return null;
  }

  // Validate DST spring forward non-existent time
  if (!isValidWallClockTime(year, month, day, startHours, sM, timeZone)) {
    return null; // Nonexistent wall-clock time
  }
  if (!isValidWallClockTime(year, month, day, endHours, eM, timeZone)) {
    return null;
  }

  function wallClockToUtc(y: number, mo: number, d: number, hr: number, min: number): Date {
    const guessUtc = new Date(Date.UTC(y, mo - 1, d, hr + 5, min, 0));
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });

    const parts = dtf.formatToParts(guessUtc);
    const getPart = (type: string) => parseInt(parts.find((p) => p.type === type)!.value, 10);
    const nyY = getPart('year');
    const nyM = getPart('month');
    const nyD = getPart('day');
    let nyH = getPart('hour');
    if (nyH === 24) nyH = 0;
    const nyMin = getPart('minute');

    const diffHours = (y - nyY) * 365 * 24 + (mo - nyM) * 30 * 24 + (d - nyD) * 24 + (hr - nyH);
    const diffMins = diffHours * 60 + (min - nyMin);

    return new Date(guessUtc.getTime() + diffMins * 60 * 1000);
  }

  const start = wallClockToUtc(year, month, day, startHours, sM);
  const end = wallClockToUtc(year, month, day, endHours, eM);

  return { start, end, durationMinutes };
}

/**
 * Standardizes phone to E.164 (+1XXXXXXXXXX) format
 */
export function standardizePhone(raw: unknown): string | null {
  if (!raw) return null;
  const str = String(raw).trim();
  if (!str) return null;
  const cleaned = str.replace(/[^\d+]/g, '');
  if (cleaned.startsWith('+')) {
    const digits = cleaned.replace(/\D/g, '');
    return digits.length >= 10 ? `+${digits}` : null;
  }
  const digits = cleaned.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.length > 10) return `+${digits}`;
  return null;
}

/**
 * Parses numeric copay from raw string (e.g. "20.0000", "$15.50").
 * CRITICAL: NEVER converts invalid or missing copay to zero!
 * Returns null if missing, empty, or unparseable. Returns number only if legitimate.
 */
export function parseCopayAmount(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const str = String(raw).replace(/[$,\s]/g, '').trim();
  if (!str) return null;
  const num = parseFloat(str);
  if (isNaN(num) || num < 0) return null;
  return Math.round(num * 100) / 100;
}

/**
 * Verifies whether the email stored in DB was an artificial alias generated by the import script:
 * alias = rawEmail.replace('@', '+' + cleanPtId + '@')
 */
export function isGeneratedEmailAlias(
  dbEmail: string | null | undefined,
  rawSourceEmail: string | null | undefined,
  mrn: string | null | undefined
): boolean {
  if (!dbEmail || !rawSourceEmail || !mrn) return false;
  if (!dbEmail.includes('@') || !rawSourceEmail.includes('@')) return false;

  const cleanMrn = mrn.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!cleanMrn) return false;

  const [rawLocal, rawDomain] = rawSourceEmail.trim().toLowerCase().split('@');
  const expectedAlias = `${rawLocal}+${cleanMrn}@${rawDomain}`;
  // Must match expected alias AND must not be identical to authentic source email!
  return (
    dbEmail.trim().toLowerCase() === expectedAlias &&
    dbEmail.trim().toLowerCase() !== rawSourceEmail.trim().toLowerCase()
  );
}

/**
 * Verifies whether the insurancePayer in DB was an invented/guessed replacement value
 * based on the actual source row columns.
 * CRITICAL: Does NOT clear legitimate Self-Pay or real payers based only on text.
 */
export function isGeneratedPayer(
  dbPayer: string | null | undefined,
  assignedFacName: string | null | undefined,
  ins1City: string | null | undefined
): boolean {
  if (!dbPayer) return false;
  const p = dbPayer.trim();

  // Never clear legitimate 'Self-Pay' based on text alone
  if (p.toLowerCase() === 'self-pay' && (!assignedFacName || assignedFacName.toLowerCase() !== 'self-pay')) {
    return false;
  }

  // 1. Check if it matches "Commercial (" + City + ")" generated from Pt. Ins1 Address (City)
  // If ins1City was flagged as COLLISION_CONFLICT, do NOT clear based on city!
  if (ins1City && ins1City.trim() && ins1City !== 'COLLISION_CONFLICT') {
    const expectedCommercialCity = `Commercial (${ins1City.trim()})`;
    if (p.toLowerCase() === expectedCommercialCity.toLowerCase()) {
      return true;
    }
  }

  // 2. Check if it matches the facility name from Assigned Fac Name (e.g. "MD Behavioral Health")
  if (assignedFacName && assignedFacName.trim()) {
    if (p.toLowerCase() === assignedFacName.trim().toLowerCase()) {
      return true;
    }
  }

  return false;
}

export interface AppointmentRowClassification {
  isNonPatient: boolean;
  mrn: string | null;
  clientName: string | null;
  isAmbiguous: boolean;
  rawText: string;
}

/**
 * Separates genuine NON-PATIENT blocks from patient appointments.
 * Requires parenthesized MRN for patient appointments; flags ambiguous format.
 * Treats blank patient text as ambiguous, NOT NON-PATIENT.
 */
export function classifyAppointmentRow(rawPatientText: string | undefined): AppointmentRowClassification {
  const raw = (rawPatientText || '').trim();
  // Blank text is ambiguous, NOT NON-PATIENT
  if (!raw) {
    return {
      isNonPatient: false,
      mrn: null,
      clientName: null,
      isAmbiguous: true,
      rawText: raw,
    };
  }
  // Only exact 'NON-PATIENT' represents supervisory non-patient block
  if (raw === 'NON-PATIENT') {
    return {
      isNonPatient: true,
      mrn: null,
      clientName: 'NON-PATIENT',
      isAmbiguous: false,
      rawText: raw,
    };
  }

  const parenMatch = raw.match(/\(([A-Z0-9\s-]+)\)$/i);
  if (parenMatch) {
    const mrn = parenMatch[1].trim();
    const cleanName = raw.replace(/\s*\([A-Z0-9\s-]+\)$/i, '').trim();
    return {
      isNonPatient: false,
      mrn,
      clientName: cleanName || null,
      isAmbiguous: false,
      rawText: raw,
    };
  }

  return {
    isNonPatient: false,
    mrn: null,
    clientName: raw,
    isAmbiguous: true,
    rawText: raw,
  };
}

export interface ClientFieldDiff {
  clientId: string;
  mrn: string;
  auditedUpdatedAt: string; // ISO string for optimistic concurrency check
  before: {
    insuranceMemberId: string | null;
    insurancePayer: string | null;
    email: string | null;
    phone: string | null;
    emergencyContactPhone: string | null;
    treatmentTeam: any;
  };
  after: {
    insuranceMemberId: string | null;
    insurancePayer: string | null;
    email: string | null;
    phone: string | null;
    emergencyContactPhone: string | null;
    treatmentTeam: any;
  };
  changedFields: string[];
  reasons: string[];
}

/**
 * Calculates audited repairs for a Client record based on verified source CSV columns.
 * Enforces optimistic concurrency guard and source verification.
 */
export function calculateClientRepair(
  client: {
    id: string;
    mrn: string | null;
    insuranceMemberId: string | null;
    insurancePayer: string | null;
    email: string | null;
    phone: string | null;
    emergencyContactPhone: string | null;
    treatmentTeam: any;
    updatedAt: Date;
    createdAt: Date;
  },
  sourceData: {
    ptPhone2: string | null;
    emergencyPhone: string | null;
    copay: string | null;
    rawEmail: string | null;
    assignedFacName?: string | null;
    ins1City?: string | null;
  },
  options: {
    cutoffDate?: Date;
    forceOverwriteEdits?: boolean;
  } = {}
): { diff: ClientFieldDiff | null; manualEditSkipped: boolean } {
  const mrn = client.mrn || '';
  const reasons: string[] = [];
  const changedFields: string[] = [];

  // Manual edit protection
  const cutoff = options.cutoffDate || new Date('2026-10-13T12:15:00Z');
  if (!options.forceOverwriteEdits && client.updatedAt > cutoff) {
    return { diff: null, manualEditSkipped: true };
  }

  const before = {
    insuranceMemberId: client.insuranceMemberId,
    insurancePayer: client.insurancePayer,
    email: client.email,
    phone: client.phone,
    emergencyContactPhone: client.emergencyContactPhone,
    treatmentTeam: client.treatmentTeam,
  };

  const after = { ...before };

  // 1. Fix COPAY-* in insuranceMemberId (verified against source copay)
  if (client.insuranceMemberId && client.insuranceMemberId.startsWith('COPAY-')) {
    const rawCopayInDb = client.insuranceMemberId.replace(/^COPAY-/, '').trim();
    const sourceCopay = (sourceData.copay || '').trim();

    const parsedDbCopay = parseCopayAmount(rawCopayInDb);
    const parsedSrcCopay = sourceCopay ? parseCopayAmount(sourceCopay) : null;

    // Check for conflicting evidence
    const hasConflict = parsedDbCopay !== null && parsedSrcCopay !== null && parsedDbCopay !== parsedSrcCopay;
    if (hasConflict) {
      reasons.push(`Quarantined conflicting copay evidence: DB has ${rawCopayInDb}, source has ${sourceCopay}`);
    } else {
      after.insuranceMemberId = null;
      changedFields.push('insuranceMemberId');
      reasons.push('Cleared COPAY-* from insuranceMemberId');

      // Store in treatmentTeam ONLY if copay is valid (never convert missing/invalid copay to zero)
      const parsedCopay = parsedSrcCopay !== null ? parsedSrcCopay : parsedDbCopay;
      if (parsedCopay !== null) {
        if (client.treatmentTeam === null || client.treatmentTeam === undefined) {
          after.treatmentTeam = {
            copay: {
              amount: parsedCopay,
              unit: 'USD',
            },
          };
          changedFields.push('treatmentTeam');
          reasons.push(`Preserved source copay ($${parsedCopay} USD) in treatmentTeam.copay`);
        } else if (typeof client.treatmentTeam === 'object' && !Array.isArray(client.treatmentTeam)) {
          // Object: preserve all existing fields and attach/update copay
          after.treatmentTeam = {
            ...client.treatmentTeam,
            copay: {
              amount: parsedCopay,
              unit: 'USD',
            },
          };
          changedFields.push('treatmentTeam');
          reasons.push(`Preserved source copay ($${parsedCopay} USD) in treatmentTeam.copay`);
        } else {
          // Array or unsupported structure (primitive string/number/boolean):
          // Quarantine! Do NOT replace or destroy existing array/unsupported structure!
          reasons.push('Quarantined treatmentTeam copay update: existing treatmentTeam has array or unsupported structure');
        }
      }
    }
  }

  // 2. Fix emergency contact phone copied into patient phone
  const stdPhone2 = standardizePhone(sourceData.ptPhone2);
  const stdEmergency = standardizePhone(sourceData.emergencyPhone);
  if (!stdPhone2 && client.phone && stdEmergency && client.phone === stdEmergency) {
    after.phone = null;
    changedFields.push('phone');
    reasons.push('Cleared patient phone which was copied from emergency contact phone');
  }

  // 3. Fix generated email alias (verified against raw source email + cleanMrn)
  if (client.email && isGeneratedEmailAlias(client.email, sourceData.rawEmail, mrn)) {
    after.email = null;
    changedFields.push('email');
    reasons.push('Removed artificial email alias (+mrn) generated for shared family email');
  }

  // 4. Fix guessed insurance payer (verified against source facility and city columns)
  if (isGeneratedPayer(client.insurancePayer, sourceData.assignedFacName, sourceData.ins1City)) {
    after.insurancePayer = null;
    changedFields.push('insurancePayer');
    reasons.push('Reverted guessed insurance payer to null');
  }

  if (changedFields.length === 0) {
    return { diff: null, manualEditSkipped: false };
  }

  return {
    diff: {
      clientId: client.id,
      mrn,
      auditedUpdatedAt: client.updatedAt.toISOString(),
      before,
      after,
      changedFields,
      reasons,
    },
    manualEditSkipped: false,
  };
}

export type AppointmentMatchStatus = 'EXACT_ONE' | 'AMBIGUOUS_DUPLICATE' | 'UNMATCHED';

export interface AppointmentMatchResult {
  status: AppointmentMatchStatus;
  matchedDbAppointmentId: string | null;
  candidateCount: number;
}

/**
 * Deterministically matches an appointment CSV row against database appointments
 * using organization, client ID / MRN, provider, duration, and source timestamp.
 * Requires EXACTLY ONE match. Quarantines ambiguous or unmatched records.
 */
export function matchAppointmentDeterministic(
  sourceRecord: {
    mrn: string;
    isNonPatient: boolean;
    providerName: string;
    targetUtcTime: ParsedAppointmentTime;
    expectedNotes: string;
    oldLocalStartIso: string;
  },
  dbCandidates: Array<{
    id: string;
    clientId: string;
    clinicianName: string | null;
    type: string;
    startsAt: Date;
    endsAt: Date;
    notes: string | null;
    clientMrn: string | null;
  }>
): AppointmentMatchResult {
  const normProv = (sourceRecord.providerName || '').trim().toLowerCase();

  const matches = dbCandidates.filter((cand) => {
    // 1. Client / MRN match
    if (sourceRecord.isNonPatient) {
      if (cand.type !== 'SUPERVISORY_BLOCK') return false;
    } else {
      if ((cand.clientMrn || '').trim().toLowerCase() !== sourceRecord.mrn.trim().toLowerCase()) {
        return false;
      }
    }

    // 2. Provider match
    const candProv = (cand.clinicianName || '').trim().toLowerCase();
    if (candProv && normProv && candProv !== normProv) {
      return false;
    }

    // 3. Duration match
    const candDurationMins = Math.round((cand.endsAt.getTime() - cand.startsAt.getTime()) / 60000);
    if (candDurationMins !== sourceRecord.targetUtcTime.durationMinutes) {
      return false;
    }

    // 4. StartsAt match against the stored timestamp signature
    if (cand.startsAt.toISOString() !== sourceRecord.oldLocalStartIso) {
      return false;
    }

    // 5. Notes match (if both present, check normalized match)
    if (sourceRecord.expectedNotes && cand.notes) {
      if (cand.notes.trim().toLowerCase() !== sourceRecord.expectedNotes.trim().toLowerCase()) {
        return false;
      }
    }

    return true;
  });

  if (matches.length === 1) {
    return {
      status: 'EXACT_ONE',
      matchedDbAppointmentId: matches[0].id,
      candidateCount: 1,
    };
  }

  if (matches.length > 1) {
    return {
      status: 'AMBIGUOUS_DUPLICATE',
      matchedDbAppointmentId: null,
      candidateCount: matches.length,
    };
  }

  return {
    status: 'UNMATCHED',
    matchedDbAppointmentId: null,
    candidateCount: 0,
  };
}

/**
 * Validates source patient rows for column width, non-empty Pt. ID, and duplicate Pt. IDs.
 * Fails closed on any inconsistency.
 */
export function reconcileSourcePatientRows(
  rows: string[][],
  expectedCols: number = 33
): { validIds: Set<string>; error?: string } {
  const seen = new Set<string>();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (r.length !== expectedCols) {
      return { validIds: seen, error: `Row ${i} has invalid column count (${r.length} != ${expectedCols})` };
    }
    const ptId = (r[11] || '').trim();
    if (!ptId) {
      return { validIds: seen, error: `Row ${i} is missing Pt. ID` };
    }
    if (seen.has(ptId)) {
      return { validIds: seen, error: `Duplicate source Pt. ID "${ptId}" detected at row ${i}` };
    }
    seen.add(ptId);
  }
  return { validIds: seen };
}

/**
 * Verifies that all parsed source Pt. IDs exist in the verified database client set.
 * Fails closed if any source patient is unlinked.
 */
export function verifySourcePatientsLinked(
  sourcePtIds: Set<string>,
  dbMrnSet: Set<string>
): { unlinkedCount: number; error?: string } {
  let unlinkedCount = 0;
  for (const ptId of sourcePtIds) {
    if (!dbMrnSet.has(ptId)) {
      unlinkedCount++;
    }
  }
  if (unlinkedCount > 0) {
    return {
      unlinkedCount,
      error: `Reconciliation failure: ${unlinkedCount} source Pt. IDs do not exist in database`,
    };
  }
  return { unlinkedCount: 0 };
}

export interface RollbackActionPlan {
  shouldRestore: boolean;
  restoreData?: Record<string, any>;
  skipReason?: string;
}

/**
 * Plans rollback for a client record.
 * Protects against overwriting subsequent manual edits unless forced.
 */
export function planClientRollback(
  item: ClientFieldDiff,
  currentState: {
    insuranceMemberId: string | null;
    insurancePayer: string | null;
    email: string | null;
    phone: string | null;
    treatmentTeam?: any;
  },
  options: { forceOverwriteEdits?: boolean } = {}
): RollbackActionPlan {
  const isTreatmentTeamEqual = (a: any, b: any): boolean => {
    const deepEqual = (x: any, y: any): boolean => {
      if (x === y) return true;
      if (x === null || y === null || x === undefined || y === undefined) return x === y;
      if (typeof x !== 'object' || typeof y !== 'object') return x === y;
      if (Array.isArray(x) !== Array.isArray(y)) return false;
      if (Array.isArray(x)) {
        if (x.length !== y.length) return false;
        for (let i = 0; i < x.length; i++) {
          if (!deepEqual(x[i], y[i])) return false;
        }
        return true;
      }
      const keysX = Object.keys(x);
      const keysY = Object.keys(y);
      if (keysX.length !== keysY.length) return false;
      for (const key of keysX) {
        if (!Object.prototype.hasOwnProperty.call(y, key)) return false;
        if (!deepEqual(x[key], y[key])) return false;
      }
      return true;
    };
    return deepEqual(a, b);
  };

  // 1. Check if record is still in its original 'before' state (never updated or already restored)
  const isAlreadyInBeforeState =
    (!item.changedFields.includes('insuranceMemberId') || currentState.insuranceMemberId === item.before.insuranceMemberId) &&
    (!item.changedFields.includes('insurancePayer') || currentState.insurancePayer === item.before.insurancePayer) &&
    (!item.changedFields.includes('phone') || currentState.phone === item.before.phone) &&
    (!item.changedFields.includes('email') || currentState.email === item.before.email) &&
    (!item.changedFields.includes('treatmentTeam') || isTreatmentTeamEqual(currentState.treatmentTeam, item.before.treatmentTeam));

  if (isAlreadyInBeforeState) {
    return {
      shouldRestore: false,
      skipReason: 'ALREADY_IN_BEFORE_STATE',
    };
  }

  // 2. Check if current state matches the expected 'after' state (successfully applied repair)
  const isExpectedAfterState =
    (!item.changedFields.includes('insuranceMemberId') || currentState.insuranceMemberId === item.after.insuranceMemberId) &&
    (!item.changedFields.includes('insurancePayer') || currentState.insurancePayer === item.after.insurancePayer) &&
    (!item.changedFields.includes('phone') || currentState.phone === item.after.phone) &&
    (!item.changedFields.includes('email') || currentState.email === item.after.email) &&
    (!item.changedFields.includes('treatmentTeam') || isTreatmentTeamEqual(currentState.treatmentTeam, item.after.treatmentTeam));

  // If it matches neither 'before' nor 'after', it was modified by a human/external process
  if (!isExpectedAfterState && !options.forceOverwriteEdits) {
    return {
      shouldRestore: false,
      skipReason: 'MANUAL_EDIT_PROTECTED',
    };
  }

  const restoreData: Record<string, any> = {};
  if (item.changedFields.includes('insuranceMemberId')) restoreData.insuranceMemberId = item.before.insuranceMemberId;
  if (item.changedFields.includes('insurancePayer')) restoreData.insurancePayer = item.before.insurancePayer;
  if (item.changedFields.includes('email')) restoreData.email = item.before.email;
  if (item.changedFields.includes('phone')) restoreData.phone = item.before.phone;
  if (item.changedFields.includes('treatmentTeam')) {
    restoreData.treatmentTeam = item.before.treatmentTeam === null ? Prisma.DbNull : item.before.treatmentTeam;
  }

  return {
    shouldRestore: true,
    restoreData,
  };
}

/**
 * Evaluates rollback targets across planned repairs.
 * To ensure batches committed before their journal write was completed are never missed,
 * all planned operations are safely evaluated against before/after database state.
 */
export function filterRollbackTargets<T>(
  allRepairs: T[],
  _committedIds?: string[]
): T[] {
  return allRepairs;
}

export interface AppointmentRepairRecord {
  appointmentId: string;
  clientId: string;
  auditedUpdatedAt: string;
  before: { startsAt: string; endsAt: string };
  after: { startsAt: string; endsAt: string };
}

/**
 * Enforces strict restricted ACLs on Windows (stripping inherited AND preexisting explicit ACEs)
 * or mode 0600 (0700 for directories) on POSIX.
 * Actively queries and verifies the resulting ACL/mode; does not merely rely on utility exit code.
 * Must throw on failure to prevent any database write from running without verifiable privacy.
 */
export function secureFilePermissions(targetPath: string): void {
  if (!fs.existsSync(targetPath)) {
    throw new Error(`CRITICAL: Cannot secure permissions on non-existent path: "${targetPath}". Aborting before DB writes.`);
  }

  const isDir = fs.statSync(targetPath).isDirectory();

  if (process.platform === 'win32') {
    const username = process.env.USERNAME || process.env.USER;
    if (!username) {
      throw new Error(`CRITICAL: Unable to resolve Windows USERNAME for security ACLs on "${targetPath}". Aborting before DB writes.`);
    }

    const cleanPath = targetPath.replace(/'/g, "''");
    // PowerShell script to disable inheritance and strip inherited ACEs ($true, $false),
    // and replace all explicit rules with an exclusive rule for the authorized user only.
    const psSetupScript = `
      $ErrorActionPreference = 'Stop';
      $p = '${cleanPath}';
      $currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent();
      $item = Get-Item -LiteralPath $p;
      $isDir = $item.PSIsContainer;
      $acl = $item.GetAccessControl([System.Security.AccessControl.AccessControlSections]::Access);
      $acl.SetAccessRuleProtection($true, $false);
      $existingRules = @($acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]));
      foreach ($r in $existingRules) {
        [void]$acl.RemoveAccessRuleSpecific($r);
      }
      $rights = if ($isDir) { [System.Security.AccessControl.FileSystemRights]'FullControl' } else { [System.Security.AccessControl.FileSystemRights]'Read,Write,Delete' };
      $inheritance = if ($isDir) { [System.Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit' } else { [System.Security.AccessControl.InheritanceFlags]'None' };
      $prop = [System.Security.AccessControl.PropagationFlags]'None';
      $type = [System.Security.AccessControl.AccessControlType]'Allow';
      $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($currentUser.User, $rights, $inheritance, $prop, $type);
      $acl.AddAccessRule($rule);
      $item.SetAccessControl($acl);
    `.replace(/\n/g, ' ');

    try {
      execSync(`powershell -NoProfile -NonInteractive -Command "${psSetupScript}"`, { stdio: 'pipe' });
    } catch (err: any) {
      throw new Error(`CRITICAL: Windows strict ACL setup failed on "${targetPath}": ${err.message}. Aborting before DB writes.`);
    }

    // ACTIVE VERIFICATION: Inspect actual DACL entries by SID against explicit allowlist.
    // Fails closed if any unauthorized SID exists or if directory traversal rights are missing.
    const psVerifyScript = `
      $ErrorActionPreference = 'Stop';
      $p = '${cleanPath}';
      $currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent();
      $userSid = $currentUser.User.Value;
      $isDir = (Get-Item -LiteralPath $p).PSIsContainer;
      $acl = Get-Acl -LiteralPath $p;
      $allowedSids = @($userSid);

      if ($acl.Access.Count -eq 0) {
        throw 'ACL verification failed: zero access entries found';
      }

      $foundUser = $false;
      foreach ($rule in $acl.Access) {
        if ($rule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow) {
          $msg = 'ACL verification failed: unexpected access control type ' + $rule.AccessControlType;
          throw $msg;
        }
        $ruleSid = $rule.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value;
        if ($allowedSids -notcontains $ruleSid) {
          $msg = 'ACL verification failed: unauthorized SID detected: ' + $ruleSid;
          throw $msg;
        }
        if ($ruleSid -eq $userSid) {
          $foundUser = $true;
          if ($isDir) {
            $traverseMask = [System.Security.AccessControl.FileSystemRights]::Traverse;
            if (($rule.FileSystemRights -band $traverseMask) -ne $traverseMask) {
              throw 'ACL verification failed: directory traversal rights missing from user entry';
            }
          }
        }
      }

      if (-not $foundUser) {
        $msg = 'ACL verification failed: authorized user SID not found in ACL: ' + $userSid;
        throw $msg;
      }
    `.replace(/\n/g, ' ');

    try {
      execSync(`powershell -NoProfile -NonInteractive -Command "${psVerifyScript}"`, { stdio: 'pipe' });
    } catch (verErr: any) {
      throw new Error(`CRITICAL: Windows ACL verification failed on "${targetPath}": ${verErr.message}. Aborting before DB writes.`);
    }
  } else {
    // POSIX
    try {
      const targetMode = isDir ? 0o700 : 0o600;
      fs.chmodSync(targetPath, targetMode);
      const actualMode = fs.statSync(targetPath).mode & 0o777;
      if (actualMode !== targetMode) {
        throw new Error(`POSIX mode verification mismatch: expected 0o${targetMode.toString(8)}, got 0o${actualMode.toString(8)}`);
      }
    } catch (err: any) {
      throw new Error(`CRITICAL: POSIX permissions failed on "${targetPath}": ${err.message}. Aborting before DB writes.`);
    }
  }
}

/**
 * Writes a private file with synchronous fsyncSync disk flush and enforced permissions.
 */
export function writeDurablePrivateFile(
  filePath: string,
  content: string,
  options: { exclusive?: boolean } = {}
): void {
  const flags = options.exclusive ? 'wx' : 'w';
  const fd = fs.openSync(filePath, flags, 0o600);
  try {
    fs.writeFileSync(fd, content, { encoding: 'utf8', mode: 0o600 });
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  secureFilePermissions(filePath);
}

export interface PreflightBackupFilesResult {
  backupDir: string;
  backupPath: string;
  journalPath: string;
  tmpManifestPath: string;
}

/**
 * Pre-creates and verifies restricted permissions on backup directory, backup manifest,
 * append-only journal, and temporary replacement manifest file.
 * MUST complete successfully before the first database transaction executes.
 */
export function preflightAndVerifyBackupStorage(
  backupDir: string,
  backupPath: string,
  manifestContent: string
): PreflightBackupFilesResult {
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }
  secureFilePermissions(backupDir);

  const journalPath = `${backupPath}.journal`;
  const tmpManifestPath = `${backupPath}.tmp`;

  // 1. Pre-create and verify backup manifest
  writeDurablePrivateFile(backupPath, manifestContent, { exclusive: !fs.existsSync(backupPath) });

  // 2. Pre-create and verify append-only journal file
  writeDurablePrivateFile(journalPath, '', { exclusive: !fs.existsSync(journalPath) });

  // 3. Pre-create and verify temporary replacement manifest file
  writeDurablePrivateFile(tmpManifestPath, manifestContent, { exclusive: !fs.existsSync(tmpManifestPath) });

  return { backupDir, backupPath, journalPath, tmpManifestPath };
}

/**
 * Appends entries to append-only crash journal with synchronous fsyncSync disk flush and enforced permissions.
 */
export function appendDurableJournal(journalPath: string, entries: string): void {
  const fd = fs.openSync(journalPath, 'a', 0o600);
  try {
    fs.writeSync(fd, entries, null, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  secureFilePermissions(journalPath);
}

/**
 * Atomically executes client repair batch with organization, sourcePlatform and audited updatedAt guards.
 */
export async function executeClientRepairBatch(
  tx: any,
  orgId: string,
  batch: ClientFieldDiff[]
): Promise<string[]> {
  const committedIds: string[] = [];
  for (const diff of batch) {
    const updateData: Record<string, any> = {};
    if (diff.changedFields.includes('insuranceMemberId')) {
      updateData.insuranceMemberId = diff.after.insuranceMemberId;
    }
    if (diff.changedFields.includes('insurancePayer')) {
      updateData.insurancePayer = diff.after.insurancePayer;
    }
    if (diff.changedFields.includes('phone')) {
      updateData.phone = diff.after.phone;
    }
    if (diff.changedFields.includes('email')) {
      updateData.email = diff.after.email;
    }
    if (diff.changedFields.includes('treatmentTeam')) {
      updateData.treatmentTeam = diff.after.treatmentTeam === null ? Prisma.DbNull : diff.after.treatmentTeam;
    }

    const res = await tx.client.updateMany({
      where: {
        id: diff.clientId,
        organizationId: orgId,
        sourcePlatform: 'VALANT_EXPORT',
        updatedAt: new Date(diff.auditedUpdatedAt),
      },
      data: updateData,
    });

    if (res.count === 0) {
      throw new Error(`Optimistic concurrency violation on client ${diff.clientId}. Record was concurrently modified or deleted.`);
    }
    committedIds.push(diff.clientId);
  }
  return committedIds;
}

export interface ClientRollbackBatchResult {
  restored: number;
  skippedManualEdits: number;
  alreadyInBeforeState: number;
}

/**
 * Atomically executes client rollback with organization, sourcePlatform and current updatedAt guards.
 * Evaluates all planned operations safely against before/after state; skips uncommitted and preserves concurrent human edits.
 */
export async function executeClientRollbackBatch(
  tx: any,
  orgId: string,
  batch: ClientFieldDiff[],
  options: { forceOverwriteEdits?: boolean } = {}
): Promise<ClientRollbackBatchResult> {
  let restored = 0;
  let skippedManualEdits = 0;
  let alreadyInBeforeState = 0;

  for (const item of batch) {
    const current = await tx.client.findFirst({
      where: { id: item.clientId, organizationId: orgId, sourcePlatform: 'VALANT_EXPORT' },
      select: {
        insuranceMemberId: true,
        phone: true,
        email: true,
        insurancePayer: true,
        treatmentTeam: true,
        updatedAt: true,
      },
    });

    if (!current) continue;

    const plan = planClientRollback(item, current, options);
    if (!plan.shouldRestore || !plan.restoreData) {
      if (plan.skipReason === 'MANUAL_EDIT_PROTECTED') {
        skippedManualEdits++;
      } else if (plan.skipReason === 'ALREADY_IN_BEFORE_STATE') {
        alreadyInBeforeState++;
      }
      continue;
    }

    const res = await tx.client.updateMany({
      where: {
        id: item.clientId,
        organizationId: orgId,
        sourcePlatform: 'VALANT_EXPORT',
        updatedAt: current.updatedAt,
      },
      data: plan.restoreData,
    });

    if (res.count === 0) {
      // Concurrently modified between check and write
      skippedManualEdits++;
    } else {
      restored++;
    }
  }

  return { restored, skippedManualEdits, alreadyInBeforeState };
}

/**
 * Atomically executes appointment repair batch with organization, before-timestamps, and audited updatedAt guards.
 */
export async function executeAppointmentRepairBatch(
  tx: any,
  orgId: string,
  batch: AppointmentRepairRecord[]
): Promise<string[]> {
  const committedIds: string[] = [];
  for (const item of batch) {
    const res = await tx.appointment.updateMany({
      where: {
        id: item.appointmentId,
        organizationId: orgId,
        startsAt: new Date(item.before.startsAt),
        endsAt: new Date(item.before.endsAt),
        updatedAt: new Date(item.auditedUpdatedAt),
      },
      data: {
        startsAt: new Date(item.after.startsAt),
        endsAt: new Date(item.after.endsAt),
      },
    });

    if (res.count === 0) {
      throw new Error(`Optimistic concurrency violation on appointment ${item.appointmentId}. Concurrently modified or deleted.`);
    }
    committedIds.push(item.appointmentId);
  }
  return committedIds;
}

export interface AppointmentRollbackBatchResult {
  restored: number;
  skippedManualEdits: number;
  alreadyInBeforeState: number;
}

/**
 * Atomically executes appointment rollback batch with organization, after-timestamps, and current updatedAt guards.
 * Safely evaluates planned operations: skips uncommitted, restores committed, and preserves concurrent human edits.
 */
export async function executeAppointmentRollbackBatch(
  tx: any,
  orgId: string,
  batch: AppointmentRepairRecord[],
  options: { forceOverwriteEdits?: boolean } = {}
): Promise<AppointmentRollbackBatchResult> {
  let restored = 0;
  let skippedManualEdits = 0;
  let alreadyInBeforeState = 0;

  for (const item of batch) {
    const current = await tx.appointment.findFirst({
      where: { id: item.appointmentId, organizationId: orgId },
      select: { startsAt: true, endsAt: true, updatedAt: true },
    });

    if (!current) continue;

    const currentStartsAtIso = current.startsAt instanceof Date ? current.startsAt.toISOString() : new Date(current.startsAt).toISOString();
    const currentEndsAtIso = current.endsAt instanceof Date ? current.endsAt.toISOString() : new Date(current.endsAt).toISOString();

    // 1. Check if already in 'before' state (never updated or already rolled back)
    const isBefore =
      currentStartsAtIso === item.before.startsAt &&
      currentEndsAtIso === item.before.endsAt;

    if (isBefore) {
      alreadyInBeforeState++;
      continue;
    }

    // 2. Check if current state matches expected 'after' state (committed repair)
    const isAfter =
      currentStartsAtIso === item.after.startsAt &&
      currentEndsAtIso === item.after.endsAt;

    if (!isAfter && !options.forceOverwriteEdits) {
      // Concurrently modified by human scheduler
      skippedManualEdits++;
      continue;
    }

    const res = await tx.appointment.updateMany({
      where: {
        id: item.appointmentId,
        organizationId: orgId,
        startsAt: new Date(item.after.startsAt),
        endsAt: new Date(item.after.endsAt),
        updatedAt: current.updatedAt,
      },
      data: {
        startsAt: new Date(item.before.startsAt),
        endsAt: new Date(item.before.endsAt),
      },
    });

    if (res.count === 0) {
      skippedManualEdits++;
    } else {
      restored++;
    }
  }

  return { restored, skippedManualEdits, alreadyInBeforeState };
}

