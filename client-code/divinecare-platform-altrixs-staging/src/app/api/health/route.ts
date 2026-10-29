import { NextResponse } from 'next/server';
import { currentVersion } from '@/lib/version';

export const dynamic = 'force-dynamic';

/**
 * Liveness: the Node process is up and serving. Never touches the database or any integration
 * (use /api/ready for that). Public; holds no PHI, configuration or secrets.
 */
export function GET() {
  return NextResponse.json(
    { ok: true, version: currentVersion().version },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
