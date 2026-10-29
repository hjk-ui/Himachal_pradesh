import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireFullAdmin } from '@/lib/auth/requireAdmin';
import { auditRequestMeta } from '@/lib/audit/requestMeta';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { BAA_LEGAL_REVIEWED, BAA_VERSION } from '@/lib/legal/baa';
import {
  baaAuditMetadata,
  baaTextSha256,
  buildBaaAcceptanceRecord,
  needsCurrentBaa,
  parseBaaAcceptance,
} from '@/lib/legal/baaAcceptance';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ADMIN_ONLY = 'Only Admin / Practice Director can view or accept the Business Associate Agreement';

/**
 * GET /api/admin/baa — the organization's BAA acceptances (Admin / Practice Director only).
 *   ?status=1 returns only { needsAcceptance } for the dashboard notice (no audit row).
 * POST /api/admin/baa — accept the current BAA for an existing organization (same fields as
 *   registration: { accepted, version, signerName, signerTitle, signerEmail }).
 */
export async function GET(req: Request) {
  const gate = await requireFullAdmin();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.status === 403 ? ADMIN_ONLY : gate.error }, { status: gate.status });
  }
  const statusOnly = new URL(req.url).searchParams.get('status') === '1';
  try {
    const rows = await prisma.baaAcceptance.findMany({
      where: { organizationId: gate.organizationId },
      orderBy: { acceptedAt: 'desc' },
      take: 50,
    });
    const needsAcceptance = needsCurrentBaa(rows.map((r) => r.baaVersion));
    if (statusOnly) return NextResponse.json({ success: true, needsAcceptance, currentVersion: BAA_VERSION });

    const org = await prisma.organization.findUnique({ where: { id: gate.organizationId }, select: { name: true } });
    const meta = auditRequestMeta(req);
    await writeAuditLog({
      action: 'READ',
      actorUserId: gate.userId,
      actorRole: gate.role,
      organizationId: gate.organizationId,
      resourceType: 'BaaAcceptance',
      outcome: 'SUCCESS',
      ...meta,
      requestId: req.headers.get('x-request-id'),
      metadata: { count: rows.length },
    });
    return NextResponse.json({
      success: true,
      organizationName: org?.name ?? '',
      currentVersion: BAA_VERSION,
      currentTextSha256: baaTextSha256(),
      legalReviewed: BAA_LEGAL_REVIEWED,
      needsAcceptance,
      acceptances: rows.map((r) => ({
        id: r.id,
        signerName: r.signerName,
        signerTitle: r.signerTitle,
        signerEmail: r.signerEmail,
        baaVersion: r.baaVersion,
        textSha256: r.textSha256,
        acceptedAt: r.acceptedAt.toISOString(),
        ipAddress: r.ipAddress,
        userAgent: r.userAgent,
        source: r.source,
        userId: r.userId,
      })),
    });
  } catch {
    return NextResponse.json({ success: false, error: 'Could not load the BAA record.' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const gate = await requireFullAdmin();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.status === 403 ? ADMIN_ONLY : gate.error }, { status: gate.status });
  }
  const raw = await req.json().catch(() => null);
  const baa = parseBaaAcceptance(raw);
  if (!baa.ok) {
    return NextResponse.json({ success: false, error: baa.error, code: 'BAA_REQUIRED' }, { status: baa.status });
  }
  const meta = auditRequestMeta(req);
  try {
    const record = buildBaaAcceptanceRecord({
      organizationId: gate.organizationId,
      userId: gate.userId,
      input: baa.value,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      source: 'admin',
    });
    const row = await prisma.baaAcceptance.create({ data: record, select: { id: true } });
    await writeAuditLog({
      action: 'BAA_ACCEPTED',
      actorUserId: gate.userId,
      actorRole: gate.role,
      organizationId: gate.organizationId,
      resourceType: 'BaaAcceptance',
      resourceId: row.id,
      outcome: 'SUCCESS',
      ...meta,
      requestId: req.headers.get('x-request-id'),
      metadata: baaAuditMetadata(record, row.id),
    });
    return NextResponse.json({ success: true, id: row.id });
  } catch {
    return NextResponse.json({ success: false, error: 'Could not record the BAA acceptance.' }, { status: 500 });
  }
}
