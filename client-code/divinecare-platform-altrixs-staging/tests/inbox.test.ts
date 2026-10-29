import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  PROTECTED_DISPLAY,
  applyPart2,
  authAttention,
  authPriority,
  dedupeAcrossSections,
  isThreadAwaiting,
  loadAllSections,
  loadSection,
  paginate,
  parsePaging,
  sortInboxItems,
  summarizeInbox,
  taskEntityKey,
  unsignedNoteCutoff,
  type InboxDeps,
} from '../src/lib/inbox/core';
import { INBOX_SECTIONS, sectionsForRole } from '../src/lib/inbox/sections';
import type { InboxDraft, InboxItem, InboxSectionKey } from '../src/lib/inbox/types';

// Synthetic ids and names only; no real patient data.

const NOW = new Date('2026-10-17T16:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

const keysFor = (role: string) => sectionsForRole(role).map((s) => s.key);

function draft(over: Partial<InboxDraft> = {}): InboxDraft {
  return {
    entityKey: 'x:1',
    title: 'Item',
    detail: 'Sensitive detail',
    clientId: 'client-a',
    clientName: 'Test Client A',
    priority: 'normal',
    since: hoursAgo(1),
    href: '/dashboard/alerts',
    hrefLabel: 'Open',
    action: null,
    ...over,
  };
}

function fakeDeps(data: Partial<Record<InboxSectionKey, InboxDraft[]>>, locked: string[] = []): InboxDeps {
  const loaders = Object.fromEntries(
    INBOX_SECTIONS.map((s) => [s.key, async () => ({ drafts: data[s.key] ?? [] })])
  ) as unknown as InboxDeps['loaders'];
  return { loaders, lockedClientIds: async () => new Set(locked) };
}

// ─── Role filtering per section ───────────────────────────────────────────────

test('refill / RxChange requests only for prescribers', () => {
  for (const role of ['PSYCHIATRIST', 'NP', 'PHYSICIAN', 'MEDICAL_NP']) assert.ok(keysFor(role).includes('rx_requests'), role);
  for (const role of ['THERAPIST', 'ADMIN', 'FRONT_DESK', 'BILLING', 'CASE_MANAGER']) {
    assert.ok(!keysFor(role).includes('rx_requests'), role);
  }
});

test('authorizations only for front desk, billing, office manager and leadership', () => {
  for (const role of ['FRONT_DESK', 'BILLING', 'OFFICE_MANAGER', 'ADMIN', 'PRACTICE_DIRECTOR']) {
    assert.ok(keysFor(role).includes('authorizations'), role);
  }
  for (const role of ['THERAPIST', 'PSYCHIATRIST', 'PEER_SUPPORT', 'HR']) assert.ok(!keysFor(role).includes('authorizations'), role);
});

test('billing gets no clinical sections', () => {
  const k = keysFor('BILLING');
  for (const s of ['alerts', 'cosign', 'unsigned_notes', 'sud_radar', 'documents', 'session_frequency', 'messages'] as const) {
    assert.ok(!k.includes(s), s);
  }
  assert.ok(k.includes('tasks'));
});

test('HR sees no patient sections at all', () => {
  assert.deepEqual(keysFor('HR'), []);
});

test('co-sign queue for supervisors (incl. licensed therapists), not for peer or front desk', () => {
  for (const role of ['THERAPIST', 'PSYCHIATRIST', 'PRACTICE_DIRECTOR']) assert.ok(keysFor(role).includes('cosign'), role);
  for (const role of ['PEER_SUPPORT', 'FRONT_DESK', 'CASE_MANAGER']) assert.ok(!keysFor(role).includes('cosign'), role);
});

test('SUD radar and documents follow the EHR gates; front desk has neither', () => {
  assert.ok(keysFor('THERAPIST').includes('sud_radar'));
  assert.ok(keysFor('THERAPIST').includes('documents'));
  assert.ok(!keysFor('FRONT_DESK').includes('sud_radar'));
  assert.ok(!keysFor('FRONT_DESK').includes('documents'));
  assert.ok(!keysFor('PEER_SUPPORT').includes('sud_radar'));
});

test('a clinician gets the clinical sections, messages and To-Do', () => {
  const k = keysFor('THERAPIST');
  for (const s of ['alerts', 'messages', 'unsigned_notes', 'session_frequency', 'tasks'] as const) assert.ok(k.includes(s), s);
});

test('no role, no sections', () => {
  assert.deepEqual(sectionsForRole(null), []);
});

test('only permitted sections are loaded, even when a loader has data', async () => {
  const deps = fakeDeps({ rx_requests: [draft({ entityKey: 'rcopiaRefill:1' })], tasks: [draft({ entityKey: 'task:1' })] });
  const results = await loadAllSections({ organizationId: 'org', userId: 'u', role: 'BILLING' }, deps, NOW);
  assert.ok(!results.some((r) => r.key === 'rx_requests'));
  assert.equal(results.find((r) => r.key === 'tasks')?.items.length, 1);
});

// ─── Part 2 masking ────────────────────────────────────────────────────────────

test('protected client the viewer cannot open: "Protected record", no details, no action', () => {
  const [item] = applyPart2(
    'alerts',
    [draft({ clientId: 'client-p', clientName: 'Hidden Name', title: 'High risk alert · Crisis keywords', action: { kind: 'review_risk_alert', alertId: 'a1', noteRequired: true } })],
    new Set(['client-p'])
  );
  assert.equal(item.clientDisplay, PROTECTED_DISPLAY);
  assert.equal(item.protected, true);
  assert.equal(item.detail, null);
  assert.equal(item.action, null);
  assert.ok(!JSON.stringify(item).includes('Hidden Name'));
  assert.ok(!JSON.stringify(item).includes('Crisis keywords'));
  assert.equal(item.href, '/dashboard/clients/client-p');
  assert.equal(item.priority, 'normal');
});

test('unlocked clients keep their details', () => {
  const [item] = applyPart2('alerts', [draft()], new Set(['someone-else']));
  assert.equal(item.clientDisplay, 'Test Client A');
  assert.equal(item.detail, 'Sensitive detail');
  assert.equal(item.protected, false);
});

test('access lookup failure locks every client row (fail closed); rows without a client stay', async () => {
  const deps = fakeDeps({ tasks: [draft({ entityKey: 'a' }), draft({ entityKey: 'b', clientId: null, clientName: 'Staff Member' })] });
  deps.lockedClientIds = async () => {
    throw new Error('db down');
  };
  const r = await loadSection({ organizationId: 'org', userId: 'u', role: 'THERAPIST' }, 'tasks', deps, NOW);
  const withClient = r.items.find((i) => i.entityKey === 'a');
  const without = r.items.find((i) => i.entityKey === 'b');
  assert.equal(withClient?.clientDisplay, PROTECTED_DISPLAY);
  assert.equal(without?.clientDisplay, 'Staff Member');
});

test('SUD radar drops protected rows entirely, like the radar page', () => {
  const items = applyPart2('sud_radar', [draft({ clientId: 'client-p' }), draft({ clientId: 'client-a', entityKey: 'y' })], new Set(['client-p']));
  assert.equal(items.length, 1);
  assert.equal(items[0].clientId, 'client-a');
});

// ─── Counts equal items ────────────────────────────────────────────────────────

test('summary count for a section equals that section items length', async () => {
  const deps = fakeDeps(
    {
      alerts: [draft({ entityKey: 'riskAlert:1', priority: 'urgent' }), draft({ entityKey: 'mbc:1', clientId: 'client-p' })],
      messages: [draft({ entityKey: 'thread:1' })],
      tasks: [draft({ entityKey: 'riskAlert:1' }), draft({ entityKey: 'task:9' })],
    },
    ['client-p']
  );
  const actor = { organizationId: 'org', userId: 'u', role: 'THERAPIST' };
  const results = await loadAllSections(actor, deps, NOW);
  const summary = summarizeInbox(results, NOW);
  for (const s of summary.sections) {
    const single = await loadSection(actor, s.key, deps, NOW);
    assert.equal(s.count, single.items.length, s.key);
  }
  assert.equal(summary.sections.find((s) => s.key === 'alerts')?.count, 2);
  assert.equal(summary.sections.find((s) => s.key === 'alerts')?.urgent, 1);
  // riskAlert:1 is both an alert and a To-Do; "All" counts it once
  assert.equal(summary.total, 4);
  assert.equal(summary.total, dedupeAcrossSections(results.flatMap((r) => r.items)).length);
});

test('a failing section reports error and null count without hiding the others', async () => {
  const deps = fakeDeps({ messages: [draft({ entityKey: 'thread:1' })] });
  deps.loaders.alerts = async () => {
    throw new Error('boom');
  };
  const summary = summarizeInbox(await loadAllSections({ organizationId: 'o', userId: 'u', role: 'THERAPIST' }, deps, NOW), NOW);
  const alerts = summary.sections.find((s) => s.key === 'alerts');
  assert.equal(alerts?.count, null);
  assert.ok(alerts?.error);
  assert.equal(summary.sections.find((s) => s.key === 'messages')?.count, 1);
});

test('pagination total equals the full list length', () => {
  const list = Array.from({ length: 30 }, (_, i) => i);
  const p2 = paginate(list, 2, 25);
  assert.equal(p2.total, 30);
  assert.deepEqual(p2.items, [25, 26, 27, 28, 29]);
  assert.deepEqual(parsePaging('0', '1000'), { page: 1, pageSize: 100 });
  assert.deepEqual(parsePaging(null, null), { page: 1, pageSize: 25 });
});

// ─── Sorting and dedupe ────────────────────────────────────────────────────────

const item = (id: string, priority: InboxItem['priority'], since: string | null, section: InboxSectionKey = 'alerts', entityKey = id): InboxItem => ({
  id,
  section,
  entityKey,
  title: id,
  detail: null,
  clientId: null,
  clientDisplay: null,
  protected: false,
  priority,
  since,
  href: '/',
  hrefLabel: 'Open',
  action: null,
});

test('sorted by priority, then oldest first, undated last', () => {
  const sorted = sortInboxItems([
    item('normal-old', 'normal', hoursAgo(100)),
    item('urgent-new', 'urgent', hoursAgo(1)),
    item('high-undated', 'high', null),
    item('urgent-old', 'urgent', hoursAgo(50)),
    item('high-old', 'high', hoursAgo(10)),
    item('low', 'low', hoursAgo(500)),
  ]);
  assert.deepEqual(sorted.map((i) => i.id), ['urgent-old', 'urgent-new', 'high-old', 'high-undated', 'normal-old', 'low']);
});

test('All keeps the dedicated section row over the To-Do copy, with the higher priority', () => {
  const out = dedupeAcrossSections([
    item('t', 'urgent', null, 'tasks', 'riskAlert:1'),
    item('a', 'high', hoursAgo(2), 'alerts', 'riskAlert:1'),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].section, 'alerts');
  assert.equal(out[0].priority, 'urgent');
});

// ─── Source rules ──────────────────────────────────────────────────────────────

test('task ids map to the same entity keys as the dedicated sections', () => {
  assert.equal(taskEntityKey('note-abc'), 'note:abc');
  assert.equal(taskEntityKey('alert-r1'), 'riskAlert:r1');
  assert.equal(taskEntityKey('sud-referral-r2'), 'riskAlert:r2');
  assert.equal(taskEntityKey('pa-expiring-p1'), 'priorAuth:p1');
  assert.equal(taskEntityKey('pa-units-p1'), 'priorAuth:p1');
  assert.equal(taskEntityKey('claims-ready-batch'), 'task:claims-ready-batch');
});

test('authorization attention: 14 days or 3 visits left; approved only', () => {
  const day = 86_400_000;
  const at = (days: number) => new Date(NOW.getTime() + days * day);
  const base = { status: 'APPROVED', unitsApproved: 20, unitsUsed: 5 };
  assert.equal(authAttention({ ...base, endDate: at(30) }, NOW), null);
  assert.ok(authAttention({ ...base, endDate: at(14) }, NOW));
  assert.equal(authAttention({ ...base, endDate: at(15) }, NOW), null);
  assert.ok(authAttention({ ...base, endDate: at(60), unitsUsed: 17 }, NOW));
  assert.equal(authAttention({ ...base, endDate: at(60), unitsUsed: 16 }, NOW), null);
  assert.equal(authAttention({ ...base, status: 'PENDING', endDate: at(1) }, NOW), null);
  const expired = authAttention({ ...base, endDate: at(-2) }, NOW);
  assert.ok(expired?.expired);
  assert.equal(authPriority(expired!), 'urgent');
  assert.equal(authPriority(authAttention({ ...base, endDate: at(5) }, NOW)!), 'high');
  assert.equal(authPriority(authAttention({ ...base, endDate: at(12) }, NOW)!), 'normal');
});

test('message threads: open with unread or waiting', () => {
  assert.ok(isThreadAwaiting({ status: 'in-progress', unreadCount: 2 }));
  assert.ok(isThreadAwaiting({ status: 'waiting', unreadCount: 0 }));
  assert.ok(!isThreadAwaiting({ status: 'in-progress', unreadCount: 0 }));
  assert.ok(!isThreadAwaiting({ status: 'resolved', unreadCount: 3 }));
});

test('unsigned notes cutoff is 24 hours', () => {
  assert.equal(unsignedNoteCutoff(NOW).toISOString(), '2026-10-16T16:00:00.000Z');
});
