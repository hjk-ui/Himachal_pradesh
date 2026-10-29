import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { currentVersion } from '@/lib/version';

export const dynamic = 'force-dynamic';

const DB_TIMEOUT_MS = 2_000;

async function dbReachable(): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), DB_TIMEOUT_MS);
    });
    await Promise.race([prisma.$queryRaw`SELECT 1`, timeout]);
    return true;
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Readiness: the database answers SELECT 1 within 2 s. 200 when ready, 503 when not.
 * Public; returns only { ok, db, version } (never the error text, host or connection string).
 */
export async function GET() {
  const dbOk = await dbReachable();
  return NextResponse.json(
    { ok: dbOk, db: dbOk ? 'ok' : 'unavailable', version: currentVersion().version },
    { status: dbOk ? 200 : 503, headers: { 'Cache-Control': 'no-store' } }
  );
}
