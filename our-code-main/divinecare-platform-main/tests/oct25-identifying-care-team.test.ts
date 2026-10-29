import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  IDENTIFYING_INFO_NOTE_TYPES,
  fieldLabel,
  formatIdentifyingSection,
  hasIdentifyingInformation,
  parseIdentifyingSection,
  ageInYears,
  formatAge,
} from '../src/lib/identifying-info/fields';
import { SOURCE_TAGS } from '../src/lib/identifying-info/copy';
import { identifyingSignIssues } from '../src/lib/identifying-info/signIssues';
import { chartUpdateCandidates, resolvePrefill } from '../src/lib/identifying-info/prefill';
import { canAssignFromRowMenu, rowActionAriaLabel, rowActionItems } from '../src/lib/clients/rowActions';
import { canAssignPatientToClinician } from '../src/lib/clients/orgScope';
import { buildCareTeamSummary, normalizeCareTeam } from '../src/lib/clients/careTeamSummary';
import { mergeSeenBy } from '../src/lib/clients/seenBy';
import { isNonClinicalAssignee, pickSuggestedClinician } from '../src/lib/clients/adminAssigned';
import { accountMenuAriaLabel, previewingAs } from '../src/lib/layout/accountMenu';
import { NEVER_AI_HEADINGS } from '../src/lib/scribe/formats';
import { formatElementsGate } from '../src/lib/notes/notes-policy';

describe('oct25 identifying information', () => {
  it('applies to the eight evaluation / intake note types only', () => {
    assert.equal(IDENTIFYING_INFO_NOTE_TYPES.length, 8);
    for (const t of [
      'Therapy Intake',
      'Substance Abuse Intake',
      'Intake',
      'Psych Eval',
      'Child Psych Initial Intake',
      'Child Psych Intake',
      'Adult Psych Intake',
      'Adult Psych Re-Eval',
    ]) {
      assert.equal(hasIdentifyingInformation(t), true, t);
    }
    for (const t of ['SOAP', 'DAP', 'Med Mgmt', 'Crisis', 'Group']) {
      assert.equal(hasIdentifyingInformation(t), false, t);
    }
  });

  it('uses the exact chief complaint label and source tags', () => {
    assert.equal(fieldLabel('chiefComplaint'), "Chief complaint (patient's own words)");
    assert.equal(SOURCE_TAGS.chart, '(from chart)');
    assert.equal(SOURCE_TAGS.appointment, '(from appointment)');
    assert.equal(SOURCE_TAGS.vitals, '(from chart vitals)');
    assert.equal(SOURCE_TAGS.lastEvaluation, '(from last evaluation)');
    assert.equal(SOURCE_TAGS.draft, '(saved draft)');
    assert.equal(SOURCE_TAGS.scribe, '(AI Scribe suggestion — reviewed by you)');
  });

  it('Identifying Information is never AI-written', () => {
    assert.ok(NEVER_AI_HEADINGS.some((h) => h === 'Identifying Information'));
  });

  it('omits blank fields and round-trips; never writes "unknown"', () => {
    const text = formatIdentifyingSection({ title: 'Mx.', chiefComplaint: ' I feel stuck ', weight: '' });
    assert.ok(!/unknown/i.test(text));
    assert.ok(!text.includes(fieldLabel('weight')));
    const parsed = parseIdentifyingSection(text);
    assert.equal(parsed.title, 'Mx.');
    assert.equal(parsed.chiefComplaint, 'I feel stuck');
    assert.equal(parsed.weight, undefined);
  });

  it('computes age from the chart date of birth only', () => {
    assert.equal(ageInYears('2000-06-01', '2026-10-27'), 26);
    assert.equal(ageInYears(null, '2026-10-27'), null);
    assert.equal(formatAge('2025-10-27', '2026-10-27'), '1 year');
  });

  it('sign issues are warnings before 2026-11-16 and blocks from then', () => {
    assert.equal(formatElementsGate('2026-11-15'), 'warn');
    assert.equal(formatElementsGate('2026-11-16'), 'block');
    const warn = identifyingSignIssues({ noteType: 'Psych Eval', values: {}, ageYears: 30, today: '2026-11-15' });
    assert.deepEqual(warn.map((i) => i.code).sort(), ['chief_complaint', 'visit_modality']);
    assert.ok(warn.every((i) => i.severity === 'warn'));
    const block = identifyingSignIssues({ noteType: 'Psych Eval', values: {}, ageYears: 30, today: '2026-11-16' });
    assert.ok(block.every((i) => i.severity === 'block'));
  });

  it('minor guardian rules: blank and "Self" are flagged; adults and other note types are not', () => {
    const base = { chiefComplaint: 'x', visitModality: 'in_office' };
    const blank = identifyingSignIssues({ noteType: 'Child Psych Intake', values: base, ageYears: 9, today: '2026-11-16' });
    assert.deepEqual(blank.map((i) => i.code), ['guardian_blank']);
    const self = identifyingSignIssues({
      noteType: 'Child Psych Intake',
      values: { ...base, legalGuardian: 'self' },
      ageYears: 9,
      today: '2026-11-16',
    });
    assert.deepEqual(self.map((i) => i.code), ['guardian_self']);
    const named = identifyingSignIssues({
      noteType: 'Child Psych Intake',
      values: { ...base, legalGuardian: 'Pat Doe' },
      ageYears: 9,
      today: '2026-11-16',
    });
    assert.equal(named.length, 0);
    assert.equal(identifyingSignIssues({ noteType: 'Intake', values: base, ageYears: 40, today: '2026-11-16' }).length, 0);
    assert.equal(identifyingSignIssues({ noteType: 'SOAP', values: {}, ageYears: 9, today: '2026-11-16' }).length, 0);
  });

  it('prefill precedence: draft beats chart; scribe fills blanks only; age is chart-derived', () => {
    const state = resolvePrefill({
      chart: { namePrefix: 'Dr.', gender: 'Female', dateOfBirth: '1990-01-01' },
      draft: { title: 'Ms.', age: '99 years' },
      scribe: { title: 'Mr.', chiefComplaint: 'Trouble sleeping' },
      today: '2026-10-27',
    });
    assert.equal(state.values.title, 'Ms.');
    assert.equal(state.sources.title, 'draft');
    assert.equal(state.values.genderIdentity, 'Female');
    assert.equal(state.sources.genderIdentity, 'chart');
    assert.equal(state.values.chiefComplaint, 'Trouble sleeping');
    assert.equal(state.sources.chiefComplaint, 'scribe');
    assert.equal(state.values.age, '36 years');
  });

  it('only title and gender identity can be written back to the chart; scribe values are skipped', () => {
    const candidates = chartUpdateCandidates(
      {
        values: { title: 'Mx.', genderIdentity: 'Non-binary', chiefComplaint: 'x' },
        sources: { title: 'draft', genderIdentity: 'scribe', chiefComplaint: 'draft' },
      },
      { namePrefix: null, gender: null, dateOfBirth: null }
    );
    assert.deepEqual(Object.keys(candidates), ['title']);
  });
});

describe('oct25 row actions menu', () => {
  it('assign roles match the clinician-assignment rule', () => {
    for (const role of ['SUPER_ADMIN', 'ADMIN', 'PRACTICE_DIRECTOR', 'FRONT_DESK', 'OFFICE_MANAGER']) {
      assert.equal(canAssignFromRowMenu(role), true, role);
    }
    for (const role of ['THERAPIST', 'PSYCHIATRIST', 'BILLING', undefined, null]) {
      assert.equal(canAssignFromRowMenu(role as string | null | undefined), false, String(role));
      assert.equal(
        canAssignFromRowMenu(role as string | null | undefined),
        canAssignPatientToClinician(role as string | null | undefined)
      );
    }
  });

  it('items: Assign clinician when unassigned, Transfer otherwise; Edit and View', () => {
    const un = rowActionItems({ unassigned: true, canAssignTeam: true, canEditRow: true });
    assert.deepEqual(un.map((i) => i.key), ['handoff', 'edit', 'view']);
    assert.equal(un[0].label, 'Assign clinician');
    const tr = rowActionItems({ unassigned: false, canAssignTeam: true, canEditRow: false });
    assert.deepEqual(tr.map((i) => i.key), ['handoff', 'view']);
    assert.match(tr[0].label, /^Transfer/);
    assert.equal(rowActionAriaLabel('Sam Rivera'), 'Actions for Sam Rivera');
  });
});

describe('oct25 care team summary', () => {
  const seen = (name: string, role: string, lastSeenAt: string, source: 'appointment' | 'medicalVisit' = 'appointment') => ({
    providerId: `id-${name}`,
    name,
    role,
    lastSeenAt,
    source,
  });

  it('unassigned when nobody is on the team; non-clinical assignee is not a clinician', () => {
    const s = buildCareTeamSummary({ treatmentTeam: null, assignedToId: 'a', assignedToName: 'Admin A', assignedToRole: 'ADMIN' });
    assert.equal(s.primary, null);
    assert.equal(s.pcp.status, 'not_assigned');
    assert.equal(s.pcp.text, 'PCP: not assigned');
  });

  it('seen-by chips read "Prescriber · seen: name" and PCP is "to confirm" with candidates', () => {
    const s = buildCareTeamSummary({
      treatmentTeam: [],
      seenBy: [
        seen('Dr. Lee', 'PSYCHIATRIST', '2026-09-01T10:00:00.000Z'),
        seen('Dr. Park', 'PHYSICIAN', '2026-08-01T10:00:00.000Z', 'medicalVisit'),
      ],
    });
    assert.ok(s.chips.some((c) => c.text === 'Prescriber · seen: Dr. Lee'));
    assert.equal(s.pcp.status, 'to_confirm');
    assert.equal(s.pcp.text, 'PCP: to confirm');
    if (s.pcp.status === 'to_confirm') assert.equal(s.pcp.candidates[0].name, 'Dr. Park');
  });

  it('accepts both legacy treatmentTeam shapes', () => {
    assert.ok(normalizeCareTeam([{ id: 'u1', name: 'Tia', role: 'Therapist' }]).length >= 1);
    assert.ok(normalizeCareTeam({ primaryTherapistId: 'u1', primaryTherapistName: 'Tia' }).length >= 1);
  });

  it('seen-by merge keeps one entry per provider with the newest visit', () => {
    const map = mergeSeenBy([
      { clientId: 'c', providerId: 'p', name: 'Dr. Lee', role: 'PSYCHIATRIST', at: new Date('2026-01-01'), source: 'appointment' },
      { clientId: 'c', providerId: 'p', name: 'Dr. Lee', role: 'PSYCHIATRIST', at: new Date('2026-05-01'), source: 'appointment' },
    ]);
    assert.equal(map.get('c')?.length, 1);
    assert.equal(map.get('c')?.[0].lastSeenAt.slice(0, 10), '2026-05-01');
  });
});

describe('oct25 admin-assigned clients', () => {
  it('classifies assignees', () => {
    assert.equal(isNonClinicalAssignee('ADMIN'), true);
    assert.equal(isNonClinicalAssignee('FRONT_DESK'), true);
    assert.equal(isNonClinicalAssignee('THERAPIST'), false);
    assert.equal(isNonClinicalAssignee(null), false);
  });

  it('suggests only clinical people already tied to the client; never a guess', () => {
    assert.equal(pickSuggestedClinician([]), null);
    const pick = pickSuggestedClinician([
      { providerId: 'pcp', role: 'PHYSICIAN', teamRole: 'Primary care', isPrimary: true, source: 'careTeam' },
      { providerId: 'rx', role: 'PSYCHIATRIST', teamRole: 'Prescriber', isPrimary: false, source: 'careTeam' },
      { providerId: 'th', role: 'THERAPIST', teamRole: 'Therapist', isPrimary: false, source: 'careTeam' },
    ]);
    assert.equal(pick?.providerId, 'th');
    const seenOnly = pickSuggestedClinician([
      { providerId: 'a', role: 'THERAPIST', teamRole: null, isPrimary: false, source: 'seenBy', lastSeenAt: '2026-01-01' },
      { providerId: 'b', role: 'THERAPIST', teamRole: null, isPrimary: false, source: 'seenBy', lastSeenAt: '2026-06-01' },
      { providerId: 'adm', role: 'ADMIN', teamRole: null, isPrimary: false, source: 'seenBy', lastSeenAt: '2026-09-01' },
    ]);
    assert.equal(seenOnly?.providerId, 'b');
  });
});

describe('oct25 account menu copy', () => {
  it('aria label and preview strip', () => {
    assert.equal(accountMenuAriaLabel('Jyoti', 'Admin'), 'Account menu: Jyoti, Admin');
    assert.equal(previewingAs('Therapist'), 'Previewing as Therapist');
  });
});
