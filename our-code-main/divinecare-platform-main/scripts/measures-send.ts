/**
 * Measures-to-patients scheduled send (STUB — ops enables scheduling later).
 *
 * Finds ACTIVE measure assignments that are due (nextDueAt <= now) for practices that have
 * turned `mbcAutoSend` ON (practice:mbc-options; default OFF), and sends each patient link.
 *
 * DRY-RUN BY DEFAULT: nothing is created or sent unless --apply is passed.
 *
 * Usage:
 *   npx tsx scripts/measures-send.ts                    # dry-run, prints the plan
 *   npx tsx scripts/measures-send.ts --org <orgId>      # limit to one practice
 *   npx tsx scripts/measures-send.ts --apply            # create links + deliver
 *
 * Output lists ids only (no names, contact details, or tokens).
 * Auto-send tries email first, then SMS (SMS only with consent). It never invents a channel.
 */
import 'dotenv/config';
import { prisma } from '../src/lib/db/prisma';
import { getMbcOptions } from '../src/lib/measures/options';
import { checkSendEligibility, sendMeasure, type MeasureChannel } from '../src/lib/measures/send';
import { isKnownSelfReportInstrument, itemContentPendingFor } from '../src/lib/measures/instruments';
import { patientSmsAllowed } from '../src/lib/sms/patient-gate';

type Outcome = { assignmentId: string; clientId: string; channel?: MeasureChannel; result: string };

function advance(frequency: string, from: Date): { status?: 'completed'; nextDueAt: Date | null } {
  const d = new Date(from);
  switch (frequency) {
    case 'once':
      return { status: 'completed', nextDueAt: null };
    case 'weekly':
      d.setDate(d.getDate() + 7);
      return { nextDueAt: d };
    case 'biweekly':
      d.setDate(d.getDate() + 14);
      return { nextDueAt: d };
    case 'monthly':
      d.setMonth(d.getMonth() + 1);
      return { nextDueAt: d };
    default:
      // every_visit is driven by visit rules, not the clock.
      return { nextDueAt: null };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const orgIdx = args.indexOf('--org');
  const onlyOrg = orgIdx >= 0 ? args[orgIdx + 1] : undefined;
  const now = new Date();

  const orgs = await prisma.organization.findMany({
    where: { active: true, ...(onlyOrg ? { id: onlyOrg } : {}) },
    select: { id: true },
  });

  const outcomes: Outcome[] = [];
  let skippedOrgs = 0;

  for (const org of orgs) {
    const options = await getMbcOptions(org.id);
    if (!options.mbcAutoSend) {
      skippedOrgs += 1;
      continue;
    }
    const due = await prisma.measureAssignment.findMany({
      where: {
        organizationId: org.id,
        status: 'active',
        itemContentPending: false,
        nextDueAt: { lte: now },
        client: { status: 'ACTIVE' },
      },
      select: {
        id: true,
        clientId: true,
        instrumentKey: true,
        frequency: true,
        nextDueAt: true,
        client: { select: { email: true, phone: true, dateOfBirth: true } },
      },
      take: 500,
    });

    for (const a of due) {
      const sms = await patientSmsAllowed(a.clientId);
      const channel = (['email', 'sms'] as const).find(
        (c) =>
          !checkSendEligibility({
            channel: c,
            instrumentKnown: isKnownSelfReportInstrument(a.instrumentKey),
            itemContentPending: itemContentPendingFor(a.instrumentKey),
            assignmentStatus: 'active',
            hasDob: Boolean(a.client.dateOfBirth),
            email: a.client.email,
            phone: a.client.phone,
            smsAllowed: c === 'sms' ? sms : null,
          })
      );
      if (!channel) {
        outcomes.push({ assignmentId: a.id, clientId: a.clientId, result: 'skipped: no eligible channel' });
        continue;
      }
      if (!apply) {
        outcomes.push({ assignmentId: a.id, clientId: a.clientId, channel, result: 'would send' });
        continue;
      }
      const sent = await sendMeasure({
        organizationId: org.id,
        clientId: a.clientId,
        instrumentKey: a.instrumentKey,
        channel,
        assignmentId: a.id,
        now,
      });
      if (sent.ok) {
        const next = advance(a.frequency, a.nextDueAt ?? now);
        await prisma.measureAssignment.update({
          where: { id: a.id },
          data: { nextDueAt: next.nextDueAt, ...(next.status ? { status: next.status } : {}) },
        });
      }
      outcomes.push({
        assignmentId: a.id,
        clientId: a.clientId,
        channel,
        result: sent.ok === true ? 'sent' : `not sent: ${sent.reason}`,
      });
    }
  }

  console.log(
    JSON.stringify(
      { mode: apply ? 'apply' : 'dry-run', orgsScanned: orgs.length, orgsAutoSendOff: skippedOrgs, outcomes },
      null,
      2
    )
  );
  if (!apply) console.log('Dry-run only. Re-run with --apply to send.');
}

main()
  .catch((err) => {
    console.error('[measures-send] failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
