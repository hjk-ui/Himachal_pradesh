# DrFirst integration

## Current status

Mock integration implemented and reviewed. Real DrFirst access and the official integration contract are pending. No DrFirst HTTP calls, SDK calls, real endpoints, prescription creation, pharmacy transmission, EPCS, or prescription-status lookup are implemented. Existing medication-record storage and refill review remain separate; their UI now explicitly says saving is local to Altrixs and does not transmit to a pharmacy.

## Architecture

Altrixs prescriptions UI → authenticated routes → DrFirst service → provider interface → Mock / Staging / Production provider.

- `src/lib/drfirst/config.ts`: server-only environment access; `settings.ts`: validation and public status whitelist.
- `types.ts`, `provider.ts`: Altrixs internal DTOs and capabilities, **not vendor request specifications**.
- `mock-provider.ts`: deterministic, tenant-separated fake entity identifiers and simulated launch sessions. No networking.
- `factory.ts`, `index.ts`: central adapter selection. Staging and production placeholders always fail with `DRFIRST_NOT_CONFIGURED`, even if credentials are populated.
- `mapping.ts`, `service.ts`: field mapping, tenant/caseload checks, self-prescriber enforcement, persistence and audits.
- `validation.ts`: internal adapter-result whitelist, environment/mode checks, bounded mock expiry and shared launch-destination policy. Extra adapter fields (including upstream payloads/tokens) are stripped before persistence or HTTP output. Only the exact internal mock page is currently an approved launch destination.
- `http.ts`: authentication, permission checks, same-origin POST requirement, rate limit, validation and safe error responses.
- `DrFirstPanel.tsx`: existing prescriptions-page entry and internal development test harness.

The only roles granted prescribing permission are existing Psychiatrist and NP roles through the shared `canPrescribe` helper. Service operations also require an active database user with an actual prescribing role, preventing admin role-preview sessions from granting prescribing authority. Prescribers can launch only as themselves, for patients in their own clinic and assigned caseload. Administrators/directors may inspect configuration status but cannot launch as another prescriber. Patient sessions do not satisfy the staff authentication gate.

## Environment variables

```dotenv
DRFIRST_ENABLED=false
DRFIRST_ENV=mock
DRFIRST_SSO_URL=
DRFIRST_API_BASE_URL=
DRFIRST_PARTNER_ID=
DRFIRST_USERNAME=
DRFIRST_PASSWORD=
DRFIRST_CLIENT_ID=
DRFIRST_CLIENT_SECRET=
DRFIRST_MOCK_FAILURE=none
```

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
- `POST /api/integrations/drfirst/launch`: `{ "clientId": "..." }`, optionally `failure` in development mock mode. Organization and prescriber are derived from the authenticated session; extra fields are rejected.

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

1. Obtain official integration documentation and supported SDK/API/SSO contract, staging endpoints, SSO protocol, partner/vendor ID and credentials.
2. Confirm required patient fields and reconciliation/idempotency rules; prescriber identifiers, NPI verification and enrollment requirements; clinic/location identifiers and mapping ownership.
3. Confirm signing/token requirements, token lifetime, callback/redirect requirements and validation, IP allowlisting if required, approved transport/timeouts/retries, and certification test cases.
4. Implement `DrFirstProvider` in the staging adapter using only the official contract. Replace the throwing staging placeholder/factory branch. Map official results to the internal DTOs; extend `validation.ts` with the vendor-approved destinations and official LIVE/READY expiry policy. External redirects deliberately remain blocked even if a placeholder is accidentally replaced. Add official signing, callback, expiry and replay protection as required. Update centralized configuration/status readiness to the documented credential and implemented-adapter requirements. Credential configuration alone does not enable the current placeholder.
5. Add contract tests for official requests/responses, malformed upstream responses, tenant isolation, idempotent retries, safe error redaction and SSO security. Review any newly required fields as additive migrations only.
6. Store supplied credentials/endpoints in the server secret store. Set `DRFIRST_ENABLED=true` and `DRFIRST_ENV=staging`; restart. Keep staging mappings separate from mock mappings, reconcile users/patients/clinics through the official adapter, and complete vendor certification with approved test cases.

## Production checklist

- Certified integration and production approval.
- Verified/enrolled prescribers; EPCS requirements and certification if EPCS is used.
- Official production credentials and endpoints; production organization/location/provider mappings.
- Approved callback/signing/redirect/IP configuration, secret rotation, monitoring, audit retention and distributed rate limits where required.
- Implement and validate the production adapter using the certified official implementation, then set `DRFIRST_ENV=production` and production credentials through the secret store. Reconcile production mappings; never promote mock external IDs.
- Run smoke/certification checks with the vendor-approved workflow before releasing prescribing to users.

## Validation commands

`npm test`, `npx prisma generate`, `npm run build`.

Tests include pure provider/config/mapping cases and actual route/service execution using an in-memory database substitute and authentication stub. They cover status redaction, unauthenticated/unauthorized requests, tenant/caseload filters, self-only prescribing, admin role-preview rejection, origin checks, strict input, disabled mode, mock launch/cookie binding/expiry and audit redaction. No test calls DrFirst or writes a real database. Browser verification against a live PostgreSQL-backed clinic remains a deployment smoke test.

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
- `tests/drfirst.test.ts`, `tests/drfirst-routes.test.ts`.
- `docs/DRFIRST-INTEGRATION.md` (this document).

Modified:

- `.env.example`: server-only placeholder configuration and development failure selection.
- `package.json`: include DrFirst tests in the existing test command.
- `src/app/dashboard/ehr/prescriptions/page.tsx`: integration panel and shared prescribing permission.
- `src/types/roles.ts`: shared existing Psychiatrist/NP prescribing permission.
- `src/lib/modules/access.ts`: deny generic API access to reserved integration storage.

Schema/migration diff: empty; `prisma/schema.prisma` is unchanged.
