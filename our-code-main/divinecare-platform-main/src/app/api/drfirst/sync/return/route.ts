import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { assertDrFirstPrescriber } from '@/lib/drfirst/access';
import { DrFirstError, safeDrFirstError } from '@/lib/drfirst/errors';
import {
  checkReturnThrottle,
  latestLaunchPatient,
  markReturnSynced,
  syncPatientFromDrFirst,
} from '@/lib/drfirst/sync';

export const runtime = 'nodejs';

/**
 * Return-from-Rcopia auto sync — tab hidden ≥3s then visible.
 * Throttled 20s per user; soft-miss is silent (cron catches up).
 */
export async function POST() {
  try {
    const gate = await requireOrgContext();
    if (gate.ok === false) throw new DrFirstError('DRFIRST_UNAUTHORIZED', gate.status);
    assertDrFirstPrescriber(gate);

    const throttle = await checkReturnThrottle(gate.organizationId, gate.userId);
    if (throttle.ok === false) {
      return NextResponse.json({
        success: true,
        soft: true,
        reason: 'throttled',
        retryAfterSeconds: throttle.retryAfterSeconds,
      });
    }

    const clientId = await latestLaunchPatient(gate.organizationId, gate.userId);
    if (!clientId) {
      return NextResponse.json({ success: true, soft: true, reason: 'no_recent_launch' });
    }

    const result = await syncPatientFromDrFirst(gate.organizationId, clientId);
    await markReturnSynced(gate.organizationId, gate.userId);

    try {
      const { recordIntegrationCall } = await import('@/lib/integrations/callLog');
      await recordIntegrationCall({
        organizationId: gate.organizationId,
        integration: 'drfirst',
        operation: 'return-sync',
        status: 'success',
        userId: gate.userId,
        clientId,
        metadata: { changes: result.changes, trigger: 'logout_url' },
      });
    } catch {
      /* never throw */
    }

    return NextResponse.json({
      success: true,
      clientId,
      changes: result.changes,
      message:
        result.changes > 0
          ? `Updated from DrFirst: ${result.changes} change(s).`
          : 'Up to date with DrFirst.',
      event: 'altrixs:drfirst-synced',
    });
  } catch (error) {
    const safe = safeDrFirstError(error);
    return NextResponse.json(
      { success: false, code: safe.code, error: safe.detail || safe.message },
      { status: safe.status }
    );
  }
}
