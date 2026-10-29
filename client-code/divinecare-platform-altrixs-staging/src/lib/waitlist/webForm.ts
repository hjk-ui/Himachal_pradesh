import { prisma } from '@/lib/db/prisma';
import { createWaitlistEntry } from './manage';
import { findDuplicateCandidates } from './standard';

/**
 * Public intake form (Marketing > Forms, /p/[org]/intake/[form]) submissions also land on the
 * waitlist as NEW, so the front desk works them like any other request. The form collects no
 * clinical detail, so the safety screen is "not_asked": staff ask it on first contact.
 * An open waitlist entry that is already the same person (name + DOB / phone / email) is not
 * duplicated. Failures never fail the public submission.
 */
export async function routeWebFormToWaitlist(
  organizationId: string,
  s: {
    leadId: string | null;
    firstName: string;
    lastName: string;
    phone?: string | null;
    email?: string | null;
    dateOfBirth?: string | null;
    serviceInterest?: string | null;
    locationId?: string | null;
    insurance?: string | null;
    preferredContact?: string | null;
    formName: string;
  }
): Promise<{ created: boolean; entryId?: string }> {
  try {
    const open = await prisma.waitlistEntry.findMany({
      where: { organizationId, status: { in: ['WAITING', 'MATCHED'] } },
      select: { id: true, name: true, dateOfBirth: true, phone: true, email: true },
      take: 2000,
    });
    const dup = findDuplicateCandidates(
      { firstName: s.firstName, lastName: s.lastName, dateOfBirth: s.dateOfBirth ?? null, phone: s.phone ?? null, email: s.email ?? null },
      open.map((o) => ({ id: o.id, name: o.name, dateOfBirth: o.dateOfBirth, phone: o.phone, email: o.email }))
    ).find((d) => d.level === 'strong');
    if (dup) return { created: false, entryId: dup.clientId };

    const contact = s.preferredContact === 'email' ? 'email' : s.preferredContact === 'phone' ? 'phone' : null;
    const r = await createWaitlistEntry(organizationId, {
      firstName: s.firstName,
      lastName: s.lastName,
      phone: s.phone ?? null,
      email: s.email ?? null,
      dateOfBirth: s.dateOfBirth ?? null,
      specialty: (s.serviceInterest ?? '').trim() || 'Not specified',
      preferredLocationIds: s.locationId ? [s.locationId] : [],
      insurancePayer: s.insurance ?? null,
      preferredContactMethod: contact,
      referralSource: `Web form: ${s.formName}`.slice(0, 120),
      safetyScreen: 'not_asked',
      source: 'web_form',
      marketingLeadId: s.leadId,
    });
    return r.ok ? { created: true, entryId: r.entry.id } : { created: false };
  } catch (err) {
    console.error('[waitlist web form routing]', err);
    return { created: false };
  }
}
