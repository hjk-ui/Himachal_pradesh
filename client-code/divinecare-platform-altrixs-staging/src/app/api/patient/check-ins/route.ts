import { readPatientJson } from '@/patient/infrastructure/http/response';
import { z } from 'zod';
import { createPatientCheckIn, listPatientCheckIns } from '@/patient/application/check-ins/service';
import {
  parsePagination,
  patientGet,
  patientOk,
  patientOptions,
  patientPost,
} from '@/patient/infrastructure/http/handler';

export function OPTIONS() {
  return patientOptions();
}

export const GET = patientGet(
  async ({ req, ctx }) => {
    const url = new URL(req.url);
    const { limit, skip } = parsePagination(url);
    const from = url.searchParams.get('from') || undefined;
    const to = url.searchParams.get('to') || undefined;
    const data = await listPatientCheckIns(ctx, { skip, limit, from, to });
    return patientOk(data);
  },
  ['patient-checkins-list', 60]
);

const createSchema = z.object({
  mood: z.coerce.number().int().min(1).max(10),
  stress: z.coerce.number().int().min(1).max(10),
  sleep: z.coerce.number().int().min(1).max(10).optional().nullable(),
  journal: z.string().max(1000).optional().nullable(),
  note: z.string().max(1000).optional().nullable(),
});

export const POST = patientPost(
  async ({ req, ctx }) => {
    const raw = await readPatientJson(req);
    const body = createSchema.parse(raw);
    const journal = body.journal ?? body.note ?? null;
    const checkIn = await createPatientCheckIn(ctx, {
      mood: body.mood,
      stress: body.stress,
      sleep: body.sleep,
      journal,
    });
    return patientOk({ checkIn }, 201);
  },
  ['patient-checkin-create', 30]
);
