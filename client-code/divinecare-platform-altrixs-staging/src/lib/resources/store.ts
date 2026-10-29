import 'server-only';
import { randomUUID } from 'crypto';
import path from 'path';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { Prisma, type Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import { assertClientPhiAccess, lockedSensitiveClientIds, SensitiveRecordAccessError } from '@/lib/privacy/sensitiveAccess';
import { isPart2Classification } from '@/lib/fhir/mapping/privacy';
import { resourceFilePath } from '@/lib/storage/privateUploads';
import { sendToUser } from '@/lib/notifications/pushService';
import {
  canAssignResources,
  canManageResources,
  canManageStaffResources,
  canReviewResources,
  canSeePatientItem,
  canSeeStaffItem,
  canUseResourceLibrary,
  RESOURCE_LIBRARY_PATH,
} from './access';
import {
  activationProblem,
  assignmentIsPart2,
  assignProblem,
  isSudItem,
  patientAssignmentWhere,
  patientStatusChange,
  recentItemIds,
  resourceNotificationPlan,
  staffWithdrawProblem,
} from './rules';
import { AOT_LINK_NEEDED_NOTE, AOT_RESOURCE_SEEDS, COMMUNITY_SEEDS, SEED_ITEMS } from './seedCatalog';
import { verifiedSource } from './verifiedSources';
import {
  UPLOAD_MAX_BYTES,
  UPLOAD_MIME,
  type AssignmentContext,
  type AssignmentDto,
  type AssignmentStatus,
  type PatientResourceDto,
  type ResourceItemDto,
  type ResourceStatus,
} from './types';

/**
 * Resource library data access. Every function takes the signed-in actor and enforces the
 * organization, the role rules (./access.ts), caseload scope and protected-record masking.
 * Routes write the audit rows (ids only) with the client ids returned as `patientIds`.
 */

export type ResourceActor = { organizationId: string; userId: string; role: Role | string };

export class ResourceError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ResourceError';
  }
}

type ItemRow = Prisma.ResourceItemGetPayload<object>;

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const ymd = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

function itemDto(r: ItemRow, state?: { favorite: boolean; lastUsedAt: Date | null }): ResourceItemDto {
  return {
    id: r.id,
    audience: r.audience as ResourceItemDto['audience'],
    kind: r.kind as ResourceItemDto['kind'],
    title: r.title,
    summary: r.summary,
    body: r.body,
    url: r.url,
    contactPhone: r.contactPhone,
    contactText: r.contactText,
    hasFile: Boolean(r.fileStoredName),
    fileName: r.fileName,
    fileMime: r.fileMime,
    fileSize: r.fileSize,
    topics: r.topics,
    audiences: r.audiences,
    language: r.language,
    readingLevel: r.readingLevel,
    publisher: r.publisher,
    licenseNote: r.licenseNote,
    linkCheckedAt: iso(r.linkCheckedAt),
    lastReviewedAt: iso(r.lastReviewedAt),
    reviewerName: r.reviewerName,
    status: r.status as ResourceStatus,
    staffCategory: r.staffCategory,
    visibleRoles: r.visibleRoles,
    sudRelated: r.sudRelated,
    seeded: Boolean(r.seedKey),
    legacy: Boolean(r.legacySourceId),
    favorite: state?.favorite ?? false,
    lastUsedAt: iso(state?.lastUsedAt ?? null),
    updatedAt: r.updatedAt.toISOString(),
  };
}

async function actorName(actor: ResourceActor) {
  const u = await prisma.user.findFirst({ where: { id: actor.userId, organizationId: actor.organizationId }, select: { name: true, email: true, credentials: true } });
  if (!u) return null;
  const name = u.name?.trim() || u.email;
  return u.credentials?.trim() ? `${name}, ${u.credentials.trim()}` : name;
}

function visible(actor: ResourceActor, r: Pick<ItemRow, 'audience' | 'status' | 'visibleRoles'>) {
  if (r.audience === 'staff') return canSeeStaffItem(actor.role, r.visibleRoles) && (r.status === 'active' || canManageStaffResources(actor.role));
  return canSeePatientItem(actor.role, r.status);
}

async function loadItem(actor: ResourceActor, id: string) {
  const row = await prisma.resourceItem.findFirst({ where: { id, organizationId: actor.organizationId } });
  if (!row || !visible(actor, row)) throw new ResourceError('Resource not found', 404);
  return row;
}

function canEdit(actor: ResourceActor, r: Pick<ItemRow, 'audience'>) {
  return r.audience === 'staff' ? canManageStaffResources(actor.role) : canManageResources(actor.role);
}

// ─── Library ────────────────────────────────────────────────────────────────

export async function listItems(actor: ResourceActor, scope: 'patient' | 'staff') {
  if (scope === 'patient' && !canUseResourceLibrary(actor.role)) throw new ResourceError('Forbidden', 403);
  const [rows, states] = await Promise.all([
    prisma.resourceItem.findMany({ where: { organizationId: actor.organizationId, audience: scope }, orderBy: [{ title: 'asc' }], take: 2000 }),
    prisma.resourceUserState.findMany({ where: { organizationId: actor.organizationId, userId: actor.userId }, select: { itemId: true, favorite: true, lastUsedAt: true } }),
  ]);
  const byItem = new Map(states.map((s) => [s.itemId, s]));
  const items = rows.filter((r) => visible(actor, r)).map((r) => itemDto(r, byItem.get(r.id)));
  const ids = new Set(items.map((i) => i.id));
  return {
    items,
    recent: recentItemIds(states.filter((s) => ids.has(s.itemId))),
    seededCount: rows.filter((r) => r.seedKey).length,
    /** MDH AOT resources (drafts needing a link) not yet added to this library */
    aotSeedMissing: scope === 'patient' ? AOT_RESOURCE_SEEDS.filter((a) => !rows.some((r) => r.seedKey === a.seedKey)).length : 0,
    canManage: scope === 'staff' ? canManageStaffResources(actor.role) : canManageResources(actor.role),
    canReview: scope === 'patient' && canReviewResources(actor.role),
    canAssign: scope === 'patient' && canAssignResources(actor.role),
  };
}

export type ItemInput = {
  audience?: 'patient' | 'staff';
  kind: string;
  title: string;
  summary?: string | null;
  body?: string | null;
  url?: string | null;
  contactPhone?: string | null;
  contactText?: string | null;
  topics?: string[];
  audiences?: string[];
  language?: string;
  readingLevel?: string | null;
  publisher?: string | null;
  licenseNote?: string | null;
  staffCategory?: string | null;
  visibleRoles?: string[];
  sudRelated?: boolean;
};

const clean = (v: string | null | undefined) => (v === undefined ? undefined : v?.trim() || null);

function itemData(input: Partial<ItemInput>) {
  return {
    ...(input.kind !== undefined ? { kind: input.kind } : {}),
    ...(input.title !== undefined ? { title: input.title.trim() } : {}),
    summary: clean(input.summary),
    body: clean(input.body),
    url: clean(input.url),
    contactPhone: clean(input.contactPhone),
    contactText: clean(input.contactText),
    ...(input.topics !== undefined ? { topics: [...new Set(input.topics)] } : {}),
    ...(input.audiences !== undefined ? { audiences: [...new Set(input.audiences)] } : {}),
    ...(input.language !== undefined ? { language: input.language } : {}),
    readingLevel: clean(input.readingLevel),
    publisher: clean(input.publisher),
    licenseNote: clean(input.licenseNote),
    staffCategory: clean(input.staffCategory),
    ...(input.visibleRoles !== undefined ? { visibleRoles: [...new Set(input.visibleRoles)] } : {}),
  };
}

export async function createItem(actor: ResourceActor, input: ItemInput) {
  const audience = input.audience ?? 'patient';
  if (!canEdit(actor, { audience })) throw new ResourceError('Your role cannot add resources here', 403);
  if (audience === 'patient' && input.kind === 'community' && !input.url && !input.contactPhone) throw new ResourceError('Add a link or phone number', 400);
  const topics = input.topics ?? [];
  const row = await prisma.resourceItem.create({
    data: {
      ...itemData(input),
      organizationId: actor.organizationId,
      audience,
      kind: input.kind,
      title: input.title.trim(),
      topics,
      audiences: input.audiences ?? [],
      language: input.language ?? 'en',
      status: 'draft',
      sudRelated: audience === 'patient' && isSudItem({ topics, sudRelated: input.sudRelated }),
      createdById: actor.userId,
      updatedById: actor.userId,
    },
  });
  return itemDto(row);
}

export type ItemUpdate = Partial<ItemInput> & { status?: ResourceStatus; markReviewed?: boolean; markLinkChecked?: boolean };

export async function updateItem(actor: ResourceActor, id: string, input: ItemUpdate) {
  const row = await loadItem(actor, id);
  if (!canEdit(actor, row)) throw new ResourceError('Your role cannot edit this resource', 403);
  if (input.markReviewed && row.audience === 'patient' && !canReviewResources(actor.role)) {
    throw new ResourceError('Only clinicians can record a clinical review', 403);
  }
  const data: Prisma.ResourceItemUpdateInput = { ...itemData(input), updatedById: actor.userId };
  const contentChanged = ['title', 'summary', 'body', 'url'].some((k) => (input as Record<string, unknown>)[k] !== undefined && (input as Record<string, unknown>)[k] !== (row as Record<string, unknown>)[k]);
  if (input.markReviewed) {
    data.lastReviewedAt = new Date();
    data.reviewedById = actor.userId;
    data.reviewerName = await actorName(actor);
  } else if (contentChanged && (row.kind === 'article' || row.kind === 'handout') && row.lastReviewedAt) {
    // Edited practice content needs a fresh clinical review
    data.lastReviewedAt = null;
    data.reviewedById = null;
    data.reviewerName = null;
  }
  if (input.markLinkChecked) data.linkCheckedAt = new Date();
  if (row.audience === 'patient' && (input.topics !== undefined || input.sudRelated !== undefined)) {
    data.sudRelated = isSudItem({ topics: input.topics ?? row.topics, sudRelated: input.sudRelated ?? row.sudRelated });
  }
  const next = { ...row, ...(data as object) } as ItemRow;
  const targetStatus = input.status ?? (row.status === 'active' ? 'active' : undefined);
  if (targetStatus === 'active' && row.audience === 'patient') {
    const problem = activationProblem(next);
    if (problem) {
      if (input.status === 'active') throw new ResourceError(problem, 400);
      // Content edits that invalidate an active item send it back to draft
      data.status = 'draft';
    }
  }
  if (input.status) data.status = data.status ?? input.status;
  const updated = await prisma.resourceItem.update({ where: { id: row.id }, data });
  return itemDto(updated);
}

// ─── Files ──────────────────────────────────────────────────────────────────

function sniffMime(bytes: Buffer): string | null {
  if (bytes.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes.subarray(1, 4).toString('latin1') === 'PNG') return 'image/png';
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  return null;
}

export async function storeItemFile(actor: ResourceActor, id: string, file: { bytes: Buffer; name: string }) {
  const row = await loadItem(actor, id);
  if (!canEdit(actor, row)) throw new ResourceError('Your role cannot upload files here', 403);
  if (row.kind !== 'handout') throw new ResourceError('Files can only be attached to handouts / worksheets', 400);
  if (file.bytes.length === 0) throw new ResourceError('The file is empty', 400);
  if (file.bytes.length > UPLOAD_MAX_BYTES) throw new ResourceError('Files must be 10 MB or smaller', 413);
  const mime = sniffMime(file.bytes);
  if (!mime || !(UPLOAD_MIME as readonly string[]).includes(mime)) throw new ResourceError('Upload a PDF, PNG or JPEG file', 415);
  const ext = mime === 'application/pdf' ? 'pdf' : mime === 'image/png' ? 'png' : 'jpg';
  const stored = `${randomUUID()}.${ext}`;
  const abs = resourceFilePath(stored);
  if (!abs) throw new ResourceError('Could not store the file', 500);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, file.bytes);
  const display = file.name.replace(/[^\w .()-]/g, '_').slice(0, 120) || `handout.${ext}`;
  const updated = await prisma.resourceItem.update({
    where: { id: row.id },
    data: {
      fileStoredName: stored,
      fileName: display,
      fileMime: mime,
      fileSize: file.bytes.length,
      updatedById: actor.userId,
      // A new file needs a fresh clinical review; an active patient handout goes back to draft
      ...(row.audience === 'patient' ? { lastReviewedAt: null, reviewedById: null, reviewerName: null, ...(row.status === 'active' ? { status: 'draft' } : {}) } : {}),
    },
  });
  return itemDto(updated);
}

async function readStored(row: Pick<ItemRow, 'fileStoredName' | 'fileName' | 'fileMime'>) {
  if (!row.fileStoredName) throw new ResourceError('No file is attached', 404);
  const abs = resourceFilePath(row.fileStoredName);
  if (!abs) throw new ResourceError('File not found', 404);
  try {
    return { bytes: await readFile(abs), name: row.fileName || 'resource', mime: row.fileMime || 'application/octet-stream' };
  } catch {
    throw new ResourceError('File not found on the server', 404);
  }
}

export async function readItemFile(actor: ResourceActor, id: string) {
  const row = await loadItem(actor, id);
  const file = await readStored(row);
  await touchUsed(actor, row.id);
  return { ...file, itemId: row.id, sudRelated: row.sudRelated };
}

// ─── Favorites / recently used ──────────────────────────────────────────────

export async function setFavorite(actor: ResourceActor, id: string, favorite: boolean) {
  const row = await loadItem(actor, id);
  await prisma.resourceUserState.upsert({
    where: { userId_itemId: { userId: actor.userId, itemId: row.id } },
    create: { organizationId: actor.organizationId, userId: actor.userId, itemId: row.id, favorite },
    update: { favorite },
  });
  return { favorite };
}

export async function touchUsed(actor: ResourceActor, itemId: string) {
  await prisma.resourceUserState.upsert({
    where: { userId_itemId: { userId: actor.userId, itemId } },
    create: { organizationId: actor.organizationId, userId: actor.userId, itemId, lastUsedAt: new Date() },
    update: { lastUsedAt: new Date() },
  });
}

// ─── Verified starter content ───────────────────────────────────────────────

/** Idempotent: creates the verified seeds that are missing (by seedKey); never overwrites staff edits. */
export async function seedStarterContent(actor: ResourceActor) {
  if (!canManageResources(actor.role)) throw new ResourceError('Your role cannot add starter content', 403);
  let items = 0;
  let community = 0;
  for (const s of SEED_ITEMS) {
    const source = verifiedSource(s.url);
    if (!source) continue; // Unverified URL: never seeded
    const exists = await prisma.resourceItem.findFirst({ where: { organizationId: actor.organizationId, seedKey: s.seedKey }, select: { id: true } });
    if (exists) continue;
    try {
      await prisma.resourceItem.create({
        data: {
          organizationId: actor.organizationId,
          audience: 'patient',
          kind: s.kind,
          title: s.title,
          summary: s.summary,
          url: s.url,
          contactPhone: s.contactPhone ?? null,
          contactText: s.contactText ?? null,
          topics: s.topics,
          audiences: s.audiences,
          language: s.language,
          publisher: s.publisher,
          licenseNote: s.licenseNote,
          linkCheckedAt: new Date(`${source.checkedOn}T12:00:00Z`),
          status: 'active',
          sudRelated: isSudItem({ topics: s.topics }),
          seedKey: s.seedKey,
          createdById: actor.userId,
        },
      });
      items++;
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
    }
  }
  // MDH AOT resources: drafts with no link (staff add and verify the link, then activate).
  let aotDrafts = 0;
  for (const a of AOT_RESOURCE_SEEDS) {
    const exists = await prisma.resourceItem.findFirst({ where: { organizationId: actor.organizationId, seedKey: a.seedKey }, select: { id: true } });
    if (exists) continue;
    try {
      await prisma.resourceItem.create({
        data: {
          organizationId: actor.organizationId,
          audience: 'patient',
          kind: a.kind,
          title: a.title,
          summary: a.summary,
          url: null,
          contactPhone: null,
          contactText: a.contactText ?? null,
          topics: a.topics,
          audiences: a.audiences,
          language: 'en',
          publisher: a.publisher,
          licenseNote: AOT_LINK_NEEDED_NOTE,
          linkCheckedAt: null,
          status: 'draft',
          sudRelated: false,
          seedKey: a.seedKey,
          createdById: actor.userId,
        },
      });
      aotDrafts++;
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
    }
  }
  for (const c of COMMUNITY_SEEDS) {
    if (!verifiedSource(c.website)) continue;
    const exists = await prisma.sdohResource.findFirst({ where: { organizationId: actor.organizationId, source: 'seed', legacyId: c.seedKey }, select: { id: true } });
    if (exists) continue;
    try {
      await prisma.sdohResource.create({
        data: {
          organizationId: actor.organizationId,
          name: c.name,
          domains: c.domains,
          counties: c.counties,
          state: 'MD',
          phone: c.phone,
          website: c.website,
          hours: c.hours,
          languages: c.languages,
          cost: c.cost,
          eligibilityNotes: c.eligibilityNotes,
          source: 'seed',
          legacyId: c.seedKey,
          lastVerifiedAt: new Date(`${verifiedSource(c.website)!.checkedOn}T12:00:00Z`),
          verificationSource: c.verificationSource,
          createdById: actor.userId,
        },
      });
      community++;
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
    }
  }
  return { items, community, aotDrafts };
}

// ─── Assignments (staff) ────────────────────────────────────────────────────

async function requireClientInScope(actor: ResourceActor, clientId: string) {
  const client = await prisma.client.findFirst({
    where: { AND: [{ id: clientId }, clientAccessWhere({ organizationId: actor.organizationId, actorUserId: actor.userId, actorRole: actor.role as Role })] },
    select: { id: true, name: true },
  });
  if (!client) throw new ResourceError('Client not found in your caseload', 404);
  try {
    await assertClientPhiAccess({ organizationId: actor.organizationId, userId: actor.userId, role: actor.role, clientId, path: RESOURCE_LIBRARY_PATH });
  } catch (e) {
    if (e instanceof SensitiveRecordAccessError) throw new ResourceError('Protected record: break-glass access is required', 403);
    throw e;
  }
  return client;
}

async function clientIsPart2(organizationId: string, clientId: string) {
  const rec = await prisma.sensitiveRecord.findFirst({ where: { organizationId, clientId }, select: { noteClassification: true } });
  return isPart2Classification(rec?.noteClassification);
}

type AssignmentRow = Prisma.ResourceAssignmentGetPayload<{ include: { item: { select: { title: true; kind: true } } } }>;

function assignmentDto(r: AssignmentRow, clientName: string): AssignmentDto {
  return {
    id: r.id,
    itemId: r.itemId,
    itemTitle: r.item.title,
    itemKind: r.item.kind,
    clientId: r.clientId,
    clientName,
    assignedByName: r.assignedByName,
    message: r.message,
    dueDate: ymd(r.dueDate),
    status: r.status as AssignmentStatus,
    sentAt: iso(r.sentAt),
    viewedAt: iso(r.viewedAt),
    completedAt: iso(r.completedAt),
    withdrawnAt: iso(r.withdrawnAt),
    withdrawnReason: r.withdrawnReason,
    context: r.context,
    part2: r.part2,
    notificationStatus: r.notificationStatus,
    createdAt: r.createdAt.toISOString(),
  };
}

export type AssignInput = {
  itemId: string;
  clientId: string;
  message?: string | null;
  dueDate?: string | null;
  context?: AssignmentContext;
  contextId?: string | null;
  /** Made from an SUD note / SUD group / Part 2 program: only ever adds protection */
  sudContext?: boolean;
};

export async function assignResource(actor: ResourceActor, input: AssignInput) {
  if (!canAssignResources(actor.role)) throw new ResourceError('Your role cannot send resources to clients', 403);
  const item = await loadItem(actor, input.itemId);
  const problem = assignProblem(item);
  if (problem) throw new ResourceError(problem, 400);
  const client = await requireClientInScope(actor, input.clientId);
  const part2 = assignmentIsPart2({ itemSud: isSudItem(item), clientPart2: await clientIsPart2(actor.organizationId, client.id), contextPart2: input.sudContext });
  const created = await prisma.resourceAssignment.create({
    data: {
      organizationId: actor.organizationId,
      itemId: item.id,
      clientId: client.id,
      assignedById: actor.userId,
      assignedByName: await actorName(actor),
      message: input.message?.trim() || null,
      dueDate: input.dueDate ? new Date(`${input.dueDate}T00:00:00Z`) : null,
      status: 'sent',
      sentAt: new Date(),
      context: input.context ?? 'library',
      contextId: input.contextId?.trim() || null,
      part2,
      notificationStatus: 'portal',
    },
    include: { item: { select: { title: true, kind: true } } },
  });
  await touchUsed(actor, item.id);

  // Notification: portal always; push only to devices the patient registered; generic wording only
  const [account, devices] = await Promise.all([
    prisma.patientAccount.findUnique({ where: { clientId: client.id }, select: { status: true } }),
    prisma.deviceToken.count({ where: { clientId: client.id } }),
  ]);
  const plan = resourceNotificationPlan({ assignmentId: created.id, part2, deviceCount: devices, portalAccount: account?.status === 'ACTIVE' });
  let notificationStatus = 'portal';
  let notificationReason = plan.reason;
  if (plan.push) {
    try {
      const res = await sendToUser(client.id, { type: 'resource_assigned', title: plan.title, body: plan.body, data: plan.data, dedupeKey: `resource:${created.id}` });
      notificationStatus = res.sentCount > 0 ? 'push_sent' : 'push_failed';
      notificationReason = res.sentCount > 0 ? null : (res.error ?? 'not_delivered').slice(0, 120);
    } catch (e) {
      notificationStatus = 'push_failed';
      notificationReason = e instanceof Error ? e.message.slice(0, 120) : 'error';
    }
  } else {
    notificationStatus = 'push_skipped';
  }
  const row = await prisma.resourceAssignment.update({
    where: { id: created.id },
    data: { notificationStatus, notificationReason },
    include: { item: { select: { title: true, kind: true } } },
  });
  return { assignment: assignmentDto(row, client.name), patientIds: [client.id], part2 };
}

export async function withdrawAssignment(actor: ResourceActor, id: string) {
  if (!canAssignResources(actor.role)) throw new ResourceError('Your role cannot change assignments', 403);
  const row = await prisma.resourceAssignment.findFirst({ where: { id, organizationId: actor.organizationId } });
  if (!row) throw new ResourceError('Assignment not found', 404);
  const client = await requireClientInScope(actor, row.clientId);
  const problem = staffWithdrawProblem(row.status);
  if (problem) throw new ResourceError(problem, 400);
  const updated = await prisma.resourceAssignment.update({
    where: { id: row.id },
    data: { status: 'withdrawn', withdrawnAt: new Date(), withdrawnById: actor.userId, withdrawnReason: 'staff_withdrew' },
    include: { item: { select: { title: true, kind: true } } },
  });
  return { assignment: assignmentDto(updated, client.name), patientIds: [client.id], part2: row.part2 };
}

/** Chart card: one client's assignments (caseload + protected-record checks). */
export async function listClientAssignments(actor: ResourceActor, clientId: string) {
  if (!canUseResourceLibrary(actor.role)) throw new ResourceError('Forbidden', 403);
  const client = await requireClientInScope(actor, clientId);
  const rows = await prisma.resourceAssignment.findMany({
    where: { organizationId: actor.organizationId, clientId: client.id },
    include: { item: { select: { title: true, kind: true } } },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  return { assignments: rows.map((r) => assignmentDto(r, client.name)), patientIds: [client.id], canAssign: canAssignResources(actor.role) };
}

/** Assignments in the actor's scope (library "Sent" tab): newest first; protected clients left out. */
export async function listScopedAssignments(actor: ResourceActor, opts: { mine?: boolean; limit?: number }) {
  if (!canUseResourceLibrary(actor.role)) throw new ResourceError('Forbidden', 403);
  const clients = await prisma.client.findMany({
    where: clientAccessWhere({ organizationId: actor.organizationId, actorUserId: actor.userId, actorRole: actor.role as Role }),
    select: { id: true, name: true },
  });
  const locked = await lockedSensitiveClientIds({ organizationId: actor.organizationId, userId: actor.userId, role: actor.role as Role, clientIds: clients.map((c) => c.id) });
  const names = new Map(clients.filter((c) => !locked.has(c.id)).map((c) => [c.id, c.name]));
  const rows = await prisma.resourceAssignment.findMany({
    where: { organizationId: actor.organizationId, clientId: { in: [...names.keys()] }, ...(opts.mine ? { assignedById: actor.userId } : {}) },
    include: { item: { select: { title: true, kind: true } } },
    orderBy: { createdAt: 'desc' },
    take: Math.min(opts.limit ?? 200, 500),
  });
  return { assignments: rows.map((r) => assignmentDto(r, names.get(r.clientId) ?? 'Client')), patientIds: [...new Set(rows.map((r) => r.clientId))], hiddenProtected: locked.size };
}

// ─── Portal (patient) ───────────────────────────────────────────────────────

export type PatientScope = { organizationId: string; clientId: string };

type PortalRow = Prisma.ResourceAssignmentGetPayload<{ include: { item: true } }>;

function patientDto(r: PortalRow): PatientResourceDto {
  const i = r.item;
  return {
    id: r.id,
    title: i.title,
    kind: i.kind,
    summary: i.summary,
    body: i.kind === 'article' ? i.body : null,
    url: i.url,
    contactPhone: i.contactPhone,
    contactText: i.contactText,
    hasFile: Boolean(i.fileStoredName),
    fileName: i.fileName,
    publisher: i.publisher,
    language: i.language,
    message: r.message,
    fromName: r.assignedByName,
    dueDate: ymd(r.dueDate),
    status: r.status as PatientResourceDto['status'],
    sentAt: iso(r.sentAt),
    viewedAt: iso(r.viewedAt),
    completedAt: iso(r.completedAt),
  };
}

export async function listPatientResources(scope: PatientScope) {
  const rows = await prisma.resourceAssignment.findMany({
    where: patientAssignmentWhere(scope),
    include: { item: true },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  return rows.map(patientDto);
}

async function patientRow(scope: PatientScope, id: string) {
  if (!id || id.length > 64) return null;
  return prisma.resourceAssignment.findFirst({ where: { ...patientAssignmentWhere(scope), id }, include: { item: true } });
}

/** Opening a resource marks it viewed (first time). Returns null when it is not this patient's. */
export async function openPatientResource(scope: PatientScope, id: string, action: 'viewed' | 'completed' = 'viewed') {
  const row = await patientRow(scope, id);
  if (!row) return null;
  const t = patientStatusChange(row, action);
  if (t.ok === false) throw new ResourceError(t.error, 400);
  if (!t.change) return { resource: patientDto(row), changed: false, part2: row.part2 };
  const updated = await prisma.resourceAssignment.update({ where: { id: row.id }, data: t.change, include: { item: true } });
  return { resource: patientDto(updated), changed: true, part2: row.part2 };
}

export async function readPatientFile(scope: PatientScope, id: string) {
  const row = await patientRow(scope, id);
  if (!row) return null;
  const file = await readStored(row.item);
  const t = patientStatusChange(row, 'viewed');
  if (t.ok && t.change) await prisma.resourceAssignment.update({ where: { id: row.id }, data: t.change });
  return { ...file, part2: row.part2 };
}
