import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  classifyChartDocument,
  decideSource,
  isPart2Source,
  isPsychotherapyNoteType,
  part2ConsentCoversTreatment,
} from '../src/lib/ai/chartDigest/classify';
import { chunkSources, renderChunk, sourceAliases, sizeOf } from '../src/lib/ai/chartDigest/chunk';
import { SourceIndex, checkCitation, validateMapReply } from '../src/lib/ai/chartDigest/validate';
import { drugKey, mergeMedicationTrials, mergeSections } from '../src/lib/ai/chartDigest/merge';
import { estimateClient, extrapolate, tokenCost, ASSUMED_CHARS_PER_PAGE } from '../src/lib/ai/chartDigest/cost';
import { decodeOcrJob, encodeOcrJob, extractDocumentText, mergeOcrPages, scannedPageNumbers, type ExtractDeps, type ExtractDoc } from '../src/lib/ai/chartDigest/extract';
import { chartHistoryFacts } from '../src/lib/ai/chartDigest/briefFacts';
import {
  buildChartDigest,
  canGenerateChartDigest,
  canViewChartDigest,
  computeSourceHash,
  digestStaleness,
  generateForViewer,
  selectSources,
  viewChartDigest,
  type DigestAudit,
  type DigestDeps,
  type DocRow,
  type NoteRow,
  type SourceSet,
  type StoredDigest,
} from '../src/lib/ai/chartDigest/service';
import { emptySections, type ChartDigest, type ChartSource, type MedicationTrial } from '../src/lib/ai/chartDigest/types';
import { CHART_DIGEST_SYSTEM_PROMPT } from '../src/lib/ai/chartDigest/prompt';

const ROOT = path.join(__dirname, '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const NOW = new Date('2026-10-25T14:00:00Z');

// ─── Fixtures ────────────────────────────────────────────────────────────────

function doc(id: string, over: Partial<DocRow> = {}): DocRow {
  return {
    id,
    documentType: 'Progress Note',
    fileName: `PN_20240105_Progress Note(${id}).pdf`,
    sourcePath: null,
    extractedFields: [{ label: 'Document date', value: '2024-01-05' }],
    mimeType: 'application/pdf',
    s3RawKey: `${id}.pdf`,
    extractedText: null,
    pageTexts: null,
    pageCount: 2,
    textMethod: null,
    textExtractedAt: null,
    textOcrJobId: null,
    sha256: `sha-${id}`,
    fileSize: 1000,
    filedAt: new Date('2026-10-01T00:00:00Z'),
    createdAt: new Date('2026-10-01T00:00:00Z'),
    ...over,
  };
}

function note(id: string, over: Partial<NoteRow> = {}): NoteRow {
  return {
    id,
    noteType: 'Progress Note',
    body: '<!-- meta -->Client reports sleep improved on sertraline 100 mg. Plan: follow up in two weeks for medication review.',
    dateOfService: new Date('2026-10-20T15:00:00Z'),
    createdAt: new Date('2026-10-20T15:00:00Z'),
    updatedAt: new Date('2026-10-20T16:00:00Z'),
    part2: false,
    ...over,
  };
}

const PAGE1 =
  'Psychiatric history: Client Jordan Rivers was hospitalized at an inpatient psychiatric unit in March 2019 after a suicide attempt by overdose. ' +
  'Prior medication trials include sertraline 50 mg which caused nausea and was stopped after six weeks.';
const PAGE2 = 'Plan: start fluoxetine 20 mg daily. Safety plan reviewed and updated with client today. Follow up in four weeks.';

// ─── 1. Classification ───────────────────────────────────────────────────────

test('classification: clinical types and clinical titles are included; billing / IDs / consents / letters are not', () => {
  assert.equal(classifyChartDocument({ documentType: 'Progress Note' }).include, true);
  assert.equal(classifyChartDocument({ documentType: 'Discharge Summary' }).include, true);
  assert.equal(classifyChartDocument({ documentType: 'Intake Note' }).include, true);
  assert.equal(classifyChartDocument({ documentType: 'Other', fileName: 'Psychiatric Evaluation 2023.pdf' }).include, true);
  assert.equal(classifyChartDocument({ documentType: 'Other', title: 'Treatment Plan' }).include, true);
  for (const t of ['Payment Receipt', 'Patient ID', 'Demographics', 'Insurance Card', 'Consent / ROI', 'Prior Auth Letter']) {
    assert.equal(classifyChartDocument({ documentType: t, fileName: 'Psychiatric evaluation.pdf' }).include, false, t);
  }
  assert.equal(classifyChartDocument({ documentType: 'Other', fileName: 'Letter to employer.pdf' }).include, false);
  assert.equal(classifyChartDocument({ documentType: 'Lab Report', fileName: 'CBC.pdf' }).include, false);
  assert.equal(classifyChartDocument({ documentType: 'Unclassified', fileName: 'scan001.pdf' }).include, false);
});

test('psychotherapy notes are always excluded (imported titles / folders and native note types)', () => {
  const r = classifyChartDocument({ documentType: 'Progress Note', fileName: 'PSY_20240105_Psychotherapy Notes(123).pdf' });
  assert.deepEqual(r, { include: false, reason: 'psychotherapy_note' });
  assert.equal(classifyChartDocument({ documentType: 'Progress Note', folder: 'Process Notes' }).include, false);
  assert.equal(isPsychotherapyNoteType('Psychotherapy Note'), true);
  assert.equal(isPsychotherapyNoteType('Progress Note'), false);
  const { selected, excluded } = selectSources({
    docs: [doc('a', { fileName: 'Psychotherapy_Notes_2024.pdf' }), doc('b')],
    notes: [note('n1', { noteType: 'Psychotherapy Note' }), note('n2')],
    part2Client: false,
    part2ConsentCovers: false,
  });
  assert.deepEqual(selected.map((s) => s.key).sort(), ['doc:b', 'note:n2']);
  assert.equal(excluded.psychotherapy_note, 2);
});

test('the pipeline never reads the psychotherapy note table (source assertion)', () => {
  for (const f of ['store.ts', 'service.ts', 'extract.ts']) {
    assert.doesNotMatch(read(`src/lib/ai/chartDigest/${f}`), /progressNotePsychotherapyNote/);
  }
});

// ─── 2. Part 2 ───────────────────────────────────────────────────────────────

const tpoConsent = { type: 'Part 2 Consent', formKey: 'lib:part2-consent', status: 'SIGNED', formStatus: 'CLIENT_SIGNED', expiresAt: null, revokedAt: null, recipientName: null, formData: { purposeTag: 'tpo' } };

test('Part 2: excluded without a treatment / TPO consent; included and marked with one', () => {
  assert.equal(part2ConsentCoversTreatment([tpoConsent], NOW), true);
  assert.equal(part2ConsentCoversTreatment([{ ...tpoConsent, revokedAt: new Date() }], NOW), false);
  assert.equal(part2ConsentCoversTreatment([{ ...tpoConsent, expiresAt: new Date('2026-01-01') }], NOW), false);
  assert.equal(part2ConsentCoversTreatment([{ ...tpoConsent, formData: { purposeTag: 'research' }, recipientName: 'State registry' }], NOW), false);
  assert.equal(part2ConsentCoversTreatment([{ ...tpoConsent, formKey: 'lib:roi-general' }], NOW), false);

  assert.equal(isPart2Source({ kind: 'note', notePart2: true, part2Client: false }), true);
  assert.equal(isPart2Source({ kind: 'doc', part2Client: false, doc: { documentType: 'Other', fileName: 'SUD Intake Assessment.pdf' } }), true);
  assert.equal(isPart2Source({ kind: 'doc', part2Client: true, doc: { documentType: 'Progress Note' } }), true);
  assert.equal(isPart2Source({ kind: 'doc', part2Client: false, doc: { documentType: 'Progress Note' } }), false);
  assert.deepEqual(decideSource({ part2: true, part2ConsentCovers: false }), { include: false, part2: true, reason: 'part2_no_consent' });

  const base: SourceSet = { docs: [doc('a')], notes: [note('n1', { part2: true }), note('n2')], part2Client: true, part2ConsentCovers: false };
  const without = selectSources(base);
  assert.deepEqual(without.selected.map((s) => s.key), ['note:n2']);
  assert.equal(without.excluded.part2_no_consent, 2);
  const withConsent = selectSources({ ...base, part2ConsentCovers: true });
  assert.equal(withConsent.selected.length, 3);
  assert.equal(withConsent.selected.filter((s) => s.part2).length, 2);
  // Non-protected clients are unaffected
  assert.equal(selectSources({ ...base, notes: [note('n2')], part2Client: false }).selected.every((s) => !s.part2), true);
});

// ─── 3. Chunking ─────────────────────────────────────────────────────────────

const src = (key: string, date: string, pages: string[], over: Partial<ChartSource> = {}): ChartSource => ({ key, kind: 'doc', id: key.slice(4), date, label: 'Progress Note', part2: false, version: 'v1', pages, ...over });

test('chunking: chronological, grouped by month, split by budget, stable keys', () => {
  const a = src('doc:a', '2024-03-02', ['x'.repeat(100)]);
  const b = src('doc:b', '2024-01-05', ['y'.repeat(100), 'z'.repeat(100)]);
  const c = src('doc:c', '2024-01-20', ['w'.repeat(100)]);
  const { chunks } = chunkSources([a, b, c].map(sizeOf), 1000);
  assert.deepEqual(chunks.map((ch) => ch.month), ['2024-01', '2024-03']);
  assert.deepEqual(chunks[0].parts, [{ source: 'doc:b', pages: [1, 2] }, { source: 'doc:c', pages: [1] }]);
  // Budget split inside a month
  const split = chunkSources([b, c].map(sizeOf), 150).chunks;
  assert.equal(split.length, 3);
  // Adding a later source leaves earlier chunk keys unchanged (incremental)
  const d = src('doc:d', '2024-05-01', ['v'.repeat(50)]);
  const again = chunkSources([a, b, c, d].map(sizeOf), 1000).chunks;
  assert.equal(again[0].key, chunks[0].key);
  assert.equal(again[1].key, chunks[1].key);
  assert.equal(again.length, 3);
  // Aliases follow chronology; markers carry alias, date and page
  const aliases = sourceAliases([a, b, c]);
  assert.equal(aliases.get('doc:b'), 'S1');
  const text = renderChunk(chunks[0], new Map([[b.key, b], [c.key, c]]), aliases, (s, n) => s.pages[n - 1]);
  assert.match(text, /<<<SOURCE S1 \| 2024-01-05 \| Progress Note \| page 2>>>/);
});

// ─── 4. Citation validator ───────────────────────────────────────────────────

const VSRC = src('doc:a', '2024-01-05', [PAGE1, PAGE2]);
const index = () => new SourceIndex(new Map([[VSRC.key, { key: VSRC.key, date: VSRC.date, pages: VSRC.pages }]]));
const ALIASES = new Map([['S1', 'doc:a']]);

test('citation validator: verbatim quotes kept (page corrected), unsupported / uncited / long quotes dropped', () => {
  const ok = checkCitation({ src: 's1', page: 1, quote: 'start  FLUOXETINE 20 mg daily' }, ALIASES, index());
  assert.equal(ok.ok, true);
  assert.equal(ok.cite?.page, 2, 'quote is on page 2; page corrected');
  assert.equal(checkCitation({ src: 'S9', page: 1, quote: 'start fluoxetine 20 mg daily' }, ALIASES, index()).reason, 'citeUnknownSource');
  assert.equal(checkCitation({ src: 'S1', page: 1, quote: 'start lithium 300 mg daily' }, ALIASES, index()).reason, 'citeQuoteNotFound');
  assert.equal(checkCitation({ src: 'S1', page: 1, quote: 'inpatient' }, ALIASES, index()).reason, 'citeQuoteLength');
  assert.equal(checkCitation({ src: 'S1', page: 1, quote: PAGE1.split(' ').slice(0, 25).join(' ') }, ALIASES, index()).reason, 'citeQuoteLength');
  assert.equal(checkCitation({ src: 'S1', page: 1, quote: 'hospitalized at an ... unit' }, ALIASES, index()).reason, 'citeQuoteLength');

  const reply = JSON.stringify({
    hospitalizations: [
      { text: 'Inpatient psychiatric admission after an overdose attempt', date: '2019-03', kind: 'inpatient', cites: [{ src: 'S1', page: 1, quote: 'hospitalized at an inpatient psychiatric unit in March 2019' }] },
      { text: 'ER visit in 2021', date: '2021-06-01', kind: 'er', cites: [{ src: 'S1', page: 1, quote: 'seen in the emergency room in June' }] },
      { text: 'Residential stay', kind: 'residential', cites: [] },
    ],
    riskHistory: [{ text: 'Suicide attempt by overdose', date: '2019-03-15', kind: 'suicide_attempt', cites: [{ src: 'S1', page: 1, quote: 'after a suicide attempt by overdose' }] }],
    medicationTrials: [
      { drug: 'Sertraline', doses: ['50mg', '200 mg'], start: null, end: null, response: null, reasonStopped: 'nausea', sideEffects: ['nausea'], cites: [{ src: 'S1', page: 1, quote: 'sertraline 50 mg which caused nausea' }] },
      { drug: 'Lithium', doses: ['300 mg'], cites: [{ src: 'S1', page: 1, quote: 'Prior medication trials include sertraline' }] },
    ],
  });
  const v = validateMapReply(reply, ALIASES, index(), new Set());
  assert.equal(v.sections.hospitalizations.length, 1);
  assert.equal(v.sections.hospitalizations[0].date, '2024-01-05', '"March 2019" is not an ISO / numeric form of 2019-03 → cited source date');
  assert.equal(v.drops.uncited, 2, 'ER (quote not found → no cites) and residential (no cites)');
  // Date 2019-03-15 not in the text → falls back to the cited source date
  assert.equal(v.sections.riskHistory[0].date, '2024-01-05');
  assert.equal(v.sections.medicationTrials.length, 1, 'lithium is not in the cited text');
  assert.deepEqual(v.sections.medicationTrials[0].doses, ['50mg'], '200 mg is not in the source');
  assert.equal(v.drops.drugNotInSource, 1);
  assert.equal(v.drops.doseNotInSource, 1);
  assert.equal(validateMapReply('not json', ALIASES, index(), new Set()).kept, 0);
});

test('Part 2 facts are marked from their cited sources', () => {
  const reply = JSON.stringify({ substanceUse: [{ text: 'Overdose history', kind: null, cites: [{ src: 'S1', page: 1, quote: 'after a suicide attempt by overdose' }] }] });
  const v = validateMapReply(reply, ALIASES, index(), new Set(['doc:a']));
  assert.equal(v.sections.substanceUse[0].part2, true);
});

// ─── 5. Merge / dedupe ───────────────────────────────────────────────────────

const cite = (source: string, date: string, quote = 'sertraline 50 mg which caused nausea') => ({ source, page: 1, date, quote });

test('merge: medication trials deduped by drug, doses / dates / side effects unioned, newest response wins', () => {
  const t1: MedicationTrial = { drug: 'Sertraline', doses: ['50 mg'], start: '2019-01-01', end: '2019-03-01', response: 'partial', reasonStopped: null, sideEffects: ['nausea'], cites: [cite('doc:a', '2019-03-01')] };
  const t2: MedicationTrial = { drug: 'sertraline HCl', doses: ['100 mg', '50mg'], start: '2018-11-01', end: '2020-02-01', response: 'no response', reasonStopped: 'ineffective', sideEffects: ['Nausea', 'insomnia'], cites: [cite('doc:b', '2020-02-01', 'sertraline increased to 100 mg')] };
  const t3: MedicationTrial = { drug: 'Fluoxetine', doses: ['20 mg'], start: '2024-01-05', end: null, response: null, reasonStopped: null, sideEffects: [], cites: [cite('doc:c', '2024-01-05', 'start fluoxetine 20 mg daily')] };
  assert.equal(drugKey('Sertraline HCl 50 mg'), 'sertraline');
  const merged = mergeMedicationTrials([[t1], [t2, t3]]);
  assert.equal(merged.length, 2);
  const s = merged.find((m) => drugKey(m.drug) === 'sertraline')!;
  assert.deepEqual(s.doses, ['50 mg', '100 mg']);
  assert.equal(s.start, '2018-11-01');
  assert.equal(s.end, '2020-02-01');
  assert.equal(s.response, 'no response');
  assert.equal(s.reasonStopped, 'ineffective');
  assert.deepEqual(s.sideEffects, ['nausea', 'insomnia']);
  assert.equal(s.cites.length, 2);
});

test('merge: items deduped, open items only from the newest source, last risk assessment / safety plan picked', () => {
  const a = emptySections();
  const b = emptySections();
  a.riskHistory.push({ text: 'Suicide attempt by overdose', date: '2019-03-01', kind: 'suicide_attempt', cites: [cite('doc:a', '2019-03-01', 'q one two')] });
  b.riskHistory.push({ text: 'Suicide attempt by overdose.', date: '2019-03-01', kind: 'suicide_attempt', cites: [cite('doc:b', '2024-01-05', 'q three four')] });
  a.riskHistory.push({ text: 'C-SSRS screen negative', date: '2023-05-01', kind: 'risk_assessment', cites: [cite('doc:a', '2023-05-01', 'q')] });
  b.riskHistory.push({ text: 'Risk assessment: low acute risk', date: '2024-01-05', kind: 'risk_assessment', cites: [cite('doc:b', '2024-01-05', 'q2')] });
  b.riskHistory.push({ text: 'Safety plan updated', date: '2024-01-05', kind: 'safety_plan', cites: [cite('doc:b', '2024-01-05', 'q3')] });
  a.openItems.push({ text: 'Old homework', date: null, kind: null, cites: [cite('doc:a', '2023-05-01', 'q4')] });
  b.openItems.push({ text: 'Follow up in four weeks', date: null, kind: null, cites: [cite('doc:b', '2024-01-05', 'q5')] });
  const d = mergeSections([a, b], {});
  assert.equal(d.riskHistory.filter((r) => r.kind === 'suicide_attempt').length, 1);
  assert.equal(d.riskHistory.find((r) => r.kind === 'suicide_attempt')!.cites.length, 2);
  assert.equal(d.lastRiskAssessment?.text, 'Risk assessment: low acute risk');
  assert.equal(d.safetyPlan?.text, 'Safety plan updated');
  assert.deepEqual(d.openItems.map((i) => i.text), ['Follow up in four weeks']);
});

// ─── 6. Extraction ───────────────────────────────────────────────────────────

function extractFakes(over: Partial<ExtractDeps> = {}) {
  const saved: Array<{ id: string; method: string; ocrJobId: string | null; pages: string[] }> = [];
  const calls = { textract: 0, read: 0 };
  const deps: ExtractDeps = {
    async readFile() {
      calls.read++;
      return new Uint8Array([1]);
    },
    async pdfPageTexts() {
      return [PAGE1, '   ', PAGE2];
    },
    async pdfSubset() {
      return new Uint8Array([2]);
    },
    textractConfigured: () => true,
    async startPdfOcr() {
      calls.textract++;
      return 'job-1';
    },
    async pollPdfOcr() {
      return { state: 'done', pages: ['OCR page text for the scanned page of this document.'] };
    },
    async ocrImage() {
      return ['image text'];
    },
    async save(id, data) {
      saved.push({ id, method: data.method, ocrJobId: data.ocrJobId, pages: data.pages });
    },
    now: () => NOW,
    ...over,
  };
  return { deps, saved, calls };
}

const xdoc = (over: Partial<ExtractDoc> = {}): ExtractDoc => ({ id: 'd1', mimeType: 'application/pdf', fileName: 'x.pdf', s3RawKey: 'd1.pdf', extractedText: null, pageTexts: null, pageCount: null, textMethod: null, textExtractedAt: null, textOcrJobId: null, ...over });

test('extraction: cached text first, PDF text layer next, Textract only for scanned pages, then polled', async () => {
  const f1 = extractFakes();
  const cached = await extractDocumentText(f1.deps, xdoc({ pageTexts: ['a', 'b'], textExtractedAt: NOW, textMethod: 'pdf_text' }), { allowOcr: true });
  assert.equal(cached.state, 'ready');
  assert.equal(f1.calls.read, 0);

  const f2 = extractFakes({ async pdfPageTexts() { return [PAGE1, PAGE2]; } });
  const text = await extractDocumentText(f2.deps, xdoc(), { allowOcr: true });
  assert.equal(text.method, 'pdf_text');
  assert.equal(f2.calls.textract, 0, 'text-layer PDF never goes to Textract');

  const f3 = extractFakes();
  const pending = await extractDocumentText(f3.deps, xdoc(), { allowOcr: true });
  assert.equal(pending.state, 'pending');
  assert.equal(pending.scannedPages, 1);
  assert.equal(f3.saved[0].ocrJobId, encodeOcrJob('job-1', [2]));
  assert.deepEqual(decodeOcrJob('job-1|2,5'), { jobId: 'job-1', pages: [2, 5] });
  const done = await extractDocumentText(f3.deps, xdoc({ pageTexts: f3.saved[0].pages, textExtractedAt: NOW, textOcrJobId: f3.saved[0].ocrJobId, pageCount: 3 }), { allowOcr: true });
  assert.equal(done.state, 'ready');
  assert.equal(done.method, 'pdf_text+textract');
  assert.match(done.pages![1], /OCR page text/);
  assert.equal(done.pages![0], PAGE1);

  // OCR not allowed: text-layer pages only, nothing started
  const f4 = extractFakes();
  const noOcr = await extractDocumentText(f4.deps, xdoc(), { allowOcr: false });
  assert.equal(noOcr.state, 'ready');
  assert.equal(f4.calls.textract, 0);
  assert.deepEqual(scannedPageNumbers(['', 'x'.repeat(50)]), [1]);
  assert.deepEqual(mergeOcrPages(['a', '', 'c'], ['B'], [2], 3), ['a', 'B', 'c']);
});

// ─── 7. Generation, incremental staleness, audit ─────────────────────────────

function fakeDeps(over: Partial<DigestDeps> & { set?: SourceSet } = {}) {
  const audits: DigestAudit[] = [];
  const store: StoredDigest[] = [];
  const prompts: string[] = [];
  let set: SourceSet = over.set ?? { docs: [doc('a', { pageTexts: [PAGE1, PAGE2], textExtractedAt: NOW })], notes: [note('n1')], part2Client: false, part2ConsentCovers: false };
  const deps: DigestDeps = {
    async resolveAccess(viewer) {
      return viewer.userId === 'outsider' ? { ok: false, status: 403, reason: 'not_on_caseload' } : { ok: true, names: ['Jordan Rivers'] };
    },
    async onCareTeam(viewer) {
      return viewer.userId !== 'not-team';
    },
    async aiConsent() {
      return 'signed';
    },
    async loadSources() {
      return set;
    },
    async clientNames() {
      return ['Jordan Rivers'];
    },
    async extract(d) {
      const pages = Array.isArray(d.pageTexts) ? (d.pageTexts as string[]) : [];
      return { state: 'ready', pages, method: 'pdf_text', pageCount: pages.length, scannedPages: 0 };
    },
    async latestDigest() {
      return store[store.length - 1] ?? null;
    },
    async saveDigest(row) {
      const s: StoredDigest = { ...row, id: `dg${store.length + 1}` };
      store.push(s);
      return s;
    },
    bedrockConfigured: () => true,
    async invokeModel({ userPrompt }) {
      prompts.push(userPrompt);
      const alias = /SOURCE (S\d+) \| 2024-01-05/.exec(userPrompt)?.[1];
      if (alias) {
        return {
          text: JSON.stringify({
            hospitalizations: [{ text: 'Inpatient psychiatric admission after overdose', date: null, kind: 'inpatient', cites: [{ src: alias, page: 1, quote: 'hospitalized at an inpatient psychiatric unit' }] }],
            medicationTrials: [{ drug: 'sertraline', doses: ['50 mg'], reasonStopped: 'nausea', cites: [{ src: alias, page: 1, quote: 'sertraline 50 mg which caused nausea' }] }],
            therapy: [{ text: 'Invented CBT course', kind: 'modality', cites: [{ src: alias, page: 1, quote: 'completed twelve sessions of CBT' }] }],
          }),
          tokensIn: 1000,
          tokensOut: 200,
        };
      }
      const a2 = /SOURCE (S\d+)/.exec(userPrompt)![1];
      return { text: JSON.stringify({ openItems: [{ text: 'Medication review follow-up', kind: null, cites: [{ src: a2, page: null, quote: 'follow up in two weeks for medication review' }] }] }), tokensIn: 500, tokensOut: 100 };
    },
    modelId: 'haiku-test',
    async audit(e) {
      audits.push(e);
    },
    now: () => NOW,
    ...over,
  };
  return { deps, audits, store, prompts, setSources: (s: SourceSet) => (set = s) };
}

const CLINICIAN = { organizationId: 'org1', userId: 'u1', role: 'THERAPIST' };

test('generation: cited facts only, names redacted before the model, audit with counts only', async () => {
  const f = fakeDeps();
  const r = await generateForViewer(f.deps, CLINICIAN, 'c1');
  assert.equal(r.ok, true);
  const json = r.digest!.digestJson as { digest: ChartDigest };
  assert.equal(json.digest.hospitalizations.length, 1);
  assert.equal(json.digest.therapy.length, 0, 'uncited CBT dropped');
  assert.equal(json.digest.medicationTrials[0].drug, 'sertraline');
  assert.equal(json.digest.openItems.length, 1);
  assert.equal(r.summary!.drops.citeQuoteNotFound, 1);
  assert.ok(f.prompts.every((p) => !/Jordan|Rivers/.test(p)), 'client names are redacted before Bedrock');
  const ai = f.audits.find((a) => a.action === 'AI_ACCESS')!;
  assert.equal(ai.outcome, 'SUCCESS');
  const meta = JSON.stringify(ai.metadata);
  assert.doesNotMatch(meta, /sertraline|inpatient|overdose|Jordan/i, 'audit carries counts, not chart text');
  assert.equal(r.digest!.tokensIn, 1500);
  assert.equal(r.digest!.costEstimateUsd, Math.round(tokenCost(1500, 300, { inPerM: 1, outPerM: 5, textractPerPage: 0 }) * 10000) / 10000);
});

test('incremental: unchanged sources skip; a new note marks stale and only its chunk is re-mapped', async () => {
  const f = fakeDeps();
  await buildChartDigest(f.deps, { organizationId: 'org1', clientId: 'c1', actorId: 'u1', allowOcr: true });
  const calls1 = f.prompts.length;
  assert.equal(calls1, 2);
  const again = await buildChartDigest(f.deps, { organizationId: 'org1', clientId: 'c1', actorId: 'u1', allowOcr: true });
  assert.equal(again.skipped, true);
  assert.equal(f.prompts.length, calls1);

  const before = computeSourceHash(selectSources(await f.deps.loadSources('org1', 'c1')).selected);
  f.setSources({ docs: [doc('a', { pageTexts: [PAGE1, PAGE2], textExtractedAt: NOW })], notes: [note('n1'), note('n2', { dateOfService: new Date('2026-11-02T15:00:00Z'), createdAt: new Date('2026-11-02T15:00:00Z') })], part2Client: false, part2ConsentCovers: false });
  const after = computeSourceHash(selectSources(await f.deps.loadSources('org1', 'c1')).selected);
  assert.notEqual(before, after);
  assert.equal(digestStaleness(f.store[0], after).reason, 'sources_changed');
  const view = await viewChartDigest(f.deps, CLINICIAN, 'c1');
  assert.equal(view.view!.stale, true);

  const r = await buildChartDigest(f.deps, { organizationId: 'org1', clientId: 'c1', actorId: 'u1', allowOcr: true });
  assert.equal(r.summary!.chunksReused, 2, 'the 2024-01 and 2026-10 chunks are reused');
  assert.equal(r.summary!.modelCalls, 1, 'only the new month is mapped');
  assert.equal(r.digest!.version, 2);
  assert.equal(digestStaleness(r.digest!, after).stale, false);
});

test('access: role and care-team gates, consent and configuration refusals, denials audited', async () => {
  assert.equal(canViewChartDigest('THERAPIST'), true);
  assert.equal(canViewChartDigest('PSYCHIATRIST'), true);
  assert.equal(canViewChartDigest('PRACTICE_DIRECTOR'), true);
  for (const r of ['HR', 'BILLING', 'FRONT_DESK', 'OFFICE_MANAGER', 'PEER_SUPPORT', 'PHYSICIAN', 'MEDICAL_ASSISTANT']) assert.equal(canViewChartDigest(r), false, r);
  assert.equal(canGenerateChartDigest('PRACTICE_DIRECTOR'), false);
  assert.equal(canGenerateChartDigest('NP'), true);

  const f = fakeDeps();
  assert.equal((await viewChartDigest(f.deps, { ...CLINICIAN, role: 'BILLING' }, 'c1')).status, 403);
  assert.equal((await viewChartDigest(f.deps, { ...CLINICIAN, userId: 'outsider' }, 'c1')).reason, 'not_on_caseload');
  assert.equal((await generateForViewer(f.deps, { ...CLINICIAN, userId: 'not-team' }, 'c1')).reason, 'not_on_care_team');
  assert.ok(f.audits.filter((a) => a.outcome === 'DENIED').length >= 3);
  assert.equal(f.prompts.length, 0);

  const declined = fakeDeps({ aiConsent: async () => 'declined' });
  assert.equal((await generateForViewer(declined.deps, CLINICIAN, 'c1')).reason, 'ai_consent_declined');
  const off = fakeDeps({ bedrockConfigured: () => false });
  assert.equal((await generateForViewer(off.deps, CLINICIAN, 'c1')).status, 503);
});

test('Part 2 consent revoked after generation: the view withholds Part 2 facts', async () => {
  const set: SourceSet = { docs: [doc('a', { pageTexts: [PAGE1, PAGE2], textExtractedAt: NOW })], notes: [], part2Client: true, part2ConsentCovers: true };
  const f = fakeDeps({ set });
  const r = await buildChartDigest(f.deps, { organizationId: 'org1', clientId: 'c1', actorId: 'u1', allowOcr: true });
  assert.equal((r.digest!.digestJson as { digest: ChartDigest }).digest.hasPart2, true);
  f.setSources({ ...set, part2ConsentCovers: false });
  const v = await viewChartDigest(f.deps, CLINICIAN, 'c1');
  assert.equal(v.view!.part2Withheld, true);
  assert.equal(v.view!.digest!.hospitalizations.length, 0);
  assert.equal(v.view!.stale, true, 'source set changed (Part 2 sources now excluded)');
});

test('route and store wiring: chart gate, care team, audit, BAA-only services (source assertions)', () => {
  const route = read('src/app/api/clients/[id]/chart-digest/route.ts');
  assert.match(route, /requireOrgContext/);
  assert.match(route, /canViewChartDigest/);
  assert.match(route, /generateForViewer/);
  assert.match(route, /chartDigestCitationLinks/);
  assert.match(read('src/lib/ai/chartDigest/citationLinks.ts'), /chartDocumentFilter/);
  const store = read('src/lib/ai/chartDigest/store.ts');
  assert.match(store, /resolveChartAccess/);
  assert.match(store, /hasCareTeamLink/);
  assert.match(store, /auditPhiAccess/);
  assert.match(store, /guard: 'clinical'/);
  assert.match(store, /temperature: 0/);
  assert.match(store, /model: 'HAIKU'/);
  assert.doesNotMatch(store + read('src/lib/ai/chartDigest/service.ts'), /fetch\(|openai|https?:\/\//i);
  assert.match(read('src/components/ai/ChartHistoryCard.tsx'), /#page=\$\{c\.page\}/);
  assert.match(CHART_DIGEST_SYSTEM_PROMPT, /3 to 20 words/);
});

// ─── 8. Brief facts (audience slicing) ───────────────────────────────────────

test('brief facts: audience slicing, names redacted, no Part 2, no quotes or ids', () => {
  const s = emptySections();
  const c = [cite('doc:a', '2024-01-05', 'quote words here')];
  s.medicationTrials.push({ drug: 'sertraline', doses: ['50 mg'], start: null, end: '2019-03-01', response: null, reasonStopped: 'nausea', sideEffects: [], cites: c });
  s.medicationTrials.push({ drug: 'naltrexone', doses: [], start: null, end: null, response: null, reasonStopped: null, sideEffects: [], cites: c, part2: true });
  s.therapy.push({ text: 'Jordan practiced CBT thought records', date: null, kind: 'modality', cites: c });
  s.trauma.push({ text: 'Childhood trauma (summary)', date: null, kind: null, cites: c });
  s.medical.push({ text: 'Penicillin allergy', date: null, kind: 'allergy', cites: c });
  const digest: ChartDigest = { ...s, lastRiskAssessment: null, safetyPlan: null, sources: {}, hasPart2: true };
  const redact = (t: string) => t.replace(/Jordan/g, 'the client');
  const p = chartHistoryFacts({ digest, generatedAt: NOW, stale: false }, 'prescriber', redact);
  const t = chartHistoryFacts({ digest, generatedAt: NOW, stale: false }, 'therapist', redact);
  const sections = (f: typeof p) => new Set(f.items.map((i) => i.section));
  assert.ok(sections(p).has('Medication trial') && sections(p).has('Medical / allergy'));
  assert.ok(!sections(p).has('Therapy') && !sections(p).has('Trauma (summary)'));
  assert.ok(sections(t).has('Therapy') && sections(t).has('Trauma (summary)'));
  assert.ok(!sections(t).has('Medication trial'));
  const all = JSON.stringify([p, t]);
  assert.doesNotMatch(all, /naltrexone/);
  assert.doesNotMatch(all, /Jordan|quote words|doc:a/);
});

test('previsit wiring: digest loaded for chart-note readers only, Part 2 removed', () => {
  const ps = read('src/lib/ai/previsit/prismaSource.ts');
  assert.match(ps, /bhChartNotes \? await digestForBrief/);
  assert.match(read('src/lib/ai/chartDigest/store.ts'), /withoutPart2\(json\.digest\)/);
  assert.match(read('src/lib/ai/previsit/facts.ts'), /bhChartNotes && inputs\.chartDigest/);
});

// ─── 9. Cost estimator ───────────────────────────────────────────────────────

test('cost estimator: tokens from chunk sizes, Textract per scanned page, extrapolation', () => {
  const prices = { inPerM: 1, outPerM: 5, textractPerPage: 0.0015 };
  const e = estimateClient(
    [
      { key: 'doc:a', date: '2024-01-05', version: 'v', pageCount: 4, pageChars: [4000, 4000, 4000, 4000], scannedPages: 2 },
      { key: 'doc:b', date: '2024-02-01', version: 'v', pageCount: 2, pageChars: null, scannedPages: 0 },
    ],
    prices,
    10_000
  );
  // a: 16000 chars → 2 chunks (8000 + 8000) in 2024-01; b: 2 × 2500 in 2024-02 → 1 chunk
  assert.equal(e.chunks, 3);
  assert.equal(e.pages, 6);
  assert.equal(e.scannedPages, 2);
  assert.equal(e.textractUsd, 0.003);
  const charsIn = 16_000 + 2 * ASSUMED_CHARS_PER_PAGE;
  assert.ok(e.tokensIn >= charsIn / 4);
  assert.equal(e.tokensOut, 3 * 900);
  assert.equal(e.totalUsd, Math.round((e.bedrockUsd + e.textractUsd) * 10000) / 10000);
  const x = extrapolate([e, e], 10);
  assert.equal(x.documents, 20);
  assert.ok(Math.abs(x.totalUsd - e.totalUsd * 10) < 1e-3);
});

// ─── 10. Script ──────────────────────────────────────────────────────────────

test('script: never prints names or chart text; dry run makes no AI calls; apply is capped', () => {
  const s = read('scripts/chart-digest.ts');
  assert.doesNotMatch(s, /\bname: true\b|legalFirstName|legalLastName|dateOfBirth/);
  assert.doesNotMatch(s, /console\.log\([^)]*(\.text\b(?!ract)|\.quote|\.body|fileName|sourcePath|title)/);
  assert.match(s, /--estimate-all/);
  assert.match(s, /APPLY_MAX = 25/);
  assert.match(s, /No AI calls were made and nothing was written/);
  // buildChartDigest (the only AI path) is reached only in --apply mode
  const dryIdx = s.indexOf('if (!apply) {');
  const buildIdx = s.indexOf('await buildChartDigest(');
  assert.ok(dryIdx > 0 && buildIdx > dryIdx && s.slice(dryIdx, buildIdx).includes('return;'));
});
