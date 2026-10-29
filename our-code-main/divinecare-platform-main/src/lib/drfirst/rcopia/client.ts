import 'server-only';
import { randomUUID } from 'node:crypto';
import { DrFirstError } from '../errors';
import type { DrFirstExchangeAuditSink, IntegrationPatient } from '../types';
import {
  buildNotificationCountRequest, buildRcopiaRequest, buildSendPatientRequest, parseNotificationCounts,
  type RcopiaEnvelopeSettings, validateRcopiaResponse, vendorErrorDetail,
} from './xml';

const TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_RETRIES = 3;
const MAX_RESPONSE_BYTES = 2_000_000;

function isTimeout(error: unknown) {
  return error instanceof DOMException && (error.name === 'AbortError' || error.name === 'TimeoutError');
}

async function boundedText(response: Response) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) throw new DrFirstError('DRFIRST_EXTERNAL_SERVICE_ERROR', 503);
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0;
  let value = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        void reader.cancel().catch(() => {});
        throw new DrFirstError('DRFIRST_EXTERNAL_SERVICE_ERROR', 503);
      }
      value += decoder.decode(chunk.value, { stream: true });
    }
    return value + decoder.decode();
  } finally { reader.releaseLock(); }
}

export class RcopiaStagingClient {
  constructor(
    private readonly endpoint: string,
    private readonly settings: RcopiaEnvelopeSettings,
    private readonly audit: DrFirstExchangeAuditSink,
    private readonly request: typeof fetch = fetch,
  ) {}

  private async call(
    operation: 'patient-upload' | 'notification-count' | 'history-download',
    requestXml: string,
    rcopiaUserName?: string,
    endpoint = this.endpoint,
  ) {
    const xml = buildRcopiaRequest({ ...this.settings, rcopiaUserName }, randomUUID(), requestXml);
    for (let attempt = 0; attempt <= MAX_TIMEOUT_RETRIES; attempt++) {
      try {
        const response = await this.request(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', Accept: 'application/xml, text/xml' },
          body: new URLSearchParams({ xml }).toString(),
          cache: 'no-store',
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!response.ok) {
          const responseXml = await boundedText(response).catch(() => '');
          throw new DrFirstError('DRFIRST_UPSTREAM_REJECTED', 422, vendorErrorDetail(responseXml) || `The prescribing vendor returned ${response.status}.`);
        }
        const responseXml = await boundedText(response);
        try {
          validateRcopiaResponse(responseXml);
        } catch (error) {
          await this.audit({ operation, outcome: 'failed', responseXml, errorCode: 'UPSTREAM_REJECTED' });
          throw error;
        }
        await this.audit({ operation, outcome: 'succeeded', responseXml });
        return responseXml;
      } catch (error) {
        if (isTimeout(error) && attempt < MAX_TIMEOUT_RETRIES) continue;
        if (!(error instanceof DrFirstError)) {
          await this.audit({ operation, outcome: 'failed', requestXml: xml, errorCode: 'CONNECTION_ERROR' });
          throw new DrFirstError('DRFIRST_EXTERNAL_SERVICE_ERROR', 503);
        }
        throw error;
      }
    }
    throw new DrFirstError('DRFIRST_EXTERNAL_SERVICE_ERROR', 503);
  }

  async uploadPatient(patient: IntegrationPatient, externalId: string) {
    await this.call('patient-upload', buildSendPatientRequest(patient, externalId));
    return externalId;
  }

  async downloadHistory(updateUrl: string, requestXml: string) {
    return this.call('history-download', requestXml, undefined, updateUrl);
  }

  async getNotificationCounts(rcopiaUserName: string) {
    const responseXml = await this.call('notification-count', buildNotificationCountRequest(), rcopiaUserName);
    return parseNotificationCounts(responseXml);
  }
}
