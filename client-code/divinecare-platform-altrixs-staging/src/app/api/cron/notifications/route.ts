import { NextResponse } from 'next/server';
import { withIntegrationCall } from '@/lib/integrations/callLog/record';
import { checkMedicationReminders } from '@/lib/notifications/triggers/medicationScheduler';
import { checkAppointmentReminders } from '@/lib/notifications/triggers/appointmentScheduler';
import { checkDailyCheckIns } from '@/lib/notifications/triggers/checkInScheduler';
import { runSmsEmailReminders } from '@/lib/notifications/triggers/smsEmailReminders';
import { runReportSchedules } from '@/lib/reports/library/saved';
import { runScribeRetention } from '@/lib/scribe/retentionJob';

export const dynamic = 'force-dynamic';

/**
 * GET/POST /api/cron/notifications
 * Executes automated notification checks:
 * 1. Medication dose reminders (time window match)
 * 2. Appointment reminders: push (24h, 1h, 15m) and SMS / email per practice settings
 *    (smsReminder24h, smsReminder2h, emailReminder24h), with consent + opt-out checks
 * 3. Daily check-in prompts (once per day)
 * 4. Scheduled report library deliveries (email with a sign-in link only, no PHI)
 * 5. AI Scribe transcript retention: delete transcripts N days after the note is signed
 */
async function runScheduler(req: Request) {
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET?.trim();

  // Fail closed: cron must present Bearer CRON_SECRET (unset secret = reject)
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date();

  const [medications, appointments, checkIns, appointmentSmsEmail, reportSchedules, scribeRetention] = await withIntegrationCall(
    { integration: 'cron', operation: 'notifications-scheduler', direction: 'job' },
    () => Promise.all([
    checkMedicationReminders(now),
    checkAppointmentReminders(now),
    checkDailyCheckIns(now),
    runSmsEmailReminders(now),
    // A report-schedule failure must not stop the patient reminders above
    runReportSchedules(now).catch((err) => ({ error: err instanceof Error ? err.name : 'unknown' })),
    runScribeRetention(now).catch((err) => ({ error: err instanceof Error ? err.name : 'unknown' })),
  ]));

  return NextResponse.json({
    success: true,
    timestamp: now.toISOString(),
    results: {
      medications,
      appointments,
      appointmentSmsEmail,
      checkIns,
      reportSchedules,
      scribeRetention,
    },
  });
}

export async function GET(req: Request) {
  return runScheduler(req);
}

export async function POST(req: Request) {
  return runScheduler(req);
}
