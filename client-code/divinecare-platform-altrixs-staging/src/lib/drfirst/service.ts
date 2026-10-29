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
import { DrFirstError, safeDrFirstError } from './errors';
import { mapPatient, mapPrescriber } from './mapping';
import { publicDrFirstStatus } from './settings';
import type { DrFirstEnvironment, IntegrationResult, MockFailure } from './types';
import { MOCK_LAUNCH_PATH, validateIntegrationResult, validateLaunchResult } from './validation';

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
    select: { id: true, name: true, dateOfBirth: true } });
  if (!row) throw new DrFirstError('DRFIRST_UNAUTHORIZED', 403);
  return mapPatient(row, context.organizationId);
}
async function prescriberDto(userId: string, context: DrFirstContext) {
  assertDrFirstSelf(userId, context);
  const row = await prisma.user.findFirst({ where: { id: userId, organizationId: context.organizationId, status: 'ACTIVE', organization: { active: true } },
    select: { id: true, name: true, npi: true, role: true, roles: true } });
  // An admin's role-preview session is not a prescribing credential.
  if (!row || ![row.role, ...row.roles].some(canPrescribe)) throw new DrFirstError('DRFIRST_UNAUTHORIZED', 403);
  return mapPrescriber(row, context.organizationId);
}
export async function syncPatientToDrFirst(clientId: string, context: DrFirstContext) {
  return audited(context, 'patient-sync', async () => {
    const config = getDrFirstConfig();
    const provider = createDrFirstProvider(config);
    await prescriberDto(context.userId, context);
    const patient = await withMapping(context, 'patient', await patientDto(clientId, context), config.environment);
    const result = validateIntegrationResult(await provider.createOrSyncPatient(patient), config.environment);
    await persistMapping(context, 'patient', clientId, result); return result;
  }, clientId);
}
export async function syncPrescriberToDrFirst(userId: string, context: DrFirstContext) {
  return audited(context, 'prescriber-sync', async () => {
    const config = getDrFirstConfig();
    const provider = createDrFirstProvider(config);
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
    const provider = createDrFirstProvider({ ...config, mockFailure: input.failure || config.mockFailure });
    const prescriber = await withMapping(context, 'prescriber', await prescriberDto(input.prescriberId, context), config.environment);
    const patient = await withMapping(context, 'patient', await patientDto(input.clientId, context), config.environment);
    const organization = await prisma.organization.findFirst({ where: { id: context.organizationId, active: true }, select: { id: true, name: true } });
    if (!organization) throw new DrFirstError('DRFIRST_UNAUTHORIZED', 403);
    const patientResult = await audited(context, 'patient-sync', async () => {
      const result = validateIntegrationResult(await provider.createOrSyncPatient(patient), config.environment);
      await persistMapping(context, 'patient', patient.id, result); return result;
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
    return { session, token };
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
