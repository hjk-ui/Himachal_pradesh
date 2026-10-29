import { NextResponse } from 'next/server';
import {
  listAvailableSlots,
  resolvePublicOrg,
} from '@/lib/scheduling/manage';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const service = url.searchParams.get('service');
    const provider = url.searchParams.get('provider');
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const organizationSlug = url.searchParams.get('organizationSlug') || url.searchParams.get('org') || undefined;
    const organizationId = url.searchParams.get('organizationId') || undefined;

    if (!service || !from || !to) {
      return NextResponse.json(
        { success: false, error: 'service, from, and to are required' },
        { status: 400 }
      );
    }

    const org = await resolvePublicOrg({ organizationId, organizationSlug });
    if (!org) {
      return NextResponse.json({ success: false, error: 'Practice not found' }, { status: 404 });
    }

    const result = await listAvailableSlots({
      organizationId: org.id,
      serviceId: service,
      providerId: provider && provider !== 'any' ? provider : null,
      from,
      to,
    });

    return NextResponse.json({
      success: true,
      organization: { id: org.id, name: org.name, slug: org.slug },
      ...result,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Could not load slots';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
