import 'server-only';
import { prisma } from '@/lib/db/prisma';
import { matchesNameAndDob } from '@/lib/drfirst/chartMapping';
import { updatePatients, type DownloadedPatient } from '@/lib/services/drfirstCommands';

/**
 * Find a chart's patient in Rcopia (the lookup behind "Link to DrFirst").
 *
 * 1. update_patient by our external id (= the client id), the id send_patient
 *    registers patients under.
 * 2. Otherwise a practice-wide update_patient download from
 *    DRFIRST_PATIENT_SCAN_START (default 01/01/2025), matched HERE on the
 *    chart's legal last name + date of birth. No demographics are sent to
 *    DrFirst: patient_search_get_data is not recognised by DrFirst staging
 *    (see drfirstCommands.patientSearchGetData), and staging must not receive
 *    real patient data.
 *
 * Candidates already tied to another Altrixs chart (their external id is
 * another client's id, or another client is linked to their Rcopia id) and
 * patients deleted in Rcopia are excluded and counted.
 */

export interface PatientCandidate {
  rcopiaId: string;
  externalId?: string;
  matchedBy: 'external_id' | 'name_dob';
  firstName?: string;
  middleName?: string;
  lastName?: string;
  dob?: string;
  sex?: string;
  city?: string;
  state?: string;
}

export interface LookupResult {
  ok: boolean;
  demo: boolean;
  error?: string;
  candidates: PatientCandidate[];
  excluded: number;
  pagesScanned: number;
  /** the practice scan stopped at the page cap before reaching the present */
  truncated: boolean;
  nameDobSearched: boolean;
}

const MAX_SCAN_PAGES = 8;
const DEFAULT_SCAN_START = '01/01/2025 00:00:00';

/** Rcopia cursor (MM/DD/YYYY HH:MM:SS) -> epoch ms, or NaN. */
function cursorMs(c: string): number {
  const m = c.match(/^(\d{2})\/(\d{2})\/(\d{4})(?: (\d{2}):(\d{2}):(\d{2}))?/);
  if (!m) return Number.NaN;
  return Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2]), Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0));
}

function toCandidate(p: DownloadedPatient, matchedBy: PatientCandidate['matchedBy']): PatientCandidate {
  return {
    rcopiaId: p.rcopiaId!,
    ...(p.externalId ? { externalId: p.externalId } : {}),
    matchedBy,
    firstName: p.firstName, middleName: p.middleName, lastName: p.lastName,
    dob: p.dob, sex: p.sex, city: p.city, state: p.state,
  };
}

export async function lookupRcopiaPatient(
  client: { id: string; legalLastName: string | null; dateOfBirth: Date | null },
  rcopiaUserName?: string,
  opts: { now?: Date } = {},
): Promise<LookupResult> {
  const out: LookupResult = { ok: true, demo: false, candidates: [], excluded: 0, pagesScanned: 0, truncated: false, nameDobSearched: false };

  const byExt = await updatePatients({ patients: [{ externalId: client.id }] }, rcopiaUserName);
  if (byExt.demo) return { ...out, demo: true };
  if (!byExt.ok) return { ...out, ok: false, error: byExt.error?.code || byExt.status };
  const found: { p: DownloadedPatient; by: PatientCandidate['matchedBy'] }[] = byExt.patients
    .filter(p => p.rcopiaId && !p.error && p.externalId === client.id)
    .map(p => ({ p, by: 'external_id' as const }));

  if (!found.length && client.legalLastName?.trim() && client.dateOfBirth) {
    out.nameDobSearched = true;
    const now = (opts.now ?? new Date()).getTime();
    let cursor = process.env.DRFIRST_PATIENT_SCAN_START?.trim() || DEFAULT_SCAN_START;
    for (let page = 0; page < MAX_SCAN_PAGES; page += 1) {
      const res = await updatePatients({ lastUpdateDate: cursor }, rcopiaUserName);
      if (!res.ok) return { ...out, ok: false, error: res.error?.code || res.status };
      out.pagesScanned += 1;
      for (const p of res.patients) {
        if (p.rcopiaId && !p.error && matchesNameAndDob(client, p) && !found.some(f => f.p.rcopiaId === p.rcopiaId)) {
          found.push({ p, by: 'name_dob' });
        }
      }
      const next = res.nextCursor;
      // Caught up when Rcopia hands back (about) the present, or the cursor stops moving. Rcopia
      // cursors are US Eastern wall-clock time, read here as UTC: allow 6 hours for the offset.
      if (!next || next === cursor || cursorMs(next) >= now - 6 * 3600 * 1000) break;
      cursor = next;
      if (page === MAX_SCAN_PAGES - 1) out.truncated = true;
    }
  }

  // Never offer a Rcopia patient that already belongs to another Altrixs chart
  const extIds = [...new Set(found.map(f => f.p.externalId).filter((v): v is string => Boolean(v) && v !== client.id))];
  const rcopiaIds = found.map(f => f.p.rcopiaId!);
  const taken = await prisma.client.findMany({
    where: {
      id: { not: client.id },
      OR: [...(extIds.length ? [{ id: { in: extIds } }] : []), { rcopiaPatientId: { in: rcopiaIds } }],
    },
    select: { id: true, rcopiaPatientId: true },
  });
  const takenIds = new Set(taken.map(t => t.id));
  const takenRcopia = new Set(taken.map(t => t.rcopiaPatientId).filter(Boolean));
  for (const f of found) {
    if (f.p.deleted || (f.p.externalId && takenIds.has(f.p.externalId)) || takenRcopia.has(f.p.rcopiaId!)) {
      out.excluded += 1;
      continue;
    }
    out.candidates.push(toCandidate(f.p, f.by));
  }
  return out;
}

/** Re-read one Rcopia patient by Rcopia id (link confirmation). */
export async function fetchRcopiaPatient(rcopiaId: string, rcopiaUserName?: string): Promise<{ ok: boolean; demo: boolean; patient?: DownloadedPatient; error?: string }> {
  const res = await updatePatients({ patients: [{ rcopiaId }] }, rcopiaUserName);
  if (res.demo) return { ok: true, demo: true };
  if (!res.ok) return { ok: false, demo: false, error: res.error?.code || res.status };
  const patient = res.patients.find(p => p.rcopiaId === rcopiaId && !p.error);
  return { ok: true, demo: false, patient };
}
