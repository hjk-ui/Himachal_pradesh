# Altrixs pricing model v2 (approved)

**Status: APPROVED by the owner on 2026-10-20, via chat** (recorded in code as `PRICING_APPROVAL` in `plans.ts`).
The owner approved the prices as proposed and delegated the open decisions; section 7 records each decision.

Going live is still a deploy switch. Nothing has been created in Stripe yet and nothing is charged. Until
`NEXT_PUBLIC_PRICING_APPROVED=true` is set, every pricing surface says "Proposed pricing" and live-mode Checkout
is refused; once it is set, the "Proposed pricing" notice and the "proposed, not billed" estimate labels go away.
The Stripe catalog sync still refuses live keys without `--live`; the owner runs the sync.
MD Behavioral Health stays comped and is never billed by the software.

- Prices and rules live in `src/lib/billing/plans.ts`.
- Cost estimates live in `src/lib/billing/costModel.ts`.
- The Stripe catalog definitions live in `src/lib/stripe/catalog.ts`.
- The numbers in this document come from `npx tsx scripts/pricing-quotes.ts`.

Research was done on 2026-10-19, and all sources were accessed on that date. Labels:

- **[P]**: price published on the vendor's own page.
- **[3P]**: a third party reporting a published price.
- **[EST]**: an estimate, or a figure that is dated or unverified.
- **[Q]**: quote-only; no number found.

Earlier research is in `docs/pricing-research.md` (2026-10-17). It describes model v1, which this document replaces.

---

## 1. Recommended model in one table

| | **Starter** | **Professional** | **Clinic** | **Enterprise** |
|---|---|---|---|---|
| Who it's for | Solo and small practices, up to 5 providers, 1 site | Group practices, up to 2 sites included | Multi-site behavioral health plus primary care, and program providers (PRP, IOP, residential, AOT) | CCBHCs, health systems, 75+ providers |
| **Prescriber seat**, monthly (annual) | $249 ($212) | $299 ($254) | $349 ($297) | Quote |
| **Clinician seat** | $99 ($84) | $139 ($118) | $179 ($152) | Quote |
| **Program staff seat** | $39 ($33) | $49 ($42) | $59 ($50) | Quote |
| **Support staff** | Free | Free | Free | Free |
| Monthly minimum | $99 | $499 | $1,500 | Contract |
| Claims included (pooled, per paid seat per month) | 50 | 150 | 200 | Contract |
| Locations | 1 | 2 included, then $99/month each | Unlimited | Unlimited |
| Onboarding, one-time | $0 (self-guided) | $1,500 + $500 per extra site | $4,000 + $750 per extra site | Scoped |
| Data migration, one-time | $0 (self-serve CSV) | $1,500 | $3,500 (full migration, for example from Valant) | Scoped |

How the seats and fees work:

- **Prescriber seats** are for psychiatrists, NPs and physicians. They include DrFirst Rcopia e-prescribing, EPCS and PDMP.
- **Clinician seats** are for therapists and counselors.
- **Program staff seats** are for PRP specialists, case managers, peer support, medical assistants and crisis staff.
- **Support staff** (front desk, billing, HR, office manager, director, admin) are free and unlimited.
- **Annual billing** saves 15% on every recurring price.
- **Volume discount on seat charges:** 5% at 25 or more providers and 10% at 50 or more. "Providers" means prescribers plus clinicians.

**Add-ons and usage**

| Item | Price |
|---|---|
| AI Scribe | $149 per scribe user per month ($127 annual), on every tier. Includes 2,500 minutes of session audio per scribe user per month, pooled across the organization. Pasted text doesn't count toward the minutes. Overage is $0.08 per minute. Runs on standard Amazon Transcribe with a behavioral-health vocabulary by default; a practice can choose Transcribe Medical. The 30-day trial includes 300 minutes per organization. |
| Claims above the allowance | $0.30 per claim. Each claim includes its 270/271 eligibility check, 276/277 status checks and 835 ERA posting. |
| Full billing service (RCM) | **Not offered publicly for now** (decision 2026-10-20: Altrixs has no billing staff yet). Hidden from the pricing page and the quote calculator; the FAQ says "available on request". Kept in code behind `NEXT_PUBLIC_BILLING_SERVICE_OFFERED` at 5% of net collections, minimum $750 per month, Professional and above. |
| Card processing for client payments | Passed through at the processor's rate |

**Why this shape (industry standard)**

- **Per provider per month, with support staff free.** This is the norm across the market:
  - TherapyNotes Group, Tebra and SimplePractice Plus all give non-clinical users free [P/3P].
  - SimplePractice charges $39 for a practice manager who has no clinical role [P].
- **Prescribers priced higher.** ICANotes charges $213 for its Prescribing seat against $75 for Non-Prescribing, with eRx included [P]. AdvancedMD prices "mid-level and higher" providers [P].
  - **Recommendation:** bundle eRx/EPCS into the prescriber seat instead of selling a separate add-on. This avoids a double premium, and every prescriber needs it.
  - The prescriber premium is $150–$170 over a clinician seat. It covers the DrFirst pass-through (about $69 per month [EST]) plus the medication-management workload (more visits, more claims, PDMP, labs).
- **Paraprofessional seats.** No competitor publishes a separate paraprofessional price; the research found none. Two things point to a low seat price:
  - They bill fewer, lower-rate services: Maryland PRP is a monthly case rate under H2017/COMAR.
  - Their cost to us is about $16 per month [EST].
  - **Recommendation:** a low-price seat, rather than free (which gives away margin at programs with many staff) or a full clinician seat (which would block PRP-heavy customers).
- **Usage included up to a fair-use allowance, then charged per claim.** Competitors charge per claim from the first one, which looks like nickel-and-diming:
  - SimplePractice: $0.39 per claim from 2026-10-01 [P].
  - TherapyNotes: $0.14 per claim plus $0.14 per ERA [3P].
  - Upheal: $0.30 per claim [P].

  A pooled allowance looks better to customers and still protects the margin at high claim volumes.
- **Locations.** No vendor was found charging per location; the closest is Tebra's $500 PDMP charge per facility [P]. So locations are included, with a cap only on the cheaper tiers.
- **Onboarding and migration.** Small-practice vendors charge $0. Mid-market vendors charge in the thousands:
  - AdvancedMD: setup $0–$1,000; migration $800–$2,000 for practice-management data; EHR migration quoted [P].
  - Valant: $5k–$15k implementation [EST].
  - Netsmart: about $100k [EST].

  The Clinic fees sit at the low end of the mid-market.

## 2. Research: competitor list prices

| Vendor | List price | Staff | eRx | Claims | Other | Source |
|---|---|---|---|---|---|---|
| SimplePractice [P] | Starter $49, Essential $79, Plus $99 (+$74 per added practitioner; 6+ custom) | Biller, scheduler and supervisor free; practice manager $39 | $49/month + $89 setup | $0.39/claim from 2026-10-01 | Note Taker AI $35; Care Aide $59/$49 | simplepractice.com/pricing; support.simplepractice.com/hc/en-us/articles/48468642804237 |
| TherapyNotes [3P] | Solo $69; Group $79 + $50 per added clinician | Non-clinical free on Group | $65/prescriber | $0.14 claim, $0.14 ERA, $0.14 eligibility | TherapyFuel AI $40; telehealth $15 | schedulingkit.com/pricing-guides/therapynotes-pricing (updated 2026-10-02) |
| Ensora / TheraNest [3P] | $29 / $59 / $89 per therapist (annual $27 / $54 / $82) | Admin free | $45 + $135 setup | Unlimited on Premier | Telehealth $12 | softwarefinder.com/emr-software/theranest/pricing; ensorahealth.com/pricing |
| ICANotes [P] | Notes-only $55, Non-prescribing $75, Prescribing $213 (eRx included, $99 activation) | First staff user free, then $25 each | Included | "Varies" | AI Scribe $49; telehealth $20; 3-month minimum | icanotes.com/pricing |
| AdvancedMD [P] | $130–$399 per provider | Provider = mid-level and up | EPCS about $35 | $0.87–$2.17/claim | Setup $0–$1,000; migration $800–$2,000; RCM 4–8% | advancedmd.com/prices |
| Valant [EST] | $100–$300 per provider, or "about $300 per user" | — | — | — | Implementation $5k–$15k, migration $2k–$10k (ITQlick) | ehrsource.com/vendors/valant (Feb 2026); itqlick.com/valant-ehr/pricing |
| Tebra [EST] | $149–$499 per provider; reported $99 non-physician / $199 physician | Non-clinical free [P] | EPCS $75 one-time [P] | Lower tier for 100 or fewer claims/month | PDMP $500 per facility + $50 per user per year [P]; AI notes $99 for 400 notes | tebra.com/pricing; costbench.com/software/ehr-emr/tebra |
| Qualifacts InSync / CareLogic [EST] | From $75 / from $100 per user | Per user | — | — | Implementation extra | capterra.com/p/144484; selecthub.com/ehr-software/carelogic |
| Netsmart myAvatar [EST] | $500–$1,500 per user per year | Per user | — | — | About $100k onboarding | itqlick.com/netsmart-myavatar-suite/pricing |
| Healthie [P] | Group $149+, then $50 per clinician | Free support account per clinician | DoseSpot $40 | ClaimMD $25–$30/month | | gethealthie.com/pricing |
| Office Ally [3P] | Practice Mate free; EHR 24/7 about $44.95 per provider | | | Free to participating payers | | gethealthie.com/blog/office-ally-ehr-surcharge-non-par-payer |
| Credible, myEvolv, CentralReach | [Q] / not relevant | | | | CentralReach is ABA/IDD, $50–$250 per user [EST] | |

### AI scribes

| Product | Price |
|---|---|
| Inside an EHR | $35–$49 per clinician: SimplePractice $35 [P], TherapyNotes $40 [3P], ICANotes $49 [P]. Tebra $99 for 400 notes [P]. |
| Standalone, therapy-focused | Upheal $39 flat [P]; Mentalyc $19.99–$119.99 solo, $59.99 per team seat [P]; Freed $39–$119 [P] |
| Ambient for physicians | Dragon Copilot (DAX) about $150–$160 per user [3P/EST, list price cut May 2026]; Abridge $208–$600 [EST]; Nabla about $119 [EST]; Eleos [Q] |

### Billing service (RCM)

- AdvancedMD: 4–8% of collections [P].
- Behavioral health: 4–8% of net collections [3P] (bluebrix.health, 2026).
- General market: 4–10% [3P] (carepatron.com, 2026).
- Before comparing quotes, check whether each one is a percentage of gross charges or of net collections.

## 3. Research: vendor pass-through costs

| Cost | Figure | Source |
|---|---|---|
| DrFirst Rcopia + EPCS | About $60 per prescriber per month [EST, historical; DrFirst is quote-only]. A reseller (NewOrg) charges $100 [3P]. | rfp.wiki/vendors/drfirst; neworg.com/rcopia |
| EPCS token | $96–$232 per prescriber every 2 years (IdenTrust) [3P/EST] | officeemr.knowledgeowl.com |
| PDMP | **Assumption (decision 2026-10-20): Maryland CRISP PDMP access through DrFirst is included in the DrFirst estimate**, so the model carries $0 for PDMP. If that proves wrong: Bamboo Gateway about $50 per provider per year in Maryland [3P/EST]; CRISP in-EHR PDMP reported free [3P]. | support.intakeq.com (now 404); intuitionlabs.ai |
| Waystar | Quote-only [Q]. A reseller charged $0.11/claim, $0.04/ERA and $0.14/eligibility in 2024 [3P/EST]. One G2 reviewer pays $87.50 per provider [3P/EST]. | sticomputer.com (now 404); g2.com |
| Other clearinghouses | Claim.MD $120/month unlimited [P]; Office Ally free to participating payers [3P] | claim.md/pricing |
| Chime SDK | $0.0017 per attendee-minute [P] | aws.amazon.com/chime/chime-sdk/pricing |
| Transcribe Medical | $0.075/min [P] | aws.amazon.com/transcribe/pricing |
| Standard Transcribe streaming (AI Scribe default) | $0.024/min tier 1 [P], the conservative case used in the model. Tiered list rates (US East, per account per month): $0.024 for the first 250,000 min, $0.015 for the next 750,000, $0.0102 for the next 4M, $0.006 above 5M. 250,000 min is about 100 scribe users. Custom vocabularies cost nothing extra. A reading of the current page suggests lower rates, unverified. | aws.amazon.com/transcribe/pricing |
| HealthScribe | About $0.10/min [P] | aws.amazon.com/healthscribe/pricing |
| Bedrock Claude | Sonnet 4.5 $3/$15 and Haiku 4.5 $1/$5 per million input/output tokens [P, Anthropic list; Bedrock usually matches] | claude.com/pricing |
| Comprehend Medical | $0.01 per 100-character unit (NERe) [P] | aws.amazon.com/comprehend/medical/pricing |
| SMS | About $0.0083 per message including carrier fee [EST]; 10DLC $4.50 + $10/month campaign [P] | aws.amazon.com/end-user-messaging/pricing |
| SES | $0.10 per 1,000 emails [P] | aws.amazon.com/ses/pricing |

### COGS per seat per month (estimate)

These come from `costModel.ts`.

**Assumptions:**

- **Clinician:** 25 sessions a week of 50 minutes (108 a month), 30% by telehealth.
- **Prescriber:** 40 visits a week of 25 minutes (173 a month).
- **Program staff:** 60 contacts a month, about 15 claims.
- **AI insights:** a Haiku call per visit, 20 Sonnet calls a month, coding assist on 30% of notes.
- **Clearinghouse:** reseller rates.
- **Hosting:** $8 per seat (estimate).
- **Support:** $8–$10 per seat (estimate).
- **Card processing:** 2.9% on top.

| Seat | COGS | Of which pass-through (clearinghouse + eRx) |
|---|---|---|
| Prescriber | $128.87 | $95.73 |
| Clinician | $48.46 | $19.58 |
| Program staff | $15.83 | $3.75 |
| Support (free) | $4.00 | — |

The DrFirst ($60 + $5 EPCS token) and Waystar figures are still **estimates**. **TODO (owner):** send the
DrFirst and Waystar contract pricing; then replace them in `costModel.ts` (marked `TODO(owner contracts)`),
re-run `scripts/pricing-quotes.ts` and update this document.

**AI Scribe COGS per scribe user** (2,400 ambient minutes a month plus 65 Sonnet note drafts):

| Engine | COGS per scribe user |
|---|---|
| **Standard Transcribe (default from 2026-10-20)** | **$62** ($64 at the full 2,500-minute allowance) |
| Transcribe Medical (practice option) | $184 |
| HealthScribe (not used) | $240 |

**AI Scribe margin per scribe user** (standard Transcribe, tier-1 rate for every minute):

| | Monthly $149 | Annual $127 |
|---|---|---|
| Before card processing, 2,400 min | 58% | 51% |
| After 2.9% card processing, 2,400 min | 55.5% | 48.3% |
| After card processing, full 2,500 min | 53.9% | 46.4% |
| Same on Transcribe Medical, 2,400 min | -27% | -48% |

- The 50% scribe target is met on monthly billing in every case, and on annual billing before processing.
  An annual scribe user who uses the whole allowance lands at about 46-48% after processing.
- Above 250,000 account minutes a month (about 100 scribe users), the tier-2 rate ($0.015) adds roughly
  5-7 points of margin.
- Overage at $0.08 per minute is about 70% margin on standard Transcribe.
- A practice that switches to Transcribe Medical makes its scribe line lose money at $149. The setting
  says "higher cost"; if several practices choose it, price a Medical-engine scribe separately.

**Margin targets:**

- **Software only:** 70% or more. Clearinghouse and eRx are treated as resold at cost. The pure-SaaS benchmark is 75–80%.
- **Blended subscription on Professional and Clinic:** 55% or more.
- **AI Scribe line:** 50% or more (met on standard Transcribe; see above).

The blended target is lower than pure SaaS because roughly 40% of a prescriber seat is passed through to DrFirst and Waystar.

## 4. Worked quotes

### MD Behavioral Health (Clinic tier)

**Staff mix is assumed.** The database was not reachable from this session. Run `npx tsx scripts/billing-seat-report.ts` against the real database to replace it.

- **Assumed staff (33):**
  - 14 therapists (clinician seats).
  - 7 prescribers: psychiatrists, psych NPs, the primary-care physician and the medical NP.
  - 7 program staff: PRP, case management, peer support, medical assistant.
  - 5 support staff (free).
- **Locations:** 3 (Bowie, Silver Spring, Baltimore).
- **Claims:** about 2,100 per month (470 visits a week plus PRP), well under the 5,600 allowance.
- **AI Scribe:** assumed for 10 users.

| | Monthly billing | Annual billing |
|---|---|---|
| Prescriber seats 7 × $349 / $297 | $2,443 | $2,079 |
| Clinician seats 14 × $179 / $152 | $2,506 | $2,128 |
| Program staff 7 × $59 / $50 | $413 | $350 |
| **Platform per month** | **$5,362** | **$4,557** |
| AI Scribe 10 × $149 / $127 | $1,490 | $1,270 |
| **Total per month** | **$6,852** | **$5,827** |
| Per year | $82,224 | $69,924 |
| One-time | $9,000: onboarding $4,000, 2 extra sites $1,500, Valant migration $3,500 | same |

| COGS and margin (per month) | Platform only | With AI Scribe on standard Transcribe (default) | With AI Scribe on Transcribe Medical (practice option) |
|---|---|---|---|
| Monthly billing | $1,897, **65% gross margin** (software-only 79%) | $2,560, 63% | $3,784, 45% |
| Annual billing | $1,873, 59% (software-only 75%) | $2,530, 57% | $3,754, 36% |

MD Behavioral Health stays comped (decision 2026-10-20), so this is the list-price value the comp represents. The real cost of the comp to Altrixs is the COGS: about $1.9k per month for the platform, plus about $62 per scribe user per month on standard Transcribe.

### Typical small practice (3 therapists, 1 NP, 1 front desk; 1 site; about 500 claims a month)

**Tier:** Starter.

| Billing | Seats | Claim overage | Total |
|---|---|---|---|
| Monthly | $546 | $90 (300 claims over the 200 allowance) | **$636** |
| Annual | $464 | $90 | **$554** |

- **One-time:** $0.
- **Gross margin:** 42% monthly and 34% annual (software-only 61% / 52%).
- **With 2 AI Scribe users:** add $298 per month (monthly billing).

Starter is below the margin target by design: it's the entry tier, and claims dominate its cost.

### Mid-size (12 therapists, 3 prescribers, 4 support; 2 sites; about 1,850 claims a month)

**Tier:** Professional.

| Billing | Total per month |
|---|---|
| Monthly | **$2,565** |
| Annual | **$2,178** ($26,136 a year) |

- **One-time:** $3,500 (onboarding $1,500, 1 extra site $500, migration $1,500).
- **Gross margin:** 58% monthly and 51% annual (software-only 73% / 67%).
- **With 6 AI Scribe users:** add $894 per month.

## 5. Comparison for the same practice sizes (monthly, without AI)

| Practice | **Altrixs (approved)** | SimplePractice | TherapyNotes | ICANotes | Ensora | AdvancedMD | Valant [EST] |
|---|---|---|---|---|---|---|---|
| Small: 3 therapists + 1 NP, about 500 claims | **$636**, claims and eRx included | About $565: $99 + 3 × $74 + $49 eRx + 500 × $0.39 [P] | About $434: $79 + 3 × $50 + $65 eRx + 500 × $0.28 [3P] | About $518 + claims: 3 × $75 + $213 + $80 telehealth [P] | About $401: 4 × $89 + $45 eRx [3P] | $520–$1,596 + $0.87–$2.17 per claim [P] | $400–$1,200 |
| Mid: 12 therapists + 3 prescribers, 2 sites | **$2,565** | About $2,000 if Plus pricing held (6+ is custom) [P] | About $1,490 [3P] | About $1,840 + claims [P] | About $1,470 [3P] | $1,950–$5,985 + claims [P] | $1,500–$4,500 |
| MD Behavioral Health: 21 providers + 7 program staff, 3 sites, PRP and primary care | **$5,362** | Not built for PRP, residential or primary care | About $2,120, no PRP or primary care [3P] | About $3,490 + claims [P] | — | $2,730–$8,380 + $1.8k–$4.6k claims [P] | $2,100–$8,400 |

**Reading the comparison:**

- **Above therapy-only tools.** For therapy-only groups, Altrixs costs about 10–75% more than SimplePractice, TherapyNotes and Ensora.
- **In the mid-market band for psychiatry, multi-site and program clinics.** Here Altrixs is priced alongside Valant, AdvancedMD and Qualifacts. Those are the customers it is built for: e-prescribing, primary care, PRP and residential programs, and Waystar billing in one product.
- **What Altrixs includes that competitors charge extra for:** claims within the allowance, eRx, telehealth and multiple sites.

## 6. Pricing page wording (plain language)

> **Pay for the people who see clients. Front desk, billing and HR are free.**
> One monthly price per provider, by role. Prescriber seats include e-prescribing with controlled substances. Every plan includes scheduling, notes, telehealth, the client portal, eligibility checks and electronic claims. 30-day free trial, no card required.
>
> - **Prescribers** (psychiatrists, nurse practitioners, physicians): from $249 a month, e-prescribing included.
> - **Clinicians** (therapists, counselors): from $99 a month.
> - **Program staff** (PRP, case management, peer support, medical assistants): from $39 a month.
> - **Support staff**: always free.
>
> Each seat includes a monthly allowance of claims, and each claim includes eligibility, status checks and remittance posting. Above the allowance, claims are $0.30 each. Pay yearly and save 15%. Larger organizations get volume discounts.

The live wording is rendered from `SEAT_RULE`, `CLAIMS_RULE` and `PRICING_FAQ` in `plans.ts`.

## 7. Decisions (approved by the owner 2026-10-20, via chat)

1. **Prices approved as proposed:** seat prices, tiers, minimums, claims allowances, one-time fees, the 15%
   annual discount, volume steps (5% at 25+ providers, 10% at 50+) and Enterprise at 75+ providers.
   The Starter clinician seat stays $99. Program-staff seats $39 / $49 / $59 are approved. The Clinic support
   SLA (99.5% monthly uptime target, 4-business-hour response on urgent tickets) is approved.
2. **AI Scribe economics:** the default engine is now standard Amazon Transcribe streaming (HIPAA-eligible
   under the AWS BAA) with a behavioral-health custom vocabulary (`altrixs-behavioral-health`, set through
   `SCRIBE_TRANSCRIBE_VOCABULARY`). Transcribe Medical is a per-practice setting. The price stays $149 per user
   per month ($127 annual) with 2,500 pooled minutes per user and $0.08 per minute overage. Margins are in
   section 3; engine details are in `docs/ai-scribe.md`.
3. **Vendor costs:** the DrFirst and Waystar estimates stay, labelled [EST], until the owner sends the
   contracts. There is a TODO in `costModel.ts` and in section 3.
4. **PDMP:** assumed that Maryland CRISP PDMP access through DrFirst is included in the DrFirst estimate
   ($0 PDMP line). Revisit with the DrFirst contract.
5. **Full billing service (5% of collections):** hidden from the pricing page and the quote calculator; the
   FAQ says "available on request". Kept in code behind `NEXT_PUBLIC_BILLING_SERVICE_OFFERED=true`, to be
   turned on only when Altrixs has billing staff.
6. **Trial:** AI Scribe is capped at 300 minutes of live session audio per organization during the 30-day
   trial, enforced in the capture and metering path with a clear message (`docs/ai-scribe.md`).
7. **Going live:** pricing is marked approved in code (`PRICING_APPROVAL`). The "Proposed pricing" notice and
   the "proposed, not billed" labels are removed when `NEXT_PUBLIC_PRICING_APPROVED=true`. Order:
   1. Run `scripts/stripe-sync-catalog.ts --apply` with a **test** key and set the printed env vars on staging.
   2. Test checkout.
   3. Run `--apply --live` (the script still refuses live keys without `--live`). The owner runs the sync.
   4. Set `NEXT_PUBLIC_PRICING_APPROVED=true` and rebuild (it is inlined at build time).
8. **MD Behavioral Health** stays comped; nothing is billed.

Still open, for later: whether to price a separate Medical-engine scribe if practices choose Transcribe
Medical. Starter's margin is accepted as the entry tier.

## 8. Where it is implemented

| Piece | File |
|---|---|
| Tiers, seat types, role mapping, add-ons, rules, quote math | `src/lib/billing/plans.ts` |
| Seat counting (active users only; highest role wins) | `src/lib/billing/seats.ts`, `countOrgSeats` / `countOrgLocations` in `entitlementsServer.ts` |
| Entitlements | `src/lib/billing/entitlements.ts`. MD Behavioral Health stays comped. |
| COGS model | `src/lib/billing/costModel.ts` |
| Stripe catalog (32 prices, 20 products, 2 coupons, 2 meters) | `src/lib/stripe/catalog.ts` (definitions only) |
| Stripe sync | `scripts/stripe-sync-catalog.ts`. Dry run by default. `--apply` needs `STRIPE_SECRET_KEY`. Live keys are refused without `--live`. Owner approval is required before any live run. |
| Checkout line items, plan change, seat sync | `src/lib/stripe/lineItems.ts`, `src/lib/stripe/checkout.ts` |
| Pricing page and quote calculator | `src/components/marketing/PricingSection.tsx`, `PricingPlans.tsx` (`publicAddOnOrder()` hides the billing service), `QuoteCalculator.tsx` |
| Admin "Your plan" estimate (`estimateLabel()`: "proposed, not billed" until live) | `src/app/dashboard/subscription/page.tsx` |
| AI Scribe engine setting and trial cap | `src/lib/scribe/settings.ts`, `transcribeUrl.ts`, `chimeTranscription.ts`, `eventStream.ts`, `trialCap.ts`; `docs/ai-scribe.md` |
| Reports | `scripts/pricing-quotes.ts` (this document's numbers); `scripts/billing-seat-report.ts` (real seat counts, read-only) |
