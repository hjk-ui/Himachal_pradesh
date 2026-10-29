import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  INTEGRATION_LABELS,
  INTEGRATION_LOGS_FORBIDDEN,
  integrationHealthFromCounts,
  maskMrn,
  recordIntegrationCall,
  redactMetadata,
} from '../src/lib/integrations/callLog';

describe('integration-logs', () => {
  it('redaction, labels, health, MRN mask', () => {
    assert.equal(INTEGRATION_LABELS.drfirst, 'DrFirst Rcopia');
    assert.equal(INTEGRATION_LABELS.waystar, 'Waystar (SFTP)');
    assert.equal(maskMrn('12345678'), '••••5678');
    const redacted = redactMetadata('drfirst', { mac: 'ABCDEF', note: 'ok' });
    assert.equal(redacted?.mac, '[redacted]');
    assert.equal(redacted?.note, 'ok');
    const stripped = redactMetadata('sms', { body: 'PHI text', to: '+1' });
    assert.equal(stripped?.body, undefined);
    assert.equal(integrationHealthFromCounts(0, 0, 0), 'No calls (1h)');
    assert.equal(integrationHealthFromCounts(3, 0, 3), 'OK');
    assert.equal(integrationHealthFromCounts(1, 2, 3), 'Failing');
    assert.equal(integrationHealthFromCounts(2, 1, 3), 'Degraded');
    assert.match(INTEGRATION_LOGS_FORBIDDEN, /Only Admin \/ Practice Director/);
  });

  it('writers never throw when prisma model missing', async () => {
    await assert.doesNotReject(() =>
      recordIntegrationCall({
        organizationId: 'org',
        integration: 'drfirst',
        operation: 'test',
        status: 'success',
        metadata: { mac: 'secret' },
      })
    );
  });

  it('admin UI + API RBAC strings present', () => {
    const api = readFileSync(
      join(process.cwd(), 'src/app/api/admin/integrations/logs/route.ts'),
      'utf8'
    );
    assert.match(api, /INTEGRATION_LOGS_FORBIDDEN/);
    const page = readFileSync(
      join(process.cwd(), 'src/app/dashboard/admin/integrations/logs/page.tsx'),
      'utf8'
    );
    assert.match(page, /Integration logs/);
    assert.match(page, /No calls match these filters/);
    assert.match(page, /Mask patient identifiers/);
  });
});
