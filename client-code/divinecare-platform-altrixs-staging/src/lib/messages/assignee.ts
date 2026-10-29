import type { MessageThreadTopic, Prisma } from '@prisma/client';

/**
 * Message thread access rules shared by the messages store and the chart rule (pure; tested in
 * tests/role-matrix.test.ts).
 */

/** Administrative thread topics: what Front Desk and Office Manager triage. */
export const ADMIN_MESSAGE_TOPICS: MessageThreadTopic[] = ['SCHEDULING', 'BILLING', 'GENERAL'];

/**
 * Front Desk and Office Manager read administrative threads only (scheduling / billing / general),
 * plus any thread forwarded or assigned to them. Clinical and Rx-refill threads (symptoms,
 * medications) go to the care team. Leadership (incl. DIRECTOR) keeps org-wide access.
 */
export function messageTopicsRestricted(role: string | null | undefined): boolean {
  const r = String(role ?? '').toUpperCase();
  return r === 'FRONT_DESK' || r === 'OFFICE_MANAGER';
}

/**
 * Thread rows forwarded or assigned to this user. forwardedTo / assignedStaff hold a staff name
 * (the forward picker stores the directory name), an email or a user id. Matching is exact
 * (case-insensitive, trimmed): a substring match let "Ann" open threads forwarded to "Joanne".
 */
export function threadAssigneeOr(actor: {
  userId: string;
  name?: string | null;
  email?: string | null;
}): Prisma.MessageThreadWhereInput[] {
  const name = actor.name?.trim();
  const email = actor.email?.trim();
  return [
    { forwardedTo: actor.userId },
    ...(name
      ? [
          { forwardedTo: { equals: name, mode: 'insensitive' as const } },
          { assignedStaff: { equals: name, mode: 'insensitive' as const } },
        ]
      : []),
    ...(email ? [{ forwardedTo: { equals: email, mode: 'insensitive' as const } }] : []),
  ];
}
