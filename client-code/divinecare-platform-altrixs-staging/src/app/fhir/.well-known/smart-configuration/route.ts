import { NextResponse } from 'next/server';
import { getApiBaseUrl, getFhirIss } from '@/lib/fhir/config';

export const runtime = 'nodejs';

/** GET /fhir/.well-known/smart-configuration — public SMART discovery (HS256: no jwks_uri). */
export async function GET() {
  const api = getApiBaseUrl();
  const iss = getFhirIss();

  const body = {
    issuer: iss,
    authorization_endpoint: `${api}/auth/smart/authorize`,
    token_endpoint: `${api}/auth/smart/token`,
    token_endpoint_auth_methods_supported: ['none', 'client_secret_basic'],
    grant_types_supported: ['authorization_code'],
    scopes_supported: [
      'launch',
      'launch/patient',
      'launch/encounter',
      'patient/Patient.read',
      'patient/Encounter.read',
      'openid',
      'fhirUser',
      'profile',
    ],
    response_types_supported: ['code'],
    capabilities: [
      'launch-ehr',
      'context-ehr-patient',
      'context-ehr-encounter',
      'permission-patient',
      'client-public',
    ],
    code_challenge_methods_supported: ['S256'],
  };

  return NextResponse.json(body, {
    headers: {
      'Cache-Control': 'public, max-age=3600',
      'Content-Type': 'application/json',
    },
  });
}
