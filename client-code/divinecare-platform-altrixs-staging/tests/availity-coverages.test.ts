import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AvailityEligibilityError } from '../src/lib/integrations/availity/errors';
import { buildCoveragesFormBody } from '../src/lib/integrations/availity/inquiry';
import { mapPatientGender, namesMatch, splitPersonName } from '../src/lib/integrations/availity/mapping';
import { normalizeCoverageResponse } from '../src/lib/integrations/availity/normalize';

test('splitPersonName maps a single Client.name onto first/last', () => {
  assert.deepEqual(splitPersonName('Ada Lovelace'), { firstName: 'Ada', lastName: 'Lovelace' });
  assert.deepEqual(splitPersonName('Madonna'), { lastName: 'Madonna' });
});

test('mapPatientGender only uses Availity M/F/U', () => {
  assert.equal(mapPatientGender('Female'), 'F');
  assert.equal(mapPatientGender('m'), 'M');
  assert.equal(mapPatientGender('other'), undefined);
});

test('payer name match is case-insensitive and ignores punctuation', () => {
  assert.equal(namesMatch('Florida Blue', 'FLORIDA BLUE'), true);
  assert.equal(namesMatch('BCBSF', 'bcbsf'), true);
  assert.equal(namesMatch('Aetna', 'Cigna'), false);
});

test('buildCoveragesFormBody omits disallowed fields and requires allowed ones', () => {
  const body = buildCoveragesFormBody(
    {
      payerId: 'BCBSF',
      insuranceMemberId: 'ABC123',
      insuranceGroupNumber: 'GRP9',
      clientName: 'Ada Lovelace',
      dateOfBirth: new Date('1990-01-15T00:00:00.000Z'),
      gender: 'F',
      state: 'FL',
      providerNpi: '1234567893',
      providerName: 'Rivendell Clinic',
    },
    {
      payerId: 'BCBSF',
      elements: {
        payerId: { allowed: true, required: true },
        memberId: { allowed: true, required: true },
        groupNumber: { allowed: false, required: false },
        providerNpi: { allowed: true, required: true, pattern: '^[1-4][0-9]{9}$' },
        patientSSN: { allowed: false, required: false },
        patientLastName: { allowed: true, required: true },
        patientFirstName: { allowed: true, required: false },
      },
    }
  );
  assert.equal(body.get('payerId'), 'BCBSF');
  assert.equal(body.get('memberId'), 'ABC123');
  assert.equal(body.get('groupNumber'), null);
  assert.equal(body.get('patientSSN'), null);
  assert.equal(body.get('providerNpi'), '1234567893');
  assert.equal(body.get('patientLastName'), 'Lovelace');
});

test('buildCoveragesFormBody 400s when a required allowed field is missing', () => {
  assert.throws(
    () =>
      buildCoveragesFormBody(
        {
          payerId: 'BCBSF',
          insuranceMemberId: null,
          insuranceGroupNumber: null,
          clientName: 'Ada',
          dateOfBirth: null,
          gender: null,
          state: null,
          providerNpi: null,
          providerName: null,
        },
        {
          payerId: 'BCBSF',
          elements: { memberId: { allowed: true, required: true, errorMessage: 'Enter a patient ID' } },
        }
      ),
    (err: unknown) =>
      err instanceof AvailityEligibilityError &&
      err.code === 'missing_fields' &&
      err.details?.[0]?.field === 'memberId'
  );
});

test('normalizeCoverageResponse maps official amount objects and drops PHI', () => {
  const normalized = normalizeCoverageResponse({
    id: 'cov-1',
    status: 'Complete',
    statusCode: '4',
    subscriber: { memberId: 'SECRET' },
    payer: { payerId: 'BCBSF', name: 'FLORIDA BLUE' },
    plans: [
      {
        eligibilityStartDate: '2024-01-01T00:00:00.000+0000',
        coverageEndDate: '2024-12-31T00:00:00.000+0000',
        benefits: [
          {
            amounts: {
              coPayment: { inNetwork: [{ amount: '25', memberId: 'SECRET' }] },
              deductibles: { inNetwork: [{ remaining: '500' }] },
              outOfPocket: { inNetwork: [{ total: '3000' }] },
              coInsurance: { inNetwork: [{ amount: '20' }] },
            },
          },
        ],
      },
    ],
  });
  assert.equal(normalized.success, true);
  assert.equal(normalized.status, 'Complete');
  assert.equal(normalized.statusCode, '4');
  assert.equal(normalized.payer?.payerId, 'BCBSF');
  assert.equal(normalized.coverageDates.eligibilityStartDate, '2024-01-01T00:00:00.000+0000');
  assert.equal(normalized.coverageDates.coverageEndDate, '2024-12-31T00:00:00.000+0000');
  const copay = normalized.benefits.copay as { inNetwork: { amount: string; memberId?: string }[] };
  assert.equal(copay.inNetwork[0].amount, '25');
  assert.equal(copay.inNetwork[0].memberId, undefined);
  assert.ok(!('subscriber' in normalized));
});
