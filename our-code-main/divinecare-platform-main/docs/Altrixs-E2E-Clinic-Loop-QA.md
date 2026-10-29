# Altrixs clinic loop — manual QA (Pack N)

Junior-friendly walkthrough of one patient from waitlist to claim, plus role switch and Rx stub.

This is a **staff portal**. The patient never logs in here. They only open a **public intake link** (`/intake/...`).

Do **not** expect SMS, real insurance clearinghouse, or pharmacy EPCS. Those are stubs where noted.

---

## Before you start

1. App running: `npm run dev` → usually `http://localhost:3000`
2. Database seeded:
   - Default clinic: `npm run db:seed`
   - 11-role demo clinic: `npm run db:create-role-demo-clinic`
3. Password for every seed user below: **`Altrixs@123`**
4. After each login, if the URL jumps to `/dashboard` and the sidebar looks empty, you used the **wrong role** for that page (Pack L redirects). Log out and use the email in the step.

**Two clinics (do not mix patients):**

| Clinic | What it is for |
| --- | --- |
| **Role demo** (`*@role-demo.local`) | Steps 1–6 and 8 (waitlist → claim → Rx) |
| **Default seed** (`*@altrixs.local`) | Step 7 only (multi-role switch). Those users are **not** on the role-demo org. |

---

## Logins (copy-paste)

| Who | Email | Role on login | Use for |
| --- | --- | --- | --- |
| Front Desk | `office@role-demo.local` | FRONT_DESK | Waitlist, intake invite, schedule, appointment check-in |
| Therapist | `therapist@role-demo.local` | THERAPIST | Notes, alerts, client check-in (assigned clients only) |
| Billing | `billing@role-demo.local` | BILLING | Eligibility stub, draft claim |
| Psychiatrist | `psychiatrist@role-demo.local` | PSYCHIATRIST | Rx stub |
| NP | `np@role-demo.local` | NP | Rx stub (same page as psych) |
| Multi-role | `multirole@altrixs.local` | THERAPIST + FRONT_DESK + BILLING + HR | Role switcher |
| Admin (smoke / backup) | `admin@altrixs.local` or `admin@role-demo.local` | ADMIN | Dashboard smoke; can open most pages **on their own clinic** |

Log out between role changes: sidebar user menu / Log out, then `/login`.

---

## Honest product notes (so you do not file fake bugs)

| Feature | What is real | What is a stub |
| --- | --- | --- |
| Intake invite | Link is created and **copied to clipboard**. Digital Intake list updates. | Email is **not** required to arrive in Gmail. Paste the URL yourself. |
| Consents | Public intake has a Consents step. Staff **Consents** page can show pending until the client finishes. | Not a DocuSign product. |
| AI Draft Note | Button opens a generator and fills a draft. | On-device template, not a live clinical AI vendor. Skip if you want; still Pass if Sign → Lock works. |
| Eligibility | **Run Eligibility Check** saves a Coverages result in DB when Availity OAuth env is set. | Requires live Availity credentials + client payer/member + user NPI. |
| Claim from locked note | **Generate claim** creates a **DRAFT** claim tied to that note. | Clearinghouse submit is stub. |
| E-Prescribing | Psych/NP can add an Rx on the page. | Saved in browser module list, **not** a pharmacy network. Demo rows may show names that are not your new patient. |
| Messages | Staff ↔ **client chart**, not staff-to-staff. | Patient has **no** inbox in this app. Out of scope for this loop. |

---

## Screenshot points (optional, for a QA packet)

Save as `01-waitlist.png`, `02-intake-link.png`, … if a lead asks for evidence.

1. Waitlist row after **Add to waitlist**
2. Same row after **Match clinician** (status Matched)
3. Alert popup with `/intake/...` URL after **Convert to Intake**
4. Digital Intake list showing that person **pending**
5. Public intake last step (Consents / Signature) — incognito window
6. Appointments: one **Virtual** + one in-person
7. Appointment row after **Check in**
8. Progress Notes: Draft → Signed → Locked
9. Alerts: new **Low mood** (or existing unreviewed) then after Review
10. Eligibility result row
11. Claims: new **Draft** from locked note
12. Multi-role: sidebar + home **before** and **after** switch
13. Prescriptions: new stub Rx at top of list

---

## The loop (do in order)

Use a unique fake patient so you can find them later, e.g. name **QA Loop Kid**, email **`qa.loop.kid@example.com`**.

### Step 1 — FRONT_DESK: waitlist → match → intake invite → pending

1. Login: `office@role-demo.local`
2. Sidebar → **Waitlist** (`/dashboard/clients/waitlist`)
3. **Add to waitlist**
   - Name: `QA Loop Kid`
   - **Email required** (intake will fail without it)
   - Specialty any (e.g. CBT)
4. On the new row click **Match clinician** → pick **Therapist Nia Patel** (so notes/alerts work later) → confirm
5. Click **Convert to Intake** → confirm
6. A dialog shows the URL. It is also copied. Paste it in Notepad.
7. You should land on **Digital Intake**. Status for this person: **pending** (not completed).
8. Optional: **Consents** (`/dashboard/ehr/consents`) — filter **Pending**. Empty is OK if no consent row exists until the form is submitted.

**Pass if:** waitlist entry exists, matched, intake link works (you can open it), Digital Intake shows pending.

---

### Step 2 — Client completes public intake (no staff login)

1. **Incognito** (or another browser). Do not stay logged in as office staff.
2. Paste `http://localhost:3000/intake/<token>`
3. Walk the steps: Demographics → Insurance → Medical History → Consents (tick the boxes) → Signature (type a name)
4. Submit until you see a success / thank-you style screen (not an error)
5. Back in staff (office or therapist): Digital Intake should show **completed**. **Clients** roster should include **QA Loop Kid**.

**Pass if:** token page works without staff login; after submit, a **client chart** exists.

---

### Step 3 — Schedule appointment (virtual + in-person)

Still Front Desk (or Therapist — both can open Appointments).

1. `/dashboard/appointments`
2. Create **two** visits for **QA Loop Kid** (or any visible client if the new one is missing — that is a **Fail** on step 2):
   - Visit A: tick **Virtual** (this is telehealth-capable)
   - Visit B: leave Virtual **off** (in-person)
3. Pick today’s date if you want Check in in the next step.

**Pass if:** both appointments appear; Virtual badge on A only.

---

### Step 4 — Check-in → note draft → AI optional → sign → lock

**Appointment check-in (front desk):**

1. On today’s appointment click **Check in**. Status should leave “scheduled” / show checked-in (wording on screen).

**Clinical note (therapist — Front Desk cannot open Notes):**

1. Log out. Login: `therapist@role-demo.local`
2. `/dashboard/ehr/notes`
3. Optional: **AI Draft Note** → pick the client → generate → use draft. Skip is OK.
4. **+ New Note** → pick **QA Loop Kid** (must be assigned to this therapist from Match) → write one sentence → **Save Note** (status **Draft**)
5. On the note: **Sign** → status **Signed**
6. **Lock** / **Lock Note** → status **Locked**

If the client is missing: you matched the wrong clinician, or intake did not create assignment. Fail and note it.

**Pass if:** Check in works; note is **Locked** after Sign (cannot skip Lock if you want step 6).

---

### Step 5 — Risk alert from low mood check-in → review

Still therapist (assigned client) **or** office (can log check-in on the chart).

1. **Clients** → open **QA Loop Kid**
2. **Log check-in**: Mood slider **2**/10 (must be ≤ 3). Stress any. Optional note without crisis words.
3. **Save check-in**
4. Sidebar → **Alerts** (`/dashboard/alerts`)
5. Filter **Unreviewed**. You should see **Low mood** for that client.
6. Review / close it. If severity is **high** (mood ≤ 2), type a response **at least 8 characters**.

Seed data may already show low-mood alerts for **Marcus Thompson**. Using a **new** check-in on QA Loop Kid is the real loop.

**Pass if:** alert appears from mood ≤ 3 and you can mark it reviewed.

---

### Step 6 — BILLING: eligibility stub → draft claim from locked note

1. Log out. Login: `billing@role-demo.local`
2. `/dashboard/ehr/eligibility` → pick the client → **Run Eligibility Check**
3. A row should persist (Active / Pending / etc.). Real payer API is **not** required.
4. `/dashboard/billing/claims`
5. Under **Generate from locked note**, pick the locked note from step 4 → **Generate claim**
6. New claim status **Draft**

If the list of locked notes is empty: step 4 Lock did not persist, or you are on the **other** clinic.

**Pass if:** eligibility row saved; draft claim exists for that locked note.

---

### Step 7 — Multi-role user: switch role; nav + home change

**Different clinic.** This does not use QA Loop Kid.

1. Login: `multirole@altrixs.local`
2. Left sidebar bottom: **role switcher** (only shows if the user has more than one role)
3. Note current home (Therapist-style overview) and which menu items you see (e.g. Notes, Alerts)
4. Switch to **Front Desk** (FRONT_DESK) → page goes to `/dashboard`
   - Home should look like a **front-desk board** (schedule / waitlist language)
   - **Billing claims** / **Notes** should **not** stay in the same nav as therapist
5. Switch to **Billing** → home is billing-oriented; Claims visible; clinical Notes blocked (URL sends you back to `/dashboard`)
6. Switch to **HR** → HR-style home; waitlist/claims blocked

**Pass if:** switcher works, home layout changes, blocked URLs do not stay open.

---

### Step 8 — Psych / NP only: create Rx stub

1. Login: `np@role-demo.local` **or** `psychiatrist@role-demo.local`
2. `/dashboard/ehr/prescriptions`
3. New Rx: pick a **client from the dropdown**, medication, pharmacy → save
4. New row appears at the top of the list

**Negative check (Pass if blocked):** `therapist@role-demo.local` opening `/dashboard/ehr/prescriptions` should bounce to `/dashboard`. Admin can **open** the page on some clinics but **create** is Psych/NP only (button disabled for Admin).

**Pass if:** NP or Psych can add a stub Rx; therapist cannot use the page.

---

## Pass / Fail table (fill this once on local seed)

Date: _____________  Tester: _____________  App URL: _____________

| # | Step | Pass / Fail | Notes (error text, screenshot #) |
| --- | --- | --- | --- |
| 1 | Waitlist add → match → Convert to Intake → pending | | |
| 2 | Public `/intake/{token}` completes; client appears | | |
| 3 | Two appointments: virtual + in-person | | |
| 4 | Appointment Check in; note Draft → Sign → Lock | | |
| 5 | Mood ≤ 3 check-in → Alerts → review | | |
| 6 | Eligibility stub + Generate claim from locked note | | |
| 7 | `multirole@altrixs.local` switch: nav + home change | | |
| 8 | NP or Psych Rx stub; therapist blocked | | |

**How to file a Fail:** one bug per step. Include email used, URL, and whether you were on role-demo vs altrixs.local. Do not file “email never arrived” for intake.

---

## Optional Playwright smoke (not the full loop)

One test only: admin logs in and `/dashboard` returns 200.

```bash
npx playwright install chromium
npx playwright test tests/e2e/smoke.spec.ts
```

Needs `npm run dev` (or the config will start it), a reachable database, and a seeded admin (`admin@altrixs.local` / `Altrixs@123`).

If the login page shows “could not connect to the authentication service”, the smoke **fails on purpose** — fix DB/tunnel first, then rerun.

Override with `PLAYWRIGHT_ADMIN_EMAIL` / `PLAYWRIGHT_ADMIN_PASSWORD` / `PLAYWRIGHT_BASE_URL`.

This is **not** a test of waitlist, intake, or claims.
