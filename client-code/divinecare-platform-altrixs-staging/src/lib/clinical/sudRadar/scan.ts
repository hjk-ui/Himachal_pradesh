/**
 * SUD Referral Radar scan over real chart data, for one organization (or one caseload).
 *
 * Diagnosis path: F10–F19 codes in Client.primaryDiagnosisCode / secondaryDiagnoses and active
 * MedicalProblem rows (incl. DrFirst). Note path (clients with no non-F17 SUD code): signed /
 * locked ProgressNote bodies and filed Smart Document Intake extractedText from the last 12
 * months. Optional Bedrock confirmation of medium/low keyword hits. Findings are upserted into
 * SudRadarSignal by (client, source, fingerprint); signals not found again are resolved.
 *
 * The database and AI are injected so the scan can be tested with mocks.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { BEDROCK_MODELS, invokeBedrock, isBedrockConfigured } from '@/lib/ai/bedrockService';
import { stripLegacyMeta } from '@/lib/ehr/noteTemplates';
import { DIAGNOSIS_OPTIONS } from '@/lib/ehr/planLibrary';
import { buildDiagnosisFindings, extractSudCodes, hasNonNicotineSudCode, normalizeSudCode, type ChartedCode } from './codes';
import { buildNoteFinding, collectNoteHits, type NoteSource } from './notes';
import { confirmHitsWithAi, type AiInvoke } from './ai';
import { planReconcile } from './reconcile';
import { assignSudMeasures, type MeasureDb } from './assignMeasures';
import { SUD_MEASURE_KEYS } from './measures';
import type { Finding, RoutedAction } from './types';

export type SudRadarDb = Pick<
  PrismaClient,
  | 'client'
  | 'medicalProblem'
  | 'sudScreening'
  | 'clinicalAssessmentRecord'
  | 'progressNote'
  | 'documentIntake'
  | 'consentForm'
  | 'sudRadarSignal'
>;

export type ScanActor = { userId: string | null; role: string };

export type ScanCounts = {
  clientsScanned: number;
  notesScanned: number;
  documentsScanned: number;
  findings: number;
  bySource: Record<'diagnosis' | 'note-keyword', number>;
  byConfidence: Record<'high' | 'medium' | 'low', number>;
  byAction: Record<RoutedAction, number>;
  needsScreening: number;
  created: number;
  updated: number;
  reopened: number;
  resolved: number;
  ai: { enabled: boolean; clientsReviewed: number; snippetsReviewed: number; dropped: number; skippedConsent: number; failed: number };
  batches: number;
  /** Practice setting "Auto-assign substance-use measures": measures newly put on the MBC schedule */
  measures: { autoAssign: boolean; clients: number; assigned: number; skipped: number; failed: boolean };
};

/**
 * Same consent the AI scribe checks (AI_NOTE_CONSENT_TYPE in src/lib/ai/noteDraftSafety.ts —
 * not imported here because that module pulls in the note-format / billing code).
 */
export const AI_CONSENT_TYPE = 'AI Note Drafting';
export const SCAN_WINDOW_DAYS = 365;
export const DEFAULT_BATCH_SIZE = 200;
const SCREENING_INSTRUMENT = /audit|dast|cage|assist|crafft|nida|\bbam\b|taps|sbirt|tobacco.*alcohol/i;
const RESOLVED_PROBLEM = /resolved|inactive|entered\s+in\s+error|deleted|historical|ruled\s+out/i;

export const ACTION_ROUTE: Record<RoutedAction, { label: string; href: (clientId: string) => string }> = {
  'residential-referral': { label: 'Refer — residential/IOP', href: () => '/dashboard/residential' },
  sbirt: { label: 'Start SBIRT', href: (id) => `/dashboard/ehr/assessments/sud?clientId=${encodeURIComponent(id)}` },
  'chart-documentation': { label: 'Document diagnosis', href: (id) => `/dashboard/clients/${encodeURIComponent(id)}` },
  'tobacco-cessation': { label: 'Document cessation note', href: (id) => `/dashboard/ehr/notes?clientId=${encodeURIComponent(id)}` },
};

const CATALOG = new Map(DIAGNOSIS_OPTIONS.map((d) => [d.icd.toUpperCase(), d.dsm]));

function isoDate(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

function emptyCounts(aiEnabled: boolean): ScanCounts {
  return {
    clientsScanned: 0,
    notesScanned: 0,
    documentsScanned: 0,
    findings: 0,
    bySource: { diagnosis: 0, 'note-keyword': 0 },
    byConfidence: { high: 0, medium: 0, low: 0 },
    byAction: { 'residential-referral': 0, sbirt: 0, 'chart-documentation': 0, 'tobacco-cessation': 0 },
    needsScreening: 0,
    created: 0,
    updated: 0,
    reopened: 0,
    resolved: 0,
    ai: { enabled: aiEnabled, clientsReviewed: 0, snippetsReviewed: 0, dropped: 0, skippedConsent: 0, failed: 0 },
    batches: 0,
    measures: { autoAssign: false, clients: 0, assigned: 0, skipped: 0, failed: false },
  };
}

/** Description for a charted code: the chart's own text, else the diagnosis catalog, else none. */
function describe(code: string, charted: string | null | undefined): string | null {
  const text = charted?.trim();
  if (text && normalizeSudCode(text) !== code) return text;
  return CATALOG.get(code) ?? null;
}

type ClientRow = {
  id: string;
  name?: string | null;
  primaryDiagnosisCode: string | null;
  primaryDiagnosis: string | null;
  secondaryDiagnoses: string | null;
};

function chartedCodesFor(
  client: ClientRow,
  problems: { id: string; icd10Code: string; name: string; description: string | null; source: string | null; onsetDate: Date | null; createdAt: Date }[]
): ChartedCode[] {
  const chartHref = `/dashboard/clients/${encodeURIComponent(client.id)}`;
  const out: ChartedCode[] = [];
  const primaryCodes = extractSudCodes(client.primaryDiagnosisCode);
  for (const code of primaryCodes) {
    out.push({
      code,
      description: describe(code, primaryCodes.length === 1 ? client.primaryDiagnosis : null),
      sourceType: 'diagnosis',
      sourceId: client.id,
      sourceLabel: 'Chart diagnosis (primary)',
      date: null,
      href: chartHref,
    });
  }
  for (const code of extractSudCodes(client.secondaryDiagnoses)) {
    out.push({
      code,
      description: describe(code, null),
      sourceType: 'diagnosis',
      sourceId: client.id,
      sourceLabel: 'Chart diagnosis (secondary)',
      date: null,
      href: chartHref,
    });
  }
  for (const p of problems) {
    for (const code of extractSudCodes(p.icd10Code)) {
      out.push({
        code,
        description: describe(code, p.name || p.description),
        sourceType: 'problem-list',
        sourceId: p.id,
        sourceLabel: p.source === 'drfirst' ? 'Problem list (DrFirst)' : 'Problem list',
        date: isoDate(p.onsetDate ?? p.createdAt),
        href: chartHref,
      });
    }
  }
  return out;
}

export function defaultAiInvoke(): AiInvoke | null {
  if (!isBedrockConfigured()) return null;
  return ({ system, userPrompt }) =>
    invokeBedrock({ model: 'HAIKU', system, userPrompt, maxTokens: 800, temperature: 0, jsonMode: true, logContext: { feature: 'sud_radar' } });
}

export async function runSudRadarScan(opts: {
  organizationId: string;
  actor: ScanActor;
  /** Client scope (org filter; caseload filter for caseload roles) */
  clientWhere: Prisma.ClientWhereInput;
  db?: SudRadarDb;
  /** null disables AI; omitted uses Bedrock when configured */
  aiInvoke?: AiInvoke | null;
  now?: Date;
  batchSize?: number;
  /** Max clients sent to the AI per scan (cost / time bound) */
  aiMaxClients?: number;
  audit?: typeof writeAuditLog;
  trigger?: 'manual' | 'cron';
  /**
   * Practice setting "Auto-assign substance-use measures when a patient appears on the SUD Referral
   * Radar" (practiceSudRadarAutoAssign). When on, clients with an open (new / reviewed / referred)
   * non-tobacco signal get AUDIT, CAGE-AID, NIDA-Modified ASSIST and BAM on the MBC schedule;
   * measures already open are skipped. Only clients in this scan's scope (caseload for caseload roles).
   */
  autoAssignMeasures?: boolean;
  measureDb?: MeasureDb;
}): Promise<ScanCounts> {
  const db = opts.db ?? prisma;
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - SCAN_WINDOW_DAYS * 86_400_000);
  const batchSize = Math.max(1, opts.batchSize ?? DEFAULT_BATCH_SIZE);
  const aiInvoke = opts.aiInvoke === undefined ? defaultAiInvoke() : opts.aiInvoke;
  const aiMaxClients = opts.aiMaxClients ?? Number(process.env.SUD_RADAR_AI_MAX_CLIENTS || 100);
  const audit = opts.audit ?? writeAuditLog;
  const counts = emptyCounts(Boolean(aiInvoke));
  counts.measures.autoAssign = Boolean(opts.autoAssignMeasures);
  const clientNames = new Map<string, string>();
  const measureCandidates = new Set<string>();

  let cursor: string | undefined;
  for (;;) {
    const clients: ClientRow[] = await db.client.findMany({
      where: { AND: [opts.clientWhere, { status: { not: 'DISCHARGED' } }] },
      select: { id: true, name: true, primaryDiagnosisCode: true, primaryDiagnosis: true, secondaryDiagnoses: true },
      orderBy: { id: 'asc' },
      take: batchSize,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (!clients.length) break;
    cursor = clients[clients.length - 1].id;
    counts.batches += 1;
    counts.clientsScanned += clients.length;
    const ids = clients.map((c) => c.id);
    for (const c of clients) clientNames.set(c.id, c.name || 'Client');

    const [problems, sudScreens, assessments] = await Promise.all([
      db.medicalProblem.findMany({
        where: { clientId: { in: ids }, icd10Code: { startsWith: 'F1', mode: 'insensitive' }, resolvedDate: null },
        select: { id: true, clientId: true, icd10Code: true, name: true, description: true, status: true, source: true, onsetDate: true, createdAt: true },
      }),
      db.sudScreening.findMany({
        where: { clientId: { in: ids }, createdAt: { gte: since } },
        select: { clientId: true },
      }),
      db.clinicalAssessmentRecord.findMany({
        where: { clientId: { in: ids }, createdAt: { gte: since } },
        select: { clientId: true, instrumentId: true, instrumentName: true },
      }),
    ]);
    const screened = new Set<string>(sudScreens.map((s) => s.clientId));
    for (const a of assessments) {
      if (SCREENING_INSTRUMENT.test(`${a.instrumentId} ${a.instrumentName}`)) screened.add(a.clientId);
    }
    const problemsByClient = new Map<string, typeof problems>();
    for (const p of problems) {
      if (RESOLVED_PROBLEM.test(p.status || '')) continue;
      const list = problemsByClient.get(p.clientId) ?? [];
      list.push(p);
      problemsByClient.set(p.clientId, list);
    }

    const findings: Finding[] = [];
    const noteClients: string[] = [];
    for (const c of clients) {
      const charted = chartedCodesFor(c, problemsByClient.get(c.id) ?? []);
      if (charted.length) {
        findings.push(...buildDiagnosisFindings({ clientId: c.id, codes: charted, hasRecentScreening: screened.has(c.id) }));
      }
      if (!hasNonNicotineSudCode(charted.map((x) => x.code))) noteClients.push(c.id);
    }

    if (noteClients.length) {
      const [notes, docs] = await Promise.all([
        db.progressNote.findMany({
          where: {
            clientId: { in: noteClients },
            workflow: { status: { in: ['SIGNED', 'LOCKED'] } },
            OR: [{ dateOfService: { gte: since } }, { dateOfService: null, createdAt: { gte: since } }],
          },
          select: { id: true, clientId: true, body: true, noteType: true, dateOfService: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
        }),
        db.documentIntake.findMany({
          where: {
            suggestedClientId: { in: noteClients },
            status: 'filed',
            extractedText: { not: null },
            OR: [{ filedAt: { gte: since } }, { filedAt: null, createdAt: { gte: since } }],
          },
          select: { id: true, suggestedClientId: true, fileName: true, documentType: true, s3RawKey: true, filedAt: true, createdAt: true, extractedText: true },
          orderBy: { createdAt: 'desc' },
        }),
      ]);
      counts.notesScanned += notes.length;
      counts.documentsScanned += docs.length;
      const sourcesByClient = new Map<string, NoteSource[]>();
      const add = (clientId: string, s: NoteSource) => {
        const list = sourcesByClient.get(clientId) ?? [];
        list.push(s);
        sourcesByClient.set(clientId, list);
      };
      for (const n of notes) {
        add(n.clientId, {
          sourceType: 'progress-note',
          sourceId: n.id,
          sourceLabel: `Signed note${n.noteType ? ` (${n.noteType})` : ''}`,
          date: isoDate(n.dateOfService ?? n.createdAt),
          href: `/dashboard/ehr/notes?clientId=${encodeURIComponent(n.clientId)}`,
          text: stripLegacyMeta(n.body || ''),
        });
      }
      for (const d of docs) {
        if (!d.suggestedClientId) continue;
        const fileUrl = d.s3RawKey && d.s3RawKey !== 'pending' && d.fileName ? `/api/files/intake-docs/${d.s3RawKey}` : null;
        add(d.suggestedClientId, {
          sourceType: 'document',
          sourceId: d.id,
          sourceLabel: `${d.documentType || 'Document'}${d.fileName ? ` — ${d.fileName}` : ''}`,
          date: isoDate(d.filedAt ?? d.createdAt),
          href: fileUrl ?? `/dashboard/clients/${encodeURIComponent(d.suggestedClientId)}`,
          text: d.extractedText || '',
        });
      }

      // AI consent: a declined 'AI Note Drafting' consent keeps that client's text away from the model
      const declined = new Set<string>();
      if (aiInvoke) {
        const consents = await db.consentForm.findMany({
          where: { organizationId: opts.organizationId, clientId: { in: [...sourcesByClient.keys()] }, type: AI_CONSENT_TYPE },
          orderBy: [{ updatedAt: 'desc' }],
          select: { clientId: true, status: true },
        });
        const latest = new Map<string, string>();
        for (const c of consents) if (!latest.has(c.clientId)) latest.set(c.clientId, String(c.status));
        for (const [id, status] of latest) if (status === 'DECLINED') declined.add(id);
      }

      for (const [clientId, sources] of sourcesByClient) {
        let hits = collectNoteHits(sources);
        if (!hits.length) continue;
        const needsReview = hits.some((h) => h.confidence !== 'high');
        if (aiInvoke && needsReview) {
          if (declined.has(clientId)) {
            counts.ai.skippedConsent += 1;
          } else if (counts.ai.clientsReviewed + counts.ai.failed < aiMaxClients) {
            const result = await confirmHitsWithAi(hits, aiInvoke);
            await audit({
              action: 'AI_ACCESS',
              actorUserId: opts.actor.userId,
              actorRole: opts.actor.role,
              organizationId: opts.organizationId,
              resourceType: 'sudRadarSignal',
              resourceId: 'ai-confirm',
              patientId: clientId,
              outcome: result.ok ? 'SUCCESS' : 'FAILURE',
              metadata: {
                feature: 'sud-radar-confirm',
                model: BEDROCK_MODELS.HAIKU,
                snippetCount: result.ok ? result.reviewed : null,
                dropped: result.ok ? result.dropped : null,
                trigger: opts.trigger ?? 'manual',
              },
            });
            if (result.ok) {
              counts.ai.clientsReviewed += 1;
              counts.ai.snippetsReviewed += result.reviewed;
              counts.ai.dropped += result.dropped;
              hits = result.hits;
            } else {
              counts.ai.failed += 1;
            }
          }
        }
        const f = buildNoteFinding(clientId, hits);
        if (f) findings.push(f);
      }
    }

    await persistFindings(db, { organizationId: opts.organizationId, findings, scannedClientIds: ids, now, counts });
    if (opts.autoAssignMeasures) {
      // Tobacco (F17) alone is never an SUD measure trigger
      for (const f of findings) if (f.routedAction !== 'tobacco-cessation') measureCandidates.add(f.clientId);
    }
    if (clients.length < batchSize) break;
  }

  if (opts.autoAssignMeasures && measureCandidates.size) {
    try {
      // Only clients whose signal is still open (a dismissed signal does not assign measures)
      const open = await db.sudRadarSignal.findMany({
        where: {
          organizationId: opts.organizationId,
          clientId: { in: [...measureCandidates] },
          status: { in: ['new', 'reviewed', 'referred'] },
          // NULL routedAction (hand-saved signals) counts; only tobacco-only signals are excluded
          OR: [{ routedAction: null }, { routedAction: { not: 'tobacco-cessation' } }],
        },
        select: { clientId: true },
      });
      const ids = [...new Set(open.map((s) => s.clientId))];
      const plan = await assignSudMeasures({
        organizationId: opts.organizationId,
        actor: opts.actor,
        clients: ids.map((id) => ({ id, name: clientNames.get(id) ?? 'Client' })),
        measures: [...SUD_MEASURE_KEYS],
        trigger: 'auto',
        db: opts.measureDb,
        audit,
        now,
      });
      counts.measures.clients = new Set(plan.add.map((a) => a.patientId)).size;
      counts.measures.assigned = plan.add.length;
      counts.measures.skipped = plan.skipped.length;
    } catch (err) {
      // The scan result stands; the measures are assigned on the next scan
      console.error('[sud-radar] auto-assign measures failed', err instanceof Error ? err.message : 'unknown');
      counts.measures.failed = true;
    }
  }
  return counts;
}

function signalData(f: Finding, now: Date) {
  const route = ACTION_ROUTE[f.routedAction];
  return {
    detectedCondition: f.detectedCondition,
    quotedEvidence: f.evidence.map((e) => e.quote).join(' | ').slice(0, 5000),
    confidencePercent: f.confidencePercent,
    recommendation: f.recommendation,
    actionLabel: route.label,
    actionHref: route.href(f.clientId),
    substanceClasses: f.substanceClasses,
    codes: f.codes,
    evidence: f.evidence as unknown as Prisma.InputJsonValue,
    evidenceKeys: f.evidenceKeys,
    confidence: f.confidence,
    routedAction: f.routedAction,
    priority: f.priority,
    needsScreening: f.needsScreening,
    scannedAt: now,
    lastSeenAt: now,
  };
}

async function persistFindings(
  db: SudRadarDb,
  input: { organizationId: string; findings: Finding[]; scannedClientIds: string[]; now: Date; counts: ScanCounts }
) {
  const { findings, now, counts } = input;
  for (const f of findings) {
    counts.findings += 1;
    counts.bySource[f.detectionSource] += 1;
    counts.byConfidence[f.confidence] += 1;
    counts.byAction[f.routedAction] += 1;
    if (f.needsScreening) counts.needsScreening += 1;
  }
  const existing = await db.sudRadarSignal.findMany({
    where: { clientId: { in: input.scannedClientIds } },
    select: { id: true, clientId: true, detectionSource: true, fingerprint: true, status: true, evidence: true, evidenceKeys: true },
  });
  const plan = planReconcile({ existing, findings, scannedClientIds: input.scannedClientIds });

  for (const f of plan.creates) {
    try {
      await db.sudRadarSignal.create({
        data: {
          organizationId: input.organizationId,
          clientId: f.clientId,
          detectionSource: f.detectionSource,
          fingerprint: f.fingerprint,
          status: 'new',
          ...signalData(f, now),
        },
      });
      counts.created += 1;
    } catch (err) {
      // A concurrent scan created the same (client, source, fingerprint): keep that row
      if ((err as { code?: string })?.code !== 'P2002') throw err;
    }
  }
  for (const u of plan.updates) {
    await db.sudRadarSignal.update({
      where: { id: u.id },
      data: {
        organizationId: input.organizationId,
        ...signalData(u.finding, now),
        status: u.status,
        resolvedAt: null,
        ...(u.statusReason ? { statusReason: u.statusReason, statusChangedAt: now, statusChangedById: null } : {}),
      },
    });
    counts.updated += 1;
  }
  counts.reopened += plan.reopened;
  if (plan.resolves.length) {
    const res = await db.sudRadarSignal.updateMany({
      where: { id: { in: plan.resolves } },
      data: {
        status: 'resolved',
        resolvedAt: now,
        statusChangedAt: now,
        statusChangedById: null,
        statusReason: 'Evidence no longer found in the chart',
      },
    });
    counts.resolved += res.count;
  }
}
