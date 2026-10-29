# Patient module

Backend for mobile clients and the /patient/login web portal. Patient JWT authentication is separate from staff NextAuth sessions.

The canonical contract is [Flutter-Patient-App-API-KB.md](../../docs/Flutter-Patient-App-API-KB.md). Import [the Postman collection](../../docs/Flutter-Patient-App-API.postman_collection.json) for requests and token/ID capture.

## Structure

- domain/: patient types, errors, password rules, appointment status mapping.
- application/auth/: login, invitations, password recovery and authentication.
- application/profile/: profile reads and permitted contact/address changes.
- application/messages/: shared care-team threads, visible messages and read receipts.
- application/forms/: read-only consent metadata scoped by patient and clinic.
- application/appointments/, doctors/, check-ins/, dashboard/: existing care flows.
- infrastructure/http/: response envelope, CORS, no-store, parsing, pagination, auth/rate-limit wrappers.
- infrastructure/security/: patient sessions and purpose-specific reset proofs.
- infrastructure/persistence/: clinic context and audit logging.
- infrastructure/notifications/: existing email/SMS adapters.
- src/app/api/patient/: thin route adapters with awaited dynamic params.

Staff uses public exports from @/patient. Application code never imports route handlers.

## Flows

Clinic invitation -> preview/accept -> login -> data.token -> Bearer-protected requests. GET/PATCH me needs an active account; care features also require a linked clinic. Patient responses use { success, data, message? } or structured errors. Existing telehealth join routes keep top-level session responses.

Recovery emails /patient/accept?mode=reset&token=... through the existing adapter. Browser and mobile reset both accept this link. Proofs expire in 30 minutes and are bound to the current password hash using HMAC. Atomic password replacement prevents reuse and invalidates all old sessions. Production requires AUTH_SECRET. Patients with tokens issued before credential binding must sign in again after rollout.

Chat shares staff MessageThread/ThreadMessage persistence. Patient queries exclude CLINICIAN_NOTE from all responses, previews and counts. Read means read by the recipient. Staff counters track patient messages; patient counts track FRONT_OFFICE replies. The existing clinician wire role covers those care-team replies.

Forms expose consent metadata only. Device push, account deletion and safety-plan signing do not have complete backend workflows yet. Dashboard safety summaries require explicit client IDs, never display-name matching.

## Proxy (guardian) access

A portal login (PatientAccount) can open several charts through PortalAccess links (self, parent, legal guardian, authorized representative). The token carries the login and the active client; requirePatient re-checks the link on every request (verified, not revoked / expired, under 18 for a minor's proxy). GET /api/patient/session lists the people; POST /api/patient/session/switch issues a token for another linked person. Proxy filtering (confidential, Part 2, limited access) lives in application/proxy/visibility.ts; rules and Maryland defaults in domain/proxy-policy.ts; staff functions in application/proxy/manage.ts. Guidance: docs/portal-proxy-access.md.

## Verification

Run npm run typecheck and npm test. Synthetic route/service tests cover auth, reset replay/concurrency, session revocation, input errors, clinic/patient scoping, profile restrictions, consent metadata, chat privacy/read receipts and transaction rollback. No live database or email is used. This update requires no Prisma schema changes.
