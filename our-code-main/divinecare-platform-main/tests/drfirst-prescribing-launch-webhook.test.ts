import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GET as getMedications, POST as postMedication } from '../src/app/api/drfirst/medications/route';
import { POST as syncPatient } from '../src/app/api/drfirst/patients/sync/route';
import { GET as getPdmpEvents } from '../src/app/api/drfirst/pdmp-events/route';
import { GET as getReviewStatus } from '../src/app/api/drfirst/review-status/route';
import { GET as getLegacySso } from '../src/app/api/drfirst/sso/route';
import { GET as getLegacyStatus } from '../src/app/api/drfirst/status/route';
import { POST as launchLegacyPrescribing } from '../src/app/api/prescribing/launch/route';
import { POST as receiveLegacyWebhook } from '../src/app/api/prescribing/webhook/route';

/** Oct 23: /api/drfirst/notifications + /api/drfirst/sync(+return) are live again — not legacy 410. */
const handlers = [
  ['GET /api/drfirst/medications', getMedications],
  ['POST /api/drfirst/medications', postMedication],
  ['POST /api/drfirst/patients/sync', syncPatient],
  ['GET /api/drfirst/pdmp-events', getPdmpEvents],
  ['GET /api/drfirst/review-status', getReviewStatus],
  ['GET /api/drfirst/sso', getLegacySso],
  ['GET /api/drfirst/status', getLegacyStatus],
  ['POST /api/prescribing/launch', launchLegacyPrescribing],
  ['POST /api/prescribing/webhook', receiveLegacyWebhook],
] as const;

test('legacy DrFirst routes fail closed without network calls', async () => {
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = async () => {
    networkCalls += 1;
    throw new Error('Legacy route attempted an external request');
  };

  try {
    for (const [name, handler] of handlers) {
      const response = await handler();
      assert.equal(response.status, 410, name);
      assert.equal(response.headers.get('cache-control'), 'no-store', name);
      assert.equal(response.headers.get('referrer-policy'), 'no-referrer', name);
      assert.deepEqual(await response.json(), {
        success: false,
        code: 'DRFIRST_LEGACY_ROUTE_DISABLED',
        error: 'This legacy DrFirst endpoint is disabled. Use /api/integrations/drfirst.',
      }, name);
    }
    assert.equal(networkCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
