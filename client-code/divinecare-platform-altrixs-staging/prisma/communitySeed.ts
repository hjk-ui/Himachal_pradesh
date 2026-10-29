import type { PrismaClient } from '@prisma/client';

function at(year: number, month: number, day: number, hour: number, minute: number) {
  return new Date(Date.UTC(year, month - 1, day, hour + 4, minute, 0, 0));
}

const EVENTS = [
  {
    title: 'Mental Health Awareness Community Fair',
    eventType: 'Health Fair',
    status: 'upcoming' as const,
    startsAt: at(2026, 3, 15, 10, 0),
    endsAt: at(2026, 3, 15, 15, 0),
    locationName: 'Mondawmin Mall, Baltimore, MD',
    description:
      'Free mental health screenings, resource tables, coping skills workshops, music, and giveaways. Open to the Baltimore community.',
    tags: ['Free', 'Families Welcome', 'Screenings', 'Resources'],
    expectedAttendees: 200,
    registeredCount: 143,
    volunteersNeeded: 12,
    volunteersSignedUp: 12,
    isFeatured: true,
  },
  {
    title: 'Community Grief Support Circle',
    eventType: 'Support Group',
    status: 'upcoming' as const,
    startsAt: at(2026, 3, 18, 18, 0),
    endsAt: at(2026, 3, 18, 19, 30),
    locationName: 'Divine Counseling LLC — Main Office',
    description: 'A facilitated support circle for adults processing grief, loss, and family transitions.',
    tags: ['Free', 'Confidential', 'Adults'],
    expectedAttendees: 25,
    registeredCount: 19,
    volunteersNeeded: 2,
    volunteersSignedUp: 2,
    isFeatured: false,
  },
  {
    title: 'Youth Mental Health Workshop @ Frederick Douglass HS',
    eventType: 'School Outreach',
    status: 'upcoming' as const,
    startsAt: at(2026, 3, 20, 9, 0),
    endsAt: at(2026, 3, 20, 11, 0),
    locationName: 'Frederick Douglass High School, Baltimore',
    description:
      'Stress management, emotional regulation, and healthy coping tools for middle and high school students.',
    tags: ['Youth', 'School', 'Workshop'],
    expectedAttendees: 60,
    registeredCount: 60,
    volunteersNeeded: 4,
    volunteersSignedUp: 4,
    isFeatured: false,
  },
  {
    title: 'Wellness Walk & Mindfulness in the Park',
    eventType: 'Wellness Event',
    status: 'upcoming' as const,
    startsAt: at(2026, 3, 22, 8, 0),
    endsAt: at(2026, 3, 22, 10, 0),
    locationName: 'Druid Hill Park, Baltimore',
    description: 'A light outdoor wellness walk with guided breathing and community connection.',
    tags: ['Free', 'Outdoor', 'Families Welcome'],
    expectedAttendees: 80,
    registeredCount: 55,
    volunteersNeeded: 8,
    volunteersSignedUp: 8,
    isFeatured: false,
  },
  {
    title: 'Faith & Mental Health Panel Discussion',
    eventType: 'Panel',
    status: 'completed' as const,
    startsAt: at(2026, 3, 8, 14, 0),
    endsAt: at(2026, 3, 8, 16, 0),
    locationName: 'New Shiloh Baptist Church, Baltimore',
    description:
      'A community discussion with faith leaders and clinicians on reducing stigma and improving access.',
    tags: ['Faith Community', 'Panel', 'Adults'],
    expectedAttendees: 75,
    registeredCount: 68,
    volunteersNeeded: 5,
    volunteersSignedUp: 5,
    isFeatured: false,
  },
  {
    title: 'Senior Wellness Tea @ Enoch Pratt',
    eventType: 'Wellness Event',
    status: 'completed' as const,
    startsAt: at(2026, 3, 12, 13, 0),
    endsAt: at(2026, 3, 12, 15, 0),
    locationName: 'Enoch Pratt Free Library, Baltimore',
    description: 'Tea, conversation, and resource tables for older adults and caregivers.',
    tags: ['Seniors', 'Free', 'Resources'],
    expectedAttendees: 40,
    registeredCount: 28,
    volunteersNeeded: 3,
    volunteersSignedUp: 3,
    isFeatured: false,
  },
  {
    title: 'NAMI Maryland Family Support Night',
    eventType: 'Support Group',
    status: 'upcoming' as const,
    startsAt: at(2026, 3, 25, 18, 30),
    endsAt: at(2026, 3, 25, 20, 0),
    locationName: 'NAMI Maryland, Columbia / Baltimore metro',
    description: 'Family education and peer support for relatives of people living with mental illness.',
    tags: ['Families Welcome', 'Free', 'Support'],
    expectedAttendees: 50,
    registeredCount: 22,
    volunteersNeeded: 4,
    volunteersSignedUp: 3,
    isFeatured: false,
  },
  {
    title: 'BCPS Counselor Roundtable',
    eventType: 'School Outreach',
    status: 'upcoming' as const,
    startsAt: at(2026, 3, 28, 8, 30),
    endsAt: at(2026, 3, 28, 10, 30),
    locationName: 'Baltimore City Schools (BCPS) Central Office',
    description: 'Partnership briefing for school counselors on referral pathways and crisis protocols.',
    tags: ['Education', 'Referral', 'Staff'],
    expectedAttendees: 30,
    registeredCount: 14,
    volunteersNeeded: 2,
    volunteersSignedUp: 2,
    isFeatured: false,
  },
];

const PARTNERS: { name: string; category: string }[] = [
  { name: 'Baltimore City Health Department', category: 'Government' },
  { name: 'New Shiloh Baptist Church', category: 'Faith' },
  { name: 'Frederick Douglass High School', category: 'Education' },
  { name: 'Baltimore City Schools (BCPS)', category: 'Education' },
  { name: 'NAMI Maryland', category: 'Nonprofit' },
  { name: 'Mondawmin Mall Management', category: 'Corporate' },
  { name: 'Druid Hill Park Conservancy', category: 'Nonprofit' },
  { name: 'Baltimore Crisis Response', category: 'Government' },
  { name: 'Enoch Pratt Free Library', category: 'Education' },
  { name: 'Johns Hopkins Bloomberg School of Public Health', category: 'Education' },
  { name: 'Behavioral Health System Baltimore', category: 'Government' },
  { name: 'Catholic Charities of Baltimore', category: 'Faith' },
  { name: 'Coppin State University', category: 'Education' },
  { name: 'United Way of Central Maryland', category: 'Nonprofit' },
  { name: 'Under Armour Community Affairs', category: 'Corporate' },
  { name: 'House of Ruth Maryland', category: 'Nonprofit' },
  { name: 'Maryland Department of Health', category: 'Government' },
];

const VOLUNTEERS: { name: string; role: string; eventCount: number; status: 'active' | 'on_call' }[] = [
  { name: 'Chantel Moore', role: 'Event Lead', eventCount: 5, status: 'active' },
  { name: 'DeShawn Harris', role: 'Setup/Logistics', eventCount: 3, status: 'active' },
  { name: 'Brianna Watson', role: 'Registration', eventCount: 4, status: 'active' },
  { name: 'Marcus Allen', role: 'Community Liaison', eventCount: 6, status: 'active' },
  { name: 'Jasmine Owens', role: 'Social Media', eventCount: 2, status: 'active' },
];

const EXTRA_VOLUNTEERS = [
  'Aaliyah Brooks',
  'Andre Whitfield',
  'Keisha Grant',
  'Jamal Porter',
  'Nia Coleman',
  'Tyrell Simmons',
  'Imani Jackson',
  'Darius King',
  'Lauren Hayes',
  'Malik Thompson',
  'Sofia Ramirez',
  'Chris Nguyen',
  'Patrice Ellis',
  'Jordan Blake',
  'Tanya Reid',
  'Omar Hassan',
  'Riley Chen',
  'Gabrielle Stone',
  'Evan Brooks',
  'Priya Shah',
  'Nathan Cole',
  'Maya Lewis',
  'Hector Alvarez',
  'Quinn Murphy',
  'Sasha Greene',
  'Leo Martin',
  'Amber Boyd',
  'Colin Wright',
  'Destiny Ward',
  'Felix Ortiz',
  'Hannah Kim',
  'Isaac Powell',
  'Jade Bennett',
  'Kyle Foster',
  'Lila Nguyen',
  'Miles Carter',
  'Nora Patel',
];

const EXTRA_ROLES = [
  'Greeter',
  'Setup/Logistics',
  'Registration',
  'Hospitality',
  'Flyer Distribution',
  'Youth Helper',
];

/**
 * Idempotent outreach seed for a clinic org. Replaces demo rows when empty;
 * if events already exist, leaves them unless `replace` is true.
 */
export async function seedCommunityOutreach(
  prisma: PrismaClient,
  organizationId: string,
  opts: { replace?: boolean } = {}
) {
  const existing = await prisma.communityEvent.count({ where: { organizationId } });
  if (existing > 0 && !opts.replace) {
    return { events: existing, skipped: true as const };
  }

  if (opts.replace) {
    await prisma.communityEvent.deleteMany({ where: { organizationId } });
    await prisma.communityPartner.deleteMany({ where: { organizationId } });
    await prisma.communityVolunteer.deleteMany({ where: { organizationId } });
  }

  await prisma.communityEvent.createMany({
    data: EVENTS.map((event) => ({ ...event, organizationId })),
  });
  await prisma.communityPartner.createMany({
    data: PARTNERS.map((partner) => ({ ...partner, organizationId })),
  });

  for (const volunteer of VOLUNTEERS) {
    await prisma.communityVolunteer.create({
      data: { ...volunteer, organizationId },
    });
  }
  await prisma.communityVolunteer.createMany({
    data: EXTRA_VOLUNTEERS.map((name, i) => ({
      organizationId,
      name,
      role: EXTRA_ROLES[i % EXTRA_ROLES.length],
      eventCount: (i % 4) + 1,
      status: 'on_call' as const,
    })),
  });

  return {
    events: EVENTS.length,
    partners: PARTNERS.length,
    volunteers: VOLUNTEERS.length + EXTRA_VOLUNTEERS.length,
    skipped: false as const,
  };
}
