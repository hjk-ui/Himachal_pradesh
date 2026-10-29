import { NextResponse } from 'next/server';
import { z } from 'zod';
import { clientKey, rateLimit } from '@/lib/security/rateLimit';
import { getPublicEvent, registerForEvent } from '@/lib/marketing/publicService';

export const runtime = 'nodejs';

const params = z.object({ org: z.string().min(1).max(80).regex(/^[a-z0-9-]+$/), slug: z.string().min(1).max(60).regex(/^[a-z0-9-]+$/) });
const noStore = { 'Cache-Control': 'no-store' };

export async function GET(_req: Request, ctx: { params: Promise<{ org: string; slug: string }> }) {
  const p = params.safeParse(await ctx.params);
  if (!p.success) return NextResponse.json({ success: false, error: 'Event not found.' }, { status: 404 });
  const event = await getPublicEvent(p.data.org, p.data.slug).catch(() => null);
  if (!event) return NextResponse.json({ success: false, error: 'Event not found.' }, { status: 404, headers: noStore });
  return NextResponse.json({ success: true, event }, { headers: noStore });
}

export async function POST(req: Request, ctx: { params: Promise<{ org: string; slug: string }> }) {
  const p = params.safeParse(await ctx.params);
  if (!p.success) return NextResponse.json({ success: false, error: 'Event not found.' }, { status: 404 });
  const limited = rateLimit(clientKey(req, `mkt-event:${p.data.org}:${p.data.slug}`), 5, 10 * 60 * 1000);
  if (!limited.ok) return NextResponse.json({ success: false, error: 'Too many registrations from this connection. Please try later.' }, { status: 429 });
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const r = await registerForEvent(p.data.org, p.data.slug, body ?? {});
    if (!r.ok) return NextResponse.json({ success: false, error: r.error ?? 'Please check the form.', errors: r.errors ?? {} }, { status: r.status, headers: noStore });
    return NextResponse.json({ success: true, message: r.message }, { headers: noStore });
  } catch (err) {
    console.error('[marketing public event]', err instanceof Error ? err.name : 'error');
    return NextResponse.json({ success: false, error: 'Registration failed. Please try again.' }, { status: 400 });
  }
}
