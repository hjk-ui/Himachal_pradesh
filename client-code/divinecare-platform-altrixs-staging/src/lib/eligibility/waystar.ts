import 'server-only';

/**
 * Eligibility through Waystar batch SFTP: 270 out (005010X279A1), 271 back (005010X279A1).
 *
 *  requestWaystarEligibility()  EligibilityCheck rows (PENDING, rawRequest.channel = waystar_sftp)
 *                               -> one 270 file (one ST per check, TRN02 = check id) -> /Upload
 *  apply271File()               271 TRN*2 -> EligibilityCheck -> ELIGIBLE / INELIGIBLE / ERROR + benefits
 *
 * Real-time (seconds) eligibility from Waystar needs their REST API credentials, which this
 * deployment does not have; batch SFTP answers arrive with the next /Download retrieval.
 */
import type { Prisma, Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { clientAccessWhere, clientOrgFilter } from '@/lib/clients/orgScope';
import { waystarSftpConfig } from '@/lib/services/waystarSftpService';
import { generate270, validateConfig, validateEligibilityInquiry, type EligibilityInquiry, type Person } from '@/lib/billing/waystarInbound/generate';
import { parse271, summarizeEligibility } from '@/lib/billing/waystarInbound/parse271';
import { inquiryConfig, sendX12File } from '@/lib/billing/waystarInbound/transport';
import { ELIGIBILITY_SERVICE_TYPES, type EligibilityServiceType } from '@/lib/billing/waystarInbound/codes';
import { administrativeSexCode, x12PatientName, X12_NAME_MISSING } from '@/lib/clients/demographics';

export const WAYSTAR_ELIGIBILITY_CHANNEL = 'waystar_sftp';

export const WAYSTAR_REALTIME_NOTE =
  'Waystar eligibility runs as a batch over SFTP: the 271 answer arrives with the next Waystar retrieval (usually within minutes to an hour). Real-time answers need Waystar REST API credentials, which are not set up yet.';

export function waystarEligibilityAvailable() {
  const cfg = waystarSftpConfig();
  return cfg.configured && cfg.live && process.env.CLINICAL_CLEARINGHOUSE_MODE !== 'demo';
}

export function availityConfigured() {
  const v = (k: string) => {
    const s = process.env[k]?.trim();
    return Boolean(s && !s.startsWith('your-') && !s.startsWith('your_'));
  };
  return v('AVAILITY_CLIENT_ID') && v('AVAILITY_CLIENT_SECRET') && v('AVAILITY_TOKEN_URL') && v('AVAILITY_API_BASE_URL');
}

export type EligibilityChannel = 'waystar' | 'availity';

/** Waystar is the default when its SFTP channel is live; Availity stays selectable only when configured. */
export function eligibilityChannels() {
  const waystar = waystarEligibilityAvailable();
  const availity = availityConfigured();
  const channels: EligibilityChannel[] = [];
  if (waystar) channels.push('waystar');
  if (availity) channels.push('availity');
  return {
    defaultChannel: (waystar ? 'waystar' : 'availity') as EligibilityChannel,
    channels,
    waystar,
    availity,
    usageIndicator: waystarSftpConfig().usageIndicator,
    note: waystar ? WAYSTAR_REALTIME_NOTE : null,
  };
}

function lower(s: string | null | undefined) {
  return (s || '').trim().toLowerCase();
}

/** Waystar payer ID for a payer name: org mapping first, then deployment-wide ('*') mapping. */
export async function resolveWaystarPayerId(organizationId: string, payerName: string): Promise<string | null> {
  const name = lower(payerName);
  if (!name) return null;
  const rows = await prisma.waystarPayerMapping.findMany({
    where: { organizationId: { in: [organizationId, '*'] }, active: true },
    select: { organizationId: true, payerName: true, aliases: true, waystarPayerId: true },
  });
  const hit = (org: string) =>
    rows.find((r) => r.organizationId === org && (lower(r.payerName) === name || r.aliases.some((a) => lower(a) === name)));
  return (hit(organizationId) ?? hit('*'))?.waystarPayerId ?? null;
}

/** 2100B information receiver: the org's default billing provider, else PRACTICE_GROUP_NPI. */
async function providerFor(organizationId: string) {
  const bp = await prisma.billingProvider.findFirst({
    where: { organizationId: { in: [organizationId, '*'] }, active: true },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    select: { npi: true, name: true },
  });
  const cfg = inquiryConfig();
  return bp ? { ...cfg, providerNpi: bp.npi, providerName: bp.name } : cfg;
}

/** Legal name only (x12PatientName); a display name is never split. Blank parts fail validation. */
function splitName(client: { legalFirstName: string | null; legalLastName: string | null; middleInitial: string | null; needsNameReview?: boolean | null }) {
  return x12PatientName(client) ?? { firstName: '', lastName: '', middleInitial: null };
}

const ymd = (d: Date | null | undefined) => (d && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : null);

export type WaystarEligibilityRequest = {
  clientId: string;
  payerName?: string | null;
  memberId?: string | null;
  /** YYYY-MM-DD; defaults to today */
  dos?: string | null;
  /** Overrides the payer mapping */
  payerId?: string | null;
  serviceTypes?: EligibilityServiceType[];
};

/**
 * Signed-in staff (their client scope applies), or a system job (actorUserId / actorRole null:
 * organization-wide scope, e.g. scripts/eligibility-nightly.ts) with a trigger name for the audit.
 */
export type WaystarEligibilityActor =
  | { organizationId: string; actorUserId: string; actorRole: Role; trigger?: string }
  | { organizationId: string; actorUserId: null; actorRole: null; trigger: string };

function actorClientScope(actor: WaystarEligibilityActor) {
  return actor.actorUserId && actor.actorRole
    ? clientAccessWhere({ organizationId: actor.organizationId, actorUserId: actor.actorUserId, actorRole: actor.actorRole })
    : clientOrgFilter(actor.organizationId);
}

export type WaystarEligibilityResult = {
  checkIds: string[];
  sent: number;
  failed: Array<{ checkId: string | null; clientId: string; errors: string[] }>;
  batch: null | { batchId: string; fileName: string; delivery: string; deliveryNote?: string; usageIndicator: 'T' | 'P' };
};

/** Creates PENDING checks and sends them in ONE 270. Checks that fail validation are saved as ERROR. */
export async function requestWaystarEligibility(actor: WaystarEligibilityActor, requests: WaystarEligibilityRequest[]): Promise<WaystarEligibilityResult> {
  if (!waystarEligibilityAvailable()) throw new Error('Waystar SFTP eligibility is not active on this server');
  const result: WaystarEligibilityResult = { checkIds: [], sent: 0, failed: [], batch: null };
  const cfg = await providerFor(actor.organizationId);
  const cfgProblems = validateConfig(cfg);

  const ready: Array<{ checkId: string; inquiry: EligibilityInquiry; clientId: string }> = [];
  for (const req of requests.slice(0, 99)) {
    const client = await prisma.client.findFirst({
      where: { id: req.clientId, ...actorClientScope(actor) },
      select: {
        id: true, name: true, legalFirstName: true, legalLastName: true, middleInitial: true, needsNameReview: true, dateOfBirth: true, administrativeSex: true, gender: true,
        insurancePayer: true, insuranceMemberId: true, insuranceGroupNumber: true,
      },
    });
    if (!client) { result.failed.push({ checkId: null, clientId: req.clientId, errors: ['Client not found'] }); continue; }
    const payerName = (req.payerName || client.insurancePayer || '').trim();
    const memberIdInput = (req.memberId ?? client.insuranceMemberId)?.trim() || '';
    const dos = req.dos && /^\d{4}-\d{2}-\d{2}$/.test(req.dos) ? req.dos : new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    const serviceTypes = (req.serviceTypes || []).filter((t) => (ELIGIBILITY_SERVICE_TYPES as readonly string[]).includes(t));

    // Subscriber other than the patient (ClientInsuranceCoverage, from the outbound COB work)
    const coverages = await prisma.clientInsuranceCoverage.findMany({ where: { clientId: client.id, active: true } });
    const coverage = coverages.find((c) => payerName && lower(c.payerName) === lower(payerName)) ?? coverages.find((c) => c.rank === 'P') ?? null;
    const patient: Person = { ...splitName(client), dateOfBirth: ymd(client.dateOfBirth), gender: administrativeSexCode(client) };
    const memberId = memberIdInput || coverage?.memberId || '';
    const isDependent = Boolean(coverage && coverage.subscriberRelationship !== '18' && coverage.subscriberLastName && coverage.subscriberFirstName);
    const subscriber = isDependent
      ? { firstName: coverage!.subscriberFirstName!, lastName: coverage!.subscriberLastName!, middleInitial: coverage!.subscriberMiddleInitial, dateOfBirth: ymd(coverage!.subscriberDob), gender: coverage!.subscriberGender, memberId, groupNumber: coverage!.groupNumber || client.insuranceGroupNumber }
      : { ...patient, memberId, groupNumber: coverage?.groupNumber || client.insuranceGroupNumber };

    const payerId = req.payerId?.trim() || (payerName ? await resolveWaystarPayerId(actor.organizationId, payerName) : null) || '';
    const check = await prisma.eligibilityCheck.create({
      data: {
        organizationId: actor.organizationId,
        clientId: client.id,
        payerName: payerName || 'Unknown payer',
        memberId: memberId || null,
        dos: new Date(`${dos}T12:00:00`),
        status: 'PENDING',
        checkedById: actor.actorUserId,
      },
      select: { id: true },
    });
    result.checkIds.push(check.id);
    const inquiry: EligibilityInquiry = {
      traceNumber: check.id, payerName, payerId, subscriber, dependent: isDependent ? patient : null, serviceDate: dos,
      serviceTypes: serviceTypes.length ? serviceTypes : undefined,
    };
    const errors = [
      ...cfgProblems,
      ...(x12PatientName(client) ? [] : [X12_NAME_MISSING]),
      ...(payerName ? [] : ['Payer is required']),
      ...(payerName && !payerId ? [`No Waystar payer ID mapped for "${payerName}" (add it under Billing › Payers)`] : []),
      ...validateEligibilityInquiry(inquiry).filter((e) => !(e.startsWith('Waystar payer ID') && !payerId)),
    ];
    if (errors.length) {
      await prisma.eligibilityCheck.update({
        where: { id: check.id },
        data: {
          status: 'ERROR',
          checkedAt: new Date(),
          rawRequest: { channel: WAYSTAR_ELIGIBILITY_CHANNEL, transaction: '270', notSent: true } as Prisma.InputJsonValue,
          rawResponse: { channel: WAYSTAR_ELIGIBILITY_CHANNEL, error: `Not sent to Waystar: ${errors.join('; ')}` } as Prisma.InputJsonValue,
        },
      });
      result.failed.push({ checkId: check.id, clientId: client.id, errors });
      continue;
    }
    ready.push({ checkId: check.id, inquiry, clientId: client.id });
  }
  if (!ready.length) return result;

  // Unique GS06 across our 270/276 files
  let file = generate270(ready.map((r) => r.inquiry), cfg);
  for (let i = 0; i < 3 && (await prisma.waystarOutboundFile.findUnique({ where: { controlNumber: file.controlNumber } })); i++) {
    file = generate270(ready.map((r) => r.inquiry), cfg);
  }
  const fileName = `${file.batchId}.270`;
  const markSent = (data: Record<string, unknown>) =>
    prisma.eligibilityCheck.updateMany({
      where: { id: { in: ready.map((r) => r.checkId) } },
      data: { rawRequest: { channel: WAYSTAR_ELIGIBILITY_CHANNEL, transaction: '270', batchId: file.batchId, fileName, controlNumber: file.controlNumber, usageIndicator: cfg.usageIndicator, sentAt: new Date().toISOString(), serviceTypes: ready[0].inquiry.serviceTypes ?? ['30', 'MH'], ...data } as Prisma.InputJsonValue },
    });

  let sent;
  try {
    sent = await sendX12File('270', fileName, file.content);
  } catch (err) {
    const message = `Not sent to Waystar: ${err instanceof Error ? err.message : 'connector error'}`.slice(0, 500);
    await prisma.eligibilityCheck.updateMany({
      where: { id: { in: ready.map((r) => r.checkId) } },
      data: { status: 'ERROR', checkedAt: new Date(), rawResponse: { channel: WAYSTAR_ELIGIBILITY_CHANNEL, error: message } as Prisma.InputJsonValue },
    });
    for (const r of ready) result.failed.push({ checkId: r.checkId, clientId: r.clientId, errors: [message] });
    await writeAuditLog({
      action: 'eligibility_270_sent', actorUserId: actor.actorUserId, actorRole: actor.actorRole ?? 'system', userAgent: actor.trigger, organizationId: actor.organizationId, outcome: 'FAILURE',
      resourceType: 'WaystarOutboundFile', resourceId: file.batchId, metadata: { count: ready.length, error: message.slice(0, 200) },
    });
    return result;
  }

  await prisma.waystarOutboundFile.create({
    data: {
      kind: '270', organizationId: actor.organizationId, batchId: file.batchId, controlNumber: file.controlNumber, fileName,
      s3Key: sent.s3Key, transferId: sent.transferId, status: sent.delivery === 'failed' ? 'failed' : sent.demo ? 'demo' : 'transferred',
      usageIndicator: cfg.usageIndicator, itemCount: ready.length, itemIds: ready.map((r) => r.checkId), createdBy: actor.actorUserId,
    },
  });
  if (sent.delivery === 'failed') {
    const message = `Waystar transfer failed: ${sent.deliveryNote || 'unknown error'}`;
    await prisma.eligibilityCheck.updateMany({
      where: { id: { in: ready.map((r) => r.checkId) } },
      data: { status: 'ERROR', checkedAt: new Date(), rawResponse: { channel: WAYSTAR_ELIGIBILITY_CHANNEL, error: message } as Prisma.InputJsonValue },
    });
    for (const r of ready) result.failed.push({ checkId: r.checkId, clientId: r.clientId, errors: [message] });
  } else {
    await markSent({ delivery: sent.delivery, ...(sent.deliveryNote ? { deliveryNote: sent.deliveryNote } : {}) });
    result.sent = ready.length;
  }
  result.batch = { batchId: file.batchId, fileName, delivery: sent.delivery, ...(sent.deliveryNote ? { deliveryNote: sent.deliveryNote } : {}), usageIndicator: cfg.usageIndicator };
  await writeAuditLog({
    action: 'eligibility_270_sent', actorUserId: actor.actorUserId, actorRole: actor.actorRole ?? 'system', userAgent: actor.trigger, organizationId: actor.organizationId,
    outcome: sent.delivery === 'failed' ? 'FAILURE' : 'SUCCESS',
    resourceType: 'WaystarOutboundFile', resourceId: file.batchId,
    metadata: { count: ready.length, checkIds: ready.map((r) => r.checkId).slice(0, 50), delivery: sent.delivery, usageIndicator: cfg.usageIndicator },
  });
  return result;
}

export type Apply271Outcome = { summary: string; unmatched: string[]; organizationIds: string[]; updated: number };

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};
}

/** Applies every subscriber/dependent answer in a 271 to its EligibilityCheck (TRN*2 = check id). */
export async function apply271File(ctx: { actorUserId: string | null; trigger: string }, fileName: string, content: string): Promise<Apply271Outcome> {
  const out: Apply271Outcome = { summary: '', unmatched: [], organizationIds: [], updated: 0 };
  const responses = parse271(content);
  const counts = { ELIGIBLE: 0, INELIGIBLE: 0, ERROR: 0 };
  for (const r of responses) {
    if (!r.traceNumber) { out.unmatched.push('271 answer without TRN*2 trace'); continue; }
    const check = await prisma.eligibilityCheck.findUnique({ where: { id: r.traceNumber }, select: { id: true, organizationId: true, clientId: true, status: true, rawRequest: true } });
    if (!check) { out.unmatched.push(`eligibility trace ${r.traceNumber}`); continue; }
    if (check.status !== 'PENDING') continue; // already answered (resent 271): keep the first answer
    const s = summarizeEligibility(r);
    counts[s.status]++;
    await prisma.eligibilityCheck.update({
      where: { id: check.id },
      data: {
        status: s.status,
        checkedAt: new Date(),
        rawResponse: {
          channel: WAYSTAR_ELIGIBILITY_CHANNEL,
          transaction: '271',
          file: fileName,
          receivedAt: new Date().toISOString(),
          benefits: s.benefits,
          waystar: {
            statusText: s.statusText,
            coinsurancePercent: s.coinsurancePercent,
            // Copay unknown (not reported) is stored as null, never as $0
            copay: s.copayKnown ? s.benefits.copay : null,
            copayKnown: s.copayKnown,
            insuranceTypes: s.insuranceTypes,
            managedCare: s.managedCare,
            benefitSource: s.benefitSource,
            priorAuthRequired: s.priorAuthRequired,
            planBegin: s.planBegin,
            planEnd: s.planEnd,
            planName: s.planName,
            groupNumber: r.groupNumber || null,
            rejections: s.rejections,
            notes: s.notes,
            benefitLines: r.benefits.slice(0, 60).map((b) => ({
              info: b.info, coverageLevel: b.coverageLevel, serviceTypes: b.serviceTypes, insuranceType: b.insuranceType, timePeriod: b.timePeriod,
              amount: b.amount, percent: b.percent, inNetwork: b.inNetwork, authRequired: b.authRequired, messages: b.messages.slice(0, 3),
              ...(b.relatedEntities?.length ? { relatedEntities: b.relatedEntities.slice(0, 5) } : {}),
            })),
          },
          ...(s.status === 'ERROR' ? { error: s.statusText } : {}),
        } as Prisma.InputJsonValue,
        rawRequest: { ...obj(check.rawRequest), answeredAt: new Date().toISOString() } as Prisma.InputJsonValue,
      },
    });
    out.updated++;
    if (!out.organizationIds.includes(check.organizationId)) out.organizationIds.push(check.organizationId);
    await writeAuditLog({
      action: 'eligibility_271_received',
      actorUserId: ctx.actorUserId,
      actorRole: ctx.actorUserId ? null : 'system',
      organizationId: check.organizationId,
      resourceType: 'eligibilityCheck',
      resourceId: check.id,
      patientId: check.clientId,
      userAgent: ctx.trigger,
      metadata: { file: fileName, status: s.status, rejections: s.rejections.length },
    });
  }
  out.summary = `${responses.length} eligibility answer(s): ${counts.ELIGIBLE} active, ${counts.INELIGIBLE} inactive, ${counts.ERROR} rejected / no status`;
  return out;
}
