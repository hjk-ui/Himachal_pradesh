import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ITEM_SECTIONS } from '../src/lib/ai/chartDigest/types';
import { canViewChartDigest } from '../src/lib/ai/chartDigest/service';
import { PANEL_ORDER, canSeeChartHistoryTab, chartHistoryPanelSections, panelAudience } from '../src/lib/ai/chartDigest/panelOrder';

const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const notes = read('src/app/dashboard/ehr/notes/page.tsx');
const drawer = read('src/components/telehealth/InCallEhrDrawer.tsx');
const card = read('src/components/ai/ChartHistoryCard.tsx');
const tabs = read('src/components/ai/SessionSideTabs.tsx');

const ROLES = [
  'SUPER_ADMIN', 'ADMIN', 'PRACTICE_DIRECTOR', 'DIRECTOR', 'THERAPIST', 'PSYCHIATRIST', 'NP', 'PHYSICIAN', 'MEDICAL_NP',
  'MEDICAL_ASSISTANT', 'PRP_SPECIALIST', 'CASE_MANAGER', 'PEER_SUPPORT', 'OFFICE_MANAGER', 'FRONT_DESK', 'BILLING_SPECIALIST',
  'HR_MANAGER', 'CLIENT', 'client', '',
];

test('audience ordering: prescribers see meds / risk / medical first, therapists therapy / risk / trauma first', () => {
  assert.equal(panelAudience('PSYCHIATRIST'), 'prescriber');
  assert.equal(panelAudience('NP'), 'prescriber');
  assert.equal(panelAudience('THERAPIST'), 'therapist');
  assert.deepEqual(chartHistoryPanelSections('PSYCHIATRIST').slice(0, 3).map((s) => s.key), ['medicationTrials', 'riskHistory', 'medical']);
  assert.deepEqual(chartHistoryPanelSections('THERAPIST').slice(0, 3).map((s) => s.key), ['therapy', 'riskHistory', 'trauma']);
  // every digest section is listed exactly once for both audiences (nothing hidden, only reordered)
  for (const order of Object.values(PANEL_ORDER)) {
    assert.deepEqual([...order].sort(), [...ITEM_SECTIONS, 'medicationTrials'].sort());
  }
  const t = chartHistoryPanelSections('THERAPIST');
  assert.equal(t.find((s) => s.key === 'therapy')?.defaultOpen, true);
  assert.equal(t.find((s) => s.key === 'medicationTrials')?.defaultOpen, false);
});

test('tab visibility mirrors the API role gate (roles the API denies never see the tab)', () => {
  for (const r of ROLES) assert.equal(canSeeChartHistoryTab(r), r ? canViewChartDigest(r) : false, r);
  assert.equal(canSeeChartHistoryTab(null), false);
});

test('note editor side panel has a Chart history tab next to the visit guide, mounted only when active', () => {
  assert.match(notes, /<SessionSideTabs/);
  assert.match(notes, /id: 'guide',\s*label: 'Visit guide'/);
  assert.match(notes, /id: 'history',\s*label: 'Chart history'/);
  assert.match(notes, /<ChartHistoryCard[\s\S]{0,200}variant="panel"/);
  assert.match(notes, /canSeeChartHistoryTab\(/);
  // drawer below lg uses the same tabs (stacks into the existing visit-guide drawer)
  assert.match(notes, /tabs=\{sessionSideTabs\(true\)\}/);
  assert.match(notes, /tabs=\{sessionSideTabs\(false\)\}/);
  // 403 hides the tab for that client
  assert.match(notes, /onDenied=\{\(\) => setChartDeniedIds/);
  assert.match(notes, /!chartDeniedIds\.includes\(noteClientId\)/);
  // only the active tab renders (lazy)
  assert.match(tabs, /\{current\.render\(\)\}/);
  assert.match(tabs, /role="tablist"/);
  assert.match(tabs, /role="tab"/);
  assert.match(tabs, /aria-selected=\{selected\}/);
  assert.match(tabs, /ArrowRight/);
});

test('in-call EHR drawer has a Chart history tab, lazy, hidden on 403', () => {
  assert.match(drawer, /activeTab === 'history' && showChartHistory && \(/);
  assert.match(drawer, /aria-label="Chart history"/);
  assert.match(drawer, /<ChartHistoryCard[\s\S]{0,200}variant="panel"/);
  assert.match(drawer, /canSeeChartHistoryTab\(role\)/);
  assert.match(drawer, /setChartHistoryDenied\(true\)/);
});

test('panel loads through the audited GET only, caches per client, hides on 403', () => {
  const fetches = card.match(/fetch\(/g) ?? [];
  assert.equal(fetches.length, 1, 'one fetch path');
  assert.match(card, /fetch\(`\/api\/clients\/\$\{encodeURIComponent\(clientId\)\}\/chart-digest\?kind=\$\{kind\}`, \{ method: regenerate \? 'POST' : 'GET'/);
  assert.match(card, /res\.status === 403 \|\| \(kind === 'medical' && res\.status === 404\)\) && !regenerate/);
  assert.match(card, /onDeniedRef\.current\?\.\(\)/);
  // cached per client and kind (BH key unchanged: the client id)
  assert.match(card, /const cacheKey = kind === 'medical' \? `medical:\$\{clientId\}` : clientId;/);
  assert.match(card, /if \(cache\?\.has\(cacheKey\)\) return;/);
  assert.match(card, /cache\?\.set\(cacheKey, payload\)/);
  // the cache is owned by the host (page session), never module-global
  assert.doesNotMatch(card, /^const \w+ = new Map/m);
  assert.match(notes, /useState\(createChartDigestCache\)/);
  assert.match(drawer, /useState\(createChartDigestCache\)/);
});

test('panel keeps the AI label, generatedAt, out-of-date state, empty state and regenerate gating', () => {
  assert.match(card, /AI-generated from chart documents — verify before relying on it/);
  assert.match(card, /\{label\}/);
  assert.match(card, /chartHistoryEmptyState\(/, 'empty state: "will be prepared before the next visit" / "Not generated yet."');
  assert.match(card, /Out of date:/);
  assert.match(card, /view\.generatedAt/);
  assert.match(card, /view\?\.canRegenerate \?/);
  assert.match(card, /'Regenerate' : 'Generate'/);
  assert.match(card, /function PanelSkeleton/);
  // collapsible sections, keyboard accessible (native details / summary)
  assert.match(card, /<details key=\{s\.key\}/);
  assert.match(card, /<summary/);
});

test('citations open the source document (at the page) in a new tab', () => {
  assert.match(card, /target="_blank" rel="noopener noreferrer"/);
  assert.match(card, /#page=\$\{c\.page\}/);
});
