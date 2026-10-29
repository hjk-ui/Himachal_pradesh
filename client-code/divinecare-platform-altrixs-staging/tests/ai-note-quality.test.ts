import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import {
  addOnForMinutes,
  cosignChecks,
  cptTimeChecks,
  diagnosisChecks,
  noteCodes,
  planChecks,
  psychotherapyMinutes,
  requiredFieldChecks,
  riskChecks,
  runRuleChecks,
  signatureChecks,
  telehealthChecks,
  timelinessChecks,
  type NoteQualityFacts,
} from '../src/lib/ai/noteQuality/rules';
import {
  buildNarrativeUserPrompt,
  isGroundedQuote,
  mergeNarrative,
  narrativeText,
  parseNarrativeOutput,
  redactNames,
  ruleNarrativeItems,
} from '../src/lib/ai/noteQuality/narrative';
import { decideAiGate, runNoteQualityCheck, type QualityDeps } from '../src/lib/ai/noteQuality/engine';
import { countStatuses, findingsOf, type QualityItem } from '../src/lib/ai/noteQuality/types';

// ─── Fixtures ───────────────────────────────────────────────────────────────

const SESSION = (o: { visit?: string; start?: string; end?: string; extra?: string[] } = {}) =>
  [
    'Session',
    'Patient: Jane Doe',
    'DOB: 1990-01-01 (age 36)',
    'MRN: A1234',
    'Date of service: 2026-10-15',
    'Provider: Sam Rivera, Therapist, LCPC',
    o.visit ?? 'Visit type: In person (POS 11)',
    'Session type: Individual psychotherapy',
    `Start time: ${o.start ?? '10:00'}`,
    `End time: ${o.end ?? '10:45'}`,
    'Session time: 45 min',
    'Service code: 90834',
    'Persons present: client',
    ...(o.extra ?? []),
  ].join('\n');

const PROGRESS_REST = (o: { goals?: boolean; risk?: boolean } = {}) =>
  [
    'Treatment Plan Goals',
    'Active treatment plan: Anxiety plan (signed 2026-09-01)',
    ...(o.goals === false ? [] : ['Goal 1: Reduce panic attacks — Progress made — used paced breathing twice']),
    '',
    'Target Symptoms & Interval History',
    'Target symptoms since last session: Improved',
    'Jane reported two panic attacks this week, down from five, and missed one day of work because of anxiety.',
    '',
    'Interventions',
    'Interventions used: CBT, Mindfulness / relaxation',
    'Intervention detail: Practiced cognitive restructuring of catastrophic thoughts about work and paced breathing.',
    '',
    'Mental Status Exam',
    'Appearance: Well groomed',
    '',
    'Risk Check',
    ...(o.risk === false ? [] : ['Suicidal ideation: Denies', 'Homicidal ideation: Denies', 'Overall risk level: Low']),
    '',
    'Response to Interventions',
    'Engagement: Engaged',
    'Response to interventions: Client identified two alternative thoughts and reported anxiety dropped from 7 to 4.',
    '',
    'Impression',
    'Panic symptoms are improving with CBT.',
    '',
    'Plan & Homework',
    'Next session: 1 week',
    'Homework: Thought record three times this week',
    '',
    'Review',
  ].join('\n');

function facts(over: Omit<Partial<NoteQualityFacts>, 'note'> & { note?: Partial<NoteQualityFacts['note']> } = {}): NoteQualityFacts {
  const base: NoteQualityFacts = {
    mode: 'cosign',
    note: {
      id: 'note-1',
      body: `${SESSION()}\n\n${PROGRESS_REST()}`,
      noteType: 'Therapy Progress',
      dateOfService: '2026-10-15',
      durationMinutes: 45,
      cptCode: '90834',
      placeOfService: '11',
      telehealth: false,
      part2: false,
      createdAt: '2026-10-15T15:00:00.000Z',
    },
    author: {
      id: 'author-1',
      role: 'THERAPIST',
      onLicensureTrack: false,
      licenseLevel: { level: 'PRE_LICENSED', source: 'credential' },
      credentials: [{ title: 'LGPC', expiresAt: '2027-06-30T00:00:00.000Z' }],
    },
    workflow: {
      status: 'SIGNED',
      signedAt: '2026-10-15T16:00:00.000Z',
      attestedAt: '2026-10-15T16:00:00.000Z',
      signedByName: 'Sam Rivera',
      cosignRequired: true,
    },
    claims: [],
    chartDiagnosisCodes: ['F41.0'],
    plan: { required: true, ok: true, message: '"Anxiety plan" is active (review due 2027-03-01).' },
    riskFlags: [],
    settings: { noteSignDeadlineHours: 24, telehealthModifierDefault: '95', timeZone: 'America/New_York' },
    now: '2026-10-16T12:00:00.000Z',
  };
  return { ...base, ...over, note: { ...base.note, ...(over.note ?? {}) } };
}

const byId = (items: QualityItem[], id: string) => {
  const hit = items.find((i) => i.id === id);
  assert.ok(hit, `missing item ${id}: ${items.map((i) => i.id).join(', ')}`);
  return hit!;
};

// ─── Required fields ────────────────────────────────────────────────────────

test('a complete Therapy Progress note passes the template required items', () => {
  const items = requiredFieldChecks(facts());
  assert.equal(byId(items, 'required.template').status, 'pass');
  assert.equal(items.find((i) => i.id === 'required.placeholders'), undefined);
});

test('missing required template items fail with a one-line fix', () => {
  const body = `${SESSION()}\n\n${PROGRESS_REST({ risk: false })}`;
  const item = byId(requiredFieldChecks(facts({ note: { body } })), 'required.template');
  assert.equal(item.status, 'fail');
  assert.match(item.detail, /Suicidal ideation is required/);
  assert.ok(item.fix && !item.fix.includes('\n'));
});

test('unfilled blanks and AI DRAFT markers are flagged', () => {
  const body = `${SESSION()}\n\n${PROGRESS_REST()}\nHomework detail [___]`;
  assert.equal(byId(requiredFieldChecks(facts({ note: { body } })), 'required.placeholders').status, 'fail');
});

// ─── CPT / time rules ───────────────────────────────────────────────────────

test('psychotherapy time rule: 45 min supports 90834, not 90837', () => {
  assert.equal(byId(cptTimeChecks(facts()), 'time.rule').status, 'pass');
  const wrong = byId(cptTimeChecks(facts({ note: { cptCode: '90837' } })), 'time.rule');
  assert.equal(wrong.status, 'fail');
  assert.match(wrong.fix || '', /90834/);
});

test('a documented code override reason turns a time-rule mismatch into a warning', () => {
  const body = `${SESSION({ extra: ['Code override reason: Payer contract bills 90837 for extended crisis follow-up'] })}\n\n${PROGRESS_REST()}`;
  assert.equal(byId(cptTimeChecks(facts({ note: { body, cptCode: '90837' } })), 'time.rule').status, 'warn');
});

test('start / end time must agree with the recorded duration', () => {
  const body = `${SESSION({ start: '10:00', end: '10:30' })}\n\n${PROGRESS_REST()}`;
  const item = byId(cptTimeChecks(facts({ note: { body } })), 'time.consistency');
  assert.equal(item.status, 'fail');
  assert.match(item.detail, /30 min/);
});

test('under 16 minutes is not billable as psychotherapy', () => {
  const body = `${SESSION({ start: '10:00', end: '10:12' })}\n\n${PROGRESS_REST()}`;
  const item = byId(cptTimeChecks(facts({ note: { body, durationMinutes: 12, cptCode: '90832' } })), 'time.rule');
  assert.equal(item.status, 'fail');
});

test('family psychotherapy needs 26 minutes and the right patient-present code', () => {
  const short = byId(cptTimeChecks(facts({ note: { body: 'Start time: 10:00\nEnd time: 10:20', durationMinutes: 20, cptCode: '90847', noteType: 'SOAP' } })), 'time.rule');
  assert.equal(short.status, 'fail');
  const body = 'Session type: Family psychotherapy with patient present\nStart time: 10:00\nEnd time: 10:50';
  const wrongCode = byId(cptTimeChecks(facts({ note: { body, durationMinutes: 50, cptCode: '90846', noteType: 'SOAP' } })), 'time.rule');
  assert.equal(wrongCode.status, 'fail');
  assert.match(wrongCode.detail, /patient was present/);
  assert.equal(byId(cptTimeChecks(facts({ note: { body, durationMinutes: 50, cptCode: '90847', noteType: 'SOAP' } })), 'time.rule').status, 'pass');
});

test('90792 by a non-prescriber fails; 90791 is not time-based', () => {
  assert.equal(byId(cptTimeChecks(facts({ note: { cptCode: '90792', noteType: 'Therapy Intake' } })), 'time.rule').status, 'fail');
  assert.equal(byId(cptTimeChecks(facts({ note: { cptCode: '90791', noteType: 'Therapy Intake' } })), 'time.rule').status, 'pass');
  assert.equal(
    byId(cptTimeChecks(facts({ note: { cptCode: '90792', noteType: 'Therapy Intake' }, author: { ...facts().author, role: 'PSYCHIATRIST' } })), 'time.rule').status,
    'pass'
  );
});

test('E/M add-ons require separately documented psychotherapy time matching the add-on', () => {
  const header = (extra: string) => `Header\nTotal time: 40 min\nE/M code: 99214\nPsychotherapy add-on: +90833 — Psychotherapy 30 min with E/M\n${extra}`;
  const pmm = { noteType: 'Psych Med Mgmt', durationMinutes: 40, cptCode: '99214' };
  assert.deepEqual(noteCodes('99214', header('')), { base: '99214', addOn: '90833' });

  const none = byId(cptTimeChecks(facts({ note: { ...pmm, body: header('') } })), 'time.addon');
  assert.equal(none.status, 'fail');
  assert.match(none.detail, /no separate psychotherapy time/);

  assert.equal(byId(cptTimeChecks(facts({ note: { ...pmm, body: header('Psychotherapy time: 20 min (supportive therapy, separate from E/M)') } })), 'time.addon').status, 'pass');

  const wrong = byId(cptTimeChecks(facts({ note: { ...pmm, durationMinutes: 60, body: header('Psychotherapy time: 40 min') } })), 'time.addon');
  assert.equal(wrong.status, 'fail');
  assert.match(wrong.detail, /\+90836/);

  const notSeparate = byId(cptTimeChecks(facts({ note: { ...pmm, durationMinutes: 20, body: header('Psychotherapy time: 20 min') } })), 'time.addon');
  assert.equal(notSeparate.status, 'fail');
  assert.match(notSeparate.detail, /not less than the total visit time/);

  const noEm = byId(cptTimeChecks(facts({ note: { noteType: 'SOAP', cptCode: '90833', body: 'Psychotherapy time: 20 min', durationMinutes: 30 } })), 'time.addon');
  assert.equal(noEm.status, 'fail');
  assert.match(noEm.detail, /needs an E\/M code/);
});

test('add-on time thresholds and psychotherapy minute parsing', () => {
  assert.equal(addOnForMinutes(15), null);
  assert.equal(addOnForMinutes(16), '90833');
  assert.equal(addOnForMinutes(37), '90833');
  assert.equal(addOnForMinutes(38), '90836');
  assert.equal(addOnForMinutes(53), '90838');
  assert.equal(psychotherapyMinutes('Psychotherapy time: 25 minutes'), 25);
  assert.equal(psychotherapyMinutes('Spent 18 min of separate psychotherapy on coping skills'), 18);
  assert.equal(psychotherapyMinutes('No time recorded'), null);
});

test('a note with no CPT code fails the service code check', () => {
  assert.equal(byId(cptTimeChecks(facts({ note: { cptCode: null } })), 'time.code').status, 'fail');
});

// ─── Telehealth ─────────────────────────────────────────────────────────────

const TELE_VISIT = 'Visit type: Telehealth (POS 10 — patient home, modifier 95)';

test('a complete telehealth note passes POS, modifier, location and consent', () => {
  const body = `${SESSION({ visit: TELE_VISIT, extra: ['Patient location during telehealth: home in Bowie, MD', 'Telehealth consent: Verbal consent obtained'] })}\n\n${PROGRESS_REST()}`;
  const items = telehealthChecks(facts({ note: { body, telehealth: true, placeOfService: '10' } }));
  for (const id of ['telehealth.pos', 'telehealth.modifier', 'telehealth.location', 'telehealth.consent']) assert.equal(byId(items, id).status, 'pass', id);
});

test('telehealth with POS 11, no location and no consent fails each item', () => {
  const body = `${SESSION({ visit: 'Visit type: Telehealth (POS 11)' })}\n\n${PROGRESS_REST()}`;
  const items = telehealthChecks(facts({ note: { body, telehealth: true, placeOfService: '11' } }));
  assert.equal(byId(items, 'telehealth.pos').status, 'fail');
  assert.equal(byId(items, 'telehealth.location').status, 'fail');
  assert.equal(byId(items, 'telehealth.consent').status, 'fail');
});

test('missing modifier 95 fails once a claim exists, warns before; practice default GT is respected', () => {
  const body = 'Patient location during telehealth: home\nTelehealth consent: Written consent on file';
  const base = { body, telehealth: true, placeOfService: '02', noteType: 'SOAP' };
  assert.equal(byId(telehealthChecks(facts({ note: base })), 'telehealth.modifier').status, 'warn');
  const claim = { id: 'c1', cptCode: '90834', icd10Codes: ['F41.0'], placeOfService: '02', modifiers: [] as string[] };
  assert.equal(byId(telehealthChecks(facts({ note: base, claims: [claim] })), 'telehealth.modifier').status, 'fail');
  assert.equal(byId(telehealthChecks(facts({ note: base, claims: [{ ...claim, modifiers: ['95'] }] })), 'telehealth.modifier').status, 'pass');
  const gt = facts({ note: base, claims: [{ ...claim, modifiers: ['GT'] }], settings: { ...facts().settings, telehealthModifierDefault: 'GT' } });
  assert.equal(byId(telehealthChecks(gt), 'telehealth.modifier').status, 'pass');
});

test('an in-person note with a telehealth POS is a mismatch warning; plain in-person is n/a', () => {
  assert.equal(byId(telehealthChecks(facts({ note: { placeOfService: '10' } })), 'telehealth.mismatch').status, 'warn');
  assert.equal(byId(telehealthChecks(facts()), 'telehealth.na').status, 'na');
});

// ─── Diagnosis / plan link / risk ───────────────────────────────────────────

test('diagnosis present on chart and matching the claim', () => {
  assert.equal(byId(diagnosisChecks(facts()), 'diagnosis.present').status, 'pass');
  assert.equal(byId(diagnosisChecks(facts()), 'diagnosis.claim').status, 'na');
  const claim = { id: 'c1', cptCode: '90834', icd10Codes: ['F32.1'], placeOfService: '11', modifiers: [] as string[] };
  assert.equal(byId(diagnosisChecks(facts({ claims: [claim] })), 'diagnosis.claim').status, 'warn');
  assert.equal(byId(diagnosisChecks(facts({ claims: [{ ...claim, icd10Codes: [] }] })), 'diagnosis.claim').status, 'fail');
  assert.equal(byId(diagnosisChecks(facts({ claims: [{ ...claim, icd10Codes: ['F410'] }] })), 'diagnosis.claim').status, 'pass');
  assert.equal(byId(diagnosisChecks(facts({ chartDiagnosisCodes: [] })), 'diagnosis.present').status, 'fail');
});

test('plan link: active plan and a marked goal pass; no plan or no goal fails; intake is n/a', () => {
  const ok = planChecks(facts());
  assert.equal(byId(ok, 'plan.active').status, 'pass');
  assert.equal(byId(ok, 'plan.goal').status, 'pass');

  const noPlan = planChecks(facts({ plan: { required: true, ok: false, message: 'No treatment plan is on file for this client.' } }));
  assert.equal(byId(noPlan, 'plan.active').status, 'fail');

  const noGoal = planChecks(facts({ note: { body: `${SESSION()}\n\n${PROGRESS_REST({ goals: false })}` } }));
  assert.equal(byId(noGoal, 'plan.goal').status, 'fail');

  assert.equal(byId(planChecks(facts({ plan: null })), 'plan.active').status, 'warn');
  assert.equal(byId(planChecks(facts({ note: { noteType: 'Therapy Intake', cptCode: '90791' } })), 'plan.active').status, 'na');
});

test('risk assessment is required when the chart has risk flags', () => {
  const body = `${SESSION()}\n\n${PROGRESS_REST({ risk: false })}`;
  assert.equal(byId(riskChecks(facts({ note: { body }, riskFlags: ['client risk level is High'] })), 'risk.assessment').status, 'fail');
  assert.equal(byId(riskChecks(facts({ riskFlags: ['client risk level is High'] })), 'risk.assessment').status, 'pass');
  assert.equal(byId(riskChecks(facts({ note: { body } })), 'risk.assessment').status, 'na');
});

// ─── Signature, timeliness, co-sign reason ──────────────────────────────────

test('signature and credentials', () => {
  assert.equal(byId(signatureChecks(facts()), 'signature.signed').status, 'pass');
  assert.equal(byId(signatureChecks(facts()), 'signature.credentials').status, 'pass');
  const expired = facts({ author: { ...facts().author, credentials: [{ title: 'LGPC', expiresAt: '2026-01-01T00:00:00.000Z' }] } });
  assert.equal(byId(signatureChecks(expired), 'signature.credentials').status, 'fail');
  assert.equal(byId(signatureChecks(facts({ author: { ...facts().author, credentials: [] } })), 'signature.credentials').status, 'warn');
  assert.equal(byId(signatureChecks(facts({ mode: 'presign', workflow: null })), 'signature.signed').status, 'na');
});

test('late signing is measured from the session end on the practice clock', () => {
  // Session ended 10:45 EDT = 14:45Z; signed 16:00Z → on time
  assert.equal(byId(timelinessChecks(facts()), 'timeliness.sign').status, 'pass');
  const late = byId(timelinessChecks(facts({ workflow: { ...facts().workflow!, signedAt: '2026-10-17T15:00:00.000Z' } })), 'timeliness.sign');
  assert.equal(late.status, 'warn');
  assert.match(late.detail, /deadline is 24 h/);
  // Pre-sign on a draft compares with now
  const draft = byId(timelinessChecks(facts({ mode: 'presign', workflow: null, now: '2026-10-20T12:00:00.000Z' })), 'timeliness.sign');
  assert.equal(draft.status, 'warn');
  assert.match(draft.detail, /Signing now would be/);
  const wide = facts({ workflow: { ...facts().workflow!, signedAt: '2026-10-17T15:00:00.000Z' }, settings: { ...facts().settings, noteSignDeadlineHours: 72 } });
  assert.equal(byId(timelinessChecks(wide), 'timeliness.sign').status, 'pass');
});

test('co-sign reason names the pre-licensed rule', () => {
  const item = byId(cosignChecks(facts()), 'cosign.reason');
  assert.equal(item.status, 'pass');
  assert.match(item.detail, /pre-licensed/);
  const licensed = facts({ author: { ...facts().author, licenseLevel: { level: 'LICENSED', source: 'credential' } }, workflow: { ...facts().workflow!, cosignRequired: false } });
  assert.equal(byId(cosignChecks(licensed), 'cosign.reason').status, 'na');
  const role = facts({ author: { ...facts().author, role: 'CASE_MANAGER', licenseLevel: null } });
  assert.match(byId(cosignChecks(role), 'cosign.reason').detail, /case manager/);
});

test('every rule item has a fix when it is not passing, and pass items carry none', () => {
  const body = `${SESSION({ visit: 'Visit type: Telehealth (POS 11)' })}\n\n${PROGRESS_REST({ risk: false, goals: false })}`;
  const items = runRuleChecks(facts({ note: { body, telehealth: true, cptCode: '90837' }, riskFlags: ['client risk level is High'] }));
  for (const i of items) {
    if (i.status === 'warn' || i.status === 'fail') assert.ok(i.fix, `no fix for ${i.id}`);
    if (i.status === 'pass') assert.equal(i.fix, undefined, `pass item ${i.id} has a fix`);
    assert.equal(i.source, 'rule');
  }
  const counts = countStatuses(items);
  assert.ok(counts.fail >= 4);
  assert.equal(findingsOf(items).length, counts.fail + counts.warn);
});

// ─── Narrative: minimal text, grounding ─────────────────────────────────────

test('narrative text drops the header and replaces names', () => {
  const sent = narrativeText({ noteType: 'Therapy Progress', body: `${SESSION()}\n\n${PROGRESS_REST()}`, clientName: 'Jane Doe', authorName: 'Sam Rivera' });
  assert.doesNotMatch(sent.text, /Jane|Doe|Rivera|MRN|DOB|A1234|1990-01-01/);
  assert.match(sent.text, /\[client\] reported two panic attacks/);
  assert.ok(!sent.sectionTitles.includes('Session') && !sent.sectionTitles.includes('Review'));
  assert.ok(sent.sectionTitles.includes('Interventions'));
  assert.equal(redactNames('Call 410-555-1234 or jane@example.com', []), 'Call [phone] or [email]');
});

test('addenda added after signing are reviewed too', () => {
  const body = `${SESSION()}\n\n${PROGRESS_REST()}\n\nAddendum (2026-10-17, Late entry): Next session focus is exposure hierarchy.`;
  const sent = narrativeText({ noteType: 'Therapy Progress', body, clientName: 'Jane Doe', authorName: null });
  assert.ok(sent.sectionTitles.includes('Addenda'));
  assert.match(sent.text, /exposure hierarchy/);
});

test('grounding: only exact substrings of the sent text survive', () => {
  const source = 'Client identified two alternative thoughts and\n reported anxiety dropped from 7 to 4.';
  assert.equal(isGroundedQuote('identified two alternative thoughts and reported anxiety', source), true);
  assert.equal(isGroundedQuote('“identified two alternative thoughts”', source), true);
  assert.equal(isGroundedQuote('identified three alternative thoughts', source), false);
  assert.equal(isGroundedQuote('two', source), false, 'too short to verify');
});

test('parseNarrativeOutput keeps grounded findings and drops ungrounded claims', () => {
  const source = 'Practiced cognitive restructuring of catastrophic thoughts. Next session: 1 week.';
  const out = JSON.stringify({
    checks: [
      { id: 'interventions', status: 'present', quotes: ['Practiced cognitive restructuring of catastrophic thoughts', 'used EMDR bilateral stimulation'], reason: 'CBT technique described.' },
      { id: 'medical_necessity', status: 'present', quotes: ['client has severe functional impairment'], reason: 'Invented.' },
      { id: 'progress_toward_goals', status: 'missing', quotes: ['should be ignored'], reason: 'No goal progress.' },
      { id: 'plan_next_session', status: 'weak', quotes: [], reason: 'No quote.' },
      { id: 'billing_code', status: 'present', quotes: ['Next session: 1 week'] },
    ],
  });
  const parsed = parseNarrativeOutput(`Here you go: ${out}`, source)!;
  assert.ok(parsed);
  assert.equal(parsed.dropped, 2);
  const ids = parsed.findings.map((f) => f.id).sort();
  assert.deepEqual(ids, ['interventions', 'progress_toward_goals']);
  const iv = parsed.findings.find((f) => f.id === 'interventions')!;
  assert.deepEqual(iv.quotes, ['Practiced cognitive restructuring of catastrophic thoughts']);
  for (const f of parsed.findings) for (const q of f.quotes) assert.ok(source.includes(q));
  assert.deepEqual(parsed.findings.find((f) => f.id === 'progress_toward_goals')!.quotes, []);
  assert.equal(parseNarrativeOutput('not json at all', source), null);
});

test('merge uses grounded AI findings and the rule heuristic for the rest', () => {
  const fallback = ruleNarrativeItems({ noteType: 'Therapy Progress', body: `${SESSION()}\n\n${PROGRESS_REST()}`, reason: 'AI gave no verifiable quote' });
  assert.ok(fallback.every((i) => i.source === 'rule'));
  assert.ok(fallback.every((i) => i.status === 'pass'), 'complete template satisfies the rule heuristic');
  const merged = mergeNarrative([{ id: 'interventions', status: 'weak', quotes: ['Practiced cognitive restructuring'], reason: 'Generic.' }], fallback);
  const iv = merged.find((i) => i.id === 'narrative.interventions')!;
  assert.equal(iv.source, 'ai');
  assert.equal(iv.status, 'warn');
  assert.ok(iv.fix);
  assert.deepEqual(iv.quotes, ['Practiced cognitive restructuring']);
  assert.equal(merged.find((i) => i.id === 'narrative.medical_necessity')!.source, 'rule');
  assert.equal(merged.length, 4);
});

test('the rule heuristic flags a free-text note without a plan', () => {
  const items = ruleNarrativeItems({ noteType: 'SOAP', body: 'Subjective\nClient reports depressed mood and poor sleep.\nObjective\nCalm.', reason: 'AI unavailable' });
  assert.equal(items.find((i) => i.id === 'narrative.plan_next_session')!.status, 'warn');
  assert.equal(items.find((i) => i.id === 'narrative.medical_necessity')!.status, 'pass');
});

// ─── Engine: AI gate, audit, fallback ───────────────────────────────────────

type AuditCall = { outcome: string; metadata: Record<string, unknown> };

function deps(over: Partial<QualityDeps> & { calls?: string[]; audits?: AuditCall[] } = {}): QualityDeps {
  const calls = over.calls ?? [];
  const audits = over.audits ?? [];
  return {
    modelId: 'test-haiku',
    invokeModel: over.invokeModel === undefined ? async () => '{"checks":[]}' : over.invokeModel,
    auditAi:
      over.auditAi ??
      (async (e) => {
        calls.push(`audit:${e.outcome}`);
        audits.push(e);
      }),
  };
}

const allowed = { allowed: true } as const;

test('AI gate: Part 2 and declined consent block; missing consent blocks only when required', () => {
  assert.equal(decideAiGate({ part2: true, consent: 'signed', practiceRequiresConsent: false }).allowed, false);
  assert.equal(decideAiGate({ part2: false, consent: 'declined', practiceRequiresConsent: false }).allowed, false);
  assert.equal(decideAiGate({ part2: false, consent: 'missing', practiceRequiresConsent: true }).allowed, false);
  assert.equal(decideAiGate({ part2: false, consent: 'missing', practiceRequiresConsent: false }).allowed, true);
  assert.equal(decideAiGate({ part2: false, consent: 'signed', practiceRequiresConsent: true }).allowed, true);
});

test('audit AI_ACCESS is written before any text goes to the model, with no note text in it', async () => {
  const calls: string[] = [];
  const audits: AuditCall[] = [];
  let prompt = '';
  const report = await runNoteQualityCheck(
    { facts: facts(), names: { client: 'Jane Doe', author: 'Sam Rivera' }, wantAi: true, aiGate: allowed, lastReview: null },
    deps({
      calls,
      audits,
      invokeModel: async ({ userPrompt }) => {
        calls.push('invoke');
        prompt = userPrompt;
        return JSON.stringify({
          checks: [
            { id: 'interventions', status: 'present', quotes: ['Practiced cognitive restructuring of catastrophic thoughts about work'], reason: 'Specific CBT technique.' },
            { id: 'medical_necessity', status: 'present', quotes: ['Jane reported two panic attacks'], reason: 'Uses the real name, so not in the sent text.' },
          ],
        });
      },
    })
  );
  assert.deepEqual(calls, ['audit:SUCCESS', 'invoke']);
  assert.equal(audits[0].metadata.feature, 'note-quality-check');
  assert.equal(audits[0].metadata.model, 'test-haiku');
  const auditText = JSON.stringify(audits);
  assert.doesNotMatch(auditText, /panic|Jane|restructuring/);
  assert.doesNotMatch(prompt, /Jane|Doe|Rivera|A1234/);
  assert.equal(report.ai.state, 'used');
  const iv = report.items.find((i) => i.id === 'narrative.interventions')!;
  assert.equal(iv.source, 'ai');
  // The quote that used the real name is not a substring of the de-identified text: dropped
  assert.equal(report.items.find((i) => i.id === 'narrative.medical_necessity')!.source, 'rule');
  assert.ok(buildNarrativeUserPrompt('x').includes('medical_necessity'));
});

test('Part 2 / consent gate: no model call, a DENIED audit, rule fallback', async () => {
  const calls: string[] = [];
  const audits: AuditCall[] = [];
  const gate = decideAiGate({ part2: true, consent: 'signed', practiceRequiresConsent: true });
  const report = await runNoteQualityCheck(
    { facts: facts({ note: { part2: true } }), names: { client: 'Jane Doe', author: null }, wantAi: true, aiGate: gate, lastReview: null },
    deps({ calls, audits, invokeModel: async () => { calls.push('invoke'); return '{}'; } })
  );
  assert.deepEqual(calls, ['audit:DENIED']);
  assert.equal(audits[0].metadata.reason, 'part2');
  assert.equal(report.ai.state, 'skipped');
  assert.ok(report.items.filter((i) => i.category === 'narrative').every((i) => i.source === 'rule'));
});

test('fallback when Bedrock is not configured, errors, or replies with junk', async () => {
  const input = { facts: facts(), names: { client: 'Jane Doe', author: null }, wantAi: true, aiGate: allowed, lastReview: null };

  const off: string[] = [];
  const r1 = await runNoteQualityCheck(input, deps({ calls: off, invokeModel: null }));
  assert.equal(r1.ai.state, 'unavailable');
  assert.deepEqual(off, [], 'nothing sent, nothing to audit');
  // The 4 narrative checks (person-first language / cloned sections are rule items of their own)
  assert.equal(r1.items.filter((i) => i.category === 'narrative' && !/^narrative\.(language|clone)/.test(i.id)).length, 4);

  const audits: AuditCall[] = [];
  const r2 = await runNoteQualityCheck(input, deps({ audits, invokeModel: async () => { throw new Error('throttled'); } }));
  assert.equal(r2.ai.state, 'unavailable');
  assert.deepEqual(audits.map((a) => a.outcome), ['SUCCESS', 'FAILURE']);
  assert.ok(r2.items.filter((i) => i.category === 'narrative').every((i) => i.source === 'rule'));

  const r3 = await runNoteQualityCheck(input, deps({ invokeModel: async () => 'I cannot help with that.' }));
  assert.equal(r3.ai.state, 'unavailable');
  // Rule checks are always present regardless of the AI outcome
  for (const r of [r1, r2, r3]) assert.ok(r.items.some((i) => i.id === 'time.rule'));
});

test('AI not requested: no audit, no model call, rules only', async () => {
  const calls: string[] = [];
  const report = await runNoteQualityCheck(
    { facts: facts(), names: { client: null, author: null }, wantAi: false, aiGate: allowed, lastReview: null },
    deps({ calls, invokeModel: async () => { calls.push('invoke'); return '{}'; } })
  );
  assert.deepEqual(calls, []);
  assert.equal(report.ai.state, 'skipped');
  assert.equal(report.counts.pass + report.counts.warn + report.counts.fail + report.counts.na, report.items.length);
});

// ─── Wiring ─────────────────────────────────────────────────────────────────

test('routes audit, use Haiku, gate access, and never write the note', () => {
  const root = path.join(__dirname, '..', 'src');
  const check = fs.readFileSync(path.join(root, 'app/api/notes/[id]/quality-check/route.ts'), 'utf8');
  const review = fs.readFileSync(path.join(root, 'app/api/notes/[id]/quality-check/review/route.ts'), 'utf8');
  assert.match(check, /model: 'HAIKU'/);
  assert.match(check, /action: 'AI_ACCESS'/);
  assert.match(check, /checkQualityAccess/);
  assert.match(review, /NOTE_QUALITY_RETURN/);
  assert.match(review, /cosignProgressNote/);
  for (const src of [check, review]) assert.doesNotMatch(src, /progressNote\.(update|upsert|create|delete)/);
  const engine = fs.readFileSync(path.join(root, 'lib/ai/noteQuality/engine.ts'), 'utf8');
  assert.doesNotMatch(engine, /@\/lib\/db\/prisma|bedrockService/);
  const panel = fs.readFileSync(path.join(root, 'components/ai/NoteQualityPanel.tsx'), 'utf8');
  assert.match(panel, /Suggestions only/);
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'docs', 'ai-note-quality.md')));
});
