import { createHmac, createHash } from 'node:crypto';

function sha256Hex(data: string) {
  return createHash('sha256').update(data, 'utf8').digest('hex');
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

function encodeForm(params: Record<string, string>) {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

export async function publishSnsSms(input: {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  phoneNumber: string;
  message: string;
  originationNumber?: string;
}): Promise<void> {
  const host = `sns.${input.region}.amazonaws.com`;
  const bodyParams: Record<string, string> = {
    Action: 'Publish',
    Version: '2010-03-31',
    PhoneNumber: input.phoneNumber,
    Message: input.message,
    'MessageAttributes.entry.1.Name': 'AWS.SNS.SMS.SMSType',
    'MessageAttributes.entry.1.Value.DataType': 'String',
    'MessageAttributes.entry.1.Value.StringValue': 'Transactional',
  };
  if (input.originationNumber) {
    bodyParams['MessageAttributes.entry.2.Name'] = 'AWS.MM.SMS.OriginationNumber';
    bodyParams['MessageAttributes.entry.2.Value.DataType'] = 'String';
    bodyParams['MessageAttributes.entry.2.Value.StringValue'] = input.originationNumber;
  }
  const body = encodeForm(bodyParams);

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body);

  const headers: Record<string, string> = {
    'content-type': 'application/x-www-form-urlencoded',
    host,
    'x-amz-date': amzDate,
  };
  if (input.sessionToken) {
    headers['x-amz-security-token'] = input.sessionToken;
  }

  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((k) => `${k}:${headers[k]}\n`).join('');
  const signedHeaders = signedHeaderNames.join(';');
  const canonicalRequest = [
    'POST',
    '/',
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const credentialScope = `${dateStamp}/${input.region}/sns/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const signature = createHmac(
    'sha256',
    signingKey(input.secretAccessKey, dateStamp, input.region, 'sns')
  )
    .update(stringToSign, 'utf8')
    .digest('hex');

  headers.authorization = `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  headers['content-length'] = String(Buffer.byteLength(body));

  const res = await fetch(`https://${host}/`, {
    method: 'POST',
    signal: AbortSignal.timeout(15000),
    headers,
    body,
  });
  const text = await res.text();
  if (!res.ok || text.includes('<ErrorResponse') || text.includes('<Code>')) {
    const code = text.match(/<Code>([^<]+)<\/Code>/)?.[1] || `HTTP ${res.status}`;
    const msg = text.match(/<Message>([^<]+)<\/Message>/)?.[1] || text.slice(0, 200);
    throw new Error(`${code}: ${msg}`);
  }
}
