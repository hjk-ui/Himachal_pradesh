/**
 * Treatment plan review interval for one client (server): the client's age today plus the practice
 * setting, through the single rule in rules.ts (adults <= 180 days from Practice Settings, under 18
 * <= 90 days). Used by the template plan editor and the legacy treatment plan API so both agree.
 * Reads the one setting column directly (no practice store import, so it stays usable from every
 * server module). A read failure falls back to the rule's defaults, never to a longer interval.
 */
import { prisma } from '@/lib/db/prisma';
import { ageOn } from '@/lib/ehr/psychMedMgmt';
import { clinicDate } from '@/lib/workflows/dates';
import { maxReviewDays } from './rules';

async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

export async function clientReviewDays(
  organizationId: string,
  clientId: string,
  today = clinicDate()
): Promise<{ days: number; age: number | null; practiceDays: number | null }> {
  const [client, practice] = await Promise.all([
    safe(() => prisma.client.findFirst({ where: { id: clientId }, select: { dateOfBirth: true } })),
    safe(() => prisma.practiceSettings.findUnique({ where: { organizationId }, select: { treatmentPlanReviewDays: true } })),
  ]);
  const age = ageOn(client?.dateOfBirth ? new Date(client.dateOfBirth).toISOString() : null, today);
  const practiceDays = practice?.treatmentPlanReviewDays ?? null;
  return { days: maxReviewDays(age, practiceDays), age, practiceDays };
}
