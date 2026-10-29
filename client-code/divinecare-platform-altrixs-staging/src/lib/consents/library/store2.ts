/**
 * Consent library: revocation, PDFs (stored privately, served through audited routes), patient
 * portal documents and disclosure helpers. See store.ts for the rest.
 */
import { createHash } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { loadPracticeIdentity } from '@/lib/practice/identity';
import { getPracticeTimeZone } from '@/lib/time/practiceTimeServer';
import { formatPracticeTime, practiceToday, practiceZoneLabel } from '@/lib/time/practiceTime';
import { signedFormPath } from '@/lib/storage/privateUploads';
import { formKeyFor, LIBRARY_FORM_PREFIX, templateKeyOf, templateVersion } from './catalog';
import { isPartialChannelRevocation, needsWrittenConfirmation, revocationEffects, validateRevocation, type RevocationInput } from './revocation';
import { buildConsentPdf, type PdfSection } from './pdf';
import { evidenceLines, type SigningEvidence } from './evidence';
import { formatPracticeMdY } from '@/lib/consents/carelon/prefill';
import type { PacketSubmission } from './signing';
import { frozenIntact, packetForSigning, ROW_SELECT, scopedClient, signPacket, userName, type LibraryActor, type LibraryFormData, type PacketForSigning, type SigningContext } from './store';

// ─── Revocation ──────────────────────────────────────────────────────────────

type PatientActor = { organizationId: string; userId: null; role: 'PATIENT'; clientId: string };

export async function revokeConsent(actor: LibraryActor | PatientActor, rowId: string, input: RevocationInput) {
  const row = await prisma.consentForm.findFirst({ where: { id: rowId, organizationId: actor.organizationId }, select: ROW_SELECT });
  if (!row) return { ok: false as const, status: 404, error: 'Consent not found' };
  if ('clientId' in actor) {
    if (row.clientId !== actor.clientId) return { ok: false as const, status: 404, error: 'Consent not found' };
  } else if (!(await scopedClient(actor, row.clientId))) return { ok: false as const, status: 404, error: 'Consent not found' };
  if (row.formKey && !row.formKey.startsWith(LIBRARY_FORM_PREFIX)) return { ok: false as const, status: 400, error: 'This form has its own workflow.' };
  const key = templateKeyOf(row.formKey);
  const t = key ? templateVersion(key, Number(row.formVersion)) : null;
  const tz = await getPracticeTimeZone(actor.organizationId);
  const errors = validateRevocation(t, row, input, practiceToday(tz));
  if (errors.length) return { ok: false as const, status: 400, error: errors[0], errors };
  const partial = isPartialChannelRevocation(t, input.channels);
  const effects = revocationEffects(t, row.formKey ? null : row.type, input.channels);
  const now = new Date();
  const fd = (row.formData ?? {}) as Partial<LibraryFormData>;
  const revocation = {
    receivedOn: input.receivedOn,
    method: input.method,
    receivedVia: input.receivedVia,
    note: input.note?.trim().slice(0, 500) || null,
    channels: input.channels ?? null,
    recordedById: actor.userId,
    recordedAt: now.toISOString(),
    effects: effects.map((e) => e.kind),
  };
  const writtenConfirmationNeeded = needsWrittenConfirmation(t, input.method);
  // Effective from the date it was received (start of that day), never later than now
  const receivedAt = new Date(`${input.receivedOn}T00:00:00Z`);
  const revokedAt = receivedAt.getTime() < now.getTime() ? receivedAt : now;
  const nextFd = {
    ...fd,
    ...(partial ? {} : { revocation }),
    writtenConfirmationNeeded,
    // Signed responses are immutable: a channel revocation is recorded beside them, never by editing them
    ...(partial ? { channelRevocations: [...(fd.channelRevocations ?? []), { channels: input.channels ?? [], ...revocation }] } : {}),
    events: [...(fd.events ?? []), { at: now.toISOString(), action: partial ? `channels_revoked:${(input.channels ?? []).join(',')}` : 'revoked', byId: actor.userId, detail: `${input.method} via ${input.receivedVia}${revocation.note ? `: ${revocation.note}` : ''}`.slice(0, 300) }],
  };
  await prisma.$transaction(async (tx) => {
    await tx.consentForm.update({
      where: { id: row.id },
      data: partial
        ? { formData: nextFd as unknown as Prisma.InputJsonValue }
        : {
            // DECLINED + revokedAt (the latest row by updatedAt): checkAiNoteConsent reads it as declined
            status: 'DECLINED',
            formStatus: 'REVOKED',
            revokedAt,
            revokedById: actor.userId,
            revocationMethod: input.method,
            revocationReceivedVia: input.receivedVia,
            revocationNote: revocation.note,
            formData: nextFd as unknown as Prisma.InputJsonValue,
          },
    });
    const kinds = new Set(effects.map((e) => e.kind));
    if (kinds.has('sms_opt_out') || kinds.has('email_opt_out')) {
      await tx.client.update({
        where: { id: row.clientId },
        data: { ...(kinds.has('sms_opt_out') ? { smsConsent: false, smsOptOutAt: now } : {}), ...(kinds.has('email_opt_out') ? { emailOptOutAt: now } : {}) },
      });
    }
    if (kinds.has('autopay_off')) {
      await tx.cardOnFile.updateMany({ where: { clientId: row.clientId }, data: { autopayEnabled: false } });
      await tx.autopayEnrollment.updateMany({ where: { clientId: row.clientId, active: true }, data: { active: false } });
    }
  });
  return { ok: true as const, clientId: row.clientId, effects: effects.map((e) => e.kind), partial, writtenConfirmationNeeded };
}

/** AI Scribe gate: the latest recording / transcription consent was revoked. */
export async function recordingConsentRevoked(organizationId: string, clientId: string): Promise<boolean> {
  const latest = await prisma.consentForm.findFirst({
    where: { organizationId, clientId, formKey: formKeyFor('recording-transcription-consent') },
    orderBy: { updatedAt: 'desc' },
    select: { revokedAt: true },
  });
  return Boolean(latest?.revokedAt);
}

/** Voicemail preference from the latest communication consent (null = not recorded). */
export async function voicemailAllowed(organizationId: string, clientId: string): Promise<boolean | null> {
  const latest = await prisma.consentForm.findFirst({
    where: { organizationId, clientId, formKey: formKeyFor('communication-consent'), status: { in: ['SIGNED', 'DECLINED'] } },
    orderBy: { updatedAt: 'desc' },
    select: { revokedAt: true, formData: true },
  });
  if (!latest) return null;
  if (latest.revokedAt) return false;
  const fd = latest.formData as LibraryFormData | null;
  if (fd?.channelRevocations?.some((r) => r.channels.includes('voicemail'))) return false;
  return fd?.response?.choices?.voicemail === 'yes';
}

// ─── PDF ─────────────────────────────────────────────────────────────────────

const PDF_ROW_SELECT = { id: true, formData: true, revokedAt: true, revocationMethod: true, revocationReceivedVia: true, clientId: true, packetId: true, formKey: true, createdAt: true } satisfies Prisma.ConsentFormSelect;
type PdfRow = Prisma.ConsentFormGetPayload<{ select: typeof PDF_ROW_SELECT }>;
type PacketSig = {
  signerType: string | null;
  signerName: string | null;
  signerRelationship: string | null;
  signerAuthority: string | null;
  signatureTyped: string | null;
  signedAt: Date | null;
  method: string;
  recordedById: string | null;
  sentAt?: Date;
  lastSentAt?: Date | null;
  sendCount?: number;
  deliveryChannels?: string[];
  viewedAt?: Date | null;
  evidence?: unknown;
};

async function pdfFor(organizationId: string, rows: PdfRow[], packet: PacketSig | null, clientId: string, recordId: string, title: string, at: Date) {
  const [client, identity, tz] = await Promise.all([
    prisma.client.findUnique({ where: { id: clientId }, select: { name: true, dateOfBirth: true } }),
    loadPracticeIdentity(organizationId),
    getPracticeTimeZone(organizationId),
  ]);
  const sections: PdfSection[] = rows.flatMap((r) => {
    const fd = r.formData as LibraryFormData | null;
    if (!fd?.frozen) return [];
    return [{ frozen: fd.frozen, response: fd.response, ownSignature: fd.ownSignature, declined: fd.declined, revoked: r.revokedAt ? { at: r.revokedAt.toISOString(), method: r.revocationMethod ?? '', receivedVia: r.revocationReceivedVia ?? '' } : null }];
  });
  return buildConsentPdf({
    title,
    practiceName: identity.name,
    clientName: client?.name ?? 'Client',
    clientDob: client?.dateOfBirth ? client.dateOfBirth.toISOString().slice(0, 10) : null,
    sections,
    signer:
      packet?.signedAt && packet.signerName
        ? {
            signerType: packet.signerType === 'representative' ? 'representative' : 'self',
            printedName: packet.signerName,
            relationship: packet.signerRelationship,
            authority: packet.signerAuthority,
            signature: packet.signatureTyped ?? '',
            signedAt: packet.signedAt.toISOString(),
            method: packet.method,
            recordedByName: await userName(packet.recordedById),
          }
        : null,
    recordId,
    timeZone: tz,
    generatedAt: at,
    auditTrail: packet
      ? evidenceLines(
          (packet.evidence as SigningEvidence | null) ?? null,
          packet.sentAt ? { sentAt: packet.sentAt.toISOString(), lastSentAt: packet.lastSentAt?.toISOString() ?? null, sendCount: packet.sendCount ?? 0, channels: packet.deliveryChannels ?? [], viewedAt: packet.viewedAt?.toISOString() ?? null } : null,
          (iso) => `${formatPracticeMdY(iso, tz)} ${formatPracticeTime(iso, tz)} ${practiceZoneLabel(tz)}`
        )
      : [],
  });
}

export async function storePacketPdf(organizationId: string, packetId: string) {
  const p = await prisma.consentPacket.findUnique({ where: { id: packetId } });
  if (!p || p.status !== 'SIGNED') return null;
  const rows = await prisma.consentForm.findMany({ where: { organizationId, packetId }, select: PDF_ROW_SELECT, orderBy: { createdAt: 'asc' } });
  const bytes = await pdfFor(organizationId, rows, p, p.clientId, p.id, 'Consent packet', p.signedAt ?? new Date());
  const fileName = `${p.id}-consent-packet.pdf`;
  const abs = signedFormPath(fileName);
  if (!abs) return null;
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, bytes);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  await prisma.consentPacket.update({ where: { id: p.id }, data: { pdfFileName: fileName, pdfSha256: sha256 } });
  return { fileName, sha256 };
}

/** Packet PDF: the stored signed file when intact, else rebuilt from the frozen rows. */
export async function packetPdf(actor: LibraryActor, packetId: string) {
  const p = await prisma.consentPacket.findFirst({ where: { id: packetId, organizationId: actor.organizationId } });
  if (!p || !(await scopedClient(actor, p.clientId))) return { ok: false as const, status: 404, error: 'Packet not found' };
  const fileName = `consent-packet-${p.id}.pdf`;
  if (p.pdfFileName && p.pdfSha256) {
    const abs = signedFormPath(p.pdfFileName);
    try {
      const buf = abs ? await readFile(abs) : null;
      if (buf && createHash('sha256').update(buf).digest('hex') === p.pdfSha256) return { ok: true as const, bytes: new Uint8Array(buf), fileName, clientId: p.clientId, source: 'stored' as const };
    } catch {
      // rebuild from the frozen rows
    }
  }
  const rows = await prisma.consentForm.findMany({ where: { organizationId: actor.organizationId, packetId }, select: PDF_ROW_SELECT, orderBy: { createdAt: 'asc' } });
  const bytes = await pdfFor(actor.organizationId, rows, p, p.clientId, p.id, 'Consent packet', p.signedAt ?? new Date());
  return { ok: true as const, bytes, fileName, clientId: p.clientId, source: 'generated' as const };
}

/** One consent's PDF (frozen text + signature record; shows a revocation when recorded). */
export async function consentPdf(actor: LibraryActor, rowId: string) {
  const r = await prisma.consentForm.findFirst({ where: { id: rowId, organizationId: actor.organizationId, formKey: { startsWith: LIBRARY_FORM_PREFIX } }, select: PDF_ROW_SELECT });
  if (!r || !(await scopedClient(actor, r.clientId))) return { ok: false as const, status: 404, error: 'Consent not found' };
  const fd = r.formData as LibraryFormData | null;
  if (!fd?.frozen) return { ok: false as const, status: 409, error: 'This consent has not been signed yet.' };
  const p = r.packetId ? await prisma.consentPacket.findUnique({ where: { id: r.packetId } }) : null;
  const bytes = await pdfFor(actor.organizationId, [r], p, r.clientId, r.id, fd.frozen.title, new Date());
  return { ok: true as const, bytes, fileName: `consent-${templateKeyOf(r.formKey)}-${r.id}.pdf`, clientId: r.clientId, intact: frozenIntact(fd.frozen) };
}

/** Signed consent packets in the chart Documents list (download goes through the audited route). */
export async function chartConsentDocuments(organizationId: string, clientId: string) {
  const packets = await prisma.consentPacket.findMany({ where: { organizationId, clientId, status: 'SIGNED' }, select: { id: true, signedAt: true, method: true }, orderBy: { signedAt: 'desc' }, take: 20 });
  return packets.map((p) => ({
    id: `consent-packet:${p.id}`,
    name: `Signed consent packet (${p.method === 'intake' ? 'intake' : p.method === 'portal' ? 'patient portal' : 'in office'})`,
    category: 'Consent',
    size: '—',
    uploadedAt: (p.signedAt ?? new Date()).toISOString().slice(0, 10),
    filesTo: 'Consents',
    url: `/api/consents/library/packets/${p.id}/pdf`,
  }));
}

// ─── Patient portal ──────────────────────────────────────────────────────────

type PatientCtx = { clientId: string; organizationId: string };

export type PatientPacketDoc = {
  id: string;
  kind: 'consent-packet';
  title: string;
  status: 'AWAITING' | 'SIGNED';
  sentAt: string;
  clinicianName: null;
  signedAt: string | null;
  signedName: string | null;
  declinedAt: null;
  declineReason: null;
  packet?: PacketForSigning;
};

function patientTitle(n: number) {
  return n === 1 ? 'Consent form to review and sign' : `Consent packet (${n} sections) to review and sign`;
}

function patientDoc(p: { id: string; items: unknown; status: string; sentAt: Date; signedAt: Date | null; signerName: string | null }): PatientPacketDoc {
  return {
    id: p.id,
    kind: 'consent-packet',
    title: patientTitle(Array.isArray(p.items) ? p.items.length : 0),
    status: p.status === 'SENT' ? 'AWAITING' : 'SIGNED',
    sentAt: p.sentAt.toISOString(),
    clinicianName: null,
    signedAt: p.signedAt?.toISOString() ?? null,
    signedName: p.signerName,
    declinedAt: null,
    declineReason: null,
  };
}

export async function listPatientPackets(ctx: PatientCtx): Promise<PatientPacketDoc[]> {
  const rows = await prisma.consentPacket.findMany({ where: { organizationId: ctx.organizationId, clientId: ctx.clientId, method: 'portal', status: { in: ['SENT', 'SIGNED'] } }, orderBy: { sentAt: 'desc' }, take: 20 });
  return rows.map(patientDoc);
}

export async function getPatientPacket(ctx: PatientCtx, id: string): Promise<PatientPacketDoc | null> {
  const p = await prisma.consentPacket.findFirst({ where: { id, organizationId: ctx.organizationId, clientId: ctx.clientId, method: 'portal', status: { in: ['SENT', 'SIGNED'] } } });
  if (!p) return null;
  const packet = await packetForSigning(ctx.organizationId, p.id, ctx.clientId);
  return { ...patientDoc(p), packet: packet ?? undefined };
}

export async function patientSignPacket(ctx: PatientCtx, id: string, sub: PacketSubmission, evidence?: SigningContext) {
  const p = await prisma.consentPacket.findFirst({ where: { id, organizationId: ctx.organizationId, clientId: ctx.clientId, method: 'portal' }, select: { id: true } });
  if (!p) return { ok: false as const, status: 404, error: 'Document not found' };
  return signPacket(ctx.organizationId, id, sub, { method: 'portal', recordedById: null, clientId: ctx.clientId, evidence });
}

/** First time the client opens an unsigned packet in the portal ("viewed" tracking). */
export async function markPatientPacketViewed(ctx: PatientCtx, id: string): Promise<boolean> {
  const r = await prisma.consentPacket
    .updateMany({ where: { id, organizationId: ctx.organizationId, clientId: ctx.clientId, method: 'portal', status: 'SENT', viewedAt: null }, data: { viewedAt: new Date() } })
    .catch(() => ({ count: 0 }));
  return r.count > 0;
}

/** The patient's own signed consents that can be revoked in the portal. */
export async function patientRevocableConsents(ctx: PatientCtx) {
  const rows = await prisma.consentForm.findMany({
    where: { organizationId: ctx.organizationId, clientId: ctx.clientId, formKey: { startsWith: LIBRARY_FORM_PREFIX }, status: 'SIGNED', revokedAt: null },
    select: { id: true, formKey: true, formVersion: true, signedAt: true, recipientName: true },
  });
  return rows.flatMap((r) => {
    const t = templateVersion(templateKeyOf(r.formKey) ?? '', Number(r.formVersion));
    return t?.revocable ? [{ id: r.id, title: t.title, recipient: r.recipientName, signedAt: r.signedAt?.toISOString() ?? null }] : [];
  });
}

// ─── Disclosures (ROI / Part 2) ──────────────────────────────────────────────

export async function loadDisclosureConsent(organizationId: string, consentFormId: string) {
  return prisma.consentForm.findFirst({ where: { id: consentFormId, organizationId }, select: { clientId: true, formKey: true, type: true, status: true, expiresAt: true, revokedAt: true } });
}

/** Valid (signed, unexpired, not revoked) ROI / Part 2 consents for a client (disclosure picker). */
export async function validDisclosureConsents(organizationId: string, clientId: string) {
  const now = new Date();
  const rows = await prisma.consentForm.findMany({
    where: {
      organizationId,
      clientId,
      status: 'SIGNED',
      revokedAt: null,
      AND: [
        { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
        { OR: [{ formKey: { in: [formKeyFor('roi-authorization'), formKeyFor('part2-consent')] } }, { formKey: null, type: 'Release of Information' }, { formKey: null, type: { contains: 'Part 2', mode: 'insensitive' } }] },
      ],
    },
    select: { id: true, type: true, recipientName: true, signedAt: true, expiresAt: true, formKey: true },
    orderBy: { signedAt: 'desc' },
  });
  return rows.map((r) => ({
    id: r.id,
    part2: r.formKey === formKeyFor('part2-consent') || /part 2/i.test(r.type),
    label: `${r.formKey === formKeyFor('part2-consent') ? 'Part 2 consent' : r.type}${r.recipientName ? ` to ${r.recipientName}` : ''} (signed ${r.signedAt?.toISOString().slice(0, 10) ?? '?'}${r.expiresAt ? `, expires ${r.expiresAt.toISOString().slice(0, 10)}` : ''})`,
  }));
}
