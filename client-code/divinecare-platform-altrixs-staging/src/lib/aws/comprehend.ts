import { hasAwsRoleOrKeys, resolveAwsCredentials } from './credentials';
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
  if (!hasAwsRoleOrKeys()) {
    // No keyword-matched stand-in codes: not configured is an honest 503
    return { ok: false, status: 503, error: 'Comprehend Medical is not configured on this server' };
  }

  const creds = await resolveAwsCredentials();
  if (!creds) return { ok: false, status: 503, error: 'AWS credentials unavailable' };
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
