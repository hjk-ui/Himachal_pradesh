import test from 'node:test';
import assert from 'node:assert/strict';
import { registerOnLaunchEnabled } from '../src/app/api/drfirst/_lib/registerMode';

const created = { importedAt: null, sourcePlatform: null };
const imported = { importedAt: new Date('2026-10-01'), sourcePlatform: 'valant' };

test('DRFIRST_REGISTER_ON_LAUNCH modes', () => {
  const prev = process.env.DRFIRST_REGISTER_ON_LAUNCH;
  try {
    delete process.env.DRFIRST_REGISTER_ON_LAUNCH;
    assert.equal(registerOnLaunchEnabled(created), false);
    process.env.DRFIRST_REGISTER_ON_LAUNCH = 'true';
    assert.equal(registerOnLaunchEnabled(imported), true);
    process.env.DRFIRST_REGISTER_ON_LAUNCH = 'non_imported';
    assert.equal(registerOnLaunchEnabled(created), true);
    assert.equal(registerOnLaunchEnabled(imported), false);
    assert.equal(registerOnLaunchEnabled({ importedAt: null, sourcePlatform: 'valant' }), false);
    assert.equal(registerOnLaunchEnabled(), false);
  } finally {
    if (prev === undefined) delete process.env.DRFIRST_REGISTER_ON_LAUNCH;
    else process.env.DRFIRST_REGISTER_ON_LAUNCH = prev;
  }
});
