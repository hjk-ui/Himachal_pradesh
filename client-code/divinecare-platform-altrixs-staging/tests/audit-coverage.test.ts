import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * HIPAA audit coverage: every API route that touches patient data must write to the audit log.
 * A route counts as touching patient data when it references a client or patient id or the Client model.
 * Routes that match that pattern but do not read or change PHI go in NOT_PHI with the reason.
 */
const API_ROOT = path.join(__dirname, '..', 'src', 'app', 'api');
const PHI_PATTERN = /clientId|patientId|prisma\.client\b|client:/;
const AUDIT_PATTERN = /auditPhiAccess|writeAuditLog/;

/** Relative to src/app/api, forward slashes, without /route.ts */
const NOT_PHI: Record<string, string> = {
  'connect/staff-call': 'Staff-to-staff call with no patient linkage; recorded in operationalCallLog',
  'agents/analyze-note':'Always returns 503; calls no model and stores nothing (add AI_ACCESS when the Bedrock call is enabled)',
  'marketing/leads/[id]/convert': 'Audited in convertLead (src/lib/marketing/leadService.ts, MARKETING_LEAD_CONVERT with patientId); the client is created through createClient, which audits too',
  'prescriptions/pharmacies': 'Pharmacy directory (store name, address, phone); `client:` is only the org filter through prescriptions, no patient fields are returned',
};

function routeFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return routeFiles(p);
    return e.name === 'route.ts' ? [p] : [];
  });
}

test('every API route that touches patient data writes an audit entry', () => {
  const missing = routeFiles(API_ROOT)
    .filter((f) => {
      const src = fs.readFileSync(f, 'utf8');
      return PHI_PATTERN.test(src) && !AUDIT_PATTERN.test(src);
    })
    .map((f) => path.relative(API_ROOT, path.dirname(f)).split(path.sep).join('/'))
    .filter((rel) => !(rel in NOT_PHI));
  assert.deepEqual(missing, [], `Routes touching patient data without audit logging:\n${missing.join('\n')}`);
});

test('the NOT_PHI list only names routes that exist', () => {
  for (const rel of Object.keys(NOT_PHI)) {
    assert.ok(fs.existsSync(path.join(API_ROOT, rel, 'route.ts')), `NOT_PHI entry has no route: ${rel}`);
  }
});
