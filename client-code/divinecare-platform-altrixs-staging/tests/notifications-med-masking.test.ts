import assert from 'node:assert/strict';
import { test } from 'node:test';
import Module, { createRequire } from 'node:module';
import {
  MASKED_MEDICATION_BODY,
  MASKED_MEDICATION_TITLE,
  canSeeMedicationReminderDetails,
  isMedicationNotification,
  maskNotificationLog,
  medicationPushDenied,
} from '../src/lib/notifications/medicationMasking';

const medLog = {
  id: 'log1',
  clientId: 'c1',
  type: 'medication_reminder',
  dedupeKey: 'med-create:sched1',
  title: 'New Prescription: Sertraline',
  body: 'Your doctor prescribed Sertraline (50mg). Timings: 08:00.',
  payload: { medicationName: 'Sertraline', dosage: '50mg', route: '/medications' },
  successCount: 1,
  failureCount: 0,
  sentAt: new Date('2026-10-20T12:00:00Z'),
};
const apptLog = { ...medLog, id: 'log2', type: 'appointment_reminder', dedupeKey: 'appt:1', title: 'Upcoming appointment', body: 'Tomorrow at 10:00', payload: { route: '/appointments' } };

test('who sees medication reminder details: canViewClientMedications', () => {
  for (const r of ['ADMIN', 'PRACTICE_DIRECTOR', 'DIRECTOR', 'PSYCHIATRIST', 'NP', 'THERAPIST', 'PHYSICIAN', 'CRISIS_RESPONDER']) {
    assert.equal(canSeeMedicationReminderDetails(r), true, r);
  }
  for (const r of ['OFFICE_MANAGER', 'FRONT_DESK', 'BILLING_SPECIALIST', 'HR', 'PEER_SUPPORT', 'CASE_MANAGER', '', null]) {
    assert.equal(canSeeMedicationReminderDetails(r), false, String(r));
  }
});

test('medication rows are recognised by type, med-* dedupe key or a drug field in the payload', () => {
  assert.equal(isMedicationNotification(medLog), true);
  assert.equal(isMedicationNotification(apptLog), false);
  assert.equal(isMedicationNotification({ type: 'chat_message', dedupeKey: 'med:abc', title: '', body: '' }), true);
  assert.equal(isMedicationNotification({ type: 'chat_message', payload: { dosage: '1 tab' } }), true);
  assert.equal(isMedicationNotification({ type: 'chat_message', payload: null }), false);
});

test('Office Manager gets a masked medication row: no drug name, dose, payload or schedule id', () => {
  const m = maskNotificationLog(medLog, 'OFFICE_MANAGER');
  assert.equal(m.masked, true);
  assert.equal(m.title, MASKED_MEDICATION_TITLE);
  assert.equal(m.body, MASKED_MEDICATION_BODY);
  assert.equal(m.payload, null);
  assert.equal(m.dedupeKey, null);
  assert.doesNotMatch(JSON.stringify(m), /Sertraline|50mg|sched1/);
  // delivery facts stay so the console still works
  assert.equal(m.successCount, 1);
  assert.equal(m.type, 'medication_reminder');
  // non-medication rows untouched
  assert.deepEqual(maskNotificationLog(apptLog, 'OFFICE_MANAGER'), { ...apptLog, masked: false });
});

test('leadership keeps the full medication row', () => {
  for (const r of ['ADMIN', 'PRACTICE_DIRECTOR', 'DIRECTOR']) {
    assert.deepEqual(maskNotificationLog(medLog, r), { ...medLog, masked: false }, r);
  }
});

test('medication pushes refused for roles without canViewClientMedications', () => {
  assert.equal(medicationPushDenied('OFFICE_MANAGER', 'medication_reminder'), true);
  assert.equal(medicationPushDenied('OFFICE_MANAGER', 'appointment_reminder'), false);
  assert.equal(medicationPushDenied('ADMIN', 'medication_reminder'), false);
});

test('/api/admin/notifications masks server-side and refuses medication pushes (403)', async (t) => {
  const gate = { ok: true, userId: 'u1', organizationId: 'org1', role: 'OFFICE_MANAGER', status: 401 };
  const sent: unknown[] = [];
  const audits: Array<Record<string, unknown>> = [];
  const db = {
    deviceToken: { count: async () => 2 },
    client: {
      findMany: async () => [{ id: 'c1', name: 'Synthetic Patient', deviceTokens: [{ id: 'd1', platform: 'ios', createdAt: new Date() }] }],
      findFirst: async () => ({ id: 'c1' }),
    },
    notificationLog: { findMany: async () => [medLog, apptLog] },
  };
  const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
  const originalLoad = loader._load;
  loader._load = function (id, ...args) {
    if (id === 'server-only') return {};
    if (id === '@/lib/db/prisma') return { prisma: db };
    if (id === '@/lib/auth/tenant') return { requireOrgContext: async () => gate };
    if (id === '@/lib/notifications/firebaseAdmin') return { getFirebaseAdmin: () => ({ app: null, isMock: true }) };
    if (id === '@/lib/notifications/pushService') return { sendToUser: async (...a: unknown[]) => { sent.push(a); return { success: true, sentCount: 1 }; } };
    if (id === '@/lib/audit/requestMeta') return { auditPhiAccess: async (e: Record<string, unknown>) => { audits.push(e); } };
    return originalLoad.call(this, id, ...args);
  };
  t.after(() => { loader._load = originalLoad; });
  const require = createRequire(import.meta.url);
  const { NextRequest } = require('next/server') as typeof import('next/server');
  const route = require('../src/app/api/admin/notifications/route') as {
    GET: (req: InstanceType<typeof NextRequest>) => Promise<Response>;
    POST: (req: InstanceType<typeof NextRequest>) => Promise<Response>;
  };
  const get = () => route.GET(new NextRequest('http://localhost/api/admin/notifications'));
  const post = (body: unknown) =>
    route.POST(new NextRequest('http://localhost/api/admin/notifications', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }));

  // Office Manager: page opens, medication rows masked
  let res = await get();
  assert.equal(res.status, 200);
  let json = await res.json();
  assert.equal(json.medicationDetails, false);
  assert.equal(json.recentLogs[0].masked, true);
  assert.equal(json.recentLogs[0].title, MASKED_MEDICATION_TITLE);
  assert.equal(json.recentLogs[1].masked, false);
  assert.doesNotMatch(JSON.stringify(json), /Sertraline|50mg/);
  assert.equal((audits.at(-1)!.metadata as Record<string, unknown>).medicationDetailsMasked, true);

  // Office Manager: medication push refused (explicit and default type); other types still work
  res = await post({ clientId: 'c1', type: 'medication_reminder', title: 'Take Sertraline', message: '50mg' });
  assert.equal(res.status, 403);
  assert.equal((await res.json()).code, 'MEDICATION_DETAILS_NOT_PERMITTED');
  res = await post({ clientId: 'c1', title: 'x', message: 'y' });
  assert.equal(res.status, 403, 'omitted type defaults to medication_reminder');
  assert.equal(sent.length, 0);
  assert.equal(audits.at(-1)!.outcome, 'DENIED');
  res = await post({ clientId: 'c1', type: 'appointment_reminder', title: 'Appointment', message: 'Tomorrow' });
  assert.equal(res.status, 200);
  assert.equal(sent.length, 1);

  // Leadership: full view and medication pushes allowed
  gate.role = 'PRACTICE_DIRECTOR';
  res = await get();
  json = await res.json();
  assert.equal(json.medicationDetails, true);
  assert.equal(json.recentLogs[0].masked, false);
  assert.equal(json.recentLogs[0].title, medLog.title);
  res = await post({ clientId: 'c1', type: 'medication_reminder', title: 'Reminder', message: 'Dose time' });
  assert.equal(res.status, 200);
  assert.equal(sent.length, 2);

  // Roles outside the console still 403 before any masking
  gate.role = 'FRONT_DESK';
  assert.equal((await get()).status, 403);
});
