import { prisma } from '@/lib/db/prisma';
import { getAwsCredentials, hasAwsCredentials } from './credentials';
import { awsJsonPost } from './sign';

export type TextractAnalyzeResult = {
  demoMode: boolean;
  jobId: string;
  documentType: string;
  pages: number;
  blocks: Array<{ blockType: string; text: string; confidence: number }>;
  keyValues: Record<string, string>;
};

function demoAnalyze(documentType: string): Omit<TextractAnalyzeResult, 'jobId' | 'demoMode'> {
  if (documentType === 'insurance_card') {
    return {
      documentType,
      pages: 1,
      blocks: [
        { blockType: 'LINE', text: 'Maryland Medicaid', confidence: 98.4 },
        { blockType: 'LINE', text: 'Member: Demo Patient', confidence: 97.1 },
        { blockType: 'LINE', text: 'ID: MD-DEMO-88421', confidence: 96.5 },
        { blockType: 'LINE', text: 'Group: HMO-BH', confidence: 94.2 },
        { blockType: 'LINE', text: 'Effective: 01/01/2026', confidence: 93.8 },
      ],
      keyValues: {
        Payer: 'Maryland Medicaid',
        'Member Name': 'Demo Patient',
        'Member ID': 'MD-DEMO-88421',
        Group: 'HMO-BH',
        'Effective Date': '01/01/2026',
        Plan: 'Healthy Connection BH',
      },
    };
  }
  return {
    documentType,
    pages: 1,
    blocks: [
      { blockType: 'LINE', text: 'Patient Intake Form', confidence: 99.1 },
      { blockType: 'LINE', text: 'Name: [Demo Patient]', confidence: 97.4 },
      { blockType: 'LINE', text: 'DOB: 01/15/1988', confidence: 96.2 },
      { blockType: 'LINE', text: 'Chief Complaint: Anxiety and sleep disturbance', confidence: 94.8 },
    ],
    keyValues: {
      'Patient Name': 'Demo Patient',
      DOB: '01/15/1988',
      'Chief Complaint': 'Anxiety and sleep disturbance',
      Insurance: 'Maryland Medicaid',
    },
  };
}

function demoMedicalForm(): Omit<TextractAnalyzeResult, 'jobId' | 'demoMode'> {
  return {
    documentType: 'medical-form',
    pages: 2,
    blocks: [
      { blockType: 'KEY_VALUE_SET', text: 'PHQ-9 Total', confidence: 98.2 },
      { blockType: 'KEY_VALUE_SET', text: 'GAD-7 Total', confidence: 97.5 },
      { blockType: 'LINE', text: 'Allergies: NKDA', confidence: 95.1 },
      { blockType: 'LINE', text: 'Current meds: sertraline 50mg daily', confidence: 93.8 },
    ],
    keyValues: {
      'PHQ-9 Total': '14',
      'GAD-7 Total': '11',
      Allergies: 'NKDA',
      Medications: 'sertraline 50mg daily',
      'Signature Present': 'Yes',
    },
  };
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

/**
 * Analyze a document (base64 bytes). Demo when AWS keys absent.
 */
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
  const documentType = input.documentType || 'general';

  if (!hasAwsCredentials()) {
    const result = await persistJob({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      documentType,
      clientId: input.clientId,
      demoMode: true,
      result: demoAnalyze(documentType),
    });
    return { ok: true, result };
  }

  const creds = getAwsCredentials()!;
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
    return {
      ok: false,
      status: res.status,
      error: `Textract AnalyzeDocument failed: ${res.error}`,
    };
  }

  const mapped = mapBlocks(res.data);
  const result = await persistJob({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    documentType,
    clientId: input.clientId,
    demoMode: false,
    result: { documentType, ...mapped },
  });
  return { ok: true, result };
}

/**
 * Analyze a medical / intake form. Demo when AWS keys absent.
 */
export async function analyzeMedicalForm(input: {
  organizationId: string;
  actorUserId: string;
  clientId?: string | null;
  bytesBase64: string;
}): Promise<
  | { ok: true; result: TextractAnalyzeResult }
  | { ok: false; status: number; error: string }
> {
  if (!hasAwsCredentials()) {
    const result = await persistJob({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      documentType: 'medical-form',
      clientId: input.clientId,
      demoMode: true,
      result: demoMedicalForm(),
    });
    return { ok: true, result };
  }

  const creds = getAwsCredentials()!;
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
    return {
      ok: false,
      status: res.status,
      error: `Textract medical-form analysis failed: ${res.error}`,
    };
  }

  const mapped = mapBlocks(res.data);
  const result = await persistJob({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    documentType: 'medical-form',
    clientId: input.clientId,
    demoMode: false,
    result: { documentType: 'medical-form', ...mapped },
  });
  return { ok: true, result };
}
