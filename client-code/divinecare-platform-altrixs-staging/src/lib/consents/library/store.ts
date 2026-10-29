/**
 * Consent library: database access (library state, client context, status, packets, intake).
 * Revocation, PDFs, portal and disclosure helpers are in store2.ts. Pure rules live next door
 * (catalog, lifecycle, composer, signing, status, revocation, pdf). Routes do auth + audit; every
 * staff function takes an org-scoped actor and checks the client is in scope (clientAccessWhere).
 *
 * Rows: one ConsentForm per signed section / authorization (formKey "lib:<key>", formVersion,
 * formData.frozen = exact rendered text + SHA-256), grouped by ConsentPacket.
 */
import { createHash } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import type { Prisma, Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { clientAccessWhere, clientByIdWhere } from '@/lib/clients/orgScope';
import { loadPracticeIdentity } from '@/lib/practice/identity';
import { getPracticeTimeZone } from '@/lib/time/practiceTimeServer';
import { practiceToday } from '@/lib/time/practiceTime';
import { signedFormPath } from '@/lib/storage/privateUploads';
import { primaryCarePatientWhere } from '@/lib/medical/medicalProgram';
import { isPart2Classification } from '@/lib/fhir/mapping/privacy';
import { marylandMedicaidPayerLabel } from '@/lib/consents/carelon/medicaid';
import type { ConsentTemplateVersion, FrozenSection, RenderedTemplate, ServiceFlag, TemplateStatus, TemplateVariables } from './types';
import { TEMPLATE_STATUS_LABEL } from './types';
import { ALL_TEMPLATE_VERSIONS, consentTypeFor, DEFAULT_PACKET_ORDER, formKeyFor, LIBRARY_FORM_PREFIX, renderTemplate, TEMPLATE_KEYS, templateVersion, versionsOf } from './catalog';
import { activeVersion, approvalLabel, canSendTemplate, effectiveStatus, indexStates, planLifecycle, type LibraryConfig, type LifecycleAction, type TemplateStateRow } from './lifecycle';
import { ageOn, composePacket, flagsFromInterests, type ComposeResult, type PacketClientContext, type PacketItem } from './composer';
import { expiresAtFor, validatePacketSubmission, type PacketSubmission, type SectionResponse, type SigningMethod } from './signing';
import { freeze, frozenIntact, hashRendered } from './freeze';
import { buildEvidence, validateStaffEvidence, type SigningEvidence, type StaffEvidenceInput } from './evidence';
import { computeClientConsents, type ClientConsentItem, type ComplianceRow, type ConsentRowLite } from './status';
import { mergeRequirements } from './requirements';

export type LibraryActor = { organizationId: string; userId: string; role: string };
export type Fail = { ok: false; status: number; error: string; errors?: string[] };

// ─── Library state ───────────────────────────────────────────────────────────

async function loadStateRows(organizationId: string) {
  return prisma.consentTemplateState.findMany({ where: { organizationId } }).catch(() => []);
}

export type LoadedLibrary = {
  states: Map<string, TemplateStateRow>;
  stateRows: Awaited<ReturnType<typeof loadStateRows>>;
  config: LibraryConfig;
  vars: TemplateVariables;
  selection: string[];
  settings: { packetKeys: string[]; packetCustomized: boolean; nppUrl: string | null; nppFileName: string | null; nppEffectiveDate: string | null } | null;
};

function appBase() {
  return (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || '').replace(/\/$/, '');
}

export async function loadLibrary(organizationId: string): Promise<LoadedLibrary> {
  const [stateRows, settings, identity, practice] = await Promise.all([
    loadStateRows(organizationId),
    prisma.consentLibrarySettings.findUnique({ where: { organizationId } }).catch(() => null),
    loadPracticeIdentity(organizationId),
    prisma.practiceSettings.findUnique({ where: { organizationId }, select: { mainPhone: true } }).catch(() => null),
  ]);
  const nppUrl = settings?.nppUrl?.trim() || (settings?.nppFileName ? `${appBase()}/api/consents/library/npp?org=${encodeURIComponent(organizationId)}` : null);
  const selection = settings?.packetCustomized ? settings.packetKeys.filter((k) => TEMPLATE_KEYS.includes(k)) : [...DEFAULT_PACKET_ORDER];
  return {
    states: indexStates(stateRows),
    stateRows,
    config: { nppReady: Boolean(nppUrl) },
    vars: { practiceName: identity.name, practicePhone: practice?.mainPhone ?? null, nppUrl, nppEffectiveDate: settings?.nppEffectiveDate ?? null },
    selection,
    settings: settings
      ? { packetKeys: settings.packetKeys, packetCustomized: settings.packetCustomized, nppUrl: settings.nppUrl, nppFileName: settings.nppFileName, nppEffectiveDate: settings.nppEffectiveDate }
      : null,
  };
}

/** Active + sendable version of a template for this practice, or the reason it cannot be used. */
export function resolveSendable(lib: LoadedLibrary, key: string): { template: ConsentTemplateVersion } | { reason: string } {
  const t = activeVersion(key, lib.states);
  if (!t) {
    const versions = versionsOf(key);
    const latest = versions[versions.length - 1];
    return { reason: latest ? `No Active version (latest is version ${latest.version}, ${effectiveStatus(latest, lib.states).toLowerCase()})` : 'Unknown template' };
  }
  const can = canSendTemplate(t, lib.states, lib.config);
  if (can.ok === false) return { reason: can.reason };
  const missing = renderTemplate(t, lib.vars).missingVariables;
  if (missing.length) return { reason: `Practice settings missing: ${missing.join(', ')}` };
  return { template: t };
}

export type LibraryVersionView = {
  key: string;
  version: number;
  title: string;
  category: string;
  origin: string;
  status: TemplateStatus;
  statusLabel: string;
  approval: string;
  approvedAt: string | null;
  approvedByName: string | null;
  activatedAt: string | null;
  retiredAt: string | null;
  source: string;
  changeNote: string | null;
  reviewFlags: ConsentTemplateVersion['reviewFlags'];
  renewalMonths: number | null;
  resignOnNewVersion: boolean;
  appliesTo: ConsentTemplateVersion['appliesTo'];
  signing: string;
  revocable: boolean;
  effects: string[];
  staffGuidance: string[];
  regulatoryElements: ConsentTemplateVersion['regulatoryElements'] | null;
  sendable: boolean;
  sendBlockedReason: string | null;
  rendered: RenderedTemplate;
  history: unknown;
};

export async function libraryView(organizationId: string) {
  const lib = await loadLibrary(organizationId);
  const versions: LibraryVersionView[] = ALL_TEMPLATE_VERSIONS.map((t) => {
    const row = lib.stateRows.find((r) => r.templateKey === t.key && r.version === t.version);
    const status = effectiveStatus(t, lib.states);
    const can = status === 'ACTIVE' ? resolveSendable(lib, t.key) : { reason: 'Only an Active version can be sent' };
    return {
      key: t.key,
      version: t.version,
      title: t.title,
      category: t.category,
      origin: t.origin,
      status,
      statusLabel: TEMPLATE_STATUS_LABEL[status],
      approval: approvalLabel(t, row),
      approvedAt: row?.approvedAt?.toISOString() ?? null,
      approvedByName: row?.approvedByName ?? null,
      activatedAt: row?.activatedAt?.toISOString() ?? null,
      retiredAt: row?.retiredAt?.toISOString() ?? null,
      source: t.source,
      changeNote: t.changeNote ?? null,
      reviewFlags: t.reviewFlags,
      renewalMonths: t.renewalMonths,
      resignOnNewVersion: t.resignOnNewVersion,
      appliesTo: t.appliesTo,
      signing: t.signing,
      revocable: t.revocable,
      effects: t.effects ?? [],
      staffGuidance: t.staffGuidance ?? [],
      regulatoryElements: t.regulatoryElements ?? null,
      sendable: 'template' in can && can.template.version === t.version,
      sendBlockedReason: 'reason' in can ? can.reason : null,
      rendered: renderTemplate(t, lib.vars),
      history: row?.history ?? null,
    };
  });
  return { versions, keys: TEMPLATE_KEYS, selection: lib.selection, settings: lib.settings, vars: lib.vars, defaultOrder: DEFAULT_PACKET_ORDER };
}

export async function userName(userId: string | null | undefined) {
  if (!userId) return null;
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } }).catch(() => null);
  return u?.name?.trim() || u?.email || null;
}

export async function applyLifecycle(actor: LibraryActor, key: string, version: number, action: LifecycleAction, note: string | null) {
  const lib = await loadLibrary(actor.organizationId);
  const plan = planLifecycle(actor.role, key, version, action, lib.states);
  if (plan.ok === false) return plan;
  const now = new Date();
  const byName = await userName(actor.userId);
  const trimmed = note?.trim().slice(0, 500) || null;
  await prisma.$transaction(
    plan.writes.map((w) => {
      const prev = lib.stateRows.find((r) => r.templateKey === w.templateKey && r.version === w.version);
      const history = [...((prev?.history as unknown[] | null) ?? []), { at: now.toISOString(), action: w.stamp, status: w.status, byId: actor.userId, byName, note: trimmed }];
      const stamp =
        w.stamp === 'approved'
          ? { approvedAt: now, approvedById: actor.userId, approvedByName: byName }
          : w.stamp === 'activated'
            ? { activatedAt: now, activatedById: actor.userId }
            : w.stamp === 'retired'
              ? { retiredAt: now, retiredById: actor.userId }
              : { approvedAt: null, approvedById: null, approvedByName: null };
      return prisma.consentTemplateState.upsert({
        where: { organizationId_templateKey_version: { organizationId: actor.organizationId, templateKey: w.templateKey, version: w.version } },
        create: { organizationId: actor.organizationId, templateKey: w.templateKey, version: w.version, status: w.status, note: trimmed, history: history as Prisma.InputJsonValue, ...stamp },
        update: { status: w.status, note: trimmed, history: history as Prisma.InputJsonValue, ...stamp },
      });
    })
  );
  return { ok: true as const, retiredVersion: plan.retiredVersion };
}

export async function saveLibrarySettings(actor: LibraryActor, input: { packetKeys?: string[]; nppUrl?: string | null; nppEffectiveDate?: string | null }) {
  const keys = input.packetKeys ? [...new Set(input.packetKeys)].filter((k) => TEMPLATE_KEYS.includes(k)) : undefined;
  const nppUrl = input.nppUrl === undefined ? undefined : input.nppUrl?.trim() || null;
  if (nppUrl && !/^https:\/\/\S+$/i.test(nppUrl)) return { ok: false as const, status: 400, error: 'The NPP link must be an https:// address.' };
  const data = {
    ...(keys ? { packetKeys: keys, packetCustomized: true } : {}),
    ...(nppUrl !== undefined ? { nppUrl } : {}),
    ...(input.nppEffectiveDate !== undefined ? { nppEffectiveDate: input.nppEffectiveDate?.trim() || null } : {}),
    updatedById: actor.userId,
  };
  await prisma.consentLibrarySettings.upsert({ where: { organizationId: actor.organizationId }, create: { organizationId: actor.organizationId, ...data }, update: data });
  return { ok: true as const };
}

export async function storeNppDocument(actor: LibraryActor, bytes: Uint8Array) {
  if (Buffer.from(bytes.slice(0, 5)).toString('latin1') !== '%PDF-') return { ok: false as const, status: 400, error: 'Upload the Notice of Privacy Practices as a PDF.' };
  const fileName = `npp-${actor.organizationId.replace(/[^A-Za-z0-9_-]/g, '')}.pdf`;
  const abs = signedFormPath(fileName);
  if (!abs) return { ok: false as const, status: 400, error: 'Invalid file name' };
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, bytes);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  await prisma.consentLibrarySettings.upsert({
    where: { organizationId: actor.organizationId },
    create: { organizationId: actor.organizationId, nppFileName: fileName, nppSha256: sha256, updatedById: actor.userId },
    update: { nppFileName: fileName, nppSha256: sha256, updatedById: actor.userId },
  });
  return { ok: true as const, sha256 };
}

/** The practice NPP PDF (a public document, not PHI). */
export async function nppDocument(organizationId: string): Promise<Uint8Array | null> {
  const s = await prisma.consentLibrarySettings.findUnique({ where: { organizationId } }).catch(() => null);
  if (!s?.nppFileName) return null;
  const abs = signedFormPath(s.nppFileName);
  if (!abs) return null;
  try {
    const buf = await readFile(abs);
    if (s.nppSha256 && createHash('sha256').update(buf).digest('hex') !== s.nppSha256) return null;
    return new Uint8Array(buf);
  } catch {
    return null;
  }
}

// ─── Client context (composer input) ─────────────────────────────────────────

export const CONTEXT_SELECT = {
  id: true,
  name: true,
  mrn: true,
  status: true,
  dateOfBirth: true,
  primaryCare: true,
  servicesInterested: true,
  medicaidId: true,
  insuranceType: true,
  insurancePayer: true,
  emergencyContactName: true,
  emergencyContactRelationship: true,
  emergencyContactPhone: true,
  guardianName: true,
  guardianRelationship: true,
  guardianAuthority: true,
  smsConsent: true,
  smsOptOutAt: true,
  locationId: true,
  assignedToId: true,
} satisfies Prisma.ClientSelect;
export type ContextClient = Prisma.ClientGetPayload<{ select: typeof CONTEXT_SELECT }>;

/** Context for many clients in a few batched queries (report / inbox). */
export async function contextsFor(organizationId: string, clients: ContextClient[], now = new Date()): Promise<Map<string, PacketClientContext>> {
  const out = new Map<string, PacketClientContext>();
  if (!clients.length) return out;
  const ids = clients.map((c) => c.id);
  const since = new Date(now.getTime() - 365 * 86_400_000);
  const [prp, sensitive, part2Notes, primary, virtual, rx] = await Promise.all([
    prisma.prpEnrollment.findMany({ where: { clientId: { in: ids }, status: { in: ['active', 'on_hold', 'transitioning'] } }, select: { clientId: true } }).catch(() => []),
    prisma.sensitiveRecord.findMany({ where: { organizationId, clientId: { in: ids } }, select: { clientId: true, noteClassification: true } }).catch(() => []),
    prisma.progressNote.findMany({ where: { clientId: { in: ids }, part2: true }, select: { clientId: true }, distinct: ['clientId'] }).catch(() => []),
    prisma.client.findMany({ where: { AND: [{ id: { in: ids } }, primaryCarePatientWhere() as Prisma.ClientWhereInput] }, select: { id: true } }).catch(() => []),
    prisma.appointment.findMany({ where: { clientId: { in: ids }, isVirtual: true, startsAt: { gte: since } }, select: { clientId: true }, distinct: ['clientId'] }).catch(() => []),
    prisma.ehrPrescription.findMany({ where: { clientId: { in: ids } }, select: { clientId: true }, distinct: ['clientId'] }).catch(() => []),
  ]);
  // Signals for the required-consent rules (requirements.ts)
  const [aot, autopay, scribeSessions, scribeCaptures] = await Promise.all([
    prisma.aotParticipant.findMany({ where: { clientId: { in: ids }, status: { in: ['active', 'renewal', 'stepdown'] } }, select: { clientId: true } }).catch(() => []),
    prisma.autopayEnrollment.findMany({ where: { clientId: { in: ids }, active: true }, select: { clientId: true } }).catch(() => []),
    prisma.scribeSession.findMany({ where: { organizationId, clientId: { in: ids }, sourceMode: { not: 'dictation' }, createdAt: { gte: since } }, select: { clientId: true }, distinct: ['clientId'] }).catch(() => []),
    prisma.scribeCapture.findMany({ where: { organizationId, clientId: { in: ids }, mode: { not: 'dictation' }, createdAt: { gte: since } }, select: { clientId: true }, distinct: ['clientId'] }).catch(() => []),
  ]);
  const aotSet = new Set(aot.map((r) => r.clientId));
  const autopaySet = new Set(autopay.map((r) => r.clientId));
  const scribeSet = new Set([...scribeSessions.map((r) => r.clientId), ...scribeCaptures.map((r) => r.clientId)]);
  const prpSet = new Set(prp.map((r) => r.clientId));
  const sudSet = new Set([...sensitive.filter((s) => isPart2Classification(s.noteClassification)).map((s) => s.clientId), ...part2Notes.map((n) => n.clientId)]);
  const pcSet = new Set(primary.map((r) => r.id));
  const teleSet = new Set(virtual.map((r) => r.clientId));
  const rxSet = new Set(rx.map((r) => r.clientId));
  for (const c of clients) {
    const flags = new Set<ServiceFlag>(flagsFromInterests(c.servicesInterested));
    if (prpSet.has(c.id)) flags.add('prp');
    if (sudSet.has(c.id)) flags.add('sud');
    if (pcSet.has(c.id) || c.primaryCare) flags.add('primary_care');
    if (teleSet.has(c.id)) flags.add('telehealth');
    if (rxSet.has(c.id)) flags.add('medication');
    if (!flags.size || [...flags].every((f) => f === 'telehealth')) flags.add('omhc');
    out.set(c.id, {
      ...contextFromClient(c, [...flags], now),
      signals: { aot: aotSet.has(c.id), autopay: autopaySet.has(c.id), smsConsent: Boolean(c.smsConsent && !c.smsOptOutAt), aiScribe: scribeSet.has(c.id) },
    });
  }
  return out;
}

function contextFromClient(
  c: Pick<ContextClient, 'dateOfBirth' | 'medicaidId' | 'insuranceType' | 'insurancePayer' | 'emergencyContactName' | 'emergencyContactRelationship' | 'emergencyContactPhone'>,
  services: ServiceFlag[],
  now: Date
): PacketClientContext {
  const otherState = /(district of columbia|virginia|\bdc\b|\bva\b)/i.test(c.insurancePayer ?? '');
  return {
    ageYears: ageOn(c.dateOfBirth, now),
    services,
    medicaid: Boolean(c.medicaidId?.trim() || marylandMedicaidPayerLabel(c.insurancePayer) || (/medicaid/i.test(c.insuranceType ?? '') && !otherState)),
    emergencyContact: c.emergencyContactName?.trim() ? { name: c.emergencyContactName.trim(), relationship: c.emergencyContactRelationship ?? null, phone: c.emergencyContactPhone ?? null } : null,
  };
}

export function composeFor(lib: LoadedLibrary, ctx: PacketClientContext, today: string, selection?: string[]): ComposeResult {
  return composePacket({ selection: selection ?? lib.selection, resolve: (k) => resolveSendable(lib, k), ctx, today });
}

/** What the client must have on file: the packet composition plus the required-consent rules (status only). */
export function requiredFor(lib: LoadedLibrary, ctx: PacketClientContext, today: string): ComposeResult {
  return mergeRequirements(composeFor(lib, ctx, today), ctx, (k) => resolveSendable(lib, k));
}

// ─── Rows → status ───────────────────────────────────────────────────────────

export const ROW_SELECT = {
  id: true,
  clientId: true,
  formKey: true,
  type: true,
  formVersion: true,
  status: true,
  formStatus: true,
  signedAt: true,
  expiresAt: true,
  revokedAt: true,
  createdAt: true,
  signedByName: true,
  recipientName: true,
  formData: true,
} satisfies Prisma.ConsentFormSelect;
type RowSel = Prisma.ConsentFormGetPayload<{ select: typeof ROW_SELECT }>;

/** Legacy simple consents (incl. point-of-care AI consents from the scribe) count for library templates. */
const LEGACY_TYPES = ['Consent to Treat', 'HIPAA Notice', 'Telehealth Consent', 'AI Note Drafting', 'Release of Information'];

function rowWhere(organizationId: string, clientIds: string[]): Prisma.ConsentFormWhereInput {
  return { organizationId, clientId: { in: clientIds }, OR: [{ formKey: { startsWith: LIBRARY_FORM_PREFIX } }, { formKey: null, type: { in: LEGACY_TYPES } }] };
}

function lite(r: RowSel): ConsentRowLite {
  const fd = (r.formData ?? {}) as { purposeTag?: string | null };
  return { ...r, purposeTag: fd.purposeTag ?? null };
}

export type ComplianceData = {
  rows: ComplianceRow[];
  clients: ContextClient[];
  contexts: Map<string, PacketClientContext>;
  /** per client: the required composition (packet + rules) */
  required: Map<string, ComposeResult>;
};

/** Required consents and their state for every active client in scope, with the inputs used. */
export async function loadComplianceData(scopeWhere: Prisma.ClientWhereInput, organizationId: string, opts: { now?: Date; clientIds?: string[] } = {}): Promise<ComplianceData> {
  const now = opts.now ?? new Date();
  const clients = await prisma.client.findMany({
    where: { AND: [scopeWhere, { organizationId, status: 'ACTIVE', deceasedAt: null } as Prisma.ClientWhereInput, ...(opts.clientIds ? [{ id: { in: opts.clientIds } }] : [])] },
    select: CONTEXT_SELECT,
    take: 20_000,
  });
  const required = new Map<string, ComposeResult>();
  if (!clients.length) return { rows: [], clients, contexts: new Map(), required };
  const [lib, tz] = await Promise.all([loadLibrary(organizationId), getPracticeTimeZone(organizationId)]);
  const today = practiceToday(tz, now);
  const ids = clients.map((c) => c.id);
  const [contexts, rows] = await Promise.all([contextsFor(organizationId, clients, now), prisma.consentForm.findMany({ where: rowWhere(organizationId, ids), select: ROW_SELECT })]);
  const byClient = new Map<string, ConsentRowLite[]>();
  for (const r of rows) byClient.set(r.clientId, [...(byClient.get(r.clientId) ?? []), lite(r)]);
  const out: ComplianceRow[] = [];
  for (const c of clients) {
    const composed = requiredFor(lib, contexts.get(c.id)!, today);
    required.set(c.id, composed);
    const items = computeClientConsents({ composed, rows: byClient.get(c.id) ?? [], activeOf: (k) => activeVersion(k, lib.states), now });
    for (const i of items) out.push({ ...i, clientId: c.id, clientName: c.name, mrn: c.mrn ?? null });
  }
  return { rows: out, clients, contexts, required };
}

export async function loadComplianceRows(scopeWhere: Prisma.ClientWhereInput, organizationId: string, opts: { now?: Date; clientIds?: string[] } = {}): Promise<ComplianceRow[]> {
  return (await loadComplianceData(scopeWhere, organizationId, opts)).rows;
}

// ─── Per-client view ─────────────────────────────────────────────────────────

export async function scopedClient(actor: LibraryActor, clientId: string) {
  return prisma.client.findFirst({
    where: { AND: [clientByIdWhere(clientId, actor.organizationId), clientAccessWhere({ organizationId: actor.organizationId, actorUserId: actor.userId, actorRole: actor.role as Role })] },
    select: CONTEXT_SELECT,
  });
}

export type ClientConsentView = {
  client: { id: string; name: string; mrn: string | null; age: number | null };
  context: PacketClientContext;
  composition: ComposeResult;
  items: ClientConsentItem[];
  packets: { id: string; status: string; method: string; sentAt: string; signedAt: string | null; signerName: string | null; itemCount: number; viewedAt: string | null; lastSentAt: string | null; sendCount: number; deliveryChannels: string[] }[];
  sendableTemplates: { key: string; version: number; title: string; signing: string }[];
  timeZone: string;
};

export async function loadClientConsents(actor: LibraryActor, clientId: string): Promise<{ ok: true; view: ClientConsentView } | Fail> {
  const c = await scopedClient(actor, clientId);
  if (!c) return { ok: false, status: 404, error: 'Client not found' };
  const now = new Date();
  const [lib, tz, ctxMap, rows, packets] = await Promise.all([
    loadLibrary(actor.organizationId),
    getPracticeTimeZone(actor.organizationId),
    contextsFor(actor.organizationId, [c], now),
    prisma.consentForm.findMany({ where: rowWhere(actor.organizationId, [c.id]), select: ROW_SELECT }),
    prisma.consentPacket.findMany({ where: { organizationId: actor.organizationId, clientId: c.id }, orderBy: { sentAt: 'desc' }, take: 30 }),
  ]);
  const ctx = ctxMap.get(c.id)!;
  const composition = composeFor(lib, ctx, practiceToday(tz, now));
  const required = mergeRequirements(composition, ctx, (k) => resolveSendable(lib, k));
  const items = computeClientConsents({ composed: required, rows: rows.map(lite), activeOf: (k) => activeVersion(k, lib.states), now });
  const sendable = TEMPLATE_KEYS.map((k) => resolveSendable(lib, k)).flatMap((r) => ('template' in r ? [{ key: r.template.key, version: r.template.version, title: r.template.title, signing: r.template.signing }] : []));
  return {
    ok: true,
    view: {
      client: { id: c.id, name: c.name, mrn: c.mrn ?? null, age: ctx.ageYears },
      context: ctx,
      composition: { ...composition, requiredUnavailable: required.requiredUnavailable ?? [] },
      items,
      packets: packets.map((p) => ({
        id: p.id,
        status: p.status,
        method: p.method,
        sentAt: p.sentAt.toISOString(),
        signedAt: p.signedAt?.toISOString() ?? null,
        signerName: p.signerName,
        itemCount: Array.isArray(p.items) ? p.items.length : 0,
        viewedAt: p.viewedAt?.toISOString() ?? null,
        lastSentAt: p.lastSentAt?.toISOString() ?? null,
        sendCount: p.sendCount,
        deliveryChannels: p.deliveryChannels,
      })),
      sendableTemplates: sendable,
      timeZone: tz,
    },
  };
}

/** Banner: required consents needing action (missing / expired / revoked / re-sign / declined). */
export async function clientConsentGaps(organizationId: string, clientId: string): Promise<ClientConsentItem[]> {
  const rows = await loadComplianceRows({ organizationId }, organizationId, { clientIds: [clientId] });
  return rows.filter((r) => r.required && r.needsAction && r.state !== 'pending');
}

// ─── Packets ─────────────────────────────────────────────────────────────────

export type LibraryFormData = {
  kind: 'library';
  templateKey: string;
  version: number;
  packetId: string;
  purposeTag: string | null;
  prefill: Record<string, string | string[]> | null;
  frozen: FrozenSection | null;
  response: SectionResponse | null;
  ownSignature: { typed: string; signedAt: string } | null;
  declined: boolean;
  writtenConfirmationNeeded?: boolean;
  revocation?: { receivedOn: string; method: string; receivedVia: string; note: string | null; channels: string[] | null; recordedById: string | null; recordedAt: string; effects: string[] } | null;
  /** Communication consent: channels revoked one at a time (the signed response is never edited) */
  channelRevocations?: { channels: string[]; receivedOn: string; method: string; receivedVia: string; note: string | null; recordedById: string | null; recordedAt: string; effects: string[] }[];
  events: { at: string; action: string; byId: string | null; detail?: string }[];
};

export { freeze, frozenIntact, hashRendered };

async function createPacketRows(input: { organizationId: string; clientId: string; items: PacketItem[]; composition: ComposeResult | null; method: SigningMethod; createdById: string | null; intakeInviteId?: string | null }) {
  return prisma.$transaction(async (tx) => {
    const packet = await tx.consentPacket.create({
      data: {
        organizationId: input.organizationId,
        clientId: input.clientId,
        intakeInviteId: input.intakeInviteId ?? null,
        status: 'SENT',
        method: input.method,
        items: input.items as unknown as Prisma.InputJsonValue,
        composition: input.composition ? ({ skipped: input.composition.skipped, minor: input.composition.minor, carelonAttestation: input.composition.carelonAttestation } as unknown as Prisma.InputJsonValue) : undefined,
        createdById: input.createdById,
      },
    });
    for (const item of input.items) {
      const t = templateVersion(item.key, item.version)!;
      const fd: LibraryFormData = {
        kind: 'library',
        templateKey: item.key,
        version: item.version,
        packetId: packet.id,
        purposeTag: item.purposeTag ?? null,
        prefill: item.prefill ?? null,
        frozen: null,
        response: null,
        ownSignature: null,
        declined: false,
        events: [{ at: new Date().toISOString(), action: 'sent', byId: input.createdById }],
      };
      await tx.consentForm.create({
        data: {
          organizationId: input.organizationId,
          clientId: input.clientId,
          type: consentTypeFor(t),
          status: 'PENDING',
          method: input.method === 'portal' ? 'Patient Portal' : input.method === 'intake' ? 'Intake Packet' : 'In-Person',
          createdById: input.createdById,
          formKey: formKeyFor(item.key),
          formVersion: String(item.version),
          formStatus: 'SENT',
          formData: fd as unknown as Prisma.InputJsonValue,
          packetId: packet.id,
          recipientName: typeof item.prefill?.recipientName === 'string' ? item.prefill.recipientName : null,
        },
      });
    }
    return packet;
  });
}

/** Create a packet for already-composed items (worklist bulk send keeps prefill / purpose tags). */
export async function createPacketForItems(actor: LibraryActor, clientId: string, items: PacketItem[], composition: ComposeResult, method: 'portal' | 'in_office') {
  const packet = await createPacketRows({ organizationId: actor.organizationId, clientId, items, composition, method, createdById: actor.userId });
  return packet.id;
}

/**
 * Staff send: the composed new-client packet (keys omitted), or chosen templates (e.g. an ROI to a
 * named recipient with prefill). Only Active, sendable versions; method portal or in_office.
 */
export async function createPacket(actor: LibraryActor, clientId: string, input: { method: 'portal' | 'in_office'; keys?: string[]; prefill?: Record<string, Record<string, string | string[]>> }) {
  const c = await scopedClient(actor, clientId);
  if (!c) return { ok: false as const, status: 404, error: 'Client not found' };
  const now = new Date();
  const [lib, tz, ctxMap] = await Promise.all([loadLibrary(actor.organizationId), getPracticeTimeZone(actor.organizationId), contextsFor(actor.organizationId, [c], now)]);
  const ctx = ctxMap.get(c.id)!;
  let composition: ComposeResult | null = null;
  let items: PacketItem[];
  if (input.keys?.length) {
    items = [];
    for (const key of [...new Set(input.keys)]) {
      const r = resolveSendable(lib, key);
      if (!('template' in r)) return { ok: false as const, status: 409, error: `${key}: ${r.reason}` };
      const t = r.template;
      items.push({ key, version: t.version, title: t.title, signing: t.signing, optional: false, reason: 'Sent by staff', prefill: input.prefill?.[key] });
    }
    composition = { items, skipped: [], carelonAttestation: false, minor: composePacket({ selection: [], resolve: () => ({ reason: '' }), ctx, today: practiceToday(tz, now) }).minor };
  } else {
    composition = composeFor(lib, ctx, practiceToday(tz, now));
    items = composition.items;
    if (!items.length) return { ok: false as const, status: 409, error: 'No Active consent templates apply to this client.' };
  }
  const packet = await createPacketRows({ organizationId: actor.organizationId, clientId: c.id, items, composition, method: input.method, createdById: actor.userId });
  return { ok: true as const, packetId: packet.id, itemCount: items.length, carelonAttestation: composition.carelonAttestation };
}

export type PacketForSigning = {
  id: string;
  status: string;
  method: string;
  clientName: string;
  practiceName: string | null;
  items: (PacketItem & { rendered: RenderedTemplate; rowId: string | null })[];
  minor: ComposeResult['minor'];
  guardian: { name: string | null; relationship: string | null; authority: string | null } | null;
  signedAt: string | null;
  signerName: string | null;
};

export async function packetForSigning(organizationId: string, packetId: string, clientFilter?: string): Promise<PacketForSigning | null> {
  const p = await prisma.consentPacket.findFirst({ where: { id: packetId, organizationId, ...(clientFilter ? { clientId: clientFilter } : {}) } });
  if (!p) return null;
  const [lib, client, rows] = await Promise.all([
    loadLibrary(organizationId),
    prisma.client.findUnique({ where: { id: p.clientId }, select: CONTEXT_SELECT }),
    prisma.consentForm.findMany({ where: { organizationId, packetId: p.id }, select: { id: true, formKey: true, formData: true } }),
  ]);
  if (!client) return null;
  const items = (p.items as unknown as PacketItem[]).map((it) => {
    const row = rows.find((r) => r.formKey === formKeyFor(it.key) && ((r.formData as LibraryFormData | null)?.purposeTag ?? null) === (it.purposeTag ?? null));
    const fd = row?.formData as LibraryFormData | null;
    const t = templateVersion(it.key, it.version)!;
    return { ...it, rendered: fd?.frozen ?? renderTemplate(t, lib.vars), rowId: row?.id ?? null };
  });
  const composition = p.composition as { minor?: ComposeResult['minor'] } | null;
  return {
    id: p.id,
    status: p.status,
    method: p.method,
    clientName: client.name,
    practiceName: lib.vars.practiceName,
    items,
    minor: composition?.minor ?? null,
    guardian: client.guardianName ? { name: client.guardianName, relationship: client.guardianRelationship, authority: client.guardianAuthority } : null,
    signedAt: p.signedAt?.toISOString() ?? null,
    signerName: p.signerName,
  };
}

export async function staffPacket(actor: LibraryActor, packetId: string) {
  const p = await prisma.consentPacket.findFirst({ where: { id: packetId, organizationId: actor.organizationId }, select: { clientId: true } });
  if (!p || !(await scopedClient(actor, p.clientId))) return null;
  return packetForSigning(actor.organizationId, packetId);
}

/** Effects of signing that live on the client record (communication preferences). */
async function applySigningEffects(tx: Prisma.TransactionClient, clientId: string, t: ConsentTemplateVersion, resp: SectionResponse, method: SigningMethod, at: Date) {
  if (!t.effects?.includes('sms')) return;
  const sms = resp.choices?.sms;
  const email = resp.choices?.email;
  const source = method === 'intake' ? 'intake' : method === 'portal' ? 'portal' : 'staff_written';
  await tx.client.update({
    where: { id: clientId },
    data: {
      ...(sms === 'yes' ? { smsConsent: true, smsConsentAt: at, smsConsentSource: source, smsOptOutAt: null } : sms === 'no' ? { smsConsent: false } : {}),
      ...(email === 'yes' ? { emailOptOutAt: null } : email === 'no' ? { emailOptOutAt: at } : {}),
    },
  });
}

/**
 * Sign a packet (intake, portal or in office): validates every section against the version that
 * was sent, freezes the rendered text + SHA-256 into each row, applies effects, stores the PDF.
 */
export type SigningContext = {
  /** IP address + user agent of the signing request (e-signature evidence) */
  request?: { ipAddress: string | null; userAgent: string | null } | null;
  portalAccountId?: string | null;
  proxy?: SigningEvidence['proxy'];
  /** In office: how the client signed, interpreter, witness, scanned paper */
  staffInput?: StaffEvidenceInput | null;
};

export async function signPacket(
  organizationId: string,
  packetId: string,
  sub: PacketSubmission,
  by: { method: SigningMethod; recordedById: string | null; clientId?: string; evidence?: SigningContext }
): Promise<{ ok: true; packetId: string; clientId: string; pdfStored: boolean } | Fail> {
  const view = await packetForSigning(organizationId, packetId, by.clientId);
  if (!view) return { ok: false, status: 404, error: 'Packet not found' };
  if (view.status !== 'SENT') return { ok: false, status: 409, error: 'This packet is not waiting for a signature.' };
  const lib = await loadLibrary(organizationId);
  const rendered = new Map<string, RenderedTemplate>();
  for (const it of view.items) {
    const t = templateVersion(it.key, it.version);
    // A version retired after sending cannot be signed: staff re-send the current one
    if (!t || effectiveStatus(t, lib.states) !== 'ACTIVE') return { ok: false, status: 409, error: `${it.title} was replaced by a newer version. Ask staff to send the packet again.` };
    rendered.set(it.key, renderTemplate(t, lib.vars));
  }
  const errors = validatePacketSubmission(view.items, rendered, sub, view.minor);
  const staffInput = by.method === 'in_office' ? by.evidence?.staffInput ?? null : null;
  if (staffInput) {
    const signedTemplates = view.items.filter((it) => !(it.optional && sub.sections[it.key]?.declined)).map((it) => templateVersion(it.key, it.version)!);
    errors.push(...validateStaffEvidence(staffInput, signedTemplates));
  }
  if (errors.length) return { ok: false, status: 400, error: errors[0], errors };
  const now = new Date();
  const frozenByKey = new Map(view.items.map((it) => [it.key, freeze(rendered.get(it.key)!, now)]));
  const evidence = buildEvidence({
    signatureMethod: by.method === 'portal' ? 'portal_esign' : by.method === 'intake' ? 'intake_esign' : staffInput?.signatureMethod ?? 'in_office_tablet',
    signedAt: now,
    request: by.evidence?.request ?? null,
    portalAccountId: by.evidence?.portalAccountId ?? null,
    proxy: by.evidence?.proxy ?? null,
    staff: by.method === 'in_office' ? { userId: by.recordedById, name: await userName(by.recordedById) } : null,
    staffInput,
    hashes: view.items.map((it) => ({ key: it.key, version: it.version, sha256: frozenByKey.get(it.key)!.sha256 })),
  });
  const s = sub.signer;
  const signerName = s.printedName.trim().slice(0, 120);
  const clientId = (await prisma.consentPacket.findUnique({ where: { id: packetId }, select: { clientId: true } }))!.clientId;
  await prisma.$transaction(async (tx) => {
    for (const it of view.items) {
      const t = templateVersion(it.key, it.version)!;
      const resp = sub.sections[it.key];
      const declined = Boolean(it.optional && resp?.declined);
      const fields = { ...(it.prefill ?? {}), ...(resp?.fields ?? {}) };
      const response: SectionResponse = { ...(resp as SectionResponse), fields };
      const fd: LibraryFormData = {
        kind: 'library',
        templateKey: it.key,
        version: it.version,
        packetId,
        purposeTag: it.purposeTag ?? null,
        prefill: it.prefill ?? null,
        frozen: frozenByKey.get(it.key)!,
        response: declined ? null : response,
        ownSignature: it.signing === 'standalone' && !declined ? { typed: (resp?.signature ?? '').trim().slice(0, 120), signedAt: now.toISOString() } : null,
        declined,
        events: [{ at: now.toISOString(), action: declined ? `declined_${by.method}` : `signed_${by.method}`, byId: by.recordedById }],
      };
      const data = {
        status: declined ? ('DECLINED' as const) : ('SIGNED' as const),
        formStatus: declined ? 'DECLINED' : 'SIGNED',
        signedAt: now,
        clientSignedAt: now,
        expiresAt: declined ? null : expiresAtFor(t.renewalMonths, fields, now),
        signedByName: s.signerType === 'representative' ? `${signerName} (${s.relationship?.trim()}, for ${view.clientName})` : signerName,
        formData: fd as unknown as Prisma.InputJsonValue,
        recipientName: typeof fields.recipientName === 'string' && fields.recipientName.trim() ? fields.recipientName.trim().slice(0, 200) : null,
        method: by.method === 'portal' ? 'Patient Portal' : by.method === 'intake' ? 'Intake Packet' : 'In-Person',
      };
      if (it.rowId) await tx.consentForm.update({ where: { id: it.rowId }, data });
      else await tx.consentForm.create({ data: { ...data, organizationId, clientId, type: consentTypeFor(t), formKey: formKeyFor(it.key), formVersion: String(it.version), packetId, createdById: by.recordedById } });
      if (!declined) await applySigningEffects(tx, clientId, t, response, by.method, now);
    }
    await tx.consentPacket.update({
      where: { id: packetId },
      data: {
        status: 'SIGNED',
        signedAt: now,
        signerType: s.signerType,
        signerName,
        signerRelationship: s.signerType === 'representative' ? s.relationship?.trim().slice(0, 80) ?? null : null,
        signerAuthority: s.signerType === 'representative' ? s.authority?.trim().slice(0, 300) ?? null : null,
        signatureTyped: s.signature.trim().slice(0, 120),
        recordedById: by.recordedById,
        evidence: evidence as unknown as Prisma.InputJsonValue,
      },
    });
    if (s.signerType === 'representative') {
      await tx.client.update({ where: { id: clientId }, data: { guardianName: signerName, guardianRelationship: s.relationship?.trim().slice(0, 80) ?? null, guardianAuthority: s.authority?.trim().slice(0, 300) ?? null, hasGuardian: true } });
    }
  });
  const { storePacketPdf } = await import('./store2');
  const stored = await storePacketPdf(organizationId, packetId).catch(() => null);
  return { ok: true, packetId, clientId, pdfStored: Boolean(stored) };
}

export async function voidPacket(actor: LibraryActor, packetId: string, reason: string) {
  const p = await prisma.consentPacket.findFirst({ where: { id: packetId, organizationId: actor.organizationId } });
  if (!p || !(await scopedClient(actor, p.clientId))) return { ok: false as const, status: 404, error: 'Packet not found' };
  if (p.status !== 'SENT') return { ok: false as const, status: 409, error: 'Only an unsigned packet can be cancelled.' };
  if (reason.trim().length < 3) return { ok: false as const, status: 400, error: 'Give a reason (3+ characters).' };
  const now = new Date();
  await prisma.$transaction([
    prisma.consentPacket.update({ where: { id: p.id }, data: { status: 'VOIDED', voidedAt: now, voidReason: reason.trim().slice(0, 300) } }),
    prisma.consentForm.updateMany({ where: { organizationId: actor.organizationId, packetId: p.id, status: 'PENDING' }, data: { formStatus: 'VOIDED', status: 'EXPIRED' } }),
  ]);
  return { ok: true as const, clientId: p.clientId };
}

// ─── Intake ──────────────────────────────────────────────────────────────────

export type IntakeAnswers = {
  dateOfBirth: string | null;
  servicesInterested: string[];
  telehealth: boolean;
  insurancePayer: string | null;
  emergencyContact: PacketClientContext['emergencyContact'];
};

export function intakeContext(input: IntakeAnswers, now = new Date()): PacketClientContext {
  const flags = new Set<ServiceFlag>(flagsFromInterests(input.servicesInterested));
  if (input.telehealth) flags.add('telehealth');
  if (!flags.size || [...flags].every((f) => f === 'telehealth')) flags.add('omhc');
  return { ageYears: ageOn(input.dateOfBirth, now), services: [...flags], medicaid: Boolean(marylandMedicaidPayerLabel(input.insurancePayer)), emergencyContact: input.emergencyContact };
}

/** Packet for the public intake page, composed from the intake answers (no chart yet). */
export async function intakePacketPreview(organizationId: string, answers: IntakeAnswers) {
  const [lib, tz] = await Promise.all([loadLibrary(organizationId), getPracticeTimeZone(organizationId)]);
  const composition = composeFor(lib, intakeContext(answers), practiceToday(tz));
  return {
    items: composition.items.map((it) => ({ ...it, rendered: renderTemplate(templateVersion(it.key, it.version)!, lib.vars) })),
    minor: composition.minor,
    carelonAttestation: composition.carelonAttestation,
    practiceName: lib.vars.practiceName,
  };
}

/** Validate an intake submission before the chart is created (a bad packet must not create a chart). */
export async function validateIntakePacket(organizationId: string, answers: IntakeAnswers, sub: PacketSubmission): Promise<string[]> {
  const [lib, tz] = await Promise.all([loadLibrary(organizationId), getPracticeTimeZone(organizationId)]);
  const composition = composeFor(lib, intakeContext(answers), practiceToday(tz));
  const rendered = new Map(composition.items.map((it) => [it.key, renderTemplate(templateVersion(it.key, it.version)!, lib.vars)]));
  return validatePacketSubmission(composition.items, rendered, sub, composition.minor);
}

/**
 * Public intake: after the chart exists, compose the packet from the intake answers (server side,
 * never trusting the browser's list) and record it as signed (method intake).
 */
export async function recordIntakePacket(input: { organizationId: string; clientId: string; intakeInviteId: string; staffOwnerId: string | null; answers: IntakeAnswers; submission: PacketSubmission; request?: SigningContext['request'] }): Promise<{ ok: true; packetId: string } | { ok: false; reason: string; errors?: string[] }> {
  const [lib, tz] = await Promise.all([loadLibrary(input.organizationId), getPracticeTimeZone(input.organizationId)]);
  const composition = composeFor(lib, intakeContext(input.answers), practiceToday(tz));
  if (!composition.items.length) return { ok: false, reason: 'no_active_templates' };
  const packet = await createPacketRows({ organizationId: input.organizationId, clientId: input.clientId, items: composition.items, composition, method: 'intake', createdById: input.staffOwnerId, intakeInviteId: input.intakeInviteId });
  const r = await signPacket(input.organizationId, packet.id, input.submission, { method: 'intake', recordedById: null, evidence: { request: input.request ?? null } });
  if (r.ok === false) return { ok: false, reason: r.error, errors: r.errors };
  return { ok: true, packetId: packet.id };
}
