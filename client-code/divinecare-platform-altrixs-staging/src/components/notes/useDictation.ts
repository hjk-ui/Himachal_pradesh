'use client';

/**
 * Clinician dictation for the note editors. PHI path: AWS Transcribe streaming (practice engine setting)
 * through a server-presigned WebSocket, opened as a 'dictation' scribe capture so it is gated
 * (AI consent, plan entitlement, practice switch), audited and metered. The clinician attests that
 * only their own voice is captured. The browser Web Speech API is not used (in Chrome it sends
 * audio to Google, which has no BAA with the practice).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { DICTATION_ATTESTATION } from '@/lib/scribe/consent';
import { useTranscribeStream } from '@/components/scribe/useTranscribeStream';

export function useDictation(onFinalText: (text: string) => void, opts: { clientId?: string | null } = {}) {
  const [error, setError] = useState<string | null>(null);
  const cbRef = useRef(onFinalText);
  useEffect(() => {
    cbRef.current = onFinalText;
  }, [onFinalText]);
  const attested = useRef(false);
  const stream = useTranscribeStream({
    captureId: null,
    kind: 'dictation',
    persist: false,
    onSegments: (segs) => {
      const text = segs.map((s) => s.text).join(' ').trim();
      if (text) cbRef.current(text);
    },
  });

  const start = useCallback(async () => {
    setError(null);
    if (!opts.clientId) {
      setError('Choose the client first. Dictation is tied to the client so their AI consent applies.');
      return;
    }
    if (!attested.current) {
      if (!window.confirm(`${DICTATION_ATTESTATION}\n\nAudio goes to Amazon Transcribe (HIPAA-eligible, under the practice BAA) and is not stored.`)) return;
      attested.current = true;
    }
    let res: Response;
    try {
      res = await fetch('/api/scribe/captures', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: opts.clientId,
          mode: 'dictation',
          consent: { method: 'verbal', participants: [], allPartiesConfirmed: true, scriptRead: true, clinicianOnly: true },
        }),
      });
    } catch {
      setError('Could not reach the server. Type instead.');
      return;
    }
    const data = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string; capture?: { id: string } };
    if (!res.ok || !data.capture) {
      setError(`${data.error || 'Dictation is unavailable.'} You can keep typing.`);
      return;
    }
    await stream.start(data.capture.id);
  }, [opts.clientId, stream]);

  const listening = stream.state === 'live' || stream.state === 'connecting';
  const stop = useCallback(() => {
    if (stream.state === 'live' || stream.state === 'connecting' || stream.state === 'paused') void stream.stop();
  }, [stream]);

  return { listening, error: error || stream.error, level: stream.level, partial: stream.partial, start: () => void start(), stop };
}
