import 'server-only';
import { randomUUID } from 'node:crypto';
import { DrFirstError } from '../errors';
import { buildDrugAllergySearchXml, parseDrugAllergySearchResponse } from './xml';
import type { DrugAllergySearchResponse, FdbSettings } from './types';

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_RETRIES = 3;
const MAX_RESPONSE_BYTES = 2_000_000;

function isTimeout(error: unknown) {
  return error instanceof DOMException && (error.name === 'AbortError' || error.name === 'TimeoutError');
}

async function readBoundedResponse(response: Response) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    throw new DrFirstError('DRFIRST_EXTERNAL_SERVICE_ERROR', 503);
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  let text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        void reader.cancel().catch(() => {});
        throw new DrFirstError('DRFIRST_EXTERNAL_SERVICE_ERROR', 503);
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

export class FdbClient {
  constructor(
    private readonly settings: FdbSettings & {
      endpoint: string;
      vendorName: string;
      vendorPassword: string;
      practiceUsername: string;
      systemName: string;
    },
    private readonly request: typeof fetch = fetch,
  ) {}

  async searchDrugAllergy(searchString: string, maximum?: number): Promise<DrugAllergySearchResponse> {
    const xml = buildDrugAllergySearchXml(this.settings, {
      requestMessageId: randomUUID(), searchString, maximum,
    });
    for (let attempt = 0; attempt <= MAX_TIMEOUT_RETRIES; attempt++) {
      try {
        const response = await this.request(this.settings.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', Accept: 'application/xml, text/xml' },
          body: new URLSearchParams({ xml }).toString(),
          cache: 'no-store',
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (!response.ok) throw new DrFirstError('DRFIRST_EXTERNAL_SERVICE_ERROR', 503);
        return parseDrugAllergySearchResponse(await readBoundedResponse(response));
      } catch (error) {
        if (isTimeout(error) && attempt < MAX_TIMEOUT_RETRIES) continue;
        if (error instanceof DrFirstError) throw error;
        throw new DrFirstError('DRFIRST_EXTERNAL_SERVICE_ERROR', 503);
      }
    }
    throw new DrFirstError('DRFIRST_EXTERNAL_SERVICE_ERROR', 503);
  }
}
