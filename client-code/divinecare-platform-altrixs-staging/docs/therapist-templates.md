# Therapist / counselor templates

Requested by the clinical director (Lisa Willis, LCPC-S). The four templates she listed, named exactly as she listed them:

| Template (as listed) | Note-type key | Code(s) | Valant alias(es) recorded (unconfirmed) |
|---|---|---|---|
| MD Therapy Adult & Child Intake | `Therapy Intake` | 90791 | MD Therapy Adult & Child Intake; MD Therapy Adult and Child Intake; MD Health - Therapy Adult & Child Intake; Therapy Intake — Adult & Child |
| Substance Abuse Intake | `Substance Abuse Intake` | 90791 | Substance Abuse Intake; Substance Use Intake; MD Health - Substance Abuse Intake; SUD Intake |
| Therapy Progress Adult & Child | `Therapy Progress` | 90832 / 90834 / 90837 (family 90846 / 90847) | Therapy Progress Adult & Child; Therapy Progress Note — Adult & Child; MD Health - Therapy Progress Note; Therapy Progress Note |
| Treatment Plan | TreatmentPlan record (not a progress note) | — | OMHC Individual Treatment Plan; OMHC Individual Treatment Plan Review |

We have no Valant access. The structure comes from the clinic's own Word forms (`2013 Intake Note`, `Progress Note - Therapy`, `2013 Progress Note`, `OMHC Individual Treatment Plan`, `OMHC Individual Treatment Plan Review`, the New Patient and Re-Evaluation SOPs) plus standard outpatient practice where the forms say nothing. In the tables below, `form` means the field is on a clinic form and `std` means standard practice. Alias names in `normalizeNoteType` cover the likely Valant titles; the exact titles still need checking against Valant screenshots.

Code: `src/lib/ehr/therapy/` (sections, templates, engine, rules, blockers, widgets, planTemplate, planStore), editor `src/components/notes/TherapyNoteEditor.tsx`, plan editor `src/components/therapy/TherapyPlanEditor.tsx` (`/dashboard/ehr/treatment-plans/therapy`), portal page `/patient/documents`. Tests: `tests/therapist-templates.test.ts`.

## How the templates are simpler than the Word forms

- **Chips and pick-lists replace free text** wherever the answer is a category: referral source, symptoms, substance use status, living situation, risk level, level of care, frequency, interventions, goal progress, discharge goals.
- **Conditional sections.**
  - Child & Adolescent History (guardians, custody, consent, school, IEP/504, milestones) appears only when the client is under 18, based on the chart DOB and the date of service.
  - Telehealth location and consent appear only for telehealth visits.
  - Trauma types appear only when trauma is endorsed.
  - The C-SSRS screener appears only when suicidal ideation is endorsed.
- **Carried in from the chart, labeled with its source:** demographics, provider, location, medications and allergies (DrFirst-synced items marked), chart diagnoses, the saved safety plan, and AUDIT / DAST / CAGE-AID scores. Nothing clinical is pre-selected.
- **Carried forward between documents:**
  - Intake history sections offer "Bring forward from <date>" from the prior note of the same template, marked for review.
  - The intake pre-fills the treatment plan: diagnoses, initial goals in the client's words, strengths, presenting problem and recommended frequency.
  - The progress note pulls the goals from the active plan.
  - A plan review copies the current plan's goals with progress reset.
- **Only billing and compliance items block signing.** These are marked `*` in the tables. Everything else is a "check before signing" reminder (r).
- **AI drafting** is available for the HPI (intakes) and the interval history (progress note) through the existing scribe. It needs the client's AI consent, and the draft carries the AI DRAFT marker, which blocks signing until it is removed.
- **Psychotherapy code from session time.** The clinician enters start and end time. The rule is 16–37 min = 90832, 38–52 = 90834, 53+ = 90837; family therapy (26+ min) is 90847 with the patient present and 90846 without. Under 16 min is not billable. The rule is shown on screen. The clinician can override the code, but needs a reason to sign.

## Workflow rules (enforced on the server)

| Rule | Where it is enforced |
|---|---|
| **A treatment plan is required after intake.** Signing a therapist intake shows "Next: the treatment plan" with a link to the plan editor, pre-filled from that intake. | Notes page (prompt). The plan pre-fill comes from `loadPlanEditorContext` in `planStore.ts`. |
| **No progress note is signed without a treatment plan.** Signing any note coded 90832 / 90834 / 90837 / 90846 / 90847, or any Therapy Progress note, needs an active plan for the client. Drafts always save. Crisis (90839 / 90840) and intake (90791 / 90792) are never blocked. The error says why and links to Treatment Plans. | `updateProgressNoteWorkflow` in `src/lib/notes/workflow-store.ts`, on the new-signature path only. It covers the notes page, the note view and Scribe sign-and-lock. The rules are in `treatmentPlanGate` in `rules.ts`. The note view and the editor show the same reason to the author, supervisors and admins. |
| **What "active" means.** The status is ACTIVE or NEEDS_REVIEW, the review date has not passed, the clinician has signed, and the supervisor has signed when the author is pre-licensed. Plans imported from Valant count as signed (their signatures are in Valant). | `planActivity` in `rules.ts` |
| **Signature order.** The clinician signs and the plan is sent to the client portal right away (Awaiting patient signature). The patient then signs (typed name, plus parent / guardian for a minor) or declines with a reason. A declined plan can be re-sent. Telehealth verbal consent can be recorded instead, per the clinic ITP form. | `applyPlanSignatureAction` and `patientRespond` in `planStore.ts`. Routes: `POST /api/ehr/treatment-plans/[id]/signatures` and `POST /api/patient/documents/[id]/respond`. Transitions are in `patientSignatureTransition`. |
| **Supervisor signature only for pre-licensed authors.** The author's license level is decided when the clinician signs. An HR setting wins. Otherwise the author counts as pre-licensed if they are a supervisee on a licensure track (HR › Supervision), or if their credential is LGPC / LMSW / LGSW / LGMFT / LGADC / ADT / trainee / intern. Only the designated supervisor or a co-sign-authority role (admin, director, practice director, psychiatrist) can sign, and never the author. | `resolveLicenseLevel` (`rules.ts`), `loadLicenseLevel` / `applyPlanSignatureAction` (`planStore.ts`). HR sets the level in HR › Credentialing › License level. |
| **The same rule applies to notes.** Note co-signature is now required for pre-licensed authors as well as the existing roles (PRP, case manager, peer) and licensure-track supervisees. | `cosignRequiredFor(role, onTrack, preLicensed)` (`src/lib/notes/transitions.ts`), called from `workflow-store.ts` |
| **Signed plans are read-only.** "Reopen for edits" clears every signature and returns the plan to draft. A Treatment Plan Review creates a new plan, and the old plan closes when the review becomes active. | `updateTreatmentPlan` (409 on content edits to a signed plan) and `saveTemplatePlanDraft`; `closeSuperseded` |
| **Switches.** "Treatment plan required" defaults ON. "Patient signature makes the plan active" defaults OFF. Leadership can change both. | `GET/PUT /api/ehr/therapy-workflow` (stored in ClinicModuleState `therapy-workflow`); the card is on the Treatment Plans page |
| **Review date.** Defaults to 3 months for a child and 6 months for an adult, per the clinic ITP form. The adult value comes from Practice Settings `treatmentPlanReviewDays` (default 180). The server accepts up to 365 days. | `defaultReviewDays`; `reviewDateOk` in `planStore.ts` |
| **42 CFR Part 2.** A Substance Abuse Intake is saved Part 2 protected (`ProgressNote.part2`, through `isSudNote`). It is excluded from carry-forward into other notes. The disclosure-consent status and the Part 2 notice are required fields. | `noteTemplates.ts` `isSudNote`; template |

## Schema

Migration `prisma/migrations/20261018_therapist_templates_plan_signatures.sql` is additive and idempotent:

- **New `TreatmentPlan` columns:**
  - `planKind`, `supersedesId`, `sourceNoteId`, `signedSnapshot`
  - `clinicianSigned{At,ById,ByName}`
  - `supervisorRequired`, `supervisorSigned{At,ById,ByName}`, `supervisorComment`
  - `patientSignatureStatus`, `patientSentAt`, `patientSignedAt`, `patientSignedName`, `patientDeclinedAt`, `patientDeclineReason`, `patientVerbalBy`
  - index `(clientId, patientSignatureStatus)`
- **New `User` column:** `licenseLevel` (`LICENSED` | `PRE_LICENSED` | null = derived).
- **Template values** are stored in `TreatmentPlan.goals.template`, so a draft reopens exactly as it was left.
- **The signed snapshot** is the text the patient sees and signs.

## Needs Lisa's confirmation

1. **Patient signature and "active".** Lisa's note implies the patient's signature is part of the plan. The build makes the plan active once the clinician has signed (and the supervisor, for pre-licensed authors), so progress notes are not held up waiting on the portal. The patient's signature is sent and tracked. The setting "Patient signature makes the plan active" turns it into a requirement. Which does she want?
2. **Exact Valant template titles,** so the aliases match imported note types. The section order also needs checking against Valant screenshots of all four templates. The **Substance Abuse Intake** has no clinic Word form, so it is built entirely from standard practice: substance table, withdrawal / overdose, treatment history, AUDIT / DAST-10 / CAGE-AID, ASAM 6 dimensions, Part 2.
3. **Review interval.** The clinic form says 3 months for a child and 6 months for an adult. Confirm this against the COMAR 10.63 program rules and the Maryland Medicaid / PBHS authorization periods. Note that the older Treatment Plans form still limits its own review date to 90 days.
4. **License list.** Pre-licensed is LGPC, LMSW, LGSW, LGMFT, LGADC, ADT, trainee / intern / supervisee. Licensed is LCPC, LCSW-C, LCSW, LCMFT, LCADC, psychologist, psychiatrist, NP. HR can override per person. Confirm the list, and whether LMSWs who do therapy at the clinic are always supervised.
5. **Which codes need a plan.** The block covers 90832 / 90834 / 90837 / 90846 / 90847 on any note type. Crisis and intake are exempt. Should group therapy (90853) or H-codes also need a plan?
6. **Minor consent options.** "Minor (16+) self-consent — Md. Health-Gen. §20-104" is offered. Confirm the wording and age the clinic uses.
7. **ASAM suggestion.** The level-of-care hint comes from the highest dimension rating and is labeled decision support only. Confirm she wants it shown.
8. **What is required to sign on intakes.** Required: presenting problem, the substance screen items (alcohol, cannabis, other drugs), MSE, SI / HI, overall risk, diagnosis, level of care, and frequency. Confirm this is the right minimum for 10–15 minute completion.
9. **Existing plans.** Plans created on the old Treatment Plans page before this change have no clinician signature, so they do not satisfy the progress-note block until they are signed. Plans can be signed from the plan view. Valant-imported plans count as signed.

## Fields by template

`*` = required to sign · (r) = shown under "Check before signing" · `form` = on a clinic form · `std` = standard practice

### MD Therapy Adult & Child Intake (key `Therapy Intake`, 90791)

| # | Section | Fields |
|---|---|---|
| 1 | Session | Session — session header: chart demographics, visit type/POS, start-end time, code `form`<br>Persons present (r) — text `form`<br>Patient location during telehealth ***** — text; only when telehealth `std`<br>Telehealth consent ***** — pick one; only when telehealth `form` |
| 2 | Referral & Presenting Problem | Referral source (r) — pick one `form`<br>Reason for referral — text `std`<br>Presenting problem (client’s words) ***** — textarea `form` |
| 3 | History of Present Illness | Current symptoms (r) — chips `std`<br>Onset — pick one `std`<br>History of present illness — textarea `form` |
| 4 | Psychiatric History | Prior outpatient treatment — Denies / Endorses / Not assessed `form`<br>Psychiatric hospitalizations — Denies / Endorses / Not assessed `form`<br>Previous diagnoses — text `form`<br>Past psychotropic medications — text `form`<br>Self-harm / suicide attempts (r) — Denies / Endorses / Not assessed `form` |
| 5 | Substance Use Screen | Alcohol ***** — pick one `form`<br>Cannabis ***** — pick one `form`<br>Tobacco / nicotine — pick one `form`<br>Other drugs / misuse of prescriptions ***** — pick one `form`<br>Details — text `form`<br>Follow-up — pick one `std` |
| 6 | Medical History & Medications | Medications & allergies — chart / DrFirst meds & allergies `form`<br>Medical conditions — text `form`<br>Primary care provider — text `std` |
| 7 | Trauma & Abuse History | Trauma / abuse history (r) — Denies / Endorses / Not assessed `form`<br>Type — chips; only when traumaHx = Endorses `std`<br>Current abuse / neglect concerns — Denies / Endorses / Not assessed `std`<br>Mandated report ***** — pick one; only when currentAbuse = Endorses `std` |
| 8 | Family & Social History | Family mental health / substance history — text `form`<br>Lives with (r) — chips `form`<br>Relationship status — pick one; only when 18+ `form`<br>Employment — pick one; only when 18+ `form`<br>Supports — chips `std`<br>Cultural / spiritual considerations — text `std`<br>Social history — text `form` |
| 9 | Child & Adolescent History (under 18 only) | Parent(s) / guardian(s) ***** — chips `std`<br>Legal custody ***** — pick one `std`<br>Consent for treatment given by ***** — pick one `std`<br>School — text `form`<br>Grade — pick one `form`<br>IEP / 504 — pick one `form`<br>School concerns — chips `form`<br>Developmental milestones — pick one `form`<br>Pregnancy / birth complications — Denies / Endorses / Not assessed `form`<br>Developmental / academic notes — text `form` |
| 10 | Legal History | Legal involvement — Denies / Endorses / Not assessed `form`<br>Involvement — chips; only when legalHx = Endorses `std` |
| 11 | Strengths & Barriers | Strengths (r) — chips `form`<br>Barriers to treatment — chips `std` |
| 12 | Mental Status Exam | Mental status exam ***** — MSE widget `form` |
| 13 | Risk Assessment | Suicidal ideation ***** — Denies / Endorses / Not assessed `form`<br>Homicidal ideation ***** — Denies / Endorses / Not assessed `form`<br>Current self-harm — Denies / Endorses / Not assessed `std`<br>C-SSRS screener ***** — C-SSRS screener; only when si = Endorses `std`<br>Overall risk level ***** — pick one `std`<br>Risk formulation (r) — text; only when riskLevel = Moderate / High `std`<br>Safety plan — Stanley-Brown safety plan (pull saved plan) `std` |
| 14 | Diagnostic Impressions | Diagnoses ***** — ICD-10 picker (chart diagnoses pre-loaded) `form`<br>Clinical formulation (r) — textarea `form` |
| 15 | Recommendations & Level of Care | Recommended level of care ***** — pick one `std`<br>Recommended session frequency ***** — pick one `std`<br>Planned modalities — chips `std`<br>Referrals — chips `form`<br>Treatment plan (r) — pick one `std`<br>Other recommendations — text `form` |
| 16 | Initial Treatment Goals | Initial goals (r) — rows `std` |
| 17 | Review | Sign-blockers, check-before-signing list, attestation, Save & Sign / Save draft |

### Substance Abuse Intake (key `Substance Abuse Intake`, 90791)

| # | Section | Fields |
|---|---|---|
| 1 | Session | Session — session header: chart demographics, visit type/POS, start-end time, code `form`<br>Persons present (r) — text `form`<br>Patient location during telehealth ***** — text; only when telehealth `std`<br>Telehealth consent ***** — pick one; only when telehealth `form` |
| 2 | Referral & Presenting Problem | Referral source (r) — pick one `form`<br>Reason for referral — text `std`<br>Presenting problem (client’s words) ***** — textarea `form` |
| 3 | History of Present Illness | Current symptoms (r) — chips `std`<br>Onset — pick one `std`<br>History of present illness — textarea `form` |
| 4 | Substance Use History | Substances ***** — rows `std`<br>Primary substance of concern — text `std`<br>Consequences — chips `std` |
| 5 | Withdrawal & Overdose Risk | Withdrawal history ***** — Denies / Endorses / Not assessed `std`<br>Withdrawal symptoms — chips; only when withdrawalHx = Endorses `std`<br>Current withdrawal risk ***** — pick one `std`<br>Overdose history ***** — Denies / Endorses / Not assessed `std`<br>Naloxone — pick one `std` |
| 6 | Substance Use Treatment History | Prior SUD treatment — rows `std`<br>Longest period of abstinence — text `std` |
| 7 | Screening Scores | AUDIT score (0–40) — number `std`<br>DAST-10 score (0–10) — number `std`<br>CAGE-AID score (0–4) — number `std` |
| 8 | ASAM Dimensions | ASAM dimensions ***** — ASAM 6 dimensions rated 0–4 `std` |
| 9 | Psychiatric History | Prior outpatient treatment — Denies / Endorses / Not assessed `form`<br>Psychiatric hospitalizations — Denies / Endorses / Not assessed `form`<br>Previous diagnoses — text `form`<br>Past psychotropic medications — text `form`<br>Self-harm / suicide attempts (r) — Denies / Endorses / Not assessed `form` |
| 10 | Medical History & Medications | Medications & allergies — chart / DrFirst meds & allergies `form`<br>Medical conditions — text `form`<br>Primary care provider — text `std` |
| 11 | Trauma & Abuse History | Trauma / abuse history (r) — Denies / Endorses / Not assessed `form`<br>Type — chips; only when traumaHx = Endorses `std`<br>Current abuse / neglect concerns — Denies / Endorses / Not assessed `std`<br>Mandated report ***** — pick one; only when currentAbuse = Endorses `std` |
| 12 | Family & Social History | Family mental health / substance history — text `form`<br>Lives with (r) — chips `form`<br>Relationship status — pick one; only when 18+ `form`<br>Employment — pick one; only when 18+ `form`<br>Supports — chips `std`<br>Cultural / spiritual considerations — text `std`<br>Social history — text `form` |
| 13 | Child & Adolescent History (under 18 only) | Parent(s) / guardian(s) ***** — chips `std`<br>Legal custody ***** — pick one `std`<br>Consent for treatment given by ***** — pick one `std`<br>School — text `form`<br>Grade — pick one `form`<br>IEP / 504 — pick one `form`<br>School concerns — chips `form`<br>Developmental milestones — pick one `form`<br>Pregnancy / birth complications — Denies / Endorses / Not assessed `form`<br>Developmental / academic notes — text `form` |
| 14 | Legal History | Legal involvement — Denies / Endorses / Not assessed `form`<br>Involvement — chips; only when legalHx = Endorses `std` |
| 15 | Strengths & Barriers | Strengths (r) — chips `form`<br>Barriers to treatment — chips `std` |
| 16 | Mental Status Exam | Mental status exam ***** — MSE widget `form` |
| 17 | Risk Assessment | Suicidal ideation ***** — Denies / Endorses / Not assessed `form`<br>Homicidal ideation ***** — Denies / Endorses / Not assessed `form`<br>Current self-harm — Denies / Endorses / Not assessed `std`<br>C-SSRS screener ***** — C-SSRS screener; only when si = Endorses `std`<br>Overall risk level ***** — pick one `std`<br>Risk formulation (r) — text; only when riskLevel = Moderate / High `std`<br>Safety plan — Stanley-Brown safety plan (pull saved plan) `std` |
| 18 | Diagnostic Impressions | Diagnoses ***** — ICD-10 picker (chart diagnoses pre-loaded) `form`<br>Clinical formulation (r) — textarea `form` |
| 19 | 42 CFR Part 2 Consent | Part 2 disclosure consent ***** — pick one `std`<br>Part 2 notice given to patient ***** — pick one `std` |
| 20 | Recommendations & Level of Care | Recommended level of care ***** — pick one `std`<br>Recommended session frequency ***** — pick one `std`<br>Planned modalities — chips `std`<br>Referrals — chips `form`<br>Treatment plan (r) — pick one `std`<br>Other recommendations — text `form` |
| 21 | Initial Treatment Goals | Initial goals (r) — rows `std` |
| 22 | Review | Sign-blockers, check-before-signing list, attestation, Save & Sign / Save draft |

### Therapy Progress Adult & Child (key `Therapy Progress`, 90832 / 90834 / 90837 / 90846 / 90847)

| # | Section | Fields |
|---|---|---|
| 1 | Session | Session — session header: chart demographics, visit type/POS, start-end time, code `form`<br>Persons present (r) — text `form`<br>Code override reason — text `std`<br>Patient location during telehealth ***** — text; only when telehealth `std`<br>Telehealth consent ***** — pick one; only when telehealth `form` |
| 2 | Treatment Plan Goals | Goal progress ***** — active plan goals + progress chips `form` |
| 3 | Target Symptoms & Interval History | Target symptoms since last session (r) — pick one `form`<br>Interval history ***** — textarea `form` |
| 4 | Interventions | Interventions used ***** — chips `form`<br>Intervention detail (r) — textarea `form` |
| 5 | Mental Status Exam | Mental status exam (r) — MSE widget `form` |
| 6 | Risk Check | Suicidal ideation ***** — Denies / Endorses / Not assessed `form`<br>Homicidal ideation ***** — Denies / Endorses / Not assessed `form`<br>Current self-harm — Denies / Endorses / Not assessed `std`<br>C-SSRS screener ***** — C-SSRS screener; only when si = Endorses `std`<br>Overall risk level ***** — pick one `std`<br>Risk formulation (r) — text; only when riskLevel = Moderate / High `std`<br>Safety plan — Stanley-Brown safety plan (pull saved plan) `std` |
| 7 | Response to Interventions | Engagement (r) — pick one `std`<br>Response to interventions ***** — textarea `form` |
| 8 | Impression | Impression — textarea `form` |
| 9 | Plan & Homework | Next session ***** — pick one `form`<br>Homework — text `std`<br>Plan — textarea `form` |
| 10 | Review | Sign-blockers, check-before-signing list, attestation, Save & Sign / Save draft |

### Treatment Plan (initial + review)

| # | Section | Fields |
|---|---|---|
| 1 | Plan Details | Plan type ***** — pick one `form`<br>Service setting ***** — pick one `form`<br>Verbal consent obtained for telehealth ***** — pick one; only when serviceSetting = Telehealth (video & audio) `form` |
| 2 | Diagnoses & Problems | Diagnoses ***** — ICD-10 picker (chart diagnoses pre-loaded) `form`<br>Changes in diagnoses at this time — pick one; only when planKind = Review `form`<br>Psychosocial problems — chips `form`<br>Presenting needs / problems ***** — textarea `form` |
| 3 | Strengths & Preferences | Strengths (as stated by client) ***** — textarea `form`<br>Abilities (as stated by client) — text `form`<br>Weaknesses / barriers (as stated by client) — text `form`<br>Client’s expectations / preferences for treatment — text `form`<br>Client’s responsibilities in recovery — text `form`<br>Progress since the last plan ***** — textarea; only when planKind = Review `form` |
| 4 | Goals & Objectives | Goals ***** — goal / objective (target date) / intervention editor `form` |
| 5 | Services & Frequency | Individual therapy frequency ***** — pick one `form`<br>Services this authorization period — rows `form`<br>Level of care — pick one `std` |
| 6 | Discharge & Transition Plan | Discharge / recovery goals ***** — chips `form`<br>Planned transition — pick one `form`<br>Anticipated transition date — date; only when dischargeAction answered `form`<br>Referrals / recommendations to other programs — text `form` |
| 7 | Next Review | Next plan review date ***** — date `form` |
| 8 | Client Participation | Client actively participated in planning ***** — pick one `form`<br>Caregiver participated in planning ***** — pick one; only when under 18 `form`<br>Client verbalized agreement with the plan — pick one `form`<br>Copy of plan explained and offered — pick one `form` |
