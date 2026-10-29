/**
 * Content-Security-Policy for every route, built per request in src/proxy.ts with a fresh nonce
 * (Next.js reads the nonce from the request's CSP header and stamps it on its own scripts; pages
 * render dynamically for that — see the root layout). 'strict-dynamic' lets those scripts load the
 * app's chunks and Stripe.js; nothing inline runs without the nonce.
 *
 * Sources the browser talks to directly:
 *  - Amazon Chime SDK (telehealth): https / wss *.chime.aws (signaling, ingest)
 *  - Amazon Transcribe streaming (AI scribe live): wss://transcribestreaming.<region>.amazonaws.com:8443
 *  - S3 presigned PUTs: scribe audio (SCRIBE_UPLOAD_BUCKET) and the Valant document import
 *    (VALANT_IMPORT_S3_BUCKET / DOC_INTAKE_S3_BUCKET): https://<bucket>.s3[.<region>].amazonaws.com
 *  - Stripe.js + Elements (patient card capture, PCI SAQ A): js.stripe.com, api.stripe.com, hooks.stripe.com
 *  - images.unsplash.com (marketing images)
 * DrFirst (Rcopia) SSO opens a new tab (window.open / location), so it needs no CSP source.
 * Fonts are self-hosted by next/font.
 *
 * Framing: frame-ancestors 'none' everywhere except /schedule (the public booking embed: *).
 * CSP_REPORT_ONLY=true sends the same policy as Content-Security-Policy-Report-Only (rollout aid).
 */
export type CspEnv = Record<string, string | undefined>;

export const CSP_HEADER = 'Content-Security-Policy';
export const CSP_REPORT_ONLY_HEADER = 'Content-Security-Policy-Report-Only';

/** Routes another site may frame (public booking widget). */
export function isEmbeddablePath(pathname: string): boolean {
  return pathname === '/schedule' || pathname.startsWith('/schedule/');
}

export function cspHeaderName(env: CspEnv = process.env): string {
  return String(env.CSP_REPORT_ONLY ?? '').trim().toLowerCase() === 'true' ? CSP_REPORT_ONLY_HEADER : CSP_HEADER;
}

/** 128-bit random nonce, base64 (Web Crypto: works in the proxy and in Node). */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function regions(env: CspEnv): string[] {
  const list = ['us-east-1', env.AWS_REGION, env.AWS_DEFAULT_REGION, env.TRANSCRIBE_REGION]
    .map((r) => (r || '').trim())
    .filter((r) => /^[a-z]{2}(-[a-z]+)+-\d$/.test(r));
  return Array.from(new Set(list));
}

/** Buckets the browser PUTs to with a presigned URL (virtual-hosted style, as the AWS SDK v3 presigner builds it). */
const BROWSER_UPLOAD_BUCKET_VARS = ['SCRIBE_UPLOAD_BUCKET', 'VALANT_IMPORT_S3_BUCKET', 'DOC_INTAKE_S3_BUCKET'] as const;

function uploadBucketHosts(env: CspEnv): string[] {
  const hosts: string[] = [];
  for (const name of BROWSER_UPLOAD_BUCKET_VARS) {
    const bucket = (env[name] || '').trim();
    if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) continue;
    hosts.push(`https://${bucket}.s3.amazonaws.com`, ...regions(env).map((r) => `https://${bucket}.s3.${r}.amazonaws.com`));
  }
  return Array.from(new Set(hosts));
}

export function buildCsp(opts: { nonce: string; pathname: string; dev?: boolean; env?: CspEnv }): string {
  const env = opts.env ?? process.env;
  const dev = Boolean(opts.dev);
  const stripe = ['https://js.stripe.com', 'https://*.js.stripe.com'];
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': ["'self'", `'nonce-${opts.nonce}'`, "'strict-dynamic'", ...stripe, ...(dev ? ["'unsafe-eval'"] : [])],
    // React style={{}} attributes and next/font need inline styles (style attributes cannot carry a nonce)
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:', 'https://images.unsplash.com', 'https://*.stripe.com'],
    'font-src': ["'self'", 'data:'],
    'connect-src': [
      "'self'",
      'https://*.chime.aws',
      'wss://*.chime.aws',
      ...regions(env).map((r) => `wss://transcribestreaming.${r}.amazonaws.com:8443`),
      ...uploadBucketHosts(env),
      'https://api.stripe.com',
      'https://*.stripe.com',
      ...(dev ? ['ws:', 'http://localhost:*'] : []),
    ],
    'media-src': ["'self'", 'blob:', 'data:', 'mediastream:'],
    'worker-src': ["'self'", 'blob:'],
    'frame-src': ["'self'", ...stripe, 'https://hooks.stripe.com', 'https://*.stripe.network'],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': isEmbeddablePath(opts.pathname) ? ['*'] : ["'none'"],
    'manifest-src': ["'self'"],
  };
  // No upgrade-insecure-requests: HSTS already forces HTTPS, and it would break local `next start` on http
  return Object.entries(directives)
    .map(([k, v]) => `${k} ${v.join(' ')}`)
    .join('; ');
}
