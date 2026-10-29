import { getAwsCredentials, hasAwsCredentials } from './credentials';
import { awsJsonPost } from './sign';

export type ComprehendEntity = {
  text: string;
  category: string;
  type: string;
  score: number;
};

export type ComprehendCode = {
  code: string;
  description: string;
  score: number;
};

export type ComprehendAnalyzeResult = {
  demoMode: boolean;
  entities: ComprehendEntity[];
  icd10: ComprehendCode[];
  medications: ComprehendCode[];
  raw?: unknown;
};

function demoResult(text: string): ComprehendAnalyzeResult {
  const lower = text.toLowerCase();
  const entities: ComprehendEntity[] = [];
  const icd10: ComprehendCode[] = [];
  const medications: ComprehendCode[] = [];

  if (/depress|phq|sad|anhedon/.test(lower)) {
    entities.push({
      text: 'depression',
      category: 'MEDICAL_CONDITION',
      type: 'DX_NAME',
      score: 0.92,
    });
    icd10.push({
      code: 'F32.1',
      description: 'Major depressive disorder, single episode, moderate',
      score: 0.88,
    });
  }
  if (/anxiet|worry|gad|panic/.test(lower)) {
    entities.push({
      text: 'anxiety',
      category: 'MEDICAL_CONDITION',
      type: 'DX_NAME',
      score: 0.9,
    });
    icd10.push({
      code: 'F41.1',
      description: 'Generalized anxiety disorder',
      score: 0.85,
    });
  }
  if (/ptsd|trauma|flashback/.test(lower)) {
    entities.push({
      text: 'PTSD',
      category: 'MEDICAL_CONDITION',
      type: 'DX_NAME',
      score: 0.87,
    });
    icd10.push({
      code: 'F43.10',
      description: 'Post-traumatic stress disorder, unspecified',
      score: 0.82,
    });
  }
  if (/suicid|si\b|self.?harm/.test(lower)) {
    entities.push({
      text: 'suicidal ideation',
      category: 'MEDICAL_CONDITION',
      type: 'DX_NAME',
      score: 0.95,
    });
  }
  if (/sertraline|zoloft/.test(lower)) {
    medications.push({ code: '312938', description: 'sertraline', score: 0.94 });
    entities.push({
      text: 'sertraline',
      category: 'MEDICATION',
      type: 'GENERIC_NAME',
      score: 0.94,
    });
  }
  if (/escitalopram|lexapro/.test(lower)) {
    medications.push({ code: '352363', description: 'escitalopram', score: 0.93 });
  }
  if (/bupropion|wellbutrin/.test(lower)) {
    medications.push({ code: '993551', description: 'bupropion', score: 0.91 });
  }
  if (/cbt|cognitive behavioral/.test(lower)) {
    entities.push({
      text: 'CBT',
      category: 'TEST_TREATMENT_PROCEDURE',
      type: 'TREATMENT_NAME',
      score: 0.86,
    });
  }

  if (entities.length === 0) {
    entities.push({
      text: 'behavioral health encounter',
      category: 'TEST_TREATMENT_PROCEDURE',
      type: 'PROCEDURE_NAME',
      score: 0.7,
    });
  }
  if (icd10.length === 0) {
    icd10.push({
      code: 'Z71.9',
      description: 'Counseling, unspecified',
      score: 0.65,
    });
  }

  return { demoMode: true, entities, icd10, medications };
}

type DetectEntitiesResponse = {
  Entities?: Array<{
    Text?: string;
    Category?: string;
    Type?: string;
    Score?: number;
  }>;
};

type InferIcdResponse = {
  Entities?: Array<{
    Text?: string;
    ICD10CMConcepts?: Array<{ Code?: string; Description?: string; Score?: number }>;
  }>;
};

type InferRxResponse = {
  Entities?: Array<{
    Text?: string;
    RxNormConcepts?: Array<{ Code?: string; Description?: string; Score?: number }>;
  }>;
};

/**
 * Analyze clinical text with Amazon Comprehend Medical.
 * Without AWS_ACCESS_KEY_ID → demo fixtures + demoMode:true.
 * With credentials → live API; on failure returns honest error (never fake live success).
 */
export async function analyzeClinicalText(
  text: string
): Promise<
  | { ok: true; result: ComprehendAnalyzeResult }
  | { ok: false; status: number; error: string }
> {
  if (!hasAwsCredentials()) {
    return { ok: true, result: demoResult(text) };
  }

  const creds = getAwsCredentials()!;
  const host = `comprehendmedical.${creds.region}.amazonaws.com`;
  const service = 'comprehendmedical';

  const entitiesRes = await awsJsonPost<DetectEntitiesResponse>({
    creds,
    service,
    host,
    target: 'ComprehendMedical_20181030.DetectEntitiesV2',
    body: { Text: text },
  });
  if (entitiesRes.ok === false) {
    return {
      ok: false,
      status: entitiesRes.status,
      error: `Comprehend Medical DetectEntitiesV2 failed: ${entitiesRes.error}`,
    };
  }

  const icdRes = await awsJsonPost<InferIcdResponse>({
    creds,
    service,
    host,
    target: 'ComprehendMedical_20181030.InferICD10CM',
    body: { Text: text },
  });
  if (icdRes.ok === false) {
    return {
      ok: false,
      status: icdRes.status,
      error: `Comprehend Medical InferICD10CM failed: ${icdRes.error}`,
    };
  }

  const rxRes = await awsJsonPost<InferRxResponse>({
    creds,
    service,
    host,
    target: 'ComprehendMedical_20181030.InferRxNorm',
    body: { Text: text },
  });
  if (rxRes.ok === false) {
    return {
      ok: false,
      status: rxRes.status,
      error: `Comprehend Medical InferRxNorm failed: ${rxRes.error}`,
    };
  }

  const entities: ComprehendEntity[] = (entitiesRes.data.Entities || []).map((e) => ({
    text: e.Text || '',
    category: e.Category || 'UNKNOWN',
    type: e.Type || 'UNKNOWN',
    score: e.Score ?? 0,
  }));

  const icd10: ComprehendCode[] = [];
  for (const ent of icdRes.data.Entities || []) {
    for (const c of ent.ICD10CMConcepts || []) {
      if (c.Code) {
        icd10.push({
          code: c.Code,
          description: c.Description || '',
          score: c.Score ?? 0,
        });
      }
    }
  }

  const medications: ComprehendCode[] = [];
  for (const ent of rxRes.data.Entities || []) {
    for (const c of ent.RxNormConcepts || []) {
      if (c.Code) {
        medications.push({
          code: c.Code,
          description: c.Description || ent.Text || '',
          score: c.Score ?? 0,
        });
      }
    }
  }

  return {
    ok: true,
    result: {
      demoMode: false,
      entities,
      icd10,
      medications,
      raw: {
        entities: entitiesRes.data,
        icd10: icdRes.data,
        rxNorm: rxRes.data,
      },
    },
  };
}
