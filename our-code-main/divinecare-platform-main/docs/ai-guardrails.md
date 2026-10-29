# AI Guardrails (Oct 23)

Every Bedrock call uses **one of two** AWS Bedrock Guardrails. The deprecated single `BEDROCK_GUARDRAIL_ID` / `BEDROCK_GUARDRAIL_VERSION` pair is **not** read.

## Env

```
BEDROCK_GUARDRAIL_CLINICAL_ID=
BEDROCK_GUARDRAIL_CLINICAL_VERSION=1
BEDROCK_GUARDRAIL_GENERAL_ID=
BEDROCK_GUARDRAIL_GENERAL_VERSION=1
```

- Missing ID → no guardrail attached (safe local).
- Missing VERSION → `DRAFT`.

## Routing

| Guard | Used by |
|---|---|
| **clinical** (default) | AI Scribe, note drafts/quality, coding, clinical insights, crisis/AOT, SUD, document intake, billing letters, Aria, pre-visit, residential CSR |
| **general** | Marketing AI, HR AI (policy Q&A may set grounding 0.7 / relevance 0.5) |

## Policy summary

| | clinical | general |
|---|---|---|
| Content filters (hate/insults/sexual/violence/misconduct) | Off (SI/abuse/SUD language must remain in notes) | High (violence & misconduct medium) |
| Prompt attacks | Block high | Block high |
| Denied topics | None | Individual medical advice |
| Sensitive numbers | Mask SSN/card/bank/PIN/password/AWS keys | Block SSN/card/CVV/bank/passport/AWS keys; mask routing/driver/PIN/password |

## Runtime

1. `invokeBedrock({ guard?: 'clinical'|'general', grounding? })` — default **clinical**.
2. User prompt wrapped in Bedrock guardContent tags with random 6-byte hex suffix; system untagged.
3. If guardrail intervenes **and** reply starts with `[Altrixs AI safety filter]` → `AiSafetyBlockedError` (`AI_SAFETY_BLOCKED`).
4. Messages: blocked → *The AI safety filter blocked this request, so nothing was generated.* · not grounded → *The AI answer was not supported by the source text, so it was not used.*
5. Masked replies without the block mark are **returned**.
6. HR/marketing catch → null / template fallback.
