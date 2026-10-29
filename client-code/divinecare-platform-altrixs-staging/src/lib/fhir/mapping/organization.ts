import { SYSTEMS, isValidNpi, ref, safeId, splitName, text, type FhirResource } from './common';
import { finalize, type MapContext } from './meta';
import type { LocationRow, OrgRow, UserRow } from './types';

export function mapOrganization(org: OrgRow, ctx: MapContext): FhirResource {
  return finalize(
    {
      resourceType: 'Organization',
      id: safeId(org.id),
      identifier: [{ system: SYSTEMS.organization, value: org.id }],
      active: org.active,
      type: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/organization-type', code: 'prov', display: 'Healthcare Provider' }] }],
      name: org.name,
    },
    ctx
  );
}

export function mapLocation(loc: LocationRow, ctx: MapContext): FhirResource {
  const line = [text(loc.addressLine1), text(loc.addressLine2)].filter(Boolean) as string[];
  const hasAddress = line.length || loc.city || loc.state || loc.postalCode;
  return finalize(
    {
      resourceType: 'Location',
      id: safeId(loc.id),
      identifier: loc.code ? [{ system: `urn:altrixs:organization:${ctx.organizationId}:location-code`, value: loc.code }] : undefined,
      status: loc.active ? 'active' : 'inactive',
      name: loc.name,
      mode: 'instance',
      telecom: loc.phone ? [{ system: 'phone', value: loc.phone.trim() }] : undefined,
      address: hasAddress
        ? { use: 'work', line, city: text(loc.city), state: text(loc.state), postalCode: text(loc.postalCode) }
        : undefined,
      physicalType: { coding: [{ system: SYSTEMS.locationPhysicalType, code: 'bu', display: 'Building' }] },
      managingOrganization: ref('Organization', ctx.organizationId),
    },
    ctx
  );
}

/** Staff user -> Practitioner. NPI identifier only when the NPI passes the Luhn check. */
export function mapPractitioner(user: UserRow, ctx: MapContext): FhirResource {
  const identifier: unknown[] = [{ system: SYSTEMS.user, value: user.id }];
  if (isValidNpi(user.npi)) identifier.push({ system: SYSTEMS.npi, value: user.npi!.trim() });
  const name = splitName(user.name);
  return finalize(
    {
      resourceType: 'Practitioner',
      id: safeId(user.id),
      identifier,
      active: user.status === 'ACTIVE',
      name: name.text ? [{ use: 'official', ...name }] : undefined,
      telecom: [{ system: 'email', value: user.email, use: 'work' }],
      qualification: user.licenseNumber
        ? [{ identifier: [{ value: user.licenseNumber.trim() }], code: { text: 'License' } }]
        : undefined,
    },
    ctx
  );
}
