# Flutter Agent Handoff — Telehealth Video (Amazon Chime SDK)

**From:** Web / backend team (Altrixs platform)  
**For:** Flutter patient app agent (iOS + Android)  
**Priority:** **P0 / High** — production video is Chime; Zoom/Meet are optional fallback only  
**Date:** 2026-10-01  
**AWS region:** `us-east-1`  
**Related docs:**  
- This file (source of truth for video join)  
- `docs/FLUTTER-MEDICATION-PUSH-HANDOFF.md` (FCM device token + channels)  
- Old WebRTC `/api/telehealth/signal` = **backup only**, not primary  

---

## 1. Product summary (read this first)

| Call type | Who starts | What patient experiences | Flutter work |
|-----------|------------|--------------------------|--------------|
| **Video telehealth** | Doctor on **web** dashboard | Push → in-app **Amazon Chime** video | **Required** — this handoff |
| **Phone telehealth** | Doctor on **web** (Amazon Connect) | Patient’s **real phone rings** (PSTN) | **None** for v1 (no Connect SDK in app) |

**Primary video provider = Amazon Chime SDK Meetings**  
Not Zoom. Not Google Meet. Not custom WebRTC signaling as primary.

Backend already:
- Creates Chime meetings when doctor clicks **Launch Chime video call**
- Persists meeting on the appointment
- Sends FCM `telehealth_call` with `joinToken` + `provider=chime`
- Exposes patient join APIs that return `Meeting` + `Attendee` objects for the SDK

Flutter must:
- Register FCM token (already required for meds)
- Handle `telehealth_call` push
- Call join APIs
- Join meeting with **Amazon Chime SDK** (native or Flutter plugin wrapping AWS SDK)

---

## 2. End-to-end flow (doctor ↔ patient)

```
┌─────────────────┐                    ┌──────────────────┐
│  Doctor (Web)   │                    │ Patient (Flutter)│
│  /dashboard/    │                    │                  │
│  telehealth     │                    │                  │
└────────┬────────┘                    └────────┬─────────┘
         │                                      │
         │ 1. Start/Join session                │
         │ 2. Launch Chime video call           │
         │    POST /api/telehealth/room         │
         │    → CreateMeeting + CreateAttendee  │
         │    → persist meeting on appointment  │
         │    → FCM push to patient ────────────┼──► 3. Push received
         │                                      │    type=telehealth_call
         │                                      │    joinToken=...
         │                                      │    provider=chime
         │                                      │
         │                                      │ 4. Tap notification
         │                                      │ 5. GET join/:token
         │                                      │ 6. POST action=here
         │                                      │ 7. POST action=chime
         │                                      │    ← meeting + attendee
         │                                      │
         │ 8. Both in same Chime meeting ◄──────┼── 9. Chime SDK join
         │    (web amazon-chime-sdk-js)         │    (iOS/Android SDK)
         └──────────────────────────────────────┘
```

**Rule:** Patient cannot create the meeting. Doctor must launch first.  
If patient joins early → API returns **409** → show waiting UI and retry.

---

## 3. Critical path checklist (Flutter)

| # | Task | Done when |
|---|------|-----------|
| 1 | Firebase FCM works (Android + iOS) | App has FCM registration token |
| 2 | After login: `POST /api/patient/device-token` | Backend can push this patient |
| 3 | Android channel id `telehealth_calls` (HIGH/MAX) | Heads-up / call-style notification |
| 4 | Handle FCM data `type == telehealth_call` (foreground + background + tap) | Opens Telehealth Join screen with `joinToken` |
| 5 | Deep link / route: `/telehealth/join?token=...` or in-app equivalent | Same screen as push tap |
| 6 | `GET /api/telehealth/join/:joinToken` | Shows clinician name + wait state |
| 7 | `POST` `{ "action": "here" }` | Marked in waiting room |
| 8 | `POST` `{ "action": "chime" }` | Returns `chime.Meeting` + `chime.Attendee` |
| 9 | Join with Amazon Chime SDK using those objects | Two-way A/V with doctor |
| 10 | Mute / camera toggle / Leave | Clean hangup; leave screen |
| 11 | Retry on HTTP **409** every 3–5s | Patient can wait until doctor launches |
| 12 | If `demoMode: true` | Show “Video unavailable” (server misconfig) — prod must be `false` |

If step 2 is missing, **no push will arrive**.

---

## 4. Two different “join tokens” (do not mix)

| Name | Where you see it | What it is | Used for |
|------|------------------|------------|----------|
| **Telehealth joinToken** | FCM `data.joinToken`, URL path `/api/telehealth/join/:joinToken` | Signed opaque token (appointment + client + expiry) | HTTP join APIs only |
| **Chime Attendee JoinToken** | `chime.attendee.JoinToken` or `chime.joinToken` in API body | AWS Chime media credential | Chime SDK only |

```
FCM joinToken  ──HTTP──►  POST .../join/:THIS_TOKEN  { action: "chime" }
                                    │
                                    ▼
                         chime.attendee.JoinToken  ──SDK──►  join meeting
```

Putting the FCM token into the Chime SDK will fail.  
Putting the Chime JoinToken into the URL will fail.

---

## 5. Auth

| Route family | Patient Bearer login? | Token needed |
|--------------|----------------------|--------------|
| `/api/patient/*` (device-token, etc.) | **Yes** | `Authorization: Bearer <access_token>` |
| `/api/telehealth/join/:joinToken` | **No** | Path `joinToken` only |

```http
Content-Type: application/json
```

Base URL = same as other patient APIs (staging / production).  
URL-encode the `joinToken` in the path (`Uri.encodeComponent`).

---

## 6. FCM: device registration (required)

Same as medication handoff:

```http
POST /api/patient/device-token
Authorization: Bearer <patient_access_token>
Content-Type: application/json

{
  "token": "<fcm_registration_token>",
  "platform": "android"
}
```

`platform`: `"ios"` | `"android"` only.

```http
DELETE /api/patient/device-token
Authorization: Bearer <patient_access_token>
Content-Type: application/json

{ "token": "<same_fcm_token>" }
```

Call register after login and whenever FCM token refreshes.  
Call delete on logout.

### Android notification channel (must match backend)

| FCM type | Android `channelId` | Importance |
|----------|---------------------|------------|
| `telehealth_call` | **`telehealth_calls`** | HIGH / MAX |

Backend sends Android notifications with `channelId: telehealth_calls` and `priority: max`.

---

## 7. FCM payload when doctor launches Chime

### Data fields (all strings in FCM `data`)

| Key | Example | Required |
|-----|---------|----------|
| `type` | `telehealth_call` | Yes |
| `provider` | `chime` | Yes (treat as Chime if present or when joining video) |
| `joinToken` | long base64url string | Yes |
| `sessionId` | appointment cuid | Yes |
| `meetingId` | Chime meeting UUID | Often present when launched from room API |
| `doctorName` | `Dr. Smith` | Optional |
| `click_action` | `FLUTTER_NOTIFICATION_CLICK` | Backend may add |
| `badge` / `unreadCount` | `1` | Optional |

### Example `data` map

```json
{
  "type": "telehealth_call",
  "provider": "chime",
  "joinToken": "eyJhbGciOi...(opaque telehealth token)...",
  "sessionId": "clxxxxxxxx",
  "meetingId": "2c579361-30be-4c43-bcaf-9e07c8842713",
  "doctorName": "Dr. Asha"
}
```

### Notification title / body (system tray)

- Title: `Your telehealth visit is starting`
- Body: `{Doctor} started a secure video call. Tap to join.`

### Flutter handling

1. **Foreground:** show in-app banner or navigate immediately.  
2. **Background / terminated:** on notification open, read `data.joinToken`.  
3. Navigate to Telehealth Join with that token.  
4. Do **not** open Zoom/Meet URLs as primary when `provider == chime`.

---

## 8. APIs (full detail)

### 8.1 Load waiting room / session

```http
GET /api/telehealth/join/{joinToken}
```

#### cURL

```bash
curl -sS "https://<API_HOST>/api/telehealth/join/$(python -c 'import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1], safe=""))' "$JOIN_TOKEN")"
```

Or simpler if token has no unsafe chars:

```bash
curl -sS "https://<API_HOST>/api/telehealth/join/<JOIN_TOKEN>"
```

#### Success `200`

```json
{
  "success": true,
  "session": {
    "clientName": "Jane Doe",
    "clinicianName": "Dr. Asha",
    "date": "2026-10-01",
    "startTime": "14:30",
    "status": "CHECKED_IN",
    "isVirtual": true,
    "waiting": true,
    "provider": "chime",
    "chimeReady": true,
    "chimeMeetingId": "2c579361-30be-4c43-bcaf-9e07c8842713",
    "zoomJoinUrl": null,
    "googleMeetJoinUrl": null
  }
}
```

#### Session fields Flutter should use

| Field | UI use |
|-------|--------|
| `clinicianName` | Header / “Waiting for Dr. X” |
| `date` + `startTime` | Subtitle |
| `chimeReady` | If `true`, enable **Join video** immediately; if `false`, wait + poll |
| `provider` | Prefer `chime` path when `"chime"` |
| `zoomJoinUrl` / `googleMeetJoinUrl` | **Optional fallback buttons only** if non-null |

#### Errors

| HTTP | Meaning | Flutter UI |
|------|---------|------------|
| `401` | Invalid / bad signature token | “Link invalid. Ask clinic for a new link.” |
| `404` | Appointment not found | Same |
| `410` | Cancelled or completed | “Visit ended / cancelled.” |
| `400` | Other | Show `error` string |

---

### 8.2 Mark “I’m here”

```http
POST /api/telehealth/join/{joinToken}
Content-Type: application/json

{ "action": "here" }
```

#### cURL

```bash
curl -sS -X POST "https://<API_HOST>/api/telehealth/join/<JOIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"action":"here"}'
```

#### Success `200`

Same shape as GET: `{ "success": true, "session": { ... } }`  
If appointment was `SCHEDULED`, status may become `CHECKED_IN` / `waiting: true`.

Call this when patient opens the join screen (or taps “I’m here”).

---

### 8.3 Get Chime Meeting + Attendee (join video)

```http
POST /api/telehealth/join/{joinToken}
Content-Type: application/json

{ "action": "chime" }
```

#### cURL

```bash
curl -sS -X POST "https://<API_HOST>/api/telehealth/join/<JOIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"action":"chime"}'
```

#### Success `200`

```json
{
  "success": true,
  "session": {
    "clientName": "Jane Doe",
    "clinicianName": "Dr. Asha",
    "date": "2026-10-01",
    "startTime": "14:30",
    "status": "IN_SESSION",
    "provider": "chime",
    "chimeReady": true,
    "chimeMeetingId": "2c579361-30be-4c43-bcaf-9e07c8842713",
    "zoomJoinUrl": null,
    "googleMeetJoinUrl": null
  },
  "chime": {
    "meetingId": "2c579361-30be-4c43-bcaf-9e07c8842713",
    "meeting": {
      "MeetingId": "2c579361-30be-4c43-bcaf-9e07c8842713",
      "ExternalMeetingId": "altrixs-clxxxxxxxx",
      "MediaRegion": "us-east-1",
      "MediaPlacement": {
        "AudioHostUrl": "...",
        "AudioFallbackUrl": "...",
        "SignalingUrl": "...",
        "TurnControlUrl": "...",
        "ScreenDataUrl": "...",
        "ScreenSharingUrl": "...",
        "ScreenViewingUrl": "..."
      }
    },
    "attendee": {
      "AttendeeId": "...",
      "ExternalUserId": "Jane Doe",
      "JoinToken": "...."
    },
    "Meeting": { "...": "same object as meeting" },
    "Attendee": { "...": "same object as attendee" },
    "joinToken": "<SAME as attendee.JoinToken — Chime credential>",
    "demoMode": false,
    "provider": "chime",
    "mediaRegion": "us-east-1"
  }
}
```

Use either camelCase (`meeting` / `attendee`) **or** AWS-style (`Meeting` / `Attendee`) — they are duplicates for SDK convenience.

#### Errors for `action: chime`

| HTTP | Meaning | Flutter UI |
|------|---------|------------|
| `409` | Meeting not created yet (doctor hasn’t launched) | “Waiting for your clinician to start video…” + retry every 3–5s |
| `401` / `404` / `410` | Same as GET | Invalid / ended visit |
| `500` | Server / AWS error | Show `error`; allow retry |

#### `demoMode`

| Value | Meaning |
|-------|---------|
| `false` | Real AWS Chime — join with SDK |
| `true` | Server has no live AWS keys — **do not** try real A/V; show error |

---

## 9. Recommended Flutter screen flow

```
Push tap / deep link
        │
        ▼
[TelehealthJoinScreen(joinToken)]
        │
        ├─ GET join/:token
        ├─ Show clinician + date/time
        ├─ POST action=here
        │
        ├─ if !chimeReady → show Waiting… poll GET or POST chime every 3–5s
        │
        └─ Button: "Join secure video"
                 │
                 ▼
         POST action=chime
                 │
                 ├─ 409 → stay waiting, retry
                 ├─ demoMode true → error dialog
                 └─ OK → [ChimeCallScreen(meeting, attendee)]
                              │
                              ├─ request camera/mic permission
                              ├─ Chime SDK join
                              ├─ local + remote video tiles
                              ├─ mute / camera / leave
                              └─ on leave → pop + stop A/V
```

### Suggested UX copy

- Waiting: `Waiting for your clinician. Keep this screen open.`
- Join button: `Join secure video call`
- 409: `Your clinician hasn’t started the video yet.`
- Leave: `Leave call`

---

## 10. Amazon Chime SDK on Flutter / mobile

### Package choice

Use one of:

1. **Official AWS Chime SDK for iOS + Android** via Flutter platform channels / existing community Flutter wrappers that wrap those SDKs  
2. A maintained pub.dev package that accepts **Meeting** + **Attendee** JSON from CreateMeeting / CreateAttendee  

Do **not** invent your own SFU. Do **not** put `AWS_ACCESS_KEY_ID` in the app.

### Join concept (all platforms)

AWS expects the same objects the server returns from CreateMeeting / CreateAttendee:

```dart
// Pseudocode — map to your plugin’s API
final chime = response['chime'] as Map<String, dynamic>;
final meeting = Map<String, dynamic>.from(chime['Meeting'] ?? chime['meeting']);
final attendee = Map<String, dynamic>.from(chime['Attendee'] ?? chime['attendee']);

if (chime['demoMode'] == true) {
  throw Exception('Video not configured on server');
}

await ChimeMeetingSession.join(
  meeting: meeting,
  attendee: attendee,
);
```

Web reference (same objects): `MeetingSessionConfiguration(meeting, attendee)` in `amazon-chime-sdk-js`.

### Permissions

**Android** (`AndroidManifest.xml`):

- `CAMERA`
- `RECORD_AUDIO`
- `MODIFY_AUDIO_SETTINGS`
- `INTERNET`

**iOS** (`Info.plist`):

- `NSCameraUsageDescription`
- `NSMicrophoneUsageDescription`

Request runtime permission **before** calling SDK join.

### Call controls (minimum)

| Control | Behavior |
|---------|----------|
| Mute / unmute | Local audio mute |
| Camera on / off | Stop/start local video tile |
| Leave | Stop session, release camera/mic, navigate back |

### Lifecycle

- `AppLifecycleState.paused`: keep call if possible (or show “return to call”)  
- On Leave / dispose: **always** stop Chime session so mic/camera release  
- Do not leave zombie meetings on background forever without UX

---

## 11. Polling / retry policy

```text
when POST action=chime returns 409:
  wait 3–5 seconds
  retry (max ~60 times ≈ 3–5 minutes)
  show “Still waiting for clinician…”
  if user leaves screen → cancel timer
```

Optional: also poll `GET` and check `session.chimeReady == true` before calling `action=chime`.

---

## 12. Deep links (optional but recommended)

Web patient page: `/telehealth/join/<token>`

Flutter should accept:

- Push `joinToken`  
- Universal / App Link: `https://<host>/telehealth/join/<token>`  
- Custom scheme if you already use one  

Extract token → same `TelehealthJoinScreen`.

---

## 13. What NOT to do

| Don’t | Why |
|-------|-----|
| Open Zoom/Meet as default video | Chime is system of record |
| Use `/api/telehealth/signal` as primary | Old browser WebRTC; backup only |
| Put AWS keys in Flutter | Security breach; meetings are server-created |
| Embed Amazon Connect CCP for patients | Connect is clinician web + PSTN phone |
| CreateMeeting from the phone | Only server (`POST /api/telehealth/room`) creates meetings |
| Confuse FCM `joinToken` with Chime `JoinToken` | Join will fail silently / auth errors |
| Ignore `demoMode: true` | SDK will fail; show clear error |

---

## 14. Phone calls (Amazon Connect) — out of Flutter video scope

- Doctor presses **Call {FirstName}** on web → Amazon Connect dials patient E.164 number.  
- Patient answers on the **cellular phone**.  
- Flutter app is not in the media path for v1.  
- Optional later: show “Clinic may call you” banner from appointment — not required for Chime video.

---

## 15. Backend endpoints Flutter does **not** call (clinician-only)

| Endpoint | Who |
|----------|-----|
| `POST /api/telehealth/room` | Doctor web (creates meeting + may push patient) |
| `GET /api/telehealth/room/:appointmentId` | Doctor web |
| `PATCH /api/telehealth/room/:appointmentId` | Doctor web (end meeting) |
| `POST /api/telehealth/token` | Doctor web (mint token + optional Zoom/Meet) |

Patient only needs **`/api/telehealth/join/:joinToken`**.

---

## 16. QA checklist (copy into PR)

### Push
- [ ] Patient logged in; device token registered  
- [ ] Doctor launches Chime on web  
- [ ] Patient receives `telehealth_call` with `provider=chime` and `joinToken`  
- [ ] Tap opens join screen (cold start + background)

### Join APIs
- [ ] GET returns session + `chimeReady`  
- [ ] POST `here` succeeds  
- [ ] POST `chime` before doctor launch → **409** + waiting UI  
- [ ] POST `chime` after doctor launch → `demoMode: false` + Meeting/Attendee  

### Video
- [ ] Doctor web + patient Flutter see each other  
- [ ] Audio both ways  
- [ ] Mute / camera / leave work  
- [ ] Second join (re-open) still works or shows clear ended state  

### Errors
- [ ] Expired token → 401/410 friendly message  
- [ ] Cancelled visit → 410  

---

## 17. Manual test without full UI (cURL)

1. Doctor launches Chime on web (or use clinician session to `POST /api/telehealth/room`).  
2. Copy `patientJoinToken` from response (or FCM `joinToken`).  
3. Run:

```bash
export API=https://<API_HOST>
export T='<patientJoinToken>'

curl -sS "$API/api/telehealth/join/$T" | jq .

curl -sS -X POST "$API/api/telehealth/join/$T" \
  -H 'Content-Type: application/json' \
  -d '{"action":"here"}' | jq .

curl -sS -X POST "$API/api/telehealth/join/$T" \
  -H 'Content-Type: application/json' \
  -d '{"action":"chime"}' | jq '.chime | {meetingId, demoMode, mediaRegion, hasMeeting:(.Meeting!=null), hasAttendee:(.Attendee!=null)}'
```

Expect `demoMode: false`, `hasMeeting: true`, `hasAttendee: true`.

---

## 18. Acceptance criteria (definition of done)

Flutter telehealth video is **done** when:

1. Doctor Launch Chime → patient push arrives within a few seconds.  
2. Patient joins in-app Chime video without opening Zoom/Meet.  
3. Doctor (web) and patient (Flutter) have working A/V in one meeting.  
4. Leave releases camera/mic.  
5. Early join shows wait + auto-retry, not a hard crash.

---

## 19. Support / failure matrix

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| No push | Device token not registered / Firebase mock | Register token; check backend Firebase Admin |
| Push but 401 on join | Stale/expired joinToken | Doctor relaunch Chime (new push) |
| Always 409 | Doctor never launched Chime | Ask clinician to Launch Chime |
| `demoMode: true` | Server AWS keys missing | Backend/env issue — not Flutter |
| SDK join fails | Wrong object / mixed tokens | Pass `Meeting` + `Attendee` from `action=chime` |
| No remote video | Permissions / one side didn’t start video | Check mic/camera permission + doctor still in call |

---

## 20. Message to paste for Flutter agent

```text
Altrixs telehealth VIDEO is now Amazon Chime SDK (us-east-1), not Zoom primary.

Read: docs/FLUTTER-TELEHEALTH-CHIME-HANDOFF.md (full contract).

Flow:
1) Keep FCM + POST /api/patient/device-token
2) Handle push type=telehealth_call, provider=chime, data.joinToken
3) GET/POST /api/telehealth/join/:joinToken
   - action=here
   - action=chime → use chime.Meeting + chime.Attendee with Amazon Chime mobile SDK
4) On 409, wait/retry (doctor not started yet)
5) Never put AWS keys in the app. Phone calls = PSTN via Connect (no Flutter Connect SDK for v1).

DoD: doctor web + patient Flutter two-way video in same Chime meeting.
```

---

**End of handoff.** Backend + AWS IAM for Chime are already live; Flutter join UI/SDK is the remaining patient-app work.
