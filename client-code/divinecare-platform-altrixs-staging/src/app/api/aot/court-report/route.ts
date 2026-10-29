import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { invokeBedrock, isBedrockConfigured, BEDROCK_MODELS } from '@/lib/ai/bedrockService';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { AOT_COURT_REPORT_ROLES, canSeeAotClinical, findParticipantInOrg } from '../_scope';

export const runtime = 'nodejs';

const bodySchema = z.object({ participantId: z.string().trim().min(1).max(64) });

type TeamRow = { role?: unknown; name?: unknown };
type EventRow = { date?: unknown; event?: unknown };

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const placeholder = (v: string | null | undefined, label: string) =>
  v && v.trim() && !/^not documented/i.test(v.trim()) ? v.trim() : `[${label}]`;

/**
 * POST /api/aot/court-report { participantId }
 * Drafts the 90-day judicial status report from the participant's stored record only (org-scoped,
 * loaded server side). Restricted to the clinical AOT team and audited as an AI access to PHI.
 */
export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  // Court report quotes diagnosis and non-adherence events: also an EHR clinical role (canSeeAotClinical)
  if (!AOT_COURT_REPORT_ROLES.has(String(gate.role)) || !canSeeAotClinical(gate.role)) {
    return NextResponse.json(
      { success: false, error: 'Court report drafting is limited to the clinical AOT team' },
      { status: 403 }
    );
  }

  try {
    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: 'participantId is required' }, { status: 400 });
    }
    const p = await findParticipantInOrg(parsed.data.participantId, gate.organizationId);
    if (!p) {
      return NextResponse.json({ success: false, error: 'AOT participant not found' }, { status: 404 });
    }

    // No template fallback: a court filing draft is either a real model draft or an explicit error.
    if (!isBedrockConfigured()) {
      return NextResponse.json(
        { success: false, error: 'AI drafting is not configured on this server (Bedrock credentials missing). Write the report manually.' },
        { status: 503 }
      );
    }

    const team = (Array.isArray(p.teamCadence) ? (p.teamCadence as TeamRow[]) : []).filter(
      (t) => typeof t?.role === 'string' && typeof t?.name === 'string'
    ) as { role: string; name: string }[];
    const memberFor = (re: RegExp) => team.find((t) => re.test(t.role.toLowerCase()))?.name ?? null;
    const events = (Array.isArray(p.escalationEvents) ? (p.escalationEvents as EventRow[]) : [])
      .filter((e) => typeof e?.event === 'string')
      .map((e) => `${typeof e.date === 'string' ? e.date : 'undated'}: ${e.event as string}`);

    const systemPrompt = `You are a forensic behavioral health legal drafter specializing in Maryland Assisted Outpatient Treatment (AOT) under MD Health-Gen § 10-6A-05.
Draft a formal 90-Day Judicial Status Report for the District Court presiding judge from the facts provided.
Use ONLY the facts provided. Where a fact is a bracketed placeholder, keep a bracketed placeholder for the clinician to complete. Never invent hospitalizations, medications, injections, contact frequency, adherence figures, names, outcomes or a team recommendation.
At the end include unsigned signature blocks for the treating psychiatrist and AOT court liaison coordinator, and append:
"[AI-generated draft - must be reviewed, completed, and certified by the clinician of record before filing]"`;

    const userPrompt = `Respondent: ${p.name}
Jurisdiction: District Court of Maryland for ${placeholder(p.county, 'County')}
Primary Psychiatric Diagnosis: ${placeholder(p.diagnosis, 'Diagnosis: clinician to document')}
Order Dates: ${day(p.orderStart) ?? '[Order start date]'} through ${day(p.orderEnd) ?? '[Order end date]'} (Hearing: ${day(p.hearingDate) ?? '[Hearing date]'})
Current AOT status in Altrixs: ${p.status}
Treating Psychiatrist: ${memberFor(/psychiatr/) ?? '[Treating psychiatrist]'}
AOT Case Manager: ${memberFor(/case manager/) ?? '[AOT case manager]'}
Treatment Adherence: [Clinician to document - not recorded in Altrixs]
Non-Adherence Events recorded in Altrixs: ${events.length ? events.join('; ') : '[None recorded in Altrixs - clinician to confirm]'}
Team Recommendation: [Team recommendation]`;

    let output: string;
    try {
      output = await invokeBedrock({
        model: 'SONNET',
        system: systemPrompt,
        userPrompt,
        maxTokens: 2500,
        temperature: 0.1,
      });
    } catch (err: unknown) {
      console.error('[aot/court-report] Bedrock error:', err instanceof Error ? err.message : 'unknown');
      await auditPhiAccess({
        gate, req, action: 'AI_ACCESS', resourceType: 'aotCourtReport', resourceId: p.id, patientId: p.clientId ?? null, outcome: 'FAILURE',
        metadata: { model: BEDROCK_MODELS.SONNET },
      });
      return NextResponse.json(
        { success: false, error: 'AI draft failed: Bedrock did not respond. Try again or write the report manually.' },
        { status: 502 }
      );
    }

    await auditPhiAccess({
      gate,
      req,
      action: 'AI_ACCESS',
      resourceType: 'aotCourtReport',
      resourceId: p.id,
      patientId: p.clientId ?? null,
      metadata: { model: BEDROCK_MODELS.SONNET, events: events.length, teamMembers: team.length },
    });

    if (!output || !output.trim()) {
      return NextResponse.json({ success: false, error: 'AI returned an empty draft' }, { status: 502 });
    }

    return NextResponse.json({
      success: true,
      modelId: BEDROCK_MODELS.SONNET,
      provider: 'bedrock-live',
      report: output.trim(),
      disclaimer: 'AI-generated draft via AWS Bedrock. Attorney/clinician review required before filing.',
    });
  } catch (err: unknown) {
    console.error('[aot/court-report]', err instanceof Error ? err.message : 'unknown');
    return NextResponse.json({ success: false, error: 'Court report generator failed' }, { status: 500 });
  }
}
