-- ============================================================================
-- MIGRATION: 20261018_clear_placeholder_location_npis.sql
-- TARGET: PostgreSQL. Idempotent: safe to run more than once.
-- WHY: 20261015_practice_locations.sql and 20261015_oct10_14_pillars.sql seeded the legacy
--   practice_locations table with invented location NPIs (1457893211-1457893214) and street
--   addresses. They are not MD Behavioral Health's real identifiers and must never reach a claim
--   or a requisition. This clears EXACTLY those seeded values; nothing else is changed.
--   Real per-site NPIs / addresses are entered in Practice settings (Location.npi, Location.addressLine1).
-- SCOPE:
--   * practice_locations.location_npi = NULL where it is one of the four seeded NPIs
--   * practice_locations.address_line1 / zip_code = NULL where the row still holds the exact
--     seeded street line AND its seeded ZIP (either 20261015 migration's values)
--   * NOT NULL dropped on those three columns so NULL (= not entered) is representable.
--   Works with either table shape (VARCHAR id from 20261015_practice_locations.sql, or UUID id +
--   slug from 20261015_oct10_14_pillars.sql); does nothing when the table does not exist.
-- NOT TOUCHED: practices.group_npi / tax_id (also placeholders — see report), pharmacies, any other table.
-- ============================================================================

DO $$
BEGIN
  IF to_regclass('public.practice_locations') IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'practice_locations' AND column_name = 'location_npi') THEN
    ALTER TABLE practice_locations ALTER COLUMN location_npi DROP NOT NULL;
    UPDATE practice_locations
       SET location_npi = NULL
     WHERE location_npi IN ('1457893211', '1457893212', '1457893213', '1457893214');
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'practice_locations' AND column_name = 'address_line1')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'practice_locations' AND column_name = 'zip_code') THEN
    ALTER TABLE practice_locations ALTER COLUMN address_line1 DROP NOT NULL;
    ALTER TABLE practice_locations ALTER COLUMN zip_code DROP NOT NULL;
    UPDATE practice_locations
       SET address_line1 = NULL, zip_code = NULL
     WHERE (address_line1, zip_code) IN (
       -- 20261015_practice_locations.sql
       ('15500 Annapolis Rd', '20715'),
       ('13870 Georgia Ave', '20906'),
       ('21600 Great Mills Rd', '20653'),
       ('2801 Smith Ave', '21209'),
       -- 20261015_oct10_14_pillars.sql
       ('14300 Gallant Fox Ln', '20715'),
       ('8401 Colesville Rd', '20910'),
       ('201 E Pratt St', '21202'),
       ('21770 FDR Blvd', '20653')
     );
  END IF;
END $$;
