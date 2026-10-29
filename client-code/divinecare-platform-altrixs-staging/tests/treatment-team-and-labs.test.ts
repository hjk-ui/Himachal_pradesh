import test from 'node:test';
import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';

// In-Memory Data Store for Hermetic, Lightning-Fast Verification
interface Member {
  id: string;
  clientId: string;
  providerId: string;
  name: string;
  role: string;
  credentials: string | null;
  isPrimary: boolean;
  avatarColor: string;
  initials: string;
  assignedBy: string | null;
  createdAt: Date;
}

interface ClientRec {
  id: string;
  name: string;
  mrn: string;
  status: string;
  treatmentTeam: any[];
}

interface LabOrderRec {
  id: string;
  organizationId: string;
  clientId: string;
  clientName: string;
  lab: string;
  priority: string;
  specimen: string;
  panels: string[];
  otherPanel: string | null;
  icd10Codes: string[];
  clinicalNotes: string | null;
  status: string;
  orderedById: string | null;
  orderedByName: string;
  orderedAt: Date;
  collectedAt: Date | null;
  isElectronicallySigned: boolean;
  signedAt: Date;
  signerName: string;
  signerNpi: string;
  facilityName: string;
  facilityClia: string | null;
  signatureHash: string;
}

const staffUsers: { id: string; name: string; email: string; npi: string | null }[] = [];

let members: Member[] = [];
const clients: ClientRec[] = [];
const labOrders: LabOrderRec[] = [];
let idCounter = 1;

const mockPrisma = {
  client: {
    create: async ({ data }: any) => {
      const rec: ClientRec = {
        id: data.id || `cl-${idCounter++}`,
        name: data.name,
        mrn: data.mrn,
        status: data.status || 'Active',
        treatmentTeam: data.treatmentTeam || [],
      };
      clients.push(rec);
      return rec;
    },
    findUnique: async ({ where }: any) => {
      return clients.find((c) => c.id === where.id) || null;
    },
    // lib/labs/manage createOrder: org-scope + caseload lookups (scope filters ignored in-memory)
    findFirst: async ({ where }: any) => {
      const c = clients.find((x) => x.id === where.id);
      return c ? { id: c.id, name: c.name } : null;
    },
    update: async ({ where, data }: any) => {
      const client = clients.find((c) => c.id === where.id);
      if (client && data.treatmentTeam) {
        client.treatmentTeam = data.treatmentTeam;
      }
      return client;
    },
    delete: async ({ where }: any) => {
      const idx = clients.findIndex((c) => c.id === where.id);
      if (idx !== -1) return clients.splice(idx, 1)[0];
      return null;
    },
  },
  clientTreatmentTeamMember: {
    create: async ({ data }: any) => {
      const member: Member = {
        id: `ttm-${idCounter++}`,
        clientId: data.clientId,
        providerId: data.providerId,
        name: data.name,
        role: data.role,
        credentials: data.credentials ?? null,
        isPrimary: Boolean(data.isPrimary),
        avatarColor: data.avatarColor || '#5C2D91',
        initials: data.initials || 'MD',
        assignedBy: data.assignedBy ?? null,
        createdAt: new Date(),
      };
      members.push(member);
      return member;
    },
    findFirst: async ({ where }: any) => {
      return (
        members.find((m) => {
          if (m.clientId !== where.clientId) return false;
          if (where.OR) {
            return where.OR.some(
              (cond: any) =>
                (cond.providerId && m.providerId === cond.providerId) ||
                (cond.id && m.id === cond.id) ||
                (cond.name && m.name === cond.name)
            );
          }
          if (where.isPrimary !== undefined) {
            return m.isPrimary === where.isPrimary;
          }
          return true;
        }) || null
      );
    },
    findMany: async ({ where, orderBy }: any) => {
      const filtered = members.filter((m) => m.clientId === where.clientId);
      if (orderBy) {
        filtered.sort((a, b) => {
          if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
          return a.createdAt.getTime() - b.createdAt.getTime();
        });
      }
      return filtered;
    },
    updateMany: async ({ where, data }: any) => {
      let count = 0;
      members.forEach((m) => {
        if (
          m.clientId === where.clientId &&
          (where.isPrimary === undefined || m.isPrimary === where.isPrimary)
        ) {
          if (data.isPrimary !== undefined) m.isPrimary = data.isPrimary;
          count++;
        }
      });
      return { count };
    },
    delete: async ({ where }: any) => {
      const idx = members.findIndex((m) => m.id === where.id);
      if (idx !== -1) return members.splice(idx, 1)[0];
      return null;
    },
    deleteMany: async ({ where }: any) => {
      const initialCount = members.length;
      members = members.filter((m) => m.clientId !== where.clientId);
      return { count: initialCount - members.length };
    },
  },
  user: {
    findUnique: async ({ where }: any) => staffUsers.find((u) => u.id === where.id) || null,
  },
  organization: {
    findFirst: async () => ({ id: 'org-test-1', name: 'Divine Counseling LLC' }),
    findUnique: async () => ({ name: 'Divine Counseling LLC' }),
    create: async ({ data }: any) => ({ id: 'org-test-1', ...data }),
  },
  labOrder: {
    create: async ({ data }: any) => {
      const order: LabOrderRec = {
        id: `lab-${idCounter++}`,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      } as LabOrderRec;
      labOrders.push(order);
      const client = clients.find((c) => c.id === data.clientId) || null;
      return { ...order, client, results: [] };
    },
    delete: async ({ where }: any) => {
      const idx = labOrders.findIndex((o) => o.id === where.id);
      if (idx !== -1) return labOrders.splice(idx, 1)[0];
      return null;
    },
  },
};

// Module loader interception for hermetic execution
const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
const original = loader._load;
loader._load = function (id, ...args) {
  if (id === '@/lib/db/prisma' || id.endsWith('/db/prisma')) {
    return { prisma: mockPrisma };
  }
  return original.call(this, id, ...args);
};

const require = createRequire(import.meta.url);
let treatmentTeamService: typeof import('../src/services/treatmentTeamService');
let labOrderService: typeof import('../src/services/labOrderService');
let labsManage: typeof import('../src/lib/labs/manage');

try {
  treatmentTeamService = require('../src/services/treatmentTeamService');
  labOrderService = require('../src/services/labOrderService');
  labsManage = require('../src/lib/labs/manage');
} finally {
  loader._load = original;
}

const { addTeamMember, removeTeamMember, getClientTreatmentTeam } = treatmentTeamService;
const { createSignedLabOrder, generateRequisitionHTML } = labOrderService;

// ===========================================================================
// Automated Verification Suite (Commits 7fba6e5 & 819d6b2)
// ===========================================================================

test('Treatment Team: Adds provider to care team and persists in database', async () => {
  const testClient = await mockPrisma.client.create({
    data: {
      name: 'Test Client Care Team',
      mrn: `MRN-TT-${Date.now()}`,
      status: 'Active',
    },
  });

  const member = await addTeamMember({
    clientId: testClient.id,
    providerId: 'prov-test-1',
    name: 'Dr. Sarah Jenkins, MD',
    role: 'Psychiatrist',
    credentials: 'MD',
    isPrimary: true,
  });

  assert.equal(member.name, 'Dr. Sarah Jenkins, MD');
  assert.equal(member.isPrimary, true);
  assert.equal(member.initials, 'SJ');

  const team = await getClientTreatmentTeam(testClient.id);
  assert.equal(team.length, 1);
  assert.equal(team[0].providerId, 'prov-test-1');
  assert.equal(team[0].isPrimary, true);

  // Clean up
  await mockPrisma.clientTreatmentTeamMember.deleteMany({ where: { clientId: testClient.id } });
  await mockPrisma.client.delete({ where: { id: testClient.id } });
});

test('Treatment Team: Demotes previous primary when a new primary is assigned', async () => {
  const testClient = await mockPrisma.client.create({
    data: {
      name: 'Test Client Primary Shift',
      mrn: `MRN-TT2-${Date.now()}`,
      status: 'Active',
    },
  });

  // Add primary 1
  await addTeamMember({
    clientId: testClient.id,
    providerId: 'prov-primary-1',
    name: 'Dr. Sarah Jenkins, MD',
    role: 'Psychiatrist',
    isPrimary: true,
  });

  // Add primary 2 (should demote primary 1)
  await addTeamMember({
    clientId: testClient.id,
    providerId: 'prov-primary-2',
    name: 'Jennifer Walsh, LCSW-C',
    role: 'Therapist',
    isPrimary: true,
  });

  const team = await getClientTreatmentTeam(testClient.id);
  assert.equal(team.length, 2);

  const primaryMembers = team.filter((m) => m.isPrimary);
  assert.equal(primaryMembers.length, 1, 'Exactly one primary provider allowed');
  assert.equal(primaryMembers[0].providerId, 'prov-primary-2');

  const demotedMember = team.find((m) => m.providerId === 'prov-primary-1');
  assert.equal(demotedMember?.isPrimary, false);

  // Clean up
  await mockPrisma.clientTreatmentTeamMember.deleteMany({ where: { clientId: testClient.id } });
  await mockPrisma.client.delete({ where: { id: testClient.id } });
});

test('Treatment Team: Blocks assigning duplicate provider to same client', async () => {
  const testClient = await mockPrisma.client.create({
    data: {
      name: 'Test Client Duplicates',
      mrn: `MRN-TT3-${Date.now()}`,
      status: 'Active',
    },
  });

  await addTeamMember({
    clientId: testClient.id,
    providerId: 'prov-dup-1',
    name: 'Marcus Vance, MSW',
    role: 'Case Manager',
    isPrimary: false,
  });

  await assert.rejects(
    async () => {
      await addTeamMember({
        clientId: testClient.id,
        providerId: 'prov-dup-1',
        name: 'Marcus Vance, MSW',
        role: 'Case Manager',
        isPrimary: false,
      });
    },
    {
      message: "Provider is already a member of this client's treatment team.",
    }
  );

  // Clean up
  await mockPrisma.clientTreatmentTeamMember.deleteMany({ where: { clientId: testClient.id } });
  await mockPrisma.client.delete({ where: { id: testClient.id } });
});

test('Treatment Team: Prevents removing Primary provider without prior replacement', async () => {
  const testClient = await mockPrisma.client.create({
    data: {
      name: 'Test Client Primary Delete Guard',
      mrn: `MRN-TT4-${Date.now()}`,
      status: 'Active',
    },
  });

  await addTeamMember({
    clientId: testClient.id,
    providerId: 'prov-primary-del',
    name: 'Dr. Sarah Jenkins, MD',
    role: 'Psychiatrist',
    isPrimary: true,
  });

  await assert.rejects(
    async () => {
      await removeTeamMember({
        clientId: testClient.id,
        providerId: 'prov-primary-del',
      });
    },
    {
      message: 'Cannot remove the Primary provider. Designate another team member as Primary first.',
    }
  );

  // Clean up
  await mockPrisma.clientTreatmentTeamMember.deleteMany({ where: { clientId: testClient.id } });
  await mockPrisma.client.delete({ where: { id: testClient.id } });
});

test('Lab Requisition: Creates order with valid SHA-256 digital signature hash', async () => {
  const org = await mockPrisma.organization.findFirst();

  const testClient = await mockPrisma.client.create({
    data: {
      name: 'Test Lab Patient',
      mrn: `MRN-LAB-${Date.now()}`,
      status: 'Active',
    },
  });

  const order = await createSignedLabOrder({
    organizationId: org.id,
    clientId: testClient.id,
    targetLab: 'QUEST',
    specimenType: 'Venous Blood',
    priority: 'Routine',
    testPanels: ['Comprehensive Metabolic Panel (CMP)', 'Lithium Level'],
    icd10Codes: ['F31.1', 'E03.9'],
    orderedByName: 'Dr. James Park, MD',
    signerNpi: '1982736450',
    facilityClia: '21D2098412',
  });

  assert.equal(order.isElectronicallySigned, true);
  assert.equal(order.signerName, 'Dr. James Park, MD');
  assert.equal(order.facilityClia, '21D2098412');
  assert.ok(order.signatureHash);
  assert.equal(order.signatureHash.length, 64, 'SHA-256 hex string must be 64 characters');

  // Clean up
  await mockPrisma.labOrder.delete({ where: { id: order.id } });
  await mockPrisma.client.delete({ where: { id: testClient.id } });
});

test('Lab Requisition: HTML template contains .esig-block with Georgia serif font and green badge', () => {
  const html = generateRequisitionHTML({
    id: 'REQ-2026-0042',
    clientName: 'Elena Rostova',
    clientId: 'CL-9402',
    lab: 'QUEST',
    priority: 'Urgent',
    specimen: 'Venous Blood',
    panels: ['Comprehensive Metabolic Panel (CMP)'],
    icd10Codes: ['F33.1'],
    orderedByName: 'Dr. Sarah Jenkins, MD',
    orderedAt: new Date('2026-10-06T10:30:00Z'),
    signerNpi: '1892837492',
    facilityName: 'Divine Counseling LLC',
    facilityClia: '21D2098412',
    signatureHash: 'a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4e5f67890',
  });

  assert.ok(html.includes('esig-block'));
  assert.ok(html.includes("Georgia, 'Times New Roman', serif"));
  assert.ok(html.includes('✓ E-Signed'));
  assert.ok(html.includes('No wet signature required'));
  assert.ok(html.includes('21D2098412'));
  assert.ok(html.includes('Dr. Sarah Jenkins, MD'));
  assert.ok(html.includes('a1b2c3d4e5f67890'));
});

test('Lab Requisition: Rejects order creation without valid NPI or ordering provider', async () => {
  const org = await mockPrisma.organization.findFirst();
  const testClient = await mockPrisma.client.create({
    data: {
      name: 'Test Lab Patient Validation',
      mrn: `MRN-VAL-${Date.now()}`,
      status: 'Active',
    },
  });

  // Missing NPI
  await assert.rejects(
    async () => {
      await createSignedLabOrder({
        organizationId: org.id,
        clientId: testClient.id,
        testPanels: ['Lipid Panel'],
        icd10Codes: ['E78.5'],
        signerNpi: '',
      });
    },
    {
      message: 'Valid ordering provider NPI is required for electronic signature.',
    }
  );

  // Missing Clinician Name
  await assert.rejects(
    async () => {
      await createSignedLabOrder({
        organizationId: org.id,
        clientId: testClient.id,
        testPanels: ['Lipid Panel'],
        icd10Codes: ['E78.5'],
        signerNpi: '1234567890',
        orderedByName: '   ',
      });
    },
    {
      message: 'Ordering clinician name is required for electronic signature.',
    }
  );

  // Clean up
  await mockPrisma.client.delete({ where: { id: testClient.id } });
});

test('Lab Requisition: no fabricated NPI, CLIA, ICD-10 codes or specimen when values are missing', () => {
  const html = generateRequisitionHTML({
    id: 'REQ-2026-0099',
    clientName: 'Test Patient <b>',
    clientId: 'CL-1',
    lab: 'QUEST',
    priority: 'Routine',
    panels: ['Lipid Panel'],
    icd10Codes: [],
    orderedAt: new Date('2026-10-06T10:30:00Z'),
  });
  for (const fabricated of ['1892837492', '21D2098412', 'F33.1', 'F41.1', 'Venous Blood', 'e3b0c44298fc1c14', 'CAP Accredited']) {
    assert.ok(!html.includes(fabricated), `requisition must not contain ${fabricated}`);
  }
  assert.ok(!html.includes('CLIA:'), 'CLIA omitted when not configured');
  assert.ok(html.includes('Not recorded'));
  assert.ok(html.includes('Test Patient &lt;b&gt;'), 'patient fields are HTML-escaped');
});

test('Lab Order: rejects an NPI that is not 10 digits', async () => {
  await assert.rejects(
    () =>
      createSignedLabOrder({
        organizationId: 'org-test-1',
        clientId: 'cl-none',
        testPanels: ['Lipid Panel'],
        icd10Codes: [],
        orderedByName: 'Dr. Test',
        signerNpi: '12345',
      }),
    { message: 'Valid ordering provider NPI is required for electronic signature.' }
  );
});

test('Lab Order (manage.createOrder): uses the orderer NPI, 409 when missing, CLIA only from LAB_FACILITY_CLIA', async () => {
  const prevClia = process.env.LAB_FACILITY_CLIA;
  delete process.env.LAB_FACILITY_CLIA;
  const testClient = await mockPrisma.client.create({ data: { name: 'Manage Lab Patient', mrn: 'MRN-M-1' } });
  staffUsers.push(
    { id: 'u-no-npi', name: 'Dr. No Npi', email: 'a@x.test', npi: null },
    { id: 'u-npi', name: 'Dr. Has Npi', email: 'b@x.test', npi: '1234567893' }
  );
  const actor = (id: string) => ({ organizationId: 'org-test-1', actorUserId: id, actorRole: 'ADMIN' as any });
  try {
    const refused = await labsManage.createOrder(actor('u-no-npi'), { clientId: testClient.id, panels: ['Lipid Panel'] });
    assert.equal(refused.ok, false);
    if (!refused.ok) {
      assert.equal(refused.status, 409);
      assert.match(refused.error, /Your NPI is not on your staff profile/);
    }

    const created = await labsManage.createOrder(actor('u-npi'), { clientId: testClient.id, panels: ['Lipid Panel'] });
    assert.equal(created.ok, true);
    if (created.ok) {
      assert.equal(created.order.signerNpi, '1234567893');
      assert.equal(created.order.facilityClia, null);
      assert.equal(created.order.facilityName, 'Divine Counseling LLC');
    }

    process.env.LAB_FACILITY_CLIA = '21d1234567';
    const withClia = await labsManage.createOrder(actor('u-npi'), { clientId: testClient.id, panels: ['Lipid Panel'] });
    assert.ok(withClia.ok && withClia.order.facilityClia === '21D1234567');
  } finally {
    if (prevClia === undefined) delete process.env.LAB_FACILITY_CLIA;
    else process.env.LAB_FACILITY_CLIA = prevClia;
    await mockPrisma.client.delete({ where: { id: testClient.id } });
  }
});
