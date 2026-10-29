/**
 * Calls every read-only Rcopia download against DrFirst staging and reports what came back:
 * status, parsed record count, next cursor, and a sample record. Nothing is sent to Rcopia
 * and nothing is written to the database.
 *
 * Usage:  npx tsx --env-file=.env scripts/sweep-rcopia.ts [rawDir]
 *   rawDir — optional folder to save each raw response (vendor password redacted).
 *   DRFIRST_TEST_PROVIDER / DRFIRST_TEST_PATIENT_RCOPIA_ID / DRFIRST_TEST_PATIENT_EXTERNAL_ID
 *   override the DrFirst staging test provider and patient.
 */
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { getNotificationCounts } from '../src/lib/services/drfirstRcopiaService';
import {
  updateMedications, updateAllergies, updatePrescriptions, updatePrescriptionEvents, updateNotifications,
  updateRxChanges, updateRxFills, getReviewStatus, getPdmpEvents, updateOfficeVisits, searchDrugDetail, updateProblems, updatePatients, searchProblems,
} from '../src/lib/services/drfirstCommands';

const PROVIDER = process.env.DRFIRST_TEST_PROVIDER || 'ssherman';
const PATIENT = {
  rcopiaId: process.env.DRFIRST_TEST_PATIENT_RCOPIA_ID || '27162725039',
  externalId: process.env.DRFIRST_TEST_PATIENT_EXTERNAL_ID || 'maxpatient',
};
const rawDir = process.argv[2];
const pass = process.env.DRFIRST_VENDOR_PASSWORD || '';
if (rawDir) mkdirSync(rawDir, { recursive: true });

type Result = { status?: string; ok?: boolean; error?: { code: string; text: string } | string; raw?: string; nextCursor?: string; [k: string]: unknown };

async function run(name: string, listKey: string | null, fn: () => Promise<Result>) {
  try {
    const r = await fn();
    const list = listKey ? (r[listKey] as unknown[] | undefined) : undefined;
    const err = typeof r.error === 'string' ? r.error : r.error ? `${r.error.code}: ${r.error.text}` : '';
    const status = r.status ?? (err ? 'error' : 'ok');
    console.log(`${name.padEnd(30)} ${String(status).padEnd(6)} ${list ? `${list.length} parsed` : ''}${r.nextCursor ? `  cursor=${r.nextCursor}` : ''}${err ? `  ${err}` : ''}`);
    if (list?.length) console.log(`${''.padEnd(31)}sample: ${JSON.stringify(list[0]).slice(0, 220)}`);
    if (rawDir && typeof r.raw === 'string') writeFileSync(join(rawDir, `${name.replace(/\W+/g, '_')}.xml`), pass ? r.raw.split(pass).join('[redacted]') : r.raw);
  } catch (e: unknown) {
    console.log(`${name.padEnd(30)} THREW  ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function main() {
  // Start of 2026 — staging history is small, and some commands require a date
  const since = '01/01/2026 00:00:00';

  await run('get_notification_count', 'items', async () => {
    const r = await getNotificationCounts(PROVIDER, { returnIds: true });
    console.log(`${''.padEnd(31)}counts: ${JSON.stringify(r.counts)}  byProvider: ${JSON.stringify(r.byProvider)}`);
    return { ...r, status: r.error ? 'error' : 'ok' } as Result;
  });
  await run('update_medication', 'medications', () => updateMedications({ patient: PATIENT }, PROVIDER) as unknown as Promise<Result>);
  await run('update_medication since', 'medications', () => updateMedications({ lastUpdateDate: since }, PROVIDER) as unknown as Promise<Result>);
  await run('update_allergy', 'allergies', () => updateAllergies({ lastUpdateDate: since, patient: PATIENT }, PROVIDER) as unknown as Promise<Result>);
  await run('update_prescription', 'prescriptions', () => updatePrescriptions({ lastUpdateDate: since, patient: PATIENT, status: 'all' }, PROVIDER) as unknown as Promise<Result>);
  await run('update_prescription_events', 'events', () => updatePrescriptionEvents({ lastUpdateDate: since }, PROVIDER) as unknown as Promise<Result>);
  await run('update_notification', 'notifications', () => updateNotifications({ lastUpdateDate: since, provider: { username: PROVIDER } }, PROVIDER) as unknown as Promise<Result>);
  await run('update_rxchange', 'rxChanges', () => updateRxChanges({ lastUpdateDate: since }, PROVIDER) as unknown as Promise<Result>);
  await run('update_rxfill', 'fills', () => updateRxFills({ lastUpdateDate: since }, PROVIDER) as unknown as Promise<Result>);
  await run('get_review_status', 'statuses', () => getReviewStatus({ lastUpdateDate: since, patients: [PATIENT] }, PROVIDER) as unknown as Promise<Result>);
  await run('get_pdmp_events', 'events', () => getPdmpEvents({ lastUpdateDate: since, patient: PATIENT }, PROVIDER) as unknown as Promise<Result>);
  await run('update_problem', 'problems', () => updateProblems({ lastUpdateDate: since, patient: PATIENT }, PROVIDER) as unknown as Promise<Result>);
  await run('update_patient (lookup)', 'patients', () => updatePatients({ patients: [{ externalId: PATIENT.externalId }] }, PROVIDER) as unknown as Promise<Result>);
  await run('search_problem', 'results', () => searchProblems('anxiety', PROVIDER) as unknown as Promise<Result>);
  await run('update_patient_office_visits', 'visits', () => updateOfficeVisits({ lastUpdateDate: since, patients: [PATIENT] }, PROVIDER) as unknown as Promise<Result>);
  await run('search_drug_detail', null, () => searchDrugDetail('sertraline', PROVIDER) as unknown as Promise<Result>);
}

main();
