import { prisma } from '@/lib/db/prisma';
import { normalizeNpi } from './facility';
import { isPlaceholderAddress, isPlaceholderNpi } from '@/lib/practice/placeholders';
import { loadOrgCatalog } from './catalogDb';
import { findTestByKey } from './catalog';
import { buildRequisitionHtml, type RequisitionContext } from './requisition';
import type { LabOrderDto } from './manage';

const joinAddr = (p: { addressLine1?: string | null; addressLine2?: string | null; city?: string | null; state?: string | null; postalCode?: string | null }) => {
  const street = [p.addressLine1, p.addressLine2].filter((x) => x?.trim()).join(', ');
  const cityLine = [p.city, [p.state, p.postalCode].filter(Boolean).join(' ')].filter((x) => x?.trim()).join(', ');
  return [street, cityLine].filter(Boolean).join(', ') || null;
};

/** Requisition HTML for an order the caller already scoped (org + caseload + Part 2) */
export async function requisitionHtmlFor(order: LabOrderDto): Promise<string> {
  const [client, settings, catalog] = await Promise.all([
    prisma.client.findUnique({
      where: { id: order.clientId },
      select: {
        mrn: true, dateOfBirth: true, gender: true, phone: true,
        addressLine1: true, addressLine2: true, city: true, state: true, postalCode: true,
        insurancePayer: true, insuranceMemberId: true, insuranceGroupNumber: true, insuranceType: true,
        location: { select: { name: true, addressLine1: true, addressLine2: true, city: true, state: true, postalCode: true, phone: true, fax: true, npi: true } },
      },
    }),
    prisma.practiceSettings
      .findUnique({
        where: { organizationId: order.organizationId },
        select: { legalName: true, dbaName: true, organizationNpi: true, mainPhone: true, mainFax: true },
      })
      .catch(() => null),
    loadOrgCatalog(order.organizationId),
  ]);
  const loc = client?.location ?? null;
  const locAddress = loc && !isPlaceholderAddress(loc.addressLine1, loc.postalCode) ? joinAddr(loc) : null;
  const practiceNpi = normalizeNpi(settings?.organizationNpi) ?? (loc?.npi && !isPlaceholderNpi(loc.npi) ? normalizeNpi(loc.npi) : null);

  const testDetails: RequisitionContext['testDetails'] = {};
  for (const l of order.testLines) {
    if (!l.key) continue;
    const t = findTestByKey(l.key, catalog);
    if (t) testDetails[l.key] = { specimenType: t.specimenType, container: t.container, specialHandling: t.specialHandling };
  }

  return buildRequisitionHtml({
    order,
    patient: {
      mrn: client?.mrn ?? null,
      dateOfBirth: client?.dateOfBirth ? client.dateOfBirth.toISOString().slice(0, 10) : null,
      sex: client?.gender ?? null,
      phone: client?.phone ?? null,
      address: client ? joinAddr(client) : null,
      insurancePayer: client?.insurancePayer ?? null,
      insuranceMemberId: client?.insuranceMemberId ?? null,
      insuranceGroupNumber: client?.insuranceGroupNumber ?? null,
      insuranceType: client?.insuranceType ?? null,
    },
    practice: {
      name: settings?.legalName || settings?.dbaName || order.facilityName || '',
      organizationNpi: practiceNpi,
      phone: loc?.phone || settings?.mainPhone || null,
      fax: loc?.fax || settings?.mainFax || null,
      address: locAddress,
    },
    testDetails,
  });
}
