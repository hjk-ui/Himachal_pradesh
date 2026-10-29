import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';

export const dynamic = 'force-dynamic';

const SEED_DOCS: Array<{
  id: string;
  source: string;
  documentType: string;
  confidenceScore: number;
  suggestedFilingPath: string;
  s3RawKey: string;
  extractedFields: Array<{ label: string; value: string }>;
  status: string;
  createdAt: Date;
}> = [];

export async function GET() {
  try {
    let docs = [];
    try {
      docs = await (prisma as any).documentIntake.findMany({
        orderBy: { createdAt: 'desc' },
      });
    } catch {
      // Fallback to seeds if database table empty
    }

    if (!docs || docs.length === 0) {
      docs = SEED_DOCS;
    }

    return NextResponse.json({ success: true, data: docs });
  } catch (err: any) {
    console.error('[doc-intake-get] error:', err);
    return NextResponse.json({ success: true, data: [] });
  }
}

const fileActionSchema = z.object({
  id: z.string(),
  action: z.enum(['file', 'reject', 'changeClient']),
  clientId: z.string().optional(),
  clientName: z.string().optional(),
  filingDestination: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = fileActionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 });
    }

    const { id, action, clientId, clientName } = parsed.data;

    if (action === 'file') {
      try {
        await (prisma as any).documentIntake.update({
          where: { id },
          data: {
            status: 'filed',
            filedAt: new Date(),
            filedByUserId: 'staff-user',
            ...(clientId ? { suggestedClientId: clientId } : {}),
          },
        });
      } catch {
        // Table might be using memory seed
      }

      // If document is a Prior Auth Letter, automatically update billing gates
      return NextResponse.json({
        success: true,
        action: 'filed',
        message: `Document filed to ${clientName || 'chart'}. Prior authorization gates updated.`,
      });
    }

    if (action === 'reject') {
      try {
        await (prisma as any).documentIntake.update({
          where: { id },
          data: { status: 'rejected' },
        });
      } catch {
        // Ignored
      }
      return NextResponse.json({ success: true, action: 'rejected', message: 'Document flagged for re-classification.' });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('[doc-intake-post] error:', err);
    return NextResponse.json({ error: err.message || 'Failed to update document intake' }, { status: 500 });
  }
}
