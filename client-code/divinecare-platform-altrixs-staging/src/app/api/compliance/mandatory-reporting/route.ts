import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireClinicalContext } from '@/lib/clinical/access';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { withoutLockedClients } from '@/lib/privacy/lockedRows';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get('clientId');
    // One-client read: Part 2 / VIP lock (403 + break-glass)
    const gate = await requireClinicalContext('/dashboard/compliance/mandatory-reporting', { clientId });
    if (!gate.ok) {
      return NextResponse.json({ error: gate.error }, { status: gate.status });
    }

    // List feed: drop Part 2 / VIP clients this actor may not open
    const rawRecords = await withoutLockedClients(gate, await prisma.mandatoryReportRecord.findMany({
      where: {
        organizationId: gate.organizationId,
        client: gate.clientWhere,
        ...(clientId ? { clientId } : {}),
      },
      include: {
        client: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    }));

    const records = rawRecords.map((item) => {
      const r = item as any;
      let parsedActions: string[] = [];
      if (r.actionsTaken) {
        try {
          parsedActions = JSON.parse(r.actionsTaken);
        } catch {
          parsedActions = String(r.actionsTaken).split(',').map((s) => s.trim()).filter(Boolean);
        }
      }

      return {
        id: r.id,
        clientId: r.clientId,
        clientName: r.client?.name || 'Unknown Patient',
        reportType: r.category,
        jurisdictionState: r.jurisdictionState,
        status: r.status,
        urgency: r.urgency || 'within_24h',
        dateOfDisclosure: r.disclosureDate ? r.disclosureDate.toISOString() : r.createdAt.toISOString(),
        dateReported: r.reportDate ? r.reportDate.toISOString() : undefined,
        reportedTo: r.agencyName || undefined,
        reportNumber: r.reportNumber || undefined,
        clinician: r.clinicianId || 'Staff Clinician',
        supervisor: r.supervisorId || undefined,
        disclosureNarrative: r.narrative,
        actionsTaken: parsedActions,
        identifiedVictim: r.identifiedVictim || undefined,
        identifiedThreat: r.identifiedThreat || undefined,
        warningGiven: Boolean(r.warningGiven),
        lawEnforcementNotified: Boolean(r.lawEnforcementContacted),
        supervisorConsulted: Boolean(r.supervisorConsulted),
        legalConsultation: Boolean(r.legalConsultation),
        clientInformed: Boolean(r.clientInformed),
        documentedInChart: typeof r.documentedInChart === 'boolean' ? r.documentedInChart : null,
        followUpDate: r.followUpDate ? r.followUpDate.toISOString() : undefined,
        notes: r.notes || '',
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      };
    });

    // Compute 90-day metrics
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 3600 * 1000);
    const total90d = records.filter((r) => new Date(r.createdAt) >= ninetyDaysAgo).length;
    const openCases = records.filter((r) => r.status !== 'closed').length;
    const followUpRequired = records.filter((r) => r.status === 'follow_up_required').length;
    const filedWithAgency = records.filter((r) => r.status === 'reported').length;

    await auditPhiAccess({
      gate, req: request, action: 'LIST', resourceType: 'mandatoryReport', patientId: clientId || null,
      metadata: { count: records.length, clientId: clientId || null },
    });

    return NextResponse.json({
      success: true,
      data: records,
      metrics: {
        total90d,
        openCases,
        followUpRequired,
        filedWithAgency,
      },
    });
  } catch (error: any) {
    console.error('[api/compliance/mandatory-reporting GET] error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const gate = await requireClinicalContext('/dashboard/compliance/mandatory-reporting');
    if (!gate.ok) {
      return NextResponse.json({ error: gate.error }, { status: gate.status });
    }

    const body = await request.json();
    const {
      id,
      clientId,
      reportType,
      jurisdictionState = 'MD',
      urgency = 'within_24h',
      status = 'documented',
      dateOfDisclosure,
      reportedTo,
      reportNumber,
      disclosureNarrative,
      actionsTaken = [],
      identifiedVictim,
      identifiedThreat,
      warningGiven = false,
      lawEnforcementNotified = false,
      supervisorConsulted = false,
      legalConsultation = false,
      clientInformed = false,
      documentedInChart,
      followUpDate,
      notes = '',
    } = body;

    // Check if updating existing report
    if (id) {
      const existing = await (prisma.mandatoryReportRecord as any).findFirst({
        where: { id, organizationId: gate.organizationId, client: gate.clientWhere },
      });
      if (!existing) {
        await auditPhiAccess({
          gate, req: request, action: 'WRITE', resourceType: 'mandatoryReport', resourceId: String(id),
          outcome: 'DENIED', metadata: { reason: 'report_not_found' },
        });
        return NextResponse.json({ error: 'Report not found' }, { status: 404 });
      }

      const updated = await (prisma.mandatoryReportRecord as any).update({
        where: { id },
        data: {
          status: status || existing.status,
          urgency: urgency || existing.urgency,
          agencyName: reportedTo !== undefined ? reportedTo : existing.agencyName,
          reportNumber: reportNumber !== undefined ? reportNumber : existing.reportNumber,
          reportDate: reportedTo ? new Date() : existing.reportDate,
          actionsTaken: Array.isArray(actionsTaken) ? JSON.stringify(actionsTaken) : existing.actionsTaken,
          warningGiven: warningGiven !== undefined ? warningGiven : existing.warningGiven,
          lawEnforcementContacted: lawEnforcementNotified !== undefined ? lawEnforcementNotified : existing.lawEnforcementContacted,
          supervisorConsulted: supervisorConsulted !== undefined ? supervisorConsulted : existing.supervisorConsulted,
          legalConsultation: legalConsultation !== undefined ? legalConsultation : existing.legalConsultation,
          clientInformed: clientInformed !== undefined ? clientInformed : existing.clientInformed,
          documentedInChart: documentedInChart !== undefined ? documentedInChart : existing.documentedInChart,
          followUpDate: followUpDate ? new Date(followUpDate) : existing.followUpDate,
          notes: notes !== undefined ? notes : existing.notes,
        },
      });

      await auditPhiAccess({
        gate, req: request, action: 'WRITE', resourceType: 'mandatoryReport', resourceId: existing.id,
        patientId: existing.clientId, metadata: { status: updated.status, fields: Object.keys(body ?? {}).filter((k) => k !== 'id' && k !== 'clientId').slice(0, 40) },
      });
      return NextResponse.json({ success: true, data: updated });
    }

    if (!clientId || !reportType || !disclosureNarrative) {
      return NextResponse.json({ error: 'Missing required report fields (Client, Category, Narrative)' }, { status: 400 });
    }

    const patient = await prisma.client.findFirst({
      where: { id: clientId, AND: [gate.clientWhere] },
      select: { id: true, name: true },
    });
    if (!patient) {
      await auditPhiAccess({
        gate, req: request, action: 'CREATE', resourceType: 'mandatoryReport', patientId: String(clientId),
        outcome: 'DENIED', metadata: { reason: 'patient_not_found' },
      });
      return NextResponse.json({ error: 'Patient not found' }, { status: 404 });
    }

    const record = await (prisma.mandatoryReportRecord as any).create({
      data: {
        organizationId: gate.organizationId,
        clientId,
        clinicianId: gate.userId,
        category: reportType,
        jurisdictionState,
        status,
        urgency,
        disclosureDate: dateOfDisclosure ? new Date(dateOfDisclosure) : new Date(),
        agencyName: reportedTo || null,
        reportNumber: reportNumber || null,
        reportDate: reportedTo ? new Date() : null,
        narrative: disclosureNarrative,
        actionsTaken: Array.isArray(actionsTaken) ? JSON.stringify(actionsTaken) : JSON.stringify([]),
        identifiedVictim: identifiedVictim || null,
        identifiedThreat: identifiedThreat || null,
        warningGiven: Boolean(warningGiven),
        lawEnforcementContacted: Boolean(lawEnforcementNotified),
        supervisorConsulted: Boolean(supervisorConsulted),
        legalConsultation: Boolean(legalConsultation),
        clientInformed: Boolean(clientInformed),
        documentedInChart: typeof documentedInChart === 'boolean' ? documentedInChart : null,
        followUpDate: followUpDate ? new Date(followUpDate) : null,
        notes: notes || '',
      },
    });

    await auditPhiAccess({
      gate, req: request, action: 'CREATE', resourceType: 'mandatoryReport', resourceId: record.id,
      patientId: patient.id, metadata: { reportType, jurisdictionState, status, fields: Object.keys(body ?? {}).filter((k) => k !== 'id' && k !== 'clientId').slice(0, 40) },
    });
    return NextResponse.json({ success: true, data: record });
  } catch (error: any) {
    console.error('[api/compliance/mandatory-reporting POST] error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
