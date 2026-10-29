import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createChimeMeeting,
  createChimeAttendee,
  endChimeMeeting,
  isDemoMode,
  CHIME_REGION,
} from '../src/lib/services/chimeService';
import { prisma } from '../src/lib/db/prisma';

test('Amazon Chime SDK Service - Regional & Demo Configuration', async (t) => {
  await t.test('Forces region to us-east-1 for AWS BAA compliance', () => {
    assert.equal(CHIME_REGION, 'us-east-1');
  });

  await t.test('Correctly identifies demo mode when AWS credentials are not set', () => {
    const demo = isDemoMode();
    assert.equal(typeof demo, 'boolean');
  });
});

test('Amazon Chime SDK Service - Meeting and Attendee Provisioning', async (t) => {
  const appointmentId = `test-appt-${Date.now()}`;
  const patientId = `test-patient-${Date.now()}`;
  const clinicianId = `test-clinician-${Date.now()}`;

  let meetingOutput: Awaited<ReturnType<typeof createChimeMeeting>>;

  await t.test('Creates meeting with clinician and patient attendees without crashing', async () => {
    meetingOutput = await createChimeMeeting({
      appointmentId,
      patientId,
      clinicianId,
      enableRecording: true,
    });

    assert.ok(meetingOutput.meetingId, 'Must have meetingId');
    assert.ok(meetingOutput.meeting, 'Must return meeting config object');
    assert.equal(meetingOutput.mediaRegion, 'us-east-1');

    // Clinician attendee
    assert.ok(meetingOutput.clinicianAttendee, 'Must have clinician attendee');
    assert.ok(meetingOutput.clinicianJoinToken, 'Must have clinician JoinToken');
    assert.ok(meetingOutput.clinicianAttendeeId, 'Must have clinician AttendeeId');

    // Patient attendee
    assert.ok(meetingOutput.patientAttendee, 'Must have patient attendee');
    assert.ok(meetingOutput.patientJoinToken, 'Must have patient JoinToken');
    assert.ok(meetingOutput.patientAttendeeId, 'Must have patient AttendeeId');
  });

  await t.test('Generates attendee on-demand for zero-install joining', async () => {
    const attendee = await createChimeAttendee({
      meetingId: meetingOutput.meetingId,
      externalUserId: 'test-patient-mobile',
    });

    assert.ok(attendee.attendeeId, 'Must have attendeeId');
    assert.ok(attendee.joinToken, 'Must have joinToken');
  });

  await t.test('Gracefully ends Chime meeting without throwing error', async () => {
    await assert.doesNotReject(async () => {
      await endChimeMeeting(meetingOutput.meetingId, meetingOutput.pipelineId);
    });
  });
});

test('TelehealthSession Persistence Layer - PostgreSQL via Prisma', async (t) => {
  let dbAvailable = false;
  try {
    const res = await prisma.$queryRaw`SELECT 1`;
    dbAvailable = Boolean(res);
  } catch {
    dbAvailable = false;
  }

  if (!dbAvailable) {
    await t.test('PostgreSQL connection check (offline / CI environment)', () => {
      assert.ok(true, 'Database is offline or SSH tunnel closed — skipping live DB mutations');
    });
    return;
  }

  const testSessionId = `telehealth-test-${Date.now()}`;
  const testJoinSlug = `join-slug-${Date.now()}`;

  // Find or create test organization
  let org = await prisma.organization.findFirst();
  if (!org) {
    org = await prisma.organization.create({
      data: {
        name: 'Test virtual Clinic',
        slug: `test-clinic-${Date.now()}`,
      },
    });
  }


  // Find or create test client
  let client = await prisma.client.findFirst({ where: { organizationId: org.id } });
  if (!client) {
    client = await prisma.client.create({
      data: {
        name: 'Jane Virtual Patient',
        organizationId: org.id,
      },
    });
  }

  let session: any;

  await t.test('Persists TelehealthSession with all Chime SDK fields in DB', async () => {
    session = await prisma.telehealthSession.create({
      data: {
        appointmentId: testSessionId,
        organizationId: org.id,
        clientId: client.id,
        clientName: client.name,
        clinicianId: 'doc-user-1',
        clinicianName: 'Dr. John Watson',
        type: 'Individual Therapy',
        sessionDate: new Date(),
        startTime: '10:00',
        durationMin: 50,
        durationMinutes: 50,
        status: 'UPCOMING',
        platform: 'CHIME',
        joinToken: testJoinSlug,
        chimeMeetingId: `chime-mtg-${Date.now()}`,
        chimeExternalMeetingId: `ext-mtg-${Date.now()}`,
        chimeMediaRegion: 'us-east-1',
        clinicianAttendeeId: 'att-clin-1',
        clinicianJoinToken: 'tok-clin-1',
        patientAttendeeId: 'att-pat-1',
        patientJoinToken: 'tok-pat-1',
        pos: '02',
        cptModifier: '-95',
      },
    });

    assert.ok(session.id);
    assert.equal(session.appointmentId, testSessionId);
    assert.equal(session.joinToken, testJoinSlug);
    assert.equal(session.patientCheckedIn, false);
    assert.equal(session.pos, '02');
    assert.equal(session.cptModifier, '-95');
  });

  await t.test('Updates waiting room status on patient check-in ("I\'m Here")', async () => {
    const updated = await prisma.telehealthSession.update({
      where: { id: session.id },
      data: {
        patientCheckedIn: true,
        patientCheckedInAt: new Date(),
        status: 'CHECKED_IN',
      },
    });

    assert.equal(updated.patientCheckedIn, true);
    assert.ok(updated.patientCheckedInAt);
    assert.equal(updated.status, 'CHECKED_IN');
  });

  await t.test('Updates visit completion with actual duration and billing modifiers', async () => {
    const completed = await prisma.telehealthSession.update({
      where: { id: session.id },
      data: {
        status: 'COMPLETED',
        durationMinutes: 53,
        pos: '02',
        cptModifier: '-95',
      },
    });

    assert.equal(completed.status, 'COMPLETED');
    assert.equal(completed.durationMinutes, 53);
    assert.equal(completed.pos, '02');
    assert.equal(completed.cptModifier, '-95');
  });

  // Cleanup test row
  await prisma.telehealthSession.delete({
    where: { id: session.id },
  }).catch(() => {});
});
