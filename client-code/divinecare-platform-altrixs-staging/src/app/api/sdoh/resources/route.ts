import { createResource, listResources } from '@/lib/sdoh/manage';
import { createResourceSchema, errorResponse, ok, sdohGate } from '@/lib/sdoh/http';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';

export const runtime = 'nodejs';

/** GET /api/sdoh/resources — org community resource directory (no PHI). */
export async function GET() {
  const g = await sdohGate();
  if (!g.ok) return g.res;
  try {
    return ok(await listResources(g.actor.organizationId));
  } catch (error) {
    return errorResponse(error, 'Could not load the directory');
  }
}

/** POST /api/sdoh/resources — add a resource. */
export async function POST(req: Request) {
  const g = await sdohGate();
  if (!g.ok) return g.res;
  try {
    const body = createResourceSchema.parse(await req.json());
    const resource = await createResource(g.actor, body);
    await writeAuditLog({
      action: 'CREATE',
      actorUserId: g.gate.userId,
      actorRole: g.gate.role,
      organizationId: g.gate.organizationId,
      resourceType: 'SdohResource',
      resourceId: resource.id,
    });
    return ok({ resource }, 201);
  } catch (error) {
    return errorResponse(error, 'Resource could not be saved');
  }
}
