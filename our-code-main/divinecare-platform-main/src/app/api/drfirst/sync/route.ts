import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { assertDrFirstPrescriber } from '@/lib/drfirst/access';
import { DrFirstError, safeDrFirstError } from '@/lib/drfirst/errors';
import {
  checkPatientSyncThrottle,
  syncPatientFromDrFirst,
} from '@/lib/drfirst/sync';

export const runtime = 'nodejs';

const bodySchema = z.object({ clientId: z.string().min(1).max(128) });

/**
 * Manual Refresh from DrFirst — per-patient 5-minute throttle.
 */
export async function POST(req: Request) {
  try {
    const gate = await requireOrgContext();
    if (gate.ok === false) throw new DrFirstError('DRFIRST_UNAUTHORIZED', gate.status);
    assertDrFirstPrescriber(gate);
    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new DrFirstError('DRFIRST_INVALID_INPUT');

    const throttle = await checkPatientSyncThrottle(gate.organizationId, parsed.data.clientId);
    if (throttle.ok === false) {
      return NextResponse.json(
        {
          success: false,
          code: 'DRFIRST_SYNC_THROTTLED',
          error: `DrFirst allows one refresh every 5 minutes for a patient; this chart updates again in about ${Math.ceil(throttle.retryAfterSeconds / 60)} min.`,
          retryAfterSeconds: throttle.retryAfterSeconds,
        },
        { status: 429 }
      );
    }

    const result = await syncPatientFromDrFirst(gate.organizationId, parsed.data.clientId);
    return NextResponse.json({
      success: true,
      changes: result.changes,
      message:
        result.changes > 0
          ? `Updated from DrFirst: ${result.changes} change(s).`
          : 'Up to date with DrFirst.',
    });
  } catch (error) {
    const safe = safeDrFirstError(error);
    return NextResponse.json(
      { success: false, code: safe.code, error: safe.detail || safe.message },
      { status: safe.status }
    );
  }
}
