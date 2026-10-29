import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { ASSESSMENT_CATALOG } from '../src/features/ehr/assessments/catalog';
import {
  BLANK_PRINT_FREE,
  bandsFromScoring,
  blankPrintCheck,
  measureGuide,
  measureGuideEntry,
  paperEntryMode,
  scoreFromTotal,
  SEE_MANUAL,
} from '../src/lib/measures/guide';
import { scoreItems, scoreMeasure } from '../src/lib/measures/scoring';
import { paperAdministeredAt, paperEnteredLabel, scorePaperMeasure } from '../src/lib/measures/paper';
import { buildBlankForm, buildMeasurePrint, howGiven, summarizeSeries } from '../src/lib/measures/printView';
import { measureRequestEmail } from '../src/lib/measures/messages';
import { measureRequestSms } from '../src/lib/sms/templates';
import { planDelivery } from '../src/lib/measures/delivery';
import { SAFETY_ITEMS, WORSENING_POINTS, instrumentById } from '../src/lib/measures/instruments';
import { canAccessPath, CLINIC_NAV_HREFS } from '../src/lib/auth/roleAccess';

// Synthetic data only; no real patient data.
const read = (p: string) => readFileSync(p, 'utf8');
const fill = (id: string, pick: (opts: number[], idx: number) => number) => {
  const i = instrumentById(id)!;
  return Object.fromEntries(i.questions!.map((q, idx) => [q.id, pick(q.options.map((o) => o.score), idx)]));
};

// ─── The guide reads the same source as the scoring ────────────────────────────

test('guide: one entry per catalog instrument', () => {
  const g = measureGuide();
  assert.equal(g.length, ASSESSMENT_CATALOG.length);
  assert.deepEqual(g.map((e) => e.id), ASSESSMENT_CATALOG.map((i) => i.id));
  for (const e of g) {
    assert.ok(e.whatItMeasures.length > 0, e.id);
    assert.ok(e.citation.length > 0, e.id);
    assert.ok(e.frequency.length > 0, e.id);
  }
});

test('guide bands are derived from the scoring: every total lands in the band the scoring returns', () => {
  for (const i of ASSESSMENT_CATALOG) {
    const bands = bandsFromScoring(i.id);
    if (!bands) continue;
    for (const b of bands) {
      for (const t of [b.min, b.max]) {
        assert.equal(scoreFromTotal(i.id, t)!.severity, b.label, `${i.id} total ${t}`);
      }
    }
    // Contiguous, no gaps
    for (let k = 1; k < bands.length; k++) assert.equal(bands[k].min, bands[k - 1].max + 1, i.id);
  }
});

test('guide bands agree with item-level scoring (the form / patient link path)', () => {
  for (const id of ['phq-9', 'gad-7', 'audit', 'pcl-5', 'epds', 'dast-10']) {
    for (const v of [0, 1, 2]) {
      const answers = fill(id, (opts) => opts.includes(v) ? v : opts[0]);
      const r = scoreItems(id, answers);
      assert.equal(r.ok, true, id);
      if (r.ok) {
        const band = bandsFromScoring(id)!.find((b) => r.scored.totalScore >= b.min && r.scored.totalScore <= b.max)!;
        assert.equal(band.label, r.scored.severity, `${id} all ${v}`);
      }
    }
  }
});

test('PHQ-9: published bands, response / remission / 5-point change, item 9 critical', () => {
  const e = measureGuideEntry('phq-9')!;
  assert.deepEqual(e.bands!.map((b) => [b.min, b.max]), [[0, 4], [5, 9], [10, 14], [15, 19], [20, 27]]);
  assert.equal(e.change.worseningPoints, WORSENING_POINTS['phq-9']);
  assert.match(e.change.response!, /50%/);
  assert.match(e.change.remission!, /under 5/);
  assert.ok(e.critical.some((c) => /Item 9/.test(c)));
  assert.deepEqual(e.scoreRange, { min: 0, max: 27 });
  assert.equal(e.itemCount, 9);
});

test('unverified cutoffs show "See the instrument manual", never bands as published', () => {
  for (const id of ['oq-45', 'cbcl', 'ham-a', 'ymrs', 'panss']) {
    const e = measureGuideEntry(id)!;
    assert.equal(e.bands, null, id);
    assert.equal(e.verified, false, id);
  }
  // Read by item pattern / subscale (verified rule, no total band)
  for (const id of ['dass-21', 'asrs', 'mdq']) assert.equal(measureGuideEntry(id)!.bands, null, id);
  const src = read('src/components/measures/MeasureGuidePanel.tsx');
  assert.match(src, /SEE_MANUAL/);
  assert.match(src, /not verified against the manual/);
  assert.equal(SEE_MANUAL, 'See the instrument manual');
  // C-SSRS / AIMS are read by item, not by a total band
  assert.equal(bandsFromScoring('c-ssrs-brief'), null);
  assert.equal(bandsFromScoring('aims'), null);
  assert.match(measureGuideEntry('c-ssrs-brief')!.scoringNote!, /item 3/);
  // Pending licensed copy: no scoring, no bands
  assert.equal(measureGuideEntry('bam')!.bands, null);
  assert.equal(paperEntryMode('bam'), 'none');
});

test('C-SSRS guide text matches its scoring (item 3 moderate, items 4-6 high)', () => {
  const base = fill('c-ssrs-brief', () => 0);
  const c = instrumentById('c-ssrs-brief')!;
  assert.match(c.calculateResult({ ...base, q3: 1 }).severity, /MODERATE/);
  for (const q of ['q4', 'q5', 'q6']) assert.match(c.calculateResult({ ...base, [q]: 1 }).severity, /HIGH/);
});

// ─── Print ────────────────────────────────────────────────────────────────────

test('no blank print for licensed, permission-only or item-less instruments', () => {
  for (const id of ['ybocs', 'ham-d', 'madrs', 'bdi-ii', 'bai', 'isi', 'ess', 'spin', 'sds', 'nida-assist', 'bam', 'crafft', 'mdq', 'rms', 'oci-r']) {
    assert.equal(blankPrintCheck(id).ok, false, id);
    assert.equal(buildBlankForm(id), null, id);
  }
  for (const id of ['phq-9', 'gad-7', 'phq-a', 'c-ssrs-brief', 'audit', 'audit-c', 'dast-10', 'pcl-5', 'epds']) {
    assert.equal(blankPrintCheck(id).ok, true, id);
    const f = buildBlankForm(id)!;
    assert.equal(f.items.length, instrumentById(id)!.questions!.length, id);
  }
  // Every allowed form has its items in the catalog and is not pending a licensed copy
  for (const id of BLANK_PRINT_FREE) {
    const i = instrumentById(id)!;
    assert.ok(i && i.questions?.length && !i.itemContentPending, id);
  }
  assert.equal(blankPrintCheck('unknown-x').ok, false);
  const route = read('src/app/api/clinical/measure-results/blank-form/route.ts');
  assert.match(route, /blankPrintCheck/);
  assert.match(route, /MEASURE_BLANK_PRINT/);
});

test('results print: minimum PHI header, trend, how given, audited', () => {
  const p = buildMeasurePrint({
    instrumentId: 'phq-9',
    client: { name: 'Test Client', dateOfBirth: '1990-01-01', mrn: 'MRN-1' },
    practiceName: 'Practice',
    printedBy: 'Staff A',
    printedAt: new Date('2026-10-27T12:00:00Z'),
    points: [
      { id: 'r2', date: '2026-10-20T12:00:00Z', score: 9, severity: 'Mild', source: 'paper', administrationType: 'Paper', notes: 'Paper — entered by Staff A, LCSW', safetyFlagged: false },
      { id: 'r1', date: '2026-09-20T12:00:00Z', score: 18, severity: 'Moderately Severe', source: 'staff', administrationType: 'Digital', notes: null, safetyFlagged: false },
    ],
    latestItems: [],
  });
  assert.deepEqual(p.header.map((h) => h.label), ['Client', 'Date of birth', 'MRN', 'Practice']);
  assert.equal(p.points[0].id, 'r1');
  assert.equal(p.points[1].how, 'Paper — entered by Staff A, LCSW');
  assert.equal(p.summary.change, -9);
  assert.equal(p.summary.percentChange, -50);
  assert.equal(howGiven({ source: 'patient_portal', administrationType: 'Digital', notes: null }), 'Patient link');
  assert.deepEqual(summarizeSeries([]), { baseline: null, latest: null, change: null, percentChange: null });
  const route = read('src/app/api/clinical/measure-results/print/route.ts');
  assert.match(route, /measureGate\(clientId\)/);
  assert.match(route, /clientWhere/);
  assert.match(route, /MEASURE_PRINT/);
  // Header select: name, DOB, MRN only
  assert.match(route, /select: \{ id: true, name: true, dateOfBirth: true, mrn: true \}/);
});

// ─── Paper upload scores the same way ──────────────────────────────────────────

test('paper items score exactly like the patient link', () => {
  for (const id of ['phq-9', 'gad-7', 'audit', 'pcl-5']) {
    const answers = fill(id, (opts, idx) => opts[idx % opts.length]);
    const link = scoreMeasure(id, answers);
    const paper = scorePaperMeasure({ instrumentId: id, mode: 'items', answers });
    assert.equal(link.ok && paper.ok, true, id);
    if (link.ok && paper.ok) {
      assert.equal(paper.scored.totalScore, link.scored.totalScore, id);
      assert.equal(paper.scored.severity, link.scored.severity, id);
      assert.equal(paper.scored.safetyFlagged, link.scored.safetyFlagged, id);
    }
  }
});

test('paper total scores like the items with the same total', () => {
  const answers = fill('phq-9', (opts, idx) => (idx < 6 ? 2 : 0));
  const items = scorePaperMeasure({ instrumentId: 'phq-9', mode: 'items', answers });
  const total = scorePaperMeasure({ instrumentId: 'phq-9', mode: 'total', totalScore: 12, safetyItemScore: 0 });
  assert.equal(items.ok && total.ok, true);
  if (items.ok && total.ok) {
    assert.equal(total.scored.totalScore, items.scored.totalScore);
    assert.equal(total.scored.severity, items.scored.severity);
  }
});

test('paper total: PHQ-9 needs item 9; positive item 9 flags safety', () => {
  const missing = scorePaperMeasure({ instrumentId: 'phq-9', mode: 'total', totalScore: 12 });
  assert.equal(missing.ok, false);
  const pos = scorePaperMeasure({ instrumentId: 'phq-9', mode: 'total', totalScore: 12, safetyItemScore: 1 });
  assert.equal(pos.ok, true);
  if (pos.ok) {
    assert.equal(pos.scored.safetyFlagged, true);
    assert.deepEqual(pos.scored.answers.map((a) => a.itemId), [SAFETY_ITEMS['phq-9']]);
  }
  assert.equal(scorePaperMeasure({ instrumentId: 'phq-9', mode: 'total', totalScore: 30, safetyItemScore: 0 }).ok, false, 'over max');
  assert.equal(scorePaperMeasure({ instrumentId: 'phq-9', mode: 'total', totalScore: 2, safetyItemScore: 3 }).ok, false, 'item > total');
});

test('paper: copyrighted forms with no items take the total only; item-read forms need items', () => {
  for (const id of ['ybocs', 'ham-d', 'madrs']) {
    assert.equal(paperEntryMode(id), 'total_only', id);
    const r = scorePaperMeasure({ instrumentId: id, mode: 'total', totalScore: 20 });
    assert.equal(r.ok, true, id);
    if (r.ok) assert.equal(r.scored.severity, scoreFromTotal(id, 20)!.severity);
    assert.equal(scorePaperMeasure({ instrumentId: id, mode: 'items', answers: {} }).ok, false, id);
  }
  assert.equal(paperEntryMode('c-ssrs-brief'), 'items_only');
  assert.equal(scorePaperMeasure({ instrumentId: 'c-ssrs-brief', mode: 'total', totalScore: 2 }).ok, false);
  assert.equal(scorePaperMeasure({ instrumentId: 'bam', mode: 'total', totalScore: 2 }).ok, false);
});

test('paper label, date and route wiring', () => {
  assert.equal(paperEnteredLabel('Jane Doe, LCSW'), 'Paper — entered by Jane Doe, LCSW');
  assert.equal(paperEnteredLabel(''), 'Paper — entered by staff');
  const now = new Date('2026-10-27T15:00:00Z');
  assert.equal(paperAdministeredAt('2026-10-20', now)!.toISOString(), '2026-10-20T12:00:00.000Z');
  assert.equal(paperAdministeredAt('2026-11-20', now), null, 'future');
  assert.equal(paperAdministeredAt('2026-02-30', now), null, 'not a date');
  const route = read('src/app/api/clinical/measure-results/paper/route.ts');
  assert.match(route, /requireClinicalContext\('\/dashboard\/ehr\/assessments', \{ clientId: body\.clientId \}\)/);
  assert.match(route, /scorePaperMeasure/);
  assert.match(route, /documentType: 'Measures'/);
  assert.match(route, /source: 'paper'/);
  assert.match(route, /sourceDocumentId: doc\.id/);
  assert.match(route, /MEASURE_PAPER_ENTERED/);
  assert.match(route, /riskAlert\.create/);
  const schema = read('prisma/schema.prisma');
  assert.match(schema, /sourceDocumentId String\?/);
  const mig = read('prisma/migrations/20261028_measure_paper_scan.sql');
  assert.match(mig, /ADD COLUMN IF NOT EXISTS "sourceDocumentId"/);
});

// ─── Send text has no PHI ──────────────────────────────────────────────────────

test('send: email and text carry no measure names or patient details', () => {
  const names = ASSESSMENT_CATALOG.flatMap((i) => [i.name, i.fullName]);
  const mail = measureRequestEmail('Practice', 'https://example.test/m/abc');
  const sms = measureRequestSms({ sender: 'Practice', url: 'https://example.test/m/abc' });
  for (const text of [mail.subject, mail.text, mail.html, sms]) {
    for (const n of names) assert.equal(text.includes(n), false, n);
    assert.doesNotMatch(text, /depress|anxiety|suicid|PTSD|alcohol|drug/i);
  }
  assert.match(mail.text, /questionnaire/);
  // The portal page lists a count only (names show after the DOB check on the link)
  const portal = read('src/lib/measures/portal.ts');
  assert.match(portal, /formCount/);
  assert.doesNotMatch(read('src/app/patient/measures/page.tsx'), /instrumentName|measureName/);
});

test('send: portal channel only for an active portal login; proxies never see measures', () => {
  const client = { dateOfBirth: '1990-01-01', email: null, emailOptOutAt: null, phone: null, smsConsent: false, smsOptOutAt: null, status: 'ACTIVE' };
  const base = { instrumentIds: ['phq-9'], part2Client: false, part2ConsentCovers: false };
  assert.equal(planDelivery({ ...base, client, allowed: ['email', 'sms', 'portal'] }).ok, false);
  const r = planDelivery({ ...base, client: { ...client, portalActive: true }, allowed: ['email', 'sms', 'portal'] });
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.channels, ['portal']);
  // Default (automatic) sends never use the portal channel
  assert.equal(planDelivery({ ...base, client: { ...client, portalActive: true } }).ok, false);
  const portal = read('src/lib/measures/portal.ts');
  assert.match(portal, /if \(a\.isProxy\) return \[\]/);
  assert.match(portal, /only available to the patient/);
  assert.match(read('src/app/api/clinical/measure-requests/route.ts'), /'email', 'sms', 'portal'/);
});

// ─── Roles ─────────────────────────────────────────────────────────────────────

test('roles: guide and print for measure roles; front desk / billing / HR none', () => {
  for (const role of ['THERAPIST', 'PSYCHIATRIST', 'NP', 'CLINICIAN', 'PRACTICE_DIRECTOR', 'ADMIN', 'PRP_SPECIALIST', 'CRISIS_RESPONDER']) {
    assert.equal(canAccessPath(role, '/dashboard/mbc/guide'), true, role);
    assert.equal(canAccessPath(role, '/dashboard/mbc/print'), true, role);
  }
  for (const role of ['FRONT_DESK', 'BILLING', 'HR_MANAGER', 'OFFICE_MANAGER']) {
    assert.equal(canAccessPath(role, '/dashboard/mbc/guide'), false, role);
    assert.equal(canAccessPath(role, '/dashboard/mbc/print'), false, role);
  }
  // Paper entry: assessment roles only (not crisis responders); the card hides the button otherwise
  assert.equal(canAccessPath('THERAPIST', '/dashboard/ehr/assessments'), true);
  assert.equal(canAccessPath('FRONT_DESK', '/dashboard/ehr/assessments'), false);
  assert.match(read('src/components/measures/MeasuresCard.tsx'), /canAccessPath\(user\?\.role, '\/dashboard\/ehr\/assessments'\)/);
  // The rest of /dashboard/mbc is unchanged (providers only)
  assert.equal(canAccessPath('PRP_SPECIALIST', '/dashboard/mbc'), false);
  assert.ok((CLINIC_NAV_HREFS as readonly string[]).includes('/dashboard/mbc/guide'));
});

test('UI wiring: Send measure, Upload paper measure, Print, How to read, bulk send', () => {
  const card = read('src/components/measures/MeasuresCard.tsx');
  for (const label of ['Send measure', 'Upload paper measure', 'Measure guide', 'How to read', '/dashboard/mbc/print?clientId=']) assert.ok(card.includes(label), label);
  const outcomes = read('src/app/dashboard/mbc/outcomes/page.tsx');
  assert.ok(outcomes.includes('Send due measures'));
  assert.doesNotMatch(outcomes, /^export function/m);
  const guidePage = read('src/app/dashboard/mbc/guide/page.tsx');
  assert.match(guidePage, /measureGuide\(\)/);
  // No emoji in the new UI
  for (const f of ['src/app/dashboard/mbc/guide/page.tsx', 'src/components/measures/MeasureGuidePanel.tsx', 'src/components/measures/PaperMeasureModal.tsx', 'src/components/measures/SendMeasureModal.tsx', 'src/app/dashboard/mbc/print/page.tsx']) {
    assert.doesNotMatch(read(f), /\p{Extended_Pictographic}/u, f);
  }
});
