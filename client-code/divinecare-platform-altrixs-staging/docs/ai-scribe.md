# AI Scribe: capture, drafting, retention (ops + compliance)

Code: `src/lib/scribe/*`, `src/app/api/scribe/*`, `src/components/scribe/*`, page `/dashboard/scribe`.
Migrations: `prisma/migrations/20261019_scribe_core.sql`, `20261020_scribe_transcription_engine.sql`,
`20261023_scribe_session_start.sql`.
Tests: `tests/ai-scribe.test.ts`, `tests/scribe-engines.test.ts`, `tests/scribe-dismiss-templates.test.ts`,
`tests/scribe-session-start.test.ts`.

## 0. Start session (one click from an appointment)

`<StartSessionButton appointmentId clientId />` (`src/components/scribe/StartSessionButton.tsx`; also shown by
`<StartVisitButton withSession />`) opens `/dashboard/ehr/notes?clientId&appointmentId&guide=1&scribe=1`:
the visit's note (an existing draft for the appointment is reopened) in the Visit Guide's note type, the
Visit Guide beside it, and the **AI Scribe panel docked in the editor** (`ScribeDock`). The editor header
also has an **AI Scribe** button for any open note. In the panel:
- **Pre-session brief** (collapsed) at the top; the format follows the note type (no picker step).
- Consent inline: AI Note Drafting status (missing → the inline recorder; declined / revoked → why
  nothing can be captured) and **one checkbox per participant** ("<client> agreed"; "+ Person" for a
  guardian, family member or interpreter). Ticking a box attests that person heard the script and
  agreed; the server validates the same Maryland all-party rule (`quickConsentInput` → `captureGate`).
- **Language** (English / Spanish) and the source: **Record session** · **Upload audio** · **Dictate a recap**.
- **Record** starts capture in one click. **Stop** (on the Recording bar, or "Stop & draft the note")
  drafts and **fills the note sections in place**: empty or template-default sections take the draft;
  a section the clinician already typed in keeps that text with the draft below it; sections the AI
  never writes (risk, diagnoses, …) are untouched. Same grounding rules, `[AI DRAFT …]` markers.
- After the editor's autosave creates the note, the capture is linked to it
  (`POST /api/scribe/captures/[id]/link`), so delete-on-sign follows the note.
- Telehealth visits: live capture stays inside the video call (as before); upload and recap work here.

**Review: per-section Accept.** The bar above the note lists every AI section with **Accept** (clears that
section's marker) and **Accept all reviewed** (after a confirmation). Editing the words of an AI section
also accepts it (`clearMarkerIfEdited`). The server still refuses to sign while any marker remains
(`countAiDraftMarkers` in `updateProgressNoteWorkflow`), so signing is blocked until every AI section is
accepted or edited. The standalone `/dashboard/scribe` page keeps working (with upload, recap and language).

## 1. Where PHI goes

| Path | Audio | Text | Vendor |
|---|---|---|---|
| In-person session | Browser mic → AudioWorklet → 16 kHz PCM → **presigned WebSocket** to Amazon Transcribe streaming: **standard** by default (`/stream-transcription-websocket`, speaker labels, practice custom vocabulary) or **Medical** when the practice chooses it (`/medical-stream-transcription-websocket`, `PRIMARYCARE`, `CONVERSATION`, speaker labels) | Final turns → `scribe_segments` (RDS, KMS-encrypted) | AWS (BAA) |
| Dictation (scribe page and note editors) | Same engine; standard without speaker labels, Medical with `DICTATION` | Editor text box only (not stored) | AWS (BAA) |
| Upload audio | m4a / mp3 / wav (≤ 2 h, ≤ 1.5 GB) PUT by the browser straight to S3 (`SCRIBE_UPLOAD_BUCKET`, presigned 15 min, SSE-KMS or AES256) → Amazon Transcribe **batch** (standard with the vocabulary, or Medical `PRIMARYCARE`/`CONVERSATION`, per the engine setting; Spanish always standard), speaker labels | Turns → `scribe_segments`; then the **audio object, the output JSON and the Transcribe job are deleted** (also on a failed job, a failed start, dismiss or consent withdrawal) | AWS (BAA) |
| Dictated recap | Same streaming path as dictation (one speaker, ≤ 10 min) | `scribe_segments`; drafted as a recap-based note | AWS (BAA) |
| Group session | One in-person microphone, Transcribe streaming with speaker labels | `scribe_group_segments`; see §5a | AWS (BAA) |
| Telehealth | Chime SDK **live transcription** runs inside AWS on the meeting audio: `EngineTranscribeSettings` (standard, with the vocabulary) by default, `EngineTranscribeMedicalSettings` when Medical is chosen | Transcript events arrive over the meeting data channel, attributed to the attendee → `scribe_segments` | AWS (BAA) |
| Drafting | none | Transcript lines + chart facts → Bedrock (Claude Sonnet 4.6, US inference profile) | AWS (BAA) |

The browser Web Speech API (`webkitSpeechRecognition`) is removed everywhere: in Chrome it sends audio
to Google, which has no BAA with the practice. A test fails if it comes back.

**Language.** English (en-US) or Spanish (es-US), stored on the capture (`scribe_captures.language`).
Spanish always uses the standard engine (Transcribe Medical streaming and batch are en-US only) and no
custom vocabulary (en-US resource). The note is always drafted in English (quotes translated and
marked); grounding still checks every sentence against the cited Spanish lines (Spanish number words
count). The client summary is translated into Spanish (Bedrock Haiku, translation only, `AI_ACCESS`
audited) when the client's preferred language is Spanish; the Part 2 filter runs before translation and
Spanish SUD terms are checked on approve / share.

**No audio is kept.** The browser never writes audio and the server never receives it; the only audio at
rest is an uploaded file, which exists in S3 only until its transcript does. Chime media
capture pipelines are not used by the scribe (the separate "record session" setting stays off).

### Transcription engine (practice setting)

Owner decision 2026-10-20 (AI Scribe economics, see `docs/pricing-model.md`): the default engine is
**standard Amazon Transcribe streaming** (HIPAA-eligible under the AWS BAA, $0.024/min tier-1 list) with a
custom vocabulary of behavioral health and psychiatric terms (common diagnoses, therapy modalities,
psychiatric medications by generic and brand name). **Transcribe Medical** ($0.075/min) stays available
per practice in AI Scribe → Settings → Transcription engine, for higher accuracy on clinical terms.

- The engine is recorded on each capture when it is created (`scribe_captures.engine`:
  `transcribe_streaming`, `transcribe_medical_streaming`, `chime_transcribe`, `chime_transcribe_medical`).
  Changing the setting affects new captures only; captures created before the setting existed are Medical.
- The vocabulary name comes from `SCRIBE_TRANSCRIBE_VOCABULARY` (the AWS resource is
  `altrixs-behavioral-health`, en-US, us-east-1). It is used by the standard engine only (a Medical
  vocabulary is a different resource type). The vocabulary must exist in the Region the stream runs in:
  the browser stream uses the server's AWS Region (`awsRegion()`), Chime always uses us-east-1. When the
  variable is unset the standard engine runs without a vocabulary.
- Both engines' transcript events are reduced to one shape (`normalizeTranscribeResult` in
  `eventStream.ts`): standard results carry `LanguageCode` and items with `Stable` /
  `VocabularyFilterMatch`; Medical results carry `Entities`. Speaker labels become `spk_N` once.

### Why Transcribe streaming and not AWS HealthScribe streaming

HealthScribe streaming (`StartMedicalScribeStream`, us-east-1) was evaluated and not chosen for go-live:
- It is HTTP/2 bidirectional only (no presigned WebSocket), so audio would have to be relayed through
  our server. Next.js route handlers cannot hold WebSocket/HTTP2 streams; we would need a separate
  long-running relay process on the single EC2.
- It writes the audio recording and its own outputs to an S3 bucket by design (data-access role +
  output bucket). That conflicts with "no raw audio by default" and adds a bucket to secure and purge.
- Its notes use AWS's own templates; we need the practice's templates (90791 intakes, Therapy
  Progress, SUD intake), field-level chips, our per-sentence grounding and our Part 2 rules.
Transcribe streaming (standard or Medical) works with a presigned URL straight from the browser, keeps
audio off our server and out of S3, and the installed SDKs suffice (no new packages). Telehealth uses
Chime's built-in Transcribe integration, which also gives exact speaker attribution per attendee.

### Free-trial minutes

During the 30-day trial an organization gets 300 minutes of live session audio in total
(`TRIAL_AI_SCRIBE_MINUTES`, `src/lib/scribe/trialCap.ts`; metered from `scribe_captures.capture_seconds`).
Capture creation and start/resume are refused with code `trial_scribe_limit` once it is used up, and the
browser pauses a running capture when the remaining seconds (`stream.maxSeconds`) run out. Pasted and
imported text uses no minutes. Paid, comped (MD Behavioral Health) and grandfathered organizations are not capped.

## 2. Consent

- **Recording (Maryland all-party, Cts. & Jud. Proc. §10-402):** before any capture the clinician reads
  the script and attests, per participant, that each person who can be heard agreed (verbal or written).
  Stored on `scribe_captures` (method, participants, script version, attested by / at). Always required;
  not a setting. "Consent withdrawn" stops capture and deletes everything captured.
- **Patient AI consent** (`AI Note Drafting` consent form): declined → no capture, no AI, anywhere.
  Missing → blocked when `PracticeSettings.aiNoteConsentRequired` (default on).
- **Transparency:** a red "Recording" bar with timer, mic level, pause / resume / stop is always visible;
  in telehealth every participant (including the patient) sees "This visit is being transcribed".

## 3. Retention

Practice settings: **Delete transcript when the note is signed** (`deleteTranscriptOnSign`, default **ON**:
matches Valant and is the more private default) and `transcriptRetentionDays` (default 30, 1-365) as the
fallback.
- Note signed, delete-on-sign ON → at the signature itself (`purgeScribeForSignedNote`, called from
  `updateProgressNoteWorkflow` after a new signature, including group notes) transcript segments, AI drafts
  (with their citation line ids: the signed note does not display grounding) and the summary text are
  deleted; the capture row keeps metadata (ids, times, counts, consent attestation). The cron is the
  safety net if that call failed.
- Group capture → purged once every included member's note for the session is signed (or `N` days after
  it stopped; discarded / withdrawn immediately).

Run by the existing cron (`/api/cron/notifications`, every 10 min; see docs/ops-cron.md):
- Note signed, delete-on-sign OFF → transcript segments, AI drafts and the summary text are deleted `N`
  days after the signature time (`ProgressNoteWorkflow.signedAt`).
- Capture never became a signed note → deleted `N` days after capture stopped.
- Consent withdrawn → deleted immediately.
- "Dismiss scribe" (clinician, during the session or after it until a draft note exists; asks "Stop and
  discard this recording? Nothing from it will be kept.") → recording / Chime transcription stops, the
  browser drops unsent turns, and segments, AI drafts and the summary are deleted immediately. The capture
  row stays as metadata (status `discarded`) with a `SCRIBE_CAPTURE_DISMISSED` audit row (who, when,
  capture id, counts, optional reason from a fixed list; no transcript text). After a draft note is
  created the capture cannot be dismissed: edit or delete the draft note in Notes.
- Safety net: every run also deletes, at any age, segments or drafts still attached to a discarded or
  consent-withdrawn capture (`sweepClosedCaptures`). Live segment uploads re-check the capture under a row
  lock in the insert transaction, and dismiss / withdraw close the capture before deleting, so a late
  upload cannot add rows.
- Each purge writes `SCRIBE_TRANSCRIPT_PURGE` to the audit log (counts only).
The signed note itself is the medical record and follows the record-retention policy. RDS automated
backups (35 days) and AWS Backup monthly copies (1 year) still contain purged rows until they age out.

## 3a. Note formats and template cues

Every note template the EHR uses is a scribe format (`src/lib/scribe/formatCatalog.ts`), drafted under
that note type's own headings (`NOTE_SECTIONS`) so the draft opens in Notes with each section in place:
therapist templates field by field; prescriber templates (Psychiatric Med Management, Medication
Management, Psychiatric Evaluation, Adult / Child Psychiatry Intake and Re-Eval), primary care SOAP and
the other note types section by section. Header, review, suicide screen / risk formulation, safety plan,
diagnoses, labs and level of care sections are never drafted (`NEVER_AI_HEADINGS`); the Exam / Mental
Status section is filled domain by domain ("Not assessed" otherwise). Group and No-Show notes are not
scribe formats. The default format follows the appointment's Visit Guide note type (or `?noteType=`),
then the clinician's default, then the role's usual template; the picker lists the role's templates
first and the rest under "More templates". While capturing, the "Template cues" panel lists the
template's sections with their help text and the Visit Guide's in-session steps; it is display only
(nothing extra goes to the AI or is stored).

## 4. Never fabricate

Every sentence, option value, MSE item, plan link, follow-up and summary sentence must cite transcript
lines (`t#`) or chart facts (`c#`). `src/lib/scribe/grounding.ts` checks each against ONLY the sources it
cites: a missing/unknown citation or a date, number, ICD-10 code, screening measure or medication not in
those sources withholds the sentence (listed with the reason, never placed in the note); weak word
overlap flags it (highlighted). Risk level, C-SSRS, safety plan, diagnoses, level of care, Part 2 and
telehealth consents are never filled by AI. SI/HI/self-harm screens are filled only from the client's own
words. Each AI section starts with the `[AI DRAFT …]` marker; Notes blocks signing until the clinician
accepts (or edits) each one. Nothing is auto-signed or auto-submitted. If Transcribe or Bedrock is not configured,
the page says so and generates nothing.

## 4b. Safety hardening (2026-10-24, prompt version `scribe-draft-2026-10-24`)

Migration `prisma/migrations/20261024_scribe_safety_hardening.sql` (idempotent): `scribe_captures.paused_at /
paused_seconds / risk_findings / risk_attestation / risk_attested_at / risk_attested_by_id / speakers_confirmed_at /
speakers_confirmed_by_id` and `"ProgressNote"."aiProvenance"`. Tests: `tests/scribe-safety-hardening.test.ts`.

1. **Transcript risk gates signing** (`src/lib/scribe/riskGate.ts`). The risk scan (risk.ts: suicide, self-harm,
   homicide / duty to warn, abuse / mandated report, hopelessness) is stored on the capture at draft time (and at
   note creation / link if the capture was never drafted): line id, time, category, concept, severity, no quotes.
   Dictation, recap and pasted / imported text also scan the clinician's lines (as note text, plus the client's
   reported words in the first person; questions are never findings). A note linked to a capture with findings —
   any note type — signs only when it documents a C-SSRS result, a risk level / risk assessment or a safety plan
   update, or the clinician records "Risk content was reviewed; no further assessment indicated because …"
   (reason ≥ 15 characters; stored on the capture, audited `SCRIBE_RISK_ATTESTATION`). Enforced in
   `updateProgressNoteWorkflow` (fails closed when linked captures cannot be read); the note editor and the note
   view show the attestation box when the sign is refused. Findings feed the quality check's risk flags.
2. **Option chips / tri fields** (`polarity.ts`): a value is set only when the cited lines are the client's (risk
   screens si / hi / selfHarm / selfHarmHx / currentAbuse: CLIENT only; other chips: client, guardian, family or
   interpreter, never the clinician) and the polarity agrees ("Denies" / "No" / "None" needs the client's negation
   answering a clinician question on that topic, or naming it; an affirmation needs no negation of the topic).
   Otherwise the chip stays unset and is listed as withheld (`option_role` / `option_polarity`). Weak risk chips are
   withheld. The clinician's own plan chips (interventions used, next session, referrals) get the sentence checks.
3. **Medications** (`medications.ts`): the active medication list (name, dose, sig, DrFirst flag) is a chart fact.
   A drug or dose not in the cited sources is withheld (`ungrounded_medication` / `ungrounded_dose`); one that is
   grounded but not on the med list is kept and flagged "not on medication list — verify". Misheard names
   (Metaphone or Levenshtein ≤ 2 against the med list, then the known name list) get a "did you mean" suggestion.
   "Plan - Med Changes" and "Current Medications" are clinician-only (`CLINICIAN_ONLY_MED_HEADINGS` in
   NEVER_AI_HEADINGS): what the model offers for them is shown as a suggestion panel in review, never inserted.
4. **Meaning check**: polarity rule (a sentence that negates what its cited line states, or states what it negates,
   is withheld; a negation the cited lines lack is weak) and an entailment second pass (`entailment.ts`, Bedrock
   Haiku, guard 'clinical', temperature 0, audited before the call): weak sentences, negations, risk / MSE /
   medication sections (and every transcript-cited sentence for Spanish or interpreted sessions) are checked with
   ONLY their cited lines — "no" withholds, "partly" makes weak, "yes" supports. Batches of 15, at most 3 calls per
   draft; over the cap, on failure or without Bedrock the deterministic rules stand. Weak sentences in risk / MSE /
   medication sections are withheld (`weak_sensitive`), not inserted.
5. **Minimum necessary** (`minimumNecessary.ts`): prompt rules (summarize clinically; no verbatim trauma / sexual
   detail; relationships, not names; no psychotherapy-note material; quotes only when clinically necessary, ≤ 15
   words). Review flags quotes over 15 words, third-party proper names and sexual / trauma detail, with "Move to
   psychotherapy notes": before the note exists the sentence leaves the draft and is filed to
   `/api/notes/[id]/psychotherapy-notes` (author-only) when the note is created; after, it is filed there and the
   clinician removes it from the progress note.
6. **Time / billing**: the capture clock (start, stop, pauses: `sessionClock.ts`) becomes the note's start / end time
   (service details; therapist templates also get "Start time / End time" in the Session section) and the default
   minutes. Prescriber formats: the clinician picks the E/M level and enters "Psychotherapy minutes"; the add-on
   (90833 / 90836 / 90838) is suggested from those minutes only and saved with the note. Crisis: 90839 for 30–74
   min, +90840 for each additional 30 min (75–104 → 1, 105–134 → 2). 90785 evidence only from non-clinician lines,
   an interpreter on the consent, or a confirmed Interpreter speaker.
7. **Stigmatizing language** (`stigma.ts`): lexicon lint (noncompliant, refused, drug abuser / addict / alcoholic,
   clean / dirty UDS, "suffers from"; manipulative, attention-seeking, drug-seeking, frequent flyer, malingering are
   flag-only) with a rewrite button in review; the rule is in the draft prompt; the pre-sign check warns.
8. **Attribution and speakers**: prompt rule ("Client reports…", "Clinician observed…", "Per [mother / guardian /
   interpreter]…"; interpreter lines are the client's statements as interpreted). Speaker roles add GUARDIAN /
   FAMILY / INTERPRETER: a third speaker takes the one non-client role on the consent participant list. Inferred
   labels (one-microphone spk_*, unlabeled paste, or 3+ speakers) must be confirmed: the draft route returns 409
   `SPEAKERS_UNCONFIRMED` until the clinician ticks "Speaker labels are a guess — confirm" (stored, audited
   `SCRIBE_SPEAKERS_CONFIRMED`).
9. **Audit evidence**: at signing, before any purge, `ProgressNote.aiProvenance` keeps the per-section edit ratio
   draft → signed (word-level Levenshtein), withheld / weak / flagged counts, model id, prompt version, capture id
   and how the risk gate was satisfied (`src/lib/notes/aiEvidence.ts`). Cloned sections: see docs/ai-note-quality.md.
10. **Medical necessity / MDM**: grounded `functionalImpact` (home / work / school / relationships, the client's words)
    and a "Continued care" sentence (symptoms + the plan goal it relates to) go in the assessment / HPI section;
    prescriber formats get a grounded MDM elements checklist in review (problems + status, data reviewed, Rx / risk)
    — the level is never picked. Section formats have required elements (`src/lib/notes/formatElements.ts`:
    sections, SI / HI screen, functional status) that block signing like the therapist templates.

Also: "Save as PHQ-9 = 14 (verbal)" for scores stated in session (`/api/scribe/captures/[id]/scores`, source
`verbal_in_session`, clinician confirms, only a score the grounded draft found); the review header shows the client's
name + DOB and "Right client?" must be ticked before "Create draft note" (the note route requires it); a cut-off or
unreadable reply on a long session is retried once by drafting the section groups in separate calls; "Low transcript
quality — review carefully" when withheld + weak > 30 % or the transcript is under 20 words a minute; the draft route
refuses missing AI consent when the practice requires it (like section-draft).

The note editor's dock opens an existing capture from `/dashboard/ehr/notes?…&scribe=1&capture=<id>` (e.g. the
telehealth recording) and drafts in place without recording; the telehealth panel's review link goes to the visit's
note in the same tab.

## 4c. Field feedback fixes (2026-10-25, prompt version `scribe-draft-2026-10-25`)

From a psychiatric NP's practice intake / follow-up on staging (`tests/scribe-field-feedback.test.ts`).

- **Recording that stops unseen.** A status bar is fixed to the top of the viewport while a capture is open
  (`RecordingStatusBar.tsx`: red pulsing dot, "Recording 12:34", Pause / Resume / Stop), whatever the scroll or dock
  state; the tab title is prefixed "● REC". An unexpected stop (Transcribe socket closed, microphone track ended,
  device unplugged / switched, permission turned off, network offline) shows a banner, a short sound cue and, when the
  tab is hidden, a browser notification (no PHI), and reconnects on the SAME capture with backoff (1, 2, 4, 8, 15 s;
  6 attempts; control action `reconnect`, no clock change), re-acquiring the microphone if it ended and replaying up to
  30 s of audio buffered in memory meanwhile. What could not be replayed is a gap (`scribe_captures.recording_gaps`,
  capture-clock ms + reason enum, control action `gaps`), shown in the transcript as "Recording gap 10:02–10:05".
  Gave up / permission revoked: the capture pauses (session clock stops) and Resume continues it. No audio above the
  silence level for 60 s: "No audio detected — check your mic". Pure state machine: `recordingMonitor.ts`.
- **MSE domains "Not assessed" although stated.** The mental status exam is the clinician's observation: the prompt
  now makes the clinician's own lines (said aloud, dictated, recap) the primary source; model keys are normalized
  ("Thought Content", "Perceptions", "Insight/Judgment", "Orientation" → the domains; an exact-match lookup dropped
  them before). A question cited with the client's "No." no longer counts as asserting the topic (polarity), and
  dictated shorthand (AH/VH, SI/HI, A&Ox3, LGD) counts for the spelled-out words. "Not assessed" only when nothing was
  drafted; a domain the model filled but grounding withheld is left blank and offered as a one-click suggestion.
- **Risk chips.** Still the client's own answer, OR the clinician's stated finding (a declarative "patient denies SI,
  HI" in dictation / recap; marked "clinician-attested"). A clinician question never sets one. The signing gate
  (riskGate.ts) is unchanged.
- **Withheld suggestions.** Withheld sentences are listed under their section in the dock and the review
  (`DraftSuggestions.tsx`, `suggestions.ts`) with the reason and an Insert button (a clinician action, no AI DRAFT
  marker). Never offered: risk screens, chips that failed the client / polarity check, polarity mismatches,
  clinician-only medication sections, the client summary.
- **History sections.** Intake / evaluation formats with more than 10 sections are always drafted in groups of at
  most 8 sections (parallel calls; the first carries options / MSE / plan links / summary); a cut-off group is retried
  once as two halves. Heading variants map onto the template ("Family History" → "Family Hx", "Inpatient History" →
  "Inpatient Hx"); terse prescriber headings get a one-line description in the prompt; the prompt asks for every
  history detail discussed. A drug named in Substance Use Hx / Consequences / Treatment Hx is substance use, not a
  medication sentence, so weak support there is highlighted instead of withheld.
- **Measures to complete.** Spoken names map to the catalog ("GAD seven", "PHQ nine", "DASS 42", "DSM five cross
  cutting", C-SSRS, PCL-5, AUDIT…; `spokenMeasures.ts`) and grounding accepts "GAD-7" against "GAD seven" (it was
  withheld as an ungrounded instrument). The plan gets "Measures to complete before next session: …" (grounded,
  clinician lines only). Review / dock show "Assign these measures": one click creates "once" schedules due on the
  next scheduled visit for the sendable catalog measures; links go out under the practice's measure settings and the
  client's contact consents. Nothing is assigned from speech. In the catalog but not sendable (DASS-42, DSM-5 Level 1:
  licensed copy pending) → "give it in session"; not in the catalog (e.g. MMPI) → "Not available in Altrixs";
  "DASS" without a version → asks which.
- **No medication changes.** Plan - Med Changes (Psych Med Mgmt, Adult / Child Psychiatry Intake and Re-Eval) has a
  "No medication changes" checkbox: it writes "No medication changes this visit; continue current medications as
  prescribed.", clears and hides the medication rows and free text, and counts as documented. Only the prescriber
  ticks it: the section stays clinician-only for the AI and AI-marked text never restores it (`noMedChanges.ts`).

## 5a. Group sessions (IOP / PHP / therapy / skills / SUD groups)

`GroupScribePanel` on the group session page (`SessionRunner`, opened with `?scribe=1` from
"Start session" on a group occurrence). In-person groups only for now.
1. **Consent**: one box per person present (every member, plus "member not shown to you" rows for
   protected members); all must be ticked (all-party). AI consent is checked per member: members without
   it (declined, or missing when the practice requires it) are **excluded** — their speech is never used
   and they get no AI text.
2. **Record group** (one microphone, speaker labels). Stop.
3. **Who is speaking?**: map each speaker to Clinician, one member, or "Not attributed". Unattributed
   speech is never used anywhere.
4. **Draft group notes**: the shared section (topic, objectives, interventions, dynamics, plan) from the
   clinician's and included members' lines, described as a group; then one model call **per member on
   that member's lines only**, renumbered for that member, so a member's section cannot cite or see anyone
   else's words. A sentence that names another attendee or a member alias ("Member B") is withheld. Risk,
   participation, attendance, UDS, ASAM, goals and stage of change stay clinician-entered.
5. **42 CFR Part 2**: in a non-SUD group, a member whose record is Part 2 gets nothing SUD-related (their
   SUD lines are not sent; SUD sentences are withheld), and the shared section — copied into that member's
   note — drops SUD lines and sentences too.
AI text fills only empty fields, carries the AI DRAFT marker (each section has **Accept**), and signing
uses the existing group sign path (markers block it). Tables: `scribe_group_captures`,
`scribe_group_segments`. Routes: `/api/scribe/group-captures[/id[/control|segments|speakers|draft]]`.

## 5. 42 CFR Part 2

A capture is Part 2 when the chart is Part 2 (protected record classified Part 2/SUD or any Part 2 note),
the format is the Substance Abuse Intake, or the clinician ticks "SUD session". Outputs carry the Part 2
notice, the draft note is saved `part2 = true` (existing access rules apply unchanged), and the client
summary drops substance-use content unless a signed, unexpired consent whose type names 42 CFR / Part 2
and the portal/patient is on file. (The 2024 Part 2 rule treats a HIPAA business associate such as AWS
as a qualified service organization.)

## 6. Audit actions

`SCRIBE_CONSENT_ATTESTED`, `SCRIBE_CAPTURE_START|PAUSE|RESUME|STOP|RECONNECT|GAPS`, `SCRIBE_CAPTURE_DISMISSED`, `SCRIBE_CONSENT_WITHDRAWN`,
`AI_ACCESS` (feature `scribe-draft`, written before PHI goes to Bedrock), `SCRIBE_CITATION_VIEW`,
`SCRIBE_SUMMARY_SHARE`, `SCRIBE_SETTINGS_WRITE`, `SCRIBE_PREFERENCES_WRITE`, `SCRIBE_TRANSCRIPT_PURGE`,
`SCRIBE_SPEAKERS_CONFIRMED`, `SCRIBE_RISK_ATTESTATION` (at signing; reason length only), `AI_ACCESS` steps
`entailment` (Haiku), `section_groups` and `section_group_retry`,
plus READ/WRITE rows for transcript, speaker map, follow-ups and the draft note. Metadata is ids, enums
and counts only.

## 7. What the owner must configure (AWS account 792233689095, us-east-1)

1. Run the migrations: `npm run db:migrate` (applies `20261019_scribe_core.sql`,
   `20261020_scribe_transcription_engine.sql` and `20261023_scribe_session_start.sql`).
2. EC2 instance role (or the `altrixs-connect` key until the role move) — add:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       { "Sid": "ScribeStreaming", "Effect": "Allow",
         "Action": [
           "transcribe:StartStreamTranscription",
           "transcribe:StartStreamTranscriptionWebSocket",
           "transcribe:StartMedicalStreamTranscription",
           "transcribe:StartMedicalStreamTranscriptionWebSocket"
         ],
         "Resource": "*" },
       { "Sid": "ScribeChimeTranscription", "Effect": "Allow",
         "Action": ["chime:StartMeetingTranscription", "chime:StopMeetingTranscription"],
         "Resource": "*" }
     ]
   }
   ```
   Chime live transcription also needs the service-linked role `AWSServiceRoleForAmazonChimeTranscription`
   (created automatically on first use when the caller has `iam:CreateServiceLinkedRole`, or create it once
   in IAM). Bedrock InvokeModel is already granted. The standard-engine actions
   (`transcribe:StartStreamTranscription`, `transcribe:StartStreamTranscriptionWebSocket`) are needed
   because standard Transcribe is now the default; the Medical actions stay for practices that choose it.
   Using a custom vocabulary in a stream needs no extra IAM action.
2b. **Upload audio** (20261023): create a private bucket in us-east-1 (Block Public Access on, default
   encryption SSE-KMS, a lifecycle rule expiring `scribe-uploads/` and `scribe-transcripts/` after 1 day as
   a safety net, CORS allowing `PUT` from `https://altrixs.com` and `https://staging.altrixs.com` with
   headers `Content-Type`, `x-amz-server-side-encryption`, `x-amz-server-side-encryption-aws-kms-key-id`),
   set `SCRIBE_UPLOAD_BUCKET` (and `SCRIBE_UPLOAD_KMS_KEY_ID` for a customer-managed key), and add to the
   server role:
   ```json
   [
     { "Sid": "ScribeUploadObjects", "Effect": "Allow",
       "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
       "Resource": ["arn:aws:s3:::<SCRIBE_UPLOAD_BUCKET>/scribe-uploads/*", "arn:aws:s3:::<SCRIBE_UPLOAD_BUCKET>/scribe-transcripts/*"] },
     { "Sid": "ScribeBatchTranscription", "Effect": "Allow",
       "Action": [
         "transcribe:StartTranscriptionJob", "transcribe:GetTranscriptionJob", "transcribe:DeleteTranscriptionJob",
         "transcribe:StartMedicalTranscriptionJob", "transcribe:GetMedicalTranscriptionJob", "transcribe:DeleteMedicalTranscriptionJob"
       ],
       "Resource": "*" },
     { "Sid": "ScribeUploadKms", "Effect": "Allow",
       "Action": ["kms:GenerateDataKey", "kms:Decrypt"],
       "Resource": "<SCRIBE_UPLOAD_KMS_KEY_ID arn>" }
   ]
   ```
   Transcribe reads the media and writes its output with the caller's permissions (no data-access role).
   Without `SCRIBE_UPLOAD_BUCKET` the upload option says it is not configured and nothing is uploaded.
   Spanish streaming / Chime and recap need no new IAM actions.
2a. Set `SCRIBE_TRANSCRIBE_VOCABULARY=altrixs-behavioral-health` (optional; without it the standard engine
   runs with no custom vocabulary).
3. Keep `AWS_LIVE=true` (or static keys) so the server can sign URLs. The presigned URL carries the
   role's temporary key id and session token (never the secret) and expires in 60 s. Optional hardening
   later: a dedicated `TRANSCRIBE_STREAMING_ROLE_ARN` assumed with a session policy limited to the
   Transcribe streaming actions (not implemented yet).
4. Bedrock guardrails: see [ai-guardrails.md](ai-guardrails.md). The scribe runs under `altrixs-clinical`
   (no content filters, prompt attacks blocked, payment / SSN numbers masked); its own per-sentence grounding
   against the transcript stays the accuracy control.
5. Practice settings: AI Scribe page → Settings (leadership): enable, delete transcript when the note is
   signed (default on), retention days (fallback), default format,
   transcription engine (standard by default), client summary sharing (off by default), live cues.
6. Make sure the `AI Note Drafting` consent is collected at intake (the scribe refuses without it when
   the practice requires it).
