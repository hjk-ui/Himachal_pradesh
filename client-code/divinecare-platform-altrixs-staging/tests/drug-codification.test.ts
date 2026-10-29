/**
 * Drug codification (DrFirst AUM2 / AUM3 / AUR1, MUM2 / MUM3 / MUM4 / MUR1): the NLM RxNav client
 * (search parsing, SCD / SBD selection, NDC list, cache, timeout fallback), the backfill matcher (only
 * exact single matches are applied; strengths never guessed) and the DrFirst send builders (code +
 * name / form / strength + several NDCs). RxNav responses are real samples recorded Oct 20 2026
 * (tests/fixtures/rxnav, RxNorm 05-Oct-2026). No network: fetch is stubbed.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import {
  RxNavUnavailableError,
  TtlLru,
  createRxNavClient,
  displayName,
  parseApproximate,
  parseAttributes,
  parseConceptGroups,
  parseIdGroup,
  parseNdcs,
  parseProperties,
  type RxNavFetch,
} from '../src/lib/drugs/rxnav';
import { classifyNonDrug, matchAllergy, matchMedication, productHasForm, productStrength, strengthKey } from '../src/lib/drugs/codify';
import { backfillUpdates, planBackfill } from '../src/lib/drugs/backfill';
import { resolveDrugCode } from '../src/lib/drugs/resolve';
import { DRUG_LOOKUP_UNAVAILABLE, allergyNeedsCode, medicationCodeFields } from '../src/lib/drugs/types';
import {
  allergyPlan,
  chartMedicationToRcopia,
  codificationReadiness,
  fingerprint,
  ndcList,
  type ChartAllergy,
  type ChartMedication,
} from '../src/lib/drfirst/chartMapping';

// ─── Fixture-backed RxNav ────────────────────────────────────────────────────

const FIXTURES = new URL('./fixtures/rxnav/', import.meta.url);
/** Same naming as the recorder: request path, lower-cased, non-alphanumerics -> "_" */
const fixtureName = (path: string) => path.toLowerCase().replace(/^\//, '').replace(/[^a-z0-9]+/g, '_').replace(/_json/, '') + '.json';
const fx = (path: string) => JSON.parse(readFileSync(new URL(fixtureName(path), FIXTURES), 'utf8'));

function fixtureClient(opts: { now?: () => number } = {}) {
  const requests: string[] = [];
  const missing: string[] = [];
  const fetchStub: RxNavFetch = async url => {
    const path = url.replace('https://rxnav.nlm.nih.gov/REST', '');
    requests.push(path);
    const file = new URL(fixtureName(path), FIXTURES);
    if (!existsSync(file)) {
      missing.push(path);
      return { ok: false, status: 404, json: async () => ({}) };
    }
    return { ok: true, status: 200, json: async () => JSON.parse(readFileSync(file, 'utf8')) };
  };
  const rx = createRxNavClient({ fetch: fetchStub, baseUrl: 'https://rxnav.nlm.nih.gov/REST', ...opts });
  return { rx, requests, missing };
}

// ─── Parsing ─────────────────────────────────────────────────────────────────

test('RxNav parsing: drugs.json concept groups, approximateTerm, rxcui.json, properties, NDCs, attributes', () => {
  const concepts = parseConceptGroups(fx('/drugs.json?name=sertraline'));
  assert.ok(concepts.length >= 8);
  assert.deepEqual([...new Set(concepts.map(c => c.tty))].sort(), ['SBD', 'SCD']);
  const scd = concepts.find(c => c.rxcui === '312941');
  assert.equal(scd?.name, 'sertraline 50 MG Oral Tablet');
  assert.deepEqual(parseConceptGroups(fx('/drugs.json?name=xyzzyfoo')), [], 'no match: {"drugGroup":{"name":null}}');

  assert.equal(parseApproximate(fx('/approximateTerm.json?term=sertralin&maxEntries=10&option=1'))[0], '36437', 'RxNorm-source candidates, best rank first');
  assert.deepEqual(parseIdGroup(fx('/rxcui.json?name=zoloft&search=2')), ['82728']);
  assert.deepEqual(parseIdGroup(fx('/rxcui.json?name=penicillin&search=2')), [], 'no exact concept named "penicillin"');
  assert.equal(parseProperties({})?.rxcui, undefined, 'unknown RxCUI answers {}');
  assert.equal(parseProperties(fx('/rxcui/7980/properties.json'))?.tty, 'IN');

  const ndcs = parseNdcs(fx('/rxcui/208161/ndcs.json'));
  assert.equal(ndcs.length, 14);
  assert.ok(ndcs.every(n => /^\d{11}$/.test(n)));
  assert.deepEqual(parseAttributes(fx('/rxcui/857005/allProperties.json?prop=attributes')), { strength: '325 MG / 7.5 MG', deaSchedule: '2' });

  // Brand-first labels for branded drugs ("(as ...)" salt notes dropped)
  const sbd = parseConceptGroups(fx('/drugs.json?name=zoloft')).map(displayName);
  assert.ok(sbd.includes('Zoloft 50 MG Oral Tablet'));
  assert.ok(sbd.includes('Zoloft 100 MG Oral Tablet'), 'synonym "Zoloft (as sertraline hydrochloride) 100 MG ..." is cleaned');
});

// ─── Search ──────────────────────────────────────────────────────────────────

test('medication search: specific drugs only (SCD / SBD), generic first; brand + strength narrows; misspelling falls back', async () => {
  const { rx, missing } = fixtureClient();
  const hits = await rx.searchMedications('sertraline');
  assert.ok(hits.length >= 8);
  assert.ok(hits.every(h => ['SCD', 'SBD', 'GPCK', 'BPCK'].includes(h.tty)), 'only drugs with strength + form');
  assert.equal(hits[0].tty, 'SCD', 'generic before brand');
  assert.ok(hits.some(h => h.rxcui === '312941' && h.display === 'sertraline 50 MG Oral Tablet'));
  assert.ok(hits.some(h => h.rxcui === '208161' && h.display === 'Zoloft 50 MG Oral Tablet'));

  const zoloft50 = await rx.searchMedications('zoloft 50mg');
  assert.deepEqual(zoloft50.map(h => h.rxcui), ['208161'], '"zoloft 50mg": the brand at that strength');

  const typo = await rx.searchMedications('sertralin');
  assert.ok(typo.some(h => h.rxcui === '312941'), 'approximateTerm -> ingredient -> its SCD / SBD');
  assert.deepEqual(await rx.searchMedications('s'), [], 'one character: no lookup');
  assert.deepEqual(missing, []);
});

test('drug-allergy search: ingredients; a brand resolves to its ingredient', async () => {
  const { rx, missing } = fixtureClient();
  const pen = await rx.searchAllergens('penicillin');
  assert.deepEqual(pen.map(h => [h.rxcui, h.tty]), [['7984', 'IN'], ['7980', 'IN']]);
  const zol = await rx.searchAllergens('zoloft');
  assert.deepEqual(zol.map(h => [h.rxcui, h.display]), [['36437', 'Zoloft (sertraline)']]);
  assert.deepEqual(missing, []);
});

// ─── Full code: SCD / SBD selection, NDCs ────────────────────────────────────

test('getDrugCode: SBD brand + generic, RxNorm form + strength, all NDCs, RxNorm release', async () => {
  const { rx, missing } = fixtureClient();
  const now = new Date('2026-10-20T15:00:00Z');
  const sbd = await rx.getDrugCode('208161', now);
  assert.deepEqual(
    { ...sbd, ndcs: sbd?.ndcs.length },
    {
      rxcui: '208161', tty: 'SBD', name: 'sertraline 50 MG Oral Tablet [Zoloft]', display: 'Zoloft 50 MG Oral Tablet',
      genericName: 'sertraline', brandName: 'Zoloft', doseForm: 'Oral Tablet', strength: '50 MG', ndcs: 14,
      deaSchedule: '0', version: 'RxNorm 05-Oct-2026', lookedUpAt: now.toISOString(),
    },
  );
  const scd = await rx.getDrugCode('312941', now);
  assert.equal(scd?.brandName, undefined, 'a generic drug never carries a brand (RxNav relates SCDs to brands)');
  assert.equal(scd?.ndcs.length, 313);
  const combo = await rx.getDrugCode('857005', now);
  assert.equal(combo?.genericName, 'acetaminophen / hydrocodone');
  assert.equal(combo?.strength, '325 MG / 7.5 MG');
  assert.equal(combo?.deaSchedule, '2');
  const ingredient = await rx.getDrugCode('36437', now);
  assert.deepEqual([ingredient?.tty, ingredient?.doseForm, ingredient?.strength, ingredient?.ndcs], ['IN', undefined, undefined, []]);
  assert.equal(await rx.getDrugCode('abc'), null, 'not an RxCUI: no request');
  assert.deepEqual(missing, []);

  // Stored columns (ClientMedication): NDC list + first NDC, lookup date and release
  const cols = medicationCodeFields(sbd!, now);
  assert.equal(cols.rxnormId, '208161');
  assert.equal(cols.rxnormTty, 'SBD');
  assert.equal(cols.ndcCode, sbd!.ndcs[0]);
  assert.equal(cols.ndcCodes.length, 14);
  assert.equal(cols.drugCodeVersion, 'RxNorm 05-Oct-2026');
  assert.equal(cols.drugCodedAt, now);
});

test('resolveDrugCode: medications need strength + form (SCD / SBD); allergies take an ingredient', async () => {
  const { rx } = fixtureClient();
  assert.equal((await resolveDrugCode('312941', 'medication', rx)).ok, true);
  const ing = await resolveDrugCode('36437', 'medication', rx);
  assert.deepEqual([ing.ok, ing.ok === false && ing.unavailable], [false, false]);
  assert.equal((await resolveDrugCode('36437', 'allergy', rx)).ok, true);
});

// ─── Cache ───────────────────────────────────────────────────────────────────

test('cache: TTL expiry and least-recently-used eviction', () => {
  let t = 0;
  const lru = new TtlLru<number>(2, 1000, () => t);
  lru.set('a', 1);
  lru.set('b', 2);
  assert.equal(lru.get('a'), 1, 'a is now most recent');
  lru.set('c', 3);
  assert.equal(lru.get('b'), undefined, 'b was least recently used');
  assert.equal(lru.get('a'), 1);
  t = 1000;
  assert.equal(lru.get('a'), undefined, 'expired at the TTL');
  assert.equal(lru.size, 1);
});

test('cache: repeated lookups are served from memory until the TTL passes', async () => {
  let t = 0;
  const { rx, requests } = fixtureClient({ now: () => t });
  await rx.searchMedications('sertraline');
  await rx.getDrugCode('208161');
  const first = requests.length;
  await rx.searchMedications('sertraline');
  await rx.getDrugCode('208161');
  assert.equal(requests.length, first, 'second search + code: no request');
  assert.equal(rx.stats().calls, first);
  t = 25 * 3600 * 1000;
  await rx.searchMedications('sertraline');
  assert.equal(requests.length, first + 1, 'after 24 h the search is fetched again');
});

// ─── Timeout / failure fallback ──────────────────────────────────────────────

test('timeout fallback: a hung RxNav aborts, is not cached, and turns into "enter as free text"', async () => {
  let calls = 0;
  const hung: RxNavFetch = (_url, init) => {
    calls++;
    return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
  };
  const rx = createRxNavClient({ fetch: hung, timeoutMs: 30 });
  const started = Date.now();
  await assert.rejects(rx.searchMedications('sertraline'), (err: unknown) => err instanceof RxNavUnavailableError && err.reason === 'timeout');
  assert.ok(Date.now() - started < 2000, 'gave up at the timeout');
  await assert.rejects(rx.searchMedications('sertraline'));
  assert.equal(calls, 2, 'failures are not cached');

  const down = createRxNavClient({ fetch: async () => ({ ok: false, status: 503, json: async () => ({}) }) });
  await assert.rejects(down.searchAllergens('penicillin'), (err: unknown) => err instanceof RxNavUnavailableError && err.reason === 'http_503');
  const offline = createRxNavClient({ fetch: async () => { throw new TypeError('fetch failed'); } });
  const r = await resolveDrugCode('312941', 'medication', offline);
  assert.deepEqual(r, { ok: false, unavailable: true, error: DRUG_LOOKUP_UNAVAILABLE });
  assert.equal(DRUG_LOOKUP_UNAVAILABLE, 'Drug lookup unavailable — enter as free text');
  const m = await matchMedication({ medicationName: 'Sertraline 50 mg tablet' }, offline);
  assert.equal(m.status, 'unavailable', 'the backfill skips, never guesses, when RxNav is down');
});

test('a hung request\'s AbortSignal is the RxNav 8 s default', () => {
  // The client is built with AbortSignal.timeout(8000) unless told otherwise (no PHI in the URL either)
  const src = readFileSync(new URL('../src/lib/drugs/rxnav.ts', import.meta.url), 'utf8');
  assert.match(src, /RXNAV_TIMEOUT_MS = 8_000/);
  assert.match(src, /AbortSignal\.timeout\(timeoutMs\)/);
});

// ─── Backfill: only exact single matches ─────────────────────────────────────

test('backfill helpers: strength keys, single-strength products, dose form words, non-drug allergens', () => {
  assert.equal(strengthKey('50 mg'), strengthKey('50 MG'));
  assert.equal(strengthKey('.5 mg/mL'), '0.5mg/ml');
  assert.equal(strengthKey('1,000 units'), '1000unt');
  assert.equal(productStrength('12 HR bupropion hydrochloride 150 MG Extended Release Oral Tablet'), '150 MG', '"12 HR" is not a strength');
  assert.equal(productStrength('sertraline 20 MG/ML Oral Solution'), '20 MG/ML');
  assert.equal(productStrength('acetaminophen 325 MG / hydrocodone bitartrate 7.5 MG Oral Tablet'), null, 'combinations never auto-match');
  assert.equal(productHasForm('sertraline 50 MG Oral Tablet', 'tablet'), true);
  assert.equal(productHasForm('sertraline 200 MG Oral Capsule', 'tablet'), false);
  assert.equal(productHasForm('24 HR bupropion hydrochloride 150 MG Extended Release Oral Tablet', 'extended-release tablet'), true);
  assert.equal(classifyNonDrug('Peanuts'), 'food');
  assert.equal(classifyNonDrug('latex'), 'environmental');
  assert.equal(classifyNonDrug('Bee stings'), 'environmental');
  assert.equal(classifyNonDrug('Penicillin'), null);
});

test('backfill: auto-applies only unambiguous exact matches; never guesses between strengths or forms', async () => {
  const { rx, missing } = fixtureClient();
  const plan = await planBackfill({
    medications: [
      { id: 'm1', clientId: 'c1', medicationName: 'Sertraline 50 mg tablet' },     // exact RxNorm name (normalized)
      { id: 'm2', clientId: 'c1', medicationName: 'Zoloft', dosage: '50 mg' },     // the one Zoloft at 50 mg
      { id: 'm3', clientId: 'c1', medicationName: 'bupropion 150 mg tablet' },     // 12 HR / 24 HR / smoking cessation
      { id: 'm4', clientId: 'c1', medicationName: 'sertraline', dosage: '' },      // no strength recorded
      { id: 'm5', clientId: 'c1', medicationName: 'Sertraline', dosage: '75 mg' }, // no 75 mg product
      { id: 'm6', clientId: 'c1', medicationName: 'Xyzzyfoo', dosage: '10 mg' },   // not a drug
    ],
    allergies: [
      { id: 'a1', clientId: 'c1', allergen: 'Penicillin' }, // penicillin G or V: staff pick
      { id: 'a2', clientId: 'c1', allergen: 'Sertraline' }, // exact ingredient
      { id: 'a3', clientId: 'c1', allergen: 'Peanuts' },    // food: classified, never coded
      { id: 'a4', clientId: 'c1', allergen: 'NKDA' },       // not an allergen
      { id: 'a5', clientId: 'c1', allergen: 'Zoloft' },     // brand with one ingredient
    ],
  }, rx);
  assert.deepEqual(missing, []);
  const status = Object.fromEntries(plan.items.map(i => [i.id, i.result.status]));
  assert.deepEqual(status, {
    m1: 'exact', m2: 'exact', m3: 'review', m4: 'review', m5: 'review', m6: 'no_match',
    a1: 'review', a2: 'exact', a3: 'non_drug', a4: 'skip', a5: 'exact',
  });
  const m3 = plan.items.find(i => i.id === 'm3')!.result;
  assert.ok(m3.status === 'review' && m3.candidates.length === 3, 'all three 150 mg bupropion tablets offered, none chosen');
  const m4 = plan.items.find(i => i.id === 'm4')!.result;
  assert.match(m4.status === 'review' ? m4.reason : '', /never guessed/);
  assert.deepEqual(plan.counts.medication, { exact: 2, review: 3, no_match: 1, non_drug: 0, skip: 0, unavailable: 0, total: 6 });
  assert.deepEqual(plan.counts.allergy, { exact: 2, review: 1, no_match: 0, non_drug: 1, skip: 1, unavailable: 0, total: 5 });

  const updates = backfillUpdates(plan, new Date('2026-10-20T15:00:00Z'));
  assert.deepEqual(updates.medications.map(u => [u.id, u.data.rxnormId, u.data.doseForm, u.data.strength]), [
    ['m1', '312941', 'Oral Tablet', '50 MG'],
    ['m2', '208161', 'Oral Tablet', '50 MG'],
  ]);
  assert.deepEqual(updates.allergies.map(u => [u.id, u.data.rxnormId ?? null, u.data.allergenType]), [
    ['a2', '36437', 'drug'],
    ['a3', null, 'food'],
    ['a5', '36437', 'drug'],
  ]);
});

test('backfill: a recorded RxNorm code is upgraded only when it is a specific drug', async () => {
  const { rx } = fixtureClient();
  assert.deepEqual(await matchMedication({ medicationName: 'Sertraline', dosage: '25 mg', rxnormId: '312940' }, rx), {
    status: 'exact', rxcui: '312940', reason: 'RxNorm code already on the record',
  });
  assert.equal((await matchAllergy({ allergen: 'Penicillin', allergenType: 'food' }, rx)).status, 'skip');
});

// ─── DrFirst send builders (MUM2 / MUM4 / MUR1, AUM2 / AUR1) ─────────────────

const NDCS = parseNdcs(fx('/rxcui/208161/ndcs.json'));
const BASE: ChartMedication = {
  id: 'm1', medicationName: 'Zoloft', dosage: '50 mg', route: 'by mouth', frequency: 'once a day', instructions: null,
  startDate: new Date('2026-09-01T00:00:00Z'), endDate: null, stopDate: null, stopReason: null, active: true, status: 'active',
  source: 'reported', rcopiaMedId: null, drugName: null, brandName: null, genericName: null, ndcCode: null, rxnormId: null,
  action: 'Take', dose: '1', doseUnit: 'tablet', quantity: null, refills: null, asNeeded: false, prnReason: null, schedule: 'nonscheduled',
  updatedAt: new Date('2026-10-01T00:00:00Z'),
};
const CODED: ChartMedication = {
  ...BASE, drugName: 'Zoloft 50 MG Oral Tablet', rxnormId: '208161', rxnormTty: 'SBD', genericName: 'sertraline', brandName: 'Zoloft',
  doseForm: 'Oral Tablet', strength: '50 MG', ndcCodes: NDCS, ndcCode: NDCS[0], drugCodedAt: new Date('2026-10-20T15:00:00Z'),
};

test('MUM2 / MUM4 / MUR1: a coded medication carries RxNorm + type, up to 10 NDCs, brand + generic name, form and strength', () => {
  const med = chartMedicationToRcopia(CODED);
  assert.equal(med.rxnormId, '208161');
  assert.equal(med.rxnormIdType, 'SBD');
  assert.equal(med.ndcId, NDCS.slice(0, 10).join(','), 'several NDCs, at most 10');
  assert.equal(med.brandName, 'Zoloft');
  assert.equal(med.genericName, 'sertraline');
  assert.equal(med.form, 'Oral Tablet');
  assert.equal(med.strength, '50 MG');
  assert.equal(med.schedule, undefined, 'no free-text flags on a coded drug');
  assert.equal(med.externalId, 'altrixs-med-m1');
  assert.equal(med.doseTiming, 'once a day', 'sig unchanged');
  assert.equal(Object.keys(med)[0], 'externalId');
  assert.notEqual(fingerprint(med), fingerprint(chartMedicationToRcopia(BASE)), 'coding a medication resends it (MUM7)');

  const free = chartMedicationToRcopia(BASE);
  assert.equal(free.rxnormId, undefined);
  assert.equal(free.ndcId, undefined);
  assert.equal(free.schedule, 'nonscheduled', 'uncoded: sent as free text with the mandatory flags');
  assert.equal(free.genericName, 'Zoloft');
  // A code without its RxNav form / strength is not "RxNav-coded": the older text rule applies
  assert.equal(chartMedicationToRcopia({ ...CODED, doseForm: null, drugName: null, medicationName: 'Zoloft', dosage: '50 mg' }).rxnormId, undefined);
  assert.equal(ndcList(['123', ...NDCS.slice(0, 2), NDCS[0]]), NDCS.slice(0, 2).join(','), 'invalid / duplicate NDCs dropped');
});

test('AUM2 / AUR1: drug allergies are sent with their RxNorm code; food / environmental stay free text', () => {
  const rows: ChartAllergy[] = [
    { id: 'a1', allergen: 'Penicillin G', reaction: 'Hives', severity: 'Moderate', status: 'Active', allergenType: 'drug', rxnormId: '7980', rxnormTty: 'IN', ndcCodes: [] },
    { id: 'a2', allergen: 'Peanuts', reaction: null, severity: 'Severe/Anaphylaxis', status: 'Active', allergenType: 'food', rxnormId: null },
    { id: 'a3', allergen: 'Zoloft 50 MG Oral Tablet', reaction: null, severity: 'Mild', status: 'Active', allergenType: 'drug', rxnormId: '208161', rxnormTty: 'SBD', ndcCodes: NDCS },
    { id: 'a4', allergen: 'Sulfa', reaction: null, severity: 'Mild', status: 'Active', allergenType: null, rxnormId: null },
  ];
  const plan = allergyPlan(rows);
  assert.deepEqual(plan.allergies[0], { externalId: 'a1', name: 'Penicillin G', rxnormId: '7980', rxnormTty: 'IN', reaction: 'Hives', severity: 'Moderate' });
  assert.deepEqual(Object.keys(plan.allergies[1]).sort(), ['externalId', 'name', 'severity']);
  assert.equal(plan.allergies[2].ndcId, NDCS.slice(0, 10).join(','));
  assert.equal(plan.allergies[3].rxnormId, undefined);
  assert.deepEqual(rows.map(r => allergyNeedsCode(r)), [false, false, false, true]);
});

test('readiness: the DrFirst panel counts active medications and drug allergies DrFirst would get as free text', () => {
  const meds: ChartMedication[] = [
    CODED,
    { ...BASE, id: 'm2', medicationName: 'Lithium', dosage: '300 mg' },
    { ...BASE, id: 'm3', medicationName: 'Hydroxyzine', dosage: '25 mg' },
    { ...BASE, id: 'm4', medicationName: 'Prazosin', dosage: '1 mg' },
    { ...BASE, id: 'm5', medicationName: 'Old med', active: false, status: 'discontinued' },
    { ...BASE, id: 'm6', medicationName: 'From DrFirst', rcopiaMedId: 'R1' },
  ];
  const allergies: ChartAllergy[] = [
    { id: 'a1', allergen: 'Penicillin', reaction: null, severity: 'Mild', status: 'Active', allergenType: 'drug', rxnormId: null },
    { id: 'a2', allergen: 'Latex', reaction: null, severity: 'Mild', status: 'Active', allergenType: 'environmental', rxnormId: null },
    { id: 'a3', allergen: 'NKDA', reaction: null, severity: 'Mild', status: 'Active', allergenType: null, rxnormId: null },
    { id: 'a4', allergen: 'Codeine', reaction: null, severity: 'Mild', status: 'Active', source: 'drfirst', rxnormId: null },
  ];
  const r = codificationReadiness(meds, allergies);
  assert.equal(r.medicationsActive, 4);
  assert.equal(r.medicationsUncoded, 3, '"3 medications not coded"');
  assert.deepEqual(r.uncodedMedications.map(m => m.name), ['Lithium 300 mg', 'Hydroxyzine 25 mg', 'Prazosin 1 mg']);
  assert.equal(r.allergiesUncoded, 1);
  assert.deepEqual(r.uncodedAllergies, [{ id: 'a1', name: 'Penicillin', allergenType: 'drug' }]);
});

// ─── Through the real send_medication / send_allergy (fetch stubbed) ────────

function loadLive(t: { after: (fn: () => void) => void }) {
  const env = { ...process.env };
  const realFetch = globalThis.fetch;
  process.env.DRFIRST_VENDOR_USERNAME = 'vendor_test';
  process.env.DRFIRST_VENDOR_PASSWORD = 'secret-test-marker';
  process.env.DRFIRST_PRACTICE_USERNAME = 'practice_test';
  process.env.DRFIRST_ENGINE_URL = 'https://engine.test/servlet';
  process.env.DRFIRST_UPDATE_URL = 'https://update.test/servlet';
  delete process.env.DATABASE_URL;
  const sent: string[] = [];
  globalThis.fetch = (async (_url: string, init: { body: string }) => {
    sent.push(init.body);
    return new Response('<RCExtResponse><Response><Status>ok</Status></Response></RCExtResponse>', { status: 200 });
  }) as typeof fetch;
  t.after(() => { process.env = env; globalThis.fetch = realFetch; });
  const require = createRequire(import.meta.url);
  for (const k of Object.keys(require.cache)) if (/drfirst(RcopiaService|Commands)/.test(k)) delete require.cache[k];
  const svc = require('../src/lib/services/drfirstRcopiaService');
  svc.setRcopiaHooks({ apiVersion: async () => '2.54', logCall: async () => {} });
  return { cmds: require('../src/lib/services/drfirstCommands'), sent };
}

test('send_medication XML: code, type, NDC list, brand / generic name, form and strength; free text keeps its flags', async t => {
  const h = loadLive(t);
  await h.cmds.sendMedication({ rcopiaId: '27162725039' }, chartMedicationToRcopia(CODED), 'ssherman');
  const body = h.sent[0];
  const drug = body.match(/<Drug>[\s\S]*?<\/Drug>/)?.[0] || '';
  assert.match(drug, new RegExp(`<NDCID>${NDCS.slice(0, 10).join(',')}</NDCID>`));
  assert.match(drug, /<RxnormID>208161<\/RxnormID>\s*<RxnormIDType>SBD<\/RxnormIDType>/);
  assert.match(drug, /<BrandName>Zoloft<\/BrandName>\s*<GenericName>sertraline<\/GenericName>/);
  assert.match(drug, /<Form>Oral Tablet<\/Form>\s*<Strength>50 MG<\/Strength>/);
  assert.doesNotMatch(drug, /<Supply>|<Compound>|<Schedule>/);
  assert.doesNotMatch(body, /<HasScheduledDrug>/);

  await h.cmds.sendMedication({ rcopiaId: '27162725039' }, chartMedicationToRcopia(BASE), 'ssherman');
  const free = h.sent[1].match(/<Drug>[\s\S]*?<\/Drug>/)?.[0] || '';
  assert.doesNotMatch(free, /<RxnormID>|<NDCID>/);
  assert.match(free, /<Supply>n<\/Supply>/);
  assert.match(h.sent[1], /<HasScheduledDrug>n<\/HasScheduledDrug>/);
});

test('send_allergy XML: ingredient CUI under Ingredient; product CUI + NDC list under Drug', async t => {
  const h = loadLive(t);
  const [ing, , product] = allergyPlan([
    { id: 'a1', allergen: 'Penicillin G', reaction: 'Hives', severity: 'Moderate', status: 'Active', allergenType: 'drug', rxnormId: '7980', rxnormTty: 'IN' },
    { id: 'a2', allergen: 'Peanuts', reaction: null, severity: 'Mild', status: 'Active', allergenType: 'food', rxnormId: null },
    { id: 'a3', allergen: 'Zoloft 50 MG Oral Tablet', reaction: null, severity: 'Mild', status: 'Active', allergenType: 'drug', rxnormId: '208161', rxnormTty: 'SBD', ndcCodes: NDCS },
  ]).allergies;
  await h.cmds.sendAllergy({ rcopiaId: '27162725039' }, ing, 'ssherman');
  assert.match(h.sent[0], /<Allergen>\s*<Name>Penicillin G<\/Name>\s*<Ingredient>\s*<RxnormID>7980<\/RxnormID>\s*<\/Ingredient>\s*<\/Allergen>/);
  await h.cmds.sendAllergy({ rcopiaId: '27162725039' }, product, 'ssherman');
  const allergen = h.sent[1].match(/<Allergen>[\s\S]*?<\/Allergen>/)?.[0] || '';
  assert.doesNotMatch(allergen, /<Ingredient>/);
  assert.match(allergen, new RegExp(`<Drug>\\s*<NDCID>${NDCS.slice(0, 10).join(',')}</NDCID>\\s*<RxnormID>208161</RxnormID>\\s*</Drug>`));
});
