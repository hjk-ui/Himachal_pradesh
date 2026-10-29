import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { AI_SAFETY_BLOCK_MARK, AiSafetyBlockedError, guardrailFor, guardrailTagged, textForGroundingCheck } from '../src/lib/ai/bedrockService';

/** Bedrock guardrails (docs/ai-guardrails.md): clinical by default, general for HR + marketing. */
const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('guardrailFor reads the clinical / general ids and versions; none set = no guardrail', () => {
  const keys = ['BEDROCK_GUARDRAIL_CLINICAL_ID', 'BEDROCK_GUARDRAIL_CLINICAL_VERSION', 'BEDROCK_GUARDRAIL_GENERAL_ID', 'BEDROCK_GUARDRAIL_GENERAL_VERSION'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  try {
    keys.forEach((k) => delete process.env[k]);
    assert.equal(guardrailFor('clinical'), null);
    process.env.BEDROCK_GUARDRAIL_CLINICAL_ID = 'clin1';
    process.env.BEDROCK_GUARDRAIL_CLINICAL_VERSION = '1';
    process.env.BEDROCK_GUARDRAIL_GENERAL_ID = 'gen1';
    assert.deepEqual(guardrailFor('clinical'), { id: 'clin1', version: '1' });
    assert.deepEqual(guardrailFor('general'), { id: 'gen1', version: 'DRAFT' });
  } finally {
    keys.forEach((k) => (saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k])));
  }
});

test('grounding check ignores [S1]-style citation tags', () => {
  assert.equal(textForGroundingCheck('Up to 40 hours carries over [S1]. Requests go to your supervisor [S2].'), 'Up to 40 hours carries over. Requests go to your supervisor.');
});

test('blocked replies raise AiSafetyBlockedError; masked replies are returned', () => {
  const src = read('src/lib/ai/bedrockService.ts');
  assert.match(src, /'amazon-bedrock-guardrailAction'\] === 'INTERVENED' && text\.trim\(\)\.startsWith\(AI_SAFETY_BLOCK_MARK\)/);
  const err = new AiSafetyBlockedError('not_grounded', 'general');
  assert.equal(err.code, 'AI_SAFETY_BLOCKED');
  assert.equal(AI_SAFETY_BLOCK_MARK, '[Altrixs AI safety filter]');
});

test('HR and marketing AI run under the general guardrail; HR policy answers are grounding-checked', () => {
  const hr = read('src/lib/hr/ai.ts');
  assert.match(hr, /guard: 'general', grounding/);
  assert.match(hr, /query: question\.slice\(0, 500\)/);
  assert.match(read('src/lib/marketing/ai.ts'), /guard: 'general'/);
});

test('clinical is the default, so clinical features never fall under the strict filters', () => {
  assert.match(read('src/lib/ai/bedrockService.ts'), /guard = 'clinical',/);
});

test('the user prompt is tagged for the prompt-attack filter, with a per-call suffix', () => {
  assert.equal(guardrailTagged('hello', 'ab12'), '<amazon-bedrock-guardrails-guardContent_ab12>hello</amazon-bedrock-guardrails-guardContent_ab12>');
  const src = read('src/lib/ai/bedrockService.ts');
  assert.match(src, /randomBytes\(6\)\.toString\('hex'\)/);
  assert.match(src, /'amazon-bedrock-guardrailConfig': \{ tagSuffix \}/);
});
