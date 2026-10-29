import { NextResponse } from 'next/server';
import {
  listSchedulingProviders,
  resolvePublicOrg,
} from '@/lib/scheduling/manage';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const service = url.searchParams.get('service') || undefined;
    const organizationSlug = url.searchParams.get('organizationSlug') || url.searchParams.get('org') || undefined;
    const organizationId = url.searchParams.get('organizationId') || undefined;

    const org = await resolvePublicOrg({ organizationId, organizationSlug });
    if (!org) {
      return NextResponse.json({ success: false, error: 'Practice not found' }, { status: 404 });
    }

    const result = await listSchedulingProviders(org.id, service);
    return NextResponse.json({
      success: true,
      organization: { id: org.id, name: org.name, slug: org.slug },
      service: result.service,
      providers: result.providers,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Could not load providers';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
