-- ============================================================================
-- MIGRATION: 20261022_marketing_suite.sql
-- TARGET: PostgreSQL 12+. Idempotent: safe to run more than once.
-- WHY: Growth & Marketing suite (/dashboard/marketing): lead pipeline CRM, public intake forms,
--   lead conversations, safe automations, reputation (reviews + testimonials with authorization),
--   email / SMS campaigns to opted-in audiences, social planner with approvals, referral partner
--   CRM, event registration + attendance, attribution analytics, AI growth assistant usage log.
-- ADDS:
--   * columns on "CommunityPartner" (partner CRM: type, owner, contact, status, last touch, notes)
--   * columns on "CommunityEvent" (registration slug / open flag, attendance, cost)
--   * tables marketing_settings, marketing_leads, marketing_lead_activities, marketing_tasks,
--     marketing_contacts, marketing_forms, marketing_messages, marketing_templates,
--     marketing_workflows, marketing_workflow_runs, marketing_reviews, marketing_testimonials,
--     marketing_campaigns, marketing_social_posts, marketing_spend,
--     marketing_event_registrations, marketing_partner_touches, marketing_ai_usage
-- COMPLIANCE: lead health details are PHI and stay in this database (no third-party ad or
--   analytics tools). Clients appear in marketing audiences only with a signed marketing
--   authorization (marketing_contacts.kind = client_authorized). No rows are seeded.
-- ============================================================================

ALTER TABLE "CommunityPartner" ADD COLUMN IF NOT EXISTS "partnerType" TEXT;
ALTER TABLE "CommunityPartner" ADD COLUMN IF NOT EXISTS "ownerUserId" TEXT;
ALTER TABLE "CommunityPartner" ADD COLUMN IF NOT EXISTS "ownerName" TEXT;
ALTER TABLE "CommunityPartner" ADD COLUMN IF NOT EXISTS "contactName" TEXT;
ALTER TABLE "CommunityPartner" ADD COLUMN IF NOT EXISTS "contactEmail" TEXT;
ALTER TABLE "CommunityPartner" ADD COLUMN IF NOT EXISTS "contactPhone" TEXT;
ALTER TABLE "CommunityPartner" ADD COLUMN IF NOT EXISTS "partnerStatus" TEXT NOT NULL DEFAULT 'active';
ALTER TABLE "CommunityPartner" ADD COLUMN IF NOT EXISTS "lastTouchAt" TIMESTAMP(3);
ALTER TABLE "CommunityPartner" ADD COLUMN IF NOT EXISTS "partnerNotes" TEXT NOT NULL DEFAULT '';

ALTER TABLE "CommunityEvent" ADD COLUMN IF NOT EXISTS "registrationSlug" TEXT;
ALTER TABLE "CommunityEvent" ADD COLUMN IF NOT EXISTS "registrationOpen" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CommunityEvent" ADD COLUMN IF NOT EXISTS "attendedCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CommunityEvent" ADD COLUMN IF NOT EXISTS "costCents" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS marketing_settings (
  "id"                         TEXT PRIMARY KEY,
  "organizationId"             TEXT NOT NULL,
  "timeZone"                   TEXT NOT NULL DEFAULT 'America/New_York',
  "businessHours"              JSONB,
  "quietHoursStart"            TEXT NOT NULL DEFAULT '20:00',
  "quietHoursEnd"              TEXT NOT NULL DEFAULT '09:00',
  "physicalAddress"            TEXT,
  "marketingAuthTemplateKey"   TEXT NOT NULL DEFAULT 'marketing-authorization',
  "testimonialAuthTemplateKey" TEXT NOT NULL DEFAULT 'testimonial-authorization',
  "senderIdentities"           JSONB,
  "brandVoice"                 TEXT,
  "autoReplyEnabled"           BOOLEAN NOT NULL DEFAULT false,
  "autoReplyText"              TEXT,
  "missedCallTextBack"         BOOLEAN NOT NULL DEFAULT false,
  "missedCallText"             TEXT,
  "speedToLeadMinutes"         INTEGER NOT NULL DEFAULT 15,
  "smallCellThreshold"         INTEGER NOT NULL DEFAULT 11,
  "aiFeatures"                 JSONB,
  "integrations"               JSONB,
  "publicFormsEnabled"         BOOLEAN NOT NULL DEFAULT true,
  "updatedById"                TEXT,
  "createdAt"                  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"                  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "marketing_settings_organizationId_key" ON marketing_settings ("organizationId");

CREATE TABLE IF NOT EXISTS marketing_leads (
  "id"                  TEXT PRIMARY KEY,
  "organizationId"      TEXT NOT NULL,
  "firstName"           TEXT NOT NULL,
  "lastName"            TEXT NOT NULL,
  "dateOfBirth"         DATE,
  "phone"               TEXT,
  "email"               TEXT,
  "source"              TEXT NOT NULL,
  "sourceDetail"        TEXT,
  "partnerId"           TEXT,
  "eventId"             TEXT,
  "formId"              TEXT,
  "stage"               TEXT NOT NULL DEFAULT 'new',
  "furthestStage"       TEXT NOT NULL DEFAULT 'new',
  "stageChangedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "assignedToId"        TEXT,
  "serviceInterest"     TEXT,
  "locationId"          TEXT,
  "locationName"        TEXT,
  "insurance"           TEXT,
  "preferredContact"    TEXT,
  "contactConsent"      BOOLEAN NOT NULL DEFAULT false,
  "smsConsent"          BOOLEAN NOT NULL DEFAULT false,
  "smsConsentAt"        TIMESTAMP(3),
  "smsConsentSource"    TEXT,
  "smsOptOutAt"         TIMESTAMP(3),
  "emailConsent"        BOOLEAN NOT NULL DEFAULT false,
  "emailOptOutAt"       TIMESTAMP(3),
  "notes"               TEXT,
  "possibleClientMatch" BOOLEAN NOT NULL DEFAULT false,
  "firstResponseAt"     TIMESTAMP(3),
  "lastContactAt"       TIMESTAMP(3),
  "lastInboundAt"       TIMESTAMP(3),
  "intakeScheduledAt"   TIMESTAMP(3),
  "intakeNoShowAt"      TIMESTAMP(3),
  "convertedClientId"   TEXT,
  "convertedAt"         TIMESTAMP(3),
  "intakeAppointmentId" TEXT,
  "lostReason"          TEXT,
  "campaignTag"         TEXT,
  "createdById"         TEXT,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "marketing_leads_organizationId_stage_idx" ON marketing_leads ("organizationId", "stage");
CREATE INDEX IF NOT EXISTS "marketing_leads_organizationId_createdAt_idx" ON marketing_leads ("organizationId", "createdAt");
CREATE INDEX IF NOT EXISTS "marketing_leads_organizationId_phone_idx" ON marketing_leads ("organizationId", "phone");

CREATE TABLE IF NOT EXISTS marketing_lead_activities (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "leadId"         TEXT NOT NULL,
  "kind"           TEXT NOT NULL,
  "summary"        TEXT NOT NULL,
  "actorId"        TEXT,
  "actorName"      TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "marketing_lead_activities_leadId_createdAt_idx" ON marketing_lead_activities ("leadId", "createdAt");

CREATE TABLE IF NOT EXISTS marketing_tasks (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "leadId"         TEXT,
  "title"          TEXT NOT NULL,
  "dueAt"          TIMESTAMP(3),
  "assignedToId"   TEXT,
  "status"         TEXT NOT NULL DEFAULT 'open',
  "source"         TEXT NOT NULL DEFAULT 'manual',
  "createdById"    TEXT,
  "completedAt"    TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "marketing_tasks_organizationId_status_dueAt_idx" ON marketing_tasks ("organizationId", "status", "dueAt");
CREATE INDEX IF NOT EXISTS "marketing_tasks_leadId_idx" ON marketing_tasks ("leadId");

CREATE TABLE IF NOT EXISTS marketing_contacts (
  "id"                              TEXT PRIMARY KEY,
  "organizationId"                  TEXT NOT NULL,
  "name"                            TEXT NOT NULL,
  "email"                           TEXT,
  "phone"                           TEXT,
  "kind"                            TEXT NOT NULL,
  "partnerId"                       TEXT,
  "clientId"                        TEXT,
  "emailConsent"                    BOOLEAN NOT NULL DEFAULT false,
  "emailConsentAt"                  TIMESTAMP(3),
  "emailOptOutAt"                   TIMESTAMP(3),
  "smsConsent"                      BOOLEAN NOT NULL DEFAULT false,
  "smsConsentAt"                    TIMESTAMP(3),
  "smsOptOutAt"                     TIMESTAMP(3),
  "marketingAuthorizationAt"        TIMESTAMP(3),
  "marketingAuthorizationExpiresAt" TIMESTAMP(3),
  "marketingAuthorizationRevokedAt" TIMESTAMP(3),
  "marketingAuthorizationRef"       TEXT,
  "tags"                            TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "source"                          TEXT,
  "createdAt"                       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"                       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "marketing_contacts_organizationId_kind_idx" ON marketing_contacts ("organizationId", "kind");
CREATE INDEX IF NOT EXISTS "marketing_contacts_organizationId_phone_idx" ON marketing_contacts ("organizationId", "phone");

CREATE TABLE IF NOT EXISTS marketing_forms (
  "id"                  TEXT PRIMARY KEY,
  "organizationId"      TEXT NOT NULL,
  "name"                TEXT NOT NULL,
  "slug"                TEXT NOT NULL,
  "active"              BOOLEAN NOT NULL DEFAULT true,
  "fields"              JSONB NOT NULL,
  "serviceOptions"      TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "locationOptions"     TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "confirmationMessage" TEXT NOT NULL,
  "submissionCount"     INTEGER NOT NULL DEFAULT 0,
  "createdById"         TEXT,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "marketing_forms_organizationId_slug_key" ON marketing_forms ("organizationId", "slug");

CREATE TABLE IF NOT EXISTS marketing_messages (
  "id"                TEXT PRIMARY KEY,
  "organizationId"    TEXT NOT NULL,
  "leadId"            TEXT,
  "contactId"         TEXT,
  "campaignId"        TEXT,
  "runId"             TEXT,
  "channel"           TEXT NOT NULL,
  "direction"         TEXT NOT NULL DEFAULT 'outbound',
  "subject"           TEXT,
  "body"              TEXT NOT NULL,
  "status"            TEXT NOT NULL,
  "reason"            TEXT,
  "templateId"        TEXT,
  "variant"           TEXT,
  "sentById"          TEXT,
  "providerMessageId" TEXT,
  "readAt"            TIMESTAMP(3),
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "marketing_messages_organizationId_leadId_createdAt_idx" ON marketing_messages ("organizationId", "leadId", "createdAt");
CREATE INDEX IF NOT EXISTS "marketing_messages_organizationId_campaignId_idx" ON marketing_messages ("organizationId", "campaignId");

CREATE TABLE IF NOT EXISTS marketing_templates (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  "channel"        TEXT NOT NULL,
  "subject"        TEXT,
  "body"           TEXT NOT NULL,
  "category"       TEXT NOT NULL DEFAULT 'follow_up',
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "marketing_templates_organizationId_channel_idx" ON marketing_templates ("organizationId", "channel");

CREATE TABLE IF NOT EXISTS marketing_workflows (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  "recipeKey"      TEXT,
  "trigger"        JSONB NOT NULL,
  "steps"          JSONB NOT NULL,
  "active"         BOOLEAN NOT NULL DEFAULT false,
  "createdById"    TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "marketing_workflows_organizationId_active_idx" ON marketing_workflows ("organizationId", "active");

CREATE TABLE IF NOT EXISTS marketing_workflow_runs (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "workflowId"     TEXT NOT NULL,
  "leadId"         TEXT,
  "contactId"      TEXT,
  "eventId"        TEXT,
  "reviewId"       TEXT,
  "stepIndex"      INTEGER NOT NULL DEFAULT 0,
  "status"         TEXT NOT NULL DEFAULT 'active',
  "waitUntil"      TIMESTAMP(3),
  "log"            JSONB,
  "startedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt"     TIMESTAMP(3),
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "marketing_workflow_runs_status_waitUntil_idx" ON marketing_workflow_runs ("status", "waitUntil");
CREATE INDEX IF NOT EXISTS "marketing_workflow_runs_workflowId_leadId_idx" ON marketing_workflow_runs ("workflowId", "leadId");

CREATE TABLE IF NOT EXISTS marketing_reviews (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "source"         TEXT NOT NULL,
  "externalId"     TEXT,
  "locationName"   TEXT,
  "rating"         INTEGER NOT NULL,
  "authorName"     TEXT,
  "body"           TEXT NOT NULL DEFAULT '',
  "reviewedAt"     TIMESTAMP(3) NOT NULL,
  "responseDraft"  TEXT,
  "responseStatus" TEXT NOT NULL DEFAULT 'none',
  "respondedAt"    TIMESTAMP(3),
  "respondedById"  TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "marketing_reviews_organizationId_reviewedAt_idx" ON marketing_reviews ("organizationId", "reviewedAt");

CREATE TABLE IF NOT EXISTS marketing_testimonials (
  "id"                     TEXT PRIMARY KEY,
  "organizationId"         TEXT NOT NULL,
  "quote"                  TEXT NOT NULL,
  "displayName"            TEXT NOT NULL,
  "contactId"              TEXT,
  "clientId"               TEXT,
  "authorizationSignedAt"  TIMESTAMP(3),
  "authorizationExpiresAt" TIMESTAMP(3),
  "authorizationRevokedAt" TIMESTAMP(3),
  "authorizationRef"       TEXT,
  "allowedChannels"        TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "status"                 TEXT NOT NULL DEFAULT 'pending',
  "createdById"            TEXT,
  "createdAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "marketing_testimonials_organizationId_status_idx" ON marketing_testimonials ("organizationId", "status");

CREATE TABLE IF NOT EXISTS marketing_campaigns (
  "id"                TEXT PRIMARY KEY,
  "organizationId"    TEXT NOT NULL,
  "name"              TEXT NOT NULL,
  "channel"           TEXT NOT NULL,
  "audience"          JSONB NOT NULL,
  "subjectA"          TEXT,
  "subjectB"          TEXT,
  "body"              TEXT NOT NULL,
  "status"            TEXT NOT NULL DEFAULT 'draft',
  "scheduledAt"       TIMESTAMP(3),
  "sentAt"            TIMESTAMP(3),
  "recipientCount"    INTEGER NOT NULL DEFAULT 0,
  "sentCount"         INTEGER NOT NULL DEFAULT 0,
  "deliveredCount"    INTEGER NOT NULL DEFAULT 0,
  "openedCount"       INTEGER NOT NULL DEFAULT 0,
  "clickedCount"      INTEGER NOT NULL DEFAULT 0,
  "unsubscribedCount" INTEGER NOT NULL DEFAULT 0,
  "blockedCount"      INTEGER NOT NULL DEFAULT 0,
  "queuedCount"       INTEGER NOT NULL DEFAULT 0,
  "variantStats"      JSONB,
  "createdById"       TEXT,
  "approvedById"      TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "marketing_campaigns_organizationId_status_idx" ON marketing_campaigns ("organizationId", "status");

CREATE TABLE IF NOT EXISTS marketing_social_posts (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "channels"       TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "content"        TEXT NOT NULL,
  "hashtags"       TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "imagePrompt"    TEXT,
  "status"         TEXT NOT NULL DEFAULT 'draft',
  "scheduledAt"    TIMESTAMP(3),
  "postedAt"       TIMESTAMP(3),
  "approvedById"   TEXT,
  "approvedAt"     TIMESTAMP(3),
  "reviewNote"     TEXT,
  "campaignTag"    TEXT,
  "createdById"    TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "marketing_social_posts_organizationId_scheduledAt_idx" ON marketing_social_posts ("organizationId", "scheduledAt");

CREATE TABLE IF NOT EXISTS marketing_spend (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "channel"        TEXT NOT NULL,
  "month"          TEXT NOT NULL,
  "amountCents"    INTEGER NOT NULL,
  "note"           TEXT,
  "createdById"    TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "marketing_spend_organizationId_month_idx" ON marketing_spend ("organizationId", "month");

CREATE TABLE IF NOT EXISTS marketing_event_registrations (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "eventId"        TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  "email"          TEXT,
  "phone"          TEXT,
  "emailConsent"   BOOLEAN NOT NULL DEFAULT false,
  "smsConsent"     BOOLEAN NOT NULL DEFAULT false,
  "attended"       BOOLEAN NOT NULL DEFAULT false,
  "contactId"      TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "marketing_event_registrations_eventId_idx" ON marketing_event_registrations ("eventId");
CREATE INDEX IF NOT EXISTS "marketing_event_registrations_organizationId_createdAt_idx" ON marketing_event_registrations ("organizationId", "createdAt");

CREATE TABLE IF NOT EXISTS marketing_partner_touches (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "partnerId"      TEXT NOT NULL,
  "kind"           TEXT NOT NULL,
  "summary"        TEXT NOT NULL,
  "touchedAt"      TIMESTAMP(3) NOT NULL,
  "actorId"        TEXT,
  "actorName"      TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "marketing_partner_touches_partnerId_touchedAt_idx" ON marketing_partner_touches ("partnerId", "touchedAt");

CREATE TABLE IF NOT EXISTS marketing_ai_usage (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "userId"         TEXT,
  "feature"        TEXT NOT NULL,
  "engine"         TEXT NOT NULL,
  "inputChars"     INTEGER NOT NULL DEFAULT 0,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "marketing_ai_usage_organizationId_createdAt_idx" ON marketing_ai_usage ("organizationId", "createdAt");
