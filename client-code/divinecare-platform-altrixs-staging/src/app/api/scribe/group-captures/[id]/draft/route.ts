import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { BEDROCK_MODELS, invokeBedrock, isBedrockConfigured } from '@/lib/ai/bedrockService';
import { normalizeScribeLanguage } from '@/lib/scribe/language';
import {
  GROUP_INDIVIDUAL_AI_FIELDS,
  GROUP_SHARED_AI_FIELDS,
  groupDraftSources,
  groupFieldValues,
  groupLinesText,
  groupMemberSystemPrompt,
  groupSharedSystemPrompt,
  groundGroupSection,
  parseGroupReply,
  type GroupDraft,
} from '@/lib/scribe/group';
import { findGroupCapture, groupCaptureView, groupMembersOf, groupSessionForScribe, loadGroupSegments } from '@/lib/scribe/groupStore';
import { aiConsentFor } from '@/lib/scribe/store';
import type { NoteValues } from '@/lib/groups/types';
import { jsonError, scribeGate } from '../../../_lib/gate';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * POST /api/scribe/group-captures/[id]/draft — grounded group draft:
 *   shared section: one model call on the clinician's + included members' lines (aliases only)
 *   each included member: one call on THAT member's lines only (numbered for that member alone)
 * Unattributed speech and excluded members are never sent. AI consent is re-checked per member now.
 * AI_ACCESS is audited before anything goes to Bedrock (ids and counts only).
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await scribeGate({ entitlement: true });
  if (g.ok === false) return g.response;
  const { actor, gate } = g;
  const { id } = await ctx.params;
  const cap = await findGroupCapture(actor, id);
  if (!cap) return jsonError(404, 'Capture not found');
  if (cap.clinicianId !== actor.userId) return jsonError(403, 'Only the capturing clinician can draft');
  if (cap.status === 'discarded' || cap.transcriptPurgedAt) return jsonError(409, 'This capture has no transcript.');
  if (!isBedrockConfigured()) return jsonError(503, 'AI drafting is not configured on this server (AWS Bedrock). Nothing was generated.');
  const detail = await groupSessionForScribe(actor, cap.groupSessionId);
  if (!detail?.canDocument) return jsonError(403, 'Only this session’s facilitators can draft its notes');
  const kind = detail.session.kind;
  const language = normalizeScribeLanguage(cap.language);

  // AI consent may have changed since the capture started: re-check, never widen
  const members = await Promise.all(
    groupMembersOf(cap).map(async (m) => {
      if (!m.included) return m;
      const now = await aiConsentFor(actor.organizationId, m.clientId);
      return now === 'declined' ? { ...m, aiConsent: now, included: false } : m;
    })
  );
  const segments = await loadGroupSegments(cap.id);
  const map = (cap.speakerMap as Record<string, string> | null) ?? {};
  const sources = groupDraftSources({ segments, speakerMap: map, members, kind });
  if (sources.shared.length < 2) return jsonError(422, 'Map the speakers first (clinician and members): unmapped speech is never used, so there is not enough to draft from.');

  const names = new Map(detail.attendees.filter((a) => a.clientId).map((a) => [a.clientId as string, a.displayName]));
  const allNames = [...names.values()];
  const noSudShared = kind !== 'sud' && members.some((m) => m.included && m.part2);
  await auditPhiAccess({
    gate,
    req,
    action: 'AI_ACCESS',
    resourceType: 'scribeGroupDraft',
    resourceId: cap.id,
    metadata: { feature: 'scribe-group-draft', model: BEDROCK_MODELS.SONNET, sharedLines: sources.shared.length, members: sources.perMember.size, dropped: sources.dropped, part2: cap.part2, language },
  });

  let withheld = 0;
  let weak = 0;
  let shared: NoteValues = {};
  try {
    const reply = await invokeBedrock({
      model: 'SONNET',
      system: groupSharedSystemPrompt(kind, language),
      userPrompt: `TRANSCRIPT\n${groupLinesText(sources.shared)}`,
      maxTokens: 2500,
      temperature: 0,
      jsonMode: true,
    });
    const raw = parseGroupReply(reply, 'shared', GROUP_SHARED_AI_FIELDS[kind]);
    if (raw) {
      const gr = groundGroupSection(raw, sources.shared, { otherNames: allNames, noSud: noSudShared });
      shared = groupFieldValues(gr.fields);
      withheld += gr.withheld;
      weak += gr.weak;
    }
  } catch {
    await auditPhiAccess({ gate, req, action: 'AI_ACCESS', resourceType: 'scribeGroupDraft', resourceId: cap.id, outcome: 'FAILURE', metadata: { step: 'shared' } });
    return jsonError(503, 'AI drafting is unavailable right now. Nothing was generated; try again.');
  }

  const individuals: Record<string, NoteValues> = {};
  for (const m of members) {
    const lines = sources.perMember.get(m.clientId);
    if (!m.included || !lines || lines.length === 0) continue;
    try {
      const reply = await invokeBedrock({
        model: 'SONNET',
        system: groupMemberSystemPrompt(kind, language),
        userPrompt: `THIS MEMBER'S LINES\n${groupLinesText(lines)}`,
        maxTokens: 1500,
        temperature: 0,
        jsonMode: true,
      });
      const raw = parseGroupReply(reply, 'fields', GROUP_INDIVIDUAL_AI_FIELDS[kind]);
      if (!raw) continue;
      const others = allNames.filter((n) => n !== names.get(m.clientId));
      const gr = groundGroupSection(raw, lines, { otherNames: others, noSud: kind !== 'sud' && m.part2 });
      const values = groupFieldValues(gr.fields);
      if (Object.keys(values).length) individuals[m.clientId] = values;
      withheld += gr.withheld;
      weak += gr.weak;
    } catch {
      // One member failing leaves that member for the clinician to write; the rest still draft
    }
  }

  const draft: GroupDraft = { shared, individuals, counts: { withheld, weak, members: Object.keys(individuals).length, dropped: sources.dropped } };
  const updated = await prisma.scribeGroupCapture.update({
    where: { id: cap.id },
    data: { draft: JSON.parse(JSON.stringify(draft)), draftCount: { increment: 1 }, status: 'drafted', members: JSON.parse(JSON.stringify(members)) },
  });
  await auditPhiAccess({ gate, req, action: 'AI_ACCESS', resourceType: 'scribeGroupDraft', resourceId: cap.id, metadata: { step: 'grounded', withheld, weak, membersDrafted: draft.counts.members } });
  return NextResponse.json({ success: true, capture: groupCaptureView(updated), draft }, { headers: { 'Cache-Control': 'private, no-store' } });
}
