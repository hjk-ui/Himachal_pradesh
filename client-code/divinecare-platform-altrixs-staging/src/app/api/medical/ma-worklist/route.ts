import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { getPracticeTimeZone } from '@/lib/time/practiceTimeServer';
import { canRoomPatients, openCareGaps, outreachTemplate } from '@/lib/medical/primaryCareWorkflow';
import { loadCareFactsBatch, loadPrimaryCareSettings, lockedClientIds, primaryCarePopulation } from '@/lib/medical/primaryCareWorkflowDb';
import { workflowGate } from '../_lib/workflowGate';

export const runtime = 'nodejs';

const RESOURCE = 'medicalOutreach';
/** Patients scanned per request (care team first by name); the list says when it was capped */
const SCAN_LIMIT = 300;

/**
 * GET /api/medical/ma-worklist — care-gap outreach list for the viewer's care team: active primary
 * care patients with a screening / immunization / diabetes gap due, the last outreach, and the
 * call / portal message templates (screening guidance; the MA logs outreach, the provider closes gaps).
 */
export async function GET(req: Request) {
  const g = await workflowGate(req, { action: 'LIST', resourceType: RESOURCE, allow: canRoomPatients });
  if (g.ok === false) return g.response;
  const v = g.viewer;
  try {
    const now = new Date();
    const timeZone = await getPracticeTimeZone(v.organizationId);
    const [settings, practice] = await Promise.all([
      loadPrimaryCareSettings(v.organizationId),
      prisma.practiceSettings.findUnique({ where: { organizationId: v.organizationId }, select: { dbaName: true, legalName: true, mainPhone: true } }).catch(() => null),
    ]);
    const clients = await prisma.client.findMany({
      where: primaryCarePopulation(v),
      select: { id: true, name: true, phone: true },
      orderBy: { name: 'asc' },
      take: SCAN_LIMIT + 1,
    });
    const capped = clients.length > SCAN_LIMIT;
    const scan = clients.slice(0, SCAN_LIMIT);
    const locked = await lockedClientIds(v, scan.map((c) => c.id));
    const visible = scan.filter((c) => locked !== null && !locked.has(c.id));
    const facts = await loadCareFactsBatch(v.organizationId, visible.map((c) => c.id), { now, timeZone, disabledGaps: settings.careGapsDisabled });
    const rows = visible
      .map((c) => {
        const f = facts.get(c.id);
        const open = f ? openCareGaps(f.careGaps) : [];
        return {
          clientId: c.id,
          patient: c.name,
          phone: c.phone,
          gaps: open.map((gp) => ({ key: gp.key, label: gp.label, status: gp.status, reason: gp.reason, patientReported: gp.patientReported })),
          overdue: open.filter((gp) => gp.status === 'overdue').length,
          lastOutreach: f?.lastOutreach ?? null,
        };
      })
      .filter((r) => r.gaps.length > 0)
      .sort((a, b) => b.overdue - a.overdue || (a.lastOutreach ?? '').localeCompare(b.lastOutreach ?? '') || a.patient.localeCompare(b.patient));
    const practiceName = practice?.dbaName || practice?.legalName || null;
    await auditPhiAccess({ gate: g.gate, req, action: 'LIST', resourceType: RESOURCE, metadata: { scanned: scan.length, listed: rows.length, capped, clientIds: rows.slice(0, 50).map((r) => r.clientId) } });
    return NextResponse.json({
      success: true,
      rows,
      capped,
      scanLimit: SCAN_LIMIT,
      maskedCount: scan.length - visible.length,
      templates: {
        phone: outreachTemplate({ gaps: ['{screenings}'], practiceName, practicePhone: practice?.mainPhone ?? null, method: 'phone' }),
        portal: outreachTemplate({ gaps: ['{screenings}'], practiceName, practicePhone: practice?.mainPhone ?? null, method: 'portal' }),
      },
    });
  } catch (err) {
    console.error('[medical/ma-worklist GET]', err instanceof Error ? err.name : 'error');
    return NextResponse.json({ success: false, error: 'Could not load the outreach list' }, { status: 500 });
  }
}
