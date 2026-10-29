import { redirect } from 'next/navigation';
import { requireOrgContext } from '@/lib/auth/tenant';
import { legacyMedicalPatientRedirect } from '@/lib/medical/medicalProgram';
import { resolveMedicalPatientLink } from '@/lib/medical/patientLink';

export const dynamic = 'force-dynamic';

/**
 * The separate medical chart is folded into the client chart (one patient record). Old links
 * (MedicalPatient id, MRN or client id) open the client chart on its Medical tab group; the chart
 * itself applies org, caseload, Part 2 and per-tab role rules. An unlinked record lands on the
 * Family Practice list with a notice (nothing is matched automatically).
 */
export default async function LegacyMedicalPatientChart({ params }: { params: Promise<{ id: string }> }) {
  const gate = await requireOrgContext();
  if (!gate.ok) redirect('/dashboard');
  const { id } = await params;
  const { clientId } = await resolveMedicalPatientLink(gate.organizationId, decodeURIComponent(id));
  redirect(legacyMedicalPatientRedirect(clientId));
}
