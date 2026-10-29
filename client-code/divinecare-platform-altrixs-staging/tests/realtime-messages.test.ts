import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  publishRealtimeMessage,
  subscribeToThread,
  type RealtimeMessageEvent,
} from '../src/lib/messages/realtime';

test('realtime messaging engine delivers events instantly to thread subscribers', async (t) => {
  await t.test('subscribers receive published messages immediately', async () => {
    const threadId = 'test-thread-realtime-1';
    const received: RealtimeMessageEvent[] = [];

    const unsubscribe = subscribeToThread(threadId, (evt) => {
      received.push(evt);
    });

    const mockEvent: RealtimeMessageEvent = {
      type: 'new_message',
      threadId,
      senderType: 'FRONT_OFFICE',
      staffMessage: {
        id: 'msg-1',
        threadId,
        senderType: 'front-office',
        senderId: 'staff',
        senderName: 'Dr. Test',
        content: 'Instant message to patient',
        read: false,
        createdAt: new Date().toISOString(),
        timestamp: 'just now',
      },
      patientMessage: {
        id: 'msg-1',
        threadId,
        senderRole: 'clinician',
        senderName: 'Dr. Test',
        body: 'Instant message to patient',
        read: false,
        createdAt: new Date().toISOString(),
      },
    };

    publishRealtimeMessage(mockEvent);

    assert.equal(received.length, 1);
    assert.equal(received[0].staffMessage.content, 'Instant message to patient');
    assert.equal(received[0].patientMessage?.body, 'Instant message to patient');

    // Unsubscribe and ensure no further messages are received
    unsubscribe();
    publishRealtimeMessage(mockEvent);
    assert.equal(received.length, 1);
  });

  await t.test('thread channel isolation: other threads do not receive cross-talk', async () => {
    const threadA = 'thread-a-isolate';
    const threadB = 'thread-b-isolate';
    const receivedA: RealtimeMessageEvent[] = [];
    const receivedB: RealtimeMessageEvent[] = [];

    const unsubA = subscribeToThread(threadA, (evt) => receivedA.push(evt));
    const unsubB = subscribeToThread(threadB, (evt) => receivedB.push(evt));

    publishRealtimeMessage({
      type: 'new_message',
      threadId: threadA,
      senderType: 'PATIENT',
      staffMessage: {
        id: 'msg-a',
        threadId: threadA,
        senderType: 'patient',
        senderId: 'client',
        senderName: 'Patient A',
        content: 'Message for Thread A',
        read: false,
        createdAt: new Date().toISOString(),
        timestamp: 'just now',
      },
      patientMessage: {
        id: 'msg-a',
        threadId: threadA,
        senderRole: 'patient',
        senderName: 'Patient A',
        body: 'Message for Thread A',
        read: false,
        createdAt: new Date().toISOString(),
      },
    });

    assert.equal(receivedA.length, 1);
    assert.equal(receivedB.length, 0);

    unsubA();
    unsubB();
  });

  await t.test('clinician notes have undefined patientMessage for privacy', async () => {
    const threadId = 'thread-clinician-privacy';
    let receivedEvt: RealtimeMessageEvent | null = null;

    const unsub = subscribeToThread(threadId, (evt) => {
      receivedEvt = evt;
    });

    publishRealtimeMessage({
      type: 'new_message',
      threadId,
      senderType: 'CLINICIAN_NOTE',
      staffMessage: {
        id: 'note-1',
        threadId,
        senderType: 'clinician-note',
        senderId: 'clinician-note',
        senderName: 'Staff Note',
        content: 'Internal clinical consideration',
        read: true,
        createdAt: new Date().toISOString(),
        timestamp: 'just now',
      },
    });

    assert.ok(receivedEvt);
    assert.equal((receivedEvt as RealtimeMessageEvent).senderType, 'CLINICIAN_NOTE');
    assert.equal((receivedEvt as RealtimeMessageEvent).patientMessage, undefined);

    unsub();
  });
});
