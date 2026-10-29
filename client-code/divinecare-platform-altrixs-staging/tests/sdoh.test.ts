import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import {
  AHC_QUESTIONS,
  AHC_SAFETY_THRESHOLD,
  CORE_QUESTION_IDS,
  normalizeAnswers,
  scoreAhcHrsn,
  type AhcAnswers,
} from '../src/lib/sdoh/ahcHrsn';
import { mergeSecondaryDiagnoses, SDOH_ZCODES, suggestZCodes } from '../src/lib/sdoh/zCodes';
import {
  applyTransition,
  canTransition,
  parseLegacyResources,
  pct,
  rescreenDueAt,
  rescreenState,
  resourceDomainFor,
} from '../src/lib/sdoh/workflow';
import { canAccessPath } from '../src/lib/auth/roleAccess';
import { NAV_SECTIONS } from '../src/components/layout/navConfig';

const ROOT = path.join(__dirname, '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const NEGATIVE_CORE: AhcAnswers = {
  q1: 'steady', q2: ['none'], q3: 'never', q4: 'never', q5: 'no', q6: 'no', q7: '1', q8: '1', q9: '1', q10: '1',
};

// ─── Instrument ─────────────────────────────────────────────────────────────

test('core instrument is the 10 CMS AHC HRSN items, verbatim', () => {
  assert.deepEqual(CORE_QUESTION_IDS, ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8', 'q9', 'q10']);
  const q = Object.fromEntries(AHC_QUESTIONS.map((x) => [x.id, x]));
  assert.equal(q.q1.text, 'What is your living situation today?');
  assert.equal(q.q5.text, 'In the past 12 months, has lack of reliable transportation kept you from medical appointments, meetings, work or from getting things needed for daily living?');
  assert.equal(q.q6.text, 'In the past 12 months has the electric, gas, oil, or water company threatened to shut off services in your home?');
  assert.equal(q.q7.text, 'How often does anyone, including family and friends, physically hurt you?');
  assert.deepEqual(q.q7.options.map((o) => o.points), [1, 2, 3, 4, 5]);
  // Every item carries its citation and LOINC from the CMS citation table
  for (const item of AHC_QUESTIONS) {
    assert.ok(item.citation.length > 10, `${item.id} citation`);
    assert.match(item.loinc, /^\d{4,5}-\d$/, `${item.id} LOINC`);
  }
  // Authors who asked to be notified (CMS table): items 1, 5, 6, 7-10
  assert.deepEqual(AHC_QUESTIONS.filter((x) => x.notifyAuthor).map((x) => x.number), [1, 5, 6, 7, 8, 9, 10]);
  // Substance use items (19-22) are not part of this build (42 CFR Part 2)
  assert.ok(!AHC_QUESTIONS.some((x) => x.number >= 17));
});

// ─── Scoring (CMS rules) ───────────────────────────────────────────────────

test('all-negative core screening has no positive domains and safety score 4', () => {
  const s = scoreAhcHrsn(NEGATIVE_CORE, false);
  assert.deepEqual(s.positiveDomains, []);
  assert.equal(s.safetyScore, 4);
  assert.equal(s.safetyPositive, false);
  assert.deepEqual(s.unanswered, []);
});

test('each underlined answer makes its domain positive', () => {
  const pos = (a: AhcAnswers) => scoreAhcHrsn({ ...NEGATIVE_CORE, ...a }, false).positiveDomains;
  assert.deepEqual(pos({ q1: 'worried' }), ['housing_instability']);
  assert.deepEqual(pos({ q1: 'not_steady' }), ['housing_instability']);
  assert.deepEqual(pos({ q2: ['mold'] }), ['housing_quality']);
  assert.deepEqual(pos({ q3: 'sometimes' }), ['food']);
  assert.deepEqual(pos({ q4: 'often' }), ['food']);
  assert.deepEqual(pos({ q5: 'yes' }), ['transportation']);
  assert.deepEqual(pos({ q6: 'yes' }), ['utilities']);
  assert.deepEqual(pos({ q6: 'shut_off' }), ['utilities']);
});

test('interpersonal safety: items 7-10 summed, 11 or more is positive', () => {
  const at = (a: string, b: string, c: string, d: string) => scoreAhcHrsn({ ...NEGATIVE_CORE, q7: a, q8: b, q9: c, q10: d }, false);
  assert.equal(AHC_SAFETY_THRESHOLD, 11);
  const ten = at('1', '3', '3', '3');
  assert.equal(ten.safetyScore, 10);
  assert.equal(ten.safetyPositive, false);
  const eleven = at('2', '3', '3', '3');
  assert.equal(eleven.safetyScore, 11);
  assert.equal(eleven.safetyPositive, true);
  assert.ok(eleven.positiveDomains.includes('safety'));
  // Partial answers already at 11 are positive; partial under 11 has no score
  const partialPos = scoreAhcHrsn({ q7: '5', q8: '5', q9: '1' }, false);
  assert.equal(partialPos.safetyPositive, true);
  assert.equal(partialPos.safetyScore, 11);
  const partialNeg = scoreAhcHrsn({ q7: '1', q8: '5' }, false);
  assert.equal(partialNeg.safetyPositive, false);
  assert.equal(partialNeg.safetyScore, null);
});

test('physically hurt / threaten endorsed under the threshold raises a prompt, not a positive', () => {
  const s = scoreAhcHrsn({ ...NEGATIVE_CORE, q7: '2' }, false);
  assert.equal(s.safetyPositive, false);
  assert.equal(s.safetyItemEndorsed, true);
  assert.equal(scoreAhcHrsn({ ...NEGATIVE_CORE, q8: '3' }, false).safetyItemEndorsed, false);
});

test('supplemental items score only when included', () => {
  const answers = { ...NEGATIVE_CORE, q11: 'somewhat_hard', q12: 'keeping', q13: 'little_more', q14: 'often', q15: 'no', q16: 'yes' };
  assert.deepEqual(scoreAhcHrsn(answers, false).positiveDomains, []);
  assert.deepEqual(scoreAhcHrsn(answers, true).positiveDomains, ['financial_strain', 'employment', 'family_support', 'education']);
  // CMS underlines "Yes" for item 15 (language other than English at home)
  assert.ok(scoreAhcHrsn({ q15: 'yes', q16: 'no' }, true).positiveDomains.includes('education'));
  assert.deepEqual(scoreAhcHrsn({ q13: 'all_help', q14: 'sometimes' }, true).positiveDomains, []);
});

test('normalizeAnswers drops unknown items/values and "None of the above" mixed with problems', () => {
  const n = normalizeAnswers({ q1: 'bogus', q2: ['none', 'mold', 'xx'], q99: 'yes', q5: null, q11: 'very_hard' }, false);
  assert.deepEqual(n, { q2: ['mold'] });
  const s = scoreAhcHrsn({ q2: ['none'] }, false);
  assert.ok(!s.positiveDomains.includes('housing_quality'));
  assert.ok(s.unanswered.includes('q1'));
});

// ─── Z codes ────────────────────────────────────────────────────────────────

test('Z-code suggestions follow the positive domains', () => {
  const answers: AhcAnswers = { ...NEGATIVE_CORE, q1: 'worried', q2: ['no_heat', 'mold'], q3: 'often', q5: 'yes', q6: 'shut_off' };
  const s = scoreAhcHrsn(answers, false);
  const sug = suggestZCodes(answers, s.positiveDomains, false);
  const pre = sug.filter((x) => x.preselected).map((x) => x.code);
  assert.deepEqual(pre, ['Z59.811', 'Z59.11', 'Z59.19', 'Z59.41', 'Z59.82', 'Z59.861']);
  assert.ok(sug.some((x) => x.code === 'Z59.12' && !x.preselected));
  // Homelessness answer: Z59.00 pre-ticked with specific alternatives
  const h = suggestZCodes({ q1: 'not_steady' }, ['housing_instability'], false);
  assert.deepEqual(h.map((x) => x.code), ['Z59.00', 'Z59.01', 'Z59.02', 'Z59.812']);
  // Negative screening: nothing suggested
  assert.deepEqual(suggestZCodes(NEGATIVE_CORE, [], false), []);
});

test('safety Z codes are offered but never pre-ticked', () => {
  const sug = suggestZCodes({ q7: '4', q8: '4', q9: '2', q10: '2' }, ['safety'], false);
  assert.ok(sug.length > 0);
  assert.ok(sug.every((x) => x.domain === 'safety' && !x.preselected));
});

test('every suggested code is in the FY2027 SDOH list with a valid ICD-10-CM shape', () => {
  for (const [code, title] of Object.entries(SDOH_ZCODES)) {
    assert.match(code, /^Z\d{2}\.\d{1,3}$/, code);
    assert.ok(title.length > 5);
  }
  // Z59.86 became a header in FY2026: only its children may be used
  assert.ok(!('Z59.86' in SDOH_ZCODES));
  const all = suggestZCodes(
    { q1: 'not_steady', q2: ['pests', 'no_heat'], q3: 'often', q5: 'yes', q6: 'shut_off', q7: '5', q8: '5', q9: '5', q10: '5', q11: 'very_hard', q12: 'finding', q13: 'lot_more', q14: 'always', q16: 'yes' },
    ['housing_instability', 'housing_quality', 'food', 'transportation', 'utilities', 'safety', 'financial_strain', 'employment', 'family_support', 'education'],
    true
  );
  for (const s of all) assert.ok(s.code in SDOH_ZCODES, s.code);
  assert.equal(new Set(all.map((s) => s.code)).size, all.length);
});

test('confirmed codes append to secondary diagnoses without duplicates', () => {
  assert.equal(mergeSecondaryDiagnoses('F41.1, Z59.41', ['Z59.41', 'Z59.82']), 'F41.1, Z59.41, Z59.82');
  assert.equal(mergeSecondaryDiagnoses(null, ['Z59.41']), 'Z59.41');
  assert.equal(mergeSecondaryDiagnoses('Z59.41', ['z59.41']), null);
});

// ─── Referrals / rescreen ───────────────────────────────────────────────────

test('referral status transitions', () => {
  assert.ok(canTransition('open', 'connected'));
  assert.ok(canTransition('open', 'closed'));
  assert.ok(canTransition('connected', 'closed'));
  assert.ok(canTransition('connected', 'open'));
  assert.ok(canTransition('closed', 'open'));
  assert.ok(!canTransition('closed', 'connected'));
  const now = new Date('2026-10-18T12:00:00Z');
  const noReason = applyTransition({ status: 'open', connectedAt: null }, 'closed', null, now);
  assert.equal(noReason.ok, false);
  const closed = applyTransition({ status: 'connected', connectedAt: now }, 'closed', 'need_met', now);
  assert.ok(closed.ok && closed.data.closedAt === now && closed.data.closeReason === 'need_met');
  const reopened = applyTransition({ status: 'closed', connectedAt: now }, 'open', null, now);
  assert.ok(reopened.ok && reopened.data.closedAt === null && reopened.data.closeReason === null && reopened.data.connectedAt === now);
  const fellThrough = applyTransition({ status: 'connected', connectedAt: now }, 'open', null, now);
  assert.ok(fellThrough.ok && fellThrough.data.connectedAt === null);
  assert.equal(applyTransition({ status: 'open', connectedAt: null }, 'open', null, now).ok, false);
  assert.equal(applyTransition({ status: 'closed', connectedAt: null }, 'connected', null, now).ok, false);
});

test('rescreen is due 12 months after the last screening', () => {
  const last = new Date('2025-11-01T00:00:00Z');
  assert.equal(rescreenDueAt(last).toISOString().slice(0, 10), '2026-11-01');
  assert.equal(rescreenState(last, new Date('2026-09-01T00:00:00Z')), 'current');
  assert.equal(rescreenState(last, new Date('2026-10-18T00:00:00Z')), 'due_soon');
  assert.equal(rescreenState(last, new Date('2026-11-02T00:00:00Z')), 'overdue');
});

test('resource domains and summary percentages', () => {
  assert.equal(resourceDomainFor('housing_quality'), 'housing');
  assert.equal(resourceDomainFor('financial_strain'), 'financial');
  assert.equal(resourceDomainFor('food'), 'food');
  assert.equal(pct(1, 3), 33.3);
  assert.equal(pct(0, 0), null);
});

test('legacy import reads the old module list and never invents rows', () => {
  const rows = parseLegacyResources([
    { id: 'h1', name: 'Housing Help', domain: 'housing', phone: '(301) 000-0000', hours: 'Mon', cost: 'Free', notes: 'n' },
    { id: 't1', name: 'Rides', domain: 'transport' },
    { id: 's1', name: 'Peer group', domain: 'social' },
    { name: 'No id' },
    { id: 'x', name: '  ' },
    null,
  ]);
  assert.deepEqual(rows.map((r) => [r.legacyId, r.domains]), [['h1', ['housing']], ['t1', ['transportation']], ['s1', ['family_support']]]);
  assert.deepEqual(parseLegacyResources(undefined), []);
  // The directory code never imports the hard-coded seed list
  assert.ok(!read('src/lib/sdoh/manage.ts').includes('legacyModuleSeed'));
  assert.ok(!read('prisma/migrations/20261018_sdoh.sql').match(/\bINSERT\b/i));
});

// ─── Access and scoping ─────────────────────────────────────────────────────

test('page and Z-code roles', () => {
  for (const r of ['THERAPIST', 'CLINICIAN', 'NP', 'PSYCHIATRIST', 'CASE_MANAGER', 'PRP_SPECIALIST', 'PRACTICE_DIRECTOR']) assert.ok(canAccessPath(r, '/dashboard/sdoh'), r);
  for (const r of ['FRONT_DESK', 'BILLING', 'HR']) assert.ok(!canAccessPath(r, '/dashboard/sdoh'), r);
  // Confirming Z codes follows the BH diagnoses rule (case managers screen; clinicians code)
  assert.ok(canAccessPath('THERAPIST', '/dashboard/ehr/diagnoses'));
  assert.ok(!canAccessPath('CASE_MANAGER', '/dashboard/ehr/diagnoses'));
});

test('SDOH data access is org + caseload scoped, checks protected records, and is audited', () => {
  const manage = read('src/lib/sdoh/manage.ts');
  assert.match(manage, /clientAccessWhere\(actor\)/);
  assert.match(manage, /assertClientPhiAccess\(/);
  assert.match(manage, /lockedSensitiveClientIds\(/);
  assert.match(manage, /canConfirmZCodes = \(role: string\) => canAccessPath\(role, '\/dashboard\/ehr\/diagnoses'\)/);
  // Every prisma read/write on SDOH tables is filtered by organization
  for (const m of manage.matchAll(/prisma\.sdoh\w+\.(findMany|findFirst|count|groupBy)\(\{\s*where:\s*\{([^}]*)/g)) {
    assert.match(m[2], /organizationId/, `unscoped query: ${m[0].slice(0, 80)}`);
  }
  const routes: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === 'route.ts') routes.push(p);
    }
  };
  walk(path.join(ROOT, 'src/app/api/sdoh'));
  // 8 SDOH routes + suggestions and CSV import (resource library, 20261020)
  assert.equal(routes.length, 10);
  for (const f of routes) {
    const src = fs.readFileSync(f, 'utf8');
    assert.match(src, /sdohGate\(\)/, f);
    assert.match(src, /auditPhiAccess|writeAuditLog/, f);
  }
});

test('safety-positive screenings create a HIGH risk alert in the same transaction', () => {
  const manage = read('src/lib/sdoh/manage.ts');
  const block = manage.slice(manage.indexOf('export async function submitScreening'), manage.indexOf('export async function listClientSdoh'));
  assert.match(block, /\$transaction/);
  assert.match(block, /if \(score\.safetyPositive\)/);
  assert.match(block, /tx\.riskAlert\.create/);
  assert.match(block, /severity: 'HIGH'/);
});

test('nav: SDOH lives under Clients > Clinical worklists, not Reports', () => {
  const items = NAV_SECTIONS.flatMap((s) => s.items.map((i) => ({ section: s.label, ...i })));
  const sdoh = items.filter((i) => i.href === '/dashboard/sdoh');
  assert.equal(sdoh.length, 1);
  assert.equal(sdoh[0].section, 'Clients');
  assert.equal(sdoh[0].group, 'Clinical worklists');
});

// ─── Migration matches schema ───────────────────────────────────────────────

function modelColumns(schema: string, model: string) {
  const m = schema.match(new RegExp(`model ${model} \\{([\\s\\S]*?)\\n\\}`));
  assert.ok(m, `model ${model}`);
  const table = m[1].match(/@@map\("([^"]+)"\)/)?.[1];
  const cols = m[1]
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('//') && !l.startsWith('///') && !l.startsWith('@@'))
    .map((l) => l.split(/\s+/)[0]);
  return { table, cols };
}

test('20261018_sdoh.sql creates exactly the schema columns, idempotently', () => {
  const schema = read('prisma/schema.prisma');
  const sql = read('prisma/migrations/20261018_sdoh.sql');
  for (const model of ['SdohScreening', 'SdohReferral', 'SdohResource']) {
    const { table, cols } = modelColumns(schema, model);
    assert.ok(table, `${model} @@map`);
    const create = sql.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\n\\);`));
    assert.ok(create, `CREATE TABLE IF NOT EXISTS ${table}`);
    // Columns added later by 20261020_resource_library.sql (ADD COLUMN IF NOT EXISTS)
    const later = read('prisma/migrations/20261020_resource_library.sql');
    const added = [...later.matchAll(new RegExp(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS "(\\w+)"`, 'g'))].map((x) => x[1]);
    const sqlCols = [...[...create[1].matchAll(/^\s*"(\w+)"/gm)].map((x) => x[1]), ...added];
    assert.deepEqual([...sqlCols].sort(), [...cols].sort(), table);
  }
  assert.ok(!/CREATE (UNIQUE )?INDEX (?!IF NOT EXISTS)/.test(sql), 'indexes must use IF NOT EXISTS');
  assert.ok(!/\bDROP\b/i.test(sql));
  assert.match(sql, /sdoh_resources_organizationId_source_legacyId_key/);
});
