import { NextResponse } from 'next/server';
import { drFirstRoute, readInput, patientSchema } from '@/lib/drfirst/http';
import { syncPatientToDrFirst } from '@/lib/drfirst/service';
export async function POST(req: Request) {
  return drFirstRoute(req, async context => {
    const input = await readInput(req, patientSchema);
    return NextResponse.json({ success: true, data: await syncPatientToDrFirst(input.clientId, context, { linkImported: input.linkImported }) });
  });
}
