import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { analyzeClinicalText } from '@/lib/aws/comprehend';
import { prisma } from '@/lib/db/prisma';

export const runtime = 'nodejs';

const bodySchema = z.object({
  text: z.string().trim().min(10).max(10000),
  clientId: z.string().min(1).max(128).optional().nullable(),
  noteType: z.string().min(1).max(64).optional().nullable(),
});

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (
    !canAccessPath(gate.role, '/dashboard/scribe') &&
    !canAccessPath(gate.role, '/dashboard/ehr/notes')
  ) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid body: text (10–10000 chars) required; clientId/noteType optional' },
      { status: 400 }
    );
  }

  const analysis = await analyzeClinicalText(parsed.text);
  if (analysis.ok === false) {
    return NextResponse.json(
      { success: false, error: analysis.error, demoMode: false },
      { status: analysis.status >= 400 ? analysis.status : 502 }
    );
  }

  if (parsed.clientId) {
    await prisma.scribeSession
      .create({
        data: {
          organizationId: gate.organizationId,
          clientId: parsed.clientId,
          sourceMode: 'comprehend',
          transcript: parsed.text.slice(0, 12000),
          noteBody: parsed.noteType ? `noteType=${parsed.noteType}` : null,
          comprehendJson: analysis.result as object,
          createdById: gate.userId,
        },
      })
      .catch(() => undefined);
  }

  return NextResponse.json({
    success: true,
    demoMode: analysis.result.demoMode,
    entities: analysis.result.entities,
    icd10: analysis.result.icd10,
    medications: analysis.result.medications,
  });
}
