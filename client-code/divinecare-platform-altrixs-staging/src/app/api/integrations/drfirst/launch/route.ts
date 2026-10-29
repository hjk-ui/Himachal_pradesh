import { NextResponse } from 'next/server';
import { drFirstRoute, readInput, launchSchema } from '@/lib/drfirst/http';
import { prepareDrFirstLaunch } from '@/lib/drfirst/service';
import { getDrFirstConfig } from '@/lib/drfirst/config';
import { MOCK_LAUNCH_PATH, MOCK_SESSION_SECONDS } from '@/lib/drfirst/validation';
export async function POST(req: Request) {
  return drFirstRoute(req, async context => {
    const input = await readInput(req, launchSchema);
    const result = await prepareDrFirstLaunch({ ...input, prescriberId: context.userId, organizationId: context.organizationId }, context);
    const response = NextResponse.json({ success: true, data: result.session });
    if (result.session.mode === 'MOCK') response.cookies.set('drfirst-mock-launch', result.token, {
      httpOnly: true, secure: getDrFirstConfig().productionRuntime, sameSite: 'strict', path: MOCK_LAUNCH_PATH, maxAge: MOCK_SESSION_SECONDS,
    });
    return response;
  });
}
