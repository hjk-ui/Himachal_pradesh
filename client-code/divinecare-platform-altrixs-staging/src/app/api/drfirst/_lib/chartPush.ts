import 'server-only';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { allergyNeedsCode } from '@/lib/drugs/types';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { sendProblem, sendAllergy, sendNoKnownAllergies, sendMedication } from '@/lib/services/drfirstCommands';
import {
  allergyPlan,
  chartMedicationToRcopia,
  diagnosisProblems,
  fingerprint,
  MEDICATION_EXTERNAL_PREFIX,
  pendingMedicationSends,
  pendingSends,
  problemExternalId,
  readLedger,
  type SentLedger,
} from '@/lib/drfirst/chartMapping';
import type { DrFirstCaller } from './access';
import { loadDiagnosisListsFor } from '@/lib/diagnoses/store';
import { currentInOrder, type DiagnosisRow } from '@/lib/diagnoses/model';
import { isPart2Classification } from '@/lib/fhir/mapping/privacy';
import { isPart2SudCode } from '@/lib/diagnoses/model';
import { applyPart2ProblemRule, part2ConsentCoversDrFirst, part2WithholdAuditMetadata, PART2_WITHHELD_REASON } from '@/lib/drfirst/part2Problems';

/**
 * After send_patient: push the client's ICD-10 diagnoses (send_problem), charted allergies
 * (send_allergy: drug allergies with their RxNorm code (AUM2 / AUR1) when coded, free text otherwise;
 * or NKA when the chart explicitly says so) and local medications (send_medication: RxNorm code, NDCs,
 * name, form and strength when coded (MUM2 / MUM4 / MUR1); free text otherwise) to Rcopia. What was sent is kept per client in ClinicModuleState
 * `drfirst:sent:<clientId>`: only new or changed items are sent (UM1 / DURM4 / AUM5 / MUM7), and an
 * item sent before that the chart no longer has is deleted in Rcopia (Deleted=y with the same
 * ExternalID), so Rcopia matches the chart before launch (DURM3 / AUM4 / MUM6). A failed item never
 * fails the patient sync; results carry codes / ids / counts only.
 */

export interface ItemResult {
  kind: 'problem' | 'allergy' | 'nka' | 'medication';
  ref: string;
  ok: boolean;
  /** Deleted in Rcopia because the chart no longer has it */
  deleted?: boolean;
  error?: string;
  /** DrFirst demo mode: nothing was sent */
  demo?: boolean;
}

export interface ChartPushResult {
  problemsSent: number;
  allergiesSent: number;
  medicationsSent: number;
  /** Problems / allergies / medications deleted in Rcopia because they left the chart */
  removedSent: number;
  nkaSent: boolean;
  unchanged: number;
  failed: number;
  allergyMode: 'list' | 'nka' | 'none';
  /** Diagnosis entries not sent because they are not ICD-10-CM codes. */
  skippedNonIcd10: string[];
  /**
   * Unresolved problem-list entries with no ICD-10 code ("needs coding", e.g. intake history).
   * send_problem only sends coded diagnoses, so these are reported here, never sent or failed.
   */
  problemsNeedingCode: number;
  /** Local medications sent free-text because they have no RxNorm / NDC code with name, form and strength */
  medicationsUncoded: number;
  /** Active drug (or unclassified) allergies sent free-text because they have no RxNorm code (AUM2) */
  allergiesUncoded: number;
  /**
   * 42 CFR Part 2: SUD diagnoses withheld from DrFirst (Part 2 client, no covering Part 2 consent).
   * Count only; a withheld code sent before is deleted in Rcopia and counted in removedSent.
   */
  part2Withheld: number;
  part2WithheldReason: typeof PART2_WITHHELD_REASON | null;
  items: ItemResult[];
}

/**
 * Part 2 status for the DrFirst problem push: Part 2 client (SensitiveRecord classified Part 2 /
 * SUD, or any Part 2 progress note) and whether a Part 2 consent on file covers DrFirst
 * (src/lib/drfirst/part2Problems.ts). Consents are only read for a Part 2 client.
 */
export async function drFirstPart2Status(organizationId: string, clientId: string, now = new Date()): Promise<{ part2Client: boolean; consentCovers: boolean }> {
  const [rec, note] = await Promise.all([
    prisma.sensitiveRecord.findFirst({ where: { organizationId, clientId }, select: { noteClassification: true } }),
    prisma.progressNote.findFirst({ where: { clientId, part2: true, client: { organizationId } }, select: { id: true } }),
  ]);
  const part2Client = isPart2Classification(rec?.noteClassification) || Boolean(note);
  if (!part2Client) return { part2Client, consentCovers: false };
  const rows = await prisma.consentForm.findMany({
    where: { organizationId, clientId, revokedAt: null },
    select: { type: true, formKey: true, status: true, formStatus: true, expiresAt: true, revokedAt: true, recipientName: true, formData: true },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  return { part2Client, consentCovers: part2ConsentCoversDrFirst(rows, now) };
}

export const ledgerModule = (clientId: string) => `drfirst:sent:${clientId}`;

export async function readSentLedger(organizationId: string, clientId: string): Promise<SentLedger> {
  const row = await prisma.clinicModuleState.findUnique({
    where: { organizationId_module: { organizationId, module: ledgerModule(clientId) } },
  });
  return readLedger(row?.data);
}

export async function writeSentLedger(organizationId: string, clientId: string, ledger: SentLedger): Promise<void> {
  const data = ledger as unknown as Prisma.InputJsonValue;
  await prisma.clinicModuleState.upsert({
    where: { organizationId_module: { organizationId, module: ledgerModule(clientId) } },
    create: { organizationId, module: ledgerModule(clientId), data },
    update: { data },
  });
}

export const MEDICATION_SELECT = {
  id: true, medicationName: true, dosage: true, route: true, frequency: true, instructions: true, indication: true,
  startDate: true, endDate: true, stopDate: true, stopReason: true, active: true, status: true, source: true,
  rcopiaMedId: true, drugName: true, brandName: true, genericName: true, ndcCode: true, rxnormId: true,
  action: true, dose: true, doseUnit: true, quantity: true, refills: true, asNeeded: true, prnReason: true,
  schedule: true, updatedAt: true,
  rxnormTty: true, doseForm: true, strength: true, ndcCodes: true, drugCodedAt: true,
} as const;

export const ALLERGY_SELECT = {
  id: true, allergen: true, reaction: true, severity: true, status: true, source: true,
  allergenType: true, rxnormId: true, rxnormTty: true, ndcCodes: true,
} as const;

export async function pushChartToRcopia(
  caller: DrFirstCaller,
  client: { id: string; primaryDiagnosisCode: string | null; primaryDiagnosis: string | null; secondaryDiagnoses: string | null },
  patient: { rcopiaId?: string; externalId?: string },
): Promise<ChartPushResult> {
  const rcopiaUser = caller.rcopiaUsername || undefined;
  // Problems = the current diagnosis list (Client fields are its derived copy, rank order); the
  // list supplies descriptions for secondary codes. Resolved / ruled-out rows leave the list, so
  // the existing ledger sends them to Rcopia as removed.
  const list: DiagnosisRow[] = (await loadDiagnosisListsFor(caller.organizationId, [client.id]).catch(() => new Map<string, DiagnosisRow[]>())).get(client.id) ?? [];
  const descriptions = new Map<string, string>(
    currentInOrder(list).filter((r) => r.code).map((r) => [String(r.code).toUpperCase(), r.description] as [string, string])
  );
  const { problems: allProblems, rejected } = diagnosisProblems(client, descriptions);
  // 42 CFR Part 2: withheld SUD codes leave the push list, so a code sent before goes as removed
  // Status unknown (lookup failed): send no NEW SUD codes, but never remove ones already in Rcopia on a
  // transient error (prescribers rely on them); the next successful sync makes the real decision
  let part2Unknown = false;
  const part2Status = await drFirstPart2Status(caller.organizationId, client.id).catch(() => {
    part2Unknown = true;
    return { part2Client: true, consentCovers: false };
  });
  const part2 = applyPart2ProblemRule(allProblems, part2Status);
  const problems = part2.send;
  const allergyRows = await prisma.medicalAllergy.findMany({
    where: { clientId: client.id },
    select: ALLERGY_SELECT,
  });
  const plan = allergyPlan(allergyRows);
  const problemsNeedingCode = await prisma.medicalProblem.count({
    where: { clientId: client.id, OR: [{ icd10Code: null }, { icd10Code: '' }], NOT: { status: 'Resolved' } },
  });
  // Local chart medications only: rows downloaded from Rcopia (rcopiaMedId) are never echoed back
  const medRows = await prisma.clientMedication.findMany({
    where: { clientId: client.id, rcopiaMedId: null },
    select: MEDICATION_SELECT,
  });
  const meds = medRows
    .filter(m => (m.drugName || m.medicationName || '').trim())
    .map(m => ({ id: m.id, med: chartMedicationToRcopia(m) }));

  const ledger: SentLedger = await readSentLedger(caller.organizationId, client.id);
  const todo = pendingSends(ledger, problems, plan);
  if (part2Unknown) todo.removedProblems = todo.removedProblems.filter((code) => !isPart2SudCode(code));
  const medTodo = pendingMedicationSends(ledger, meds);
  const now = new Date().toISOString();
  const items: ItemResult[] = [];
  const done = (kind: ItemResult['kind'], ref: string, res: { ok: boolean; demo: boolean; status: string; error?: { code: string } }, deleted = false) => {
    items.push({ kind, ref, ok: res.ok, ...(deleted ? { deleted: true } : {}), ...(res.demo ? { demo: true } : {}), ...(res.ok ? {} : { error: res.error?.code || res.status }) });
    return res.ok && !res.demo;
  };

  for (const p of todo.problems) {
    const res = await sendProblem(patient, p.code, p.description, rcopiaUser, { externalId: problemExternalId(client.id, p.code) });
    if (done('problem', p.code, res)) {
      ledger.problems[p.code] = now;
      ledger.problemFingerprints = { ...(ledger.problemFingerprints || {}), [p.code]: fingerprint(p) };
    }
  }
  for (const code of todo.removedProblems) {
    const res = await sendProblem(patient, code, code, rcopiaUser, { externalId: problemExternalId(client.id, code), deleted: true });
    if (done('problem', code, res, true)) {
      delete ledger.problems[code];
      if (ledger.problemFingerprints) delete ledger.problemFingerprints[code];
    }
  }
  for (const a of todo.allergies) {
    const res = await sendAllergy(patient, a, rcopiaUser);
    if (done('allergy', a.externalId, res)) {
      ledger.allergies[a.externalId] = fingerprint(a);
      ledger.allergyNames = { ...(ledger.allergyNames || {}), [a.externalId]: a.name };
    }
  }
  for (const id of todo.removedAllergies) {
    const name = allergyRows.find(r => r.id === id)?.allergen?.trim() || ledger.allergyNames?.[id];
    if (!name) continue; // sent by an older ledger without the name: left for staff to remove in Rcopia
    const res = await sendAllergy(patient, { externalId: id, name, deleted: true }, rcopiaUser);
    if (done('allergy', id, res, true)) {
      delete ledger.allergies[id];
      if (ledger.allergyNames) delete ledger.allergyNames[id];
    }
  }
  if (todo.nka) {
    const res = await sendNoKnownAllergies(patient, rcopiaUser);
    if (done('nka', 'NKDA', res)) ledger.nka = now;
  }
  for (const m of medTodo.send) {
    const res = await sendMedication(patient, { ...m.med, ...(rcopiaUser ? { providerUsername: rcopiaUser } : {}) }, rcopiaUser);
    if (done('medication', m.id, res)) {
      ledger.medications = { ...(ledger.medications || {}), [m.id]: m.fingerprint };
      ledger.medicationNames = { ...(ledger.medicationNames || {}), [m.id]: m.med.genericName || m.med.brandName || '' };
    }
  }
  for (const id of medTodo.removed) {
    const name = ledger.medicationNames?.[id];
    if (!name) continue;
    const res = await sendMedication(patient, { externalId: `${MEDICATION_EXTERNAL_PREFIX}${id}`, genericName: name, deleted: true }, rcopiaUser);
    if (done('medication', id, res, true)) {
      if (ledger.medications) delete ledger.medications[id];
      if (ledger.medicationNames) delete ledger.medicationNames[id];
    }
  }

  if (items.some(i => i.ok && !i.demo)) await writeSentLedger(caller.organizationId, client.id, ledger);

  const sent = (kind: ItemResult['kind']) => items.filter(i => i.kind === kind && i.ok && !i.demo && !i.deleted).length;
  const result: ChartPushResult = {
    // Demo-mode answers were not sent to DrFirst: never counted as sent
    problemsSent: sent('problem'),
    allergiesSent: sent('allergy'),
    medicationsSent: sent('medication'),
    removedSent: items.filter(i => i.deleted && i.ok && !i.demo).length,
    nkaSent: items.some(i => i.kind === 'nka' && i.ok && !i.demo),
    unchanged: todo.unchanged + medTodo.unchanged,
    failed: items.filter(i => !i.ok).length,
    allergyMode: plan.mode,
    skippedNonIcd10: rejected,
    problemsNeedingCode,
    medicationsUncoded: meds.filter(m => !m.med.rxnormId && !m.med.ndcId).length,
    allergiesUncoded: allergyRows.filter(a => allergyNeedsCode(a)).length,
    part2Withheld: part2.withheld.length,
    part2WithheldReason: part2.reason,
    items,
  };

  const audit = (action: string, kinds: ItemResult['kind'][], extra: Record<string, unknown>) => {
    const mine = items.filter(i => kinds.includes(i.kind));
    if (!mine.length) return Promise.resolve();
    return writeAuditLog({
      action,
      actorUserId: caller.userId,
      actorRole: caller.role,
      organizationId: caller.organizationId,
      resourceType: 'patient',
      resourceId: client.id,
      patientId: client.id,
      outcome: mine.every(i => i.ok) ? 'SUCCESS' : 'FAILURE',
      ipAddress: caller.ipAddress,
      userAgent: caller.userAgent,
      metadata: {
        sent: mine.filter(i => i.ok && !i.deleted).length,
        deleted: mine.filter(i => i.ok && i.deleted).length,
        failed: mine.filter(i => !i.ok).length,
        errorCodes: [...new Set(mine.map(i => i.error).filter(Boolean))],
        ...extra,
      },
    });
  };
  // Diagnosis codes and drug names stay out of the audit row (counts / ids only)
  await audit('DRFIRST_SEND_PROBLEM', ['problem'], { skippedNonIcd10: rejected.length, problemsNeedingCode, part2Withheld: part2.withheld.length });
  if (part2.withheld.length) {
    // The withholding decision itself (counts + reason; no codes or diagnosis text)
    const withheldCodes = new Set(part2.withheld.map(p => p.code));
    await writeAuditLog({
      action: 'DRFIRST_PART2_WITHHELD',
      actorUserId: caller.userId,
      actorRole: caller.role,
      organizationId: caller.organizationId,
      resourceType: 'patient',
      resourceId: client.id,
      patientId: client.id,
      outcome: 'SUCCESS',
      ipAddress: caller.ipAddress,
      userAgent: caller.userAgent,
      metadata: part2WithholdAuditMetadata({
        withheld: part2.withheld.length,
        removedFromDrFirst: items.filter(i => i.kind === 'problem' && i.deleted && i.ok && !i.demo && withheldCodes.has(i.ref)).length,
        sent: result.problemsSent,
      }),
    }).catch(() => {});
  }
  await audit('DRFIRST_SEND_ALLERGY', ['allergy', 'nka'], { allergyIds: items.filter(i => i.kind === 'allergy').map(i => i.ref), nka: todo.nka, uncoded: result.allergiesUncoded });
  await audit('DRFIRST_SEND_MEDICATION', ['medication'], { medicationIds: items.filter(i => i.kind === 'medication').map(i => i.ref), uncoded: result.medicationsUncoded });

  return result;
}
