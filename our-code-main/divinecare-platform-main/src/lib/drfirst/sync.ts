import { prisma } from '@/lib/db/prisma';
import { loadDrFirstDiagnoses } from '@/lib/drfirst/part2-withhold';
import { UPDATE_POLL_MIN_MS, RETURN_SYNC_THROTTLE_MS, SSO_LAUNCH_LOOKBACK_MS } from '@/lib/drfirst/screens';

const SYNC_MODULE = (clientId: string) => `drfirst:patient-sync:${clientId}`;
const RETURN_MODULE = (userId: string) => `drfirst:return-sync:${userId}`;
const LAUNCH_MODULE = (userId: string) => `drfirst:sso-launch:${userId}`;

export async function recordSsoLaunch(
  organizationId: string,
  userId: string,
  clientId: string,
  screen?: string | null
) {
  await prisma.clinicModuleState.upsert({
    where: {
      organizationId_module: { organizationId, module: LAUNCH_MODULE(userId) },
    },
    create: {
      organizationId,
      module: LAUNCH_MODULE(userId),
      data: {
        clientId,
        screen: screen || null,
        at: new Date().toISOString(),
        action: 'DRFIRST_SSO_LAUNCH',
      },
    },
    update: {
      data: {
        clientId,
        screen: screen || null,
        at: new Date().toISOString(),
        action: 'DRFIRST_SSO_LAUNCH',
      },
    },
  });
}

export async function latestLaunchPatient(
  organizationId: string,
  userId: string
): Promise<string | null> {
  const row = await prisma.clinicModuleState.findUnique({
    where: {
      organizationId_module: { organizationId, module: LAUNCH_MODULE(userId) },
    },
  });
  const data = (row?.data || {}) as { clientId?: string; at?: string };
  if (!data.clientId || !data.at) return null;
  if (Date.now() - Date.parse(data.at) > SSO_LAUNCH_LOOKBACK_MS) return null;
  return data.clientId;
}

export async function checkPatientSyncThrottle(
  organizationId: string,
  clientId: string
): Promise<{ ok: true } | { ok: false; retryAfterSeconds: number }> {
  const row = await prisma.clinicModuleState.findUnique({
    where: {
      organizationId_module: { organizationId, module: SYNC_MODULE(clientId) },
    },
  });
  const at = (row?.data as { at?: string } | null)?.at;
  if (!at) return { ok: true };
  const elapsed = Date.now() - Date.parse(at);
  if (elapsed >= UPDATE_POLL_MIN_MS) return { ok: true };
  return { ok: false, retryAfterSeconds: Math.ceil((UPDATE_POLL_MIN_MS - elapsed) / 1000) };
}

export async function markPatientSynced(organizationId: string, clientId: string, changes: number) {
  await prisma.clinicModuleState.upsert({
    where: {
      organizationId_module: { organizationId, module: SYNC_MODULE(clientId) },
    },
    create: {
      organizationId,
      module: SYNC_MODULE(clientId),
      data: { at: new Date().toISOString(), changes },
    },
    update: { data: { at: new Date().toISOString(), changes } },
  });
}

export async function checkReturnThrottle(
  organizationId: string,
  userId: string
): Promise<{ ok: true } | { ok: false; retryAfterSeconds: number }> {
  const row = await prisma.clinicModuleState.findUnique({
    where: {
      organizationId_module: { organizationId, module: RETURN_MODULE(userId) },
    },
  });
  const at = (row?.data as { at?: string } | null)?.at;
  if (!at) return { ok: true };
  const elapsed = Date.now() - Date.parse(at);
  if (elapsed >= RETURN_SYNC_THROTTLE_MS) return { ok: true };
  return { ok: false, retryAfterSeconds: Math.ceil((RETURN_SYNC_THROTTLE_MS - elapsed) / 1000) };
}

export async function markReturnSynced(organizationId: string, userId: string) {
  await prisma.clinicModuleState.upsert({
    where: {
      organizationId_module: { organizationId, module: RETURN_MODULE(userId) },
    },
    create: {
      organizationId,
      module: RETURN_MODULE(userId),
      data: { at: new Date().toISOString() },
    },
    update: { data: { at: new Date().toISOString() } },
  });
}

/** Soft sync stub — records sync stamp; live Rcopia download hooks elsewhere. */
export async function syncPatientFromDrFirst(
  organizationId: string,
  clientId: string
): Promise<{ changes: number; notice?: string }> {
  // SUD diagnoses are withheld without a Part 2 consent; tell staff instead of failing the sync.
  const { notice } = await loadDrFirstDiagnoses(organizationId, clientId);
  await markPatientSynced(organizationId, clientId, 0);
  return { changes: 0, ...(notice ? { notice } : {}) };
}
