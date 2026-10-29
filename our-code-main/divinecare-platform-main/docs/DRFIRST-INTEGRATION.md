# DrFirst integration

## Current status (19 October 2026)

The application now has a server-only **Staging 201 adapter** in addition to mock mode. It implements the official v2.54 request envelope, patient demographic upload, enrolled prescriber/patient mapping, short-lived MAC-signed Orca staging SSO launch creation, encrypted request/response audit storage, retention cleanup, and order-independent notification-count parsing. Production remains fail-closed.

Prescription creation, review, signing, pharmacy selection/transmission, signature password, and EPCS multi-factor authentication occur inside DrFirst after SSO. Altrixs does not claim to be a pharmacy network and does not implement a parallel controlled-substance signer. The local medication-order form is explicitly marked as an internal draft and cannot be represented as transmitted.

Live Staging 201 verification established that the supplied vendor credential authenticates to the Update servlet: `get_notification_count` returned a successful response containing six notification categories for the supplied provider. The Engine `search_drug_allergy` request authenticated but returned `not_permitted`; DrFirst must enable that entitlement. The Orca SSO endpoint was reachable but returned support status `202-99-9999` for both documented parameter variants, so DrFirst must confirm/enable the practice's External Login configuration before browser launch can be treated as working. No production traffic was attempted.

Full `update_medication`, `update_prescription`, prescription-event, RxFill, RxChange, and refill payload synchronization is not enabled. The available integration portal login was rejected and the exact download schemas/cursor rules could not be verified. Those clinical parsers must not be guessed from legacy code. The partner must provide working portal access or the relevant v2.54 pages/export and resolve the SSO status before this part can be certified.

The credential-independent First Data Bank `search_drug_allergy` foundation is implemented but disabled by default. It includes server-only configuration, the documented Rcopia Engine XML 2.54 envelope, XML escaping before form URL encoding, bounded order-independent XML parsing, timeout-only retries, response warnings, a protected API route, and an explicit-submit UI. It makes no external request until an assigned DrFirst endpoint and credentials are configured and `DRFIRST_FDB_ENABLED=true`.

All pre-adapter DrFirst routes are explicitly disabled with HTTP 410 and `DRFIRST_LEGACY_ROUTE_DISABLED`. They cannot make external requests or modify clinical data. The client e-prescribe action now opens the authenticated prescribing workspace, which owns the protected `/api/integrations/drfirst/launch` flow. The unverified inbound webhook is also disabled because DrFirst's supplied workflow states that download requests are partner-initiated.

The Maryland PDMP checkpoint is a local prescriber attestation, not proof of a DrFirst or CRISP query. It is restricted to active database-backed prescribing roles and tenant/caseload-visible patients. Reviewer identity, NPI, and primary location are derived from the authenticated user; request bodies cannot override them. Missing NPI, cross-origin writes, cross-tenant patients, and storage failures fail closed. A database error can never fabricate a successful or compliant review.

## Architecture

Altrixs prescriptions UI → authenticated routes → DrFirst service → provider interface → Mock / Staging / Production provider.

- `src/lib/drfirst/config.ts`: server-only environment access; `settings.ts`: validation and public status whitelist.
- `types.ts`, `provider.ts`: Altrixs internal DTOs and capabilities, **not vendor request specifications**.
- `mock-provider.ts`: deterministic, tenant-separated fake entity identifiers and simulated launch sessions. No networking.
- `staging-provider.ts`, `rcopia/client.ts`, `rcopia/xml.ts`: Staging 201 patient upload, MAC-signed SSO, bounded HTTP transport, timeout-only retries, safe XML parsing, and notification counts.
- `factory.ts`, `index.ts`: central adapter selection. Staging is injected only from the server-only service boundary; production always fails closed.
- `mapping.ts`, `service.ts`: field mapping, tenant/caseload checks, self-prescriber enforcement, persistence and audits.
- `validation.ts`: internal adapter-result whitelist, environment/mode checks, bounded expiry and shared launch-destination policy. Extra adapter fields are stripped before persistence or HTTP output. Only the internal mock page and exact Orca staging External Login endpoint are approved.
- `http.ts`: authentication, permission checks, same-origin POST requirement, rate limit, validation and safe error responses.
- `DrFirstPanel.tsx`: existing prescriptions-page entry and internal development test harness.

The only roles granted prescribing permission are existing Psychiatrist and NP roles through the shared `canPrescribe` helper. Service operations also require an active database user with an actual prescribing role, preventing admin role-preview sessions from granting prescribing authority. Prescribers can launch only as themselves, for patients in their own clinic and assigned caseload. Administrators/directors may inspect configuration status but cannot launch as another prescriber. Patient sessions do not satisfy the staff authentication gate.

## Environment variables

```dotenv
DRFIRST_ENABLED=false
DRFIRST_ENV=mock
DRFIRST_ENGINE_URL=https://engine201.staging.drfirst.com/servlet/rcopia.servlet.EngineServlet
DRFIRST_UPDATE_URL=https://update201.staging.drfirst.com/servlet/rcopia.servlet.EngineServlet
DRFIRST_SSO_URL=https://orca.staging.drfirst.com/orca/auth/extLogin/v10
DRFIRST_VENDOR_USERNAME=
DRFIRST_VENDOR_PASSWORD=
DRFIRST_PRACTICE_USERNAME=
DRFIRST_PORTAL_SYSTEM_NAME=
DRFIRST_PRESCRIBER_MAP_JSON={}
DRFIRST_PATIENT_MAP_JSON={}
DRFIRST_AUDIT_ENCRYPTION_KEY=
DRFIRST_AUDIT_RETENTION_DAYS=90
DRFIRST_MOCK_FAILURE=none
```

First Data Bank / Rcopia Engine drug-allergy search uses separate server-only settings so it can be enabled independently of the still-unimplemented prescribing adapter:

```dotenv
DRFIRST_FDB_ENABLED=false
DRFIRST_FDB_URL=
DRFIRST_FDB_VENDOR_NAME=
DRFIRST_FDB_VENDOR_PASSWORD=
DRFIRST_FDB_APPLICATION=Altrixs
DRFIRST_FDB_APPLICATION_VERSION=1.0.0
DRFIRST_FDB_PRACTICE_NAME=
DRFIRST_FDB_STATION=
DRFIRST_FDB_PRACTICE_USERNAME=
DRFIRST_FDB_SYSTEM_NAME=
DRFIRST_FDB_API_VERSION=2.54
```

The endpoint is configuration-driven and must be an HTTPS `drfirst.com` Rcopia Engine servlet URL without embedded credentials, query parameters, or fragments. Credentials remain server-only and are never returned by the status endpoint. Keep the feature disabled until DrFirst identifies the assigned staging region and supplies the account identifiers.

Only `mock`, `staging` and `production` are valid environments. Boolean/mode/failure selections are trimmed and lowercased centrally; secret values are not normalized. Disabled is the default. Development defaults to mock when the environment is absent. When `NODE_ENV=production` and the integration is enabled, an explicit, nonblank environment is mandatory; there is no silent mock or staging fallback. Explicit mock is permitted for an intentionally configured production-build test deployment and remains prominently labelled MOCK. Runtime cookie and failure-injection decisions also come from this centralized configuration.

`DRFIRST_MOCK_FAILURE` accepts `none`, `patient`, `prescriber`, or `unavailable`. Failure injection is allowed only outside production runtime in mock mode. Both environment configuration and per-request injection are checked server-side. No variable uses `NEXT_PUBLIC_`. Endpoints and credential placeholders are reserved for the future official adapter; their required combinations are intentionally not guessed.

## Test mock mode

1. In local environment configuration set `DRFIRST_ENABLED=true`, `DRFIRST_ENV=mock`, and `DRFIRST_MOCK_FAILURE=none`; restart `npm run dev`.
2. Use an active NP or Psychiatrist account in an active clinic, with a display name. NPI is optional in the internal/mock model. If supplied, its format must contain 10 digits. Official enrollment, NPI verification and any mandatory identifiers remain requirements for the future official adapter, not claims made by this mock.
3. Use an assigned synthetic patient with a name and valid, non-future date of birth. Do not create real prescribing orders to test this integration.
4. Open `/dashboard/ehr/prescriptions`, select the patient and click **Open E-Prescribing**.
5. The internal `/dashboard/ehr/prescriptions/mock` page displays MOCK, SIMULATED, fake mapping/session IDs, expiry, and the explicit no-transmission notice.
6. Select a test patient in the harness and try successful launch, patient validation failure, provider validation failure, and unavailable service. Failure buttons appear only outside production runtime.
7. Disable integration and confirm the page reports configuration unavailable. Set staging/production and confirm configuration is pending and launch fails closed.

Launch sessions expire after five minutes. Only a random opaque token is placed in an HttpOnly, SameSite=Strict cookie restricted to the mock page path; production runtime also uses Secure. No token appears in a URL or JSON response. The database stores its hash, user/clinic binding, patient reference, expiry, and safe mock results. Page reads revalidate user and patient access. After expiry, return to prescriptions and launch again. Sessions survive worker restarts because storage is in PostgreSQL.

The session is a **display-only mock result**, deliberately reusable by the same authorized user until expiry so refresh/back navigation works. Re-reading it performs no synchronization or prescribing action. It is not a one-time SSO authorization code. Unknown, wrong-user and wrong-organization sessions are denied; a recognized expired session has `DRFIRST_SESSION_EXPIRED` (410 at the service error boundary). The server-rendered page displays the error and a return link. Actual single-use redemption, revocation and replay protection must follow the official SSO protocol when supplied. Mock external entity IDs are deterministic mappings, not authentication secrets; session tokens are 32 random bytes and session IDs use random UUIDs.

## Routes

- `GET /api/integrations/drfirst/status`: only `{ enabled, environment, configured }`; admin/director or prescriber. Active prescriber views also recheck the actual database role and profile, preventing admin-preview sessions from obtaining actionable launch state. `configured` means the adapter is implemented and enabled, not a vendor connectivity probe. No credential values are returned.
- `POST /api/integrations/drfirst/patient/sync`: `{ "clientId": "..." }`.
- `POST /api/integrations/drfirst/prescriber/sync`: `{}` or `{ "userId": "current-user-id" }`.
- Practice download poll: every **5 minutes** (`*/5`). Whole-minute claims use `UPDATE_POLL_MIN_MS = 5 * 60_000` so early cron is not double-throttled.
- Return-from-Rcopia: `POST /api/drfirst/sync/return` after tab hidden ≥3s; per-user throttle 20s.
- Manual chart refresh: `POST /api/drfirst/sync` `{ "clientId" }` — 5-minute per-patient throttle.
- Notification deep links: `GET /api/integrations/drfirst/sso?count=pending_prescription|need_signing|refill|rx_change` → `startup_screen=report|message`, `limp_mode=y`, new tab only.
- `POST /api/integrations/drfirst/launch`: `{ "clientId": "..." }`, optionally `failure` in development mock mode. Organization and prescriber are derived from the authenticated session; extra fields are rejected.
- `GET /api/integrations/drfirst/drug-allergy`: credential-redacted FDB readiness and API version; active NP/Psychiatrist only.
- `POST /api/integrations/drfirst/drug-allergy`: `{ "searchString": "amoxicillin", "maximum": 50 }`; active NP/Psychiatrist only. Search is explicit-submit, not typeahead. It accepts 2–100 characters with at least two letters/numbers and caps results at 200.

The FDB client submits exactly one `application/x-www-form-urlencoded` field named `xml`. XML text is escaped before the full message is URL encoded. Responses are limited to 2 MB and 20,000 XML nodes; DTD/entity declarations are rejected. Parsing uses element names and nesting rather than sibling order, tolerates omitted optional fields, and strips unrecognized upstream fields. Each request has a 30-second timeout and at most three timeout retries after the initial attempt. HTTP failures, connection errors, and valid DrFirst XML errors are not retried. Successful identical searches are cached in-process for one minute to reduce redundant traffic.

Raw XML and signed SSO URLs are never written to PM2/application logs. Exchange evidence is encrypted with AES-256-GCM using a dedicated 32-byte server key and stored in the tenant-scoped reserved `ClinicModuleState` namespace. The default retention is 90 days (configurable from 1–3650 days); expired exchange records are deleted transactionally whenever a new exchange audit is written. Access remains denied through the generic module API. Operations still require the customer to approve the final retention period, key rotation/backup process, authorized support-access procedure, and alert destination.

The unused legacy `/api/prescribing/sso-url` and `/api/prescribing/sync` placeholders fail closed with `DRFIRST_NOT_CONFIGURED`. The former `/api/drfirst/*`, `/api/prescribing/launch`, and `/api/prescribing/webhook` implementations fail closed with HTTP 410. They no longer generate locally signed tokens, expose them in JSON, call an undocumented transport, accept invented inbound events, or describe a local medication record as synchronized with DrFirst. Official behavior must use the documented integration routes once the remaining SSO and download contracts are supplied.

POST requests must carry an Origin equal to the request URL's origin. Browser same-origin fetch supplies this automatically. Test clients must supply it explicitly. JSON bodies are limited to 4 KiB while streaming, including when Content-Length is missing or inaccurate. Wrong content type returns 415, oversized input 413, invalid JSON/schema 400, authorization failure 401/403, configuration/service failures 503, and rate limits 429. Responses are `no-store`. Writes use the existing per-process rate limiter (20/minute per clinic/user); distributed rate limiting is an operational consideration for multi-instance hosting. Reverse proxies must preserve the canonical public origin for this same-origin check; forwarded-host headers are not independently trusted by the integration.

Errors expose only normalized codes and fixed messages: `DRFIRST_DISABLED`, `DRFIRST_NOT_CONFIGURED`, `DRFIRST_UNAUTHORIZED`, `DRFIRST_PATIENT_INVALID`, `DRFIRST_PRESCRIBER_INVALID`, `DRFIRST_EXTERNAL_SERVICE_ERROR`, `DRFIRST_INVALID_INPUT`, `DRFIRST_SESSION_EXPIRED`. Raw errors, upstream bodies and stacks are not returned or logged by this integration.

## Persistence and schema decision

No Prisma schema changes or migrations. No `db push` or database migration was run.

Existing `ClinicModuleState` provides organization-scoped JSON and a unique organization/module key. Reserved server-only module namespaces:

- `drfirst:mapping:<environment>:<entity-kind>:<hashed-local-id>`: external ID, environment and last-sync timestamp. Separate mock/staging/production mappings cannot overwrite each other.
- `drfirst:session:<token-hash>`: short-lived mock launch record.
- `drfirst:audit:<uuid>`: one event per row, avoiding concurrent append lost updates.

Generic module access explicitly denies all `drfirst` prefixes. Colon-separated internal keys additionally fail the generic route's module-name validator. These records cannot be edited/read through the clinic module API, even by admin roles.

After tenant/role/caseload authorization, the service reads an existing mapping from the selected environment and supplies its optional `externalId` to the adapter on synchronization. Results are checked against the selected environment before writes. Mock-prefixed IDs are rejected in live-mode results. Vendor idempotency and concurrent external creation behavior still need the official contract; an external ID alone does not guarantee idempotence.

Audits include organization scope, actor ID, operation, a correlation ID joining attempt/outcome, attempted/succeeded/failed outcome, environment, timestamp and normalized failure code. Patient-bearing operations include a SHA-256 reference of organization + entity kind + local patient ID; provider references use the same pattern. These pseudonymous references support authorized correlation without placing raw patient IDs or names in audit payloads; they remain protected audit data, not anonymous public data. Names, demographics, NPI, medications, prescription contents, token values and credentials are omitted. Database audit writes are awaited; an audit failure blocks successful completion. Existing clinic JSON storage is reused, but DrFirst audit records are not currently rendered by the admin audit-list UI. Records are not automatically deleted; establish an approved retention/cleanup policy for expired mock sessions and audit records before prolonged deployment.

## Official staging access checklist and connection steps

1. Ask DrFirst to resolve Orca External Login status `202-99-9999`, enable the FDB/search entitlement if it is in scope, and restore working integration-portal access.
2. Confirm required patient fields and reconciliation/idempotency rules; prescriber identifiers, NPI verification and enrollment requirements; clinic/location identifiers and mapping ownership.
3. Confirm signing/token requirements, token lifetime, callback/redirect requirements and validation, IP allowlisting if required, approved transport/timeouts/retries, and certification test cases.
4. Obtain the exact v2.54 download request/response pages and implement cursor-based medication, prescription, event, RxFill, RxChange and refill ingestion with idempotent database upserts. Poll no more frequently than once every five minutes, use a 30-second timeout with at most three timeout-only retries, and upload patient demographics before clinical data.
5. Execute the existing contract/security tests plus vendor certification fixtures, malformed responses, tenant isolation, idempotent retries, safe error redaction and SSO security.
6. Store credentials/endpoints/mappings and the independently generated audit key in the server secret store. Set `DRFIRST_ENABLED=true` and `DRFIRST_ENV=staging` only after a real Altrixs prescriber is mapped to an enrolled DrFirst test provider. Restart and execute the vendor-approved test matrix with supplied synthetic patients.

## Production checklist

- Certified integration and production approval.
- Verified/enrolled prescribers; EPCS requirements and certification if EPCS is used.
- Official production credentials and endpoints; production organization/location/provider mappings.
- Approved callback/signing/redirect/IP configuration, secret rotation, monitoring, audit retention and distributed rate limits where required.
- Implement and validate the production adapter using the certified official implementation, then set `DRFIRST_ENV=production` and production credentials through the secret store. Reconcile production mappings; never promote mock external IDs.
- Run smoke/certification checks with the vendor-approved workflow before releasing prescribing to users.

## Validation commands

`npm test`, `npx prisma generate`, `npm run build`.

Tests include pure provider/config/mapping cases and actual route/service execution using an in-memory database substitute and authentication stub. They cover status redaction, unauthenticated/unauthorized requests, tenant/caseload filters, self-only prescribing, admin role-preview rejection, origin checks, strict input, disabled mode, mock launch/cookie binding/expiry and audit redaction. FDB tests additionally cover endpoint allowlisting, XML escaping and URL encoding, shuffled/missing response tags, warnings, malicious XML rejection, credential redaction, and timeout-only retries. No test calls DrFirst or writes a real database. Browser verification against a live PostgreSQL-backed clinic remains a deployment smoke test.

Review additions exercise all four routes, independent wrong-tenant/wrong-caseload cases, both NP and Psychiatrist, absent/invalid NPI, reused display sessions and access revocation, mapping reuse/environment rejection, malicious adapter output and destinations, bounded JSON parsing, audit outage behavior, actual rate limiting, and the server-only import guard. The suite disallows network fetches during DrFirst route tests. A mocked auth gate tests the integration boundary; it does not replace a live staff/patient-cookie authentication smoke test.

## Staging-switch readiness and review changes

The business flow can remain in the service. Replacing the adapter alone is deliberately **not sufficient**: official configuration/readiness validation, destination/expiry policy, and any vendor-required callback/token redemption endpoints must also be implemented. If DrFirst supplies a POST-based or form-based SSO launch rather than a navigable URL, the internal launch result and UI handoff must be extended to that documented mechanism. No such mechanism is assumed today. Vendor-specific required fields, NPI/enrollment and location mapping belong to the adapter/mapping boundary. Concurrency/idempotency rules, actual single-use SSO behavior and certification are unresolved until DrFirst answers them.

This review changed `types.ts`, `mapping.ts`, `errors.ts`, `settings.ts`, `mock-provider.ts`, `service.ts`, `http.ts`; added `validation.ts`; updated the status/launch routes, mock page, integration panel and prescriptions-page wording; expanded the two DrFirst test files; and updated this document. `.env.example`, Prisma, role/module helpers and dependencies were reviewed but unchanged in this review.

Concrete fixes: optional NPI to avoid blocking valid mock users; reuse of stored external IDs; whitelisted adapter output and fail-closed destinations; audit references/correlation; bounded input; centralized runtime settings; distinct expired-session errors; admin-preview status gating; and removal of misleading local-save pharmacy/EPCS labels. No confirmed critical/high-severity exploit was found in the current mock authorization/session flow. These changes do not certify real prescribing, EPCS or vendor SSO.

Questions for the DrFirst Partner Integration team:

- Is launch a navigable URL, signed form POST, SDK operation or another officially supported mechanism, and what are the token expiry, redemption, replay and revocation requirements?
- What patient, prescriber/NPI/enrollment and clinic/location fields are mandatory, and how should partner IDs, existing external IDs and concurrent create/sync retries be reconciled?
- What are the official staging endpoints, credential types, signing/key rotation, callback and approved redirect requirements, and is IP allowlisting required?
- Which certification cases, verified-prescriber steps and EPCS requirements apply to this integration, and what differs between staging and production?
- What are the documented timeout/rate-limit/retry policies, audit requirements and support procedures for indeterminate upstream results?

## File inventory

Created:

- `src/lib/drfirst/`: `access.ts`, `config.ts`, `errors.ts`, `factory.ts`, `http.ts`, `index.ts`, `mapping.ts`, `mock-provider.ts`, `provider.ts`, `service.ts`, `settings.ts`, `types.ts`, `validation.ts`.
- `src/app/api/integrations/drfirst/`: `status/route.ts`, `patient/sync/route.ts`, `prescriber/sync/route.ts`, `launch/route.ts`.
- `src/app/dashboard/ehr/prescriptions/mock/page.tsx`.
- `src/components/drfirst/DrFirstPanel.tsx`.
- `src/lib/drfirst/fdb/`: settings, XML codec, bounded HTTP client, service cache and response types.
- `src/app/api/integrations/drfirst/drug-allergy/route.ts`.
- `src/components/drfirst/DrugAllergySearch.tsx`.
- `tests/drfirst.test.ts`, `tests/drfirst-routes.test.ts`.
- `tests/drfirst-fdb.test.ts`.
- `docs/DRFIRST-INTEGRATION.md` (this document).

Modified:

- `.env.example`: server-only placeholder configuration and development failure selection.
- `package.json`: include DrFirst tests in the existing test command.
- `src/app/dashboard/ehr/prescriptions/page.tsx`: integration panel and shared prescribing permission.
- `src/types/roles.ts`: shared existing Psychiatrist/NP prescribing permission.
- `src/lib/modules/access.ts`: deny generic API access to reserved integration storage.

Schema/migration diff: empty; `prisma/schema.prisma` is unchanged.
