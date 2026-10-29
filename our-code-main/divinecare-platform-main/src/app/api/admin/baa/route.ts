import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { prisma } from '@/lib/db/prisma';
import {
  BAA_LEGAL_REVIEWED,
  BAA_MISSING_SIGNER,
  BAA_MUST_ACCEPT,
  BAA_STALE_CODE,
  BAA_STALE_MESSAGE,
  BAA_TITLE,
  BAA_VERSION,
  baaPlainText,
  baaTextSha256,
} from '@/lib/legal/baa';

export const runtime = 'nodejs';

function canManageBaa(role: string) {
  return role === 'ADMIN' || role === 'PRACTICE_DIRECTOR';
}

export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canManageBaa(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const acceptances = await prisma.baaAcceptance.findMany({
    where: { organizationId: gate.organizationId },
    orderBy: { acceptedAt: 'desc' },
    take: 20,
  });
  const latest = acceptances[0] || null;
  const org = await prisma.organization.findUnique({
    where: { id: gate.organizationId },
    select: { name: true },
  });

  return NextResponse.json({
    success: true,
    title: BAA_TITLE,
    version: BAA_VERSION,
    legalReviewed: BAA_LEGAL_REVIEWED,
    plainText: baaPlainText(),
    textSha256: baaTextSha256(),
    orgName: org?.name || '',
    currentAccepted: latest?.version === BAA_VERSION,
    latest,
    acceptances,
  });
}

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canManageBaa(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as {
    accepted?: boolean;
    version?: string;
    signerName?: string;
    signerTitle?: string;
    signerEmail?: string;
  } | null;

  if (!body?.accepted) {
    return NextResponse.json({ success: false, error: BAA_MUST_ACCEPT }, { status: 400 });
  }
  if (body.version !== BAA_VERSION) {
    return NextResponse.json(
      { success: false, code: BAA_STALE_CODE, error: BAA_STALE_MESSAGE },
      { status: 409 }
    );
  }
  const signerName = String(body.signerName || '').trim();
  const signerTitle = String(body.signerTitle || '').trim();
  const signerEmail = String(body.signerEmail || '').trim().toLowerCase();
  if (!signerName || !signerTitle || !signerEmail) {
    return NextResponse.json({ success: false, error: BAA_MISSING_SIGNER }, { status: 400 });
  }

  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    null;
  const userAgent = req.headers.get('user-agent');

  const row = await prisma.baaAcceptance.create({
    data: {
      organizationId: gate.organizationId,
      version: BAA_VERSION,
      textSha256: baaTextSha256(),
      signerName,
      signerTitle,
      signerEmail,
      acceptedById: gate.userId,
      via: 'admin',
      ip,
      userAgent,
    },
  });

  return NextResponse.json({ success: true, acceptance: row });
}
