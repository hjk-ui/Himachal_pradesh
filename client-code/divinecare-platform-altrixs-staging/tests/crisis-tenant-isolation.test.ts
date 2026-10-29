import assert from 'node:assert/strict';
import { test } from 'node:test';
import Module, { createRequire } from 'node:module';

// Intercept 'server-only' in Node test runner
const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
const originalLoad = loader._load;
loader._load = function (id: string, ...args: unknown[]) {
  if (id === 'server-only') return {};
  return originalLoad.call(this, id, ...args);
};

test('CRISIS TENANT ISOLATION & NOTIFICATION DELIVERY VERIFICATION SUITE', async (t) => {
  // Mock In-Memory Database State
  type ClientRecord = { id: string; name: string; organizationId: string };
  type EpisodeRecord = {
    id: string;
    episodeNumber: string;
    organizationId: string | null;
    clientId: string | null;
    clientName: string;
    location: string;
    callerName?: string | null;
    callerRelationship?: string | null;
    priority: number;
    status: string;
    assignedTeam: string;
    teamMembers: string;
    dispatchedAt: string;
    arrivedAt?: string | null;
    resolvedAt?: string | null;
    responseMinutes?: number | null;
    disposition?: string | null;
    interventions: string[];
    mseAppearance?: string | null;
    mseMood?: string | null;
    mseThought?: string | null;
    mseOrientation?: string | null;
    lraNarrative?: string | null;
    clientVoice?: string | null;
    docComplete: boolean;
    notificationsSent: boolean;
    followUp24hStatus: string;
    followUp24hDate?: Date | null;
    followUp72hStatus: string;
    followUp72hDate?: Date | null;
    chargeRouted: boolean;
    timeline: any[];
    startedAt: Date;
    createdAt: Date;
    updatedAt: Date;
  };

  type PageRecord = {
    id: string;
    organizationId: string | null;
    episodeId: string | null;
    episodeNumber: string | null;
    pagedBy?: string | null;
    trigger: string;
    assignedTeam: string;
    smsDelivered: boolean;
    pushDelivered: boolean;
    snsDelivered: boolean;
    respondersAck: number;
    respondersTotal: number;
    supervisorNotified: boolean;
    deliveryStatus: string;
    pagedAt: Date;
    secureEpisodeLink?: string | null;
    metadata?: any;
    createdAt: Date;
    updatedAt: Date;
  };

  const clients: ClientRecord[] = [
    { id: 'client-org-a-1', name: 'Alice OrgA', organizationId: 'org-alpha' },
    { id: 'client-org-b-1', name: 'Bob OrgB', organizationId: 'org-beta' },
  ];

  let episodes: EpisodeRecord[] = [];
  let pages: PageRecord[] = [];

  // Reset database state helper
  function resetDb() {
    episodes = [
      {
        id: 'ep-org-a-100',
        episodeNumber: 'MC-2026-0100',
        organizationId: 'org-alpha',
        clientId: 'client-org-a-1',
        clientName: 'Alice OrgA',
        location: 'Downtown Center',
        priority: 1,
        status: 'dispatched',
        assignedTeam: 'Unit 1',
        teamMembers: 'Team Alpha',
        dispatchedAt: '10:00',
        docComplete: false,
        notificationsSent: false,
        followUp24hStatus: 'pending',
        followUp72hStatus: 'pending',
        chargeRouted: false,
        interventions: [],
        timeline: [],
        startedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'ep-org-b-200',
        episodeNumber: 'MC-2026-0200',
        organizationId: 'org-beta',
        clientId: 'client-org-b-1',
        clientName: 'Bob OrgB',
        location: 'Uptown Center',
        priority: 2,
        status: 'onscene',
        assignedTeam: 'Unit 2',
        teamMembers: 'Team Beta',
        dispatchedAt: '11:00',
        docComplete: false,
        notificationsSent: false,
        followUp24hStatus: 'pending',
        followUp72hStatus: 'pending',
        chargeRouted: false,
        interventions: [],
        timeline: [],
        startedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      // Legacy unverified episode without clientId (must NOT be exposed or guessed)
      {
        id: 'ep-legacy-orphan',
        episodeNumber: 'MC-2026-0001',
        organizationId: null,
        clientId: null,
        clientName: 'Orphan Legacy',
        location: 'Old Location',
        priority: 3,
        status: 'resolved',
        assignedTeam: 'Unit 0',
        teamMembers: 'Team Old',
        dispatchedAt: '08:00',
        docComplete: true,
        notificationsSent: false,
        followUp24hStatus: 'completed',
        followUp72hStatus: 'completed',
        chargeRouted: false,
        interventions: [],
        timeline: [],
        startedAt: new Date(Date.now() - 100000),
        createdAt: new Date(Date.now() - 100000),
        updatedAt: new Date(Date.now() - 100000),
      },
      // Legacy unassigned episode with trusted ownership evidence (clientId belongs to org-alpha)
      {
        id: 'ep-legacy-with-trusted-client',
        episodeNumber: 'MC-2026-0002',
        organizationId: null,
        clientId: 'client-org-a-1',
        clientName: 'Alice OrgA Legacy',
        location: 'Field Site',
        priority: 2,
        status: 'dispatched',
        assignedTeam: 'Unit 1',
        teamMembers: 'Team Alpha',
        dispatchedAt: '09:00',
        docComplete: false,
        notificationsSent: false,
        followUp24hStatus: 'pending',
        followUp72hStatus: 'pending',
        chargeRouted: false,
        interventions: [],
        timeline: [],
        startedAt: new Date(Date.now() - 50000),
        createdAt: new Date(Date.now() - 50000),
        updatedAt: new Date(Date.now() - 50000),
      },
    ];

    pages = [
      {
        id: 'page-org-a-1',
        organizationId: 'org-alpha',
        episodeId: 'ep-org-a-100',
        episodeNumber: 'MC-2026-0100',
        trigger: 'manual_override',
        assignedTeam: 'Unit 1',
        smsDelivered: false,
        pushDelivered: false,
        snsDelivered: false,
        respondersAck: 0,
        respondersTotal: 0,
        supervisorNotified: false,
        deliveryStatus: 'failed',
        pagedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'page-org-b-1',
        organizationId: 'org-beta',
        episodeId: 'ep-org-b-200',
        episodeNumber: 'MC-2026-0200',
        trigger: 'manual_override',
        assignedTeam: 'Unit 2',
        smsDelivered: false,
        pushDelivered: false,
        snsDelivered: false,
        respondersAck: 0,
        respondersTotal: 0,
        supervisorNotified: false,
        deliveryStatus: 'failed',
        pagedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];
  }

  // Active mock gate
  let activeGate = {
    ok: true as const,
    userId: 'user-alpha',
    organizationId: 'org-alpha',
    role: 'CRISIS_WORKER',
    session: { user: { id: 'user-alpha' } },
  };

  const mockPrisma = {
    client: {
      findFirst: async ({ where }: any) => {
        const id = where.id;
        const orgFilter = where.AND?.[0]?.OR?.[0]?.organizationId;
        return (
          clients.find(
            (c) =>
              (!id || c.id === id) &&
              (!orgFilter || c.organizationId === orgFilter)
          ) || null
        );
      },
    },
    crisisEpisode: {
      count: async ({ where }: any = {}) => {
        return episodes.filter((e) => !where?.organizationId || e.organizationId === where.organizationId).length;
      },
      findMany: async ({ where }: any = {}) => {
        return episodes.filter((e) => {
          if (where?.organizationId !== undefined && e.organizationId !== where.organizationId) {
            return false;
          }
          if (where?.organizationId === null && e.organizationId !== null) {
            return false;
          }
          if (where?.clientId?.not === null && e.clientId === null) {
            return false;
          }
          if (where?.status && where.status !== 'all' && e.status !== where.status) {
            return false;
          }
          if (where?.priority && e.priority !== where.priority) {
            return false;
          }
          return true;
        });
      },
      findFirst: async ({ where }: any) => {
        return (
          episodes.find((e) => {
            if (where?.organizationId !== undefined && e.organizationId !== where.organizationId) {
              return false;
            }
            if (where?.OR) {
              const matchesOr = where.OR.some((cond: any) => {
                if (cond.id && e.id === cond.id) return true;
                if (cond.episodeNumber && e.episodeNumber === cond.episodeNumber) return true;
                return false;
              });
              if (!matchesOr) return false;
            }
            if (where?.id && e.id !== where.id) return false;
            if (where?.episodeNumber && e.episodeNumber !== where.episodeNumber) return false;
            return true;
          }) || null
        );
      },
      create: async ({ data }: any) => {
        const newEp: EpisodeRecord = {
          id: `ep-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          episodeNumber: data.episodeNumber || `MC-2026-${episodes.length + 100}`,
          organizationId: data.organizationId || null,
          clientId: data.clientId || null,
          clientName: data.clientName || 'Anonymous Client',
          location: data.location || 'Field',
          callerName: data.callerName || null,
          callerRelationship: data.callerRelationship || null,
          priority: data.priority || 2,
          status: data.status || 'dispatched',
          assignedTeam: data.assignedTeam || 'Unit 1',
          teamMembers: data.teamMembers || 'Team',
          dispatchedAt: data.dispatchedAt || '12:00',
          docComplete: Boolean(data.docComplete),
          notificationsSent: Boolean(data.notificationsSent),
          followUp24hStatus: data.followUp24hStatus || 'pending',
          followUp72hStatus: data.followUp72hStatus || 'pending',
          chargeRouted: Boolean(data.chargeRouted),
          interventions: data.interventions || [],
          timeline: data.timeline || [],
          startedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        episodes.push(newEp);
        return newEp;
      },
      update: async ({ where, data }: any) => {
        const idx = episodes.findIndex((e) => e.id === where.id || (where.episodeNumber && e.episodeNumber === where.episodeNumber));
        if (idx === -1) throw new Error('Episode not found');
        episodes[idx] = {
          ...episodes[idx],
          ...data,
          updatedAt: new Date(),
        };
        return episodes[idx];
      },
    },
    crisisTeamPage: {
      findFirst: async ({ where }: any = {}) => {
        return (
          pages.find((p) => {
            if (where?.organizationId && p.organizationId !== where.organizationId) return false;
            if (where?.episodeId && p.episodeId !== where.episodeId) return false;
            return true;
          }) || null
        );
      },
      findMany: async ({ where }: any = {}) => {
        return pages.filter((p) => {
          if (where?.organizationId !== undefined && p.organizationId !== where.organizationId) return false;
          return true;
        });
      },
      create: async ({ data }: any) => {
        const newPage: PageRecord = {
          id: `page-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          organizationId: data.organizationId || null,
          episodeId: data.episodeId || null,
          episodeNumber: data.episodeNumber || null,
          pagedBy: data.pagedBy || null,
          trigger: data.trigger || 'manual_override',
          assignedTeam: data.assignedTeam || 'Unit 1',
          smsDelivered: Boolean(data.smsDelivered),
          pushDelivered: Boolean(data.pushDelivered),
          snsDelivered: Boolean(data.snsDelivered),
          respondersAck: data.respondersAck || 0,
          respondersTotal: data.respondersTotal || 0,
          supervisorNotified: Boolean(data.supervisorNotified),
          deliveryStatus: data.deliveryStatus || 'failed',
          pagedAt: data.pagedAt || new Date(),
          secureEpisodeLink: data.secureEpisodeLink || null,
          metadata: data.metadata || null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        pages.push(newPage);
        return newPage;
      },
      update: async ({ where, data }: any) => {
        const idx = pages.findIndex((p) => p.id === where.id);
        if (idx === -1) throw new Error('Page not found');
        pages[idx] = { ...pages[idx], ...data, updatedAt: new Date() };
        return pages[idx];
      },
    },
  };

  // Mock loader for module imports
  loader._load = function (id, ...args) {
    if (id === '@/lib/db/prisma') return { prisma: mockPrisma };
    if (id === '@/lib/auth/tenant') return { requireOrgContext: async () => activeGate };
    return originalLoad.call(this, id, ...args);
  };

  const require = createRequire(import.meta.url);
  const episodesRoute = require('../src/app/api/crisis/episodes/route');
  const singleEpisodeRoute = require('../src/app/api/crisis/episodes/[id]/route');
  const pagingRoute = require('../src/app/api/crisis/paging/route');

  // -------------------------------------------------------------------------
  // 1. List Isolation & Demo-Data Removal (GET /api/crisis/episodes)
  // -------------------------------------------------------------------------
  await t.test('1. List isolation: org-alpha only sees org-alpha episodes; cannot see org-beta', async () => {
    resetDb();
    activeGate.organizationId = 'org-alpha';

    const req = new Request('http://localhost/api/crisis/episodes');
    const res = await episodesRoute.GET(req);
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.success, true);
    // Should include ep-org-a-100 and the backfilled ep-legacy-with-trusted-client
    assert.ok(body.episodes.some((e: any) => e.id === 'ep-org-a-100'));
    // MUST NOT include org-beta episode
    assert.ok(!body.episodes.some((e: any) => e.id === 'ep-org-b-200'));
    // MUST NOT expose legacy orphan without verified ownership
    assert.ok(!body.episodes.some((e: any) => e.id === 'ep-legacy-orphan'));
  });

  await t.test('2. Trusted backfill: legacy episode with trusted client in org-alpha is backfilled', async () => {
    resetDb();
    activeGate.organizationId = 'org-alpha';

    const req = new Request('http://localhost/api/crisis/episodes');
    const res = await episodesRoute.GET(req);
    const body = await res.json();

    assert.equal(res.status, 200);
    const backfilled = body.episodes.find((e: any) => e.id === 'ep-legacy-with-trusted-client');
    assert.ok(backfilled, 'Trusted legacy episode should be backfilled and exposed');
    assert.equal(backfilled.organizationId, 'org-alpha');
  });

  await t.test('3. No demo-data auto-creation on empty GET request in production', async () => {
    resetDb();
    episodes = []; // Empty DB
    activeGate.organizationId = 'org-fresh';

    const req = new Request('http://localhost/api/crisis/episodes');
    const res = await episodesRoute.GET(req);
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.episodes.length, 0, 'Must return empty list without creating demo episodes');
    assert.equal(episodes.length, 0, 'DB must remain completely empty');
  });

  // -------------------------------------------------------------------------
  // 2. Read Single Episode Isolation (GET /api/crisis/episodes/[id])
  // -------------------------------------------------------------------------
  await t.test('4. Read isolation: org-alpha can read its own episode', async () => {
    resetDb();
    activeGate.organizationId = 'org-alpha';

    const req = new Request('http://localhost/api/crisis/episodes/ep-org-a-100');
    const res = await singleEpisodeRoute.GET(req, {
      params: Promise.resolve({ id: 'ep-org-a-100' }),
    });
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.episode.id, 'ep-org-a-100');
  });

  await t.test('5. Cross-org read denial: org-alpha cannot read org-beta episode (404)', async () => {
    resetDb();
    activeGate.organizationId = 'org-alpha';

    const req = new Request('http://localhost/api/crisis/episodes/ep-org-b-200');
    const res = await singleEpisodeRoute.GET(req, {
      params: Promise.resolve({ id: 'ep-org-b-200' }),
    });
    const body = await res.json();

    assert.equal(res.status, 404);
    assert.equal(body.success, false);
    assert.equal(body.error, 'Episode not found');
  });

  // -------------------------------------------------------------------------
  // 3. Create Episode Tenant Protection & Delivery Truth (POST /api/crisis/episodes)
  // -------------------------------------------------------------------------
  await t.test('6. Create episode assigns organizationId from auth context and rejects body override', async () => {
    resetDb();
    activeGate.organizationId = 'org-alpha';

    const req = new Request('http://localhost/api/crisis/episodes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        organizationId: 'org-malicious-override',
        clientName: 'Charlie',
        clientId: 'client-org-a-1',
        location: 'North Ave',
        priority: 1,
        notificationsSent: true, // Attempted false confirmation
      }),
    });

    const res = await episodesRoute.POST(req);
    const body = await res.json();

    assert.equal(res.status, 201);
    assert.equal(body.success, true);
    assert.equal(body.episode.organizationId, 'org-alpha', 'organizationId must be assigned from auth gate');
    assert.equal(body.episode.notificationsSent, false, 'notificationsSent must NOT be set to true on create');
  });

  await t.test('7. Create episode rejects clientId belonging to another organization (400)', async () => {
    resetDb();
    activeGate.organizationId = 'org-alpha';

    // Passing clientId that belongs to org-beta
    const req = new Request('http://localhost/api/crisis/episodes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientName: 'Cross Org Test',
        clientId: 'client-org-b-1',
        location: 'Somewhere',
      }),
    });

    const res = await episodesRoute.POST(req);
    const body = await res.json();

    assert.equal(res.status, 400);
    assert.equal(body.success, false);
    assert.equal(body.error, 'Client not found in this organization');
  });

  // -------------------------------------------------------------------------
  // 4. Update Episode Tenant Denial & Ownership Guard (PATCH /api/crisis/episodes/[id])
  // -------------------------------------------------------------------------
  await t.test('8. Cross-org update denial: org-alpha cannot update org-beta episode (404)', async () => {
    resetDb();
    activeGate.organizationId = 'org-alpha';

    const req = new Request('http://localhost/api/crisis/episodes/ep-org-b-200', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'resolved' }),
    });

    const res = await singleEpisodeRoute.PATCH(req, {
      params: Promise.resolve({ id: 'ep-org-b-200' }),
    });
    const body = await res.json();

    assert.equal(res.status, 404);
    assert.equal(body.success, false);
    assert.equal(body.error, 'Episode not found');
  });

  await t.test('9. Update episode prevents request body from reassigning organizationId or spoofing notificationsSent', async () => {
    resetDb();
    activeGate.organizationId = 'org-alpha';

    const req = new Request('http://localhost/api/crisis/episodes/ep-org-a-100', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        organizationId: 'org-hijack',
        notificationsSent: true, // Spoofed confirmation
        status: 'onscene',
      }),
    });

    const res = await singleEpisodeRoute.PATCH(req, {
      params: Promise.resolve({ id: 'ep-org-a-100' }),
    });
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.success, true);

    const epInDb = episodes.find((e) => e.id === 'ep-org-a-100')!;
    assert.equal(epInDb.organizationId, 'org-alpha', 'organizationId must not be changed');
    assert.equal(epInDb.notificationsSent, false, 'notificationsSent must not be spoofed by body');
    assert.equal(epInDb.status, 'onscene');
  });

  await t.test('10. Update episode rejects linking client from another organization (400)', async () => {
    resetDb();
    activeGate.organizationId = 'org-alpha';

    const req = new Request('http://localhost/api/crisis/episodes/ep-org-a-100', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: 'client-org-b-1',
      }),
    });

    const res = await singleEpisodeRoute.PATCH(req, {
      params: Promise.resolve({ id: 'ep-org-a-100' }),
    });
    const body = await res.json();

    assert.equal(res.status, 400);
    assert.equal(body.success, false);
    assert.equal(body.error, 'Client not found in this organization');
  });

  // -------------------------------------------------------------------------
  // 5. Paging Tenant Isolation & Delivery Failure Handling
  // -------------------------------------------------------------------------
  await t.test('11. Paging GET scopes to organization; cannot view cross-org paging events', async () => {
    resetDb();
    activeGate.organizationId = 'org-alpha';

    const req = new Request('http://localhost/api/crisis/paging');
    const res = await pagingRoute.GET(req);
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.latest.organizationId, 'org-alpha');
  });

  await t.test('12. Paging GET rejects cross-org episodeId (404)', async () => {
    resetDb();
    activeGate.organizationId = 'org-alpha';

    // org-alpha asks for paging telemetry of org-beta's episode
    const req = new Request('http://localhost/api/crisis/paging?episodeId=ep-org-b-200');
    const res = await pagingRoute.GET(req);
    const body = await res.json();

    assert.equal(res.status, 404);
    assert.equal(body.success, false);
    assert.equal(body.error, 'Episode not found in this organization');
  });

  await t.test('13. Cross-org paging POST denial: org-alpha cannot trigger page for org-beta episode (404)', async () => {
    resetDb();
    activeGate.organizationId = 'org-alpha';

    const req = new Request('http://localhost/api/crisis/paging', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        episodeId: 'ep-org-b-200',
        trigger: 'triage_dispatch',
      }),
    });

    const res = await pagingRoute.POST(req);
    const body = await res.json();

    assert.equal(res.status, 404);
    assert.equal(body.success, false);
    assert.equal(body.error, 'Episode not found in this organization');
  });

  await t.test('14. Paging POST returns explicit unavailable result and does not record successful dispatch when provider is unimplemented', async () => {
    resetDb();
    activeGate.organizationId = 'org-alpha';

    const req = new Request('http://localhost/api/crisis/paging', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        episodeId: 'ep-org-a-100',
        trigger: 'manual_override',
        assignedTeam: 'Crisis Unit 1',
        smsDelivered: true, // Spoof attempt
        respondersAck: 2,   // Spoof attempt
        deliveryStatus: 'acknowledged', // Spoof attempt
      }),
    });

    const res = await pagingRoute.POST(req);
    const body = await res.json();

    // Must return explicit unavailable result (status 503)
    assert.equal(res.status, 503);
    assert.equal(body.success, false);
    assert.equal(body.unavailable, true);
    assert.equal(body.deliveryStatus, 'unavailable');
    assert.equal(body.respondersAcknowledged, 0);
    assert.equal(body.notificationsSent, false);
    assert.equal(body.channels.sms, 'unavailable');
    assert.equal(body.channels.push, 'unavailable');
    assert.equal(body.channels.sns, 'unavailable');

    // Audit page telemetry must NOT record successful dispatch
    const pageCreated = pages.find((p) => p.episodeId === 'ep-org-a-100' && p.organizationId === 'org-alpha');
    assert.ok(pageCreated);
    assert.equal(pageCreated.smsDelivered, false, 'Must not claim SMS delivered');
    assert.equal(pageCreated.pushDelivered, false, 'Must not claim Push delivered');
    assert.equal(pageCreated.snsDelivered, false, 'Must not claim SNS delivered');
    assert.equal(pageCreated.respondersAck, 0, 'Must not claim responders acknowledged');
    assert.equal(pageCreated.deliveryStatus, 'failed', 'Must record failure/unimplemented status');

    // Linked episode must NOT have notificationsSent set to true
    const ep = episodes.find((e) => e.id === 'ep-org-a-100')!;
    assert.equal(ep.notificationsSent, false, 'Episode notificationsSent must remain false');
  });

  // Restore loader
  loader._load = originalLoad;
});
