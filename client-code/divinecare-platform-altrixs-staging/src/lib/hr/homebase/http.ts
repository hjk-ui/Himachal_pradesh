import { hrJsonError, isMissingTable } from '@/lib/hr/server';

/** API error for the Homebase routes (never echoes Homebase responses or the key). */
export function homebaseServerError(tag: string, err: unknown) {
  if (isMissingTable(err)) {
    return hrJsonError('Homebase tables are not on this database yet. Run the 20261024_homebase_connector migration.', 503);
  }
  console.error(`[hr homebase ${tag}]`, err instanceof Error ? err.message : 'error');
  return hrJsonError('Something went wrong. Try again.', 500);
}
