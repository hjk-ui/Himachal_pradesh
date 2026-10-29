import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import {
  canAccessCommunity,
  eventsToCsv,
  eventsToIcs,
  listCommunity,
} from '@/lib/community/manage';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessCommunity(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const format = new URL(req.url).searchParams.get('format') === 'csv' ? 'csv' : 'ics';
  const { events } = await listCommunity(gate.organizationId);
  const upcoming = events.filter((event) => event.status === 'upcoming');

  if (format === 'csv') {
    return new NextResponse(eventsToCsv(upcoming.length ? upcoming : events), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="community-events.csv"',
      },
    });
  }

  return new NextResponse(eventsToIcs(upcoming.length ? upcoming : events), {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="community-events.ics"',
    },
  });
}
