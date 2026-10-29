import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { NOTIFICATION_SCREENS } from '../src/lib/drfirst/notificationScreens';

/** DrFirst certification call 2026-10-23: refresh on return from Rcopia, Refresh button, per-count deep links (NCDM2 / NCDM3). */
const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const returnRoute = read('src/app/api/drfirst/sync/return/route.ts');
const shell = read('src/components/layout/DashboardShell.tsx');

test('return route: prescriber gate, caseload + Part 2 lock, patient sync with the 5-minute throttle', () => {
  assert.match(returnRoute, /requireDrFirstCaller\(req, \{ requireRcopiaUser: true \}\)/);
  assert.match(returnRoute, /findDrFirstClient\(/);
  assert.match(returnRoute, /syncPatient\(/);
  assert.match(returnRoute, /action: 'DRFIRST_MEDICATION_DOWNLOAD'/);
  assert.match(returnRoute, /trigger: 'return_from_rcopia'/);
});

test('return route: latest DRFIRST_SSO_LAUNCH with a patient in the last 2 hours, 20 s claim per user', () => {
  assert.match(returnRoute, /action: 'DRFIRST_SSO_LAUNCH'/);
  assert.match(returnRoute, /actorUserId: c\.userId/);
  assert.match(returnRoute, /patientId: \{ not: null \}/);
  assert.match(returnRoute, /LAUNCH_LOOKBACK_MS = 2 \* 60 \* 60_000/);
  assert.match(returnRoute, /RETURN_SYNC_MIN_MS = 20_000/);
  assert.match(returnRoute, /claimPoll\(`return_sync:\$\{c\.userId\}`, RETURN_SYNC_MIN_MS\)/);
  for (const reason of ['recent', 'no_recent_launch', 'not_registered']) assert.match(returnRoute, new RegExp(`reason: '${reason}'`));
});

test('notification counts open their own Rcopia screen: pending / to sign in Report, renewals / changes in Message', () => {
  assert.deepEqual(NOTIFICATION_SCREENS, {
    pending_prescription: 'report',
    need_signing: 'report',
    refill: 'message',
    rx_change: 'message',
  });
  const page = read('src/app/dashboard/ehr/prescriptions/page.tsx');
  assert.match(page, /onClick=\{\(\) => void openScreen\(card\.screen\)\}/);
  assert.match(page, /screen: NOTIFICATION_SCREENS\.need_signing/);
  assert.doesNotMatch(page, /async function openRcopia/, 'launcher lives in src/lib/drfirst/openRcopiaClient.ts');
  assert.match(page, /when you come back to this tab \(or within 5 minutes\)/);
});

test('DashboardShell mounts DrFirstReturnSync and opens each badge count on its screen', () => {
  assert.match(shell, /<DrFirstReturnSync \/>/);
  assert.match(shell, /openRcopia\(\{ screen: NOTIFICATION_SCREENS\[key\] \}\)/);
  assert.match(shell, /aria-label=\{`Open \$\{item\.value\} \$\{item\.a11y\} in DrFirst`\}/);
});

test('badge: no button nested inside a Link', () => {
  const start = shell.indexOf('DrFirst Rcopia Prescriber Badge');
  const end = shell.indexOf('<DrFirstReturnSync', start);
  assert.ok(start > 0 && end > start);
  const badge = shell.slice(start, end);
  for (const link of badge.match(/<Link[\s\S]*?<\/Link>/g) ?? []) assert.doesNotMatch(link, /<button/);
});

test('return sync listens to visibilitychange and broadcasts altrixs:drfirst-synced', () => {
  const comp = read('src/components/drfirst/DrFirstReturnSync.tsx');
  assert.match(comp, /addEventListener\('visibilitychange'/);
  assert.match(comp, /MIN_HIDDEN_MS = 3_000/);
  assert.match(comp, /fetch\('\/api\/drfirst\/sync\/return', \{ method: 'POST'/);
  assert.match(read('src/lib/drfirst/openRcopiaClient.ts'), /DRFIRST_SYNCED_EVENT = 'altrixs:drfirst-synced'/);
  const panel = read('src/components/drfirst/DrFirstChartPanel.tsx');
  assert.match(panel, /Refresh from DrFirst/);
  assert.match(panel, /addEventListener\(DRFIRST_SYNCED_EVENT/);
});

test('practice-wide polls are claimed at the whole minute so the 5-minute cron is never throttled', () => {
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'src/app/api/drfirst/_lib/sync.ts'), 'utf8'), /Math\.floor\(d\.getTime\(\) \/ 60_000\) \* 60_000/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'src/app/api/drfirst/_lib/sync.ts'), 'utf8'), /UPDATE_POLL_MIN_MS, startOfMinute\(new Date\(\)\)\)/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'deploy/crontab.staging'), 'utf8'), /\*\/5 \* \* \* \* altrixs .*drfirst-sync/);
});

test('Rcopia logout_url: SSO launch sets it to the return page, which syncs and reopens the chart for every prescriber role', async () => {
  const fs = await import('node:fs');
  const sso = fs.readFileSync('src/app/api/drfirst/sso/route.ts', 'utf8');
  assert.match(sso, /logoutUrl: `\$\{getAppBaseUrl\(\)\}\/dashboard\/ehr\/prescriptions\/return`/);
  const page = fs.readFileSync('src/app/dashboard/ehr/prescriptions/return/page.tsx', 'utf8');
  assert.match(page, /fetch\('\/api\/drfirst\/sync\/return', \{ method: 'POST' \}\)/);
  const { canAccessPath } = await import('../src/lib/auth/roleAccess');
  for (const r of ['PSYCHIATRIST', 'NP', 'PHYSICIAN', 'MEDICAL_NP']) assert.equal(canAccessPath(r, '/dashboard/ehr/prescriptions/return'), true, r);
  assert.equal(canAccessPath('THERAPIST', '/dashboard/ehr/prescriptions/return'), false);
});
