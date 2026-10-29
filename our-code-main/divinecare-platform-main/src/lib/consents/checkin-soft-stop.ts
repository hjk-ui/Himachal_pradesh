import { prisma } from '@/lib/db/prisma';

/** Soft-stop consent types at appointment check-in (Oct 21 staging) */
export const CHECKIN_REQUIRED_CONSENT = 'informed-consent-treatment';
export const CHECKIN_TELEHEALTH_CONSENT = 'telehealth-consent';

export const CONSENT_REQUIRED_CODE = 'CONSENT_REQUIRED';
export const CONSENT_CHECKIN_OVERRIDE_CODE = 'CONSENT_CHECKIN_OVERRIDE';

const TYPE_ALIASES: Record<string, string[]> = {
  [CHECKIN_REQUIRED_CONSENT]: [
    'informed-consent-treatment',
    'informed_consent_treatment',
    'Informed Consent for Treatment',
    'informed consent',
  ],
  [CHECKIN_TELEHEALTH_CONSENT]: [
    'telehealth-consent',
    'telehealth_consent',
    'Telehealth Consent',
    'telehealth',
  ],
};

function matchesType(stored: string, wanted: string): boolean {
  const aliases = TYPE_ALIASES[wanted] || [wanted];
  const lower = stored.trim().toLowerCase();
  return aliases.some((a) => a.toLowerCase() === lower);
}

export type ConsentSoftStopResult =
  | { ok: true; overridden?: boolean; auditCode?: string }
  | {
      ok: false;
      code: typeof CONSENT_REQUIRED_CODE;
      missing: string[];
      error: string;
    };

/**
 * Soft stop only — front desk can override with ≥10 character reason (audited).
 */
export async function evaluateCheckinConsentSoftStop(input: {
  organizationId: string;
  clientId: string;
  isVirtual: boolean;
  overrideReason?: string | null;
  actorUserId?: string | null;
}): Promise<ConsentSoftStopResult> {
  const required = [CHECKIN_REQUIRED_CONSENT];
  if (input.isVirtual) required.push(CHECKIN_TELEHEALTH_CONSENT);

  const forms = await prisma.consentForm.findMany({
    where: {
      organizationId: input.organizationId,
      clientId: input.clientId,
      status: 'SIGNED',
    },
    select: { type: true, expiresAt: true, signedAt: true },
  });

  const now = Date.now();
  const missing: string[] = [];
  for (const need of required) {
    const hit = forms.find(
      (f) =>
        matchesType(f.type, need) &&
        (!f.expiresAt || f.expiresAt.getTime() > now)
    );
    if (!hit) missing.push(need);
  }

  if (missing.length === 0) return { ok: true };

  const reason = (input.overrideReason || '').trim();
  if (reason.length >= 10) {
    // Soft override — persist audit as a consent note row marker when possible
    if (input.actorUserId) {
      await prisma.consentForm.create({
        data: {
          organizationId: input.organizationId,
          clientId: input.clientId,
          type: CONSENT_CHECKIN_OVERRIDE_CODE,
          status: 'SIGNED',
          method: 'Staff Override',
          signedAt: new Date(),
          signedByName: input.actorUserId,
          notes: reason.slice(0, 1000),
          createdById: input.actorUserId,
        },
      }).catch(() => {
        /* audit best-effort; check-in must proceed once reason validated */
      });
    }
    return { ok: true, overridden: true, auditCode: CONSENT_CHECKIN_OVERRIDE_CODE };
  }

  return {
    ok: false,
    code: CONSENT_REQUIRED_CODE,
    missing,
    error:
      missing.includes(CHECKIN_TELEHEALTH_CONSENT)
        ? 'Unsigned informed-consent-treatment and/or telehealth-consent. Provide a ≥10 character override reason to check in.'
        : 'Unsigned informed-consent-treatment. Provide a ≥10 character override reason to check in.',
  };
}

export function isCheckInStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  const s = status.replace(/_/g, '-').toLowerCase();
  return s === 'checked-in' || s === 'checkedin';
}
