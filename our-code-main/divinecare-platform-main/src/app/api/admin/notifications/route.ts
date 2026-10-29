import { NextRequest, NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { prisma } from '@/lib/db/prisma';
import { getFirebaseAdmin } from '@/lib/notifications/firebaseAdmin';
import { sendToUser } from '@/lib/notifications/pushService';
import { checkMedicationReminders } from '@/lib/notifications/triggers/medicationScheduler';
import { checkAppointmentReminders } from '@/lib/notifications/triggers/appointmentScheduler';
import { checkDailyCheckIns } from '@/lib/notifications/triggers/checkInScheduler';
import { clientAccessWhere, clientByIdWhere, clientOrgFilter } from '@/lib/clients/orgScope';

function canTestNotifications(role: string) {
  return (
    role === 'ADMIN' ||
    role === 'PRACTICE_DIRECTOR' ||
    role === 'DIRECTOR' ||
    role === 'OFFICE_MANAGER'
  );
}

export async function GET(_req: NextRequest) {
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
    recentLogs: logs,
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

    // Staff-triggered scheduler (dashboard "Run cron") — session auth, not CRON_SECRET
    if (body.action === 'run_cron') {
      const now = new Date();
      const [medications, appointments, checkIns] = await Promise.all([
        checkMedicationReminders(now),
        checkAppointmentReminders(now),
        checkDailyCheckIns(now),
      ]);
      return NextResponse.json({
        success: true,
        timestamp: now.toISOString(),
        results: { medications, appointments, checkIns },
      });
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
      return NextResponse.json({ error: 'Patient not found' }, { status: 404 });
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

    const result = await sendToUser(client.id, {
      type: notifType,
      title,
      body: message,
      data: {
        route: notifType === 'medication_reminder' ? '/medications' : '/appointments',
      },
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error('[Admin Notification Test Error]:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 }
    );
  }
}
