import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  CHART_DIGEST_DISCLAIMER,
  CHART_DIGEST_EMPTY,
  DIGEST_DENIAL_CODES,
  DIGEST_DENIAL_MESSAGES,
  DIGEST_DENIAL_STATUS,
} from '../src/lib/chart-digest/copy';
import {
  MA_SECTION_KEYS,
  canRegenerateDigestKind,
  canViewDigestKind,
  parseDigestKind,
  sectionsForKind,
  type DigestContent,
} from '../src/lib/chart-digest/kinds';
import { aiConsentDeclinedFromForms, evaluateDigestAccess } from '../src/lib/chart-digest/access';
import {
  assembleSources,
  buildDigestPrompt,
  emptyDigestContent,
  emptyRawSources,
  isDigestEmpty,
  parseDigestResponse,
  viewDigestForRole,
  type RawChartSources,
} from '../src/lib/chart-digest/build';
import {
  PREVISIT_EMPTY,
  PREVISIT_NOT_GENERATED,
  buildEnrichedBrief,
  isSudCodeF10toF19,
} from '../src/lib/previsit/enrichedBrief';

const root = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

const baseFacts = {
  role: 'THERAPIST',
  kind: 'bh' as const,
  action: 'view' as const,
  onCareTeam: true,
  aiConsentDeclined: false,
  aiConfigured: true,
  sensitiveRecord: false,
};

test('exact copy', () => {
  assert.equal(CHART_DIGEST_DISCLAIMER, 'AI-generated from chart documents — verify before relying on it');
  assert.equal(CHART_DIGEST_EMPTY, 'No chart history yet');
  assert.deepEqual([...DIGEST_DENIAL_CODES], [
    'role_not_permitted',
    'not_on_care_team',
    'ai_consent_declined',
    'ai_not_configured',
    'sensitive_record',
  ]);
  for (const code of DIGEST_DENIAL_CODES) {
    assert.ok(DIGEST_DENIAL_MESSAGES[code]);
    assert.ok(DIGEST_DENIAL_STATUS[code] >= 400);
  }
});

test('kind parsing: default bh, unknown rejected', () => {
  assert.equal(parseDigestKind(null), 'bh');
  assert.equal(parseDigestKind(''), 'bh');
  assert.equal(parseDigestKind('medical'), 'medical');
  assert.equal(parseDigestKind('MEDICAL'), 'medical');
  assert.equal(parseDigestKind('other'), null);
});

test('medical kind role rules', () => {
  for (const role of ['PHYSICIAN', 'MEDICAL_NP', 'MEDICAL_ASSISTANT', 'PSYCHIATRIST', 'NP', 'ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR']) {
    assert.equal(canViewDigestKind(role, 'medical'), true, `${role} views medical`);
  }
  for (const role of ['THERAPIST', 'FRONT_DESK', 'BILLING', 'HR', 'PEER_SUPPORT', 'CASE_MANAGER']) {
    assert.equal(canViewDigestKind(role, 'medical'), false, `${role} cannot view medical`);
  }
  assert.equal(canRegenerateDigestKind('PHYSICIAN', 'medical'), true);
  assert.equal(canRegenerateDigestKind('MEDICAL_NP', 'medical'), true);
  for (const role of ['MEDICAL_ASSISTANT', 'PSYCHIATRIST', 'NP', 'ADMIN']) {
    assert.equal(canRegenerateDigestKind(role, 'medical'), false, `${role} cannot regenerate medical`);
  }
});

test('BH digest is not visible to medical or front-office roles', () => {
  for (const role of ['PHYSICIAN', 'MEDICAL_NP', 'MEDICAL_ASSISTANT', 'FRONT_DESK', 'BILLING', 'HR', 'PEER_SUPPORT']) {
    assert.equal(canViewDigestKind(role, 'bh'), false, `${role}`);
  }
  assert.equal(canViewDigestKind('THERAPIST', 'bh'), true);
});

test('access denies with the pinned codes', () => {
  assert.deepEqual(evaluateDigestAccess({ ...baseFacts, role: 'FRONT_DESK' }), { ok: false, code: 'role_not_permitted' });
  assert.deepEqual(evaluateDigestAccess({ ...baseFacts, onCareTeam: false }), { ok: false, code: 'not_on_care_team' });
  assert.deepEqual(evaluateDigestAccess({ ...baseFacts, aiConsentDeclined: true }), { ok: false, code: 'ai_consent_declined' });
  assert.deepEqual(evaluateDigestAccess({ ...baseFacts, sensitiveRecord: true }), { ok: false, code: 'sensitive_record' });
  assert.deepEqual(
    evaluateDigestAccess({ ...baseFacts, action: 'generate', aiConfigured: false }),
    { ok: false, code: 'ai_not_configured' }
  );
  // A stored digest can be viewed even when AI is not configured.
  assert.equal(evaluateDigestAccess({ ...baseFacts, aiConfigured: false }).ok, true);
  // Medical assistants cannot regenerate medical history.
  assert.deepEqual(
    evaluateDigestAccess({ ...baseFacts, role: 'MEDICAL_ASSISTANT', kind: 'medical', action: 'generate' }),
    { ok: false, code: 'role_not_permitted' }
  );
  // Leadership may view without being on the care team, but not regenerate that way.
  const lead = evaluateDigestAccess({ ...baseFacts, role: 'ADMIN', onCareTeam: false });
  assert.deepEqual(lead, { ok: true, canRegenerate: false });
  assert.deepEqual(
    evaluateDigestAccess({ ...baseFacts, role: 'ADMIN', onCareTeam: false, action: 'generate' }),
    { ok: false, code: 'not_on_care_team' }
  );
  // Physician on the care team may regenerate medical history.
  assert.deepEqual(
    evaluateDigestAccess({ ...baseFacts, role: 'PHYSICIAN', kind: 'medical', action: 'generate' }),
    { ok: true, canRegenerate: true }
  );
});

test('AI consent: latest AI consent form decides', () => {
  assert.equal(aiConsentDeclinedFromForms([]), false);
  assert.equal(aiConsentDeclinedFromForms([{ type: 'HIPAA Notice', status: 'DECLINED' }]), false);
  assert.equal(
    aiConsentDeclinedFromForms([
      { type: 'AI Documentation Consent', status: 'DECLINED' },
      { type: 'AI Documentation Consent', status: 'SIGNED' },
    ]),
    true
  );
  assert.equal(
    aiConsentDeclinedFromForms([
      { type: 'AI Documentation Consent', status: 'SIGNED' },
      { type: 'AI Documentation Consent', status: 'DECLINED' },
    ]),
    false
  );
});

function rawFixture(): RawChartSources {
  const raw = emptyRawSources();
  raw.diagnoses = [
    { id: 'd1', code: 'F32.1', description: 'Major depressive disorder', status: 'ACTIVE', date: null },
    { id: 'd2', code: 'F10.20', description: 'Alcohol dependence', status: 'ACTIVE', date: null },
  ];
  raw.medications = [
    { id: 'm1', name: 'Sertraline', dosage: '50 mg', frequency: 'daily', indication: 'Depression', date: null },
    { id: 'm2', name: 'Naltrexone', dosage: '50 mg', frequency: 'daily', indication: 'Alcohol use disorder', date: null },
  ];
  raw.notes = [
    { id: 'n1', body: '<!--ehr type="SOAP" duration="50" cpt="" telehealth="false" pos="11" part2="false"-->\nDiscussed sleep.', createdAt: new Date('2026-09-01T00:00:00Z') },
    { id: 'n2', body: '<!--ehr type="Psychotherapy Note" duration="50" cpt="" telehealth="false" pos="11" part2="false"-->\nProcess material.', createdAt: new Date('2026-09-02T00:00:00Z') },
    { id: 'n3', body: '<!--ehr type="SOAP" duration="50" cpt="" telehealth="false" pos="11" part2="true"-->\nSUD group.', createdAt: new Date('2026-09-03T00:00:00Z') },
  ];
  raw.appointments = [{ id: 'a1', type: 'Follow-up', startsAt: new Date('2026-09-10T00:00:00Z'), status: 'COMPLETED' }];
  raw.allergies = [{ id: 'al1', allergen: 'Penicillin', reaction: 'Rash', severity: 'Moderate' }];
  raw.vitals = [{ id: 'v1', line: 'BP 120/80, HR 70', recordedAt: new Date('2026-09-05T00:00:00Z') }];
  raw.problems = [
    { id: 'p1', code: 'E11.9', name: 'Type 2 diabetes', status: 'Active' },
    { id: 'p2', code: 'F11.20', name: 'Opioid dependence', status: 'Active' },
  ];
  raw.labs = [{ id: 'l1', line: 'A1c 7.1 %', date: new Date('2026-08-01T00:00:00Z') }];
  raw.careGaps = [
    { id: 'g1', label: 'Diabetes A1c', status: 'overdue', lastDoneAt: null },
    { id: 'g2', label: 'Influenza immunization', status: 'met', lastDoneAt: new Date('2026-10-01T00:00:00Z') },
  ];
  return raw;
}

test('BH sources: psychotherapy notes never ingested; Part 2 only with consent', () => {
  const noConsent = assembleSources('bh', rawFixture(), { part2Consent: false });
  const labels = noConsent.sources.map((s) => s.label).join(' | ');
  assert.ok(labels.includes('F32.1'));
  assert.equal(labels.includes('F10.20'), false, 'SUD diagnosis withheld');
  assert.equal(labels.includes('Naltrexone'), false, 'SUD-indicated medication withheld');
  const noteIds = noConsent.sources.filter((s) => s.type === 'note').map((s) => s.date);
  assert.deepEqual(noteIds, ['2026-09-01'], 'only the ordinary note is ingested');
  assert.equal(Object.values(noConsent.text).some((t) => t.includes('Process material')), false);
  assert.equal(Object.values(noConsent.text).some((t) => t.includes('SUD group')), false);

  const withConsent = assembleSources('bh', rawFixture(), { part2Consent: true });
  const withLabels = withConsent.sources.map((s) => s.label).join(' | ');
  assert.ok(withLabels.includes('F10.20'));
  assert.ok(withLabels.includes('Naltrexone'));
  assert.equal(
    Object.values(withConsent.text).some((t) => t.includes('Process material')),
    false,
    'psychotherapy notes stay out even with Part 2 consent'
  );
});

test('medical sources: SUD problems withheld, care gaps tracked', () => {
  const a = assembleSources('medical', rawFixture(), { part2Consent: false });
  assert.equal(a.sources.some((s) => s.label.includes('F11.20')), false);
  assert.ok(a.sources.some((s) => s.label.includes('E11.9')));
  assert.equal(a.careGapIds.length, 2);
  assert.equal(a.sources.some((s) => s.type === 'note'), false, 'medical digest never reads progress notes');
});

test('prompt forbids invention and excludes care-gap sources', () => {
  const a = assembleSources('medical', rawFixture(), { part2Consent: false });
  const { system, user } = buildDigestPrompt('medical', a);
  assert.match(system, /ONLY the numbered sources/);
  assert.match(system, /Never invent/);
  assert.match(system, /cite/i);
  assert.equal(system.includes('preventiveDue'), false, 'AI is not asked for preventive care');
  assert.equal(user.includes('Diabetes A1c'), false, 'care gaps are not sent to AI');
  assert.match(user, /<document>/);
  assert.match(user, /untrusted/);
});

test('parse drops uncited or unknown-citation items and keeps only cited sources', () => {
  const raw = rawFixture();
  const a = assembleSources('medical', raw, { part2Consent: false });
  const allergyId = a.sources.find((s) => s.type === 'allergy')!.id;
  const reply = JSON.stringify({
    sections: {
      allergies: [
        { text: 'Penicillin allergy with rash.', citations: [allergyId] },
        { text: 'Invented fact with no citation.', citations: [] },
        { text: 'Invented fact citing a source that does not exist.', citations: ['S999'] },
        { text: 'Missing citations key.' },
      ],
      // AI tries to supply preventive care: ignored in favor of care-gap records.
      preventiveDue: [{ text: 'Needs a colonoscopy.', citations: [allergyId] }],
    },
  });
  const parsed = parseDigestResponse('medical', `Here you go: ${reply}`, a, raw.careGaps)!;
  assert.ok(parsed);
  const allergies = parsed.sections.find((s) => s.key === 'allergies')!;
  assert.deepEqual(allergies.items, [{ text: 'Penicillin allergy with rash.', citations: [allergyId] }]);

  const preventive = parsed.sections.find((s) => s.key === 'preventiveDue')!;
  assert.equal(preventive.items.length, 1, 'only the overdue care-gap record');
  assert.match(preventive.items[0].text, /^Diabetes A1c: overdue/);
  assert.equal(JSON.stringify(parsed).includes('colonoscopy'), false);

  const cited = new Set(parsed.sources.map((s) => s.id));
  assert.ok(cited.has(allergyId));
  assert.equal(cited.size, 2, 'allergy + the care-gap record');

  assert.equal(parseDigestResponse('bh', 'not json', a), null);
});

test('medical assistants see only allergies, medications, vitals, preventive care', () => {
  assert.deepEqual([...MA_SECTION_KEYS], ['allergies', 'medications', 'vitals', 'preventiveDue']);
  const content: DigestContent = {
    version: 1,
    sections: sectionsForKind('medical').map((s) => ({
      key: s.key,
      title: s.title,
      items: [{ text: `${s.key} item`, citations: ['S1'] }],
    })),
    sources: [{ id: 'S1', type: 'allergy', label: 'x', date: null }],
  };
  const ma = viewDigestForRole(content, 'medical', 'MEDICAL_ASSISTANT');
  assert.deepEqual(ma.sections.map((s) => s.key), [...MA_SECTION_KEYS]);
  const phys = viewDigestForRole(content, 'medical', 'PHYSICIAN');
  assert.equal(phys.sections.length, sectionsForKind('medical').length);
  // BH digests are not subset by role.
  assert.equal(viewDigestForRole(content, 'bh', 'MEDICAL_ASSISTANT').sections.length, content.sections.length);
});

test('empty digest is empty and invents nothing', () => {
  const empty = emptyDigestContent('bh');
  assert.equal(isDigestEmpty(empty), true);
  assert.equal(isDigestEmpty(null), true);
  assert.equal(empty.sources.length, 0);
  assert.equal(empty.sections.every((s) => s.items.length === 0), true);
});

test('API route: GET + POST, kind query, private no-store', () => {
  const route = read('src/app/api/clients/[id]/chart-digest/route.ts');
  assert.match(route, /export async function GET\b/);
  assert.match(route, /export async function POST\b/);
  assert.match(route, /searchParams\.get\('kind'\)/);
  assert.match(route, /'Cache-Control': 'private, no-store'/);
  assert.match(route, /requireOrgContext/);
  assert.match(route, /viewDigestForRole/);
});

test('schema + migration', () => {
  const schema = read('prisma/schema.prisma');
  const model = schema.match(/model ClientChartDigest \{[\s\S]*?\n\}/)![0];
  for (const field of ['organizationId', 'clientId', 'kind', 'content', 'status', 'generatedAt', 'generatedById']) {
    assert.match(model, new RegExp(`\\b${field}\\b`));
  }
  assert.match(model, /kind\s+String\s+@default\("bh"\)/);
  assert.match(model, /content\s+Json\b/);
  assert.match(model, /generatedById\s+String\?/);
  const sql = 'prisma/migrations/20261025120000_chart_history_digest/migration.sql';
  assert.ok(existsSync(join(root, sql)));
  assert.match(read(sql), /CREATE TABLE IF NOT EXISTS "ClientChartDigest"/);
});

test('UI: card, tabs, and scripts', () => {
  const card = read('src/components/chart/ChartHistoryCard.tsx');
  assert.match(card, /CHART_HISTORY_TITLE/);
  assert.match(card, /GENERATE_LABEL/);
  assert.match(card, /REGENERATE_LABEL/);
  assert.match(card, /CHART_DIGEST_DISCLAIMER/);
  assert.match(card, /CHART_DIGEST_EMPTY/);
  const copy = read('src/lib/chart-digest/copy.ts');
  assert.match(copy, /CHART_HISTORY_TITLE = 'Chart history'/);
  assert.match(copy, /SESSION_TAB_VISIT_GUIDE = 'Visit guide'/);
  assert.match(copy, /SESSION_TAB_MEDICAL_HISTORY = 'Medical history'/);
  assert.match(copy, /SESSION_TAB_BH_HISTORY = 'Behavioral health history'/);
  const tabs = read('src/components/visits/VisitSessionTabs.tsx');
  assert.match(tabs, /variant === 'medical'/);
  assert.match(read('src/app/dashboard/medical/visits/page.tsx'), /<VisitSessionTabs[^>]*variant="medical"/);
  for (const script of ['scripts/chart-digest.ts', 'scripts/chart-digest-prep.ts']) {
    assert.ok(existsSync(join(root, script)), script);
  }
  const prep = read('scripts/chart-digest-prep.ts');
  assert.match(prep, /--apply/);
  assert.match(prep, /# cron:/);
  assert.equal(/^\s*30 5 \* \* \*/m.test(prep), false, 'cron stays commented out');
});

test('previsit brief: facts only, PC hides SUD F10–F19', () => {
  assert.equal(PREVISIT_EMPTY, 'Chart history will be prepared before the next visit.');
  assert.equal(PREVISIT_NOT_GENERATED, 'Not generated yet.');

  const empty = buildEnrichedBrief(
    { diagnoses: [], medications: [], visits: [], labs: [], careTeam: [], openItems: [], digestGeneratedAt: null },
    'bh'
  );
  assert.equal(empty.emptyMessage, PREVISIT_EMPTY);
  assert.equal(empty.chartHistoryStatus, 'Not generated yet.');
  assert.equal(empty.sections.every((s) => s.items.length === 0), true);

  const input = {
    diagnoses: [
      { code: 'F32.1', description: 'Major depressive disorder', status: 'ACTIVE' },
      { code: 'F10.20', description: 'Alcohol dependence', status: 'ACTIVE' },
      { code: 'F17.210', description: 'Nicotine dependence', status: 'ACTIVE' },
    ],
    medications: [
      { name: 'Sertraline', dosage: '50 mg', frequency: 'daily', indication: 'Depression' },
      { name: 'Naltrexone', dosage: '50 mg', frequency: 'daily', indication: 'Alcohol use disorder' },
    ],
    visits: [{ date: '2026-09-10', type: 'Follow-up', status: 'completed' }],
    labs: [{ line: 'A1c 7.1 %', date: '2026-08-01' }],
    careTeam: [{ name: 'A. Provider', role: 'Therapist', isPrimary: true }],
    openItems: [{ label: 'Diabetes A1c: overdue' }],
    digestGeneratedAt: '2026-10-25T10:00:00.000Z',
  };
  const bh = buildEnrichedBrief(input, 'bh');
  const pc = buildEnrichedBrief(input, 'pc');
  const dx = (b: typeof bh) => b.sections.find((s) => s.key === 'diagnoses')!.items;
  assert.equal(dx(bh).length, 3);
  assert.deepEqual(dx(pc), ['F32.1 Major depressive disorder']);
  assert.deepEqual(pc.sections.find((s) => s.key === 'medications')!.items, ['Sertraline 50 mg daily']);
  assert.deepEqual(bh.sections.find((s) => s.key === 'careTeam')!.items, ['A. Provider · Therapist (primary)']);
  assert.equal(bh.emptyMessage, null);
  assert.equal(bh.chartHistoryStatus, 'Generated 2026-10-25');
  assert.equal(isSudCodeF10toF19('F10.20'), true);
  assert.equal(isSudCodeF10toF19('F19.10'), true);
  assert.equal(isSudCodeF10toF19('F20.0'), false);
  assert.equal(isSudCodeF10toF19('F9'), false);
});

test('visit guide brief tab renders the enriched brief', () => {
  assert.match(read('src/components/visits/VisitGuide.tsx'), /enrichedBrief/);
  assert.match(read('src/app/api/visits/guide/route.ts'), /loadEnrichedBrief/);
});
