# Altrixs patient mobile API handoff

Version 3.0 | September 2026 | Next.js backend

## Setup

Set `BASE_URL` to your deployed API host. Local development: `http://localhost:3000` (iOS simulator/Postman), `http://10.0.2.2:3000` (Android emulator), or the development machine's LAN address.

Send `Content-Type: application/json` and, after login, `Authorization: Bearer <data.token>`. Store the token in mobile secure storage. Clear it on logout or HTTP 401. Patient tokens cannot access staff APIs or `/dashboard`.

All patient responses use:

```json
{ "success": true, "data": {}, "message": "Optional message" }
```

```json
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "Invalid request", "fields": { "phone": "Invalid input" } } }
```

HTTP codes: 400 invalid input, 401 sign in again, 403 unavailable access/account, 404 inaccessible/missing record, 409 conflict, 429 retry later. Responses include `Cache-Control: private, no-store` and CORS headers. Patient routes support OPTIONS; `PATIENT_CORS_ORIGIN` overrides the default `*` for web clients.

**Telehealth exception:** existing join endpoints return top-level `session` and string errors, without the patient `data` wrapper.

## Supported scope

Existing login, invitations, appointments, doctors, chat, check-ins, progress and telehealth are reused. This update adds forgot-password, reset-password, PATCH me, GET forms, GET form detail, POST logout, and DELETE me / delete-account; it also fixes chat and shared request handling.

These requested routes are **not implemented**:

- Device token registration/removal and notification list/read: no patient device registry, push sender or persisted notification read state exists. Dashboard notifications remain a summary of existing care-team alerts.
- POST forms/:id/submit: consent records store type/status metadata, not questions or versioned consent text for mobile submission.
- GET safety-plan and POST safety-plan/sign: current staff plans are clinic JSON records linked by display name, without reliable patient IDs and a patient-signature workflow. Dashboard safety summaries now require an explicit `clientId`; they never match by name.

No placeholder endpoints, push delivery or video hosting infrastructure are added.

## Auth and onboarding

1. Clinic staff invites a client using the existing email/SMS flow.
2. `GET /api/patient/invite/preview?token=<inviteToken>` returns `data.invite`: name, email, expiresAt.
3. `POST /api/patient/invite/accept` with `{ "token": "<inviteToken>", "password": "Example123" }` returns data.email and data.name; then log in.
4. `POST /api/patient/login` with `{ "email": "patient@example.com", "password": "Example123" }` returns data.token and data.client (id, name, email, phone).

Passwords: 8-72 characters, a letter and number, no whitespace, at most 72 UTF-8 bytes. Invites expire after seven days. Login/invite accept allow 10 requests per 15 minutes per IP; preview allows 30. Inactive/discharged patients cannot sign in.

## Password recovery

Public `POST /api/patient/forgot-password`:

```json
{ "email": "patient@example.com" }
```

HTTP 200 returns empty data and the same generic message for active, unknown, invited, disabled and email-throttled accounts. The token is never returned by this API. Eligible accounts receive an email through existing SMTP. IP limit: 10 per 15 minutes; email limit: 3 per 15 minutes per server process. Delivery failures are logged while the response remains generic.

The link is `/patient/accept?mode=reset&token=<resetToken>`. 

**Mobile App Deep Linking (Option 1 - Universal Links & App Links):**
1. When the patient taps the email button on iOS or Android, the mobile app intercepts the link directly via Universal Links (iOS) / App Links (Android) or scheme `altrixs://patient/accept?mode=reset&token=<resetToken>`.
2. Digital Asset Links (`/.well-known/assetlinks.json`) and Apple App Site Association (`/.well-known/apple-app-site-association`) are configured on the Next.js backend.
3. In Flutter, extract `token = uri.queryParameters['token']`.
4. Navigate the patient to the in-app "Reset Password" screen with "New Password" & "Confirm Password" fields.
5. The Flutter app sends the payload directly to `POST /api/patient/reset-password`.
6. Fallback: If clicked on a desktop or unsupported browser, the website at `/patient/accept?mode=reset` safely handles the reset form with identical security.

Reset links expire after 30 minutes, are single-use, and are distinct from invite/login tokens.

Public `POST /api/patient/reset-password`:

```json
{ "token": "<resetToken>", "password": "NewExample123" }
```

Success: HTTP 200, empty data, then sign in with the new password. Invalid/expired/used links return 400 `invalid_token`; password-policy errors use `weak_password`. IP limit: 10 per 15 minutes.

Successful reset invalidates all old patient sessions and outstanding reset links. Atomic replacement of the existing password hash prevents concurrent reuse; no new database table is required.

## Authenticated password change

Authenticated `POST /api/patient/change-password`:

```json
{
  "currentPassword": "OldPassword123",
  "newPassword": "NewPassword123"
}
```

- Header: `Authorization: Bearer <patientSessionToken>`
- Validates current password against stored hash. Returns 400 `invalid_current_password` if wrong.
- Validates new password against password policy (8-72 chars, letter & number, no spaces).
- Requires new password to differ from current password (400 `same_password`).
- Atomically updates password hash, writes audit log, and issues a fresh JWT session token so the active session continues uninterrupted.
- IP limit: 10 per 15 minutes.
- Also available directly in the Patient Web Portal under `/patient/home` -> "Security & Password".

**Rollout:** tokens issued before this update lack credential binding and return 401. Patients must sign in once again. New sessions expire after 30 days, or earlier when credentials/account access change. There is no refresh-token endpoint.

## Profile

Patient website: open `/patient/home`, choose **Edit profile**, then **Save changes**. The form edits phone, address and emergency contact details through the same mobile API. Cancel discards the draft. Save sends only changed fields; an empty field clears its value. Validation errors keep the draft, and temporary network errors do not sign the patient out.

- `GET /api/patient/me` -> data.client.
- `PATCH /api/patient/me` -> updated data.client.

```json
{
  "phone": "+14105550100",
  "addressLine1": "123 Example Street",
  "addressLine2": null,
  "city": "Baltimore",
  "state": "MD",
  "postalCode": "21201",
  "emergencyContactName": "Example Contact",
  "emergencyContactPhone": "+14105550101"
}
```

All fields are optional, but supply at least one. Null clears a field. Phones accept digits and common punctuation, 5-30 characters. GET also returns read-only id, name, email, image. Changes to name, login email, clinical fields, client/clinic IDs, account status or staff roles are rejected. Changes update the staff-visible Client record. Profile access works without clinic assignment; care features require a linked clinic. PATCH limit: 30 per 15 minutes.

## Logout

- `POST /api/patient/logout`
- Header: `Authorization: Bearer <token>`
- Returns: `{ "success": true, "data": { "message": "Logged out successfully" } }`

Clears/invalidates the patient session on mobile and records a security audit log. On the client app, remove the token from secure storage and navigate the user to the login screen.

## Account Deletion (Apple App Store & Play Store Guideline Compliance)

- `DELETE /api/patient/me` (or `POST /api/patient/delete-account`)
- Header: `Authorization: Bearer <token>`
- Returns: `{ "success": true, "data": { "message": "Account deleted successfully" } }`

Immediately disables the patient login account (`status: DISABLED`), revokes active authentication tokens, and writes a compliance audit event. Clinical medical records are retained per healthcare legal retention policies, while all mobile app access and login credentials are permanently deactivated.

## Dashboard, check-ins and progress

- `GET /api/patient/dashboard` -> profile, todayCheckIn, latestScores, nextAppointment, unreadMessageCount, latestConversation, medicationSummary, weeklyProgress, pendingTasks, notifications, safetyPlan, recommendedWellnessTool.
- `GET /api/patient/progress` -> existing weekly trends and streak data.
- `GET /api/patient/check-ins?page=1&limit=20` -> data.checkIns and data.pagination; optional from/to date filters.
- `POST /api/patient/check-ins` -> 201, data.checkIn.

```json
{ "mood": 7, "stress": 4, "sleep": 8, "journal": "Feeling better today" }
```

Scores are integers 1-10. Sleep/journal are optional and nullable; journal maximum 1000 characters. Existing service handles streak/risk updates. Dashboard medicationSummary describes a treatment plan, not a prescription list.

## Doctors and appointments

- `GET /api/patient/doctors` -> data.doctors (id, name, role, image), within the patient's clinic.
- `GET /api/patient/doctors/:id/availability?from=YYYY-MM-DD&days=14` -> existing slot response; maximum 30 days.
- `GET /api/patient/appointments` -> data.appointments; returns **upcoming appointments only** (excludes past, completed, and cancelled visits). Pass `?includePast=true` if full history is ever needed.
- `GET /api/patient/appointments/:id` -> data.appointment.
- `POST /api/patient/appointments` -> 201, data.appointment.
- `PATCH /api/patient/appointments/:id/reschedule` -> data.appointment.
- `PATCH /api/patient/appointments/:id/cancel` -> data.appointment; empty body or {}.

Booking:

```json
{
  "clinicianId": "<doctorId>",
  "type": "Individual Therapy",
  "date": "YYYY-MM-DD",
  "startTime": "10:00",
  "endTime": "10:50",
  "isVirtual": false
}
```

Choose a future slot from availability. EndTime is optional (default 50 minutes). Types follow src/features/appointments/types.ts. Rescheduling accepts date/startTime, optional endTime, optional note (maximum 500 characters).

Slots use existing server-time scheduling and a fixed office-hour grid; this is not an individual clinician working-hours calendar. Booking starts pending. Rescheduling changes the time and flags it for review. Patient-facing statuses: pending, confirmed, completed, cancelled, reschedule_requested. Slot conflicts return 409 SLOT_UNAVAILABLE. Eligible virtual visits include patient joinUrl; staff notes and video host URLs are excluded.

## Patient-doctor/care-team chat

Patient and staff use the same MessageThread/ThreadMessage records. The assigned clinician sees the patient through existing staff caseload rules. This is a shared care-team inbox, not arbitrary direct messaging with every doctor in the directory.

- `GET /api/patient/conversations` -> data.conversations (up to 100).
- `POST /api/patient/conversations` -> 201, data.conversation.
- `GET /api/patient/conversations/:id/messages?page=1&limit=20` -> data.conversation, data.messages, data.pagination.
- `POST /api/patient/conversations/:id/messages` -> 201, data.message.
- `PATCH /api/patient/messages/:id/read` -> data.id, data.read = true.
- `GET /api/patient/conversations/:id/stream` -> **Real-Time SSE Stream** (instant message delivery in <50ms, eliminating polling latency).

Start a thread with `{ "topic": "clinical", "message": "I have a question for my doctor" }`. Valid topics: general (default), scheduling, billing, clinical, rx-refill. Replies accept `{ "message": "Thank you" }`. Messages require non-whitespace content, maximum 4000 characters.

Messages contain id, threadId, senderRole (patient/clinician), senderName, body, read, createdAt. The existing clinician wire role includes care-team/front-office replies; display senderName. Internal CLINICIAN_NOTE records are strictly excluded from history, totals, unread counts, conversation previews, dashboard previews, and real-time streams.

### Real-Time Live Messaging (SSE Stream in Flutter):
To receive clinician messages instantly without waiting for polling intervals:
Connect to `GET /api/patient/conversations/:id/stream` with `Authorization: Bearer <patientToken>`.

```dart
// Flutter Example: Real-time Message Stream listener
final request = http.Request('GET', Uri.parse('$baseUrl/api/patient/conversations/$threadId/stream'));
request.headers['Authorization'] = 'Bearer $token';
request.headers['Accept'] = 'text/event-stream';

final response = await http.Client().send(request);
response.stream
    .transform(utf8.decoder)
    .transform(const LineSplitter())
    .listen((line) {
      if (line.startsWith('data: ')) {
        final jsonStr = line.substring(6);
        final data = jsonDecode(jsonStr);
        // data contains: { id, threadId, senderRole, senderName, body, read, createdAt }
        onNewMessageReceived(data);
      }
    });
```
- The server sends a `: ping` heartbeat every 15 seconds to prevent mobile connection drops across carrier NATs and reverse proxies.
- If the stream disconnects (e.g. device network switch), simply reconnect or perform a one-time GET messages fetch to synchronize.

Read means read by the recipient. New messages start unread. GET history does not acknowledge replies: PATCH read each displayed care-team message. Repeated acknowledgement is safe. Staff's message view marks patient messages read. Staff and patient unread counts are separate. Patients cannot acknowledge their own messages or internal notes.

## Forms: existing consent metadata

- `GET /api/patient/forms?page=1&limit=20` -> data.forms, data.pagination.
- `GET /api/patient/forms/:id` -> data.form.

Records contain id, type, status, method, sentAt, signedAt, expiresAt, signedByName. Status is pending/signed/expired/declined; passed expiry is reflected without changing persistence. Both patient and clinic IDs are checked. Staff notes and creator identity are excluded. List is newest first. Limit: 60 requests per 15 minutes for each endpoint. These are read-only metadata records; do not render a mobile signing/submission action.

## Telehealth

- `GET /api/telehealth/join/:joinToken` -> top-level session.
- `POST /api/telehealth/join/:joinToken` with `{ "action": "here" }` -> marks arrival, returns top-level session.

Extract joinToken from the appointment joinUrl or email/SMS link. It is separate from a login token. Existing GET/POST /api/telehealth/signal supports in-app signaling; hosting is outside this update. Native mobile does not need CORS; these routes do not use the patient CORS wrapper.

## Pagination, Postman and verification

For messages, check-ins and forms: page/limit must be positive integers. Defaults: 1 and 20; limit capped at 100. Fractional/infinite/invalid values return 400. Pagination shape: `{ "total": 12, "page": 1, "limit": 20 }`.

Import Flutter-Patient-App-API.postman_collection.json. It defaults to localhost. Set patientEmail, patientPassword, inviteToken/resetToken as needed. Login captures patientToken; doctor/thread/appointment/form requests capture record IDs. Set dates/IDs deliberately before writes. Run requests individually: they include real creation, rescheduling, cancellation and password-reset actions.

Before mobile release, verify against a development clinic: invite -> accept -> login; profile visible to staff; patient message -> doctor reply -> read badge clears; foreign patient IDs rejected; password reset -> old token rejected -> new login; forms metadata; appointment/telehealth links.

Automated tests use synthetic in-memory persistence and mocked email; they do not prove live database connectivity or SMTP delivery. Checks: `npm run typecheck`, `npm test`. Existing configuration: DATABASE_URL, production AUTH_SECRET, SMTP and application base URL. Rate limits remain process-local. This update requires no database schema changes.
