import { NextResponse } from 'next/server';
import { drFirstRoute } from '@/lib/drfirst/http';
import { checkDrFirstConnection } from '@/lib/drfirst/service';
export async function GET(req: Request) {
  return drFirstRoute(req, async context => NextResponse.json(await checkDrFirstConnection(context)), true);
}
