import { NextResponse } from 'next/server';
import {
  getOrCreateSchedulingSettings,
  resolvePublicOrg,
} from '@/lib/scheduling/manage';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const organizationSlug = url.searchParams.get('organizationSlug') || url.searchParams.get('org') || undefined;
    const organizationId = url.searchParams.get('organizationId') || undefined;

    const org = await resolvePublicOrg({ organizationId, organizationSlug });
    if (!org) {
      return NextResponse.json({ success: false, error: 'Practice not found' }, { status: 404 });
    }

    const settings = await getOrCreateSchedulingSettings(org.id);
    const enabledServices = settings.services.filter((s) => s.enabled);

    return NextResponse.json({
      success: true,
      organization: { id: org.id, name: org.name, slug: org.slug },
      settings: {
        practiceName: settings.practiceName || org.name,
        practiceCity: settings.practiceCity,
        contactPhone: settings.contactPhone,
        contactEmail: settings.contactEmail,
        services: enabledServices,
        minNoticeDays: settings.minNoticeDays,
        bookAheadDays: settings.bookAheadDays,
        rules: settings.rules,
        embed: settings.embed,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Could not load scheduling settings';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
