import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildPreVisitFacts,
  extractPlanSection,
  factLines,
  modelFacts,
  redactNames,
  type PreVisitInputs,
} from '../src/lib/ai/previsit/facts';
import { ruleBasedBullets } from '../src/lib/ai/previsit/rules';
import { checkBullet, groundedBullets, groundingSets, parseModelBullets } from '../src/lib/ai/previsit/validate';
import { previsitUserPrompt, PREVISIT_SYSTEM_PROMPT } from '../src/lib/ai/previsit/prompt';
import { getPreVisitBrief, type AuditEntry, type PreVisitDeps } from '../src/lib/ai/previsit/service';
import { PreVisitBriefCache } from '../src/lib/ai/previsit/cache';

const ROOT = path.join(__dirname, '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const TZ = 'America/New_York';
const NOW = new Date('2026-10-18T14:00:00Z');
const d = (iso: string) => new Date(`${iso}T15:00:00Z`);
const NAMES = ['Jordan Rivers', 'Jordan', 'Rivers'];

function inputs(over: Partial<PreVisitInputs> = {}): PreVisitInputs {
  return {
    client: { riskLevel: 'MEDIUM', names: NAMES },
    appointments: [
      { id: 'a0', startsAt: d('2026-09-20'), type: 'Individual Therapy', status: 'COMPLETED' },
      { id: 'a1', startsAt: d('2026-10-11'), type: 'Individual Therapy', status: 'COMPLETED' },
      { id: 'a2', startsAt: d('2026-10-14'), type: 'Individual Therapy', status: 'NO_SHOW' },
      { id: 'a3', startsAt: d('2026-10-01'), type: 'Individual Therapy', status: 'CANCELLED' },
    ],
    medications: [
      { id: 'm1', medicationName: 'Sertraline', dosage: '50 mg', startDate: d('2026-10-14'), createdAt: d('2026-10-14'), active: true, status: 'active', rcopiaMedId: 'RX1' },
      { id: 'm2', medicationName: 'Hydroxyzine', dosage: '25 mg', startDate: d('2026-08-01'), createdAt: d('2026-08-01'), stopDate: d('2026-10-13'), active: false, status: 'stopped', rcopiaMedId: null },
      { id: 'm3', medicationName: 'Bupropion', dosage: '150 mg', startDate: d('2026-09-01'), createdAt: d('2026-09-01'), active: true, status: 'active' },
    ],
    problems: [
      { id: 'p1', name: 'Generalized anxiety disorder', icd10Code: 'F41.1', status: 'Active', createdAt: d('2026-10-12'), source: 'drfirst' },
      { id: 'p0', name: 'Insomnia', icd10Code: 'G47.00', status: 'Active', createdAt: d('2026-09-02'), source: null },
    ],
    riskAlerts: [{ id: 'r1', type: 'low_mood', severity: 'HIGH', reviewed: false, createdAt: d('2026-10-15') }],
    crisisEpisodes: [{ id: 'c1', startedAt: d('2026-10-16'), status: 'resolved', priority: 2 }],
    assessments: [
      { id: 's1', instrumentId: 'phq-9', instrumentName: 'PHQ-9', totalScore: 14, severity: 'Moderate', safetyFlagged: false, createdAt: d('2026-10-15') },
      { id: 's2', instrumentId: 'phq-9', instrumentName: 'PHQ-9', totalScore: 9, severity: 'Mild', safetyFlagged: false, createdAt: d('2026-10-11') },
      { id: 's3', instrumentId: 'gad-7', instrumentName: 'GAD-7', totalScore: 8, severity: 'Mild', safetyFlagged: false, createdAt: d('2026-10-11') },
      { id: 's4', instrumentId: 'c-ssrs-brief', instrumentName: 'C-SSRS Screener', totalScore: 2, severity: 'Moderate', safetyFlagged: true, createdAt: d('2026-10-15') },
    ],
    // Same PHQ-9 administration mirrored from Valant: deduped
    measurements: [{ id: 'mr1', instrumentKey: 'phq-9', valueNumeric: 14, measuredAt: d('2026-10-15') }],
    treatmentPlan: { id: 'tp1', status: 'ACTIVE', reviewDueAt: d('2026-10-25'), goals: { items: [{ text: 'Jordan will sleep 7 hours most nights' }] } },
    sessionFrequency: { bucket: 'below' as never, recommendation: 'Weekly', statusDetail: '2 of 4 expected visits in 28 days' },
    draftNoteCount: 1,
    pendingConsentCount: 0,
    sdohReferrals: [{ id: 'sd1', domain: 'housing_instability', status: 'open', createdAt: d('2026-10-05') }],
    standingLabs: [{ id: 'l1', tests: [{ key: 'lithium', name: 'Lithium level' }], nextDueAt: d('2026-10-20'), active: true, endDate: null }],
    labResultsAwaitingReview: 1,
    recentNotes: [
      { id: 'n0', noteType: 'SUD', body: 'Plan:\nRelapse prevention group Tuesday', dateOfService: d('2026-10-12'), createdAt: d('2026-10-12'), part2: true },
      {
        id: 'n1',
        noteType: 'SOAP',
        body: 'Subjective:\nJordan reports poor sleep and conflict at work.\nAssessment:\nModerate depressive symptoms.\nPlan:\nPractice 4-7-8 breathing nightly. Call Jordan Rivers at 410-555-1234 if needed.\n',
        dateOfService: d('2026-10-11'),
        createdAt: d('2026-10-11'),
        part2: false,
      },
    ],
    ...over,
  };
}

// ─── Facts builder ───────────────────────────────────────────────────────────

test('facts: changes since the last completed visit, scores + trend, risk, plan, frequency, open items', () => {
  const f = buildPreVisitFacts(inputs(), { now: NOW, timeZone: TZ, audience: 'therapist' });
  assert.equal(f.asOf, '2026-10-18');
  assert.deepEqual(f.lastVisit, { date: '2026-10-11', type: 'Individual Therapy' });
  assert.equal(f.since, '2026-10-11');
  assert.deepEqual(f.changes.medsStarted.map((m) => [m.name, m.dose, m.date, m.fromDrFirst]), [['Sertraline', '50 mg', '2026-10-14', true]]);
  assert.deepEqual(f.changes.medsStopped.map((m) => [m.name, m.date]), [['Hydroxyzine', '2026-10-13']]);
  assert.deepEqual(f.changes.newProblems.map((p) => [p.code, p.fromDrFirst]), [['F41.1', true]]);
  assert.equal(f.changes.newRiskAlerts.length, 1);
  assert.equal(f.changes.crisisEpisodes[0].date, '2026-10-16');
  // Cancelled visit on 10-01 is before the window; the 10-14 no-show is in it
  assert.deepEqual(f.changes.missedVisits.map((v) => [v.date, v.status]), [['2026-10-14', 'no-show']]);

  const phq = f.scores.find((s) => s.instrument === 'PHQ-9')!;
  assert.equal(phq.latest.score, 14);
  assert.equal(phq.previous?.score, 9);
  assert.equal(phq.change, 5);
  assert.equal(phq.trend, 'up');
  assert.equal(phq.history.length, 2, 'Valant mirror of the same administration is deduped');
  assert.equal(f.scores.find((s) => s.instrument === 'GAD-7')!.trend, 'single');
  assert.equal(f.scores[0].instrument, 'C-SSRS', 'safety instrument first');

  assert.equal(f.risk.level, 'high', 'unreviewed high alert + flagged C-SSRS raise the level (banner rules)');
  assert.equal(f.risk.chartLevel, 'medium');
  assert.equal(f.risk.cssrsSafetyFlagged, true);
  assert.equal(f.treatmentPlan?.reviewState, 'due_soon');
  assert.deepEqual(f.treatmentPlan?.goals, ['the client will sleep 7 hours most nights']);
  assert.equal(f.sessionFrequency?.recommendation, 'Weekly');
  assert.equal(f.openItems.draftNotes, 1);
  assert.equal(f.openItems.sdohReferrals[0].need, 'housing instability');
  assert.equal(f.labs, null, 'therapists do not get the labs section');
});

test('facts: last note plan is the plan section only, from the newest non–Part 2 note, redacted', () => {
  const f = buildPreVisitFacts(inputs(), { now: NOW, timeZone: TZ, audience: 'therapist' });
  assert.equal(f.lastNotePlan?.date, '2026-10-11');
  assert.match(f.lastNotePlan!.text, /^Practice 4-7-8 breathing nightly/);
  assert.doesNotMatch(f.lastNotePlan!.text, /poor sleep|conflict|depressive/, 'no other note sections');
  assert.doesNotMatch(f.lastNotePlan!.text, /Relapse/, 'Part 2 note skipped');
  assert.doesNotMatch(f.lastNotePlan!.text, /Jordan|Rivers|410-555/);
});

test('facts: no client name, no ids in what the model sees', () => {
  const f = buildPreVisitFacts(inputs(), { now: NOW, timeZone: TZ, audience: 'prescriber' });
  const json = JSON.stringify(modelFacts(f));
  assert.doesNotMatch(json, /Jordan|Rivers/);
  assert.doesNotMatch(json, /"(?:m1|p1|r1|tp1|n1|RX1)"/);
  assert.doesNotMatch(previsitUserPrompt(f), /Jordan|Rivers|reports poor sleep/);
});

test('facts: prescriber audience includes labs due and results awaiting review', () => {
  const f = buildPreVisitFacts(inputs(), { now: NOW, timeZone: TZ, audience: 'prescriber' });
  assert.deepEqual(f.labs?.due, [{ tests: ['Lithium level'], dueDate: '2026-10-20', state: 'due_soon' }]);
  assert.equal(f.labs?.resultsAwaitingReview, 1);
});

test('facts: no completed visit → 30-day window; empty chart is handled', () => {
  const f = buildPreVisitFacts(
    inputs({ appointments: [], medications: [], problems: [], riskAlerts: [], crisisEpisodes: [], assessments: [], measurements: [], treatmentPlan: null, sessionFrequency: null, sdohReferrals: [], recentNotes: [], draftNoteCount: 0 }),
    { now: NOW, timeZone: TZ, audience: 'therapist' }
  );
  assert.equal(f.lastVisit, null);
  assert.equal(f.since, '2026-09-18');
  assert.equal(f.scores.length, 0);
  const bullets = ruleBasedBullets(f);
  assert.ok(bullets.length >= 4 && bullets.length <= 6);
  assert.ok(bullets.some((b) => /No PHQ-9, GAD-7 or C-SSRS scores/.test(b)));
});

test('extractPlanSection: headings, inline P:, stops at the next heading, none → empty', () => {
  assert.equal(extractPlanSection('Data:\nx\nPlan:\nHomework: thought log.\nReturn in 1 week.\nRisk:\nnone'), 'Homework: thought log. Return in 1 week.');
  assert.equal(extractPlanSection('S: ok\nP: Continue CBT, follow up 2 weeks'), 'Continue CBT, follow up 2 weeks');
  assert.equal(extractPlanSection('## Plan\nTitrate per prescriber\n## Signature\nX'), 'Titrate per prescriber');
  assert.equal(extractPlanSection('<!-- meta -->\nSubjective:\nNo plan here.'), '');
});

test('redactNames: names, emails, phones', () => {
  assert.equal(redactNames('Jordan said Rivers family; email j@x.org, 410.555.1234', NAMES), 'the client said the client family; email [email], [phone]');
});

// ─── Grounding validation ────────────────────────────────────────────────────

test('validation keeps grounded bullets and drops ungrounded dates, numbers, codes, names and relative dates', () => {
  const f = buildPreVisitFacts(inputs(), { now: NOW, timeZone: TZ, audience: 'therapist' });
  const { kept, dropped } = groundedBullets(
    [
      'PHQ-9 rose to 14 on 2026-10-15, up 5 from 9.',
      'Sertraline 50 mg was started on 2026-10-14 via DrFirst.',
      'PHQ-9 was 21 on 2026-10-15.', // number not in facts
      'Hospitalized on 2026-10-17.', // date not in facts
      'Seen in the ER on Oct 16.', // non-ISO date
      'Crisis episode 3 days ago.', // relative date
      'New diagnosis F32.9 added.', // code not in facts
      'Jordan missed a visit on 2026-10-14.', // names the client
      'PHQ-9 rose to 14 on 2026-10-15, up 5 from 9.', // duplicate
    ],
    f,
    NAMES
  );
  assert.deepEqual(kept, ['PHQ-9 rose to 14 on 2026-10-15, up 5 from 9.', 'Sertraline 50 mg was started on 2026-10-14 via DrFirst.']);
  assert.deepEqual(dropped, ['ungrounded_number', 'ungrounded_date', 'unverifiable_date', 'unverifiable_date', 'ungrounded_code', 'names_client', 'duplicate']);
});

test('validation: the rule-based brief is itself fully grounded', () => {
  for (const audience of ['therapist', 'prescriber'] as const) {
    const f = buildPreVisitFacts(inputs(), { now: NOW, timeZone: TZ, audience });
    const sets = groundingSets(f);
    for (const b of ruleBasedBullets(f)) assert.equal(checkBullet(b, sets, NAMES), null, `rule bullet failed grounding: ${b}`);
  }
});

test('parseModelBullets: JSON object, bare array, objects with text, junk', () => {
  assert.deepEqual(parseModelBullets('{"bullets":["- a","2. b"]}'), ['a', 'b']);
  assert.deepEqual(parseModelBullets('[{"text":"x"}]'), ['x']);
  assert.deepEqual(parseModelBullets('not json'), []);
});

// ─── Service: gates, fallback, audit, cache ──────────────────────────────────

type FakeOpts = {
  access?: Awaited<ReturnType<PreVisitDeps['resolveAccess']>>;
  consent?: 'signed' | 'missing' | 'declined';
  configured?: boolean;
  reply?: string | Error;
};

function fake(o: FakeOpts = {}) {
  const audits: AuditEntry[] = [];
  const prompts: string[] = [];
  let loads = 0;
  const deps: PreVisitDeps = {
    resolveAccess: async () => o.access ?? { ok: true, sensitive: 'none', names: NAMES },
    loadInputs: async () => {
      loads++;
      return inputs();
    },
    aiConsent: async () => o.consent ?? 'signed',
    practiceTimeZone: async () => TZ,
    bedrockConfigured: () => o.configured ?? true,
    invokeModel: async ({ system, userPrompt }) => {
      prompts.push(system + '\n' + userPrompt);
      if (o.reply instanceof Error) throw o.reply;
      return o.reply ?? JSON.stringify({ bullets: ['Risk level high with 1 unreviewed alert on 2026-10-15.', 'PHQ-9 14 on 2026-10-15, up 5 from 9.', 'Sertraline 50 mg started 2026-10-14.', 'Plan review due 2026-10-25.'] });
    },
    modelId: 'test-haiku',
    audit: async (e) => {
      audits.push(e);
    },
    cache: new PreVisitBriefCache(),
    now: () => NOW,
  };
  return { deps, audits, prompts, loads: () => loads };
}

const VIEWER = { organizationId: 'org1', userId: 'u1', role: 'THERAPIST' };

test('service: AI path → grounded bullets, labelled ai, one AI_ACCESS audit with counts only', async () => {
  const t = fake();
  const r = await getPreVisitBrief(t.deps, VIEWER, 'c1');
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.brief.source, 'ai');
  assert.equal(r.brief.model, 'test-haiku');
  assert.equal(r.brief.bullets.length, 4);
  assert.ok(r.brief.factLines.length > 5);
  const ai = t.audits.filter((a) => a.action === 'AI_ACCESS');
  assert.equal(ai.length, 1);
  assert.equal(ai[0].outcome, 'SUCCESS');
  const meta = JSON.stringify(ai[0].metadata);
  assert.doesNotMatch(meta, /Sertraline|breathing|Jordan|housing/, 'audit holds counts and ids, never chart text');
  assert.match(meta, /"factCounts"/);
  assert.equal(t.prompts.length, 1);
  assert.match(t.prompts[0], /Use ONLY the facts/);
  assert.doesNotMatch(t.prompts[0], /Jordan|Rivers|reports poor sleep|Relapse/);
});

test('service: consent declined → no AI call, rule-based brief labelled with the reason', async () => {
  const t = fake({ consent: 'declined' });
  const r = await getPreVisitBrief(t.deps, VIEWER, 'c1');
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.brief.source, 'rules');
  assert.equal(r.brief.fallbackReason, 'ai_consent_declined');
  assert.equal(r.brief.model, null);
  assert.equal(t.prompts.length, 0);
  assert.equal(t.audits.filter((a) => a.action === 'AI_ACCESS').length, 0);
  assert.equal(t.audits.filter((a) => a.action === 'READ' && a.outcome === 'SUCCESS').length, 1);
});

test('service: 42 CFR Part 2 locked record → no brief, nothing loaded, denial audited', async () => {
  const t = fake({ access: { ok: false, status: 403, reason: 'sensitive_record' } });
  const r = await getPreVisitBrief(t.deps, VIEWER, 'c1');
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.status, 403);
  assert.equal(t.loads(), 0);
  assert.equal(t.prompts.length, 0);
  assert.deepEqual(t.audits.map((a) => [a.action, a.outcome, a.metadata.reason]), [['READ', 'DENIED', 'sensitive_record']]);
});

test('service: protected record the viewer is cleared for → rule-based only (nothing to AI)', async () => {
  const t = fake({ access: { ok: true, sensitive: 'allowed', names: NAMES } });
  const r = await getPreVisitBrief(t.deps, VIEWER, 'c1');
  assert.ok(r.ok && r.brief.source === 'rules' && r.brief.fallbackReason === 'protected_record');
  assert.equal(t.prompts.length, 0);
});

test('service: roles without brief access are denied before any chart read', async () => {
  for (const role of ['FRONT_DESK', 'BILLING', 'PEER_SUPPORT', 'HR']) {
    const t = fake();
    const r = await getPreVisitBrief(t.deps, { ...VIEWER, role }, 'c1');
    assert.equal(r.ok, false, role);
    assert.equal(t.loads(), 0);
  }
});

test('service: Bedrock not configured → rule-based, no AI audit', async () => {
  const t = fake({ configured: false });
  const r = await getPreVisitBrief(t.deps, VIEWER, 'c1');
  assert.ok(r.ok && r.brief.source === 'rules' && r.brief.fallbackReason === 'ai_not_configured');
  assert.equal(t.audits.filter((a) => a.action === 'AI_ACCESS').length, 0);
});

test('service: model failure → rule-based, AI_ACCESS FAILURE audited, not cached', async () => {
  const t = fake({ reply: new Error('throttled') });
  const r1 = await getPreVisitBrief(t.deps, VIEWER, 'c1');
  assert.ok(r1.ok && r1.brief.source === 'rules' && r1.brief.fallbackReason === 'ai_failed');
  const ai = t.audits.filter((a) => a.action === 'AI_ACCESS');
  assert.equal(ai.length, 1);
  assert.equal(ai[0].outcome, 'FAILURE');
  await getPreVisitBrief(t.deps, VIEWER, 'c1');
  assert.equal(t.prompts.length, 2, 'a transient failure is retried on the next open');
});

test('service: ungrounded model output → discarded, rule-based brief shown', async () => {
  const t = fake({ reply: JSON.stringify({ bullets: ['Admitted on 2026-10-17 after an overdose.', 'PHQ-9 is 27.'] }) });
  const r = await getPreVisitBrief(t.deps, VIEWER, 'c1');
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.brief.source, 'rules');
  assert.equal(r.brief.fallbackReason, 'ai_output_rejected');
  assert.equal(r.brief.droppedCount, 2);
  assert.ok(!r.brief.bullets.some((b) => /overdose|27/.test(b)));
});

test('service: cached per client + day; Refresh rebuilds; access re-checked on cache hits', async () => {
  const t = fake();
  const a = await getPreVisitBrief(t.deps, VIEWER, 'c1');
  const b = await getPreVisitBrief(t.deps, VIEWER, 'c1');
  assert.ok(a.ok && b.ok);
  if (!a.ok || !b.ok) return;
  assert.equal(a.brief.cached, false);
  assert.equal(b.brief.cached, true);
  assert.equal(t.prompts.length, 1);
  await getPreVisitBrief(t.deps, VIEWER, 'c1', { refresh: true });
  assert.equal(t.prompts.length, 2);
  // Same cache, viewer now locked out → denied, cache not served
  const locked = { ...t.deps, resolveAccess: async () => ({ ok: false as const, status: 403 as const, reason: 'sensitive_record' }) };
  const c = await getPreVisitBrief(locked, VIEWER, 'c1');
  assert.equal(c.ok, false);
});

test('service: prescribers get the prescriber audience (labs) and a separate cache entry', async () => {
  const t = fake();
  const r = await getPreVisitBrief(t.deps, { ...VIEWER, role: 'PSYCHIATRIST' }, 'c1');
  assert.ok(r.ok && r.brief.audience === 'prescriber' && r.brief.facts.labs?.due.length === 1);
});

// ─── Wiring ─────────────────────────────────────────────────────────────────

test('wiring: routes use the service; legacy briefing no longer sends note bodies; UI hooks present', () => {
  const route = read('src/app/api/clients/[id]/previsit-brief/route.ts');
  assert.match(route, /getPreVisitBrief/);
  assert.match(route, /export function GET/);
  assert.match(route, /export function POST/);
  const legacy = read('src/app/api/clients/[id]/briefing/route.ts');
  assert.match(legacy, /getPreVisitBrief/);
  assert.doesNotMatch(legacy, /body\.slice|progressNote\.findMany/);
  assert.match(read('src/app/dashboard/clients/[id]/page.tsx'), /<PreVisitBriefCard clientId=\{client\.id\} \/>/);
  assert.match(read('src/features/dashboard/components/TherapistHome.tsx'), /<PreVisitBriefButton /);
  assert.match(read('src/features/dashboard/components/RoleHomes.tsx'), /<PreVisitBriefButton /);
  assert.match(read('src/app/dashboard/appointments/page.tsx'), /<PreVisitBriefButton /);
  assert.match(read('src/components/ai/PreVisitBrief.tsx'), /AI-generated from chart facts — verify/);
  assert.match(PREVISIT_SYSTEM_PROMPT, /the client/);
  assert.ok(factLines(buildPreVisitFacts(inputs(), { now: NOW, timeZone: TZ, audience: 'therapist' })).every((l) => !/Jordan|Rivers/.test(l.text)));
});
