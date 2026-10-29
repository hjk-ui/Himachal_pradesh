import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { SCRIBE_FORMATS, SCRIBE_FORMAT_LABELS, scribeSettingsPatchSchema, type ScribeFormat } from '../src/lib/scribe/settings';
import {
  FORMAT_GROUP,
  FORMAT_NOTE_TYPE,
  defaultScribeFormat,
  formatForNoteType,
  formatsForRole,
  roleFormatGroup,
} from '../src/lib/scribe/formatCatalog';
import { applyDraft, composeBody, formatSpec, NEVER_AI_HEADINGS, NOT_ASSESSED } from '../src/lib/scribe/templateFields';
import { buildDraftSystemPrompt, groundDraft, type RawDraft } from '../src/lib/scribe/draft';
import { suggestCptForSession } from '../src/lib/scribe/coding';
import { canDismiss, dismissBlocker, DISMISS_CONFIRM, DISMISS_LABEL, DISMISSED_CAPTURE_DATA } from '../src/lib/scribe/dismiss';
import { guideCues, templateCues, withGuideNoteSteps } from '../src/lib/scribe/templateCues';
import { DEFAULT_PREFERENCES } from '../src/lib/scribe/settings';
import { NOTE_SECTIONS, NOTE_TYPES, structuredNoteSections } from '../src/lib/ehr/noteTemplates';
import { PROTOCOLS } from '../src/lib/visits/protocols';
import { AI_DRAFT_MARKER } from '../src/lib/ai/noteDraftFormats';
import type { GuideStep } from '../src/lib/visits/types';
import type { Source } from '../src/lib/scribe/grounding';

const SRC = path.join(__dirname, '..', 'src');
const read = (p: string) => fs.readFileSync(path.join(SRC, p), 'utf8');

// ─── 4. Templates ────────────────────────────────────────────────────────────

test('every EHR note template except Group and No-Show is a scribe format, mapped to its NOTE_TYPES key', () => {
  const mapped = new Set(Object.values(FORMAT_NOTE_TYPE));
  for (const t of NOTE_TYPES) {
    if (t === 'Group' || t === 'No-Show') continue;
    assert.ok(mapped.has(t), `note type ${t} has a scribe format`);
  }
  for (const f of SCRIBE_FORMATS) {
    assert.ok(SCRIBE_FORMAT_LABELS[f], `${f} label`);
    assert.ok(f.length <= 40, `${f} fits VARCHAR(40)`);
  }
  // Settings accept the new formats as the practice / clinician default
  assert.equal(scribeSettingsPatchSchema.safeParse({ defaultFormat: 'PSYCH_MED_MGMT' }).success, true);
});

test('prescriber templates map to the note editor section keys (headings) exactly', () => {
  const cases: [ScribeFormat, string][] = [
    ['PSYCH_MED_MGMT', 'Psych Med Mgmt'],
    ['MED_MGMT', 'Med Mgmt'],
    ['PSYCH_EVAL', 'Psych Eval'],
    ['ADULT_PSYCH_INTAKE', 'Adult Psych Intake'],
    ['ADULT_PSYCH_REEVAL', 'Adult Psych Re-Eval'],
    ['CHILD_PSYCH_INTAKE', 'Child Psych Initial Intake'],
    ['CHILD_PSYCH_REEVAL', 'Child Psych Intake'],
    ['PRIMARY_CARE_SOAP', 'SOAP'],
  ];
  for (const [f, nt] of cases) {
    const spec = formatSpec(f);
    assert.equal(spec.kind, 'sections');
    assert.equal(spec.noteType, nt);
    assert.deepEqual(spec.headings, [...NOTE_SECTIONS[nt as keyof typeof NOTE_SECTIONS]]);
    assert.equal(FORMAT_GROUP[f], f === 'PRIMARY_CARE_SOAP' ? 'medical' : 'prescriber');
  }
  const pmm = formatSpec('PSYCH_MED_MGMT');
  assert.ok(pmm.kind === 'sections');
  if (pmm.kind !== 'sections') return;
  assert.equal(pmm.mseHeading, 'Exam');
  for (const h of ['Header', 'Suicidal Ideation', 'Suicide Prevention Plan', 'Assessment - Diagnoses', 'Lab Results', 'Plan - Labs Ordered', 'Review']) {
    assert.ok(!pmm.aiHeadings.includes(h), `${h} is never AI`);
  }
  // Medication changes are the prescriber's (CLINICIAN_ONLY_MED_HEADINGS): offered as a suggestion, never drafted
  assert.ok(!pmm.aiHeadings.includes('Plan - Med Changes'), 'Plan - Med Changes is clinician-only');
  for (const h of ['History of Present Illness/Interval History', 'Side Effects', 'Meds & Allergies', 'Plan - Next Appointment', 'Plan']) {
    assert.ok(pmm.aiHeadings.includes(h), `${h} is drafted`);
  }
  // Existing formats keep their behavior
  const soap = formatSpec('SOAP');
  assert.ok(soap.kind === 'sections' && soap.aiHeadings.length === 4 && soap.mseHeading === null);
  assert.equal(formatSpec('SUD_NOTE').part2, true);
  assert.equal(formatSpec('PSYCH_MED_MGMT').part2, false);
});

const s = (text: string, cites = ['t1']) => ({ text, cites });
const sources: Source[] = [
  { id: 't1', kind: 'transcript', text: 'Sleep is better on sertraline 100 mg, no nausea now.' },
  { id: 't2', kind: 'transcript', text: 'Mood has been okay, maybe a six out of ten.' },
  { id: 't3', kind: 'transcript', text: 'We will keep sertraline at 100 mg and see you in four weeks.' },
];

test('prescriber draft fills the right note sections; clinician-only sections stay blank; MSE domain by domain', () => {
  const raw: RawDraft = {
    narrative: {
      'History of Present Illness/Interval History': [s('Client reported sleep is better on sertraline 100 mg.', ['t1'])],
      'Plan - Med Changes': [s('Continue sertraline 100 mg.', ['t3'])],
      'Assessment - Diagnoses': [s('Major depressive disorder.', ['t2'])],
      'Suicidal Ideation': [s('Denies SI.', ['t2'])],
    },
    options: {},
    mse: { Mood: { text: 'Mood okay, six out of ten.', cites: ['t2'], basis: 'stated' } },
    interventions: [],
    planLinks: [],
    homework: [],
    nextAppointment: s('Return in four weeks.', ['t3']),
    followUps: [],
    conditions: [],
    summary: [],
  };
  const g = groundDraft(raw, { format: 'PSYCH_MED_MGMT', sources, chart: { goals: [], diagnoses: [], lastPlan: null, scores: [] } });
  assert.ok(g.texts['History of Present Illness/Interval History'].startsWith(AI_DRAFT_MARKER));
  // Medication changes: never inserted; offered in review as a suggestion (flagged: no medication list here)
  assert.equal(g.texts['Plan - Med Changes'], '');
  assert.ok(g.medSuggestions.some((m) => /sertraline 100 mg/.test(m.text) && m.flags?.some((f) => /not on medication list/.test(f))));
  assert.match(g.texts['Plan - Next Appointment'], /four weeks/);
  assert.equal(g.texts['Assessment - Diagnoses'], '');
  assert.equal(g.texts['Suicidal Ideation'], '');
  assert.equal(g.texts.Header, '');
  assert.match(g.texts.Exam, /Mood: Mood okay/);
  assert.match(g.texts.Exam, new RegExp(`Appearance: ${NOT_ASSESSED}`));
  // The body splits back into the same headings the note editor uses
  const back = structuredNoteSections('Psych Med Mgmt', g.body);
  assert.ok(back.some((x) => x.title === 'History of Present Illness/Interval History' && /sertraline/.test(x.text)));
  assert.ok(back.every((x) => x.title !== 'Clinical Documentation'));
});

test('applyDraft never writes NEVER_AI headings even if the model returns them', () => {
  const spec = formatSpec('ADULT_PSYCH_INTAKE');
  const narrative: Record<string, { text: string; cites: string[]; status: 'supported'; support: number }[]> = {};
  for (const h of spec.headings) narrative[h] = [{ text: 'x said.', cites: ['t1'], status: 'supported', support: 1 }];
  const out = applyDraft(spec, { narrative, options: {}, mse: {} });
  for (const h of spec.headings) {
    if (NEVER_AI_HEADINGS.has(h) || h === 'Exam') assert.equal(out[h], '', h);
    else assert.ok(out[h].startsWith(AI_DRAFT_MARKER), h);
  }
  assert.equal(composeBody(spec, out).split('\n\n').length, spec.headings.length);
});

test('draft prompt for a prescriber template lists only the drafted sections and the MSE rule', () => {
  const p = buildDraftSystemPrompt(formatSpec('PSYCH_MED_MGMT'), DEFAULT_PREFERENCES);
  assert.match(p, /Plan - Med Changes/);
  assert.match(p, /Do not write the other sections of this note \(Header,/);
  assert.match(p, /Mental status \("Exam"\)/);
  const soap = buildDraftSystemPrompt(formatSpec('SOAP'), DEFAULT_PREFERENCES);
  assert.doesNotMatch(soap, /Do not write the other sections/);
});

test('coding: E/M templates never guess a level; program / contact notes suggest no code', () => {
  assert.equal(suggestCptForSession({ format: 'PSYCH_MED_MGMT', minutes: 30 }).code, null);
  assert.equal(suggestCptForSession({ format: 'PRIMARY_CARE_SOAP', minutes: 30 }).code, null);
  assert.equal(suggestCptForSession({ format: 'PRP', minutes: 60 }).code, null);
  assert.equal(suggestCptForSession({ format: 'CLINICAL_INTAKE', minutes: 60 }).code, '90791');
  assert.equal(suggestCptForSession({ format: 'THERAPY_PROGRESS', minutes: 55 }).code, '90837');
});

test('role picker: prescriber templates first for PSYCHIATRIST / NP, SOAP for PHYSICIAN / MEDICAL_NP, therapy otherwise', () => {
  assert.equal(roleFormatGroup('PSYCHIATRIST'), 'prescriber');
  assert.equal(roleFormatGroup('NP'), 'prescriber');
  assert.equal(roleFormatGroup('PHYSICIAN'), 'medical');
  assert.equal(roleFormatGroup('MEDICAL_NP'), 'medical');
  assert.equal(roleFormatGroup('THERAPIST'), 'therapy');
  const np = formatsForRole('NP');
  assert.equal(np.primary[0], 'PSYCH_MED_MGMT');
  assert.ok(np.primary.includes('CHILD_PSYCH_INTAKE') && !np.primary.includes('THERAPY_PROGRESS'));
  assert.ok(np.more.includes('THERAPY_PROGRESS'));
  assert.deepEqual(formatsForRole('PHYSICIAN').primary, ['PRIMARY_CARE_SOAP']);
  assert.equal(formatsForRole('THERAPIST').primary[0], 'THERAPY_PROGRESS');
  for (const r of ['NP', 'PHYSICIAN', 'THERAPIST', 'PRP_SPECIALIST']) {
    const { primary, more } = formatsForRole(r);
    assert.equal(primary.length + more.length, SCRIBE_FORMATS.length);
  }
});

test('default format follows the visit, then the open note, then preferences, then the role', () => {
  // Every Visit Guide kind with a drafted note type resolves to a format of that note type
  for (const p of Object.values(PROTOCOLS)) {
    const f = formatForNoteType(p.noteType, { medical: p.audience === 'medical' });
    if (p.noteType === 'Group' || p.noteType === 'No-Show') assert.equal(f, null, p.kind);
    else assert.ok(f && FORMAT_NOTE_TYPE[f as Exclude<ScribeFormat, 'TREATMENT_PLAN_REVIEW'>] === p.noteType, p.kind);
  }
  assert.equal(formatForNoteType(PROTOCOLS.med_management.noteType), 'PSYCH_MED_MGMT');
  assert.equal(formatForNoteType(PROTOCOLS.psych_eval_child.noteType), 'CHILD_PSYCH_INTAKE');
  assert.equal(formatForNoteType('SOAP', { medical: true }), 'PRIMARY_CARE_SOAP');
  assert.equal(formatForNoteType('Medication Management'), 'MED_MGMT');

  const visit = { noteType: 'Psych Med Mgmt', audience: 'prescriber' };
  assert.deepEqual(defaultScribeFormat({ role: 'NP', visit, preferred: 'SOAP' }), { format: 'PSYCH_MED_MGMT', source: 'visit' });
  assert.equal(defaultScribeFormat({ role: 'PHYSICIAN', visit: { noteType: 'SOAP', audience: 'medical' } }).format, 'PRIMARY_CARE_SOAP');
  assert.equal(defaultScribeFormat({ role: 'NP', noteType: 'Adult Psych Re-Eval' }).format, 'ADULT_PSYCH_REEVAL');
  assert.equal(defaultScribeFormat({ role: 'NP', preferred: 'MED_MGMT', practiceDefault: 'THERAPY_PROGRESS' }).format, 'MED_MGMT');
  // A therapy practice default does not override a prescriber's role default
  assert.equal(defaultScribeFormat({ role: 'PSYCHIATRIST', practiceDefault: 'THERAPY_PROGRESS' }).format, 'PSYCH_MED_MGMT');
  assert.equal(defaultScribeFormat({ role: 'THERAPIST', practiceDefault: 'DAP' }).format, 'DAP');
  assert.equal(defaultScribeFormat({ role: 'MEDICAL_NP' }).format, 'PRIMARY_CARE_SOAP');
});

// ─── 5. Template cues ────────────────────────────────────────────────────────

const step = (p: Partial<GuideStep> & { id: string }): GuideStep => ({ label: p.id, level: 'required', source: 'manual', phase: 'during', status: 'not_done', ...p }) as GuideStep;

test('template cues: every section of the template, with its own help text and who completes it', () => {
  const cues = templateCues('PSYCH_MED_MGMT');
  assert.deepEqual(
    cues.map((c) => c.heading),
    [...NOTE_SECTIONS['Psych Med Mgmt']]
  );
  const hpi = cues.find((c) => c.heading === 'History of Present Illness/Interval History')!;
  assert.match(hpi.cue, /adherence/);
  assert.equal(hpi.aiFills, true);
  assert.equal(cues.find((c) => c.heading === 'Suicidal Ideation')!.aiFills, false);
  assert.equal(cues.find((c) => c.heading === 'Exam')!.aiFills, true);
  // Therapist templates use their field labels as cues
  const tp = templateCues('THERAPY_PROGRESS');
  assert.ok(tp.length > 3 && tp.every((c) => typeof c.cue === 'string'));
  assert.ok(templateCues('TREATMENT_PLAN_REVIEW').length === 1);
});

test('template cues add the Visit Guide steps (C-SSRS, PDMP, med rec, AIMS when applicable) without changing the draft', () => {
  const steps: GuideStep[] = [
    step({ id: 'review_brief', phase: 'prepare' }),
    step({ id: 'cssrs', label: 'C-SSRS screener', source: 'auto' }),
    step({ id: 'pdmp', label: 'PDMP (CRISP) checked', source: 'auto', when: 'controlled_meds', status: 'done' }),
    step({ id: 'med_rec', label: 'Medication reconciliation' }),
    step({ id: 'aims', label: 'AIMS (movement exam)', level: 'recommended', source: 'auto', when: 'antipsychotic' }),
    step({ id: 'coordination', level: 'optional' }),
    step({ id: 'prescribing', label: 'Prescribing decision', source: 'note', noteSection: 'Plan - Med Changes' }),
  ];
  const g = guideCues(steps);
  assert.deepEqual(
    g.map((x) => x.id),
    ['cssrs', 'pdmp', 'med_rec', 'aims']
  );
  assert.equal(g.find((x) => x.id === 'pdmp')!.done, true);
  const merged = withGuideNoteSteps(templateCues('PSYCH_MED_MGMT'), steps);
  assert.deepEqual(merged.find((c) => c.heading === 'Plan - Med Changes')!.guide, ['Prescribing decision']);
});

test('template cues panel is display only (no fetch, no AI call) and shows on the capture screen', () => {
  const panel = read('components/scribe/TemplateCuesPanel.tsx');
  const lib = read('lib/scribe/templateCues.ts');
  for (const src of [panel, lib]) {
    assert.doesNotMatch(src, /fetch\(|invokeBedrock|\/api\//);
  }
  assert.match(panel, /Template cues/);
  const page = read('app/dashboard/scribe/page.tsx');
  assert.match(page, /<TemplateCuesPanel format=\{format\}/);
  assert.match(page, /More templates/);
  // The draft request body: the format, plus the speaker confirmation when labels were inferred (no cue content)
  assert.match(page, /body: JSON\.stringify\(\{ format, \.\.\.\(speakersOk \? \{ speakersConfirmed: true \} : \{\}\) \}\)/);
});

// ─── 3. Dismiss ──────────────────────────────────────────────────────────────

test('dismiss is allowed while capturing or after capture, not once a draft note exists', () => {
  assert.equal(DISMISS_CONFIRM, 'Stop and discard this recording? Nothing from it will be kept.');
  assert.equal(DISMISS_LABEL, 'Dismiss scribe');
  for (const status of ['ready', 'capturing', 'paused', 'stopped', 'drafted']) assert.equal(canDismiss({ status, progressNoteId: null }), true, status);
  assert.match(dismissBlocker({ status: 'note_created', progressNoteId: 'n1' })!, /draft note was already created/);
  assert.ok(dismissBlocker({ status: 'discarded', progressNoteId: null }));
  assert.ok(dismissBlocker({ status: 'stopped', progressNoteId: null, consentWithdrawnAt: new Date() }));
  const d = DISMISSED_CAPTURE_DATA(new Date('2026-10-23T12:00:00Z'));
  assert.equal(d.status, 'discarded');
  assert.equal(d.clientSummary, null);
  assert.ok(d.transcriptPurgedAt instanceof Date);
});

test('dismiss route: stops Chime, deletes segments and drafts, keeps a metadata-only audit row', () => {
  const ctl = read('app/api/scribe/captures/[id]/control/route.ts');
  assert.match(ctl, /'dismiss'/);
  assert.match(ctl, /dismiss: 'SCRIBE_CAPTURE_DISMISSED'/);
  const block = ctl.slice(ctl.indexOf("if (body.action === 'dismiss') {\n    // Mark"));
  assert.ok(block.length > 0);
  const end = block.indexOf('return NextResponse.json');
  const body = block.slice(0, end);
  // discarded first (late uploads refused), then the text is deleted
  assert.ok(body.indexOf('DISMISSED_CAPTURE_DATA') < body.indexOf('scribeSegment.deleteMany'));
  assert.match(body, /scribeDraft\.deleteMany/);
  // audit metadata: counts and the reason enum only
  assert.match(body, /audit\('SUCCESS', \{ segmentsDeleted: deleted\.count, draftsDeleted: drafts\.count/);
  const auditLine = body.split('\n').find((l) => l.includes("audit('SUCCESS'"))!;
  assert.doesNotMatch(auditLine, /text|lines|transcript/i);
  // Chime transcription is stopped before deletion (shared stop path)
  assert.ok(ctl.indexOf('stopChimeTranscription(meetingId)') < ctl.indexOf("if (body.action === 'dismiss') {\n    // Mark"));
  // reason is an enum, never free text
  assert.match(ctl, /reason: z\.enum\(DISMISS_REASONS\)\.optional\(\)/);
  // segment uploads are refused for a discarded capture
  assert.match(read('app/api/scribe/captures/[id]/segments/route.ts'), /cap\.status === 'discarded'/);
});

test('dismiss UI: confirm first, stop the stream at once, return to the plain setup', () => {
  const ui = read('components/scribe/DismissScribe.tsx');
  assert.match(ui, /DISMISS_CONFIRM/);
  assert.match(ui, /Stop and discard/);
  const bar = read('components/scribe/RecordingBar.tsx');
  assert.match(bar, /<DismissScribe onConfirm=\{onDismiss\} \/>/);
  const hook = read('components/scribe/useTranscribeStream.ts');
  assert.match(hook, /const discard = useCallback/);
  assert.match(hook, /sink\.clear\(\)/);
  const page = read('app/dashboard/scribe/page.tsx');
  assert.match(page, /stream\.discard\(\)/);
  assert.match(page, /controlCapture\(capture\.id, 'dismiss'/);
  assert.match(page, /setPhase\('setup'\)/);
  assert.match(page, /canDismiss\(capture\)/);
  const tele = read('components/scribe/TelehealthScribePanel.tsx');
  assert.match(tele, /chime\.discard\(\)/);
  assert.match(tele, /controlCapture\(captureId, 'dismiss'/);
  assert.match(tele, /onDismiss=/);
});

// ─── Dismiss / withdraw race: guaranteed cleanup ─────────────────────────────

test('segment upload re-checks the capture under a row lock in the same transaction as the insert', () => {
  const store = read('lib/scribe/store.ts');
  const fn = store.slice(store.indexOf('export async function appendSegmentsIfOpen'));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  assert.match(body, /prisma\.\$transaction\(async \(tx\)/);
  assert.match(body, /FOR SHARE/);
  assert.ok(body.indexOf('FOR SHARE') < body.indexOf('tx.scribeSegment.createMany'), 'guard before insert');
  assert.match(body, /if \(!open\.length\) return null/);
  assert.match(store, /OPEN_CAPTURE_GUARD_SQL = `"status" NOT IN \('discarded', 'ready'\) AND "consent_withdrawn_at" IS NULL AND "transcript_purged_at" IS NULL`/);
  const route = read('app/api/scribe/captures/[id]/segments/route.ts');
  assert.match(route, /appendSegmentsIfOpen\(cap, body\.segments\)/);
  assert.match(route, /if \(added === null\) return jsonError\(409/);
  assert.doesNotMatch(route, /appendSegments\(cap/);
  // dismiss and withdraw both close the capture (row update) before deleting the text
  const ctl = read('app/api/scribe/captures/[id]/control/route.ts');
  for (const marker of ["if (body.action === 'dismiss') {\n    // Mark", "if (body.action === 'withdraw') {"]) {
    const b = ctl.slice(ctl.indexOf(marker));
    assert.ok(b.indexOf('scribeCapture.update') < b.indexOf('scribeSegment.deleteMany'), marker);
  }
});

test('retention safety net deletes leftover segments / drafts of discarded or withdrawn captures at any age', async () => {
  const { sweepClosedCaptures } = await import('../src/lib/scribe/retention');
  const left = new Map([
    ['cap-dismissed', { segments: 3, drafts: 1 }],
    ['cap-withdrawn', { segments: 0, drafts: 2 }],
    ['cap-gone', { segments: 0, drafts: 0 }],
  ]);
  const audits: { captureId: string; segments: number; drafts: number }[] = [];
  const res = await sweepClosedCaptures({
    leftovers: async () => [...left.keys()].map((captureId) => ({ captureId, organizationId: 'org1' })),
    purge: async (id) => left.get(id)!,
    audit: async (e) => {
      audits.push(e);
    },
  });
  assert.deepEqual(res, { captures: 2, segments: 3, drafts: 3 });
  assert.deepEqual(
    audits.map((a) => a.captureId),
    ['cap-dismissed', 'cap-withdrawn']
  );
  const job = read('lib/scribe/retentionJob.ts');
  assert.match(job, /CLOSED_CAPTURE: Prisma\.ScribeCaptureWhereInput = \{ OR: \[\{ status: 'discarded' \}, \{ consentWithdrawnAt: \{ not: null \} \}\] \}/);
  // no age filter on the sweep, and deletes are re-scoped to closed captures
  const sweep = job.slice(job.indexOf('export function prismaClosedSweepDeps'), job.indexOf('export async function runScribeRetention'));
  assert.doesNotMatch(sweep, /createdAt|updatedAt|stoppedAt|lt:|lte:/);
  assert.match(sweep, /scribeSegment\.deleteMany\(\{ where: \{ sessionId: captureId, session: CLOSED_CAPTURE \} \}\)/);
  assert.match(sweep, /scribeDraft\.deleteMany\(\{ where: \{ sessionId: captureId, session: CLOSED_CAPTURE \} \}\)/);
  assert.match(sweep, /metadata: \{ segments, drafts, reason: 'closed_capture_leftover' \}/);
  assert.match(job, /await sweepClosedCaptures\(prismaClosedSweepDeps\(\)\)/);
});
