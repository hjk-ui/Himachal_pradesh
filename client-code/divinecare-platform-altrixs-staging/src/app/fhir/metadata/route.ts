import { NextResponse } from 'next/server';
import { FHIR_PRODUCT_NAME, getApiBaseUrl, getFhirIss } from '@/lib/fhir/config';

export const runtime = 'nodejs';

/** GET /fhir/metadata — FHIR R4 CapabilityStatement (public). */
export async function GET() {
  const api = getApiBaseUrl();
  const iss = getFhirIss();

  const statement = {
    resourceType: 'CapabilityStatement',
    status: 'active',
    date: new Date().toISOString().slice(0, 10),
    kind: 'instance',
    software: {
      name: FHIR_PRODUCT_NAME,
      version: '1.0.0',
    },
    implementation: {
      description: `${FHIR_PRODUCT_NAME} SMART on FHIR thin host for CRISP Embedded Query Portal`,
      url: iss,
    },
    fhirVersion: '4.0.1',
    format: ['json', 'application/fhir+json'],
    rest: [
      {
        mode: 'server',
        security: {
          extension: [
            {
              url: 'http://fhir-registry.smarthealthit.org/StructureDefinition/oauth-uris',
              extension: [
                {
                  url: 'authorize',
                  valueUri: `${api}/auth/smart/authorize`,
                },
                {
                  url: 'token',
                  valueUri: `${api}/auth/smart/token`,
                },
              ],
            },
          ],
          service: [
            {
              coding: [
                {
                  system: 'http://terminology.hl7.org/CodeSystem/restful-security-service',
                  code: 'SMART-on-FHIR',
                },
              ],
              text: 'OAuth2 using SMART-on-FHIR profile (see http://docs.smarthealthit.org)',
            },
          ],
        },
        resource: [
          {
            type: 'Patient',
            interaction: [{ code: 'read' }],
          },
          {
            type: 'Practitioner',
            interaction: [{ code: 'read' }],
          },
        ],
      },
    ],
  };

  return NextResponse.json(statement, {
    headers: {
      'Content-Type': 'application/fhir+json',
      'Cache-Control': 'public, max-age=300',
    },
  });
}
