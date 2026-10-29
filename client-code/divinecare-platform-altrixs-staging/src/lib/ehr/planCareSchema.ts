import { z } from 'zod';
import {
  PLAN_TYPES,
  LEVELS_OF_CARE,
  ASAM_LEVELS,
  SERVICE_FREQUENCIES,
  EXPECTED_DURATIONS,
} from './planLibrary';
export const planCareSchema = z.object({
  planType: z.enum(['', ...PLAN_TYPES]),
  levelOfCare: z.enum(['', ...LEVELS_OF_CARE]),
  asamLevel: z.enum(['', ...ASAM_LEVELS]),
  serviceFrequency: z.enum(['', ...SERVICE_FREQUENCIES]),
  expectedDuration: z.enum(['', ...EXPECTED_DURATIONS]),
  coordinationOfCare: z.string().trim().max(4000),
  barriersToTreatment: z.string().trim().max(4000),
});
