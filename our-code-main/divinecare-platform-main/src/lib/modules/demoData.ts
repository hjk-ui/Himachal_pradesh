const DEMO_MARKERS = [
  '@example.com',
  'sofia jones',
  '192.168.1.14',
  '192.168.1.22',
  'auth #md-2026-88421',
];

const DEMO_ID =
  /(^|")((elig|tp|dx|pa|gb)-seed-\d+|inv-[1-9]|d-[1-9]|cl-[1-9]|note-00\d|rx00\d|sv-[1-9]|gs-[1-4]|sb-[1-3]|pan-[1-9]|sl-[1-9]|p[1-9]|audit-[1-4]|cr-[1-9]|contact-[1-3])("|$)/i;

export function isDemoRecord(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const json = JSON.stringify(value).toLowerCase();
  if (DEMO_MARKERS.some((marker) => json.includes(marker))) return true;
  return DEMO_ID.test(json);
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
