import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { sanitizeCrisisRequestBody } from '@/lib/crisis/tenantIsolation';

export const runtime = 'nodejs';

function formatHhMm(d: Date): string {
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  try {
    const { searchParams } = new URL(req.url);
    const episodeId = searchParams.get('episodeId');

    // If episodeId is provided, enforce that the episode belongs to the authenticated organization
    if (episodeId) {
      const ep = await prisma.crisisEpisode.findFirst({
        where: {
          organizationId: gate.organizationId,
          OR: [{ id: episodeId }, { episodeNumber: episodeId }],
        },
        select: { id: true },
      });
      if (!ep) {
        return NextResponse.json(
          { success: false, error: 'Episode not found in this organization' },
          { status: 404 }
        );
      }
    }

    const latest = await prisma.crisisTeamPage.findFirst({
      where: {
        organizationId: gate.organizationId,
        ...(episodeId ? { episodeId } : {}),
      },
      orderBy: { pagedAt: 'desc' },
    });

    if (!latest) {
      return NextResponse.json({ success: true, latest: null });
    }

    const timeStr = formatHhMm(new Date(latest.pagedAt));

    return NextResponse.json({
      success: true,
      latest: {
        ...latest,
        formattedTime: timeStr,
        channels: {
          sms: latest.smsDelivered ? 'delivered' : 'unavailable',
          push: latest.pushDelivered ? 'delivered' : 'unavailable',
          sns: latest.snsDelivered ? 'delivered' : 'unavailable',
        },
      },
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Could not fetch paging status' },
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

    const now = new Date();
    const timeStr = formatHhMm(now);

    const trigger = body.trigger || 'manual_override';
    const assignedTeam = body.assignedTeam || 'Crisis Unit 1 — Central';
    const episodeId = body.episodeId || null;
    const episodeNumber = body.episodeNumber || null;

    // Validate episode ownership if episodeId or episodeNumber is provided
    let linkedEpisode = null;
    if (episodeId || episodeNumber) {
      linkedEpisode = await prisma.crisisEpisode.findFirst({
        where: {
          organizationId: gate.organizationId,
          ...(episodeId ? { id: episodeId } : { episodeNumber: episodeNumber! }),
        },
      });

      if (!linkedEpisode) {
        return NextResponse.json(
          { success: false, error: 'Episode not found in this organization' },
          { status: 404 }
        );
      }
    }

    // Secure zero-PHI link
    const secureLink = linkedEpisode?.episodeNumber
      ? `/dashboard/crisis?episode=${encodeURIComponent(linkedEpisode.episodeNumber)}`
      : '/dashboard/crisis';

    // Check if real SMS / push notification provider is configured with delivery evidence.
    // In current environment, notification delivery is unimplemented.
    // Rule: Do not set delivered, acknowledged, respondersAck or notificationsSent
    // unless supported by actual provider/receiver evidence.
    // If notification delivery is unimplemented, return an explicit unavailable result
    // and do not record successful dispatch.
    const isNotificationProviderAvailable = Boolean(
      process.env.PINPOINT_APPLICATION_ID &&
      process.env.AWS_SNS_TOPIC_ARN &&
      process.env.ENABLE_LIVE_CRISIS_PAGING === 'true'
    );

    if (!isNotificationProviderAvailable) {
      // Record failure audit entry without false confirmations
      const failedPage = await prisma.crisisTeamPage.create({
        data: {
          organizationId: gate.organizationId,
          episodeId: linkedEpisode?.id || episodeId,
          episodeNumber: linkedEpisode?.episodeNumber || episodeNumber,
          trigger,
          assignedTeam,
          smsDelivered: false,
          pushDelivered: false,
          snsDelivered: false,
          respondersAck: 0,
          respondersTotal: 0,
          supervisorNotified: false,
          deliveryStatus: 'failed',
          pagedAt: now,
          secureEpisodeLink: secureLink,
          metadata: {
            deliveryError: 'PROVIDER_UNAVAILABLE',
            message: 'External notification delivery provider is unimplemented or unavailable',
          },
        },
      }).catch((e) => {
        console.error('[crisis:paging] Failed to persist page telemetry:', e);
        return null;
      });

      // Update episode timeline to reflect attempted but unavailable delivery;
      // explicitly do NOT set notificationsSent = true!
      if (linkedEpisode) {
        const existingTimeline = Array.isArray(linkedEpisode.timeline)
          ? (linkedEpisode.timeline as Array<{ time: string; label: string; note?: string; kind: string }>)
          : [];

        await prisma.crisisEpisode.update({
          where: { id: linkedEpisode.id },
          data: {
            timeline: [
              ...existingTimeline,
              {
                time: timeStr,
                label: `Crisis team paging attempted — notification delivery unavailable`,
                note: `Automated SMS/Push provider unavailable. Responders must be contacted manually.`,
                kind: 'notify',
              },
            ],
            // notificationsSent MUST remain unchanged (false) unless verified
          },
        }).catch(() => {});
      }

      return NextResponse.json(
        {
          success: false,
          unavailable: true,
          error: 'Notification delivery provider is unimplemented or unavailable',
          deliveryStatus: 'unavailable',
          channels: {
            sms: 'unavailable',
            push: 'unavailable',
            sns: 'unavailable',
          },
          respondersAcknowledged: 0,
          respondersTotal: 0,
          notificationsSent: false,
          page: failedPage,
        },
        { status: 503 }
      );
    }

    // In the future when a live provider is implemented with actual webhooks/evidence:
    // (Actual delivery dispatch logic would run here)
    return NextResponse.json(
      {
        success: false,
        unavailable: true,
        error: 'Notification delivery provider is unimplemented or unavailable',
      },
      { status: 503 }
    );
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Could not process crisis team page' },
      { status: 500 }
    );
  }
}
