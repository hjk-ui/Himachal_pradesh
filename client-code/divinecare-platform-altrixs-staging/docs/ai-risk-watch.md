# Risk language watch

Flags language about suicide, self-harm, harm to others and abuse/danger in patient portal messages, progress/structured notes and SDOH screening notes. It creates a `RiskAlert` (type `risk_language`) for clinician review and shows a banner on the message thread or note. **This is decision support. A clinician reviews every flag.** It never messages the patient. The only patient-facing output is a static crisis-resource block returned with the portal API response.

## Pipeline

1. **Rules first** (`src/lib/ai/riskWatch/engine.ts`, `phrases.ts`): sentence-level phrase match, then these checks in order: blank checkbox, idiom, negation (NegEx-style, the same approach as `sudRadar/keywords.ts`), history, and someone-else, followed by context escalation.
2. **Optional AI** (`ai.ts`). This uses Bedrock Haiku through `bedrockService.ts`, in JSON mode with a 6-second timeout.
   - Only **ambiguous LOW/MEDIUM** hits are sent. The model gets the matched sentence plus one sentence either side. Client name parts, other mid-sentence capitalised words, emails, phone numbers, dates and long numbers are redacted first.
   - The AI may only **downgrade**: medium → low, or low → dismissed. HIGH hits are never sent and never changed. `runRiskWatch` throws if a rule-HIGH result ever comes back lower.
   - Every downgrade goes into the `AI_ACCESS` audit row as `phraseId:from->to:reason`.
   - If AI consent is declined (the latest `AI Note Drafting` consent is `DECLINED`) or Bedrock isn't configured, only the rules run. If the AI call fails, returns bad JSON or times out, the rule result stands.
3. **Alert** (`service.ts`, `routing.ts`): `RiskAlert` with `source` = `risk_watch_message|note|sdoh`.
   - `sourceId` is `msg:<threadId>:<messageId>`, `note:<noteId>` or `sdoh:<screeningId>`.
   - `clinicianId` is the assigned clinician.
   - Writes `CREATE`/`UPDATE` audit rows (ids and enums only).

## Severity (rule-based)

| Rule | Severity |
|---|---|
| Explicit intent/plan ("going to kill myself", "SI with plan"), method ("hang myself", "overdose on"), preparatory acts (suicide note, giving belongings away, stockpiling pills) | HIGH (same-day) |
| Any ideation or self-harm with a plan, means or timing cue in the same or a neighbouring sentence ("I want to die. I have pills saved up") | HIGH |
| Attempt that is recent (last week, yesterday, again), or disclosed by the patient in a portal message | HIGH |
| Non-ambiguous active ideation written by the patient in a portal message ("I want to kill myself"). It hasn't been assessed yet, and portal messages aren't monitored around the clock | HIGH |
| Homicidal plan/means; abuse with lethality markers (threats to kill, a weapon, strangulation/choking, "fear for my life") | HIGH |
| Passive ideation (wish to be dead, "don't want to wake up", "better off dead") | MEDIUM |
| Active ideation documented in a note without a plan, self-harm, homicidal ideation, current abuse | MEDIUM |
| Hopelessness ("can't go on", "what's the point"); a third-party mention in a portal message ("my friend wants to die") | LOW |
| History only ("history of suicide attempt in 2015"), negated, about someone else in a note, idiom, blank checkbox, screening question in a note | no alert |

**Negation:**
- A cue up to 6 words before the term ends the term's scope at a terminator such as "but", "reports", a pronoun restarting the clause, or punctuation. Cues include denies, no, not, never, without, negative for, and don't/doesn't.
- A post-term pattern is also checked ("SI: denies", "SI/HI – none").
- A negated plan or means cue ("denies plan or access to firearms") does not escalate.

**Third person and quotes:**
- In notes, a relative, friend or character named as the subject ("client's friend attempted suicide") or a family history is dropped.
- A clinician quoting the patient (`Pt stated "I want to kill myself"`) counts.
- In portal messages, a third-party mention is kept as LOW. A guardian may be writing about the client, so it is surfaced for review rather than dropped.

## Dedupe and routing

- **One alert per source item.** A re-scan at the same or a lower severity is skipped. A higher severity on an unreviewed alert updates it (escalation). A higher severity after review creates a new alert.
- **Messages coalesce per thread** while an alert is unreviewed, so one distressed conversation produces one alert, escalated if needed.
- The thread's existing `MessageThread.risk` tag is raised (never lowered). This drives the existing "High-risk client" UI on the messages and communications pages.
- **Routing** reuses existing `RiskAlert` visibility (`clientAccessWhere`):
  - Assigned clinician: always.
  - Crisis responders and supervisors: see the organisation. On HIGH, active `CRISIS_RESPONDER` users are counted as recipients.
  - Users who can't open a protected record are withheld and counted in the audit row.
  - Alerts appear in the **Inbox → Risk & MBC alerts** section (label "Risk language watch"; HIGH shows as urgent), in My To-Do, and on `/dashboard/alerts`.
- **42 CFR Part 2 / protected records:**
  - For a Part 2 note or a client with a `SensitiveRecord`, the alert description carries **no quote** ("Open the record to view the flagged text").
  - The Inbox masks the row as "Protected record" (`applyPart2`).
  - The banner route (`GET /api/ai/risk-watch`) re-checks `lockedSensitiveClientIds`, failing closed. A viewer without access gets only "Protected record", the severity and the chart link for break-glass.

## UI

`RiskWatchBanner` (`src/lib/ai/riskWatch/RiskWatchBanner.tsx`) appears on the messages page, the communications page and the note detail panel. It shows:
- the quoted snippet(s) and severity
- **Call client** (when a phone number is on file) and **Message client**
- **Copy 988 reminder** for staff to share
- **Create safety plan** when no safety plan is linked to the client (`ehr-safety-plans` module); otherwise a link to the chart's Safety tab

## Patient portal

`POST /api/patient/messages`, `/api/patient/conversations` and `/api/patient/conversations/:id/messages` now return an additive `safety` field on the message/conversation:
- `null` when nothing is flagged.
- On HIGH (and MEDIUM): `{ show, level, title, message, resources }` with 988 (call/text/chat), 911, and "Text HOME to 741741" (Crisis Text Line).
- It never contains the matched words.

The portal app should display `safety.resources` immediately when `safety.show` is true. If the alert pipeline fails, the rule result alone still decides this payload.

The portal previously showed crisis text only on the documents page, and Aria has its own crisis reply. Message sends had no crisis handling, so nothing is duplicated.

Not covered: `ConnectMessage` has no inbound (patient → clinic) path today; `Message` (legacy) is staff-sent only. Draft autosaves are not scanned (create and sign are).

## Hook points

- `src/patient/application/messages/service.ts`: `createPatientConversation`, `sendPatientMessage` via `patientMessageSafety` (lazy import; keeps server-only modules out of the patient code's load chain).
- `src/app/api/clients/[id]/notes/route.ts` (note saved), `src/app/api/notes/[id]/route.ts` (sign/lock), `src/app/api/ehr/notes/[id]/workflow/route.ts` (new signature). Each returns `riskWatch: { severity, action, alertId } | null`.
- `src/app/api/sdoh/screenings/route.ts`: SDOH screening `notes` free text.

## Sources

- Posner K, Brown GK, Stanley B, et al. *The Columbia–Suicide Severity Rating Scale: initial validity and internal consistency findings.* Am J Psychiatry 2011;168(12):1266–1277. Defines the ideation (wish to be dead → active with plan and intent) and behavior (actual, interrupted and aborted attempts; preparatory acts; NSSI) concepts used here.
- The Columbia Lighthouse Project, *C-SSRS Screener with triage points*: behavior in the past 3 months and ideation with method, intent or plan → immediate evaluation. https://cssrs.columbia.edu
- The Joint Commission, *National Patient Safety Goal NPSG.15.01.01* and R3 Report Issue 18 (2018): screening, assessment, safety planning and follow-up for suicide risk in behavioral health.
- NIMH, *Ask Suicide-Screening Questions (ASQ) toolkit*: acute risk wording ("thoughts of killing yourself right now").
- Stanley B, Brown GK. *Safety Planning Intervention: a brief intervention to mitigate suicide risk.* Cogn Behav Pract 2012;19:256–264. The source for the "Create safety plan" prompt.
- Campbell JC, et al. *Risk factors for femicide in abusive relationships.* Am J Public Health 2003;93(7):1089–1097 (Danger Assessment): threats to kill, a weapon and strangulation as lethality markers.
- Chapman WW, et al. *A simple algorithm for identifying negated findings and diseases in discharge summaries (NegEx).* J Biomed Inform 2001;34:301–310.
- 988 Suicide & Crisis Lifeline: call, text or chat (chat.988lifeline.org). https://988lifeline.org (checked Oct 2026).
- Crisis Text Line: "Text HOME to 741741 from anywhere in the United States – 24/7, free, confidential" (HOLA for Spanish). https://www.crisistextline.org (checked Oct 2026).
- Maryland Courts & Judicial Proceedings §5-609 (mental health provider duty to warn). Context for treating homicidal plan/means as HIGH.

## Tests

`tests/ai-risk-watch.test.ts` covers rule hits, negations, third-person and idiom handling, severity mapping, AI downgrades (low/medium ambiguous only, never HIGH, failures and timeouts), snippet redaction, dedupe and coalescing, routing and Part 2 masking, the patient payload, consent, and audit metadata.
