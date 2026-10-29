import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveVisitKind, VISIT_KIND_LIST, VISIT_KINDS } from '../src/lib/visits/kinds';
import {
  CONFIRMED_BY_PRACTICE_BADGE,
  CONFIRM_WITH_COMPLIANCE_BADGE,
  MARYLAND_CONFIRMATIONS,
  stepsForVisitKind,
  briefForVisitKind,
} from '../src/lib/visits/guide-catalog';

test('visit guide exposes all staged visit kinds', () => {
  const expected = [
    'therapy_intake',
    'psych_eval_adult',
    'psych_eval_child',
    'psych_reeval',
    'med_management',
    'therapy_individual',
    'therapy_family',
    'group_therapy',
    'sud_individual',
    'sud_group',
    'sud_intake',
    'prp',
    'iop',
    'php',
    'crisis_followup',
    'telephone',
    'primary_care',
    'tms',
    'spravato',
    'treatment_plan_review',
    'discharge',
    'no_show',
    'other',
  ];
  assert.deepEqual(
    VISIT_KIND_LIST.map((k) => k.id).sort(),
    [...expected].sort()
  );
});

test('resolveVisitKind maps note labels and CPT-facing aliases', () => {
  assert.equal(resolveVisitKind('Med Mgmt'), 'med_management');
  assert.equal(resolveVisitKind('Psych Eval'), 'psych_eval_adult');
  assert.equal(resolveVisitKind('Individual Therapy'), 'therapy_individual');
  assert.equal(resolveVisitKind('SUD'), 'sud_individual');
  assert.equal(resolveVisitKind('Group'), 'group_therapy');
  assert.equal(resolveVisitKind('Annual Physical'), 'primary_care');
  assert.equal(resolveVisitKind('IOP'), 'iop');
  assert.equal(resolveVisitKind('med_management'), 'med_management');
});

test('med management CPT list includes 99212', () => {
  assert.ok(VISIT_KINDS.med_management.defaultCpt.includes('99212'));
  assert.ok(briefForVisitKind('med_management').cpt.includes('99212'));
});

test('AIMS step is gated on antipsychotic when for med management', () => {
  const steps = stepsForVisitKind('med_management');
  const aims = steps.find((s) => s.key === 'aims');
  assert.ok(aims);
  assert.equal(aims?.instrumentName, 'AIMS');
  assert.equal(aims?.when, 'antipsychotic');
  assert.equal(aims?.label, 'AIMS (movement exam)');
});

test('Maryland confirmation badges are exact', () => {
  const confirmed = MARYLAND_CONFIRMATIONS.filter((c) => c.status === 'confirmed');
  assert.ok(confirmed.length >= 14);
  for (const row of confirmed) {
    assert.equal(row.badge, CONFIRMED_BY_PRACTICE_BADGE);
  }
  const pending = MARYLAND_CONFIRMATIONS.filter((c) => c.status === 'confirm_with_compliance');
  assert.deepEqual(
    pending.map((p) => p.id).sort(),
    ['acip', 'collaborative_care', 'uspstf'].sort()
  );
  for (const row of pending) {
    assert.equal(row.badge, CONFIRM_WITH_COMPLIANCE_BADGE);
  }
  const open = MARYLAND_CONFIRMATIONS.filter((c) => c.status === 'open_numeric');
  assert.equal(open.length, 2);
  for (const row of open) {
    assert.equal(row.badge, undefined);
  }
});

test('SUD kinds are Part 2 and PRPs have empty CPT until model confirmed', () => {
  assert.equal(VISIT_KINDS.sud_individual.part2, true);
  assert.equal(VISIT_KINDS.sud_group.part2, true);
  assert.equal(VISIT_KINDS.sud_intake.part2, true);
  assert.deepEqual(VISIT_KINDS.prp.defaultCpt, []);
});

test('checklist tabs phases cover prepare during wrap-up for therapy', () => {
  const steps = stepsForVisitKind('therapy_individual');
  assert.ok(steps.some((s) => s.phase === 'prepare' && s.key === 'cssrs'));
  assert.ok(steps.some((s) => s.phase === 'during' && s.level === 'required'));
  assert.ok(steps.some((s) => s.phase === 'wrap_up'));
});
