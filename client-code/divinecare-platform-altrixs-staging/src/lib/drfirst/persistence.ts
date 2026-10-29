/**
 * DrFirst database hooks used by the Rcopia service, the sync and the routes:
 *  - API version from drfirst_settings (GM4), cached 5 minutes;
 *  - the call / SSO log drfirst_api_logs (GM6 / GM12 / GM13): payloads only ever stored encrypted,
 *    with credentials and the SSO MAC removed first; purged after DRFIRST_LOG_RETENTION_DAYS (90);
 *  - poll throttles drfirst_poll_state (GM8 / DR2 / PEDM3 / NCDM1).
 * Loaded lazily by drfirstRcopiaService only when DATABASE_URL is set, so unit tests and the
 * standalone capture scripts never need a database.
 */
import { prisma } from '@/lib/db/prisma';
import { encryptField, decryptField } from '@/lib/security/fieldCrypto';
import { recordIntegrationCall } from '@/lib/integrations/callLog/record';

export const DEFAULT_API_VERSION = '2.54';
const VERSION_TTL_MS = 5 * 60_000;
let versionCache: { value: string; at: number } | null = null;

/** Rcopia API version for the envelope: drfirst_settings.api_version, else DRFIRST_API_VERSION, else 2.54. */
export async function loadApiVersion(now = Date.now()): Promise<string> {
  if (versionCache && now - versionCache.at < VERSION_TTL_MS) return versionCache.value;
  let value = process.env.DRFIRST_API_VERSION?.trim() || DEFAULT_API_VERSION;
  try {
    const row = await prisma.drFirstSetting.findUnique({ where: { key: 'api_version' } });
    if (row?.value && /^\d+\.\d+$/.test(row.value.trim())) value = row.value.trim();
  } catch (err) {
    console.error('[drfirst] api_version setting unavailable:', err instanceof Error ? err.name : 'unknown');
  }
  versionCache = { value, at: now };
  return value;
}

export function resetApiVersionCache() {
  versionCache = null;
}

// ─── Call / SSO log ──────────────────────────────────────────────────────────

/** Remove credentials before anything is stored: vendor password / name in the envelope, MAC in SSO URLs. */
export function scrubPayload(payload: string, secrets: string[] = []): string {
  let out = payload
    .replace(/<VendorPassword>[^<]*<\/VendorPassword>/g, '<VendorPassword>[removed]</VendorPassword>')
    .replace(/([?&])MAC=[^&\s"]*/g, '$1MAC=[removed]');
  for (const s of secrets) if (s && s.length >= 4) out = out.split(s).join('[removed]');
  return out;
}

export interface RcopiaCallLog {
  kind: 'api' | 'sso';
  command: string;
  servlet?: string;
  practiceUsername?: string;
  rcopiaUsername?: string;
  organizationId?: string | null;
  actorUserId?: string | null;
  ok: boolean;
  httpStatus?: number;
  status?: string;
  errorCode?: string;
  errorText?: string;
  durationMs?: number;
  /** The payload DrFirst may ask for: response (answered calls), request (connection failures), sso_url */
  payloadKind?: 'response' | 'request' | 'sso_url';
  payload?: string;
  /** Patient the call was about (unified integration log only; never sent anywhere) */
  clientId?: string | null;
}

/** Store one log row. Never throws (a log failure must not fail the clinical call). */
export async function recordRcopiaCall(e: RcopiaCallLog): Promise<void> {
  try {
    const scrubbed = e.payload ? scrubPayload(e.payload, [process.env.DRFIRST_VENDOR_PASSWORD || '']) : null;
    // PHI: encrypted or not stored at all (never plaintext)
    const payloadEncrypted = scrubbed ? encryptField(scrubbed) : null;
    const row = await prisma.drFirstApiLog.create({
      select: { id: true },
      data: {
        kind: e.kind,
        command: e.command.slice(0, 80),
        servlet: e.servlet ?? null,
        practiceUsername: e.practiceUsername ?? null,
        rcopiaUsername: e.rcopiaUsername ?? null,
        organizationId: e.organizationId ?? null,
        actorUserId: e.actorUserId ?? null,
        ok: e.ok,
        httpStatus: e.httpStatus ?? null,
        status: e.status?.slice(0, 40) ?? null,
        errorCode: e.errorCode?.slice(0, 80) ?? null,
        errorText: e.errorText?.slice(0, 500) ?? null,
        durationMs: e.durationMs ?? null,
        payloadKind: payloadEncrypted ? e.payloadKind ?? null : null,
        payloadEncrypted,
      },
    });
    // Unified Admin > Integrations > Logs row (metadata; the payload stays here, encrypted)
    await recordIntegrationCall({
      integration: 'drfirst',
      operation: e.kind === 'sso' && !e.command.startsWith('sso') ? `sso_${e.command}` : e.command,
      direction: 'outbound',
      status: e.ok ? 'success' : 'error',
      organizationId: e.organizationId ?? null,
      actorUserId: e.actorUserId ?? null,
      clientId: e.clientId ?? null,
      httpStatus: e.httpStatus ?? null,
      vendorStatus: e.status ?? null,
      errorCode: e.errorCode ?? null,
      errorMessage: e.errorText ?? null,
      durationMs: e.durationMs ?? null,
      sourceTable: 'drfirst_api_logs',
      sourceId: row.id,
      metadata: { kind: e.kind, servlet: e.servlet, rcopiaUsername: e.rcopiaUsername, payloadKind: payloadEncrypted ? e.payloadKind ?? null : null },
    });
  } catch (err) {
    console.error('[drfirst] call log write failed:', err instanceof Error ? err.name : 'unknown');
  }
}

export function decryptLogPayload(stored: string | null): string | null {
  return decryptField(stored);
}

/** Delete log rows older than the retention period (default 90 days). Returns the count removed. */
export async function purgeRcopiaLogs(now = new Date()): Promise<number> {
  const n = Number.parseInt(process.env.DRFIRST_LOG_RETENTION_DAYS || '', 10);
  const days = Number.isFinite(n) && n > 0 ? n : 90;
  const res = await prisma.drFirstApiLog.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - days * 86_400_000) } } });
  return res.count;
}

// ─── Poll throttle ───────────────────────────────────────────────────────────

export const UPDATE_POLL_MIN_MS = 5 * 60_000;        // GM8 / DR2 / PEDM3
export const NOTIFICATION_COUNT_MIN_MS = 15 * 60_000; // NCDM1

/**
 * Claim the right to call `key` now. Returns claimed=false (with the last stored answer) when the
 * previous call was less than `minMs` ago. The claim is a conditional update, so two processes
 * cannot both claim the same window.
 */
export async function claimPoll(key: string, minMs: number, now = new Date()): Promise<{ claimed: boolean; lastCalledAt: Date | null; payload: unknown }> {
  const cutoff = new Date(now.getTime() - minMs);
  const existing = await prisma.drFirstPollState.findUnique({ where: { key } });
  if (!existing) {
    try {
      await prisma.drFirstPollState.create({ data: { key, lastCalledAt: now } });
      return { claimed: true, lastCalledAt: null, payload: null };
    } catch {
      const row = await prisma.drFirstPollState.findUnique({ where: { key } });
      return { claimed: false, lastCalledAt: row?.lastCalledAt ?? null, payload: row?.payload ?? null };
    }
  }
  if (existing.lastCalledAt > cutoff) return { claimed: false, lastCalledAt: existing.lastCalledAt, payload: existing.payload };
  const won = await prisma.drFirstPollState.updateMany({ where: { key, lastCalledAt: existing.lastCalledAt }, data: { lastCalledAt: now } });
  return won.count === 1
    ? { claimed: true, lastCalledAt: existing.lastCalledAt, payload: existing.payload }
    : { claimed: false, lastCalledAt: existing.lastCalledAt, payload: existing.payload };
}

/** Keep the last answer with the throttle row (served while throttled). */
export async function savePollPayload(key: string, payload: unknown): Promise<void> {
  await prisma.drFirstPollState.update({ where: { key }, data: { payload: payload as never } }).catch(() => {});
}
