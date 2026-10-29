import { z } from 'zod';

/** DrFirst Search Drug Allergy input rules used by the API and certification tests. */
export const drugAllergySearchSchema = z.object({
  searchString: z.string().trim().min(2).max(100).refine(
    value => value.replace(/[^\p{L}\p{N}]/gu, '').length >= 2,
    'Search string must contain at least two letters or numbers.',
  ),
  maximum: z.number().int().min(1).max(200).optional(),
}).strict();

