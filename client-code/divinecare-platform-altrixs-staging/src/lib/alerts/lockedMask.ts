/**
 * Risk alert feeds (GET /api/risk-alerts, legacy GET /api/alerts): alerts of 42 CFR Part 2 / VIP
 * clients the viewer may not open keep their severity / type / review state (safety triage still
 * works) but the description and review note are blanked and the client name is replaced by the
 * record's alias (or "Protected record"), like the inbox (src/lib/inbox/core.ts applyPart2).
 * Lookup failure fails closed (every alert masked).
 */
import type { Role } from '@prisma/client';
import type { AlertDto } from '@/lib/alerts/manage';
import { resolveSensitiveAccessMap } from '@/lib/privacy/sensitiveAccess';
import { PROTECTED_RECORD_LABEL } from '@/lib/privacy/lockedRows';

export type MaskedAlertDto = AlertDto & { protected?: boolean };

/** Pure: mask alerts whose client is locked. `locked` null = lookup failed = mask all. */
export function maskLockedAlerts(
  alerts: AlertDto[],
  locked: Map<string, { alias: string | null }> | null,
): MaskedAlertDto[] {
  return alerts.map((a) => {
    const lock = locked === null ? { alias: null } : locked.get(a.clientId);
    if (!lock) return a;
    return { ...a, clientName: lock.alias?.trim() || PROTECTED_RECORD_LABEL, description: '', reviewNote: null, protected: true };
  });
}

export async function maskAlertsForViewer(
  actor: { organizationId: string; userId: string; role: Role | string },
  alerts: AlertDto[],
): Promise<MaskedAlertDto[]> {
  if (!alerts.length) return alerts;
  let locked: Map<string, { alias: string | null }> | null;
  try {
    const map = await resolveSensitiveAccessMap({
      organizationId: actor.organizationId,
      userId: actor.userId,
      role: actor.role,
      clientIds: [...new Set(alerts.map((a) => a.clientId))],
    });
    locked = new Map([...map].filter(([, v]) => !v.canAccessSensitive).map(([id, v]) => [id, { alias: v.alias }]));
  } catch (err) {
    console.error('[alerts] sensitive lookup failed', err instanceof Error ? err.name : 'error');
    locked = null;
  }
  return maskLockedAlerts(alerts, locked);
}
