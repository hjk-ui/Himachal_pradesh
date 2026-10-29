# Patient Autopay sweep

Dedicated job for due patient autopay charges. Complements the live-gate
`PATIENT_PAYMENTS_LIVE_APPROVED` (which already blocks live Stripe keys in APIs).

**Live charging is never enabled by default.**

---

## TEST MODE behavior (default)

When Stripe keys are **test** (`sk_test_…`) or unset/stub:

- Sweep **runs** and creates **draft** `AutopaySweepAttempt` rows
- Idempotent: one row per `enrollmentId` + calendar day (`periodKey`)
- **No money is captured** — UI must show a **Test mode** badge and must not imply payment succeeded
- Safe for local / staging / CI

---

## LIVE MODE checklist (owner approval required)

All of the following must be true before any live path:

1. Stripe **live** secret key configured (`sk_live_…`)
2. Env `PATIENT_PAYMENTS_LIVE_APPROVED=true` (explicit owner approval)
3. Ops has scheduled the sweep (cron / Task Scheduler / ECS / GitHub Action)
4. Finance has verified enrollment last4 / card-on-file source of truth

If live keys are present **without** the flag → sweep and patient-payment APIs **refuse** (403).

---

## What the sweep does vs Stripe processor

| Layer | Responsibility |
|---|---|
| **Sweep job** | Select active enrollments; gate check; write idempotent attempt/draft rows; log success/skip/fail |
| **Patient payments gate** | Block live keys unless `PATIENT_PAYMENTS_LIVE_APPROVED=true` |
| **Stripe processor** (future / ops) | Actual PaymentIntent / off-session charge, webhooks, retries |

Sweep drafts/attempts are **not** proof of money captured. Test mode never captures. Live capture remains deferred to the Stripe processor path after approval.

---

## Gate (unchanged)

- Live Stripe keys → refused unless `PATIENT_PAYMENTS_LIVE_APPROVED=true`
- Test / stub modes → create safe draft attempts only (no live charge)

## Run

```bash
npx tsx scripts/patient-autopay-sweep.ts
npx tsx scripts/patient-autopay-sweep.ts --dry-run
npx tsx scripts/patient-autopay-sweep.ts --org <organizationId>
```

## Schedule (ops enables later)

| Runtime | Example |
|---|---|
| cron | `0 6 * * * cd /app && npx tsx scripts/patient-autopay-sweep.ts` |
| Windows Task Scheduler | Daily action: `npx tsx scripts/patient-autopay-sweep.ts` in repo cwd |
| GitHub Action | `schedule: cron: '0 11 * * *'` + secrets for DB / Stripe test |
| ECS | Scheduled task definition with same command + env |

## Code

- `src/lib/billing/patient-autopay-sweep.ts` — gate + sweep
- `src/lib/billing/patient-payments-gate.ts` — live approval flag
- `scripts/patient-autopay-sweep.ts` — CLI entry
- `AutopaySweepAttempt` Prisma table — idempotent `enrollmentId` + `periodKey`
- Migration: `prisma/migrations/20261027140000_medical_pc_workflow/`
