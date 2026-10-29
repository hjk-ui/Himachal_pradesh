/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typescript: {
    ignoreBuildErrors: true,
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
    ];
    return [
      {
        source: '/schedule',
        headers: [...base, { key: 'Content-Security-Policy', value: 'frame-ancestors *' }],
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
};

module.exports = nextConfig;
