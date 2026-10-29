# Portal proxy (guardian / representative) access

Status: built on `staging/hardening` (Oct 21 2026). Migration `prisma/migrations/20261021_portal_proxy_access.sql`.
Rules are in code at `src/patient/domain/proxy-policy.ts` (`PROXY_RULES`, `proxyMayView`, `proxyMayUse`). The owner can change any default below; each one is a single constant or function.

## Model (industry standard: Epic MyChart proxy, athena, SimplePractice)

- **Portal user** = the login identity (`PatientAccount`: email unique, password, MFA-ready fields). One email = one login.
  `PatientAccount.clientId` is set only when the login is the client's own ("self"); a guardian-only login has `clientId = null`.
- **PortalAccess** (`portal_access`) links a portal user to a client chart: relationship (`self | parent | legal_guardian | authorized_representative`), access level (`full | limited`), granted by/at, verification of authority (verified by/at, method, legal document reference, note), end date, revoked by/at + reason, ended reason (`revoked | aged_out | expired`).
- **Session** (web `sessionStorage` token and Flutter bearer token, same JWT): `sub` = portal user, `clientId` = the active person. Every request re-checks server-side that the link is active (verified, not revoked, not expired, client under 18 for a minor's proxy, chart active). Nothing in the token is trusted for access.
- `GET /api/patient/session` lists who the login may view; `POST /api/patient/session/switch { clientId }` returns a new token for another linked person (403 + audit row for anyone else). Old single-client tokens keep working.

## Maryland defaults (owner may adjust)

| Situation | Default | Why |
|---|---|---|
| Client under 12, parent / guardian | **Full** proxy | Parent is the personal representative (HIPAA 45 CFR 164.502(g)). |
| Client 12-17 | **Limited** proxy | Teen confidentiality; matches MyChart teen proxy practice. Staff may choose full with a reason. |
| Minor consented to own mental health care (Md. Health-General §20-104, 16+) | Staff tick "consented to their own mental health treatment" on the chart card. A **limited** proxy then does not see treatment plans or medications. | The minor controls those records. |
| 42 CFR Part 2 (SUD) content | Hidden from **every** proxy (full or limited) | §2.14: a minor who can consent to SUD treatment (any age in Maryland, Health-General §20-102(c)) controls disclosure. Shown only if the clinician marks the item "shared with guardian", citing the client's written consent. |
| Items a clinician marks **confidential** | Hidden from every proxy | Clinician judgment (e.g. safety, teen request). |
| Client turns 18 | Proxy access granted while the client was a minor **ends automatically** (each request + nightly job `scripts/portal-proxy-expiry.ts`); the client is invited to their own login | Parental authority ends at majority. If the chart email is the parent's, the job lists the client under `needsOwnEmail` for staff. |
| Adult with a legal guardian / authorized representative | Staff choose full or limited; reason and legal document (guardianship order, POA, health care agent) required | Authority comes from the document, not the relationship. |

What a proxy **can** do: appointments (view, request, cancel, reschedule), documents and consents (view, sign **as representative**, revoke non-Part 2 consents), billing / statements / payments, messages to the care team, resources, view the profile (edit contact details and photo only with full access).

What a proxy **cannot** do or see: items marked confidential, Part 2 content without consent, the client's own message threads (a proxy sees only threads it opened; the client's own login does not see the proxy's threads), mood check-ins and progress, closing the client's account, medications when limited + minor self-consent.

Signatures made by a proxy are always as the representative: the server overrides "Self" with Parent / Legal guardian, the treatment plan stores "Typed Name (Parent)", and the HIPAA audit row records the signing portal user, the link and `signedAsRepresentative`.
Messages a proxy sends are labelled for staff as "Guardian Name (parent of First)".

## Audit

- `PatientAuditLog`: `proxy.login`, `proxy.switch`, `proxy.switch_denied`, `proxy.access` (every proxy request: method + route), `proxy.access_blocked` (feature not allowed), `proxy.access_denied` (link ended), `proxy.aged_out`, `proxy.expired`, each with `portalAccessId` + `relationship`.
- HIPAA `AuditLog`: `LOGIN` / `PORTAL_SWITCH` with `actorRole = PATIENT_PROXY`; staff actions `PORTAL_PROXY_GRANT | VERIFY | REVOKE | LEVEL | RESEND_INVITE | CONVERT_SELF`, `PORTAL_ITEM_VISIBILITY`, `PORTAL_MINOR_SELF_CONSENT`; nightly `PORTAL_PROXY_EXPIRY`.
- Invites and "access added" emails to guardians carry **no PHI** (no child name, service, clinician or location).

## Staff workflow (client chart → Summary → "Portal access")

1. Make sure the chart has a date of birth.
2. **Add guardian / representative**: guardian's full name, the guardian's own email, relationship, access level (age default shown), reason when not the default (always for adults).
3. **Verify authority** before activation: photo ID (in person or video) and relationship; for legal guardians, custody, POA or adults, the legal document reference. Tick "I verified … now" or use **Record verification** later. Unverified access stays inactive.
4. The guardian gets an invitation (new login) or an "access added" email (existing login). One login covers every linked child; the portal header shows **Viewing: Child ▾** and an "Acting as parent for …" banner.
5. **Revoke** takes effect on the guardian's next request. **Make limited / full** needs a reason.
6. If a child's own portal login was created with the parent's email (common before this feature), use **Convert to guardian login** on that child's chart: the login keeps its email and password and becomes the parent's guardian login; then add the siblings with the same email.
7. Clinicians can mark individual items **Confidential** or **Shared with guardian** under "What the guardian sees", and tick the minor self-consent box.

## Rollout

1. `scripts/migrate.sh` (applies `20261021_portal_proxy_access.sql`; idempotent).
2. `npx tsx --env-file=.env scripts/migrate-portal-proxy-access.ts` (dry run: counts + review list), then `--apply` to create explicit self links. Optional: nothing breaks without it.
3. Install the cron line in `deploy/crontab.staging` (06:30 UTC `scripts/portal-proxy-expiry.ts`).
