# Homebase integration (read-only)

Homebase is the practice's payroll and timekeeping vendor. Homebase stays the **system of record
for pay and time**. Altrixs only **reads** from Homebase and shows the data to HR and leadership in
**HR > Homebase** (`/dashboard/hr/homebase`) and on each staff member's HR record
(**People > person > Hours (Homebase)**).

Code: `src/lib/hr/homebase/*`, APIs `src/app/api/hr/homebase/*`, UI `src/components/hr/HomebaseHub.tsx`
and `HomebaseStaffPanel.tsx`, cron script `scripts/homebase-sync.ts`, migration
`prisma/migrations/20261024_homebase_connector.sql`, tests `tests/homebase-connector.test.ts`.

## What Altrixs reads

GET requests only (Homebase Public API v1, `Accept: application/vnd.homebase-v1+json`):

| Endpoint | Used for |
|---|---|
| `/locations` | Homebase locations, mapped by HR to Bowie / Silver Spring / Baltimore |
| `/locations/{uuid}/employees` | Roster: name, work email, job title, active / archived |
| `/locations/{uuid}/shifts`, `/shifts/deleted` | Scheduled shifts (read-only view on the HR record) |
| `/locations/{uuid}/timecards`, `/timecards/deleted` | Clock in / out, unpaid breaks, worked minutes |
| `/company`, `/timeclock/status`, `/plan`, `/labor*` | Available in the client; not used by the screens yet |

**Not stored, even when Homebase returns them:** pay rates, wages, labor cost, phone numbers,
addresses, SSNs. Compensation stays in Homebase (and the Altrixs HR compensation tab, which is a
separate record). Only names, work email, job title, status, location, shifts and timecards are cached.

## What Altrixs never sends

Nothing. The connector has no write calls. **No PHI ever goes to Homebase.** Because Homebase
receives no PHI and the connection is read-only, a BAA should not be needed for this connector
(confirm with counsel).

Inside Altrixs, HR never sees client PHI from this feature either: the payroll reconciliation shows
**counts and minutes per clinician only** (completed visits, scheduled visit minutes, signed notes,
unsigned notes past due), computed with SQL aggregates (`src/lib/hr/homebase/aggregates.ts`).
No client names, ids, dates of birth or diagnoses are queried for or shown, and the CSV export has
the same columns. Every view, export, sync, mapping and link change is written to the HIPAA audit log
(`HR_HOMEBASE_*` actions).

## Matching rules

- **Locations:** HR maps each Homebase location to an Altrixs location. A name match is suggested
  (e.g. "Divine Counseling - Bowie" to Bowie); nothing is saved until HR clicks Save mapping.
- **Employees:** same work email (case-insensitive) links automatically. A name match is only a
  suggestion that HR must confirm ("Confirm" / "Not the same person"). HR can also link or unlink
  manually; HR decisions survive later syncs.
- **Roster review** flags onboarding / offboarding gaps: active in Homebase but deactivated in
  Altrixs; archived in Homebase but still active in Altrixs; active Altrixs staff missing from
  Homebase (or a contractor); active Homebase employees without an Altrixs account.

## Payroll reconciliation

For a pay period, per clinician: Homebase clocked hours vs. Altrixs documented visits. Flags:
unsigned notes past the practice signing deadline (before payroll), days with completed visits but
no clock-in, clocked days with no visits (clinical roles), open timecards, and staff not linked to
Homebase. Export CSV (counts only, formula-injection safe).

## Getting the read-only key

1. A Homebase account owner opens **Settings > API Settings** in Homebase and requests an API key
   with read access. Homebase reviews and approves API access.
2. The key is shared with the Altrixs administrator through a secure channel (never email, chat or a ticket).
3. The administrator stores it in AWS Secrets Manager (not created yet):
   `altrixs/staging/homebase` (and later `altrixs/production/homebase`) with the env vars below,
   the same way the DrFirst secrets reach `process.env`. Restart the app.
4. HR opens HR > Homebase, clicks **Sync now**, maps locations, and reviews the roster.

Until then the page says **Not connected** and shows how to connect. It never shows sample data.

## Environment variables

| Variable | Required | Notes |
|---|---|---|
| `HOMEBASE_API_KEY` | yes | Bearer key. Never logged, returned to the browser or audited. |
| `HOMEBASE_ORGANIZATION_ID` | yes | Altrixs organization id the key belongs to. Without it nothing is connected, so one practice's roster can never land in another practice. |
| `HOMEBASE_API_BASE` | no | Default `https://api.joinhomebase.com`. Homebase's docs also mention a base path `/api/public` (e.g. `https://app.joinhomebase.com/api/public`); confirm with the first `GET /company` once the key is issued. HTTPS only. |
| `HOMEBASE_TIMEOUT_MS` | no | Per-request timeout, default 20000. |

## Limits and sync behavior

- Homebase allows 60 requests / minute per UUID in the URL (429 `{"error":"Rate limit exceeded"}`).
  The client keeps itself to 50 / minute per UUID and retries a 429 with backoff (Retry-After when sent).
- Pagination follows the `Link` header (`rel="next"`), falling back to `Total` / `Per-Page`. Next links
  to any other host are refused so the key is never sent elsewhere.
- Default sync window: last 31 days through 14 days ahead (max 93 days per run). Deleted shifts and
  timecards are marked deleted from the `/deleted` endpoints; rows are never hard-deleted.
- **Sync now** (HR, practice director, admin) and the cron script share the advisory lock
  `job:homebase-sync:<org>`.
- Cron: the line in `deploy/crontab.staging` is **commented out**. Install only after owner approval.

## Field names we guessed

The documentation we have does not list response fields or date query parameters. The mappers
accept common variants and mark guesses with `GUESSED` in `src/lib/hr/homebase/mappers.ts` and
`client.ts`: `start_date` / `end_date` query parameters; `with_archived`; employee `archived` /
`archived_at` / `status`, `job_title` / `role` / `jobs[]`; shift `user_id` / `start_at` / `end_at`;
timecard `clock_in` / `clock_out`, `timebreaks[]` / `break_minutes`, `approved`, `shift_id`. Check them
against the first live sync (the sync run stores counts only) and tighten the mappers.

## Future phase (not built)

- Write access as a Homebase partner: push new hires from Altrixs onboarding to Homebase
  (would need Homebase partner approval and a fresh privacy review; still no PHI).
- Altrixs remains the owner of licenses, credentialing, CEUs, clinical supervision and HIPAA
  training; Homebase remains the owner of pay, time and scheduling of hours.
