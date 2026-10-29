/**
 * Captures one live Rcopia call — exact request and response — for DrFirst support.
 * The vendor password is never printed (redacted from the envelope and the response echo).
 *
 * Usage:  npx tsx --env-file=.env scripts/capture-rcopia.ts [command] [engine|update] [rcopiaUserName]
 *         (defaults: get_notification_count, engine, none)
 */
import { buildEnvelope } from '../src/lib/services/drfirstRcopiaService';

const ENGINE_URL = process.env.DRFIRST_ENGINE_URL || 'https://engine201.staging.drfirst.com/servlet/rcopia.servlet.EngineServlet';
const UPDATE_URL = process.env.DRFIRST_UPDATE_URL || 'https://update201.staging.drfirst.com/servlet/rcopia.servlet.EngineServlet';
const pass = process.env.DRFIRST_VENDOR_PASSWORD || '';
const command = process.argv[2] || 'get_notification_count';
const url = process.argv[3] === 'update' ? UPDATE_URL : ENGINE_URL;
const rcopiaUser = process.argv[4];

if (!/^[a-z_]+$/.test(command)) {
  console.error('command must be a Rcopia command name, e.g. get_notification_count');
  process.exit(1);
}

async function main() {
  const body = buildEnvelope(`    <Command>${command}</Command>`, rcopiaUser);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=UTF-8' },
    body,
  });
  const raw = await res.text();
  const redact = (s: string) => (pass ? s.split(pass).join('[redacted]') : s);

  console.log('=== REQUEST ===');
  console.log(`POST ${url}`);
  console.log('Content-Type: text/xml; charset=UTF-8');
  console.log('');
  console.log(redact(body));
  console.log('\n=== RESPONSE ===');
  console.log(`HTTP ${res.status} ${res.statusText}   captured ${new Date().toISOString()}`);
  console.log(redact(raw));
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
