import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeCoverageResponse } from '../src/lib/integrations/availity/normalize';
import {
  benefitsFromNormalized,
  eligibilityStatusFromNormalized,
  toEligibilityCheckResult,
} from '../src/lib/integrations/availity/result';

test('benefitsFromNormalized flattens Availity amount trees for the UI', () => {
  const normalized = normalizeCoverageResponse({
    id: 'cov-1',
    status: 'Complete',
    statusCode: '4',
    plans: [
      {
        benefits: [
          {
            amounts: {
              coPayment: { inNetwork: [{ amount: '25' }] },
              deductibles: { inNetwork: [{ total: '500', remaining: '200' }] },
              outOfPocket: { inNetwork: [{ total: '3000', remaining: '2100' }] },
            },
          },
        ],
      },
    ],
  });
  const benefits = benefitsFromNormalized(normalized);
  assert.equal(benefits.copay, 25);
  assert.equal(benefits.deductible, 500);
  assert.equal(benefits.deductibleMet, 300);
  assert.equal(benefits.oopMax, 3000);
  assert.equal(benefits.oopMet, 900);
});

test('eligibilityStatusFromNormalized maps Complete to ELIGIBLE', () => {
  assert.equal(
    eligibilityStatusFromNormalized({
      success: true,
      status: 'Complete',
      statusCode: '4',
      coverageDates: {},
      benefits: {},
    }),
    'ELIGIBLE'
  );
  assert.equal(
    eligibilityStatusFromNormalized({
      success: true,
      status: 'Inactive',
      statusCode: '4',
      coverageDates: {},
      benefits: {},
    }),
    'INELIGIBLE'
  );
});

test('toEligibilityCheckResult always uses live mode', () => {
  const result = toEligibilityCheckResult(
    {
      success: true,
      status: 'Complete',
      statusCode: '4',
      payer: { payerId: 'BCBSF' },
      coverageDates: { eligibilityStartDate: '2024-01-01' },
      benefits: {},
    },
    { transaction: 'coverages' }
  );
  assert.equal(result.mode, 'live');
  assert.equal(result.status, 'ELIGIBLE');
  const payer = result.rawResponse.payer as { payerId?: string } | undefined;
  assert.equal(payer?.payerId, 'BCBSF');
});
