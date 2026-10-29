# Flutter Agent Handoff — Medication Push & Reminders (Altrixs)

**From:** Web/backend team  
**For:** Flutter patient app agent  
**Priority:** High — without this, doctor-created meds never notify the patient  
**Date:** 2026-09-21

---

## Goal (what must work)

1. When a **doctor creates a medication** on the web dashboard → patient phone gets a **push** (“New Prescription…”).
2. If medication is **3×/day** (e.g. `08:00, 13:00, 20:00`) → patient gets **3 reminders** (one per dose).
3. Each reminder fires **~15 minutes before** that dose time (“Medication in 15 minutes”).
4. Tapping the notification opens the **Medications** screen; patient can **Take / Skip**.

Backend scheduling + FCM send is already implemented. Flutter must register the device and handle the payloads.

---

## Critical path (do these first)

| # | Task | Done when |
|---|------|-----------|
| 1 | Firebase (FCM) in Flutter app (Android + iOS) | App gets an FCM token |
| 2 | After login → `POST /api/patient/device-token` | Token saved; dashboard “patients with devices” shows this client |
| 3 | On logout → `DELETE /api/patient/device-token` | Token removed |
| 4 | Android notification **channels** match backend (see below) | High-priority med alerts show |
| 5 | Handle FCM `data.type` + tap → navigate | Opens correct screen |
| 6 | Medications list + Take/Skip APIs | Dose status syncs with web |

If step 2 is missing, **no push will ever arrive** (backend silently skips create notify).

---

## Auth

All patient APIs need the same patient session/token you already use:

```http
Authorization: Bearer <patient_access_token>
Content-Type: application/json
```

Base URL = environment API host (staging / production). Same as other `/api/patient/*` calls.

---

## 1) Register / unregister FCM device token

### Register (call after login + whenever token refreshes)

```http
POST /api/patient/device-token
```

```json
{
  "token": "<fcm_registration_token>",
  "platform": "android"
}
```

`platform`: `"ios"` | `"android"` only.  
Token min length 10.

**Success:** `{ "success": true, "data": { "registered": true, "platform": "android" } }` (shape may wrap via `patientOk`).

### Unregister (call on logout)

```http
DELETE /api/patient/device-token
```

```json
{
  "token": "<same_fcm_token>"
}
```

### Implementation notes

- Use `firebase_messaging` (and iOS APNs entitlement).
- Re-register when `onTokenRefresh` fires.
- Request notification permission on first login (iOS + Android 13+).
- Foreground + background + terminated handlers all required.

---

## 2) Android notification channels (must match backend)

Backend sets `channelId` per type. Create these channels in Flutter **before** first push:

| `type` (data) | Android `channelId` | Suggested importance |
|---------------|---------------------|----------------------|
| `medication_reminder` | `medication_reminders` | HIGH / MAX |
| `appointment_reminder` | `appointment_reminders` | HIGH |
| `telehealth_call` | `telehealth_calls` | MAX |
| `chat_message` | `chat_messages` | HIGH |
| `check_in_reminder` | `check_in_reminders` | DEFAULT |

Wrong channel id → notification may be silent / missing.

---

## 3) Push payload shapes (what Flutter receives)

FCM includes both `notification` (title/body) and `data` (all string values).

Common `data` fields always present:

- `type` — see table above  
- `click_action` — `FLUTTER_NOTIFICATION_CLICK`  
- `badge` / `unreadCount` / `count`

### A) Doctor just created a prescription

- `type`: `medication_reminder`
- Title like: `💊 New Prescription: <name>`
- `data` may include:
  - `medicationScheduleId`
  - `medicationName`
  - `dosage`
  - `doseTimes` (comma-separated HH:MM)
  - `route`: `/medications`

**Action:** open Medications screen; refresh list.

### B) Dose reminder (~15 min before each dose)

- `type`: `medication_reminder`
- Title like: `Medication in 15 minutes 💊`
- `data` may include:
  - `medicationId` (schedule id)
  - `medicationName`
  - `dosage`
  - `doseTime` (e.g. `08:00`)
  - `scheduledTime` (ISO)
  - `route`: `/medications`

**Action:** open Medications; highlight that dose; allow Take/Skip.

> Note: create-notify and dose-reminder share `type: medication_reminder`. Distinguish by presence of `doseTime` / `scheduledTime` vs `medicationScheduleId` + “New Prescription” title, or by `route` + fields.

---

## 4) Medications APIs

### List active meds + today’s doses

```http
GET /api/patient/medications
```

Response (simplified):

```json
{
  "success": true,
  "medications": [
    {
      "id": "clx...",
      "medicationName": "Sertraline",
      "dosage": "50mg",
      "instructions": "With food",
      "doseTimes": ["08:00", "13:00", "20:00"],
      "startDate": "...",
      "endDate": "...",
      "isActive": true,
      "todayDoses": [
        { "time": "08:00", "taken": false, "takenAt": null, "skipped": false },
        { "time": "13:00", "taken": true, "takenAt": "...", "skipped": false },
        { "time": "20:00", "taken": false, "takenAt": null, "skipped": false }
      ]
    }
  ]
}
```

`doseTimes.length === 3` means **3 reminders/day** (backend cron handles timing).

### Mark taken

```http
POST /api/patient/medications/{scheduleId}/take
```

Body (optional but recommended):

```json
{
  "doseTime": "08:00",
  "scheduledFor": "2026-09-21T12:00:00.000Z"
}
```

Prefer `scheduledFor` from push `data.scheduledTime` when opening from notification.

### Mark skipped

```http
POST /api/patient/medications/{scheduleId}/skip
```

Same body shape as take.

Alternate (also supported):

```http
POST /api/patient/medications/{id}/intake
```

with `taken` / `skipped` flags — use whichever you already have; `/take` and `/skip` are the simple fallbacks.

---

## 5) Navigation on notification tap

| `data.type` | Open screen |
|-------------|-------------|
| `medication_reminder` | Medications (`data.route` often `/medications`) |
| `appointment_reminder` | Appointments |
| `telehealth_call` | Telehealth / join call |
| `chat_message` | Chat thread |
| `check_in_reminder` | Daily check-in |

Handle:

- App in foreground  
- Background  
- Killed (getInitialMessage)

---

## 6) QA checklist (Flutter + web together)

1. Patient logs into Flutter → token registered (confirm on web Notifications page: patient has device).
2. Doctor creates med with `08:00, 13:00, 20:00` → patient gets **immediate** “New Prescription” push.
3. Wait until ~15 min before a dose (or ask backend to “Run cron” on Notifications page while clock is in 10–20 min-before window) → **dose reminder** push.
4. Tap reminder → Medications opens → Take → `todayDoses` shows taken on refresh.
5. Logout → token deleted → new pushes stop for that device.
6. Re-login → token re-registered → pushes work again.

---

## Backend dependencies (not Flutter’s job — but know them)

- Live server must have Firebase Admin env (`FIREBASE_*`) configured.
- Live server must run cron every ~5 minutes:  
  `GET /api/cron/notifications` with `Authorization: Bearer <CRON_SECRET>`.
- Without cron, **dose reminders never fire** even if Flutter is perfect.
- Without device token, **create notify never fires**.

---

## Out of scope for Flutter

- Creating schedules (doctor does this on web).
- Cron / 15-minute-before timing (backend `medicationScheduler`).
- FCM server credentials (web/AWS env).

---

## Copy-paste prompt for Flutter agent

```
Implement Altrixs patient medication push end-to-end:

1. Firebase Messaging + notification permissions (iOS/Android).
2. After login and onTokenRefresh: POST /api/patient/device-token { token, platform: ios|android }.
3. On logout: DELETE /api/patient/device-token { token }.
4. Create Android channels: medication_reminders, appointment_reminders, telehealth_calls, chat_messages, check_in_reminders (HIGH for meds).
5. Handle FCM data.type=medication_reminder:
   - New prescription → open /medications, refresh GET /api/patient/medications
   - Dose reminder (has doseTime/scheduledTime) → open medications, allow Take/Skip
6. POST /api/patient/medications/{id}/take and /skip with doseTime or scheduledFor from payload.
7. Support foreground, background, and terminated notification taps (click_action FLUTTER_NOTIFICATION_CLICK).

Backend already sends ~15 min before each doseTimes entry; 3 times/day = 3 pushes. Without device-token register, nothing arrives.
```
