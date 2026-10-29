import type { Prisma } from '@prisma/client';

/**
 * Smart Document Intake queue scope for an organization. Uploaded documents carry
 * organizationId; older rows are scoped through their suggested client.
 */
export function docIntakeOrgWhere(organizationId: string): Prisma.DocumentIntakeWhereInput {
  return { OR: [{ organizationId }, { organizationId: null, suggestedClient: { organizationId } }] };
}

/** Status of a document that has been read and is waiting for staff to confirm the filing ("Needs Review") */
export const DOC_INTAKE_NEEDS_REVIEW = 'ready';
