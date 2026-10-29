import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

/** Sidebar footer: one account button + account menu, role switch/preview inside it, amber preview state. */
const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const shell = read('src/components/layout/DashboardShell.tsx');
const menu = read('src/components/layout/SidebarAccountMenu.tsx');
const switcher = read('src/components/layout/RoleSwitcher.tsx');

function sidebarFooter() {
  const start = shell.indexOf('mt-auto shrink-0 border-t border-white/10');
  assert.ok(start > 0, 'footer container present');
  const end = shell.indexOf('</div>', shell.indexOf('<SidebarAccountMenu', start));
  return shell.slice(start, end);
}

test('footer renders a single account button (no stacked cards / separate links)', () => {
  const footer = sidebarFooter();
  assert.equal((footer.match(/<SidebarAccountMenu/g) || []).length, 1);
  assert.doesNotMatch(footer, /<RoleSwitcher\b|<Link\b|<button\b/);
  assert.doesNotMatch(shell, /<RoleSwitcher\b/);
  assert.equal((menu.match(/aria-haspopup="menu"/g) || []).length, 1, 'one menu trigger');
  assert.match(menu, /min-h-\[52px\]/);
  assert.match(menu, /bg-\[#5C2D91\]/, 'brand purple avatar');
  assert.match(menu, /user\.image/);
  assert.match(menu, /ChevronsUpDown/);
});

test('account menu: accessible menu with profile, role section, sign out, version', () => {
  assert.match(menu, /role="menu"/);
  assert.match(menu, /aria-expanded=\{open\}/);
  for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End', 'Escape', 'Tab']) assert.ok(menu.includes(`'${key}'`), key);
  assert.match(menu, /mousedown/);
  assert.match(menu, /touchstart/);
  assert.match(menu, /bottom-full/, 'opens upward');
  assert.match(menu, />My profile</);
  assert.match(menu, /profileHref \?/);
  assert.match(menu, />Sign out</);
  assert.match(menu, /<RoleSwitcherMenuSection/);
  assert.match(menu, /Altrixs \{formatVersionLabel\(version\)\}/);
  assert.match(menu, /title=\{`Built \$\{version\.builtAt\}`\}/);
  assert.match(menu, /user\.email/);
});

test('sign out is still wired to handleLogout', () => {
  assert.match(shell, /onSignOut=\{handleLogout\}/);
  assert.match(shell, /const handleLogout = async \(\) => \{\s*clearRecentClients\(userId\);\s*await logout\(\);/);
  assert.match(menu, /void onSignOut\(\)/);
});

test('role switching keeps admin preview, Medical Director preview, assigned roles, refresh and busy', () => {
  assert.match(switcher, /export function useRoleSwitcher/);
  assert.match(switcher, /MEDICAL_DIRECTOR_PREVIEW_ENTRY/);
  assert.match(switcher, /switchRole\(next, \{ medicalDirectorPreview: preview \}\)/);
  assert.match(switcher, /router\.refresh\(\)/);
  assert.match(switcher, /disabled=\{rs\.busy\}/);
  assert.match(switcher, /role="menuitemradio"/);
  assert.match(switcher, /aria-checked=/);
  assert.match(switcher, /'Role preview' : 'Switch dashboard'/);
  assert.match(switcher, /exitPreview = \(\) => pick\('ADMIN', false\)/);
  // Shell calls the hook once and shares it with the menu and the banner.
  assert.equal((shell.match(/useRoleSwitcher\(\)/g) || []).length, 1);
  assert.match(shell, /rs=\{roleSwitch\}/);
});

test('preview state: amber bar with Exit above the account button and a banner on every page', () => {
  assert.match(switcher, /isPreviewing = Boolean\(isAdminViewer && active && \(active !== 'ADMIN' \|\| activeDirectorPreview\)\)/);
  assert.match(menu, /rs\.isPreviewing/);
  assert.match(menu, /Previewing as/);
  assert.match(menu, />\s*Exit\s*</);
  assert.match(menu, /rs\.exitPreview\(\)/);
  assert.match(menu, /amber/);
  assert.match(shell, /roleSwitch\.isPreviewing \?/);
  assert.match(shell, /You&apos;re previewing the/);
  assert.match(shell, /Exit preview/);
  assert.match(shell, /roleSwitch\.exitPreview\(\)/);
  assert.ok(shell.indexOf('Exit preview') < shell.indexOf('<main id="main"'), 'banner sits above main content');
});

test('contrast: no slate-400/500 text in the sidebar footer, menu or role list', () => {
  for (const [name, src] of [['footer', sidebarFooter()], ['menu', menu], ['switcher', switcher]]) {
    assert.doesNotMatch(src, /text-slate-(400|500)\b/, name);
  }
  assert.match(menu, /rounded-lg/);
  assert.doesNotMatch(menu, /rounded-xl/);
  assert.match(menu, /focus-visible:ring-2/);
  assert.match(menu, /min-h-11/, '44px tap targets on mobile');
});

test('collapsed sidebar: avatar-only trigger with a title, menu anchored beside the rail', () => {
  assert.match(shell, /collapsed=\{Boolean\(collapsed && !isMobile\)\}/);
  assert.match(menu, /title=\{collapsed \? `\$\{name\} · \$\{secondary\}` : undefined\}/);
  assert.match(menu, /\{!collapsed && \(/);
  assert.match(menu, /rect\.right \+ 8/);
  assert.match(menu, /'fixed w-72/);
});
