import { NextResponse } from 'next/server';
import { drFirstRoute, readInput } from '@/lib/drfirst/http';
import { getFdbConfig } from '@/lib/drfirst/config';
import { publicFdbStatus } from '@/lib/drfirst/fdb/settings';
import { searchDrugAllergies } from '@/lib/drfirst/fdb/service';
import { drugAllergySearchSchema } from '@/lib/drfirst/fdb/validation';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  return drFirstRoute(req, async () => NextResponse.json(publicFdbStatus(getFdbConfig())));
}

export async function POST(req: Request) {
  return drFirstRoute(req, async () => {
    const input = await readInput(req, drugAllergySearchSchema);
    return NextResponse.json({ success: true, data: await searchDrugAllergies(input.searchString, input.maximum) });
  });
}
