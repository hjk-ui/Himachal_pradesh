/**
 * READ-ONLY demographics check for ACTIVE clients. Never writes (SELECT only, no audit rows).
 *
 *   npx tsx --conditions=react-server --env-file=.env scripts/check-client-demographics.ts
 *   ... --org=<organizationId>   limit to one organization
 *   ... --samples=5              sample clients with gaps (default 5)
 *
 * Uses the same checks as the app (src/lib/clients/demographics.ts): DrFirst readiness (legal
 * name, DOB, sex, full address; phone recommended), claim readiness (plus payer + member ID),
 * FHIR US Core readiness (MRN, legal name, sex). Output: counts, client ids and MRNs only
 * (no names, no values).
 * Imports plain lib modules only (no next-auth / next/navigation chains).
 */
import { prisma } from '@/lib/db/prisma';
import {
  administrativeSexCode,
  claimReadiness,
  drfirstReadiness,
  fhirReadiness,
  normalizeStateCode,
  normalizeUsPhone,
  normalizeUsZip,
} from '@/lib/clients/demographics';

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const ORG = arg('org');
const SAMPLES = Math.max(0, Number(arg('samples') ?? 5) || 5);
const pad = (s: string | number, n: number) => String(s).padEnd(n);
const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : '-');
const blank = (v: string | null | undefined) => !(v ?? '').trim();

async function main() {
  const clients = await prisma.client.findMany({
    where: { status: 'ACTIVE', ...(ORG ? { organizationId: ORG } : {}) },
    select: {
      id: true, mrn: true, organizationId: true, name: true,
      legalFirstName: true, legalLastName: true, needsNameReview: true,
      dateOfBirth: true, administrativeSex: true, gender: true,
      sexAtBirth: true, race: true, ethnicity: true, preferredLanguage: true,
      addressLine1: true, city: true, state: true, postalCode: true, phone: true, email: true,
      insurancePayer: true, insuranceMemberId: true, insuranceType: true, medicaidId: true,
    },
    orderBy: { createdAt: 'asc' },
  });
  const orgs = new Set(clients.map((c) => c.organizationId ?? '(none)'));
  const now = new Date();
  const n = clients.length;

  const c = {
    missingLegalFirst: 0, missingLegalLast: 0, missingLegalEither: 0, needsNameReview: 0,
    missingDob: 0, missingSex: 0, sexFromLegacyGender: 0,
    missingAddress: 0, missingCity: 0, missingState: 0, invalidState: 0,
    missingZip: 0, invalidZip: 0, missingPhone: 0, invalidPhone: 0,
    missingPayer: 0, missingMemberId: 0,
    missingSexAtBirth: 0, missingRace: 0, missingEthnicity: 0, missingLanguage: 0, missingMrn: 0,
    readyDrFirst: 0, readyClaims: 0, readyFhir: 0, readyAll: 0,
  };
  const gapSamples: Array<{ id: string; mrn: string | null; missing: string[] }> = [];

  for (const x of clients) {
    if (blank(x.legalFirstName)) c.missingLegalFirst++;
    if (blank(x.legalLastName)) c.missingLegalLast++;
    if (blank(x.legalFirstName) || blank(x.legalLastName)) c.missingLegalEither++;
    if (x.needsNameReview) c.needsNameReview++;
    if (!x.dateOfBirth) c.missingDob++;
    const sex = administrativeSexCode(x);
    if (!sex) c.missingSex++;
    else if (blank(x.administrativeSex)) c.sexFromLegacyGender++;
    if (blank(x.addressLine1)) c.missingAddress++;
    if (blank(x.city)) c.missingCity++;
    if (blank(x.state)) c.missingState++;
    else if (!normalizeStateCode(x.state)) c.invalidState++;
    if (blank(x.postalCode)) c.missingZip++;
    else if (!normalizeUsZip(x.postalCode)) c.invalidZip++;
    if (blank(x.phone)) c.missingPhone++;
    else if (!normalizeUsPhone(x.phone)) c.invalidPhone++;
    if (blank(x.insurancePayer)) c.missingPayer++;
    if (blank(x.insuranceMemberId)) c.missingMemberId++;
    if (blank(x.sexAtBirth)) c.missingSexAtBirth++;
    if (!x.race?.length) c.missingRace++;
    if (blank(x.ethnicity)) c.missingEthnicity++;
    if (blank(x.preferredLanguage)) c.missingLanguage++;
    if (blank(x.mrn)) c.missingMrn++;

    const erx = drfirstReadiness(x, now);
    const claims = claimReadiness(x, now);
    const fhir = fhirReadiness(x);
    if (erx.ready) c.readyDrFirst++;
    if (claims.ready) c.readyClaims++;
    if (fhir.ready) c.readyFhir++;
    if (erx.ready && claims.ready && fhir.ready) c.readyAll++;
    if ((!erx.ready || !claims.ready) && gapSamples.length < SAMPLES) {
      const missing = Array.from(new Set([...erx.missing, ...claims.missing].filter((g) => g.severity === 'required').map((g) => g.field)));
      gapSamples.push({ id: x.id, mrn: x.mrn, missing });
    }
  }

  console.log(`Client demographics check (read-only) — ${n} ACTIVE clients${ORG ? ` in org ${ORG}` : ` across ${orgs.size} organization(s)`}\n`);
  const line = (label: string, v: number) => console.log(`  ${pad(label, 44)} ${pad(v, 7)} ${pct(v, n)}`);
  console.log('Name');
  line('missing legal first name', c.missingLegalFirst);
  line('missing legal last name', c.missingLegalLast);
  line('missing legal first or last', c.missingLegalEither);
  line('needs name review (flagged)', c.needsNameReview);
  console.log('Birth date / sex');
  line('missing DOB', c.missingDob);
  line('missing sex (no administrativeSex, legacy not M/F)', c.missingSex);
  line('sex only from legacy gender (run backfill)', c.sexFromLegacyGender);
  console.log('Address / phone');
  line('missing street address', c.missingAddress);
  line('missing city', c.missingCity);
  line('missing state', c.missingState);
  line('invalid state (not a USPS code)', c.invalidState);
  line('missing ZIP', c.missingZip);
  line('invalid ZIP (not 5 digits / ZIP+4)', c.invalidZip);
  line('missing phone', c.missingPhone);
  line('invalid phone (not a 10-digit US number)', c.invalidPhone);
  console.log('Insurance');
  line('missing payer', c.missingPayer);
  line('missing insurance member ID', c.missingMemberId);
  console.log('USCDI (recommended for FHIR / CRISP)');
  line('missing MRN', c.missingMrn);
  line('missing sex at birth', c.missingSexAtBirth);
  line('missing race', c.missingRace);
  line('missing ethnicity', c.missingEthnicity);
  line('missing preferred language', c.missingLanguage);
  console.log('Readiness (required items only)');
  line('ready for DrFirst (e-prescribing)', c.readyDrFirst);
  line('ready for claims (837P)', c.readyClaims);
  line('ready for FHIR (US Core required)', c.readyFhir);
  line('ready for all three', c.readyAll);
  if (gapSamples.length) {
    console.log(`\nSample clients with gaps (id / MRN / missing fields):`);
    for (const s of gapSamples) console.log(`  ${s.id}  ${s.mrn ?? '(no MRN)'}  ${s.missing.join(', ')}`);
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
