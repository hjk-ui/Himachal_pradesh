import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  canAccessDrFirstReturn,
  DRFIRST_RETURN_STATUS,
  drfirstLogoutUrl,
  drfirstThrottleCopy,
} from '../src/lib/drfirst/returnAccess';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('drfirst-quick-refresh logout_url', () => {
  it('logoutUrl string and throttle copy', () => {
    assert.equal(
      drfirstLogoutUrl('https://altrixs.com'),
      'https://altrixs.com/dashboard/ehr/prescriptions/return'
    );
    assert.equal(DRFIRST_RETURN_STATUS, 'Updating the chart from DrFirst…');
    assert.match(
      drfirstThrottleCopy(300),
      /DrFirst allows one update per patient every 5 minutes; the chart will catch up in about 5 min\./
    );
  });

  it('role ACL — THERAPIST false; admin/prescriber true', () => {
    assert.equal(canAccessDrFirstReturn('THERAPIST'), false);
    assert.equal(canAccessDrFirstReturn('ADMIN'), true);
    assert.equal(canAccessDrFirstReturn('PRACTICE_DIRECTOR'), true);
    assert.equal(canAccessDrFirstReturn('PSYCHIATRIST'), true);
    assert.equal(canAccessDrFirstReturn('NP'), true);
  });

  it('SSO staging includes logout_url; return page POSTs sync', () => {
    const staging = read('src/lib/drfirst/staging-provider.ts');
    assert.match(staging, /logout_url/);
    assert.match(staging, /drfirstLogoutUrl/);
    const page = read('src/app/dashboard/ehr/prescriptions/return/page.tsx');
    assert.match(page, /\/api\/drfirst\/sync\/return/);
    assert.match(page, /tab=medications/);
    assert.match(page, /canAccessDrFirstReturn/);
    const sso = read('src/app/api/integrations/drfirst/sso/route.ts');
    assert.match(sso, /demo: true/);
  });
});
