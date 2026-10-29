import { prisma } from '@/lib/db/prisma';
import { hasAwsRoleOrKeys, resolveAwsCredentials } from './credentials';
import { awsJsonPost } from './sign';

export type TextractAnalyzeResult = {
  demoMode: boolean;
  jobId: string;
  documentType: string;
  pages: number;
  blocks: Array<{ blockType: string; text: string; confidence: number }>;
  keyValues: Record<string, string>;
};

/** Textract runs with static keys or the instance role (AWS_LIVE=true); otherwise 503, never fixtures. */
export function isTextractConfigured(): boolean {
  return hasAwsRoleOrKeys();
}

export function textractNotConfiguredMessage(documentType: string): string {
  return documentType === 'insurance_card' ? 'Card scanning not configured' : 'Document scanning not configured';
}

async function persistJob(input: {
  organizationId: string;
  actorUserId: string;
  documentType: string;
  clientId?: string | null;
  demoMode: boolean;
  result: Omit<TextractAnalyzeResult, 'jobId' | 'demoMode'>;
}): Promise<TextractAnalyzeResult> {
  const row = await prisma.textractJob.create({
    data: {
      organizationId: input.organizationId,
      documentType: input.documentType,
      clientId: input.clientId || null,
      demoMode: input.demoMode,
      createdById: input.actorUserId,
      resultJson: input.result,
    },
  });
  return {
    demoMode: input.demoMode,
    jobId: row.id,
    ...input.result,
  };
}

type DetectDocResponse = {
  Blocks?: Array<{
    BlockType?: string;
    Text?: string;
    Confidence?: number;
  }>;
  DocumentMetadata?: { Pages?: number };
};

function mapBlocks(data: DetectDocResponse) {
  const blocks = (data.Blocks || [])
    .filter((b) => b.Text)
    .slice(0, 40)
    .map((b) => ({
      blockType: b.BlockType || 'UNKNOWN',
      text: b.Text || '',
      confidence: b.Confidence ?? 0,
    }));
  const keyValues: Record<string, string> = {};
  for (const b of blocks) {
    if (b.blockType === 'KEY_VALUE_SET' || b.blockType === 'LINE') {
      const parts = b.text.split(':');
      if (parts.length >= 2) {
        keyValues[parts[0]!.trim()] = parts.slice(1).join(':').trim();
      }
    }
  }
  return {
    pages: data.DocumentMetadata?.Pages || 1,
    blocks,
    keyValues,
  };
}

/** One AnalyzeDocument call; a TextractJob row is saved only for a real result. */
async function runAnalyze(input: {
  organizationId: string;
  actorUserId: string;
  documentType: string;
  clientId?: string | null;
  bytesBase64: string;
  label: string;
}): Promise<{ ok: true; result: TextractAnalyzeResult } | { ok: false; status: number; error: string }> {
  if (!isTextractConfigured()) {
    return { ok: false, status: 503, error: textractNotConfiguredMessage(input.documentType) };
  }
  let creds;
  try {
    creds = await resolveAwsCredentials();
  } catch {
    creds = null;
  }
  if (!creds) return { ok: false, status: 503, error: textractNotConfiguredMessage(input.documentType) };
  const host = `textract.${creds.region}.amazonaws.com`;
  const res = await awsJsonPost<DetectDocResponse>({
    creds,
    service: 'textract',
    host,
    target: 'Textract.AnalyzeDocument',
    body: {
      Document: { Bytes: input.bytesBase64 },
      FeatureTypes: ['FORMS', 'TABLES'],
    },
  });
  if (res.ok === false) {
    return { ok: false, status: res.status, error: `${input.label} failed: ${res.error}` };
  }
  const mapped = mapBlocks(res.data);
  const result = await persistJob({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    documentType: input.documentType,
    clientId: input.clientId,
    demoMode: false,
    result: { documentType: input.documentType, ...mapped },
  });
  return { ok: true, result };
}

/** Analyze a document (base64 bytes). 503 when Textract is not configured. */
export async function analyzeDocument(input: {
  organizationId: string;
  actorUserId: string;
  documentType?: string;
  clientId?: string | null;
  bytesBase64: string;
}): Promise<
  | { ok: true; result: TextractAnalyzeResult }
  | { ok: false; status: number; error: string }
> {
  return runAnalyze({ ...input, documentType: input.documentType || 'general', label: 'Textract AnalyzeDocument' });
}

/** Analyze a medical / intake form. 503 when Textract is not configured. */
export async function analyzeMedicalForm(input: {
  organizationId: string;
  actorUserId: string;
  clientId?: string | null;
  bytesBase64: string;
}): Promise<
  | { ok: true; result: TextractAnalyzeResult }
  | { ok: false; status: number; error: string }
> {
  return runAnalyze({ ...input, documentType: 'medical-form', label: 'Textract medical-form analysis' });
}
