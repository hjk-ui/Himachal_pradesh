import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { assertClientPhiAccess, SensitiveRecordAccessError } from '@/lib/privacy/sensitiveAccess';
import { clientAccessWhere, canEditClientProfile } from '@/lib/clients/orgScope';
import { resolveNoteMeta } from '@/lib/clients/notes';
import { demographicFields } from '@/lib/clients/demographics';
import { normalizeNoteType, stripLegacyAddenda } from '@/lib/ehr/noteTemplates';
import {
  IDENTIFYING_INFO_NOTE_TYPES,
  NAME_TITLES,
  hasIdentifyingInfo,
  identifyingSectionText,
  isReEvalNoteType,
  type ChartIdentifying,
  type ChartVitals,
} from '@/lib/ehr/identifyingInfo';

export const runtime = 'nodejs';

const SIGNED = new Set(['SIGNED', 'LOCKED']);

async function phiGate(gate: Extract<Awaited<ReturnType<typeof requireOrgContext>>, { ok: true }>, id: string) {
  try {
    await assertClientPhiAccess({
      organizationId: gate.organizationId,
      userId: gate.userId,
      role: gate.role,
      clientId: id,
      path: `/api/clients/${id}/identifying-info`,
    });
    return null;
  } catch (err) {
    if (err instanceof SensitiveRecordAccessError) return NextResponse.json(err.body, { status: err.status });
    throw err;
  }
}

const CLIENT_SELECT = {
  id: true,
  name: true,
  preferredName: true,
  namePrefix: true,
  dateOfBirth: true,
  gender: true,
  sexAtBirth: true,
  genderIdentity: true,
  pronouns: true,
  race: true,
  ethnicity: true,
  maritalStatus: true,
  preferredLanguage: true,
  interpreterNeeded: true,
  hasGuardian: true,
  guardianName: true,
  guardianRelationship: true,
} as const;

/**
 * GET /api/clients/[id]/identifying-info?noteType=&excludeNoteId=
 * Read-only prefill for the note's Identifying Information section: chart demographics, the
 * latest weight / height in vitals, and (re-evaluations) the last signed evaluation's section.
 * Org + caseload scoped; Part 2 notes are never used as the prior source. Nothing leaves Altrixs.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canAccessPath(gate.role, '/dashboard/ehr/notes')) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const noteType = normalizeNoteType(url.searchParams.get('noteType') || '');
  if (!id || id.length > 128 || !hasIdentifyingInfo(noteType)) {
    return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
  }
  const excludeNoteId = url.searchParams.get('excludeNoteId')?.trim().slice(0, 128) || null;
  const denied = await phiGate(gate, id);
  if (denied) return denied;

  try {
    const client = await prisma.client.findFirst({
      where: { id, ...clientAccessWhere({ organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role }) },
      select: CLIENT_SELECT,
    });
    if (!client) return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 });

    const [vital, notes] = await Promise.all([
      prisma.medicalVital.findFirst({
        where: { clientId: client.id, OR: [{ weightLbs: { not: null } }, { heightInches: { not: null } }] },
        orderBy: { recordedAt: 'desc' },
        select: { weightLbs: true, heightInches: true, recordedAt: true },
      }),
      isReEvalNoteType(noteType)
        ? prisma.progressNote.findMany({
            where: { clientId: client.id, part2: false, ...(excludeNoteId ? { id: { not: excludeNoteId } } : {}) },
            include: { workflow: { select: { status: true } } },
            orderBy: { createdAt: 'desc' },
            take: 60,
          })
        : Promise.resolve([]),
    ]);

    let prior: { noteId: string; noteType: string; date: string; text: string } | null = null;
    for (const n of notes) {
      const meta = resolveNoteMeta(n);
      if (meta.part2) continue;
      const type = normalizeNoteType(meta.noteType || '');
      if (!IDENTIFYING_INFO_NOTE_TYPES.includes(type) || !SIGNED.has(n.workflow?.status ?? 'DRAFT')) continue;
      const text = identifyingSectionText(type, stripLegacyAddenda(meta.displayBody));
      if (!text) continue;
      prior = { noteId: n.id, noteType: type, date: meta.dateOfService || n.createdAt.toISOString().slice(0, 10), text };
      break;
    }

    const chart: ChartIdentifying = {
      name: client.name,
      preferredName: client.preferredName,
      namePrefix: client.namePrefix,
      dateOfBirth: client.dateOfBirth ? client.dateOfBirth.toISOString().slice(0, 10) : null,
      gender: client.gender,
      sexAtBirth: client.sexAtBirth,
      genderIdentity: client.genderIdentity,
      pronouns: client.pronouns,
      race: client.race ?? [],
      ethnicity: client.ethnicity,
      maritalStatus: client.maritalStatus,
      preferredLanguage: client.preferredLanguage,
      interpreterNeeded: client.interpreterNeeded,
      hasGuardian: client.hasGuardian,
      guardianName: client.guardianName,
      guardianRelationship: client.guardianRelationship,
    };
    const vitals: ChartVitals = vital ? { weightLbs: vital.weightLbs, heightInches: vital.heightInches, recordedAt: vital.recordedAt.toISOString() } : null;

    await auditPhiAccess({
      gate,
      req,
      action: 'READ',
      resourceType: 'client',
      resourceId: id,
      patientId: id,
      metadata: { purpose: 'note_identifying_info', noteType, priorNoteId: prior?.noteId ?? null },
    });
    return NextResponse.json(
      { success: true, chart, vitals, prior, canUpdateChart: canEditClientProfile(gate.role) },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (err) {
    console.error('[identifying-info GET]', err);
    return NextResponse.json({ success: false, error: 'Could not load chart data' }, { status: 500 });
  }
}

const patchSchema = z
  .object({
    namePrefix: z.enum(NAME_TITLES as unknown as [string, ...string[]]).optional(),
    sexAtBirth: demographicFields.sexAtBirth,
    genderIdentity: demographicFields.genderIdentity,
    pronouns: demographicFields.pronouns,
    race: demographicFields.race,
    ethnicity: demographicFields.ethnicity,
    maritalStatus: demographicFields.maritalStatus,
    preferredLanguage: demographicFields.preferredLanguage,
    interpreterNeeded: z.boolean().optional(),
    hasGuardian: z.boolean().optional(),
    guardianName: z.string().trim().min(1).max(160).optional(),
    guardianRelationship: demographicFields.guardianRelationship,
  })
  .strict();

const bodySchema = z.object({
  /** The note the clinician confirmed the values in (audit trail) */
  noteId: z.string().trim().max(128).optional().nullable(),
  changes: patchSchema,
});

/**
 * POST /api/clients/[id]/identifying-info — "Update chart demographics" from the note.
 * Explicit clinician action only (never called automatically); only the fields sent change;
 * blank values never clear the chart. Audited (WRITE, source note_identifying_info).
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canEditClientProfile(gate.role) || !canAccessPath(gate.role, '/dashboard/ehr/notes')) {
    return NextResponse.json({ success: false, error: 'Your role cannot update client demographics.' }, { status: 403 });
  }
  const { id } = await ctx.params;
  if (!id || id.length > 128) return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message || 'Invalid demographics' }, { status: 400 });
  }
  const denied = await phiGate(gate, id);
  if (denied) return denied;

  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(parsed.data.changes)) {
    if (v === undefined || v === null || v === '') continue;
    if (k === 'race') {
      if (Array.isArray(v) && v.length) data.race = Array.from(new Set(v as string[]));
      continue;
    }
    data[k] = typeof v === 'string' ? v.trim() : v;
  }
  if (!Object.keys(data).length) return NextResponse.json({ success: false, error: 'Nothing to update.' }, { status: 400 });

  try {
    const client = await prisma.client.findFirst({
      where: { id, ...clientAccessWhere({ organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role }) },
      select: { id: true },
    });
    if (!client) return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 });
    const noteId = parsed.data.noteId || null;
    if (noteId) {
      const note = await prisma.progressNote.findFirst({ where: { id: noteId, clientId: client.id }, select: { id: true } });
      if (!note) return NextResponse.json({ success: false, error: 'Note not found for this client' }, { status: 404 });
    }
    const updated = await prisma.client.update({ where: { id: client.id }, data, select: CLIENT_SELECT });
    await auditPhiAccess({
      gate,
      req,
      action: 'WRITE',
      resourceType: 'patient',
      resourceId: client.id,
      patientId: client.id,
      metadata: { source: 'note_identifying_info', noteId, fields: Object.keys(data) },
    });
    return NextResponse.json({ success: true, updatedFields: Object.keys(data), client: { ...updated, dateOfBirth: updated.dateOfBirth?.toISOString().slice(0, 10) ?? null } });
  } catch (err) {
    console.error('[identifying-info POST]', err);
    return NextResponse.json({ success: false, error: 'Could not update the chart' }, { status: 500 });
  }
}
