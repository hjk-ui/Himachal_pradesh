/**
 * Resource library: shared constants and types (pure, browser-safe; no Prisma, no React).
 * Tables: resource_items / resource_user_state / resource_assignments
 * (prisma/migrations/20261020_resource_library.sql).
 */

export const RESOURCE_KINDS = ['handout', 'link', 'video', 'article', 'crisis', 'community'] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];
export const RESOURCE_KIND_LABEL: Record<ResourceKind, string> = {
  handout: 'Handout / worksheet',
  link: 'External link',
  video: 'Video link',
  article: 'Article',
  crisis: 'Crisis resource',
  community: 'Community resource',
};

export const RESOURCE_STATUSES = ['draft', 'active', 'retired'] as const;
export type ResourceStatus = (typeof RESOURCE_STATUSES)[number];
export const RESOURCE_STATUS_LABEL: Record<ResourceStatus, string> = { draft: 'Draft', active: 'Active', retired: 'Retired' };

export const RESOURCE_AUDIENCE_SCOPES = ['patient', 'staff'] as const;
export type ResourceAudienceScope = (typeof RESOURCE_AUDIENCE_SCOPES)[number];

/** Who a patient-facing resource is written for */
export const AUDIENCES = ['adult', 'teen', 'child', 'caregiver'] as const;
export type Audience = (typeof AUDIENCES)[number];
export const AUDIENCE_LABEL: Record<Audience, string> = { adult: 'Adult', teen: 'Teen', child: 'Child', caregiver: 'Parent / caregiver' };

export const TOPICS = [
  'crisis',
  'anxiety',
  'depression',
  'trauma',
  'sud_recovery',
  'sleep',
  'coping_skills',
  'parenting',
  'grief',
  'medication_info',
  'suicide_prevention',
  'serious_mental_illness',
  'adhd',
  'eating_disorders',
  'ocd',
  'child_teen',
  'family_caregivers',
  'diabetes',
  'hypertension',
  'tobacco',
  'community_services',
  'general_wellness',
] as const;
export type Topic = (typeof TOPICS)[number];
export const TOPIC_LABEL: Record<Topic, string> = {
  crisis: 'Crisis',
  anxiety: 'Anxiety',
  depression: 'Depression',
  trauma: 'Trauma / PTSD',
  sud_recovery: 'SUD / recovery',
  sleep: 'Sleep',
  coping_skills: 'Coping skills',
  parenting: 'Parenting',
  grief: 'Grief',
  medication_info: 'Medication info',
  suicide_prevention: 'Suicide prevention',
  serious_mental_illness: 'Bipolar / psychosis',
  adhd: 'ADHD',
  eating_disorders: 'Eating disorders',
  ocd: 'OCD',
  child_teen: 'Child & teen',
  family_caregivers: 'Family & caregivers',
  diabetes: 'Diabetes',
  hypertension: 'Hypertension',
  tobacco: 'Tobacco / quitting',
  community_services: 'Community services',
  general_wellness: 'General wellness',
};
/** Topics whose content reveals substance use treatment (42 CFR Part 2 handling) */
export const SUD_TOPICS: readonly Topic[] = ['sud_recovery'];

export const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'am', label: 'Amharic' },
  { value: 'zh', label: 'Chinese' },
  { value: 'ko', label: 'Korean' },
  { value: 'vi', label: 'Vietnamese' },
  { value: 'other', label: 'Other' },
] as const;
export const languageLabel = (v: string) => LANGUAGES.find((l) => l.value === v)?.label ?? v;

export const READING_LEVELS = [
  { value: 'easy', label: 'Easy to read (grade 6 or below)' },
  { value: 'general', label: 'General public' },
  { value: 'advanced', label: 'Advanced / detailed' },
] as const;

export const STAFF_CATEGORIES = ['policy', 'form', 'training', 'other'] as const;
export type StaffCategory = (typeof STAFF_CATEGORIES)[number];
export const STAFF_CATEGORY_LABEL: Record<StaffCategory, string> = { policy: 'Policy', form: 'Form', training: 'Training', other: 'Other' };

export const ASSIGNMENT_STATUSES = ['sent', 'viewed', 'completed', 'withdrawn'] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];
export const ASSIGNMENT_STATUS_LABEL: Record<AssignmentStatus, string> = {
  sent: 'Sent',
  viewed: 'Viewed',
  completed: 'Completed',
  withdrawn: 'Withdrawn',
};

export const ASSIGNMENT_CONTEXTS = ['library', 'chart', 'note', 'scribe', 'sdoh', 'legacy'] as const;
export type AssignmentContext = (typeof ASSIGNMENT_CONTEXTS)[number];

/** Practice uploads: PDF and images only, 10 MB */
export const UPLOAD_MIME = ['application/pdf', 'image/png', 'image/jpeg'] as const;
export const UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

/** Library item as the staff API returns it */
export type ResourceItemDto = {
  id: string;
  audience: ResourceAudienceScope;
  kind: ResourceKind;
  title: string;
  summary: string | null;
  body: string | null;
  url: string | null;
  contactPhone: string | null;
  contactText: string | null;
  hasFile: boolean;
  fileName: string | null;
  fileMime: string | null;
  fileSize: number | null;
  topics: string[];
  audiences: string[];
  language: string;
  readingLevel: string | null;
  publisher: string | null;
  licenseNote: string | null;
  linkCheckedAt: string | null;
  lastReviewedAt: string | null;
  reviewerName: string | null;
  status: ResourceStatus;
  staffCategory: string | null;
  visibleRoles: string[];
  sudRelated: boolean;
  seeded: boolean;
  legacy: boolean;
  favorite: boolean;
  lastUsedAt: string | null;
  updatedAt: string;
};

/** Assignment as staff see it (chart card, assignment list) */
export type AssignmentDto = {
  id: string;
  itemId: string;
  itemTitle: string;
  itemKind: string;
  clientId: string;
  clientName: string;
  assignedByName: string | null;
  message: string | null;
  dueDate: string | null;
  status: AssignmentStatus;
  sentAt: string | null;
  viewedAt: string | null;
  completedAt: string | null;
  withdrawnAt: string | null;
  withdrawnReason: string | null;
  context: string;
  part2: boolean;
  notificationStatus: string | null;
  createdAt: string;
};

/** Assignment as the patient sees it in the portal ("My resources") */
export type PatientResourceDto = {
  id: string;
  title: string;
  kind: string;
  summary: string | null;
  body: string | null;
  url: string | null;
  contactPhone: string | null;
  contactText: string | null;
  hasFile: boolean;
  fileName: string | null;
  publisher: string | null;
  language: string;
  message: string | null;
  fromName: string | null;
  dueDate: string | null;
  status: 'sent' | 'viewed' | 'completed';
  sentAt: string | null;
  viewedAt: string | null;
  completedAt: string | null;
};
