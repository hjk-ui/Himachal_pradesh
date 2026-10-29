/**
 * Is a consent on file? Pure (no I/O): signed, not revoked / expired / superseded / voided, matching
 * a consent-library key or (legacy rows) the consent type text. Same rule as the Visit Guide's
 * consent checks (src/lib/visits/loader.ts consentOnFile); used where 'server-only' modules cannot be
 * imported (note service details).
 */
import { LEGACY_TYPE_TO_KEY, templateKeyOf } from '@/lib/consents/library/catalog';

export type ConsentRowForCheck = {
  type: string;
  formKey: string | null;
  status: string;
  formStatus: string | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
};

export function consentOnFile(rows: ConsentRowForCheck[], key: string, typeRe: RegExp, now: Date): boolean {
  return rows.some((r) => {
    const signed = r.status === 'SIGNED' || ['CLIENT_SIGNED', 'COMPLETE', 'SUBMITTED'].includes(String(r.formStatus ?? ''));
    if (!signed || r.revokedAt || ['SUPERSEDED', 'VOIDED'].includes(String(r.formStatus ?? ''))) return false;
    if (r.expiresAt && r.expiresAt.getTime() < now.getTime()) return false;
    const k = templateKeyOf(r.formKey) ?? (r.formKey ? null : LEGACY_TYPE_TO_KEY[r.type] ?? null);
    return k === key || typeRe.test(r.type);
  });
}
