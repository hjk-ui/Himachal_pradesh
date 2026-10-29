import path from 'path';
import { config } from 'dotenv';

// Load environment configuration
config({ path: path.join(__dirname, '..', '.env') });
config({ path: path.join(__dirname, '..', '.env.local') });

import {
  probeConnection,
  callUpdate,
  buildEnvelope,
  DEMO_MODE,
} from '../src/lib/services/drfirstRcopiaService';

async function main() {
  console.log('===============================================================');
  console.log('  DrFirst Rcopia (v2.54) Automated Diagnostics & Test Harness  ');
  console.log('===============================================================\n');

  console.log(`[ENVIRONMENT] DEMO_MODE: ${DEMO_MODE}`);
  console.log(`[CONFIG] Vendor: ${process.env.DRFIRST_VENDOR_USERNAME || 'unset'}`);
  console.log(`[CONFIG] Practice: ${process.env.DRFIRST_PRACTICE_USERNAME || process.env.DRFIRST_PRACTICE_USER_NAME || 'unset'}`);
  console.log(`[CONFIG] Engine URL: ${process.env.DRFIRST_ENGINE_URL || 'default staging'}`);
  console.log(`[CONFIG] Update URL: ${process.env.DRFIRST_UPDATE_URL || 'default staging'}\n`);

  // Step 1: Probe Servlet Connectivity
  console.log('--- Step 1: Probing Engine Servlet Connectivity ---');
  const probe = await probeConnection();
  console.log('Probe Result:', JSON.stringify(probe, null, 2));

  // Step 2: Validate XML Envelope Construction
  console.log('\n--- Step 2: Validating XML Envelope Construction ---');
  const sampleCommand = '    <Command>get_patient_list</Command>';
  const sampleEnvelope = buildEnvelope(sampleCommand, 'ssherman');
  console.log('Generated Envelope Sample:');
  console.log(sampleEnvelope);

  // Step 3: Test update_medication against Staging Patient (maxpatient / ID: 27162725039)
  console.log('\n--- Step 3: Testing update_medication with Staging Patient ---');
  const testPatientRcopiaId = '27162725039';
  const testPatientExternalId = 'maxpatient';

  const updateMedXml = `    <Command>update_medication</Command>
    <Patient>
      <RcopiaID>${testPatientRcopiaId}</RcopiaID>
      <ExternalID>${testPatientExternalId}</ExternalID>
    </Patient>`;

  console.log(`Sending update_medication for RcopiaID=${testPatientRcopiaId}, ExternalID=${testPatientExternalId}...`);
  const medResult = await callUpdate(updateMedXml, 'ssherman');
  console.log('Result Status:', medResult.status);
  console.log('Success (ok):', medResult.ok);
  console.log('Is Demo:', medResult.demo);
  if (medResult.error) {
    console.error('Error Details:', medResult.error);
  }
  if (medResult.raw) {
    console.log('\nRaw XML Response Snippet (First 500 chars):');
    console.log(medResult.raw.slice(0, 500) + (medResult.raw.length > 500 ? '...' : ''));
  }

  console.log('\n===============================================================');
  console.log('  DrFirst Diagnostic Test Complete                             ');
  console.log('===============================================================');
}

main().catch((err) => {
  console.error('[FATAL] Test harness failed:', err);
  process.exit(1);
});
