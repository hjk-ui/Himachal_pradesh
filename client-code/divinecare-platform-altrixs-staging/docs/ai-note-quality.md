# Note quality check before co-sign

A checklist shown to the supervisor before co-signing a note, and to the author as a pre-sign checklist. **Suggestions only:** nothing blocks signing or co-signing, nothing edits the note, and the supervisor decides. A signed note is corrected by its author with an addendum. Addenda count toward the checks when the note is checked again.

## Where it shows

| Place | Mode | What the user can do |
|---|---|---|
| **EHR > Supervisor Review** (`/dashboard/ehr/supervisor-review`), detail pane under the supervisor comment | `cosign` | Re-run the checks, run the AI narrative check, **Return to author** (the checklist and the comment are attached), or **Co-sign anyway** / **Co-sign with checklist** (co-signs like the existing button and records the findings and the comment). The existing Co-sign buttons are unchanged. |
| **EHR > Progress Notes** (`/dashboard/ehr/notes`), note detail dialog | `presign` | The author sees the checklist before pressing Sign. On a signed note the author also sees the supervisor's returned checklist and whether an addendum has been added since. Hidden for anyone who is not the author. |

## Code

- `src/lib/ai/noteQuality/types.ts`: item / report types (shared with the browser).
- `src/lib/ai/noteQuality/rules.ts`: deterministic checks (pure).
- `src/lib/ai/noteQuality/narrative.ts`: minimal text for the model, prompt, grounding, rule fallback (pure).
- `src/lib/ai/noteQuality/engine.ts`: rules first, then the AI gate, audit and fallback (no Prisma or Bedrock import; injected).
- `src/lib/ai/noteQuality/load.ts`: reads the note, signature, claims, plan gate, risk flags, credentials, practice settings, consent and Part 2 status.
- `src/lib/ai/noteQuality/access.ts`: who may run it.
- `src/lib/ai/noteQuality/reviewStore.ts`: `NoteQualityReview` table (created on first use) for returns and co-signs with findings.
- `POST /api/notes/[id]/quality-check` `{ mode: 'cosign' | 'presign', ai: boolean }` returns the report.
- `POST /api/notes/[id]/quality-check/review` `{ action: 'return' | 'cosign', comment?, findings }`.
- UI: `src/components/ai/NoteQualityPanel.tsx`. Tests: `tests/ai-note-quality.test.ts`.

## Deterministic checks (always run first)

Statuses are pass, warn ("check"), fail ("fix") and n/a. Every warn or fail item has a one-line fix.

| Check | Rule | Status when it is not met |
|---|---|---|
| Template required items | Therapist templates: the required fields of the template (`missingFields`, the same rule the editor uses). Psychiatry templates: their sign rules. Free-text formats (SOAP, DAP, BIRP …): every section has text. | fail (template), warn (free text) |
| Format required elements | Section formats (SOAP, DAP, BIRP, GIRP, PIRP, PIE, CBT, DBT, MFT, EMDR, Crisis, SUD, Intake, Psych Eval, Med Mgmt, PRP, Peer Support, Discharge): the required sections, an SI / HI screen and functional status (`src/lib/notes/formatElements.ts`; the same rule blocks signing through `noteTypeIssues`) | fail |
| Recommended items | Template items marked recommended (e.g. MSE, engagement) | warn |
| Placeholders | `[___]` blanks or AI DRAFT markers left in the note | fail |
| Service code | A CPT code is on the note | fail |
| Start / end vs duration | The minutes between start and end time agree with the recorded duration (2 min tolerance) | fail. Duration without start / end is a warn. |
| 90832 / 90834 / 90837 | Midpoint time rule: 16–37 / 38–52 / 53+ min, under 16 min not billable | fail, or warn when a code override reason is written |
| 90846 / 90847 | At least 26 min. 90847 = patient present, 90846 = without (read from the session type) | fail |
| 90791 / 90792 | Not time-based. 90792 (with medical services) only by a physician / NP role. No psychotherapy add-on with an evaluation. | fail |
| 90839 | At least 30 min of crisis psychotherapy | fail |
| +90840 | Add-on to 90839, from 75 min; units = each additional 30 min beyond 74 (75–104 → 1, 105–134 → 2). 90839 at 75+ min without +90840 is a missed unit. | fail (under 75 min / without 90839), warn (missed unit) |
| E/M + add-on 90833 / 90836 / 90838 | The primary code is an E/M (99202–99215). Psychotherapy time is documented separately ("Psychotherapy time: N min"). The add-on matches that time (16–37 / 38–52 / 53+). Psychotherapy time is less than the total visit time. | fail |
| Telehealth POS | POS 02 or 10 when the visit is telehealth | fail |
| Telehealth modifier | The practice default modifier (Practice Settings > Billing, 95 / GT / none) on the claim line or note | fail once a claim exists, warn before |
| Patient location | "Patient location during telehealth" (or stated in the narrative) | fail |
| Telehealth consent | "Telehealth consent" (or verbal / written consent in the narrative) | fail |
| Visit type mismatch | In-person note with a telehealth POS or modifier | warn |
| Diagnosis documented | ICD-10 in the note, or on the chart / active treatment plan | fail |
| Diagnosis on the claim | The linked claim has ICD-10 codes, and they match the documentation | fail (no code), warn (does not match), n/a (no claim yet) |
| Active treatment plan | Therapy progress notes and psychotherapy codes: the existing plan gate (`checkTreatmentPlanGate`) | fail. Warn if the plan could not be checked. |
| Plan goal addressed | Progress is marked on at least one plan goal (Treatment Plan Goals section) | fail. Warn if goals are only mentioned in the narrative. |
| Risk assessment | When the chart has risk flags (client risk level High, a high-severity risk alert or a safety-flagged assessment in the 30 days before the visit, or risk language in a linked AI Scribe transcript), the note documents SI / HI screening and a risk level or safety plan | fail; warn when the only flag is the transcript and the clinician recorded the risk attestation (the sign path enforces the transcript gate itself: src/lib/scribe/riskGate.ts) |
| Person-first language | Stigmatizing terms (noncompliant, refused, addict / abuser / alcoholic, clean / dirty UDS, "suffers from"; manipulative, attention-seeking, drug-seeking, frequent flyer, malingering) with the suggested wording (`src/lib/scribe/stigma.ts`) | warn |
| Cloned section | Each section vs the same section of the client's last 3 signed notes (3-word shingles, Jaccard > 0.8, sections of 15+ words): "This section is very similar to the note on <date>" (`src/lib/notes/aiEvidence.ts`) | warn |
| Author signature | Signed with attestation (co-sign mode) | fail |
| Author credentials | A license / credential in HR > Credentialing valid on the date of service | fail (expired), warn (none on file) |
| Signed on time | Signature time (or now, for a draft) minus the session end (date of service + end time on the practice clock, else end of day) is within Practice Settings `noteSignDeadlineHours` | warn |
| Co-signature | States why a co-signature is required: pre-licensed (HR setting, credential or supervision track) or a role in `COSIGN_REQUIRED_ROLES` | information |

## AI narrative checks (optional)

The panel runs the rule checks when it opens. **AI narrative check** runs four checks with Bedrock **Haiku** (`src/lib/ai/bedrockService.ts`, temperature 0, JSON):

1. Medical necessity: symptoms / functional impairment and the response to the intervention.
2. Interventions described.
3. Progress toward goals.
4. Plan for the next session.

Each check comes back as present, weak or missing. Present maps to pass. Weak and missing map to warn. AI never produces a fail.

### Guardrails

- **Minimal text.** Only the narrative sections and any addenda are sent. The Session / Header block, Review, medications, labs and the Part 2 consent section are removed. Lines such as Patient, DOB, MRN, Provider, location and contact details are removed. The client's and clinician's names (full name and each part) are replaced with `[client]` / `[clinician]`. Emails and phone numbers are masked. The text is capped at 6,000 characters.
- **Grounding.** For present or weak, the model must quote the note. A quote is kept only if it is an exact substring of the text that was sent (whitespace and smart quotes normalized, at least 8 characters). A finding with no verified quote is dropped and that check falls back to the rule heuristic. Unknown check ids are ignored.
- **AI consent and Part 2.** No AI runs on a Part 2 note: the note is flagged Part 2, it is a Substance Abuse Intake, or the client's protected record is classified Part 2. No AI runs if the client declined the "AI Note Drafting" consent. No AI runs if consent is missing and Practice Settings requires it (`aiNoteConsentRequired`, default on). In these cases nothing is sent, and an `AI_ACCESS` audit row is written with outcome `DENIED` and the reason.
- **Audit.** `AI_ACCESS` (SUCCESS) is written **before** text goes to the model, with ids, the model and counts only. `FAILURE` is written if the call errors. Every check run writes `NOTE_QUALITY_CHECK` with the counts. A return writes `NOTE_QUALITY_RETURN`. Co-sign from the panel writes `NOTE_COSIGN` (as the existing route does), plus the review id and the finding counts.
- **Fallback.** When Bedrock is not configured, errors, or replies with something that is not usable JSON, the four checks use the rule heuristic. Therapist templates use their sections (interval history + response, interventions used, goal progress, next session). Free text uses keywords. Each item is labelled as a rule check, with the reason.
- **Never auto-edits.** No route writes the progress note. Returns and co-signs with findings go into `NoteQualityReview`. The comment also goes into the existing `supervisorComment`.

## Access

- `cosign` mode: a role that can open Supervisor Review **and** either co-sign authority (`COSIGN_AUTHORITY_ROLES`) or being the author's designated licensure-track supervisor. Never the note's author.
- `presign` mode: only the note's author (same rule as signing).
- Both modes: the note must be in the user's organization, and sensitive (protected) clients need PHI access (`assertClientPhiAccess`: whitelist or break-the-glass).

## "Return to author"

There was no existing return workflow. A signed note cannot be reopened, by design (`noteTransition`). Return to author therefore records the checklist and the comment against the note. The note stays in the co-sign queue. The author sees the returned checklist on the note in Progress Notes and fixes it with an addendum. The supervisor sees "N addenda added since" and re-runs the check, which includes the addenda.

## Documentation sources

The rules follow these sources. Check current versions before an audit, because payer manuals change.

- **CMS: psychotherapy documentation and time.**
  - CMS LCD L34616 *Psychiatric Codes* and its billing and coding article A57130. These cover required elements of psychotherapy notes, the time rules, the add-on with E/M (psychotherapy time separate from the E/M), 90791 / 90792 and 90846 / 90847.
  - CMS Medicare Benefit Policy Manual, Pub. 100-02, Ch. 15 §160 / §170 (clinical psychologist and clinical social worker services).
  - CPT time convention: a unit of time is attained when the midpoint is passed (CPT Professional, Psychiatry guidelines).
- **CMS: medical necessity and the treatment plan.**
  - CMS MLN booklet *Medicare & Mental Health Coverage* (MLN1986542).
  - LCD L34616 "Documentation Requirements": an individualized treatment plan, goals, the interventions used, and progress toward goals.
- **CMS: signatures.**
  - Medicare Program Integrity Manual, Pub. 100-08, Ch. 3 §3.3.2.4 (signature requirements).
  - MLN fact sheet *Complying with Medicare Signature Requirements* (MLN905364).
- **CMS: telehealth.**
  - MLN booklet *Telehealth Services* (MLN901705).
  - CMS Medicare telehealth FAQ / PFS final rule: POS 02 vs 10, modifier 95, the patient's location.
- **Maryland Medicaid / Optum Maryland PBHS.**
  - COMAR 10.63 (Community-Based Behavioral Health Programs and Services, including OMHC requirements). Covers treatment plan and progress note content, signatures and credentials.
  - COMAR 10.09.59 (Specialty Mental Health Services, Medicaid).
  - COMAR 10.09.49 (Telehealth Services): patient location, consent, and audio-video vs audio-only.
  - Optum Maryland Public Behavioral Health System *Provider Manual* (documentation requirements, medical necessity criteria, authorizations) and Optum Maryland provider alerts on telehealth billing (POS / modifier).
  - Maryland Department of Health Medicaid telehealth program guidance / transmittals.
- **42 CFR Part 2** (§2.12, §2.32 redisclosure). This is why Part 2 notes are never sent to the model.
- **Practice policy**: Practice Settings > Clinical (`noteSignDeadlineHours`, `cosignRequiredRoles`, `aiNoteConsentRequired`) and Billing (`telehealthModifierDefault`).
