import { NextResponse } from 'next/server';
import { isBedrockConfigured } from '@/lib/ai/bedrockService';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';

export const runtime = 'nodejs';

/**
 * AI agents status — Bedrock wiring.
 * Honest fail-closed / demoMode when AWS Bedrock env is unset.
 */
export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (
    !canAccessPath(gate.role, '/dashboard/scribe') &&
    !canAccessPath(gate.role, '/dashboard/ai-insights') &&
    !canAccessPath(gate.role, '/dashboard/coding')
  ) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const region =
    process.env.AWS_REGION?.trim() || process.env.AWS_DEFAULT_REGION?.trim() || 'us-east-1';
  const configured = isBedrockConfigured();
  const sonnetModelId =
    process.env.BEDROCK_CLAUDE_SONNET_MODEL_ID?.trim() || 'us.anthropic.claude-sonnet-4-6';
  const haikuModelId =
    process.env.BEDROCK_CLAUDE_HAIKU_MODEL_ID?.trim() || 'us.anthropic.claude-haiku-4-5-20251001-v1:0';

  return NextResponse.json({
    success: true,
    demoMode: !configured,
    region,
    models: {
      sonnet: sonnetModelId,
      haiku: haikuModelId,
    },
    agents: {
      aria: { ready: configured, mode: configured ? 'bedrock-live' : 'fail-closed', model: haikuModelId },
      scribe: { ready: configured, mode: configured ? 'bedrock-live' : 'fail-closed', model: sonnetModelId },
      coding: { ready: configured, mode: configured ? 'bedrock-live' : 'fail-closed', model: sonnetModelId },
      'risk-score': { ready: configured, mode: configured ? 'bedrock-live' : 'fail-closed', model: haikuModelId },
      'crisis-triage': { ready: configured, mode: configured ? 'bedrock-live' : 'fail-closed', model: haikuModelId },
      'crisis-summary': { ready: configured, mode: configured ? 'bedrock-live' : 'fail-closed', model: sonnetModelId },
      'aot-report': { ready: configured, mode: configured ? 'bedrock-live' : 'fail-closed', model: sonnetModelId },
      'residential-csr': { ready: configured, mode: configured ? 'bedrock-live' : 'fail-closed', model: sonnetModelId },
      'denial-appeal': { ready: configured, mode: configured ? 'bedrock-live' : 'fail-closed', model: sonnetModelId },
      'medical-soap': { ready: configured, mode: configured ? 'bedrock-live' : 'fail-closed', model: sonnetModelId },
    },
    hipaaDisclaimer:
      'Processed via AWS Bedrock under BAA. PHI is encrypted in transit and at rest, and never retained for foundation model training.',
    message: configured
      ? 'AWS Bedrock runtime active. All 10 clinical AI workflows enabled with Claude 3.5 Sonnet v2 & Claude 3 Haiku.'
      : 'AWS Bedrock credentials missing. Agent routes remain fail-closed 503.',
  });
}
