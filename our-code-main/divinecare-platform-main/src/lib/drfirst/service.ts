import 'server-only';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import { canPrescribe } from '@/types/roles';
import { assertDrFirstPrescriber, assertDrFirstSelf, type DrFirstContext } from './access';
import { getDrFirstConfig } from './config';
import { createDrFirstProvider } from './factory';
import { createDrFirstExchangeAuditSink } from './exchange-audit';
import { StagingDrFirstProvider } from './staging-provider';
import { DrFirstError, safeDrFirstError } from './errors';
import { mapPatient, mapPrescriber } from './mapping';
import { publicDrFirstStatus } from './settings';
import type { DrFirstEnvironment, IntegrationResult, MockFailure } from './types';
import { MOCK_LAUNCH_PATH, validateIntegrationResult, validateLaunchResult } from './validation';
import {
  assertRegisterAllowed,
  demographicsIncompleteMessage,
  missingDemographicsLabels,
  uploadFailedMessage,
} from './register-on-launch';
import { loadDrFirstDiagnoses } from './part2-withhold';
import { recordSsoLaunch } from './sync';
import { recordIntegrationCall } from '@/lib/integrations/callLog';

function providerFor(config: ReturnType<typeof getDrFirstConfig>, context: DrFirstContext) {
  if (config.environment !== 'staging') return createDrFirstProvider(config);
  const auditSink = createDrFirstExchangeAuditSink(context, config.auditEncryptionKey, config.auditRetentionDays);
  return createDrFirstProvider(config, () => new StagingDrFirstProvider({
    stagingConfigured: config.stagingConfigured,
    engineUrl: config.engineUrl,
    ssoUrl: config.ssoUrl,
    vendorUsername: config.vendorUsername,
    vendorPassword: config.vendorPassword,
    practiceUsername: config.practiceUsername,
    practiceName: config.practiceName,
    systemName: config.systemName,
    prescriberMap: config.prescriberMap,
    patientMap: config.patientMap,
  }, auditSink));
}

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
async function save(organizationId: string, module: string, data: Prisma.InputJsonValue) {
  await prisma.clinicModuleState.upsert({ where: { organizationId_module: { organizationId, module } }, create: { organizationId, module, data }, update: { data } });
}
type AuditDetails = { operationId: string; environment: DrFirstEnvironment; patientRef?: string; prescriberRef: string };
async function audit(context: DrFirstContext, action: string, outcome: string, details: AuditDetails, code?: string) {
  // One row per event avoids concurrent lost updates. References are hashes, not demographics.
  await prisma.clinicModuleState.create({ data: { organizationId: context.organizationId,
    module: `drfirst:audit:${randomUUID()}`, data: { action, outcome, ...details,
      actorId: context.userId, timestamp: new Date().toISOString(), ...(code ? { code } : {}) } } });
}
async function audited<T>(context: DrFirstContext, action: string, operation: () => Promise<T>, clientId?: string): Promise<T> {
  assertDrFirstPrescriber(context);
  const details: AuditDetails = { operationId: randomUUID(), environment: getDrFirstConfig().environment,
    prescriberRef: digest(`${context.organizationId}:prescriber:${context.userId}`),
    ...(clientId ? { patientRef: digest(`${context.organizationId}:patient:${clientId}`) } : {}) };
  await audit(context, action, 'attempted', details);
  try { const result = await operation(); await audit(context, action, 'succeeded', details); return result; }
  catch (error) { const safe = safeDrFirstError(error); await audit(context, action, 'failed', details, safe.code); throw safe; }
}
async function withMapping<T extends { id: string }>(context: DrFirstContext, kind: string, value: T, environment: DrFirstEnvironment): Promise<T & { externalId?: string }> {
  const row = await prisma.clinicModuleState.findUnique({ where: { organizationId_module: {
    organizationId: context.organizationId, module: `drfirst:mapping:${environment}:${kind}:${digest(value.id)}`,
  } } });
  if (!row) return value;
  const stored = z.object({ externalId: z.string(), environment: z.enum(['mock', 'staging', 'production']) }).safeParse(row.data);
  if (!stored.success) throw new DrFirstError('DRFIRST_EXTERNAL_SERVICE_ERROR', 503);
  const result = validateIntegrationResult({ ...stored.data, mode: environment === 'mock' ? 'MOCK' : 'LIVE' }, environment);
  return { ...value, externalId: result.externalId };
}
async function persistMapping(context: DrFirstContext, kind: string, id: string, result: IntegrationResult) {
  await save(context.organizationId, `drfirst:mapping:${result.environment}:${kind}:${digest(id)}`,
    { externalId: result.externalId, environment: result.environment, lastSyncedAt: new Date().toISOString() });
}
async function patientDto(clientId: string, context: DrFirstContext) {
  const row = await prisma.client.findFirst({ where: { id: clientId, AND: [clientAccessWhere({ organizationId: context.organizationId, actorUserId: context.userId, actorRole: context.role })] },
    select: {
      id: true, name: true, dateOfBirth: true, legalFirstName: true, middleInitial: true, legalLastName: true,
      gender: true, addressLine1: true, city: true, state: true, postalCode: true, phone: true, email: true, mrn: true,
    } });
  if (!row) throw new DrFirstError('DRFIRST_UNAUTHORIZED', 403);
  return mapPatient(row, context.organizationId);
}
async function prescriberDto(userId: string, context: DrFirstContext) {
  assertDrFirstSelf(userId, context);
  const row = await prisma.user.findFirst({ where: { id: userId, organizationId: context.organizationId, status: 'ACTIVE', organization: { active: true } },
    select: { id: true, name: true, email: true, npi: true, role: true, roles: true } });
  // An admin's role-preview session is not a prescribing credential.
  if (!row || ![row.role, ...row.roles].some(canPrescribe)) throw new DrFirstError('DRFIRST_UNAUTHORIZED', 403);
  return mapPrescriber(row, context.organizationId);
}
export async function syncPatientToDrFirst(clientId: string, context: DrFirstContext, opts?: { linkImported?: boolean }) {
  const origin = await prisma.client.findFirst({
    where: { id: clientId, organizationId: context.organizationId },
    select: { sourcePlatform: true, importedAt: true },
  });
  if ((origin?.sourcePlatform || origin?.importedAt) && !opts?.linkImported) {
    throw new DrFirstError('DRFIRST_INVALID_INPUT');
  }
  return audited(context, 'patient-sync', async () => {
    const config = getDrFirstConfig();
    const provider = providerFor(config, context);
    await prescriberDto(context.userId, context);
    const patient = await withMapping(context, 'patient', await patientDto(clientId, context), config.environment);
    const result = validateIntegrationResult(await provider.createOrSyncPatient(patient), config.environment);
    await persistMapping(context, 'patient', clientId, result); return result;
  }, clientId);
}
export async function syncPrescriberToDrFirst(userId: string, context: DrFirstContext) {
  return audited(context, 'prescriber-sync', async () => {
    const config = getDrFirstConfig();
    const provider = providerFor(config, context);
    const prescriber = await withMapping(context, 'prescriber', await prescriberDto(userId, context), config.environment);
    const result = validateIntegrationResult(await provider.createOrSyncPrescriber(prescriber), config.environment);
    await persistMapping(context, 'prescriber', userId, result); return result;
  });
}
export async function checkDrFirstConnection(context: DrFirstContext) {
  if (canPrescribe(context.role)) await prescriberDto(context.userId, context);
  return publicDrFirstStatus(getDrFirstConfig());
}
export async function prepareDrFirstLaunch(input: { clientId: string; prescriberId: string; organizationId: string; failure?: MockFailure }, context: DrFirstContext) {
  assertDrFirstSelf(input.prescriberId, context);
  if (input.organizationId !== context.organizationId) throw new DrFirstError('DRFIRST_UNAUTHORIZED', 403);
  return audited(context, 'launch', async () => {
    const config = getDrFirstConfig();
    if (input.failure && input.failure !== 'none' && !config.allowMockFailures) throw new DrFirstError('DRFIRST_INVALID_INPUT');
    const provider = providerFor({ ...config, mockFailure: input.failure || config.mockFailure }, context);
    const prescriber = await withMapping(context, 'prescriber', await prescriberDto(input.prescriberId, context), config.environment);
    // Caseload / tenant gate before register-on-launch so unauthorized actors never hit registration.
    const authorizedPatient = await withMapping(
      context,
      'patient',
      await patientDto(input.clientId, context),
      config.environment
    );
    const origin = await prisma.client.findFirst({
      where: { id: input.clientId, organizationId: context.organizationId },
      select: {
        sourcePlatform: true,
        importedAt: true,
        rcopiaPatientId: true,
        name: true,
        legalFirstName: true,
        legalLastName: true,
        dateOfBirth: true,
        gender: true,
        addressLine1: true,
        city: true,
        state: true,
        postalCode: true,
      },
    });
    if (!origin) throw new DrFirstError('DRFIRST_UNAUTHORIZED', 403);
    const imported = Boolean(origin.sourcePlatform || origin.importedAt);
    const registerDecision = assertRegisterAllowed(config.registerOnLaunch, origin);
    if (registerDecision === 'register') {
      const missing = missingDemographicsLabels(origin);
      if (missing.length) {
        throw new DrFirstError(
          'DRFIRST_DEMOGRAPHICS_INCOMPLETE',
          409,
          demographicsIncompleteMessage(missing),
          missing
        );
      }
    }
    const patient = {
      ...authorizedPatient,
      ...(imported && origin.rcopiaPatientId ? { externalId: origin.rcopiaPatientId } : {}),
      ...(registerDecision === 'use_existing' && origin.rcopiaPatientId
        ? { externalId: origin.rcopiaPatientId }
        : {}),
    };
    const organization = await prisma.organization.findFirst({ where: { id: context.organizationId, active: true }, select: { id: true, name: true } });
    if (!organization) throw new DrFirstError('DRFIRST_UNAUTHORIZED', 403);
    const patientResult = await audited(context, 'patient-sync', async () => {
      if (registerDecision === 'use_existing' && origin.rcopiaPatientId) {
        const mappedId =
          config.environment === 'mock' && !origin.rcopiaPatientId.startsWith('mock_')
            ? `mock_patient_${origin.rcopiaPatientId}`
            : origin.rcopiaPatientId;
        return validateIntegrationResult(
          {
            externalId: mappedId,
            environment: config.environment,
            mode: config.environment === 'mock' ? 'MOCK' : 'LIVE',
          },
          config.environment
        );
      }
      try {
        const result = validateIntegrationResult(await provider.createOrSyncPatient(patient), config.environment);
        await persistMapping(context, 'patient', patient.id, result);
        if (!imported) await prisma.client.update({ where: { id: patient.id }, data: { rcopiaPatientId: result.externalId } });
        return result;
      } catch (err) {
        if (err instanceof DrFirstError) {
          if (
            err.code === 'DRFIRST_DEMOGRAPHICS_INCOMPLETE' ||
            err.code === 'DRFIRST_EXTERNAL_SERVICE_ERROR' ||
            err.code === 'DRFIRST_NOT_CONFIGURED' ||
            err.code === 'DRFIRST_DISABLED'
          ) {
            throw err;
          }
        }
        const reason = err instanceof DrFirstError ? err.message : 'upload failed';
        throw new DrFirstError('DRFIRST_UPSTREAM_REJECTED', 409, uploadFailedMessage(reason));
      }
    }, patient.id);
    const prescriberResult = await audited(context, 'prescriber-sync', async () => {
      const result = validateIntegrationResult(await provider.createOrSyncPrescriber(prescriber), config.environment);
      await persistMapping(context, 'prescriber', prescriber.id, result); return result;
    });
    const organizationResult = validateIntegrationResult(await provider.createOrSyncOrganization(
      await withMapping(context, 'organization', organization, config.environment)), config.environment);
    await persistMapping(context, 'organization', organization.id, organizationResult);
    const providerSession = await provider.createSsoLaunchSession({ patient: patientResult, prescriber: prescriberResult, organization: organizationResult });
    const session = validateLaunchResult({ ...providerSession, launchUrl: provider.getLaunchUrl(providerSession) }, config.environment);
    const token = randomBytes(32).toString('hex');
    if (session.mode === 'MOCK') {
      await save(context.organizationId, `drfirst:session:${digest(token)}`, { actorId: context.userId, clientId: patient.id,
        session: { ...session }, patientId: patientResult.externalId, prescriberId: prescriberResult.externalId });
    }
    try {
      await recordSsoLaunch(context.organizationId, context.userId, patient.id, null);
    } catch {
      /* launch tracking is advisory — never block a successful SSO */
    }
    await recordIntegrationCall({
      organizationId: context.organizationId,
      integration: 'drfirst',
      operation: 'sso-launch',
      status: 'success',
      userId: context.userId,
      clientId: patient.id,
      metadata: {
        logout_url: session.launchUrl.includes('logout_url') ? '[present]' : session.mode === 'MOCK' ? '[demo-omitted]' : '[check]',
        mac: '[redacted]',
      },
    });
    // SUD diagnoses stay out of DrFirst without a Part 2 consent; tell staff why (no codes in the notice).
    let part2Notice: string | null = null;
    try {
      part2Notice = (await loadDrFirstDiagnoses(context.organizationId, patient.id)).notice;
    } catch {
      /* Part 2 notice is advisory — never block a successful SSO */
    }
    // Never include registerNote on success — open only after full patient sync.
    return {
      session: { ...session, patientSynced: true as const },
      token,
      patientSynced: true as const,
      ...(part2Notice ? { part2Notice } : {}),
    };
  }, input.clientId);
}
export async function readMockLaunch(token: string, context: DrFirstContext) {
  assertDrFirstPrescriber(context);
  const config = getDrFirstConfig();
  if (!config.enabled) throw new DrFirstError('DRFIRST_DISABLED', 503);
  if (config.environment !== 'mock' || !/^[a-f0-9]{64}$/.test(token)) throw new DrFirstError('DRFIRST_UNAUTHORIZED', 403);
  const row = await prisma.clinicModuleState.findUnique({ where: { organizationId_module: { organizationId: context.organizationId, module: `drfirst:session:${digest(token)}` } } });
  const parsed = z.object({ actorId: z.string(), clientId: z.string(), patientId: z.string(), prescriberId: z.string(),
    session: z.object({ externalId: z.string(), environment: z.literal('mock'), mode: z.literal('MOCK'), status: z.literal('SIMULATED'),
      launchUrl: z.literal(MOCK_LAUNCH_PATH), expiresAt: z.string().datetime() }) }).safeParse(row?.data);
  const data = parsed.success ? parsed.data : undefined;
  if (!data || data.actorId !== context.userId) throw new DrFirstError('DRFIRST_UNAUTHORIZED', 403);
  if (Date.parse(data.session.expiresAt) <= Date.now()) throw new DrFirstError('DRFIRST_SESSION_EXPIRED', 410);
  await prescriberDto(context.userId, context);
  await patientDto(data.clientId, context);
  return { ...data.session, patientId: data.patientId, prescriberId: data.prescriberId };
}
