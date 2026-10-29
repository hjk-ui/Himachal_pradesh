import { prisma } from '@/lib/db/prisma';

export type CareGapStatus = 'due' | 'overdue' | 'met' | 'not_applicable';

export type CareGapProviderAction =
  | 'completed'
  | 'ordered'
  | 'done_elsewhere'
  | 'refused'
  | 'not_applicable'
  | 'reopened';

export type CareGapMaAction = 'reported_elsewhere' | 'outreach';

export type CareGapDef = {
  id: string;
  category: 'cancer' | 'diabetes' | 'immunization';
  label: string;
};

/** Catalog — dates never invented; lastDoneAt null = none on file */
export const CARE_GAP_CATALOG: CareGapDef[] = [
  { id: 'colorectal', category: 'cancer', label: 'Colorectal cancer screening' },
  { id: 'breast', category: 'cancer', label: 'Breast cancer screening' },
  { id: 'cervical', category: 'cancer', label: 'Cervical cancer screening' },
  { id: 'a1c', category: 'diabetes', label: 'Diabetes A1c' },
  { id: 'eye', category: 'diabetes', label: 'Diabetes eye exam' },
  { id: 'foot', category: 'diabetes', label: 'Diabetes foot exam' },
  { id: 'uacr', category: 'diabetes', label: 'Diabetes uACR' },
  { id: 'influenza', category: 'immunization', label: 'Influenza immunization' },
  { id: 'pneumococcal', category: 'immunization', label: 'Pneumococcal immunization' },
  { id: 'tdap', category: 'immunization', label: 'Tdap immunization' },
];

export type CareGapRow = {
  gapId: string;
  label: string;
  category: CareGapDef['category'];
  status: CareGapStatus;
  lastDoneAt: string | null;
  providerAction: CareGapProviderAction | null;
  maAction: CareGapMaAction | null;
  note: string;
  updatedAt: string;
};

export function defaultGapsForClient(): CareGapRow[] {
  const now = new Date().toISOString();
  return CARE_GAP_CATALOG.map((g) => ({
    gapId: g.id,
    label: g.label,
    category: g.category,
    status: 'due' as const,
    lastDoneAt: null,
    providerAction: null,
    maAction: null,
    note: '',
    updatedAt: now,
  }));
}

function toRow(row: {
  gapId: string;
  label: string;
  category: string;
  status: string;
  lastDoneAt: Date | null;
  providerAction: string | null;
  maAction: string | null;
  note: string;
  updatedAt: Date;
}): CareGapRow {
  return {
    gapId: row.gapId,
    label: row.label,
    category: row.category as CareGapDef['category'],
    status: row.status as CareGapStatus,
    lastDoneAt: row.lastDoneAt ? row.lastDoneAt.toISOString().slice(0, 10) : null,
    providerAction: (row.providerAction as CareGapProviderAction) || null,
    maAction: (row.maAction as CareGapMaAction) || null,
    note: row.note,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listCareGaps(organizationId: string, clientId: string): Promise<CareGapRow[]> {
  const existing = await prisma.medicalCareGap.findMany({
    where: { organizationId, clientId },
  });
  if (existing.length === 0) {
    await prisma.medicalCareGap.createMany({
      data: CARE_GAP_CATALOG.map((g) => ({
        organizationId,
        clientId,
        gapId: g.id,
        label: g.label,
        category: g.category,
        status: 'due',
        lastDoneAt: null,
        note: '',
      })),
      skipDuplicates: true,
    });
    const seeded = await prisma.medicalCareGap.findMany({
      where: { organizationId, clientId },
    });
    return seeded.map(toRow);
  }

  // Ensure catalog completeness without inventing dates
  const have = new Set(existing.map((e) => e.gapId));
  const missing = CARE_GAP_CATALOG.filter((g) => !have.has(g.id));
  if (missing.length) {
    await prisma.medicalCareGap.createMany({
      data: missing.map((g) => ({
        organizationId,
        clientId,
        gapId: g.id,
        label: g.label,
        category: g.category,
        status: 'due',
        lastDoneAt: null,
        note: '',
      })),
      skipDuplicates: true,
    });
    const all = await prisma.medicalCareGap.findMany({ where: { organizationId, clientId } });
    return all.map(toRow);
  }
  return existing.map(toRow);
}

export async function applyCareGapAction(
  organizationId: string,
  clientId: string,
  gapId: string,
  input: {
    role: 'ma' | 'provider';
    action: CareGapMaAction | CareGapProviderAction;
    note?: string;
  }
): Promise<{ ok: true; gaps: CareGapRow[] } | { ok: false; error: string }> {
  await listCareGaps(organizationId, clientId);
  const row = await prisma.medicalCareGap.findUnique({
    where: {
      organizationId_clientId_gapId: { organizationId, clientId, gapId },
    },
  });
  if (!row) return { ok: false, error: 'Care gap not found' };

  if (input.role === 'ma') {
    if (input.action !== 'reported_elsewhere' && input.action !== 'outreach') {
      return { ok: false, error: 'MA may only mark done elsewhere / outreach — cannot close a gap' };
    }
    await prisma.medicalCareGap.update({
      where: { id: row.id },
      data: {
        maAction: input.action,
        note: input.note || row.note,
        // MA cannot set met — status unchanged
      },
    });
  } else {
    const action = input.action as CareGapProviderAction;
    let status: CareGapStatus = row.status as CareGapStatus;
    let lastDoneAt: Date | null = row.lastDoneAt;
    if (action === 'completed' || action === 'done_elsewhere') {
      status = 'met';
      lastDoneAt = new Date();
    }
    if (action === 'not_applicable') status = 'not_applicable';
    if (action === 'reopened') status = 'due';
    if (action === 'ordered') status = row.status === 'overdue' ? 'overdue' : 'due';
    if (action === 'refused') status = 'due';
    await prisma.medicalCareGap.update({
      where: { id: row.id },
      data: {
        providerAction: action,
        status,
        lastDoneAt,
        note: input.note || row.note,
      },
    });
  }

  return { ok: true, gaps: await listCareGaps(organizationId, clientId) };
}
