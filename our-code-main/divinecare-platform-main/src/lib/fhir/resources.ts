import type { Client } from '@prisma/client';

export function operationOutcome(
  severity: 'error' | 'warning' | 'information',
  code: string,
  diagnostics: string
) {
  return {
    resourceType: 'OperationOutcome' as const,
    issue: [
      {
        severity,
        code,
        diagnostics,
      },
    ],
  };
}

export function demoPatientResource(id = 'demo-patient-001') {
  return {
    resourceType: 'Patient' as const,
    id,
    identifier: [
      {
        system: 'urn:altrixs:client',
        value: id,
      },
      {
        system: 'urn:altrixs:mrn',
        value: 'MRN-DEMO-001',
      },
    ],
    name: [
      {
        use: 'official',
        family: 'Wilson',
        given: ['James'],
      },
    ],
    gender: 'male',
    birthDate: '1985-03-14',
    telecom: [{ system: 'phone', value: '410-555-0142' }],
    address: [
      {
        use: 'home',
        line: ['100 Pratt St'],
        city: 'Baltimore',
        state: 'MD',
        postalCode: '21201',
        country: 'US',
      },
    ],
  };
}

export function demoPractitionerResource(id = 'demo-practitioner-001') {
  return {
    resourceType: 'Practitioner' as const,
    id,
    identifier: [
      {
        system: 'http://hl7.org/fhir/sid/us-npi',
        value: '1234567890',
      },
    ],
    name: [
      {
        use: 'official',
        family: 'Smith',
        given: ['Sarah'],
        prefix: ['Dr'],
        text: 'Dr. Sarah Smith',
      },
    ],
    qualification: [
      {
        code: {
          text: 'LCSW',
        },
      },
    ],
  };
}

function mapGender(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const g = raw.trim().toLowerCase();
  if (g === 'm' || g === 'male') return 'male';
  if (g === 'f' || g === 'female') return 'female';
  if (g === 'other') return 'other';
  if (g === 'unknown') return 'unknown';
  return 'unknown';
}

export function clientToPatientResource(client: Client) {
  const parts = client.name.trim().split(/\s+/);
  const given = parts.length > 1 ? parts.slice(0, -1) : parts;
  const family = parts.length > 1 ? parts[parts.length - 1]! : parts[0] || 'Unknown';

  return {
    resourceType: 'Patient' as const,
    id: client.id,
    identifier: [
      {
        system: 'urn:altrixs:client',
        value: client.id,
      },
      ...(client.mrn
        ? [
            {
              system: 'urn:altrixs:mrn',
              value: client.mrn,
              type: { text: 'MRN' },
            },
          ]
        : []),
      ...(client.insuranceMemberId
        ? [
            {
              system: 'urn:altrixs:insurance-member-id',
              value: client.insuranceMemberId,
              type: { text: 'Insurance Member ID' },
            },
          ]
        : []),
    ],
    name: [
      {
        use: 'official' as const,
        family,
        given: given.length ? given : [family],
        text: client.name,
      },
    ],
    gender: mapGender(client.gender),
    birthDate: client.dateOfBirth
      ? client.dateOfBirth.toISOString().slice(0, 10)
      : undefined,
    telecom: client.phone
      ? [{ system: 'phone' as const, value: client.phone }]
      : undefined,
    address: [
      {
        use: 'home' as const,
        line: [client.addressLine1, client.addressLine2].filter(Boolean) as string[],
        city: client.city || undefined,
        state: client.state || 'MD',
        postalCode: client.postalCode || undefined,
        country: 'US',
      },
    ],
  };
}

export function practitionerFromToken(id: string, npi?: string) {
  return {
    resourceType: 'Practitioner' as const,
    id,
    identifier: [
      {
        system: 'http://hl7.org/fhir/sid/us-npi',
        value: npi || '0000000000',
      },
    ],
    name: [
      {
        use: 'official' as const,
        text: `Practitioner ${id}`,
      },
    ],
  };
}
