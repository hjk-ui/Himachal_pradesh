import { NextResponse } from 'next/server';
import { z } from 'zod';
import { loadPracticeOverview, savePracticeSection } from '@/lib/practice/store';
import { practiceError, practiceGate } from './_lib/gate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET: practice settings overview (settings, locations, BAAs, billing/payer summary, integrations, checklist). No PHI; tax ID masked. */
export async function GET() {
  const g = await practiceGate('read');
  if (!g.ok) return g.response;
  try {
    const overview = await loadPracticeOverview(g.actor.organizationId);
    return NextResponse.json({ success: true, canEdit: g.canEdit, ...overview });
  } catch (error) {
    return practiceError(error, 'Could not load practice settings');
  }
}

const putSchema = z.object({
  section: z.enum(['profile', 'billing', 'clinical', 'scheduling', 'compliance']),
  data: z.record(z.string(), z.unknown()),
});

/** PUT { section, data }: saves one settings section (leadership only; audited with field names, never values). */
export async function PUT(request: Request) {
  const g = await practiceGate('write');
  if (!g.ok) return g.response;
  try {
    const body = putSchema.parse(await request.json().catch(() => ({})));
    const result = await savePracticeSection(g.actor, body.section, body.data);
    const overview = await loadPracticeOverview(g.actor.organizationId);
    return NextResponse.json({ success: true, canEdit: true, changedFields: result.changedFields, ...overview });
  } catch (error) {
    return practiceError(error, 'Could not save practice settings');
  }
}
