import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { clientLabelMap, staffNameMap } from '@/lib/audit/clientLabels';
import { isSensitivePrivilegedRole } from '@/lib/privacy/sensitiveRoles';
import {
  DISCLOSURE_SELECT,
  canUsePart2Page,
  checkPart2ClientAccess,
  disclosureInputSchema,
  disclosureView,
} from '@/lib/privacy/part2Disclosures';
import { loadDisclosureConsent } from '@/lib/consents/library/store2';
import { disclosureConsentCheck } from '@/lib/consents/library/revocation';
import { PART2_REDISCLOSURE_NOTICE } from '@/lib/consents/library/elements';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/*
 * 42 CFR Part 2 disclosures. Append-only by design: this route has GET and POST only —
 * there is no PUT / PATCH / DELETE anywhere, and the table has an UPDATE/DELETE trigger.
 * A mistaken entry is corrected by recording a new disclosure, never by editing one.
 */

/**
 * GET /api/part2/disclosures?clientId=… — disclosures for one client (Part 2 page roles,
 * protected-record rules apply). Read rule: ADMIN / PD or a treating clinician with the client on
 * their caseload (src/lib/privacy/part2DisclosureAccess.ts); Billing / Front Desk / Office Manager
 * may record (POST) but not read. Without clientId: the org's latest 200, ADMIN / PD only.
 */
export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  const clientId = new URL(req.url).searchParams.get('clientId')?.trim().slice(0, 191) || null;

  try {
    if (clientId) {
      const access = await checkPart2ClientAccess({ ...gate, clientId, path: '/api/part2/disclosures' });
      if (access.ok === false) {
        if (access.denied) {
          await auditPhiAccess({ gate, req, action: 'LIST', resourceType: 'part2Disclosure', patientId: clientId, outcome: 'DENIED' });
        }
        return NextResponse.json({ success: false, error: access.error }, { status: access.status });
      }
    } else if (!canUsePart2Page(gate.role) || !isSensitivePrivilegedRole(gate.role)) {
      await auditPhiAccess({ gate, req, action: 'LIST', resourceType: 'part2Disclosure', outcome: 'DENIED' });
      return NextResponse.json({ success: false, error: 'Only Admin / Practice Director can list all disclosures' }, { status: 403 });
    }

    const rows = await prisma.part2Disclosure.findMany({
      where: { organizationId: gate.organizationId, ...(clientId ? { clientId } : {}) },
      select: DISCLOSURE_SELECT,
      orderBy: [{ disclosedAt: 'desc' }, { createdAt: 'desc' }],
      take: clientId ? 500 : 200,
    });
    const [names, clients] = await Promise.all([
      staffNameMap(gate.organizationId, rows.map((r) => r.disclosedById)),
      clientLabelMap({ ...gate, clientIds: rows.map((r) => r.clientId) }),
    ]);
    await auditPhiAccess({
      gate,
      req,
      action: 'LIST',
      resourceType: 'part2Disclosure',
      patientId: clientId,
      metadata: { returned: rows.length, scope: clientId ? 'client' : 'org' },
    });
    return NextResponse.json({
      success: true,
      disclosures: rows.map((r) => ({ ...disclosureView(r, names), client: clients.get(r.clientId) ?? null })),
    });
  } catch (err) {
    console.error('[part2 disclosures GET]', err instanceof Error ? err.name : 'error');
    return NextResponse.json({ success: false, error: 'Could not load disclosures' }, { status: 500 });
  }
}

/** POST /api/part2/disclosures — record one disclosure (append-only). */
export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });

  const parsed = disclosureInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0]?.message || 'Invalid disclosure', issues: parsed.error.issues },
      { status: 400 }
    );
  }
  const body = parsed.data;

  try {
    // Recording: ADMIN / PD, treating clinicians on the caseload, or the release desk (Billing,
    // Front Desk, Office Manager) for clients they can see; the Part 2 lock applies to all
    const access = await checkPart2ClientAccess({ ...gate, clientId: body.clientId, path: '/api/part2/disclosures', mode: 'record' });
    if (access.ok === false) {
      if (access.denied) {
        await auditPhiAccess({ gate, req, action: 'CREATE', resourceType: 'part2Disclosure', patientId: body.clientId, outcome: 'DENIED' });
      }
      return NextResponse.json({ success: false, error: access.error }, { status: access.status });
    }
    if (body.consentFormId) {
      // The consent must be an ROI / Part 2 authorization for this client, signed, not revoked and
      // not expired on the disclosure date (src/lib/consents/library/revocation.ts)
      const consent = await loadDisclosureConsent(gate.organizationId, body.consentFormId);
      const valid = disclosureConsentCheck(consent, body.clientId, new Date(body.disclosedAt));
      if (valid.ok === false) {
        await auditPhiAccess({ gate, req, action: 'CREATE', resourceType: 'part2Disclosure', patientId: body.clientId, outcome: 'DENIED', metadata: { reason: 'consent_not_valid' } });
        return NextResponse.json({ success: false, error: valid.reason }, { status: 409 });
      }
    }

    const row = await prisma.part2Disclosure.create({
      data: {
        organizationId: gate.organizationId,
        clientId: body.clientId,
        consentFormId: body.consentFormId || null,
        consentReference: body.consentReference || null,
        basis: body.basis,
        disclosedTo: body.disclosedTo,
        purpose: body.purpose,
        informationDisclosed: body.informationDisclosed,
        method: body.method,
        disclosedAt: body.disclosedAt,
        disclosedById: gate.userId,
      },
      select: DISCLOSURE_SELECT,
    });
    await auditPhiAccess({
      gate,
      req,
      action: 'CREATE',
      resourceType: 'part2Disclosure',
      resourceId: row.id,
      patientId: row.clientId,
      metadata: { basis: row.basis, method: row.method, consentOnFile: !!row.consentFormId, redisclosureNotice: true },
    });
    const names = await staffNameMap(gate.organizationId, [row.disclosedById]);
    // 42 CFR §2.32: this notice must accompany each disclosure made with the patient's consent
    return NextResponse.json({ success: true, disclosure: disclosureView(row, names), redisclosureNotice: PART2_REDISCLOSURE_NOTICE }, { status: 201 });
  } catch (err) {
    console.error('[part2 disclosures POST]', err instanceof Error ? err.name : 'error');
    return NextResponse.json({ success: false, error: 'Could not record disclosure' }, { status: 500 });
  }
}
