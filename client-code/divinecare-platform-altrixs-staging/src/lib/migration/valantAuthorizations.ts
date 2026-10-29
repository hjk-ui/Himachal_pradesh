import { createHash } from 'node:crypto';
import { isoDate, parseLongDate, parseUsDate } from './valantReportCommon';

/**
 * Valant "Insurance Authorizations" export (CSV, real column names). OPERATIONAL import: rows become
 * PriorAuth records that claims use for REF*G1.
 *
 * Only these columns are read: insuranceAuthorizationsDate (report date), insuranceProviderDescription
 * (payer), patientId (Valant ID), authorizationCode (kept as text exactly as exported),
 * allowedVisits, remainingVisits (can be negative = over the limit), startDate, expirationDate,
 * expiredAuthorizationWarning / remainingVisitsWarning / futureAuthorizationWarning ('!'), note.
 * patientName, birthDate, groupNumber and insured* columns are never read or stored.
 *
 * Valant exports no CPT codes, so cptCodes = [] (the auth covers any service for the payer in its
 * date range). The same auth number can appear twice for a patient with different visits or end
 * dates; each row is kept as its own auth.
 */

export const AUTH_REQUIRED_COLUMNS = [
  'insuranceAuthorizationsDate', 'insuranceProviderDescription', 'patientId', 'authorizationCode',
  'allowedVisits', 'remainingVisits', 'startDate', 'expirationDate', 'expiredAuthorizationWarning',
  'remainingVisitsWarning', 'futureAuthorizationWarning', 'note',
] as const;

export const VALANT_AUTH_VENDOR = 'valant';
export const VALANT_AUTH_EXTERNAL_STATUS = 'valant-import';

export type ValantAuth = {
  line: number;
  valantPatientId: string;
  payer: string;
  authNumber: string;
  unitsApproved: number;
  remainingVisits: number;
  unitsUsed: number;
  overLimit: boolean;
  startDate: Date | null;
  endDate: Date | null;
  expiredFlag: boolean;
  remainingWarning: boolean;
  futureFlag: boolean;
  note: string | null;
  /** 0 for the first row with the same patient + auth number + payer + start, 1 for the next, ... */
  rank: number;
};

export type AuthParse = {
  ok: boolean;
  error?: string;
  reportDate: Date | null;
  auths: ValantAuth[];
  errors: { line: number; error: string }[];
  sharedAuthKeys: number;
  distinctPatients: number;
  distinctPayers: number;
};

/** "Insurance Authorizations on October 17, 2026" */
export function parseAuthReportDate(title: string): Date | null {
  const m = String(title ?? '').match(/on\s+([A-Za-z]+\s+\d{1,2},\s*\d{4})/i);
  return m ? parseLongDate(m[1]) : null;
}

function int(raw: string): number | null {
  const s = raw.trim();
  return /^-?\d+$/.test(s) ? Number(s) : null;
}

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

export function authBaseKey(a: { valantPatientId: string; authNumber: string; payer: string; startDate: Date | null }) {
  return [a.valantPatientId.toUpperCase(), a.authNumber, norm(a.payer), isoDate(a.startDate) ?? ''].join('|');
}

/** PriorAuth.submissionKey for an imported auth (globally unique, so the org is part of it) */
export function valantAuthSubmissionKey(organizationId: string, a: ValantAuth): string {
  const h = createHash('sha256').update(`${organizationId}|${authBaseKey(a)}|#${a.rank}`).digest('hex').slice(0, 40);
  return `valant:${h}`;
}

/** Expired when Valant flags it or the end date is before today (date only) */
export function authIsExpired(a: { expiredFlag: boolean; endDate: Date | null }, today: Date): boolean {
  if (a.expiredFlag) return true;
  return Boolean(a.endDate && (isoDate(a.endDate) as string) < (isoDate(today) as string));
}

export function parseAuthorizationReport(records: readonly (readonly string[])[]): AuthParse {
  const empty: AuthParse = { ok: false, reportDate: null, auths: [], errors: [], sharedAuthKeys: 0, distinctPatients: 0, distinctPayers: 0 };
  const [rawHeader, ...data] = records;
  const header = (rawHeader ?? []).map((h) => String(h).replace(/^﻿/, '').trim());
  const col = (n: string) => header.indexOf(n);
  if (!rawHeader || AUTH_REQUIRED_COLUMNS.some((n) => col(n) < 0)) {
    return { ...empty, error: 'This is not the Valant Insurance Authorizations export (expected columns are missing).' };
  }
  const body = data.filter((r) => r.some((c) => String(c).trim()));
  if (!body.length) return { ...empty, error: 'The file has no rows.' };
  const reportDate = parseAuthReportDate(String(body[0][col('insuranceAuthorizationsDate')] ?? ''));

  const auths: Omit<ValantAuth, 'rank'>[] = [];
  const errors: { line: number; error: string }[] = [];
  body.forEach((cells, i) => {
    const line = i + 2;
    const cell = (n: string) => String(cells[col(n)] ?? '').trim();
    const valantPatientId = cell('patientId').replace(/\s+/g, ' ').toUpperCase();
    if (!valantPatientId) return errors.push({ line, error: 'patientId is blank' });
    // Kept exactly as text: auth numbers can have leading zeros, letters, dashes and spaces
    const authNumber = String(cells[col('authorizationCode')] ?? '').trim();
    if (!authNumber) return errors.push({ line, error: `Patient ${valantPatientId}: authorization code is blank` });
    const payer = cell('insuranceProviderDescription').replace(/\s+/g, ' ');
    if (!payer) return errors.push({ line, error: `Patient ${valantPatientId}: payer is blank` });
    const allowed = int(cell('allowedVisits'));
    const remaining = int(cell('remainingVisits'));
    if (allowed === null || allowed < 0) return errors.push({ line, error: `Patient ${valantPatientId}: allowed visits is not a whole number` });
    if (remaining === null) return errors.push({ line, error: `Patient ${valantPatientId}: remaining visits is not a whole number` });
    const startRaw = cell('startDate');
    const endRaw = cell('expirationDate');
    const startDate = startRaw ? parseUsDate(startRaw) : null;
    const endDate = endRaw ? parseUsDate(endRaw) : null;
    if ((startRaw && !startDate) || (endRaw && !endDate)) return errors.push({ line, error: `Patient ${valantPatientId}: a date is not MM/DD/YYYY` });
    const used = allowed - remaining;
    auths.push({
      line,
      valantPatientId,
      payer,
      authNumber,
      unitsApproved: allowed,
      remainingVisits: remaining,
      unitsUsed: used,
      overLimit: remaining < 0,
      startDate,
      endDate,
      expiredFlag: cell('expiredAuthorizationWarning') === '!',
      remainingWarning: cell('remainingVisitsWarning') === '!',
      futureFlag: cell('futureAuthorizationWarning') === '!',
      note: cell('note') || null,
    });
  });

  // Rank rows that share patient + auth number + payer + start in a stable order (not file order)
  const groups = new Map<string, Omit<ValantAuth, 'rank'>[]>();
  for (const a of auths) groups.set(authBaseKey(a), [...(groups.get(authBaseKey(a)) ?? []), a]);
  const ranked: ValantAuth[] = [];
  let shared = 0;
  for (const g of groups.values()) {
    if (g.length > 1) shared += 1;
    const sorted = [...g].sort(
      (x, y) =>
        (isoDate(x.endDate) ?? '').localeCompare(isoDate(y.endDate) ?? '') ||
        x.unitsApproved - y.unitsApproved ||
        (x.note ?? '').localeCompare(y.note ?? '') ||
        x.remainingVisits - y.remainingVisits
    );
    sorted.forEach((a, rank) => ranked.push({ ...a, rank }));
  }
  ranked.sort((a, b) => a.line - b.line);
  return {
    ok: true,
    reportDate,
    auths: ranked,
    errors,
    sharedAuthKeys: shared,
    distinctPatients: new Set(ranked.map((a) => a.valantPatientId)).size,
    distinctPayers: new Set(ranked.map((a) => a.payer)).size,
  };
}

/** PriorAuth.notes for an imported auth */
export function importedAuthNotes(note: string | null, reportDate: Date | null): string {
  const suffix = `(imported from Valant ${isoDate(reportDate) ?? 'export'})`;
  return note ? `${note} ${suffix}` : suffix;
}
