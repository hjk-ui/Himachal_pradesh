import assert from 'node:assert/strict';
import { test } from 'node:test';
import Module, { createRequire } from 'node:module';
import type { Prisma } from '@prisma/client';
import { EMPTY_PLAN_CARE } from '../src/lib/ehr/planLibrary';
import { encodeNoteBody } from '../src/lib/ehr/noteTemplates';

test('clinical API persistence retains new fields and existing tenant/role boundaries', async (t) => {
  const gate = {
    ok: true,
    userId: 'clinician',
    organizationId: 'clinic',
    role: 'THERAPIST',
    status: 401,
    error: 'Unauthorized',
  };
  let inScope = true;
  let plan: Record<string, unknown> | null = null;
  let savedNote: Record<string, unknown> | null = null;
  const db = {
    client: {
      findFirst: async () => (inScope ? { id: 'patient', assignedToId: 'clinician' } : null),
    },
    user: { findFirst: async () => ({ id: 'clinician' }) },
    treatmentPlan: {
      create: async ({ data }: Prisma.TreatmentPlanCreateArgs) => {
        plan = {
          ...data,
          id: 'plan',
          createdAt: new Date(),
          updatedAt: new Date(),
          client: { name: 'Synthetic Patient' },
          clinician: { name: 'Clinician' },
        };
        return plan;
      },
      findFirst: async ({ where }: Prisma.TreatmentPlanFindFirstArgs) => {
        assert.equal(where?.organizationId, 'clinic');
        return inScope ? plan : null;
      },
      update: async ({ data }: Prisma.TreatmentPlanUpdateArgs) => {
        plan = { ...plan, ...data };
        return plan;
      },
    },
    progressNote: {
      create: async ({ data }: Prisma.ProgressNoteCreateArgs) => {
        savedNote = {
          ...data,
          id: 'note',
          createdAt: new Date(),
          clinician: { name: 'Clinician', email: '', image: null },
        };
        return savedNote;
      },
      findMany: async () => (savedNote ? [savedNote] : []),
    },
  };
  const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
  const original = loader._load;
  loader._load = function (id, ...args) {
    if (id === '@/lib/db/prisma') return { prisma: db };
    if (id === '@/lib/auth/tenant') return { requireOrgContext: async () => gate };
    if (id === '@/lib/notes/workflow-store') return { loadWorkflowStatuses: async () => new Map() };
    return original.call(this, id, ...args);
  };
  const require = createRequire(import.meta.url);
  type Route = {
    POST: (req: Request, ctx?: { params: Promise<{ id: string }> }) => Promise<Response>;
    GET: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
    PATCH: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
  };
  let plans: Route, detail: Route, notes: Route;
  try {
    plans = require('../src/app/api/ehr/treatment-plans/route');
    detail = require('../src/app/api/ehr/treatment-plans/[id]/route');
    notes = require('../src/app/api/clients/[id]/notes/route');
  } finally {
    loader._load = original;
  }
  const request = (body: unknown, method = 'POST') =>
    new Request('http://localhost/api/test', { method, body: JSON.stringify(body) });
  const context = { params: Promise.resolve({ id: 'plan' }) };
  const care = {
    ...EMPTY_PLAN_CARE,
    planType: 'Substance Use Disorder (SUD)',
    serviceFrequency: 'Weekly',
    expectedDuration: '180 days',
    coordinationOfCare: 'Coordinate with PCP',
    barriersToTreatment: 'Transportation',
  };
  await t.test('create and reload a plan; goal-only updates retain care fields', async () => {
    const response = await plans.POST(
      request({
        clientId: 'patient',
        title: 'Recovery plan',
        clinicalDetails: care,
        goals: [
          {
            id: 'g1',
            text: 'Recovery support',
            objectives: ['Practice skill'],
            interventions: ['MI'],
            targetDate: '',
            progress: 0,
          },
        ],
      }),
    );
    assert.equal(response.status, 201);
    assert.deepEqual((await response.json()).plan.clinicalDetails, care);
    const patch = await detail.PATCH(
      request({ goals: [{ id: 'g1', text: 'Recovery support', progress: 100 }] }, 'PATCH'),
      context,
    );
    assert.equal(patch.status, 200);
    const read = await detail.GET(new Request('http://localhost'), context);
    const data = await read.json();
    assert.deepEqual(data.plan.clinicalDetails, care);
    assert.equal(data.plan.goals[0].progress, 100);
    assert.equal(
      (
        await detail.PATCH(
          request({ clinicalDetails: { ...care, planType: 'invalid' } }, 'PATCH'),
          context,
        )
      ).status,
      400,
    );
  });
  await t.test(
    'note POST and GET preserve billing / Part 2 metadata while keeping narrative clean',
    async () => {
      const context = { params: Promise.resolve({ id: 'patient' }) };
      const body = encodeNoteBody('Subjective\nDocumented visit', {
        noteType: 'SOAP',
        durationMinutes: 45,
        billingCode: '90834',
        telehealth: true,
        placeOfService: '02',
        sudConfidential: true,
      });
      const response = await notes.POST(request({ body }), context);
      assert.equal(response.status, 200);
      const read = await notes.GET(new Request('http://localhost'), context);
      const note = (await read.json()).notes[0];
      assert.equal(note.billingCode, '90834');
      assert.equal(note.sudConfidential, true);
      assert.equal(note.placeOfService, '02');
      assert.equal(note.telehealth, true);
      assert.equal(note.body, 'Subjective\nDocumented visit');
    },
  );
  await t.test('wrong roles, sessions and out-of-scope patients are still rejected', async () => {
    gate.ok = false;
    assert.equal((await plans.POST(request({}))).status, 401);
    gate.ok = true;
    gate.role = 'BILLING';
    assert.equal((await plans.POST(request({}))).status, 403);
    gate.role = 'THERAPIST';
    inScope = false;
    assert.equal((await detail.GET(new Request('http://localhost'), context)).status, 404);
  });
});
