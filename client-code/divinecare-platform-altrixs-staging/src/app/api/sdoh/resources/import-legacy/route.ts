import { importLegacyResources } from '@/lib/sdoh/manage';
import { errorResponse, ok, sdohGate } from '@/lib/sdoh/http';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';

export const runtime = 'nodejs';

/** POST /api/sdoh/resources/import-legacy — copy the old 'sdoh-resources' list into the directory once (idempotent). */
export async function POST() {
  const g = await sdohGate();
  if (!g.ok) return g.res;
  try {
    const result = await importLegacyResources(g.actor);
    await writeAuditLog({
      action: 'CREATE',
      actorUserId: g.gate.userId,
      actorRole: g.gate.role,
      organizationId: g.gate.organizationId,
      resourceType: 'SdohResource',
      metadata: { importType: 'legacy-module', ...result },
    });
    return ok(result);
  } catch (error) {
    return errorResponse(error, 'Import failed');
  }
}
