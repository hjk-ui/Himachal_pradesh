/**
 * Citation targets for chart history digest sources: chart documents the viewer may open (document
 * viewer; the UI adds #page=N), signed notes (notes page) and structured records (the chart tab that
 * lists the record; risk flags: no link). Server only. Shared by the chart history card
 * (GET /api/clients/[id]/chart-digest) and the huddle sheet summary links.
 */
import { prisma } from '@/lib/db/prisma';
import { chartDocumentFilter } from '@/lib/docIntake/chartDocumentAccess';

const RECORD_TAB: Record<string, string | null> = {
  problem: 'diagnoses',
  bhdx: 'diagnoses',
  med: 'medications',
  allergy: 'medical-history',
  vital: 'medical-vitals',
  lab: 'labs',
  referral: 'medical-orders',
  risk: null,
};

export async function chartDigestCitationLinks(
  viewer: { organizationId: string; userId: string; role: string },
  clientId: string,
  keys: readonly string[]
): Promise<Record<string, string | null>> {
  const chartTab = (tab: string) => `/dashboard/clients/${encodeURIComponent(clientId)}?tab=${tab}`;
  const docIds = keys.filter((k) => k.startsWith('doc:')).map((k) => k.slice(4));
  const links: Record<string, string | null> = {};
  if (docIds.length) {
    const rows = await prisma.documentIntake.findMany({
      where: { id: { in: docIds }, suggestedClientId: clientId, suggestedClient: { organizationId: viewer.organizationId }, status: 'filed', voidedAt: null },
      select: { id: true, documentType: true, s3RawKey: true, fileName: true },
    });
    const filter = chartDocumentFilter(viewer, clientId);
    for (const r of rows) {
      const ok = r.s3RawKey && r.s3RawKey !== 'pending' && r.fileName && (await filter.canView(r.documentType));
      links[`doc:${r.id}`] = ok ? `/api/files/intake-docs/${encodeURIComponent(r.s3RawKey)}` : null;
    }
  }
  for (const k of keys.filter((x) => x.startsWith('note:'))) {
    links[k] = `/dashboard/ehr/notes?clientId=${encodeURIComponent(clientId)}&openNote=${encodeURIComponent(k.slice(5))}`;
  }
  for (const k of keys.filter((x) => x.startsWith('visit:'))) links[k] = chartTab('medical-visits');
  for (const k of keys.filter((x) => x.startsWith('rec:'))) {
    const tab = RECORD_TAB[k.split(':')[1] ?? ''];
    links[k] = tab ? chartTab(tab) : null;
  }
  return links;
}
