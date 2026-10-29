-- Owner request (Oct 19 2026): in-app video (Amazon Chime) is the default telehealth platform.
-- Only the column default for new practices changes here; existing practices are switched by
-- scripts/switch-telehealth-to-in-app.ts (audited). Idempotent.
ALTER TABLE IF EXISTS "TelehealthSettings" ALTER COLUMN "defaultPlatform" SET DEFAULT 'CHIME';
