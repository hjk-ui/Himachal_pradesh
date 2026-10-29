/** Sidebar Account menu (Oct 25) — exact copy. */

export const ACCOUNT_MENU_COPY = {
  profile: 'My profile',
  rolePreview: 'Role preview',
  switchDashboard: 'Switch dashboard',
  signOut: 'Sign out',
  exit: 'Exit',
} as const;

export const PROFILE_HREF = '/dashboard/settings';

export function accountMenuAriaLabel(name: string, role: string): string {
  return `Account menu: ${name}, ${role}`;
}

export function previewingAs(label: string): string {
  return `Previewing as ${label}`;
}

/** Footer line, e.g. "Altrixs 1.0.0". */
export function altrixsVersionLabel(version?: string | null): string {
  return `Altrixs ${version || '1.0.0'}`;
}

/** Admins preview other roles; multi-role staff switch between assigned dashboards. */
export function roleMenuLabel(isAdminViewer: boolean): string {
  return isAdminViewer ? ACCOUNT_MENU_COPY.rolePreview : ACCOUNT_MENU_COPY.switchDashboard;
}
