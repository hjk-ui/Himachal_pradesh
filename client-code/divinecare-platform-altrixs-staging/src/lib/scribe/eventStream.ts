/**
 * Minimal AWS event-stream codec for the Transcribe streaming WebSocket. Browser-safe, no deps.
 *
 * Message layout (big-endian):
 *   total length (4) | headers length (4) | prelude CRC32 (4) | headers | payload | message CRC32 (4)
 * Header: name length (1) | name (utf8) | value type (1) | value. Only the types Transcribe uses
 * are written (7 = string); the decoder skips the others by their fixed sizes.
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

export function encodeEventMessage(headers: Record<string, string>, payload: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const [name, value] of Object.entries(headers)) {
    const n = enc.encode(name);
    const v = enc.encode(value);
    const h = new Uint8Array(1 + n.length + 1 + 2 + v.length);
    const dv = new DataView(h.buffer);
    h[0] = n.length;
    h.set(n, 1);
    h[1 + n.length] = 7;
    dv.setUint16(2 + n.length, v.length);
    h.set(v, 4 + n.length);
    parts.push(h);
  }
  const headersLen = parts.reduce((t, p) => t + p.length, 0);
  const total = 12 + headersLen + payload.length + 4;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, total);
  dv.setUint32(4, headersLen);
  dv.setUint32(8, crc32(out.subarray(0, 8)));
  let off = 12;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  out.set(payload, off);
  dv.setUint32(total - 4, crc32(out.subarray(0, total - 4)));
  return out;
}

export type DecodedMessage = { headers: Record<string, string | number | boolean>; payload: Uint8Array };

export function decodeEventMessage(input: Uint8Array): DecodedMessage {
  if (input.length < 16) throw new Error('event-stream: message too short');
  const dv = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const total = dv.getUint32(0);
  const headersLen = dv.getUint32(4);
  if (total !== input.length) throw new Error('event-stream: length mismatch');
  if (dv.getUint32(8) !== crc32(input.subarray(0, 8))) throw new Error('event-stream: prelude CRC mismatch');
  if (dv.getUint32(total - 4) !== crc32(input.subarray(0, total - 4))) throw new Error('event-stream: message CRC mismatch');
  const headers: Record<string, string | number | boolean> = {};
  let off = 12;
  const end = 12 + headersLen;
  while (off < end) {
    const nameLen = input[off];
    const name = dec.decode(input.subarray(off + 1, off + 1 + nameLen));
    off += 1 + nameLen;
    const type = input[off];
    off += 1;
    switch (type) {
      case 0:
        headers[name] = true;
        break;
      case 1:
        headers[name] = false;
        break;
      case 2:
        headers[name] = dv.getInt8(off);
        off += 1;
        break;
      case 3:
        headers[name] = dv.getInt16(off);
        off += 2;
        break;
      case 4:
        headers[name] = dv.getInt32(off);
        off += 4;
        break;
      case 5:
      case 8:
        headers[name] = Number(dv.getBigInt64(off));
        off += 8;
        break;
      case 6:
      case 7: {
        const len = dv.getUint16(off);
        const bytes = input.subarray(off + 2, off + 2 + len);
        headers[name] = type === 7 ? dec.decode(bytes) : bytes.length;
        off += 2 + len;
        break;
      }
      case 9:
        off += 16;
        break;
      default:
        throw new Error('event-stream: unknown header type');
    }
  }
  return { headers, payload: input.subarray(end, total - 4) };
}

/** One audio chunk (16-bit LE PCM). An empty chunk tells Transcribe the stream is finished. */
export function encodeAudioEvent(pcm: Uint8Array): Uint8Array {
  return encodeEventMessage({ ':content-type': 'application/octet-stream', ':event-type': 'AudioEvent', ':message-type': 'event' }, pcm);
}

export type TranscribeItem = { StartTime?: number; EndTime?: number; Type?: string; Content?: string; Speaker?: string };
export type TranscribeResult = {
  ResultId?: string;
  StartTime?: number;
  EndTime?: number;
  IsPartial?: boolean;
  ChannelId?: string;
  Alternatives?: { Transcript?: string; Items?: TranscribeItem[] }[];
};

export type TranscribeStreamMessage =
  | { type: 'transcript'; results: TranscribeResult[] }
  | { type: 'exception'; exceptionType: string; message: string };

const num = (v: unknown): number | undefined => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
};
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : undefined);

/**
 * One result from either engine, reduced to the fields the scribe uses.
 *
 * Standard (StartStreamTranscription) results carry LanguageCode, and items carry Stable,
 * Confidence and VocabularyFilterMatch. Medical (StartMedicalStreamTranscription) results carry
 * Entities on each alternative and no LanguageCode. Both put the words in Alternatives[0].Items
 * with Speaker as "0", "1"…; a "spk_N" label (batch / SDK style) is reduced to "N" so diarization
 * always produces spk_N exactly once. A missing IsPartial is treated as final.
 */
export function normalizeTranscribeResult(raw: unknown): TranscribeResult {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const alts = Array.isArray(r.Alternatives) ? r.Alternatives : [];
  return {
    ResultId: str(r.ResultId),
    StartTime: num(r.StartTime),
    EndTime: num(r.EndTime),
    IsPartial: r.IsPartial === true,
    ChannelId: str(r.ChannelId),
    Alternatives: alts.map((a) => {
      const alt = (a && typeof a === 'object' ? a : {}) as Record<string, unknown>;
      const items = (Array.isArray(alt.Items) ? alt.Items : []).map((i) => {
        const it = (i && typeof i === 'object' ? i : {}) as Record<string, unknown>;
        const speaker = str(it.Speaker);
        return {
          StartTime: num(it.StartTime),
          EndTime: num(it.EndTime),
          Type: str(it.Type),
          Content: str(it.Content),
          Speaker: speaker === undefined ? undefined : speaker.replace(/^spk_/, ''),
        };
      });
      const transcript =
        str(alt.Transcript) ??
        (items.length
          ? items
              .map((it) => (it.Type === 'punctuation' ? it.Content ?? '' : ` ${it.Content ?? ''}`))
              .join('')
              .trim()
          : undefined);
      return { Transcript: transcript, Items: items };
    }),
  };
}

/** Transcript event or exception from a raw socket frame (either engine); null for anything else. */
export function parseTranscribeMessage(frame: Uint8Array): TranscribeStreamMessage | null {
  const msg = decodeEventMessage(frame);
  const text = dec.decode(msg.payload);
  if (msg.headers[':message-type'] === 'exception') {
    let message = 'Transcription error';
    try {
      message = String((JSON.parse(text) as { Message?: string }).Message || message);
    } catch {
      /* keep default */
    }
    return { type: 'exception', exceptionType: String(msg.headers[':exception-type'] || 'Exception'), message };
  }
  if (msg.headers[':event-type'] !== 'TranscriptEvent') return null;
  // The WebSocket payload is { Transcript: { Results } }; SDK-style payloads nest it under TranscriptEvent.
  const body = JSON.parse(text) as { Transcript?: { Results?: unknown[] }; TranscriptEvent?: { Transcript?: { Results?: unknown[] } } };
  const results = body.Transcript?.Results ?? body.TranscriptEvent?.Transcript?.Results ?? [];
  return { type: 'transcript', results: Array.isArray(results) ? results.map(normalizeTranscribeResult) : [] };
}
