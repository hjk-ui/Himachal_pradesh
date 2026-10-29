import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { prisma } from '@/lib/db/prisma';
import { clientOrgFilter } from '@/lib/clients/orgScope';
import { AvailityAuthError } from '@/lib/integrations/availity/auth';
import { checkLiveEligibility } from '@/lib/integrations/availity/provider';
import { AvailityEligibilityError } from '@/lib/integrations/availity/errors';
import { rateLimit } from '@/lib/security/rateLimit';
import { auditPhiAccess } from '@/lib/audit/requestMeta';

export const runtime = 'nodejs';

/**
 * POST /api/prp/eligibility — real Availity 270/271 (Coverages) when configured.
 * No DEMO_ELG. Fail closed if Availity is down / not configured / inactive.
 *
 * TEST-ONLY: PRP_ELIGIBILITY_TEST_PASS=true (never default) allows a single local/dev
 * bypass so enroll + PriorAuth can be proven when Availity returns 502. Production
 * and unset env always fail closed / live Availity.
 */
function testPassEnabled() {
  return (
    process.env.PRP_ELIGIBILITY_TEST_PASS === 'true' &&
    process.env.NODE_ENV !== 'production'
  );
}

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const limited = rateLimit(
    `prp-eligibility:${gate.organizationId}:${gate.userId}`,
    20,
    15 * 60 * 1000
  );
  if (!limited.ok) {
    return NextResponse.json(
      { success: false, error: 'Too many eligibility requests. Try again later.' },
      { status: 429 }
    );
  }

  const body = await req.json();
  const client = await prisma.client.findFirst({
    where: { id: body.clientId, ...clientOrgFilter(gate.organizationId) },
    select: {
      id: true,
      name: true,
      insuranceMemberId: true,
      insurancePayer: true,
      insuranceGroupNumber: true,
      dateOfBirth: true,
      gender: true,
      state: true,
    },
  });
  if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 });

  const auditEligibility = (
    mode: string,
    extra: Record<string, unknown>,
    outcome: 'SUCCESS' | 'FAILURE' = 'SUCCESS'
  ) =>
    auditPhiAccess({
      gate,
      req,
      action: 'READ',
      resourceType: 'prpEligibility',
      resourceId: client.id,
      patientId: client.id,
      outcome,
      metadata: { mode, ...extra },
    });

  if (!client.insuranceMemberId || !client.insurancePayer) {
    await auditEligibility('missing_insurance', { transmitted: false });
    return NextResponse.json({
      success: true,
      active: false,
      prpCovered: false,
      message: 'Missing insurance member ID or payer — cannot run 270/271',
      endpoint: '/api/prp/eligibility → Availity Coverages',
      testPass: false,
    });
  }

  // Explicit local/dev bypass only when flag is set — never invent eligible by default
  if (testPassEnabled()) {
    await auditEligibility('test_pass', { transmitted: false });
    return NextResponse.json({
      success: true,
      active: true,
      prpCovered: true,
      status: 'ELIGIBLE',
      mode: 'test_pass',
      message:
        'TEST PASS (PRP_ELIGIBILITY_TEST_PASS=true) — Availity bypass for local enroll proof only',
      endpoint: '/api/prp/eligibility (TEST PASS — not live Availity)',
      testPass: true,
    });
  }

  const provider = await prisma.user.findFirst({
    where: { id: gate.userId, organizationId: gate.organizationId },
    select: { npi: true, name: true },
  });

  try {
    const result = await checkLiveEligibility({
      clientName: client.name,
      memberId: client.insuranceMemberId,
      payerName: client.insurancePayer,
      insurancePayer: client.insurancePayer,
      insuranceGroupNumber: client.insuranceGroupNumber,
      dateOfBirth: client.dateOfBirth,
      gender: client.gender,
      state: client.state,
      providerNpi: provider?.npi ?? null,
      providerName: provider?.name ?? null,
      dateOfService: new Date(),
    });

    const active = result.status === 'ELIGIBLE';
    const services = (result.benefits?.coveredServices || []).map((s) =>
      String(s).toLowerCase()
    );
    const prpListed = services.some(
      (s) =>
        s.includes('prp') ||
        s.includes('h2017') ||
        s.includes('psychosocial') ||
        s.includes('rehab')
    );
    // true only when the 271 lists a PRP benefit; 'unknown' when coverage is active but
    // no PRP benefit came back (the Optum authorization is then the real coverage check).
    const prpCovered: boolean | 'unknown' = !active ? false : prpListed ? true : 'unknown';

    await auditEligibility(String(result.mode ?? 'live'), {
      transmitted: true,
      recipient: 'availity',
      status: result.status,
      prpCovered,
    });

    return NextResponse.json({
      success: true,
      active,
      prpCovered,
      status: result.status,
      mode: result.mode,
      message: active
        ? `271 active (${client.insurancePayer}) — PRP benefit ${prpListed ? 'listed in 271' : 'not confirmed in 271'}`
        : `271 status ${result.status} — not eligible for PRP enroll`,
      endpoint: '/api/prp/eligibility (Availity Coverages 270/271)',
      benefits: result.benefits,
      testPass: false,
    });
  } catch (err) {
    await auditEligibility(
      'live',
      {
        transmitted: true,
        recipient: 'availity',
        error: err instanceof AvailityEligibilityError ? err.code : err instanceof Error ? err.name : 'unknown',
      },
      'FAILURE'
    );
    if (err instanceof AvailityEligibilityError) {
      return NextResponse.json(
        {
          success: false,
          active: false,
          prpCovered: false,
          error: err.message,
          code: err.code,
          endpoint: '/api/prp/eligibility (Availity Coverages 270/271)',
          testPass: false,
        },
        { status: err.status }
      );
    }
    if (err instanceof AvailityAuthError) {
      return NextResponse.json(
        {
          success: false,
          active: false,
          prpCovered: false,
          error: err.message,
          endpoint: '/api/prp/eligibility (Availity Coverages 270/271)',
          testPass: false,
        },
        { status: err.status }
      );
    }
    console.error('[prp-eligibility]', err instanceof Error ? err.name : 'unknown');
    return NextResponse.json(
      {
        success: false,
        active: false,
        prpCovered: false,
        error: 'Eligibility check failed',
        endpoint: '/api/prp/eligibility (Availity Coverages 270/271)',
        testPass: false,
      },
      { status: 500 }
    );
  }
}
