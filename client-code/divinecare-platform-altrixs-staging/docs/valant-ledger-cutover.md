# Valant balances to the Altrixs ledger: Nov 8 cutover

Owner decisions (2026-10-17):

1. Valant patient balances are posted to the Altrixs ledger.
2. Insurance A/R is a **run-out in Valant**. No claims or insurance balances are created from Valant. Insurance
   aging and the insurance part of combined aging stay reference-only.
3. Post on staging now as a rehearsal, then post again with the final numbers at the Nov 8 cutover. **Re-posting
   replaces the earlier posting. It never adds to it.**

## What gets posted

| Ledger entry | From | Amount | Not posted |
|---|---|---|---|
| `opening_balance` (shown as "Valant opening balance") | The **current** Patient Aging snapshot (latest as-of) | Each matched patient's Valant aging total. The sign is kept, so a negative total is a credit. | Unmatched Valant IDs (listed in the dry run). Patients with a $0 total. |
| `prepayment_credit` (shown as "Valant prepayment credit") | Valant Prepayments transactions | −(patient's net), only when the net is positive and complete | Unmatched names. Net below zero. Prepayments received before the report start that were applied in the period. Net of $0. |

A patient's balance is computed by `patientBalance()` in `src/lib/billing/patientLedger.ts`. Statements, autopay,
the chart and the Payments history all use it:

```
balance = active ledger entries (opening balance + prepayment credit + adjustments)
        + patient responsibility on Altrixs claims (ERA amount; billed amount on self-pay claims)
        − patient payments (every Payment that is not INSURANCE, with or without a claim)
```

There is at most one active entry per patient for each kind. This is enforced by the partial unique index
`PatientLedgerEntry_one_active_key`. When you post again, every active entry of that kind is superseded and the new
set is inserted, all in one transaction. A patient who is missing from the new data loses their earlier entry.
Rows are never deleted.

## Before Nov 8 (once)

- Apply `prisma/migrations/20261017_patient_ledger_entries.sql`. It is idempotent.
- Rehearse on staging: run the dry run, post, check, then unpost, using the same steps as below.

## At cutover (Nov 8)

1. **Freeze Valant patient billing** after the last Valant posting day. Do not take any more patient payments in
   Valant.
2. **Import the final Patient Aging Summary** under Admin → Migration → Valant reference imports. Its as-of date must
   be the cutover date. Check that the import reconciles (the green checks against the report totals).
3. **Import a FULL-HISTORY Prepayments export.** Set the start date to the practice's first Valant date, not
   Jan 1, 2026. A period-limited export makes patients "incomplete", and they are not posted. Resolve the Unmatched
   names on the Prepayments tab.
4. Open **Billing → Valant Balances → Post patient opening balances** to run the dry run. Check:
   - The as-of date is the cutover date.
   - "Reconciles" is green: posted total = matched rows total, and matched + unmatched = snapshot total.
   - The snapshot total equals the Valant report total printed on the Patient Aging Summary.
   - The **Unmatched** list. Match those patients first if they should carry a balance, then run the dry run again.
   - "Replace earlier postings" and the **Changes** list (rehearsal amount → final amount, plus removed patients).
5. Tick "I understand" (*This replaces any earlier Valant opening balances*), then **Post**.
6. Do the same with **Post prepayment credits**. Read the **Excluded** list and its reasons. Incomplete patients need a
   fuller export. They are never posted as a guess.
7. **Verify:**
   - The panel totals equal the dry-run totals, and the as-of date is correct.
   - Spot-check 5 charts: Insurance tab → *Patient balance (Altrixs ledger)*. The Valant opening balance line should
     equal that patient's row on the Patient Aging tab.
   - Payments history lists the entries ("Valant opening balance" / "Valant prepayment credit").
   - Generate statements as a draft (no send) and confirm that they show the "Previous balance (Valant, as of …)" line.
   - In the audit log, the `patientLedgerEntry` CREATE rows record the batch id, counts and totals.
8. **Do not post the insurance aging.** Insurance balances are worked to zero in Valant (run-out).

## Undo

**Unpost all Valant postings** supersedes every active Valant entry and keeps them as history. After that, you can
post again at any time. Statements that were already sent are not changed.

## Check before the rehearsal is signed off

- Confirm with Valant whether the Patient Aging total already nets out unapplied prepayments. If it does, posting
  prepayment credits as well would count the credit twice. In that case, post opening balances only.
- Corrected claims (frequency 7): the original claim is still counted if it carries ERA patient responsibility.
  Review these on the first statements run after go-live.
