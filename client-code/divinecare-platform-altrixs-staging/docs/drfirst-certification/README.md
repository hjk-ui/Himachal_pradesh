# DrFirst Rcopia certification checklist (Altrixs)

Prepared 2026-10-20 on branch `staging/hardening`. Requirement IDs are DrFirst's (see
[requirements.md](requirements.md)). Evidence files are in [evidence/](evidence/): each holds one live
request / response pair captured against **DrFirst STAGING 201** on 2026-10-20 (15:08 and 15:39 UTC) with
DrFirst's own test patient (`maxpatient`, RcopiaID 27162725039) and test prescriber (`ssherman`), practice
`mb3385`. In the evidence, credentials, the vendor username, every demographic field, NPI and DEA are masked;
record ids, codes, drug names, statuses and dates are kept. Records created for the write-back checks were
deleted again in the same run. No prescription was sent to a pharmacy.

Regenerate the evidence with `scripts/capture-rcopia-certification.ts` (standalone, staging only).

> The live captures exercise the DrFirst side of each call. The Altrixs code changes in this branch
> (listed under "Fixes") are **not deployed yet** (staging runs 37e1eba); they are covered by unit tests on
> the same recorded responses (`tests/drfirst-certification.test.ts`, `tests/drfirst-chart-sync.test.ts`,
> `tests/drfirst-commands-v254.test.ts`).

## 1. The APIs the owner asked about

| API (DrFirst name) | Live result (staging 201) | Evidence | Altrixs status |
|---|---|---|---|
| `send_patient` | PASS: envelope `ok`, item `updated`, RcopiaID 27162725039 returned. Also PASS by RcopiaID only (chart linked to an existing Rcopia patient) | `send_patient.txt`, `send_patient_by_rcopia_id.txt` | Fixed: item status checked, only new / changed demographics sent, ID stored, placeholder phones dropped, HOMELESS / UNKNOWN address |
| `get_notification_count` | PASS: `ok`; types refill 0, rxchange 0, therapy_request 0, rx_pending 1, rx_need_signing 0, rx_orders_pending 0; with Return*IDs the pending item SB-61360164576 is listed with its owner `ssherman` | `get_notification_count.txt` (prescriber, with ids), `get_notification_count_practice.txt` | Fixed: badge keys were never matched (live keys are `rx_pending` / `rxchange`, the UI read `pending_prescription` / `refill` only); now per-prescriber, 15-minute throttle, all 4 counts shown |
| `update_prescription` | PASS: `ok`. Round-trip: sent `01/01/2026 00:00:00` -> got `10/20/2026 11:39:01`; sent that back -> 0 new rows, cursor `10/20/2026 11:39:01`. Without `<Status>` only the COMPLETED script comes back; `<Status>all</Status>` also returns the pending one | `update_prescription_1.txt` / `_2_cursor.txt`, `update_prescription_status_all_1.txt` / `_2_cursor.txt`, practice-wide `update_prescription_practice_*` | Fixed: sync now sends `Status=all` (pending scripts never reached the chart before), refreshes every field on re-download |
| `update_medication` | PASS: `ok`, 1 medication (Ativan 0.5 mg, sig "Take 1 tablet by mouth twice a day for anxiety", start 10/14, stop 10/30, linked to Rx SB-61358989377). Round-trip `01/01/2026 00:00:00` -> `10/20/2026 11:39:01` -> 0 new | `update_medication_1.txt` / `_2_cursor.txt`, `update_medication_practice_*`, `update_medication_after_send.txt` (our deleted test med comes back `Deleted=y`) | Fixed: nested `Prescription` / `Preparer` ids can no longer be read as the medication's; our own echoed meds are not copied back |
| `update_problem` (diagnoses) | PASS: `ok`, 3 problems (2 deleted ICD-10 F41.1 probes, 1 active ICD-9 300.0 entered in Rcopia). Round-trip `01/01/2026` -> `10/20/2026 11:39:01` -> 0 new. Both ways: `send_problem` F41.1 `created` (6132416311) -> visible in `update_problem` -> `send_problem Deleted=y` -> `deleted` | `update_problem_1.txt` / `_2_cursor.txt`, `send_problem.txt`, `update_problem_after_send.txt`, `send_problem_delete.txt` | Met; fixed: a diagnosis removed from the chart is now deleted in Rcopia, a changed description resent |
| `update_patient` | PASS: lookup by ExternalID returns the patient; practice-wide round-trip `10/01/2026 00:00:00` -> `10/20/2026 11:39:01` (10 patients) -> same cursor returns only maxpatient, which `send_patient` had just updated (the boundary is inclusive: idempotent upserts absorb it, nothing is skipped) | `update_patient_lookup.txt`, `update_patient_1.txt`, `update_patient_2_cursor.txt` | Met. Deleted in Rcopia -> review item; a chart linked to a different Rcopia patient -> link-conflict review item (merges). Optional under Single Patient Mode (PDDR1) |
| `update_allergy` (+ `send_allergy`) | PASS: `ok`, 3 allergies; round-trip `01/01/2026` -> `10/20/2026 11:39:01` -> 0 new. `send_allergy` Peanuts `created` (6184120311, with a `<Warning>` about the reaction's SNOMED match) -> `Deleted=y` -> `deleted` | `update_allergy_1.txt` / `_2_cursor.txt`, `send_allergy.txt`, `send_allergy_delete.txt`, `update_allergy_after_send.txt` | Fixed: `<Status><Inactive/></Status>` was not read (an allergy inactivated in Rcopia stayed Active in the chart); removed chart allergies now deleted in Rcopia |
| `send_medication` | PASS: free-text reported med `created` (61400519440) -> `Deleted=y` -> `deleted` | `send_medication.txt`, `send_medication_delete.txt` | Fixed: response item now checked; chart medications uploaded before launch (were never sent) |
| `update_prescription_events` | PASS: `ok`; SB-61360164576 `pending`, SB-61358989377 `completed` | `update_prescription_events.txt` | Met (practice-level cursor) |
| "Rcopia not reachable" | Timeout / refused / HTTP 5xx page each fail with a code (`network_error`, `http_503`, `bad_response`), the cursor is not advanced, the badge falls back to synced counts, SSO launch is blocked with a message when the pre-launch upload fails | unit tests (`tests/drfirst-certification.test.ts`) | Fixed: an HTTP error page used to come back with no error code |

**Prescription needed for the test?** One pending (SB-61360164576, created 10/20 10:30 EDT) and one signed /
printed (SB-61358989377, 10/15) prescription already exist for maxpatient on staging, so no new test
prescription was needed. For the certification script DrFirst will likely want a prescription **sent**
electronically, a pharmacy renewal and a change request; those must be created by a prescriber in the Rcopia UI
(via Altrixs SSO) or by DrFirst's test pharmacy.

## 2. Code audit per API

| API | Request we send (spec: M = mandatory, O = optional, as far as the recorded responses / builders show) | Response parsing | LastUpdateDate cursor | Idempotency | Altrixs tables | Errors / retry | Audit | Tests |
|---|---|---|---|---|---|---|---|---|
| send_patient | PatientList/Patient: ExternalID (client id) **or** RcopiaID (linked chart), FirstName, MiddleName, LastName, Suffix, DOB MM/DD/YYYY, Sex F/M/U, HomePhone / MobilePhone / WorkPhone (typed, 10 digits, placeholders dropped), Address1, Address2, City, State, Zip (5 or 9 digits) | envelope `ok` + item `created`/`updated`; RcopiaID stored in `Client.rcopiaPatientId`; item error / no item = failure | n/a | ExternalID = client id; resend = update; ledger fingerprint `drfirst:sent:<client>` -> sent only when demographics changed | Client.rcopiaPatientId | 30 s timeout; failure returned to caller (422 incomplete, 502 DrFirst) | DRFIRST_SEND_PATIENT (counts / codes) | yes |
| get_notification_count | Command, Return{Prescription,Refill,RxChange,TherapyRequest}IDs=y, signed as the prescriber | NotificationCount Type/Number + listed items with Provider/Username | n/a | n/a | badge (no table); fallback `rcopia_refill_notifications`, `rcopia_prescriptions` | error -> synced counts | DRFIRST_NOTIFICATION_COUNT per live call | yes |
| update_prescription | LastUpdateDate (M), Status=all, Patient (patient-level) | Prescription blocks: own RcopiaID (nested Patient/Provider/Preparer/Sig ids excluded), Deleted/Voided/Denied/NeedsReview/Signed/Completed/Undeliverable -> status, sig, qty, refills, pharmacy, CompletionAction | practice: `update_prescription_all:<org>`; patient: `update_prescription:patient:<client>`; saved only after every row was written | upsert by `rcopia_prescriptions.rcopia_id` (unique); a script already filed to another chart is never moved | rcopia_prescriptions (separate from medications: PDM1) | cursor kept on error; retried next cycle (15 min cron) | DRFIRST_PRESCRIPTION_DOWNLOAD | yes |
| update_medication | LastUpdateDate, Patient | Medication: own RcopiaID, ExternalID, Deleted, Provider, Sig (Drug, Dosage/Instruction or DosageText), Start/Stop/StopReason, HistorySource, Prescription link | `update_medication:<org>` / `:patient:<client>` | upsert by (client, rcopiaMedId); own echoes (`altrixs-med-`) skipped | ClientMedication (active / discontinued by StopDate or Deleted) | as above | DRFIRST_MEDICATION_DOWNLOAD | yes |
| update_problem | LastUpdateDate, Patient | Problem: own RcopiaID, `<Status><X/></Status>`, Deleted, ICD10 / ICD9 / SNOMED code + description, onset | `update_problem:<org>` / `:patient:<client>` | upsert by rcopiaProblemId; own echoes (`altrixs-dx-`) skipped; local rows never changed | MedicalProblem (source drfirst; ICD-9 kept in notes, never converted) | as above | DRFIRST_PROBLEM_DOWNLOAD | yes |
| update_patient | LastUpdateDate or PatientList (RcopiaID / ExternalID) | Patient demographics, Deleted, per-patient Error (bad_patient_id is data) | `update_patient:<org>` | link confirmed only via our ExternalID; demographics never overwritten | Client.rcopiaPatientId + ClinicalEvent `drfirst-patient-review` | as above | DRFIRST_PATIENT_DOWNLOAD | yes |
| update_allergy | LastUpdateDate, Patient | Allergy: own RcopiaID, `<Status><X/></Status>`, Deleted, Allergen name / codes, reactions, severity | `update_allergy:<org>` / `:patient:<client>` | upsert by rcopiaAllergyId; our echo (ExternalID = MedicalAllergy id) only gets its Rcopia id | MedicalAllergy (source drfirst) | as above | DRFIRST_ALLERGY_DOWNLOAD | yes |

Cursor rule (GM7 / DR1): the value sent is always the `<LastUpdateDate>` of the previous successful
response, stored verbatim (Rcopia's Eastern time) in `drfirst_sync_cursors`; it is read from the `<Response>`
only (Rcopia echoes our request first). It is saved only when every row was written, so a failed row is
downloaded again (no gaps); the boundary is inclusive, so re-downloads are absorbed by the upserts (no
duplicates). First run without a cursor: practice-wide = 90 days back (`DRFIRST_SYNC_LOOKBACK_DAYS`),
patient-level = full history (medications, prescriptions) or 2 years (allergies, problems).

## 3. Requirement checklist

Status: **met** (already correct), **fixed** (changed in this branch), **n/a** (with reason), **gap** (open).

| ID | Status | How / evidence |
|---|---|---|
| GM1 | met | Every record carries ExternalID and / or RcopiaID; a chart linked to a pre-existing Rcopia patient is sent by RcopiaID (`send_patient_by_rcopia_id.txt`) |
| GM2 | met | ExternalIDs are unique per practice + system name: client cuid, `altrixs-dx-<client>-<code>`, MedicalAllergy cuid, `altrixs-med-<id>`, `altrixs-appt-<id>` |
| GM3 | met | ids above are never reused (cuids; deleted items are sent `Deleted=y` with the same id, never re-assigned) |
| GM4 | fixed | API version read from `drfirst_settings.api_version` (migration `20261020_drfirst_certification.sql`, seeded 2.54), ADMIN `GET/PUT /api/drfirst/settings`, cached 5 min; fallback `DRFIRST_API_VERSION` |
| GM5 | met | One vendor account + one practice per deployment (`DRFIRST_PRACTICE_USERNAME`) |
| GM6 | fixed | Every call writes a `drfirst_api_logs` row with status, error code and text (HTTP error pages now get `http_<n>` / `bad_response`); audit rows per call / sweep |
| GM7 | met | See cursor rule above; tests `GM7 / PDM2`, `patient-level sync` |
| GM8 | fixed | Each update_* scope (practice, or patient) is called at most once per 5 minutes (`drfirst_poll_state`); the cron runs every 15 minutes; on-demand review-status / PDMP answer 429 inside the window |
| GM9 | fixed | One escaper for every value: & < > " ' escaped, XML-invalid characters dropped, UTF-8 kept (test `GM9`) |
| GM10 | fixed | With `DRFIRST_REGISTER_ON_LAUNCH=true` the SSO route uploads patient -> problems -> allergies -> medications (new / changed only) before building the URL, and refuses to launch (409) when an upload fails. **Off on staging** (no real PHI to DrFirst's test system); turn on at cutover |
| GM11 | n/a | Rcopia opens in a normal browser tab (`window.open`), never an iframe. The SSO builder supports `allow_popup_screen=n` if that changes |
| GM12 | fixed | Response payload stored for answered calls, request for connection failures; AES-256-GCM encrypted (`PHI_FIELD_ENCRYPTION_KEY`), vendor password removed, ADMIN-only `GET /api/drfirst/logs`, purged after 90 days by the cron |
| GM13 | fixed | Every SSO launch attempt logged (`kind=sso`, screen, user, outcome, encrypted URL with the MAC removed) |
| UM1 | fixed | Patient (demographics fingerprint), problems (code + description), allergies, medications: sent only when new / changed; removed items deleted |
| UM2 / UM3 | n/a | Uploads are on-demand (launch / patient sync), not polled |
| UR1 | partial | Uploads run at patient sync and before each launch; not yet on every chart edit (recommended only) |
| PDUM1 | met | send_patient refused without legal first / last name, sex, DOB, ZIP (test `PDUM1 / PDUM2`) |
| PDUM2 | fixed | Full address required; new "No street address?" option (homeless / address unknown) sends `HOMELESS` / `UNKNOWN` with the client's clinic (else the practice's primary location) city / state / ZIP |
| PDUM3 | met | Home / mobile / work phones by recorded type |
| PDUM4 | fixed | Pre-launch upload (GM10) |
| PDUM5 | fixed | Demographics fingerprint ledger |
| PDUR1 | met | ExternalID = client id |
| PDUR2 | fixed | Placeholder phones (one repeated digit, 555 area code, 555-01xx, N11 codes, 123-456-7890) never sent |
| DURM1 | met | All ICD-10 diagnoses on the chart are sent; uncoded entries reported as "needs coding" |
| DURM2 | met | ICD-10-CM only (validated) |
| DURM3 | fixed | Pre-launch upload; removed diagnoses deleted in Rcopia (`send_problem_delete.txt`) |
| DURM4 | fixed | Changed description resent; unchanged not resent |
| AUM1 | met | All active chart allergies (or explicit NKA) sent |
| AUM2 / AUM3 / AUR1 | fixed | Drug allergies carry an RxNorm CUI from NLM RxNav (RxNorm, rebuilt monthly; release stored per row in `drugCodeVersion`), chosen in the allergy typeahead (type: drug / food / environmental) or applied by `scripts/codify-meds-allergies.ts`. Ingredient CUIs are sent as `Allergen/Ingredient/RxnormID`; a product CUI as `Allergen/Drug/RxnormID` with up to 10 NDCs (AUR1). Food / environmental allergens stay free text. Uncoded drug allergies are still sent free text and counted in the chart's DrFirst panel (test `drug-codification`) |
| AUM4 | fixed | Pre-launch upload; inactive / removed allergies deleted (`send_allergy_delete.txt`) |
| AUM5 | met | Fingerprint ledger |
| MUM1 | fixed | Local chart medications are now uploaded (before: never) |
| MUM2 / MUM3 / MUM4 | fixed | Medications are coded at entry with the RxNorm typeahead (specific SCD / SBD: strength + form) or by the backfill; the server resolves name, brand / generic, RxNorm dose form, strength and NDCs from RxNav (monthly). Sent with `RxnormID` + `RxnormIDType`, `NDCID` list, `BrandName` / `GenericName`, `Form`, `Strength`. Uncoded medications are still sent free text with the uncoded flags, and the chart's DrFirst panel shows "N medications not coded" with a one-click "code it" |
| MUM5 | fixed | Latin sig abbreviations expanded (bid, tid, qid, qd, qod, qhs, hs, prn, po, sl, im, subq, ac, pc, stat, gtt, qNh ...) before sending (test `MUM5`) |
| MUM6 | fixed | Pre-launch upload |
| MUM7 | fixed | Fingerprint ledger |
| MUR1 / MUR2 / MUR3 | fixed / met / met | Up to 10 NDCs per coded drug (RxNav `ndcs.json`, all active NDCs stored in `ndcCodes`); discrete sig fields used, PatientNotes only when nothing maps; OtherNotes never sent |
| DPUM1-4 / DPUR | n/a | Not an HIS. `send_prescription` disabled; only "delete pending prescription" is wired and DrFirst staging answers `not_permitted` for our login (open item) |
| DR1 / DR2 | met / fixed | Cursor rule; 5-minute throttle |
| PDDM1 / PDDM2 / PDDR1 | met | `update_patient` polled with its own cursor; optional under Single Patient Mode (owner is choosing Single Patient Mode = y) |
| DDM1-3 | met | update_problem, per practice and per patient cursors |
| ADM1-3 | fixed | Inactive status now read; per practice / per patient cursors |
| MDM1-3 | met | per practice / per patient cursors |
| POVDM1 | met | `update_patient_office_visits:<org>` |
| PIRDM1 | met | `update_notification:<org>`; renewals now leave the pending badge when Rcopia reports the action |
| PDM1 / PDM2 / PDR1 | fixed | Prescriptions in `rcopia_prescriptions` (separate from medications); chart panel and the E-Prescribing page (`GET /api/drfirst/prescriptions`) show pending ("Pending, not sent") apart from signed / completed, with the latest pharmacy fill status; Status=all |
| PEDM1 / PEDM3 | met / fixed | Practice cursor; 5-minute throttle |
| PEDM2 / PEDM4 | n/a | Polled by LastUpdateDate, never by prescription id lists |
| PSDM1-3 | n/a | Prescription status download not used |
| NCDM1 | fixed | One live call per Rcopia user per 15 minutes server-wide; other viewers get the stored answer |
| NCDM2 | fixed | Header badge always shows Rx pending (`rx_pending`), Renewals (`refill`), Changes (`rxchange`), To sign (`rx_need_signing`) for the signed-in prescriber; the E-Prescribing page shows the same four counts as "Waiting in DrFirst" cards that open the message screen |
| NCDM3 | fixed | "DrFirst messages" / "DrFirst reports" buttons (E-Prescribing page) launch `startup_screen=message|report` with `limp_mode=y` |
| UDH1 / UDH2 | n/a | Acute (HIS) only |
| PMLRSDM1 | fixed | get_review_status: practice cursor, and now a per-patient cursor for patient-level calls; 5-minute throttle |

## 4. SSO launch modes used

| Screen | Where | Parameters |
|---|---|---|
| `patient` | Client chart "E-Prescribe", note editor, telehealth drawer | `rcopia_patient_external_id` (client id) or `rcopia_patient_id` (linked chart); after the pre-launch upload in production |
| `message` | E-Prescribing page "DrFirst messages" | `limp_mode=y` (Limited Multi Patient Mode), no patient |
| `report` | E-Prescribing page "DrFirst reports" | `limp_mode=y`, no patient |
| `manage_medications` / `manage_allergies` / `manage_problems` | Accepted by `/api/drfirst/sso?screen=` | patient context as for `patient` |

Every URL is MAC-signed (MD5 of the parameter string + vendor password, upper-case hex), carries
`close_window=n` and a GMT `time`; the Rcopia username always comes from the signed-in user's staff profile.

## 5. Notification badge

`GET /api/drfirst/notifications` (prescribers and ADMIN). Prescriber: `get_notification_count` signed as their
own Rcopia username with item ids; for a type whose items are listed only the items owned by that prescriber
count, otherwise the type's own number. ADMIN: organization totals plus per-prescriber counts. One live call per
Rcopia user per 15 minutes (server-wide); never holds the page more than 1.5 s, falling back to the counts the
15-minute sync wrote (pending prescriptions by NPI, pending renewals by owning provider). Each live call writes an
audit row (`DRFIRST_NOTIFICATION_COUNT`, no patient data).

Per-count deep links (NCDM2 / NCDM3): under Single Patient Mode each count opens the Rcopia screen that lists
those items, in Limited Multi Patient Mode (`limp_mode=y`). The mapping is one constant,
`src/lib/drfirst/notificationScreens.ts`, used by the header badge (each count is its own button; the
"DrFirst:" label links to E-Prescribing) and the E-Prescribing "Waiting in DrFirst" cards:

| Count | Rcopia screen |
|---|---|
| Pending prescriptions (`pending_prescription`) | `report` |
| Needs signing (`need_signing`) | `report` |
| Renewal requests (`refill`) | `message` |
| Change requests (`rx_change`) | `message` |

Screen names to confirm with DrFirst. A failed launch (no Rcopia username, Rcopia not configured) shows the
reason in a toast.

On-demand refresh (certification call 2026-10-23: the chart reflects what the prescriber did in Rcopia
"immediately, when you close the screen, or by clicking"):

- Return from Rcopia: when an Altrixs tab becomes visible again after 3 s or more (`DrFirstReturnSync` in the
  dashboard shell, prescribers only), `POST /api/drfirst/sync/return` refreshes the patient of the caller's
  latest `DRFIRST_SSO_LAUNCH` in the last 2 hours (caseload + Part 2 lock; at most one return refresh per user per
  20 s). Open charts and the E-Prescribing page reload.
- "Refresh from DrFirst" on the chart's DrFirst panel (prescribers, linked charts): `POST /api/drfirst/sync`
  `{clientId}`.
- Both run update_medication, update_prescription, update_allergy and update_problem for that one patient with
  per-patient cursors; each is still called at most once per 5 minutes per patient (GM8 / DR2), and a throttled
  refresh tells the prescriber when the chart updates again. Audit: `DRFIRST_MEDICATION_DOWNLOAD` (return
  refresh: `trigger: return_from_rcopia`), ids and counts only.
- Everything else arrives with the practice-wide sync (`scripts/drfirst-sync.ts`, cron in
  `deploy/crontab.staging`; each update_* scope at most once per 5 minutes).

## 6. Private label settings (owner's choices, set by DrFirst)

| Setting | Value |
|---|---|
| Patient mode | Single Patient Mode = y (DrFirst recommendation, PDDR1); message / report screens in Limited Multi Patient Mode (NCDM3) |
| Suppress encounters | y |
| Logout | "Return to Altrixs" (closes / returns to the Altrixs tab) |

To confirm with DrFirst: under Single Patient Mode a `patient` launch needs patient context, so on production the
pre-launch upload (`DRFIRST_REGISTER_ON_LAUNCH=true`) must be on.

## 7. Fixes in this branch

1. `update_prescription` now sends `Status=all` (Rcopia returns completed scripts only by default: pending
   scripts never reached the chart or the synced badge); new cursor name `update_prescription_all` backfills the
   lookback window once; every field refreshed on re-download.
2. Notification badge: Rcopia's real type names mapped (`rx_pending`, `rxchange`, `rx_need_signing`, ...); per
   prescriber per type; all four counts shown; 15-minute server-wide throttle; audit per live call.
3. `send_patient`: item status checked (a bare `ok` no longer counts), Rcopia id returned explicitly, RcopiaID
   for linked charts, changed-only, placeholder phones dropped, HOMELESS / UNKNOWN address with clinic values
   (new `Client.addressStatus` + form option), uploads before launch with a blocking failure.
4. Problems / allergies / medications upload: changed-only, removals deleted in Rcopia, chart medications
   uploaded (coded only when complete), Latin sig expansion, item status checked for send_allergy /
   send_medication (shapes verified live).
5. Parsers: allergy `<Status><Inactive/></Status>`; medication / prescription nested `Prescription`, `Preparer`,
   `ProviderLocation`; own echoed medications not copied back; renewal action clears the pending row.
6. Per-patient cursors + 5-minute throttles for every patient-level and on-demand download.
7. API version in the database; encrypted call / SSO log with 90-day purge and an ADMIN read route; HTTP error
   pages and timeouts reported with codes.

## 8. Open items

**Owner**
- Apply migration `20261020_drfirst_certification.sql` before deploying; confirm `PHI_FIELD_ENCRYPTION_KEY` is set
  (it is on staging) or payloads are not stored.
- Turn on `DRFIRST_REGISTER_ON_LAUNCH=true` on production at cutover (GM10).
- Apply migration `20261021_drug_codification.sql`, then run `npm run db:codify-drugs` (dry run) and
  `npm run db:codify-drugs -- --apply`; staff code the listed "review" rows from the chart's DrFirst panel.
- On staging, confirm Rcopia accepts a coded send_medication carrying both `NDCID` (comma list) and
  `RxnormID` + `RxnormIDType` (the shape update_medication returns), and a coded send_allergy.
- Have a prescriber create (in Rcopia via SSO) the test prescriptions DrFirst's script needs: one sent
  electronically, plus a renewal and a change request from DrFirst's test pharmacy.

**DrFirst**
- Set the private label (Single Patient Mode, suppress encounters, "Return to Altrixs" logout) on staging and
  production; confirm `limp_mode=y` is the right flag for message / report under Single Patient Mode.
- Enable or confirm: `search_problem`, `search_drug_detail` and `send_prescription` (delete pending) answer
  `not_permitted` for our login; `patient_search_get_data` is not recognized on staging 201.
- Confirm whether `update_*` responses are ever truncated (a maximum record count per call); Altrixs resumes
  from the returned LastUpdateDate either way.
- Confirm how merged patients appear in `update_patient` (Altrixs raises a link-conflict review item).
- Provide the final certification test script.
