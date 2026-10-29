import assert from 'node:assert/strict';
import { test } from 'node:test';
import Module, { createRequire } from 'node:module';
import { PatientAppError, type PatientContext } from '../src/patient/domain';

test('patient and clinician messaging share threads without exposing internal notes', async (t) => {
  const ctx: PatientContext = {
    accountId: 'account', clientId: 'patient', name: 'Synthetic Patient', clientName: 'Synthetic Patient',
    email: 'patient@example.test', phone: null, status: 'ACTIVE', organizationId: 'clinic',
    assignedClinicianId: 'doctor', assignedClinicianName: 'Synthetic Doctor',
    // Portal proxy access (20261021): the client's own login
    portalUserId: 'account',
    access: { accessId: null, relationship: 'self', accessLevel: 'full', isProxy: false, actorName: 'Synthetic Patient', clientAgeYears: null, minorSelfConsentMh: false },
  };
  let threads: any[] = [
    { id: 'own', clientId: 'patient', organizationId: 'clinic', clientName: ctx.name, topic: 'CLINICAL', status: 'WAITING',
      lastMessage: 'INTERNAL NOTE', lastMessageAt: new Date('2026-01-03'), assignedStaff: 'Synthetic Doctor', unreadCount: 1, risk: 'LOW' },
    { id: 'another-patient', clientId: 'other', organizationId: 'clinic', topic: 'GENERAL', status: 'WAITING' },
    { id: 'another-clinic', clientId: 'patient', organizationId: 'other-clinic', topic: 'GENERAL', status: 'WAITING' },
  ];
  let messages: any[] = [
    { id: 'patient-message', threadId: 'own', senderType: 'PATIENT', senderName: ctx.name, content: 'Question for doctor', read: false, createdAt: new Date('2026-01-01') },
    { id: 'doctor-message', threadId: 'own', senderType: 'FRONT_OFFICE', senderName: 'Synthetic Doctor', content: 'Shared reply', read: false, createdAt: new Date('2026-01-02') },
    { id: 'private-message', threadId: 'own', senderType: 'CLINICIAN_NOTE', senderName: 'Staff', content: 'INTERNAL NOTE', read: false, createdAt: new Date('2026-01-03') },
    { id: 'other-message', threadId: 'another-patient', senderType: 'FRONT_OFFICE', senderName: 'Doctor', content: 'OTHER PATIENT', read: false, createdAt: new Date() },
  ];
  let failThreadUpdate = false, nextId = 0, linkedSafetyPlan = false;
  const threadMatches = (row: any, where: any) => ['id', 'clientId', 'organizationId'].every((key) => !where?.[key] || row[key] === where[key]);
  const messageMatches = (row: any, where: any) => {
    if (where.id && row.id !== where.id) return false;
    if (where.threadId && row.threadId !== where.threadId) return false;
    if (typeof where.senderType === 'string' && row.senderType !== where.senderType) return false;
    if (where.senderType?.in && !where.senderType.in.includes(row.senderType)) return false;
    if (where.read !== undefined && row.read !== where.read) return false;
    if (where.thread && !threads.some((thread) => thread.id === row.threadId && threadMatches(thread, where.thread))) return false;
    return true;
  };
  const withThreadRelations = (row: any, include: any) => {
    const result = structuredClone(row);
    if (include?.messages) {
      const query = include.messages;
      result.messages = messages.filter((m) => m.threadId === row.id && messageMatches(m, query.where))
        .sort((a, b) => b.createdAt - a.createdAt).slice(0, query.take).map((m) => structuredClone(m));
    }
    if (include?._count) {
      result._count = { messages: messages.filter((m) => m.threadId === row.id && messageMatches(m, include._count.select.messages.where)).length };
    }
    return result;
  };
  const db = {
    messageThread: {
      findFirst: async ({ where, include }: any) => {
        const row = threads.find((thread) => threadMatches(thread, where));
        return row ? withThreadRelations(row, include) : null;
      },
      findUnique: async ({ where }: any) => threads.find((thread) => thread.id === where.id),
      findMany: async ({ where, include }: any) => threads.filter((thread) => threadMatches(thread, where)).map((row) => withThreadRelations(row, include)),
      create: async ({ data }: any) => {
        const row = { id: 'thread-' + (++nextId), risk: 'LOW', ...data }; threads.push(row); return structuredClone(row);
      },
      update: async ({ where, data }: any) => {
        if (failThreadUpdate) throw new Error('thread update failed');
        const row = threads.find((thread) => thread.id === where.id)!;
        const patch = structuredClone(data);
        if (data.unreadCount?.increment) patch.unreadCount = row.unreadCount + data.unreadCount.increment;
        Object.assign(row, patch); return structuredClone(row);
      },
    },
    threadMessage: {
      count: async ({ where }: any) => messages.filter((m) => messageMatches(m, where)).length,
      findMany: async ({ where, skip = 0, take = 100 }: any) => messages.filter((m) => messageMatches(m, where))
        .sort((a, b) => a.createdAt - b.createdAt).slice(skip, skip + take).map((m) => structuredClone(m)),
      findFirst: async ({ where, include }: any) => {
        const row = messages.filter((m) => messageMatches(m, where)).sort((a, b) => b.createdAt - a.createdAt)[0];
        if (!row) return null;
        return { ...structuredClone(row), ...(include?.thread ? {
          thread: withThreadRelations(threads.find((thread) => thread.id === row.threadId), include.thread.include),
        } : {}) };
      },
      create: async ({ data }: any) => {
        const row = { id: 'message-' + (++nextId), createdAt: new Date(), ...data }; messages.push(row); return structuredClone(row);
      },
      update: async ({ where, data }: any) => {
        const row = messages.find((message) => message.id === where.id)!; Object.assign(row, data); return row;
      },
      updateMany: async ({ where, data }: any) => {
        const matching = messages.filter((m) => messageMatches(m, where));
        matching.forEach((m) => Object.assign(m, data)); return { count: matching.length };
      },
    },
    patientAuditLog: { create: async () => ({}) },
    // No protected (Part 2 / VIP) records in this fixture: the staff thread reads check them
    sensitiveRecord: { findFirst: async () => null, findMany: async () => [] },
    client: { findUnique: async () => ({ id: ctx.clientId, name: ctx.name, checkInStreak: 0 }) },
    checkIn: { findFirst: async () => null, findMany: async () => [] },
    treatmentPlan: { findFirst: async () => null },
    riskAlert: { findMany: async () => [] },
    clinicModuleState: { findUnique: async () => ({ data: [{
      clientName: ctx.name, ...(linkedSafetyPlan ? { clientId: ctx.clientId } : {}),
      steps: [{ content: 'Synthetic plan' }], clientSigned: true,
    }] }) },
    $transaction: async (work: any) => {
      if (Array.isArray(work)) return Promise.all(work);
      const beforeThreads = structuredClone(threads), beforeMessages = structuredClone(messages);
      try { return await work(db); } catch (error) { threads = beforeThreads; messages = beforeMessages; throw error; }
    },
  };
  const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
  const originalLoad = loader._load;
  loader._load = function (id, ...args) {
    if (id === '@/lib/db/prisma') return { prisma: db };
    if (id === '@/patient/application/auth/session') return { requirePatient: async (req: Request) => {
      if (req.headers.get('authorization') !== 'Bearer synthetic') throw new PatientAppError('Sign in required', 401, 'unauthenticated');
      return ctx;
    } };
    if (id === '@/patient/infrastructure/persistence/patient-context') return { loadPatientContext: async () => ctx };
    if (id === '@/patient/application/appointments/service') return { getNextPatientAppointment: async () => null };
    return originalLoad.call(this, id, ...args);
  };
  const require = createRequire(import.meta.url);
  let service: typeof import('../src/patient/application/messages/service');
  let staff: typeof import('../src/lib/messages/manage');
  let dashboard: typeof import('../src/patient/application/dashboard/service');
  let route: typeof import('../src/app/api/patient/conversations/[id]/messages/route');
  let conversations: typeof import('../src/app/api/patient/conversations/route');
  let read: typeof import('../src/app/api/patient/messages/[id]/read/route');
  try {
    service = require('../src/patient/application/messages/service');
    staff = require('../src/lib/messages/manage');
    dashboard = require('../src/patient/application/dashboard/service');
    route = require('../src/app/api/patient/conversations/[id]/messages/route');
    conversations = require('../src/app/api/patient/conversations/route');
    read = require('../src/app/api/patient/messages/[id]/read/route');
  } finally { loader._load = originalLoad; }
  const actor = { threadId: 'own', organizationId: 'clinic', actorUserId: 'doctor', actorRole: 'THERAPIST' as const, actorName: 'Synthetic Doctor' };
  const request = (method: string, data?: unknown, query = '') => new Request('https://example.test/api/patient/conversations' + query, {
    method, headers: { Authorization: 'Bearer synthetic' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  const params = (id: string) => ({ params: Promise.resolve({ id }) });

  await t.test('thread previews, counts and messages exclude clinician-only notes', async () => {
    const list = await service.listPatientConversations(ctx);
    assert.equal(list.length, 1);
    assert.equal(list[0].lastMessage, 'Shared reply');
    assert.equal(list[0].unreadCount, 1);
    const data = await service.listPatientMessages(ctx, 'own', 0, 20);
    assert.equal(data.pagination.total, 2);
    assert.equal(data.conversation.unreadCount, 1);
    assert.deepEqual(data.messages.map((m) => m.id), ['patient-message', 'doctor-message']);
    assert.equal(JSON.stringify(data).includes('INTERNAL NOTE'), false);
    assert.equal(messages.find((m) => m.id === 'doctor-message').read, false);
  });

  await t.test('dashboard preview is shared chat and name-only safety plans are not matched', async () => {
    const data = await dashboard.buildPatientDashboard(ctx);
    assert.equal(data.latestConversation.preview, 'Shared reply');
    assert.equal(data.unreadMessageCount, 1);
    assert.deepEqual(data.safetyPlan, { available: false, clientSigned: false });
    assert.equal(JSON.stringify(data).includes('INTERNAL NOTE'), false);
    linkedSafetyPlan = true;
    assert.equal((await dashboard.buildPatientDashboard(ctx)).safetyPlan.available, true);
  });

  await t.test('other patients and clinics cannot be read or messaged by ID', async () => {
    for (const id of ['another-patient', 'another-clinic', 'missing']) {
      assert.equal((await route.GET(request('GET'), params(id))).status, 404);
      assert.equal((await route.POST(request('POST', { message: 'Hello' }), params(id))).status, 404);
    }
    for (const id of ['other-message', 'private-message', 'patient-message']) {
      assert.equal((await read.PATCH(request('PATCH'), params(id))).status, 404);
    }
    const unauthorized = await route.GET(new Request('https://example.test'), params('own'));
    assert.equal(unauthorized.status, 401);
  });

  await t.test('invalid topics, blank messages, JSON and fractional pagination yield JSON errors', async () => {
    assert.equal((await conversations.POST(request('POST', { topic: 'invalid', message: 'Hello' }))).status, 400);
    assert.equal((await route.POST(request('POST', { message: '  ' }), params('own'))).status, 400);
    assert.equal((await route.GET(request('GET', undefined, '?page=1.5'), params('own'))).status, 400);
    const malformed = new Request('https://example.test', { method: 'POST', headers: { Authorization: 'Bearer synthetic' }, body: '{' });
    const res = await route.POST(malformed, params('own'));
    assert.equal(res.status, 400); assert.equal((await res.json()).error.code, 'VALIDATION_ERROR');
  });

  await t.test('patient sends to shared staff inbox, staff reply starts unread, patient acknowledges it', async () => {
    const created = await service.createPatientConversation(ctx, { topic: 'clinical', message: 'New question' });
    assert.equal(created.assignedStaff, ctx.assignedClinicianName);
    assert.equal(created.unreadCount, 0);
    const newMessage = messages.find((m) => m.threadId === created.id);
    assert.equal(newMessage.read, false);
    const outgoing = await service.sendPatientMessage(ctx, 'own', 'Follow-up');
    assert.equal(outgoing.read, false);
    assert.equal(threads.find((thread) => thread.id === 'own').unreadCount, 2);
    const staffView = await staff.listThreadMessages(actor);
    assert.equal(staffView.ok, true);
    if (staffView.ok) assert.equal(staffView.messages.some((m) => m.id === outgoing.id), true);
    const reply = await staff.sendThreadMessage({ ...actor, content: 'Doctor reply' });
    assert.equal(reply.ok, true);
    if (!reply.ok) throw new Error('Expected successful reply');
    assert.equal(reply.message.read, false);
    assert.equal((await service.listPatientConversations(ctx)).find((thread) => thread.id === 'own').unreadCount, 2);
    assert.deepEqual(await service.markPatientMessageRead(ctx, reply.message.id), { id: reply.message.id, read: true });
    assert.deepEqual(await service.markPatientMessageRead(ctx, reply.message.id), { id: reply.message.id, read: true });
    assert.equal((await service.listPatientConversations(ctx)).find((thread) => thread.id === 'own').unreadCount, 1);
    await staff.markThreadRead(actor);
    assert.equal(messages.find((m) => m.id === outgoing.id).read, true);
    assert.equal(messages.find((m) => m.id === 'doctor-message').read, false);
  });

  await t.test('staff and patient message writes roll back if thread update fails', async () => {
    failThreadUpdate = true;
    const count = messages.length;
    await assert.rejects(() => service.sendPatientMessage(ctx, 'own', 'Should roll back'));
    assert.equal(messages.length, count);
    await assert.rejects(() => staff.sendThreadMessage({ ...actor, content: 'Should roll back' }));
    assert.equal(messages.length, count);
    failThreadUpdate = false;
  });
});
