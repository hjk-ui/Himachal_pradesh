/**
 * Transcript retention (pure planning + an injectable runner). Called from the existing cron
 * (/api/cron/notifications, every 10 minutes).
 *
 * Policy (practice settings deleteTranscriptOnSign, default ON, and transcriptRetentionDays,
 * default 30, 1-365):
 *  - note signed, delete-on-sign ON: purge segments, drafts and the client summary text at the
 *                            signature (the sign path does it at once, signPurge.ts; this job is the
 *                            safety net for a sign that happened while the purge failed)
 *  - note signed, delete-on-sign OFF: purge N days after the note's signature time
 *  - no signed note:         purge N days after capture stopped (or was last updated)
 *  - consent withdrawn / dismissed ("Dismiss scribe"): purged immediately by /control; the safety
 *                            net (sweepClosedCaptures) also deletes, at any age, any segment or draft
 *                            still attached to a discarded or withdrawn capture (e.g. an upload that
 *                            raced the delete)
 * Raw audio is never stored, so there is nothing else to delete. RDS automated backups (35 days)
 * and AWS Backup monthly copies (1 year) still hold purged rows until they age out.
 */
export const DAY_MS = 86_400_000;

export type RetentionCapture = {
  id: string;
  organizationId: string;
  progressNoteId: string | null;
  noteSignedAt: Date | null;
  stoppedAt: Date | null;
  updatedAt: Date;
  transcriptPurgeAfter: Date | null;
  transcriptPurgedAt: Date | null;
};

/** When this capture's transcript becomes eligible for deletion. */
export function purgeAfter(
  c: Pick<RetentionCapture, 'noteSignedAt' | 'stoppedAt' | 'updatedAt' | 'progressNoteId'>,
  retentionDays: number,
  deleteOnSign = false
): Date {
  // Delete on sign: due at the signature itself
  if (deleteOnSign && c.noteSignedAt) return new Date(c.noteSignedAt.getTime());
  const base = c.noteSignedAt ?? c.stoppedAt ?? c.updatedAt;
  return new Date(base.getTime() + retentionDays * DAY_MS);
}

export function isDue(c: RetentionCapture, retentionDays: number, now: Date, deleteOnSign = false): boolean {
  if (c.transcriptPurgedAt) return false;
  // A capture with a linked note waits for the signature
  if (c.progressNoteId && !c.noteSignedAt) return false;
  return purgeAfter(c, retentionDays, deleteOnSign).getTime() <= now.getTime();
}

export type RetentionDeps = {
  /** Unpurged captures (bounded batch) */
  candidates(): Promise<RetentionCapture[]>;
  retentionDays(organizationId: string): Promise<number>;
  /** Practice "Delete transcript when the note is signed" (default true); omitted = false */
  deleteOnSign?(organizationId: string): Promise<boolean>;
  /** Signature time of a linked note (null while unsigned) */
  noteSignedAt(noteId: string): Promise<Date | null>;
  markSigned(captureId: string, signedAt: Date, purgeAt: Date): Promise<void>;
  purge(captureId: string): Promise<{ segments: number }>;
  audit(entry: { organizationId: string; captureId: string; segments: number }): Promise<void>;
};

export async function runRetention(deps: RetentionDeps, now = new Date()): Promise<{ checked: number; purged: number; segments: number }> {
  const list = await deps.candidates();
  const days = new Map<string, number>();
  const onSign = new Map<string, boolean>();
  let purged = 0;
  let segments = 0;
  for (const c of list) {
    if (c.transcriptPurgedAt) continue;
    if (!days.has(c.organizationId)) days.set(c.organizationId, await deps.retentionDays(c.organizationId));
    if (!onSign.has(c.organizationId)) onSign.set(c.organizationId, deps.deleteOnSign ? await deps.deleteOnSign(c.organizationId) : false);
    const n = days.get(c.organizationId)!;
    const del = onSign.get(c.organizationId)!;
    let cap = c;
    if (c.progressNoteId && !c.noteSignedAt) {
      const signed = await deps.noteSignedAt(c.progressNoteId);
      if (signed) {
        cap = { ...c, noteSignedAt: signed };
        await deps.markSigned(c.id, signed, purgeAfter(cap, n, del));
      }
    }
    if (!isDue(cap, n, now, del)) continue;
    const res = await deps.purge(c.id);
    purged++;
    segments += res.segments;
    await deps.audit({ organizationId: c.organizationId, captureId: c.id, segments: res.segments });
  }
  return { checked: list.length, purged, segments };
}

export type ClosedSweepDeps = {
  /** Discarded / withdrawn captures that still have segments or drafts (bounded batch) */
  leftovers(): Promise<{ captureId: string; organizationId: string }[]>;
  /** Delete them, only while the capture is still discarded / withdrawn */
  purge(captureId: string): Promise<{ segments: number; drafts: number }>;
  audit(entry: { organizationId: string; captureId: string; segments: number; drafts: number }): Promise<void>;
};

/** Safety net: transcript text never outlives a dismissed or consent-withdrawn capture, whatever its age. */
export async function sweepClosedCaptures(deps: ClosedSweepDeps): Promise<{ captures: number; segments: number; drafts: number }> {
  let captures = 0;
  let segments = 0;
  let drafts = 0;
  for (const c of await deps.leftovers()) {
    const res = await deps.purge(c.captureId);
    if (!res.segments && !res.drafts) continue;
    captures++;
    segments += res.segments;
    drafts += res.drafts;
    await deps.audit({ organizationId: c.organizationId, captureId: c.captureId, ...res });
  }
  return { captures, segments, drafts };
}
