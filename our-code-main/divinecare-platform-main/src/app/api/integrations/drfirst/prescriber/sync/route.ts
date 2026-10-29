import { NextResponse } from 'next/server';
import { drFirstRoute, readInput, prescriberSchema } from '@/lib/drfirst/http';
import { syncPrescriberToDrFirst } from '@/lib/drfirst/service';
export async function POST(req: Request) {
  return drFirstRoute(req, async context => {
    const input = await readInput(req, prescriberSchema);
    return NextResponse.json({ success: true, data: await syncPrescriberToDrFirst(input.userId || context.userId, context) });
  });
}
