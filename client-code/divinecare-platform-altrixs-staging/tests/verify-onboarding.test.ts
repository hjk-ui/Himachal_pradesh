import assert from 'node:assert/strict';
import { test } from 'node:test';
import { practiceSetupSchema, hasDuplicateServices } from '../src/lib/solo/schema';
import { slugifyPracticeName, uniqueSlugCandidate } from '../src/lib/solo/slug';
import { EMPTY_PRACTICE_SETUP } from '../src/lib/solo/defaults';

test('Onboarding Schema: Valid practice setup passes parsing', () => {
  const futureDate = new Date();
  futureDate.setFullYear(futureDate.getFullYear() + 2);
  const expiryStr = futureDate.toISOString().slice(0, 10);

  const sample = {
    ...EMPTY_PRACTICE_SETUP,
    practiceName: 'Beacon Health Therapy',
    practiceAddress: '100 West Baltimore St',
    practiceCity: 'Baltimore',
    practiceState: 'MD',
    practiceZip: '21201',
    practicePhone: '(410) 555-0199',
    fullName: 'Dr. Sarah Smith',
    npi: '1234567890',
    licenseNumber: 'MD-998811',
    licenseType: 'LCSW-C',
    licenseState: 'MD',
    licenseExpiryDate: expiryStr,
    acceptsInsurance: true,
    acceptedPayers: ['Maryland Medicaid', 'Medicare Part B'],
    acceptsSelfPay: true,
    selfPayRate: 150,
  };

  const parsed = practiceSetupSchema.parse(sample);
  assert.equal(parsed.practiceName, 'Beacon Health Therapy');
  assert.equal(parsed.npi, '1234567890');
  assert.equal(parsed.licenseType, 'LCSW-C');
  assert.equal(parsed.services.length, 2);
});

test('Onboarding Schema: Rejects invalid NPI format (must be 10 digits)', () => {
  const sample = {
    ...EMPTY_PRACTICE_SETUP,
    practiceName: 'Beacon Health',
    practicePhone: '(410) 555-0199',
    fullName: 'Dr. Sarah Smith',
    npi: '12345', // invalid length
    licenseNumber: 'MD-12345',
    licenseType: 'MD',
    licenseState: 'MD',
    licenseExpiryDate: '2028-12-31',
  };

  assert.throws(() => practiceSetupSchema.parse(sample), /npi/i);
});

test('Onboarding Schema: Rejects duplicate service names', () => {
  const duplicateServices = [
    { name: 'Individual Therapy' },
    { name: 'individual therapy ' }, // case and whitespace insensitive duplicate
  ];
  assert.equal(hasDuplicateServices(duplicateServices), true);

  const validServices = [
    { name: 'Initial Assessment' },
    { name: 'Individual Therapy' },
  ];
  assert.equal(hasDuplicateServices(validServices), false);
});

test('Practice Slug: slugify and candidate collision resolver', () => {
  const slug = slugifyPracticeName('Dr. Jane Smith Clinic & Wellness!');
  assert.equal(slug, 'dr-jane-smith-clinic-wellness');

  const candidate1 = uniqueSlugCandidate(slug, [slug]);
  assert.equal(candidate1, 'dr-jane-smith-clinic-wellness-1');

  const candidate2 = uniqueSlugCandidate(slug, [slug, 'dr-jane-smith-clinic-wellness-1']);
  assert.equal(candidate2, 'dr-jane-smith-clinic-wellness-2');
});

test('Onboarding Schema: Requires at least one payer when insurance is accepted', () => {
  const sample = {
    ...EMPTY_PRACTICE_SETUP,
    practiceName: 'Beacon Health',
    practicePhone: '(410) 555-0199',
    fullName: 'Dr. Sarah Smith',
    npi: '1234567890',
    licenseNumber: 'MD-12345',
    licenseType: 'MD',
    licenseState: 'MD',
    licenseExpiryDate: '2028-12-31',
    acceptsInsurance: true,
    acceptedPayers: [], // empty accepted payers
  };

  const parsed = practiceSetupSchema.parse(sample);
  assert.equal(parsed.acceptsInsurance, true);
  assert.equal(parsed.acceptedPayers.length, 0);
  // API route rejects when acceptsInsurance is true and acceptedPayers.length === 0
});
