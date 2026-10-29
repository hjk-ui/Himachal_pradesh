/**
 * Real dependencies for the pre-visit brief (prisma + Bedrock + audit). Server only.
 * Reads are scoped to the viewer's org and to a client that already passed resolveChartAccess.
 * Note bodies are read here only to cut out short section extracts (enrich.ts); they never leave
 * the server except as those extracts. Psychotherapy notes are a separate table and never read.
 * All chart reads run in one batched Promise.all (plus the digest lookups).
 */
import type { Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { resolveChartAccess, prismaChartBannerSource } from '@/lib/clients/chartAccess';
import { checkAiNoteConsent } from '@/lib/ai/noteDraftSafety';
import { BEDROCK_MODELS, invokeBedrock, isBedrockConfigured } from '@/lib/ai/bedrockService';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { getPracticeTimeZone } from '@/lib/time/practiceTimeServer';
import type { PreVisitInputs, RawDocumentLab, RawNoteDocument } from '@/lib/ai/previsit/facts';
import { PREVISIT_RESOURCE, type PreVisitDeps } from '@/lib/ai/previsit/service';
import { digestForBrief, latestChartDigest } from '@/lib/ai/chartDigest/store';
import { canGenerateChartDigest, canViewChartDigest } from '@/lib/ai/chartDigest/access';
import { classifyChartDocument, isSudProgramDocument } from '@/lib/ai/chartDigest/classify';
import { parseMedicalDigestJson } from '@/lib/ai/chartDigest/medical/service';
import { isNightlyPrepEnabled } from '@/lib/ai/chartDigest/emptyState';
import { chartDocumentFilter } from '@/lib/docIntake/chartDocumentAccess';
import { isPart2Classification } from '@/lib/fhir/mapping/privacy';
import { DEFAULT_NOTE_DUE_HOURS } from '@/lib/notes/standard';

const DAY_MS = 86_400_000;
const LOOKBACK_DAYS = 180;
/** Visits by type (last therapy / med management / primary care) look back further */
const VISIT_LOOKBACK_DAYS = 400;
const LAB_LOOKBACK_DAYS = 730;
const UPCOMING_DAYS = 60;
const INSTRUMENT_KEYS = ['phq-9', 'gad-7', 'c-ssrs', 'c-ssrs-brief', 'c-ssrs-screener', 'cssrs', 'pcl-5', 'audit', 'audit-c', 'dast-10', 'mdq'];
const NOTE_DOC_RE = /progress|session|medication management|med management|psychiatric|follow[- ]?up|therapy note/i;

type HeaderSource = Request | Headers | { headers: Headers } | null | undefined;

function fieldValue(fields: unknown, label: string): string | null {
  if (!Array.isArray(fields)) return null;
  const f = (fields as Array<{ label?: unknown; value?: unknown }>).find((x) => x && x.label === label);
  return typeof f?.value === 'string' ? f.value : null;
}

type DigestLabItem = { text: string; date: string | null; part2?: boolean; cites: Array<{ source: string; date: string }> };

export function prismaPreVisitDeps(input: {
  gate: { organizationId: string; userId: string; role: string };
  req?: HeaderSource;
  path: string;
}): PreVisitDeps {
  const banner = prismaChartBannerSource(input.path);
  return {
    async resolveAccess(viewer, clientId) {
      const d = await resolveChartAccess(viewer, clientId, input.path);
      if (d.ok === false) return { ok: false, status: d.status, reason: d.reason };
      const c = d.client;
      return {
        ok: true,
        sensitive: d.sensitive === 'allowed' ? 'allowed' : 'none',
        names: [c.name, c.legalFirstName, c.legalLastName].filter((n): n is string => Boolean(n)),
      };
    },

    async loadInputs(viewer, clientId, { now, audience, names, bhChartNotes = true }): Promise<PreVisitInputs> {
      const org = viewer.organizationId;
      const since = new Date(now.getTime() - LOOKBACK_DAYS * DAY_MS);
      const visitSince = new Date(now.getTime() - VISIT_LOOKBACK_DAYS * DAY_MS);
      // Labs, DrFirst items and the medical digest: prescribers and primary care (not therapists)
      const labsAudience = audience === 'prescriber' || audience === 'primary_care';
      const noteDeadline = new Date(now.getTime() - DEFAULT_NOTE_DUE_HOURS * 3_600_000);
      const unsigned = [{ workflow: { is: null } }, { workflow: { is: { status: 'DRAFT' as const } } }];
      // Primary care roles: BH note bodies and treatment-plan goals are not loaded at all (minimum necessary)
      const [
        client,
        appointments,
        upcomingAppointments,
        medications,
        problems,
        riskAlerts,
        crisisEpisodes,
        assessments,
        measurements,
        plans,
        sessionFrequency,
        draftNoteCount,
        overdueNoteCount,
        pendingConsentCount,
        sdohReferrals,
        standingLabs,
        labResultsAwaitingReview,
        recentNotes,
        diagnoses,
        medicalVisits,
        labOrders,
        filed,
        careTeam,
        measureAssignments,
        referrals,
        drFirstPendingCount,
        sensitive,
        part2Note,
      ] = await Promise.all([
        prisma.client.findFirst({ where: { id: clientId, organizationId: org }, select: { riskLevel: true } }),
        prisma.appointment.findMany({
          where: { clientId, startsAt: { gte: visitSince, lte: now } },
          select: { id: true, startsAt: true, type: true, status: true, notes: true, source: true, clinicianName: true, clinician: { select: { role: true } } },
          orderBy: { startsAt: 'desc' },
          take: 200,
        }),
        prisma.appointment.findMany({
          where: { clientId, startsAt: { gt: now, lte: new Date(now.getTime() + UPCOMING_DAYS * DAY_MS) }, status: { in: ['SCHEDULED', 'CHECKED_IN'] } },
          select: { id: true, startsAt: true, type: true, status: true, notes: true, source: true, clinicianName: true, clinician: { select: { role: true, name: true } } },
          orderBy: { startsAt: 'asc' },
          take: 5,
        }),
        prisma.clientMedication.findMany({
          where: { clientId, OR: [{ active: true }, { updatedAt: { gte: since } }] },
          select: {
            id: true,
            medicationName: true,
            drugName: true,
            dosage: true,
            dosageText: true,
            route: true,
            frequency: true,
            instructions: true,
            asNeeded: true,
            isAntipsychotic: true,
            startDate: true,
            createdAt: true,
            stopDate: true,
            endDate: true,
            active: true,
            status: true,
            rcopiaMedId: true,
          },
          orderBy: { updatedAt: 'desc' },
          take: 100,
        }),
        prisma.medicalProblem.findMany({
          where: { clientId, createdAt: { gte: since } },
          select: { id: true, name: true, icd10Code: true, status: true, createdAt: true, source: true },
          orderBy: { createdAt: 'desc' },
          take: 30,
        }),
        banner.riskAlerts(org, clientId),
        prisma.crisisEpisode.findMany({
          where: { clientId, organizationId: org, startedAt: { gte: since } },
          select: { id: true, startedAt: true, status: true, priority: true },
          orderBy: { startedAt: 'desc' },
          take: 10,
        }),
        prisma.clinicalAssessmentRecord.findMany({
          where: { organizationId: org, clientId },
          select: { id: true, instrumentId: true, instrumentName: true, totalScore: true, severity: true, safetyFlagged: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 60,
        }),
        prisma.measurementResult.findMany({
          where: { organizationId: org, clientId, measurementType: { instrumentKey: { in: INSTRUMENT_KEYS }, isSubscore: false } },
          select: { id: true, valueNumeric: true, measuredAt: true, measurementType: { select: { instrumentKey: true } } },
          orderBy: { measuredAt: 'desc' },
          take: 40,
        }),
        prisma.treatmentPlan.findMany({
          where: { organizationId: org, clientId, status: { in: ['ACTIVE', 'NEEDS_REVIEW', 'DRAFT'] } },
          select: { id: true, status: true, reviewDueAt: true, goals: bhChartNotes },
          orderBy: { updatedAt: 'desc' },
          take: 5,
        }),
        banner.sessionFrequency({ organizationId: org, userId: viewer.userId, role: viewer.role as Role }, clientId).catch(() => null),
        // Unsigned = no workflow row yet (drafts only get one when signed) or a DRAFT row
        prisma.progressNote.count({ where: { clientId, client: { organizationId: org }, dismissedAt: null, OR: unsigned } }),
        // ...and past the documentation deadline (72 h after the date of service)
        prisma.progressNote.count({ where: { clientId, client: { organizationId: org }, dismissedAt: null, dateOfService: { lt: noteDeadline }, OR: unsigned } }),
        prisma.consentForm.count({ where: { organizationId: org, clientId, status: 'PENDING' } }),
        prisma.sdohReferral.findMany({
          where: { organizationId: org, clientId, status: { in: ['open', 'connected'] } },
          select: { id: true, domain: true, status: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 10,
        }),
        labsAudience
          ? prisma.labStandingOrder.findMany({
              where: { organizationId: org, clientId, active: true },
              select: { id: true, tests: true, nextDueAt: true, active: true, endDate: true },
              take: 20,
            })
          : Promise.resolve([]),
        labsAudience
          ? prisma.labOrder.count({ where: { organizationId: org, clientId, status: { in: ['resulted', 'critical'] }, reviewedAt: null } })
          : Promise.resolve(0),
        bhChartNotes
          ? prisma.progressNote.findMany({
              where: { clientId, dismissedAt: null, workflow: { status: { in: ['SIGNED', 'LOCKED'] } } },
              select: { id: true, noteType: true, body: true, dateOfService: true, createdAt: true, part2: true, cptCode: true, clinician: { select: { role: true } } },
              orderBy: { createdAt: 'desc' },
              take: 15,
            })
          : Promise.resolve([]),
        prisma.clientDiagnosis.findMany({
          where: { organizationId: org, clientId, status: { in: ['ACTIVE', 'PROVISIONAL'] } },
          select: { id: true, code: true, description: true, dsmName: true, rank: true, isPrimary: true, status: true, createdAt: true, source: true },
          orderBy: [{ isPrimary: 'desc' }, { rank: 'asc' }],
          take: 30,
        }),
        // Signed primary-care visits: dates for everyone; assessment / plan text only for prescribers and primary care
        prisma.medicalVisit.findMany({
          where: { clientId, signedAt: { not: null }, visitDate: { gte: visitSince } },
          select: { id: true, visitDate: true, visitType: true, providerName: true, signedAt: true, assessment: labsAudience, plan: labsAudience },
          orderBy: { visitDate: 'desc' },
          take: 10,
        }),
        labsAudience
          ? prisma.labOrder.findMany({
              where: { organizationId: org, clientId, orderedAt: { gte: new Date(now.getTime() - LAB_LOOKBACK_DAYS * DAY_MS) } },
              select: {
                id: true,
                status: true,
                orderedAt: true,
                collectedAt: true,
                resultedAt: true,
                panels: true,
                results: { select: { id: true, testName: true, testKey: true, value: true, unit: true, refRange: true, flag: true, collectedAt: true, createdAt: true } },
              },
              orderBy: { orderedAt: 'desc' },
              take: 40,
            })
          : Promise.resolve([]),
        // Filed chart documents (type labels; imported note documents for the "not summarized yet" list)
        prisma.documentIntake.findMany({
          where: { suggestedClientId: clientId, suggestedClient: { organizationId: org }, status: 'filed', voidedAt: null },
          select: { id: true, documentType: true, fileName: true, sourcePath: true, extractedFields: true, s3RawKey: true, filedAt: true, createdAt: true },
          orderBy: { filedAt: 'desc' },
          take: 40,
        }),
        banner.careTeam ? banner.careTeam(org, clientId).catch(() => null) : Promise.resolve(null),
        bhChartNotes
          ? prisma.measureAssignment.findMany({
              where: { organizationId: org, clientId, status: 'active' },
              select: { instrumentId: true, schedule: true, everyDays: true, startDate: true, endDate: true, status: true },
              take: 20,
            })
          : Promise.resolve([]),
        prisma.medicalReferral.findMany({
          where: { organizationId: org, clientId },
          select: { kind: true, status: true, sentAt: true },
          orderBy: { sentAt: 'desc' },
          take: 10,
        }),
        labsAudience ? prisma.rcopiaRxchangeRequest.count({ where: { clientId, status: 'pending' } }) : Promise.resolve(0),
        prisma.sensitiveRecord.findFirst({ where: { organizationId: org, clientId }, select: { noteClassification: true } }),
        prisma.progressNote.findFirst({ where: { clientId, part2: true, client: { organizationId: org } }, select: { id: true } }),
      ]);
      // Chart history digest (cited, Part 2 facts removed); BH chart-note readers only. Never blocks the brief.
      const chartDigest = bhChartNotes ? await digestForBrief(org, clientId).catch(() => null) : null;
      const medicalDigest = labsAudience && canViewChartDigest(viewer.role, 'medical') ? await latestChartDigest(org, clientId, 'medical').catch(() => null) : null;
      const rank = (s: string) => (s === 'ACTIVE' ? 0 : s === 'NEEDS_REVIEW' ? 1 : 2);
      const plan = [...plans].sort((a, b) => rank(a.status) - rank(b.status))[0] ?? null;

      // Imported documents of a Part 2 client cannot be told apart by program: none are listed
      const part2Client = isPart2Classification(sensitive?.noteClassification) || Boolean(part2Note);
      const docs = part2Client
        ? []
        : filed.filter((d) => {
            const meta = { documentType: d.documentType, fileName: d.fileName, sourcePath: d.sourcePath, title: fieldValue(d.extractedFields, 'Title'), folder: fieldValue(d.extractedFields, 'Valant folder') };
            return classifyChartDocument(meta).include && !isSudProgramDocument(meta);
          });
      const noteDocuments: RawNoteDocument[] = [];
      if (bhChartNotes && !chartDigest) {
        const filter = chartDocumentFilter(viewer, clientId);
        for (const d of docs) {
          const title = fieldValue(d.extractedFields, 'Title');
          if (!NOTE_DOC_RE.test(`${d.documentType} ${title ?? ''} ${d.fileName ?? ''}`)) continue;
          const docDate = fieldValue(d.extractedFields, 'Document date');
          const ok = Boolean(d.s3RawKey && d.s3RawKey !== 'pending' && (await filter.canView(d.documentType)));
          noteDocuments.push({
            id: d.id,
            date: docDate && /^\d{4}-\d{2}-\d{2}$/.test(docDate) ? new Date(`${docDate}T12:00:00Z`) : d.filedAt ?? d.createdAt,
            label: String(d.documentType || 'Progress Note'),
            href: ok ? `/api/files/intake-docs/${encodeURIComponent(d.s3RawKey)}` : null,
          });
          if (noteDocuments.length >= 3) break;
        }
      }

      // Lab facts the medical chart history cited from documents (used only without structured results)
      const documentLabs: RawDocumentLab[] = [];
      const mj = medicalDigest && medicalDigest.status !== 'failed' ? parseMedicalDigestJson(medicalDigest.digestJson) : null;
      if (mj) {
        const items = ((mj.digest as unknown as { labs?: DigestLabItem[] }).labs ?? []).filter((i) => !i.part2 && i.cites.some((c) => c.source.startsWith('doc:')));
        const sources = mj.digest.sources as Record<string, { label?: string; date?: string }>;
        for (const i of items.slice(-6)) {
          const cite = i.cites.find((c) => c.source.startsWith('doc:'))!;
          const src = sources[cite.source];
          documentLabs.push({ text: i.text, date: i.date, source: `${src?.label ?? 'Document'} ${src?.date ?? cite.date}` });
        }
      }

      const team = careTeam
        ? { primary: careTeam.primary ? { name: careTeam.primary.name, label: careTeam.primary.label } : null, members: careTeam.allMembers.map((m) => ({ name: m.name, label: m.label })) }
        : null;
      const role = (r: { role?: unknown } | null | undefined) => (r?.role ? String(r.role) : null);

      return {
        client: { riskLevel: client?.riskLevel ?? 'LOW', names },
        appointments: appointments.map((a) => ({ id: a.id, startsAt: a.startsAt, type: a.type, status: String(a.status), notes: a.notes, source: a.source, clinicianName: a.clinicianName, clinicianRole: role(a.clinician) })),
        upcomingAppointments: upcomingAppointments.map((a) => ({
          id: a.id,
          startsAt: a.startsAt,
          type: a.type,
          status: String(a.status),
          notes: a.notes,
          source: a.source,
          clinicianName: a.clinicianName ?? a.clinician?.name ?? null,
          clinicianRole: role(a.clinician),
        })),
        medications,
        problems,
        riskAlerts: riskAlerts.map((a) => ({ ...a, severity: String(a.severity) })),
        crisisEpisodes,
        assessments,
        measurements: measurements.map((m) => ({ id: m.id, valueNumeric: m.valueNumeric, measuredAt: m.measuredAt, instrumentKey: m.measurementType.instrumentKey })),
        treatmentPlan: plan ? { id: plan.id, status: String(plan.status), reviewDueAt: plan.reviewDueAt, goals: bhChartNotes ? plan.goals : null } : null,
        sessionFrequency,
        draftNoteCount,
        overdueNoteCount,
        pendingConsentCount,
        sdohReferrals,
        standingLabs,
        labResultsAwaitingReview,
        recentNotes: recentNotes.map((n) => ({ id: n.id, noteType: n.noteType, body: n.body, dateOfService: n.dateOfService, createdAt: n.createdAt, part2: n.part2, cptCode: n.cptCode, authorRole: role(n.clinician) })),
        chartDigest,
        diagnoses,
        medicalVisits,
        labOrders: labOrders.map((o) => ({ ...o, status: String(o.status) })),
        documentLabs,
        noteDocuments,
        filedDocuments: docs.filter((d) => d.filedAt).map((d) => ({ id: d.id, label: String(d.documentType || 'Document'), filedAt: d.filedAt! })),
        careTeam: team,
        measureAssignments,
        referrals,
        drFirstPendingCount,
        nightlyPrepEnabled: isNightlyPrepEnabled(),
        canGenerateDigest: canGenerateChartDigest(viewer.role),
      };
    },

    async aiConsent(organizationId, clientId) {
      return (await checkAiNoteConsent(organizationId, clientId)).status;
    },
    practiceTimeZone: (organizationId) => getPracticeTimeZone(organizationId),
    bedrockConfigured: () => isBedrockConfigured(),
    invokeModel: ({ system, userPrompt }) => invokeBedrock({ model: 'HAIKU', system, userPrompt, maxTokens: 1000, temperature: 0.1, jsonMode: true, logContext: { feature: 'previsit_brief' } }),
    modelId: BEDROCK_MODELS.HAIKU,
    async audit(e) {
      await auditPhiAccess({
        gate: input.gate,
        req: input.req,
        action: e.action,
        resourceType: PREVISIT_RESOURCE,
        resourceId: e.clientId,
        patientId: e.clientId,
        outcome: e.outcome,
        metadata: e.metadata,
      });
    },
  };
}
