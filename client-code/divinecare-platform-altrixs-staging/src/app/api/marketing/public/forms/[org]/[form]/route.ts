import { NextResponse } from 'next/server';
import { z } from 'zod';
import { clientKey, rateLimit } from '@/lib/security/rateLimit';
import { FORM_RATE_LIMIT } from '@/lib/marketing/forms';
import { getPublicForm, submitPublicForm } from '@/lib/marketing/publicService';

export const runtime = 'nodejs';

const params = z.object({ org: z.string().min(1).max(80).regex(/^[a-z0-9-]+$/), form: z.string().min(1).max(60).regex(/^[a-z0-9-]+$/) });
const noStore = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' };

/** GET: public form definition (no PHI, no staff data). */
export async function GET(_req: Request, ctx: { params: Promise<{ org: string; form: string }> }) {
  const p = params.safeParse(await ctx.params);
  if (!p.success) return NextResponse.json({ success: false, error: 'Form not found.' }, { status: 404 });
  const form = await getPublicForm(p.data.org, p.data.form).catch(() => null);
  if (!form) return NextResponse.json({ success: false, error: 'Form not found.' }, { status: 404, headers: noStore });
  return NextResponse.json({ success: true, form }, { headers: noStore });
}

/** POST: submission in the JSON body (never the URL). Rate limited per IP and per IP + form. */
export async function POST(req: Request, ctx: { params: Promise<{ org: string; form: string }> }) {
  const p = params.safeParse(await ctx.params);
  if (!p.success) return NextResponse.json({ success: false, error: 'Form not found.' }, { status: 404 });
  const ip = rateLimit(clientKey(req, 'mkt-form'), FORM_RATE_LIMIT.perIp.limit, FORM_RATE_LIMIT.perIp.windowMs);
  const per = rateLimit(clientKey(req, `mkt-form:${p.data.org}:${p.data.form}`), FORM_RATE_LIMIT.perForm.limit, FORM_RATE_LIMIT.perForm.windowMs);
  if (!ip.ok || !per.ok) return NextResponse.json({ success: false, error: 'Too many submissions. Please call our office instead.' }, { status: 429, headers: noStore });
  try {
    const body = (await req.json()) as Record<string, unknown>;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ success: false, error: 'Please check the form.' }, { status: 400 });
    const r = await submitPublicForm(p.data.org, p.data.form, body);
    if (!r.ok) return NextResponse.json({ success: false, error: r.error ?? 'Please check the highlighted fields.', errors: r.errors ?? {} }, { status: r.status, headers: noStore });
    return NextResponse.json({ success: true, message: r.message }, { headers: noStore });
  } catch (err) {
    console.error('[marketing public form]', err instanceof Error ? err.name : 'error');
    return NextResponse.json({ success: false, error: 'We could not send your request. Please call our office.' }, { status: 400, headers: noStore });
  }
}
