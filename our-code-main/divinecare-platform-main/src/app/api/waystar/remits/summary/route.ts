import { NextRequest, NextResponse } from 'next/server';
import { getS3FileContent, parse835Summary } from '@/lib/services/waystarSftpService';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPayerBilling } from '@/lib/auth/roleAccess';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPayerBilling(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  try {
    const key = req.nextUrl.searchParams.get('key') || 'inbound/835/835_OPTUMMD_CK884201.txt';
    const content = await getS3FileContent(key);
    const summary = parse835Summary(content);
    return NextResponse.json({
      success: true,
      key,
      ...summary,
    });
  } catch (err: any) {
    console.error('[waystar-remit-summary] error:', err);
    return NextResponse.json({ error: err.message || 'Failed to summarize remittance' }, { status: 500 });
  }
}
