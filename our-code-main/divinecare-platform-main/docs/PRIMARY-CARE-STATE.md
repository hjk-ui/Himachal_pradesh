# Primary-care persistence map

Honest inventory of where PC visit state lives. **Do not invent clinical defaults** — empty means none on file.

## Current store (production tables)

Migration: `prisma/migrations/20261027140000_medical_pc_workflow/`

| Entity | Table | Key / uniqueness | Notes |
|---|---|---|---|
| MA rooming | `MedicalRooming` | **1:1 `appointmentId`** | Status `draft` → `ready` → `in_room`. Vitals/screenings JSON on the row. ClientId locked after create (no cross-patient overwrite). |
| Care gaps | `MedicalCareGap` | `organizationId + clientId + gapId` | Catalog-driven; `lastDoneAt` null = none on file. MA cannot set `met`. |
| Referrals | `MedicalReferral` | row id | Status chain; warm handoff skips report step. |
| MA tasks | `MedicalMaTask` | row id | Provider → MA queue. |
| Close the loop | `CloseLoopNotification` | `org + itemId + method + notifiedDay` | Idempotent “Patient notified”. |
| Autopay sweep | `AutopaySweepAttempt` | `enrollmentId + periodKey` | Draft/attempt only until live capture path. |

## Still module / settings (staging-grade OK)

| Entity | Module key pattern | Promote when |
|---|---|---|
| Standing orders (6 POC) | `primary-care-standing-orders` | Multiple sites need versioned attestations |
| PC policy windows | `primary-care-settings` | Leadership saves 7/14/30 (until then hints only) |

`clinicModuleState` is **not** used for rooming / care-gaps / referrals / tasks after the Oct 21 gap migration. Older `chart-item:…` rooming rows are legacy; MA worklist reads `MedicalRooming` only.

## Deep-links

- MA rooming: `/dashboard/medical?appointmentId=…&clientId=…`
- Provider visit: `/dashboard/medical/visits?appointmentId=…&clientId=…`
- Opening provider visit when rooming is `ready` → auto `in_room` (API + audit).

## Audit (light)

HIPAA console audit via `writeAuditLog`:

- `medical.rooming.ready`
- `medical.rooming.in_room`
- `medical.close_loop.patient_notified`

## Backfill note

No automatic backfill from `clinicModuleState` / chart-items. If staging orgs had JSON rooming drafts, re-enter on the live appointment after migrate deploy. Keys were never shared across patients when appointment-scoped; Prisma unique on `appointmentId` enforces that.
