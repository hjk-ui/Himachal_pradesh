import { NextResponse } from 'next/server';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { nppDocument, storeNppDocument } from '@/lib/consents/library/store';
import { canApproveTemplates } from '@/lib/consents/library/lifecycle';
import { consentGate, json } from '../_gate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/consents/library/npp?org=<organizationId> — the practice's Notice of Privacy Practices
 * PDF. Public on purpose: the NPP is a public notice (45 CFR §164.520), not PHI.
 */
export async function GET(req: Request) {
  const org = new URL(req.url).searchParams.get('org') ?? '';
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(org)) return json({ success: false, error: 'Not found' }, 404);
  const bytes = await nppDocument(org);
  if (!bytes) return json({ success: false, error: 'Not found' }, 404);
  return new NextResponse(Buffer.from(bytes), {
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="notice-of-privacy-practices.pdf"', 'Cache-Control': 'public, max-age=300', 'X-Content-Type-Options': 'nosniff' },
  });
}

/** POST (multipart "file") — upload the NPP PDF (admin + practice director). Max 10 MB. */
export async function POST(req: Request) {
  const g = await consentGate();
  if (!g.ok) return g.res;
  if (!canApproveTemplates(g.gate.role)) return json({ success: false, error: 'Only an administrator or the practice director can upload the NPP.' }, 403);
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!file || typeof file === 'string') return json({ success: false, error: 'Choose a PDF file.' }, 400);
  if (file.size > 10 * 1024 * 1024) return json({ success: false, error: 'The file is larger than 10 MB.' }, 400);
  const r = await storeNppDocument(g.actor, new Uint8Array(await file.arrayBuffer()));
  await auditPhiAccess({ gate: g.gate, req, action: 'UPDATE', resourceType: 'consentLibraryNpp', outcome: r.ok ? undefined : 'DENIED', metadata: { size: file.size } });
  if (r.ok === false) return json({ success: false, error: r.error }, r.status);
  return json({ success: true, sha256: r.sha256 });
}
