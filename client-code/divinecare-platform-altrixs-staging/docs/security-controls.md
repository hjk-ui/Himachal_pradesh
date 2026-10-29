# Staff sign-in and session security controls

What the staff app (`/login`, NextAuth Credentials) enforces as of Oct 24, 2026. Written for the DrFirst
security questionnaire. The same list appears in the app under **Admin › Security** and **Practice settings ›
Users & security** (`src/lib/practice/securityPolicy.ts`). Patient portal sign-in (`src/patient`) is separate and
has not changed.

Migration: `prisma/migrations/20261024_staff_mfa_lockout.sql`. It is idempotent.

## Controls

| Control | What it does | Where |
|---|---|---|
| Two-factor sign-in (TOTP) | Every staff account (all clinic roles, including Admin, plus platform admins) signs in with a password or emailed code, then a 6-digit code from an authenticator app. Codes are valid for ±1 time step (30 s). A code that was already accepted is refused. | `src/lib/auth/staffSignIn.ts`, `src/lib/auth/totp.ts` |
| Enrollment | Set up at the first sign-in after deploy, or after an admin reset. The screen shows a QR code (rendered on the server, never sent to a third party) and a manual key. The user confirms with a code and then sees 10 one-time recovery codes, with **Download** and **Copy** buttons. | `/login` (`LoginForm.tsx`) |
| Secret storage | The TOTP secret is encrypted with AES-256-GCM using `PHI_FIELD_ENCRYPTION_KEY` (`fieldCrypto` v1). Each recovery code is stored as a salted SHA-256 hash and works only once. | `User.mfaSecretEnc`, `User.mfaRecoveryCodes` |
| Remember this device | Optional at the 2FA step. A signed httpOnly cookie (`altrixs_mfa_device`, SameSite=Strict, path `/api/auth/staff`) is tied to the user and to an `MfaTrustedDevice` row. It skips the code for 30 days. It is revoked by an admin 2FA reset, a password change, or a password reset. | `MfaTrustedDevice` |
| 2FA lockout | After 5 wrong codes, 2FA locks for 15 minutes. | `User.mfaFailedCount / mfaLockedUntil` |
| Password lockout | After 5 wrong passwords on one account, the account locks for 15 minutes. The lock is stored in the database, so it holds across restarts and servers. Each IP address is also limited to 20 attempts per 15 minutes. Unknown emails get the same responses, so the app does not reveal which accounts exist. | `User.failedLoginCount / loginLockedUntil`, `src/lib/auth/lockout.ts` |
| Email one-time codes | Codes expire after 2 minutes. A code is void after 5 wrong guesses. Each account and each IP can request 5 codes per 15 minutes. The response is the same whether or not the account exists. | `src/lib/auth/otp.ts`, `/api/auth/otp/*` |
| Lockout message | "Too many attempts. Try again in N minutes." | |
| Idle sign-out | After 15 minutes without activity, the user is signed out. A **Still there?** dialog appears 60 seconds before. Activity in any open Altrixs tab counts. A live microphone or camera (telehealth call, AI scribe recording) also counts, so a visit in progress is never cut off. The server checks too: background polling does not count as activity, and a session idle for more than 15 minutes is refused. | `StaffIdleGuard.tsx`, `src/lib/auth/sessionPolicy.ts`, jwt callback in `src/lib/auth/config.ts` |
| Maximum session | 12 hours after sign-in, whatever the activity. The JWT maxAge is also 12 h. Sessions from before this deploy are ended once. | `sessionPolicy.ts` |
| Password rule | 12 to 128 characters. Rejected if it is on the bundled top-10,000 common-password list, or is a listed password with digits or symbols added. Also rejected if it contains the user's name or email, or repeats the same few characters. There are no network calls. The rule applies when a password is set: first admin, registration, invite accept, admin create, reset, and change. Existing passwords keep working until the next change. | `src/lib/auth/passwordPolicy.ts`, `src/lib/auth/data/commonPasswords.ts` |
| Content-Security-Policy | Sent on every route with a new nonce per request. Policy: `default-src 'self'`; scripts from `'self'` with the nonce and `'strict-dynamic'`; `connect-src` covers Chime (`*.chime.aws`), Transcribe streaming (`wss://transcribestreaming.<region>.amazonaws.com:8443`), the S3 upload buckets and Stripe; `frame-ancestors 'none'`, except `/schedule`, which keeps `*` for the booking embed. DrFirst SSO opens a new tab, so it needs no CSP source. | `src/lib/security/csp.ts`, `src/proxy.ts` |
| Outdated browser notice | A dismissible banner on staff and patient pages: "Your browser is out of date. Please update to keep Altrixs secure." It appears below Chrome, Edge or Firefox 111, or Safari 16.4. It never blocks access. | `OutdatedBrowserBanner.tsx`, `src/lib/browser/browserSupport.ts` |

### Audit events

Audit events record ids only, never emails or codes:

- `LOGIN`: metadata `method` and `mfa`, where `mfa` is `totp`, `recovery`, `device`, `enrolled` or `none`
- `LOGIN_FAILED`
- `LOGIN_LOCKED`
- `MFA_ENROLLED`
- `MFA_CHALLENGE_SUCCESS`
- `MFA_CHALLENGE_FAILED`
- `MFA_RECOVERY_USED`
- `MFA_LOCKED`
- `MFA_RESET`: records the admin who did it

## Operator steps

### Before the first deploy with 2FA

1. Make sure `PHI_FIELD_ENCRYPTION_KEY` is set on the server (32 bytes, base64 or hex). Without it, nobody can set
   up 2FA, and sign-in stops at "Two-factor setup is unavailable".
2. Run the migration: `npm run db:migrate`.
3. Tell staff to install an authenticator app on their phone before they next sign in: Google Authenticator,
   Microsoft Authenticator, 1Password, Authy or Duo Mobile. Everyone who was signed in is signed out once, then
   goes through the setup screen.

### Reset a staff member's 2FA (lost phone, new phone)

1. An **Admin** or **Practice Director** opens **Admin & compliance › Users & Roles**.
2. Find the person. The Status column shows **2FA on** or **2FA not set up**.
3. Click **Reset 2FA** and confirm. Their authenticator, recovery codes and remembered devices stop working.
4. At their next sign-in they enter their password and then set up 2FA again.

The reset is audited as `MFA_RESET`. Nobody can reset their own 2FA; another admin has to do it. A user who still has a recovery code can sign in
with **Use a recovery code** instead.

### Unlock an account

Locks clear on their own after 15 minutes. A password reset (**Forgot password?**) also clears the password lock.
A 2FA lock clears after 15 minutes, or when an admin uses **Reset 2FA**.

### Pause the 2FA requirement

Both switches below lower security. Record why, and turn the requirement back on as soon as possible.

- **One practice:** go to Practice settings › Compliance & privacy › **Staff sign-in**, set **Require two-factor sign-in for staff** to
  *Not required*, and save. The change is audited as a practice-settings change. Platform admins always need 2FA.
- **Emergency, all practices:** set `MFA_ENFORCE=false` in the server environment and restart. While it is set,
  staff sign in with a password only. Remove the variable and restart to turn 2FA back on.

### CSP problems

If a page breaks because of the CSP (the browser console shows "Refused to load ..."):

1. Set `CSP_REPORT_ONLY=true` and restart. The policy is then reported but not enforced.
2. Add the missing source in `src/lib/security/csp.ts`.
3. Remove the variable again.

Browser upload buckets are read from `SCRIBE_UPLOAD_BUCKET`, `VALANT_IMPORT_S3_BUCKET` and `DOC_INTAKE_S3_BUCKET`.
