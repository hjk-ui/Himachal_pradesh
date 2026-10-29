import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import {
  validateClientBelongsToOrg,
  sanitizeCrisisRequestBody,
} from '@/lib/crisis/tenantIsolation';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { filterRowsToCaseload, programCaseloadClientIds } from '@/lib/programs/caseloadRows';

export const runtime = 'nodejs';

async function findVerifiedEpisode(id: string, organizationId: string) {
  let episode = await prisma.crisisEpisode.findFirst({
    where: {
      organizationId,
      OR: [{ id }, { episodeNumber: id }],
    },
  });

  if (!episode) {
    // Check if there is an unassigned legacy episode with trusted ownership evidence
    const legacy = await prisma.crisisEpisode.findFirst({
      where: {
        organizationId: null,
        OR: [{ id }, { episodeNumber: id }],
      },
    });

    if (legacy && legacy.clientId) {
      const hasTrustedOwnership = await validateClientBelongsToOrg(legacy.clientId, organizationId);
      if (hasTrustedOwnership) {
        episode = await prisma.crisisEpisode.update({
          where: { id: legacy.id },
          data: { organizationId },
        });
      }
    }
  }

  return episode;
}

/** Peer Support / Case Manager / PRP: only episodes linked to a client on their caseload (as the list route). */
async function onCaseload(gate: { organizationId: string; userId: string; role: string }, clientId: string | null | undefined) {
  const allowed = await programCaseloadClientIds({ organizationId: gate.organizationId, userId: gate.userId, role: String(gate.role) });
  return filterRowsToCaseload([{ clientId: clientId ?? null }], allowed).length > 0;
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  try {
    const { id } = await ctx.params;
    const found = await findVerifiedEpisode(id, gate.organizationId);
    const episode = found && (await onCaseload(gate, found.clientId)) ? found : null;

    if (!episode) {
      await auditPhiAccess({ gate, req, action: 'READ', resourceType: 'crisisEpisode', resourceId: id, outcome: 'DENIED', metadata: { reason: 'episode_not_found' } });
      return NextResponse.json({ success: false, error: 'Episode not found' }, { status: 404 });
    }

    await auditPhiAccess({ gate, req, action: 'READ', resourceType: 'crisisEpisode', resourceId: episode.id, patientId: episode.clientId, metadata: { status: episode.status } });

    return NextResponse.json({ success: true, episode });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Error fetching episode' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  try {
    const { id } = await ctx.params;
    const found = await findVerifiedEpisode(id, gate.organizationId);
    const existing = found && (await onCaseload(gate, found.clientId)) ? found : null;

    if (!existing) {
      await auditPhiAccess({ gate, req, action: 'WRITE', resourceType: 'crisisEpisode', resourceId: id, outcome: 'DENIED', metadata: { reason: 'episode_not_found' } });
      return NextResponse.json({ success: false, error: 'Episode not found' }, { status: 404 });
    }

    const rawBody = await req.json().catch(() => ({}));
    // Strip ownership and delivery/acknowledgement override attempts
    const body = sanitizeCrisisRequestBody(rawBody);

    // Validate clientId belongs to this organization if updating client link
    if (body.clientId) {
      const isValid = await validateClientBelongsToOrg(body.clientId, gate.organizationId);
      if (!isValid) {
        return NextResponse.json(
          { success: false, error: 'Client not found in this organization' },
          { status: 400 }
        );
      }
      // Caseload roles may only link the episode to a client on their own caseload
      if (!(await onCaseload(gate, body.clientId))) {
        return NextResponse.json({ success: false, error: 'Client not found in this organization' }, { status: 400 });
      }
    }

    // CARF Compliance Gate: Cannot close without docComplete + trusted notificationsSent + scheduled/completed 24h follow-up
    if (body.status === 'closed') {
      const isDocComplete = body.docComplete !== undefined ? Boolean(body.docComplete) : existing.docComplete;
      const isNotified = existing.notificationsSent;
      const followUp24h = body.followUp24hStatus ?? existing.followUp24hStatus;

      if (!isDocComplete || !isNotified || followUp24h === 'pending') {
        return NextResponse.json(
          {
            success: false,
            error: 'CARF Compliance Gate: Episode cannot be closed without complete documentation, verified care team notifications sent, and a scheduled or completed 24-hour follow-up.',
            gate: 'CARF_EPISODE_CLOSURE_RESTRICTED',
          },
          { status: 422 }
        );
      }
    }

    const updated = await prisma.crisisEpisode.update({
      where: { id: existing.id },
      data: {
        clientId: body.clientId !== undefined ? body.clientId : undefined,
        clientName: body.clientName ?? undefined,
        location: body.location ?? undefined,
        callerName: body.callerName ?? undefined,
        callerRelationship: body.callerRelationship ?? undefined,
        priority: body.priority !== undefined ? Number(body.priority) : undefined,
        status: body.status ?? undefined,
        assignedTeam: body.assignedTeam ?? undefined,
        teamMembers: body.teamMembers ?? undefined,
        dispatchedAt: body.dispatchedAt ?? undefined,
        arrivedAt: body.arrivedAt ?? undefined,
        resolvedAt: body.resolvedAt ?? undefined,
        responseMinutes: body.responseMinutes !== undefined ? Number(body.responseMinutes) : undefined,
        disposition: body.disposition ?? undefined,
        interventions: body.interventions ?? undefined,
        mseAppearance: body.mseAppearance ?? undefined,
        mseMood: body.mseMood ?? undefined,
        mseThought: body.mseThought ?? undefined,
        mseOrientation: body.mseOrientation ?? undefined,
        lraNarrative: body.lraNarrative ?? undefined,
        clientVoice: body.clientVoice ?? undefined,
        docComplete: body.docComplete !== undefined ? Boolean(body.docComplete) : undefined,
        // notificationsSent and organizationId are protected from body overrides
        followUp24hStatus: body.followUp24hStatus ?? undefined,
        followUp24hDate: body.followUp24hDate ? new Date(body.followUp24hDate) : undefined,
        followUp72hStatus: body.followUp72hStatus ?? undefined,
        followUp72hDate: body.followUp72hDate ? new Date(body.followUp72hDate) : undefined,
        chargeRouted: body.chargeRouted !== undefined ? Boolean(body.chargeRouted) : undefined,
        timeline: body.timeline ?? undefined,
      },
    });

    await auditPhiAccess({
      gate,
      req,
      action: 'WRITE',
      resourceType: 'crisisEpisode',
      resourceId: updated.id,
      patientId: updated.clientId,
      metadata: {
        fields: Object.keys(body as Record<string, unknown>).filter((k) => (body as Record<string, unknown>)[k] !== undefined),
        status: updated.status,
      },
    });

    return NextResponse.json({ success: true, episode: updated });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Error updating episode' },
      { status: 500 }
    );
  }
}

export const PUT = PATCH;

