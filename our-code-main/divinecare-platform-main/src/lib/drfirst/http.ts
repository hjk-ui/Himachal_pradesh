import 'server-only';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { rateLimit } from '@/lib/security/rateLimit';
import { assertDrFirstPrescriber, type DrFirstContext } from './access';
import { DrFirstError, safeDrFirstError } from './errors';
const localId = z.string().trim().min(1).max(128);
export const launchSchema = z.object({ clientId: localId, failure: z.enum(['none', 'patient', 'prescriber', 'unavailable']).optional() }).strict();
export const patientSchema = z.object({ clientId: localId, linkImported: z.boolean().optional() }).strict();
export const prescriberSchema = z.object({ userId: localId.optional() }).strict();
export async function readInput<T>(req: Request, schema: z.ZodType<T>): Promise<T> {
  if (req.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new DrFirstError('DRFIRST_INVALID_INPUT', 415);
  const maxBytes = 4096; // These routes accept only short identifiers and a failure enum.
  if (Number(req.headers.get('content-length')) > maxBytes) throw new DrFirstError('DRFIRST_INVALID_INPUT', 413);
  const reader = req.body?.getReader();
  if (!reader) throw new DrFirstError('DRFIRST_INVALID_INPUT');
  let size = 0;
  let body = '';
  const decoder = new TextDecoder('utf-8', { fatal: true });
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        void reader.cancel().catch(() => {});
        throw new DrFirstError('DRFIRST_INVALID_INPUT', 413);
      }
      body += decoder.decode(value, { stream: true });
    }
    return schema.parse(JSON.parse(body + decoder.decode()));
  } catch (error) {
    if (error instanceof DrFirstError) throw error;
    throw new DrFirstError('DRFIRST_INVALID_INPUT');
  } finally { reader.releaseLock(); }
}
export async function drFirstRoute(req: Request, operation: (context: DrFirstContext) => Promise<NextResponse>, statusOnly = false) {
  try {
    const gate = await requireOrgContext();
    if (!gate.ok) throw new DrFirstError(gate.status === 503 ? 'DRFIRST_EXTERNAL_SERVICE_ERROR' : 'DRFIRST_UNAUTHORIZED', gate.status);
    if (!(statusOnly && ['ADMIN', 'DIRECTOR'].includes(gate.role))) assertDrFirstPrescriber(gate);
    if (req.method !== 'GET') {
      if (req.headers.get('origin') !== new URL(req.url).origin) throw new DrFirstError('DRFIRST_UNAUTHORIZED', 403);
      if (!rateLimit(`drfirst:${gate.organizationId}:${gate.userId}`, 20, 60_000).ok) throw new DrFirstError('DRFIRST_EXTERNAL_SERVICE_ERROR', 429);
    }
    const response = await operation(gate);
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('Referrer-Policy', 'no-referrer');
    return response;
  } catch (error) {
    const safe = safeDrFirstError(error);
    // Prefer exact staging detail for open-stop paths (demographics / upload).
    const errorText = safe.detail?.trim() || safe.message;
    return NextResponse.json(
      {
        success: false,
        code: safe.code,
        error: errorText,
        ...(safe.detail ? { detail: safe.detail } : {}),
        ...(safe.missingFields?.length ? { missingFields: safe.missingFields } : {}),
      },
      { status: safe.status, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
