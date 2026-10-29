import { createHmac, createHash } from 'node:crypto';
import type { AwsCredentials } from './credentials';

function sha256Hex(data: string | Buffer) {
  return createHash('sha256').update(data).digest('hex');
}

function hmac(key: Buffer | string, data: string) {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function signingKey(secret: string, dateStamp: string, region: string, service: string) {
  const kDate = hmac(`AWS4${secret}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, 'aws4_request');
}

/**
 * SigV4-signed POST for AWS JSON 1.0 / 1.1 APIs (Comprehend Medical, Textract, Personalize).
 */
export async function awsJsonPost<T = unknown>(input: {
  creds: AwsCredentials;
  service: string;
  host: string;
  target: string;
  body: Record<string, unknown>;
  contentType?: string;
  path?: string;
}): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
  const path = input.path || '/';
  const body = JSON.stringify(input.body);
  const contentType = input.contentType || 'application/x-amz-json-1.1';
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body);

  const headers: Record<string, string> = {
    'content-type': contentType,
    host: input.host,
    'x-amz-date': amzDate,
    'x-amz-target': input.target,
  };
  if (input.creds.sessionToken) {
    headers['x-amz-security-token'] = input.creds.sessionToken;
  }

  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((k) => `${k}:${headers[k]}\n`).join('');
  const signedHeaders = signedHeaderNames.join(';');
  const canonicalRequest = ['POST', path, '', canonicalHeaders, signedHeaders, payloadHash].join(
    '\n'
  );

  const credentialScope = `${dateStamp}/${input.creds.region}/${input.service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const signature = createHmac(
    'sha256',
    signingKey(input.creds.secretAccessKey, dateStamp, input.creds.region, input.service)
  )
    .update(stringToSign, 'utf8')
    .digest('hex');

  headers.authorization = `AWS4-HMAC-SHA256 Credential=${input.creds.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  try {
    const res = await fetch(`https://${input.host}${path}`, {
      method: 'POST',
      headers,
      body,
    });
    const text = await res.text();
    let data: T | null = null;
    if (text) {
      try {
        data = JSON.parse(text) as T;
      } catch {
        return {
          ok: false,
          status: res.status || 502,
          error: `Invalid AWS JSON response (${input.service})`,
        };
      }
    }
    if (!res.ok) {
      const errObj = data as { message?: string; Message?: string; __type?: string } | null;
      const msg =
        errObj?.message ||
        errObj?.Message ||
        errObj?.__type ||
        text.slice(0, 240) ||
        `HTTP ${res.status}`;
      return { ok: false, status: res.status, error: msg };
    }
    return { ok: true, data: data as T };
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Network error';
    return { ok: false, status: 502, error: detail };
  }
}

/**
 * SigV4-signed request for HealthLake FHIR REST (GET/POST).
 */
export async function awsSignedFetch(input: {
  creds: AwsCredentials;
  service: string;
  method: 'GET' | 'POST';
  url: string;
  body?: string;
  headers?: Record<string, string>;
}): Promise<{ ok: true; status: number; text: string } | { ok: false; status: number; error: string }> {
  const parsed = new URL(input.url);
  const body = input.body || '';
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body);

  const headers: Record<string, string> = {
    host: parsed.host,
    'x-amz-date': amzDate,
    ...(input.headers || {}),
  };
  if (body && !headers['content-type']) {
    headers['content-type'] = 'application/json';
  }
  if (input.creds.sessionToken) {
    headers['x-amz-security-token'] = input.creds.sessionToken;
  }

  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((k) => `${k}:${headers[k]}\n`).join('');
  const signedHeaders = signedHeaderNames.join(';');
  const canonicalQuery = [...parsed.searchParams.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  const canonicalRequest = [
    input.method,
    parsed.pathname || '/',
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const credentialScope = `${dateStamp}/${input.creds.region}/${input.service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const signature = createHmac(
    'sha256',
    signingKey(input.creds.secretAccessKey, dateStamp, input.creds.region, input.service)
  )
    .update(stringToSign, 'utf8')
    .digest('hex');

  headers.authorization = `AWS4-HMAC-SHA256 Credential=${input.creds.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  try {
    const res = await fetch(input.url, {
      method: input.method,
      headers,
      body: body || undefined,
    });
    const text = await res.text();
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: text.slice(0, 400) || `HTTP ${res.status}`,
      };
    }
    return { ok: true, status: res.status, text };
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Network error';
    return { ok: false, status: 502, error: detail };
  }
}
