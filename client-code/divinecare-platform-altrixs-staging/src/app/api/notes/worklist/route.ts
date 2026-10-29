import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { loadWorklist, WORKLIST_TABS } from '@/lib/notes/worklist';

export const runtime = 'nodejs';

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();
const querySchema = z.object({
  tab: z.enum(WORKLIST_TABS).default('drafts'),
  clientId: z.string().max(128).optional(),
  from: ymd,
  to: ymd,
  noteType: z.string().max(60).optional(),
  clinicianId: z.string().max(128).optional(),
  locationId: z.string().max(128).optional(),
  program: z.string().max(30).optional(),
  status: z.enum(['Draft', 'Signed', 'Locked']).optional(),
  billing: z.enum(['none', 'DRAFT', 'READY', 'SUBMITTED', 'ACCEPTED', 'DENIED', 'PAID']).optional(),
  part2: z.enum(['yes', 'no']).optional(),
  search: z.string().max(100).optional(),
  /** All notes tab: include dismissed notes (read-only) */
  dismissed: z.enum(['include']).optional(),
  sort: z.enum(['dos_desc', 'dos_asc', 'client', 'oldest_due']).default('dos_desc'),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(25),
});

/**
 * GET /api/notes/worklist — "My notes" queue with tabs, filters, counts and pagination.
 * Rows carry no note text (minimum necessary); opening a note goes through the audited note view.
 */
export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canAccessPath(gate.role, '/dashboard/ehr/notes', gate.capabilities)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const url = new URL(req.url);
  const raw = Object.fromEntries([...url.searchParams.entries()].filter(([, v]) => v !== ''));
  const parsed = querySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message || 'Invalid request' }, { status: 400 });
  }
  const q = parsed.data;
  const result = await loadWorklist({
    organizationId: gate.organizationId,
    actorUserId: gate.userId,
    actorRole: gate.role,
    medicalDirector: gate.capabilities?.medicalDirector,
    tab: q.tab,
    filters: {
      clientId: q.clientId,
      from: q.from,
      to: q.to,
      noteType: q.noteType,
      clinicianId: q.clinicianId,
      locationId: q.locationId,
      program: q.program,
      status: q.status,
      billing: q.billing,
      part2: q.part2,
      search: q.search,
      includeDismissed: q.dismissed === 'include',
    },
    sort: q.sort,
    page: q.page,
    pageSize: q.pageSize,
  });

  await auditPhiAccess({
    gate,
    req,
    action: 'LIST',
    resourceType: 'progressNote',
    patientId: q.clientId ?? null,
    metadata: { view: 'notesWorklist', tab: q.tab, page: q.page, returned: result.rows.length, filtered: Boolean(q.clientId || q.search || q.noteType || q.clinicianId), includeDismissed: q.dismissed === 'include' },
  });

  return NextResponse.json({ success: true, ...result });
}
