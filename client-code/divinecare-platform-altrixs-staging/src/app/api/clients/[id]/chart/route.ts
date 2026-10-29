import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { resolveChartAccess } from '@/lib/clients/chartAccess';
import { activeAuthSummaries, summarizeAuth } from '@/lib/clients/chartBanner';
import { dischargeCasesForClient, diagnosisRecordsForClient, safetyPlansForClient } from '@/lib/clients/chartSections';
import { canUseClinicModule } from '@/lib/modules/access';
import { getModuleData } from '@/lib/modules/manage';
import { CHART_SECTIONS, canSeeBhDiagnoses, sectionAllowed, type ChartSectionKey as Section } from '@/lib/clients/chartSectionAccess';
import { medicalHistoryView, problemNeedsCoding, vitalRowView } from '@/lib/medical/chartMedical';
import type { StaffRole } from '@/types/roles';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';



const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

type Client = NonNullable<Extract<Awaited<ReturnType<typeof resolveChartAccess>>, { ok: true }>['client']>;
type Ctx = { organizationId: string; userId: string; role: string; client: Client };

async function load(section: Section, ctx: Ctx): Promise<Record<string, unknown>> {
  const { organizationId, client } = ctx;
  const now = new Date();
  switch (section) {
    case 'diagnoses': {
      // Problems-only viewers (medical problem-list rule) never get BH diagnoses / plan codes
      const bh = canSeeBhDiagnoses(ctx.role);
      const [problems, plans, moduleData] = await Promise.all([
        prisma.medicalProblem.findMany({
          where: { clientId: client.id },
          select: { id: true, icd10Code: true, name: true, status: true, category: true, isChronic: true, onsetDate: true, resolvedDate: true, source: true, updatedAt: true },
          orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
        }),
        bh
          ? prisma.treatmentPlan.findMany({
              where: { organizationId, clientId: client.id },
              select: { id: true, title: true, status: true, diagnosisCodes: true, updatedAt: true },
              orderBy: { updatedAt: 'desc' },
            })
          : Promise.resolve([]),
        bh && canUseClinicModule(ctx.role as StaffRole, 'diagnoses') ? getModuleData<unknown>(organizationId, 'diagnoses') : Promise.resolve(null),
      ]);
      if (!bh) {
        return {
          problemsOnly: true,
          chart: null,
          problems: problems.map((p) => ({ ...p, needsCoding: problemNeedsCoding(p.icd10Code), onsetDate: day(p.onsetDate), resolvedDate: day(p.resolvedDate), updatedAt: iso(p.updatedAt) })),
          planDiagnoses: [],
          practiceListEntries: null,
        };
      }
      return {
        problemsOnly: false,
        chart: {
          primaryDiagnosisCode: client.primaryDiagnosisCode,
          primaryDiagnosis: client.primaryDiagnosis,
          secondaryDiagnoses: client.secondaryDiagnoses,
        },
        problems: problems.map((p) => ({ ...p, needsCoding: problemNeedsCoding(p.icd10Code), onsetDate: day(p.onsetDate), resolvedDate: day(p.resolvedDate), updatedAt: iso(p.updatedAt) })),
        planDiagnoses: plans.filter((p) => p.diagnosisCodes.length).map((p) => ({ ...p, updatedAt: iso(p.updatedAt) })),
        // Rows the old diagnoses page auto-derived from this record (ids "dx-<clientId>-…") repeated the chart
        // diagnoses with guessed severity / onset: only hand-entered practice-list rows are returned.
        practiceListEntries:
          moduleData == null
            ? null
            : diagnosisRecordsForClient(moduleData, client).filter((r) => !String((r as { id?: unknown }).id ?? '').startsWith('dx-')),
      };
    }
    case 'labs': {
      const orders = await prisma.labOrder.findMany({
        where: { organizationId, clientId: client.id },
        select: {
          id: true, lab: true, priority: true, status: true, panels: true, otherPanel: true, icd10Codes: true,
          orderedByName: true, orderedAt: true, collectedAt: true, resultedAt: true,
          results: { select: { id: true, testName: true, value: true, unit: true, refRange: true, flag: true } },
        },
        orderBy: { orderedAt: 'desc' },
        take: 100,
      });
      return { orders: orders.map((o) => ({ ...o, orderedAt: iso(o.orderedAt), collectedAt: iso(o.collectedAt), resultedAt: iso(o.resultedAt) })) };
    }
    case 'safety': {
      const plansAllowed = canUseClinicModule(ctx.role as StaffRole, 'ehr-safety-plans');
      const [alerts, cssrs, moduleData] = await Promise.all([
        prisma.riskAlert.findMany({
          where: { clientId: client.id, OR: [{ organizationId }, { organizationId: null }] },
          select: { id: true, type: true, severity: true, description: true, source: true, reviewed: true, reviewNote: true, reviewedAt: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 100,
        }),
        prisma.clinicalAssessmentRecord.findMany({
          where: { organizationId, clientId: client.id, instrumentId: { startsWith: 'c-ssrs' } },
          select: { id: true, instrumentName: true, totalScore: true, severity: true, safetyFlagged: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 20,
        }),
        plansAllowed ? getModuleData<unknown>(organizationId, 'ehr-safety-plans') : Promise.resolve(null),
      ]);
      const plans = plansAllowed ? safetyPlansForClient(moduleData, client) : null;
      return {
        alerts: alerts.map((a) => ({ ...a, reviewedAt: iso(a.reviewedAt), createdAt: iso(a.createdAt) })),
        cssrs: cssrs.map((c) => ({ ...c, createdAt: iso(c.createdAt) })),
        safetyPlans: plans ? plans.matched : null,
        unlinkedSafetyPlans: plans ? plans.unlinkedCount : null,
      };
    }
    case 'authorizations': {
      const rows = await prisma.priorAuth.findMany({
        where: { organizationId, clientId: client.id },
        select: { id: true, payer: true, authNumber: true, cptCodes: true, unitsApproved: true, unitsUsed: true, status: true, startDate: true, endDate: true, notes: true, updatedAt: true },
        orderBy: [{ endDate: 'desc' }, { updatedAt: 'desc' }],
      });
      const activeIds = new Set(activeAuthSummaries(rows, now).map((a) => a.id));
      return {
        authorizations: rows.map((r) => ({ ...summarizeAuth(r, now), status: r.status, notes: r.notes, active: activeIds.has(r.id) })),
      };
    }
    case 'eligibility': {
      const checks = await prisma.eligibilityCheck.findMany({
        where: { organizationId, clientId: client.id },
        select: { id: true, payerName: true, memberId: true, dos: true, status: true, checkedAt: true, checkedBy: { select: { name: true } } },
        orderBy: { checkedAt: 'desc' },
        take: 25,
      });
      return {
        checks: checks.map((c) => ({
          id: c.id,
          payerName: c.payerName,
          memberIdLast4: c.memberId ? c.memberId.slice(-4) : null,
          dos: day(c.dos),
          status: c.status,
          checkedAt: iso(c.checkedAt),
          checkedBy: c.checkedBy?.name ?? null,
        })),
      };
    }
    case 'care-team': {
      const [team, prpReferrals] = await Promise.all([
        prisma.clientTreatmentTeamMember.findMany({
          where: { clientId: client.id },
          select: { id: true, name: true, role: true, credentials: true, isPrimary: true, createdAt: true },
          orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
        }),
        prisma.prpReferral.findMany({
          where: { organizationId, clientId: client.id },
          select: { id: true, displayId: true, diagnosisCode: true, prescriberName: true, referralDate: true, recommendedDomains: true },
          orderBy: { referralDate: 'desc' },
        }),
      ]);
      return {
        team: team.map((t) => ({ ...t, createdAt: iso(t.createdAt) })),
        prpReferrals: prpReferrals.map((r) => ({ ...r, referralDate: iso(r.referralDate) })),
      };
    }
    case 'messages': {
      const threads = await prisma.messageThread.findMany({
        where: { organizationId, clientId: client.id },
        select: { id: true, topic: true, status: true, risk: true, assignedStaff: true, lastMessageAt: true, unreadCount: true },
        orderBy: { lastMessageAt: 'desc' },
        take: 50,
      });
      return { threads: threads.map((t) => ({ ...t, lastMessageAt: iso(t.lastMessageAt) })) };
    }
    case 'programs': {
      const [prp, tms, spravato] = await Promise.all([
        prisma.prpEnrollment.findMany({
          where: { organizationId, clientId: client.id },
          select: { id: true, displayId: true, status: true, diagnosisCode: true, startDate: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.tmsCourse.findMany({
          where: { organizationId, clientId: client.id },
          select: { id: true, status: true, targetSessions: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.spravatoEnrollment.findMany({
          where: { organizationId, clientId: client.id },
          select: { id: true, phase: true, doseCount: true, enrolledAt: true },
          orderBy: { enrolledAt: 'desc' },
        }),
      ]);
      return {
        prp: prp.map((p) => ({ ...p, startDate: day(p.startDate), createdAt: iso(p.createdAt) })),
        tms: tms.map((t) => ({ ...t, createdAt: iso(t.createdAt) })),
        spravato: spravato.map((s) => ({ ...s, enrolledAt: day(s.enrolledAt) })),
      };
    }
    case 'discharge': {
      const allowed = canUseClinicModule(ctx.role as StaffRole, 'ehr-discharge-cases');
      const data = allowed ? await getModuleData<unknown>(organizationId, 'ehr-discharge-cases') : null;
      return {
        clientStatus: client.status,
        cases: allowed ? dischargeCasesForClient(data, client) : null,
      };
    }
    case 'medical-visits': {
      const visits = await prisma.medicalVisit.findMany({
        where: { clientId: client.id },
        select: {
          id: true, visitDate: true, visitType: true, chiefComplaint: true, providerName: true, status: true, signedAt: true,
          subjective: true, objective: true, assessment: true, plan: true, cptCode: true, cptModifiers: true, icd10Codes: true,
        },
        orderBy: { visitDate: 'desc' },
        take: 100,
      });
      return { visits: visits.map((v) => ({ ...v, visitDate: iso(v.visitDate), signedAt: iso(v.signedAt) })) };
    }
    case 'medical-vitals': {
      const vitals = await prisma.medicalVital.findMany({
        where: { clientId: client.id },
        select: {
          id: true, recordedAt: true, systolic: true, bpSystolic: true, diastolic: true, bpDiastolic: true, heartRate: true,
          respiratoryRate: true, respRate: true, temperature: true, spO2: true, o2Sat: true, weightLbs: true, heightInches: true,
          bmi: true, recordedBy: { select: { name: true } },
        },
        orderBy: { recordedAt: 'desc' },
        take: 100,
      });
      return { vitals: vitals.map(vitalRowView) };
    }
    case 'medical-history': {
      const [allergies, problems] = await Promise.all([
        prisma.medicalAllergy.findMany({
          where: { clientId: client.id },
          select: { id: true, allergen: true, reaction: true, severity: true, status: true, source: true, createdAt: true, allergenType: true, rxnormId: true, rxnormName: true },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.medicalProblem.findMany({
          where: { clientId: client.id },
          select: { id: true, icd10Code: true, name: true, status: true, isChronic: true, onsetDate: true, resolvedDate: true, source: true },
          orderBy: { updatedAt: 'desc' },
        }),
      ]);
      return medicalHistoryView({ allergies, problems });
    }
    case 'access-log': {
      const [events, sensitive] = await Promise.all([
        prisma.auditLog.findMany({
          where: { organizationId, patientId: client.id },
          select: { id: true, actorUserId: true, actorRole: true, action: true, resourceType: true, outcome: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 200,
        }),
        prisma.sensitiveAccessLog.findMany({
          where: { organizationId, clientId: client.id },
          select: { id: true, userId: true, accessType: true, path: true, timestamp: true },
          orderBy: { timestamp: 'desc' },
          take: 100,
        }),
      ]);
      const userIds = [...new Set([...events.map((e) => e.actorUserId), ...sensitive.map((s) => s.userId)].filter((v): v is string => Boolean(v)))];
      const users = userIds.length
        ? await prisma.user.findMany({ where: { id: { in: userIds }, organizationId }, select: { id: true, name: true } })
        : [];
      const names = new Map(users.map((u) => [u.id, u.name]));
      return {
        events: events.map((e) => ({ ...e, actorName: e.actorUserId ? names.get(e.actorUserId) ?? null : null, createdAt: iso(e.createdAt) })),
        sensitiveAccess: sensitive.map((s) => ({ ...s, userName: names.get(s.userId) ?? null, timestamp: iso(s.timestamp) })),
      };
    }
  }
}

/**
 * GET /api/clients/[id]/chart?section=… — one client-chart tab's data, scoped to this client.
 * Same org / roster / caseload / protected-record gate as the chart; each section also needs
 * the role rule of its practice-wide page.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  const { id } = await ctx.params;
  const section = new URL(req.url).searchParams.get('section') as Section | null;
  if (!section || !(CHART_SECTIONS as readonly string[]).includes(section)) {
    return NextResponse.json({ success: false, error: 'Unknown chart section' }, { status: 400 });
  }
  const resourceType = `chart:${section}`;
  try {
    const access = await resolveChartAccess(
      { organizationId: gate.organizationId, userId: gate.userId, role: gate.role },
      id,
      `/api/clients/${id}/chart?section=${section}`
    );
    if (access.ok === false) {
      await auditPhiAccess({ gate, req, action: 'READ', resourceType, resourceId: id, patientId: id, outcome: 'DENIED', metadata: { reason: access.reason } });
      if (access.reason === 'sensitive_record') {
        return NextResponse.json({ error: 'SENSITIVE_RECORD', canRequestBreakGlass: true }, { status: 403 });
      }
      return NextResponse.json({ success: false, error: access.status === 404 ? 'Client not found' : 'Forbidden' }, { status: access.status });
    }
    if (!sectionAllowed(section, gate.role)) {
      await auditPhiAccess({ gate, req, action: 'READ', resourceType, resourceId: id, patientId: id, outcome: 'DENIED', metadata: { reason: 'role_not_permitted' } });
      return NextResponse.json({ success: false, error: 'Your role cannot view this section' }, { status: 403 });
    }
    const data = await load(section, { organizationId: gate.organizationId, userId: gate.userId, role: gate.role, client: access.client });
    await auditPhiAccess({ gate, req, action: 'READ', resourceType, resourceId: id, patientId: id });
    return NextResponse.json({ success: true, section, ...data }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    console.error('[api/clients/[id]/chart GET]', section, err);
    return NextResponse.json({ success: false, error: 'Could not load this chart section' }, { status: 500 });
  }
}
