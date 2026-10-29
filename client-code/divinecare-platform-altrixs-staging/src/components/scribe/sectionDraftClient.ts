/**
 * Browser helper for the grounded one-section AI draft (POST /api/scribe/section-draft), used by the
 * structured and therapist note editors. Only cited, supported sentences come back as `text`.
 */
import { WITHHOLD_LABEL, type WithholdReason } from '@/lib/scribe/grounding';

export type SectionDraftResponse =
  | { ok: true; text: string; withheld: { text: string; reason: string | null }[]; weak: number; notice: string | null }
  | { ok: false; error: string };

export async function requestGroundedSectionDraft(input: {
  clientId: string;
  heading: string;
  noteLabel: string;
  scope: 'history' | 'narrative';
  input: string;
}): Promise<SectionDraftResponse> {
  let res: Response;
  try {
    res = await fetch('/api/scribe/section-draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  } catch {
    return { ok: false, error: 'Could not reach the AI drafting service. Write the section yourself.' };
  }
  const data = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    provider?: string;
    error?: string;
    text?: string;
    withheld?: { text: string; reason: string | null }[];
    weak?: number;
  };
  if (!res.ok || !data.success || data.provider !== 'bedrock-live') {
    return { ok: false, error: data.error || `AI drafting failed (${res.status}). Nothing was generated; write the section yourself.` };
  }
  const withheld = data.withheld ?? [];
  const weak = data.weak ?? 0;
  const parts: string[] = [];
  if (withheld.length) {
    const reasons = [...new Set(withheld.map((w) => (w.reason && w.reason in WITHHOLD_LABEL ? WITHHOLD_LABEL[w.reason as WithholdReason] : 'Not supported')))];
    parts.push(`${withheld.length} AI sentence${withheld.length === 1 ? ' was' : 's were'} left out because your points did not support ${withheld.length === 1 ? 'it' : 'them'} (${reasons.join('; ')}).`);
  }
  if (weak) parts.push(`${weak} sentence${weak === 1 ? ' has' : 's have'} weak support: check ${weak === 1 ? 'it' : 'them'} against your points.`);
  return { ok: true, text: data.text || '', withheld, weak, notice: parts.length ? parts.join(' ') : null };
}
