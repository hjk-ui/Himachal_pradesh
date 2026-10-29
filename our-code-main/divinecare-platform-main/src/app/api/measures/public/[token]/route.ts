import { NextResponse } from 'next/server';
import { z } from 'zod';
import { clientKey, rateLimit } from '@/lib/security/rateLimit';
import {
  createMeasureSession,
  hashMeasureToken,
  isWellFormedMeasureToken,
  MEASURE_COOKIE_PATH,
  MEASURE_SESSION_TTL_SECONDS,
  measureCookieName,
  verifyMeasureSession,
} from '@/lib/measures/hash';
import { buildPublicView, findRequestByHash, saveAnswers, verifyDob } from '@/lib/measures/public';
import { PATIENT_COPY } from '@/lib/measures/copy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HEADERS = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } as const;

const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('verify'), dob: z.string().max(10) }),
  z.object({ action: z.literal('save'), answers: z.record(z.string(), z.number()) }),
  z.object({ action: z.literal('complete'), answers: z.record(z.string(), z.number()) }),
]);

type Ctx = { params: Promise<{ token: string }> };

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: HEADERS });
}

function limited(req: Request) {
  // 60 requests / minute / IP across the public measure endpoints.
  return !rateLimit(clientKey(req, 'measures-public'), 60, 60_000).ok;
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

/** GET — what the patient may see right now (verify gate, questions with saved answers, or done). */
export async function GET(req: Request, ctx: Ctx) {
  if (limited(req)) return json({ success: false, error: 'Too many requests. Please try again shortly.' }, 429);
  const { token } = await ctx.params;
  if (!isWellFormedMeasureToken(token)) return json({ success: true, view: { state: 'invalid' } });

  const row = await findRequestByHash(hashMeasureToken(token));
  const verified = Boolean(row && verifyMeasureSession(row.id, readCookie(req, measureCookieName(row.id))));
  return json({ success: true, view: await buildPublicView(row, verified) });
}

/** POST — verify DOB, save progress, or complete. */
export async function POST(req: Request, ctx: Ctx) {
  if (limited(req)) return json({ success: false, error: 'Too many requests. Please try again shortly.' }, 429);
  const { token } = await ctx.params;
  if (!isWellFormedMeasureToken(token)) return json({ success: false, state: 'invalid', error: PATIENT_COPY.invalid }, 404);

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ success: false, error: PATIENT_COPY.error }, 400);
  const body = parsed.data;

  const row = await findRequestByHash(hashMeasureToken(token));
  if (!row) return json({ success: false, state: 'invalid', error: PATIENT_COPY.invalid }, 404);

  if (body.action === 'verify') {
    const result = await verifyDob(row, body.dob);
    if (result.ok === true) {
      const res = json({ success: true, view: await buildPublicView(row, true) });
      res.cookies.set(measureCookieName(row.id), createMeasureSession(row.id), {
        httpOnly: true,
        sameSite: 'strict',
        secure: process.env.NODE_ENV === 'production',
        path: MEASURE_COOKIE_PATH,
        maxAge: MEASURE_SESSION_TTL_SECONDS,
      });
      return res;
    }
    if (result.reason === 'wrong_dob') {
      const left = result.attemptsLeft ?? 0;
      return json({ success: false, state: 'verify', attemptsLeft: left, error: PATIENT_COPY.verifyWrong(left) }, 403);
    }
    if (result.reason === 'locked') return json({ success: false, state: 'locked', error: PATIENT_COPY.locked }, 423);
    if (result.reason === 'expired') return json({ success: false, state: 'expired', error: PATIENT_COPY.expired }, 410);
    return json({ success: false, state: 'invalid', error: PATIENT_COPY.invalid }, 404);
  }

  // save / complete require the DOB session cookie issued above.
  if (!verifyMeasureSession(row.id, readCookie(req, measureCookieName(row.id)))) {
    return json({ success: false, state: 'verify', error: PATIENT_COPY.verifyHelp }, 401);
  }

  const outcome = await saveAnswers(row, body.answers, body.action === 'complete');
  if (outcome.ok === true) return json({ success: true, completed: outcome.completed, crisis: outcome.crisis });

  switch (outcome.reason) {
    case 'expired':
      return json({ success: false, state: 'expired', error: PATIENT_COPY.expired }, 410);
    case 'locked':
      return json({ success: false, state: 'locked', error: PATIENT_COPY.locked }, 423);
    case 'already_completed':
      return json({ success: false, state: 'completed', error: PATIENT_COPY.thanksBody }, 409);
    case 'bad_answers':
      return json({ success: false, error: outcome.message || PATIENT_COPY.error }, 400);
    default:
      return json({ success: false, state: 'invalid', error: PATIENT_COPY.invalid }, 404);
  }
}
