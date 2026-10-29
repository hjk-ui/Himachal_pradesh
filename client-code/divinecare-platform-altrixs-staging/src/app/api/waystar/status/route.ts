import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessClaims } from '@/lib/billing/claims';
import { getConnectionStatus } from '@/lib/services/waystarSftpService';

export const dynamic = 'force-dynamic';

/** Waystar connector status (connector ID, S3 bucket, SFTP host): billing core only. */
export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessClaims(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  try {
    const status = await getConnectionStatus();
    return NextResponse.json({
      success: true,
      ...status,
      timestamp: new Date().toISOString(),
    });
  } catch (err: unknown) {
    console.error('[waystar-status] error:', err instanceof Error ? err.message : 'unknown error');
    return NextResponse.json({ success: false, error: 'Failed to read Waystar connector status' }, { status: 500 });
  }
}
