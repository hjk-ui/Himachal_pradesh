-- ============================================================================
-- MIGRATION: 20261027_group_telehealth.sql
-- TARGET: PostgreSQL. Idempotent: safe to run more than once. No rows are written.
-- WHY: SUD IOP and psychotherapy groups need one video room per group session, joined by many
--   clients, each with their OWN join link (per-person attendance; links cannot be forwarded).
-- ADDS:
--   * group_video_rooms         one row per group session: Chime meeting, open / ended,
--                               name display (first_last_initial | first_only), attendee cap.
--   * group_video_participants  one row per member (personal link) or staff host: waiting room
--                               state, Chime attendee, check-in location, join / leave events,
--                               minutes in the room (heartbeats), mute / remove requests.
-- NOT TOUCHED: existing tables (no new columns on clinical_group_* or Appointment).
-- ============================================================================

CREATE TABLE IF NOT EXISTS group_video_rooms (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "sessionId"      TEXT NOT NULL,
  "groupId"        TEXT NOT NULL,
  "chimeMeetingId" TEXT,
  "chimeMeeting"   JSONB,
  "demoMode"       BOOLEAN NOT NULL DEFAULT FALSE,
  "status"         TEXT NOT NULL DEFAULT 'open',
  "nameDisplay"    TEXT NOT NULL DEFAULT 'first_last_initial',
  "maxAttendees"   INTEGER NOT NULL DEFAULT 12,
  "startedById"    TEXT,
  "startedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedById"      TEXT,
  "endedAt"        TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "group_video_rooms_sessionId_key" ON group_video_rooms ("sessionId");
CREATE INDEX IF NOT EXISTS "group_video_rooms_organizationId_status_idx" ON group_video_rooms ("organizationId", "status");

CREATE TABLE IF NOT EXISTS group_video_participants (
  "id"              TEXT PRIMARY KEY,
  "organizationId"  TEXT NOT NULL,
  "roomId"          TEXT NOT NULL,
  "sessionId"       TEXT NOT NULL,
  "kind"            TEXT NOT NULL DEFAULT 'member',
  "clientId"        TEXT,
  "memberId"        TEXT,
  "userId"          TEXT,
  "state"           TEXT NOT NULL DEFAULT 'invited',
  "chimeAttendeeId" TEXT,
  "externalUserId"  TEXT,
  "locationType"    TEXT,
  "locationState"   TEXT,
  "consentAt"       TIMESTAMP(3),
  "checkedInAt"     TIMESTAMP(3),
  "admittedAt"      TIMESTAMP(3),
  "admittedById"    TEXT,
  "connected"       BOOLEAN NOT NULL DEFAULT FALSE,
  "firstJoinedAt"   TIMESTAMP(3),
  "lastJoinedAt"    TIMESTAMP(3),
  "lastSeenAt"      TIMESTAMP(3),
  "totalSeconds"    INTEGER NOT NULL DEFAULT 0,
  "joinCount"       INTEGER NOT NULL DEFAULT 0,
  "events"          JSONB NOT NULL DEFAULT '[]'::jsonb,
  "muteRequestedAt" TIMESTAMP(3),
  "muteAckAt"       TIMESTAMP(3),
  "removedAt"       TIMESTAMP(3),
  "removedById"     TEXT,
  "linkEmailedAt"   TIMESTAMP(3),
  "linkPortalAt"    TIMESTAMP(3),
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "group_video_participants_roomId_clientId_key" ON group_video_participants ("roomId", "clientId");
CREATE UNIQUE INDEX IF NOT EXISTS "group_video_participants_roomId_userId_key" ON group_video_participants ("roomId", "userId");
CREATE INDEX IF NOT EXISTS "group_video_participants_sessionId_idx" ON group_video_participants ("sessionId");
