import { z } from 'zod';
import { importResourcesCsv } from '@/lib/sdoh/manage';
import { errorResponse, ok, sdohGate } from '@/lib/sdoh/http';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { auditRequestMeta } from '@/lib/audit/requestMeta';

export const runtime = 'nodejs';

/** POST { csv } — import local agencies from the CSV template (no PHI). Invalid rows are reported, not imported. */
export async function POST(req: Request) {
  const g = await sdohGate();
  if (!g.ok) return g.res;
  try {
    const { csv } = z.object({ csv: z.string().min(1).max(2_000_000) }).parse(await req.json());
    const result = await importResourcesCsv(g.actor, csv);
    await writeAuditLog({
      action: 'IMPORT',
      actorUserId: g.gate.userId,
      actorRole: g.gate.role,
      organizationId: g.gate.organizationId,
      resourceType: 'SdohResource',
      metadata: { created: result.created, errors: result.errors.length },
      ...auditRequestMeta(req),
    });
    return ok(result);
  } catch (error) {
    return errorResponse(error, 'The CSV could not be imported');
  }
}
