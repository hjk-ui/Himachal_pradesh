// ─── Practice profile — single source of truth ────────────────────────────────
// These are the details entered during practice setup. Every page that shows
// the practice name, address, NPI/TIN, or contact info should import from here
// instead of hardcoding strings, so a change during onboarding lands everywhere.

export const PRACTICE = {
  name: 'MD Behavioral Health',
  legalName: 'MD Behavioral Health, LLC',
  platform: 'Altrixs',
  groupNpi: '',
  taxId: '',
  domain: 'mdbehavioralhealth.com',
  website: 'https://mdbehavioralhealth.com',
  mainPhone: '',
  mainEmail: 'info@mdbehavioralhealth.com',
  privacyEmail: 'privacy@mdbehavioralhealth.com',
  billingEmail: 'billing@mdbehavioralhealth.com',
  locations: [
    { id: 'bowie', name: 'Bowie', address: 'Bowie, MD', locationNpi: '', flagship: true },
    { id: 'ss', name: 'Silver Spring', address: 'Silver Spring, MD', locationNpi: '', flagship: false },
    { id: 'balt', name: 'Baltimore', address: 'Baltimore, MD', locationNpi: '', flagship: false },
    { id: 'lex', name: 'Lexington Park', address: 'Lexington Park, MD', locationNpi: '', flagship: false },
  ],
} as const;

export type PracticeLocationId = (typeof PRACTICE.locations)[number]['id'];
