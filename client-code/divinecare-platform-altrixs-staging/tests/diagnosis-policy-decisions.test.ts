/**
 * Owner-delegated policy decisions (2026-10-24):
 *  A) 42 CFR Part 2: SUD diagnoses of a Part 2-protected client are withheld from the DrFirst
 *     problem push unless a covering Part 2 consent is on file (src/lib/drfirst/part2Problems.ts).
 *  B) Non-F primary diagnosis on a BH service: error for Maryland Medicaid / PBHS / Carelon, warning
 *     for other payers (src/lib/diagnoses/rules.ts, src/lib/billing/claimScrubber.ts).
 *  C) Required note format elements warn until the Notes policy date, then block
 *     (src/lib/notes/formatElements.ts, standard.ts noteTypeIssues, policy.ts).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import Module, { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import {
  applyPart2ProblemRule,
  part2ConsentCoversDrFirst,
  part2WithholdAuditMetadata,
  PART2_WITHHELD_NOTICE,
  type Part2ConsentRow,
} from '../src/lib/drfirst/part2Problems';
import { claimDiagnosisFindings } from '../src/lib/diagnoses/rules';
import { isMarylandPbhsClaimPayer } from '../src/lib/consents/carelon/medicaid';
import {
  DEFAULT_FORMAT_ELEMENTS_ENFORCE_FROM,
  formatElementsGate,
  resolveFormatElementsEnforceFrom,
  enforceFromLabel,
} from '../src/lib/notes/formatElements';
import { DEFAULT_NOTE_POLICY, firstSignBlocker, noteTypeIssues } from '../src/lib/notes/standard';
import { requiredFieldChecks, type NoteQualityFacts } from '../src/lib/ai/noteQuality/rules';

type Row = Record<string, unknown>;
const NOW = new Date('2026-10-24T15:00:00Z');

// ─── A) Part 2 → DrFirst ─────────────────────────────────────────────────────

const consent = (over: Partial<Part2ConsentRow> = {}): Part2ConsentRow => ({
  type: 'Consent for Use and Disclosure of SUD Records (42 CFR Part 2)',
  formKey: 'lib:part2-consent',
  status: 'SIGNED',
  formStatus: 'COMPLETE',
  expiresAt: null,
  revokedAt: null,
  recipientName: null,
  formData: { purposeTag: 'tpo', response: { fields: { recipientType: 'tpo' } } },
  ...over,
});

test('A: Part 2 consent coverage by state (TPO / named DrFirst / expired / revoked / unsigned / other key)', () => {
  assert.equal(part2ConsentCoversDrFirst([], NOW), false, 'no consent');
  assert.equal(part2ConsentCoversDrFirst([consent()], NOW), true, 'signed TPO consent');
  assert.equal(part2ConsentCoversDrFirst([consent({ formData: { response: { fields: { recipientType: 'tpo' } } } })], NOW), true, 'TPO from the signed response');
  assert.equal(part2ConsentCoversDrFirst([consent({ expiresAt: new Date('2026-10-01T00:00:00Z') })], NOW), false, 'expired');
  assert.equal(part2ConsentCoversDrFirst([consent({ expiresAt: new Date('2027-10-01T00:00:00Z') })], NOW), true, 'not yet expired');
  assert.equal(part2ConsentCoversDrFirst([consent({ revokedAt: new Date('2026-10-20T00:00:00Z') })], NOW), false, 'revoked');
  assert.equal(part2ConsentCoversDrFirst([consent({ formStatus: 'REVOKED' })], NOW), false, 'revoked form status');
  assert.equal(part2ConsentCoversDrFirst([consent({ status: 'PENDING', formStatus: 'SENT' })], NOW), false, 'sent, not signed');
  assert.equal(part2ConsentCoversDrFirst([consent({ formStatus: 'SUPERSEDED' })], NOW), false, 'superseded');
  const named = (name: string) => consent({ recipientName: name, formData: { purposeTag: null, response: { fields: { recipientType: 'named', recipientName: name } } } });
  assert.equal(part2ConsentCoversDrFirst([named('DrFirst (Rcopia e-prescribing)')], NOW), true, 'names DrFirst');
  assert.equal(part2ConsentCoversDrFirst([named('Dr. Smith, prescriber')], NOW), true, 'names the prescriber');
  assert.equal(part2ConsentCoversDrFirst([named('Baltimore County Probation')], NOW), false, 'other named recipient');
  // Matched by consent-library key, never by free text
  assert.equal(part2ConsentCoversDrFirst([consent({ formKey: 'lib:roi-authorization' })], NOW), false, 'ROI is not a Part 2 consent');
  assert.equal(part2ConsentCoversDrFirst([consent({ formKey: null, type: '42 CFR Part 2 consent (TPO)' })], NOW), false, 'free-text type only');
});

test('A: withhold SUD codes for an unconsented Part 2 client; non-SUD go; non-protected unchanged', () => {
  const problems = [{ code: 'F33.1' }, { code: 'F11.20' }, { code: 'F17.210' }, { code: 'F10.20' }];
  const withheld = applyPart2ProblemRule(problems, { part2Client: true, consentCovers: false });
  assert.deepEqual(withheld.send.map((p) => p.code), ['F33.1', 'F17.210'], 'tobacco F17 is not Part 2');
  assert.deepEqual(withheld.withheld.map((p) => p.code), ['F11.20', 'F10.20']);
  assert.equal(withheld.reason, 'part2_no_consent');
  assert.deepEqual(applyPart2ProblemRule(problems, { part2Client: true, consentCovers: true }), { send: problems, withheld: [], reason: null });
  assert.deepEqual(applyPart2ProblemRule(problems, { part2Client: false, consentCovers: false }), { send: problems, withheld: [], reason: null });
  assert.equal(applyPart2ProblemRule([{ code: 'F33.1' }], { part2Client: true, consentCovers: false }).reason, null, 'nothing withheld: no notice');
  const meta = part2WithholdAuditMetadata({ withheld: 2, removedFromDrFirst: 1, sent: 1 });
  assert.deepEqual(Object.keys(meta).sort(), ['nonSudSentCount', 'reason', 'removedFromDrFirstCount', 'rule', 'withheldCount']);
  assert.equal(PART2_WITHHELD_NOTICE, 'SUD diagnoses not sent to DrFirst: no Part 2 consent on file');
});

function loadChartPush(state: { part2: boolean; consents: Row[]; ledger?: Row }) {
  const sent: { code: string; deleted: boolean }[] = [];
  const audits: Row[] = [];
  const queries: string[] = [];
  const ledgers = new Map<string, unknown>(state.ledger ? [['drfirst:sent:c1', state.ledger]] : []);
  const db = {
    clinicModuleState: {
      findUnique: async ({ where }: { where: { organizationId_module: { module: string } } }) =>
        ledgers.has(where.organizationId_module.module) ? { data: ledgers.get(where.organizationId_module.module) } : null,
      upsert: async ({ where, create }: { where: { organizationId_module: { module: string } }; create: { data: unknown } }) => {
        ledgers.set(where.organizationId_module.module, JSON.parse(JSON.stringify(create.data)));
      },
    },
    medicalAllergy: { findMany: async () => [] },
    medicalProblem: { count: async () => 0 },
    clientMedication: { findMany: async () => [] },
    sensitiveRecord: { findFirst: async () => { queries.push('sensitiveRecord'); return state.part2 ? { noteClassification: '42 CFR Part 2 (SUD program)' } : null; } },
    progressNote: { findFirst: async () => { queries.push('progressNote'); return null; } },
    consentForm: { findMany: async () => { queries.push('consentForm'); return state.consents; } },
  };
  const ok = async () => ({ ok: true, demo: false, status: 'ok' });
  const real = createRequire(import.meta.url)('../src/lib/services/drfirstCommands');
  const commands = {
    ...real,
    sendProblem: async (_p: unknown, code: string, _d: string, _u: unknown, opts: { deleted?: boolean }) => { sent.push({ code, deleted: Boolean(opts?.deleted) }); return ok(); },
    sendAllergy: ok, sendNoKnownAllergies: ok, sendMedication: ok,
  };
  const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
  const originalLoad = loader._load;
  loader._load = function (id, ...args) {
    if (id === 'server-only') return {};
    if (id === '@/lib/db/prisma') return { prisma: db };
    if (id === '@/lib/services/drfirstCommands') return commands;
    if (id === '@/lib/audit/writeAuditLog') return { writeAuditLog: async (e: Row) => { audits.push(e); } };
    if (id === '@/lib/diagnoses/store') return { loadDiagnosisListsFor: async () => new Map() };
    return originalLoad.call(this, id, ...args);
  };
  const require = createRequire(import.meta.url);
  for (const k of Object.keys(require.cache)) if (/drfirst[\\/]_lib[\\/]chartPush/.test(k)) delete require.cache[k];
  try {
    const push = require('../src/app/api/drfirst/_lib/chartPush') as typeof import('../src/app/api/drfirst/_lib/chartPush');
    return { push, sent, audits, queries, ledgers };
  } finally {
    loader._load = originalLoad;
  }
}

const caller = { userId: 'u1', role: 'NP', organizationId: 'org1', rcopiaUsername: 'np1', ipAddress: null, userAgent: null };
const client = { id: 'c1', primaryDiagnosisCode: 'F33.1', primaryDiagnosis: 'Major depressive disorder, recurrent, moderate', secondaryDiagnoses: 'F11.20 - Opioid use disorder, moderate' };

test('A: chart push — no Part 2 consent: SUD code withheld, previously sent SUD code removed, audit counts only', async () => {
  const h = loadChartPush({ part2: true, consents: [], ledger: { problemFormat: 2, problems: { 'F11.20': '2026-10-15' }, allergies: {} } });
  const r = await h.push.pushChartToRcopia(caller as never, client, { rcopiaId: '9001' });
  assert.deepEqual(h.sent, [{ code: 'F33.1', deleted: false }, { code: 'F11.20', deleted: true }], 'non-SUD sent; withheld SUD sent as removed');
  assert.equal(r.problemsSent, 1);
  assert.equal(r.removedSent, 1);
  assert.equal(r.part2Withheld, 1);
  assert.equal(r.part2WithheldReason, 'part2_no_consent');
  const ledger = h.ledgers.get('drfirst:sent:c1') as { problems: Record<string, string> };
  assert.deepEqual(Object.keys(ledger.problems), ['F33.1'], 'removed SUD code leaves the ledger');
  const audit = h.audits.find((a) => a.action === 'DRFIRST_PART2_WITHHELD')!;
  assert.ok(audit, 'withholding decision is audit-logged');
  assert.deepEqual(audit.metadata, { reason: 'part2_no_consent', rule: '42 CFR Part 2', withheldCount: 1, removedFromDrFirstCount: 1, nonSudSentCount: 1 });
  const all = JSON.stringify(h.audits);
  for (const text of ['F11', 'Opioid', 'F33.1', 'depressive']) assert.equal(all.includes(text), false, `no diagnosis text in audit rows: ${text}`);
});

test('A: chart push — covering Part 2 consent: SUD code sent; non-protected client unchanged (no consent lookup)', async () => {
  const allowed = loadChartPush({ part2: true, consents: [consent() as unknown as Row] });
  const r = await allowed.push.pushChartToRcopia(caller as never, client, { rcopiaId: '9001' });
  assert.deepEqual(allowed.sent.map((s) => s.code), ['F33.1', 'F11.20']);
  assert.equal(r.part2Withheld, 0);
  assert.equal(allowed.audits.some((a) => a.action === 'DRFIRST_PART2_WITHHELD'), false);

  const expired = loadChartPush({ part2: true, consents: [consent({ expiresAt: new Date('2026-01-01T00:00:00Z') }) as unknown as Row] });
  await expired.push.pushChartToRcopia(caller as never, client, { rcopiaId: '9001' });
  assert.deepEqual(expired.sent.map((s) => s.code), ['F33.1'], 'expired consent: withheld');

  const plain = loadChartPush({ part2: false, consents: [] });
  const p = await plain.push.pushChartToRcopia(caller as never, client, { rcopiaId: '9001' });
  assert.deepEqual(plain.sent.map((s) => s.code), ['F33.1', 'F11.20'], 'non-protected client: everything goes');
  assert.equal(p.part2Withheld, 0);
  assert.equal(plain.queries.includes('consentForm'), false, 'consents only read for a Part 2 client');
});

test('A: DrFirst panel shows the notice with a link to the consents tab', () => {
  const panel = readFileSync('src/components/drfirst/DrFirstChartPanel.tsx', 'utf8');
  assert.match(panel, /state\.part2Notice\.message/);
  assert.match(panel, /\?tab=documents/);
  const route = readFileSync('src/app/api/drfirst/patients/link/route.ts', 'utf8');
  assert.match(route, /PART2_WITHHELD_NOTICE/);
  assert.match(route, /part2Notice/);
});

// ─── B) Non-F primary on BH claims ──────────────────────────────────────────

test('B: Maryland Medicaid / PBHS / Carelon payer detection', () => {
  for (const p of ['Maryland Medicaid', 'Carelon Behavioral Health', 'Maryland Public Behavioral Health System', 'Optum Maryland', 'Priority Partners (HealthChoice)']) {
    assert.equal(isMarylandPbhsClaimPayer({ payer: p }), true, p);
  }
  for (const p of ['Aetna', 'CareFirst BlueCross BlueShield', 'Medicare', 'DC Medicaid (DHCF)', null]) {
    assert.equal(isMarylandPbhsClaimPayer({ payer: p }), false, String(p));
  }
  assert.equal(isMarylandPbhsClaimPayer({ payer: 'Some MCO', claimFilingCode: 'MC' }), true, 'claim filing code MC');
  assert.equal(isMarylandPbhsClaimPayer({ payer: 'Virginia Medicaid (DMAS)', claimFilingCode: 'MC' }), false, 'other state Medicaid');
});

test('B: non-F primary on a BH service: error for MD Medicaid / Carelon, warning for others', () => {
  const f = (marylandPbhsPayer: boolean | undefined, cpt = '90837', codes = ['Z63.0']) =>
    claimDiagnosisFindings({ codes, chart: null, cptCodes: [cpt], dateOfService: '2026-10-20', marylandPbhsPayer }).find((x) => x.code === 'DX_PRIMARY_NOT_BH');
  const err = f(true)!;
  assert.equal(err.severity, 'error');
  assert.match(err.message, /F codes are accepted|F code/);
  assert.match(err.message, /only F codes/);
  assert.equal(f(false)!.severity, 'warning');
  assert.equal(f(undefined)!.severity, 'warning');
  assert.equal(f(true, '99213'), undefined, 'medical E/M: no BH rule');
  assert.equal(f(true, '90837', ['F33.1']), undefined, 'F primary: fine');
});

test('B: claim scrubber passes the payer through (Carelon -> errors; Aetna -> warnings)', () => {
  const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
  const originalLoad = loader._load;
  loader._load = function (id, ...args) {
    if (id === 'server-only') return {};
    if (id === '@/lib/db/prisma' || id === '@/lib/db') return { prisma: {} };
    if (id === '@/lib/audit/writeAuditLog') return { writeAuditLog: async () => undefined };
    return originalLoad.call(this, id, ...args);
  };
  let scrubber: typeof import('../src/lib/billing/claimScrubber');
  try {
    const req = createRequire(import.meta.url);
    delete req.cache[req.resolve('../src/lib/billing/claimScrubber')];
    scrubber = req('../src/lib/billing/claimScrubber');
  } finally {
    loader._load = originalLoad;
  }
  const claim = (payer: string, filing?: string) => ({
    id: 'cl1', clientId: 'c1', cptCode: '90837', units: 1, amountCents: 18000, payer, status: 'DRAFT' as const,
    submissionData: { diagnosisCodes: ['Z63.0'], serviceDate: '2026-10-20', payerId: 'X1', ...(filing ? { claimFilingCode: filing } : {}) },
    createdAt: new Date(), denialReason: null,
    client: { name: 'Client A', insuranceMemberId: 'M1', dateOfBirth: new Date('1990-01-01'), primaryDiagnosisCode: 'Z63.0' },
    appointment: null, progressNote: null, serviceLines: [],
  });
  const md = scrubber.evaluateClaimScrub(claim('Carelon Behavioral Health Maryland'));
  assert.ok(md.findings.some((x) => x.code === 'DX_PRIMARY_NOT_BH' && x.severity === 'error'));
  assert.equal(md.status, 'errors');
  const mc = scrubber.evaluateClaimScrub(claim('Wellness MCO', 'MC'));
  assert.ok(mc.findings.some((x) => x.code === 'DX_PRIMARY_NOT_BH' && x.severity === 'error'), 'filing code MC');
  const other = scrubber.evaluateClaimScrub(claim('Aetna'));
  assert.ok(other.findings.some((x) => x.code === 'DX_PRIMARY_NOT_BH' && x.severity === 'warning'));
  assert.equal(other.findings.some((x) => x.code === 'DX_PRIMARY_NOT_BH' && x.severity === 'error'), false);
});

// ─── C) Note format elements: warn until the cutoff, then block ─────────────

const DAP_MISSING = 'Data\nClient was anxious.';
const TZ = 'America/New_York';

test('C: setting default, override, invalid values, practice-time-zone cutoff', () => {
  assert.equal(DEFAULT_FORMAT_ELEMENTS_ENFORCE_FROM, '2026-11-16');
  assert.equal(DEFAULT_NOTE_POLICY.formatElementsEnforceFrom, '2026-11-16');
  assert.equal(resolveFormatElementsEnforceFrom(null), '2026-11-16');
  assert.equal(resolveFormatElementsEnforceFrom('2026-12-01'), '2026-12-01');
  for (const bad of ['2026-02-30', '11/16/2026', '', 'now']) assert.equal(resolveFormatElementsEnforceFrom(bad), '2026-11-16', bad);
  // 2026-11-16 03:00Z is still Nov 15 in Maryland; 05:30Z is Nov 16 00:30 ET
  assert.equal(formatElementsGate({ timeZone: TZ }, new Date('2026-11-16T03:00:00Z')).enforced, false);
  assert.equal(formatElementsGate({ timeZone: TZ }, new Date('2026-11-16T05:30:00Z')).enforced, true);
  assert.equal(formatElementsGate({ timeZone: TZ }, new Date('2026-12-01T12:00:00Z')).enforced, true);
  assert.equal(formatElementsGate({ timeZone: TZ, formatElementsEnforceFrom: '2026-10-24' }, NOW).enforced, true, 'block now (today)');
  assert.equal(formatElementsGate({ timeZone: TZ, formatElementsEnforceFrom: '2027-01-04' }, new Date('2026-12-01T12:00:00Z')).enforced, false, 'later date');
  assert.equal(enforceFromLabel('2026-11-16', 2026), 'Nov 16');
  assert.equal(enforceFromLabel('2027-01-04', 2026), 'Jan 4, 2027');
});

test('C: before the cutoff signing proceeds with a warning; on/after it blocks', () => {
  const before = noteTypeIssues({ noteType: 'DAP', body: DAP_MISSING, formatElements: formatElementsGate({ timeZone: TZ }, NOW), now: NOW });
  const fmt = before.filter((i) => i.id.startsWith('format.'));
  assert.ok(fmt.length >= 1);
  assert.ok(fmt.every((i) => i.severity === 'warn'));
  assert.ok(fmt.every((i) => i.message.endsWith('Will be required from Nov 16.')), fmt.map((i) => i.message).join(' | '));
  assert.equal(firstSignBlocker(before), null, 'signing proceeds');

  const on = new Date('2026-11-16T14:00:00Z');
  const after = noteTypeIssues({ noteType: 'DAP', body: DAP_MISSING, formatElements: formatElementsGate({ timeZone: TZ }, on), now: on });
  assert.ok(after.filter((i) => i.id.startsWith('format.')).every((i) => i.severity === 'block'));
  assert.match(firstSignBlocker(after) ?? '', /DAP note/);

  // Other blocks unchanged before the cutoff (crisis risk assessment still blocks)
  const crisis = noteTypeIssues({ noteType: 'Crisis', body: 'Presenting Crisis\nCalled after argument.', formatElements: formatElementsGate({ timeZone: TZ }, NOW), now: NOW });
  assert.equal(crisis.find((i) => i.id === 'crisis.risk')?.severity, 'block');
  assert.equal(crisis.find((i) => i.id === 'format.sections')?.severity, 'warn');
  // No gate passed: strict (block)
  assert.ok(noteTypeIssues({ noteType: 'DAP', body: DAP_MISSING }).some((i) => i.id === 'format.sections' && i.severity === 'block'));
});

test('C: quality check: warn before the cutoff, fail on/after', () => {
  const facts = (now: string, enforceFrom?: string) =>
    ({ note: { noteType: 'DAP', body: DAP_MISSING }, settings: { noteSignDeadlineHours: 72, telehealthModifierDefault: '95', timeZone: TZ, formatElementsEnforceFrom: enforceFrom ?? null }, now }) as unknown as NoteQualityFacts;
  const item = (f: NoteQualityFacts) => requiredFieldChecks(f).find((i) => i.id === 'required.format_elements')!;
  assert.equal(item(facts(NOW.toISOString())).status, 'warn');
  assert.match(item(facts(NOW.toISOString())).detail, /Will be required from Nov 16\./);
  assert.equal(item(facts('2026-11-16T14:00:00Z')).status, 'fail');
  assert.equal(item(facts(NOW.toISOString(), '2026-10-24')).status, 'fail', 'admin set "block now"');
});

test('C: loadNotePolicy default and override; sign path and pre-sign check pass the gate', async () => {
  let row: Row | null = null;
  const db = {
    practiceSettings: { findUnique: async () => ({ noteSignDeadlineHours: 72, timeZone: TZ, cosignRequiredRoles: [] }) },
    notePolicySettings: {
      findUnique: async () => row,
      upsert: async ({ create, update }: { create: Row; update: Row }) => { row = { ...(row ?? create), ...update }; return row; },
    },
  };
  const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
  const originalLoad = loader._load;
  loader._load = function (id, ...args) {
    if (id === '@/lib/db/prisma') return { prisma: db };
    return originalLoad.call(this, id, ...args);
  };
  let policyMod: typeof import('../src/lib/notes/policy');
  try {
    const req = createRequire(import.meta.url);
    delete req.cache[req.resolve('../src/lib/notes/policy')];
    policyMod = req('../src/lib/notes/policy');
  } finally {
    loader._load = originalLoad;
  }
  assert.equal((await policyMod.loadNotePolicy('org1')).formatElementsEnforceFrom, '2026-11-16', 'no row: default');
  await policyMod.saveNotePolicy('org1', 'u1', { formatElementsEnforceFrom: '2026-12-07' });
  assert.equal((await policyMod.loadNotePolicy('org1')).formatElementsEnforceFrom, '2026-12-07', 'override');

  for (const f of ['src/lib/notes/workflow-store.ts', 'src/lib/notes/worklist.ts', 'src/app/api/notes/[id]/standard/route.ts']) {
    assert.match(readFileSync(f, 'utf8'), /formatElements: (formatElementsGate\(policy|ctx\.formatElements)/, f);
  }
  const route = readFileSync('src/app/api/notes/policy/route.ts', 'utf8');
  assert.match(route, /formatElementsEnforceFrom: z\.string\(\)\.refine\(isEnforceFromDate/);
  assert.match(route, /formatElementsBlockNow/);
  const card = readFileSync('src/components/notes/NotePolicyCard.tsx', 'utf8');
  assert.match(card, /Required note sections: warn until/);
  assert.match(card, /Block now/);
});

test('Part 2 lookup failure never removes SUD codes already in Rcopia (transient error)', () => {
  const src = readFileSync(new URL('../src/app/api/drfirst/_lib/chartPush.ts', import.meta.url), 'utf8');
  assert.match(src, /part2Unknown = true/);
  assert.match(src, /if \(part2Unknown\) todo\.removedProblems = todo\.removedProblems\.filter\(\(code\) => !isPart2SudCode\(code\)\)/);
});
