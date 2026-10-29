import type { Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import { canPrescribe } from '@/types/roles';
import { DrFirstError } from '@/lib/drfirst/errors';
import { mapPatient } from '@/lib/drfirst/mapping';
import { RcopiaStagingClient } from '@/lib/drfirst/rcopia/client';

type Actor = { organizationId: string; userId: string; role: Role };

function tag(raw: string, name: string) {
  return (raw.match(new RegExp(`<${name}>([^<]*)</${name}>`)) || [])[1] || '';
}

function vendorClient() {
  const engineUrl = process.env.DRFIRST_ENGINE_URL?.trim();
  const updateUrl = process.env.DRFIRST_UPDATE_URL?.trim();
  const vendorUsername = process.env.DRFIRST_VENDOR_USERNAME?.trim();
  const vendorPassword = process.env.DRFIRST_VENDOR_PASSWORD?.trim();
  const practiceUsername = (process.env.DRFIRST_PRACTICE_USERNAME || process.env.DRFIRST_PRACTICE_USER_NAME || '').trim();
  const practiceName = process.env.DRFIRST_PRACTICE_NAME?.trim() || practiceUsername;
  const systemName = process.env.DRFIRST_PORTAL_SYSTEM_NAME?.trim();
  if (!engineUrl || !updateUrl || !vendorUsername || !vendorPassword || !practiceUsername || !systemName) return null;
  return {
    updateUrl,
    client: new RcopiaStagingClient(engineUrl, {
      apiVersion: '2.54',
      vendorUsername,
      vendorPassword,
      application: 'Altrixs',
      applicationVersion: '1.0.0',
      practiceName,
      practiceUsername,
      systemName,
      practiceId: process.env.DRFIRST_PRACTICE_ID?.trim() || undefined,
    }, async () => {}),
  };
}

export async function linkPatientOnPurpose(actor: Actor, clientId: string) {
  if (!canPrescribe(actor.role)) return { ok: false as const, status: 403 as const, error: 'Forbidden' };
  const client = await prisma.client.findFirst({
    where: {
      id: clientId,
      AND: [clientAccessWhere({ organizationId: actor.organizationId, actorUserId: actor.userId, actorRole: actor.role })],
    },
    include: {
      medications: { where: { active: true }, take: 40 },
      medicalAllergies: { take: 40 },
      medicalProblems: { take: 40 },
    },
  });
  if (!client) return { ok: false as const, status: 403 as const, error: 'Forbidden' };
  const imported = Boolean(client.importedAt || client.sourcePlatform);
  const dob = client.dateOfBirth ? client.dateOfBirth.toISOString().slice(0, 10) : '';
  if (!dob || !client.postalCode) {
    return { ok: false as const, status: 400 as const, error: 'Date of birth and ZIP are required before linking this chart.' };
  }
  const vendor = vendorClient();
  if (!vendor) {
    return {
      ok: false as const,
      status: 503 as const,
      error: 'The prescribing vendor is not configured. This chart was not uploaded.',
    };
  }
  const externalId = client.rcopiaPatientId || client.id;
  let patient;
  try {
    patient = mapPatient(client, actor.organizationId);
  } catch (error) {
    const detail = error instanceof DrFirstError ? error.detail || error.message : 'Date of birth and ZIP are required before linking this chart.';
    return { ok: false as const, status: 400 as const, error: detail };
  }
  try {
    await vendor.client.uploadPatient(patient, externalId);
  } catch (error) {
    const detail = error instanceof DrFirstError
      ? error.detail || error.message
      : 'The prescribing vendor did not accept the patient link.';
    return { ok: false as const, status: error instanceof DrFirstError ? error.status : 502, error: detail };
  }

  let medicationXml = '';
  let allergyXml = '';
  try {
    medicationXml = await vendor.client.downloadHistory(
      vendor.updateUrl,
      `<Command>update_medication</Command><PatientList><Patient><ExternalID>${externalId}</ExternalID></Patient></PatientList>`,
    );
    allergyXml = await vendor.client.downloadHistory(
      vendor.updateUrl,
      `<Command>update_allergy</Command><Patient><ExternalID>${externalId}</ExternalID></Patient>`,
    );
  } catch {
    medicationXml = '';
    allergyXml = '';
  }
  const history: Array<{ kind: 'medication' | 'allergy'; name: string; code: string | null }> = [];

  for (const block of allergyXml.match(/<Allergy>[\s\S]*?<\/Allergy>/g) || []) {
    const name = tag(block, 'AllergenName') || tag(block, 'Name');
    const code = tag(block, 'RxnormID') || tag(block, 'NDCID') || null;
    const deleted = /<Deleted>\s*y\s*<\/Deleted>/i.test(block);
    if (!name || !code || deleted) continue;
    history.push({ kind: 'allergy', name, code });
    const existing = await prisma.medicalAllergy.findFirst({
      where: { clientId: client.id, allergen: name },
      select: { id: true },
    });
    if (!existing) {
      await prisma.medicalAllergy.create({
        data: {
          patientId: client.id,
          clientId: client.id,
          allergen: name,
          reaction: tag(block, 'Reaction') || null,
          severity: tag(block, 'Severity') || 'Moderate',
        },
      });
    }
  }

  for (const block of medicationXml.match(/<Medication>[\s\S]*?<\/Medication>/g) || []) {
    const name = tag(block, 'BrandName') || tag(block, 'GenericName') || tag(block, 'DrugDescription');
    const code = tag(block, 'RxnormID') || tag(block, 'NDCID') || null;
    if (!name || !code) continue;
    history.push({ kind: 'medication', name, code });
    const existing = await prisma.clientMedication.findFirst({
      where: { clientId: client.id, medicationName: name },
      select: { id: true },
    });
    if (!existing) {
      await prisma.clientMedication.create({
        data: {
          clientId: client.id,
          medicationName: name,
          dosage: tag(block, 'Strength') || 'As recorded by the vendor',
          rxnormId: tag(block, 'RxnormID') || null,
          ndcCode: tag(block, 'NDCID') || null,
          source: 'vendor',
          active: true,
        },
      });
    }
  }

  await prisma.client.update({
    where: { id: client.id },
    data: { rcopiaPatientId: externalId },
  });

  return {
    ok: true as const,
    imported,
    registered: true,
    vendorDemo: false,
    history,
  };
}
