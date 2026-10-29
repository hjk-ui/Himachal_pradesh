import { NextResponse } from 'next/server';

export const LEGACY_DRFIRST_ROUTE_CODE = 'DRFIRST_LEGACY_ROUTE_DISABLED';

/**
 * Fail closed for routes that pre-date the authenticated DrFirst adapter.
 * These endpoints must not call DrFirst or mutate clinical data until they
 * are rebuilt on the verified, tenant-scoped integration contract.
 */
export function legacyDrFirstRouteDisabled() {
  return NextResponse.json(
    {
      success: false,
      code: LEGACY_DRFIRST_ROUTE_CODE,
      error: 'This legacy DrFirst endpoint is disabled. Use /api/integrations/drfirst.',
    },
    {
      status: 410,
      headers: {
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
      },
    },
  );
}
