import { NextResponse } from 'next/server';
import { currentVersion } from '@/lib/version';

export const dynamic = 'force-static';

/** Public build/version check for deploy verification and support. Holds no PHI or configuration. */
export function GET() {
  return NextResponse.json(currentVersion(), { headers: { 'Cache-Control': 'no-store' } });
}
