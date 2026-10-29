-- ==============================================================================
-- Migration: MD Behavioral Health Multi-Location System
-- Date: 2026-10-15
-- Table: practice_locations
-- ==============================================================================

CREATE TABLE IF NOT EXISTS practice_locations (
    id VARCHAR(50) PRIMARY KEY, -- 'bowie', 'ss', 'lex', 'balt'
    name VARCHAR(255) NOT NULL,
    short_code VARCHAR(5) NOT NULL,
    brand_color VARCHAR(20) NOT NULL,
    bg_color VARCHAR(20) NOT NULL,
    border_color VARCHAR(20) NOT NULL,
    address_line1 VARCHAR(255) NOT NULL,
    city VARCHAR(100) NOT NULL,
    state VARCHAR(2) NOT NULL DEFAULT 'MD',
    zip_code VARCHAR(10) NOT NULL,
    location_npi VARCHAR(10) NOT NULL,
    is_flagship BOOLEAN DEFAULT FALSE,
    specialty_type VARCHAR(100) NOT NULL,
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed MD Behavioral Health's 4 physical facilities
INSERT INTO practice_locations (id, name, short_code, brand_color, bg_color, border_color, address_line1, city, zip_code, location_npi, is_flagship, specialty_type)
VALUES
('bowie', 'Bowie', 'BW', '#4F46E5', '#EEF2FF', '#C7D2FE', '15500 Annapolis Rd', 'Bowie', '20715', '1457893211', TRUE, 'Full Clinical Outpatient & PRP'),
('ss', 'Silver Spring', 'SS', '#059669', '#ECFDF5', '#A7F3D0', '13870 Georgia Ave', 'Silver Spring', '20906', '1457893212', FALSE, 'Behavioral Health + Primary Care'),
('lex', 'Lexington Park', 'LP', '#D97706', '#FFFBEB', '#FDE68A', '21600 Great Mills Rd', 'Lexington Park', '20653', '1457893214', FALSE, 'Outpatient BH & Peer Support'),
('balt', 'Baltimore', 'BA', '#0E7490', '#ECFEFF', '#A5F3FC', '2801 Smith Ave', 'Baltimore', '21209', '1457893213', FALSE, 'Outpatient & Community Mobile Crisis')
ON CONFLICT (id) DO UPDATE SET 
    name = EXCLUDED.name,
    location_npi = EXCLUDED.location_npi,
    brand_color = EXCLUDED.brand_color,
    bg_color = EXCLUDED.bg_color,
    border_color = EXCLUDED.border_color,
    specialty_type = EXCLUDED.specialty_type,
    is_flagship = EXCLUDED.is_flagship;

-- Add location_id / primary_location_id columns
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS primary_location_id VARCHAR(50) DEFAULT 'bowie' REFERENCES practice_locations(id);
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS location_id VARCHAR(50) DEFAULT 'bowie' REFERENCES practice_locations(id);

-- Backfill existing Client and Appointment records
UPDATE "Client" SET primary_location_id = 'bowie' WHERE primary_location_id IS NULL;
UPDATE "Appointment" SET location_id = 'bowie' WHERE location_id IS NULL;

-- Distribute some existing appointments and clients across branches for realistic testing
UPDATE "Client" SET primary_location_id = 'ss' WHERE id IN (SELECT id FROM "Client" OFFSET 1 LIMIT 2);
UPDATE "Client" SET primary_location_id = 'lex' WHERE id IN (SELECT id FROM "Client" OFFSET 3 LIMIT 2);
UPDATE "Client" SET primary_location_id = 'balt' WHERE id IN (SELECT id FROM "Client" OFFSET 5 LIMIT 2);

UPDATE "Appointment" SET location_id = 'ss' WHERE id IN (SELECT id FROM "Appointment" OFFSET 1 LIMIT 2);
UPDATE "Appointment" SET location_id = 'lex' WHERE id IN (SELECT id FROM "Appointment" OFFSET 3 LIMIT 2);
UPDATE "Appointment" SET location_id = 'balt' WHERE id IN (SELECT id FROM "Appointment" OFFSET 5 LIMIT 2);
