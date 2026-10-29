/**
 * Central env access for the web app.
 * Auth: NextAuth + PostgreSQL (no Firebase / Firestore).
 */

function read(key: string): string | undefined {
  const value = process.env[key];
  if (!value || value.trim() === '' || value.startsWith('your-')) return undefined;
  return value.trim();
}

export const env = {
  /** Same-origin Next.js API routes by default (no separate Express server). */
  apiUrl: read('NEXT_PUBLIC_API_URL') ?? '',
  databaseUrl: read('DATABASE_URL'),
  authSecret: read('AUTH_SECRET'),
  googleClientId: read('AUTH_GOOGLE_ID'),
  googleClientSecret: read('AUTH_GOOGLE_SECRET'),
} as const;

export const isDatabaseConfigured = Boolean(env.databaseUrl);
export const isAuthConfigured = Boolean(env.authSecret && env.databaseUrl);
export const isGoogleAuthConfigured = Boolean(
  env.googleClientId && env.googleClientSecret
);
