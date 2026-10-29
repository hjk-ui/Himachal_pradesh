import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDateStamp, formatVersionLabel, normalizeEnv, pickReleaseTag, resolveVersion } from '../src/lib/version';

test('release tag at HEAD becomes the version', () => {
  const v = resolveVersion({ tags: ['v2026.10.17.1'], commit: '977f464', builtAt: new Date('2026-10-17T19:00:00Z'), env: 'production' });
  assert.equal(v.version, '2026.10.17.1');
  assert.equal(v.release, true);
  assert.equal(formatVersionLabel(v), '2026.10.17.1 (977f464)');
});

test('untagged builds show the Maryland build date and an environment marker', () => {
  // 02:30 UTC on Oct 18 is still Oct 17 in Maryland
  const builtAt = new Date('2026-10-18T02:30:00Z');
  assert.equal(buildDateStamp(builtAt), '2026.10.17');
  assert.equal(resolveVersion({ tags: [], commit: 'abc1234', builtAt, env: 'staging' }).version, '2026.10.17-rc');
  assert.equal(resolveVersion({ tags: [], commit: null, builtAt, env: 'development' }).version, '2026.10.17-dev');
  assert.equal(resolveVersion({ tags: ['latest'], commit: null, builtAt, env: 'production' }).version, '2026.10.17-untagged');
});

test('non-release tags are ignored and the highest release wins', () => {
  assert.equal(pickReleaseTag(['staging', 'v2026.10.17.1', 'v2026.10.17.2', 'v1.0.0']), 'v2026.10.17.2');
  assert.equal(pickReleaseTag(['v2026.10.9.1', 'release']), null);
});

test('environment names normalize', () => {
  assert.equal(normalizeEnv('PROD'), 'production');
  assert.equal(normalizeEnv('staging'), 'staging');
  assert.equal(normalizeEnv(undefined), 'development');
});
