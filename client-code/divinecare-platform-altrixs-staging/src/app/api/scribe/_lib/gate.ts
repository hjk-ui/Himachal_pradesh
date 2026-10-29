import { NextResponse } from 'next/server';
import { sanitizeGaps } from '@/lib/scribe/recordingMonitor';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { canWriteClientChartNotes } from '@/lib/clients/orgScope';
import { requireFeatureWrite } from '@/lib/billing/entitlementsServer';
import type { ScribeActor } from '@/lib/scribe/store';

export type ScribeGate =
  | { ok: true; actor: ScribeActor; gate: { organizationId: string; userId: string; role: string } }
  | { ok: false; response: NextResponse };

/** Signed-in clinician who may use the scribe and write chart notes; optionally the ai_scribe entitlement. */
export async function scribeGate(opts: { entitlement?: boolean } = {}): Promise<ScribeGate> {
  const gate = await requireOrgContext();
  if (!gate.ok) return { ok: false, response: NextResponse.json({ success: false, error: gate.error }, { status: gate.status }) };
  if (!canAccessPath(gate.role, '/dashboard/scribe') || !canWriteClientChartNotes(gate.role)) {
    return { ok: false, response: NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 }) };
  }
  if (opts.entitlement) {
    const plan = await requireFeatureWrite(gate.organizationId, 'ai_scribe');
    if (plan.ok === false) {
      return { ok: false, response: NextResponse.json({ success: false, error: plan.error, code: plan.code }, { status: plan.status }) };
    }
  }
  const g = { organizationId: gate.organizationId, userId: gate.userId, role: String(gate.role) };
  return { ok: true, actor: g, gate: g };
}

export function jsonError(status: number, error: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ success: false, error, ...extra }, { status });
}

export function captureView(cap: {
  id: string;
  clientId: string;
  mode: string;
  engine: string;
  status: string;
  noteFormat: string | null;
  part2: boolean;
  aiConsentStatus: string;
  liveCues: boolean;
  consentAttestedAt: Date;
  consentAttestedByName: string | null;
  consentMethod: string | null;
  progressNoteId: string | null;
  telehealthSessionId: string | null;
  appointmentId: string | null;
  captureSeconds: number;
  language?: string | null;
  source?: string | null;
  audioDeletedAt?: Date | null;
  batchJobName?: string | null;
  recordingGaps?: unknown;
}) {
  return {
    id: cap.id,
    clientId: cap.clientId,
    mode: cap.mode,
    engine: cap.engine,
    status: cap.status,
    noteFormat: cap.noteFormat,
    part2: cap.part2,
    aiConsentStatus: cap.aiConsentStatus,
    liveCues: cap.liveCues,
    consent: { attestedAt: cap.consentAttestedAt.toISOString(), attestedBy: cap.consentAttestedByName, method: cap.consentMethod },
    progressNoteId: cap.progressNoteId,
    telehealthSessionId: cap.telehealthSessionId,
    appointmentId: cap.appointmentId,
    captureSeconds: cap.captureSeconds,
    language: cap.language ?? 'en-US',
    source: cap.source ?? 'live',
    audioDeleted: Boolean(cap.audioDeletedAt),
    recordingGaps: sanitizeGaps(cap.recordingGaps),
  };
}
