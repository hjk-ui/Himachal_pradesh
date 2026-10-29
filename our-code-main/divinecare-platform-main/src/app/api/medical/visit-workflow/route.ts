import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { buildVisitWorkflow } from '@/lib/medical/visit-workflow';
import { openVisitSetsInRoom } from '@/lib/medical/rooming';
import { assertMedicalClientAccess, assertMedicalAppointmentAccess } from '@/lib/medical/access';

export const runtime = 'nodejs';

const PROVIDER_ROLES = new Set([
  'PHYSICIAN',
  'MEDICAL_NP',
  'MEDICAL_ASSISTANT',
  'ADMIN',
  'DIRECTOR',
  'PRACTICE_DIRECTOR',
]);

export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (gate.ok === false) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPath(gate.role, '/dashboard/medical') || !PROVIDER_ROLES.has(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const url = new URL(req.url);
  const appointmentId = url.searchParams.get('appointmentId') || '';
  const clientId = url.searchParams.get('clientId') || '';
  const clientName = url.searchParams.get('clientName') || 'Patient';
  if (!appointmentId || !clientId) {
    return NextResponse.json(
      { success: false, error: 'appointmentId and clientId are required' },
      { status: 400 }
    );
  }

  const actor = { organizationId: gate.organizationId, userId: gate.userId, role: gate.role };
  const clientAccess = await assertMedicalClientAccess(actor, clientId);
  if (clientAccess.ok === false) {
    return NextResponse.json(
      { success: false, error: clientAccess.error },
      { status: clientAccess.status }
    );
  }
  const apptAccess = await assertMedicalAppointmentAccess(actor, appointmentId);
  if (apptAccess.ok === false) {
    return NextResponse.json(
      { success: false, error: apptAccess.error },
      { status: apptAccess.status }
    );
  }

  const ageRaw = url.searchParams.get('ageYears');
  const ageYears = ageRaw != null && ageRaw !== '' ? Number(ageRaw) : null;
  const medicare = url.searchParams.get('medicare') === '1';
  const minutesRaw = url.searchParams.get('minutes');
  const minutes = minutesRaw != null && minutesRaw !== '' ? Number(minutesRaw) : null;
  const phq9Raw = url.searchParams.get('phq9');
  const gad7Raw = url.searchParams.get('gad7');
  const phq9 = phq9Raw != null && phq9Raw !== '' ? Number(phq9Raw) : null;
  const gad7 = gad7Raw != null && gad7Raw !== '' ? Number(gad7Raw) : null;

  // Opening visit when rooming ready → in_room
  await openVisitSetsInRoom(gate.organizationId, appointmentId, gate.userId);

  const workflow = await buildVisitWorkflow(gate.organizationId, {
    appointmentId,
    clientId,
    clientName,
    ageYears: Number.isFinite(ageYears) ? ageYears : null,
    medicare,
    minutes: Number.isFinite(minutes) ? minutes : null,
    phq9: Number.isFinite(phq9) ? phq9 : null,
    gad7: Number.isFinite(gad7) ? gad7 : null,
  });

  return NextResponse.json({ success: true, workflow });
}
