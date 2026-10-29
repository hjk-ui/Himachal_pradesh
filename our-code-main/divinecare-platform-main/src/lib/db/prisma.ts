import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export function getDatasourceUrl() {
  const raw = process.env.DATABASE_URL;
  if (!raw) return undefined;

  try {
    const url = new URL(raw);
    const isLocalSshTunnel = url.hostname === '127.0.0.1' && url.port === '5433';

    if (isLocalSshTunnel) {
      // Tunnel is slow/flaky; always overwrite — leftover ?connection_limit=3 causes P2024.
      // connect_timeout helps brief SSH blips; keep pool small so page-load fan-out doesn't stall.
      url.searchParams.set('connection_limit', '5');
      url.searchParams.set('pool_timeout', '60');
      url.searchParams.set('connect_timeout', '30');
      url.searchParams.set('sslaccept', 'accept_invalid_certs');
    } else if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
      // Remote databases default to hostname + certificate verification.
      if (!url.searchParams.has('sslmode')) url.searchParams.set('sslmode', 'verify-full');
    }

    return url.toString();
  } catch {
    return raw;
  }
}

const datasourceUrl = getDatasourceUrl();

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasourceUrl,
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });

if (!(prisma as any).practiceLocation) {
  Object.defineProperty(prisma, 'practiceLocation', {
    get() {
      return (this as any).location;
    },
    configurable: true,
  });
}

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
