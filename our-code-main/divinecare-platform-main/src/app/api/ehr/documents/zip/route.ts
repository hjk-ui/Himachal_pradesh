import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { clientCodeInPath, isBillingArchive, readZip, sha256 } from '@/lib/documents/clientZip';

export const runtime = 'nodejs';

const MAX_BYTES = 80 * 1024 * 1024;

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canAccessPath(gate.role, '/dashboard/ehr/doc-intake')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) return NextResponse.json({ success: false, error: 'Choose a ZIP file' }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ success: false, error: 'ZIP is too large' }, { status: 400 });
  const bytes = Buffer.from(await file.arrayBuffer());
  let entries;
  try {
    entries = readZip(bytes);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not open the ZIP';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
  const clients = await prisma.client.findMany({
    where: { organizationId: gate.organizationId },
    select: { id: true, name: true, mrn: true, sourceId: true },
  });
  const codes = clients.flatMap((client) => [client.mrn, client.sourceId].filter((code): code is string => Boolean(code)));
  let filed = 0;
  let skipped = 0;
  let archive = 0;
  let deflate64 = 0;
  const unmatched: string[] = [];
  for (const entry of entries) {
    if (entry.method === 9) deflate64 += 1;
    const digest = sha256(entry.bytes);
    if (isBillingArchive(entry.path)) {
      const module = `billing-archive:${digest}`;
      const existing = await prisma.clinicModuleState.findUnique({
        where: { organizationId_module: { organizationId: gate.organizationId, module } },
        select: { id: true },
      });
      if (existing) {
        skipped += 1;
        continue;
      }
      await prisma.clinicModuleState.create({
        data: {
          organizationId: gate.organizationId,
          module,
          data: { path: entry.path, name: entry.path.split('/').pop(), bytes: entry.bytes.length, sha256: digest },
        },
      });
      archive += 1;
      continue;
    }
    const code = clientCodeInPath(entry.path, codes);
    const client = code
      ? clients.find((row) => row.mrn?.toLowerCase() === code.toLowerCase() || row.sourceId?.toLowerCase() === code.toLowerCase())
      : null;
    if (!client) {
      unmatched.push(entry.path);
      continue;
    }
    const module = `chart-doc:${client.id}:${digest}`;
    const existing = await prisma.clinicModuleState.findUnique({
      where: { organizationId_module: { organizationId: gate.organizationId, module } },
      select: { id: true },
    });
    if (existing) {
      skipped += 1;
      continue;
    }
    await prisma.clinicModuleState.create({
      data: {
        organizationId: gate.organizationId,
        module,
        data: {
          clientId: client.id,
          clientName: client.name,
          path: entry.path,
          name: entry.path.split('/').pop(),
          bytes: entry.bytes.length,
          sha256: digest,
        },
      },
    });
    filed += 1;
  }
  return NextResponse.json({ success: true, filed, skipped, archive, unmatched, deflate64 });
}
