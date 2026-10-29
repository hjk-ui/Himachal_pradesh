/** Zod schemas for packet submissions and revocations (shared by staff, portal and intake routes). */
import { z } from 'zod';
import { REVOCATION_CHANNELS, REVOCATION_METHODS } from './revocation';
import { STAFF_SIGNATURE_METHODS } from './evidence';

const fieldValue = z.union([z.string().max(2000), z.array(z.string().max(200)).max(20)]);

export const sectionResponseSchema = z.object({
  version: z.number().int().min(1).max(999),
  acknowledged: z.boolean(),
  checkboxes: z.record(z.string().max(60), z.boolean()).optional(),
  choices: z.record(z.string().max(60), z.string().max(60)).optional(),
  fields: z.record(z.string().max(60), fieldValue).optional(),
  declined: z.boolean().optional(),
  signature: z.string().max(120).optional(),
});

export const packetSubmissionSchema = z.object({
  sections: z.record(z.string().max(80), sectionResponseSchema),
  signer: z.object({
    signerType: z.enum(['self', 'representative']),
    printedName: z.string().trim().min(2).max(120),
    relationship: z.string().trim().max(80).optional().nullable(),
    authority: z.string().trim().max(300).optional().nullable(),
    signature: z.string().trim().min(1).max(120),
    agree: z.boolean(),
  }),
});

export const revocationSchema = z.object({
  receivedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  method: z.enum(REVOCATION_METHODS),
  receivedVia: z.enum(REVOCATION_CHANNELS),
  note: z.string().trim().max(500).optional().nullable(),
  channels: z.array(z.enum(['sms', 'email', 'voicemail'])).max(3).optional(),
});

/** In-office signing: how the client signed + interpreter / witness / scanned paper (evidence.ts). */
export const staffEvidenceSchema = z.object({
  signatureMethod: z.enum(STAFF_SIGNATURE_METHODS),
  interpreter: z.object({ used: z.boolean(), language: z.string().trim().max(60).nullable().optional(), name: z.string().trim().max(120).nullable().optional() }).nullable().optional(),
  witnessName: z.string().trim().max(120).nullable().optional(),
  paperDocumentRef: z.string().trim().max(200).nullable().optional(),
});

export const staffPacketSigningSchema = packetSubmissionSchema.extend({ evidence: staffEvidenceSchema.optional() });
