'use client';

/**
 * Tracks microphone / camera / screen streams the page opened (getUserMedia, getDisplayMedia),
 * so the idle sign-out treats a live telehealth call or AI scribe recording as activity and never
 * cuts a session off mid-visit. Installed once when this module loads (before any page effect).
 */
const streams = new Set<MediaStream>();
let installed = false;

function track(stream: MediaStream): MediaStream {
  streams.add(stream);
  return stream;
}

export function installLiveMediaTracker(): void {
  if (installed || typeof navigator === 'undefined' || !navigator.mediaDevices) return;
  installed = true;
  const md = navigator.mediaDevices;
  if (typeof md.getUserMedia === 'function') {
    const original = md.getUserMedia.bind(md);
    md.getUserMedia = (constraints?: MediaStreamConstraints) => original(constraints).then(track);
  }
  if (typeof md.getDisplayMedia === 'function') {
    const original = md.getDisplayMedia.bind(md);
    md.getDisplayMedia = (options?: DisplayMediaStreamOptions) => original(options).then(track);
  }
}

/** True while any tracked stream still has a live track. */
export function hasLiveMedia(): boolean {
  for (const s of streams) {
    if (s.getTracks().some((t) => t.readyState === 'live')) return true;
    streams.delete(s);
  }
  return false;
}

installLiveMediaTracker();
