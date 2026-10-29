import { NextResponse } from 'next/server';
import { z } from 'zod';
import { listSignals, pushSignal, resolveJoinToken } from '@/lib/telehealth/signalStore';

export const runtime = 'nodejs';

const postSchema = z.object({
  token: z.string().min(8),
  from: z.enum(['staff', 'client']),
  type: z.enum(['offer', 'answer', 'ice', 'hangup']),
  data: z.unknown(),
});

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get('token') || '';
  const afterSeq = Number(url.searchParams.get('after') || '0');
  const payload = resolveJoinToken(token);
  if (!payload) {
    return NextResponse.json({ success: false, error: 'Invalid or expired link' }, { status: 401 });
  }
  const messages = listSignals(payload.appointmentId, Number.isFinite(afterSeq) ? afterSeq : 0);
  return NextResponse.json({ success: true, messages });
}

export async function POST(req: Request) {
  try {
    const body = postSchema.parse(await req.json());
    const payload = resolveJoinToken(body.token);
    if (!payload) {
      return NextResponse.json({ success: false, error: 'Invalid or expired link' }, { status: 401 });
    }
    const message = pushSignal(payload.appointmentId, {
      from: body.from,
      type: body.type,
      data: body.data,
    });
    return NextResponse.json({ success: true, message });
  } catch (err: unknown) {
    const message = err instanceof z.ZodError ? 'Invalid signal' : (err as Error).message;
    return NextResponse.json({ success: false, error: message || 'Could not send signal' }, { status: 400 });
  }
}
