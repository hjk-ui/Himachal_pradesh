import 'server-only';
import { prisma } from '@/lib/db/prisma';
import { clientOrgFilter } from '@/lib/clients/orgScope';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { recordClinicalEvent } from '@/lib/clinical/events';
import { claimPoll, UPDATE_POLL_MIN_MS } from '@/lib/drfirst/persistence';
import {
  mapDownloadedAllergy,
  mapDownloadedProblem,
  officeVisitPayload,
  patientReview,
  patientReviewPayload,
  prescriptionEventPayload,
  formatRcopiaCursor,
  firstRunCursor,
  PROBLEM_EXTERNAL_PREFIX,
  MEDICATION_EXTERNAL_PREFIX,
} from '@/lib/drfirst/chartMapping';
import {
  updateMedications,
  updateAllergies,
  updatePrescriptionEvents,
  type DownloadedAllergy,
  type PrescriptionEvent,
  updatePrescriptions,
  updateRxFills,
  updateRxChanges,
  updateNotifications,
  updateProblems,
  updatePatients,
  updateOfficeVisits,
  type DownloadedProblem,
  type DownloadedPatient,
  type DownloadedOfficeVisit,
  type DownloadedMedication,
  type DownloadedPrescription,
  type PharmacyFillEvent,
  type RxChangeRequest,
  type DownloadedNotification,
} from '@/lib/services/drfirstCommands';

/**
 * Rcopia → Altrixs chart sync. Every downloaded row is matched to a client of
 * ONE organization (Client.rcopiaPatientId, or the Rcopia external id, which
 * is our client id). Rows that match no client of that organization are
 * skipped and counted, never written with a placeholder client or value.
 *
 * Results carry ids and counts only (they are returned to the browser and
 * written to the audit log).
 */

export interface PatientRef {
  patientExternalId?: string;
  patientRcopiaId?: string;
}

export interface StepResult {
  ok: boolean;
  demo: boolean;
  downloaded: number;
  created: number;
  updated: number;
  skippedNoClient: number;
  skippedMissingData: number;
  failed: number;
  cursorAdvanced: boolean;
  /** Not called: the same download ran less than 5 minutes ago (GM8 / DR2) */
  throttled?: boolean;
  error?: string;
  /** Rcopia ids of rows that were skipped for missing data (ids only, for follow-up). */
  skippedIds: string[];
}

function emptyStep(demo: boolean): StepResult {
  return { ok: true, demo, downloaded: 0, created: 0, updated: 0, skippedNoClient: 0, skippedMissingData: 0, failed: 0, cursorAdvanced: false, skippedIds: [] };
}

function skipMissing(step: StepResult, id: string | undefined) {
  step.skippedMissingData += 1;
  if (id && step.skippedIds.length < 50) step.skippedIds.push(id);
}

/** Rcopia sends MM/DD/YYYY or MM/DD/YYYY HH:MM:SS. Invalid / empty -> null (never "now"). */
export function parseRcopiaDate(v?: string | null): Date | null {
  if (!v || !v.trim()) return null;
  const d = new Date(v.trim());
  return Number.isNaN(d.getTime()) ? null : d;
}

// formatRcopiaCursor (MM/DD/YYYY HH:MM:SS, UTC) and firstRunCursor live in a pure module for tests
export { formatRcopiaCursor, firstRunCursor };

// ─── Cursors (existing drfirst_sync_cursors table, keyed per organization) ───

const cursorKey = (command: string, organizationId: string) => `${command}:${organizationId}`;

export async function getCursor(command: string, organizationId: string): Promise<string | undefined> {
  const own = await prisma.drFirstSyncCursor.findUnique({ where: { commandName: cursorKey(command, organizationId) } });
  if (own?.lastUpdateDate) return own.lastUpdateDate;
  // Pre-org-scoping rows were keyed by command only
  const legacy = await prisma.drFirstSyncCursor.findUnique({ where: { commandName: command } });
  return legacy?.lastUpdateDate || undefined;
}

export async function saveCursor(command: string, organizationId: string, value: string): Promise<void> {
  const commandName = cursorKey(command, organizationId);
  await prisma.drFirstSyncCursor.upsert({
    where: { commandName },
    create: { commandName, lastUpdateDate: value },
    update: { lastUpdateDate: value },
  });
}

/** No stored medication cursor: resume from the newest Rcopia med already in this org's charts (1-day overlap; writes are idempotent). */
async function medicationCursorFallback(organizationId: string): Promise<string | undefined> {
  const latest = await prisma.clientMedication.findFirst({
    where: { rcopiaMedId: { not: null }, client: clientOrgFilter(organizationId) },
    orderBy: { updatedAt: 'desc' },
    select: { updatedAt: true },
  });
  if (!latest) return undefined;
  return formatRcopiaCursor(new Date(latest.updatedAt.getTime() - 24 * 3600 * 1000));
}

// ─── Matching ────────────────────────────────────────────────────────────────

export interface ClientResolver {
  (ref: PatientRef): string | null;
}

/** Map Rcopia patient refs to client ids of this organization only. */
export async function buildClientResolver(organizationId: string, refs: PatientRef[]): Promise<ClientResolver> {
  const extIds = [...new Set(refs.map(r => r.patientExternalId).filter((v): v is string => Boolean(v)))];
  const rcopiaIds = [...new Set(refs.map(r => r.patientRcopiaId).filter((v): v is string => Boolean(v)))];
  if (!extIds.length && !rcopiaIds.length) return () => null;
  const rows = await prisma.client.findMany({
    where: {
      AND: [
        clientOrgFilter(organizationId),
        { OR: [...(extIds.length ? [{ id: { in: extIds } }] : []), ...(rcopiaIds.length ? [{ rcopiaPatientId: { in: rcopiaIds } }] : [])] },
      ],
    },
    select: { id: true, rcopiaPatientId: true },
  });
  const byId = new Set(rows.map(r => r.id));
  const byRcopia = new Map<string, string>();
  for (const r of rows) if (r.rcopiaPatientId) byRcopia.set(r.rcopiaPatientId, r.id);
  return (ref: PatientRef) => {
    if (ref.patientExternalId && byId.has(ref.patientExternalId)) return ref.patientExternalId;
    if (ref.patientRcopiaId && byRcopia.has(ref.patientRcopiaId)) return byRcopia.get(ref.patientRcopiaId)!;
    return null;
  };
}

export interface StaffMatch { id: string; npi: string | null; name: string | null }

/** Org staff keyed by lower-cased Rcopia username. */
export async function loadOrgPrescribers(organizationId: string): Promise<Map<string, StaffMatch>> {
  const users = await prisma.user.findMany({
    where: { organizationId, rcopiaUsername: { not: null } },
    select: { id: true, npi: true, name: true, rcopiaUsername: true },
  });
  const map = new Map<string, StaffMatch>();
  for (const u of users) {
    const key = u.rcopiaUsername?.trim().toLowerCase();
    if (key) map.set(key, { id: u.id, npi: u.npi?.trim() || null, name: u.name });
  }
  return map;
}

// ─── update_medication → ClientMedication ────────────────────────────────────

async function applyMedications(
  organizationId: string,
  meds: DownloadedMedication[],
  step: StepResult,
  onlyClientId?: string,
): Promise<void> {
  if (!meds.length) return;
  const resolve = await buildClientResolver(organizationId, meds);
  const staff = await loadOrgPrescribers(organizationId);
  const now = new Date();

  for (const m of meds) {
    const clientId = resolve(m);
    if (!clientId || (onlyClientId && clientId !== onlyClientId)) {
      step.skippedNoClient += 1;
      continue;
    }
    // Our own chart medication echoed back (send_medication ExternalID): already in the chart, never copied
    if (m.externalId?.startsWith(MEDICATION_EXTERNAL_PREFIX)) continue;
    const stopDate = parseRcopiaDate(m.stopDate);
    const startDate = parseRcopiaDate(m.startDate);
    const discontinued = m.deleted || Boolean(stopDate && stopDate <= now);
    const prescriber = m.providerUsername ? staff.get(m.providerUsername.toLowerCase()) : undefined;
    const data = {
      medicationName: m.drugName,
      dosage: m.strength || '',
      route: m.route ?? null,
      frequency: m.doseTiming ?? null,
      instructions: m.sigText ?? null,
      endDate: stopDate,
      stopDate,
      stopReason: m.stopReason ?? (m.deleted ? 'Deleted in DrFirst' : null),
      active: !discontinued,
      status: discontinued ? 'discontinued' : 'active',
      // Rcopia-written meds are prescriptions; HistorySource marks outside / patient-reported meds
      source: m.historySource ? 'reported' : 'prescribed',
      externalMedId: m.externalId ?? null,
      rcopiaMedId: m.rcopiaId,
      drugName: m.drugName,
      brandName: m.brandName ?? null,
      genericName: m.genericName ?? null,
      ndcCode: m.ndcId ?? null,
      rxnormId: m.rxnormId ?? null,
      dosageText: m.sigText ?? null,
      action: m.action ?? null,
      dose: m.dose ?? null,
      doseUnit: m.doseUnit ?? null,
      quantity: m.quantity ?? null,
      refills: m.refills ?? null,
      asNeeded: m.asNeeded,
      prnReason: m.asNeeded ? m.doseOther ?? null : null,
      schedule: m.schedule ?? null,
      prescriberName: m.providerName ?? null,
      prescribedById: prescriber?.id ?? null,
      // startDate is NOT NULL in the schema; only set it when Rcopia sent one
      ...(startDate ? { startDate } : {}),
    };
    try {
      const existing = await prisma.clientMedication.findFirst({
        where: { clientId, rcopiaMedId: m.rcopiaId },
        select: { id: true },
      });
      if (existing) {
        await prisma.clientMedication.update({ where: { id: existing.id }, data });
        step.updated += 1;
      } else {
        await prisma.clientMedication.create({ data: { ...data, clientId } });
        step.created += 1;
      }
    } catch (err) {
      step.failed += 1;
      console.error('[drfirst-sync] medication write failed', JSON.stringify({ rcopiaMedId: m.rcopiaId, error: err instanceof Error ? err.name : 'unknown' }));
    }
  }
}

// ─── update_prescription → rcopia_prescriptions ──────────────────────────────

function lifecycleOf(status: DownloadedPrescription['status']): string {
  if (status === 'deleted' || status === 'voided' || status === 'denied') return 'cancelled';
  return status;
}

async function applyPrescriptions(
  organizationId: string,
  rxs: DownloadedPrescription[],
  step: StepResult,
  onlyClientId?: string,
): Promise<void> {
  if (!rxs.length) return;
  const resolve = await buildClientResolver(organizationId, rxs);
  for (const rx of rxs) {
    const clientId = resolve(rx);
    if (!clientId || (onlyClientId && clientId !== onlyClientId)) {
      step.skippedNoClient += 1;
      continue;
    }
    if (!rx.rcopiaId || !rx.drugName) {
      skipMissing(step, rx.rcopiaId);
      continue;
    }
    // A pending script can still be edited in Rcopia before it is signed: every re-download refreshes it
    const fields = {
      lifecycleStatus: lifecycleOf(rx.status),
      signedDate: parseRcopiaDate(rx.signedDate),
      stopDate: parseRcopiaDate(rx.stopDate),
      externalId: rx.externalId ?? null,
      providerName: rx.providerName ?? null,
      providerNpi: rx.providerNpi ?? null,
      providerDea: rx.providerDea ?? null,
      supervisorName: rx.supervisorName ?? null,
      drugName: rx.drugName,
      schedule: rx.schedule ?? null,
      sig: rx.sig ?? null,
      quantity: rx.quantity ?? null,
      refills: rx.refills ?? null,
      pharmacyName: rx.pharmacyName ?? null,
      pharmacyNcpdpId: rx.pharmacyNcpdpId ?? null,
      createdDate: parseRcopiaDate(rx.createdDate),
    };
    try {
      const existing = await prisma.rcopiaPrescription.findUnique({ where: { rcopiaId: rx.rcopiaId }, select: { clientId: true } });
      if (existing) {
        if (existing.clientId !== clientId) {
          // Same Rcopia script already filed to a different chart: never move it silently
          skipMissing(step, rx.rcopiaId);
          continue;
        }
        await prisma.rcopiaPrescription.update({ where: { rcopiaId: rx.rcopiaId }, data: fields });
        step.updated += 1;
      } else {
        await prisma.rcopiaPrescription.create({ data: { ...fields, clientId, rcopiaId: rx.rcopiaId } });
        step.created += 1;
      }
    } catch (err) {
      step.failed += 1;
      console.error('[drfirst-sync] prescription write failed', JSON.stringify({ rcopiaId: rx.rcopiaId, error: err instanceof Error ? err.name : 'unknown' }));
    }
  }
}

// ─── update_rxfill / update_rxchange / update_notification ───────────────────

async function applyRxFills(organizationId: string, fills: PharmacyFillEvent[], step: StepResult): Promise<void> {
  if (!fills.length) return;
  const resolve = await buildClientResolver(organizationId, fills);
  for (const f of fills) {
    const clientId = resolve(f);
    if (!clientId) { step.skippedNoClient += 1; continue; }
    const rxId = f.prescriptionRcopiaId || f.notificationId;
    const fillDate = parseRcopiaDate(f.fillDate);
    if (!rxId || !fillDate) { skipMissing(step, f.notificationId || rxId); continue; }
    try {
      const dup = await prisma.rcopiaRxfillEvent.findFirst({
        where: { clientId, prescriptionRcopiaId: rxId, fillStatus: f.fillStatus, fillDate },
        select: { id: true },
      });
      if (dup) continue;
      await prisma.rcopiaRxfillEvent.create({
        data: {
          clientId,
          prescriptionRcopiaId: rxId,
          fillStatus: f.fillStatus,
          reasonCode: f.reasonCode ?? null,
          fillNotes: f.fillNote ?? null,
          pharmacyName: f.pharmacyName ?? null,
          fillDate,
          adherenceFlag: f.fillStatus === 'not_dispensed' ? 'warning_outreach_needed' : 'ok',
        },
      });
      step.created += 1;
    } catch (err) {
      step.failed += 1;
      console.error('[drfirst-sync] rxfill write failed', JSON.stringify({ id: rxId, error: err instanceof Error ? err.name : 'unknown' }));
    }
  }
}

async function applyRxChanges(organizationId: string, changes: RxChangeRequest[], step: StepResult): Promise<void> {
  if (!changes.length) return;
  const resolve = await buildClientResolver(organizationId, changes);
  for (const c of changes) {
    const clientId = resolve(c);
    if (!clientId) { step.skippedNoClient += 1; continue; }
    const ordered = c.medicationOrdered?.drug;
    const requested = c.medicationsRequested?.[0]?.drug;
    if (!c.notificationId || !ordered || !requested) { skipMissing(step, c.notificationId); continue; }
    // Answered in Rcopia: a ResponseCode, or a closed Status. Stored as Rcopia's own word so the
    // Altrixs queue clears when the prescriber responds in DrFirst (never an invented outcome).
    const answered = Boolean(c.responseCode?.trim()) || /complet|approv|den|clos|cancel|expir|respond/i.test(c.status || '');
    const status = answered ? (c.status?.trim().toLowerCase() || 'responded').slice(0, 40) : 'pending';
    try {
      const existing = await prisma.rcopiaRxchangeRequest.findUnique({ where: { rcopiaId: c.notificationId }, select: { id: true, status: true } });
      if (existing) {
        if (existing.status !== status) {
          await prisma.rcopiaRxchangeRequest.update({ where: { id: existing.id }, data: { status } });
          step.updated += 1;
        }
        continue;
      }
      await prisma.rcopiaRxchangeRequest.create({
        data: {
          clientId,
          rcopiaId: c.notificationId,
          orderedDrugName: ordered,
          requestedDrugName: requested,
          // NOT NULL columns: empty when Rcopia sent nothing (never an invented reason)
          requestType: c.requestType || '',
          changeReason: c.changeReason || '',
          priorAuthNumber: c.priorAuthConfirmation ?? null,
          status,
        },
      });
      step.created += 1;
    } catch (err) {
      step.failed += 1;
      console.error('[drfirst-sync] rxchange write failed', JSON.stringify({ id: c.notificationId, error: err instanceof Error ? err.name : 'unknown' }));
    }
  }
}

async function applyNotifications(organizationId: string, notes: DownloadedNotification[], step: StepResult): Promise<void> {
  if (!notes.length) return;
  const resolve = await buildClientResolver(organizationId, notes);
  for (const n of notes) {
    const clientId = resolve(n);
    if (!clientId) { step.skippedNoClient += 1; continue; }
    const orderNumber = n.prescriberOrderNumber || n.rcopiaId;
    if (!orderNumber || !n.providerUsername || !n.drugPrescribed) { skipMissing(step, n.rcopiaId || orderNumber); continue; }
    try {
      const dup = await prisma.rcopiaRefillNotification.findFirst({
        where: { clientId, rcopiaOrderNumber: orderNumber },
        select: { id: true, actionTaken: true },
      });
      if (dup) {
        // Rcopia reports the provider's answer (ActionTaken / FinalActionDate): the renewal leaves the pending badge
        const action = n.actionTaken?.trim().toLowerCase() || (n.finalActionDate ? 'completed' : '');
        if (action && dup.actionTaken !== action) {
          await prisma.rcopiaRefillNotification.update({ where: { id: dup.id }, data: { actionTaken: action.slice(0, 40) } });
          step.updated += 1;
        }
        continue;
      }
      await prisma.rcopiaRefillNotification.create({
        data: {
          clientId,
          // The provider who owns the renewal in Rcopia, not whoever ran the sync
          providerUsername: n.providerUsername,
          rcopiaOrderNumber: orderNumber,
          drugPrescribed: n.drugPrescribed,
          drugDispensed: n.drugDispensed || '',
          pharmacyName: n.pharmacyName ?? null,
          actionTaken: n.actionTaken?.trim().toLowerCase().slice(0, 40) || (n.finalActionDate ? 'completed' : 'pending'),
        },
      });
      step.created += 1;
    } catch (err) {
      step.failed += 1;
      console.error('[drfirst-sync] notification write failed', JSON.stringify({ id: orderNumber, error: err instanceof Error ? err.name : 'unknown' }));
    }
  }
}

// ─── update_allergy → MedicalAllergy (source 'drfirst') ───────────────────────

/**
 * Upsert Rcopia allergies into the chart allergy list. A row Rcopia echoes
 * back with our MedicalAllergy id as ExternalID is the local entry we sent:
 * only its Rcopia id is recorded (local content stays as charted). Others are
 * matched by Rcopia id and written with source 'drfirst'. Nothing is deleted:
 * deleted / inactive in Rcopia -> status Inactive on DrFirst-sourced rows only.
 */
async function applyAllergies(organizationId: string, rows: DownloadedAllergy[], step: StepResult): Promise<void> {
  if (!rows.length) return;
  const resolve = await buildClientResolver(organizationId, rows);
  const clientIds = [...new Set(rows.map(r => resolve(r)).filter((v): v is string => Boolean(v)))];
  // Allergies key on the medical chart when the client has one
  const medicalCharts = clientIds.length
    ? await prisma.medicalPatient.findMany({ where: { organizationId, bhClientId: { in: clientIds } }, select: { id: true, bhClientId: true } })
    : [];
  const medicalByClient = new Map(medicalCharts.map(m => [m.bhClientId as string, m.id]));

  for (const a of rows) {
    const clientId = resolve(a);
    if (!clientId) { step.skippedNoClient += 1; continue; }
    const mapped = mapDownloadedAllergy(a);
    if (!mapped) { skipMissing(step, a.rcopiaId); continue; }
    try {
      if (a.externalId) {
        const local = await prisma.medicalAllergy.findFirst({ where: { id: a.externalId, clientId }, select: { id: true, rcopiaAllergyId: true } });
        if (local) {
          if (local.rcopiaAllergyId !== mapped.rcopiaAllergyId) {
            await prisma.medicalAllergy.update({ where: { id: local.id }, data: { rcopiaAllergyId: mapped.rcopiaAllergyId } });
            step.updated += 1;
          }
          continue;
        }
      }
      const existing = await prisma.medicalAllergy.findFirst({
        where: { clientId, rcopiaAllergyId: mapped.rcopiaAllergyId },
        select: { id: true, source: true },
      });
      if (existing) {
        // A local entry linked to this Rcopia id keeps its charted content
        if (existing.source !== 'drfirst') continue;
        await prisma.medicalAllergy.update({ where: { id: existing.id }, data: mapped });
        step.updated += 1;
      } else {
        if (mapped.status === 'Inactive') continue; // never create a row only to mark it deleted
        await prisma.medicalAllergy.create({
          data: { ...mapped, clientId, patientId: medicalByClient.get(clientId) ?? null, source: 'drfirst' },
        });
        step.created += 1;
      }
    } catch (err) {
      step.failed += 1;
      console.error('[drfirst-sync] allergy write failed', JSON.stringify({ rcopiaId: a.rcopiaId, error: err instanceof Error ? err.name : 'unknown' }));
    }
  }
}

// ─── update_prescription_events → ClinicalEvent (drfirst-prescription-event) ──

export const PRESCRIPTION_EVENT_TYPE = 'drfirst-prescription-event';

/**
 * Transmission / signing / cancellation / PDMP telemetry per script, filed to
 * the chart of the client that owns the Rcopia prescription (rcopia_prescriptions,
 * filled by the update_prescription step that runs first). One ClinicalEvent per
 * distinct event state; an unchanged re-download is not stored twice.
 */
async function applyPrescriptionEvents(organizationId: string, events: PrescriptionEvent[], step: StepResult): Promise<void> {
  if (!events.length) return;
  const ids = [...new Set(events.map(e => e.rcopiaId).filter(Boolean))];
  const owners = ids.length
    ? await prisma.rcopiaPrescription.findMany({
        where: { rcopiaId: { in: ids }, client: clientOrgFilter(organizationId) },
        select: { rcopiaId: true, clientId: true },
      })
    : [];
  const ownerOf = new Map(owners.map(o => [o.rcopiaId, o.clientId]));

  for (const e of events) {
    if (!e.rcopiaId) { skipMissing(step, e.externalId); continue; }
    const clientId = ownerOf.get(e.rcopiaId);
    if (!clientId) { step.skippedNoClient += 1; continue; }
    const payload = prescriptionEventPayload(e);
    try {
      const dup = await prisma.clinicalEvent.findFirst({
        where: {
          organizationId, clientId, eventType: PRESCRIPTION_EVENT_TYPE,
          payloadJson: { path: ['fingerprint'], equals: String(payload.fingerprint) },
        },
        select: { id: true },
      });
      if (dup) continue;
      await recordClinicalEvent({ organizationId, eventType: PRESCRIPTION_EVENT_TYPE, clientId, payload });
      step.created += 1;
    } catch (err) {
      step.failed += 1;
      console.error('[drfirst-sync] prescription event write failed', JSON.stringify({ rcopiaId: e.rcopiaId, error: err instanceof Error ? err.name : 'unknown' }));
    }
  }
}

// ─── update_problem → MedicalProblem (source 'drfirst') ──────────────────────

/**
 * Upsert Rcopia problems into the chart problem list (MedicalProblem, keyed by
 * clientId; patientId set when the client has a medical chart). Client.primary
 * DiagnosisCode / secondaryDiagnoses are never touched. Rows Rcopia echoes back
 * with our own send_problem ExternalID are the chart's own diagnoses and are
 * not copied again. Local (source null) rows are never changed; nothing is
 * deleted: deleted in Rcopia -> Inactive on the DrFirst-sourced row.
 */
async function applyProblems(organizationId: string, rows: DownloadedProblem[], step: StepResult): Promise<void> {
  if (!rows.length) return;
  const resolve = await buildClientResolver(organizationId, rows);
  const clientIds = [...new Set(rows.map(r => resolve(r)).filter((v): v is string => Boolean(v)))];
  const medicalCharts = clientIds.length
    ? await prisma.medicalPatient.findMany({ where: { organizationId, bhClientId: { in: clientIds } }, select: { id: true, bhClientId: true } })
    : [];
  const medicalByClient = new Map(medicalCharts.map(m => [m.bhClientId as string, m.id]));

  for (const p of rows) {
    const clientId = resolve(p);
    if (!clientId) { step.skippedNoClient += 1; continue; }
    if (p.externalId?.startsWith(PROBLEM_EXTERNAL_PREFIX)) continue; // our own chart diagnosis, echoed back
    const mapped = mapDownloadedProblem(p);
    if (!mapped) { skipMissing(step, p.rcopiaId); continue; }
    try {
      const existing = await prisma.medicalProblem.findFirst({
        where: { clientId, rcopiaProblemId: mapped.rcopiaProblemId },
        select: { id: true, source: true, resolvedDate: true },
      });
      if (existing) {
        if (existing.source !== 'drfirst') continue;
        await prisma.medicalProblem.update({
          where: { id: existing.id },
          // keep the first date the row was seen resolved
          data: { ...mapped, resolvedDate: mapped.status === 'Resolved' ? existing.resolvedDate ?? new Date() : null },
        });
        step.updated += 1;
      } else {
        if (mapped.status === 'Inactive') continue; // never create a row only to mark it deleted
        await prisma.medicalProblem.create({
          data: {
            ...mapped,
            resolvedDate: mapped.status === 'Resolved' ? new Date() : null,
            clientId,
            patientId: medicalByClient.get(clientId) ?? null,
            source: 'drfirst',
          },
        });
        step.created += 1;
      }
    } catch (err) {
      step.failed += 1;
      console.error('[drfirst-sync] problem write failed', JSON.stringify({ rcopiaId: p.rcopiaId, error: err instanceof Error ? err.name : 'unknown' }));
    }
  }
}

// ─── update_patient → Client.rcopiaPatientId + review items ──────────────────

export const PATIENT_REVIEW_EVENT_TYPE = 'drfirst-patient-review';
export const PATIENT_REVIEW_ACK_EVENT_TYPE = 'drfirst-patient-review-ack';

/**
 * Rcopia patient changes. A patient carrying our client id as ExternalID
 * confirms the chart's Rcopia id (set when the chart has none, or only the
 * client-id placeholder from send_patient). Chart demographics are never
 * overwritten: name / DOB / sex / ZIP differences, a chart linked to another
 * Rcopia patient, or a patient deleted in Rcopia become one review item
 * (ClinicalEvent drfirst-patient-review) per distinct state.
 */
async function applyPatients(organizationId: string, rows: DownloadedPatient[], step: StepResult): Promise<void> {
  const usable = rows.filter(r => r.rcopiaId && !r.error);
  step.skippedMissingData += rows.length - usable.length;
  if (!usable.length) return;
  const refs = usable.map(r => ({ patientExternalId: r.externalId, patientRcopiaId: r.rcopiaId }));
  const resolve = await buildClientResolver(organizationId, refs);
  const ids = [...new Set(refs.map(r => resolve(r)).filter((v): v is string => Boolean(v)))];
  const charts = ids.length
    ? await prisma.client.findMany({
        where: { id: { in: ids } },
        select: { id: true, rcopiaPatientId: true, legalFirstName: true, legalLastName: true, dateOfBirth: true, gender: true, postalCode: true },
      })
    : [];
  const chartById = new Map(charts.map(c => [c.id, c]));

  for (const p of usable) {
    const clientId = resolve({ patientExternalId: p.externalId, patientRcopiaId: p.rcopiaId });
    const chart = clientId ? chartById.get(clientId) : undefined;
    if (!chart) { step.skippedNoClient += 1; continue; }
    const review = patientReview(chart, p);
    try {
      if (review.linkRcopiaId) {
        await prisma.client.update({ where: { id: chart.id }, data: { rcopiaPatientId: review.linkRcopiaId } });
        step.updated += 1;
      }
      const payload = patientReviewPayload(p.rcopiaId!, review);
      if (!payload) continue;
      const dup = await prisma.clinicalEvent.findFirst({
        where: {
          organizationId, clientId: chart.id, eventType: PATIENT_REVIEW_EVENT_TYPE,
          payloadJson: { path: ['fingerprint'], equals: String(payload.fingerprint) },
        },
        select: { id: true },
      });
      if (dup) continue;
      await recordClinicalEvent({ organizationId, eventType: PATIENT_REVIEW_EVENT_TYPE, clientId: chart.id, payload });
      step.created += 1;
    } catch (err) {
      step.failed += 1;
      console.error('[drfirst-sync] patient write failed', JSON.stringify({ rcopiaId: p.rcopiaId, error: err instanceof Error ? err.name : 'unknown' }));
    }
  }
}

// ─── update_patient_office_visits → ClinicalEvent (drfirst-office-visit) ─────

export const OFFICE_VISIT_EVENT_TYPE = 'drfirst-office-visit';

/** One ClinicalEvent per distinct downloaded visit state (re-downloads are not stored twice). */
async function applyOfficeVisits(organizationId: string, visits: DownloadedOfficeVisit[], step: StepResult): Promise<void> {
  if (!visits.length) return;
  const resolve = await buildClientResolver(organizationId, visits);
  for (const v of visits) {
    const clientId = resolve(v);
    if (!clientId) { step.skippedNoClient += 1; continue; }
    if (!v.visitDate && !v.deleted) { skipMissing(step, v.rcopiaId); continue; }
    const payload = officeVisitPayload(v);
    try {
      const dup = await prisma.clinicalEvent.findFirst({
        where: {
          organizationId, clientId, eventType: OFFICE_VISIT_EVENT_TYPE,
          payloadJson: { path: ['fingerprint'], equals: String(payload.fingerprint) },
        },
        select: { id: true },
      });
      if (dup) continue;
      await recordClinicalEvent({ organizationId, eventType: OFFICE_VISIT_EVENT_TYPE, clientId, payload });
      step.created += 1;
    } catch (err) {
      step.failed += 1;
      console.error('[drfirst-sync] office visit write failed', JSON.stringify({ rcopiaId: v.rcopiaId, error: err instanceof Error ? err.name : 'unknown' }));
    }
  }
}

// ─── Orchestration ───────────────────────────────────────────────────────────

type Download<T> = { ok: boolean; demo: boolean; nextCursor?: string; error?: { code: string; text: string }; status: string } & T;

/** Throttle key for one download scope (GM8 / DR2: an update_* scope is polled at most every 5 minutes). */
export const pollKey = (command: string, scope: string) => `poll:${command}:${scope}`;

/** The minute a moment falls in (seconds and milliseconds dropped). */
export function startOfMinute(d: Date): Date {
  return new Date(Math.floor(d.getTime() / 60_000) * 60_000);
}

/** Run one cursor-based download for an org; the cursor only advances when every row was handled. */
async function cursorStep<T>(
  command: string,
  organizationId: string,
  fetcher: (cursor: string | undefined) => Promise<Download<T>>,
  rows: (r: Download<T>) => unknown[],
  apply: (r: Download<T>, step: StepResult) => Promise<void>,
  fallbackCursor?: () => Promise<string | undefined>,
): Promise<StepResult> {
  // Practice-wide polls are claimed at the whole minute: the 5-minute cron then lands exactly 5 minutes
  // after the last claim (GM8) instead of being throttled when a run starts a few seconds early.
  const claim = await claimPoll(pollKey(command, organizationId), UPDATE_POLL_MIN_MS, startOfMinute(new Date()));
  if (!claim.claimed) return { ...emptyStep(false), throttled: true };
  let cursor = await getCursor(command, organizationId);
  if (!cursor && fallbackCursor) cursor = await fallbackCursor();
  // Never call an update_* without LastUpdateDate; the cursor is saved only after a clean download
  if (!cursor) cursor = firstRunCursor();
  const res = await fetcher(cursor);
  const step = emptyStep(res.demo);
  if (res.demo) return step;
  if (!res.ok) {
    step.ok = false;
    step.error = res.error?.code || res.status;
    return step;
  }
  step.downloaded = rows(res).length;
  await apply(res, step);
  if (res.nextCursor && step.failed === 0) {
    await saveCursor(command, organizationId, res.nextCursor);
    step.cursorAdvanced = true;
  }
  return step;
}

/** Who ran the sweep, for the per-download audit rows (cron: system). */
export interface SyncActor { userId: string | null; role: string; ipAddress: string | null; userAgent: string | null }
const SYSTEM_ACTOR: SyncActor = { userId: null, role: 'system', ipAddress: null, userAgent: 'cron' };

async function auditDownload(action: string, organizationId: string, step: StepResult, actor: SyncActor, resourceType = 'prescription'): Promise<void> {
  if (step.demo || step.throttled) return;
  await writeAuditLog({
    action,
    actorUserId: actor.userId,
    actorRole: actor.role,
    organizationId,
    resourceType,
    resourceId: 'drfirst-sync',
    outcome: step.ok && step.failed === 0 ? 'SUCCESS' : 'FAILURE',
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
    metadata: {
      scope: 'organization', downloaded: step.downloaded, created: step.created, updated: step.updated,
      skippedNoClient: step.skippedNoClient, skippedMissingData: step.skippedMissingData, failed: step.failed,
      cursorAdvanced: step.cursorAdvanced, errorCode: step.error ?? null,
    },
  });
}

/**
 * Practice-wide delta sync for one organization (ADMIN or cron). Signs as
 * `rcopiaUserName` when given (the admin's own username), else practice-level.
 * update_patient runs first so newly confirmed Rcopia ids resolve in every later
 * step. update_patient, update_allergy, update_problem, update_prescription_events
 * and update_patient_office_visits also write their own audit row (counts only).
 */
export async function syncOrganization(
  organizationId: string,
  rcopiaUserName?: string,
  actor: SyncActor = SYSTEM_ACTOR,
): Promise<Record<string, StepResult>> {
  const out: Record<string, StepResult> = {};
  out.patients = await cursorStep(
    'update_patient', organizationId,
    cursor => updatePatients({ lastUpdateDate: cursor }, rcopiaUserName),
    r => r.patients,
    (r, step) => applyPatients(organizationId, r.patients, step),
  );
  await auditDownload('DRFIRST_PATIENT_DOWNLOAD', organizationId, out.patients, actor, 'patient');
  out.medications = await cursorStep(
    'update_medication', organizationId,
    cursor => updateMedications({ lastUpdateDate: cursor }, rcopiaUserName),
    r => r.medications,
    (r, step) => applyMedications(organizationId, r.medications, step),
    () => medicationCursorFallback(organizationId),
  );
  await auditDownload('DRFIRST_MEDICATION_DOWNLOAD', organizationId, out.medications, actor, 'medication');
  // Status "all": without it Rcopia returns completed scripts only (pending ones never reached the chart).
  // Own cursor name, so the first run after this change backfills the lookback window once.
  out.prescriptions = await cursorStep(
    PRESCRIPTION_CURSOR, organizationId,
    cursor => updatePrescriptions({ lastUpdateDate: cursor, status: 'all' }, rcopiaUserName),
    r => r.prescriptions,
    (r, step) => applyPrescriptions(organizationId, r.prescriptions, step),
  );
  await auditDownload('DRFIRST_PRESCRIPTION_DOWNLOAD', organizationId, out.prescriptions, actor);
  // After update_prescription, so events find the script's chart
  out.prescriptionEvents = await cursorStep(
    'update_prescription_events', organizationId,
    cursor => updatePrescriptionEvents({ lastUpdateDate: cursor }, rcopiaUserName),
    r => r.events,
    (r, step) => applyPrescriptionEvents(organizationId, r.events, step),
  );
  await auditDownload('DRFIRST_PRESCRIPTION_EVENTS_DOWNLOAD', organizationId, out.prescriptionEvents, actor);
  out.allergies = await cursorStep(
    'update_allergy', organizationId,
    cursor => updateAllergies({ lastUpdateDate: cursor }, rcopiaUserName),
    r => r.allergies,
    (r, step) => applyAllergies(organizationId, r.allergies, step),
  );
  await auditDownload('DRFIRST_ALLERGY_DOWNLOAD', organizationId, out.allergies, actor);
  out.problems = await cursorStep(
    'update_problem', organizationId,
    cursor => updateProblems({ lastUpdateDate: cursor }, rcopiaUserName),
    r => r.problems,
    (r, step) => applyProblems(organizationId, r.problems, step),
  );
  await auditDownload('DRFIRST_PROBLEM_DOWNLOAD', organizationId, out.problems, actor, 'medicalProblem');
  out.rxFills = await cursorStep(
    'update_rxfill', organizationId,
    cursor => updateRxFills({ lastUpdateDate: cursor }, rcopiaUserName),
    r => r.fills,
    (r, step) => applyRxFills(organizationId, r.fills, step),
  );
  await auditDownload('DRFIRST_RXFILL_DOWNLOAD', organizationId, out.rxFills, actor);
  out.rxChanges = await cursorStep(
    'update_rxchange', organizationId,
    cursor => updateRxChanges({ lastUpdateDate: cursor }, rcopiaUserName),
    r => r.rxChanges,
    (r, step) => applyRxChanges(organizationId, r.rxChanges, step),
  );
  await auditDownload('DRFIRST_RXCHANGE_DOWNLOAD', organizationId, out.rxChanges, actor);
  out.notifications = await cursorStep(
    'update_notification', organizationId,
    cursor => updateNotifications({ lastUpdateDate: cursor }, rcopiaUserName),
    r => r.notifications,
    (r, step) => applyNotifications(organizationId, r.notifications, step),
  );
  await auditDownload('DRFIRST_RENEWAL_DOWNLOAD', organizationId, out.notifications, actor);
  out.officeVisits = await cursorStep(
    'update_patient_office_visits', organizationId,
    cursor => updateOfficeVisits({ lastUpdateDate: cursor }, rcopiaUserName),
    r => r.visits,
    (r, step) => applyOfficeVisits(organizationId, r.visits, step),
  );
  await auditDownload('DRFIRST_OFFICE_VISIT_DOWNLOAD', organizationId, out.officeVisits, actor, 'appointment');
  return out;
}

/** First start for a single patient's history (meds / prescriptions), before that patient has a cursor. */
const PATIENT_HISTORY_START = '01/01/2000 00:00:00';

/** Cursor name of the practice-wide update_prescription download (Status "all"; see syncOrganization). */
export const PRESCRIPTION_CURSOR = 'update_prescription_all';

/** Per-patient cursor scope (DDM3 / ADM3 / MDM3 / PDM2: LastUpdateDate per patient for patient-level calls). */
export const patientScope = (clientId: string) => `patient:${clientId}`;

/**
 * One patient-filtered download with its OWN cursor (`<command>:patient:<clientId>`), throttled to
 * once per 5 minutes per patient. The first call starts at `firstStart`; afterwards the LastUpdateDate
 * Rcopia returned last time is sent, and saved again only when every row was written.
 */
async function patientStep<R extends { ok: boolean; demo: boolean; status: string; nextCursor?: string; error?: { code: string; text: string } }>(
  command: string,
  clientId: string,
  firstStart: string,
  fetcher: (cursor: string) => Promise<R>,
  rows: (r: R) => unknown[],
  apply: (r: R, step: StepResult) => Promise<void>,
): Promise<StepResult> {
  const scope = patientScope(clientId);
  const claim = await claimPoll(pollKey(command, scope), UPDATE_POLL_MIN_MS);
  if (!claim.claimed) return { ...emptyStep(false), throttled: true };
  const stored = await prisma.drFirstSyncCursor.findUnique({ where: { commandName: cursorKey(command, scope) } });
  const res = await fetcher(stored?.lastUpdateDate || firstStart);
  const step = emptyStep(res.demo);
  if (res.demo) return step;
  if (!res.ok) {
    step.ok = false;
    step.error = res.error?.code || res.status;
    return step;
  }
  step.downloaded = rows(res).length;
  await apply(res, step);
  if (res.nextCursor && step.failed === 0) {
    await saveCursor(command, scope, res.nextCursor);
    step.cursorAdvanced = true;
  }
  return step;
}

/**
 * One patient's medications, prescriptions, allergies and problems, pulled with a patient filter
 * and per-patient cursors. Never touches the org cursors, so a prescriber's sync never makes the
 * practice-wide sync miss rows for other patients.
 */
export async function syncPatient(
  organizationId: string,
  client: { id: string; rcopiaPatientId: string | null },
  rcopiaUserName: string,
): Promise<{ medications: StepResult; prescriptions: StepResult; allergies: StepResult; problems: StepResult }> {
  const patient = client.rcopiaPatientId && client.rcopiaPatientId !== client.id
    ? { rcopiaId: client.rcopiaPatientId }
    : { externalId: client.id };
  // Allergies and problems: Rcopia answers about two years per request, so the first call asks for two years
  const recent = formatRcopiaCursor(new Date(Date.now() - 729 * 24 * 3600 * 1000));

  const medications = await patientStep('update_medication', client.id, PATIENT_HISTORY_START,
    cursor => updateMedications({ patient, lastUpdateDate: cursor }, rcopiaUserName),
    r => r.medications,
    (r, step) => applyMedications(organizationId, r.medications, step, client.id));
  const prescriptions = await patientStep('update_prescription', client.id, PATIENT_HISTORY_START,
    cursor => updatePrescriptions({ patient, lastUpdateDate: cursor, status: 'all' }, rcopiaUserName),
    r => r.prescriptions,
    (r, step) => applyPrescriptions(organizationId, r.prescriptions, step, client.id));
  const allergies = await patientStep('update_allergy', client.id, recent,
    cursor => updateAllergies({ patient, lastUpdateDate: cursor }, rcopiaUserName),
    r => r.allergies,
    (r, step) => applyAllergies(organizationId, r.allergies, step));
  const problems = await patientStep('update_problem', client.id, recent,
    cursor => updateProblems({ patient, lastUpdateDate: cursor }, rcopiaUserName),
    r => r.problems,
    (r, step) => applyProblems(organizationId, r.problems, step));
  return { medications, prescriptions, allergies, problems };
}

/**
 * Seconds until syncPatient can call Rcopia again for this patient after every step was throttled:
 * once the most recent of its four update_* calls is 5 minutes old (GM8 / DR2).
 */
export async function patientRetryAfterSeconds(clientId: string): Promise<number> {
  const commands = ['update_medication', 'update_prescription', 'update_allergy', 'update_problem'];
  const rows = await prisma.drFirstPollState.findMany({
    where: { key: { in: commands.map(command => pollKey(command, patientScope(clientId))) } },
    select: { lastCalledAt: true },
  });
  const latest = Math.max(0, ...rows.map(r => r.lastCalledAt.getTime()));
  return Math.max(1, Math.ceil((latest + UPDATE_POLL_MIN_MS - Date.now()) / 1000));
}

/**
 * Cursor + throttle for an on-demand download route (get_review_status, get_pdmp_events):
 * practice-level calls use the org cursor, patient-level calls a per-patient cursor (PMLRSDM1:
 * LastUpdateDate per practice / per patient); the first call starts at the lookback window (practice)
 * or two years back (patient). Each scope is called at most once per 5 minutes (GM8).
 */
export async function downloadWindow(
  command: string,
  organizationId: string,
  clientId?: string,
): Promise<{ throttled: boolean; retryAfterSeconds: number; cursor: string; save: (next: string | undefined) => Promise<boolean> }> {
  const scope = clientId ? patientScope(clientId) : organizationId;
  const claim = await claimPoll(pollKey(command, scope), UPDATE_POLL_MIN_MS);
  if (!claim.claimed) {
    const wait = claim.lastCalledAt ? UPDATE_POLL_MIN_MS - (Date.now() - claim.lastCalledAt.getTime()) : UPDATE_POLL_MIN_MS;
    return { throttled: true, retryAfterSeconds: Math.max(1, Math.ceil(wait / 1000)), cursor: '', save: async () => false };
  }
  const stored = clientId
    ? (await prisma.drFirstSyncCursor.findUnique({ where: { commandName: cursorKey(command, scope) } }))?.lastUpdateDate
    : await getCursor(command, organizationId);
  const cursor = stored || (clientId ? formatRcopiaCursor(new Date(Date.now() - 729 * 24 * 3600 * 1000)) : firstRunCursor());
  return {
    throttled: false,
    retryAfterSeconds: 0,
    cursor,
    save: async (next) => {
      if (!next) return false;
      await saveCursor(command, scope, next);
      return true;
    },
  };
}

/** Sum step results for audit metadata (counts only). */
export function totals(steps: Record<string, StepResult>): Record<string, number> {
  const t = { downloaded: 0, created: 0, updated: 0, skippedNoClient: 0, skippedMissingData: 0, failed: 0 };
  for (const s of Object.values(steps)) {
    t.downloaded += s.downloaded; t.created += s.created; t.updated += s.updated;
    t.skippedNoClient += s.skippedNoClient; t.skippedMissingData += s.skippedMissingData; t.failed += s.failed;
  }
  return t;
}

/** Per-step counts for the audit log (ids and counts only). */
export function stepSummary(steps: Record<string, StepResult>) {
  return Object.fromEntries(
    Object.entries(steps).map(([k, s]) => [
      k,
      { ok: s.ok, downloaded: s.downloaded, created: s.created, updated: s.updated, skipped: s.skippedNoClient + s.skippedMissingData, failed: s.failed, error: s.error },
    ]),
  );
}
