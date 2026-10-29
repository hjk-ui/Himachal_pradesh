import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { BUILTIN_LAB_TESTS, mergeCatalog, type LabTestDef, type OrgLabTestRow } from './catalog';
import type { LabCatalogImportPlan } from './catalogImport';

const ROW_SELECT = {
  key: true,
  name: true,
  aliases: true,
  isPanel: true,
  components: true,
  loinc: true,
  cpt: true,
  specimenType: true,
  container: true,
  fastingRequired: true,
  specialHandling: true,
  category: true,
  orderType: true,
  active: true,
  source: true,
  sourceNames: true,
} as const;

/** The org's LabTest rows; [] when the 20261018_lab_catalog migration has not run yet */
export async function loadOrgLabTestRows(organizationId: string): Promise<OrgLabTestRow[]> {
  try {
    return await prisma.labTest.findMany({ where: { organizationId }, select: ROW_SELECT, orderBy: { name: 'asc' } });
  } catch (err) {
    console.error('[labs/catalog] lab_tests unavailable; using the built-in catalog', err);
    return [];
  }
}

/** Built-in catalog merged with the org's imported / edited tests */
export async function loadOrgCatalog(organizationId: string): Promise<LabTestDef[]> {
  return mergeCatalog(BUILTIN_LAB_TESTS, await loadOrgLabTestRows(organizationId));
}

/** Writes a planned Valant import (create + update) in one transaction */
export async function applyLabCatalogImport(
  organizationId: string,
  plan: LabCatalogImportPlan,
  tx: Prisma.TransactionClient
): Promise<{ created: number; updated: number }> {
  const now = new Date();
  for (const c of plan.create) {
    const { valantNames: _names, ...data } = c;
    void _names;
    await tx.labTest.upsert({
      where: { organizationId_key: { organizationId, key: c.key } },
      create: { ...data, organizationId, importedAt: now },
      update: {},
    });
  }
  for (const u of plan.update) {
    await tx.labTest.update({
      where: { organizationId_key: { organizationId, key: u.key } },
      data: {
        aliases: u.data.aliases,
        sourceNames: u.data.sourceNames,
        active: u.data.active,
        loinc: u.data.loinc,
        cpt: u.data.cpt,
        importedAt: now,
      },
    });
  }
  return { created: plan.create.length, updated: plan.update.length };
}
