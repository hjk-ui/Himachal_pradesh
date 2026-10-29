import { NextResponse } from 'next/server';
import { checkMedicationReminders } from '@/lib/notifications/triggers/medicationScheduler';
import { checkAppointmentReminders } from '@/lib/notifications/triggers/appointmentScheduler';
import { checkDailyCheckIns } from '@/lib/notifications/triggers/checkInScheduler';

export const dynamic = 'force-dynamic';

/**
 * GET/POST /api/cron/notifications
 * Executes automated notification checks:
 * 1. Medication dose reminders (time window match)
 * 2. Appointment reminders (24h, 1h, 15m)
 * 3. Daily check-in prompts (once per day)
 */
async function runScheduler(req: Request) {
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET?.trim();

  // Fail closed: cron must present Bearer CRON_SECRET (unset secret = reject)
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date();

  const [medications, appointments, checkIns] = await Promise.all([
    checkMedicationReminders(now),
    checkAppointmentReminders(now),
    checkDailyCheckIns(now),
  ]);

  // Nightly eligibility stays OFF unless an org explicitly enables it (default false).
  // Cron is org-agnostic here; per-org jobs should read getOvernightEligibilitySettings.
  const eligibility = {
    ran: false,
    reason: 'Nightly automatic eligibility stays off until enabled after Waystar production is live.',
  };

  return NextResponse.json({
    success: true,
    timestamp: now.toISOString(),
    results: {
      medications,
      appointments,
      checkIns,
      eligibility,
    },
  });
}

export async function GET(req: Request) {
  return runScheduler(req);
}

export async function POST(req: Request) {
  return runScheduler(req);
}
