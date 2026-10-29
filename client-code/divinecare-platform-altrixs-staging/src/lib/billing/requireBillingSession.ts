import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth/requireSession';

/** Roles allowed to submit claims and read clearinghouse responses and remittances (PHI): billing +
 * leadership. Office Manager removed 2026-10-22 (owner: patient-side billing only). */
const BILLING_ROLES = new Set(['BILLING', 'ADMIN', 'PRACTICE_DIRECTOR', 'DIRECTOR']);

type Session = Extract<Awaited<ReturnType<typeof requireSession>>, { ok: true }>;

/** Returns the billing session, or a ready-to-return 401/403 response. */
export async function requireBillingSession(): Promise<{ session: Session; denied?: never } | { session?: never; denied: NextResponse }> {
  const s = await requireSession();
  if (!s.ok) return { denied: NextResponse.json({ error: s.error }, { status: s.status }) };
  if (!BILLING_ROLES.has(String(s.role))) {
    return { denied: NextResponse.json({ error: 'Billing access required' }, { status: 403 }) };
  }
  return { session: s };
}
