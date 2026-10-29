# Client workflow implementation

Source: Altrixs — Module Workflow Reference (2).pdf, 41 physical pages, v1.3.0.
Baseline: 82 regression tests passed before edits. Existing uncommitted DrFirst work is preserved.

## Accepted decisions

- DIRECTOR performs Office Manager duties (user confirmed).
- Follow appointment section: pending authorization allows booking with a warning; affected service/billing requires authorization checks. This reconciles the document's conflicting booking sentences.
- Keep Prisma/PostgreSQL. Introduce additive domain services and explicit validation instead of replacing working modules or seeding live data.
- Do not claim real DrFirst/Chime/transcription/clearinghouse execution from mocks. Approved vendor contracts and sandbox access remain necessary.

## Work sequence and completion ledger

1. In progress: shared persistence/access safeguards; SMS privacy; clinical deadline rules; assessment safety; monotonic note finalization.
2. Pending: immutable signed domain records, verified consent/signatures, exact appointment/claim linkage and outbox-driven follow-ups.
3. Pending: 29-module UI/action integration, analytics sourced from canonical records, operational evidence and role UAT.
4. Pending external inputs: vendor sandbox contracts/access and production infrastructure verification.
5. Pending: staging end-to-end acceptance, migration rehearsal, rollback validation and production deployment.

This ledger is not a statement that all PDF gaps are implemented. Production deployment and database migrations have not been performed.

## Verified implementation checkpoint — 2026-09-09

- `npm run typecheck`: passed. `npm test`: 97 passed, 0 failed (82 baseline plus 15 added checks, including the assessment route suite).
- Shared module saves serialize rapid edits, retain failed drafts, expose retry/errors and use conditional versions for updated callers. Unknown module names fail closed. Legacy unversioned callers remain compatible and do not yet receive concurrency protection.
- Assessment submission is server-scored for PHQ-9/GAD-7 and caseload scoped. Positive PHQ-9 item 9 creates a HIGH risk alert in the same transaction; retries are idempotent and changed retry payloads conflict. Tests use a transactional database substitute; no live database or browser clinical submission was performed.
- Other assessment instruments require clinician verification and interpretation. Patient self-administration, scheduled administration, alert escalation and complete instrument-specific workflows remain pending.
- Note status changes serialize on the note row, reject regressions and preserve signed content when locking. Automatic claims, addenda and the PDF's single finalization action remain pending. Database concurrency integration testing remains pending.
- Treatment plan create/review-date edits enforce the inclusive 90-day window. Signature and reminder workflows remain pending.
- Appointment confirmation SMS uses schedule/provider fields only, excluding service, diagnosis, client name and join link.
- Grievance UI captures actual receipt date, calculates 2/10 business-day deadlines, shows the active queue first and sorts by deadline. Holiday policy, server-enforced grievance lifecycle, letters, signed evidence and notifications remain pending. Existing historical deadlines are preserved.

These are specific implemented safeguards, not completion of seven modules or a percentage of the 29-module scope. End-to-end acceptance and deployment remain pending.

## Architecture boundaries

- UI gathers data and shows pending/saved/error states; it never establishes clinical truth with a success toast.
- Route authenticates and validates transport; domain service enforces roles, caseload, transitions and policies.
- Repository commits canonical record plus audit/outbox events atomically. Notification workers deliver only approved nonclinical templates with idempotency/retry evidence.
- Additive migrations must be rehearsed on an isolated database before deployment; no db push or demo seed on production.
- Maintain legacy readers during record migration, but do not invent signatures, certificates, clinical scores or delivery acknowledgments.
