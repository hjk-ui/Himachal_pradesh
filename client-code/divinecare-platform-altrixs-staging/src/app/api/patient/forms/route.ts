import { listPatientForms } from '@/patient/application/forms/service';
import { parsePagination, patientGet, patientOk, patientOptions } from '@/patient/infrastructure/http/handler';

export function OPTIONS() { return patientOptions(); }

export const GET = patientGet(async ({ req, ctx }) => {
  const { skip, limit } = parsePagination(new URL(req.url));
  return patientOk(await listPatientForms(ctx, skip, limit));
}, ['patient-forms', 60]);
