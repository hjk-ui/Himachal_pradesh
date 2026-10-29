/**
 * Automatic consent reminders (server; run nightly by scripts/consent-reminders.ts). Schedule math
 * and caps are pure in decisions.ts.
 *
 *  - Unsigned portal packet: 3 and 7 days after it was sent.
 *  - Renewal: 30 and 7 days before a REQUIRED consent expires (the client's required consents from
 *    the rules engine; voluntary ROIs / Part 2 consents are not chased). With --apply the renewal
 *    forms go to the portal as a packet when no open packet already holds them.
 *  - At most 3 reminders per packet / consent (ConsentReminder tracks count, last send and the
 *    stages done, so a rerun never sends twice); one notification per client per run.
 *  - Channels: portal (Documents to sign), email when on file and not opted out, SMS only through
 *    the patient SMS gate (sendPatientSms re-checks consent / STOP). The text never names the forms.
 *  - Practice toggle ConsentReminderSettings.autoReminders (default ON).
 * Dry run (apply false) reads only and returns counts.
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { LIBRARY_FORM_PREFIX, templateKeyOf } from './catalog';
import { createPacketForItems, loadComplianceData, type LibraryActor } from './store';
import { notifyPacket } from './delivery';
import { STAFF_PREPARED_KEYS } from './requirements';
import type { PacketItem } from './composer';
import { nextTracker, packetReminderStage, renewalReminderStage, reminderChannels, RENEWAL_REMINDER_DAYS, type ReminderStage, type ReminderTracker } from './decisions';

const DAY = 86_400_000;

export type ConsentReminderCounts = {
  organizationId: string;
  mode: 'apply' | 'dry-run';
  setting: 'on' | 'off';
  packetsDue: number;
  renewalsDue: number;
  clients: number;
  notified: number;
  notDelivered: number;
  packetsCreated: number;
  failed: number;
};

export async function autoRemindersEnabled(organizationId: string): Promise<boolean> {
  const s = await prisma.consentReminderSettings.findUnique({ where: { organizationId } }).catch(() => null);
  return s ? s.autoReminders : true;
}

export async function setAutoReminders(organizationId: string, on: boolean, userId: string | null) {
  await prisma.consentReminderSettings.upsert({ where: { organizationId }, create: { organizationId, autoReminders: on, updatedById: userId }, update: { autoReminders: on, updatedById: userId } });
}

type Due = { kind: 'packet' | 'renewal'; subjectId: string; stage: ReminderStage; tracker: ReminderTracker | null; itemKey?: string };

export async function runConsentReminders(opts: { organizationId: string; apply: boolean; now?: Date }): Promise<ConsentReminderCounts> {
  const now = opts.now ?? new Date();
  const org = opts.organizationId;
  const counts: ConsentReminderCounts = { organizationId: org, mode: opts.apply ? 'apply' : 'dry-run', setting: 'on', packetsDue: 0, renewalsDue: 0, clients: 0, notified: 0, notDelivered: 0, packetsCreated: 0, failed: 0 };
  if (!(await autoRemindersEnabled(org))) return { ...counts, setting: 'off' };

  // Candidates: open portal packets sent 3+ days ago; signed library consents ending within 30 days
  const [packets, expiring] = await Promise.all([
    prisma.consentPacket.findMany({ where: { organizationId: org, status: 'SENT', method: 'portal', sentAt: { lte: new Date(now.getTime() - 3 * DAY) } }, select: { id: true, clientId: true, sentAt: true, sendCount: true, items: true } }),
    prisma.consentForm.findMany({
      where: { organizationId: org, formKey: { startsWith: LIBRARY_FORM_PREFIX }, status: 'SIGNED', revokedAt: null, expiresAt: { gt: now, lte: new Date(now.getTime() + (RENEWAL_REMINDER_DAYS[0] + 1) * DAY) }, NOT: { formStatus: { in: ['VOIDED', 'SUPERSEDED', 'REVOKED'] } } },
      select: { id: true, clientId: true, formKey: true, signedAt: true, expiresAt: true, formData: true },
    }),
  ]);
  const clientIds = [...new Set([...packets.map((p) => p.clientId), ...expiring.map((r) => r.clientId)])];
  if (!clientIds.length) return counts;
  const clients = await prisma.client.findMany({
    where: { organizationId: org, id: { in: clientIds }, status: 'ACTIVE', deceasedAt: null } as Prisma.ClientWhereInput,
    select: { id: true, email: true, emailOptOutAt: true, smsConsent: true, smsOptOutAt: true },
  });
  const clientById = new Map(clients.map((c) => [c.id, c]));

  // Renewed already: a later signed row of the same template (and purpose)
  const purposeOf = (fd: unknown) => ((fd ?? {}) as { purposeTag?: string | null }).purposeTag ?? null;
  const later = expiring.length
    ? await prisma.consentForm.findMany({ where: { organizationId: org, clientId: { in: [...new Set(expiring.map((r) => r.clientId))] }, formKey: { in: [...new Set(expiring.map((r) => r.formKey!))] }, status: 'SIGNED', revokedAt: null }, select: { id: true, clientId: true, formKey: true, signedAt: true, formData: true } })
    : [];
  const renewed = (r: (typeof expiring)[number]) => later.some((x) => x.id !== r.id && x.clientId === r.clientId && x.formKey === r.formKey && purposeOf(x.formData) === purposeOf(r.formData) && (x.signedAt?.getTime() ?? 0) > (r.signedAt?.getTime() ?? 0));

  // Only consents the client is required to have (rules + packet composition), and not staff-prepared
  const renewalClients = [...new Set(expiring.filter((r) => clientById.has(r.clientId)).map((r) => r.clientId))];
  const compliance = renewalClients.length ? await loadComplianceData({ organizationId: org }, org, { clientIds: renewalClients, now }) : null;
  const requiredItem = (clientId: string, key: string, purposeTag: string | null): PacketItem | null =>
    compliance?.required.get(clientId)?.items.find((i) => !i.optional && i.key === key && (i.purposeTag ?? null) === purposeTag && !STAFF_PREPARED_KEYS.has(i.key)) ?? null;

  const trackers = await prisma.consentReminder.findMany({
    where: { organizationId: org, OR: [{ kind: 'packet', subjectId: { in: packets.map((p) => p.id) } }, { kind: 'renewal', subjectId: { in: expiring.map((r) => r.id) } }] },
    select: { kind: true, subjectId: true, count: true, stages: true },
  });
  const trackerOf = (kind: string, id: string) => trackers.find((t) => t.kind === kind && t.subjectId === id) ?? null;

  const byClient = new Map<string, { due: Due[]; renewalItems: PacketItem[] }>();
  const add = (clientId: string, d: Due, item?: PacketItem) => {
    const e = byClient.get(clientId) ?? { due: [], renewalItems: [] };
    e.due.push(d);
    if (item) e.renewalItems.push(item);
    byClient.set(clientId, e);
  };
  for (const p of packets) {
    if (!clientById.has(p.clientId)) continue;
    const t = trackerOf('packet', p.id);
    const stage = packetReminderStage(p.sentAt, now, t, Math.max(0, p.sendCount - 1));
    if (!stage) continue;
    counts.packetsDue += 1;
    add(p.clientId, { kind: 'packet', subjectId: p.id, stage, tracker: t });
  }
  for (const r of expiring) {
    if (!clientById.has(r.clientId) || !r.expiresAt || renewed(r)) continue;
    const key = templateKeyOf(r.formKey);
    const item = key ? requiredItem(r.clientId, key, purposeOf(r.formData)) : null;
    if (!item) continue;
    const t = trackerOf('renewal', r.id);
    const stage = renewalReminderStage(r.expiresAt, now, t);
    if (!stage) continue;
    counts.renewalsDue += 1;
    add(r.clientId, { kind: 'renewal', subjectId: r.id, stage, tracker: t, itemKey: item.purposeTag ? `${item.key}:${item.purposeTag}` : item.key }, item);
  }
  counts.clients = byClient.size;
  if (!opts.apply) return counts;

  const actor: LibraryActor = { organizationId: org, userId: null, role: 'SYSTEM' };
  const itemKeyOf = (i: { key: string; purposeTag?: string | null }) => (i.purposeTag ? `${i.key}:${i.purposeTag}` : i.key);
  for (const [clientId, entry] of byClient) {
    try {
      // Which packet to point the client at: one already holding the renewal forms, else a new one
      let packetId: string | null = null;
      if (entry.renewalItems.length) {
        const wanted = new Set(entry.renewalItems.map(itemKeyOf));
        const open = await prisma.consentPacket.findMany({ where: { organizationId: org, clientId, status: 'SENT', method: 'portal' }, select: { id: true, items: true }, orderBy: { sentAt: 'desc' } });
        const holding = open.find((p) => {
          const keys = new Set(((p.items as unknown as PacketItem[]) ?? []).map(itemKeyOf));
          return [...wanted].every((k) => keys.has(k));
        });
        if (holding) packetId = holding.id;
        else {
          const items = entry.renewalItems.map((i) => ({ ...i, optional: false, reason: 'Renewal' }));
          const composition = compliance!.required.get(clientId)!;
          packetId = await createPacketForItems(actor, clientId, items, { ...composition, items }, 'portal');
          counts.packetsCreated += 1;
        }
      } else {
        packetId = entry.due.find((d) => d.kind === 'packet')!.subjectId;
      }
      const c = clientById.get(clientId)!;
      const n = await notifyPacket({ organizationId: org, packetId, channels: reminderChannels(c), actor: { userId: null, role: 'SYSTEM' } });
      const delivered = n.ok === true && n.results.some((r) => r.ok);
      if (delivered) counts.notified += 1;
      else counts.notDelivered += 1;
      for (const d of entry.due) {
        const next = nextTracker(d.tracker, d.stage, delivered);
        await prisma.consentReminder.upsert({
          where: { kind_subjectId: { kind: d.kind, subjectId: d.subjectId } },
          create: { organizationId: org, clientId, kind: d.kind, subjectId: d.subjectId, count: next.count, stages: next.stages, lastAt: delivered ? now : null },
          update: { count: next.count, stages: next.stages, ...(delivered ? { lastAt: now } : {}) },
        });
      }
      await writeAuditLog({
        action: 'NOTIFY',
        actorUserId: null,
        actorRole: 'SYSTEM',
        organizationId: org,
        resourceType: 'consentReminder',
        resourceId: packetId,
        patientId: clientId,
        outcome: delivered ? 'SUCCESS' : 'FAILURE',
        metadata: { packets: entry.due.filter((d) => d.kind === 'packet').length, renewals: entry.due.filter((d) => d.kind === 'renewal').length, channels: n.ok === true ? n.results.map((r) => `${r.channel}:${r.ok ? 'sent' : 'not_sent'}`) : [] },
      }).catch(() => {});
    } catch (err) {
      counts.failed += 1;
      console.error(`consent-reminders org=${org} client failed: ${err instanceof Error ? err.message : 'error'}`);
    }
  }
  return counts;
}
