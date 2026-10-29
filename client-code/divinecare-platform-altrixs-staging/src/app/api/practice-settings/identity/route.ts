import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { loadPracticeIdentity } from '@/lib/practice/identity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET: practice display name + accreditation for letters/forms. Any signed-in staff of the org; no PHI. */
export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  try {
    const identity = await loadPracticeIdentity(gate.organizationId);
    return NextResponse.json({ success: true, identity }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('[practice-settings/identity GET]', error instanceof Error ? error.message : 'unknown error');
    return NextResponse.json({ success: false, error: 'Could not load the practice name' }, { status: 500 });
  }
}
