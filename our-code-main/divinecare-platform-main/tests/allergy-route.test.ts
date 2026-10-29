import assert from 'node:assert/strict';
import { test } from 'node:test';
import Module, { createRequire } from 'node:module';
import type { Prisma, Role } from '@prisma/client';
import { clientAccessWhere } from '../src/lib/clients/orgScope';

type SampleClient = {
  id: string;
  organizationId: string;
  assignedToId: string | null;
  locationId: string | null;
  locationOrg: string | null;
  assignedToOrg: string | null;
  teamProviderIds: string[];
};

function matches(where: Prisma.ClientWhereInput, client: SampleClient): boolean {
  if (where.id != null && where.id !== client.id) return false;
  if (typeof where.organizationId === 'string' && where.organizationId !== client.organizationId) return false;
  if (typeof where.assignedToId === 'string' && where.assignedToId !== client.assignedToId) return false;
  if (where.locationId === null && client.locationId !== null) return false;
  const location = where.location && typeof where.location === 'object' && 'organizationId' in where.location
    ? where.location.organizationId
    : undefined;
  if (typeof location === 'string' && location !== client.locationOrg) return false;
  const assigneeOrg = where.assignedTo && typeof where.assignedTo === 'object' && 'organizationId' in where.assignedTo
    ? where.assignedTo.organizationId
    : undefined;
  if (typeof assigneeOrg === 'string' && assigneeOrg !== client.assignedToOrg) return false;
  const teamProvider = where.treatmentTeamMembers
    && typeof where.treatmentTeamMembers === 'object'
    && 'some' in where.treatmentTeamMembers
    && where.treatmentTeamMembers.some
    && typeof where.treatmentTeamMembers.some === 'object'
    && 'providerId' in where.treatmentTeamMembers.some
    ? where.treatmentTeamMembers.some.providerId
    : undefined;
  if (typeof teamProvider === 'string' && !client.teamProviderIds.includes(teamProvider)) return false;
  const and = where.AND == null ? [] : Array.isArray(where.AND) ? where.AND : [where.AND];
  if (!and.every((clause) => matches(clause, client))) return false;
  const or = where.OR == null ? null : Array.isArray(where.OR) ? where.OR : [where.OR];
  if (or && !or.some((clause) => matches(clause, client))) return false;
  return true;
}

test('allergy writes fail closed for caseload users and stay organization-scoped for medical roles', async () => {
  const gate = { ok: true as const, userId: 'doc-1', organizationId: 'org-1', role: 'THERAPIST' as Role, status: 401 };
  let patient: { id: string; bhClientId: string | null } | null = { id: 'mp-1', bhClientId: null };
  let sample: SampleClient = {
    id: 'client-1',
    organizationId: 'org-1',
    assignedToId: 'doc-1',
    locationId: null,
    locationOrg: null,
    assignedToOrg: 'org-1',
    teamProviderIds: [],
  };
  let creates = 0;
  let clientReads = 0;

  const prisma = {
    medicalPatient: {
      findFirst: async ({ where }: Prisma.MedicalPatientFindFirstArgs) => {
        if (!patient || where.organizationId !== gate.organizationId) return null;
        const ors = Array.isArray(where.OR) ? where.OR : [];
        const requested = ors.some((entry) => entry.id === patient?.id || entry.bhClientId === patient?.id || entry.mrn === patient?.id);
        return requested ? patient : null;
      },
    },
    client: {
      findFirst: async ({ where }: Prisma.ClientFindFirstArgs) => {
        clientReads += 1;
        assert.deepEqual(where, {
          id: where.id,
          AND: [clientAccessWhere({
            organizationId: gate.organizationId,
            actorUserId: gate.userId,
            actorRole: gate.role,
          })],
        });
        return where && matches(where, sample) ? { id: sample.id } : null;
      },
    },
    medicalAllergy: {
      create: async () => {
        creates += 1;
        return { id: 'allergy-1', allergen: 'penicillin', rxnormId: '7980' };
      },
    },
    $executeRawUnsafe: async () => 0,
    $executeRaw: async () => 0,
  };

  const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
  const originalLoad = loader._load;
  loader._load = function (id, ...args) {
    if (id === 'server-only') return {};
    if (id === '@/lib/db/prisma') return { prisma };
    if (id === '@/lib/auth/tenant') return { requireOrgContext: async () => gate };
    return originalLoad.call(this, id, ...args);
  };
  const require = createRequire(import.meta.url);
  let post: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
  try {
    post = (require('../src/app/api/medical/patients/[id]/allergies/route') as { POST: typeof post }).POST;
  } finally {
    loader._load = originalLoad;
  }

  const send = (id: string) => post(
    new Request('http://localhost:3000/api/medical/patients/mp-1/allergies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ substance: 'penicillin', reaction: 'rash' }),
    }),
    { params: Promise.resolve({ id }) },
  );

  patient = { id: 'mp-1', bhClientId: null };
  creates = 0;
  clientReads = 0;
  const unlinked = await send('mp-1');
  assert.equal(unlinked.status, 404);
  assert.equal(creates, 0);
  assert.equal(clientReads, 0);

  patient = { id: 'mp-1', bhClientId: 'client-1' };
  sample = { ...sample, organizationId: 'org-1', assignedToId: 'someone-else', teamProviderIds: [] };
  creates = 0;
  clientReads = 0;
  const unrelated = await send('mp-1');
  assert.equal(unrelated.status, 404);
  assert.equal(creates, 0);
  assert.equal(clientReads, 1);

  sample = { ...sample, organizationId: 'org-2', assignedToId: 'doc-1', assignedToOrg: 'org-2', teamProviderIds: ['doc-1'] };
  creates = 0;
  clientReads = 0;
  const crossTenant = await send('mp-1');
  assert.equal(crossTenant.status, 404);
  assert.equal(creates, 0);
  assert.equal(clientReads, 1);

  sample = { ...sample, organizationId: 'org-1', assignedToId: 'doc-1', assignedToOrg: 'org-1', teamProviderIds: [] };
  creates = 0;
  const assigned = await send('mp-1');
  assert.equal(assigned.status, 200);
  assert.equal(creates, 1);

  sample = { ...sample, assignedToId: 'someone-else', teamProviderIds: ['doc-1'] };
  creates = 0;
  const team = await send('mp-1');
  assert.equal(team.status, 200);
  assert.equal(creates, 1);

  gate.role = 'PHYSICIAN';
  patient = { id: 'mp-1', bhClientId: null };
  creates = 0;
  clientReads = 0;
  const medical = await send('mp-1');
  assert.equal(medical.status, 200);
  assert.equal(creates, 1);
  assert.equal(clientReads, 0);
});
