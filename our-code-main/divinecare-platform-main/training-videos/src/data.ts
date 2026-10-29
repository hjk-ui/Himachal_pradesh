// Per-role training video content — every feature the role touches, step by step.
// Source of truth: the Altrixs prescriber curriculum + role walkthroughs (Oct 2026).

export type Scene = {
  title: string;
  kicker?: string; // small label above the title, e.g. the nav path
  steps: string[];
  callout?: string; // amber rule/guardrail banner shown after the steps
};

export type RoleVideo = {
  id: string; // composition id
  role: string; // on-screen role label
  tagline: string;
  scenes: Scene[];
};

export const VIDEOS: RoleVideo[] = [
  // ───────────────────────── PRESCRIBERS ─────────────────────────
  {
    id: "prescriber",
    role: "Psychiatrists & Nurse Practitioners",
    tagline: "Your complete clinical workflow — from sign-in to signed note.",
    scenes: [
      {
        title: "Sign in & get oriented",
        steps: [
          "Go to altrixs.com and sign in — your role badge shows Psychiatrist or NP",
          "Amber DEMO tag = sandbox. No tag = the real record",
          "Location switcher: Bowie · Silver Spring · Baltimore, or All Locations",
          "Sidebar groups: Clinical, EHR, AI & Analytics — badges are live counts",
        ],
        callout: "Practice everything in the demo sandbox first — it never touches real charts.",
      },
      {
        title: "Your day: schedule & To-Do",
        steps: [
          "Dashboard opens to today: appointments, alerts, signatures waiting",
          "My To-Do is your work queue — co-signs, reviews, SUD prompts, messages",
          "Appointments shows your day or week, filtered to your location",
        ],
      },
      {
        title: "Find any client in two keystrokes",
        kicker: "Ctrl+K · ⌘K",
        steps: [
          "Press Ctrl+K anywhere — type a few letters, press Enter, chart opens",
          "The same palette jumps to any page and runs quick actions",
          "Prefer browsing? The Clients list has filters",
        ],
      },
      {
        title: "Chart review, meds & labs",
        kicker: "Client chart · EHR → Lab Orders & Results",
        steps: [
          "Walk the chart: demographics, treatment team, diagnoses, med list, allergies",
          "Antipsychotic clients carry an automatic QTc/EKG safety flag",
          "Order labs and e-sign the requisition — no wet signature, no printer",
          "Results return to the chart; pending results show on the dashboard",
        ],
        callout: "The QTc flag clears with a documented EKG — the system tracks it so you don't have to.",
      },
      {
        title: "The visit note",
        kicker: "EHR → Progress Notes",
        steps: [
          "Pick the note type — each template carries the right structure",
          "Generate the AI draft, then edit — the draft is a start, never a finish",
          "AI Coding suggests the E&M level from what you documented; you confirm",
          "Sign to lock. Changes after signature are addenda, never edits",
        ],
        callout: "AI drafts. You sign. Nothing files itself.",
      },
      {
        title: "e-Prescribing with DrFirst",
        kicker: "EHR → E-Prescribing",
        steps: [
          "One click opens Rcopia signed-in, client in context — no second login",
          "Med history and formulary load there; reconcile against the chart",
          "Controlled substances use your EPCS token — two-factor at signature",
          "PDMP (CRISP) check runs from the same screen before you sign",
          "Refill requests land in the queue — approve or deny with a reason",
        ],
        callout: "EPCS identity-proofing must be complete by Oct 23 — it blocks live prescribing.",
      },
      {
        title: "Screeners & SUD referral alerts",
        kicker: "EHR → SUD Screeners · Risk Alerts",
        steps: [
          "AUDIT, CAGE-AID, NIDA, BAM score themselves as you tap",
          "Threshold hits route a referral prompt to YOU — Risk Alerts, To-Do, push",
          "A positive screen cannot be filed without routing the alert",
          "Confirmed positives flow into the ASAM assessment for level of care",
          "The AI radar also catches SUD language buried in notes",
        ],
      },
      {
        title: "Telehealth & secure messages",
        steps: [
          "Join video from the appointment — built in, client joins by text link",
          "POS and telehealth modifiers set automatically on the note",
          "Client portal messages are triaged by front office — clinical ones reach your To-Do",
        ],
      },
      {
        title: "AOT evals & continued-stay reviews",
        kicker: "AOT Program · Residential → Assessments Due",
        steps: [
          "The psychiatric eval produces your court affidavit — 30-day exam window enforced",
          "AI drafts the factual-basis paragraphs; you edit and own every word",
          "Continued-stay reviews: every 7 days (ASAM 3.5), every 30 (3.1)",
          "A lapsed review blocks that client's billing the same night",
        ],
      },
      {
        title: "Crisis pages & go-live rules",
        steps: [
          "Crisis pages you by text and push — no PHI, just a secure link",
          "The link opens the live episode timeline in Mobile Crisis",
          "Valant is the record until Fri Oct 30, 5 pm — then fix forward in Altrixs",
          "Every issue goes in the shared issue log, never by text",
        ],
        callout: "Your two deadlines: data check by Oct 21 · EPCS by Oct 23.",
      },
    ],
  },

  // ───────────────────────── THERAPISTS ─────────────────────────
  {
    id: "therapist",
    role: "Therapists",
    tagline: "Documentation that drafts itself — your job is clinical judgment.",
    scenes: [
      {
        title: "Sign in & your day",
        steps: [
          "Go to altrixs.com and sign in — role badge shows Therapist; amber DEMO tag = sandbox",
          "Dashboard opens to today; My To-Do is your work queue",
          "Pick your location: Bowie · Silver Spring · Baltimore",
        ],
      },
      {
        title: "Find clients fast",
        kicker: "Ctrl+K · ⌘K",
        steps: [
          "Ctrl+K anywhere — type a name, Enter, chart opens",
          "The same palette jumps to pages and quick actions",
        ],
      },
      {
        title: "Progress notes & the AI draft",
        kicker: "EHR → Progress Notes",
        steps: [
          "Pick the note type — 17 templates, each with the right structure",
          "AI drafts the narrative from your session; edit before anything files",
          "Sign to lock — addenda after, never edits",
          "AI Coding suggests the CPT; you confirm",
        ],
        callout: "AI drafts. You sign. Nothing files itself.",
      },
      {
        title: "Treatment plans & the Goal Bank",
        kicker: "EHR → Treatment Plans · Goal Bank",
        steps: [
          "Build plans from the Goal Bank — browse goals by domain",
          "Always individualize the language — cloned goals are an audit flag",
          "Plan review dates surface on your To-Do before they lapse",
        ],
      },
      {
        title: "Assessments & measures",
        kicker: "EHR → Assessments · MBC",
        steps: [
          "C-SSRS runs as a guided page with computed risk tiers",
          "PHQ-9 / GAD-7 trend per client in MBC Outcome Measures",
          "SUD screeners (AUDIT, CAGE-AID) auto-score — threshold hits route to the prescriber",
        ],
      },
      {
        title: "Safety planning & risk alerts",
        steps: [
          "Safety plans live in the chart — warning signs, coping steps, contacts",
          "Reach a client's plan straight from their Risk Alert",
          "High-risk C-SSRS connects to the crisis workflow — 988 first, always",
        ],
      },
      {
        title: "Telehealth & messages",
        steps: [
          "Join video from the appointment; client joins by text link",
          "Clinical portal messages are forwarded to your To-Do — answer and resolve there",
        ],
      },
      {
        title: "When crisis involves your client",
        steps: [
          "Mobile Crisis handles dispatch — you'll get the post-intervention summary",
          "Read the episode timeline before their next session",
          "Your SUD screener results feed the residential referral pipeline",
        ],
      },
      {
        title: "Go-live rules",
        steps: [
          "Valant is the record until Fri Oct 30, 5 pm",
          "Check your migrated caseload by Oct 21 — report gaps in the issue log",
          "Nov 2–4 schedules are reduced on purpose — use the slack to document well",
        ],
      },
    ],
  },

  // ───────────────────────── FRONT DESK ─────────────────────────
  {
    id: "front-desk",
    role: "Front Desk & Office Managers",
    tagline: "Check-in, scheduling, and every phone line — one screen.",
    scenes: [
      {
        title: "Sign in & your site",
        steps: [
          "Go to altrixs.com and sign in — role badge shows Office Manager; DEMO tag = sandbox",
          "Location switcher sets your site — your schedule and queues follow it",
        ],
      },
      {
        title: "Scheduling",
        kicker: "Appointments",
        steps: [
          "Book, reschedule, cancel from the Appointments view",
          "Telehealth visits send the client a join link by text automatically",
          "Ctrl+K finds any client or page in two keystrokes",
        ],
      },
      {
        title: "Digital intake",
        kicker: "Clients → Digital Intake",
        steps: [
          "Send the intake link by text or email from the intake page",
          "Track completion — demographics, insurance, consents arrive signed",
          "Completed intakes create the chart shell automatically",
        ],
      },
      {
        title: "Eligibility at check-in",
        kicker: "EHR → Eligibility",
        steps: [
          "Run the coverage check (270/271) before the visit",
          "Read active coverage, copay, and plan in seconds",
          "Coverage surprises get flagged to billing — not discovered at claim time",
        ],
      },
      {
        title: "SMS, calls & secure messages",
        kicker: "Communications",
        steps: [
          "Client texting and calling runs through Amazon Connect — one thread per client",
          "Secure Messages: you triage everything; forward clinical questions to the provider",
          "Crisis language in any message gets flagged automatically",
        ],
      },
      {
        title: "Dial & Directory",
        kicker: "Communications → Dial & Directory",
        steps: [
          "Team queues: Crisis Team, each site's front desk, Billing",
          "Staff directory rings a teammate directly — no phone numbers to remember",
          "Payers, pharmacies, labs, courts, and vendor support are preloaded",
        ],
      },
      {
        title: "Waitlist & referrals",
        steps: [
          "The waitlist tracks who's waiting, for what, and how long",
          "Inbound referrals route to the right program — crisis, residential, AOT, PRP",
        ],
      },
      {
        title: "Go-live week",
        steps: [
          "From Oct 19: any Nov 2+ booking goes in BOTH systems the same day",
          "Valant is the record until Fri Oct 30, 5 pm",
          "Downtime packet lives at your desk; 8:00 am huddle every day",
          "Every issue goes in the shared log — never by text",
        ],
        callout: "Your data check deadline: Mon Oct 19.",
      },
    ],
  },

  // ───────────────────────── BILLING ─────────────────────────
  {
    id: "billing",
    role: "Billing Specialists",
    tagline: "Claims that gate themselves — compliance built into the charge.",
    scenes: [
      {
        title: "Sign in & billing home",
        steps: [
          "Go to altrixs.com and sign in — role badge shows Billing Specialist; DEMO tag = sandbox",
          "Billing home: claims queue by status, payments, invoices",
        ],
      },
      {
        title: "Fee schedule & codes",
        kicker: "Billing → CPT tab",
        steps: [
          "The full BH fee schedule: therapy, E&M, crisis, PRP (H2017), peer, TCM",
          "Residential per-diems: H0018 (ASAM 3.5) · H0019 (3.1) — POS 55",
          "Mobile crisis: H2011 per 15 min — POS 15",
        ],
      },
      {
        title: "BH Payer Settings",
        kicker: "Billing → BH Payer Settings",
        steps: [
          "Maryland Medicaid BH routes to Optum Maryland (Incedo) — never the MCO",
          "The coverage matrix shows code × payer: covered, PA required, or not",
          "Billing rules auto-apply modifiers: HF, U3, HK, credential levels, Mod 59",
        ],
        callout: "The ASO carve-out rule is a hard stop — misdirected BH claims are the #1 Maryland denial.",
      },
      {
        title: "Claim scrubber",
        steps: [
          "Every claim runs the scrubber before submission",
          "Errors name the rule that fired and how to fix it",
          "Unit caps (H2017 max 16/day) and PA checks run automatically",
        ],
      },
      {
        title: "Residential & Crisis billing",
        kicker: "Billing → Residential & Crisis",
        steps: [
          "Census-driven per-diems: every occupied bed, one charge per night",
          "Charges BLOCK when the continued-stay review lapses or PA runs out",
          "Crisis charges draft from episode minutes — held until docs complete",
          "Low PA units warn early so concurrent review starts in time",
        ],
      },
      {
        title: "Denials & AI appeals",
        kicker: "Billing → Denial Management",
        steps: [
          "Denials sort by status with appeal deadlines counting down",
          "Draft with AI writes the appeal letter from the denial and chart evidence",
          "You edit and submit — the AI never sends anything itself",
        ],
      },
      {
        title: "Payments, ERA & A/R",
        steps: [
          "ERA files post automatically; exceptions go to review",
          "A/R Control Center works the aging by payer and balance",
          "eStatements and AutoPay handle the patient side",
        ],
      },
      {
        title: "Go-live",
        steps: [
          "Waystar is the clearinghouse — enrollments confirmed before Nov 2",
          "Visits before Nov 2 bill from Valant — never re-billed in Altrixs",
          "Claims held the first days, checked, then released payer by payer",
        ],
        callout: "Your data check deadline: Thu Oct 22.",
      },
    ],
  },

  // ───────────────────────── MEDICAL ASSISTANT ─────────────────────────
  {
    id: "medical-assistant",
    role: "Medical Assistants",
    tagline: "Rooming, vitals, and visit prep — the medical day, organized.",
    scenes: [
      {
        title: "Sign in & your home",
        steps: [
          "Go to altrixs.com and sign in — role badge shows Medical Assistant; DEMO tag = sandbox",
          "Medical Overview is your home — today's visits and prep",
          "Set your location (Silver Spring runs the medical department)",
        ],
      },
      {
        title: "Patients — both departments",
        steps: [
          "Medical → Patients for the medical panel",
          "The full Clients list is open to you for scheduling and demographics",
          "Ctrl+K finds anyone in two keystrokes",
        ],
        callout: "BH clinical narratives stay restricted — you see what rooming needs, per minimum necessary.",
      },
      {
        title: "New patient intake",
        kicker: "Medical → New Patient Intake",
        steps: [
          "Start intake; demographics and insurance come from the digital intake link",
          "Verify coverage at creation — eligibility runs from the same screen",
        ],
      },
      {
        title: "Rooming & vitals",
        kicker: "Medical → Vitals",
        steps: [
          "Enter vitals at rooming — BP, pulse, weight, BMI computes",
          "Out-of-range values flag for the provider automatically",
          "Vitals history trends across visits",
        ],
      },
      {
        title: "Labs",
        kicker: "Medical → Labs & Results",
        steps: [
          "Prep lab orders for provider signature — requisitions e-sign, no printer",
          "Incoming results route to the ordering provider",
          "Track pending results so nothing sits unseen",
        ],
      },
      {
        title: "Visits & history",
        steps: [
          "Medical Visits lists the day's schedule with prep status",
          "Medical History holds problems, meds, allergies for your review",
          "Flag anything odd to the provider before the visit, not during",
        ],
      },
      {
        title: "Communications & go-live",
        steps: [
          "Dial & Directory reaches any teammate or queue without a phone list",
          "From Oct 19, Nov 2+ bookings go in both systems same day",
          "Issues go in the shared log; 8:00 am huddle daily during go-live",
        ],
        callout: "Your data check deadline: Wed Oct 21.",
      },
    ],
  },

  // ───────────────────────── CRISIS RESPONDER ─────────────────────────
  {
    id: "crisis-responder",
    role: "Crisis Responders",
    tagline: "From page to follow-up — the whole episode in one timeline.",
    scenes: [
      {
        title: "Sign in & your view",
        steps: [
          "Go to altrixs.com and sign in — role badge shows Crisis Responder; DEMO tag = sandbox",
          "Mobile Crisis and Risk Alerts are your home screens",
        ],
      },
      {
        title: "The command center",
        kicker: "Mobile Crisis",
        steps: [
          "Episode board: every active episode with priority and status",
          "Team availability shows who's on and ETA",
          "Response standards: P1 face-to-face within 60 min · P2 within 2 hrs",
        ],
      },
      {
        title: "Smart triage",
        steps: [
          "Safety gates first: medical emergency, weapons, attempt in progress",
          "One Yes routes the call instantly — EMS, co-response, or Priority 1",
          "Risk and protective factors compute the dispatch qualification",
          "The Aria copilot suggests probes — decision support, never the decision",
        ],
      },
      {
        title: "Dispatch & paging",
        steps: [
          "Dispatch pages the unit automatically — SMS, push, SNS to supervisor",
          "Pages carry no PHI — a secure link opens the episode",
          "Re-page from the episode, or page all-hands from the command center",
        ],
      },
      {
        title: "On-scene documentation",
        steps: [
          "Log timestamped events: en route, on scene, interventions",
          "MSE chips, intervention checklist, LRA justification",
          "Capture the person's own words — person-centered is a CARF requirement",
        ],
      },
      {
        title: "Post-intervention",
        steps: [
          "One click notifies the clinician, supervisor, and referral source",
          "AI drafts the episode summary from the timeline — you review and file",
          "24-hr contact and 72-hr check are required before the episode closes",
          "Billable units compute from your documented minutes",
        ],
        callout: "The episode cannot close until docs, notifications, and follow-ups are set.",
      },
      {
        title: "Ground rules",
        steps: [
          "988-first, engagement-first — enforcement is never step one",
          "Every episode feeds the CARF checklist automatically",
          "Issues during go-live week go in the shared log",
        ],
      },
    ],
  },

  // ───────────────────────── PRACTICE DIRECTOR ─────────────────────────
  {
    id: "director",
    role: "Practice Directors & Leadership",
    tagline: "Every location, program, and dollar — visible from one seat.",
    scenes: [
      {
        title: "Sign in & All Locations",
        steps: [
          "Go to altrixs.com and sign in — your role sees everything, every site",
          "Bowie · Silver Spring · Baltimore roll up to one practice view",
        ],
      },
      {
        title: "Program boards",
        steps: [
          "Mobile Crisis: live episodes, response times, follow-up rates",
          "Residential: bed board, census, assessments due",
          "AOT: caseboard with every statutory deadline flagged",
        ],
      },
      {
        title: "Quality & compliance",
        kicker: "Quality & Compliance",
        steps: [
          "QI dashboard collects every program's exceptions",
          "Incident reports flow to review; compliance calendar tracks the year",
          "CARF checklists fill themselves from real workflow data",
        ],
      },
      {
        title: "Revenue oversight",
        steps: [
          "Billing dashboards: claims, denials, A/R by payer",
          "Residential & Crisis billing shows blocked revenue and why",
          "The blocks are compliance working — a gated charge beats a recoupment",
        ],
      },
      {
        title: "AI & population views",
        steps: [
          "The eligibility scanner's AI scan finds candidates across the caseload",
          "SUD radar catches what problem lists miss",
          "Outcomes and population health get richer as real data lands",
        ],
      },
      {
        title: "Your teams",
        steps: [
          "HR & Staff: credentialing, supervision logs, training hub",
          "Role-based access means everyone sees exactly their job",
          "The demo sandbox stays forever — onboarding never touches real charts",
        ],
      },
      {
        title: "Go-live command",
        steps: [
          "8:00 am huddles at every site; 4:00 pm issue review daily",
          "Watch four numbers: same-day notes, claim acceptance, alert response, satisfaction",
          "Superusers on the floor through Nov 13 — then the week-4 optimization round",
        ],
      },
    ],
  },
];

// ── Timing model (30 fps) ──────────────────────────────────────────────────
export const FPS = 30;
export const TITLE_FRAMES = 105;
export const SCENE_INTRO = 55;
export const STEP_FRAMES = 62;
export const CALLOUT_FRAMES = 80;
export const SCENE_TAIL = 20;
export const OUTRO_FRAMES = 160;

export const sceneDuration = (s: Scene) =>
  SCENE_INTRO + s.steps.length * STEP_FRAMES + (s.callout ? CALLOUT_FRAMES : 0) + SCENE_TAIL;

export const videoDuration = (v: RoleVideo) =>
  TITLE_FRAMES + v.scenes.reduce((sum, s) => sum + sceneDuration(s), 0) + OUTRO_FRAMES;
