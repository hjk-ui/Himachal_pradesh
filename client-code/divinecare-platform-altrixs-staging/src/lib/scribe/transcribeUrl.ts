/**
 * Presigned WebSocket URL for Amazon Transcribe streaming (server only). Two engines, both
 * HIPAA-eligible under the AWS BAA:
 *  - 'standard' (default): StartStreamTranscriptionWebSocket on /stream-transcription-websocket,
 *    with the practice's behavioral-health custom vocabulary when SCRIBE_TRANSCRIBE_VOCABULARY is set.
 *  - 'medical': StartMedicalStreamTranscriptionWebSocket on /medical-stream-transcription-websocket.
 *
 * The browser opens the socket itself and streams 16 kHz PCM audio frames straight to AWS (a
 * HIPAA-eligible service under the account's BAA). Audio never passes through or rests on our
 * server, and nothing goes to a browser speech service.
 *
 * The URL is SigV4 query-signed for exactly one request: GET on the engine's path with the
 * parameters below. Every parameter is part of the signature, so the browser cannot change the
 * engine, the vocabulary, the specialty, the language or anything else. It
 * expires after TRANSCRIBE_URL_EXPIRES_S seconds (only the connection must start in that window).
 *
 * With the EC2 instance role the URL carries the role's temporary access key id and session token
 * (never the secret key). That is the standard presigned-URL model; for tighter scoping set
 * TRANSCRIBE_STREAMING_ROLE_ARN later (see docs/ai-scribe.md).
 */
import { createHash, createHmac } from 'node:crypto';
import type { AwsCredentials } from '@/lib/aws/credentials';

export const TRANSCRIBE_URL_EXPIRES_S = 60;
export const TRANSCRIBE_SAMPLE_RATE = 16000;
/** Transcribe Medical streaming path. */
export const TRANSCRIBE_STREAM_PATH = '/medical-stream-transcription-websocket';
/** Standard Transcribe streaming path. */
export const TRANSCRIBE_STANDARD_STREAM_PATH = '/stream-transcription-websocket';

export type StreamKind = 'conversation' | 'dictation';
export type StreamEngine = 'standard' | 'medical';

export function transcribeStreamPath(engine: StreamEngine): string {
  return engine === 'medical' ? TRANSCRIBE_STREAM_PATH : TRANSCRIBE_STANDARD_STREAM_PATH;
}

/** Custom vocabulary for the standard engine (a Transcribe custom vocabulary in the streaming region), or undefined. */
export function scribeVocabularyName(env: Record<string, string | undefined> = process.env): string | undefined {
  const v = (env.SCRIBE_TRANSCRIBE_VOCABULARY || '').trim();
  // Transcribe vocabulary names: 1-200 chars of [0-9a-zA-Z._-]
  return /^[0-9A-Za-z._-]{1,200}$/.test(v) ? v : undefined;
}

/**
 * Query parameters per engine.
 *
 * Medical: specialties are PRIMARYCARE, CARDIOLOGY, NEUROLOGY, ONCOLOGY, RADIOLOGY and UROLOGY;
 * there is no behavioral health specialty, and PRIMARYCARE is the general vocabulary AWS recommends
 * for it. CONVERSATION + show-speaker-label gives diarized turns; DICTATION is tuned for one speaker.
 *
 * Standard: no specialty or type; accuracy on behavioral health terms (diagnoses, therapy
 * modalities, psychiatric medications by generic and brand name) comes from the custom vocabulary.
 * Speaker labels are requested for conversations (dictation is one speaker).
 */
export function transcribeStreamParams(
  kind: StreamKind,
  sampleRate = TRANSCRIBE_SAMPLE_RATE,
  opts: { engine?: StreamEngine; vocabularyName?: string; languageCode?: 'en-US' | 'es-US' } = {}
): Record<string, string> {
  // Transcribe Medical is en-US only: a Spanish stream is always the standard engine (language.ts)
  const language = opts.languageCode ?? 'en-US';
  const engine = language === 'en-US' ? (opts.engine ?? 'medical') : 'standard';
  const params: Record<string, string> = {
    'language-code': language,
    'media-encoding': 'pcm',
    'sample-rate': String(sampleRate),
  };
  if (engine === 'medical') {
    params.specialty = 'PRIMARYCARE';
    params.type = kind === 'dictation' ? 'DICTATION' : 'CONVERSATION';
  } else if (opts.vocabularyName && language === 'en-US') {
    params['vocabulary-name'] = opts.vocabularyName;
  }
  if (kind === 'conversation') params['show-speaker-label'] = 'true';
  return params;
}

export function transcribeStreamingHost(region: string): string {
  return `transcribestreaming.${region}.amazonaws.com:8443`;
}

/** RFC 3986 encoding as SigV4 requires (encodeURIComponent leaves !'()* alone). */
export function rfc3986(v: string): string {
  return encodeURIComponent(v).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function sha256Hex(data: string) {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}
function hmac(key: Buffer | string, data: string) {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

export type PresignInput = {
  creds: AwsCredentials;
  region?: string;
  kind: StreamKind;
  now?: Date;
  expiresSeconds?: number;
  sampleRate?: number;
};

/** Transcribe Medical streaming URL. */
export function presignTranscribeMedicalUrl(input: PresignInput): string {
  return presignTranscribeUrl({ ...input, engine: 'medical' });
}

/** Streaming URL for either engine. `vocabularyName` applies to the standard engine only. */
export function presignTranscribeUrl(input: PresignInput & { engine: StreamEngine; vocabularyName?: string; languageCode?: 'en-US' | 'es-US' }): string {
  const region = input.region || input.creds.region || 'us-east-1';
  const host = transcribeStreamingHost(region);
  const now = input.now ?? new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const service = 'transcribe';
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const expires = Math.min(300, Math.max(1, Math.floor(input.expiresSeconds ?? TRANSCRIBE_URL_EXPIRES_S)));

  const query: Record<string, string> = {
    ...transcribeStreamParams(input.kind, input.sampleRate, { engine: input.engine, vocabularyName: input.vocabularyName, languageCode: input.languageCode }),
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${input.creds.accessKeyId}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expires),
    'X-Amz-SignedHeaders': 'host',
  };
  if (input.creds.sessionToken) query['X-Amz-Security-Token'] = input.creds.sessionToken;

  const canonicalQuery = Object.keys(query)
    .sort()
    .map((k) => `${rfc3986(k)}=${rfc3986(query[k])}`)
    .join('&');
  const path = transcribeStreamPath((input.languageCode ?? 'en-US') === 'en-US' ? input.engine : 'standard');
  const canonicalRequest = ['GET', path, canonicalQuery, `host:${host}\n`, 'host', sha256Hex('')].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const kDate = hmac(`AWS4${input.creds.secretAccessKey}`, dateStamp);
  const kSigning = hmac(hmac(hmac(kDate, region), service), 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

  return `wss://${host}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}
