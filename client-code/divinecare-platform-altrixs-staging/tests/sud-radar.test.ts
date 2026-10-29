import assert from 'node:assert/strict';
import { test } from 'node:test';
import Module, { createRequire } from 'node:module';
import {
  buildDiagnosisFindings,
  classifySudCode,
  extractSudCodes,
  hasNonNicotineSudCode,
  type ChartedCode,
} from '../src/lib/clinical/sudRadar/codes';
import { isAboutOthers, isNegated, quoteSentence, scanText, QUOTE_MAX } from '../src/lib/clinical/sudRadar/keywords';
import { buildNoteFinding, collectNoteHits } from '../src/lib/clinical/sudRadar/notes';
import { planReconcile, type ExistingSignal } from '../src/lib/clinical/sudRadar/reconcile';
import { applyAiVerdicts, confirmHitsWithAi } from '../src/lib/clinical/sudRadar/ai';
import { runSudRadarScan, type SudRadarDb } from '../src/lib/clinical/sudRadar/scan';

// Synthetic ids and text only; no real patient data.

const dx = (code: string, description: string | null = null, sourceType: ChartedCode['sourceType'] = 'diagnosis'): ChartedCode => ({
  code,
  description,
  sourceType,
  sourceId: 'c1',
  sourceLabel: 'Chart diagnosis',
  date: null,
  href: '/dashboard/clients/c1',
});

// ─── Diagnosis path ──────────────────────────────────────────────────────────

test('code → substance class, severity and routed action', () => {
  const cases: [string, string, string, string][] = [
    ['F10.20', 'alcohol', 'dependence', 'residential-referral'],
    ['F11.10', 'opioids', 'use-abuse', 'sbirt'],
    ['F12.90', 'cannabis', 'unspecified', 'sbirt'],
    ['F13.20', 'sedatives', 'dependence', 'residential-referral'],
    ['F14.10', 'cocaine', 'use-abuse', 'sbirt'],
    ['F15.20', 'stimulants', 'dependence', 'residential-referral'],
    ['F16.10', 'hallucinogens', 'use-abuse', 'sbirt'],
    ['F18.10', 'inhalants', 'use-abuse', 'sbirt'],
    ['F19.20', 'other', 'dependence', 'residential-referral'],
    ['F10', 'alcohol', 'category', 'sbirt'],
  ];
  for (const [code, substance, level, action] of cases) {
    const info = classifySudCode(code)!;
    assert.equal(info.substance, substance, code);
    assert.equal(info.level, level, code);
    assert.equal(info.action, action, code);
  }
  assert.equal(classifySudCode('F41.1'), null);
  assert.equal(classifySudCode('F20.9'), null);
});

test('withdrawal codes route opioid / alcohol use to level-of-care even below dependence', () => {
  assert.equal(classifySudCode('F11.13')!.withdrawal, true);
  assert.equal(classifySudCode('F11.13')!.action, 'residential-referral');
  assert.equal(classifySudCode('F10.930')!.action, 'residential-referral');
  assert.equal(classifySudCode('F10.231')!.withdrawal, true);
  // Cannabis withdrawal at use level stays SBIRT
  assert.equal(classifySudCode('F12.13')!.action, 'sbirt');
});

test('remission (.x1 or "in remission") → chart documentation, low priority', () => {
  for (const code of ['F10.21', 'F11.11', 'F12.91']) {
    const info = classifySudCode(code)!;
    assert.equal(info.remission, true, code);
    assert.equal(info.action, 'chart-documentation', code);
  }
  assert.equal(classifySudCode('F10.20', 'Alcohol use disorder, severe, in early remission')!.remission, true);
  const [f] = buildDiagnosisFindings({ clientId: 'c1', codes: [dx('F10.21')], hasRecentScreening: true });
  assert.equal(f.routedAction, 'chart-documentation');
  assert.equal(f.priority, 'low');
  assert.equal(f.needsScreening, false, 'remission-only does not need a screen');
});

test('F17 nicotine is excluded from referral routing and gets a separate cessation signal', () => {
  assert.equal(classifySudCode('F17.210')!.action, 'tobacco-cessation');
  const findings = buildDiagnosisFindings({ clientId: 'c1', codes: [dx('F17.210'), dx('F10.10')], hasRecentScreening: true });
  assert.equal(findings.length, 2);
  const sud = findings.find((x) => x.routedAction !== 'tobacco-cessation')!;
  const tob = findings.find((x) => x.routedAction === 'tobacco-cessation')!;
  assert.deepEqual(sud.codes, ['F10.10']);
  assert.equal(sud.routedAction, 'sbirt');
  assert.deepEqual(tob.codes, ['F17.210']);
  assert.equal(tob.priority, 'low');
  assert.match(tob.recommendation, /not routed for SUD referral/);
  assert.notEqual(sud.fingerprint, tob.fingerprint);
  assert.equal(hasNonNicotineSudCode(['F17.210']), false);
  assert.equal(hasNonNicotineSudCode(['F17.210', 'F12.90']), true);
});

test('codes are grouped per client; the most urgent action wins; descriptions are never invented', () => {
  const [f] = buildDiagnosisFindings({
    clientId: 'c1',
    codes: [dx('F12.90'), dx('F11.20', 'Opioid dependence, uncomplicated', 'problem-list'), dx('F12.90', 'Cannabis use, unspecified')],
    hasRecentScreening: true,
  });
  assert.deepEqual(f.codes, ['F11.20', 'F12.90']);
  assert.equal(f.routedAction, 'residential-referral');
  assert.equal(f.priority, 'urgent');
  assert.equal(f.confidence, 'high');
  assert.match(f.recommendation, /ASAM level-of-care assessment; residential\/IOP referral if indicated/);
  assert.deepEqual(f.evidence.map((e) => e.quote), ['F11.20 — Opioid dependence, uncomplicated', 'F12.90 — Cannabis use, unspecified']);
  const [bare] = buildDiagnosisFindings({ clientId: 'c1', codes: [dx('F15.10')], hasRecentScreening: true });
  assert.equal(bare.evidence[0].quote, 'F15.10', 'unknown description shows the code only');
});

test('active SUD dx without a screening in 12 months → recommend a screen', () => {
  const [f] = buildDiagnosisFindings({ clientId: 'c1', codes: [dx('F10.10')], hasRecentScreening: false });
  assert.equal(f.needsScreening, true);
  assert.match(f.recommendation, /No SUD screening .* in the last 12 months/);
});

test('extractSudCodes reads comma / semicolon separated fields and normalises dots', () => {
  assert.deepEqual(extractSudCodes('F41.1, F10.20; f1110 F17.210, Z63.0'), ['F10.20', 'F11.10', 'F17.210']);
  assert.deepEqual(extractSudCodes(null), []);
});

// ─── Note path ───────────────────────────────────────────────────────────────

test('negation handling', () => {
  assert.deepEqual(scanText('Patient denies alcohol, tobacco, or drug use.'), []);
  assert.deepEqual(scanText('No history of heroin use.'), []);
  assert.deepEqual(scanText('UDS negative for cocaine.'), []);
  assert.deepEqual(scanText('She has never used marijuana.'), []);
  assert.deepEqual(scanText('Alcohol: denies\nDrugs: none'), []);
  const s = 'Denies alcohol but reports smoking weed daily.';
  const hits = scanText(s);
  assert.deepEqual(hits.map((h) => h.substance), ['cannabis'], 'the terminator "but" ends the negation');
  assert.equal(isNegated('denies alcohol use', 7, 7), true);
  assert.equal(isNegated('Pt drinks alcohol nightly', 10, 7), false);
});

test('family history and relatives are not the patient', () => {
  assert.deepEqual(scanText('Family history of alcoholism in father.'), []);
  assert.deepEqual(scanText('Her father drinks heavily and her brother uses heroin.'), []);
  assert.equal(isAboutOthers('Mother uses cocaine', 12), true);
  assert.equal(scanText('Pt drinks 4 beers with friends on weekends.').length, 1, '"with friends" is company, not the subject');
});

test('prescribed medications, mood "withdrawal", questions and blank checkboxes do not count', () => {
  assert.deepEqual(scanText('Medications: Xanax 0.5 mg bid prn anxiety.'), []);
  assert.deepEqual(scanText('Social withdrawal and isolation noted.'), []);
  assert.deepEqual(scanText('Depression relapse after job loss.'), []);
  assert.deepEqual(scanText('Patient took an intentional overdose of acetaminophen.'), []);
  assert.deepEqual(scanText('Have you ever used heroin?'), []);
  assert.deepEqual(scanText('Substance Use:'), []);
  assert.deepEqual(scanText('Alcohol [ ] Cannabis [ ]'), []);
  assert.equal(scanText('She has been buying Xanax off the street.')[0].substance, 'sedatives');
});

test('note-path confidence and routed actions', () => {
  const heavy = scanText('Pt reports drinking 6 beers daily with morning shakes.')[0];
  assert.equal(heavy.confidence, 'high');
  assert.equal(heavy.action, 'residential-referral', 'heavy daily alcohol');
  const od = scanText('Overdosed on fentanyl last month; Narcan given by EMS.')[0];
  assert.equal(od.action, 'residential-referral');
  assert.equal(scanText('Reports IV drug use.')[0].action, 'residential-referral');
  const coc = scanText('Uses cocaine 2x per week.')[0];
  assert.equal(coc.action, 'sbirt');
  assert.equal(coc.confidence, 'high');
  const plain = scanText('Client mentioned cannabis.')[0];
  assert.equal(plain.confidence, 'low');
  const hist = scanText('History of heroin use, sober since 2019.')[0];
  assert.equal(hist.confidence, 'low');
  assert.equal(hist.action, 'chart-documentation');
  const mat = scanText('Currently on Suboxone 8 mg daily.')[0];
  assert.equal(mat.action, 'chart-documentation');
  assert.equal(scanText('He wants to quit drinking; drinks a fifth of vodka daily.')[0].historical, false);
});

test('evidence quoting trims to ~240 chars around the term and carries the source', () => {
  const filler = 'The patient discussed work stress and sleep at length during the session today. '.repeat(5);
  const sentence = `${filler}She reports drinking 5 beers nightly since the layoff and ${filler}`;
  const q = quoteSentence(sentence, sentence.indexOf('drinking'), 8);
  assert.ok(q.length <= QUOTE_MAX + 2, `quote length ${q.length}`);
  assert.match(q, /drinking 5 beers nightly/);
  assert.ok(q.startsWith('…') && q.endsWith('…'));

  const hits = collectNoteHits([
    { sourceType: 'document', sourceId: 'doc-1', sourceLabel: 'Visit Note — v1.pdf', date: '2026-09-01', href: '/api/files/intake-docs/x', text: 'Pt reports smoking weed daily.' },
    { sourceType: 'progress-note', sourceId: 'note-1', sourceLabel: 'Signed note', date: '2026-10-01', href: '/dashboard/ehr/notes?clientId=c1', text: 'Pt reports smoking weed daily.' },
  ]);
  assert.equal(hits.length, 1, 'the same copied-forward sentence counts once');
  const f = buildNoteFinding('c1', hits)!;
  assert.equal(f.detectionSource, 'note-keyword');
  assert.deepEqual(f.codes, [], 'the note path never infers a code');
  assert.equal(f.evidence[0].sourceLabel, 'Visit Note — v1.pdf');
  assert.equal(f.evidence[0].date, '2026-09-01');
  assert.match(f.recommendation, /never assigns codes/);
});

// ─── Dedupe / resolve ────────────────────────────────────────────────────────

test('reconcile: dedupe, reopen on new evidence, resolve when evidence disappears', () => {
  const [a] = buildDiagnosisFindings({ clientId: 'c1', codes: [dx('F10.20')], hasRecentScreening: true });
  const noteHits = collectNoteHits([{ sourceType: 'progress-note', sourceId: 'n1', sourceLabel: 'n', date: null, href: '/x', text: 'Uses cocaine 2x per week.' }]);
  const b = buildNoteFinding('c2', noteHits)!;

  const first = planReconcile({ existing: [], findings: [a, b, a], scannedClientIds: ['c1', 'c2'] });
  assert.equal(first.creates.length, 2, 'duplicate findings in one scan collapse');

  const existing: ExistingSignal[] = [
    { id: 's1', clientId: 'c1', detectionSource: 'diagnosis', fingerprint: a.fingerprint, status: 'dismissed', evidence: a.evidence, evidenceKeys: a.evidenceKeys },
    { id: 's2', clientId: 'c2', detectionSource: 'note-keyword', fingerprint: b.fingerprint, status: 'reviewed', evidence: [], evidenceKeys: ['old-key'] },
    { id: 's3', clientId: 'c3', detectionSource: 'diagnosis', fingerprint: 'gone', status: 'new', evidence: [] },
    { id: 's4', clientId: 'c3', detectionSource: 'note-keyword', fingerprint: null, status: 'new', evidence: [] },
    { id: 's5', clientId: 'c9', detectionSource: 'diagnosis', fingerprint: 'other', status: 'new', evidence: [] },
    { id: 's6', clientId: 'c3', detectionSource: 'diagnosis', fingerprint: 'old', status: 'resolved', evidence: [] },
  ];
  const plan = planReconcile({ existing, findings: [a, b], scannedClientIds: ['c1', 'c2', 'c3'] });
  assert.equal(plan.creates.length, 0);
  const s1 = plan.updates.find((u) => u.id === 's1')!;
  assert.equal(s1.status, 'dismissed', 'same evidence keeps a dismissal');
  const s2 = plan.updates.find((u) => u.id === 's2')!;
  assert.equal(s2.status, 'new', 'new evidence reopens a reviewed signal');
  assert.match(s2.statusReason!, /New evidence/);
  assert.deepEqual(plan.resolves, ['s3'], 'only scan-created signals of scanned clients resolve; legacy, unscanned and resolved rows are untouched');
  assert.equal(plan.reopened, 1);

  const back = planReconcile({
    existing: [{ id: 's7', clientId: 'c1', detectionSource: 'diagnosis', fingerprint: a.fingerprint, status: 'resolved', evidence: [] }],
    findings: [a],
    scannedClientIds: ['c1'],
  });
  assert.equal(back.updates[0].status, 'new', 'a resolved signal found again reopens');
});

// ─── AI confirmation ─────────────────────────────────────────────────────────

test('AI verdicts: negated / not-patient dropped, current raises low, failure keeps the rules', async () => {
  const hits = collectNoteHits([{ sourceType: 'progress-note', sourceId: 'n1', sourceLabel: 'n', date: null, href: '/x', text: 'Client mentioned cannabis. Client mentioned kratom.' }]);
  assert.equal(hits.length, 2);
  const verdicts = new Map([
    [hits[0].key, { id: hits[0].key, negated: false, aboutPatient: true, current: true, historical: false }],
    [hits[1].key, { id: hits[1].key, negated: true, aboutPatient: true, current: false, historical: false }],
  ]);
  const applied = applyAiVerdicts(hits, verdicts);
  assert.equal(applied.dropped, 1);
  assert.equal(applied.hits[0].confidence, 'medium');
  assert.equal(applied.hits[0].aiVerdict, 'confirmed');

  let prompt = '';
  const failed = await confirmHitsWithAi(hits, async ({ userPrompt }) => {
    prompt = userPrompt;
    throw new Error('throttled');
  });
  assert.equal(failed.ok, false);
  assert.deepEqual(failed.hits, hits);
  assert.ok(prompt.includes('Client mentioned cannabis.') && !prompt.includes('n1'), 'only evidence snippets are sent');
  const garbage = await confirmHitsWithAi(hits, async () => 'not json');
  assert.equal(garbage.ok, false);
});

// ─── Scan over a mock database ───────────────────────────────────────────────

type Row = Record<string, any>;

function inList(v: unknown, cond: any) {
  return cond?.in ? cond.in.includes(v) : v === cond;
}

function makeDb(state: {
  clients: Row[];
  problems?: Row[];
  notes?: Row[];
  docs?: Row[];
  consents?: Row[];
  screenings?: Row[];
}) {
  const signals: Row[] = [];
  let seq = 0;
  const db = {
    client: {
      findMany: async ({ take, cursor }: any) => {
        const sorted = [...state.clients].sort((a, b) => a.id.localeCompare(b.id));
        const start = cursor ? sorted.findIndex((c) => c.id === cursor.id) + 1 : 0;
        return sorted.slice(start, start + take);
      },
    },
    medicalProblem: { findMany: async ({ where }: any) => (state.problems ?? []).filter((p) => inList(p.clientId, where.clientId) && /^F1/i.test(p.icd10Code)) },
    sudScreening: { findMany: async ({ where }: any) => (state.screenings ?? []).filter((s) => inList(s.clientId, where.clientId)) },
    clinicalAssessmentRecord: { findMany: async () => [] },
    progressNote: { findMany: async ({ where }: any) => (state.notes ?? []).filter((n) => inList(n.clientId, where.clientId)) },
    documentIntake: { findMany: async ({ where }: any) => (state.docs ?? []).filter((d) => inList(d.suggestedClientId, where.suggestedClientId)) },
    consentForm: { findMany: async ({ where }: any) => (state.consents ?? []).filter((c) => inList(c.clientId, where.clientId)) },
    sudRadarSignal: {
      findMany: async ({ where }: any) => signals.filter((s) => inList(s.clientId, where.clientId)),
      create: async ({ data }: any) => {
        const row = { id: `sig-${++seq}`, ...data };
        signals.push(row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const row = signals.find((s) => s.id === where.id)!;
        Object.assign(row, data);
        return row;
      },
      updateMany: async ({ where, data }: any) => {
        const rows = signals.filter((s) => where.id.in.includes(s.id));
        rows.forEach((r) => Object.assign(r, data));
        return { count: rows.length };
      },
    },
  };
  return { db: db as unknown as SudRadarDb, signals };
}

test('scan: both paths, batching, dedupe across scans, resolve on dx removal, AI consent', async () => {
  const clients = [
    { id: 'a1', primaryDiagnosisCode: 'F10.20', primaryDiagnosis: 'Alcohol use disorder, moderate', secondaryDiagnoses: 'F41.1' },
    { id: 'a2', primaryDiagnosisCode: 'F33.1', primaryDiagnosis: 'MDD', secondaryDiagnoses: 'F17.210' },
    { id: 'a3', primaryDiagnosisCode: 'F41.1', primaryDiagnosis: 'GAD', secondaryDiagnoses: null },
    { id: 'a4', primaryDiagnosisCode: 'F43.10', primaryDiagnosis: 'PTSD', secondaryDiagnoses: null },
    { id: 'a5', primaryDiagnosisCode: 'F41.1', primaryDiagnosis: 'GAD', secondaryDiagnoses: null },
  ];
  const now = new Date('2026-10-17T12:00:00Z');
  const state = {
    clients,
    problems: [{ id: 'mp1', clientId: 'a1', icd10Code: 'F11.20', name: 'Opioid dependence', description: null, status: 'Active', source: 'drfirst', onsetDate: null, createdAt: now }],
    notes: [
      { id: 'n1', clientId: 'a2', body: 'Pt reports drinking 6 beers daily.', noteType: 'Psych Med Mgmt', dateOfService: now, createdAt: now },
      { id: 'n2', clientId: 'a3', body: 'Patient denies alcohol or drug use.', noteType: null, dateOfService: now, createdAt: now },
      { id: 'n3', clientId: 'a5', body: 'Client mentioned cannabis.', noteType: null, dateOfService: now, createdAt: now },
    ],
    docs: [{ id: 'd1', suggestedClientId: 'a4', fileName: 'visit.pdf', documentType: 'Visit Note', s3RawKey: 'k1', filedAt: now, createdAt: now, extractedText: 'She has been buying Xanax off the street.' }],
    consents: [{ clientId: 'a5', status: 'DECLINED' }],
  };
  const { db, signals } = makeDb(state);
  const audits: Row[] = [];
  let aiCalls = 0;
  const run = () =>
    runSudRadarScan({
      organizationId: 'org',
      actor: { userId: 'u1', role: 'PRACTICE_DIRECTOR' },
      clientWhere: {},
      db,
      now,
      batchSize: 2,
      aiInvoke: async () => {
        aiCalls += 1;
        return '{"results":[]}';
      },
      audit: async (e: any) => {
        audits.push(e);
      },
    });

  const c1 = await run();
  assert.equal(c1.batches, 3);
  assert.equal(c1.clientsScanned, 5);
  // a1 dx (alcohol + opioid via DrFirst problem list), a2 nicotine dx + note (F17 does not block the note path), a4 doc, a5 note
  assert.equal(c1.bySource.diagnosis, 2);
  assert.equal(c1.bySource['note-keyword'], 3);
  assert.equal(c1.created, 5);
  const a1 = signals.find((s) => s.clientId === 'a1')!;
  assert.deepEqual(a1.codes, ['F10.20', 'F11.20']);
  assert.equal(a1.routedAction, 'residential-referral');
  assert.equal(a1.needsScreening, true);
  assert.equal(a1.evidence[0].quote, 'F10.20 — Alcohol use disorder, moderate');
  assert.equal(a1.evidence[1].sourceLabel, 'Problem list (DrFirst)');
  assert.ok(!signals.some((s) => s.clientId === 'a3'), 'negated note → no signal');
  assert.equal(signals.find((s) => s.clientId === 'a4')!.evidence[0].href, '/api/files/intake-docs/k1');
  // AI: a5 declined consent → skipped; a4's hit is high → no call needed
  assert.equal(c1.ai.skippedConsent, 1);
  assert.equal(aiCalls, 0);
  assert.ok(audits.every((a) => !JSON.stringify(a.metadata ?? {}).includes('Xanax')), 'audit has ids/counts only');

  const c2 = await run();
  assert.equal(c2.created, 0, 'second scan dedupes');
  assert.equal(c2.updated, 5);
  assert.equal(signals.length, 5);

  // Diagnosis removed from the chart → resolved, not deleted
  state.clients[0] = { ...clients[0], primaryDiagnosisCode: 'F41.1' };
  state.problems = [];
  const c3 = await run();
  assert.equal(c3.resolved, 1);
  assert.equal(signals.find((s) => s.id === a1.id)!.status, 'resolved');
  assert.equal(signals.length, 5);
});

// ─── Part 2 filtering in GET /api/ehr/scanner/sud-radar ──────────────────────

test('GET sud-radar keeps caseload scoping and hides protected clients the viewer cannot open', async (t) => {
  const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
  const originalLoad = loader._load;
  t.after(() => {
    loader._load = originalLoad;
  });
  let capturedWhere: any = null;
  const audits: any[] = [];
  const rows = [
    { id: 's1', clientId: 'open-client', detectionSource: 'diagnosis', status: 'new', lastSeenAt: null, client: { id: 'open-client', name: 'Synthetic A' } },
    { id: 's2', clientId: 'protected-client', detectionSource: 'note-keyword', status: 'new', lastSeenAt: null, client: { id: 'protected-client', name: 'Synthetic B' } },
  ];
  const mockPrisma = {
    sudRadarSignal: {
      findMany: async ({ where }: any) => {
        capturedWhere = where;
        return rows;
      },
    },
  };
  loader._load = function (id: string, ...args: unknown[]) {
    if (id === 'server-only') return {};
    if (id === '@/lib/db/prisma') return { prisma: mockPrisma };
    if (id === '@/lib/auth/tenant') return { requireOrgContext: async () => ({ ok: true, userId: 'therapist-1', organizationId: 'org', role: 'THERAPIST' }) };
    if (id === '@/lib/audit/requestMeta') return { auditPhiAccess: async (a: any) => { audits.push(a); } };
    if (id === '@/lib/privacy/sensitiveAccess') {
      return {
        lockedSensitiveClientIds: async () => new Set(['protected-client']),
        assertClientPhiAccess: async () => {},
        SensitiveRecordAccessError: class extends Error {},
      };
    }
    return originalLoad.call(this, id, ...args);
  };
  const require = createRequire(import.meta.url);
  const route = require('../src/app/api/ehr/scanner/sud-radar/route');
  const res = await route.GET(new Request('http://localhost/api/ehr/scanner/sud-radar?status=all'));
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.deepEqual(body.signals.map((s: any) => s.id), ['s1']);
  assert.equal(body.stats.sensitiveHidden, 1);
  assert.equal(capturedWhere.organizationId, 'org');
  assert.deepEqual(JSON.stringify(capturedWhere.client).includes('"assignedToId":"therapist-1"'), true, 'caseload role scoped to assigned clients');
  assert.equal(audits[0].metadata.sensitiveHidden, 1);
});
