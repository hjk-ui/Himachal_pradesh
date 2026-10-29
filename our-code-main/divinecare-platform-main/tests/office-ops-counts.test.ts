import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

test('ops-counts scopes draft notes via ProgressNote → client, not workflow.client', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'lib', 'office', 'ops-counts.ts'), 'utf8');
  assert.match(src, /prisma\.progressNote\s*\n\s*\.count/);
  assert.match(src, /client:\s*\{\s*organizationId\s*\}/);
  assert.match(src, /workflow:\s*\{[\s\S]*status:\s*'DRAFT'/);
  assert.doesNotMatch(src, /progressNoteWorkflow[\s\S]*client:\s*\{\s*organizationId/);
});

test('ops-counts API preserves OM/admin role gate and org context', () => {
  const route = fs.readFileSync(
    path.join(ROOT, 'src', 'app', 'api', 'office', 'ops-counts', 'route.ts'),
    'utf8'
  );
  assert.match(route, /requireOrgContext/);
  assert.match(route, /OFFICE_MANAGER/);
  assert.match(route, /OM_ROLES\.has\(gate\.role\)/);
  assert.match(route, /buildOfficeOpsCounts\(gate\.organizationId\)/);
});

test('in-basket unsigned notes also org-scope through ProgressNote.client', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'lib', 'medical', 'inbasket.ts'), 'utf8');
  assert.match(src, /prisma\.progressNote[\s\S]*client:\s*\{\s*organizationId\s*\}/);
  assert.match(src, /workflow:\s*\{\s*status:\s*'DRAFT'\s*\}/);
});
