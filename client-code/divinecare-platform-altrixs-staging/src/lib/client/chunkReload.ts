'use client';

/**
 * After a deploy, a tab opened on the previous build asks for that build's JavaScript chunks, which no
 * longer exist ("Failed to load chunk …"). Reloading the page picks up the new build.
 */
export function isChunkLoadError(error: unknown): boolean {
  const e = error as { name?: string; message?: string } | null;
  if (!e) return false;
  if (e.name === 'ChunkLoadError') return true;
  return /Failed to load chunk|Loading chunk [\w-]+ failed|Loading CSS chunk|Importing a module script failed|error loading dynamically imported module|Failed to fetch dynamically imported module/i.test(
    e.message ?? ''
  );
}

const KEY = 'altrixs-chunk-reload-at';

/** Reload once per 30 seconds at most, so a real outage can't cause a reload loop. Returns true when reloading. */
export function reloadOnceForChunkError(error: unknown): boolean {
  if (typeof window === 'undefined' || !isChunkLoadError(error)) return false;
  try {
    const last = Number(window.sessionStorage.getItem(KEY) || 0);
    if (Date.now() - last < 30_000) return false;
    window.sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    // Storage blocked: still reload once; the browser keeps no loop state, so keep it to this error only
  }
  window.location.reload();
  return true;
}
