/**
 * Click-through BAA acceptance (server only). Text and version: src/lib/legal/baa.ts.
 * Table: "BaaAcceptance" (prisma/migrations/20261026_baa_acceptance.sql).
 *
 * Callers: /api/auth/register (new organizations; registration is refused without acceptance)
 * and /api/admin/baa (existing organizations, admins only).
 */
import { createHash } from 'crypto';
import { z } from 'zod';
import { BAA_VERSION, baaPlainText } from '@/lib/legal/baa';

export const BAA_REQUIRED_ERROR =
  'An authorized signer must accept the Business Associate Agreement to create an account.';
export const BAA_VERSION_STALE_ERROR =
  'The Business Associate Agreement has been updated. Reload the page, review it and accept again.';

export type BaaAcceptanceSource = 'registration' | 'admin';

/** SHA-256 (hex) of the exact agreement text for the current BAA_VERSION. */
export function baaTextSha256(text: string = baaPlainText()): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

const acceptanceSchema = z.object({
  accepted: z.literal(true, { message: BAA_REQUIRED_ERROR }),
  version: z.string().trim().min(1, BAA_REQUIRED_ERROR),
  signerName: z.string().trim().min(2, 'Enter the full name of the person accepting the BAA').max(120),
  signerTitle: z.string().trim().min(2, 'Enter the signer\'s title (for example Owner or Practice Director)').max(120),
  signerEmail: z.string().trim().email('Enter a valid email for the BAA signer').toLowerCase(),
});

export type BaaAcceptanceInput = z.infer<typeof acceptanceSchema>;

export type ParsedBaaAcceptance =
  | { ok: true; value: BaaAcceptanceInput; error?: undefined; status?: undefined }
  | { ok: false; error: string; status: number; value?: undefined };

/** Validate the `baa` block of a request body. Missing / unchecked => 400; old version => 409. */
export function parseBaaAcceptance(raw: unknown): ParsedBaaAcceptance {
  if (!raw || typeof raw !== 'object') return { ok: false, error: BAA_REQUIRED_ERROR, status: 400 };
  const parsed = acceptanceSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message || BAA_REQUIRED_ERROR, status: 400 };
  }
  if (parsed.data.version !== BAA_VERSION) {
    return { ok: false, error: BAA_VERSION_STALE_ERROR, status: 409 };
  }
  return { ok: true, value: parsed.data };
}

export type BaaAcceptanceRecord = {
  organizationId: string;
  userId: string;
  signerName: string;
  signerTitle: string;
  signerEmail: string;
  baaVersion: string;
  textSha256: string;
  acceptedAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
  source: BaaAcceptanceSource;
};

/** Row for prisma.baaAcceptance.create({ data }). */
export function buildBaaAcceptanceRecord(args: {
  organizationId: string;
  userId: string;
  input: BaaAcceptanceInput;
  ipAddress: string | null;
  userAgent: string | null;
  source: BaaAcceptanceSource;
  now?: Date;
}): BaaAcceptanceRecord {
  return {
    organizationId: args.organizationId,
    userId: args.userId,
    signerName: args.input.signerName,
    signerTitle: args.input.signerTitle,
    signerEmail: args.input.signerEmail,
    baaVersion: BAA_VERSION,
    textSha256: baaTextSha256(),
    acceptedAt: args.now ?? new Date(),
    ipAddress: args.ipAddress ? args.ipAddress.slice(0, 64) : null,
    userAgent: args.userAgent ? args.userAgent.slice(0, 512) : null,
    source: args.source,
  };
}

/** Audit row metadata: ids, version and hash only (signer details live in the BaaAcceptance row). */
export function baaAuditMetadata(record: BaaAcceptanceRecord, acceptanceId: string): Record<string, unknown> {
  return {
    baaAcceptanceId: acceptanceId,
    baaVersion: record.baaVersion,
    textSha256: record.textSha256,
    source: record.source,
  };
}

/** True when the organization has not accepted the CURRENT BAA_VERSION. */
export function needsCurrentBaa(acceptedVersions: string[]): boolean {
  return !acceptedVersions.includes(BAA_VERSION);
}
