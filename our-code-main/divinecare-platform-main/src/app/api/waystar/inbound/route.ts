import { NextRequest, NextResponse } from 'next/server';
import { pollInboundFiles } from '@/lib/services/waystarSftpService';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPayerBilling } from '@/lib/auth/roleAccess';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPayerBilling(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  try {
    const userId = gate.userId;
    const result = await pollInboundFiles(userId);
    return NextResponse.json({ success: true, ...result });
  } catch (err: any) {
    console.error('[waystar-inbound] error:', err);
    return NextResponse.json({ error: err.message || 'Failed to poll inbound files' }, { status: 500 });
  }
}
