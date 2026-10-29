/**
 * Public marketing copy standard (owner request 2026-10-26).
 *  - Category: Altrixs is a behavioral health EHR. "CRM" only names one module ("Community and
 *    outreach CRM") or appears in the FAQ question that answers "EHR or CRM?".
 *  - No certification claims (SOC 2 / HITRUST), no absolute "HIPAA compliant" claim, no hype words,
 *    no emoji, no other EHR vendor names (owner: migration copy says "your current EHR").
 *  - Every public page has a title and description; one H1 per page.
 *  - Prices are unchanged (snapshot of src/lib/billing/plans.ts, approved 2026-10-20) and are never
 *    hard-coded in copy.
 *  - Each differentiator on the homepage maps to the code that does it.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import {
  ADD_ONS,
  ANNUAL_DISCOUNT_PERCENT,
  FEATURES,
  PRICING_FAQ,
  TIERS,
  VOLUME_DISCOUNTS,
  AI_SCRIBE_INCLUDED_MINUTES,
  AI_SCRIBE_OVERAGE_PER_MINUTE,
  TRIAL_DAYS,
} from '../src/lib/billing/plans';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  AUDIENCES,
  BAA_SIGNUP_POINT,
  DEMO_REQUEST_EMAIL,
  DEMO_REQUEST_HREF,
  DIFFERENTIATORS,
  GO_LIVE_TIMELINE,
  MIGRATION_PROMISE,
  HERO,
  HOME_DESCRIPTION,
  HOME_FAQS,
  HOME_TITLE,
  MODULES,
  MORE_MODULES,
  SECURITY_POINTS,
} from '../src/components/marketing/homeContent';
import { PARTNERS, PARTNER_TRADEMARK_LINE, partnerLabel } from '../src/components/marketing/partners';
import { PartnerStrip } from '../src/components/marketing/PartnerStrip';
import { BAA_LEGAL_REVIEWED } from '../src/lib/legal/baa';

const ROOT = path.join(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel: string) => fs.existsSync(path.join(ROOT, rel));

const PUBLIC_FILES = [
  'src/app/layout.tsx',
  'src/app/page.tsx',
  'src/app/pricing/page.tsx',
  'src/app/get-started/layout.tsx',
  'src/app/get-started/page.tsx',
  'src/app/support/page.tsx',
  'src/app/privacy/page.tsx',
  'src/components/marketing/HomePage.tsx',
  'src/components/marketing/homeContent.ts',
  'src/components/marketing/PricingSection.tsx',
  'src/components/marketing/PricingPlans.tsx',
  'src/components/marketing/QuoteCalculator.tsx',
  'src/components/marketing/MarketingDocShell.tsx',
  'src/components/marketing/PartnerStrip.tsx',
  'src/components/marketing/partners.ts',
  'src/app/legal/baa/page.tsx',
];

/** Strings rendered on public pages that live in data modules. */
const RUNTIME_COPY = JSON.stringify({
  TIERS,
  ADD_ONS,
  FEATURES,
  PRICING_FAQ,
  HERO,
  AUDIENCES,
  MODULES,
  MORE_MODULES,
  DIFFERENTIATORS,
  SECURITY_POINTS,
  HOME_FAQS,
  HOME_TITLE,
  HOME_DESCRIPTION,
  PARTNERS,
});

const ALL_COPY: [string, string][] = [
  ...PUBLIC_FILES.map((f) => [f, read(f)] as [string, string]),
  ['runtime copy (plans.ts + homeContent.ts values)', RUNTIME_COPY],
];

test('public files exist (guard is not vacuous)', () => {
  for (const f of PUBLIC_FILES) assert.ok(exists(f), f);
  assert.ok(HOME_FAQS.length >= 12, 'buyer FAQ');
  assert.ok(DIFFERENTIATORS.length >= 5);
});

test('"CRM" never describes the product; only the outreach module and the EHR-or-CRM question', () => {
  for (const [name, text] of ALL_COPY) {
    const stripped = text
      .replace(/Community (?:and|&) outreach CRM/gi, '')
      .replace(/an EHR or a CRM/g, '');
    assert.doesNotMatch(stripped, /\bCRM\b/, `${name} uses "CRM" outside the module label`);
  }
  assert.match(HERO.kicker, /Behavioral health EHR/);
  assert.match(HOME_TITLE, /Behavioral Health EHR/);
  assert.ok(MORE_MODULES.some((m) => m.title === 'Community and outreach CRM'));
});

test('no certification claims, no absolute HIPAA claim, no hype words, no emoji', () => {
  for (const [name, text] of ALL_COPY) {
    assert.doesNotMatch(text, /SOC ?2|HITRUST/i, `${name}: certification claim`);
    const hipaa = text.replace(/Is Altrixs HIPAA compliant\?/g, '');
    assert.doesNotMatch(hipaa, /HIPAA[- ]compliant/i, `${name}: say "designed to support HIPAA compliance"`);
    assert.doesNotMatch(hipaa, /HIPAA[- ]certified|fully compliant/i, name);
    assert.doesNotMatch(text, /revolutionary|best-in-class|world'?s first|cutting-edge|game-?chang/i, `${name}: hype`);
    assert.doesNotMatch(text, /\p{Extended_Pictographic}/u, `${name}: emoji`);
  }
  assert.match(JSON.stringify(HOME_FAQS), /designed to support HIPAA compliance/);
});

test('no other EHR vendor is named on public pages (owner 2026-10-26)', () => {
  for (const [name, text] of ALL_COPY) {
    assert.doesNotMatch(text, /Valant/i, `${name} names Valant`);
    assert.doesNotMatch(text, /SimplePractice|TherapyNotes|Netsmart|Qualifacts|CredibleBH|AdvancedMD|Kareo|TheraNest/i, name);
  }
  assert.ok(DIFFERENTIATORS.some((d) => /Switch from any EHR/.test(d.title)));
});

test('every public page has a title and description; one H1 per page', () => {
  const withMeta = [
    'src/app/layout.tsx',
    'src/app/page.tsx',
    'src/app/pricing/page.tsx',
    'src/app/get-started/layout.tsx',
    'src/app/support/page.tsx',
    'src/app/privacy/page.tsx',
  ];
  for (const f of withMeta) {
    const s = read(f);
    assert.match(s, /export const metadata/, f);
    assert.match(s, /\btitle\b/, `${f} title`);
    assert.match(s, /\bdescription\b/, `${f} description`);
  }
  assert.ok(HOME_DESCRIPTION.length >= 120 && HOME_DESCRIPTION.length <= 170, `homepage description ${HOME_DESCRIPTION.length} chars`);
  assert.equal((read('src/components/marketing/HomePage.tsx').match(/<h1\b/g) || []).length, 1, 'homepage H1');
  assert.equal((read('src/app/get-started/page.tsx').match(/<h1\b/g) || []).length, 1, 'get-started H1');
  // /pricing renders its H1 through PricingSection; the homepage uses it at h2.
  assert.match(read('src/app/pricing/page.tsx'), /headingLevel="h1"/);
  assert.match(read('src/components/marketing/HomePage.tsx'), /<PricingSection showFaq=\{false\} \/>/);
  // Every <Image> on the homepage has alt text.
  const home = read('src/components/marketing/HomePage.tsx');
  const images = home.match(/<Image\b[\s\S]*?\/>/g) || [];
  assert.ok(images.length >= 3);
  for (const img of images) assert.match(img, /\balt=/, img.slice(0, 80));
});

test('approved prices are unchanged (pricing model v2, 2026-10-20)', () => {
  const seat = (t: 'starter' | 'professional' | 'clinic') =>
    [TIERS[t].seatPrices!.prescriber.month, TIERS[t].seatPrices!.clinician.month, TIERS[t].seatPrices!.paraprofessional.month];
  assert.deepEqual(seat('starter'), [249, 99, 39]);
  assert.deepEqual(seat('professional'), [299, 139, 49]);
  assert.deepEqual(seat('clinic'), [349, 179, 59]);
  assert.deepEqual(
    (['starter', 'professional', 'clinic'] as const).map((t) => [
      TIERS[t].minimumMonthly,
      TIERS[t].onboardingFee,
      TIERS[t].onboardingPerExtraLocation,
      TIERS[t].dataMigrationFee,
    ]),
    [
      [99, 0, 0, 0],
      [499, 1500, 500, 1500],
      [1500, 4000, 750, 3500],
    ]
  );
  assert.equal(TIERS.enterprise.seatPrices, null);
  assert.equal(ADD_ONS.ai_scribe.monthlyPerUnit, 149);
  assert.equal(ADD_ONS.additional_location.monthlyPerUnit, 99);
  assert.equal(ANNUAL_DISCOUNT_PERCENT, 15);
  assert.equal(AI_SCRIBE_INCLUDED_MINUTES, 2500);
  assert.equal(AI_SCRIBE_OVERAGE_PER_MINUTE, 0.08);
  assert.equal(TRIAL_DAYS, 30);
  assert.deepEqual(VOLUME_DISCOUNTS.map((v) => [v.minProviderSeats, v.percent]), [
    [25, 5],
    [50, 10],
  ]);
  // Copy never hard-codes a dollar amount: every price is rendered from plans.ts.
  for (const f of ['src/components/marketing/homeContent.ts', 'src/app/page.tsx', 'src/app/pricing/page.tsx', 'src/app/get-started/layout.tsx']) {
    assert.deepEqual(read(f).match(/\$\d[\d,]*(\.\d+)?/g) || [], [], `${f} hard-codes a price`);
  }
  assert.match(read('src/app/page.tsx'), /pricingApproved\(\)/, 'structured-data offer only once pricing is live');
});

/** Each marketing claim -> the code that does it. */
const CLAIM_MAP: { claim: RegExp; file: string; code: RegExp }[] = [
  { claim: /cite the transcript/, file: 'src/lib/scribe/grounding.ts', code: /must cite them on\s+\* every sentence/ },
  { claim: /English or Spanish/, file: 'src/lib/scribe/language.ts', code: /Spanish/ },
  { claim: /SOAP, DAP and BIRP/, file: 'src/lib/scribe/formatCatalog.ts', code: /BIRP: 'BIRP'/ },
  { claim: /cannot be signed until risk is documented/, file: 'src/lib/scribe/riskGate.ts', code: /RISK_ATTESTATION_PREFIX/ },
  { claim: /Medication changes are left to the prescriber/, file: 'src/lib/scribe/draft.ts', code: /Do not write medication changes into the note/ },
  { claim: /psychotherapy notes/, file: 'src/lib/scribe/minimumNecessary.ts', code: /Move to psychotherapy notes/ },
  { claim: /Every fact links to the page it came from/, file: 'src/lib/ai/chartDigest/types.ts', code: /Every fact carries at least one citation/ },
  { claim: /summarizes past notes/, file: 'src/lib/ai/previsit/service.ts', code: /./ },
  { claim: /42 CFR Part 2/, file: 'src/lib/privacy/part2Disclosures.ts', code: /./ },
  { claim: /including to e-prescribing/, file: 'src/lib/drfirst/part2Problems.ts', code: /./ },
  { claim: /break-the-glass/, file: 'src/lib/privacy/sensitiveAccess.ts', code: /break.?the.?glass|breakGlass/i },
  { claim: /Care-team access/, file: 'src/lib/auth/roleAccess.ts', code: /care.?team/i },
  { claim: /EPCS/, file: 'src/app/api/prescriptions/route.ts', code: /EPCS/ },
  { claim: /PDMP/, file: 'src/app/api/drfirst/pdmp-events/route.ts', code: /./ },
  { claim: /lab orders/, file: 'src/lib/labs/orderSets.ts', code: /./ },
  { claim: /vitals/, file: 'src/lib/medical/medicalProgram.ts', code: /vitals/i },
  { claim: /Maryland COMAR/, file: 'src/lib/prp/standard.ts', code: /COMAR/ },
  { claim: /IOP and PHP/, file: 'src/lib/intensive/policy.ts', code: /IOP|PHP/ },
  { claim: /AOT/, file: 'src/lib/aot/forms/complaint.ts', code: /./ },
  { claim: /peer support/, file: 'src/lib/peerSupport/manage.ts', code: /./ },
  { claim: /residential/, file: 'src/lib/residential/capacity.ts', code: /./ },
  { claim: /PHQ-9, GAD-7/, file: 'src/lib/measures/instruments.ts', code: /GAD-7/ },
  { claim: /by text or email/, file: 'src/lib/measures/delivery.ts', code: /sms:[\s\S]*smsConsent/ },
  { claim: /claim scrubber/, file: 'src/lib/medical/claimScrubber.ts', code: /./ },
  { claim: /remittances \(ERA\)/, file: 'src/lib/billing/clearinghouseClaims.ts', code: /\b835\b|\bERA\b/ },
  { claim: /autopay/, file: 'src/lib/patientPayments/access.ts', code: /autopay/i },
  { claim: /Video visits/, file: 'src/lib/telehealth/chime.ts', code: /./ },
  { claim: /installs on any phone/, file: 'public/sw.js', code: /./ },
  { claim: /book online/, file: 'src/app/book/[practiceSlug]', code: /./ },
  { claim: /only after they agree/, file: 'src/lib/appointments/manage.ts', code: /TCPA/ },
  { claim: /timekeeping connector/, file: 'src/app/api/hr/homebase/reconciliation/route.ts', code: /./ },
  { claim: /licenses, supervision/, file: 'src/lib/hr/credentials.ts', code: /supervis/i },
  { claim: /Two-factor sign-in/, file: 'src/lib/auth/mfaTokens.ts', code: /./ },
  { claim: /15 idle minutes/, file: 'src/lib/auth/sessionPolicy.ts', code: /IDLE_TIMEOUT_MS = 15 \* 60 \* 1000/ },
  { claim: /six years/, file: 'src/lib/audit/writeAuditLog.ts', code: /6 years/ },
  { claim: /contact and scheduling details only/, file: 'src/lib/marketing/leads.ts', code: /contact \/ scheduling facts only/ },
  { claim: /diagnoses, appointment history and documents/, file: 'src/lib/migration/valantDocuments.ts', code: /./ },
  { claim: /FHIR API/, file: 'src/app/fhir/Patient', code: /./ },
];

test('every differentiator and capability claim maps to existing code', () => {
  const homeCopy = JSON.stringify({ HERO, AUDIENCES, MODULES, MORE_MODULES, DIFFERENTIATORS, SECURITY_POINTS, HOME_FAQS });
  for (const { claim, file, code } of CLAIM_MAP) {
    assert.match(homeCopy, claim, `claim no longer on the page: ${claim}`);
    assert.ok(exists(file), `${claim} -> missing ${file}`);
    if (fs.statSync(path.join(ROOT, file)).isFile()) assert.match(read(file), code, `${claim} -> ${file}`);
  }
  // Unverified items stay off the page.
  assert.doesNotMatch(homeCopy, /\bTMS\b|\bWAF\b|firewall|secure messaging/i);
});

// --- Owner answers 2026-10-26: partners, timeline, demo email, migration wording, BAA claim ---

test('partner strip renders text wordmarks (no logo files are shipped)', () => {
  assert.deepEqual(PARTNERS.map((p) => p.key), ['drfirst', 'waystar', 'aws']);
  for (const p of PARTNERS) assert.equal(p.logo, null, `${p.key}: logos stay off until approved (docs/marketing-partner-logos.md)`);
  assert.deepEqual(PARTNERS.map(partnerLabel), [
    'DrFirst — e-prescribing & EPCS',
    'Waystar — claims & remittance',
    'Amazon Web Services — hosting & AI, under a BAA',
  ]);
  const html = renderToStaticMarkup(React.createElement(PartnerStrip));
  assert.match(html, /Integrated with/);
  for (const p of PARTNERS) {
    assert.ok(html.includes(p.name), p.name);
    assert.ok(html.includes(p.role.replace(/&/g, '&amp;')), p.role);
  }
  assert.doesNotMatch(html, /<img\b/, 'no logo image while logo is null');
  assert.equal(exists('public/partners'), false, 'no partner logo files committed without approval');
  // A logo, once configured, must be an existing approved file at /partners/<key>.svg|png.
  for (const p of PARTNERS) {
    if (!p.logo) continue;
    assert.match(p.logo, new RegExp(`^/partners/${p.key}\\.(svg|png)$`));
    assert.ok(exists(`public${p.logo}`), `${p.logo} missing`);
  }
  assert.match(read('src/components/marketing/PartnerStrip.tsx'), /p\.logo \?[\s\S]*alt=/, 'logo branch has alt text');
  // Shown on the homepage and /pricing.
  assert.match(read('src/components/marketing/HomePage.tsx'), /<PartnerStrip\b/);
  assert.match(read('src/app/pricing/page.tsx'), /<PartnerStrip\b/);
  assert.ok(exists('docs/marketing-partner-logos.md'));
  assert.match(read('docs/marketing-partner-logos.md'), /Powered by AWS[\s\S]*partner manager/);
});

test('footer trademark line on the homepage, pricing and doc pages', () => {
  assert.equal(PARTNER_TRADEMARK_LINE, 'DrFirst, Rcopia, Waystar and AWS are trademarks of their respective owners.');
  for (const f of ['src/components/marketing/HomePage.tsx', 'src/app/pricing/page.tsx', 'src/components/marketing/MarketingDocShell.tsx']) {
    assert.match(read(f), /\{PARTNER_TRADEMARK_LINE\}/, f);
  }
});

test('implementation timeline is "Most practices go live in 2–4 weeks"', () => {
  assert.equal(GO_LIVE_TIMELINE, 'Most practices go live in 2–4 weeks');
  const setup = HOME_FAQS.find((f) => /How long does setup take/.test(f.q));
  assert.ok(setup && setup.a.startsWith(GO_LIVE_TIMELINE), 'setup / training FAQ');
  assert.ok(PRICING_FAQ.find((f) => f.id === 'onboarding')!.answer.startsWith(GO_LIVE_TIMELINE), 'pricing FAQ');
  assert.match(read('src/components/marketing/HomePage.tsx'), /\{GO_LIVE_TIMELINE\}/);
  // No other timeline promise anywhere public.
  for (const [name, text] of ALL_COPY) {
    const other = text.replace(/2–4 weeks/g, '');
    assert.doesNotMatch(other, /\b\d+\s*(?:-|–|to)\s*\d+\s*weeks\b|\bin \d+ (?:days|weeks)\b/i, `${name}: other timeline`);
  }
});

test('"Request a demo" uses one email constant', () => {
  assert.equal(DEMO_REQUEST_EMAIL, 'support@altrixs.com');
  assert.ok(DEMO_REQUEST_HREF.startsWith(`mailto:${DEMO_REQUEST_EMAIL}?`));
  assert.match(read('src/components/marketing/homeContent.ts'), /mailto:\$\{DEMO_REQUEST_EMAIL\}/);
  const home = read('src/components/marketing/HomePage.tsx');
  assert.doesNotMatch(home, /mailto:/, 'HomePage links via DEMO_REQUEST_HREF only');
  assert.equal((home.match(/href=\{DEMO_REQUEST_HREF\}/g) || []).length >= 2, true);
});

test('migration wording is softened: any EHR platform, with support; no automatic-filing promise', () => {
  assert.equal(MIGRATION_PROMISE, 'Migration from any EHR platform, with support available');
  const faq = HOME_FAQS.find((f) => /move our data/.test(f.q))!;
  assert.ok(
    faq.a.startsWith(
      'Yes. We help you migrate from any EHR platform — typically clients, diagnoses, appointment history and documents — and our team supports you through the move.'
    )
  );
  assert.ok(DIFFERENTIATORS.find((d) => d.title === 'Switch from any EHR')!.body.startsWith(MIGRATION_PROMISE));
  for (const [name, text] of ALL_COPY) {
    assert.doesNotMatch(text, /Full migration|automatic(?:ally)? fil|every document|all (?:of )?your (?:documents|records)/i, `${name}: overpromises migration`);
    assert.doesNotMatch(text, /We move your clients/i, `${name}: old migration wording`);
  }
});

test('no "BAA at sign-up" claim while BAA_LEGAL_REVIEWED is false', () => {
  const claim = /(?:BAA|Business Associate Agreement)[^.]{0,60}sign[- ]?up|sign[- ]?up[^.]{0,60}(?:BAA|Business Associate Agreement)/i;
  assert.match(BAA_SIGNUP_POINT, claim, 'guard pattern matches the claim it guards');
  if (BAA_LEGAL_REVIEWED) {
    assert.ok(SECURITY_POINTS.includes(BAA_SIGNUP_POINT));
    return;
  }
  assert.ok(!SECURITY_POINTS.includes(BAA_SIGNUP_POINT));
  assert.doesNotMatch(RUNTIME_COPY, claim, 'runtime copy');
  for (const [name, text] of ALL_COPY) {
    // homeContent.ts defines the guarded claim; nothing else may carry it.
    const src = (name === 'src/components/marketing/homeContent.ts' ? text.replace(/BAA_SIGNUP_POINT = '[^']*'/, '') : text).replace(/BAA_SIGNUP_POINT/g, '');
    assert.doesNotMatch(src, claim, `${name}: claims BAA at sign-up before legal review`);
  }
  assert.match(read('src/components/marketing/homeContent.ts'), /BAA_LEGAL_REVIEWED \? \[BAA_SIGNUP_POINT\]/);
});
