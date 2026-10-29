import crypto from 'crypto';
import type { LabOrder, LabOrderStatus, LabResult, LabVendor, Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { clientAccessWhere, clientByIdWhere } from '@/lib/clients/orgScope';

export const LABS_PATH = '/dashboard/ehr/labs';

export const LAB_ORDER_STATUSES = [
  'ordered',
  'collected',
  'pending',
  'resulted',
  'critical',
  'cancelled',
] as const satisfies readonly LabOrderStatus[];

export const LAB_VENDORS = ['QUEST', 'LABCORP'] as const satisfies readonly LabVendor[];

export const LAB_RESULT_FLAGS = ['N', 'H', 'L', 'HH', 'LL', 'A'] as const;

export type LabResultFlag = (typeof LAB_RESULT_FLAGS)[number];

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
  createdAt: string;
  updatedAt: string;
  results: LabResultDto[];
};

export type CreateLabOrderInput = {
  clientId: string;
  lab?: LabVendor;
  priority?: string;
  specimen?: string | null;
  icd10Codes?: string[];
  panels?: string[];
  otherPanel?: string | null;
  clinicalNotes?: string | null;
};

export type LabResultInput = {
  testName: string;
  value: string;
  unit?: string | null;
  refRange?: string | null;
  flag?: string;
};

export type PatchLabOrderInput = {
  status?: LabOrderStatus;
  results?: LabResultInput[];
  collectedAt?: string | null;
  resultedAt?: string | null;
  clinicalNotes?: string | null;
};

export function canAccessLabs(role: Role | undefined | null) {
  return Boolean(role && canAccessPath(role, LABS_PATH));
}

function iso(d: Date | null | undefined) {
  return d ? d.toISOString() : null;
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
  };
}

function serializeOrder(row: LabOrder & { results: LabResult[] }): LabOrderDto {
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
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    results: row.results.map(serializeResult),
  };
}

function parseOptionalDate(value?: string | null) {
  if (value == null || value === '') return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return undefined;
  return d;
}

function normalizeFlag(flag?: string | null): string {
  const raw = (flag || 'N').trim().toUpperCase();
  if ((LAB_RESULT_FLAGS as readonly string[]).includes(raw)) return raw;
  return 'N';
}

export async function listOrders(
  actor: LabActor,
  opts?: { status?: LabOrderStatus; q?: string }
) {
  const status = opts?.status;
  const q = opts?.q?.trim();

  const rows = await prisma.labOrder.findMany({
    where: {
      organizationId: actor.organizationId,
      ...(status ? { status } : {}),
      client: clientAccessWhere(actor),
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
    take: 200,
  });

  return rows.map(serializeOrder);
}

export async function createOrder(actor: LabActor, input: CreateLabOrderInput) {
  const panels = (input.panels ?? []).map((p) => p.trim()).filter(Boolean);
  const otherPanel = input.otherPanel?.trim() || null;
  if (panels.length === 0 && !otherPanel) {
    return {
      ok: false as const,
      status: 400 as const,
      error: 'Select at least one panel or enter a custom panel',
    };
  }

  const client = await prisma.client.findFirst({
    where: clientByIdWhere(input.clientId, actor.organizationId),
    select: { id: true, name: true },
  });
  if (!client) {
    return { ok: false as const, status: 404 as const, error: 'Client not found' };
  }

  const accessible = await prisma.client.findFirst({
    where: { id: client.id, ...clientAccessWhere(actor) },
    select: { id: true },
  });
  if (!accessible) {
    return { ok: false as const, status: 403 as const, error: 'Client not in your caseload' };
  }

  const orderer = await prisma.user.findUnique({
    where: { id: actor.actorUserId },
    select: { id: true, name: true, email: true },
  });

  const lab = input.lab && (LAB_VENDORS as readonly string[]).includes(input.lab) ? input.lab : 'QUEST';
  const priority = (input.priority || 'Routine').trim() || 'Routine';

  const orderedDate = new Date();
  const signerName = orderer?.name?.trim() || orderer?.email || 'Ordering provider';
  const signerNpi = '1892837492';
  const facilityName = 'Divine Counseling LLC';
  const facilityClia = '21D2098412';
  const orderNumber = `LAB-${orderedDate.getFullYear()}-${String(Date.now()).slice(-4)}`;
  const signaturePayload = `${orderNumber}|${client.id}|${signerNpi}|${signerName}|${orderedDate.toISOString()}|${facilityClia}`;
  const signatureHash = crypto.createHash('sha256').update(signaturePayload).digest('hex');

  const row = await prisma.labOrder.create({
    data: {
      organizationId: actor.organizationId,
      clientId: client.id,
      clientName: client.name,
      lab,
      priority,
      specimen: input.specimen?.trim() || null,
      icd10Codes: (input.icd10Codes ?? []).map((c) => c.trim()).filter(Boolean),
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
      facilityClia,
      signatureHash,
    },
    include: { results: true },
  });

  return { ok: true as const, order: serializeOrder(row) };
}

export async function patchOrder(actor: LabActor, id: string, input: PatchLabOrderInput) {
  const existing = await prisma.labOrder.findFirst({
    where: {
      id,
      organizationId: actor.organizationId,
      client: clientAccessWhere(actor),
    },
    include: { results: true },
  });
  if (!existing) {
    return { ok: false as const, status: 404 as const, error: 'Lab order not found' };
  }

  if (input.status && !(LAB_ORDER_STATUSES as readonly string[]).includes(input.status)) {
    return { ok: false as const, status: 400 as const, error: 'Invalid status' };
  }

  const collectedAt = parseOptionalDate(input.collectedAt);
  if (collectedAt === undefined) {
    return { ok: false as const, status: 400 as const, error: 'Invalid collectedAt' };
  }
  const resultedAt = parseOptionalDate(input.resultedAt);
  if (resultedAt === undefined) {
    return { ok: false as const, status: 400 as const, error: 'Invalid resultedAt' };
  }

  const nextStatus = input.status ?? existing.status;
  const autoCollectedAt =
    collectedAt !== null
      ? collectedAt
      : input.collectedAt === null
        ? null
        : nextStatus !== 'ordered' && !existing.collectedAt
          ? new Date()
          : undefined;
  const autoResultedAt =
    resultedAt !== null
      ? resultedAt
      : input.resultedAt === null
        ? null
        : (nextStatus === 'resulted' || nextStatus === 'critical') && !existing.resultedAt
          ? new Date()
          : undefined;

  const updated = await prisma.$transaction(async (tx) => {
    if (input.results) {
      await tx.labResult.deleteMany({ where: { orderId: existing.id } });
      if (input.results.length > 0) {
        await tx.labResult.createMany({
          data: input.results.map((r) => ({
            orderId: existing.id,
            testName: r.testName.trim(),
            value: r.value.trim(),
            unit: r.unit?.trim() || null,
            refRange: r.refRange?.trim() || null,
            flag: normalizeFlag(r.flag),
          })),
        });
      }
    }

    return tx.labOrder.update({
      where: { id: existing.id },
      data: {
        ...(input.status ? { status: input.status } : {}),
        ...(autoCollectedAt !== undefined ? { collectedAt: autoCollectedAt } : {}),
        ...(autoResultedAt !== undefined ? { resultedAt: autoResultedAt } : {}),
        ...(input.clinicalNotes !== undefined
          ? { clinicalNotes: input.clinicalNotes?.trim() || null }
          : {}),
      },
      include: { results: { orderBy: { createdAt: 'asc' } } },
    });
  });

  return { ok: true as const, order: serializeOrder(updated) };
}

function formatResultsForPortal(order: LabOrderDto): string {
  const panels = [...order.panels];
  if (order.otherPanel?.trim()) panels.push(order.otherPanel.trim());
  const labName = order.lab === 'LABCORP' ? 'LabCorp' : 'Quest Diagnostics';
  const lines: string[] = [
    `Lab results are available from ${labName}.`,
    `Order: ${order.id}`,
    `Status: ${order.status}`,
    panels.length ? `Panels: ${panels.join(', ')}` : '',
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

/** Deliver resulted/critical lab summary via secure portal message (+ optional notify SMS/email without PHI values). */
export async function sendOrderToClient(actor: LabActor, orderId: string) {
  const { sendStaffMessage } = await import('@/lib/messages/manage');
  const { sendEmail } = await import('@/lib/email/smtp');
  const { sendSms } = await import('@/lib/sms/send');
  const { normalizeToE164 } = await import('@/lib/sms/phone');

  const existing = await prisma.labOrder.findFirst({
    where: {
      id: orderId,
      organizationId: actor.organizationId,
      client: clientAccessWhere(actor),
    },
    include: { results: { orderBy: { createdAt: 'asc' } }, client: true },
  });
  if (!existing) {
    return { ok: false as const, status: 404 as const, error: 'Lab order not found' };
  }
  if (existing.status !== 'resulted' && existing.status !== 'critical') {
    return {
      ok: false as const,
      status: 400 as const,
      error: 'Only resulted or critical orders can be sent to the client',
    };
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

  const channels: { portal: true; email?: string; sms?: string } = { portal: true };
  const notifyLine =
    'Your lab results are ready in the patient portal. Sign in to review and message your care team. Do not reply to this text with PHI.';

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

  const e164 = normalizeToE164(existing.client.phone);
  if (e164) {
    try {
      const sms = await sendSms({ to: e164, body: notifyLine, context: 'lab-results-notify' });
      channels.sms = sms.mode;
    } catch {
      channels.sms = 'failed';
    }
  }

  return {
    ok: true as const,
    order,
    threadId: msg.thread.id,
    channels,
  };
}
