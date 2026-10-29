import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { assertDrFirstPrescriber } from '@/lib/drfirst/access';
import { getDrFirstConfig } from '@/lib/drfirst/config';
import { publicDrFirstStatus } from '@/lib/drfirst/settings';
import { DrFirstError, safeDrFirstError } from '@/lib/drfirst/errors';
import { prepareDrFirstLaunch } from '@/lib/drfirst/service';
import { recordSsoLaunch } from '@/lib/drfirst/sync';
import { screenForCount, type DrFirstStartupScreen } from '@/lib/drfirst/screens';

export const runtime = 'nodejs';

/**
 * Deep-link SSO: ?screen=report|message (no patient) or patient launch.
 * New tab only — never iframe. limp_mode=y for count screens.
 */
export async function GET(req: Request) {
  try {
    const gate = await requireOrgContext();
    if (gate.ok === false) throw new DrFirstError('DRFIRST_UNAUTHORIZED', gate.status);
    assertDrFirstPrescriber(gate);

    const url = new URL(req.url);
    const screenParam = url.searchParams.get('screen') as DrFirstStartupScreen | null;
    const patient = url.searchParams.get('patient');
    const countKey = url.searchParams.get('count');

    const screen =
      screenParam ||
      (countKey ? screenForCount(countKey) : null) ||
      null;

    const config = getDrFirstConfig();
    if (!config.enabled) throw new DrFirstError('DRFIRST_DISABLED', 503);

    // Demo without vendor creds — early 200, never hit 409 demographics paths.
    const status = publicDrFirstStatus(config);
    if (!status.configured || config.environment === 'mock') {
      return NextResponse.json({
        success: true,
        demo: true,
        url: '/dashboard/ehr/prescriptions/mock',
        screen,
        limp_mode: screen ? 'y' : undefined,
      });
    }

    if (patient) {
      const result = await prepareDrFirstLaunch(
        {
          clientId: patient,
          prescriberId: gate.userId,
          organizationId: gate.organizationId,
        },
        gate
      );
      await recordSsoLaunch(gate.organizationId, gate.userId, patient, screen);
      return NextResponse.json({
        success: true,
        demo: false,
        url: result.session.launchUrl,
        patientSynced: true,
        screen,
      });
    }

    // Practice-level screen open (report/message) — no patient upload.
    if (!screen || (screen !== 'report' && screen !== 'message')) {
      throw new DrFirstError('DRFIRST_INVALID_INPUT', 400, 'screen=report|message required when patient is omitted');
    }

    return NextResponse.json({
      success: true,
      demo: false,
      url: `${config.ssoUrl || ''}?startup_screen=${screen}&limp_mode=y`,
      screen,
      limp_mode: 'y',
    });
  } catch (error) {
    const safe = safeDrFirstError(error);
    return NextResponse.json(
      {
        success: false,
        code: safe.code,
        error: safe.detail || safe.message,
        ...(safe.missingFields?.length ? { missingFields: safe.missingFields } : {}),
      },
      { status: safe.status }
    );
  }
}

// Keep schema available for tests
export const ssoQuerySchema = z.object({
  patient: z.string().optional(),
  screen: z.enum(['report', 'message']).optional(),
  count: z.string().optional(),
});
