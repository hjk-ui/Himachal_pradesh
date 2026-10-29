import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import {
  validateClientBelongsToOrg,
  backfillTrustedLegacyEpisodes,
  sanitizeCrisisRequestBody,
} from '@/lib/crisis/tenantIsolation';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { filterRowsToCaseload, programCaseloadClientIds } from '@/lib/programs/caseloadRows';
import { formatEpisodeNumber, nextEpisodeNumber, yearInTimeZone } from '@/lib/crisis/episodeNumber';
import { getPracticeTimeZone } from '@/lib/time/practiceTimeServer';
import { Prisma } from '@prisma/client';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status');
    const priority = searchParams.get('priority');

    // Backfill legacy episodes ONLY when trusted evidence (valid clientId in this org) exists.
    // Unverified legacy episodes are NEVER guessed and NEVER exposed.
    await backfillTrustedLegacyEpisodes(gate.organizationId);

    // Strictly scope all episode queries to the authenticated organization
    // Peer Support / Case Manager / PRP: only episodes linked to their own caseload
    const episodes = filterRowsToCaseload(
      await prisma.crisisEpisode.findMany({
        where: {
          organizationId: gate.organizationId,
          ...(status && status !== 'all' ? { status } : {}),
          ...(priority ? { priority: Number(priority) } : {}),
        },
        orderBy: { startedAt: 'desc' },
      }),
      await programCaseloadClientIds({ organizationId: gate.organizationId, userId: gate.userId, role: String(gate.role) }),
    );

    await auditPhiAccess({
      gate,
      req,
      action: 'LIST',
      resourceType: 'crisisEpisode',
      metadata: {
        count: episodes.length,
        filters: { status: status ?? null, priority: priority ?? null },
        episodeIds: episodes.slice(0, 50).map((e) => e.id),
      },
    });

    return NextResponse.json({ success: true, episodes });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Could not fetch crisis episodes' },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  try {
    const rawBody = await req.json().catch(() => ({}));
    // Prevent request bodies from overriding ownership or delivery confirmation fields
    const body = sanitizeCrisisRequestBody(rawBody);

    // Validate that clientId belongs to the authenticated organization
    if (body.clientId) {
      const isValid = await validateClientBelongsToOrg(body.clientId, gate.organizationId);
      if (!isValid) {
        await auditPhiAccess({ gate, req, action: 'CREATE', resourceType: 'crisisEpisode', patientId: String(body.clientId), outcome: 'DENIED', metadata: { reason: 'client_not_in_org' } });
        return NextResponse.json(
          { success: false, error: 'Client not found in this organization' },
          { status: 400 }
        );
      }
    }

    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const timeStr = `${hh}:${mm}`;

    // Episode number is always assigned here (current year, sequence per org); a client value is ignored
    const year = yearInTimeZone(now, await getPracticeTimeZone(gate.organizationId));
    const prefix = `MC-${year}-`;
    const priority = body.priority ? Number(body.priority) : 2;
    // Only an explicit crisis-line dispatch is recorded as 'dispatched'; an episode
    // opened from telehealth (or with no status) starts 'pending' — no unit has been sent.
    const source = body.source === 'telehealth' ? 'telehealth' : 'crisis_line';
    const status = source === 'crisis_line' && body.status === 'dispatched' ? 'dispatched' : 'pending';
    const assignedTeam = body.assignedTeam || 'Unassigned';

    const timeline: Array<{ time: string; label: string; note?: string; kind: string }> = [
      {
        time: timeStr,
        label:
          source === 'telehealth'
            ? `Episode opened from telehealth — no unit dispatched (Priority ${priority})`
            : `Crisis call received — triage completed (Priority ${priority})`,
        note: body.initialNotes || 'Crisis intake recorded',
        kind: 'status',
      },
    ];
    if (status === 'dispatched') {
      // Automated paging is not connected, so record the assignment, not a confirmed deployment
      timeline.push({
        time: timeStr,
        label: `Assigned to ${assignedTeam} — automated paging not connected; unit must be contacted by phone`,
        kind: 'dispatch',
      });
    }

    // notificationsSent defaults to false; never falsely confirm automated dispatch
    const data = {
      organizationId: gate.organizationId,
        clientId: body.clientId || null,
        clientName: body.clientName || 'Anonymous Client',
        location: body.location || 'Location not recorded',
        callerName: body.callerName || null,
        callerRelationship: body.callerRelationship || null,
        priority,
        status,
        assignedTeam,
        teamMembers: body.teamMembers || 'Not assigned',
        // Time the episode was opened (schema field is required); no deployment is implied
        dispatchedAt: body.dispatchedAt || timeStr,
        docComplete: false,
        notificationsSent: false,
        timeline,
      };

    // Unique episodeNumber: on a concurrent insert with the same number, take the next one
    let created: Awaited<ReturnType<typeof prisma.crisisEpisode.create>> | null = null;
    for (let attempt = 0; attempt < 5 && !created; attempt++) {
      const existing = await prisma.crisisEpisode.findMany({
        where: { organizationId: gate.organizationId, episodeNumber: { startsWith: prefix } },
        select: { episodeNumber: true },
      });
      // Bump past a number that is already taken (a concurrent insert, or another org: the column is globally unique)
      const nextSeq = Number(nextEpisodeNumber(year, existing.map((e) => e.episodeNumber)).slice(prefix.length));
      const episodeNumber = formatEpisodeNumber(year, nextSeq + attempt);
      try {
        created = await prisma.crisisEpisode.create({ data: { ...data, episodeNumber } });
      } catch (e) {
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
      }
    }
    if (!created) {
      return NextResponse.json({ success: false, error: 'Could not assign an episode number — try again' }, { status: 409 });
    }

    await auditPhiAccess({
      gate,
      req,
      action: 'CREATE',
      resourceType: 'crisisEpisode',
      resourceId: created.id,
      patientId: created.clientId,
      metadata: { priority: created.priority, status: created.status, source },
    });

    return NextResponse.json({ success: true, episode: created }, { status: 201 });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Could not create crisis episode' },
      { status: 500 }
    );
  }
}
