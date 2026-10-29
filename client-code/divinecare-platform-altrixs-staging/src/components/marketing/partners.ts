/**
 * Integration partners shown on the public site (homepage + /pricing) by PartnerStrip.
 * Owner confirmed 2026-10-26: DrFirst (Rcopia e-prescribing), Waystar (clearinghouse) and AWS
 * (hosting) are real, live integrations.
 *
 * Logos: NO trademarked logo is downloaded or embedded. Each partner renders as a text wordmark
 * until an approved logo file is placed at public/partners/<key>.svg (or .png) AND `logo` below is
 * set to that path. tests/marketing-copy-standard.test.ts fails if a `logo` path has no file.
 * How to get approval and add a file: docs/marketing-partner-logos.md.
 */
export type PartnerKey = 'drfirst' | 'waystar' | 'aws';

export type Partner = {
  key: PartnerKey;
  name: string;
  /** One-line role shown under the name (and in the logo's accessible name). */
  role: string;
  /** '/partners/<key>.svg' | '/partners/<key>.png' once an approved file exists; null = text wordmark. */
  logo: string | null;
  logoAlt: string;
};

export const PARTNERS: Partner[] = [
  { key: 'drfirst', name: 'DrFirst', role: 'e-prescribing & EPCS', logo: null, logoAlt: 'DrFirst logo' },
  { key: 'waystar', name: 'Waystar', role: 'claims & remittance', logo: null, logoAlt: 'Waystar logo' },
  {
    key: 'aws',
    name: 'Amazon Web Services',
    role: 'hosting & AI, under a BAA',
    logo: null,
    logoAlt: 'Powered by AWS',
  },
];

export const PARTNER_TRADEMARK_LINE = 'DrFirst, Rcopia, Waystar and AWS are trademarks of their respective owners.';

/** "DrFirst — e-prescribing & EPCS" */
export function partnerLabel(p: Partner): string {
  return `${p.name} — ${p.role}`;
}
