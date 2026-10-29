# Stripe setup for Altrixs subscriptions

> **Superseded by pricing model v2 (2026-10-20).** Do not create the v1 prices in the table below.
> The v2 products, prices, coupons and meters are defined in `src/lib/stripe/catalog.ts` and created by
> `scripts/stripe-sync-catalog.ts` (dry run by default; `--apply` with a **test** key first; a live key is refused
> unless `--live` is passed, which needs the owner's written approval of `docs/pricing-model.md`). The script prints the
> `STRIPE_PRICE_V2_*` / `STRIPE_COUPON_V2_*` env vars to set. The v1 env names below are still read so any
> test-mode subscription made on them keeps resolving. Webhook, portal and seat-sync steps below still apply.

Do these steps **only after the owner approves the prices** in `docs/pricing-research.md`. Do test mode
first. The code reads every price ID from env, so going live means adding values here, not changing code.

Amounts below are the current proposal in `src/lib/billing/plans.ts`. If the owner changes a number, change
it in `plans.ts` first; the app reads its displayed prices from that file. Then create the matching Stripe Price.

## 1. Products and prices

- **Currency:** USD.
- **Recurring prices:** "Per unit" (licensed), so the quantity equals the number of seats or prescribers.
- **Tax:** tax behaviour "exclusive", unless the owner decides otherwise.
- **Metadata:** put `altrixs_kind` and the tier or add-on on every Price, as shown. The app maps prices by env var, not by metadata; the metadata makes the Stripe dashboard readable.

| Product | Price nickname | Amount | Interval | Env var | Price metadata |
|---|---|---|---|---|---|
| Altrixs Starter | Starter monthly | $69.00 per seat | month | `STRIPE_PRICE_STARTER_MONTHLY` | `altrixs_kind=tier, tier=starter` |
| Altrixs Starter | Starter annual | $708.00 per seat ($59 × 12) | year | `STRIPE_PRICE_STARTER_ANNUAL` | `altrixs_kind=tier, tier=starter` |
| Altrixs Professional | Professional monthly | $79.00 per seat | month | `STRIPE_PRICE_PROFESSIONAL_MONTHLY` | `altrixs_kind=tier, tier=professional` |
| Altrixs Professional | Professional annual | $804.00 per seat ($67 × 12) | year | `STRIPE_PRICE_PROFESSIONAL_ANNUAL` | `altrixs_kind=tier, tier=professional` |
| Altrixs Clinic | Clinic monthly | $129.00 per seat | month | `STRIPE_PRICE_CLINIC_MONTHLY` | `altrixs_kind=tier, tier=clinic` |
| Altrixs Clinic | Clinic annual | $1,308.00 per seat ($109 × 12) | year | `STRIPE_PRICE_CLINIC_ANNUAL` | `altrixs_kind=tier, tier=clinic` |
| E-prescribing (DrFirst Rcopia + EPCS) | eRx monthly | $59.00 per prescriber | month | `STRIPE_PRICE_ERX_MONTHLY` | `altrixs_kind=addon, addon=eprescribing` |
| E-prescribing (DrFirst Rcopia + EPCS) | eRx annual | $600.00 per prescriber ($50 × 12) | year | `STRIPE_PRICE_ERX_ANNUAL` | `altrixs_kind=addon, addon=eprescribing` |
| AI Scribe | AI Scribe monthly | $39.00 per clinician | month | `STRIPE_PRICE_AI_SCRIBE_MONTHLY` | `altrixs_kind=addon, addon=ai_scribe` |
| AI Scribe | AI Scribe annual | $396.00 per clinician ($33 × 12) | year | `STRIPE_PRICE_AI_SCRIBE_ANNUAL` | `altrixs_kind=addon, addon=ai_scribe` |
| Onboarding — Professional | one-time | $499.00 | one-time | `STRIPE_PRICE_ONBOARDING_PROFESSIONAL` | `altrixs_kind=onboarding, tier=professional` |
| Onboarding — Clinic | one-time | $2,500.00 | one-time | `STRIPE_PRICE_ONBOARDING_CLINIC` | `altrixs_kind=onboarding, tier=clinic` |

Notes:

- Enterprise has no Stripe Price. It is quoted and invoiced manually, or set up as a custom subscription in the Stripe dashboard. Put `organizationId` in that subscription's metadata so the webhook can attach it to the org.
- **Do not set `trial_period_days` on any Price.** The app passes `trial_end` itself, carrying over the clinic's remaining 30-day local trial.
- **Seat minimums are enforced by the app, not by Stripe:** Professional is 2 and Clinic is 5. Starter is capped at 1.
- **Older env names still work.** `STRIPE_SOLO_*` maps to Starter. `STRIPE_PRACTICE_*`, `STRIPE_PROFESSIONAL_*_PRICE_ID` and `STRIPE_GROWTH_*` map to Professional. `STRIPE_ENTERPRISE_*` maps to Clinic. These are only so that old subscriptions resolve; do not create new prices under these names.

## 2. Environment variables

| Var | Required | Purpose |
|---|---|---|
| `STRIPE_SECRET_KEY` | yes | `sk_test_…` (staging) or `sk_live_…` (production). A restricted key (`rk_…`) works if it has Checkout, Billing Portal, Subscriptions, Invoices and Customers permissions. |
| `STRIPE_WEBHOOK_SECRET` | yes | `whsec_…` from the webhook endpoint below |
| `STRIPE_PRICE_*` (the 12 in the table above) | per tier you sell | Price IDs (`price_…`). A tier or interval without its env var shows "Stripe price not configured on this server" and cannot be bought. |
| `AUTH_URL` | yes (already set) | Base URL for Checkout success and cancel URLs, and the portal return URL |
| `NEXT_PUBLIC_PRICING_APPROVED` | after owner approval | `true` removes the "Proposed pricing" notice and allows **live-mode** Checkout. Test-mode Checkout works without it. It is read at build time, so rebuild after changing it. |
| `BILLING_SEAT_SYNC` | optional | `true` turns on automatic Stripe seat quantity updates (prorated) when staff are created, deactivated or have their roles changed, and enables the "Sync seats" button. Leave it off until test mode has been verified. |
| `BILLING_COMPED_ORG_IDS` | optional | A comma-separated list of org IDs that are never billed and never locked. MD Behavioral Health (`cmva1hmq6000090ohpo38undp`) is already hard-coded as comped in `src/lib/billing/entitlements.ts`. |

The Plan & Subscription page has a "Server billing configuration" panel. It shows which of these are set, never their values.

## 3. Webhook endpoint

- **URL:** `https://<host>/api/webhooks/stripe`, for example `https://staging.altrixs.com/api/webhooks/stripe`.
- **Auth:** the route is public in `src/proxy.ts`. Stripe authenticates by signature.
- **Events to send:**
  - `checkout.session.completed`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.paid`
  - `invoice.payment_failed`
- **API version:** the account default is fine. The code reads the current shape: the period end on subscription items, and the invoice subscription under `parent.subscription_details`.

**Signature check.** The signature is verified on the raw body against `STRIPE_WEBHOOK_SECRET`:

- A bad or missing signature returns 400.
- A missing secret returns 503.

**Processing rules** (`src/lib/stripe/events.ts`):

- Duplicate event IDs are skipped.
- Subscription events older than the newest one already applied are skipped.
- Events for a subscription other than the org's current one never downgrade the org.
- Comped orgs stay comped.
- Records are saved with optimistic concurrency, so two deliveries cannot overwrite each other.
- If the handler fails, the endpoint returns 500 and Stripe retries. Retrying is safe.

**Finding the org.** The webhook looks for the organization in this order:

1. `metadata.organizationId` on the session or subscription. The app sets it on Checkout.
2. `client_reference_id`.
3. `parent.subscription_details.metadata` on invoices.
4. Lookup by Stripe customer ID.

## 4. Customer portal

In the Stripe dashboard, go to Settings, then Billing, then Customer portal, and enable:

- **Payment methods:** update.
- **Invoice history:** on.
- **Cancel subscriptions:** at end of billing period. Do not use "immediately".
- **Switch plans:** add the three tier products with both prices. Allow quantity changes only if you want clinics to change seats themselves; otherwise the app manages quantity.
- **Business information:** the terms of service and privacy links. Privacy is `https://altrixs.com/privacy`.

The app can also change plans itself through "Switch to …" on the Plan & Subscription page, which calls `POST /api/stripe/change` with prorations.

## 5. Test-mode checklist

1. Set `STRIPE_SECRET_KEY=sk_test_…`, the test `STRIPE_PRICE_*` values and the test `STRIPE_WEBHOOK_SECRET`. Restart.
2. Forward webhooks locally with `stripe listen --forward-to localhost:3000/api/webhooks/stripe`, or create the endpoint against staging.
3. Register a new practice at `/get-started` with the Professional tier. Confirm the account starts on a 30-day trial.
4. On `/dashboard/subscription`, click "Choose Professional" and pay with card `4242 4242 4242 4242`. After the webhook arrives, the page shows the tier, seats paid, period end and next invoice.
5. Test a failed renewal with card `4000 0000 0000 0341` (attaches, then fails on charge). Advance a test clock past renewal. Confirm the past-due banner appears, writes still work during the 14-day grace period, and the account becomes read-only after it.
6. Resend the same event from the dashboard. Confirm the response is `outcome: duplicate` and nothing changes.
7. Cancel in the portal. Confirm "Subscription ends …" appears, then read-only after the period end.
8. Confirm MD Behavioral Health is unaffected throughout: the plan page says "Complimentary" and there is no banner.

## 6. Admin tools

- `npx tsx scripts/billing-set-comped.ts <orgId> "<reason>" [--apply]` marks an org comped. Add `--remove` to set it back to grandfathered. It is a dry run unless `--apply` is passed.
- `npm run db:seed:subscription` is now a read-only report of every org's billing status and access mode.
