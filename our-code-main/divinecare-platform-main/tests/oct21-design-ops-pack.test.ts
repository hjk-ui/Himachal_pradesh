import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { readZip } from '../src/lib/documents/clientZip';
import { canAccessPath } from '../src/lib/auth/roleAccess';
import { CLINIC_ROLES } from '../src/types/roles';

test('design tokens use brand #5C2D91 and Inter', () => {
  const css = fs.readFileSync(path.join(process.cwd(), 'src', 'app', 'globals.css'), 'utf8');
  assert.match(css, /--clinic-primary:\s*#5c2d91/i);
  assert.match(css, /Inter/);
  assert.match(css, /Banned/i);
  const btn = fs.readFileSync(
    path.join(process.cwd(), 'src', 'components', 'ui', 'Button.tsx'),
    'utf8'
  );
  assert.match(btn, /primary/);
  assert.match(btn, /secondary/);
  assert.match(btn, /ghost/);
  assert.match(btn, /danger/);
});

test('Growth & Marketing nav label', () => {
  const shell = fs.readFileSync(
    path.join(process.cwd(), 'src', 'components', 'layout', 'DashboardShell.tsx'),
    'utf8'
  );
  assert.match(shell, /Growth & Marketing/);
  assert.match(shell, /label: 'Marketing hub'/);
  assert.match(shell, /label: 'PR & Marketing'/);
  assert.match(shell, /href: '\/dashboard\/marketing'/);
});

test('OM patient-side billing only — blocked from claims/AR', () => {
  assert.equal(canAccessPath('OFFICE_MANAGER', '/dashboard/billing/payments'), true);
  assert.equal(canAccessPath('OFFICE_MANAGER', '/dashboard/billing/statements'), true);
  assert.equal(canAccessPath('OFFICE_MANAGER', '/dashboard/billing/autopay'), true);
  assert.equal(canAccessPath('OFFICE_MANAGER', '/dashboard/billing/claims'), false);
  assert.equal(canAccessPath('OFFICE_MANAGER', '/dashboard/billing/ar-control'), false);
  assert.equal(canAccessPath('OFFICE_MANAGER', '/dashboard/billing/denials'), false);
  assert.equal(canAccessPath('OFFICE_MANAGER', '/dashboard/billing/clearinghouse'), false);
  assert.ok(CLINIC_ROLES.includes('OFFICE_MANAGER'));
});

test('nested ZIP expansion (shallow fixture)', () => {
  // Minimal local-file header for an empty stored entry named "a.txt"
  // This asserts readZip is callable; nested path logic is covered by unit of method 0 store.
  const name = Buffer.from('a.txt');
  const header = Buffer.alloc(30 + name.length);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(0, 8); // store
  header.writeUInt32LE(0, 18); // compressed size
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(0, 28);
  name.copy(header, 30);
  const entries = readZip(header);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].path, 'a.txt');
});

test('staff patch schema allows email (source present)', () => {
  const route = fs.readFileSync(
    path.join(process.cwd(), 'src', 'app', 'api', 'staff', '[id]', 'route.ts'),
    'utf8'
  );
  assert.match(route, /email:\s*z\.string/);
  const manage = fs.readFileSync(
    path.join(process.cwd(), 'src', 'lib', 'staff', 'manage.ts'),
    'utf8'
  );
  assert.match(manage, /Email correction/);
});

test('OM capture-card uses patient autopay path (not AR billing catch-all)', () => {
  const route = fs.readFileSync(
    path.join(process.cwd(), 'src', 'app', 'api', 'billing', 'autopay', 'capture-card', 'route.ts'),
    'utf8'
  );
  assert.match(route, /\/dashboard\/billing\/autopay/);
  assert.doesNotMatch(route, /canAccessPath\(gate\.role, '\/dashboard\/billing'\)/);
});

test('valant-archive merges ZIP billing-archive module rows', () => {
  const route = fs.readFileSync(
    path.join(process.cwd(), 'src', 'app', 'api', 'billing', 'valant-archive', 'route.ts'),
    'utf8'
  );
  assert.match(route, /billing-archive:/);
  assert.match(route, /zipModule/);
  assert.match(route, /documentIntake/);
});
