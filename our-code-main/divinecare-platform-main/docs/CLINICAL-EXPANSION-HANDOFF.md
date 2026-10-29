# Clinical expansion delivery

Implemented in the local project on September 10, 2026. Deployment has not been performed.

## Client-ready update

The five requested clinical expansion updates have been implemented:

- **Service Eligibility Scanner:** PRP, Spravato, TMS and AOT screening preview; eight fictional patients; service summary cards; patient/diagnosis search; service/status filtering; expandable criteria panels; referral, missing-data, care-plan and documentation draft actions; rescan animation and timestamp; legal and REMS notices.
- **Progress Notes:** 17 note types with tailored section templates and structured detail views; a shared 30-code CPT/HCPCS selector; telehealth modifier 95 and POS 02/10; SUD/chemical-dependency confidentiality marking and Part 2 notices in creation and detail views. Saved billing selections are used by the existing claim-draft flow.
- **Billing:** a searchable library of 30 CPT/HCPCS codes, 15 modifiers and 10 places of service, plus an ERA & Payments preview tab with payer/EFT details, payment totals, claim counts, CARC adjustments, discrepancy review and simulated posting.
- **Treatment Plans:** nine plan types; 43 diagnoses in ten groups; level of care and ASAM selections; frequency and duration; care coordination and treatment barriers; six editable practice templates; care detail cards and persisted goal-completion checkboxes.
- **Navigation and permissions:** the scanner appears under EHR for Therapist, Psychiatrist, NP, Case Manager and Practice Director. Billing and HR cannot access it through either navigation or the direct route.

Existing routes and database tables are retained. New note and treatment-plan fields use the existing storage and authenticated API flows. Notes and treatment plans include an explicit Demo Preview mode for demonstrations without creating real chart records.

## Demonstration

1. Use one of the five permitted roles and open **EHR → Service Eligibility Scanner**. Click a service card to show eligible patients, change the status filter, expand a patient and try the service tabs. Action buttons save reviewable drafts into the preview activity list. Rescanning updates the timestamp; sample eligibility outcomes stay deterministic.
2. Open **EHR → Progress Notes → Demo Preview**. Create a note, choose its format and billing code, enable telehealth/SUD flags, fill the sections, save and view it. Attest before signing in the detail view, then lock the sample note.
3. Open **EHR → Treatment Plans → Demo Preview → New Treatment Plan**. Choose **Use Practice Library Template**, select a patient, edit the care fields, create the plan, mark a goal complete and reopen Edit Plan to verify the values.
4. Open **Billing → CPT Codes** for the expanded library. Open **ERA & Payments**, filter Discrepancy, view the Aetna sample, enter a reconciliation note, resolve it and simulate posting.

## Persistence and scope

- Live note metadata extends the existing `<!--ehr ...-->` body header. Older headers and plain-text notes remain readable. The API exposes the new billing/telehealth/Part 2 fields separately from the clean narrative.
- Live treatment-plan care fields are stored in the existing goals JSON envelope under `clinicalDetails`. Create, fetch and update preserve them, including when only goal completion is changed. Missing fields on older records display as unspecified. No database migration is required.
- The scanner is a deterministic demonstration of the requested screening workflow. It does not run an external AI model, determine actual treatment eligibility, write patient charts, or book real assessments.
- ERA data, discrepancy resolution and posting are simulated. No clearinghouse connection, 835 file ingestion, real ledger posting or money movement was added.
- Demo note/plan edits last for the current page session and reset on reload. Preview patient links are hidden so fictional IDs do not open real chart routes. Live Goal Bank templates remain in live mode.
- Modifier/POS values are retained with the note; this change does not add modifier/POS fields to the existing Claim database table or implement claim transmission.
- Existing fee defaults remain intact. New library entries do not introduce invented reimbursement rates.
- The repository maps Practice Director to `DIRECTOR`; the scanner uses the exact five requested active roles. Clinic Admin can use the existing role switcher to preview an allowed role.

## Validation

- `npm run build`: passed, including Next.js compilation, TypeScript and route generation.
- `npm run typecheck`: passed.
- `npm test`: 129 tests passed, including new catalog, metadata, claim-code selection, API persistence, tenant-boundary and role-access coverage.
- `npm run test:e2e:clinical`: four browser scenarios passed using installed Chrome, actual page components and mocked APIs. Covered creation, filters, tabs, modals, signing/locking, care-field edits, goal completion, reconciliation/posting and 390px mobile overflow checks. Screenshots were captured and visually reviewed.
- Scoped ESLint checks for the clinical expansion source passed. The repository-wide lint command still reports pre-existing issues in unrelated modules, including render-time date calculations in alerts, client details, compliance, safety plans and training, and React rules in community/PR pages.
- Browser tests use a loopback-only harness with framework-shell mocks. They do not constitute production authentication, live-database or clearinghouse end-to-end testing. API persistence tests use mocked database operations.

## Reference wording

The requested AOT citation is retained with clarification: §10-632 concerns involuntary admission hearings; AOT provisions are in Subtitle 6A. See [Maryland AOT guidance](https://health.maryland.gov/bha/Pages/Assisted-Outpatient-Treatment.aspx) and [Maryland Health-General §10-6A-01](https://mgaleg.maryland.gov/mgawebsite/Laws/StatuteText?article=ghg&enactments=false&section=10-6A-01).

The Spravato notice distinguishes REMS enrollment from JANSSEN CAREPATH access support and specifies observation for at least two hours. See [official SPRAVATO REMS requirements](https://www.spravatorems.com/).

SUD confidentiality notices link to [HHS Part 2 guidance](https://www.hhs.gov/hipaa/part-2/index.html). These notices provide workflow reminders; they do not implement a new consent-management or disclosure-enforcement engine.
