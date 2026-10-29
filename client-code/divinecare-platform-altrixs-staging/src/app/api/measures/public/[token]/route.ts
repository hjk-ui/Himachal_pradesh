import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { auditRequestMeta } from '@/lib/audit/requestMeta';
import { clientKey, rateLimit } from '@/lib/security/rateLimit';
import { SESSION_COOKIE } from '@/lib/measures/token';
import {
  completeMeasureLink,
  openMeasureLink,
  resumeMeasureLink,
  saveMeasureLinkAnswers,
  verifyMeasureLink,
} from '@/lib/measures/patientLink';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Public measure link API (/m/<token>; no login). GET: link state only (no PHI). POST actions:
 * verify { dob } (3 wrong tries lock the link; success sets the httpOnly session cookie), resume,
 * save { answers }, complete { answers }. Rate limited per IP.
 */
const tokenSchema = z.string().min(20).max(100).regex(/^[A-Za-z0-9_-]+$/);
const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('verify'), dob: z.string().trim().min(6).max(20) }),
  z.object({ action: z.literal('resume') }),
  z.object({ action: z.literal('save'), answers: z.record(z.string(), z.record(z.string(), z.number())) }),
  z.object({ action: z.literal('complete'), answers: z.record(z.string(), z.record(z.string(), z.number())) }),
]);

const noStore = { 'Cache-Control': 'no-store' };

function limited(req: Request) {
  const r = rateLimit(clientKey(req, 'measure-link'), 60, 60_000);
  return r.ok ? null : NextResponse.json({ success: false, error: 'Too many requests. Please wait a minute.' }, { status: 429, headers: noStore });
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const tooMany = limited(req);
  if (tooMany) return tooMany;
  const parsed = tokenSchema.safeParse((await ctx.params).token);
  if (!parsed.success) return NextResponse.json({ success: true, state: 'invalid', practiceName: null, measureCount: 0 }, { headers: noStore });
  try {
    const view = await openMeasureLink(parsed.data, auditRequestMeta(req));
    return NextResponse.json({ success: true, ...view }, { headers: noStore });
  } catch (err) {
    console.error('[measures/public GET]', err instanceof Error ? err.message : 'error');
    return NextResponse.json({ success: false, error: 'This link could not be opened' }, { status: 500, headers: noStore });
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const tooMany = limited(req);
  if (tooMany) return tooMany;
  const parsed = tokenSchema.safeParse((await ctx.params).token);
  if (!parsed.success) return NextResponse.json({ success: false, state: 'invalid' }, { status: 404, headers: noStore });
  const token = parsed.data;
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400, headers: noStore });
  const meta = auditRequestMeta(req);
  const cookie = req.cookies.get(SESSION_COOKIE)?.value ?? null;
  try {
    const b = body.data;
    if (b.action === 'verify') {
      const r = await verifyMeasureLink(token, b.dob, meta);
      if (r.ok === false) return NextResponse.json({ success: false, state: r.state, remaining: r.remaining ?? null }, { status: r.state === 'wrong_dob' ? 401 : 409, headers: noStore });
      const res = NextResponse.json({ success: true, questionnaire: r.questionnaire }, { headers: noStore });
      res.cookies.set(SESSION_COOKIE, r.sessionSecret, {
        httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: `/api/measures/public/${token}`, expires: r.sessionExpiresAt,
      });
      return res;
    }
    if (b.action === 'resume') {
      const r = await resumeMeasureLink(token, cookie);
      if (r.ok === false) return NextResponse.json({ success: false, state: r.state }, { status: 409, headers: noStore });
      return NextResponse.json({ success: true, questionnaire: r.questionnaire }, { headers: noStore });
    }
    if (b.action === 'save') {
      const r = await saveMeasureLinkAnswers(token, cookie, b.answers, meta);
      if (r.ok === false) return NextResponse.json({ success: false, state: r.state }, { status: 409, headers: noStore });
      return NextResponse.json({ success: true }, { headers: noStore });
    }
    const r = await completeMeasureLink(token, cookie, b.answers, meta);
    if (r.ok === false) return NextResponse.json({ success: false, state: r.state, instrumentId: r.instrumentId ?? null }, { status: r.state === 'incomplete' ? 400 : 409, headers: noStore });
    const res = NextResponse.json({ success: true, crisis: r.crisis }, { headers: noStore });
    res.cookies.set(SESSION_COOKIE, '', { path: `/api/measures/public/${token}`, maxAge: 0 });
    return res;
  } catch (err) {
    console.error('[measures/public POST]', err instanceof Error ? err.message : 'error');
    return NextResponse.json({ success: false, error: 'Something went wrong. Your answers are saved; please try again.' }, { status: 500, headers: noStore });
  }
}
