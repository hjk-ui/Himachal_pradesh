import { NextResponse } from 'next/server';
import type { Role } from '@prisma/client';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath, canAccessPayerBilling } from '@/lib/auth/roleAccess';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import { prisma } from '@/lib/db/prisma';
import {
  OPERATIONAL_REPORTS,
  REVENUE_REPORTS,
  lateCancelRate,
  noShowRate,
  parseDay,
} from '@/lib/billing/patientReference';

export const runtime = 'nodejs';

const operational = new Set<string>(OPERATIONAL_REPORTS);
const revenue = new Set<string>(REVENUE_REPORTS);

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  const { id } = await ctx.params;
  const billing = canAccessPayerBilling(gate.role);
  if (revenue.has(id)) {
    if (!billing) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  } else if (operational.has(id)) {
    if (!billing && gate.role !== 'OFFICE_MANAGER') {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }
    if (gate.role === 'OFFICE_MANAGER' && !canAccessPath(gate.role, '/dashboard/reports')) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }
  } else {
    return NextResponse.json({ success: false, error: 'Unknown report' }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const from = parseDay(typeof body.from === 'string' ? body.from : null);
  const to = parseDay(typeof body.to === 'string' ? body.to : null);
  const page = Math.max(0, Number(body.page) || 0);
  const pageSize = Math.min(200, Math.max(1, Number(body.pageSize) || 50));
  const actor = {
    organizationId: gate.organizationId,
    actorUserId: gate.userId,
    actorRole: gate.role as Role,
  };
  const toEnd = to ? new Date(to.getTime() + 86_400_000) : null;

  if (id === 'prior-auth-utilization') {
    const rows = await prisma.priorAuth.findMany({
      where: {
        organizationId: gate.organizationId,
        client: clientAccessWhere(actor),
        ...(typeof body.payer === 'string' && body.payer ? { payer: { contains: body.payer, mode: 'insensitive' } } : {}),
        ...(typeof body.status === 'string' && body.status ? { status: body.status as never } : {}),
        ...(from || toEnd ? { startDate: { ...(from ? { gte: from } : {}), ...(toEnd ? { lt: toEnd } : {}) } } : {}),
      },
      include: { client: { select: { name: true, mrn: true } } },
      orderBy: { endDate: 'asc' },
    });
    const now = Date.now();
    const horizon = now + 30 * 86_400_000;
    const shaped = rows.map((row) => {
      const remaining = row.unitsApproved - row.unitsUsed;
      const nearlyUsed = row.unitsApproved > 0 && row.unitsUsed / row.unitsApproved >= 0.8;
      const expiring = row.endDate != null && row.endDate.getTime() >= now && row.endDate.getTime() <= horizon;
      return {
        id: row.id,
        payer: row.payer,
        authNumber: row.authNumber,
        status: row.status,
        startDate: row.startDate,
        endDate: row.endDate,
        unitsApproved: row.unitsApproved,
        unitsUsed: row.unitsUsed,
        remaining,
        expiring,
        nearlyUsed,
        clientName: row.client.name,
        mrn: row.client.mrn,
      };
    });
    return NextResponse.json({
      success: true,
      id,
      total: shaped.length,
      page,
      pageSize,
      rows: shaped.slice(page * pageSize, page * pageSize + pageSize),
    });
  }

  if (id === 'appointment-volume' || id === 'no-show-late-cancel') {
    const groupBy = ['provider', 'type', 'month', 'location'].includes(body.groupBy) ? body.groupBy : 'provider';
    const appointments = await prisma.appointment.findMany({
      where: {
        organizationId: gate.organizationId,
        ...(from || toEnd ? { startsAt: { ...(from ? { gte: from } : {}), ...(toEnd ? { lt: toEnd } : {}) } } : {}),
        ...(typeof body.provider === 'string' && body.provider ? { clinicianId: body.provider } : {}),
        ...(typeof body.site === 'string' && body.site ? { client: { locationId: body.site } } : {}),
      },
      select: {
        status: true,
        type: true,
        startsAt: true,
        clinicianId: true,
        clinicianName: true,
        client: { select: { location: { select: { id: true, name: true } } } },
      },
    });
    const byStatus: Record<string, number> = {};
    const groups = new Map<string, { key: string; kept: number; noShows: number; lateCancels: number; total: number }>();
    for (const row of appointments) {
      byStatus[row.status] = (byStatus[row.status] || 0) + 1;
      const key =
        groupBy === 'type'
          ? row.type
          : groupBy === 'month'
            ? row.startsAt.toISOString().slice(0, 7)
            : groupBy === 'location'
              ? row.client.location?.name || 'No location'
              : row.clinicianName || row.clinicianId || 'Unassigned';
      const bucket = groups.get(key) || { key, kept: 0, noShows: 0, lateCancels: 0, total: 0 };
      bucket.total += 1;
      if (row.status === 'COMPLETED' || row.status === 'CHECKED_IN') bucket.kept += 1;
      if (row.status === 'NO_SHOW') bucket.noShows += 1;
      if (row.status === 'LATE_CANCEL') bucket.lateCancels += 1;
      groups.set(key, bucket);
    }
    const kept = (byStatus.COMPLETED || 0) + (byStatus.CHECKED_IN || 0);
    const noShows = byStatus.NO_SHOW || 0;
    const lateCancels = byStatus.LATE_CANCEL || 0;
    const grouped = [...groups.values()].map((row) => ({
      ...row,
      noShowRate: noShowRate(row.kept, row.noShows),
      lateCancelRate: lateCancelRate(row.kept, row.noShows, row.lateCancels),
    }));
    return NextResponse.json({
      success: true,
      id,
      groupBy,
      byStatus,
      kept,
      noShows,
      lateCancels,
      noShowRate: noShowRate(kept, noShows),
      lateCancelRate: lateCancelRate(kept, noShows, lateCancels),
      total: grouped.length,
      page,
      pageSize,
      rows: grouped.slice(page * pageSize, page * pageSize + pageSize),
    });
  }

  if (id === 'waitlist') {
    const open = ['WAITING', 'MATCHED', 'SCHEDULED'];
    const rows = await prisma.waitlistEntry.findMany({
      where: {
        organizationId: gate.organizationId,
        ...(typeof body.status === 'string' && body.status ? { status: body.status as never } : {}),
        ...(typeof body.payer === 'string' && body.payer
          ? { insurancePayer: { contains: body.payer, mode: 'insensitive' } }
          : {}),
        ...(from || toEnd ? { createdAt: { ...(from ? { gte: from } : {}), ...(toEnd ? { lt: toEnd } : {}) } } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
    const shaped = rows.map((row) => ({
      id: row.id,
      status: row.status,
      urgency: row.urgency,
      specialty: row.specialty,
      referralSource: row.referralSource,
      createdAt: row.createdAt,
      closedAt: row.closedAt,
      convertedAt: row.convertedAt,
      matchedAt: row.matchedAt,
      open: open.includes(row.status),
    }));
    return NextResponse.json({
      success: true,
      id,
      openCount: shaped.filter((row) => row.open).length,
      total: shaped.length,
      page,
      pageSize,
      rows: shaped.slice(page * pageSize, page * pageSize + pageSize),
    });
  }

  return NextResponse.json({ success: true, id, total: 0, page, pageSize, rows: [] });
}
