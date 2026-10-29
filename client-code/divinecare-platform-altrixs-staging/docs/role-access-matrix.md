# Role access matrix

Who can open what in Altrixs, by role. The source of truth is code:

- Pages: `PATH_ACCESS` / `canAccessPath` in `src/lib/auth/roleAccess.ts`. The proxy (`src/proxy.ts`), the dashboard layout, `DashboardShell` and the sidebar all use it.
- APIs: `API_PATH_ACCESS` / `canAccessApiPath` in the same file. The proxy applies it to every signed-in `/api` request; public APIs (patient app, booking, intake links, telehealth join, webhooks) are excluded. After that, each route runs its own checks (caseload or care-team scope, 42 CFR Part 2, prescriber, `requireFullAdmin`, and so on).
- `tests/role-matrix.test.ts` encodes every table below, so a change to any role's access fails a test until this document and the test are updated together.

Legend: **Y** = allowed, **·** = refused. "View/edit" splits are in the helper table. Caseload roles (THR, CLN, PSY, NP, PRP, CM, PEER, CRI) only see clients assigned to them. Primary care roles (PHY, MNP, MA) see clients on their care team: assigned, treatment team, or a visit or appointment with them. Protected (Part 2 / sensitive) records add whitelist and break-the-glass rules on top.

| Abbr | Role | Abbr | Role |
|---|---|---|---|
| ADM | ADMIN | PSY | PSYCHIATRIST |
| DIR | DIRECTOR (legacy leadership alias) | NP | NP (psychiatric nurse practitioner, prescriber) |
| PD | PRACTICE_DIRECTOR | PRP | PRP_SPECIALIST |
| OM | OFFICE_MANAGER | CM | CASE_MANAGER |
| FD | FRONT_DESK | PEER | PEER_SUPPORT |
| BIL | BILLING | CRI | CRISIS_RESPONDER |
| HR | HR | PHY | PHYSICIAN (primary care) |
| THR | THERAPIST | MNP | MEDICAL_NP (primary care NP) |
| CLN | CLINICIAN (legacy licensed alias) | MA | MEDICAL_ASSISTANT |

The platform admin (SUPER_ADMIN) is not a clinic role. Every `/dashboard` URL redirects them to `/platform`, and `requireOrgContext` refuses them on clinic APIs.

## Landing page per role

`homePathForRole` is now used on every sign-in, on `/dashboard` (server redirect in the proxy, with a client fallback in `src/app/dashboard/page.tsx`), on role switch (RoleSwitcher), when a signed-in user opens `/login` or `/`, when a non-platform role opens `/platform`, and whenever a page is blocked. A `?callbackUrl=` is followed only when it is a same-site `/dashboard/*` page that the role can open (`postLoginPath`). Absolute or protocol-relative URLs, encoded slashes and pages the role cannot open all fall back to the role home.

| Role | Before | After |
|---|---|---|
| ADMIN, DIRECTOR, PRACTICE_DIRECTOR | `/dashboard` (admin home) | same |
| OFFICE_MANAGER, FRONT_DESK, BILLING, HR | `/dashboard` (their role home) | same |
| THERAPIST, CLINICIAN | `/dashboard` (therapist home) | same |
| PSYCHIATRIST, **NP** (psychiatric) | `/dashboard` (prescriber home) | same: `/dashboard`, prescriber home (PsychRoleHome) |
| PRP_SPECIALIST, CASE_MANAGER, PEER_SUPPORT | `/dashboard` (their role home) | same |
| **PHYSICIAN, MEDICAL_NP** | login went to `/dashboard`, the therapist-style page rendered first, then a client-side `router.replace` to `/dashboard/medical`; any callbackUrl was ignored | **`/dashboard/medical`** (primary care overview), redirected server-side before anything renders |
| **MEDICAL_ASSISTANT** | `/dashboard`, which rendered the **behavioral-health therapist home** | **`/dashboard/medical`** |
| **CRISIS_RESPONDER** | `/dashboard`, which rendered the therapist home | **`/dashboard/crisis`** |
| SUPER_ADMIN | `/platform` | same |
| Any role on a blocked page | bounced to `/dashboard` (a second hop for medical and crisis roles) | straight to the role home |

`/dashboard/medical` no longer redirects to `/dashboard/clients`. It loads `/api/medical/overview`. The old `/dashboard/medical/patients` redirect to `/dashboard/clients?program=medical` is being replaced in a separate change.

## Pages (canAccessPath)

Medical and crisis roles can open `/dashboard`, but the proxy sends them to their own home.

| Page | ADM | DIR | PD | OM | FD | BIL | HR | THR | CLN | PSY | NP | PRP | CM | PEER | CRI | PHY | MNP | MA |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `/dashboard` | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| `/dashboard/clients` | Y | Y | Y | Y | Y | Y | · | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| `/dashboard/clients/abc` | Y | Y | Y | Y | Y | Y | · | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| `/dashboard/clients/intake` | Y | Y | Y | Y | Y | · | · | · | · | · | · | · | · | · | · | · | · | · |
| `/dashboard/clients/waitlist` | Y | Y | Y | Y | Y | · | · | · | · | · | · | · | · | · | · | · | · | · |
| `/dashboard/appointments` | Y | Y | Y | Y | Y | · | · | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | · |
| `/dashboard/telehealth` | Y | Y | Y | Y | Y | · | · | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| `/dashboard/messages` | Y | Y | Y | Y | Y | · | · | Y | Y | Y | Y | Y | Y | Y | Y | · | · | · |
| `/dashboard/communications` | Y | Y | Y | Y | · | · | · | Y | · | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| `/dashboard/inbox` | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| `/dashboard/tasks` | Y | Y | Y | Y | Y | Y | · | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| `/dashboard/ehr` | Y | Y | Y | · | · | · | · | Y | Y | Y | Y | · | · | · | · | · | · | · |
| `/dashboard/ehr/notes` | Y | Y | Y | · | · | · | · | Y | Y | Y | Y | Y | · | · | · | · | · | · |
| `/dashboard/ehr/note-builder` | Y | Y | Y | · | · | · | · | Y | Y | Y | Y | · | · | · | · | · | · | · |
| `/dashboard/ehr/treatment-plans` | Y | Y | Y | · | · | · | · | Y | Y | Y | Y | Y | · | · | · | · | · | · |
| `/dashboard/ehr/assessments` | Y | Y | Y | · | · | · | · | Y | Y | Y | Y | Y | · | · | · | · | · | · |
| `/dashboard/ehr/assessments/cssrs` | Y | Y | Y | · | · | · | · | Y | Y | Y | Y | · | · | · | · | · | · | · |
| `/dashboard/ehr/evaluations` | Y | Y | Y | · | · | · | · | Y | Y | Y | Y | · | · | · | · | · | · | · |
| `/dashboard/ehr/diagnoses` | Y | Y | Y | · | · | · | · | Y | Y | Y | Y | · | · | · | · | · | · | · |
| `/dashboard/ehr/prescriptions` | Y | Y | Y | · | · | · | · | · | · | Y | Y | · | · | · | · | · | · | · |
| `/dashboard/ehr/labs` | Y | Y | Y | · | · | · | · | Y | Y | Y | Y | · | · | · | · | · | · | · |
| `/dashboard/ehr/safety-plan` | Y | Y | Y | · | · | · | · | Y | Y | Y | Y | Y | Y | · | · | · | · | · |
| `/dashboard/ehr/discharge` | Y | Y | Y | · | · | · | · | Y | Y | Y | Y | · | Y | · | · | · | · | · |
| `/dashboard/ehr/supervisor-review` | Y | Y | Y | · | · | · | · | Y | Y | Y | Y | · | · | · | · | · | · | · |
| `/dashboard/ehr/consents` | Y | Y | Y | Y | Y | · | · | Y | Y | Y | Y | · | · | · | · | · | · | · |
| `/dashboard/ehr/eligibility` | Y | Y | Y | Y | Y | Y | · | Y | Y | Y | Y | · | · | · | · | · | · | · |
| `/dashboard/ehr/hie` | Y | Y | Y | · | · | · | · | Y | Y | Y | Y | Y | Y | · | · | Y | Y | · |
| `/dashboard/ehr/part2` | Y | Y | Y | Y | · | Y | · | Y | Y | Y | Y | Y | · | · | · | · | · | · |
| `/dashboard/ehr/scanner` | · | Y | Y | · | · | · | · | Y | · | Y | Y | · | Y | · | · | · | · | · |
| `/dashboard/ehr/tms-spravato` | Y | Y | Y | · | · | · | · | Y | · | Y | Y | · | · | · | · | · | · | · |
| `/dashboard/ehr/group-sessions` | Y | Y | Y | · | · | · | · | Y | Y | · | · | Y | Y | · | · | · | · | · |
| `/dashboard/ehr/sud-groups` | Y | Y | Y | · | · | · | · | Y | Y | · | · | · | Y | · | · | · | · | · |
| `/dashboard/protected-records` | · | · | Y | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| `/dashboard/medical` | Y | Y | Y | Y | Y | · | · | Y | Y | Y | Y | · | Y | · | · | Y | Y | Y |
| `/dashboard/medical/patients/intake` | Y | Y | Y | Y | Y | · | · | Y | Y | Y | Y | · | Y | · | · | Y | Y | Y |
| `/dashboard/medical/visits` | Y | Y | Y | · | · | · | · | · | Y | Y | Y | · | · | · | · | Y | Y | Y |
| `/dashboard/medical/vitals` | Y | Y | Y | · | · | · | · | · | Y | Y | Y | · | · | · | · | Y | Y | Y |
| `/dashboard/medical/history` | Y | Y | Y | · | · | · | · | · | Y | Y | Y | · | · | · | · | Y | Y | Y |
| `/dashboard/medical/problem-list` | Y | Y | Y | · | · | · | · | · | Y | Y | Y | · | · | · | · | Y | Y | · |
| `/dashboard/medical/preventive-care` | Y | Y | Y | · | · | · | · | · | Y | Y | Y | · | · | · | · | Y | Y | · |
| `/dashboard/medical/labs` | Y | Y | Y | · | · | · | · | Y | Y | Y | Y | · | · | · | · | Y | Y | Y |
| `/dashboard/medical/ai` | Y | Y | Y | · | · | · | · | · | Y | Y | Y | · | · | · | · | Y | Y | Y |
| `/dashboard/medical/billing` | Y | Y | Y | · | · | Y | · | · | · | · | · | · | · | · | · | Y | Y | · |
| `/dashboard/medical/payer-settings` | Y | Y | Y | · | · | Y | · | · | · | · | · | · | · | · | · | · | · | · |
| `/dashboard/billing` | Y | Y | Y | · | · | Y | · | · | · | · | · | · | · | · | · | · | · | · |
| `/dashboard/billing/claims` | Y | Y | Y | · | · | Y | · | · | · | · | · | · | · | · | · | · | · | · |
| `/dashboard/billing/claim-scrubber` | Y | Y | Y | · | · | Y | · | · | · | · | · | · | · | · | · | · | · | · |
| `/dashboard/billing/payments` | Y | Y | Y | Y | Y | Y | · | · | · | · | · | · | · | · | · | · | · | · |
| `/dashboard/billing/superbills` | Y | Y | Y | · | · | Y | · | · | · | · | · | · | · | · | · | · | · | · |
| `/dashboard/billing/denials` | Y | Y | Y | · | · | Y | · | · | · | · | · | · | · | · | · | · | · | · |
| `/dashboard/billing/statements` | Y | Y | Y | Y | · | Y | · | · | · | · | · | · | · | · | · | · | · | · |
| `/dashboard/billing/ar-control` | Y | Y | Y | · | · | Y | · | · | · | · | · | · | · | · | · | · | · | · |
| `/dashboard/billing/valant-balances` | Y | Y | Y | · | · | Y | · | · | · | · | · | · | · | · | · | · | · | · |
| `/dashboard/billing/payer-settings` | Y | Y | Y | · | · | Y | · | · | · | · | · | · | · | · | · | · | · | · |
| `/dashboard/billing/fee-schedule` | Y | Y | Y | · | · | Y | · | · | · | · | · | · | · | · | · | · | · | · |
| `/dashboard/billing/authorizations` | Y | Y | Y | Y | Y | Y | · | Y | Y | Y | Y | · | · | · | · | · | · | · |
| `/dashboard/billing/residential-crisis` | Y | Y | Y | · | · | Y | · | · | · | · | · | · | · | · | · | · | · | · |
| `/dashboard/billing/autopay` | Y | Y | Y | Y | Y | Y | · | · | · | · | · | · | · | · | · | · | · | · |
| `/dashboard/billing/prior-auth` | Y | Y | Y | Y | · | Y | · | Y | Y | Y | Y | · | · | · | · | · | · | · |
| `/dashboard/billing/insurance-companies` | Y | Y | Y | · | · | Y | · | · | · | · | · | · | · | · | · | · | · | · |
| `/dashboard/billing/panels` | Y | Y | Y | · | · | Y | · | · | · | · | · | · | · | · | · | · | · | · |
| `/dashboard/billing/provider-collections` | Y | Y | Y | · | · | Y | · | · | · | · | · | · | · | · | · | · | · | · |
| `/dashboard/billing/clearinghouse` | Y | Y | Y | · | · | Y | · | · | · | · | · | · | · | · | · | · | · | · |
| `/dashboard/coding` | Y | Y | Y | · | · | Y | · | Y | Y | Y | Y | · | · | · | · | · | · | · |
| `/dashboard/reports` | Y | Y | Y | Y | Y | Y | Y | · | · | · | · | · | · | · | · | · | · | · |
| `/dashboard/reports/outcomes` | Y | Y | Y | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| `/dashboard/analytics/schedule` | Y | Y | Y | Y | Y | · | · | · | · | · | · | · | · | · | · | · | · | · |
| `/dashboard/analytics/productivity` | Y | Y | Y | Y | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| `/dashboard/analytics/surveys` | Y | Y | Y | Y | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| `/dashboard/population` | Y | Y | Y | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| `/dashboard/ai-insights` | Y | Y | Y | · | · | · | · | Y | Y | Y | Y | · | · | · | Y | · | · | · |
| `/dashboard/mbc` | Y | Y | Y | · | · | · | · | Y | Y | Y | Y | · | · | · | Y | · | · | · |
| `/dashboard/scribe` | Y | Y | Y | · | · | · | · | Y | Y | Y | Y | · | · | · | Y | · | · | · |
| `/dashboard/hr` | Y | Y | Y | · | · | · | Y | · | · | · | · | · | · | · | · | · | · | · |
| `/dashboard/hr/credentialing` | Y | Y | Y | Y | · | · | Y | · | · | · | · | · | · | · | · | · | · | · |
| `/dashboard/hr/supervision` | Y | Y | Y | Y | · | · | Y | Y | Y | Y | Y | · | · | · | · | · | · | · |
| `/dashboard/hr/training` | Y | Y | Y | Y | · | · | Y | · | · | · | · | · | · | · | · | · | · | · |
| `/dashboard/hr/people` | Y | Y | Y | Y | · | · | Y | · | · | · | · | · | · | · | · | · | · | · |
| `/dashboard/hr/onboarding` | Y | Y | Y | · | · | · | Y | · | · | · | · | · | · | · | · | · | · | · |
| `/dashboard/hr/offboarding` | Y | Y | Y | · | · | · | Y | · | · | · | · | · | · | · | · | · | · | · |
| `/dashboard/hr/time-off` | Y | Y | Y | · | · | · | Y | · | · | · | · | · | · | · | · | · | · | · |
| `/dashboard/hr/performance` | Y | Y | Y | · | · | · | Y | · | · | · | · | · | · | · | · | · | · | · |
| `/dashboard/hr/settings` | Y | Y | Y | · | · | · | Y | · | · | · | · | · | · | · | · | · | · | · |
| `/dashboard/hr/org-chart` | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| `/dashboard/hr/me` | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| `/dashboard/compliance` | Y | Y | Y | Y | · | · | Y | · | · | · | · | · | · | · | · | · | · | · |
| `/dashboard/admin` | Y | Y | Y | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| `/dashboard/admin/audit-log` | Y | · | Y | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| `/dashboard/admin/migration` | Y | Y | Y | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| `/dashboard/admin/scheduling-settings` | Y | Y | Y | Y | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| `/dashboard/subscription` | Y | Y | Y | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| `/dashboard/practice-setup` | Y | Y | Y | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| `/dashboard/enterprise` | Y | Y | Y | Y | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| `/dashboard/settings` | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| `/dashboard/notifications` | Y | Y | Y | Y | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| `/dashboard/alerts` | Y | Y | Y | · | · | · | · | Y | Y | Y | Y | Y | Y | · | Y | · | · | · |
| `/dashboard/crisis` | Y | Y | Y | · | · | · | · | Y | Y | Y | Y | Y | Y | Y | Y | · | · | · |
| `/dashboard/prp` | Y | Y | Y | · | · | · | · | Y | Y | Y | Y | Y | · | · | · | · | · | · |
| `/dashboard/prp/assessment` | Y | Y | Y | · | · | · | · | · | · | · | · | Y | Y | · | · | · | · | · |
| `/dashboard/prp/referral` | Y | Y | Y | · | · | · | · | · | · | Y | Y | · | · | · | · | · | · | · |
| `/dashboard/residential` | Y | Y | Y | · | · | · | · | Y | Y | Y | Y | Y | Y | Y | Y | · | · | · |
| `/dashboard/programs/intensive` | Y | Y | Y | · | · | · | · | Y | Y | Y | Y | · | Y | · | · | · | · | · |
| `/dashboard/programs/intensive/billing` | Y | Y | Y | · | · | Y | · | · | · | · | · | · | · | · | · | · | · | · |
| `/dashboard/aot` | Y | Y | Y | · | · | · | · | Y | Y | Y | Y | Y | Y | Y | Y | · | · | · |
| `/dashboard/community` | Y | Y | Y | Y | · | · | · | · | · | · | · | · | Y | Y | · | · | · | · |
| `/dashboard/community/referrals` | Y | Y | Y | Y | Y | · | · | Y | Y | Y | Y | Y | Y | Y | Y | · | · | · |
| `/dashboard/peer-support` | Y | Y | Y | · | · | · | · | · | · | · | · | Y | Y | Y | · | · | · | · |
| `/dashboard/pr` | Y | Y | Y | Y | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| `/dashboard/incidents` | Y | Y | Y | Y | Y | · | · | Y | Y | Y | Y | Y | Y | · | · | Y | Y | · |
| `/dashboard/grievances` | Y | Y | Y | Y | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| `/dashboard/qi` | Y | Y | Y | Y | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| `/dashboard/resources` | Y | Y | Y | Y | · | · | · | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| `/dashboard/resources/staff` | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| `/dashboard/projects` | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| `/dashboard/sdoh` | Y | Y | Y | · | · | · | · | Y | Y | Y | Y | Y | Y | · | · | · | · | · |
| `/platform` | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |

## API gates enforced by the proxy (canAccessApiPath)

This table shows the proxy gate only. Most `/api/*` prefixes refuse only HR (no client PHI) and leave the rest to the route's own checks, listed in the next table. For example, `GET /api/clients/x/notes` passes the proxy for Front Desk, and the route then returns 403 because `canAccessClientChartNotes` refuses Front Desk. Area APIs (crisis, residential, AOT, PRP, alerts, communications, HR credentialing, billing statements, denials and appeals, medical billing, dashboard overview) now use the same role lists as their pages.

| API (proxy gate) | ADM | DIR | PD | OM | FD | BIL | HR | THR | CLN | PSY | NP | PRP | CM | PEER | CRI | PHY | MNP | MA |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `GET /api/clients` | Y | Y | Y | Y | Y | Y | · | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| `GET /api/clients/x/notes` | Y | Y | Y | Y | Y | Y | · | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| `GET /api/clinical/medications` | Y | Y | Y | Y | Y | Y | · | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| `GET /api/appointments` | Y | Y | Y | Y | Y | Y | · | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| `GET /api/messages` | Y | Y | Y | Y | Y | Y | · | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| `GET /api/billing/claims` | Y | Y | Y | Y | Y | Y | · | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| `GET /api/billing/statements` | Y | Y | Y | Y | · | Y | · | · | · | · | · | · | · | · | · | · | · | · |
| `GET /api/billing/overview`, `/api/billing/ar/*`, `/api/billing/claim-scrub`, `/api/billing/provider-collections`, `/api/billing/valant-archive`, `/api/billing/residential-crisis`, `/api/billing/specialized`, `/api/billing/insurance-companies` | Y | Y | Y | · | · | Y | · | · | · | · | · | · | · | · | · | · | · | · |
| `GET /api/billing/denials` | Y | Y | Y | · | · | Y | · | · | · | · | · | · | · | · | · | · | · | · |
| `POST /api/billing/appeals/draft` | Y | Y | Y | · | · | Y | · | · | · | · | · | · | · | · | · | · | · | · |
| `GET /api/medical/billing/charges` | Y | Y | Y | · | · | Y | · | · | · | · | · | · | · | · | · | Y | Y | · |
| `GET /api/medical/payer-settings` | Y | Y | Y | · | · | Y | · | · | · | · | · | · | · | · | · | · | · | · |
| `GET /api/medical/patients` | Y | Y | Y | Y | Y | Y | · | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| `GET /api/labs/orders` | Y | Y | Y | Y | Y | Y | · | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| `GET /api/prescriptions` | Y | Y | Y | Y | Y | Y | · | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| `GET /api/ehr/notes` | Y | Y | Y | Y | Y | Y | · | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| `GET /api/part2/disclosures` | Y | Y | Y | Y | Y | Y | · | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| `POST /api/sensitive-records/x/break-glass` | Y | Y | Y | Y | Y | Y | · | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| `GET /api/dashboard/overview` | Y | Y | Y | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| `GET /api/reports/library` | Y | Y | Y | Y | Y | Y | Y | · | · | · | · | · | · | · | · | · | · | · |
| `GET /api/crisis/episodes` | Y | Y | Y | · | · | · | · | Y | Y | Y | Y | Y | Y | Y | Y | · | · | · |
| `POST /api/crisis/episodes` | Y | Y | Y | Y | Y | · | · | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| `PUT /api/crisis/episodes/x` | Y | Y | Y | · | · | · | · | Y | Y | Y | Y | Y | Y | Y | Y | · | · | · |
| `POST /api/crisis/paging` | Y | Y | Y | Y | Y | · | · | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| `POST /api/crisis/triage` | Y | Y | Y | · | · | · | · | Y | Y | Y | Y | Y | Y | Y | Y | · | · | · |
| `GET /api/residential/residents` | Y | Y | Y | · | · | · | · | Y | Y | Y | Y | Y | Y | Y | Y | · | · | · |
| `GET /api/intensive/hub` | Y | Y | Y | · | · | · | · | Y | Y | Y | Y | · | Y | · | · | · | · | · |
| `GET /api/intensive/charges` | Y | Y | Y | Y | · | Y | · | · | · | · | · | · | · | · | · | · | · | · |
| `GET /api/aot/participants` | Y | Y | Y | · | · | · | · | Y | Y | Y | Y | Y | Y | Y | Y | · | · | · |
| `GET /api/prp/workflow` | Y | Y | Y | · | · | · | · | Y | Y | Y | Y | Y | Y | · | · | · | · | · |
| `GET /api/alerts` | Y | Y | Y | · | · | · | · | Y | Y | Y | Y | Y | Y | · | Y | · | · | · |
| `GET /api/risk-alerts` | Y | Y | Y | · | · | · | · | Y | Y | Y | Y | Y | Y | · | Y | · | · | · |
| `GET /api/communications/voicemails` | Y | Y | Y | Y | · | · | · | Y | · | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| `POST /api/connect/external-call` | Y | Y | Y | Y | Y | · | · | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| `GET /api/hr/credentialing/intake-grid` | Y | Y | Y | Y | · | · | Y | · | · | · | · | · | · | · | · | · | · | · |
| `PUT /api/hr/credentialing/toggle-doc` | Y | Y | Y | Y | · | · | Y | · | · | · | · | · | · | · | · | · | · | · |
| `GET /api/hr/dashboard` | Y | Y | Y | · | · | · | Y | · | · | · | · | · | · | · | · | · | · | · |
| `GET /api/hr/discipline` | Y | Y | Y | · | · | · | Y | · | · | · | · | · | · | · | · | · | · | · |
| `GET /api/hr/exclusions` | Y | Y | Y | Y | · | · | Y | · | · | · | · | · | · | · | · | · | · | · |
| `PATCH /api/hr/people/x` | Y | Y | Y | Y | · | · | Y | · | · | · | · | · | · | · | · | · | · | · |
| `GET /api/hr/me` | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| `GET /api/hr/credentials` | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| `GET /api/staff` | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| `GET /api/inbox/items` | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| `GET /api/tasks` | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| `GET /api/profile` | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| `GET /api/locations` | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y |

## Route-level helpers (what the API does once past the proxy)

| Helper | ADM | DIR | PD | OM | FD | BIL | HR | THR | CLN | PSY | NP | PRP | CM | PEER | CRI | PHY | MNP | MA |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| client roster | Y | Y | Y | Y | Y | Y | · | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| edit demographics | Y | Y | Y | Y | Y | · | · | Y | Y | Y | Y | Y | Y | · | Y | Y | Y | Y |
| client messages | Y | Y | Y | Y | Y | · | · | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| BH chart notes read | Y | Y | Y | · | · | · | · | Y | Y | Y | Y | Y | Y | · | Y | · | · | · |
| BH chart notes write | Y | Y | Y | · | · | · | · | Y | Y | Y | Y | Y | Y | · | Y | · | · | · |
| chart safety section | Y | Y | Y | · | · | · | · | Y | Y | Y | Y | Y | Y | · | Y | · | · | · |
| labs view | Y | Y | Y | · | · | · | · | Y | Y | Y | Y | · | · | · | · | Y | Y | Y |
| labs order | · | · | · | · | · | · | · | · | · | Y | Y | · | · | · | · | Y | Y | · |
| labs enter results | Y | Y | Y | · | · | · | · | · | Y | Y | Y | · | · | · | · | Y | Y | Y |
| labs review / sign off | · | · | · | · | · | · | · | · | · | Y | Y | · | · | · | · | Y | Y | · |
| prescriptions view | Y | Y | Y | · | · | · | · | · | · | Y | Y | · | · | · | · | Y | Y | · |
| prescriptions write | · | · | · | · | · | · | · | · | · | Y | Y | · | · | · | · | Y | Y | · |
| claims | Y | Y | Y | · | · | Y | · | · | · | · | · | · | · | · | · | · | · | · |
| draft claim from locked note | Y | Y | Y | · | · | Y | · | Y | Y | Y | Y | · | · | · | · | · | · | · |
| patient ledger read | Y | Y | Y | Y | Y | Y | · | · | · | · | · | · | · | · | · | · | · | · |
| patient ledger post | Y | Y | Y | · | · | Y | · | · | · | · | · | · | · | · | · | · | · | · |
| HR corner | Y | Y | Y | · | · | · | Y | · | · | · | · | · | · | · | · | · | · | · |
| Part 2 / sensitive privileged | Y | · | Y | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| break-the-glass | Y | Y | Y | · | · | · | · | Y | Y | Y | Y | · | · | · | · | Y | Y | · |
| medication list, view | Y | Y | Y | · | · | · | · | Y | Y | Y | Y | · | · | · | Y | Y | Y | Y |
| medication list, write | Y | Y | Y | · | · | · | · | Y | Y | Y | Y | · | · | · | · | Y | Y | Y |
| insurance / payer / copay | Y | Y | Y | Y | Y | Y | · | Y | Y | Y | Y | Y | Y | · | Y | Y | Y | Y |
| BH diagnoses on client record / roster | Y | Y | Y | · | · | Y | · | Y | Y | Y | Y | Y | Y | · | Y | · | · | · |
| risk detail + SUD flag on chart banner | Y | Y | Y | · | · | · | · | Y | Y | Y | Y | Y | Y | · | Y | · | · | · |
| check-in scores / notes | Y | Y | Y | · | · | · | · | Y | Y | Y | Y | Y | Y | Y | Y | · | · | · |
| edit BH diagnoses | Y | Y | Y | · | · | · | · | Y | Y | Y | Y | · | · | · | · | · | · | · |
| edit clinical risk level | Y | Y | Y | · | · | · | · | Y | Y | Y | Y | · | · | · | Y | · | · | · |
| check-in entry | Y | Y | Y | Y | Y | · | · | Y | Y | Y | Y | Y | Y | · | Y | · | · | · |
| AI pre-session briefing | Y | Y | Y | · | · | · | · | Y | Y | Y | Y | · | · | · | · | Y | Y | · |
| denials read | Y | Y | Y | · | · | Y | · | · | · | · | · | · | · | · | · | · | · | · |
| denial status change / appeal draft | Y | Y | Y | · | · | Y | · | · | · | · | · | · | · | · | · | · | · | · |
| primary care charge status (mark submitted) | Y | Y | Y | · | · | Y | · | · | · | · | · | · | · | · | · | · | · | · |
| co-sign org-wide | Y | Y | Y | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| co-sign own caseload (plus supervisees) | · | · | · | · | · | · | · | · | · | Y | · | · | · | · | · | · | · | · |
| incident review (org-wide) | Y | Y | Y | Y | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| CRISP HIE launch | Y | Y | Y | · | · | · | · | Y | Y | Y | Y | Y | Y | · | · | Y | Y | · |
| medication reminder details (notifications) | Y | Y | Y | · | · | · | · | Y | Y | Y | Y | · | · | · | Y | Y | Y | Y |
| chart documents: clinical types (notes, intake, consents, labs, measures, other) | Y | Y | Y | · | · | · | · | Y | Y | Y | Y | · | · | · | · | · | · | · |
| chart documents: payment receipts | Y | Y | Y | Y | Y | Y | · | · | · | · | · | · | · | · | · | · | · | · |
| chart documents: patient ID, demographics | Y | Y | Y | Y | Y | Y | · | CT | CT | CT | CT | · | · | · | · | · | · | · |
| void an imported (Valant) chart document, with reason | Y | Y | Y | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |

Chart documents (GET /api/clients/[id]/documents and /api/files/intake-docs, src/lib/migration/valantDocuments.ts canViewChartDocument): CT = only when on the client's care team. The 42 CFR Part 2 / VIP lock applies on top for every role. Imported records are read-only.

A verified Medical Director also has org-wide co-sign and incident review (server flag, not a role). Every supervisor role co-signs its designated supervisees' notes (SupervisionTrack), see "Role audit follow-ups" below.

## Areas at a glance (view / edit / none)

Summary of the tables above, by area. "own" = caseload / care team (assigned, treatment team, or an appointment in the last ~18 months or upcoming). "flag" = the generic risk level on the chart banner (the safety flag), with no alert text, C-SSRS score or SUD flag.

| Area | ADM / PD | DIR | OM | FD | BIL | HR | THR / CLN | PSY / NP | PRP | CM | PEER | CRI | PHY / MNP | MA |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Client list / demographics / insurance | edit | edit | edit | edit | view (+ insurance edit) | none | edit (own) | edit (own) | edit (own) | edit (own) | view (own), no insurance | edit (own) | edit (care team) | edit (care team) |
| BH diagnoses on the client record / roster | edit | edit | none | none (intake entry only) | codes, view | none | edit | edit | view | view | none | view | none (problem list) | none |
| Clinical risk level | edit | edit | flag | flag | flag | none | edit | edit | flag + detail | flag + detail | flag | edit | flag | flag |
| Risk alerts, C-SSRS detail, SUD (Part 2) flag | yes | yes | none | none | none | none | yes | yes | yes | yes | none | yes | none | none |
| Patient check-in scores / notes | yes | yes | none | none (kiosk entry only) | none | none | yes | yes | yes | yes | yes | yes | none | none |
| BH progress notes | edit | edit | none | none | none | none | edit (own) | edit (own) | edit (own) | edit (own) | none | edit (own) | none | none |
| Psychotherapy notes (`ProgressNotePsychotherapyNote`) | author only | author only | none | none | none | none | author only | author only | author only | author only | none | author only | none | none |
| Treatment plans / assessments | edit | edit | none | none | none | none | edit | edit | edit | none | none | none | none | none |
| Medication list / eRx | view | view | none | none | none | none | view, edit list | prescribe | none | none | none | view | prescribe | view, edit list |
| Labs | enter, view | enter, view | none | none | none | none | view (THR), enter (CLN) | order, review | none | none | none | none | order, review | enter, view |
| Primary care visit notes / vitals | edit | edit | none | none | none | none | CLN only | edit | none | none | none | none | edit | edit |
| Primary care charges | edit | edit | none | none | edit | none | none | none | none | none | none | none | own encounters | none |
| BH billing / claims / ledger | edit | edit | patient side only (2026-10-22): post patient payments / copays (no claim link), patient balance as Front Desk sees it, statements, AutoPay, eligibility, authorizations. No claims, A/R, ERA, denials, fees, payer settings, Valant balances or provider collections | patient payments (copays, no claim) and autopay | edit | none | coding, draft claim from own locked note | coding, draft claim | none | none | none | none | none | none |
| Patient messages | all | all | administrative topics + assigned | administrative topics + assigned | none | none | own clients + forwarded | own + forwarded | own + forwarded | own + forwarded | own + forwarded | own + forwarded | API only | API only |
| Crisis board | yes | yes | escalate only | escalate only | none | none | yes | yes | yes | yes (own) | yes (own) | yes (home) | escalate only | escalate only |
| Residential / AOT / PRP boards | yes | yes | none | none | none | none | yes | yes | yes (own) | yes (own) | res. / AOT (own) | res. / AOT | none | none |
| CRISP HIE | yes | yes | none | none | none | none | yes | yes | yes | yes | none | none | yes (care team) | none |
| Part 2 page; disclosure history / accounting | page; read all | page; no disclosure reads | page; record disclosures only (release-of-information desk) | none (by decision, see below) | page; record disclosures only | none | page; read for own caseload | page; read for own caseload | page; read for own caseload | none | none | none | none | none |
| Voicemails (Communications) | all, re-route | all, re-route | all, re-route | none | none | none | routed to them (THR) | routed to them | routed to them | routed to them | routed to them | routed to them | routed to them | routed to them |
| Service scanner / SUD radar | PD only | yes | none | none | none | none | THR | yes | none | yes | none | none | none | none |
| HR / staff / credentials | edit | edit | credentialing, training, own supervision | none | none | edit (no case content in supervision logs) | own supervision | own supervision | none | none | none | none | none | none |
| Admin / settings / subscription | edit | edit (no audit log) | scheduling settings | none | none | none | none | none | none | none | none | none | none | none |
| HIPAA audit log | yes | none | none | none | none | none | none | none | none | none | none | none | none | none |
| Practice reports / analytics | yes | yes | ops (report library) + prior-auth utilization; no financial / A-R / payer reports, no Outcomes & Reports page | schedule / no-show ops | financial | HR reports (no PHI) | none | none (Medical Director: clinical oversight) | none | none | none | none | none | none |

DIRECTOR is the legacy leadership alias: everything ADMIN gets except the HIPAA audit log and Part 2 privileged actions (`requireFullAdmin` / `isSensitivePrivilegedRole` are ADMIN and PRACTICE_DIRECTOR only). It keeps org-wide message access.

## Least-privilege review (Oct 20 2026)

Benchmarked against HIPAA minimum necessary (45 CFR 164.502(b), 164.514(d)), 42 CFR Part 2 and the role models of Valant, TherapyNotes, athenaOne and Netsmart. Owner decisions kept: providers run no practice reports; a verified Medical Director gets org-wide clinical oversight; clinicians see their care-team clients only (`clientAccessWhere`, not loosened); HR sees no client PHI; Billing sees claims, payments, demographics, insurance and diagnosis codes but no clinical notes.

### Page / API rule changes (role -> removed access, reason)

| Role | Removed | Reason |
|---|---|---|
| OFFICE_MANAGER | Risk Alerts page + `/api/alerts`, `/api/risk-alerts`, chart "Safety plan & risk" section, risk-alert tasks | Alert descriptions and C-SSRS are clinical; OM keeps the safety flag and can still open a crisis episode / page |
| OFFICE_MANAGER | Crisis board (GET / PUT / triage), Residential, AOT, PRP pages and APIs | Clinical program boards (ASAM residential is 42 CFR Part 2; AOT holds court and MSE content) |
| OFFICE_MANAGER | Service Eligibility Scanner + SUD Referral Radar | Org-wide screen of signed-note language for substance use |
| OFFICE_MANAGER | CRISP HIE page + launch | Outside clinical records need a treatment relationship |
| OFFICE_MANAGER | `/dashboard/hr` (HR corner) | Personnel roster / payroll exports; the API already refused OM (page was empty). OM keeps credentialing, training and own supervision |
| OFFICE_MANAGER, HR | Practice-admin modules (`admin-integrations` with API keys, `admin-notification-rules`, `admin-compliance`) | Same people as `/dashboard/admin` |
| HR, OFFICE_MANAGER, DIRECTOR | `admin-audit-log` module | Audit log is ADMIN / PRACTICE_DIRECTOR |
| everyone but ADMIN / PD | Legacy `part2-audit` module (read); everyone (write) | Part 2 audit trail is privileged and read-only |
| FRONT_DESK | `/dashboard/ehr/part2` (Part 2 roster, disclosures) | The roster itself identifies SUD patients; consents stay on `/dashboard/ehr/consents` |
| FRONT_DESK, OFFICE_MANAGER | BH diagnoses and check-in scores / notes on the client record and roster; diagnosis-code search | Not needed for scheduling or eligibility |
| FRONT_DESK, OFFICE_MANAGER, BILLING, primary care | C-SSRS score, alert text, open-alert count and the SUD flag on the chart banner | Risk detail and Part 2 status are clinical; the risk level stays as the safety flag |
| FRONT_DESK, OFFICE_MANAGER, PRP, CM, CRI, primary care | Editing BH diagnoses on the profile (CRI keeps the risk level) | Diagnosing is outside their scope; the field is dropped server-side and hidden in the form |
| FRONT_DESK, OFFICE_MANAGER | Clinical and Rx-refill message threads | Administrative topics (scheduling, billing, general) plus threads forwarded / assigned to them |
| CASE_MANAGER | BH Labs and primary care Labs | Labs are prescriber / licensed-clinician data |
| PEER_SUPPORT | CRISP HIE page + launch | Minimum necessary |
| THERAPIST | Patient ledger API (`canReadLedger`), clinic billing modules (invoices, superbills, autopay) | No clinician role works the ledger |
| THR, CLN, PSY, NP, CM, FD, MA | Primary care charges and payer settings | Charge capture is billing work; physicians / medical NPs keep their own encounters |
| THR, CLN, PSY, NP, CRI | `/dashboard/billing/residential-crisis` (org-wide billing queue) | Billing work queue; providers document the services |
| FRONT_DESK, MEDICAL_ASSISTANT, PHYSICIAN, MEDICAL_NP | Primary care payer settings | Payer table is billing configuration (BH payer settings already excluded them) |

Added: `/api/medical/payer-settings` now has a proxy rule (same roles as the page). `/dashboard/hr/training` is matched before `/dashboard/hr`.

### Data-level leaks fixed

1. **Tasks (`/api/tasks`, inbox "My To-Do")**: each task feed now follows the page it links to (`taskSourcesForRole`). Front Desk, Billing, Peer Support, Office Manager and primary care no longer get risk-alert descriptions; treatment-plan tasks no longer carry a diagnosis code and go only to plan roles; intake / waitlist tasks only to the front office and leadership; claims and denials only to billing roles; draft / missing-note tasks only to note writers. The "completed visit without a note" and "no-show" feeds no longer add every org appointment for caseload roles (`clinician: { organizationId }` branch removed). Tasks about protected (Part 2 / VIP) clients are masked (fail closed), and the list is audited.
2. **Client roster and record (`GET /api/clients`, `GET /api/clients/[id]`)**: diagnoses, check-in scores and the patient's check-in notes are role-gated (`canSeeClientDiagnoses`, `canSeeClientCheckIns`); the roster also hid BH diagnoses from primary care inconsistently (record hid them, roster did not). PATCH drops diagnosis / risk fields for roles that cannot set them.
3. **Chart banner**: risk detail and the SUD flag only for `canSeeClientRiskDetail` roles.
4. **Messages**: Front Desk / Office Manager threads limited to administrative topics or threads assigned to them; protected clients' threads dropped from lists and refused on open (`assertClientPhiAccess`); forwarded / assigned matching is exact (case-insensitive) everywhere, including the chart and note rules ("Ann" used to match "Joanne" and open her chart).
5. **Supervision logs**: case references and topics are returned only to the supervisor and supervisee (HR and leadership keep hours, dates and signatures); HR / leadership can no longer sign on someone's behalf.
6. **Service scanner / SUD radar**: see above (OM had an org-wide view of substance-use language in notes).
7. **Clinic modules**: practice-admin modules, admin audit log and legacy Part 2 audit, see above.

Route-level fixes made in the same review by the billing, HR / admin and clinical sweeps are listed in the report for this pass (`tests/billing-role-hardening.test.ts`, `tests/admin-hr-hardening.test.ts`, `tests/clinical-route-hardening.test.ts`, `tests/clinical-scope-hardening.test.ts`).

### Judgment calls (industry standard chosen)

- Therapists keep view-only labs for their own clients (urine drug screens, lithium / clozapine levels are part of BH treatment); case managers lose labs.
- Billing keeps BH diagnosis codes on the roster (claims need them) but not check-ins or risk detail.
- Front Desk keeps the generic risk level (safety flag) and can still enter diagnoses from a referral at intake (`createClient`); after intake, diagnoses are clinician-owned.
- Office Manager keeps the Part 2 page (release-of-information custodian), payments, statements, credentialing, training and scheduling settings; loses clinical boards. (A/R and denials removed 2026-10-22, see below.)
- Crisis responders may change the risk level but not diagnoses.
- ADMIN stays off the Service Eligibility Scanner (existing rule, encoded in three tests); DIRECTOR / PRACTICE_DIRECTOR have it.

## Role audit follow-ups (Oct 22 2026, decisions made by industry standard)

1. **Incident reports (relational).** Incidents moved from the org-wide `ClinicModuleState` list `incidents` to the `IncidentReport` table (migration `20261022_roles_followup_incidents.sql`; `src/lib/incidents/*`; `GET/POST /api/incidents`, `PATCH /api/incidents/[id]`; the page keeps its UI and adds a "Staff involved" picker). Every role that opens `/dashboard/incidents` can file. Leadership (ADMIN, DIRECTOR, PRACTICE_DIRECTOR), OFFICE_MANAGER (operations / risk) and a verified Medical Director review every report. Everyone else sees only reports they filed, that name them as involved staff, or that are assigned to them. Investigation fields and status: reviewers or the assigned investigator. Assignment and involved staff: reviewers only. The reporter cannot rewrite a filed report. The server sets the reporter and the INC number. Reports linked to a client hide Part 2 / sensitive clients the caller cannot open. The generic module route no longer serves `incidents`. The CARF scorecard and the report library read the table. Copy the old list with `npx tsx scripts/migrate-incidents-blob.ts` (dry run by default, `--apply` to write). Reporter and assignee names are linked to a user only on a unique exact match; a legacy report with no linked reporter is visible to reviewers only.
2. **Per-client module lists (caseload scoped).** `/api/modules/[module]` now scopes every module that holds per-client records (`src/lib/modules/clientScope.ts`): `ehr-safety-plans`, `ehr-discharge-cases`, `part2-clients`, `outcome-schedules`, `outcome-responses`, `mbc-schedules`, `patient-surveys`, `ehr-overview-revals`, `sdoh-screenings`, `prp-participants`, `ai-insights`, `ai-session-history`, `scribe-accepted-suggestions`, `assessment-due`, `mandatory-reporting`, `prior-auth`, `referrals`, `referral-audit` and the legacy `diagnoses`, `evaluations`, `locus`, `prescriptions`, `prescription-refills` lists. GET returns only items whose client the caller may open (`clientAccessWhere`), minus locked Part 2 / sensitive clients (`lockedSensitiveClientIds`). PUT refuses (403, audited DENIED) an item for a client outside that scope, or an item reusing a hidden item's id; items the caller cannot see are merged back unchanged. Items with no client link (legacy, name only) are shown to org-wide roles only. New discharge cases now carry `clientId` (and the chart DOB instead of a made-up one). Link legacy items with `npx tsx scripts/backfill-module-client-ids.ts` (dry run by default, `--apply`; unique exact name match only). These lists were filtered, not migrated to tables (the fallback): server-side readers (chart, CARF scorecard, risk watch, insights, reports, visit guide) already filter per client. Billing modules (claims, invoices, superbills, autopay) stay org-wide by design.
3. **CRISP HIE for primary care.** PHYSICIAN and MEDICAL_NP open `/dashboard/ehr/hie` and may launch CRISP (`LAUNCH_ROLES`). The launch is caseload / care-team scoped through `gateClientRoute`, the same as for the BH prescribers. Medical Assistants still do not.
4. **Notifications page.** Office Manager keeps `/dashboard/notifications`, but medication reminder details (drug name, dose, instructions) are masked server-side in `/api/admin/notifications` for roles without `canViewClientMedications` (`masked: true`). Medication-reminder pushes from those roles are refused (403), and the page hides the prescribe / dose-tracker tab.
5. **Co-sign authority.** Leadership and a verified Medical Director co-sign org-wide (a primary care director still cannot be the supervisor signature for a pre-licensed BH author). A PSYCHIATRIST without the flag co-signs only notes and plans by their supervisees (`SupervisionTrack`) or for clients on their caseload. NP, THERAPIST and CLINICIAN co-sign only for their supervisees. The review queue lists only what the viewer may co-sign. Co-signing a Part 2 / VIP record needs whitelist or break-the-glass access. Denials are audited.
6. **Office Manager read-only on claims.** OFFICE_MANAGER can no longer change a denial status or draft an AI appeal (`canUpdateDenialStatus`). The OM exception in the 276 claim-status request is removed. OM still reads denials, A/R, the scrubber snapshot, the clearinghouse page and claim details, and keeps A/R follow-up calls, statements and patient payment posting. Superseded 2026-10-22: OM no longer reads any of the payer side (see "2026-10-22 owner: Office Manager patient-side billing only").
7. **Buttons follow the API.** Pages hide controls the role cannot use, with the same pure helpers as the routes (`src/lib/billing/billingAccess.ts`). Hidden for OM: claim editor Save, Claim Scrubber re-scrub / submit, A/R resubmit and Sync ERA, denial status / appeal controls, clearinghouse retrieval / 276 / ERA posting, and New Claim, Submit / Resubmit, batch submit and 277 on the billing hub. On medical billing, "Mark submitted" is hidden for PHYSICIAN, MEDICAL_NP and OM (`canUpdateMedicalChargeStatus`); providers keep New Claim Entry for their own visits.
8. **DrFirst list mode.** `GET /api/drfirst/review-status` and `/api/drfirst/pdmp-events` without `?patient` list only clients on the prescriber's caseload (`drFirstCaseloadClientIds`: `clientAccessWhere` plus the Part 2 lock). ADMIN and a verified Medical Director stay org-wide. Every downloaded row is still stored (the practice compliance trail). Other rows are only counted (`notListed`). If the scope lookup fails, the route returns 503 and stores nothing.
9. **Front Desk and Part 2 disclosures: unchanged by decision.** OFFICE_MANAGER is the release-of-information custodian and records Part 2 disclosures on `/dashboard/ehr/part2`; Billing records payment disclosures under a 42 CFR 2.31 consent. Front Desk does not open the Part 2 page (the roster identifies SUD patients) and routes release requests to the Office Manager; consent packets stay on `/dashboard/ehr/consents`.

## Open questions for the owner

Still open from the Oct 20 review (questions 1-5, 11 and 12 are closed above):

1. **Residential census.** `ResidentialResident` has no `organizationId`; residents not linked to a client are hidden from everyone until the column is added (migration).
2. **DrFirst staff user type.** Admins can open DrFirst only with their own Rcopia username and only on message / report screens; a DrFirst "staff" user type for front-office refill handling is future work.
3. **Primary care messages and calendar**, and **CLINICIAN on Communications**, are unchanged.
4. **ADMIN on the Service Eligibility Scanner.** ADMIN stays off it (existing rule). Confirm, or give ADMIN the same access as the Practice Director.
5. **Residential admissions now need a client chart.** The admit form still uses demo names and sends no client id, so admitting is refused until the page gets a real chart picker.
6. **Clinician claim from note.** A clinician's draft claim from their own locked note stays DRAFT (mark-ready is dropped); the Coding page still shows "ready" locally.
7. **Office Manager ledger adjustments (resolved).** `canMutateLedger` is billing core only (ADMIN, DIRECTOR, PRACTICE_DIRECTOR, BILLING). Adjustments / write-offs, payer bulk batches, payment plans and stored-card charges refuse OFFICE_MANAGER and FRONT_DESK. Both post patient payments only (card, cash, check, ACH, no claim link) through `paymentPostDecision`; billing applies them to claims. Valant opening-balance posting (`canPostValantLedger`) kept OFFICE_MANAGER for the cutover import until 2026-10-22; it is now billing + leadership only.

## Earlier pass (Oct 18-19 2026): landing pages and first leak sweep

Landing:

1. `homePathForRole` now sets the landing page on credentials login (`LoginForm`, through the new `postLoginPath`, which honours a permitted callbackUrl), on `/dashboard` (proxy server redirect plus a client fallback), for a signed-in user on `/login` or `/`, for a non-platform role on `/platform`, and for any blocked page. Before, login always went to `/dashboard` and ignored the callbackUrl, and only PHYSICIAN / MEDICAL_NP were redirected, client-side, after the page rendered. MEDICAL_ASSISTANT and CRISIS_RESPONDER saw the therapist home.

Leaks fixed (the API allowed what the page or the minimum-necessary rule hides):

2. **Front Desk and Office Manager read full BH progress-note bodies** through the chart Notes tab and `GET /api/clients/[id]/notes` (and addenda). Both are now refused, matching `/dashboard/ehr/notes`. Office Manager could also **write** chart notes (`canWriteClientChartNotes` used `isClinicalStaff`, which includes OM); that is refused too. Office (administrative) notes are unchanged.
3. **Chart "Safety plan & risk" section** (risk alert descriptions, C-SSRS scores, safety plans) was returned to every chart viewer, including Front Desk, Billing and Peer Support. It is now limited to the Risk Alerts / Safety Plan page roles, and the chart tab is hidden for everyone else.
4. **Crisis, Residential and AOT APIs** (`/api/crisis/*`, `/api/residential/*`, `/api/aot/*`) had no role check, so any staff role, including HR and Billing, could list crisis episodes, residents and AOT participants. They now use the page roles. Opening a crisis episode and paging (`POST /api/crisis/episodes`, `POST /api/crisis/paging`, used from telehealth and Communications) stay open to every clinic role except HR and Billing, so a safety escalation is never blocked.
5. **Risk alerts API** (`GET /api/alerts`, `/api/risk-alerts/summary`) returned org-wide risk alerts with client names to HR, Billing and Front Desk (their client scope is the whole org). Medical roles got their care team's psychiatric alerts, which their access rule excludes. Both are now limited to the Risk Alerts page roles.
6. **`/api/dashboard/overview`** returned org-wide alerts, today's appointments and client names to any role. No page uses it. It is now leadership only.
7. **HR could call client-PHI APIs.** Several routes check only the org, and `clientAccessWhere` gives non-caseload roles the whole org (for example `/api/clinical/medications`). HR is now refused at the proxy on every client-PHI prefix: clients, clinical, ehr, notes, assessments, appointments, messages, telehealth, medical, labs, prescriptions, prescribing, DrFirst, eligibility, consents, sdoh, tms, spravato, sensitive-records, part2, waitlist, intake, referrals, comprehend, textract, healthlake, agents, billing, waystar.
8. **HR credentialing grid and toggle** (`/api/hr/credentialing/intake-grid`, `toggle-doc`) had no role check, so any staff role could change provider payer-enrollment checklists. They now use the HR page roles.
9. **Billing statements / denials / appeals, PRP workflow, voicemails and calls** (`/api/billing/statements/generate`, `/api/billing/denials/[id]/status`, `/api/billing/appeals/draft`, `/api/prp/*`, `/api/communications/voicemails`, `/api/connect/*`) checked only the org. They now use the page roles. `/api/medical/billing/*` now uses the medical billing page roles.
10. **Break-the-glass** into a Part 2 / sensitive record was open to any role, including HR, Billing, Front Desk and Office Manager. It is now limited to treating roles (`canBreakGlass`). Refusals are audited as DENIED.
11. **`/dashboard/notifications`** (patient push console and medication reminder schedules) was open to every staff role through the `/dashboard` fallback, while its API only allows leadership and OM. The page now uses the same roles as the API. A page for clinicians would have been broken, because the admin notifications API refuses them.

Broken pages fixed (the page opened but the API refused):

12. `/dashboard/medical/labs`: Front Desk and Office Manager could open it but every lab API call was refused. The page now uses the lab API readers.
13. `/dashboard/hr` (HR corner): Practice Director could open it, but `canAccessHrCorner` refused them. PD has been added to the API.
14. `/dashboard/settings` (My profile): physician, medical NP and medical assistant could not open their own profile or password page. Every staff role can now.
15. `canGenerateDraftClaim` was missing PRACTICE_DIRECTOR, who can open Coding. Added.

Files: `src/lib/auth/roleAccess.ts`, `src/proxy.ts`, `src/features/auth/components/LoginForm.tsx`, `src/app/dashboard/page.tsx`, `src/lib/clients/orgScope.ts`, `src/lib/clients/chartSectionAccess.ts`, `src/app/dashboard/clients/[id]/page.tsx` (one line: safety tab visibility), `src/app/api/sensitive-records/[clientId]/break-glass/route.ts`, `src/lib/hr/corner.ts`, `src/lib/billing/claims.ts`, `tests/role-matrix.test.ts` (new), `tests/role-access.test.ts`, `package.json` (adds the new test to `npm test`).

## Follow-up hardening (peer support sweep, stub charges)

- One-client clinical APIs now run the role rule and then the chart rule (org, Part 2, caseload / care team), with denials audited (`src/lib/clients/clientRouteGate.ts`): `GET/POST /api/clients/[id]/medications`, `GET /api/clients/[id]/safety-check`, `GET /api/drfirst/medications`, `GET/POST /api/telehealth/in-call` (session clinician, or a BH-notes role with chart access), `GET/PATCH /api/telehealth/room/[appointmentId]` (appointment in org; clinician or appointment role with chart access), `POST /fhir/launch` (chart rule; `demo-*` ids only in DEMO_MODE).
- `POST /api/clients/[id]/briefing`: licensed clinicians / prescribers, primary care providers and leadership only. Chart access and AI consent are still checked by the pre-visit service.
- Peer Support: caseload = assigned OR on the treatment team (`clientAccessWhere`, chart banner, `GET /api/clients/[id]`). No diagnoses, insurance or copay on the client record or roster (and no diagnosis-code search). The banner shows no payer or authorization, no C-SSRS score or alert detail and no SUD flag, but keeps the overall risk level (the high-risk safety flag). The chart API gives peers no sections.
- Chart sections are deny-by-default (explicit rule per section).
- Check-in entry: Peer Support, Billing, HR and primary care roles are refused. Medication add: leadership, licensed BH and the primary care team only.
- Break-the-glass: leadership and licensed treating clinicians / prescribers only. Non-leadership roles only for a client already on their caseload / care team.
- Crisis episodes, residential residents and AOT participants lists: Peer Support, Case Manager and PRP see only rows linked to their caseload (licensed, crisis, leadership and Office Manager see the org board).
- The referrals module data uses the referrals page roles (Peer Support included). The care-team POST refuses a duplicate member.
- Stub (no-money) charges: only with `NODE_ENV=development` and `ALLOW_STUB_CHARGES=1` and Stripe not configured (`ledger.stubChargesAllowed`). Otherwise `POST /api/billing/payments/charge` returns 403 (audited DENIED), and `POST /api/billing/payments` refuses method `STUB`.

## 2026-10-22 owner: Office Manager patient-side billing only

Industry standard (Valant, TherapyNotes, athenaOne): payer A/R, claims, provider revenue and fees belong to Billing and leadership (ADMIN, DIRECTOR, PRACTICE_DIRECTOR). The Office Manager runs the front office and the patient side of billing. Nothing changed for Front Desk, Billing or leadership. Tests: `tests/office-manager-patient-billing.test.ts`, `tests/role-matrix.test.ts`.

| Office Manager keeps | Office Manager loses |
|---|---|
| Payments & deposits (`/dashboard/billing/payments`, `/api/billing/payments`): patient payments and copays only (card, cash, check, ACH, no claim link; `paymentPostDecision`, same as Front Desk) | Billing overview (`/dashboard/billing`, `/api/billing/overview`) and the clearinghouse page |
| eStatements (`/dashboard/billing/statements`, `/api/billing/statements`) | A/R Control Center (`/dashboard/billing/ar-control`, `/api/billing/ar/*`, `arControl.ts` AR_ROLES) |
| AutoPay (`/dashboard/billing/autopay`, `/api/billing/autopay/*`) | Claim Scrubber (`/dashboard/billing/claim-scrubber`, `/api/billing/claim-scrub`, SCRUB_ROLES) |
| Eligibility (`/dashboard/ehr/eligibility`) and Authorizations / prior auth (`/dashboard/billing/authorizations`, `/dashboard/billing/prior-auth`, `/dashboard/prior-auth`, `/api/billing/prior-auth`) | Denials and appeals (`/dashboard/billing/denials`, `/api/billing/denials`, `/api/billing/appeals`), claim detail, Waystar inbound / remit review, `requireBillingSession` |
| Patient balance as Front Desk sees it (`canReadLedger` / LEDGER_READ unchanged; `/api/billing/patient-balance/[clientId]` through the payments page; copay rules) | Provider Collections, Valant Balances (incl. the billing archive and Valant ledger posting, `canPostValantLedger`) |
| "Copays not posted today" on the office operations panel and the front desk huddle | Fee schedule, BH payer settings, Medical payer settings, Insurance panels, Insurance companies, Superbills (pages and the `superbills` / `payer-panels` modules) |
| Report library operational reports (schedule, no-shows, census, waitlist, compliance logs) and prior-auth utilization (units, no dollars) | Residential & Crisis billing, IOP / PHP charge drafts (`/api/intensive/charges`), primary care charges (`/dashboard/medical/billing`) |
| | Every financial / A-R / revenue / collections / payer report in the library, the Outcomes & Reports page (every tab carries practice revenue KPIs) and the billing library links |

Decisions made here: the Insurance companies list is removed for OM (front-office intake types the payer on the insurance card and never opens it; the page shows Valant A/R usage per payer). Primary care charges go with the rest of the payer side (`canReadBillingQueue` no longer includes OM). The OM sidebar now links Payments, Statements and AutoPay.

## Intensive programs (IOP / PHP), Oct 22 2026

- `/dashboard/programs/intensive` and `/api/intensive/*`: leadership (program director view: census, attendance %, under-minimum, auths, follow-up, outcomes with small-cell suppression) plus the treating team (Therapist, Clinician, Psychiatrist, NP, Case Manager). PRP specialists and peer support are out (SUD IOP is 42 CFR Part 2); Office Manager, Front Desk, Billing and HR are out.
- Inside the module (`src/lib/intensive/access.ts`): non-leadership roles see enrollments where they are on the program team (primary clinician, psychiatrist / NP, case manager) or the client is in their caseload (`clientAccessWhere`). Providers get no practice rollups. SUD (Part 2) enrollments: SUD-group roles, plus a psychiatrist / NP named on the program team. Protected-record locks apply on top.
- Program setup and policy confirmation: leadership only. Screening / admission / discharge / weekly review: licensed staff and leadership; the PHP prescriber review: Psychiatrist / NP only. Case managers record attendance, referrals and outreach.
- `/dashboard/programs/intensive/billing` and `/api/intensive/charges`: Billing + leadership generate, read and void charge drafts (Office Manager read them until 2026-10-22). Drafts are never submitted from the module.

## HR hub (Oct 22, src/lib/hr/standard.ts)

One HR hub at `/dashboard/hr` with tabs (each its own URL, shown only when the role can open it): Dashboard, People, Credentialing, Onboarding, Offboarding, Training, Time off, Performance, Supervision, Org chart, Settings, My HR.

- **My HR** (`/dashboard/hr/me`, every staff role): own record without pay data, own credentials / expirations, trainings and CEUs, time off, documents (uploads pending HR review), onboarding tasks and policy e-acknowledgments, profile edits as change requests that HR approves. Supervisors also get "My team": their direct reports' (or clinical supervisees') work data, time-off approvals, reviews and goals.
- **Org chart / directory** (every staff role): names, titles, locations, programs, work contact, reporting lines. Headcount and turnover only for HR + leadership.
- **Employee record** (`/api/hr/people/[userId]`): HR + leadership see everything; Office Manager sees employment, credentials, training and credential documents (no pay, payroll, personal data or discipline); the employee sees their own record without compensation; a manager / clinical supervisor sees their reports' employment, credentials, training, time off and performance; anyone else is refused (403, audited).
- **Compensation summary** (pay type, rate, payroll system and employee id) and **corrective action**: HR + leadership only. No SSN or bank data is stored; payroll keeps them.
- Every sensitive read (`READ hrEmployee`, documents, discipline) and every write is in the HIPAA audit log with ids and field names only.
