import { canPrescribe } from '@/types/roles';
import { DrFirstError } from './errors';
import type { Role } from '@prisma/client';
export interface DrFirstContext { userId: string; organizationId: string; role: Role }
export function assertDrFirstPrescriber(context: DrFirstContext) {
  if (!context.userId || !context.organizationId || !canPrescribe(context.role)) throw new DrFirstError('DRFIRST_UNAUTHORIZED', 403);
}
export function assertDrFirstSelf(userId: string, context: DrFirstContext) {
  assertDrFirstPrescriber(context);
  if (userId !== context.userId) throw new DrFirstError('DRFIRST_UNAUTHORIZED', 403);
}
