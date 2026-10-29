import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

/**
 * Aggregator: the Oct 25 test files exist, are wired into `npm test`, and the key
 * deliverables are on disk. The detailed behavior lives in the individual test files.
 */

const root = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');
const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };

const OCT25_TESTS = [
  'tests/layout-static-guards-business.test.ts',
  'tests/identifying-information.test.ts',
  'tests/scribe-field-feedback.test.ts',
  'tests/chart-history-digest.test.ts',
  'tests/client-demographics-middlename.test.ts',
  'tests/sidebar-account-menu.test.ts',
  'tests/client-card-care-team.test.ts',
];

test('Oct 25 test files exist and run under npm test', () => {
  for (const file of OCT25_TESTS) {
    assert.ok(existsSync(join(root, file)), `${file} exists`);
    assert.ok(pkg.scripts.test.includes(file), `${file} is in the test script`);
  }
});

test('layout e2e script and viewport config are present', () => {
  assert.ok(pkg.scripts['test:e2e:layout']);
  assert.match(pkg.scripts['test:e2e:layout'], /playwright\.layout\.config\.ts/);
  const config = read('playwright.layout.config.ts');
  for (const width of ['390', '768', '1280', '1920']) {
    assert.ok(config.includes(`width: ${width}`), `viewport ${width}`);
  }
});

test('Oct 25 deliverables are on disk', () => {
  for (const file of [
    'src/components/scribe/RecordingStatusBar.tsx',
    'src/components/scribe/DraftSuggestions.tsx',
    'src/components/chart/ChartHistoryCard.tsx',
    'src/components/visits/VisitSessionTabs.tsx',
    'src/lib/scribe-feedback/mseAliases.ts',
    'src/lib/scribe-feedback/spokenMeasures.ts',
    'src/lib/scribe-feedback/draftGroups.ts',
    'src/lib/scribe-feedback/withheld.ts',
    'src/lib/chart-digest/access.ts',
    'src/lib/chart-digest/build.ts',
    'src/lib/chart-digest/copy.ts',
    'src/lib/chart-digest/kinds.ts',
    'src/lib/previsit/enrichedBrief.ts',
    'src/app/api/clients/[id]/chart-digest/route.ts',
    'prisma/migrations/20261025110000_scribe_recording_gaps/migration.sql',
    'prisma/migrations/20261025120000_chart_history_digest/migration.sql',
    'scripts/chart-digest.ts',
    'scripts/chart-digest-prep.ts',
  ]) {
    assert.ok(existsSync(join(root, file)), `${file} exists`);
  }
});

test('chart digest migration foreign keys point at existing tables', () => {
  const sql = read('prisma/migrations/20261025120000_chart_history_digest/migration.sql');
  assert.match(sql, /REFERENCES "Organization"\("id"\)/);
  assert.match(sql, /REFERENCES "Client"\("id"\)/);
});
