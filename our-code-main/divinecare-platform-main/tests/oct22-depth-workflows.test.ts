import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { CAMPAIGN_TRANSITIONS } from '../src/lib/marketing/store';
import { formatBookedByLabel, formatLastChangedBy } from '../src/lib/appointments/bookedBy';
import { hrFieldAccess } from '../src/lib/hr/workspace';

test('campaign status transitions draft→review→approve/send_back→send', () => {
  assert.deepEqual(CAMPAIGN_TRANSITIONS.draft, ['review']);
  assert.deepEqual(CAMPAIGN_TRANSITIONS.review, ['approved', 'send_back']);
  assert.ok(CAMPAIGN_TRANSITIONS.approved.includes('sent'));
  assert.ok(!CAMPAIGN_TRANSITIONS.sent.length);
  const itemsRoute = fs.readFileSync(
    path.join(process.cwd(), 'src/app/api/marketing/items/route.ts'),
    'utf8'
  );
  assert.match(itemsRoute, /CAN-SPAM/);
  assert.match(itemsRoute, /SMS_OPT_OUT_FOOTER|Reply STOP/);
});

test('HR checklist Done persistence API actions exist', () => {
  const route = fs.readFileSync(path.join(process.cwd(), 'src/app/api/hr/workspace/route.ts'), 'utf8');
  assert.match(route, /checklist-task/);
  assert.match(route, /checklist-start/);
  assert.match(route, /reminder-status/);
  const ws = fs.readFileSync(path.join(process.cwd(), 'src/lib/hr/workspace.ts'), 'utf8');
  assert.match(ws, /setChecklistTaskDone/);
  assert.match(ws, /status: allDone \? 'Complete'/);
});

test('OM cannot see compensation/discipline/personal', () => {
  const om = hrFieldAccess('OFFICE_MANAGER');
  assert.equal(om.canSeeCompensation, false);
  assert.equal(om.canSeeDiscipline, false);
  assert.equal(om.canSeePersonal, false);
  const hr = hrFieldAccess('HR');
  assert.equal(hr.canSeeCompensation, true);
  assert.equal(hr.canSeeDiscipline, true);
  assert.equal(hr.canApprovePto, true);
});

test('booked-by vias exact display text', () => {
  assert.equal(
    formatBookedByLabel({ createdVia: 'online' }),
    'Client, online booking page'
  );
  assert.equal(
    formatBookedByLabel({ createdVia: 'portal' }),
    'Client, patient portal'
  );
  assert.equal(formatBookedByLabel({ createdVia: 'import' }), 'Imported from Valant');
  assert.match(
    formatBookedByLabel({ createdVia: 'group', createdByName: 'Alex', createdAt: '2026-10-22T12:00:00Z' }),
    /Alex \(group session\)/
  );
  assert.match(
    formatBookedByLabel({ createdVia: 'staff', createdByName: 'Sam', createdAt: '2026-10-22T12:00:00Z' }),
    /^Sam · /
  );
  assert.equal(formatBookedByLabel({}), 'Not recorded');
  assert.match(
    formatLastChangedBy({ lastChangedByName: 'Pat', lastChangedAt: '2026-10-22T12:00:00Z' }) || '',
    /Last changed by Pat/
  );
});

test('Marketing hub is not placeholder-only (CRUD hooks + campaign Send now)', () => {
  const hub = fs.readFileSync(path.join(process.cwd(), 'src/features/marketing/MarketingHub.tsx'), 'utf8');
  assert.match(hub, /Send now/);
  assert.match(hub, /Submit for review/);
  assert.match(hub, /Create a form/);
  assert.match(hub, /No workflows/);
  assert.match(hub, /No campaigns yet/);
  assert.doesNotMatch(hub, /Coming soon/i);
  assert.ok(!fs.existsSync(path.join(process.cwd(), 'src/features/hr/HrCornerPage.tsx')));
});

test('Appointment schema includes booked-by fields', () => {
  const schema = fs.readFileSync(path.join(process.cwd(), 'prisma/schema.prisma'), 'utf8');
  assert.match(schema, /createdVia/);
  assert.match(schema, /lastChangedByName/);
  assert.match(schema, /lastChangedAt/);
});
