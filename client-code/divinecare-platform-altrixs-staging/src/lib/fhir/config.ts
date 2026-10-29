/**
 * SMART on FHIR / CRISP HIE configuration.
 * Blank SMART_SIGNING_SECRET → DEMO_MODE (no live CRISP embedding).
 */

function read(name: string): string {
  return (process.env[name] ?? '').trim();
}

export const SMART_SIGNING_SECRET = read('SMART_SIGNING_SECRET');

/** True when signing secret is unset — launch/authorize/token use demo fixtures. */
export const DEMO_MODE = !SMART_SIGNING_SECRET;

export const SMART_ALLOWED_CLIENTS = (
  read('SMART_ALLOWED_CLIENTS') || 'crisp-eqp,crisp-sandbox'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

export const CRISP_EQP_URL =
  read('CRISP_EQP_URL') || 'https://portal.crisphealth.org/eqp';

/** Public origin, no trailing slash. */
export function getApiBaseUrl(): string {
  const raw =
    read('API_BASE_URL') ||
    read('NEXT_PUBLIC_APP_URL') ||
    read('AUTH_URL') ||
    read('NEXTAUTH_URL') ||
    'http://localhost:3000';
  return raw.replace(/\/$/, '');
}

/** FHIR issuer = ${API_BASE_URL}/fhir */
export function getFhirIss(): string {
  return `${getApiBaseUrl()}/fhir`;
}

export const FHIR_PRODUCT_NAME = 'Altrixs';

/** CRISP launch: treating clinicians, care coordinators, primary care providers and leadership
 * (same roles as the /dashboard/ehr/hie page). Not Office Manager, Peer Support or Medical
 * Assistants (minimum necessary). Patient scope is the caseload / care team rule
 * (gateClientRoute in /fhir/launch), the same as the BH prescribers. */
export const LAUNCH_ROLES = [
  'THERAPIST',
  'PSYCHIATRIST',
  'NP',
  'PHYSICIAN',
  'MEDICAL_NP',
  'CASE_MANAGER',
  'PRP_SPECIALIST',
  'PRACTICE_DIRECTOR',
  'ADMIN',
  'DIRECTOR',
  'CLINICIAN',
] as const;

export type LaunchRole = (typeof LAUNCH_ROLES)[number];

export function canLaunchCrisp(role: string | null | undefined): boolean {
  if (!role) return false;
  return (LAUNCH_ROLES as readonly string[]).includes(String(role).trim().toUpperCase());
}
