# Altrixs / DivineCare Patient Mobile App (Flutter) — Complete API & cURL Guide

> **Base URL:**
> - Local Development: `http://localhost:3000` (or `http://10.0.2.2:3000` for Android Emulator)
> - Production Server: `https://altrixs.com`
>
> **Global Auth Header:**
> All protected routes require:
> `Authorization: Bearer <PATIENT_TOKEN>`
> `Content-Type: application/json`

---

## Table of Contents
1. [Authentication & Account Lifecycle](#1-authentication--account-lifecycle)
   - [1.1 Login (Email & Password)](#11-login-email--password)
   - [1.2 Logout](#12-logout)
   - [1.3 Forgot Password Request](#13-forgot-password-request)
   - [1.4 Reset Password Confirm](#14-reset-password-confirm)
   - [1.5 Accept Clinic Invite](#15-accept-clinic-invite)
   - [1.6 Delete Account](#16-delete-account)
2. [Patient Profile & Avatar](#2-patient-profile--avatar)
   - [2.1 Get Current Patient Profile](#21-get-current-patient-profile)
   - [2.2 Update Profile](#22-update-profile)
   - [2.3 Upload Avatar Photo](#23-upload-avatar-photo)
3. [Dashboard & Clinical Progress](#3-dashboard--clinical-progress)
   - [3.1 Get Home Dashboard](#31-get-home-dashboard)
   - [3.2 Get Health Progress & Treatment Plan](#32-get-health-progress--treatment-plan)
4. [Daily Mood & Mental Health Check-Ins](#4-daily-mood--mental-health-check-ins)
   - [4.1 List Past Check-Ins](#41-list-past-check-ins)
   - [4.2 Submit Today's Check-In](#42-submit-todays-check-in)
5. [Doctors & Appointments Booking](#5-doctors--appointments-booking)
   - [5.1 List Clinic Doctors](#51-list-clinic-doctors)
   - [5.2 Get Doctor Free Time Slots](#52-get-doctor-free-time-slots)
   - [5.3 List Patient Appointments](#53-list-patient-appointments)
   - [5.4 Book New Appointment](#54-book-new-appointment)
   - [5.5 Reschedule Appointment](#55-reschedule-appointment)
   - [5.6 Cancel Appointment](#56-cancel-appointment)
6. [1-to-1 Patient-Doctor Messaging & Real-Time Stream](#6-1-to-1-patient-doctor-messaging--real-time-stream)
   - [6.1 List Conversation Threads](#61-list-conversation-threads)
   - [6.2 Start New Conversation](#62-start-new-conversation)
   - [6.3 Get Message History](#63-get-message-history)
   - [6.4 Send Message](#64-send-message)
   - [6.5 Mark Message as Read](#65-mark-message-as-read)
   - [6.6 Real-Time Live Message Stream (SSE)](#66-real-time-live-message-stream-sse)
7. [Intake & Consent Forms](#7-intake--consent-forms)
   - [7.1 List Patient Forms](#71-list-patient-forms)
   - [7.2 Get Form Details](#72-get-form-details)
8. [Virtual Telehealth Video Calling](#8-virtual-telehealth-video-calling)
   - [8.1 Join Telehealth Room](#81-join-telehealth-room)
   - [8.2 Mark Patient Arrival](#82-mark-patient-arrival)

---

## 1. Authentication & Account Lifecycle

### 1.1 Login (Email & Password)
- **Method:** `POST`
- **Endpoint:** `/api/patient/login`
- **Auth:** Public (No header)

#### cURL Request:
```bash
curl -X POST "https://altrixs.com/api/patient/login" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "patient@example.com",
    "password": "Password123!"
  }'
```

#### Response (200 OK):
```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "patient": {
      "id": "client_abc123",
      "accountId": "acc_xyz789",
      "name": "Sarah Connor",
      "email": "patient@example.com",
      "status": "ACTIVE",
      "clinicId": "clinic_001",
      "assignedDoctorId": "doc_456",
      "assignedDoctorName": "Dr. Marcus Vance"
    }
  }
}
```

---

### 1.2 Logout
- **Method:** `POST`
- **Endpoint:** `/api/patient/logout`
- **Auth:** `Bearer <PATIENT_TOKEN>`

#### cURL Request:
```bash
curl -X POST "https://altrixs.com/api/patient/logout" \
  -H "Authorization: Bearer <PATIENT_TOKEN>"
```

#### Response (200 OK):
```json
{
  "success": true,
  "message": "Logged out successfully"
}
```

---

### 1.3 Forgot Password Request
- **Method:** `POST`
- **Endpoint:** `/api/patient/forgot-password`
- **Auth:** Public

#### cURL Request:
```bash
curl -X POST "https://altrixs.com/api/patient/forgot-password" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "patient@example.com"
  }'
```

#### Response (200 OK):
```json
{
  "success": true,
  "message": "If that email is registered, a password reset link has been sent."
}
```

---

### 1.4 Reset Password Confirm
- **Method:** `POST`
- **Endpoint:** `/api/patient/reset-password`
- **Auth:** Public

#### cURL Request:
```bash
curl -X POST "https://altrixs.com/api/patient/reset-password" \
  -H "Content-Type: application/json" \
  -d '{
    "token": "<RESET_TOKEN_FROM_EMAIL>",
    "password": "NewSecurePassword2026!"
  }'
```

#### Response (200 OK):
```json
{
  "success": true,
  "message": "Password updated successfully. Please log in with your new password."
}
```

---

### 1.5 Accept Clinic Invite
- **Method:** `POST`
- **Endpoint:** `/api/patient/invite/accept`
- **Auth:** Public

#### cURL Request:
```bash
curl -X POST "https://altrixs.com/api/patient/invite/accept" \
  -H "Content-Type: application/json" \
  -d '{
    "token": "<INVITE_TOKEN_FROM_SMS_OR_EMAIL>",
    "password": "MyInitialPassword123!"
  }'
```

#### Response (200 OK):
```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "patient": {
      "id": "client_abc123",
      "name": "Sarah Connor",
      "email": "patient@example.com"
    }
  }
}
```

---

### 1.6 Delete Account
*Meets Apple App Store & Google Play Store Account Deletion guidelines.*
- **Method:** `DELETE` or `POST /api/patient/delete-account`
- **Endpoint:** `/api/patient/me` OR `/api/patient/delete-account`
- **Auth:** `Bearer <PATIENT_TOKEN>`

#### cURL Request:
```bash
curl -X DELETE "https://altrixs.com/api/patient/me" \
  -H "Authorization: Bearer <PATIENT_TOKEN>"
```

#### Response (200 OK):
```json
{
  "success": true,
  "message": "Account successfully scheduled for deletion"
}
```

---

## 2. Patient Profile & Avatar

### 2.1 Get Current Patient Profile
- **Method:** `GET`
- **Endpoint:** `/api/patient/me`
- **Auth:** `Bearer <PATIENT_TOKEN>`

#### cURL Request:
```bash
curl -X GET "https://altrixs.com/api/patient/me" \
  -H "Authorization: Bearer <PATIENT_TOKEN>"
```

#### Response (200 OK):
```json
{
  "success": true,
  "data": {
    "client": {
      "id": "client_abc123",
      "name": "Sarah Connor",
      "email": "patient@example.com",
      "phone": "+1 (555) 234-5678",
      "image": "/uploads/client-avatars/client_abc123.webp",
      "addressLine1": "123 Main St",
      "addressLine2": "Apt 4B",
      "city": "Los Angeles",
      "state": "CA",
      "postalCode": "90001",
      "emergencyContactName": "John Connor",
      "emergencyContactPhone": "+1 (555) 987-6543"
    }
  }
}
```

---

### 2.2 Update Profile
- **Method:** `PATCH`
- **Endpoint:** `/api/patient/me`
- **Auth:** `Bearer <PATIENT_TOKEN>`

#### cURL Request:
```bash
curl -X PATCH "https://altrixs.com/api/patient/me" \
  -H "Authorization: Bearer <PATIENT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+15552345678",
    "emergencyContactName": "John Connor",
    "emergencyContactPhone": "+15559876543"
  }'
```

---

### 2.3 Upload Avatar Photo
Supports both standard multipart file upload and JSON dataUrl.
- **Method:** `POST`
- **Endpoint:** `/api/patient/avatar`
- **Auth:** `Bearer <PATIENT_TOKEN>`

#### cURL Request (Multipart):
```bash
curl -X POST "https://altrixs.com/api/patient/avatar" \
  -H "Authorization: Bearer <PATIENT_TOKEN>" \
  -F "avatar=@/path/to/profile_pic.jpg"
```

#### Response (200 OK):
```json
{
  "success": true,
  "data": {
    "avatarUrl": "/uploads/client-avatars/client_abc123.webp"
  }
}
```

---

## 3. Dashboard & Clinical Progress

### 3.1 Get Home Dashboard
*One fast call to populate the Flutter app's Home Tab.*
- **Method:** `GET`
- **Endpoint:** `/api/patient/dashboard`
- **Auth:** `Bearer <PATIENT_TOKEN>`

#### cURL Request:
```bash
curl -X GET "https://altrixs.com/api/patient/dashboard" \
  -H "Authorization: Bearer <PATIENT_TOKEN>"
```

#### Response (200 OK):
```json
{
  "success": true,
  "data": {
    "patient": {
      "name": "Sarah Connor",
      "streak": 7
    },
    "nextAppointment": {
      "id": "apt_123",
      "date": "2026-09-15",
      "time": "10:00 AM",
      "doctorName": "Dr. Marcus Vance",
      "isVirtual": true,
      "joinUrl": "https://altrixs.com/telehealth/join?token=abc"
    },
    "treatmentPlan": {
      "title": "Depression & Anxiety Recovery Plan",
      "reviewDate": "2026-10-01",
      "completedGoals": 3,
      "totalGoals": 5
    },
    "unreadMessagesCount": 2,
    "todayCheckInCompleted": false
  }
}
```

---

### 3.2 Get Health Progress & Treatment Plan
*Populates the Flutter app's Progress & Recovery Tab.*
- **Method:** `GET`
- **Endpoint:** `/api/patient/progress`
- **Auth:** `Bearer <PATIENT_TOKEN>`

#### cURL Request:
```bash
curl -X GET "https://altrixs.com/api/patient/progress" \
  -H "Authorization: Bearer <PATIENT_TOKEN>"
```

#### Response (200 OK):
```json
{
  "success": true,
  "data": {
    "goals": [
      { "id": "g1", "title": "Daily Mindfulness (10 mins)", "status": "IN_PROGRESS" },
      { "id": "g2", "title": "Sleep Schedule Consistency", "status": "ACHIEVED" }
    ],
    "safetyPlan": {
      "warningSigns": ["Restlessness", "Withdrawal"],
      "copingStrategies": ["Deep breathing", "Walk in park"],
      "emergencyContacts": ["988 Suicide & Crisis Lifeline"]
    },
    "assessmentTrends": {
      "phq9": [
        { "date": "2026-08-01", "score": 14, "severity": "Moderate" },
        { "date": "2026-09-01", "score": 8, "severity": "Mild" }
      ],
      "gad7": [
        { "date": "2026-08-01", "score": 12, "severity": "Moderate" },
        { "date": "2026-09-01", "score": 6, "severity": "Mild" }
      ]
    }
  }
}
```

---

## 4. Daily Mood & Mental Health Check-Ins

### 4.1 List Past Check-Ins
- **Method:** `GET`
- **Endpoint:** `/api/patient/check-ins?limit=10&skip=0`
- **Auth:** `Bearer <PATIENT_TOKEN>`

#### cURL Request:
```bash
curl -X GET "https://altrixs.com/api/patient/check-ins?limit=10&skip=0" \
  -H "Authorization: Bearer <PATIENT_TOKEN>"
```

---

### 4.2 Submit Today's Check-In
*Scores range from 1 to 10. Calling this increments the patient's daily streak.*
- **Method:** `POST`
- **Endpoint:** `/api/patient/check-ins`
- **Auth:** `Bearer <PATIENT_TOKEN>`

#### cURL Request:
```bash
curl -X POST "https://altrixs.com/api/patient/check-ins" \
  -H "Authorization: Bearer <PATIENT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "mood": 8,
    "stress": 3,
    "sleep": 8,
    "journal": "Had a restful night and feeling productive."
  }'
```

#### Response (201 Created):
```json
{
  "success": true,
  "data": {
    "checkIn": {
      "id": "chk_987",
      "mood": 8,
      "stress": 3,
      "sleep": 8,
      "journal": "Had a restful night and feeling productive.",
      "createdAt": "2026-09-11T12:00:00.000Z"
    },
    "streak": 8
  }
}
```

---

## 5. Doctors & Appointments Booking

### 5.1 List Clinic Doctors
- **Method:** `GET`
- **Endpoint:** `/api/patient/doctors`
- **Auth:** `Bearer <PATIENT_TOKEN>`

#### cURL Request:
```bash
curl -X GET "https://altrixs.com/api/patient/doctors" \
  -H "Authorization: Bearer <PATIENT_TOKEN>"
```

#### Response (200 OK):
```json
{
  "success": true,
  "data": {
    "doctors": [
      {
        "id": "doc_456",
        "name": "Dr. Marcus Vance",
        "role": "Psychiatrist",
        "specialty": "Adult Psychiatry & Medication Management",
        "image": "/uploads/staff/doc_456.png"
      }
    ]
  }
}
```

---

### 5.2 Get Doctor Free Time Slots
- **Method:** `GET`
- **Endpoint:** `/api/patient/doctors/:id/availability?from=YYYY-MM-DD&days=14`
- **Auth:** `Bearer <PATIENT_TOKEN>`

#### cURL Request:
```bash
curl -X GET "https://altrixs.com/api/patient/doctors/doc_456/availability?from=2026-09-15&days=7" \
  -H "Authorization: Bearer <PATIENT_TOKEN>"
```

#### Response (200 OK):
```json
{
  "success": true,
  "data": {
    "slots": [
      { "date": "2026-09-15", "startTime": "09:00", "endTime": "09:50" },
      { "date": "2026-09-15", "startTime": "10:00", "endTime": "10:50" },
      { "date": "2026-09-16", "startTime": "14:00", "endTime": "14:50" }
    ]
  }
}
```

---

### 5.3 List Patient Appointments
- **Method:** `GET`
- **Endpoint:** `/api/patient/appointments` (Pass `?includePast=true` for full visit history)
- **Auth:** `Bearer <PATIENT_TOKEN>`

#### cURL Request:
```bash
curl -X GET "https://altrixs.com/api/patient/appointments" \
  -H "Authorization: Bearer <PATIENT_TOKEN>"
```

---

### 5.4 Book New Appointment
- **Method:** `POST`
- **Endpoint:** `/api/patient/appointments`
- **Auth:** `Bearer <PATIENT_TOKEN>`

#### cURL Request:
```bash
curl -X POST "https://altrixs.com/api/patient/appointments" \
  -H "Authorization: Bearer <PATIENT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "clinicianId": "doc_456",
    "type": "Individual Therapy",
    "date": "2026-09-15",
    "startTime": "10:00",
    "endTime": "10:50",
    "isVirtual": true
  }'
```

#### Response (201 Created):
```json
{
  "success": true,
  "message": "Appointment requested",
  "data": {
    "appointment": {
      "id": "apt_777",
      "clinicianName": "Dr. Marcus Vance",
      "date": "2026-09-15",
      "startTime": "10:00",
      "endTime": "10:50",
      "status": "pending",
      "isVirtual": true
    }
  }
}
```

---

### 5.5 Reschedule Appointment
- **Method:** `PATCH`
- **Endpoint:** `/api/patient/appointments/:id/reschedule`
- **Auth:** `Bearer <PATIENT_TOKEN>`

#### cURL Request:
```bash
curl -X PATCH "https://altrixs.com/api/patient/appointments/apt_777/reschedule" \
  -H "Authorization: Bearer <PATIENT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "date": "2026-09-16",
    "startTime": "14:00",
    "endTime": "14:50",
    "note": "Work schedule conflict"
  }'
```

---

### 5.6 Cancel Appointment
- **Method:** `PATCH`
- **Endpoint:** `/api/patient/appointments/:id/cancel`
- **Auth:** `Bearer <PATIENT_TOKEN>`

#### cURL Request:
```bash
curl -X PATCH "https://altrixs.com/api/patient/appointments/apt_777/cancel" \
  -H "Authorization: Bearer <PATIENT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{}'
```

---

## 6. 1-to-1 Patient-Doctor Messaging & Real-Time Stream

### 6.1 List Conversation Threads
- **Method:** `GET`
- **Endpoint:** `/api/patient/conversations`
- **Auth:** `Bearer <PATIENT_TOKEN>`

#### cURL Request:
```bash
curl -X GET "https://altrixs.com/api/patient/conversations" \
  -H "Authorization: Bearer <PATIENT_TOKEN>"
```

#### Response (200 OK):
```json
{
  "success": true,
  "data": {
    "conversations": [
      {
        "id": "thread_001",
        "topic": "clinical",
        "status": "in-progress",
        "lastMessage": "Please continue with 20mg daily.",
        "lastMessageAt": "2026-09-11T10:15:00.000Z",
        "assignedStaff": "Dr. Marcus Vance",
        "unreadCount": 1
      }
    ]
  }
}
```

---

### 6.2 Start New Conversation
- **Method:** `POST`
- **Endpoint:** `/api/patient/conversations`
- **Topics:** `general`, `scheduling`, `billing`, `clinical`, `rx-refill`
- **Auth:** `Bearer <PATIENT_TOKEN>`

#### cURL Request:
```bash
curl -X POST "https://altrixs.com/api/patient/conversations" \
  -H "Authorization: Bearer <PATIENT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "topic": "clinical",
    "message": "Hello Doctor, I had a question regarding my medication dosage."
  }'
```

---

### 6.3 Get Message History
- **Method:** `GET`
- **Endpoint:** `/api/patient/conversations/:id/messages?page=1&limit=30`
- **Auth:** `Bearer <PATIENT_TOKEN>`

#### cURL Request:
```bash
curl -X GET "https://altrixs.com/api/patient/conversations/thread_001/messages?page=1&limit=30" \
  -H "Authorization: Bearer <PATIENT_TOKEN>"
```

#### Response (200 OK):
```json
{
  "success": true,
  "data": {
    "conversation": { "id": "thread_001", "topic": "clinical" },
    "messages": [
      {
        "id": "msg_1",
        "threadId": "thread_001",
        "senderRole": "patient",
        "senderName": "Sarah Connor",
        "body": "Hello Doctor, I had a question regarding my medication dosage.",
        "read": true,
        "createdAt": "2026-09-11T10:00:00.000Z"
      },
      {
        "id": "msg_2",
        "threadId": "thread_001",
        "senderRole": "clinician",
        "senderName": "Dr. Marcus Vance",
        "body": "Please continue with 20mg daily.",
        "read": false,
        "createdAt": "2026-09-11T10:15:00.000Z"
      }
    ],
    "pagination": { "total": 2, "page": 1, "limit": 30 }
  }
}
```

---

### 6.4 Send Message
- **Method:** `POST`
- **Endpoint:** `/api/patient/conversations/:id/messages`
- **Auth:** `Bearer <PATIENT_TOKEN>`

#### cURL Request:
```bash
curl -X POST "https://altrixs.com/api/patient/conversations/thread_001/messages" \
  -H "Authorization: Bearer <PATIENT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Understood, thank you Dr. Marcus."
  }'
```

---

### 6.5 Mark Message as Read
- **Method:** `PATCH`
- **Endpoint:** `/api/patient/messages/:id/read`
- **Auth:** `Bearer <PATIENT_TOKEN>`

#### cURL Request:
```bash
curl -X PATCH "https://altrixs.com/api/patient/messages/msg_2/read" \
  -H "Authorization: Bearer <PATIENT_TOKEN>"
```

#### Response (200 OK):
```json
{
  "success": true,
  "data": {
    "id": "msg_2",
    "read": true
  }
}
```

---

### 6.6 Real-Time Live Message Stream (SSE)
*Delivers messages in <50ms without polling delay. Keeps connection alive with a 15-second heartbeat ping.*
- **Method:** `GET`
- **Endpoint:** `/api/patient/conversations/:id/stream`
- **Auth:** `Bearer <PATIENT_TOKEN>`
- **Header:** `Accept: text/event-stream`

#### cURL Request:
```bash
curl -N -X GET "https://altrixs.com/api/patient/conversations/thread_001/stream" \
  -H "Authorization: Bearer <PATIENT_TOKEN>" \
  -H "Accept: text/event-stream"
```

#### Event Stream Output:
```text
event: connected
data: {"conversationId":"thread_001","connectedAt":"2026-09-11T12:00:00.000Z"}

: ping

event: message
data: {"id":"msg_3","threadId":"thread_001","senderRole":"clinician","senderName":"Dr. Marcus Vance","body":"Let me know if any side effects occur.","read":false,"createdAt":"2026-09-11T12:01:05.000Z"}
```

#### Flutter / Dart Integration Code:
```dart
import 'dart:convert';
import 'package:http/http.dart' as http;

void listenToLiveMessages(String conversationId, String token, Function(dynamic) onNewMessage) async {
  final client = http.Client();
  final request = http.Request(
    'GET',
    Uri.parse('https://altrixs.com/api/patient/conversations/$conversationId/stream'),
  );
  request.headers['Authorization'] = 'Bearer $token';
  request.headers['Accept'] = 'text/event-stream';

  final response = await client.send(request);
  response.stream
      .transform(utf8.decoder)
      .transform(const LineSplitter())
      .listen((line) {
        if (line.startsWith('data: ')) {
          final jsonStr = line.substring(6).trim();
          if (jsonStr.isNotEmpty) {
            final payload = jsonDecode(jsonStr);
            if (payload['id'] != null) {
              onNewMessage(payload);
            }
          }
        }
      }, onError: (err) {
        // Reconnect logic
      });
}
```

---

## 7. Intake & Consent Forms

### 7.1 List Patient Forms
- **Method:** `GET`
- **Endpoint:** `/api/patient/forms?page=1&limit=20`
- **Auth:** `Bearer <PATIENT_TOKEN>`

#### cURL Request:
```bash
curl -X GET "https://altrixs.com/api/patient/forms?page=1&limit=20" \
  -H "Authorization: Bearer <PATIENT_TOKEN>"
```

#### Response (200 OK):
```json
{
  "success": true,
  "data": {
    "forms": [
      {
        "id": "form_01",
        "type": "General Telehealth Consent",
        "status": "signed",
        "signedAt": "2026-08-10T14:30:00.000Z",
        "signedByName": "Sarah Connor"
      },
      {
        "id": "form_02",
        "type": "HIPAA Disclosure Authorization",
        "status": "pending",
        "expiresAt": "2026-10-01T00:00:00.000Z"
      }
    ],
    "pagination": { "total": 2, "page": 1, "limit": 20 }
  }
}
```

---

### 7.2 Get Form Details
- **Method:** `GET`
- **Endpoint:** `/api/patient/forms/:id`
- **Auth:** `Bearer <PATIENT_TOKEN>`

#### cURL Request:
```bash
curl -X GET "https://altrixs.com/api/patient/forms/form_01" \
  -H "Authorization: Bearer <PATIENT_TOKEN>"
```

---

## 8. Virtual Telehealth Video Calling

> **Updated 2026-10-01:** Primary video is **Amazon Chime SDK**, not LiveKit/Daily/Zoom.  
> Full Flutter contract: **`docs/FLUTTER-TELEHEALTH-CHIME-HANDOFF.md`** (use that as source of truth).

### 8.1 Join Telehealth Room
- **Method:** `GET`
- **Endpoint:** `/api/telehealth/join/:joinToken`
- **Auth:** Public — telehealth `joinToken` from FCM / deep link (not patient Bearer)

#### cURL Request:
```bash
curl -X GET "https://altrixs.com/api/telehealth/join/<JOIN_TOKEN>"
```

#### Response (200 OK):
```json
{
  "success": true,
  "session": {
    "clientName": "Jane Doe",
    "clinicianName": "Dr. Asha",
    "date": "2026-10-01",
    "startTime": "14:30",
    "status": "CHECKED_IN",
    "provider": "chime",
    "chimeReady": true,
    "chimeMeetingId": "...",
    "zoomJoinUrl": null,
    "googleMeetJoinUrl": null
  }
}
```

---

### 8.2 Mark Patient Arrival
- **Method:** `POST`
- **Endpoint:** `/api/telehealth/join/:joinToken`
- **Auth:** Public with token

#### cURL Request:
```bash
curl -X POST "https://altrixs.com/api/telehealth/join/<JOIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{ "action": "here" }'
```

---

### 8.3 Get Chime credentials (join video)
- **Method:** `POST`
- **Endpoint:** `/api/telehealth/join/:joinToken`
- **Body:** `{ "action": "chime" }`

#### cURL Request:
```bash
curl -X POST "https://altrixs.com/api/telehealth/join/<JOIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{ "action": "chime" }'
```

#### Response (200 OK):
```json
{
  "success": true,
  "session": { "provider": "chime", "chimeReady": true },
  "chime": {
    "meetingId": "...",
    "Meeting": { "MeetingId": "...", "MediaPlacement": {}, "MediaRegion": "us-east-1" },
    "Attendee": { "AttendeeId": "...", "JoinToken": "..." },
    "demoMode": false,
    "provider": "chime"
  }
}
```

Pass `chime.Meeting` + `chime.Attendee` into the Amazon Chime SDK.  
HTTP **409** = doctor has not launched video yet — retry.  
See **`docs/FLUTTER-TELEHEALTH-CHIME-HANDOFF.md`** for full flow, FCM, QA, and errors.

---

## 💡 Quick Tips for the Flutter Developer:
1. **Base URL Config:** Use an environment switcher (e.g. `String baseUrl = kDebugMode ? 'http://10.0.2.2:3000' : 'https://altrixs.com';`).
2. **Auth Interceptor:** Store `token` in `FlutterSecureStorage` and automatically inject `Authorization: Bearer $token` in all API calls. Telehealth **join** routes use path `joinToken` instead of Bearer.
3. **Real-Time SSE:** For screen chat, listen to `GET /api/patient/conversations/:id/stream`. It pushes doctor messages in <50ms without consuming battery or spamming HTTP polling!
4. **Postman Collection:** A ready-to-import Postman JSON collection is available at `docs/Flutter-Patient-App-API.postman_collection.json`.
5. **Video:** Use Chime handoff doc — do not treat Zoom/Meet/LiveKit as primary.
