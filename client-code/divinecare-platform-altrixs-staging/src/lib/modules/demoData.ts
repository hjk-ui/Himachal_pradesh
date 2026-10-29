/**
 * Demo-record filtering for module snapshots.
 *
 * This used to match string heuristics (ids like "D-1", "p1", "@example.com", ...). Real records
 * can legitimately contain those values, and because the client saves back what it read, a hidden
 * real record was then deleted permanently on the next save. Only an explicit marker now counts:
 * a record is demo data when it carries `__demo: true`. Nothing else is ever hidden.
 */
export const DEMO_MARKER_FIELD = '__demo';

export function isDemoRecord(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return (value as Record<string, unknown>)[DEMO_MARKER_FIELD] === true;
}

export function stripDemoModuleData<T>(data: T): T {
  if (Array.isArray(data)) {
    return data.filter((item) => !isDemoRecord(item)) as T;
  }
  if (data && typeof data === 'object' && isDemoRecord(data)) {
    return null as T;
  }
  return data;
}
