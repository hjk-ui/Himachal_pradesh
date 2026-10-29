import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import {
  validateClientBelongsToOrg,
  backfillTrustedLegacyEpisodes,
  sanitizeCrisisRequestBody,
} from '@/lib/crisis/tenantIsolation';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPath(gate.role, '/dashboard/crisis')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status');
    const priority = searchParams.get('priority');

    // Backfill legacy episodes ONLY when trusted evidence (valid clientId in this org) exists.
    // Unverified legacy episodes are NEVER guessed and NEVER exposed.
    await backfillTrustedLegacyEpisodes(gate.organizationId);

    // Strictly scope all episode queries to the authenticated organization
    const episodes = await prisma.crisisEpisode.findMany({
      where: {
        organizationId: gate.organizationId,
        ...(status && status !== 'all' ? { status } : {}),
        ...(priority ? { priority: Number(priority) } : {}),
      },
      orderBy: { startedAt: 'desc' },
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
  const role = String(gate.role || '').toUpperCase();
  if (role === 'HR' || role === 'BILLING') {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const rawBody = await req.json().catch(() => ({}));
    // Prevent request bodies from overriding ownership or delivery confirmation fields
    const body = sanitizeCrisisRequestBody(rawBody);

    // Validate that clientId belongs to the authenticated organization
    if (body.clientId) {
      const isValid = await validateClientBelongsToOrg(body.clientId, gate.organizationId);
      if (!isValid) {
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

    const count = await prisma.crisisEpisode.count({
      where: { organizationId: gate.organizationId },
    });
    const episodeNumber = body.episodeNumber || `MC-2026-${String(count + 101).padStart(4, '0')}`;
    const namedPriority = { routine: 3, urgent: 2, emergent: 1, crisis: 1, high: 1, low: 3 };
    const parsedPriority = Number(body.priority);
    const priority = Number.isInteger(parsedPriority)
      ? parsedPriority
      : namedPriority[String(body.priority || '').toLowerCase()] ?? 2;
    const assignedTeam = body.assignedTeam || 'Crisis Unit 1 — Central';

    // notificationsSent defaults to false; never falsely confirm automated dispatch
    const created = await prisma.crisisEpisode.create({
      data: {
        organizationId: gate.organizationId,
        episodeNumber,
        clientId: body.clientId || null,
        clientName: body.clientName || 'Anonymous Client',
        location: body.location || 'Field Location',
        callerName: body.callerName || null,
        callerRelationship: body.callerRelationship || null,
        priority,
        status: body.status || 'dispatched',
        assignedTeam,
        teamMembers: body.teamMembers || 'Crisis Response Unit',
        dispatchedAt: body.dispatchedAt || timeStr,
        docComplete: false,
        notificationsSent: false,
        timeline: [
          {
            time: timeStr,
            label: `Crisis call received — triage completed (Priority ${priority})`,
            note: body.initialNotes || 'Crisis intake recorded',
            kind: 'status',
          },
          {
            time: timeStr,
            label: `Dispatched — ${assignedTeam}`,
            note: body.initialNotes || 'Mobile crisis unit deployed',
            kind: 'dispatch',
          },
        ],
      },
    });

    return NextResponse.json({ success: true, episode: created }, { status: 201 });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Could not create crisis episode' },
      { status: 500 }
    );
  }
}
