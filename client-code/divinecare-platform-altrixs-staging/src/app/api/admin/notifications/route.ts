import { NextRequest, NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { prisma } from '@/lib/db/prisma';
import { getFirebaseAdmin } from '@/lib/notifications/firebaseAdmin';
import { sendToUser } from '@/lib/notifications/pushService';
import { clientAccessWhere, clientByIdWhere, clientOrgFilter } from '@/lib/clients/orgScope';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { canSeeMedicationReminderDetails, maskNotificationLog, medicationPushDenied } from '@/lib/notifications/medicationMasking';

function canTestNotifications(role: string) {
  return (
    role === 'ADMIN' ||
    role === 'PRACTICE_DIRECTOR' ||
    role === 'DIRECTOR' ||
    role === 'OFFICE_MANAGER'
  );
}

export async function GET(req: NextRequest) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  if (!canTestNotifications(gate.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { app, isMock } = getFirebaseAdmin();
  const orgClients = clientOrgFilter(gate.organizationId);

  const deviceCount = await prisma.deviceToken.count({
    where: { client: orgClients },
  });

  const clientsWithTokens = await prisma.client.findMany({
    where: {
      AND: [orgClients, { deviceTokens: { some: {} } }],
    },
    select: {
      id: true,
      name: true,
      deviceTokens: {
        select: {
          id: true,
          platform: true,
          createdAt: true,
        },
      },
    },
    take: 20,
  });

  const allClients = await prisma.client.findMany({
    where: orgClients,
    select: {
      id: true,
      name: true,
      deviceTokens: { select: { id: true, platform: true } },
    },
    orderBy: { name: 'asc' },
    take: 50,
  });

  const logs = await prisma.notificationLog.findMany({
    where: { client: orgClients },
    orderBy: { sentAt: 'desc' },
    take: 15,
  });

  // Medication names / doses / instructions only for canViewClientMedications (not Office Manager).
  const medicationDetails = canSeeMedicationReminderDetails(gate.role);
  const recentLogs = logs.map((log) => maskNotificationLog(log, gate.role));

  await auditPhiAccess({
    gate,
    req,
    action: 'LIST',
    resourceType: 'notificationDevice',
    metadata: {
      medicationDetailsMasked: !medicationDetails,
      count: allClients.length,
      clientsWithTokensCount: clientsWithTokens.length,
      notificationLogCount: logs.length,
      clientIds: allClients.slice(0, 50).map((c) => c.id),
    },
  });

  return NextResponse.json({
    success: true,
    firebase: {
      configured: !isMock && !!app,
      isMock,
      projectId: process.env.FIREBASE_PROJECT_ID || null,
      // Do not expose full service-account email fingerprint to non-platform UIs
      configuredEmail: Boolean(process.env.FIREBASE_CLIENT_EMAIL),
      appName: app?.name || null,
    },
    stats: {
      totalRegisteredDevices: deviceCount,
      patientsWithDevices: clientsWithTokens.length,
    },
    clientsWithTokens,
    allClients,
    recentLogs,
    /** false: medication reminder rows are masked (masked: true) and medication pushes are refused. */
    medicationDetails,
  });
}

export async function POST(req: NextRequest) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  if (!canTestNotifications(gate.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await req.json();

    // The reminder schedulers sweep every organization, so staff may not trigger them from a
    // clinic session (cross-tenant counts and errors). They run only through
    // GET /api/cron/notifications behind CRON_SECRET.
    if (body.action === 'run_cron') {
      await auditPhiAccess({ gate, req, action: 'CREATE', resourceType: 'notification', outcome: 'DENIED', metadata: { reason: 'run_cron_removed', trigger: 'run_cron' } });
      return NextResponse.json(
        { error: 'Running the reminder schedulers from the dashboard is no longer supported. They run automatically on the server schedule.' },
        { status: 410 }
      );
    }

    const {
      clientId,
      type = 'medication_reminder',
      title = 'Altrixs Live Test',
      message = 'This is a test notification from Altrixs Dashboard.',
    } = body;

    // Raw FCM token push disabled — prevents cross-tenant / arbitrary device spam
    if (body.token) {
      return NextResponse.json(
        {
          error:
            'Raw FCM token push is disabled for security. Send by clientId within your organization only.',
        },
        { status: 403 }
      );
    }

    const allowedTypes = [
      'medication_reminder',
      'appointment_reminder',
      'check_in_reminder',
      'telehealth_call',
      'chat_message',
    ] as const;
    type Allowed = (typeof allowedTypes)[number];
    const notifType: Allowed = allowedTypes.includes(type as Allowed)
      ? (type as Allowed)
      : 'medication_reminder';

    // A medication push writes drug wording to the phone and NotificationLog: canViewClientMedications only.
    if (medicationPushDenied(gate.role, notifType)) {
      await auditPhiAccess({ gate, req, action: 'CREATE', resourceType: 'notification', resourceId: typeof clientId === 'string' ? clientId : undefined, outcome: 'DENIED', metadata: { reason: 'medication_details_not_permitted', trigger: 'test_push', type: notifType } });
      return NextResponse.json(
        { error: 'Your role cannot send medication reminders. Choose another notification type.', code: 'MEDICATION_DETAILS_NOT_PERMITTED' },
        { status: 403 }
      );
    }

    if (!clientId || typeof clientId !== 'string') {
      return NextResponse.json(
        { error: 'Please provide a clientId from your organization' },
        { status: 400 }
      );
    }

    const access = clientAccessWhere({
      organizationId: gate.organizationId,
      actorUserId: gate.userId,
      actorRole: gate.role,
    });
    const client = await prisma.client.findFirst({
      where: { AND: [clientByIdWhere(clientId, gate.organizationId), access] },
      select: { id: true },
    });
    if (!client) {
      await auditPhiAccess({ gate, req, action: 'CREATE', resourceType: 'notification', resourceId: clientId, patientId: clientId, outcome: 'DENIED', metadata: { reason: 'client_not_accessible', trigger: 'test_push' } });
      return NextResponse.json({ error: 'Patient not found' }, { status: 404 });
    }

    const result = await sendToUser(client.id, {
      type: notifType,
      title,
      body: message,
      data: {
        route: notifType === 'medication_reminder' ? '/medications' : '/appointments',
      },
    });

    await auditPhiAccess({ gate, req, action: 'CREATE', resourceType: 'notification', resourceId: client.id, patientId: client.id, metadata: { trigger: 'test_push', type: notifType } });

    return NextResponse.json(result);
  } catch (err) {
    console.error('[Admin Notification Test Error]:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 }
    );
  }
}
