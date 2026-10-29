import { randomBytes } from 'crypto';
import { bedrockClientConfig } from '@/lib/aws/clientConfig';
import { errorCodeOf, httpStatusOf, isThrottleError, recordIntegrationCall } from '@/lib/integrations/callLog/record';
import { bedrockLimiter, bedrockThrottleRetries } from '@/lib/ai/bedrockPacing';
import { withThrottleRetry } from '@/lib/ai/chartDigest/concurrency';
import {
  ApplyGuardrailCommand,
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';

export const BEDROCK_MODELS = {
  // US-only cross-region inference profiles (not global.*) so PHI stays in US regions.
  // Newest models this AWS account is entitled to; override per environment once 5.x access is granted.
  SONNET: process.env.BEDROCK_CLAUDE_SONNET_MODEL_ID || 'us.anthropic.claude-sonnet-4-6',
  HAIKU: process.env.BEDROCK_CLAUDE_HAIKU_MODEL_ID || 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
} as const;

let cachedClient: BedrockRuntimeClient | null = null;

function hasStaticKeys(): boolean {
  return Boolean(process.env.AWS_ACCESS_KEY_ID?.trim() && process.env.AWS_SECRET_ACCESS_KEY?.trim());
}

/** Static keys, or AWS_LIVE=true on a server whose instance role grants bedrock:InvokeModel */
export function isBedrockConfigured(): boolean {
  return hasStaticKeys() || process.env.AWS_LIVE === 'true';
}

export function getBedrockClient(): BedrockRuntimeClient | null {
  if (!isBedrockConfigured()) return null;
  if (!cachedClient) {
    cachedClient = new BedrockRuntimeClient({
      ...bedrockClientConfig(),
      region: process.env.AWS_REGION?.trim() || 'us-east-1',
      // Without static keys the SDK's default chain picks up the instance role
      ...(hasStaticKeys()
        ? {
            credentials: {
              accessKeyId: process.env.AWS_ACCESS_KEY_ID!.trim(),
              secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!.trim(),
              ...(process.env.AWS_SESSION_TOKEN ? { sessionToken: process.env.AWS_SESSION_TOKEN.trim() } : {}),
            },
          }
        : {}),
    });
  }
  return cachedClient;
}

/**
 * Which Bedrock guardrail a call runs under (docs/ai-guardrails.md):
 * - 'clinical' (default): scribe, briefs, notes, coding, clinical summaries, document intake, billing
 *   letters. Clinical risk language passes; only prompt attacks are blocked; SSN / payment numbers in
 *   the reply are masked.
 * - 'general': marketing, reputation replies, HR drafts, HR policy Q&A. Strict content filters, no
 *   individual medical advice, SSN / payment numbers blocked, optional grounding check.
 */
export type AiGuard = 'clinical' | 'general';

export interface InvokeBedrockOptions {
  model: 'SONNET' | 'HAIKU';
  system: string;
  userPrompt: string;
  maxTokens?: number;
  temperature?: number;
  jsonMode?: boolean;
  guard?: AiGuard;
  /**
   * 'general' only: check the reply is supported by this source text (e.g. the handbook sections an
   * HR answer must come from). An unsupported reply throws AiSafetyBlockedError('not_grounded').
   */
  grounding?: { source: string; query: string };
  /** Token counts Bedrock reports for this call (cost accounting; counts only) */
  onUsage?: (usage: { inputTokens: number; outputTokens: number }) => void;
  /** Integration log only: feature name (e.g. scribe_note), practice, patient, user. Never the prompt. */
  logContext?: { feature?: string; organizationId?: string | null; clientId?: string | null; actorUserId?: string | null };
}

/** The guardrails' blocked-message prefix, used to tell a block from a masked reply. */
export const AI_SAFETY_BLOCK_MARK = '[Altrixs AI safety filter]';

export class AiSafetyBlockedError extends Error {
  readonly code = 'AI_SAFETY_BLOCKED';
  constructor(
    readonly reason: 'blocked' | 'not_grounded',
    readonly guard: AiGuard
  ) {
    super(
      reason === 'not_grounded'
        ? 'The AI answer was not supported by the source text, so it was not used.'
        : 'The AI safety filter blocked this request, so nothing was generated.'
    );
    this.name = 'AiSafetyBlockedError';
  }
}

/** Guardrail id + version for a call, from BEDROCK_GUARDRAIL_{CLINICAL|GENERAL}_{ID|VERSION}; null = none set. */
export function guardrailFor(guard: AiGuard): { id: string; version: string } | null {
  const key = guard === 'general' ? 'GENERAL' : 'CLINICAL';
  const id = process.env[`BEDROCK_GUARDRAIL_${key}_ID`]?.trim();
  if (!id) return null;
  return { id, version: process.env[`BEDROCK_GUARDRAIL_${key}_VERSION`]?.trim() || 'DRAFT' };
}

/** User prompt wrapped in the guardrail's input tags (InvokeModel input tagging). */
export function guardrailTagged(userPrompt: string, tagSuffix: string): string {
  return `<amazon-bedrock-guardrails-guardContent_${tagSuffix}>${userPrompt}</amazon-bedrock-guardrails-guardContent_${tagSuffix}>`;
}

/** Citation tags like [S1] are not part of the claim and lower the grounding score; drop them before the check. */
export function textForGroundingCheck(reply: string): string {
  return reply.replace(/\s*\[S\d+\]/g, '').trim();
}

/**
 * Centrally invoke Anthropic Claude on AWS Bedrock (Claude 3.5 Sonnet v2 or Claude 3 Haiku).
 * Supports JSON prefill, guardrails, temperature, and system instructions.
 */
export async function invokeBedrock(opts: InvokeBedrockOptions): Promise<string> {
  // Integration log: model, tokens, latency and guardrail outcome only (never prompt or output)
  const startedAt = new Date();
  let usage: { inputTokens: number; outputTokens: number } | null = null;
  const base = {
    integration: 'bedrock' as const,
    operation: 'invoke_model',
    direction: 'outbound' as const,
    organizationId: opts.logContext?.organizationId ?? null,
    clientId: opts.logContext?.clientId ?? null,
    actorUserId: opts.logContext?.actorUserId ?? null,
  };
  const meta = (guardrailOutcome: string) => ({
    model: opts.model,
    modelId: BEDROCK_MODELS[opts.model] ?? null,
    feature: opts.logContext?.feature ?? null,
    guard: opts.guard ?? 'clinical',
    guardrail: guardrailFor(opts.guard ?? 'clinical') ? 'on' : 'off',
    guardrailOutcome,
    inputTokens: usage?.inputTokens ?? null,
    outputTokens: usage?.outputTokens ?? null,
  });
  // Paced under the account's per-minute quota (bedrockPacing.ts); a call Bedrock still throttles is retried with backoff
  let retries = 0;
  let waitedMs = 0;
  const paced = () => ({ retries, waitedMs: waitedMs || null });
  try {
    const text = await withThrottleRetry(
      async () => {
        waitedMs += await bedrockLimiter(opts.model).acquire();
        return invokeBedrockCore({
          ...opts,
          onUsage: (u) => {
            usage = u;
            opts.onUsage?.(u);
          },
        });
      },
      { retries: bedrockThrottleRetries(), baseMs: 2000, maxMs: 20_000, onRetry: () => retries++ }
    );
    await recordIntegrationCall({ ...base, status: 'success', startedAt, metadata: { ...meta(opts.grounding ? 'grounded' : 'passed'), ...paced() } });
    return text;
  } catch (err) {
    const blocked = err instanceof AiSafetyBlockedError;
    const throttled = !blocked && isThrottleError(err);
    await recordIntegrationCall({
      ...base,
      status: blocked ? 'success' : throttled ? 'throttled' : 'error',
      vendorStatus: blocked ? `guardrail_${err.reason}` : null,
      startedAt,
      httpStatus: httpStatusOf(err),
      errorCode: blocked ? 'AI_SAFETY_BLOCKED' : errorCodeOf(err),
      errorMessage: blocked ? err.message : err,
      // The guardrail never ran when the call itself failed: say why instead of a bare 'error'
      metadata: { ...meta(blocked ? err.reason : throttled ? 'not_run_throttled' : 'not_run_error'), ...paced() },
    });
    throw err;
  }
}

async function invokeBedrockCore({
  model,
  system,
  userPrompt,
  maxTokens = 1500,
  temperature = 0.2,
  jsonMode = false,
  guard = 'clinical',
  grounding,
  onUsage,
}: InvokeBedrockOptions): Promise<string> {
  const client = getBedrockClient();
  if (!client) {
    throw new Error('AWS_BEDROCK_NOT_CONFIGURED: Missing AWS credentials or Bedrock client initialization.');
  }

  const modelId = BEDROCK_MODELS[model];
  const guardrail = guardrailFor(guard);
  // The guardrail's prompt-attack filter only checks input inside its tags. Tag the user prompt (our
  // own system prompt stays untagged); a random suffix per call so content can't close the tag itself.
  const tagSuffix = guardrail ? randomBytes(6).toString('hex') : null;
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
    { role: 'user', content: tagSuffix ? guardrailTagged(userPrompt, tagSuffix) : userPrompt },
  ];
  // No assistant prefill: current Claude models don't accept it. Ask for JSON and extract it below.
  const payload = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: maxTokens,
    temperature,
    system: jsonMode
      ? `${system}\n\nRespond with only a single JSON object: no prose, no code fences.`
      : system,
    messages,
    ...(tagSuffix ? { 'amazon-bedrock-guardrailConfig': { tagSuffix } } : {}),
  };

  const command = new InvokeModelCommand({
    modelId,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(payload),
    ...(guardrail ? { guardrailIdentifier: guardrail.id, guardrailVersion: guardrail.version } : {}),
  });

  const response = await client.send(command);
  const decoded = JSON.parse(new TextDecoder().decode(response.body));
  if (onUsage) {
    const u = decoded.usage ?? {};
    onUsage({ inputTokens: Number(u.input_tokens) || 0, outputTokens: Number(u.output_tokens) || 0 });
  }
  const blocks: Array<{ type?: string; text?: string }> = Array.isArray(decoded.content) ? decoded.content : [];
  const text = blocks
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('');
  // A guardrail block replaces the reply with its blocked message; a masked reply (SSN / card) is kept
  if (decoded['amazon-bedrock-guardrailAction'] === 'INTERVENED' && text.trim().startsWith(AI_SAFETY_BLOCK_MARK)) {
    throw new AiSafetyBlockedError('blocked', guard);
  }
  if (grounding && guard === 'general' && guardrail && text.trim()) {
    await assertGrounded(client, guardrail, grounding, text);
  }
  if (jsonMode) return firstJsonObject(text) ?? text;
  return text;
}

/** Contextual grounding check (general guardrail): the reply must be supported by the source. */
async function assertGrounded(
  client: BedrockRuntimeClient,
  guardrail: { id: string; version: string },
  grounding: { source: string; query: string },
  reply: string
): Promise<void> {
  const res = await client.send(
    new ApplyGuardrailCommand({
      guardrailIdentifier: guardrail.id,
      guardrailVersion: guardrail.version,
      source: 'OUTPUT',
      content: [
        { text: { text: grounding.source.slice(0, 100_000), qualifiers: ['grounding_source'] } },
        { text: { text: grounding.query.slice(0, 1_000), qualifiers: ['query'] } },
        { text: { text: textForGroundingCheck(reply).slice(0, 5_000), qualifiers: ['guard_content'] } },
      ],
    })
  );
  const ungrounded = (res.assessments ?? []).some((a) =>
    (a.contextualGroundingPolicy?.filters ?? []).some((f) => f.action === 'BLOCKED')
  );
  if (res.action === 'GUARDRAIL_INTERVENED' && ungrounded) throw new AiSafetyBlockedError('not_grounded', 'general');
}

/**
 * The first complete top-level JSON object in a reply. Models sometimes add prose or a second
 * object after the first; slicing from the first "{" to the last "}" would join them into invalid JSON.
 */
export function firstJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}
