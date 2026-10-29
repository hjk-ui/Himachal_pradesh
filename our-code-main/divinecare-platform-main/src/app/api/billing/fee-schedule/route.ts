import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { prisma } from '@/lib/db/prisma';
import { CPT_CODES } from '@/lib/constants/cpt';

export const runtime = 'nodejs';

const LEADERSHIP = new Set(['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR']);

function priceRows(stored: unknown) {
  if (!Array.isArray(stored)) return null;
  const rows = stored.flatMap((row) => {
    if (!row || typeof row !== 'object') return [];
    const item = row as { code?: string; description?: string; rateCents?: number };
    if (!item.code || !item.description) return [];
    if (item.code.trim().toUpperCase() === '99212') {
      return [{ code: '99212', description: item.description, rateCents: null }];
    }
    if (!Number.isFinite(item.rateCents)) return [];
    return [{ code: item.code, description: item.description, rateCents: Math.round(item.rateCents as number) }];
  });
  return rows.length ? rows : null;
}

export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canAccessPath(gate.role, '/dashboard/billing/fee-schedule')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const saved = await prisma.clinicModuleState.findUnique({
    where: { organizationId_module: { organizationId: gate.organizationId, module: 'billing:fee-schedule' } },
  });
  const imported = priceRows(saved?.data);
  const catalog = imported || CPT_CODES.map((row) => ({
    code: row.code,
    description: row.desc,
    rateCents: row.code === '99212' ? null : Math.round(row.rate * 100),
  }));
  const rows = catalog.map((row) =>
    row.code.trim().toUpperCase() === '99212' ? { ...row, code: '99212', rateCents: null } : row
  );
  if (!rows.some((row) => row.code === '99212')) {
    rows.push({
      code: '99212',
      description: 'Office visit, established patient, straightforward',
      rateCents: null,
    });
  }
  return NextResponse.json({ success: true, source: imported ? 'import' : 'fee-schedule', rows });
}

const importSchema = z.object({
  rows: z.array(z.object({
    code: z.string().trim().min(3).max(12),
    description: z.string().trim().min(1).max(200),
    rateCents: z.number().int().positive(),
  })).min(1).max(400),
});

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!LEADERSHIP.has(gate.role) || !canAccessPath(gate.role, '/dashboard/billing/fee-schedule')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const parsed = importSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: 'The fee schedule file is not valid' }, { status: 400 });
  await prisma.clinicModuleState.upsert({
    where: { organizationId_module: { organizationId: gate.organizationId, module: 'billing:fee-schedule' } },
    create: { organizationId: gate.organizationId, module: 'billing:fee-schedule', data: parsed.data.rows },
    update: { data: parsed.data.rows },
  });
  return NextResponse.json({ success: true, imported: parsed.data.rows.length });
}
