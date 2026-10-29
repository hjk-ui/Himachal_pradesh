/**
 * The app's public base URL (no trailing slash). Dependency-free so scripts (e.g. the huddle notice
 * in scripts/chart-digest-prep.ts) can use it without loading staff/invite and its UI-side imports.
 */
export function getAppBaseUrl() {
  return (
    process.env.AUTH_URL ||
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    'http://localhost:3000'
  ).replace(/\/$/, '');
}
