/**
 * Renewal request packet for staff review. The numbers and dates are computed (forecast.ts);
 * Bedrock (Haiku) only writes the clinical-justification paragraph from those facts, and only when the
 * client has not declined AI drafting. Identifiers (name, DOB, member id, auth #) are filled in by the
 * template and never sent to the model. Nothing is submitted to a payer.
 */
import { fmtForecastDay, type AuthForecast } from './labels';
import type { RenewalRequest } from './forecast';

export type GoalSummary = {
  text: string;
  /** Plan progress 0-100 when recorded */
  progressPct: number | null;
  /** Most recent progress chip from a signed note ("Progress made" / "No change" / "Regression") */
  latestChip: { status: string; day: string } | null;
};

export type RenewalFacts = {
  forecast: AuthForecast;
  request: RenewalRequest;
  /** Identifiers the payer form requires; template only */
  client: { name: string; dateOfBirth: string | null; memberId: string | null; mrn: string | null; clientId: string };
  diagnoses: string[];
  plan: { title: string; reviewDue: string | null; levelOfCare: string | null } | null;
  goals: GoalSummary[];
  /** Signed notes in the auth window */
  signedNotesInWindow: number;
};

export type AiConsent = 'signed' | 'missing' | 'declined';

export type RenewalDraftResult = {
  text: string;
  justification: string;
  justificationSource: 'ai' | 'template';
  /** Why the template was used */
  fallbackReason: 'consent_declined' | 'ai_unavailable' | 'ai_failed' | 'ai_empty' | null;
  consent: AiConsent;
  warning: string | null;
  model: string | null;
};

export type RenewalDraftDeps = {
  consent: () => Promise<AiConsent>;
  aiAvailable: boolean;
  model: string | null;
  invoke: (system: string, userPrompt: string) => Promise<string>;
  /** Called once with what happened; metadata is ids/counts only */
  audit: (entry: { action: 'AI_ACCESS'; outcome: 'SUCCESS' | 'DENIED' | 'FAILURE'; metadata: Record<string, string | number | boolean | null> }) => Promise<void>;
};

// ─── Progress chips from signed notes ──────────────────────────────────────────

const CHIP_RE = /^Goal (\d+): (.+?) — (Progress made|No change|Regression)(?: — .*)?$/gm;

/** "Goal 2: Reduce panic — Progress made — …" lines written by renderPlanGoals() into note bodies */
export function parseProgressChips(body: string): { goalIndex: number; goalText: string; status: string }[] {
  return [...String(body ?? '').matchAll(CHIP_RE)].map((m) => ({ goalIndex: Number(m[1]) - 1, goalText: m[2].trim(), status: m[3] }));
}

export function summarizeGoals(
  goals: { text: string; progress: number | null }[],
  notes: { body: string; day: string }[]
): GoalSummary[] {
  const newestFirst = [...notes].sort((a, b) => b.day.localeCompare(a.day));
  return goals
    .filter((g) => g.text.trim())
    .map((g, i) => {
      let latestChip: GoalSummary['latestChip'] = null;
      for (const n of newestFirst) {
        const hit = parseProgressChips(n.body).find((c) => c.goalIndex === i || c.goalText === g.text.trim());
        if (hit) {
          latestChip = { status: hit.status, day: n.day };
          break;
        }
      }
      return { text: g.text.trim(), progressPct: g.progress != null && g.progress > 0 ? g.progress : null, latestChip };
    });
}

// ─── Template ──────────────────────────────────────────────────────────────────

const usedLine = (f: AuthForecast) =>
  `${f.visitsUsed} (recorded on auth: ${f.unitsRecorded}; attended visits since start: ${f.visitsAttended})`;

export function templateJustification(facts: RenewalFacts): string {
  const f = facts.forecast;
  const goals = facts.goals.length
    ? facts.goals
        .map((g, i) => `goal ${i + 1} (${g.text}) ${g.latestChip ? `— ${g.latestChip.status.toLowerCase()} as of ${fmtForecastDay(g.latestChip.day)}` : '— no progress rating documented'}`)
        .join('; ')
    : 'no treatment plan goals documented';
  return [
    `The client has attended ${f.visitsAttended} visit${f.visitsAttended === 1 ? '' : 's'} under the current authorization` +
      (f.pacePerWeek > 0 ? ` at a recent pace of ${f.pacePerWeek} per week.` : '.'),
    `Treatment addresses ${facts.diagnoses.length ? facts.diagnoses.join(', ') : 'the documented diagnoses'}.`,
    `Treatment plan progress: ${goals}.`,
    `Continued services are requested at ${facts.request.frequencyLabel.toLowerCase()} to continue work on the treatment plan goals.`,
    '[Staff: add clinical rationale — current symptoms, functional impact and why this level of care remains necessary.]',
  ].join(' ');
}

export function renderRenewalPacket(facts: RenewalFacts, justification: string, generatedOn: string): string {
  const f = facts.forecast;
  const r = facts.request;
  const c = facts.client;
  const lines = [
    'AUTHORIZATION RENEWAL REQUEST — DRAFT FOR STAFF REVIEW',
    'Not submitted. Review, edit and submit through the payer portal or form.',
    '',
    `Payer: ${f.payer}`,
    `Current authorization #: ${f.authNumber || '(none on file)'}`,
    `Client: ${c.name}    DOB: ${c.dateOfBirth ?? '(not on file)'}    Member ID: ${c.memberId ?? '(not on file)'}`,
    `Client ID: ${c.mrn ? `MRN ${c.mrn} / ` : ''}${c.clientId}    Authorization ID: ${f.priorAuthId}`,
    '',
    'CURRENT AUTHORIZATION',
    `Period: ${f.startDate ?? '(no start)'} to ${f.endDate ?? '(open)'}`,
    `Services (CPT): ${f.cptCodes.join(', ') || 'Any service (no CPT on file)'}`,
    `Visits approved: ${f.unitsApproved}`,
    `Visits used: ${usedLine(f)}`,
    `Visits remaining: ${Math.max(f.remaining, 0)}`,
    `Recent pace: ${f.pacePerWeek}/week (${f.paceVisits} visits in the last ${f.paceWindowDays} days)`,
    `Scheduled visits before the end date: ${f.scheduledInWindow}`,
    `Projected run-out: ${f.projectedRunOut ?? 'not projected'}    Forecast: ${f.statusLabel}`,
    '',
    'DIAGNOSES',
    ...(facts.diagnoses.length ? facts.diagnoses.map((d) => `- ${d}`) : ['- (none on file)']),
    '',
    'TREATMENT PLAN',
    facts.plan
      ? `${facts.plan.title}${facts.plan.levelOfCare ? ` · ${facts.plan.levelOfCare}` : ''}${facts.plan.reviewDue ? ` · review due ${facts.plan.reviewDue}` : ''}`
      : '(no active treatment plan on file)',
    ...facts.goals.map(
      (g, i) =>
        `Goal ${i + 1}: ${g.text}${g.progressPct != null ? ` — ${g.progressPct}% progress` : ''}${g.latestChip ? ` — latest note: ${g.latestChip.status} (${g.latestChip.day})` : ''}`
    ),
    `Signed notes in the current period: ${facts.signedNotesInWindow}`,
    '',
    'REQUEST',
    `Frequency: ${r.frequencyLabel}`,
    `Units requested: ${r.units} for ${r.periodStart} to ${r.periodEnd} (${r.periodDays} days)`,
    ...(r.additionalThroughCurrentEnd != null
      ? [`Or additional units for the current period: ${r.additionalThroughCurrentEnd} (projected run-out ${f.projectedRunOut} to end ${f.endDate})`]
      : []),
    '',
    'CLINICAL JUSTIFICATION',
    justification.trim(),
    '',
    `Prepared ${generatedOn} for staff review. Rendering clinician signature: ____________________`,
  ];
  return lines.join('\n');
}

// ─── AI prompt (no identifiers) ────────────────────────────────────────────────

export const RENEWAL_SYSTEM_PROMPT = `You draft the clinical-justification paragraph of a behavioral health prior authorization renewal request for staff review.
Write one paragraph of 120 to 200 words. Use only the facts provided. Refer to the person only as "the client"; never invent names, scores, symptoms, dates or diagnoses.
State the services used so far, progress on treatment plan goals as documented, and why continued services at the requested frequency are needed to meet the goals.
If progress is not documented for a goal, say so. Plain text only, no headings, bullet points or placeholders except where a fact is missing.`;

export function buildRenewalPrompt(facts: RenewalFacts): string {
  const f = facts.forecast;
  const r = facts.request;
  return [
    `Services (CPT): ${f.cptCodes.join(', ') || 'any outpatient service'}`,
    `Current period: ${f.startDate ?? 'unknown'} to ${f.endDate ?? 'open'}; visits approved ${f.unitsApproved}, used ${f.visitsUsed}, remaining ${Math.max(f.remaining, 0)}`,
    `Recent pace: ${f.pacePerWeek} visits per week; scheduled visits before end: ${f.scheduledInWindow}; projected run-out ${f.projectedRunOut ?? 'not projected'}`,
    `Diagnoses: ${facts.diagnoses.join('; ') || 'not documented'}`,
    `Level of care: ${facts.plan?.levelOfCare || 'not documented'}`,
    `Treatment plan goals:\n${
      facts.goals
        .map((g, i) => `${i + 1}. ${g.text} | progress ${g.progressPct != null ? `${g.progressPct}%` : 'not rated'} | latest note rating: ${g.latestChip ? `${g.latestChip.status} (${g.latestChip.day})` : 'none'}`)
        .join('\n') || 'none documented'
    }`,
    `Signed notes this period: ${facts.signedNotesInWindow}`,
    `Requested: ${r.units} units, ${r.frequencyLabel}, ${r.periodStart} to ${r.periodEnd}`,
  ].join('\n');
}

const MAX_JUSTIFICATION = 2500;

export async function draftRenewal(facts: RenewalFacts, deps: RenewalDraftDeps, generatedOn: string): Promise<RenewalDraftResult> {
  const consent = await deps.consent();
  const base = { consent, model: null as string | null };
  const meta = {
    feature: 'auth-renewal-draft',
    priorAuthId: facts.forecast.priorAuthId,
    goalCount: facts.goals.length,
    diagnosisCount: facts.diagnoses.length,
  };
  const template = (reason: RenewalDraftResult['fallbackReason'], warning: string | null): RenewalDraftResult => {
    const justification = templateJustification(facts);
    return { ...base, text: renderRenewalPacket(facts, justification, generatedOn), justification, justificationSource: 'template', fallbackReason: reason, warning };
  };

  if (consent === 'declined') {
    await deps.audit({ action: 'AI_ACCESS', outcome: 'DENIED', metadata: { ...meta, reason: 'consent_declined', sentToModel: false } });
    return template('consent_declined', 'The client declined AI drafting; nothing was sent to the AI model. Template draft only.');
  }
  if (!deps.aiAvailable) {
    return template('ai_unavailable', 'AI drafting is not available on this server; template draft only.');
  }

  // PHI (diagnoses, goals, progress) goes to the model under the AWS BAA: audit before sending
  await deps.audit({ action: 'AI_ACCESS', outcome: 'SUCCESS', metadata: { ...meta, model: deps.model, sentToModel: true, consent } });
  let text: string;
  try {
    text = (await deps.invoke(RENEWAL_SYSTEM_PROMPT, buildRenewalPrompt(facts))).trim();
  } catch {
    return template('ai_failed', 'AI drafting failed; template draft only.');
  }
  if (!text) return template('ai_empty', 'AI returned nothing; template draft only.');
  const justification = text.length > MAX_JUSTIFICATION ? `${text.slice(0, MAX_JUSTIFICATION)}…` : text;
  return {
    consent,
    model: deps.model,
    text: renderRenewalPacket(facts, `${justification}\n[AI draft — review before use]`, generatedOn),
    justification,
    justificationSource: 'ai',
    fallbackReason: null,
    warning: consent === 'missing' ? 'No AI drafting consent on file; review the draft carefully.' : null,
  };
}
