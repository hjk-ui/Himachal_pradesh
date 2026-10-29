import assert from 'node:assert/strict';
import { test } from 'node:test';
import Module, { createRequire } from 'node:module';

test('Forward and Resolve clinical workflow operates end-to-end', async (t) => {
  let threads: any[] = [
    {
      id: 'thread-vishal',
      clientId: 'client-vishal',
      clientName: 'Vishal',
      organizationId: 'clinic-1',
      topic: 'GENERAL',
      status: 'IN_PROGRESS',
      risk: 'LOW',
      assignedStaff: 'Front Office',
      forwardedTo: null,
      lastMessage: 'I need medication advice',
      lastMessageAt: new Date(),
      unreadCount: 0,
      client: { id: 'client-vishal', assignedToId: 'doctor-old' },
    },
  ];

  let messages: any[] = [
    {
      id: 'msg-1',
      threadId: 'thread-vishal',
      senderType: 'PATIENT',
      senderName: 'Vishal',
      content: 'I need medication advice',
      read: true,
      createdAt: new Date(),
    },
  ];

  const db = {
    user: {
      findUnique: async ({ where }: any) => {
        if (where.id === 'doctor-new') {
          return { id: 'doctor-new', name: 'Dr. Sarah Jenkins', email: 'sarah@clinic.test', role: 'CLINICIAN' };
        }
        return null;
      },
      findFirst: async () => null,
    },
    messageThread: {
      findFirst: async ({ where }: any) => {
        return threads.find((t) => {
          if (where.id && t.id !== where.id) return false;
          if (where.organizationId && t.organizationId !== where.organizationId) return false;
          return true;
        }) || null;
      },
      findMany: async ({ where }: any) => {
        return threads.filter((t) => {
          if (where.organizationId && t.organizationId !== where.organizationId) return false;
          if (where.OR) {
            const matchesOr = where.OR.some((cond: any) => {
              if (cond.forwardedTo?.contains && t.forwardedTo?.includes(cond.forwardedTo.contains)) return true;
              if (cond.client?.AND?.[1]?.assignedToId && t.client?.assignedToId === cond.client.AND[1].assignedToId) return true;
              return false;
            });
            return matchesOr;
          }
          return true;
        });
      },
      update: async ({ where, data }: any) => {
        const row = threads.find((t) => t.id === where.id);
        if (!row) throw new Error('Thread not found');
        Object.assign(row, data);
        return structuredClone(row);
      },
    },
    threadMessage: {
      create: async ({ data }: any) => {
        const msg = { id: `msg-${messages.length + 1}`, ...data };
        messages.push(msg);
        return msg;
      },
      findMany: async ({ where }: any) => messages.filter((m) => m.threadId === where.threadId),
      count: async () => 0,
    },
  };

  const loader = Module as any;
  const originalLoad = loader._load;
  loader._load = function (id: string, ...args: any[]) {
    if (id === '@/lib/db/prisma') return { prisma: db };
    return originalLoad.call(this, id, ...args);
  };

  const require = createRequire(import.meta.url);
  let manage: typeof import('../src/lib/messages/manage');
  try {
    manage = require('../src/lib/messages/manage');
  } finally {
    loader._load = originalLoad;
  }

  await t.test('Front office forwards thread to Dr. Sarah Jenkins with internal note', async () => {
    const adminActor = {
      threadId: 'thread-vishal',
      organizationId: 'clinic-1',
      actorUserId: 'admin-1',
      actorRole: 'ADMIN' as const,
      actorName: 'Clinic Admin',
    };

    const res = await manage.patchMessageThread({
      ...adminActor,
      forwardedTo: 'Dr. Sarah Jenkins',
      forwardNote: 'Patient asking about SSRI side-effects, please review chart.',
    });

    assert.equal(res.ok, true);
    if (!res.ok) return;

    assert.equal(res.thread.status, 'forwarded');
    assert.equal(res.thread.forwardedTo, 'Dr. Sarah Jenkins');

    // Verify internal clinician note was recorded
    const note = messages.find((m) => m.senderType === 'CLINICIAN_NOTE');
    assert.ok(note);
    assert.equal(note.content, 'Patient asking about SSRI side-effects, please review chart.');
    assert.equal(note.senderName, 'Clinic Admin');
  });

  await t.test('Forwarded thread appears in recipient clinician inbox', async () => {
    const clinicianActor = {
      organizationId: 'clinic-1',
      actorUserId: 'doctor-new',
      actorRole: 'CLINICIAN' as const,
    };

    const list = await manage.listMessageThreads(clinicianActor);
    assert.equal(list.length, 1);
    assert.equal(list[0].id, 'thread-vishal');
    assert.equal(list[0].forwardedTo, 'Dr. Sarah Jenkins');
    assert.equal(list[0].status, 'forwarded');

    // Recipient clinician can access the thread details
    const thread = await manage.getThreadForActor('thread-vishal', clinicianActor);
    assert.ok(thread);
    assert.equal(thread.id, 'thread-vishal');
  });

  await t.test('Staff can mark thread as resolved and verify status', async () => {
    const adminActor = {
      threadId: 'thread-vishal',
      organizationId: 'clinic-1',
      actorUserId: 'admin-1',
      actorRole: 'ADMIN' as const,
    };

    const res = await manage.patchMessageThread({
      ...adminActor,
      status: 'resolved',
    });

    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(res.thread.status, 'resolved');
  });
});
