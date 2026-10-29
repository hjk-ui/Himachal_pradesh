# Altrixs pricing research and proposed tiers

> **Superseded (2026-10-20):** the recommended model is now v2 in `docs/pricing-model.md` (seat types by role, prescriber seats with e-prescribing, per-user AI Scribe, claims allowance). The competitor research below is still valid background.

**Status: PROPOSED. The owner has not approved these numbers.** Prices live in `src/lib/billing/plans.ts`.
Until `NEXT_PUBLIC_PRICING_APPROVED=true` is set, every pricing surface shows a "Proposed pricing" notice
and live-mode Stripe Checkout is refused (test mode still works).

Research date: **2026-10-17**. All sources were accessed on that date.

How each figure is labelled:

- **[P]** published on the vendor's own page
- **[3P]** a third party reporting a published price
- **[EST]** a third-party estimate for a vendor that only quotes
- **[Q]** quote-only; no public price

Most pages show no "last updated" date. Where a page gives one, it is noted.

---

## 1. Competitor pricing

### SimplePractice [P]

Plan prices: https://www.simplepractice.com/pricing/ (monthly only, no annual option).

| Item | Price |
|---|---|
| Starter | $49/mo, solo |
| Essential | $79/mo, solo |
| Plus | $99/mo for the first clinician, then $74 per additional clinician. 6+ clinicians are custom-priced. |
| Note Taker (AI) | $35/mo |
| Care Aide (AI bundle) | $59 for the owner, $49 per additional clinician |
| ePrescribe | $49 per prescriber per month, plus $89 one-time setup |
| Insurance claims | $0.39 per claim on all plans from 2026-10-01 |
| Card processing | 3.15% + $0.30 [3P]. Another source says 2.9% + $0.30; the sources conflict. |
| Trial | 30 days |

Sources for the claims fee and card rate:

- Claims fee: SimplePractice support article https://support.simplepractice.com/hc/en-us/articles/48468642804237-What-s-changing-with-insurance-pricing. Seen in a search snippet only; a direct fetch was refused.
- Card rate [3P]: https://www.therapyappointment.com/competitor-comparison/therapyappointment-vs-simplepractice

### TherapyNotes

- **Solo [P]:** $69/mo. It was $59 until 2025-12-01.
- **Group [P]:** $79 for the first clinician, then $50 per additional clinician. Schedulers, billers and admins are free and unlimited.
- **TherapyFuel (AI notes):** $40 per clinician per month.
- **Add-ons and fees [3P]:**
  - ePrescribe: $65 per prescriber per month.
  - E-claims: $0.14 per claim. ERA: $0.14.
  - Text and phone reminders: $0.14 each.
- **Terms [3P]:** 30-day trial, no card needed. Monthly only, no annual discount.
- **Sources:**
  - Plan prices: support article https://support.therapynotes.com/hc/en-us/articles/30661380110747-TherapyNotes-Pricing-and-Subscription-Options. Seen in a search snippet; a direct fetch was refused.
  - Add-on fees: https://practiceharbor.com/blog/therapynotes-pricing, dated 2026-07-19. Practice Harbor is a competing EHR.

### TheraNest / Ensora Mental Health [P]

Source: https://ensorahealth.com/pricing/theranest-mental-health/

Pricing is per therapist, not by number of active clients.

| Plan | Monthly | Annual (per month equivalent) | What it adds |
|---|---|---|---|
| Essentials | $29 | $27 | Telehealth is a +$12 add-on |
| Advanced | $59 | $54 | Telehealth. 50 claims, 50 eligibility checks and 50 reminders free per month |
| Premier | $89 | $82 | Unlimited claims, eligibility and reminders (fair use) |

- **Add-ons:**
  - AI (Ensai): $35 per provider per month.
  - eRx + PDMP: $45 per therapist per month, plus $135 setup.
  - Payments: 2.99% + $0.30.
- **Terms:**
  - Admin users are free.
  - No setup fee.
  - Annual billing saves about 8%.
  - 21-day trial.
- **RCM** (https://ensorahealth.com/pricing/rcm/): [Q], percentage not published.

### Valant [Q]

Valant publishes no prices.

- **ITQlick [EST]** (https://www.itqlick.com/valant-ehr/pricing, 2026-06-23):
  - About $300 per user per month.
  - Implementation $5k–$15k for small and mid-size practices, $20k–$50k for enterprise.
  - Data migration $2k–$10k on top.
  - The page contradicts itself in places, so treat these as rough.
- **EHRSource [EST]** (https://ehrsource.com/vendors/valant/, updated February 2026): $100–$300 per provider per month.

### Tebra (formerly Kareo) [Q]

Official page: https://www.tebra.com/pricing/

- **Published [P]:**
  - Bundles only, no prices shown.
  - Non-clinical staff are free.
  - EPCS setup about $75 per provider.
  - PDMP $500 per facility, plus about $50 per user per year.
- **Estimates [EST]** (https://costbench.com/software/ehr-emr/tebra/):
  - $99–$499 per provider per month.
  - AI notes $99 per provider per month for 400 notes.
  - Cards 2.75–3.25% + $0.30.

### ICANotes [P]

Source: https://www.icanotes.com/pricing/

| Plan | Full-time | Part-time |
|---|---|---|
| Notes Only | $55/mo | $35/mo |
| Non-Prescribing | $75/mo | $45/mo |
| Prescribing (eRx included) | $213/mo, plus $99 activation | $138/mo |

- **Add-ons:**
  - Telehealth: $20 per user per month.
  - AI Scribe: $49 per user per month.
- **Terms:** 3-month minimum commitment.

### Qualifacts (CareLogic / Credible / InSync) [Q]

- **Credible:** about $200 per user per month [EST] (https://www.itqlick.com/credible/pricing).
- **CareLogic:** not found.
- **Implementation fees:** not found.

### Netsmart (myAvatar / myEvolv) [Q]

- **myAvatar:** licensing based on average daily census. About $500–$1,500 per user per year, plus about $100k onboarding [EST] (https://www.itqlick.com/netsmart-myavatar-suite/pricing).
- **myEvolv:** about $300 per user per month [EST]. G2 lists no published pricing: https://www.g2.com/products/netsmart-myevolv/pricing

### Smaller vendors [P]

- **TherapyAppointment** (https://www.therapyappointment.com/pricing):
  - Group: $59, plus $39 per additional clinician.
  - Claims $0.15. eRx $65 per month plus $110 setup.
  - Cards 2.9% + $0.30.
  - 30-day trial.
- **Sessions Health** (https://www.sessionshealth.com/pricing):
  - $39 for the first practitioner, $29 per additional.
  - Claims $0.19–$0.25.
  - Reminders included.
  - 30-day trial.
- **Jane** (https://jane.app/pricing):
  - Plans $59–$99 per month.
  - AI Scribe $15.
  - No trial.

## 2. Add-on norms

| Add-on | Typical market price | Sources |
|---|---|---|
| E-prescribing with EPCS | $45–$65 per prescriber per month, plus $89–$135 setup | SimplePractice $49 [P]; TherapyNotes $65 [3P]; Ensora $45 [P]; TherapyAppointment $65 [P]; Rcopia reseller $100 [P] (https://neworg.com/rcopia); DrFirst list price [Q] (about $60 [EST], https://www.rfp.wiki/vendors/drfirst) |
| Telehealth | Usually included; otherwise $10–$20 per clinician per month | Sessions, Ensora, TherapyAppointment, ICANotes [P] |
| AI scribe inside an EHR | $35–$49 per clinician per month | SimplePractice $35, TherapyNotes $40, Ensora $35, ICANotes $49 [P]. Standalone tools: Upheal $39, Mentalyc $14.99–$119.99, Freed $39–$119 (https://www.upheal.io/pricing, https://www.mentalyc.com/pricing, https://www.getfreed.ai/pricing) |
| RCM / billing service | 3.5–5% of collections for lean services; 5–8% for full service | Carepatron article 2026-06-17 (https://www.carepatron.com/blog/how-much-do-medical-billing-services-cost); Practolytics 3.49–4.99% with a $750 minimum (https://practolytics.com/behavioral-health-tech-conference-2026/). No authoritative behavioral-health-specific benchmark was found. |
| Card processing | 2.9% + $0.30 (Stripe list price); EHRs charge 2.9–3.15% + $0.30 | https://stripe.com/pricing |
| Text reminders | Included, or $0.04–$0.14 per message | Sessions and TherapyAppointment include them; TherapyNotes $0.14 [3P] |
| Claims and clearinghouse | $0.14–$0.39 per claim when the EHR charges for it | Waystar direct pricing [Q] (estimates: https://www.verifytx.com/waystar-pricing/; a reseller lists $0.11 per claim) |
| Onboarding / migration | $0 for small-practice self-serve; thousands of dollars for mid-market; $20k–$100k+ for enterprise [EST] | Ensora "no setup fees" [P]; Valant and Netsmart [EST] above |
| Trial | 30 days is the norm (range 7–30) | SimplePractice, TherapyNotes, TherapyAppointment, Sessions |
| Annual discount | Often none for small-practice EHRs; 8–25% where offered | Ensora about 8%; Mentalyc 14–25% |

## 3. Market synthesis

- **Solo:** most vendors charge $50–$80 per month. Claims fees, AI and eRx add $40–$120 per month on top.
- **Group:** the first clinician is $59–$99, then $29–$74 per additional clinician. For 5 clinicians that works out to about $56 per clinician (TherapyNotes) and about $79 (SimplePractice Plus). Most vendors hand off to sales at about 6+ clinicians.
- **Mid-market psychiatry and behavioral health** (Valant, Tebra): $100–$500 per provider per month [EST], plus implementation fees in the thousands.
- **Enterprise / CCBHC class** (Qualifacts, Netsmart): quote-only. About $200–$300 per user per month [EST], or census-based licensing, plus $20k–$100k+ implementation.
- **Seat counting:** almost every vendor charges per clinician and gives non-clinical staff free.
- **Usage fees:** claims, eligibility and SMS are usually metered on top of the seat price.

## 4. Proposed Altrixs tiers (owner approval required)

The basis for each choice:

- **Per-clinician pricing** is the market norm.
- **No per-claim, eligibility or reminder fees.** This sets Altrixs apart from vendors that charge $0.14–$0.39 per claim. Confirm Altrixs's own Waystar per-claim cost first (see §6).
- **AI Scribe is included on Clinic.** The market charges $35–$49 for it separately, so bundling it supports the Clinic price.
- **E-prescribing is an add-on at the market rate.**
- **Annual billing saves about 15%.** This is above the small-practice norm and in line with the higher end of the market.
- **30-day trial,** which matches the market.

| Tier | Monthly | Annual (per month) | Seats | Onboarding | For |
|---|---|---|---|---|---|
| **Starter** | $69 | $59 | 1 clinician (max) | $0, self-guided | Solo private practice |
| **Professional** | $79 per clinician | $67 | Minimum 2 | $499, optional | Group practices |
| **Clinic** | $129 per clinician | $109 | Minimum 5 | $2,500, optional | Multi-location clinics and programs (PRP, residential, AOT) |
| **Enterprise** | Quote | Quote | Usually 25+ | Quoted | CCBHCs and health systems |

| Add-on | Monthly | Annual (per month) | Unit | Tiers |
|---|---|---|---|---|
| E-prescribing with EPCS (DrFirst Rcopia) | $59 | $50 | Per prescriber | All tiers. Volume pricing on Enterprise. |
| AI Scribe | $39 | $33 | Per licensed clinician, bought for every seat | Starter and Professional. Included on Clinic and Enterprise. |

What a typical clinic would pay:

| Scenario | Altrixs (proposed) | Comparison |
|---|---|---|
| Solo therapist | $69 per month | SimplePractice Essential $79, TherapyNotes Solo $69 |
| 5-therapist group | $395 per month | SimplePractice Plus $395, TherapyNotes Group $279 (both plus claim fees) |
| 10 clinicians with 2 prescribers on Clinic | 10 × $129 + 2 × $59 = $1,408 per month, AI Scribe included | Valant is about $2,500 per month for 10 users [EST] |

### Feature matrix

The full matrix, with plain-language explanations and the screen each feature lives on, is `FEATURES` in `src/lib/billing/plans.ts`. It is shown on `/pricing`, in the homepage `#pricing` section and on `/dashboard/subscription`.

- **Every tier includes:**
  - Notes and templates
  - Treatment plans
  - Assessments and measurement-based care
  - Telehealth
  - Scheduling and online booking
  - The client portal
  - Email and text reminders (fair use)
  - Secure messaging
  - Eligibility checks
  - Electronic claims and ERA through Waystar
  - Client payments
  - Superbills and statements
  - Audit log and role-based permissions
  - A signed BAA
- **Professional adds:**
  - Claim scrubber, denials and prior authorizations
  - Front-desk and multi-clinician calendar
  - Supervision and co-signature
  - Practice reports
  - Staff credentialing and HR
- **Clinic adds:**
  - Multiple locations
  - PRP, residential and AOT program tools
  - 42 CFR Part 2 tools
  - QI, incidents and grievances
  - Population health and SDOH
  - AI Scribe included
  - Priority support and an uptime target
- **Enterprise adds:**
  - Custom integrations and data exports
  - A contractual SLA
  - A dedicated success manager

### Rules

These are plain-language strings in `plans.ts`, rendered verbatim in the product.

- **Seats.**
  - Every active licensed clinician is a seat: therapist, psychiatrist, NP, physician or clinician.
  - Front desk, billing, HR, office manager, director and admin accounts are free.
  - PRP specialists, case managers, peer support and crisis staff are free on Clinic and Enterprise, and count as seats on Starter and Professional.
  - Invited and deactivated users do not count.
- **Overage.**
  - With seat sync on (`BILLING_SEAT_SYNC=true`), extra seats are added and prorated by Stripe.
  - With seat sync off, extra seats are trued up at renewal.
  - The seat count never drops below the tier minimum.
- **Trial.**
  - 30 days on the chosen tier, AI Scribe included, no card needed.
  - If the clinic subscribes during the trial, the remaining trial days carry into the Stripe trial, so the first charge falls on the trial end date.
  - If the trial ends without a subscription, the account becomes read-only. Clinics can still view and export records. Nothing is deleted.
- **Failed payments (dunning).**
  - Stripe retries the card, and the clinic sees a warning banner.
  - Full access continues for 14 days. After that the account becomes read-only until the balance is paid.
- **Cancellation.**
  - Access continues to the end of the paid period, then the account becomes read-only.
  - Data is kept for at least 90 days and can be exported.

## 5. What the owner must approve

1. **Tier prices:** $69, $79 and $129 per seat per month, and the annual equivalents of $59, $67 and $109.
2. **Seat minimums:** 2 on Professional, 5 on Clinic.
3. **Add-on prices:** e-prescribing $59 (annual $50) and AI Scribe $39 (annual $33).
4. **Onboarding fees:** Professional $499 and Clinic $2,500, both optional at checkout. The small-practice market norm is $0.
5. **Trial and dunning terms:** 30-day trial without a card, 14-day grace period after a failed payment, and 90-day data retention after cancellation.
6. **No per-claim, eligibility or SMS fees.** First confirm the Waystar contract cost per claim and the SMS cost per message (AWS End User Messaging), so the fair-use margin holds.
7. **Seat rule for program staff:** free on Clinic, seats on Starter and Professional.
8. **Clinic support terms:** whether to promise a 99.5% uptime target and a 4-business-hour response on urgent tickets. A Clinic SLA should not be published until operations can meet it.
9. **Sales contact address:** `support@altrixs.com`, the only address already published on `/support`. Replace it with a dedicated sales address if one exists.
10. **Turning pricing on:** after approval, set `NEXT_PUBLIC_PRICING_APPROVED=true` and rebuild.

## 6. Open items and gaps

These were not found in the research:

- DrFirst EPCS identity-proofing and token pricing
- Qualifacts implementation fees
- An authoritative behavioral-health RCM percentage benchmark
- TherapyNotes card processing rate

These are inputs the owner should supply:

- Waystar per-claim and ERA cost to Altrixs
- The DrFirst per-prescriber wholesale cost
- The Bedrock cost per AI Scribe note, to confirm the $39 add-on margin and the Clinic bundle margin
