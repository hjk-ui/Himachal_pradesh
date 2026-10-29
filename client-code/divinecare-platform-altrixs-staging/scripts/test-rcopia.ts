/**
 * DrFirst Rcopia staging test harness.
 *
 * Usage:  npx tsx --env-file=.env scripts/test-rcopia.ts
 *
 * Probes the staging engine with the current envelope from
 * drfirstRcopiaService.buildEnvelope(), then tries update_medication for the
 * DrFirst staging test patient (default "maxpatient" / RcopiaID 27162725039;
 * override with DRFIRST_TEST_PATIENT_RCOPIA_ID / DRFIRST_TEST_PROVIDER).
 * Read-only; nothing is written to the database.
 */
import { probeConnection, callEngine } from '../src/lib/services/drfirstRcopiaService';
import { updateMedications } from '../src/lib/services/drfirstCommands';

const PROVIDER = process.env.DRFIRST_TEST_PROVIDER || 'ssherman';
const PATIENT_RCOPIA_ID = process.env.DRFIRST_TEST_PATIENT_RCOPIA_ID || '27162725039';
const pass = process.env.DRFIRST_VENDOR_PASSWORD || '';
const redact = (s: string) => (pass ? s.split(pass).join('[redacted]') : s);

async function main() {
  console.log('-- Rcopia staging probe ----------------------------------------');
  const probe = await probeConnection();
  console.log('demo mode:', probe.demo, '| engine:', probe.engineUrl, '| practice:', probe.practice);
  if (probe.result) {
    console.log('status:', probe.result.status, probe.result.error ? `| error: ${probe.result.error.code} - ${probe.result.error.text}` : '');
    console.log(redact(probe.result.raw.slice(0, 600)));
  }

  console.log(`\n-- update_medication (RcopiaID ${PATIENT_RCOPIA_ID}) --------------`);
  const meds = await updateMedications({ patient: { rcopiaId: PATIENT_RCOPIA_ID } }, PROVIDER);
  console.log('status:', meds.status, meds.error ? `| error: ${meds.error.code} - ${meds.error.text}` : '', '| parsed:', meds.medications.length);
  console.log(JSON.stringify(meds.medications, null, 2).slice(0, 1200));

  console.log('\n-- raw get_patient (for schema discovery) ----------------------');
  const raw = await callEngine(
    ['    <Command>get_patient</Command>', '    <Patient>', `      <RcopiaID>${PATIENT_RCOPIA_ID}</RcopiaID>`, '    </Patient>'].join('\n'),
    PROVIDER,
  );
  console.log(redact(raw.raw.slice(0, 800)));
}

main().catch(err => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
