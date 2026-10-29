import crypto from 'crypto';
import type { LabOrder, LabOrderStatus, LabResult, LabVendor, Prisma, Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { clientAccessWhere, clientByIdWhere } from '@/lib/clients/orgScope';
import { labFacilityName, labSignaturePayload, normalizeNpi, performingLabLabel } from '@/lib/labs/facility';
import { practiceFacilityClia } from '@/lib/practice/consumers';
import { canViewLabs, LABS_PATH as LABS_PAGE_PATH } from '@/lib/labs/access';
import { BUILTIN_LAB_TESTS, findTestByKey, findTestByName, type LabTestDef } from '@/lib/labs/catalog';
import { isCriticalFlag, LAB_RESULT_FLAGS as FLAGS, numericResult, resolveResultFlag } from '@/lib/labs/results';
import { canMoveStatus, releaseCheck, reviewCheck } from '@/lib/labs/workflow';
import { primaryCarePatientWhere } from '@/lib/medical/medicalProgram';
import { icd10ErrorText, validateIcd10Codes } from '@/lib/icd10/validate';

export const LABS_PATH = LABS_PAGE_PATH;

export const LAB_ORDER_STATUSES = [
  'ordered',
  'collected',
  'pending',
  'resulted',
  'critical',
  'cancelled',
] as const satisfies readonly LabOrderStatus[];

export const LAB_VENDORS = ['QUEST', 'LABCORP', 'IN_HOUSE'] as const satisfies readonly LabVendor[];

export const LAB_RESULT_FLAGS = FLAGS;

export type LabResultFlag = (typeof LAB_RESULT_FLAGS)[number];

export const COLLECTION_SITE_IDS = ['in_office', 'patient_service_center'] as const;
export const BILL_TO_IDS = ['insurance', 'patient', 'client'] as const;

export type LabActor = {
  organizationId: string;
  actorUserId: string;
  actorRole: Role;
};

export type LabResultDto = {
  id: string;
  testName: string;
  value: string;
  unit: string | null;
  refRange: string | null;
  flag: string;
  createdAt: string;
  testKey?: string | null;
  panelName?: string | null;
  loinc?: string | null;
  numericValue?: number | null;
  criticalRange?: string | null;
  flagSource?: string | null;
  collectedAt?: string | null;
  performingLab?: string | null;
  enteredByName?: string | null;
};

export type LabTestLine = {
  key: string | null;
  name: string;
  diagnoses: { code: string; description: string | null }[];
  loinc: string | null;
  cpt: string | null;
  fastingRequired: boolean;
  orderType: 'lab' | 'in_office_procedure';
};

export type LabOrderDto = {
  id: string;
  organizationId: string;
  clientId: string;
  clientName: string;
  lab: LabVendor;
  priority: string;
  specimen: string | null;
  icd10Codes: string[];
  panels: string[];
  otherPanel: string | null;
  clinicalNotes: string | null;
  status: LabOrderStatus;
  orderedById: string | null;
  orderedByName: string | null;
  orderedAt: string;
  collectedAt: string | null;
  resultedAt: string | null;
  isElectronicallySigned?: boolean;
  signedAt?: string | null;
  signerName?: string | null;
  signerNpi?: string | null;
  facilityName?: string | null;
  facilityClia?: string | null;
  signatureHash?: string | null;
  testLines: LabTestLine[];
  fastingRequired: boolean;
  collectionSite: string | null;
  billTo: string | null;
  abnRequired: boolean;
  abnNote: string | null;
  standingOrderId: string | null;
  sentAt: string | null;
  performingLabName: string | null;
  resultDocumentId: string | null;
  hasCritical: boolean;
  reviewedAt: string | null;
  reviewedByName: string | null;
  reviewNote: string | null;
  releasedAt: string | null;
  createdAt: string;
  updatedAt: string;
  results: LabResultDto[];
};

export type CreateLabTestInput = { key?: string | null; name: string; icd10Codes: string[] };

export type CreateLabOrderInput = {
  clientId: string;
  lab?: LabVendor;
  priority?: string;
  specimen?: string | null;
  icd10Codes?: string[];
  panels?: string[];
  otherPanel?: string | null;
  clinicalNotes?: string | null;
  /** Per-test lines with their own ICD-10 pointers (medical necessity) */
  tests?: CreateLabTestInput[];
  /** Descriptions for the codes used (from the diagnosis picker), printed on the requisition */
  diagnoses?: { code: string; description?: string | null }[];
  fastingRequired?: boolean;
  collectionSite?: (typeof COLLECTION_SITE_IDS)[number] | null;
  billTo?: (typeof BILL_TO_IDS)[number] | null;
  abnRequired?: boolean;
  abnNote?: string | null;
  standingOrderId?: string | null;
};

export type LabResultInput = {
  testName: string;
  value: string;
  unit?: string | null;
  refRange?: string | null;
  /** Lab's printed flag; when absent the flag is computed from the entered range */
  flag?: string | null;
  testKey?: string | null;
  panelName?: string | null;
  loinc?: string | null;
  criticalRange?: string | null;
  collectedAt?: string | null;
  performingLab?: string | null;
};

export type PatchLabOrderInput = {
  status?: LabOrderStatus;
  results?: LabResultInput[];
  collectedAt?: string | null;
  resultedAt?: string | null;
  clinicalNotes?: string | null;
  performingLabName?: string | null;
  resultDocumentId?: string | null;
};

/** View lab orders / results (BH Labs page roles, or primary care roles via the medical Labs page) */
export function canAccessLabs(role: Role | string | undefined | null) {
  return canViewLabs(role ?? null);
}

function iso(d: Date | null | undefined) {
  return d ? d.toISOString() : null;
}

/** "f41.1" / "F411" → "F41.1"; not ICD-10-CM shaped → null */
export function normalizeIcd10Code(raw: string): string | null {
  let code = raw.trim().toUpperCase().replace(/\s+/g, '');
  if (/^[A-Z][0-9][0-9A-Z][0-9A-Z]{1,4}$/.test(code)) code = `${code.slice(0, 3)}.${code.slice(3)}`;
  return /^[A-Z][0-9][0-9A-Z](\.[0-9A-Z]{1,4})?$/.test(code) ? code : null;
}

function serializeResult(row: LabResult): LabResultDto {
  return {
    id: row.id,
    testName: row.testName,
    value: row.value,
    unit: row.unit,
    refRange: row.refRange,
    flag: row.flag,
    createdAt: row.createdAt.toISOString(),
    testKey: row.testKey ?? null,
    panelName: row.panelName ?? null,
    loinc: row.loinc ?? null,
    numericValue: row.numericValue ?? null,
    criticalRange: row.criticalRange ?? null,
    flagSource: row.flagSource ?? null,
    collectedAt: iso(row.collectedAt),
    performingLab: row.performingLab ?? null,
    enteredByName: row.enteredByName ?? null,
  };
}

function parseLines(raw: unknown): LabTestLine[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((l): l is Record<string, unknown> => Boolean(l) && typeof l === 'object')
    .map((l) => ({
      key: typeof l.key === 'string' ? l.key : null,
      name: String(l.name ?? ''),
      diagnoses: Array.isArray(l.diagnoses)
        ? (l.diagnoses as Record<string, unknown>[]).map((d) => ({ code: String(d.code ?? ''), description: typeof d.description === 'string' ? d.description : null }))
        : [],
      loinc: typeof l.loinc === 'string' ? l.loinc : null,
      cpt: typeof l.cpt === 'string' ? l.cpt : null,
      fastingRequired: Boolean(l.fastingRequired),
      orderType: l.orderType === 'in_office_procedure' ? ('in_office_procedure' as const) : ('lab' as const),
    }))
    .filter((l) => l.name);
}

export function serializeOrder(row: LabOrder & { results: LabResult[] }): LabOrderDto {
  return {
    id: row.id,
    organizationId: row.organizationId,
    clientId: row.clientId,
    clientName: row.clientName,
    lab: row.lab,
    priority: row.priority,
    specimen: row.specimen,
    icd10Codes: row.icd10Codes,
    panels: row.panels,
    otherPanel: row.otherPanel,
    clinicalNotes: row.clinicalNotes,
    status: row.status,
    orderedById: row.orderedById,
    orderedByName: row.orderedByName,
    orderedAt: row.orderedAt.toISOString(),
    collectedAt: iso(row.collectedAt),
    resultedAt: iso(row.resultedAt),
    isElectronicallySigned: row.isElectronicallySigned,
    signedAt: iso(row.signedAt),
    signerName: row.signerName,
    signerNpi: row.signerNpi,
    facilityName: row.facilityName,
    facilityClia: row.facilityClia,
    signatureHash: row.signatureHash,
    testLines: parseLines(row.testLines),
    fastingRequired: Boolean(row.fastingRequired),
    collectionSite: row.collectionSite ?? null,
    billTo: row.billTo ?? null,
    abnRequired: Boolean(row.abnRequired),
    abnNote: row.abnNote ?? null,
    standingOrderId: row.standingOrderId ?? null,
    sentAt: iso(row.sentAt),
    performingLabName: row.performingLabName ?? null,
    resultDocumentId: row.resultDocumentId ?? null,
    hasCritical: Boolean(row.hasCritical) || row.status === 'critical',
    reviewedAt: iso(row.reviewedAt),
    reviewedByName: row.reviewedByName ?? null,
    reviewNote: row.reviewNote ?? null,
    releasedAt: iso(row.releasedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    results: (row.results ?? []).map(serializeResult),
  };
}

function parseOptionalDate(value?: string | null) {
  if (value == null || value === '') return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return undefined;
  return d;
}

/** Org catalog when available; the built-in catalog otherwise (table missing, test doubles) */
async function catalogFor(organizationId: string): Promise<LabTestDef[]> {
  try {
    const { loadOrgCatalog } = await import('@/lib/labs/catalogDb');
    return await loadOrgCatalog(organizationId);
  } catch {
    return BUILTIN_LAB_TESTS;
  }
}

/** Part 2: client ids among `ids` the actor may not open (fail closed on lookup errors) */
async function lockedIds(actor: LabActor, ids: string[]): Promise<Set<string> | null> {
  if (!ids.length) return new Set();
  try {
    const { lockedSensitiveClientIds } = await import('@/lib/privacy/sensitiveAccess');
    return await lockedSensitiveClientIds({ organizationId: actor.organizationId, userId: actor.actorUserId, role: actor.actorRole, clientIds: ids });
  } catch (err) {
    console.error('[labs] sensitive record lookup failed; hiding all rows', err);
    return null;
  }
}

export async function listOrders(
  actor: LabActor,
  opts?: { status?: LabOrderStatus; q?: string; clientId?: string; program?: 'medical' }
) {
  const status = opts?.status;
  const q = opts?.q?.trim();

  const clientScope: Prisma.ClientWhereInput = opts?.program === 'medical'
    ? { AND: [clientAccessWhere(actor), primaryCarePatientWhere()] }
    : clientAccessWhere(actor);

  const rows = await prisma.labOrder.findMany({
    where: {
      organizationId: actor.organizationId,
      ...(status ? { status } : {}),
      ...(opts?.clientId ? { clientId: opts.clientId } : {}),
      client: clientScope,
      ...(q
        ? {
            OR: [
              { clientName: { contains: q, mode: 'insensitive' } },
              { panels: { has: q } },
              { otherPanel: { contains: q, mode: 'insensitive' } },
              { clinicalNotes: { contains: q, mode: 'insensitive' } },
              { orderedByName: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    include: { results: { orderBy: { createdAt: 'asc' } } },
    orderBy: [{ orderedAt: 'desc' }, { createdAt: 'desc' }],
    take: 300,
  });

  // 42 CFR Part 2 / protected records: drop rows the viewer may not open, as the chart does
  const locked = await lockedIds(actor, [...new Set(rows.map((r) => r.clientId))]);
  const visible = locked === null ? [] : rows.filter((r) => !locked.has(r.clientId));
  return visible.map(serializeOrder);
}

export async function getOrder(actor: LabActor, id: string) {
  const row = await prisma.labOrder.findFirst({
    where: { id, organizationId: actor.organizationId, client: clientAccessWhere(actor) },
    include: { results: { orderBy: { createdAt: 'asc' } } },
  });
  if (!row) return null;
  const locked = await lockedIds(actor, [row.clientId]);
  if (locked === null || locked.has(row.clientId)) return null;
  return serializeOrder(row);
}

type Fail = { ok: false; status: 400 | 403 | 404 | 409; error: string };
const fail = (status: Fail['status'], error: string): Fail => ({ ok: false, status, error });

export async function createOrder(actor: LabActor, input: CreateLabOrderInput) {
  // Per-test lines (new order form) or the legacy panel list
  let lines: LabTestLine[] = [];
  if (input.tests?.length) {
    const catalog = await catalogFor(actor.organizationId);
    const desc = new Map((input.diagnoses ?? []).map((d) => [normalizeIcd10Code(d.code) ?? d.code, d.description?.trim() || null]));
    for (const t of input.tests) {
      const def = (t.key ? findTestByKey(t.key, catalog) : null) || findTestByName(t.name, catalog);
      const codes = [...new Set(t.icd10Codes.map((c) => normalizeIcd10Code(c)))];
      if (codes.some((c) => c === null)) return fail(400, `${t.name}: one of the diagnosis codes is not a valid ICD-10-CM code`);
      if (!codes.length) return fail(400, `${t.name}: add at least one ICD-10 diagnosis (medical necessity)`);
      lines.push({
        key: def?.key ?? null,
        name: def?.name ?? t.name.trim(),
        diagnoses: (codes as string[]).map((code) => ({ code, description: desc.get(code) ?? null })),
        loinc: def?.loinc ?? null,
        cpt: def?.cpt ?? null,
        fastingRequired: Boolean(def?.fastingRequired),
        orderType: def?.orderType ?? 'lab',
      });
    }
    // Same test twice on one order is one line
    const seen = new Set<string>();
    lines = lines.filter((l) => {
      const k = l.key ?? l.name.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  const panels = lines.length ? lines.map((l) => l.name) : (input.panels ?? []).map((p) => p.trim()).filter(Boolean);
  const otherPanel = input.otherPanel?.trim() || null;
  if (panels.length === 0 && !otherPanel) {
    return fail(400, 'Select at least one test or enter a custom test');
  }
  const legacyCodes = (input.icd10Codes ?? []).map((c) => c.trim()).filter(Boolean);
  const icd10Codes = lines.length ? [...new Set(lines.flatMap((l) => l.diagnoses.map((d) => d.code)))] : legacyCodes;
  // Medical necessity codes must be billable FY2027 ICD-10-CM codes (no category headers)
  const dxCheck = validateIcd10Codes(icd10Codes, { requireBillable: true });
  if (!dxCheck.ok) return fail(400, icd10ErrorText(dxCheck.errors));

  const client = await prisma.client.findFirst({
    where: clientByIdWhere(input.clientId, actor.organizationId),
    select: { id: true, name: true },
  });
  if (!client) {
    return fail(404, 'Client not found');
  }

  const accessible = await prisma.client.findFirst({
    where: { id: client.id, ...clientAccessWhere(actor) },
    select: { id: true },
  });
  if (!accessible) {
    return fail(403, 'Client not in your caseload');
  }

  const [orderer, org] = await Promise.all([
    prisma.user.findUnique({
      where: { id: actor.actorUserId },
      select: { id: true, name: true, email: true, npi: true },
    }),
    prisma.organization.findUnique({
      where: { id: actor.organizationId },
      select: { name: true },
    }),
  ]);

  // A lab order is signed under the ordering clinician's own NPI — never a placeholder.
  const signerNpi = normalizeNpi(orderer?.npi);
  if (!signerNpi) {
    return fail(
      409,
      'Your NPI is not on your staff profile. Lab orders need a valid 10-digit ordering NPI — add it in your profile, then place the order.'
    );
  }

  let standingOrderId: string | null = null;
  if (input.standingOrderId) {
    const standing = await prisma.labStandingOrder.findFirst({
      where: { id: input.standingOrderId, organizationId: actor.organizationId, clientId: client.id, active: true },
      select: { id: true },
    });
    if (!standing) return fail(404, 'Standing order not found for this client');
    standingOrderId = standing.id;
  }

  const lab = input.lab && (LAB_VENDORS as readonly string[]).includes(input.lab) ? input.lab : 'QUEST';
  const priority = (input.priority || 'Routine').trim() || 'Routine';

  const orderedDate = new Date();
  const signerName = orderer?.name?.trim() || orderer?.email || 'Ordering clinician';
  const facilityName = labFacilityName(org?.name);
  // Practice settings CLIA, else LAB_FACILITY_CLIA; null when neither is set — omitted rather than invented.
  const facilityClia = await practiceFacilityClia(actor.organizationId);
  const orderNumber = `LAB-${orderedDate.getFullYear()}-${String(Date.now()).slice(-4)}`;
  const signaturePayload = labSignaturePayload({
    orderNumber,
    patientRef: client.id,
    signerNpi,
    signerName,
    signedAt: orderedDate,
    facilityClia,
  });
  const signatureHash = crypto.createHash('sha256').update(signaturePayload).digest('hex');

  const row = await prisma.labOrder.create({
    data: {
      organizationId: actor.organizationId,
      clientId: client.id,
      clientName: client.name,
      lab,
      priority,
      specimen: input.specimen?.trim() || null,
      icd10Codes,
      panels,
      otherPanel,
      clinicalNotes: input.clinicalNotes?.trim() || null,
      status: 'ordered',
      orderedById: orderer?.id ?? actor.actorUserId,
      orderedByName: signerName,
      orderedAt: orderedDate,
      isElectronicallySigned: true,
      signedAt: orderedDate,
      signerName,
      signerNpi,
      facilityName,
      // Explicit null overrides the schema's column default so no CLIA is stored when unset.
      facilityClia,
      signatureHash,
      ...(lines.length ? { testLines: lines as unknown as Prisma.InputJsonValue } : {}),
      ...(input.fastingRequired !== undefined || lines.some((l) => l.fastingRequired)
        ? { fastingRequired: input.fastingRequired ?? lines.some((l) => l.fastingRequired) }
        : {}),
      ...(input.collectionSite ? { collectionSite: input.collectionSite } : {}),
      ...(input.billTo ? { billTo: input.billTo } : {}),
      ...(input.abnRequired ? { abnRequired: true, abnNote: input.abnNote?.trim() || null } : {}),
      ...(standingOrderId ? { standingOrderId } : {}),
    },
    include: { results: true },
  });

  if (standingOrderId) {
    const { markStandingOrderPlaced } = await import('@/lib/labs/standingDb');
    await markStandingOrderPlaced(actor, standingOrderId, row.id, orderedDate);
  }

  return { ok: true as const, order: serializeOrder(row) };
}

export async function patchOrder(actor: LabActor, id: string, input: PatchLabOrderInput, actorName?: string | null) {
  const existing = await prisma.labOrder.findFirst({
    where: {
      id,
      organizationId: actor.organizationId,
      client: clientAccessWhere(actor),
    },
    include: { results: true },
  });
  if (!existing) {
    return fail(404, 'Lab order not found');
  }
  const locked = await lockedIds(actor, [existing.clientId]);
  if (locked === null || locked.has(existing.clientId)) return fail(404, 'Lab order not found');

  if (input.status && !(LAB_ORDER_STATUSES as readonly string[]).includes(input.status)) {
    return fail(400, 'Invalid status');
  }
  if (existing.releasedAt && (input.results || input.status)) {
    return fail(409, 'These results were released to the patient portal and are locked. Enter a corrected result as a new order and message the patient.');
  }

  const results = input.results?.filter((r) => r.testName.trim() && r.value.trim());
  // Results decide resulted / critical; staff move the earlier steps by hand
  let nextStatus: LabOrderStatus = existing.status;
  let hasCritical = existing.hasCritical;
  if (results) {
    if (results.length) {
      hasCritical = results.some((r) => isCriticalFlag(resolveResultFlag(r).flag));
      nextStatus = hasCritical ? 'critical' : 'resulted';
    } else if (existing.status === 'resulted' || existing.status === 'critical') {
      nextStatus = existing.sentAt ? 'pending' : existing.collectedAt ? 'collected' : 'ordered';
      hasCritical = false;
    }
  } else if (input.status && input.status !== existing.status) {
    if (!canMoveStatus(existing.status, input.status)) {
      return fail(400, `An order cannot move from "${existing.status}" to "${input.status}" by hand${input.status === 'resulted' || input.status === 'critical' ? ' — enter the results instead' : ''}.`);
    }
    nextStatus = input.status;
  }

  const collectedAt = parseOptionalDate(input.collectedAt);
  if (collectedAt === undefined) return fail(400, 'Invalid collectedAt');
  const resultedAt = parseOptionalDate(input.resultedAt);
  if (resultedAt === undefined) return fail(400, 'Invalid resultedAt');
  for (const r of results ?? []) {
    if (r.collectedAt && parseOptionalDate(r.collectedAt) === undefined) return fail(400, `${r.testName}: invalid collection date`);
  }

  let resultDocumentId: string | null | undefined;
  if (input.resultDocumentId !== undefined) {
    if (!input.resultDocumentId) resultDocumentId = null;
    else {
      // Only a document already filed to this client's chart through Smart Document Intake
      const doc = await prisma.documentIntake.findFirst({
        where: { id: input.resultDocumentId, suggestedClientId: existing.clientId, status: 'filed' },
        select: { id: true },
      });
      if (!doc) return fail(404, 'That document is not filed to this client’s chart.');
      resultDocumentId = doc.id;
    }
  }

  const now = new Date();
  const movingOn = nextStatus !== 'ordered' && nextStatus !== 'cancelled';
  const autoCollectedAt =
    collectedAt !== null ? collectedAt : input.collectedAt === null ? null : movingOn && !existing.collectedAt ? now : undefined;
  const autoResultedAt =
    resultedAt !== null
      ? resultedAt
      : input.resultedAt === null
        ? null
        : (nextStatus === 'resulted' || nextStatus === 'critical') && !existing.resultedAt
          ? now
          : undefined;
  const sentAt = nextStatus === 'pending' && !existing.sentAt ? now : undefined;
  // Changed results after sign-off need a new review (amended result)
  const resultsChanged = Boolean(results);
  const clearReview = resultsChanged && existing.reviewedAt;

  const updated = await prisma.$transaction(async (tx) => {
    if (results) {
      await tx.labResult.deleteMany({ where: { orderId: existing.id } });
      if (results.length > 0) {
        await tx.labResult.createMany({
          data: results.map((r) => {
            const { flag, flagSource } = resolveResultFlag(r);
            const performing = r.performingLab?.trim() || input.performingLabName?.trim() || existing.performingLabName || performingLabLabel(existing.lab);
            return {
              orderId: existing.id,
              testName: r.testName.trim(),
              value: r.value.trim(),
              unit: r.unit?.trim() || null,
              refRange: r.refRange?.trim() || null,
              flag,
              flagSource,
              testKey: r.testKey?.trim() || null,
              panelName: r.panelName?.trim() || null,
              loinc: r.loinc?.trim() || null,
              numericValue: numericResult(r.value),
              criticalRange: r.criticalRange?.trim() || null,
              collectedAt: parseOptionalDate(r.collectedAt) ?? autoCollectedAt ?? existing.collectedAt ?? null,
              performingLab: performing,
              enteredById: actor.actorUserId,
              enteredByName: actorName ?? null,
            };
          }),
        });
      }
    }

    return tx.labOrder.update({
      where: { id: existing.id },
      data: {
        status: nextStatus,
        hasCritical,
        ...(autoCollectedAt !== undefined ? { collectedAt: autoCollectedAt } : {}),
        ...(autoResultedAt !== undefined ? { resultedAt: autoResultedAt } : {}),
        ...(sentAt ? { sentAt } : {}),
        ...(input.clinicalNotes !== undefined ? { clinicalNotes: input.clinicalNotes?.trim() || null } : {}),
        ...(input.performingLabName !== undefined ? { performingLabName: input.performingLabName?.trim() || null } : {}),
        ...(resultDocumentId !== undefined ? { resultDocumentId } : {}),
        ...(clearReview ? { reviewedAt: null, reviewedById: null, reviewedByName: null, reviewNote: null } : {}),
      },
      include: { results: { orderBy: { createdAt: 'asc' } } },
    });
  });

  return { ok: true as const, order: serializeOrder(updated), reviewCleared: Boolean(clearReview) };
}

/** Provider sign-off of resulted labs. Role is checked by the route (prescribers only). */
export async function reviewOrder(actor: LabActor, id: string, input: { note?: string | null }) {
  const existing = await prisma.labOrder.findFirst({
    where: { id, organizationId: actor.organizationId, client: clientAccessWhere(actor) },
    include: { results: true },
  });
  if (!existing) return fail(404, 'Lab order not found');
  const locked = await lockedIds(actor, [existing.clientId]);
  if (locked === null || locked.has(existing.clientId)) return fail(404, 'Lab order not found');
  const check = reviewCheck({ ...existing, resultCount: existing.results.length });
  if (check.ok === false) return fail(409, check.error);
  if (existing.hasCritical && !input.note?.trim()) {
    return fail(400, 'Critical results need a review note (who was contacted and the plan).');
  }
  const user = await prisma.user.findUnique({ where: { id: actor.actorUserId }, select: { name: true, email: true } });
  const updated = await prisma.labOrder.update({
    where: { id: existing.id },
    data: {
      reviewedAt: new Date(),
      reviewedById: actor.actorUserId,
      reviewedByName: user?.name?.trim() || user?.email || null,
      reviewNote: input.note?.trim() || null,
    },
    include: { results: { orderBy: { createdAt: 'asc' } } },
  });
  return { ok: true as const, order: serializeOrder(updated) };
}

function formatResultsForPortal(order: LabOrderDto): string {
  const panels = [...order.panels];
  if (order.otherPanel?.trim()) panels.push(order.otherPanel.trim());
  const labName = order.performingLabName || performingLabLabel(order.lab);
  const lines: string[] = [
    `Your lab results from ${labName} have been reviewed by your care team.`,
    `Order: ${order.id}`,
    panels.length ? `Tests: ${panels.join(', ')}` : '',
    '',
  ];
  if (order.results.length === 0) {
    lines.push('Detailed result values will appear in your chart as released by your care team.');
  } else {
    lines.push('Results:');
    for (const r of order.results) {
      const flag = r.flag && r.flag !== 'N' ? ` [${r.flag}]` : '';
      const unit = r.unit ? ` ${r.unit}` : '';
      const ref = r.refRange ? ` (ref ${r.refRange})` : '';
      lines.push(`• ${r.testName}: ${r.value}${unit}${ref}${flag}`);
    }
  }
  lines.push('', 'Please message your care team in the patient portal if you have questions.');
  return lines.filter((l, i) => !(l === '' && lines[i - 1] === '')).join('\n').slice(0, 3900);
}

/**
 * Release reviewed results to the patient: secure portal message (+ notify SMS/email without PHI
 * values). Order enforced: resulted → reviewed → released.
 */
export async function sendOrderToClient(actor: LabActor, orderId: string) {
  const { sendStaffMessage } = await import('@/lib/messages/manage');
  const { sendEmail } = await import('@/lib/email/smtp');
  const { sendPatientSms } = await import('@/lib/sms/patientSms');
  const { portalNoticeSms } = await import('@/lib/sms/templates');

  const existing = await prisma.labOrder.findFirst({
    where: {
      id: orderId,
      organizationId: actor.organizationId,
      client: clientAccessWhere(actor),
    },
    include: { results: { orderBy: { createdAt: 'asc' } }, client: true },
  });
  if (!existing) {
    return fail(404, 'Lab order not found');
  }
  const locked = await lockedIds(actor, [existing.clientId]);
  if (locked === null || locked.has(existing.clientId)) return fail(404, 'Lab order not found');
  const check = releaseCheck({ ...existing, resultCount: existing.results.length });
  if (check.ok === false) {
    return fail(409, check.error);
  }

  const order = serializeOrder(existing);
  const portalBody = formatResultsForPortal(order);
  const actorName =
    (
      await prisma.user.findFirst({
        where: { id: actor.actorUserId },
        select: { name: true },
      })
    )?.name || 'Care team';

  const msg = await sendStaffMessage({
    clientId: existing.clientId,
    organizationId: actor.organizationId,
    actorUserId: actor.actorUserId,
    actorRole: actor.actorRole,
    content: portalBody,
    actorName,
  });
  if (!msg.ok) {
    return { ok: false as const, status: msg.status, error: msg.error };
  }

  const released = await prisma.labOrder.update({
    where: { id: existing.id },
    data: { releasedAt: new Date(), releasedById: actor.actorUserId },
    include: { results: { orderBy: { createdAt: 'asc' } } },
  });

  const channels: { portal: true; email?: string; sms?: string; smsNote?: string } = { portal: true };

  if (existing.client.email?.trim()) {
    try {
      const mailed = await sendEmail({
        to: existing.client.email.trim(),
        subject: 'Lab results available in your patient portal',
        text: [
          `Hello ${existing.clientName},`,
          '',
          'New lab results from your care team are available in the secure patient portal.',
          'Sign in to review them. Clinical questions should be asked via portal messaging.',
          '',
          `Order reference: ${existing.id}`,
        ].join('\n'),
        context: 'lab-results-notify',
      });
      channels.email = mailed.mode;
    } catch {
      channels.email = 'failed';
    }
  }

  // Consent-gated notice (src/lib/sms/patientSms.ts): says only that a portal message is waiting
  // (not "lab", no result, no value). channels.sms = sent | skipped | failed (+ reason sentence).
  if (existing.client.phone?.trim()) {
    const text = await sendPatientSms({
      clientId: existing.clientId,
      organizationId: actor.organizationId,
      purpose: 'portal_notice',
      actor: { userId: actor.actorUserId, role: actor.actorRole },
      build: ({ sender }) => portalNoticeSms({ sender }),
    });
    channels.sms = text.sent ? 'sent' : text.status;
    channels.smsNote = text.message;
  }

  return {
    ok: true as const,
    order: serializeOrder(released),
    threadId: msg.thread.id,
    channels,
  };
}
