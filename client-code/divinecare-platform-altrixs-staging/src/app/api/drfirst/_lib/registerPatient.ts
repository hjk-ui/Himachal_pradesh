import 'server-only';
import { prisma } from '@/lib/db/prisma';
import { assertClientPhiAccess, SensitiveRecordAccessError } from '@/lib/privacy/sensitiveAccess';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { sendPatient } from '@/lib/services/drfirstRcopiaService';
import { buildRcopiaPatient, linkedRcopiaId, RCOPIA_PATIENT_SELECT } from '@/lib/drfirst/patientDemographics';
import { fingerprint } from '@/lib/drfirst/chartMapping';
import { pushChartToRcopia, readSentLedger, writeSentLedger, type ChartPushResult } from './chartPush';
import { drFirstClientWhere, type DrFirstCaller } from './access';

export { registerOnLaunchEnabled } from './registerMode';

export type RegisterResult =
  | {
      ok: true;
      rcopiaPatientId: string;
      /** send_patient was called (new patient or changed demographics); false = unchanged since the last confirmed send */
      patientSent: boolean;
      chart: ChartPushResult | { error: string };
    }
  | { ok: false; reason: string; code?: string; missing?: { field: string; label: string }[]; demo?: boolean };

/** The practice's primary location address (fallback for a client with no fixed address and no clinic). */
async function practiceAddress(organizationId: string) {
  return prisma.location.findFirst({
    where: { organizationId, active: true },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    select: { city: true, state: true, postalCode: true },
  });
}

/**
 * Upload one chart to Rcopia. Demographics always come from the chart (legal name, recorded sex,
 * DOB, address, typed phones), never from a request body, and are never invented: an incomplete chart
 * is refused with the list of what is missing (PDUM1). send_patient is called only when the patient
 * is new to Rcopia or its demographics changed since Rcopia last confirmed them (PDUM5); problems,
 * allergies and medications then follow with their own new / changed / removed rules (chartPush).
 * Scope: the caller's caseload (drFirstClientWhere; verified Medical Director org-wide) and the
 * 42 CFR Part 2 / sensitive-record lock (assertClientPhiAccess) — never any client of the org.
 */
export async function uploadPatientToRcopia(caller: DrFirstCaller, clientId: string, trigger: string): Promise<RegisterResult> {
  const client = await prisma.client.findFirst({
    where: drFirstClientWhere(caller, clientId),
    select: { ...RCOPIA_PATIENT_SELECT, primaryDiagnosisCode: true, primaryDiagnosis: true, secondaryDiagnoses: true },
  });
  if (!client) return { ok: false, reason: 'Patient not found', code: 'NOT_FOUND' };
  try {
    await assertClientPhiAccess({
      organizationId: caller.organizationId, userId: caller.userId, role: caller.role, clientId: client.id, path: `drfirst-upload:${trigger}`,
    });
  } catch (err) {
    if (err instanceof SensitiveRecordAccessError) {
      return { ok: false, reason: 'Protected record: break-the-glass access is required', code: 'SENSITIVE_RECORD' };
    }
    throw err;
  }

  const built = buildRcopiaPatient(client, new Date(), await practiceAddress(caller.organizationId));
  if (built.ok === false) {
    return { ok: false, code: 'DEMOGRAPHICS_INCOMPLETE', reason: built.reason, missing: built.missing.map((g) => ({ field: g.field, label: g.label })) };
  }

  const ledger = await readSentLedger(caller.organizationId, client.id);
  const demographics = fingerprint(built.patient);
  const registered = Boolean(client.rcopiaPatientId);
  let rcopiaId = linkedRcopiaId(client) || undefined;
  let patientSent = false;

  if (!registered || ledger.patient !== demographics) {
    const result = await sendPatient(built.patient, caller.rcopiaUsername || undefined);
    patientSent = true;
    await writeAuditLog({
      action: 'DRFIRST_SEND_PATIENT',
      actorUserId: caller.userId,
      actorRole: caller.role,
      organizationId: caller.organizationId,
      resourceType: 'patient',
      resourceId: client.id,
      patientId: client.id,
      outcome: result.ok ? 'SUCCESS' : 'FAILURE',
      ipAddress: caller.ipAddress,
      userAgent: caller.userAgent,
      metadata: { trigger, demo: result.demo, itemStatus: result.itemStatus ?? null, rcopiaIdReturned: Boolean(result.patientRcopiaId), errorCode: result.error?.code ?? null },
    });
    if (result.demo) return { ok: false, demo: true, reason: 'DrFirst is not configured; the patient was not registered.' };
    if (!result.ok) return { ok: false, code: result.error?.code || 'RCOPIA_ERROR', reason: result.error?.text || 'DrFirst did not accept the patient' };

    rcopiaId = result.patientRcopiaId || rcopiaId;
    // Registered under our client id as external id; keep Rcopia's own id when it sends one
    if (!linkedRcopiaId(client)) {
      await prisma.client.update({ where: { id: client.id }, data: { rcopiaPatientId: result.patientRcopiaId || client.id } });
    }
    await writeSentLedger(caller.organizationId, client.id, { ...(await readSentLedger(caller.organizationId, client.id)), patient: demographics });
  }

  let chart: ChartPushResult | { error: string };
  try {
    chart = await pushChartToRcopia(caller, client, rcopiaId ? { rcopiaId } : { externalId: client.id });
  } catch (err: unknown) {
    console.error('[drfirst-upload] chart push error:', err instanceof Error ? err.name : 'unknown');
    chart = { error: 'Problems, allergies and medications could not be sent to DrFirst' };
  }
  return { ok: true, rcopiaPatientId: rcopiaId || client.id, patientSent, chart };
}

/** Same as uploadPatientToRcopia(caller, clientId, 'eprescribe-launch'). */
export function registerClientFromChart(caller: DrFirstCaller, clientId: string): Promise<RegisterResult> {
  return uploadPatientToRcopia(caller, clientId, 'eprescribe-launch');
}
