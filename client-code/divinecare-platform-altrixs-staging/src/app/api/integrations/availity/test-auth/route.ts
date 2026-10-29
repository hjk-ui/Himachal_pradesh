import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { AvailityAuthError, getAvailityAccessToken } from '@/lib/integrations/availity/auth';
import { rateLimit } from '@/lib/security/rateLimit';

/** Testing the practice's Availity credentials is an admin/integration action, not an eligibility one. */
const ADMIN_PATH = '/dashboard/admin';

export async function POST() {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  if (!canAccessPath(gate.role, ADMIN_PATH)) {
    return NextResponse.json(
      { success: false, error: 'You do not have permission to test Availity authentication' },
      { status: 403 }
    );
  }

  const limited = rateLimit(`availity-test-auth:${gate.organizationId}:${gate.userId}`, 10, 15 * 60 * 1000);
  if (!limited.ok) {
    return NextResponse.json(
      { success: false, error: 'Too many Availity auth tests. Try again later.' },
      { status: 429 }
    );
  }

  try {
    await getAvailityAccessToken();
    return NextResponse.json({
      success: true,
      message: 'Availity authentication successful',
    });
  } catch (err) {
    if (err instanceof AvailityAuthError) {
      return NextResponse.json({ success: false, error: err.message }, { status: err.status });
    }
    console.error('[availity-test-auth]', err instanceof Error ? err.name : 'unknown');
    return NextResponse.json(
      { success: false, error: 'Availity authentication failed' },
      { status: 500 }
    );
  }
}
