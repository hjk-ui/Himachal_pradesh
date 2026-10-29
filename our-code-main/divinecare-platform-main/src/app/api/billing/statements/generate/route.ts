import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import crypto from 'crypto';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  try {
    const body = await req.json();

    if (!body.clientId) {
      return NextResponse.json({ success: false, error: 'clientId is required' }, { status: 400 });
    }

    const client = await prisma.client.findUnique({
      where: { id: body.clientId },
      select: { id: true, name: true, email: true, phone: true },
    });

    if (!client) {
      return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 });
    }

    const uniqueCode = `STM-${Date.now().toString().slice(-6)}`;
    const trackedToken = crypto.randomBytes(6).toString('hex');
    const trackedPayLink = `altrixs.com/pay/${trackedToken}`;

    const statement = await prisma.eStatement.create({
      data: {
        id: uniqueCode,
        organizationId: gate.organizationId,
        clientId: client.id,
        periodFrom: body.periodFrom ? new Date(body.periodFrom) : new Date(Date.now() - 30 * 86400000),
        periodTo: body.periodTo ? new Date(body.periodTo) : new Date(),
        totalBilled: Number(body.totalBilled) || 350.00,
        balanceDue: Number(body.balanceDue) || 75.00,
        deliveryMethod: body.deliveryMethod || 'email',
        emailSentTo: body.emailSentTo || client.email || 'patient@altrixs.com',
        phoneSentTo: body.phoneSentTo || client.phone || null,
        trackedPayLink,
        status: 'sent',
      },
    });

    return NextResponse.json({
      success: true,
      statement,
      trackedPayLink,
    }, { status: 201 });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Could not generate eStatement' },
      { status: 500 }
    );
  }
}
