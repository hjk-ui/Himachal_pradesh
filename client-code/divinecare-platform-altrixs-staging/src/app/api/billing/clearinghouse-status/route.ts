import { NextResponse } from 'next/server';
import { claimClearinghouseMode } from '@/lib/integrations/waystar';

/** Public clearinghouse mode for billing UI banners (no secrets). */
export async function GET() {
  const mode = claimClearinghouseMode();
  return NextResponse.json({
    success: true,
    claimCh: mode.claimCh,
    demoMode: mode.demoMode,
    waystarEnabled: mode.waystarEnabled,
    availityEnabled: mode.availityEnabled,
  });
}
