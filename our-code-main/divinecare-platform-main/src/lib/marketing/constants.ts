/** Exact Oct 22 Growth & Marketing labels — do not rename. */

export const MARKETING_HUB_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'leads', label: 'Leads & inbox' },
  { id: 'forms', label: 'Web forms' },
  { id: 'automations', label: 'Automations' },
  { id: 'reputation', label: 'Reputation' },
  { id: 'campaigns', label: 'Campaigns' },
  { id: 'social', label: 'Social & content' },
  { id: 'partners', label: 'Partners & events' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'settings', label: 'Settings' },
] as const;

export type MarketingHubTabId = (typeof MARKETING_HUB_TABS)[number]['id'];

export const MARKETING_HUB_TITLE = 'Growth & Marketing';
export const MARKETING_HUB_DESCRIPTION =
  'Leads, conversations, automations, reputation, campaigns, social and partners, built for HIPAA, TCPA and CAN-SPAM.';
export const MARKETING_HIPAA_BADGE = 'HIPAA-safe marketing';

export const SMS_OPT_OUT_FOOTER = 'Reply STOP to opt out.';

export const LEAD_STAGES = [
  'New',
  'Contacted',
  'Screening',
  'Insurance verified',
  'Scheduled',
  'Converted to client',
  'Not a fit',
  'Lost',
] as const;

export type LeadStage = (typeof LEAD_STAGES)[number];

export const OPEN_LEAD_STAGES: LeadStage[] = [
  'New',
  'Contacted',
  'Screening',
  'Insurance verified',
  'Scheduled',
];

export const LEAD_SOURCES = [
  'Website form',
  'Phone call',
  'Referral partner',
  'Community event',
  'Walk-in',
  'Insurance directory',
  'Therapist listing site',
  'Social media',
  'Other',
] as const;

export type LeadSource = (typeof LEAD_SOURCES)[number];

export const LEAD_VIEWS = ['Pipeline', 'List', 'Conversations', 'Tasks'] as const;

export const PARTNER_TYPES = [
  'School',
  'Hospital/ED',
  'PCP',
  'Court',
  'Faith',
  'Community org',
  'Government',
  'Employer/EAP',
  'Other',
] as const;

export const MARKETING_EMPTIES = {
  noOpenLeads: 'No open leads',
  noLeadsMatch: 'No leads match',
  noConversations: 'No conversations yet',
  noOpenTasks: 'No open tasks',
  installRecipe: 'Install a recipe or build your own',
  noTrainings: 'No required trainings yet',
} as const;
