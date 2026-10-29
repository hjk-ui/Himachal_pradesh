const { execSync } = require('child_process');

// Release stamp (see src/lib/version.ts). ALTRIXS_COMMIT / ALTRIXS_TAGS override git for builds without .git.
function git(cmd) {
  try {
    return execSync(`git ${cmd}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return '';
  }
}
const buildStamp = {
  NEXT_PUBLIC_ALTRIXS_COMMIT: process.env.ALTRIXS_COMMIT || git('rev-parse --short=7 HEAD'),
  NEXT_PUBLIC_ALTRIXS_TAGS: process.env.ALTRIXS_TAGS || git('tag --points-at HEAD').split(/\s+/).filter(Boolean).join(','),
  NEXT_PUBLIC_ALTRIXS_BUILT_AT: new Date().toISOString(),
  NEXT_PUBLIC_ALTRIXS_ENV: process.env.ALTRIXS_ENV || 'development',
};

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: buildStamp,
  poweredByHeader: false,
  experimental: {
    // Requests pass through the proxy (middleware), which cuts bodies off at 10 MB by default.
    // Doc intake accepts scans up to 20 MB; nginx allows 25 MB.
    proxyClientMaxBodySize: '25mb',
  },
  typescript: {
    ignoreBuildErrors: process.env.ALTRIXS_SKIP_BUILD_TYPECHECK === '1',
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
        pathname: '/**',
      },
    ],
  },
  async headers() {
    const base = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), geolocation=()' },
      { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
    ];
    // Content-Security-Policy is NOT set here: it carries a per-request nonce, so src/proxy.ts builds it
    // for every route (src/lib/security/csp.ts), including /schedule's `frame-ancestors *` for the
    // booking embed. Setting it here as well would send two policies (the browser enforces both).
    // CSP_REPORT_ONLY=true switches it to Content-Security-Policy-Report-Only.
    return [
      {
        source: '/schedule',
        headers: base,
      },
      {
        source: '/dashboard/:path*',
        headers: [...base, { key: 'X-Frame-Options', value: 'DENY' }],
      },
      {
        source: '/api/:path*',
        headers: [...base, { key: 'X-Frame-Options', value: 'DENY' }],
      },
      {
        source: '/:path*',
        headers: base,
      },
    ];
  },
  async rewrites() {
    return {
      // Old rows store /uploads/<kind>/<file>. Send them through the signed-in file route
      // BEFORE public/ is checked, so files left in public/uploads are never served directly.
      beforeFiles: [{ source: '/uploads/:kind/:name', destination: '/api/files/:kind/:name' }],
    };
  },
};

module.exports = nextConfig;
