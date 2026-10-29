-- DrFirst Rcopia provider username per staff member. The e-prescribe SSO launch
-- signs only as the signed-in user's own value (never a username from the request).
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "rcopiaUsername" TEXT;
