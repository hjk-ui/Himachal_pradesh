import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  ACCOUNT_MENU_COPY,
  PROFILE_HREF,
  accountMenuAriaLabel,
  altrixsVersionLabel,
  previewingAs,
  roleMenuLabel,
} from '../src/lib/layout/accountMenu';

const root = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

// String guards: they fail if the sidebar account controls are renamed or removed.

test('account menu copy is exact', () => {
  assert.equal(ACCOUNT_MENU_COPY.profile, 'My profile');
  assert.equal(ACCOUNT_MENU_COPY.rolePreview, 'Role preview');
  assert.equal(ACCOUNT_MENU_COPY.switchDashboard, 'Switch dashboard');
  assert.equal(ACCOUNT_MENU_COPY.signOut, 'Sign out');
  assert.equal(ACCOUNT_MENU_COPY.exit, 'Exit');
  assert.equal(PROFILE_HREF, '/dashboard/settings');
  assert.equal(accountMenuAriaLabel('Alex', 'Therapist'), 'Account menu: Alex, Therapist');
  assert.equal(previewingAs('Physician'), 'Previewing as Physician');
  assert.equal(altrixsVersionLabel(), 'Altrixs 1.0.0');
  assert.equal(roleMenuLabel(true), 'Role preview');
  assert.equal(roleMenuLabel(false), 'Switch dashboard');
});

test('the sidebar footer renders the Account menu and passes sign out', () => {
  const shell = read('src/components/layout/DashboardShell.tsx');
  assert.match(shell, /import \{ AccountMenu \} from '@\/components\/layout\/AccountMenu'/);
  assert.match(shell, /<AccountMenu[\s\S]*?onSignOut=\{handleLogout\}/);
  assert.match(shell, /const handleLogout = async \(\) => \{\s*await logout\(\);/);
});

test('the Account menu has profile, sign out, and menu semantics', () => {
  const menu = read('src/components/layout/AccountMenu.tsx');
  assert.match(menu, /role="menu"/);
  assert.match(menu, /role="menuitem"/);
  assert.match(menu, /aria-haspopup="menu"/);
  assert.match(menu, /aria-expanded=\{open\}/);
  assert.match(menu, /href=\{PROFILE_HREF\}/);
  assert.match(menu, /ACCOUNT_MENU_COPY\.profile/);
  assert.match(menu, /ACCOUNT_MENU_COPY\.signOut/);
  assert.match(menu, /void onSignOut\(\)/);
  // Keyboard: Escape closes, focus stays inside the menu.
  assert.match(menu, /e\.key === 'Escape'/);
  assert.match(menu, /min-h-11/);
});

test('profile settings stays reachable and titled', () => {
  const shell = read('src/components/layout/DashboardShell.tsx');
  assert.match(shell, /'\/dashboard\/settings': 'Profile settings'/);
  assert.match(shell, /href: '\/dashboard\/settings', label: 'Profile settings'/);
});
