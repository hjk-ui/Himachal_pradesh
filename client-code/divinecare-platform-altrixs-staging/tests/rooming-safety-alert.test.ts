import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { ASSESSMENT_CATALOG } from '../src/features/ehr/assessments/catalog';
import { screeningSafetyFlags } from '../src/lib/medical/primaryCareWorkflow';
import {
  raiseRoomingSafetyAlert,
  ROOMING_SAFETY_PROMPT,
  roomingSafetyPrompt,
  roomingSafetyRecipient,
  roomingScored,
} from '../src/lib/medical/roomingSafety';

// Synthetic data only; no real patient data.

function alertDb() {
  const rows: { id: string; data: Record<string, unknown> }[] = [];
  return {
    rows,
    riskAlert: {
      findFirst: async ({ where }: { where: { organizationId: string; clientId: string; source: string; sourceId: string } }) =>
        rows.find((r) => r.data.organizationId === where.organizationId && r.data.clientId === where.clientId && r.data.source === where.source && r.data.sourceId === where.sourceId) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `alert${rows.length + 1}`, data };
        rows.push(row);
        return { id: row.id };
      },
    },
  };
}

/** Same scoring path as the rooming route (catalog calculateResult on q1..qN) */
function roomingScreen(instrumentId: string, items: number[]) {
  const inst = ASSESSMENT_CATALOG.find((i) => i.id === instrumentId)!;
  const answers = Object.fromEntries(items.map((v, i) => [`q${i + 1}`, v]));
  return roomingScored({ instrumentId, instrumentName: inst.name, category: inst.category, answers, result: inst.calculateResult!(answers) });
}

const client = { id: 'clientA', name: 'Synthetic Patient' };

test('rooming: recipient is the PCP, else the rendering provider, else the person who entered it', () => {
  assert.equal(roomingSafetyRecipient({ pcpUserId: 'pcp', renderingProviderId: 'rendering', enteredById: 'ma' }), 'pcp');
  assert.equal(roomingSafetyRecipient({ pcpUserId: null, renderingProviderId: 'rendering', enteredById: 'ma' }), 'rendering');
  assert.equal(roomingSafetyRecipient({ pcpUserId: null, renderingProviderId: null, enteredById: 'ma' }), 'ma');
});

test('rooming: PHQ-9 item 9 above 0 raises one HIGH alert to the PCP, never duplicated per record', async () => {
  const scored = roomingScreen('phq-9', [0, 0, 0, 0, 0, 0, 0, 0, 1]);
  assert.equal(scored.safetyFlagged, true);
  assert.equal(scored.safetyItemPositive, true);
  const db = alertDb();
  const input = { organizationId: 'org1', client, recipientUserId: roomingSafetyRecipient({ pcpUserId: 'pcp', renderingProviderId: 'rendering', enteredById: 'ma' }), actorUserId: 'ma', recordId: 'rec1', scored };
  const first = await raiseRoomingSafetyAlert(db, input);
  assert.equal(first.created.length, 1);
  assert.equal(db.rows[0].data.severity, 'HIGH');
  assert.equal(db.rows[0].data.type, 'suicidal_ideation');
  assert.equal(db.rows[0].data.clinicianId, 'pcp');
  assert.equal(db.rows[0].data.source, 'assessment');
  assert.equal(db.rows[0].data.sourceId, 'rec1');
  const again = await raiseRoomingSafetyAlert(db, input);
  assert.deepEqual(again, { created: [], existing: 'alert1' });
  assert.equal(db.rows.length, 1);
  // No PCP on file: the visit's rendering provider
  await raiseRoomingSafetyAlert(db, { ...input, recordId: 'rec2', recipientUserId: roomingSafetyRecipient({ pcpUserId: null, renderingProviderId: 'rendering', enteredById: 'ma' }) });
  assert.equal(db.rows[1].data.clinicianId, 'rendering');
});

test('rooming: negative screens raise nothing and show no MA prompt', async () => {
  const db = alertDb();
  for (const [id, items] of [['phq-9', [3, 3, 3, 3, 3, 3, 3, 3, 0]], ['phq-2', [3, 3]], ['gad-7', [3, 3, 3, 3, 3, 3, 3]]] as [string, number[]][]) {
    const scored = roomingScreen(id, items);
    const r = await raiseRoomingSafetyAlert(db, { organizationId: 'org1', client, recipientUserId: 'pcp', actorUserId: 'ma', recordId: `r-${id}`, scored });
    assert.equal(r.created.length, 0, id);
  }
  assert.equal(db.rows.length, 0);
  assert.equal(roomingSafetyPrompt(screeningSafetyFlags({ phq9: { items: [3, 3, 3, 3, 3, 3, 3, 3, 0] } }).length), null);
});

test('rooming: MA prompt is the fixed crisis text on a positive item 9 (minimum necessary)', () => {
  const prompt = roomingSafetyPrompt(screeningSafetyFlags({ phq9: { items: [0, 0, 0, 0, 0, 0, 0, 0, 2] } }).length);
  assert.equal(prompt, ROOMING_SAFETY_PROMPT);
  assert.match(ROOMING_SAFETY_PROMPT, /notify the provider now/);
  assert.match(ROOMING_SAFETY_PROMPT, /988/);
  assert.doesNotMatch(ROOMING_SAFETY_PROMPT, /\d+\/\d+|score/i);
  const panel = readFileSync('src/features/medical/components/RoomingPanel.tsx', 'utf8');
  assert.match(panel, /function SafetyPrompt/);
  assert.match(panel, /safetyFlags\.length \? <SafetyPrompt/);
  assert.match(panel, /ROOMING_SAFETY_PROMPT/);
});

test('rooming route: files a positive safety screen on any save, alerts once, audits it', () => {
  const src = readFileSync('src/app/api/medical/rooming/[appointmentId]/route.ts', 'utf8');
  // Filed on draft save too (onlySafety), before the "ready" filing
  assert.match(src, /await file\('phq9', 'phq-9', true\)/);
  assert.match(src, /raiseRoomingSafetyAlert\(prisma/);
  assert.match(src, /loadCurrentPcp\(gate\.organizationId, appt\.clientId\)/);
  assert.match(src, /renderingProviderId: appt\.clinicianId/);
  assert.match(src, /resourceType: 'riskAlert'/);
  assert.match(src, /feature: 'primary-care-rooming'/);
  assert.match(src, /safetyPrompt: roomingSafetyPrompt/);
  assert.match(src, /prompt: ROOMING_SAFETY_PROMPT/);
  // A filed screen is never filed again (dedupe at the record level too)
  assert.match(src, /if \(!sc \|\| sc\.recordId/);
});

test('provider visit banner shows the positive rooming safety screen', () => {
  const src = readFileSync('src/app/api/medical/visit-workflow/route.ts', 'utf8');
  assert.match(src, /screeningSafetyFlags\(checks\?\.screenings\)/);
});
