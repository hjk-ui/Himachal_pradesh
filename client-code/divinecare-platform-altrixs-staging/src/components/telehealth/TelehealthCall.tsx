'use client';

import { useEffect, useRef, useState } from 'react';

type Role = 'staff' | 'client';
type Signal = {
  seq: number;
  from: Role;
  type: 'offer' | 'answer' | 'ice' | 'hangup';
  data: unknown;
};

const ICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

async function getLocalStream(): Promise<{ stream: MediaStream | null; note: string }> {
  const attempts: MediaStreamConstraints[] = [
    { video: true, audio: true },
    { video: true, audio: false },
    { video: false, audio: true },
  ];
  let lastError: unknown = null;
  for (const constraints of attempts) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      const hasVideo = stream.getVideoTracks().length > 0;
      const hasAudio = stream.getAudioTracks().length > 0;
      if (hasVideo && hasAudio) return { stream, note: 'Camera and mic on' };
      if (hasVideo) return { stream, note: 'Camera on (no mic)' };
      return { stream, note: 'Mic only — this PC has no camera' };
    } catch (err) {
      lastError = err;
    }
  }
  const name = lastError instanceof Error ? lastError.name : '';
  if (name === 'NotAllowedError') {
    throw new Error('Camera/mic blocked. Click Allow in the browser prompt, or open Windows Settings → Privacy → Camera.');
  }
  if (name === 'NotFoundError' || (lastError instanceof Error && /device not found/i.test(lastError.message))) {
    return { stream: null, note: 'No camera or mic found on this computer. Join from another device (such as a phone) that has a camera.' };
  }
  throw lastError instanceof Error ? lastError : new Error('Could not access camera');
}

export function TelehealthCall({ token, role }: { token: string; role: Role }) {
  const localRef = useRef<HTMLVideoElement | null>(null);
  const remoteRef = useRef<HTMLVideoElement | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lastSeq = useRef(0);
  const started = useRef(false);
  const [status, setStatus] = useState('Starting…');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let cancelled = false;
    started.current = false;
    lastSeq.current = 0;

    async function post(type: Signal['type'], data: unknown) {
      await fetch('/api/telehealth/signal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, from: role, type, data }),
      });
    }

    async function setup() {
      setError('');
      setStatus('Starting camera…');
      const { stream, note } = await getLocalStream();
      if (cancelled) {
        stream?.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      if (stream && localRef.current) {
        localRef.current.srcObject = stream;
        await localRef.current.play().catch(() => {});
      }

      const pc = new RTCPeerConnection(ICE);
      pcRef.current = pc;
      if (stream) {
        stream.getTracks().forEach((track) => pc.addTrack(track, stream));
      } else {
        pc.addTransceiver('video', { direction: 'recvonly' });
        pc.addTransceiver('audio', { direction: 'recvonly' });
      }
      pc.ontrack = (event) => {
        if (remoteRef.current && event.streams[0]) {
          remoteRef.current.srcObject = event.streams[0];
          void remoteRef.current.play().catch(() => {});
          setStatus('Connected');
        }
      };
      pc.onicecandidate = (event) => {
        if (event.candidate) void post('ice', event.candidate.toJSON());
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected') setStatus('Connected');
        if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
          setStatus('Disconnected');
        }
      };

      if (role === 'staff') {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await post('offer', { sdp: offer.sdp, type: offer.type });
        setStatus(stream ? `${note}. Waiting for client…` : `${note} Waiting for client…`);
      } else {
        setStatus(note || 'Waiting for clinician…');
      }

      async function poll() {
        if (cancelled) return;
        try {
          const res = await fetch(
            `/api/telehealth/signal?token=${encodeURIComponent(token)}&after=${lastSeq.current}`
          );
          const json = (await res.json()) as { success?: boolean; messages?: Signal[] };
          for (const msg of json.messages || []) {
            lastSeq.current = Math.max(lastSeq.current, msg.seq);
            if (msg.from === role) continue;
            const peer = pcRef.current;
            if (!peer) continue;
            if (msg.type === 'hangup') {
              setStatus('Other person left');
              continue;
            }
            if (msg.type === 'ice' && msg.data) {
              await peer.addIceCandidate(new RTCIceCandidate(msg.data as RTCIceCandidateInit)).catch(() => {});
            }
            if (msg.type === 'offer' && role === 'client' && msg.data) {
              const offer = msg.data as RTCSessionDescriptionInit;
              await peer.setRemoteDescription(new RTCSessionDescription(offer));
              const answer = await peer.createAnswer();
              await peer.setLocalDescription(answer);
              await post('answer', { sdp: answer.sdp, type: answer.type });
              setStatus('Connecting…');
            }
            if (msg.type === 'answer' && role === 'staff' && msg.data) {
              const answer = msg.data as RTCSessionDescriptionInit;
              if (!peer.currentRemoteDescription) {
                await peer.setRemoteDescription(new RTCSessionDescription(answer));
              }
            }
          }
        } catch {
          // keep polling
        }
        if (!cancelled) window.setTimeout(poll, 1000);
      }

      void poll();
    }

    setup().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : 'Could not start call');
      setStatus('Could not start camera');
    });

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      pcRef.current?.close();
      pcRef.current = null;
    };
  }, [token, role, retry]);

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[1.4fr_0.8fr]">
        <div className="relative overflow-hidden rounded-2xl bg-slate-900">
          <video ref={remoteRef} autoPlay playsInline className="aspect-video h-full w-full object-cover" />
          <span className="absolute left-2 top-2 rounded bg-black/50 px-2 py-0.5 text-[11px] font-semibold text-white">
            Other person
          </span>
        </div>
        <div className="relative overflow-hidden rounded-2xl bg-slate-800">
          <video ref={localRef} autoPlay muted playsInline className="aspect-video h-full w-full object-cover" />
          <span className="absolute left-2 top-2 rounded bg-black/50 px-2 py-0.5 text-[11px] font-semibold text-white">
            You
          </span>
        </div>
      </div>
      <p className="text-xs font-medium text-slate-600">{status}</p>
      {error && (
        <div className="space-y-2">
          <p className="text-xs text-rose-600">{error}</p>
          <button
            type="button"
            onClick={() => setRetry((n) => n + 1)}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            Try again
          </button>
        </div>
      )}
    </div>
  );
}
