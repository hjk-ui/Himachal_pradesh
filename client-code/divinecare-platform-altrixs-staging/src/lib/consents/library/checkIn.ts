/**
 * Check-in soft stop (server). The rules are in decisions.ts; this loads the facts for one client
 * and visit and records an override. Called from updateAppointment (src/lib/appointments/manage.ts)
 * when a visit moves to CHECKED_IN, so every staff check-in path gets the same rule.
 *
 * Not covered here: the patient's own telehealth lobby check-in (src/app/api/telehealth/join), where
 * the patient attests to the telehealth consent themselves.
 */
import { prisma } from '@/lib/db/prisma';
import { latestTitle, LIBRARY_FORM_PREFIX } from './catalog';
import { activeVersion } from './lifecycle';
import { loadComplianceData, loadLibrary, resolveSendable, ROW_SELECT } from './store';
import type { ConsentRowLite } from './status';
import { checkInBlockingKeys, decideCheckInConsents, onFileStatus, type CheckInConsentDecision, type CheckInConsentFact, type OnFileStatus } from './decisions';

export async function checkInConsentDecision(organizationId: string, clientId: string, isVirtual: boolean, now = new Date()): Promise<CheckInConsentDecision> {
  const [lib, rows, compliance] = await Promise.all([
    loadLibrary(organizationId),
    prisma.consentForm.findMany({ where: { organizationId, clientId, OR: [{ formKey: { startsWith: LIBRARY_FORM_PREFIX } }, { formKey: null }] }, select: ROW_SELECT }),
    loadComplianceData({ organizationId }, organizationId, { clientIds: [clientId], now }).catch(() => null),
  ]);
  const lites: ConsentRowLite[] = rows.map((r) => ({ ...r, purposeTag: ((r.formData ?? {}) as { purposeTag?: string | null }).purposeTag ?? null }));
  const facts: CheckInConsentFact[] = [];
  for (const key of checkInBlockingKeys(isVirtual)) {
    const res = resolveSendable(lib, key);
    facts.push({ key, title: 'template' in res ? res.template.title : latestTitle(key), templateAvailable: 'template' in res, status: onFileStatus(lites, key, activeVersion(key, lib.states), now) });
  }
  // Every other required consent: flags only
  for (const r of compliance?.rows ?? []) {
    if (!r.required || r.standard === 'complete') continue;
    const status: OnFileStatus = r.state === 'signed' ? 'expiring' : r.state;
    facts.push({ key: r.itemKey, title: r.title, templateAvailable: r.activeVersion !== null, status });
  }
  for (const u of compliance?.required.get(clientId)?.requiredUnavailable ?? []) {
    facts.push({ key: u.key, title: u.title, templateAvailable: false, status: 'missing' });
  }
  return decideCheckInConsents({ isVirtual, facts });
}

/** Store the override reason (never in audit metadata); returns the row id for the audit entry. */
export async function recordCheckInOverride(input: { organizationId: string; appointmentId: string; clientId: string; templateKeys: string[]; reason: string; userId: string | null }): Promise<string> {
  const row = await prisma.consentCheckInOverride.create({
    data: { organizationId: input.organizationId, appointmentId: input.appointmentId, clientId: input.clientId, templateKeys: input.templateKeys, reason: input.reason, overriddenById: input.userId },
    select: { id: true },
  });
  return row.id;
}
