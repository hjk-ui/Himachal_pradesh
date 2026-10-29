import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/lib/db/prisma';
import {
  recordPatientNotification,
  listPatientNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  getUnreadNotificationCount,
  deletePatientNotification,
} from '../src/patient/application/notifications/service';
import { OPTIONS as notificationsOptions } from '../src/app/api/patient/notifications/route';
import { OPTIONS as readOptions } from '../src/app/api/patient/notifications/[id]/read/route';
import { OPTIONS as readAllOptions } from '../src/app/api/patient/notifications/read-all/route';

test('Persistent Patient Notification History Suite', async (t) => {
  let client = null;
  try {
    client = await prisma.client.findFirst({
      select: { id: true, organizationId: true },
    });
  } catch {
    console.log('Skipping database-dependent tests: Database unreachable');
    return;
  }

  if (!client) {
    console.log('Skipping database-dependent tests: No clients found in database');
    return;
  }

  const clientId = client.id;
  const orgId = client.organizationId;
  if (!orgId) {
    console.log('Skipping database-dependent tests: Client has no organization');
    return;
  }
  const owner = { clientId, organizationId: orgId };
  let createdNotifId1: string | null = null;
  let createdNotifId2: string | null = null;

  await t.test('1. CORS OPTIONS endpoints respond with PATIENT_CORS headers', () => {
    const res1 = notificationsOptions();
    assert.equal(res1.status, 204);
    assert.equal(res1.headers.get('Access-Control-Allow-Origin'), '*');

    const res2 = readOptions();
    assert.equal(res2.status, 204);

    const res3 = readAllOptions();
    assert.equal(res3.status, 204);
  });

  await t.test('2. recordPatientNotification creates unread persistent notification', async () => {
    const notif1 = await recordPatientNotification({
      clientId,
      organizationId: orgId,
      type: 'appointment_reminder',
      title: 'Upcoming Appointment',
      body: 'You have a therapy session tomorrow at 10:00 AM',
      data: { appointmentId: 'appt-test-123', type: 'appointment' },
    });

    assert.ok(notif1?.id);
    assert.equal(notif1.clientId, clientId);
    assert.equal(notif1.title, 'Upcoming Appointment');
    assert.equal(notif1.isRead, false);
    createdNotifId1 = notif1.id;

    const notif2 = await recordPatientNotification({
      clientId,
      organizationId: orgId,
      type: 'medication_reminder',
      title: 'Medication Time',
      body: 'Time to take Sertraline 50mg',
      data: { medicationId: 'med-test-456' },
      dedupeKey: `patient-notification-test:${clientId}:med-test-456`,
    });

    assert.ok(notif2?.id);
    assert.equal(notif2.isRead, false);
    createdNotifId2 = notif2.id;

    const duplicate = await recordPatientNotification({
      clientId,
      organizationId: orgId,
      type: 'medication_reminder',
      title: 'Medication Time',
      body: 'Time to take Sertraline 50mg',
      data: { medicationId: 'med-test-456' },
      dedupeKey: `patient-notification-test:${clientId}:med-test-456`,
    });
    assert.equal(duplicate?.id, notif2.id);
  });

  await t.test('3. listPatientNotifications returns formatted notifications with aliases', async () => {
    const res = await listPatientNotifications(owner, { limit: 10 });
    assert.ok(Array.isArray(res.notifications));
    assert.ok(res.total >= 2);
    assert.ok(res.unreadCount >= 2);

    const found = res.notifications.find((n) => n.id === createdNotifId1);
    assert.ok(found);
    assert.equal(found.isRead, false);
    assert.equal(found.is_read, false);
    assert.equal(found.message, 'You have a therapy session tomorrow at 10:00 AM');
    assert.equal(found.data?.appointmentId, 'appt-test-123');

    const crossTenant = await listPatientNotifications(
      { clientId, organizationId: `${orgId}-other` },
      { limit: 10 }
    );
    assert.equal(crossTenant.notifications.length, 0);
  });

  await t.test('4. markNotificationRead marks single notification as read with timestamp', async () => {
    assert.ok(createdNotifId1);
    const readRes = await markNotificationRead(owner, createdNotifId1!);
    assert.ok(readRes);
    assert.equal(readRes.isRead, true);
    assert.ok(readRes.readAt);

    const repeatedRead = await markNotificationRead(owner, createdNotifId1!);
    assert.equal(repeatedRead?.readAt, readRes.readAt);

    // Verify in database
    const fresh = await prisma.patientNotification.findUnique({
      where: { id: createdNotifId1! },
    });
    assert.equal(fresh?.isRead, true);
    assert.ok(fresh?.readAt);
  });

  await t.test('5. markAllNotificationsRead marks all remaining notifications as read', async () => {
    const allRes = await markAllNotificationsRead(owner);
    assert.equal(allRes.success, true);

    const unread = await getUnreadNotificationCount(owner);
    assert.equal(unread, 0);
  });

  await t.test('6. deletePatientNotification cleans up test records', async () => {
    if (createdNotifId1) {
      const del1 = await deletePatientNotification(owner, createdNotifId1);
      assert.equal(del1, true);
    }
    if (createdNotifId2) {
      const del2 = await deletePatientNotification(owner, createdNotifId2);
      assert.equal(del2, true);
    }
  });
});
