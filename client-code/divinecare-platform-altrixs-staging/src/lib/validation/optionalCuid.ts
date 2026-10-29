import { z } from 'zod';

/**
 * Optional cuid that treats "" / whitespace as null.
 * HTML <select> "Unassigned" submits "" which must not fail cuid().
 */
export const optionalCuid = z.preprocess((value) => {
  if (value == null) return null;
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}, z.string().cuid().nullable().optional());
