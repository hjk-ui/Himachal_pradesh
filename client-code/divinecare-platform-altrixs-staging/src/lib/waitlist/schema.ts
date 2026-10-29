import { z } from 'zod';
import { AGE_GROUPS, AVAILABILITY_DAYS, AVAILABILITY_TIMES, CLOSE_REASONS, CONTACT_METHODS, CONTACT_OUTCOMES, CONTACT_PREFERENCES, OPEN_STAGES } from './standard';

/** Request bodies for /api/waitlist/* (shared by the routes). */
const keys = <T extends readonly (readonly [string, string])[]>(list: T) => list.map((x) => x[0]) as [T[number][0], ...T[number][0][]];
const optText = (max: number) => z.string().trim().max(max).optional().nullable();
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const waitlistEntrySchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  firstName: optText(60),
  lastName: optText(60),
  dateOfBirth: ymd.optional().nullable().or(z.literal('')),
  email: z.string().trim().email().max(200).optional().nullable().or(z.literal('')),
  phone: optText(40),
  preferredContactMethod: z.enum(keys(CONTACT_PREFERENCES)).optional().nullable(),
  bestTimeToContact: optText(80),
  guardianName: optText(120),
  guardianPhone: optText(40),
  guardianRelationship: optText(60),
  specialty: z.string().trim().min(1).max(80).optional(),
  ageGroup: z.enum(keys(AGE_GROUPS)).optional().nullable(),
  preferredLocationIds: z.array(z.string().min(1).max(64)).max(10).optional(),
  telehealthOk: z.boolean().optional().nullable(),
  availabilityDays: z.array(z.enum(keys(AVAILABILITY_DAYS))).max(6).optional(),
  availabilityTimes: z.array(z.enum(keys(AVAILABILITY_TIMES))).max(3).optional(),
  clinicianGenderPref: optText(40),
  languagePref: optText(60),
  urgency: z.enum(['routine', 'urgent', 'crisis']).optional(),
  insurancePayer: optText(120),
  payerRegistryId: optText(64),
  insuranceMemberId: optText(60),
  referralSource: optText(120),
  referringProvider: optText(160),
  presentingConcern: optText(500),
  safetyScreen: z.enum(['no', 'yes', 'not_asked']).optional().nullable(),
  notes: optText(2000),
  preferredClinician: optText(120),
});

export const waitlistPatchSchema = waitlistEntrySchema.extend({
  stage: z.enum(OPEN_STAGES as [string, ...string[]]).optional(),
  status: z.enum(['waiting', 'matched', 'scheduled', 'closed']).optional(),
  action: z.enum(['close', 'reopen']).optional(),
  closeReason: z.enum(keys(CLOSE_REASONS)).optional().nullable(),
  closeNote: optText(500),
});

export const contactAttemptSchema = z.object({
  method: z.enum(keys(CONTACT_METHODS)),
  outcome: z.enum(keys(CONTACT_OUTCOMES)),
  note: optText(1000),
  nextFollowUpAt: z.string().trim().max(40).optional().nullable().or(z.literal('')),
});

export const conversionSchema = z.object({
  linkClientId: z.string().min(1).max(128).optional().nullable(),
  createDespiteMatches: z.boolean().optional(),
  appointment: z
    .object({
      clinicianId: z.string().min(1).max(128),
      startsAt: z.string().min(16).max(40),
      endsAt: z.string().min(16).max(40),
      type: z.string().trim().min(2).max(120),
      isVirtual: z.boolean(),
    })
    .optional()
    .nullable(),
  assignedToId: z.string().min(1).max(128).optional().nullable(),
  locationId: z.string().min(1).max(64).optional().nullable(),
  sendIntake: z.boolean().optional(),
  runEligibility: z.boolean().optional(),
});

/** Names of the keys present in a body (audit metadata: field names only, never values). */
export function presentFields(body: Record<string, unknown>): string[] {
  return Object.keys(body).filter((k) => body[k] !== undefined);
}
