/**
 * Automatic overnight eligibility checks: database side (run by scripts/eligibility-nightly.ts).
 * Rules: src/lib/eligibility/nightly.ts. Sends through requestWaystarEligibility, the same 270 path
 * as the eligibility page and the Waystar batch route. Prints / returns counts only (no PHI).
 */
import { prisma } from '@/lib/db/prisma';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { appointmentOrgWhere } from '@/lib/appointments/duplicates';
import { appointmentFilterFacets } from '@/lib/appointments/listFacets';
import { detectMarylandMedicaid } from '@/lib/consents/carelon/medicaid';
import { addDaysYmd, practiceDayBounds } from '@/lib/dashboard/practiceDay';
import { practiceToday, toPracticeWallTime } from '@/lib/time/practiceTime';
import { getPracticeTimeZone } from '@/lib/time/practiceTimeServer';
import type { FoEligibilityFact } from '@/lib/frontOffice/rules';
import { eligibilityResponseFacts } from './manage';
import { eligibilityChannels, requestWaystarEligibility } from './waystar';
import {
  NIGHTLY_SETTING_LABEL,
  chunkInquiries,
  nightlyGate,
  selectNightlyInquiries,
  type NightlyAppointment,
  type NightlySettings,
} from './nightly';

export async function loadNightlySettings(organizationId: string): Promise<NightlySettings & { updatedAt: string | null }> {
  const row = await prisma.practiceSettings.findUnique({
    where: { organizationId },
    select: { eligibilityNightlyEnabled: true, eligibilityNightlyAllowTest: true, eligibilityNightlyUpdatedAt: true },
  });
  return {
    enabled: row?.eligibilityNightlyEnabled ?? false,
    allowTest: row?.eligibilityNightlyAllowTest ?? false,
    updatedAt: row?.eligibilityNightlyUpdatedAt?.toISOString() ?? null,
  };
}

export async function saveNightlySettings(organizationId: string, userId: string, input: Partial<NightlySettings>) {
  const data = {
    ...(input.enabled !== undefined ? { eligibilityNightlyEnabled: input.enabled } : {}),
    ...(input.allowTest !== undefined ? { eligibilityNightlyAllowTest: input.allowTest } : {}),
    eligibilityNightlyUpdatedBy: userId,
    eligibilityNightlyUpdatedAt: new Date(),
  };
  await prisma.practiceSettings.upsert({ where: { organizationId }, create: { organizationId, ...data }, update: data });
  return loadNightlySettings(organizationId);
}

export type NightlyRunCounts = {
  organizationId: string;
  apply: boolean;
  status: 'ran' | 'skipped';
  skipReason?: string;
  visitDate?: string;
  appointments: number;
  selected: number;
  sent: number;
  failed: number;
  files: number;
  reasons?: Record<string, number>;
  skipped?: Record<string, number>;
};

/** One organization: gate, select tomorrow's stale coverage, send (only with apply), audit. */
export async function runNightlyEligibility(input: { organizationId: string; apply: boolean; now?: Date }): Promise<NightlyRunCounts> {
  const now = input.now ?? new Date();
  const org = input.organizationId;
  const base: NightlyRunCounts = { organizationId: org, apply: input.apply, status: 'skipped', appointments: 0, selected: 0, sent: 0, failed: 0, files: 0 };

  const settings = await loadNightlySettings(org);
  const channels = eligibilityChannels();
  const gate = nightlyGate({ settings, waystarActive: channels.waystar, usageIndicator: channels.usageIndicator });
  if (gate.run === false) return { ...base, skipReason: gate.reason };

  const tz = await getPracticeTimeZone(org);
  const visitDate = addDaysYmd(practiceToday(tz, now), 1);
  const { start, end } = practiceDayBounds(visitDate, tz);
  const appts = await prisma.appointment.findMany({
    where: { AND: [appointmentOrgWhere(org), { startsAt: { gte: start, lt: end } }] },
    orderBy: { startsAt: 'asc' },
    take: 2000,
    select: {
      id: true, clientId: true, startsAt: true, status: true, insurancePayer: true,
      client: { select: { insurancePayer: true, insuranceMemberId: true, insuranceType: true, insuranceEffectiveTo: true, medicaidId: true } },
    },
  });
  const facets = await appointmentFilterFacets(appts.map((a) => ({ id: a.id, clientId: a.clientId, startsAt: a.startsAt.toISOString() }))).catch(() => new Map());
  const list: NightlyAppointment[] = appts.map((a) => {
    const payer = facets.get(a.id)?.payer ?? (a.insurancePayer?.trim() || a.client.insurancePayer?.trim() || null);
    const medicaid = detectMarylandMedicaid(
      { medicaidId: a.client.medicaidId, insuranceType: a.client.insuranceType, insurancePayer: payer, insuranceMemberId: a.client.insuranceMemberId, insuranceEffectiveTo: a.client.insuranceEffectiveTo, coverages: [] },
      { now }
    ).medicaid;
    return { id: a.id, clientId: a.clientId, startsAt: a.startsAt, status: a.status, payer, medicaid };
  });

  const clientIds = [...new Set(list.map((a) => a.clientId))];
  const rows = clientIds.length
    ? await prisma.eligibilityCheck.findMany({
        where: { organizationId: org, clientId: { in: clientIds }, checkedAt: { gte: new Date(start.getTime() - 400 * 86_400_000) } },
        orderBy: { checkedAt: 'desc' },
        take: clientIds.length * 6,
        select: { clientId: true, payerName: true, status: true, checkedAt: true, rawRequest: true, rawResponse: true },
      })
    : [];
  const checks = new Map<string, FoEligibilityFact[]>();
  for (const r of rows) {
    const f = eligibilityResponseFacts(r);
    const l = checks.get(r.clientId) ?? [];
    l.push({ status: r.status, checkedAt: r.checkedAt, payerName: r.payerName, awaitingResponse: f.awaitingResponse, priorAuthRequired: f.priorAuthRequired, channel: f.channel });
    checks.set(r.clientId, l);
  }

  const sel = selectNightlyInquiries({ appointments: list, checks, visitDate: (a) => toPracticeWallTime(a.startsAt, tz).date, now });
  const out: NightlyRunCounts = {
    ...base, status: 'ran', visitDate, appointments: list.length, selected: sel.inquiries.length, reasons: sel.reasons, skipped: sel.skipped,
  };
  if (!input.apply || !sel.inquiries.length) {
    await audit(org, out, 'SUCCESS');
    return out;
  }

  for (const batch of chunkInquiries(sel.inquiries)) {
    try {
      const r = await requestWaystarEligibility(
        { organizationId: org, actorUserId: null, actorRole: null, trigger: 'eligibility-nightly' },
        batch.map((q) => ({ clientId: q.clientId, payerName: q.payer, dos: q.dos }))
      );
      out.sent += r.sent;
      out.failed += r.failed.length;
      if (r.batch) out.files += 1;
    } catch (err) {
      out.failed += batch.length;
      console.error(`${new Date().toISOString()} eligibility-nightly org=${org} batch failed: ${err instanceof Error ? err.message : 'error'}`);
    }
  }
  await audit(org, out, out.failed && !out.sent ? 'FAILURE' : 'SUCCESS');
  return out;
}

async function audit(organizationId: string, c: NightlyRunCounts, outcome: 'SUCCESS' | 'FAILURE') {
  await writeAuditLog({
    action: 'eligibility_nightly_run',
    actorUserId: null,
    actorRole: 'system',
    organizationId,
    resourceType: 'eligibilityCheck',
    outcome,
    userAgent: 'scripts/eligibility-nightly.ts',
    metadata: {
      setting: NIGHTLY_SETTING_LABEL, apply: c.apply, visitDate: c.visitDate ?? null, appointments: c.appointments, selected: c.selected,
      sent: c.sent, failed: c.failed, files: c.files, count: c.selected,
    },
  });
}
