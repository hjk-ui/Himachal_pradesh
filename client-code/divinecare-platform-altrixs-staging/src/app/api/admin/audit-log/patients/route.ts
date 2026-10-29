import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireFullAdmin } from '@/lib/auth/requireAdmin';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { clientLabelMap } from '@/lib/audit/clientLabels';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/audit-log/patients?q=… — patient picker for the audit-log filter: search by
 * name or MRN (min 2 characters), or ?id=… to label one patient. Org-scoped, max 20 results;
 * protected clients the viewer may not open match by MRN only and show their alias.
 * Leadership only (requireFullAdmin).
 */
export async function GET(req: Request) {
  const gate = await requireFullAdmin();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  const url = new URL(req.url);
  const q = (url.searchParams.get('q') || '').trim().slice(0, 80);
  const id = (url.searchParams.get('id') || '').trim().slice(0, 191);
  if (!id && q.length < 2) return NextResponse.json({ success: true, patients: [] });

  try {
    const found = await prisma.client.findMany({
      where: {
        organizationId: gate.organizationId,
        ...(id
          ? { id }
          : {
              OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { mrn: { contains: q, mode: 'insensitive' } },
              ],
            }),
      },
      select: { id: true, name: true, mrn: true },
      orderBy: { name: 'asc' },
      take: 20,
    });
    const labels = await clientLabelMap({
      organizationId: gate.organizationId,
      userId: gate.userId,
      role: gate.role,
      clientIds: found.map((c) => c.id),
    });
    const patients = found.flatMap((c) => {
      const l = labels.get(c.id);
      if (!l) return [];
      // A protected client this viewer may not open is found only by id or exact MRN, never by name
      if (l.locked && !id && (c.mrn ?? '').toLowerCase() !== q.toLowerCase()) return [];
      return [{ id: c.id, label: l.label, mrn: l.mrn, protected: l.protected }];
    });

    await auditPhiAccess({
      gate,
      req,
      action: 'LIST',
      resourceType: 'auditLogPatientSearch',
      patientId: id || null,
      metadata: { returned: patients.length, byId: !!id },
    });
    return NextResponse.json({ success: true, patients });
  } catch (err) {
    console.error('[admin audit-log patients GET]', err instanceof Error ? err.name : 'error');
    return NextResponse.json({ success: false, error: 'Could not search patients' }, { status: 500 });
  }
}
