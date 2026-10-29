import type { CommunityEventStatus, CommunityVolunteerStatus, Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { canAccessPath } from '@/lib/auth/roleAccess';

export function canAccessCommunity(role: Role) {
  return canAccessPath(role, '/dashboard/community');
}

export type CommunityEventDTO = {
  id: string;
  title: string;
  eventType: string;
  status: 'upcoming' | 'completed';
  startsAt: string;
  endsAt: string;
  locationName: string;
  description: string;
  tags: string[];
  expectedAttendees: number;
  registeredCount: number;
  volunteersNeeded: number;
  volunteersSignedUp: number;
  isFeatured: boolean;
};

export type CommunityPartnerDTO = {
  id: string;
  name: string;
  category: string;
};

export type CommunityVolunteerDTO = {
  id: string;
  name: string;
  role: string;
  eventCount: number;
  status: 'active' | 'on_call';
};

function serializeEvent(row: {
  id: string;
  title: string;
  eventType: string;
  status: CommunityEventStatus;
  startsAt: Date;
  endsAt: Date;
  locationName: string;
  description: string;
  tags: string[];
  expectedAttendees: number;
  registeredCount: number;
  volunteersNeeded: number;
  volunteersSignedUp: number;
  isFeatured: boolean;
}): CommunityEventDTO {
  return {
    id: row.id,
    title: row.title,
    eventType: row.eventType,
    status: row.status,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    locationName: row.locationName,
    description: row.description,
    tags: row.tags,
    expectedAttendees: row.expectedAttendees,
    registeredCount: row.registeredCount,
    volunteersNeeded: row.volunteersNeeded,
    volunteersSignedUp: row.volunteersSignedUp,
    isFeatured: row.isFeatured,
  };
}

export async function listCommunity(organizationId: string) {
  const [events, partners, volunteers] = await Promise.all([
    prisma.communityEvent.findMany({
      where: { organizationId },
      orderBy: { startsAt: 'asc' },
    }),
    prisma.communityPartner.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.communityVolunteer.findMany({
      where: { organizationId },
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
    }),
  ]);

  return {
    events: events.map(serializeEvent),
    partners: partners.map((p) => ({ id: p.id, name: p.name, category: p.category })),
    volunteers: volunteers.map((v) => ({
      id: v.id,
      name: v.name,
      role: v.role,
      eventCount: v.eventCount,
      status: v.status === 'on_call' ? ('on_call' as const) : ('active' as const),
    })),
  };
}

export type CreateEventInput = {
  title: string;
  eventType: string;
  date: string;
  startTime: string;
  endTime: string;
  locationName: string;
  description?: string;
  expectedAttendees?: number;
  volunteersNeeded?: number;
  tags?: string[];
};

function combineLocal(date: string, time: string) {
  const t = (time && time.length >= 4 ? time : '09:00').slice(0, 5);
  const iso = `${date}T${t}:00`;
  for (const offset of ['-04:00', '-05:00'] as const) {
    const d = new Date(`${iso}${offset}`);
    if (Number.isNaN(d.getTime())) continue;
    const backDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(d);
    const hour = parts.find((p) => p.type === 'hour')?.value.padStart(2, '0');
    const minute = parts.find((p) => p.type === 'minute')?.value.padStart(2, '0');
    if (backDate === date && `${hour}:${minute}` === t) return d;
  }
  const fallback = new Date(`${iso}-04:00`);
  if (Number.isNaN(fallback.getTime())) {
    throw new Error('Invalid date or time');
  }
  return fallback;
}

export async function createCommunityEvent(organizationId: string, input: CreateEventInput) {
  const startsAt = combineLocal(input.date, input.startTime);
  const endsAt = combineLocal(input.date, input.endTime || input.startTime);
  if (endsAt.getTime() < startsAt.getTime()) {
    return { ok: false as const, status: 400, error: 'End time must be after start time.' };
  }

  const row = await prisma.communityEvent.create({
    data: {
      organizationId,
      title: input.title.trim(),
      eventType: input.eventType,
      status: 'upcoming',
      startsAt,
      endsAt,
      locationName: input.locationName.trim(),
      description: (input.description || '').trim(),
      tags: input.tags?.length ? input.tags : ['Community'],
      expectedAttendees: Math.max(0, input.expectedAttendees ?? 0),
      registeredCount: 0,
      volunteersNeeded: Math.max(0, input.volunteersNeeded ?? 0),
      volunteersSignedUp: 0,
    },
  });
  return { ok: true as const, event: serializeEvent(row) };
}

export type UpdateEventInput = {
  title?: string;
  eventType?: string;
  date?: string;
  startTime?: string;
  endTime?: string;
  startsAt?: string;
  endsAt?: string;
  locationName?: string;
  description?: string;
  expectedAttendees?: number;
  volunteersNeeded?: number;
  volunteersSignedUp?: number;
  registeredCount?: number;
  status?: 'upcoming' | 'completed';
  tags?: string[];
  isFeatured?: boolean;
};

export async function updateCommunityEvent(
  organizationId: string,
  id: string,
  input: UpdateEventInput
) {
  const existing = await prisma.communityEvent.findFirst({ where: { id, organizationId } });
  if (!existing) {
    return { ok: false as const, status: 404, error: 'Event not found' };
  }

  let startsAt = existing.startsAt;
  let endsAt = existing.endsAt;
  if (input.date && input.startTime) {
    startsAt = combineLocal(input.date, input.startTime);
    endsAt = combineLocal(input.date, input.endTime || input.startTime);
  } else {
    if (input.startsAt) startsAt = new Date(input.startsAt);
    if (input.endsAt) endsAt = new Date(input.endsAt);
  }

  const row = await prisma.communityEvent.update({
    where: { id },
    data: {
      title: input.title?.trim() ?? existing.title,
      eventType: input.eventType ?? existing.eventType,
      status: (input.status as CommunityEventStatus | undefined) ?? existing.status,
      startsAt,
      endsAt,
      locationName: input.locationName?.trim() ?? existing.locationName,
      description: input.description != null ? input.description.trim() : existing.description,
      expectedAttendees:
        input.expectedAttendees != null
          ? Math.max(0, input.expectedAttendees)
          : existing.expectedAttendees,
      volunteersNeeded:
        input.volunteersNeeded != null ? Math.max(0, input.volunteersNeeded) : existing.volunteersNeeded,
      volunteersSignedUp:
        input.volunteersSignedUp != null
          ? Math.max(0, input.volunteersSignedUp)
          : existing.volunteersSignedUp,
      registeredCount:
        input.registeredCount != null ? Math.max(0, input.registeredCount) : existing.registeredCount,
      tags: input.tags ?? existing.tags,
      isFeatured: input.isFeatured ?? existing.isFeatured,
    },
  });
  return { ok: true as const, event: serializeEvent(row) };
}

export async function signUpVolunteerForEvent(
  organizationId: string,
  eventId: string,
  volunteerId?: string
) {
  const event = await prisma.communityEvent.findFirst({
    where: { id: eventId, organizationId },
  });
  if (!event) {
    return { ok: false as const, status: 404, error: 'Event not found' };
  }

  const nextSigned = event.volunteersSignedUp + 1;
  const updatedEvent = await prisma.communityEvent.update({
    where: { id: eventId },
    data: { volunteersSignedUp: nextSigned },
  });

  let volunteer: CommunityVolunteerDTO | null = null;
  if (volunteerId) {
    const row = await prisma.communityVolunteer.findFirst({
      where: { id: volunteerId, organizationId },
    });
    if (row) {
      const next = await prisma.communityVolunteer.update({
        where: { id: row.id },
        data: { eventCount: row.eventCount + 1, status: 'active' as CommunityVolunteerStatus },
      });
      volunteer = {
        id: next.id,
        name: next.name,
        role: next.role,
        eventCount: next.eventCount,
        status: next.status === 'on_call' ? 'on_call' : 'active',
      };
    }
  }

  return { ok: true as const, event: serializeEvent(updatedEvent), volunteer };
}

export async function createCommunityPartner(
  organizationId: string,
  input: { name: string; category: string }
) {
  const name = input.name.trim();
  const dup = await prisma.communityPartner.findFirst({
    where: { organizationId, name: { equals: name, mode: 'insensitive' } },
  });
  if (dup) {
    return { ok: false as const, status: 409, error: 'That partner is already in the directory.' };
  }
  const row = await prisma.communityPartner.create({
    data: { organizationId, name, category: input.category },
  });
  return { ok: true as const, partner: { id: row.id, name: row.name, category: row.category } };
}

export async function createCommunityVolunteer(
  organizationId: string,
  input: { name: string; role: string }
) {
  const name = input.name.trim();
  const row = await prisma.communityVolunteer.create({
    data: {
      organizationId,
      name,
      role: input.role.trim() || 'Volunteer',
      eventCount: 0,
      status: 'active',
    },
  });
  return {
    ok: true as const,
    volunteer: {
      id: row.id,
      name: row.name,
      role: row.role,
      eventCount: row.eventCount,
      status: 'active' as const,
    },
  };
}

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function icsDate(d: Date) {
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T` +
    `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

function icsEscape(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

export function eventsToIcs(events: CommunityEventDTO[]) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Altrixs//Events & Outreach//EN',
    'CALSCALE:GREGORIAN',
  ];
  for (const event of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${event.id}@altrixs`,
      `DTSTAMP:${icsDate(new Date())}`,
      `DTSTART:${icsDate(new Date(event.startsAt))}`,
      `DTEND:${icsDate(new Date(event.endsAt))}`,
      `SUMMARY:${icsEscape(event.title)}`,
      `LOCATION:${icsEscape(event.locationName)}`,
      `DESCRIPTION:${icsEscape(event.description)}`,
      'END:VEVENT'
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

export function eventsToCsv(events: CommunityEventDTO[]) {
  const header = [
    'Title',
    'Type',
    'Status',
    'Starts',
    'Ends',
    'Location',
    'Registered',
    'Expected',
    'Volunteers',
  ];
  const rows = events.map((event) =>
    [
      event.title,
      event.eventType,
      event.status,
      event.startsAt,
      event.endsAt,
      event.locationName,
      event.registeredCount,
      event.expectedAttendees,
      event.volunteersSignedUp,
    ]
      .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
      .join(',')
  );
  return [header.join(','), ...rows].join('\n');
}
