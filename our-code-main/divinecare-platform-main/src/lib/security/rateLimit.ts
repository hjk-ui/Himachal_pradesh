const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true as const, remaining: limit - 1 };
  }
  if (current.count >= limit) {
    return { ok: false as const, remaining: 0, retryAt: current.resetAt };
  }
  current.count += 1;
  return { ok: true as const, remaining: limit - current.count };
}

export function clientKey(req: Request, prefix: string) {
  const forwarded = req.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown';
  return `${prefix}:${ip}`;
}
