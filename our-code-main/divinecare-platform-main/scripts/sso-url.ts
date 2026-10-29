import path from 'path';
import { config } from 'dotenv';

// Load environment variables from .env or .env.local
config({ path: path.join(__dirname, '..', '.env') });
config({ path: path.join(__dirname, '..', '.env.local') });

import { buildRcopiaSsoUrl } from '../src/lib/services/drfirstRcopiaService';

const rcopiaUsername = process.argv[2] || 'ssherman';
const patientExternalId = process.argv[3] || 'maxpatient';
const startupScreen = (process.argv[4] || 'patient') as
  | 'patient'
  | 'message'
  | 'report'
  | 'manage_medications'
  | 'manage_allergies'
  | 'manage_problems';

console.log('--- DrFirst Rcopia v2.54 SSO URL Generator ---');
console.log(`Prescriber:    ${rcopiaUsername}`);
console.log(`Patient ID:    ${patientExternalId}`);
console.log(`Startup Screen: ${startupScreen}`);

const url = buildRcopiaSsoUrl({
  rcopiaUsername,
  patientExternalId,
  startupScreen,
});

if (url) {
  console.log('\n[SUCCESS] Generated MAC-Signed Launch URL:');
  console.log(url);
} else {
  console.log('\n[DEMO MODE] DRFIRST_VENDOR_PASSWORD not set in environment.');
  console.log('Set DRFIRST_VENDOR_USERNAME and DRFIRST_VENDOR_PASSWORD in .env to generate live signed URLs.');
}
