import { canAccessPath, homePathForRole } from '@/lib/auth/roleAccess';

/**
 * After login, follow a callback only when it is a same-site /dashboard page
 * this role can open. Anything else (other sites, /login, /api, unknown paths)
 * goes to the role home.
 */
export function safeCallbackForRole(
  role: string | null | undefined,
  raw: string | null | undefined
): string {
  const home = homePathForRole(role);
  if (!raw) return home;
  const value = raw.trim();
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\') || value.includes('..')) {
    return home;
  }
  const path = value.split('#')[0] || '';
  const pathname = (path.split('?')[0] || '').replace(/\/+$/, '') || '/';
  if (!pathname.startsWith('/dashboard')) return home;
  if (pathname === '/dashboard') return home;
  if (!canAccessPath(role, pathname)) return home;
  return path;
}
