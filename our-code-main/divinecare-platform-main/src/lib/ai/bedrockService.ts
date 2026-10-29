import { randomBytes } from 'node:crypto';
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';

export const BEDROCK_MODELS = {
  SONNET: process.env.BEDROCK_CLAUDE_SONNET_MODEL_ID || 'us.anthropic.claude-sonnet-4-20250514-v1:0',
  HAIKU: process.env.BEDROCK_CLAUDE_HAIKU_MODEL_ID || 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
} as const;

/** Exact block mark from staging — throw when present after guardrail intervention. */
export const AI_SAFETY_BLOCK_MARK = '[Altrixs AI safety filter]';
export const AI_SAFETY_BLOCKED_MESSAGE =
  'The AI safety filter blocked this request, so nothing was generated.';
export const AI_SAFETY_NOT_GROUNDED_MESSAGE =
  'The AI answer was not supported by the source text, so it was not used.';

export type BedrockGuard = 'clinical' | 'general';

export class AiSafetyBlockedError extends Error {
  readonly code = 'AI_SAFETY_BLOCKED' as const;
  constructor(message = AI_SAFETY_BLOCKED_MESSAGE) {
    super(message);
    this.name = 'AiSafetyBlockedError';
  }
}

let cachedClient: BedrockRuntimeClient | null = null;

export function isBedrockConfigured(): boolean {
  return Boolean(process.env.AWS_ACCESS_KEY_ID?.trim() && process.env.AWS_SECRET_ACCESS_KEY?.trim());
}

export function getBedrockClient(): BedrockRuntimeClient | null {
  if (!isBedrockConfigured()) return null;
  if (!cachedClient) {
    cachedClient = new BedrockRuntimeClient({
      region: process.env.AWS_REGION?.trim() || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!.trim(),
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!.trim(),
        ...(process.env.AWS_SESSION_TOKEN ? { sessionToken: process.env.AWS_SESSION_TOKEN.trim() } : {}),
      },
    });
  }
  return cachedClient;
}

/** Dual guardrails — never use deprecated BEDROCK_GUARDRAIL_ID. */
export function resolveGuardrail(guard: BedrockGuard = 'clinical'): {
  identifier?: string;
  version?: string;
} {
  if (guard === 'general') {
    const id = process.env.BEDROCK_GUARDRAIL_GENERAL_ID?.trim();
    if (!id) return {};
    return {
      identifier: id,
      version: process.env.BEDROCK_GUARDRAIL_GENERAL_VERSION?.trim() || 'DRAFT',
    };
  }
  const id = process.env.BEDROCK_GUARDRAIL_CLINICAL_ID?.trim();
  if (!id) return {};
  return {
    identifier: id,
    version: process.env.BEDROCK_GUARDRAIL_CLINICAL_VERSION?.trim() || 'DRAFT',
  };
}

export interface BedrockChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface InvokeBedrockOptions {
  model: 'SONNET' | 'HAIKU';
  system: string;
  userPrompt?: string;
  messages?: BedrockChatMessage[];
  maxTokens?: number;
  temperature?: number;
  jsonMode?: boolean;
  /** Default clinical. Marketing/HR must pass general. */
  guard?: BedrockGuard;
  /** HR policy Q&A: grounding 0.7, relevance 0.5 */
  grounding?: { groundingThreshold?: number; relevanceThreshold?: number };
}

function wrapUserGuardContent(text: string): string {
  const suffix = randomBytes(6).toString('hex');
  return `<guardrail_user_prompt_${suffix}>\n${text}\n</guardrail_user_prompt_${suffix}>`;
}

/** Strip grounding citations like [S1] from replies. */
export function stripGroundingCitations(text: string): string {
  return text.replace(/\[S\d+\]/g, '').replace(/ {2,}/g, ' ').trim();
}

/**
 * Centrally invoke Anthropic Claude on AWS Bedrock with dual guardrails.
 */
export async function invokeBedrock({
  model,
  system,
  userPrompt,
  messages: customMessages,
  maxTokens = 1500,
  temperature = 0.2,
  jsonMode = false,
  guard = 'clinical',
  grounding,
}: InvokeBedrockOptions): Promise<string> {
  const client = getBedrockClient();
  if (!client) {
    throw new Error('AWS_BEDROCK_NOT_CONFIGURED: Missing AWS credentials or Bedrock client initialization.');
  }

  const modelId = BEDROCK_MODELS[model];
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> =
    customMessages && customMessages.length > 0
      ? customMessages.map((m) => ({
          role: m.role,
          content: m.role === 'user' ? wrapUserGuardContent(m.content) : m.content,
        }))
      : [{ role: 'user', content: wrapUserGuardContent(userPrompt || '') }];

  if (jsonMode) {
    messages.push({ role: 'assistant', content: '{' });
  }

  const payload: Record<string, unknown> = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: maxTokens,
    temperature,
    system,
    messages,
  };

  if (grounding) {
    payload.amazon_bedrock_guardrail_config = {
      tagSuffix: 'altrixs',
      streamProcessingMode: 'sync',
      ...(grounding.groundingThreshold != null || grounding.relevanceThreshold != null
        ? {
            groundingConfig: {
              groundingThreshold: grounding.groundingThreshold ?? 0.7,
              relevanceThreshold: grounding.relevanceThreshold ?? 0.5,
            },
          }
        : {}),
    };
  }

  const rail = resolveGuardrail(guard);
  const command = new InvokeModelCommand({
    modelId,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(payload),
    ...(rail.identifier
      ? {
          guardrailIdentifier: rail.identifier,
          guardrailVersion: rail.version || 'DRAFT',
        }
      : {}),
  });

  const response = await client.send(command, { abortSignal: AbortSignal.timeout(20_000) });
  const decoded = JSON.parse(new TextDecoder().decode(response.body));
  let text = String(decoded.content?.[0]?.text ?? '');
  if (jsonMode && !text.startsWith('{')) {
    text = '{' + text;
  }

  const stopReason = String(decoded.stop_reason || '');
  const intervened =
    stopReason === 'guardrail_intervened' ||
    Boolean(decoded['amazon-bedrock-guardrailAction']) ||
    Boolean(decoded.amazonBedrockGuardrailAction);

  if (intervened && text.trimStart().startsWith(AI_SAFETY_BLOCK_MARK)) {
    throw new AiSafetyBlockedError();
  }

  // Masked replies without block mark are returned as-is (prompt §2.5).
  return stripGroundingCitations(text);
}
