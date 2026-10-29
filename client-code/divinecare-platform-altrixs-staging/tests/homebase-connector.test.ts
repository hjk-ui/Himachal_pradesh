import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { HomebaseClient, HomebaseNotConnectedError, RateLimiter, homebaseClientFor, parseLinkHeader, rateLimitKey, type Clock, type FetchLike } from '../src/lib/hr/homebase/client';
import { getHomebaseConfig } from '../src/lib/hr/homebase/config';
import { breakMinutesOf, mapDeletedIds, mapEmployee, mapLocation, mapShift, mapTimecard } from '../src/lib/hr/homebase/mappers';
import { buildRosterReview, matchEmployees, normalizePersonName, suggestLocation, type LinkState } from '../src/lib/hr/homebase/matching';
import { buildReconciliation, reconciliationCsv, summarizePayPeriod, csvCell } from '../src/lib/hr/homebase/reconcile';
import { mergeEmployees, runHomebaseSync, validateSyncRange } from '../src/lib/hr/homebase/sync';
import type { HomebaseStore } from '../src/lib/hr/homebase/store';

const ROOT = path.join(__dirname, '..');
const LOC = '11111111-2222-3333-4444-555555555555';

function fakeClock(): Clock & { slept: number[]; t: number } {
  const c = {
    t: 0,
    slept: [] as number[],
    now: () => c.t,
    sleep: async (ms: number) => {
      c.slept.push(ms);
      c.t += ms;
    },
  };
  return c;
}

type Resp = { status: number; body?: unknown; headers?: Record<string, string> };
function mockFetch(handler: (url: string, n: number) => Resp) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const fn: FetchLike = async (url, init) => {
    calls.push({ url, headers: init.headers });
    const r = handler(url, calls.length);
    const h = new Map(Object.entries(r.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    return { status: r.status, ok: r.status >= 200 && r.status < 300, headers: { get: (k: string) => h.get(k.toLowerCase()) ?? null }, json: async () => r.body };
  };
  return { fn, calls };
}

// ─── Link header + pagination ────────────────────────────────────────────────

test('parseLinkHeader reads next / last (RFC 5988)', () => {
  const h = '<https://api.joinhomebase.com/locations?page=2&per_page=2>; rel="next", <https://api.joinhomebase.com/locations?page=3&per_page=2>; rel="last"';
  const l = parseLinkHeader(h);
  assert.equal(l.next, 'https://api.joinhomebase.com/locations?page=2&per_page=2');
  assert.equal(l.last, 'https://api.joinhomebase.com/locations?page=3&per_page=2');
  assert.deepEqual(parseLinkHeader(null), {});
  assert.deepEqual(parseLinkHeader('garbage'), {});
  assert.equal(parseLinkHeader('<https://x/a?page=2>;rel=next').next, 'https://x/a?page=2');
});

test('getAll follows Link rel="next", sends the v1 Accept header and bearer key', async () => {
  const { fn, calls } = mockFetch((url) => {
    const page = new URL(url).searchParams.get('page');
    if (page === '1') return { status: 200, body: [{ uuid: 'a' }, { uuid: 'b' }], headers: { Total: '3', 'Per-Page': '2', Link: '<https://api.joinhomebase.com/locations?page=2&per_page=2>; rel="next"' } };
    return { status: 200, body: { data: [{ uuid: 'c' }] }, headers: { Total: '3', 'Per-Page': '2' } };
  });
  const c = new HomebaseClient({ apiKey: 'k-secret', baseUrl: 'https://api.joinhomebase.com', fetchImpl: fn, clock: fakeClock() });
  const r = await c.locations();
  assert.equal(r.items.length, 3);
  assert.equal(r.pages, 2);
  assert.equal(r.total, 3);
  assert.equal(calls[0].headers.Accept, 'application/vnd.homebase-v1+json');
  assert.equal(calls[0].headers.Authorization, 'Bearer k-secret');
});

test('getAll falls back to Total / Per-Page when there is no Link header', async () => {
  const { fn, calls } = mockFetch((url) => {
    const page = Number(new URL(url).searchParams.get('page'));
    return { status: 200, body: page <= 2 ? [{ id: page * 10 }, { id: page * 10 + 1 }] : [{ id: 99 }], headers: { Total: '5', 'Per-Page': '2' } };
  });
  const c = new HomebaseClient({ apiKey: 'k', baseUrl: 'https://api.joinhomebase.com', fetchImpl: fn, clock: fakeClock() });
  const r = await c.getAll('/locations/x/employees');
  assert.equal(r.items.length, 5);
  assert.equal(calls.length, 3);
});

test('next links to another host are never followed (the key stays on Homebase)', async () => {
  const { fn, calls } = mockFetch(() => ({ status: 200, body: [{ uuid: 'a' }], headers: { Link: '<https://evil.example.com/steal?page=2>; rel="next"' } }));
  const c = new HomebaseClient({ apiKey: 'k', baseUrl: 'https://api.joinhomebase.com', fetchImpl: fn, clock: fakeClock() });
  const r = await c.locations();
  assert.equal(r.items.length, 1);
  assert.equal(calls.length, 1);
});

test('base path from HOMEBASE_API_BASE is kept (e.g. /api/public)', () => {
  const c = new HomebaseClient({ apiKey: 'k', baseUrl: 'https://app.joinhomebase.com/api/public' });
  assert.equal(c.url('/locations', { page: 1 }), 'https://app.joinhomebase.com/api/public/locations?page=1');
});

// ─── 429 backoff + rate limiter ──────────────────────────────────────────────

test('429 is retried with backoff (Retry-After honored)', async () => {
  const clock = fakeClock();
  const { fn, calls } = mockFetch((_u, n) => (n === 1 ? { status: 429, body: { error: 'Rate limit exceeded' }, headers: { 'Retry-After': '3' } } : n === 2 ? { status: 429, body: { error: 'Rate limit exceeded' } } : { status: 200, body: { name: 'Co' } }));
  const c = new HomebaseClient({ apiKey: 'k', baseUrl: 'https://api.joinhomebase.com', fetchImpl: fn, clock });
  const body = await c.company();
  assert.deepEqual(body, { name: 'Co' });
  assert.equal(calls.length, 3);
  assert.deepEqual(clock.slept, [3000, 4000]);
});

test('429 gives up after the retry budget with a safe message (no key)', async () => {
  const { fn } = mockFetch(() => ({ status: 429, body: { error: 'Rate limit exceeded' } }));
  const c = new HomebaseClient({ apiKey: 'super-secret-key', baseUrl: 'https://api.joinhomebase.com', fetchImpl: fn, clock: fakeClock(), maxRateLimitRetries: 2 });
  await assert.rejects(c.company(), (err: Error) => /rate limit/i.test(err.message) && !err.message.includes('super-secret-key'));
});

test('rate limiter: at most 50 requests per minute per UUID, buckets are separate', async () => {
  const clock = fakeClock();
  const lim = new RateLimiter(50, 60_000, clock);
  for (let i = 0; i < 50; i++) await lim.acquire('a');
  assert.equal(clock.slept.length, 0);
  await lim.acquire('b');
  assert.equal(clock.slept.length, 0);
  await lim.acquire('a');
  assert.equal(clock.slept.length, 1);
  assert.ok(clock.slept[0] >= 59_000);
  assert.equal(rateLimitKey(`/locations/${LOC}/shifts`), LOC);
  assert.equal(rateLimitKey('/company'), 'global');
});

// ─── Not connected: no fabricated data ───────────────────────────────────────

test('no key → "Not connected" and no client (never demo data)', () => {
  const cfg = getHomebaseConfig('org1', {} as unknown as NodeJS.ProcessEnv);
  assert.equal(cfg.connected, false);
  assert.equal(cfg.reason, 'no_api_key');
  assert.equal(getHomebaseConfig('org1', { HOMEBASE_API_KEY: 'k' } as unknown as NodeJS.ProcessEnv).reason, 'no_organization');
  assert.equal(getHomebaseConfig('org2', { HOMEBASE_API_KEY: 'k', HOMEBASE_ORGANIZATION_ID: 'org1' } as unknown as NodeJS.ProcessEnv).reason, 'other_organization');
  assert.equal(getHomebaseConfig('org1', { HOMEBASE_API_KEY: 'k', HOMEBASE_ORGANIZATION_ID: 'org1' } as unknown as NodeJS.ProcessEnv).connected, true);
  const prev = process.env.HOMEBASE_API_KEY;
  delete process.env.HOMEBASE_API_KEY;
  try {
    assert.throws(() => homebaseClientFor('org1'), HomebaseNotConnectedError);
  } finally {
    if (prev !== undefined) process.env.HOMEBASE_API_KEY = prev;
  }
  const src = fs.readdirSync(path.join(ROOT, 'src/lib/hr/homebase')).map((f) => fs.readFileSync(path.join(ROOT, 'src/lib/hr/homebase', f), 'utf8')).join('\n');
  assert.doesNotMatch(src, /faker|demoEmployees|DEMO_|sampleEmployees|mockEmployees/);
});

// ─── Tolerant mappers ────────────────────────────────────────────────────────

test('mappers accept field variants, never crash, and never keep wages', () => {
  assert.equal(mapLocation({ uuid: LOC, name: 'Divine Counseling - Bowie' })?.homebaseId, LOC);
  assert.equal(mapLocation({ name: 'no id' }), null);
  assert.equal(mapLocation(null), null);
  const e = mapEmployee({ id: 7, first_name: 'Jane', last_name: 'Doe', email: 'JANE@Example.com', role: 'Therapist', pay_rate: 45, wage: 45, phone: '555', archived: false }, LOC)!;
  assert.equal(e.homebaseId, '7');
  assert.equal(e.email, 'jane@example.com');
  assert.equal(e.jobTitle, 'Therapist');
  assert.equal(e.status, 'active');
  assert.deepEqual(e.locationIds, [LOC]);
  assert.ok(!('payRate' in e) && !('wage' in e) && !('phone' in e));
  assert.equal(mapEmployee({ id: 'x', name: 'Sam Lee', archived_at: '2026-01-01' })!.lastName, 'Lee');
  assert.equal(mapEmployee({ id: 'x', name: 'Sam Lee', archived_at: '2026-01-01' })!.status, 'archived');
  assert.equal(mapEmployee({ id: 'y' })!.status, 'unknown');
  const s = mapShift({ id: 1, user_id: 7, start_at: '2026-10-20T13:00:00Z', end_at: '2026-10-20T21:00:00Z' }, LOC)!;
  assert.equal(s.homebaseEmployeeId, '7');
  assert.equal(s.endAt?.toISOString(), '2026-10-20T21:00:00.000Z');
  assert.equal(mapShift({ id: 2, start_at: 'not a date' })!.startAt, null);
  const t = mapTimecard({ id: 9, employee_id: 7, clock_in: '2026-10-20T13:00:00Z', clock_out: '2026-10-20T21:30:00Z', timebreaks: [{ start_at: '2026-10-20T17:00:00Z', end_at: '2026-10-20T17:30:00Z', paid: false }, { start_at: '2026-10-20T19:00:00Z', end_at: '2026-10-20T19:10:00Z', paid: true }] })!;
  assert.equal(t.breakMinutes, 30);
  assert.equal(t.workedMinutes, 480);
  assert.equal(mapTimecard({ id: 10, clock_in: '2026-10-20T13:00:00Z' })!.workedMinutes, null);
  assert.equal(breakMinutesOf({ break_minutes: 15 }), 15);
  assert.deepEqual(mapDeletedIds([1, '2', { id: 3 }, null, {}]), ['1', '2', '3']);
});

// ─── Matching ────────────────────────────────────────────────────────────────

const staff = [
  { userId: 'u1', name: 'Jane Doe, LCSW-C', email: 'jane.doe@divine.test', accountStatus: 'ACTIVE' },
  { userId: 'u2', name: 'Dr. Sam Lee', email: 'slee@divine.test', accountStatus: 'ACTIVE' },
  { userId: 'u3', name: 'Pat Gone', email: 'pat@divine.test', accountStatus: 'DEACTIVATED' },
  { userId: 'u4', name: 'New Hire', email: 'new@divine.test', accountStatus: 'ACTIVE' },
];

test('email links automatically (case-insensitive); name is only a suggestion', () => {
  const d = matchEmployees(
    [
      { homebaseId: 'h1', firstName: 'Janie', lastName: 'D', email: 'JANE.DOE@divine.test' },
      { homebaseId: 'h2', firstName: 'Sam', lastName: 'Lee', email: 'sam.personal@gmail.test' },
      { homebaseId: 'h3', firstName: 'Nobody', lastName: 'Here', email: null },
    ],
    staff,
  );
  assert.equal(d.get('h1')!.linkStatus, 'email');
  assert.equal(d.get('h1')!.linkedUserId, 'u1');
  assert.equal(d.get('h2')!.linkStatus, 'suggested');
  assert.equal(d.get('h2')!.linkedUserId, null);
  assert.equal(d.get('h2')!.suggestedUserId, 'u2');
  assert.equal(d.get('h3')!.linkStatus, 'none');
  assert.equal(normalizePersonName('Dr. Jane  O\'Neil-Smith, LCSW-C'), 'jane oneilsmith');
});

test('HR-confirmed links and rejections survive a re-sync', () => {
  const existing = new Map<string, LinkState>([
    ['h1', { linkedUserId: 'u4', linkStatus: 'confirmed', suggestedUserId: null }],
    ['h2', { linkedUserId: null, linkStatus: 'rejected', suggestedUserId: 'u2' }],
  ]);
  const d = matchEmployees(
    [
      { homebaseId: 'h1', firstName: 'Different', lastName: 'Name', email: 'jane.doe@divine.test' },
      { homebaseId: 'h2', firstName: 'Sam', lastName: 'Lee', email: null },
    ],
    staff,
    existing,
  );
  assert.equal(d.get('h1')!.linkedUserId, 'u4');
  assert.equal(d.get('h1')!.linkStatus, 'confirmed');
  assert.equal(d.get('h2')!.linkStatus, 'rejected');
  assert.equal(d.get('h2')!.linkedUserId, null);
});

test('ambiguous names give no suggestion', () => {
  const twins = [...staff, { userId: 'u5', name: 'Sam Lee', email: 'sam2@divine.test', accountStatus: 'ACTIVE' }];
  const d = matchEmployees([{ homebaseId: 'h2', firstName: 'Sam', lastName: 'Lee', email: null }], twins);
  assert.equal(d.get('h2')!.linkStatus, 'none');
});

test('location suggestion by name (Bowie / Silver Spring / Baltimore)', () => {
  const ax = [
    { id: 'L1', name: 'Bowie' },
    { id: 'L2', name: 'Silver Spring' },
    { id: 'L3', name: 'Baltimore', city: 'Baltimore' },
  ];
  assert.equal(suggestLocation('Divine Counseling - Bowie', ax), 'L1');
  assert.equal(suggestLocation('Silver Spring Office', ax), 'L2');
  assert.equal(suggestLocation('DIVINE COUNSELING LLC (Baltimore)', ax), 'L3');
  assert.equal(suggestLocation('Remote', ax), null);
});

test('roster review: matched / suggested / unmatched and onboarding / offboarding mismatches', () => {
  const roster = staff.map((s) => ({ ...s, role: 'THERAPIST' }));
  const r = buildRosterReview(
    [
      { homebaseId: 'h1', firstName: 'Jane', lastName: 'Doe', email: null, status: 'archived', jobTitle: null, locationNames: [], linkedUserId: 'u1', linkStatus: 'email', suggestedUserId: null },
      { homebaseId: 'h3', firstName: 'Pat', lastName: 'Gone', email: null, status: 'active', jobTitle: null, locationNames: [], linkedUserId: 'u3', linkStatus: 'confirmed', suggestedUserId: null },
      { homebaseId: 'h2', firstName: 'Sam', lastName: 'Lee', email: null, status: 'active', jobTitle: null, locationNames: [], linkedUserId: null, linkStatus: 'suggested', suggestedUserId: 'u2' },
      { homebaseId: 'h9', firstName: 'Only', lastName: 'Homebase', email: null, status: 'active', jobTitle: null, locationNames: [], linkedUserId: null, linkStatus: 'none', suggestedUserId: null },
    ],
    roster,
  );
  const by = new Map(r.rows.map((x) => [x.key, x]));
  assert.deepEqual(by.get('hb:h1')!.flags, ['archived_in_homebase_active_in_altrixs']);
  assert.deepEqual(by.get('hb:h3')!.flags, ['active_in_homebase_deactivated_in_altrixs']);
  assert.equal(by.get('hb:h2')!.category, 'suggested');
  assert.deepEqual(by.get('hb:h9')!.flags, ['active_in_homebase_no_altrixs_account']);
  assert.deepEqual(by.get('ax:u4')!.flags, ['active_in_altrixs_missing_from_homebase']);
  assert.equal(by.has('ax:u2'), false); // pending suggestion, not "missing"
  assert.equal(r.counts.matched, 2);
  assert.equal(r.counts.unmatched_altrixs, 1);
});

// ─── Reconciliation ──────────────────────────────────────────────────────────

test('reconciliation math and flags', () => {
  const { rows, totals } = buildReconciliation({
    staff: [
      { userId: 'u1', name: 'Jane Doe', role: 'THERAPIST' },
      { userId: 'u2', name: 'Sam Lee', role: 'PSYCHIATRIST' },
      { userId: 'fd', name: 'Front Desk', role: 'FRONT_DESK' },
    ],
    links: new Map([['u1', ['h1']]]),
    timecards: [
      { homebaseEmployeeId: 'h1', day: '2026-10-19', workedMinutes: 480 },
      { homebaseEmployeeId: 'h1', day: '2026-10-20', workedMinutes: 240 },
      { homebaseEmployeeId: 'h1', day: '2026-10-21', workedMinutes: null, open: true },
    ],
    visits: [
      { userId: 'u1', day: '2026-10-19', completedVisits: 5, scheduledVisits: 6, scheduledMinutes: 330 },
      { userId: 'u1', day: '2026-10-22', completedVisits: 2, scheduledVisits: 2, scheduledMinutes: 120 },
      { userId: 'u2', day: '2026-10-19', completedVisits: 3, scheduledVisits: 3, scheduledMinutes: 90 },
    ],
    notes: [{ userId: 'u1', signedNotes: 5, unsignedNotes: 2, unsignedPastDue: 1 }],
  });
  const u1 = rows.find((r) => r.userId === 'u1')!;
  assert.equal(u1.clockedMinutes, 720);
  assert.equal(u1.clockedHours, 12);
  assert.equal(u1.clockedDays, 3);
  assert.equal(u1.openTimecards, 1);
  assert.equal(u1.completedVisits, 7);
  assert.equal(u1.scheduledVisitMinutes, 450);
  assert.deepEqual(u1.visitDaysWithoutClockIn, ['2026-10-22']);
  assert.equal(u1.visitsWithoutClockIn, 2);
  assert.deepEqual(u1.clockedDaysWithoutVisits, ['2026-10-20', '2026-10-21']);
  assert.deepEqual(new Set(u1.flags), new Set(['unsigned_notes_before_payroll', 'visits_without_clock_in', 'clocked_days_without_visits', 'open_timecards']));
  const u2 = rows.find((r) => r.userId === 'u2')!;
  assert.deepEqual(u2.flags, ['not_linked_to_homebase']);
  assert.deepEqual(u2.visitDaysWithoutClockIn, []);
  assert.equal(rows.some((r) => r.userId === 'fd'), false);
  assert.equal(totals.completedVisits, 10);
  assert.equal(totals.flagged, 1);
});

test('reconciliation output and CSV contain no client identifiers', () => {
  const { rows } = buildReconciliation({
    staff: [{ userId: 'u1', name: 'Jane Doe', role: 'THERAPIST' }],
    links: new Map([['u1', ['h1']]]),
    timecards: [{ homebaseEmployeeId: 'h1', day: '2026-10-19', workedMinutes: 60 }],
    visits: [{ userId: 'u1', day: '2026-10-19', completedVisits: 1, scheduledVisits: 1, scheduledMinutes: 60, clientId: 'c_SECRET', clientName: 'Patient Name' } as never],
    notes: [{ userId: 'u1', signedNotes: 1, unsignedNotes: 0, unsignedPastDue: 0, clientId: 'c_SECRET' } as never],
  });
  const json = JSON.stringify(rows);
  assert.doesNotMatch(json, /client|patient|c_SECRET|Patient Name|mrn|diagnos|icd/i);
  const csv = reconciliationCsv(rows, { start: '2026-10-19', end: '2026-10-25' });
  assert.doesNotMatch(csv.replace('no client information', ''), /client|patient|c_SECRET|mrn|diagnos/i);
  // The SQL behind the report never names a person-level chart table or column
  const agg = fs.readFileSync(path.join(ROOT, 'src/lib/hr/homebase/aggregates.ts'), 'utf8');
  assert.doesNotMatch(agg, /client|patient|mrn|diagnos|body|"Client"/i);
  assert.match(agg, /GROUP BY/);
  assert.equal(csvCell('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
});

test('pay period summary totals hours per employee', () => {
  const r = summarizePayPeriod(
    [
      { homebaseId: 'h1', name: 'Jane Doe', userId: 'u1', altrixsName: 'Jane Doe' },
      { homebaseId: 'h2', name: 'No Cards', userId: null, altrixsName: null },
    ],
    [
      { homebaseEmployeeId: 'h1', day: '2026-10-19', workedMinutes: 450, breakMinutes: 30 },
      { homebaseEmployeeId: 'h1', day: '2026-10-20', workedMinutes: 90, breakMinutes: 0 },
    ],
  );
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].hours, 9);
  assert.equal(r.rows[0].days, 2);
  assert.equal(r.rows[0].breakMinutes, 30);
  assert.equal(r.totalHours, 9);
});

// ─── Sync (mock fetch + in-memory store) ─────────────────────────────────────

function memoryStore() {
  const s = {
    runs: [] as Array<{ id: string; status?: string; counts?: Record<string, number> }>,
    locations: [] as unknown[],
    employees: new Map<string, unknown>(),
    shifts: new Map<string, { deleted?: boolean } & Record<string, unknown>>(),
    timecards: new Map<string, { deleted?: boolean } & Record<string, unknown>>(),
  };
  const store: HomebaseStore = {
    startRun: async () => {
      s.runs.push({ id: `r${s.runs.length + 1}` });
      return `r${s.runs.length}`;
    },
    finishRun: async (id, status, counts) => {
      Object.assign(s.runs.find((r) => r.id === id)!, { status, counts });
    },
    upsertLocations: async (_o, rows) => {
      s.locations = rows;
    },
    loadEmployeeLinks: async () => new Map(),
    upsertEmployees: async (_o, rows) => rows.forEach((r) => s.employees.set(r.homebaseId, r)),
    upsertShifts: async (_o, rows) => rows.forEach((r) => s.shifts.set(r.homebaseId, { ...r })),
    upsertTimecards: async (_o, rows) => rows.forEach((r) => s.timecards.set(r.homebaseId, { ...r })),
    markShiftsDeleted: async (_o, ids) => ids.filter((id) => s.shifts.has(id) && (s.shifts.get(id)!.deleted = true)).length,
    markTimecardsDeleted: async (_o, ids) => ids.filter((id) => s.timecards.has(id) && (s.timecards.get(id)!.deleted = true)).length,
    loadStaffForMatch: async () => staff,
  };
  return { s, store };
}

test('sync pulls locations, employees, shifts, timecards and applies /deleted', async () => {
  const { fn } = mockFetch((url) => {
    const p = new URL(url).pathname;
    if (p === '/locations') return { status: 200, body: [{ uuid: LOC, name: 'Bowie' }] };
    if (p.endsWith('/employees')) return { status: 200, body: [{ id: 7, first_name: 'Jane', last_name: 'Doe', email: 'jane.doe@divine.test' }, { id: 8, first_name: 'Sam', last_name: 'Lee' }] };
    if (p.endsWith('/shifts/deleted')) return { status: 200, body: [{ id: 2 }] };
    if (p.endsWith('/timecards/deleted')) return { status: 200, body: [99] };
    if (p.endsWith('/shifts')) return { status: 200, body: [{ id: 1, user_id: 7, start_at: '2026-10-20T13:00:00Z' }, { id: 2, user_id: 8, start_at: '2026-10-20T13:00:00Z' }] };
    if (p.endsWith('/timecards')) return { status: 200, body: [{ id: 5, user_id: 7, clock_in: '2026-10-20T13:00:00Z', clock_out: '2026-10-20T17:00:00Z' }] };
    return { status: 404 };
  });
  const client = new HomebaseClient({ apiKey: 'k', baseUrl: 'https://api.joinhomebase.com', fetchImpl: fn, clock: fakeClock() });
  const { s, store } = memoryStore();
  const r = await runHomebaseSync({ organizationId: 'org1', client, store, range: { startDate: '2026-10-01', endDate: '2026-10-31' }, trigger: 'manual', triggeredById: 'hr1' });
  assert.equal(r.status, 'success');
  assert.equal(r.counts.employees, 2);
  assert.equal(r.counts.linkedByEmail, 1);
  assert.equal(r.counts.nameSuggestions, 1);
  assert.equal(r.counts.shifts, 2);
  assert.equal(r.counts.timecards, 1);
  assert.equal(r.counts.deletedShifts, 1);
  assert.equal(r.counts.deletedTimecards, 0);
  assert.equal(s.shifts.get('2')!.deleted, true);
  assert.equal(s.runs[0].status, 'success');
});

test('sync: a failing per-location endpoint is "partial"; failing /locations is "failed"', async () => {
  const partial = mockFetch((url) => {
    const p = new URL(url).pathname;
    if (p === '/locations') return { status: 200, body: [{ uuid: LOC, name: 'Bowie' }] };
    if (p.endsWith('/timecards')) return { status: 403 };
    return { status: 200, body: [] };
  });
  const c1 = new HomebaseClient({ apiKey: 'k', baseUrl: 'https://api.joinhomebase.com', fetchImpl: partial.fn, clock: fakeClock() });
  const r1 = await runHomebaseSync({ organizationId: 'o', client: c1, store: memoryStore().store, range: { startDate: '2026-10-01', endDate: '2026-10-02' }, trigger: 'cron', triggeredById: null });
  assert.equal(r1.status, 'partial');
  assert.equal(r1.counts.failedCalls, 1);
  const down = mockFetch(() => ({ status: 401 }));
  const c2 = new HomebaseClient({ apiKey: 'k', baseUrl: 'https://api.joinhomebase.com', fetchImpl: down.fn, clock: fakeClock() });
  const r2 = await runHomebaseSync({ organizationId: 'o', client: c2, store: memoryStore().store, range: { startDate: '2026-10-01', endDate: '2026-10-02' }, trigger: 'cron', triggeredById: null });
  assert.equal(r2.status, 'failed');
  assert.match(r2.error ?? '', /API key/);
});

test('sync range validation and employee merge across locations', () => {
  assert.equal(validateSyncRange({ startDate: '2026-10-01', endDate: '2026-10-31' }), null);
  assert.match(validateSyncRange({ startDate: '2026-10-31', endDate: '2026-10-01' }) ?? '', /before/);
  assert.match(validateSyncRange({ startDate: '2026-01-01', endDate: '2026-12-31' }) ?? '', /at most/);
  const m = mergeEmployees([
    { homebaseId: '7', firstName: 'Jane', lastName: null, email: null, jobTitle: null, status: 'archived', locationIds: ['a'] },
    { homebaseId: '7', firstName: null, lastName: 'Doe', email: 'j@x.test', jobTitle: 'Therapist', status: 'active', locationIds: ['b'] },
  ]);
  assert.equal(m.length, 1);
  assert.equal(m[0].status, 'active');
  assert.deepEqual(m[0].locationIds, ['a', 'b']);
  assert.equal(m[0].lastName, 'Doe');
});

// ─── Read-only + audit ───────────────────────────────────────────────────────

test('connector is read-only: the client only issues GET and the routes are HR-admin gated + audited', () => {
  const client = fs.readFileSync(path.join(ROOT, 'src/lib/hr/homebase/client.ts'), 'utf8');
  assert.doesNotMatch(client, /method:\s*'(POST|PUT|PATCH|DELETE)'/);
  const dir = path.join(ROOT, 'src/app/api/hr/homebase');
  const routes: string[] = [];
  const walk = (d: string) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name === 'route.ts' && routes.push(path.join(d, e.name))));
  walk(dir);
  assert.ok(routes.length >= 6);
  for (const r of routes) {
    const src = fs.readFileSync(r, 'utf8');
    assert.match(src, /hrGate\('admin'\)/, r);
    assert.match(src, /auditHr\(/, r);
  }
});
