# Compliance confirmations — 2026-10-21

The practice owner confirmed the Maryland / payer requirement items below on 2026-10-21. In the
Visit Guide they now show **"Confirmed by practice 2026-10-21"** instead of the "Confirm with
compliance" badge (`confirmedBy: 'Practice owner'`, `confirmedOn: '2026-10-21'` in
`src/lib/visits/requirements.ts`, list `OWNER_CONFIRMED_IDS`). Plain-language summaries for staff,
not legal text.

## Confirmed items and where they are enforced

| Requirement id | Item | Where it is enforced / shown |
|---|---|---|
| `md_pdmp` | Maryland PDMP (CRISP) query before starting an opioid or benzodiazepine, then every 90 days — Md. Code, Health-General **§21-2A-04.1** | Visit Guide due item `src/lib/visits/due.ts` (PDMP, 90-day interval); med-management step in `src/lib/visits/protocols.ts`; PDMP checkpoint `src/app/api/prescribing/pdmp-check/route.ts` and DrFirst PDMP trail `src/app/api/drfirst/pdmp-events/route.ts` (citation corrected from 04.2 to 04.1) |
| `md_epcs` | EPCS for controlled substances — Health-General §21-220 | Prescribing step `src/lib/visits/protocols.ts` (sent electronically through DrFirst EPCS) |
| `dea_telehealth` | DEA telemedicine prescribing of controlled substances | Same prescribing step (telehealth reminder) in `src/lib/visits/protocols.ts` |
| `minor_consent_md` | Maryland minor consent — Health-General §20-104 / §20-102(c) | Visit Guide due item `src/lib/visits/due.ts`; required consent rule `minor` in `src/lib/consents/library/requirements.ts` |
| `prp_comar` | PRP documentation and IRP review (COMAR 10.63.03, 10.09.59) | PRP protocol steps in `src/lib/visits/protocols.ts`; IRP interval from Practice Settings (`prpIrpReviewDays`) |
| `treatment_plan_review` | Treatment plan and periodic review (COMAR 10.63.03) | **One rule everywhere:** adults at most 180 days (Practice Settings `treatmentPlanReviewDays`, 30–180), under 18 at most 90 days — `src/lib/ehr/therapy/rules.ts` (`defaultReviewDays` / `maxReviewDays`), applied by the template editor (`src/lib/ehr/therapy/planStore.ts`) and the legacy API (`src/lib/ehr/treatmentPlans.ts`) through `src/lib/ehr/therapy/reviewInterval.ts`; settings validation `src/lib/practice/settings.ts` caps the adult value at 180; Visit Guide due item in `src/lib/visits/due.ts` |
| `spravato_rems` | Spravato REMS (observed dosing, 2-hour monitoring) | Spravato protocol steps in `src/lib/visits/protocols.ts` |
| `telehealth_consent_location` | Telehealth consent, patient location / state, modality; **audio-only** only with the patient's agreement and the payer's audio-only modifier (93 / FQ) where accepted (COMAR 10.09.49) | Visit Guide due item `src/lib/visits/due.ts`; telehealth steps in `src/lib/visits/protocols.ts`; required consent rule `telehealth` in `src/lib/consents/library/requirements.ts`; audio-only flag on the claim (`src/lib/billing/waystarClaimPrep.ts`) |
| `discharge_aftercare` | Discharge summary and aftercare plan | Discharge steps in `src/lib/visits/protocols.ts` (deadline: see open items) |
| `sdoh_screen` | Social needs screening at least yearly (AHC-HRSN) | Visit Guide due item `src/lib/visits/due.ts` (SDOH interval) |
| `tms_course` | TMS course documentation and prior authorization on file | TMS protocol steps in `src/lib/visits/protocols.ts` |
| `md_duty_to_warn` | Duty to warn / protect — Cts. & Jud. Proc. §5-609 | Reportable-concerns step in `src/lib/visits/protocols.ts` |
| `md_child_abuse_report` | Mandated report, suspected child abuse / neglect — Family Law §5-704; 42 CFR 2.12(c)(6) | Reportable-concerns step in `src/lib/visits/protocols.ts` |
| `md_vulnerable_adult_report` | Mandated report, vulnerable adult — Family Law §14-302 | Reportable-concerns step in `src/lib/visits/protocols.ts` |

PBHS / Carelon: the requirement catalog has no separate PBHS / Carelon item; the Medicaid parts of
`prp_comar` (COMAR 10.09.59) and `telehealth_consent_location` (COMAR 10.09.49, audio-only) are
covered by the confirmations above. The Carelon attestation workflow itself is unchanged.

Not confirmed (still show "Confirm with compliance"): `uspstf_screening`, `acip_immunization`,
`collaborative_care`.

## Inconsistencies resolved

1. **PDMP citation** — Health-General §21-2A-04.1 everywhere (the PDMP checkpoint and the DrFirst PDMP
   events route cited 04.2 and described "Schedule II-V"; both now use 04.1 and the opioid /
   benzodiazepine rule).
2. **Treatment plan review interval** — one rule (adults ≤ 180 days from Practice Settings, under 18
   ≤ 90 days). Before: the legacy treatment plan API capped every plan at 90 days and defaulted to 90;
   the template editor allowed up to 365 days; Practice Settings accepted up to 365.

## Open numeric items — the practice to supply

These have no number in the code and stay as they are until the practice gives the value:

1. **COMAR initial treatment plan deadline after intake** — the intake protocol step says "within the
   practice timeframe after intake" (`src/lib/visits/protocols.ts`, step `treatment_plan`); no number
   of days is enforced.
2. **Discharge summary deadline** — `discharge_aftercare` says "within the practice timeframe"; no
   number of days is enforced.
3. (Related, not part of the requirement catalog) **PBHS / Carelon authorization renewal lead time** —
   `src/lib/ai/authForecast/forecast.ts` uses the clinic default (14 days) with `verified: false`
   until it is checked against Chapter 5 of the Carelon Maryland PBHS Provider Manual.
