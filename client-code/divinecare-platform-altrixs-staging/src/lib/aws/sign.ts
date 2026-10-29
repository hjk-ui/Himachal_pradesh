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
      signal: AbortSignal.timeout(30000),
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

/** RFC 3986 strict encoding (SigV4 canonical form): encodeURIComponent leaves !'()* unescaped. */
export function rfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** SigV4 canonical query string from decoded pairs: strict-encoded, sorted by key then value. */
export function canonicalQueryString(params: URLSearchParams): string {
  return [...params.entries()]
    .map(([k, v]) => [rfc3986(k), rfc3986(v)] as const)
    .sort(([ak, av], [bk, bv]) => (ak === bk ? (av < bv ? -1 : av > bv ? 1 : 0) : ak < bk ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
}

/**
 * Canonical URI for non-S3 services: each segment of the (already URL-encoded) path is
 * encoded again, as botocore does.
 */
export function canonicalUri(pathname: string): string {
  if (!pathname || pathname === '/') return '/';
  return pathname
    .split('/')
    .map((seg) => rfc3986(seg))
    .join('/');
}

/**
 * SigV4-signed request for the HealthLake FHIR REST data plane (GET/POST/PUT/DELETE).
 * The request is sent with the same strict query encoding that is signed.
 */
export async function awsSignedFetch(input: {
  creds: AwsCredentials;
  service: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  url: string;
  body?: string;
  headers?: Record<string, string>;
  fetchImpl?: typeof fetch;
}): Promise<
  | { ok: true; status: number; text: string; headers: Headers }
  | { ok: false; status: number; error: string; text?: string }
> {
  const parsed = new URL(input.url);
  const body = input.body || '';
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body);

  const headers: Record<string, string> = {
    host: parsed.host,
    'x-amz-date': amzDate,
    'x-amz-content-sha256': payloadHash,
  };
  for (const [k, v] of Object.entries(input.headers || {})) headers[k.toLowerCase()] = v;
  if (body && !headers['content-type']) {
    headers['content-type'] = 'application/json';
  }
  if (input.creds.sessionToken) {
    headers['x-amz-security-token'] = input.creds.sessionToken;
  }

  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((k) => `${k}:${String(headers[k]).trim()}\n`).join('');
  const signedHeaders = signedHeaderNames.join(';');
  const canonicalQuery = canonicalQueryString(parsed.searchParams);
  const canonicalRequest = [
    input.method,
    canonicalUri(parsed.pathname),
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

  const requestUrl = `${parsed.origin}${parsed.pathname}${canonicalQuery ? `?${canonicalQuery}` : ''}`;
  const doFetch = input.fetchImpl ?? fetch;
  try {
    const res = await doFetch(requestUrl, {
      method: input.method,
      signal: AbortSignal.timeout(30000),
      headers,
      body: body || undefined,
    });
    const text = await res.text();
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: text.slice(0, 400) || `HTTP ${res.status}`,
        text,
      };
    }
    return { ok: true, status: res.status, text, headers: res.headers };
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Network error';
    return { ok: false, status: 502, error: detail };
  }
}
