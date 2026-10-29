import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scanRiskText, isNegated } from '../src/lib/ai/riskWatch/engine';
import { applyAiVerdicts, buildSnippet, hitsForAiReview, redactNames, reviewWithAi, type AiVerdict } from '../src/lib/ai/riskWatch/ai';
import {
  alertRecipients,
  buildAlertDescription,
  planAlertWrite,
  riskSourceId,
  threadSourcePrefix,
  RISK_WATCH_TYPE,
  type ExistingAlert,
} from '../src/lib/ai/riskWatch/routing';
import { buildBannerView } from '../src/lib/ai/riskWatch/view';
import { patientSafetyPayload, CRISIS_RESOURCES } from '../src/lib/ai/riskWatch/crisisResources';
import { runRiskWatch, type RiskWatchDeps } from '../src/lib/ai/riskWatch/service';
import type { AuditLogEntry } from '../src/lib/audit/writeAuditLog';

// Synthetic text and ids only; no real patient data.

const sev = (text: string, ch: 'patient_message' | 'note' = 'note') => scanRiskText(text, ch).severity;

// ─── Rule hits ─────────────────────────────────────────────────────────────────

test('C-SSRS concepts map to severity: plan / intent / means → HIGH, passive → MEDIUM', () => {
  assert.equal(sev("I'm going to kill myself tonight", 'patient_message'), 'high');
  assert.equal(sev('Pt endorses SI with plan to overdose.'), 'high');
  assert.equal(sev('I wrote a suicide note.', 'patient_message'), 'high');
  assert.equal(sev('Client has been stockpiling pills.'), 'high');
  assert.equal(sev('i want to die. i have pills saved up', 'patient_message'), 'high');
  assert.equal(sev('Pt reports passive SI.'), 'medium');
  assert.equal(sev('I wish I was dead', 'patient_message'), 'medium');
  assert.equal(sev("I don't want to wake up anymore", 'patient_message'), 'medium');
  assert.equal(sev('Better off without me.', 'patient_message'), 'medium');
});

test('active ideation: HIGH in the patient’s own message, MEDIUM in a note without plan', () => {
  assert.equal(sev('I want to kill myself', 'patient_message'), 'high');
  assert.equal(sev('Pt reports thoughts of killing herself, no plan or intent.'), 'medium');
});

test('behavior: recent attempt HIGH, history only → no alert', () => {
  assert.equal(sev('Client attempted suicide last week.'), 'high');
  assert.equal(sev('I tried to kill myself yesterday', 'patient_message'), 'high');
  assert.equal(sev('History of suicide attempt in 2015.'), null);
  const r = scanRiskText('History of suicide attempt in 2015.', 'note');
  assert.ok(r.excluded.some((e) => e.reason === 'historical'));
});

test('self-harm, homicide and abuse / danger', () => {
  assert.equal(sev('I have been cutting again', 'patient_message'), 'medium');
  assert.equal(sev('Pt endorses HI toward neighbor.'), 'medium');
  assert.equal(sev("I'm going to shoot him", 'patient_message'), 'high');
  assert.equal(sev('He choked me last night', 'patient_message'), 'high');
  assert.equal(sev('He threatened to kill me', 'patient_message'), 'high');
  assert.equal(sev('My husband hits me', 'patient_message'), 'medium');
  assert.equal(sev("Can't go on like this", 'patient_message'), 'low');
});

test('negation: denies SI, not suicidal, SI: denies, without plan', () => {
  for (const t of ['Client denies SI/HI.', 'Pt denies SI, HI, plan or intent.', 'SI: denies', 'Pt not currently suicidal.', 'Negative for suicidal ideation.', "I don't want to die"]) {
    assert.equal(sev(t, t.startsWith('I ') ? 'patient_message' : 'note'), null, t);
  }
  // A terminator ends the negation scope
  assert.equal(sev('Pt denies HI but reports passive SI.'), 'medium');
  // A negated plan cue does not escalate
  assert.equal(sev('Pt endorses passive SI, denies plan or intent.'), 'medium');
  assert.equal(isNegated('denies suicidal ideation', 7, 17), true);
});

test('third person / quotes: others in notes are dropped; in portal messages kept LOW for review', () => {
  assert.equal(sev("Client's friend attempted suicide last week."), null);
  assert.equal(sev('Family history of suicide (maternal uncle).'), null);
  const msg = scanRiskText('my friend said she wants to die', 'patient_message');
  assert.equal(msg.severity, 'low');
  assert.equal(msg.hits[0]!.thirdParty, true);
  // Clinician quoting the patient still counts
  assert.equal(sev('Pt stated "I want to kill myself."'), 'medium');
});

test('idioms, blank checkboxes and screening questions in notes are not hits', () => {
  assert.equal(sev('This traffic is killing me, I could die of embarrassment', 'patient_message'), null);
  assert.equal(sev('Suicidal ideation [ ]'), null);
  assert.equal(sev('Are you having thoughts of suicide?'), null);
  // a patient's own question still counts
  assert.equal(sev('should I just kill myself?', 'patient_message'), 'high');
});

// ─── AI review ─────────────────────────────────────────────────────────────────

const verdict = (id: string, v: Partial<AiVerdict>): [string, AiVerdict] => [id, { id, riskPresent: true, aboutPatient: true, negated: false, figurative: false, ...v }];

test('only ambiguous low/medium hits are eligible; HIGH hits are never sent', () => {
  const high = scanRiskText("I'm going to kill myself tonight", 'patient_message');
  assert.equal(hitsForAiReview(high.hits).length, 0);
  const amb = scanRiskText('I just want to end it', 'patient_message');
  assert.equal(amb.severity, 'medium');
  assert.equal(hitsForAiReview(amb.hits).length, 1);
});

test('AI may downgrade medium → low and low → dismissed; never touches HIGH or non-ambiguous', () => {
  const amb = scanRiskText('I just want to end it', 'patient_message');
  const key = amb.hits[0]!.key;
  const down = applyAiVerdicts(amb, new Map([verdict(key, { riskPresent: false, figurative: true })]));
  assert.equal(down.scan.severity, 'low');
  assert.deepEqual(down.downgrades.map((d) => [d.from, d.to]), [['medium', 'low']]);

  const low = scanRiskText("Can't go on like this", 'patient_message');
  const lowDown = applyAiVerdicts(low, new Map([verdict(low.hits[0]!.key, { riskPresent: false })]));
  assert.equal(lowDown.scan.severity, null);
  assert.equal(lowDown.downgrades[0]!.to, 'dismissed');

  const high = scanRiskText("I'm going to kill myself tonight", 'patient_message');
  const untouched = applyAiVerdicts(high, new Map([verdict(high.hits[0]!.key, { riskPresent: false, figurative: true })]));
  assert.equal(untouched.scan.severity, 'high');
  assert.equal(untouched.downgrades.length, 0);

  const passive = scanRiskText('I wish I was dead', 'patient_message'); // not ambiguous
  const kept = applyAiVerdicts(passive, new Map([verdict(passive.hits[0]!.key, { riskPresent: false })]));
  assert.equal(kept.scan.severity, 'medium');
});

test('AI failure, bad JSON or timeout keeps the rule result', async () => {
  const amb = scanRiskText('I just want to end it', 'patient_message');
  const bad = await reviewWithAi(amb, async () => 'not json');
  assert.equal(bad.status, 'failed');
  assert.equal(bad.scan.severity, 'medium');
  const thrown = await reviewWithAi(amb, async () => {
    throw new Error('Bedrock down');
  });
  assert.equal(thrown.scan.severity, 'medium');
  const slow = await reviewWithAi(amb, () => new Promise((r) => setTimeout(() => r('{}'), 200)), { timeoutMs: 20 });
  assert.equal(slow.status, 'failed');
});

test('snippet is the hit sentence ± 1 with names and contact details redacted', () => {
  const text = 'Session went fine. Jane Doe said she might just end it. Call 410-555-1234 later. Unrelated closing line.';
  const scan = scanRiskText(text, 'note');
  const hit = scan.hits.find((h) => h.phraseId === 'end-it')!;
  const s = buildSnippet(scan, hit, ['Jane', 'Doe']);
  assert.ok(!/Jane|Doe/.test(s), s);
  assert.ok(!/410/.test(s), s);
  assert.ok(!/Unrelated closing/.test(s), 'only ±1 sentence');
  assert.match(redactNames('Talked with Marcus about it', []), /\[name\]/);
});

// ─── Dedupe / routing / Part 2 ───────────────────────────────────────────────

const a = (id: string, sourceId: string, severity: ExistingAlert['severity'], reviewed = false): ExistingAlert => ({ id, sourceId, severity, reviewed });

test('dedupe per source item; escalation updates; messages coalesce per thread while unreviewed', () => {
  const note = riskSourceId({ kind: 'note', noteId: 'n1' });
  assert.deepEqual(planAlertWrite([], note, 'medium'), { kind: 'create' });
  assert.equal(planAlertWrite([a('x', note, 'MEDIUM')], note, 'medium').kind, 'skip');
  assert.equal(planAlertWrite([a('x', note, 'HIGH', true)], note, 'medium').kind, 'skip');
  assert.deepEqual(planAlertWrite([a('x', note, 'MEDIUM')], note, 'high'), { kind: 'update', alertId: 'x', escalated: true });
  assert.deepEqual(planAlertWrite([a('x', note, 'MEDIUM', true)], note, 'high'), { kind: 'create' });

  const prefix = threadSourcePrefix('t1');
  const m1 = riskSourceId({ kind: 'message', threadId: 't1', messageId: 'm1' });
  const m2 = riskSourceId({ kind: 'message', threadId: 't1', messageId: 'm2' });
  assert.deepEqual(planAlertWrite([a('x', m1, 'MEDIUM')], m2, 'medium', prefix), { kind: 'skip', alertId: 'x', reason: 'coalesced' });
  assert.deepEqual(planAlertWrite([a('x', m1, 'MEDIUM')], m2, 'high', prefix), { kind: 'update', alertId: 'x', escalated: true });
  assert.deepEqual(planAlertWrite([a('x', m1, 'MEDIUM', true)], m2, 'medium', prefix), { kind: 'create' });
});

test('routing: assigned clinician always, crisis responders on HIGH, locked users withheld', () => {
  const responders = [{ id: 'cr1', role: 'CRISIS_RESPONDER' }, { id: 'cr2', role: 'CRISIS_RESPONDER' }];
  const med = alertRecipients({ severity: 'medium', assignedClinicianId: 'c1', crisisResponders: responders, lockedUserIds: new Set() });
  assert.deepEqual(med.userIds, ['c1']);
  const high = alertRecipients({ severity: 'high', assignedClinicianId: 'c1', crisisResponders: responders, lockedUserIds: new Set(['cr2']) });
  assert.deepEqual(high.userIds, ['c1', 'cr1']);
  assert.equal(high.withheldProtected, 1);
});

test('protected records: description has no quote; banner shows "Protected record" + break-glass only', () => {
  const scan = scanRiskText("I'm going to kill myself tonight", 'patient_message');
  const open = buildAlertDescription({ kind: 'message', hits: scan.hits, protectedRecord: false, severity: 'high' });
  assert.match(open, /kill myself/);
  const prot = buildAlertDescription({ kind: 'message', hits: scan.hits, protectedRecord: true, severity: 'high' });
  assert.doesNotMatch(prot, /kill myself/);

  const alerts = [{ id: 'r1', severity: 'HIGH' as const, reviewed: false, createdAt: new Date(0) }];
  const masked = buildBannerView({ clientId: 'c1', alerts, locked: true, hits: scan.hits, safetyPlanOnFile: false, phone: '4105550000' });
  assert.equal(masked.active && masked.protected, true);
  assert.doesNotMatch(JSON.stringify(masked), /kill myself|4105550000/);
  if (masked.active && masked.protected) assert.equal(masked.label, 'Protected record');

  const shown = buildBannerView({ clientId: 'c1', alerts, locked: false, hits: scan.hits, safetyPlanOnFile: false, phone: null });
  const openView = shown as Extract<typeof shown, { protected: false }>;
  assert.equal(openView.protected, false);
  assert.ok(openView.hits[0]!.quote.includes('kill myself'));
  assert.match(openView.reminder, /988/);
  assert.equal(openView.safetyPlanOnFile, false);
  assert.deepEqual(buildBannerView({ clientId: 'c1', alerts: [], locked: false, hits: [], safetyPlanOnFile: null, phone: null }), { active: false });
});

test('patient crisis payload: 988, 911, text HOME to 741741; never the matched words', () => {
  const p = patientSafetyPayload('high');
  const s = JSON.stringify(p);
  assert.match(s, /988/);
  assert.match(s, /911/);
  assert.match(CRISIS_RESOURCES.textLine.detail, /Text HOME to 741741/);
});

// ─── Pipeline over mock dependencies ─────────────────────────────────────────

function mockDeps(opts: { consent?: 'declined' | 'allowed'; invoke?: RiskWatchDeps['invoke']; protectedClient?: boolean; locked?: string[] } = {}) {
  const alerts: { id: string; sourceId: string; severity: 'HIGH' | 'MEDIUM' | 'LOW'; reviewed: boolean; data: Record<string, unknown> }[] = [];
  const audits: AuditLogEntry[] = [];
  const thread = { id: 't1', risk: 'LOW' as 'HIGH' | 'MEDIUM' | 'LOW' };
  let invokes = 0;
  const deps: RiskWatchDeps = {
    db: {
      client: { findFirst: async () => ({ id: 'c1', name: 'Test Client', assignedToId: 'u1', legalFirstName: 'Test', legalLastName: 'Client' }) },
      riskAlert: {
        findMany: async (args: unknown) => {
          const w = (args as { where: { sourceId: string | { startsWith: string } } }).where;
          return alerts
            .filter((x) => (typeof w.sourceId === 'string' ? x.sourceId === w.sourceId : x.sourceId.startsWith(w.sourceId.startsWith)))
            .map(({ id, sourceId, severity, reviewed }) => ({ id, sourceId, severity, reviewed }));
        },
        create: async ({ data }) => {
          const row = { id: `a${alerts.length + 1}`, sourceId: String(data.sourceId), severity: data.severity as 'HIGH', reviewed: false, data };
          alerts.push(row);
          return { id: row.id };
        },
        update: async ({ where, data }) => {
          const row = alerts.find((x) => x.id === where.id)!;
          row.severity = data.severity as 'HIGH';
          row.data = { ...row.data, ...data };
          return { id: row.id };
        },
      },
      messageThread: {
        findFirst: async () => thread,
        update: async ({ data }) => {
          thread.risk = data.risk;
          return thread;
        },
      },
      user: { findMany: async () => [{ id: 'cr1', role: 'CRISIS_RESPONDER' }] },
    },
    audit: async (e) => {
      audits.push(e);
    },
    invoke:
      opts.invoke === undefined
        ? async () => {
            invokes += 1;
            return '{"results":[]}';
          }
        : opts.invoke,
    model: 'haiku-test',
    aiConsent: async () => opts.consent ?? 'allowed',
    isProtectedClient: async () => Boolean(opts.protectedClient),
    lockedUsers: async () => new Set(opts.locked ?? []),
  };
  return { deps, alerts, audits, thread, invokes: () => invokes };
}

const msgInput = (text: string, messageId = 'm1') => ({
  organizationId: 'o1',
  clientId: 'c1',
  text,
  source: { kind: 'message' as const, threadId: 't1', messageId },
  actor: { userId: null, role: 'client' },
});

test('HIGH portal message: alert created for the assigned clinician, thread risk raised, crisis payload, audited', async () => {
  const m = mockDeps();
  const r = await runRiskWatch(msgInput("I'm going to kill myself tonight"), m.deps);
  assert.equal(r.action, 'created');
  assert.equal(r.severity, 'high');
  assert.equal(r.patientSafety?.level, 'high');
  assert.equal(m.alerts[0]!.data.type, RISK_WATCH_TYPE);
  assert.equal(m.alerts[0]!.data.clinicianId, 'u1');
  assert.equal(m.alerts[0]!.data.severity, 'HIGH');
  assert.equal(m.thread.risk, 'HIGH');
  assert.equal(m.invokes(), 0, 'HIGH is never sent to the AI');
  const create = m.audits.find((x) => x.action === 'CREATE')!;
  assert.equal(create.resourceType, 'riskAlert');
  assert.equal((create.metadata as { crisisResponders: number }).crisisResponders, 1);
  assert.ok(!JSON.stringify(create.metadata).includes('kill myself'), 'no PHI text in audit metadata');

  // same message again → duplicate; next message in the thread coalesces
  assert.equal((await runRiskWatch(msgInput("I'm going to kill myself tonight"), m.deps)).action, 'skipped');
  assert.equal((await runRiskWatch(msgInput('I wish I was dead', 'm2'), m.deps)).skipReason, 'coalesced');
  assert.equal(m.alerts.length, 1);
});

test('AI downgrade of an ambiguous MEDIUM is applied and logged as AI_ACCESS', async () => {
  const m = mockDeps({
    invoke: async ({ userPrompt }) => {
      const id = /id=(\S+)/.exec(userPrompt)![1];
      return JSON.stringify({ results: [{ id, riskPresent: false, aboutPatient: true, negated: false, figurative: true }] });
    },
  });
  const r = await runRiskWatch(msgInput('I just want to end it'), m.deps);
  assert.equal(r.ruleSeverity, 'medium');
  assert.equal(r.severity, 'low');
  const ai = m.audits.find((x) => x.action === 'AI_ACCESS')!;
  assert.equal(ai.outcome, 'SUCCESS');
  assert.deepEqual((ai.metadata as { downgrades: string[] }).downgrades, ['end-it:medium->low:figurative']);
  assert.equal(r.patientSafety, null);
});

test('AI consent declined or Bedrock unavailable → rules only', async () => {
  let called = false;
  const declined = mockDeps({
    consent: 'declined',
    invoke: async () => {
      called = true;
      return '{}';
    },
  });
  const r = await runRiskWatch(msgInput('I just want to end it'), declined.deps);
  assert.equal(called, false);
  assert.equal(r.ai.reason, 'consent-declined');
  assert.equal(r.severity, 'medium');
  assert.equal(declined.audits.some((x) => x.action === 'AI_ACCESS'), false);

  const none = mockDeps({ invoke: null });
  const r2 = await runRiskWatch(msgInput('I just want to end it'), none.deps);
  assert.equal(r2.ai.reason, 'not-configured');
  assert.equal(r2.action, 'created');
});

test('Part 2 note: alert text has no quote; locked crisis responders are withheld', async () => {
  const m = mockDeps({ locked: ['cr1'] });
  const r = await runRiskWatch(
    { organizationId: 'o1', clientId: 'c1', text: 'Client attempted suicide last week by overdose.', source: { kind: 'note', noteId: 'n1' }, part2: true, actor: { userId: 'u1', role: 'THERAPIST' } },
    m.deps
  );
  assert.equal(r.severity, 'high');
  assert.doesNotMatch(String(m.alerts[0]!.data.description), /overdose/);
  const meta = m.audits.find((x) => x.action === 'CREATE')!.metadata as { withheldProtected: number; protectedRecord: boolean };
  assert.equal(meta.protectedRecord, true);
  assert.equal(meta.withheldProtected, 1);
  assert.equal(r.patientSafety, null, 'notes never produce patient-facing output');
});

test('no hit → nothing written', async () => {
  const m = mockDeps();
  const r = await runRiskWatch(msgInput('Can I move my appointment to Friday?'), m.deps);
  assert.equal(r.action, 'none');
  assert.equal(m.alerts.length, 0);
  assert.equal(m.audits.length, 0);
});
