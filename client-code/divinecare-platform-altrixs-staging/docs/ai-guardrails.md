# AI safety filters (Bedrock guardrails)

Every Bedrock call goes through `invokeBedrock` (`src/lib/ai/bedrockService.ts`), which runs it under one of
two guardrails. A guardrail checks the request and the reply; blocked content never reaches the app, and
each block is logged by Bedrock.

| | `altrixs-clinical` (default, `guard: 'clinical'`) | `altrixs-general` (`guard: 'general'`) |
|---|---|---|
| Used by | AI Scribe, pre-visit brief, note drafts and quality check, coding, clinical insights, crisis and AOT summaries, residential CSR, SUD radar, document intake, billing appeal / authorization letters, Aria | Marketing (content, reputation replies, lead replies, insights) and HR (document extraction, writing, review assistant, policy Q&A, digest) |
| Content filters (hate, insults, sexual, violence, misconduct) | Off: notes must record suicidal ideation, abuse, violence and substance use | High (violence and misconduct medium, so awareness-month posts pass) |
| Prompt attacks | Blocked (high) | Blocked (high) |
| Denied topics | None | Individual medical advice (diagnosing a person, telling a person what to take) |
| Sensitive numbers | SSN, card, bank, PIN, password, AWS keys masked in the reply | SSN, card, CVV, bank account, passport, AWS keys blocked; routing, driver ID, PIN, password masked |
| Grounding check | Not used: the scribe checks each sentence against the transcript lines it cites (`groundDraft`) | HR policy Q&A: the answer must be supported by the handbook sections (grounding 0.7, relevance 0.5) |

The user prompt is wrapped in the guardrail's input tags (random suffix per call), because the prompt-attack
filter only checks tagged input; our own system prompt is not tagged.

When a guardrail blocks, `invokeBedrock` throws `AiSafetyBlockedError` (`reason: 'blocked' | 'not_grounded'`);
every caller already falls back to its template or "nothing was generated" path. A masked reply (for
example `{US_SOCIAL_SECURITY_NUMBER}`) is returned as is. Blocked messages start with
`[Altrixs AI safety filter]`.

## AWS (account 792233689095, us-east-1)

| Guardrail | Id | Version |
|---|---|---|
| altrixs-clinical | `u9brovqm098p` | 1 |
| altrixs-general | `835mmtxabtqk` | 1 |

Created 2026-10-23 and tested with synthetic samples (clinical note with passive SI / abuse / substance use
passes; prompt attack blocked; awareness and service posts pass; medical-advice question, insults and SSN
blocked; grounded HR answer passes at 0.99-1.0, invented answer fails at 0.01). The old `BridgeCareGuardrail`
(June 2026, patient chatbot) is not used.

Environment (staging set 2026-10-23; production at cutover):

```
BEDROCK_GUARDRAIL_CLINICAL_ID=u9brovqm098p
BEDROCK_GUARDRAIL_CLINICAL_VERSION=1
BEDROCK_GUARDRAIL_GENERAL_ID=835mmtxabtqk
BEDROCK_GUARDRAIL_GENERAL_VERSION=1
```

The server role needs `bedrock:ApplyGuardrail` on both guardrail ARNs (staging: statement
`BedrockGuardrails` in inline policy `staging-app-services` on `altrixs-staging-ec2`). The older
`BEDROCK_GUARDRAIL_ID` / `BEDROCK_GUARDRAIL_VERSION` variables are no longer read.

To change a guardrail: edit the DRAFT in the Bedrock console, re-test, publish a new version, then bump the
`_VERSION` variable and restart.
