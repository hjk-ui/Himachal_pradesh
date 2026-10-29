import type { PrismaClient } from '@prisma/client';

function at(year: number, month: number, day: number, hour = 9, minute = 0) {
  return new Date(Date.UTC(year, month - 1, day, hour + 4, minute, 0, 0));
}

const CHANNELS = [
  { platform: 'Facebook', handle: 'DivineCounselingLLC', followers: 3240, monthGrowthPct: 5, sortOrder: 0 },
  { platform: 'Instagram', handle: '@divinecounselingllc', followers: 2810, monthGrowthPct: 12, sortOrder: 1 },
  { platform: 'LinkedIn', handle: 'Divine Counseling LLC', followers: 1450, monthGrowthPct: 8, sortOrder: 2 },
  { platform: 'Twitter/X', handle: '@DivineCounselingMD', followers: 890, monthGrowthPct: 3, sortOrder: 3 },
];

const ASSETS = [
  {
    title: 'Logo Pack (SVG/PNG)',
    category: 'Brand',
    iconKey: 'image',
    fileName: 'divine-counseling-logo-pack.txt',
    body: 'Divine Counseling LLC logo pack — SVG and PNG lockups for web, print, and social. Royal Purple on white; reversed white on Midnight.',
    sortOrder: 0,
  },
  {
    title: 'Event Flyer Template',
    category: 'Template',
    iconKey: 'file',
    fileName: 'event-flyer-template.txt',
    body: 'Community event flyer template. Headline, date/time, location, and QR block. Use Royal Purple + Divine Gold.',
    sortOrder: 1,
  },
  {
    title: 'Social Media Kit',
    category: 'Template',
    iconKey: 'share',
    fileName: 'social-media-kit.txt',
    body: 'Instagram, Facebook, LinkedIn, and X post templates with caption formulas, hashtags, and safe-zone crop guides.',
    sortOrder: 2,
  },
  {
    title: 'Email Newsletter',
    category: 'Template',
    iconKey: 'mail',
    fileName: 'email-newsletter-template.txt',
    body: 'Monthly community newsletter layout: hero, events, hiring, and footer with referral phone line.',
    sortOrder: 3,
  },
  {
    title: 'Press Kit (PDF)',
    category: 'Media',
    iconKey: 'newspaper',
    fileName: 'press-kit.txt',
    body: 'Divine Counseling LLC press kit: boilerplate, leadership bios, Baltimore impact stats, and high-res photos.',
    sortOrder: 4,
  },
  {
    title: 'Brand Guidelines',
    category: 'Brand',
    iconKey: 'book',
    fileName: 'brand-guidelines.txt',
    body: 'Brand guidelines: Royal Purple, Divine Gold, Teal, Coral, Midnight. Voice: warm, clinical, community-first. Never use slang in crisis copy.',
    sortOrder: 5,
  },
];

const COLORS = [
  { name: 'Royal Purple', hex: '#5C2D91', sortOrder: 0 },
  { name: 'Divine Gold', hex: '#C9A227', sortOrder: 1 },
  { name: 'Teal', hex: '#0F766E', sortOrder: 2 },
  { name: 'Coral', hex: '#E07050', sortOrder: 3 },
  { name: 'Midnight', hex: '#141C34', sortOrder: 4 },
];

const COVERAGE = [
  {
    outlet: 'Baltimore Sun',
    medium: 'Print / Online',
    headline: 'Local Mental Health Center Sees 40% Growth in Community Outreach',
    publishedAt: at(2026, 2, 15),
    sentiment: 'positive' as const,
    url: 'https://www.baltimoresun.com/maryland/baltimore-city/mental-health-outreach',
  },
  {
    outlet: 'WBAL-TV 11',
    medium: 'TV Segment',
    headline: "Spotlight: Divine Counseling's free mental health screenings in Baltimore",
    publishedAt: at(2026, 3, 2),
    sentiment: 'positive' as const,
    url: 'https://www.wbaltv.com/article/divine-counseling-free-screenings',
  },
  {
    outlet: 'WYPR 88.1',
    medium: 'Radio Interview',
    headline: 'CEO discusses closing the mental health access gap in underserved communities',
    publishedAt: at(2026, 2, 28),
    sentiment: 'positive' as const,
    url: 'https://www.wypr.org/show/midday/divine-counseling-access-gap',
  },
  {
    outlet: 'Afro American',
    medium: 'Feature Article',
    headline: "Holistic Healing: Baltimore's Divine Counseling Breaks Stigma",
    publishedAt: at(2026, 1, 30),
    sentiment: 'positive' as const,
    url: 'https://www.afro.com/holistic-healing-divine-counseling-baltimore',
  },
];

const RELEASES = [
  {
    title: 'Divine Counseling LLC Expands PRP Program with 15 New Slots',
    body: 'BALTIMORE — Divine Counseling LLC announced 15 additional Psychiatric Rehabilitation Program slots to reduce wait times for Medicaid-eligible adults in West Baltimore.',
    status: 'published' as const,
    publishedAt: at(2026, 3, 1),
    outlet: 'Baltimore Sun, WYPR, WBAL-TV',
  },
  {
    title: 'Annual Mental Health Awareness Fair Returns to Mondawmin Mall',
    body: 'Free screenings, resource tables, and youth workshops return to Mondawmin Mall on March 15, 2026. No insurance required.',
    status: 'published' as const,
    publishedAt: at(2026, 2, 20),
    outlet: 'Afro American, Community Times',
  },
  {
    title: 'New Youth Mental Health Outreach Program Launches Spring 2026',
    body: 'Draft: Partnership with Baltimore City Schools to reach 500 students with coping skills workshops and family resource nights.',
    status: 'draft' as const,
    publishedAt: at(2026, 3, 10),
    outlet: '',
  },
];

/**
 * Idempotent PR & Marketing seed. Skips when metrics already exist unless replace=true.
 */
export async function seedPrMarketing(
  prisma: PrismaClient,
  organizationId: string,
  opts: { replace?: boolean } = {}
) {
  const existing = await prisma.prOrgMetrics.count({ where: { organizationId } });
  if (existing > 0 && !opts.replace) {
    return { skipped: true as const, campaigns: await prisma.prCampaign.count({ where: { organizationId } }) };
  }

  if (opts.replace) {
    await prisma.prSocialPost.deleteMany({ where: { organizationId } });
    await prisma.prCampaign.deleteMany({ where: { organizationId } });
    await prisma.prMediaCoverage.deleteMany({ where: { organizationId } });
    await prisma.prPressRelease.deleteMany({ where: { organizationId } });
    await prisma.prBrandAsset.deleteMany({ where: { organizationId } });
    await prisma.prBrandColor.deleteMany({ where: { organizationId } });
    await prisma.prSocialChannel.deleteMany({ where: { organizationId } });
    await prisma.prOrgMetrics.deleteMany({ where: { organizationId } });
  }

  await prisma.prOrgMetrics.create({
    data: {
      organizationId,
      pressMentionsYtd: 14,
      socialReach: 12400,
      socialReachPeriod: 'Mar',
      websiteVisitors: 2840,
      websiteVisitorsPeriod: 'Mar',
    },
  });

  await prisma.prSocialChannel.createMany({
    data: CHANNELS.map((row) => ({ ...row, organizationId })),
  });
  await prisma.prBrandAsset.createMany({
    data: ASSETS.map((row) => ({ ...row, organizationId })),
  });
  await prisma.prBrandColor.createMany({
    data: COLORS.map((row) => ({ ...row, organizationId })),
  });
  await prisma.prMediaCoverage.createMany({
    data: COVERAGE.map((row) => ({ ...row, organizationId })),
  });
  await prisma.prPressRelease.createMany({
    data: RELEASES.map((row) => ({ ...row, organizationId })),
  });

  const march = await prisma.prCampaign.create({
    data: {
      organizationId,
      name: 'March Mental Health Month',
      status: 'active',
      startDate: at(2026, 3, 1),
      endDate: at(2026, 3, 31, 17, 0),
      description: 'Increase community awareness and event attendance',
      progress: 42,
      channels: ['Instagram', 'Facebook', 'Email', 'Flyers'],
    },
  });
  const hiring = await prisma.prCampaign.create({
    data: {
      organizationId,
      name: 'Spring Hiring Push',
      status: 'active',
      startDate: at(2026, 3, 1),
      endDate: at(2026, 4, 15, 17, 0),
      description: 'Fill 4 open clinical positions',
      progress: 55,
      channels: ['LinkedIn', 'Indeed', 'Website'],
    },
  });
  await prisma.prCampaign.create({
    data: {
      organizationId,
      name: 'Youth Outreach — Baltimore City Schools',
      status: 'active',
      startDate: at(2026, 2, 15),
      endDate: at(2026, 6, 30, 17, 0),
      description: 'Reach 500 Baltimore youth with mental health education',
      progress: 28,
      channels: ['Email', 'Flyers', 'Schools'],
    },
  });

  await prisma.prSocialPost.createMany({
    data: [
      {
        organizationId,
        platform: 'Instagram',
        content:
          "March is Women's History Month! Honoring the Black women therapists and healers who paved the way. #DivineCare #MentalHealth #Baltimore",
        status: 'posted',
        scheduledAt: at(2026, 3, 6, 10, 0),
        reach: '1.8K',
        engagement: '4.2%',
        campaignId: march.id,
      },
      {
        organizationId,
        platform: 'Facebook',
        content:
          'Free mental health screenings at our Community Fair on March 15! No cost, no insurance needed. Come as you are. Register at the link.',
        status: 'scheduled',
        scheduledAt: at(2026, 3, 8, 9, 0),
        campaignId: march.id,
      },
      {
        organizationId,
        platform: 'Instagram',
        content:
          '"You are worthy of healing." — A reminder for this Monday. Share with someone who needs it. #MentalHealthMatters',
        status: 'draft',
        scheduledAt: at(2026, 3, 10, 9, 0),
        campaignId: march.id,
      },
      {
        organizationId,
        platform: 'LinkedIn',
        content:
          "Divine Counseling LLC is hiring! We're looking for Licensed Therapists (LCSW/LGPC) to join our team. See open roles -> #MentalHealthJobs #Baltimore",
        status: 'scheduled',
        scheduledAt: at(2026, 3, 12, 9, 0),
        campaignId: hiring.id,
      },
      {
        organizationId,
        platform: 'Twitter/X',
        content:
          'TODAY: Join us at Mondawmin Mall for the Mental Health Awareness Community Fair! Free screenings, resources, and giveaways.',
        status: 'scheduled',
        scheduledAt: at(2026, 3, 15, 8, 0),
        campaignId: march.id,
      },
    ],
  });

  return { skipped: false as const, campaigns: 3, posts: 5, coverage: COVERAGE.length };
}
