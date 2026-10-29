import assert from 'node:assert/strict';
import { test } from 'node:test';
import Module, { createRequire } from 'node:module';
import { ASSESSMENT_CATALOG } from '../src/features/ehr/assessments/catalog';
import { SOURCE_INSTRUMENTS } from '../src/features/ehr/assessments/sourceInstruments';
import { EVALUATION_TEMPLATES } from '../src/features/ehr/evaluations/templates';
import { MBC_THRESHOLDS, isMbcAlert } from '../src/features/ehr/assessments/thresholds';
import { canAccessPath } from '../src/lib/auth/roleAccess';
import { clearinghouseMode, submitPriorAuth, checkPriorAuthStatus } from '../src/lib/integrations/clearinghouse';

test('all source instruments and evaluation variants are available', () => {
  assert.equal(ASSESSMENT_CATALOG.length, SOURCE_INSTRUMENTS.length);
  assert.equal(ASSESSMENT_CATALOG.filter(i => i.hasDigitalQuestionnaire).length, 25);
  assert.equal(new Set(ASSESSMENT_CATALOG.map(i => i.id)).size, ASSESSMENT_CATALOG.length);
  for (const source of SOURCE_INSTRUMENTS) {
    const instrument = ASSESSMENT_CATALOG.find(i => i.name === source.name);
    assert.ok(instrument, source.name);
    assert.equal(instrument.hasDigitalQuestionnaire, Boolean(source.questions?.length));
  }
  for (const id of ['initial_psych_med', 'psych_re_eval', 'psych_follow_up', 'collateral_consultation']) {
    assert.ok(EVALUATION_TEMPLATES.find(t => t.id === id)?.sections.length, id);
  }
  assert.ok(EVALUATION_TEMPLATES.find(t => t.id === 'psychiatric_eval')!.sections.length > 15);
});

test('MBC uses instrument-specific thresholds and preserves safety flags', () => {
  for (const [instrumentId, threshold] of Object.entries(MBC_THRESHOLDS)) {
    assert.equal(isMbcAlert({ instrumentId, totalScore: threshold - 1, safetyFlagged: false }), false);
    assert.equal(isMbcAlert({ instrumentId, totalScore: threshold, safetyFlagged: false }), true);
  }
  assert.equal(isMbcAlert({ instrumentId: 'audit', totalScore: 20, safetyFlagged: false }), false);
  assert.equal(isMbcAlert({ instrumentId: 'epds', totalScore: 1, safetyFlagged: true }), true);
  const cssrs = ASSESSMENT_CATALOG.find(i => i.id === 'c-ssrs-brief')!;
  assert.equal(cssrs.calculateResult({q1:0,q2:0,q3:0,q4:0,q5:0,q6:0}).totalScore, 0);
  assert.equal(cssrs.calculateResult({q1:1,q2:1,q3:1,q4:1,q5:1,q6:1}).totalScore, 6);
  const epds = ASSESSMENT_CATALOG.find(i => i.id === 'epds')!;
  assert.equal(epds.calculateResult({ q10: 1 }).safetyFlagged, true);
});

test('new pages respect clinical and billing roles', () => {
  for (const path of ['/dashboard/ehr/evaluations', '/dashboard/ehr/locus', '/dashboard/compliance/mandatory-reporting']) {
    assert.equal(canAccessPath('THERAPIST', path), true);
    assert.equal(canAccessPath('BILLING', path), false);
    assert.equal(canAccessPath('FRONT_DESK', path), false);
  }
  assert.equal(canAccessPath('BILLING', '/dashboard/billing/prior-auth'), true);
  assert.equal(canAccessPath('PEER_SUPPORT', '/dashboard/billing/prior-auth'), false);
});

test('clearinghouse uses explicit configuration and mocked authenticated transport', async (t) => {
  const keys = ['CLINICAL_CLEARINGHOUSE_MODE', 'CARELON_CLIENT_ID', 'CARELON_CLIENT_SECRET', 'CARELON_TOKEN_URL', 'CARELON_PRIOR_AUTH_URL', 'CARELON_PRIOR_AUTH_STATUS_URL', 'AVAILITY_NPI', 'AVAILITY_ORG_NAME'];
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; for (const key of keys) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; } });
  for (const key of keys) delete process.env[key];
  assert.equal(clearinghouseMode('Carelon'), 'unconfigured');
  const payload = { patientId: 'patient', patientName: 'Synthetic Patient', dob: '1990-01-01', memberId: 'MEM1', payerId: 'PAYER1', payerName: 'Synthetic Payer', vendor: 'Carelon' as const, cptCodes: ['90837'], diagnosisCodes: ['F41.1'], startDate: '2026-09-15', endDate: '2026-10-15', requestedUnits: 4, clinicalRationale: 'Test only' };
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw Error('Unexpected network request'); };
  await assert.rejects(submitPriorAuth(payload));
  process.env.CLINICAL_CLEARINGHOUSE_MODE = 'demo';
  const demo = await submitPriorAuth(payload);
  assert.equal(demo.demoMode, true); assert.equal(demo.status, 'PENDING_REVIEW'); assert.equal(calls, 0);
  delete process.env.CLINICAL_CLEARINGHOUSE_MODE;
  Object.assign(process.env, { CARELON_CLIENT_ID: 'test-id', CARELON_CLIENT_SECRET: 'test-secret', CARELON_TOKEN_URL: 'https://clearinghouse.example/token', CARELON_PRIOR_AUTH_URL: 'https://clearinghouse.example/authorizations', CARELON_PRIOR_AUTH_STATUS_URL: 'https://clearinghouse.example/authorizations/{id}', AVAILITY_NPI: '1234567890', AVAILITY_ORG_NAME: 'Test clinic' });
  globalThis.fetch = async (url, init) => {
    calls++;
    if (String(url).endsWith('/token')) return Response.json({ access_token: 'test-token', expires_in: 300 });
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer test-token');
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body));
      assert.equal(body.memberInfo.memberId, 'MEM1');
      assert.equal(body.authorizationRequest.requestedUnits, 4);
      return Response.json({ authorizationNumber: 'AUTH-123', status: 'pending' });
    }
    assert.ok(String(url).endsWith('/AUTH-123'));
    return Response.json({ status: 'approved', approvedUnits: 4 });
  };
  const result = await submitPriorAuth(payload);
  assert.equal(result.referenceNumber, 'AUTH-123'); assert.equal(result.status, 'PENDING_REVIEW');
  assert.deepEqual(await checkPriorAuthStatus('AUTH-123', 'Carelon'), { status: 'APPROVED', approvedUnits: 4 });
  assert.equal(calls, 3, 'one token request is cached across submission and status');
});

test('clinical persistence rejects invalid or out-of-scope writes and preserves signed originals', async (t) => {
  let allowed = true;
  let assessment: any = null;
  let evaluation: any = null;
  let evaluationUpdate: any = null;
  const gate = { ok: true, organizationId: 'org', userId: 'clinician', role: 'THERAPIST', clientWhere: { assignedToId: 'clinician' }, session: { user: { name: 'Test Clinician' } } };
  const prisma = {
    client: { findFirst: async ({ where }: any) => { assert.deepEqual(where.AND, [gate.clientWhere]); return allowed ? { id: 'patient' } : null; } },
    clinicalAssessmentRecord: {
      create: async ({ data }: any) => { assessment = { ...data, id: 'assessment', createdAt: new Date(), answers: data.answers.create }; return assessment; },
      findMany: async ({ where }: any) => { assert.deepEqual(where.client, gate.clientWhere); return assessment ? [assessment] : []; },
    },
    clinicalEvaluationRecord: {
      findFirst: async ({ where }: any) => { assert.equal(where.organizationId, 'org'); assert.deepEqual(where.client, gate.clientWhere); return evaluation; },
      update: async ({ data }: any) => { evaluationUpdate = data; return { ...evaluation, ...data }; },
    },
    locusAssessmentRecord: { create: async ({ data }: any) => data },
  };
  const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
  const original = loader._load;
  loader._load = function(id, ...args) {
    if (id === '@/lib/db/prisma') return { prisma };
    if (id === '@/lib/clinical/access') return { requireClinicalContext: async () => gate };
    return original.call(this, id, ...args);
  };
  const require = createRequire(import.meta.url);
  let assessmentRoute: any, evaluationRoute: any, locusRoute: any;
  try {
    assessmentRoute = require('../src/app/api/clinical/assessments/route');
    evaluationRoute = require('../src/app/api/clinical/evaluations/route');
    locusRoute = require('../src/app/api/clinical/locus/route');
  } finally { loader._load = original; }
  const request = (body: unknown) => new Request('http://localhost/api/clinical/test', { method: 'POST', body: JSON.stringify(body) });
  const body = { clientId: 'patient', instrumentId: 'phq-9', clinicianVerified: true, answers: Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`q${i+1}`, i === 8 ? 1 : 0])) };
  await t.test('assessment answers are complete, rescored server-side and scoped', async () => {
    assert.equal((await assessmentRoute.POST(request({ ...body, answers: {} }))).status, 400);
    allowed = false; assert.equal((await assessmentRoute.POST(request(body))).status, 404); allowed = true;
    const response = await assessmentRoute.POST(request({ ...body, totalScore: 0, safetyFlagged: false }));
    assert.equal(response.status, 201); assert.equal(assessment.totalScore, 1); assert.equal(assessment.safetyFlagged, true);
    const history = await assessmentRoute.GET(new Request('http://localhost/api/clinical/assessments?clientId=patient'));
    assert.equal((await history.json()).data[0].answers.q9, 1);
  });
  await t.test('LOCUS rejects incomplete and out-of-range scores', async () => {
    assert.equal((await locusRoute.POST(request({ clientId: 'patient', scores: {} }))).status, 400);
    const scores = { dim1_harm: 1, dim2_function: 1, dim3_comorbidity: 1, dim4a_stress: 1, dim4b_support: 1, dim5_history: 1, dim6_engagement: 1 };
    assert.equal((await locusRoute.POST(request({ clientId: 'patient', scores, overrideLevel: 'Level 5' }))).status, 400);
    assert.equal((await locusRoute.POST(request({ clientId: 'patient', scores }))).status, 200);
  });
  await t.test('finalized evaluations require amendments and retain original JSON', async () => {
    evaluation = { id: 'evaluation', clientId: 'patient', templateType: 'psychiatric_eval', status: 'FINALIZED', formDataJson: '{"original":"retained"}', amendments: [] };
    const payload = { id: 'evaluation', clientId: 'patient', templateId: 'psychiatric_eval', status: 'DRAFT', content: { changed: 'value' } };
    assert.equal((await evaluationRoute.POST(request(payload))).status, 409);
    assert.equal((await evaluationRoute.POST(request({ ...payload, amendmentRationale: 'Corrected history' }))).status, 200);
    assert.equal(evaluationUpdate.formDataJson, undefined);
    assert.equal(evaluationUpdate.status, 'AMENDED');
    assert.equal(JSON.parse(evaluationUpdate.amendments.create.changesJson).content.changed, 'value');
  });
});

test('prior auth persists scoped requests, uses authoritative demographics and prevents duplicate transport', async () => {
  let allowed = true;
  let row: any = null;
  let calls = 0;
  const gate = { ok: true, organizationId: 'org', userId: 'billing', clientWhere: { organizationId: 'org' } };
  const prisma = {
    client: { findFirst: async ({where}: any) => { assert.deepEqual(where.AND, [gate.clientWhere]); return allowed ? { id: 'patient', name: 'Stored Patient', dateOfBirth: new Date('1980-01-02') } : null; } },
    priorAuth: {
      findFirst: async ({where}: any) => { assert.equal(where.organizationId, 'org'); assert.deepEqual(where.client, gate.clientWhere); return row; },
      findMany: async ({where}: any) => { assert.equal(where.organizationId, 'org'); assert.deepEqual(where.client, gate.clientWhere); return row ? [row] : []; },
      create: async ({data}: any) => { row = { ...data, id: 'pa', createdAt: new Date(), client: { name: 'Stored Patient', insuranceMemberId: 'M1' } }; return row; },
      update: async ({data}: any) => { row = {...row, ...data}; return row; },
    },
  };
  const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
  const original = loader._load;
  loader._load = function(id, ...args) {
    if (id === '@/lib/db/prisma') return { prisma };
    if (id === '@/lib/clinical/access') return { requireClinicalContext: async () => gate };
    if (id === '@/lib/integrations/clearinghouse') return {
      clearinghouseMode: () => 'configured',
      submitPriorAuth: async (payload: any) => { calls++; assert.equal(payload.vendor, 'Availity'); assert.equal(payload.patientName, 'Stored Patient'); assert.equal(payload.dob, '1980-01-02'); assert.equal(row.externalStatus, 'SUBMITTING'); return { referenceNumber: 'AUTH1', status: 'PENDING_REVIEW', demoMode: false, message: 'Submitted' }; },
      checkPriorAuthStatus: async () => ({status: 'APPROVED', approvedUnits: 3}),
    };
    return original.call(this, id, ...args);
  };
  let route: any;
  try { route = createRequire(import.meta.url)('../src/app/api/billing/prior-auth/route'); } finally { loader._load = original; }
  const request = (body: unknown) => new Request('http://localhost/api/billing/prior-auth', {method:'POST', body: JSON.stringify(body)});
  const input = { requestId:'e8877872-205f-40b8-9aba-e501881806b8', patientId:'patient', patientName:'Spoofed', vendor:'Availity', memberId:'M1', payerId:'P1', payerName:'Test', cptCodes:['90837'], diagnosisCodes:['F41.1'], requestedUnits:3, startDate:'2026-09-15', endDate:'2026-10-15', clinicalRationale:'Test' };
  assert.equal((await route.GET()).status,200);
  assert.equal((await route.POST(request({}))).status,400);
  allowed = false; assert.equal((await route.POST(request(input))).status,404); allowed = true;
  assert.equal((await route.POST(request(input))).status,201);
  assert.equal(row.status,'SUBMITTED');
  assert.equal((await route.POST(request(input))).status,200); assert.equal(calls,1);
  const batch = await route.POST(request({action:'batch_check'}));
  assert.equal((await batch.json()).data[0].status,'APPROVED'); assert.equal(row.unitsApproved,3);
});
