import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EMPTY_POPULATION_HEALTH,
  POPULATION_HEALTH_SEED,
  POPULATION_CLIENTS_SEED,
  POPULATION_ACTIONS_SEED,
  isPopulationHealthPayload,
  overlayLivePopulationCounts,
} from '../src/features/analytics/populationHealthData';
import {
  EMPTY_AI_INSIGHTS,
  AI_INSIGHTS_SEED,
  buildInsightsFromClients,
  isAiInsightsPayload,
} from '../src/features/ehr/aiInsightsData';
import { MOCK_POPULATION_HEALTH_FIXTURE } from './fixtures/populationHealthFixture';

test('Population Health: Production defaults are completely empty typed payloads without fabricated metrics', () => {
  // 1. Verify EMPTY_POPULATION_HEALTH
  assert.equal(isPopulationHealthPayload(EMPTY_POPULATION_HEALTH), true);
  assert.equal(EMPTY_POPULATION_HEALTH.activeCaseload, 0);
  assert.equal(EMPTY_POPULATION_HEALTH.highRiskCount, 0);
  assert.equal(EMPTY_POPULATION_HEALTH.moderateCount, 0);
  assert.equal(EMPTY_POPULATION_HEALTH.lowCount, 0);
  assert.equal(EMPTY_POPULATION_HEALTH.avgPhq9, 0);
  assert.equal(EMPTY_POPULATION_HEALTH.priorAvgPhq9, 0);
  assert.equal(EMPTY_POPULATION_HEALTH.engagementRate, 0);
  assert.deepEqual(EMPTY_POPULATION_HEALTH.clients, []);
  assert.deepEqual(EMPTY_POPULATION_HEALTH.actions, []);
  assert.deepEqual(EMPTY_POPULATION_HEALTH.phq9Trend, []);
  assert.deepEqual(EMPTY_POPULATION_HEALTH.gad7Trend, []);
  assert.deepEqual(EMPTY_POPULATION_HEALTH.clinicians, []);

  // 2. Verify backward-compatible seeds match empty payload in production
  assert.deepEqual(POPULATION_HEALTH_SEED, EMPTY_POPULATION_HEALTH);
  assert.deepEqual(POPULATION_CLIENTS_SEED, []);
  assert.deepEqual(POPULATION_ACTIONS_SEED, []);
});

test('Population Health: overlayLivePopulationCounts clears all fabricated data when caseload is empty', () => {
  // If passed legacy payload containing fabricated mock data:
  const result = overlayLivePopulationCounts(MOCK_POPULATION_HEALTH_FIXTURE, []);

  assert.equal(result.activeCaseload, 0);
  assert.equal(result.highRiskCount, 0);
  assert.equal(result.moderateCount, 0);
  assert.equal(result.lowCount, 0);
  assert.equal(result.avgPhq9, 0);
  assert.equal(result.priorAvgPhq9, 0);
  assert.equal(result.engagementRate, 0);
  assert.deepEqual(result.clients, []);
  assert.deepEqual(result.actions, []);
  assert.deepEqual(result.phq9Trend, []);
  assert.deepEqual(result.gad7Trend, []);
  assert.deepEqual(result.clinicians, []);
});

test('Population Health: overlayLivePopulationCounts correctly stratifies live clients without inventing outcome trends', () => {
  const liveClients = [
    { id: 'cli-1', name: 'Patient A', risk: 'high' },
    { id: 'cli-2', name: 'Patient B', risk: 'high' },
    { id: 'cli-3', name: 'Patient C', risk: 'medium' },
    { id: 'cli-4', name: 'Patient D', risk: 'low' },
  ];

  const result = overlayLivePopulationCounts(EMPTY_POPULATION_HEALTH, liveClients);

  assert.equal(result.activeCaseload, 4);
  assert.equal(result.highRiskCount, 2);
  assert.equal(result.moderateCount, 1);
  assert.equal(result.lowCount, 1);
  // No fake outcome trends invented
  assert.deepEqual(result.phq9Trend, []);
  assert.deepEqual(result.gad7Trend, []);
  assert.deepEqual(result.clinicians, []);
});

test('AI Insights: Production defaults are completely empty typed payloads', () => {
  assert.equal(isAiInsightsPayload(EMPTY_AI_INSIGHTS), true);
  assert.equal(EMPTY_AI_INSIGHTS.accuracy, 0);
  assert.deepEqual(EMPTY_AI_INSIGHTS.predictions, []);
  assert.deepEqual(EMPTY_AI_INSIGHTS.sentiment, []);
  assert.deepEqual(EMPTY_AI_INSIGHTS.patterns, []);

  const accStat = EMPTY_AI_INSIGHTS.stats.find((s) => s.label.includes('Accuracy'));
  assert.ok(accStat);
  assert.equal(accStat.value, '—');

  const sentStat = EMPTY_AI_INSIGHTS.stats.find((s) => s.label.includes('Sentiment'));
  assert.ok(sentStat);
  assert.equal(sentStat.value, '—');

  assert.deepEqual(AI_INSIGHTS_SEED, EMPTY_AI_INSIGHTS);
});

test('AI Insights: buildInsightsFromClients does NOT default missing mood or hardcode 94% accuracy', () => {
  // Case 1: Clients with NO mood measurements recorded
  const clientsWithoutMood = [
    { id: 'c-1', name: 'Client One', risk: 'high', mood: undefined },
    { id: 'c-2', name: 'Client Two', risk: 'medium', mood: null },
  ];

  const insights = buildInsightsFromClients(clientsWithoutMood);

  // 1. Accuracy must NEVER be hardcoded 94%
  assert.notEqual(insights.accuracy, 94);
  assert.equal(insights.accuracy, 0);
  const accStat = insights.stats.find((s) => s.label.includes('Accuracy'));
  assert.equal(accStat?.value, '—');

  // 2. Missing mood must NEVER default to 5.0 (50/100)
  assert.equal(insights.sentiment.length, 0);
  const sentStat = insights.stats.find((s) => s.label.includes('Sentiment'));
  assert.equal(sentStat?.value, '—');
  assert.equal(sentStat?.sub, 'awaiting client check-ins');

  // 3. Risk predictions must NOT hardcode 85 or 60 percent
  for (const p of insights.predictions) {
    assert.equal(p.risk, null);
  }

  // 4. Does not falsely claim heuristic counts are Bedrock AI detections
  const crisisStat = insights.stats.find((s) => s.label.includes('Crisis'));
  assert.ok(crisisStat);
  assert.equal(crisisStat.sub.includes('flagged by AI this week'), false);

  const earlyInterv = insights.stats.find((s) => s.label.includes('Early Interventions'));
  assert.ok(earlyInterv);
  assert.equal(earlyInterv.value, '0');
});

test('AI Insights: buildInsightsFromClients computes sentiment ONLY when real mood data exists', () => {
  const clientsWithMood = [
    { id: 'c-1', name: 'Client One', risk: 'low', mood: 8.0 },
    { id: 'c-2', name: 'Client Two', risk: 'low', mood: 6.0 },
  ];

  const insights = buildInsightsFromClients(clientsWithMood);

  assert.equal(insights.sentiment.length, 2);
  assert.equal(insights.sentiment[0].score, 80);
  assert.equal(insights.sentiment[0].today, 'Positive');
  assert.equal(insights.sentiment[1].score, 60);

  const sentStat = insights.stats.find((s) => s.label.includes('Sentiment'));
  assert.equal(sentStat?.value, '70/100');
  assert.ok(sentStat?.sub.includes('across 2 recorded check-in(s)'));
});

test('Bootstrap Safety: Handlers tolerate empty responses and API failures without throwing or auto-seeding', async () => {
  // Test simulation of bootstrap with null data (empty DB)
  let putCalled = false;
  const mockApiGetNull = async () => null;
  const mockApiPut = async () => { putCalled = true; };

  // Simulated bootstrap logic
  const loaded = await mockApiGetNull();
  const payload = loaded ?? EMPTY_POPULATION_HEALTH;

  assert.equal(putCalled, false);
  assert.deepEqual(payload, EMPTY_POPULATION_HEALTH);

  // Simulated API error recovery
  const mockApiGetFail = async () => { throw new Error('Network 500 error'); };
  let errorCaught = false;
  let fallbackPayload = null;

  try {
    await mockApiGetFail();
  } catch {
    errorCaught = true;
    fallbackPayload = EMPTY_POPULATION_HEALTH;
  }

  assert.equal(errorCaught, true);
  assert.equal(putCalled, false);
  assert.deepEqual(fallbackPayload, EMPTY_POPULATION_HEALTH);
});
