/**
 * HR AI assists (server-side only, AWS Bedrock under the practice BAA). Staff data only: no client
 * PHI is ever sent. Every result is an AiDraft ({ status: 'draft', saved: false }): these
 * functions never write to the HR record; a person reviews, edits and saves through the normal
 * forms. Each feature is off until leadership turns it on in HR settings. When Bedrock is not
 * configured (or fails) a deterministic rules version is returned and labeled as such.
 */
import { firstJsonObject, invokeBedrock, isBedrockConfigured } from '@/lib/ai/bedrockService';
import { awsJsonPost } from '@/lib/aws/sign';
import { hasAwsRoleOrKeys, resolveAwsCredentials } from '@/lib/aws/credentials';
import {
  aiDraft,
  extractCredentialFields,
  retrievePolicySections,
  type AiDraft,
  type ExtractedCredential,
  type HrAiFeature,
  type PolicySection,
} from './standard';
import type { HrSettingsView } from './server';

export function aiFeatureEnabled(settings: HrSettingsView, feature: HrAiFeature): boolean {
  return Boolean(settings[feature]);
}

async function model(
  system: string,
  userPrompt: string,
  maxTokens = 1200,
  grounding?: { source: string; query: string }
): Promise<string | null> {
  if (!isBedrockConfigured()) return null;
  try {
    // Staff data only (no client PHI): the general guardrail
    return await invokeBedrock({ model: 'HAIKU', system, userPrompt, maxTokens, temperature: 0.2, guard: 'general', grounding });
  } catch (err) {
    console.error('[hr ai] bedrock failed', err instanceof Error ? err.message : err);
    return null;
  }
}

// ─── (a) Document intelligence ───────────────────────────────────────────────

/** OCR with Textract DetectDocumentText (images / single-page PDF). Nothing is persisted. */
export async function ocrDocument(bytes: Buffer): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  if (!hasAwsRoleOrKeys()) return { ok: false, error: 'Document scanning is not configured on this server' };
  const creds = await resolveAwsCredentials().catch(() => null);
  if (!creds) return { ok: false, error: 'Document scanning is not configured on this server' };
  const res = await awsJsonPost<{ Blocks?: Array<{ BlockType?: string; Text?: string }> }>({
    creds,
    service: 'textract',
    host: `textract.${creds.region}.amazonaws.com`,
    target: 'Textract.DetectDocumentText',
    body: { Document: { Bytes: bytes.toString('base64') } },
  });
  if (res.ok === false) return { ok: false, error: 'Could not read the document. Use a clear image or a one-page PDF.' };
  const text = (res.data.Blocks || [])
    .filter((b) => b.BlockType === 'LINE' && b.Text)
    .map((b) => b.Text)
    .join('\n');
  return { ok: true, text };
}

const EXTRACT_SYSTEM = `You read a staff credential document (professional license, DEA or state CDS registration, certificate, CPR card, malpractice certificate of insurance) for a Maryland behavioral health practice's HR team.
Return ONLY a JSON object with these keys (null when not present in the text; never guess):
{"credentialType":"LICENSE|DEA|CDS|CERTIFICATION|BOARD_CERTIFICATION|CPR_BLS|MALPRACTICE|null","licenseType":"e.g. LCSW-C, LCPC, LGPC, LMSW, MD, CRNP-PMH or null","licenseNumber":string|null,"holderName":string|null,"issuer":string|null,"state":"two-letter or null","issuedAt":"YYYY-MM-DD or null","expiresAt":"YYYY-MM-DD or null","carrier":string|null,"policyNumber":string|null,"perClaimLimit":string|null,"aggregateLimit":string|null,"notes":[short strings about anything unclear]}`;

export async function extractCredentialDraft(text: string): Promise<AiDraft<ExtractedCredential & Record<string, unknown>>> {
  const rules = extractCredentialFields(text);
  const out = await model(EXTRACT_SYSTEM, `Document text:\n"""\n${text.slice(0, 12000)}\n"""`, 800);
  if (out) {
    try {
      const parsed = JSON.parse(firstJsonObject(out) || '{}') as Record<string, unknown>;
      const pick = (k: string) => (typeof parsed[k] === 'string' && (parsed[k] as string).trim() ? (parsed[k] as string).trim() : null);
      const date = (k: string) => (pick(k) && /^\d{4}-\d{2}-\d{2}$/.test(pick(k)!) ? pick(k) : null);
      return aiDraft(
        'document_extract',
        {
          credentialType: pick('credentialType') ?? rules.credentialType,
          licenseType: pick('licenseType') ?? rules.licenseType,
          licenseNumber: pick('licenseNumber') ?? rules.licenseNumber,
          holderName: pick('holderName') ?? rules.holderName,
          issuer: pick('issuer') ?? rules.issuer,
          state: pick('state') ?? rules.state,
          issuedAt: date('issuedAt') ?? rules.issuedAt,
          expiresAt: date('expiresAt') ?? rules.expiresAt,
          carrier: pick('carrier'),
          policyNumber: pick('policyNumber'),
          perClaimLimit: pick('perClaimLimit'),
          aggregateLimit: pick('aggregateLimit'),
          confidence: 'medium',
          notes: Array.isArray(parsed.notes) ? (parsed.notes as unknown[]).map(String).slice(0, 5) : [],
        },
        'bedrock',
        'AI read this document. Check every field against the document before saving.',
      );
    } catch {
      // fall through to rules
    }
  }
  return aiDraft('document_extract', { ...rules }, 'rules', 'Fields found by text matching. Check every field against the document before saving.');
}

// ─── (b) Job description / offer letter ──────────────────────────────────────

export type WritingInput = {
  kind: 'job_description' | 'offer_letter';
  jobTitle: string;
  role?: string | null;
  location?: string | null;
  program?: string | null;
  workerType?: string | null;
  payType?: string | null;
  /** Only what HR typed; never invented */
  payText?: string | null;
  candidateName?: string | null;
  startDate?: string | null;
  supervisorTitle?: string | null;
  practiceName?: string | null;
  extra?: string | null;
};

function writingFallback(i: WritingInput): string {
  const practice = i.practiceName || '[Practice name]';
  const pay = i.payText?.trim() || '[Pay: confirm before sending]';
  if (i.kind === 'offer_letter') {
    return [
      `[Date]`,
      ``,
      `Dear ${i.candidateName || '[Candidate name]'},`,
      ``,
      `We are pleased to offer you the position of ${i.jobTitle} with ${practice}${i.location ? ` at our ${i.location} location` : ''}${i.program ? ` (${i.program})` : ''}.`,
      ``,
      `Start date: ${i.startDate || '[Start date]'}`,
      `Classification: ${i.workerType === '1099' ? 'Independent contractor (1099)' : i.workerType === 'PER_DIEM' ? 'Per diem employee' : 'Employee (W-2)'}`,
      `Compensation: ${pay}${i.payType ? ` (${i.payType.replace('_', ' ')})` : ''}`,
      `Reports to: ${i.supervisorTitle || '[Supervisor title]'}`,
      ``,
      `This offer is contingent on a satisfactory background check, exclusion screening (OIG, SAM.gov and Maryland Medicaid), verification of required licenses and credentials, and completion of Form I-9.`,
      ``,
      `Employment with ${practice} is at will. [Benefits summary: confirm with HR.]`,
      ``,
      `Please sign and return this letter by [date].`,
      ``,
      `Sincerely,`,
      `[Name, title]`,
    ].join('\n');
  }
  return [
    `${i.jobTitle}`,
    `${practice}${i.location ? ` · ${i.location}` : ''}${i.program ? ` · ${i.program}` : ''}`,
    ``,
    `About the role`,
    `[Two to three sentences about the team and the people we serve.]`,
    ``,
    `Responsibilities`,
    `- [Core duty 1]`,
    `- [Core duty 2]`,
    `- Complete documentation within the practice's note timeliness standard`,
    `- Follow HIPAA, 42 CFR Part 2 and practice policies`,
    ``,
    `Qualifications`,
    `- [License / certification required in Maryland]`,
    `- [Experience]`,
    ``,
    `Classification: ${i.workerType || '[W-2 / 1099 / per diem]'} · Pay: ${pay}`,
  ].join('\n');
}

export async function writingDraft(input: WritingInput): Promise<AiDraft<{ text: string; kind: string }>> {
  const system = `You draft HR documents for a Maryland outpatient behavioral health and primary care practice. Write plain, warm, professional text.
Rules: never invent pay amounts, benefits, dates or names; when a value is not given, write a bracketed placeholder like [Pay: confirm]. Do not promise anything not stated. Include contingencies (background check, exclusion screening, credential verification, I-9) in offer letters. No legal advice. Output the document text only.`;
  const prompt = JSON.stringify({ ...input, practiceName: input.practiceName || null });
  const out = await model(system, `Draft a ${input.kind === 'offer_letter' ? 'job offer letter' : 'job description'} from these facts:\n${prompt}`, 1400);
  if (out?.trim()) return aiDraft('writing', { text: out.trim(), kind: input.kind }, 'bedrock', 'AI draft. Edit, confirm every bracketed item, and have HR approve before sending.');
  return aiDraft('writing', { text: writingFallback(input), kind: input.kind }, 'rules', 'Template draft. Fill in every bracketed item before sending.');
}

// ─── (c) Performance review assistant ────────────────────────────────────────

export type ReviewAssistInput = {
  reviewType: string;
  periodLabel: string;
  goals: Array<{ title: string; status: string; progressPct: number; description?: string | null }>;
  managerNotes: string | null;
  selfReview: string | null;
  metrics: { onTimePct?: number | null; total?: number; signedOnTime?: number; deadlineHours?: number } | null;
};

export async function reviewDraft(input: ReviewAssistInput): Promise<AiDraft<{ text: string }>> {
  const system = `You help a supervisor at a behavioral health practice write an employee performance review.
Use ONLY the goals, manager notes, self review and documentation counts provided. Refer to the person as "the employee". Do not invent events, numbers or clinical details, and do not include any client information. Structure: Summary; Strengths; Goals progress (one line per goal); Areas to develop; Documentation timeliness (only if counts are given); Suggested goals for next period. Mark it as a draft for the manager to edit.`;
  const out = await model(system, JSON.stringify(input).slice(0, 12000), 1400);
  if (out?.trim()) return aiDraft('review_assist', { text: out.trim() }, 'bedrock', 'AI draft built from goals and your notes. Edit before signing.');
  const lines = [
    `DRAFT: ${input.reviewType.replace('_', ' ')} review, ${input.periodLabel}`,
    ``,
    `Summary`,
    `[Overall summary]`,
    ``,
    `Goals progress`,
    ...(input.goals.length ? input.goals.map((g) => `- ${g.title}: ${g.status.replace('_', ' ')} (${g.progressPct}%)`) : ['- No goals recorded for this period']),
    ``,
    `Manager notes`,
    input.managerNotes?.trim() || '[No notes yet]',
    ...(input.metrics?.onTimePct != null
      ? ['', 'Documentation timeliness', `- ${input.metrics.signedOnTime} of ${input.metrics.total} notes signed within ${input.metrics.deadlineHours} hours (${input.metrics.onTimePct}%)`]
      : []),
    ``,
    `Areas to develop`,
    `[Areas to develop]`,
  ];
  return aiDraft('review_assist', { text: lines.join('\n') }, 'rules', 'Outline from goals and notes. Edit before signing.');
}

// ─── (d) Handbook Q&A ────────────────────────────────────────────────────────

export const POLICY_QA_DISCLAIMER = "Answers come only from the practice's uploaded policies. This is not legal advice; ask HR when in doubt.";

export async function policyAnswer(
  question: string,
  sections: PolicySection[],
): Promise<AiDraft<{ answer: string; citations: Array<{ policyTitle: string; heading: string; sectionId: string; policyId: string }>; found: boolean }>> {
  const top = retrievePolicySections(question, sections, 4);
  const citations = top.map((s) => ({ policyTitle: s.policyTitle, heading: s.heading, sectionId: s.sectionId, policyId: s.policyId }));
  if (!top.length) {
    return aiDraft('policy_qa', { answer: 'The uploaded policies do not cover this. Ask HR.', citations: [], found: false }, 'rules', POLICY_QA_DISCLAIMER);
  }
  const context = top.map((s, i) => `[S${i + 1}] ${s.policyTitle} > ${s.heading}\n${s.text.slice(0, 2500)}`).join('\n\n');
  const system = `You answer staff questions about their employer's HR policies using ONLY the sections given. Cite sections like [S1]. If the sections do not answer the question, say so and suggest asking HR. Never give legal advice or add rules that are not in the text. Keep it under 150 words.`;
  // Grounding check: an answer the handbook sections don't support is dropped (falls back to the excerpts below)
  const out = await model(system, `Sections:\n${context}\n\nQuestion: ${question.slice(0, 500)}`, 500, {
    source: top.map((s) => `${s.policyTitle} > ${s.heading}\n${s.text.slice(0, 2500)}`).join('\n\n'),
    query: question.slice(0, 500),
  });
  if (out?.trim()) return aiDraft('policy_qa', { answer: out.trim(), citations, found: true }, 'bedrock', POLICY_QA_DISCLAIMER);
  const excerpt = top.map((s, i) => `[S${i + 1}] ${s.heading}: ${s.text.slice(0, 300)}${s.text.length > 300 ? '…' : ''}`).join('\n\n');
  return aiDraft('policy_qa', { answer: `These sections look relevant:\n\n${excerpt}`, citations, found: true }, 'rules', POLICY_QA_DISCLAIMER);
}

// ─── (e) Smart reminders digest ──────────────────────────────────────────────

export type DigestFacts = {
  weekLabel: string;
  licensesExpiring: number;
  licensesExpired: number;
  credentialsDue: number;
  exclusionChecksDue: number;
  caqhDue: number;
  trainingsOverdue: number;
  onboardingTasksOverdue: number;
  timeOffPending: number;
  reviewsDue: number;
  changeRequestsPending: number;
};

export function digestFallback(f: DigestFacts): string {
  const parts: string[] = [];
  const add = (n: number, one: string, many: string) => n > 0 && parts.push(`${n} ${n === 1 ? one : many}`);
  add(f.licensesExpired, 'license expired', 'licenses expired');
  add(f.licensesExpiring, 'license expiring', 'licenses expiring');
  add(f.credentialsDue, 'other credential due', 'other credentials due');
  add(f.exclusionChecksDue, 'staff member due for exclusion checks', 'staff due for exclusion checks');
  add(f.caqhDue, 'CAQH re-attestation due', 'CAQH re-attestations due');
  add(f.trainingsOverdue, 'training overdue', 'trainings overdue');
  add(f.onboardingTasksOverdue, 'onboarding / offboarding task overdue', 'onboarding / offboarding tasks overdue');
  add(f.timeOffPending, 'time-off request waiting', 'time-off requests waiting');
  add(f.reviewsDue, 'review due', 'reviews due');
  add(f.changeRequestsPending, 'profile change to approve', 'profile changes to approve');
  return parts.length ? `${f.weekLabel}: ${parts.join(', ')}.` : `${f.weekLabel}: nothing needs attention.`;
}

/** Counts only go to the model (no names); the UI lists the people from the engine. */
export async function digestDraft(facts: DigestFacts): Promise<AiDraft<{ text: string }>> {
  const system = `Write a short weekly HR to-do digest (3 to 5 sentences, plain language, most urgent first) from these counts for a behavioral health practice HR team. Do not add facts or numbers.`;
  const out = await model(system, JSON.stringify(facts), 300);
  if (out?.trim()) return aiDraft('digest', { text: out.trim() }, 'bedrock', 'AI summary of the counts below.');
  return aiDraft('digest', { text: digestFallback(facts) }, 'rules', 'Summary of the counts below.');
}
