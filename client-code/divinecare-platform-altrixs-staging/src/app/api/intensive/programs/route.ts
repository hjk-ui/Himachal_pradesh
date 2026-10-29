import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { z } from 'zod';
import { errorResponse, fail, intensiveGate, ok, programSchema } from '@/lib/intensive/http';
import { canManagePrograms } from '@/lib/intensive/access';
import { confirmProgramPolicy, listPrograms, programView, saveProgram } from '@/lib/intensive/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/intensive/programs: programs (inactive too for leadership). No PHI. */
export async function GET() {
  const g = await intensiveGate();
  if (!g.ok) return g.res;
  try {
    return ok({ programs: await listPrograms(g.actor, { includeInactive: canManagePrograms(g.actor.role) }) });
  } catch (e) {
    return errorResponse(e, 'Could not load programs');
  }
}

/** POST /api/intensive/programs: create or update a program (leadership). Policy changes reset confirmation. */
export async function POST(req: Request) {
  const g = await intensiveGate({ write: true });
  if (!g.ok) return g.res;
  if (!canManagePrograms(g.actor.role)) return fail('Only practice leadership sets up programs', 403);
  try {
    const body = programSchema.parse(await req.json());
    const { id, ...input } = body;
    const { program, policyReset } = await saveProgram(g.actor, id ?? null, input);
    await auditPhiAccess({ gate: g.gate, req, action: id ? 'UPDATE' : 'CREATE', resourceType: 'intensiveProgram',
      resourceId: program.id,
      metadata: { programType: program.programType, active: program.active, policyReset },
    });
    return ok({ program: programView(program, null), policyReset }, id ? 200 : 201);
  } catch (e) {
    return errorResponse(e, 'Could not save the program');
  }
}

const patchSchema = z.object({ id: z.string().trim().min(1).max(64), action: z.literal('confirm_policy') });

/** PATCH /api/intensive/programs { id, action: 'confirm_policy' }: leadership confirms the program's policy settings. */
export async function PATCH(req: Request) {
  const g = await intensiveGate({ write: true });
  if (!g.ok) return g.res;
  try {
    const body = patchSchema.parse(await req.json());
    const p = await confirmProgramPolicy(g.actor, body.id);
    await auditPhiAccess({ gate: g.gate, req, action: 'UPDATE', resourceType: 'intensiveProgram', resourceId: p.id, metadata: { action: 'confirm_policy' } });
    return ok({ program: programView(p, null) });
  } catch (e) {
    return errorResponse(e, 'Could not confirm the program policy');
  }
}
