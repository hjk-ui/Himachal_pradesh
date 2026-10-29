-- Oct 25 Identifying Information: chart "Title" (name prefix) on the client
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "namePrefix" TEXT;
