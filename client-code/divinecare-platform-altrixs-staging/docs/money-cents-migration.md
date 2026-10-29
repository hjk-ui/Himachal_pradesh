# Money as integer cents: migration plan

Status: plan only (October 2026). New code paths already use integer cents; the columns
below are still `Float` (double precision dollars) and should move in a later, separate release.

## Why

`Float` dollars round on every sum (0.1 + 0.2 != 0.3). Claim totals, ERA balancing (BPR02 =
sum CLP04 - sum PLB), batch reconciliation and patient balances all add many values, so the
drift shows up as off-by-a-cent batches and "does not balance" errors. Integer cents (`Int`)
make every sum exact. The 835 tables (`era_*`) already use `Decimal(12,2)`, which is also exact.

## Already in cents (keep)

- `Claim.amountCents`, `Payment.amountCents`, `PatientStatement.balanceCents`, fee schedule cents,
  ledger math in `patientLedgerMath.ts`.
- New in the 20261019 RCM work: payment batch posting (`paymentBatchMath.ts`: totals compared in
  cents, Payment rows in cents), `createPaymentAdjustment`, prior auth units (integers).

## Still Float dollars (migrate)

| Model | Columns | Written by | Read by |
|---|---|---|---|
| Claim | paidAmount, adjustmentAmount, patientResponsibility | ERA posting (era.ts), claim editor | Claims page, AR, overview |
| ClaimServiceLine | unitCharge, totalCharge | claimLines.ts serviceLineData, claim editor | 837 mapper, ERA line match |
| PaymentBatch | totalAmount | ERA batch upsert, bulk-batch | Payments page, reconciliation |
| PaymentBatchLine | paidAmount, adjustment, patientBalance | ERA posting, bulk-batch | Payments page |
| MedicalCharge | chargedAmount | medical visits | medical billing |
| SpecializedBillingCharge | rate, totalAmount | residential / programs | billing |
| AutoPayCharge | amount | autopay | autopay page |
| EStatement | totalBilled, balanceDue | retired generate route (410) | legacy statement views |
| PaymentPlan | totalBalance | payment plans | statements |
| WaystarBatch / WaystarClaimBatch | totalAmount / totalCharges | Waystar send | batch lists |
| WaystarInboundFile | totalPaid | 835 summary | inbound list |
| HrBenefitPlan | employerCost, employeeCost | HR (not RCM; lower priority) | HR |

## Steps (one release per group, each reversible)

1. **Add** `<name>Cents Int?` next to each Float column (idempotent `ADD COLUMN IF NOT EXISTS`).
2. **Backfill** `UPDATE ... SET x_cents = ROUND(x * 100)` in a script with a dry-run that reports
   rows where `ABS(x * 100 - ROUND(x * 100)) > 0.001` (values that were never whole cents) for
   review before writing. Never guess a corrected value.
3. **Dual-write**: every writer sets both columns (search each column name; the table above lists
   the writers). Add a test per writer that the two agree.
4. **Switch readers** to the cents column; format with one shared `money(cents)` helper.
5. **Verify** in staging: claim totals = sum of line cents; every ERA batch = BPR02 to the cent;
   patient balances unchanged against a snapshot taken before step 1.
6. **Drop** the Float columns one release later (after a backup), then rename `xCents` if wanted.

Order by risk: ClaimServiceLine + Claim (837 / ERA balancing) first, then PaymentBatch(+Line),
then the rest. HR costs last (not revenue cycle).

## Rules for new code until then

- Do arithmetic in integer cents (`Math.round(dollars * 100)` once at the boundary), compare
  cents with `===`, convert back to dollars only to write a Float column.
- Never sum Float dollars directly to decide whether something balances.
