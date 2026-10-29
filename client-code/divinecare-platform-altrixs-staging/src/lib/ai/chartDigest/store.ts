/**
 * Real dependencies for the chart history digest (prisma + local file store + Textract + Bedrock +
 * audit). Server only. Reads are scoped to the organization and the client; document bytes are
 * read from the private upload store and only ever sent to Textract / Bedrock (AWS BAA).
 */
import { randomBytes } from 'crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { hasCareTeamLink, resolveChartAccess } from '@/lib/clients/chartAccess';
import { checkAiNoteConsent } from '@/lib/ai/noteDraftSafety';
import { BEDROCK_MODELS, invokeBedrock, isBedrockConfigured } from '@/lib/ai/bedrockService';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { isPart2Classification } from '@/lib/fhir/mapping/privacy';
import { readIntakeFile } from '@/lib/docIntake/process';
import { extractPdfPages } from '@/lib/docIntake/pdfPages';
import { isPdfOcrConfigured, ocrImage, pollPdfOcr, startPdfOcr } from '@/lib/docIntake/ocr';
import { part2ConsentCoversTreatment } from '@/lib/ai/chartDigest/classify';
import { extractDocumentText, type ExtractDeps } from '@/lib/ai/chartDigest/extract';
import { CHART_DIGEST_RESOURCE, type ChartDigest } from '@/lib/ai/chartDigest/types';
import type { DigestKind } from '@/lib/ai/chartDigest/access';
import { computeSourceHash, digestStaleness, parseDigestJson, selectSources, withoutPart2, type DigestDeps, type DocRow, type NoteRow, type StoredDigest } from '@/lib/ai/chartDigest/service';

type HeaderSource = Request | Headers | { headers: Headers } | null | undefined;

/** Most recent sources considered per client (oldest beyond this are left out) */
const MAX_DOCS = 600;
const MAX_NOTES = 600;

export const DOC_SELECT = {
  id: true,
  documentType: true,
  fileName: true,
  sourcePath: true,
  extractedFields: true,
  mimeType: true,
  s3RawKey: true,
  extractedText: true,
  pageTexts: true,
  pageCount: true,
  textMethod: true,
  textExtractedAt: true,
  textOcrJobId: true,
  sha256: true,
  fileSize: true,
  filedAt: true,
  createdAt: true,
} as const;

/** PDF page texts with the bundled pdf.js (local, no network) */
export async function pdfPageTexts(bytes: Uint8Array): Promise<string[]> {
  const { extractText, getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  try {
    const { text } = await extractText(pdf, { mergePages: false });
    return text.map((t) => String(t ?? ''));
  } finally {
    await pdf.destroy().catch(() => {});
  }
}

export const extractDeps: ExtractDeps = {
  async readFile(storedName) {
    const buf = await readIntakeFile(storedName).catch(() => null);
    return buf ? new Uint8Array(buf) : null;
  },
  pdfPageTexts,
  pdfSubset: (bytes, pages) => extractPdfPages(bytes, pages),
  textractConfigured: () => isPdfOcrConfigured(),
  // Unique request token: the intake pipeline already used the document id for its own job
  startPdfOcr: (docId, bytes) => startPdfOcr(docId, bytes, `cd-${docId.replace(/[^A-Za-z0-9-]/g, '').slice(0, 40)}-${randomBytes(4).toString('hex')}`),
  async pollPdfOcr(docId, jobId) {
    const r = await pollPdfOcr(docId, jobId);
    return r.state === 'done' ? { state: 'done', pages: r.result.pages } : r;
  },
  async ocrImage(bytes) {
    return (await ocrImage(bytes)).pages;
  },
  async save(docId, data) {
    await prisma.documentIntake.update({
      where: { id: docId },
      data: {
        pageTexts: data.pages as unknown as Prisma.InputJsonValue,
        extractedText: data.pages.join('\f'),
        pageCount: data.pages.length,
        textMethod: data.method,
        textExtractedAt: data.at,
        textOcrJobId: data.ocrJobId,
      },
    });
  },
};

/** Without the text columns (staleness checks); extract() reads the full row per document */
const DOC_SELECT_LIGHT = Object.fromEntries(Object.entries(DOC_SELECT).filter(([k]) => k !== 'extractedText' && k !== 'pageTexts')) as Omit<typeof DOC_SELECT, 'extractedText' | 'pageTexts'>;

export async function loadDigestSources(organizationId: string, clientId: string, opts: { withBodies?: boolean } = {}) {
  const [docs, notes, rec, part2Note] = await Promise.all([
    prisma.documentIntake.findMany({
      where: { suggestedClientId: clientId, suggestedClient: { organizationId }, status: 'filed', voidedAt: null },
      select: DOC_SELECT_LIGHT,
      orderBy: { filedAt: 'desc' },
      take: MAX_DOCS,
    }),
    // Signed / locked native notes; psychotherapy notes are a separate table and never read here
    prisma.progressNote.findMany({
      where: { clientId, client: { organizationId }, dismissedAt: null, workflow: { status: { in: ['SIGNED', 'LOCKED'] } } },
      select: { id: true, noteType: true, body: Boolean(opts.withBodies), dateOfService: true, createdAt: true, updatedAt: true, part2: true },
      orderBy: { createdAt: 'desc' },
      take: MAX_NOTES,
    }),
    prisma.sensitiveRecord.findFirst({ where: { organizationId, clientId }, select: { noteClassification: true } }),
    prisma.progressNote.findFirst({ where: { clientId, part2: true, client: { organizationId } }, select: { id: true } }),
  ]);
  const part2Client = isPart2Classification(rec?.noteClassification) || Boolean(part2Note);
  let part2ConsentCovers = false;
  if (part2Client) {
    const rows = await prisma.consentForm.findMany({
      where: { organizationId, clientId, revokedAt: null },
      select: { type: true, formKey: true, status: true, formStatus: true, expiresAt: true, revokedAt: true, recipientName: true, formData: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    part2ConsentCovers = part2ConsentCoversTreatment(rows);
  }
  return {
    docs: docs.map((d) => ({ ...d, extractedText: null, pageTexts: null })) as DocRow[],
    notes: notes.map((n) => ({ ...n, body: (n as { body?: string }).body ?? '' })) as NoteRow[],
    part2Client,
    part2ConsentCovers,
  };
}

function toStored(r: {
  id: string;
  version: number;
  status: string;
  digestJson: Prisma.JsonValue;
  sourceDocIds: string[];
  sourceHash: string;
  model: string | null;
  promptVersion: string;
  tokensIn: number;
  tokensOut: number;
  costEstimateUsd: number;
  generatedAt: Date;
  errors: Prisma.JsonValue;
}): StoredDigest {
  return { ...r, status: (r.status === 'failed' || r.status === 'partial' ? r.status : 'ready') as StoredDigest['status'] };
}

/** Latest version of one kind of digest (versions and staleness are per kind) */
export async function latestChartDigest(organizationId: string, clientId: string, kind: DigestKind = 'bh'): Promise<StoredDigest | null> {
  const r = await prisma.clientChartDigest.findFirst({ where: { organizationId, clientId, kind }, orderBy: { version: 'desc' } });
  return r ? toStored(r) : null;
}

/**
 * input.gate = the signed-in viewer (route); null = an operator script (audited as system with the
 * operator label in metadata).
 */
export function prismaChartDigestDeps(input: { gate: { organizationId: string; userId: string; role: string } | null; req?: HeaderSource; path: string; scriptLabel?: string; organizationId?: string; kind?: DigestKind }): DigestDeps {
  const kind: DigestKind = input.kind ?? 'bh';
  return {
    async resolveAccess(viewer, clientId) {
      const d = await resolveChartAccess(viewer, clientId, input.path);
      if (d.ok === false) return { ok: false, status: d.status, reason: d.reason };
      const c = d.client;
      return { ok: true, names: [c.name, c.legalFirstName, c.legalLastName].filter((n): n is string => Boolean(n)) };
    },
    onCareTeam: (viewer, clientId) => hasCareTeamLink(viewer, clientId).catch(() => false),
    async aiConsent(organizationId, clientId) {
      return (await checkAiNoteConsent(organizationId, clientId)).status;
    },
    loadSources: loadDigestSources,
    async clientNames(organizationId, clientId) {
      const c = await prisma.client.findFirst({ where: { id: clientId, organizationId }, select: { name: true, legalFirstName: true, legalLastName: true } });
      return c ? [c.name, c.legalFirstName, c.legalLastName].filter((n): n is string => Boolean(n)) : [];
    },
    async extract(doc, opts) {
      const full = await prisma.documentIntake.findUnique({ where: { id: doc.id }, select: DOC_SELECT });
      return extractDocumentText(extractDeps, full ?? doc, opts);
    },
    latestDigest: (organizationId, clientId) => latestChartDigest(organizationId, clientId, kind),
    async saveDigest(row) {
      const r = await prisma.clientChartDigest.create({
        data: {
          kind,
          organizationId: row.organizationId,
          clientId: row.clientId,
          version: row.version,
          status: row.status,
          digestJson: row.digestJson as Prisma.InputJsonValue,
          sourceDocIds: row.sourceDocIds,
          sourceHash: row.sourceHash,
          model: row.model,
          promptVersion: row.promptVersion,
          tokensIn: row.tokensIn,
          tokensOut: row.tokensOut,
          costEstimateUsd: row.costEstimateUsd,
          generatedById: row.generatedById,
          generatedAt: row.generatedAt,
          errors: row.errors as Prisma.InputJsonValue,
        },
      });
      return toStored(r);
    },
    bedrockConfigured: () => isBedrockConfigured(),
    async invokeModel({ system, userPrompt }) {
      let usage = { inputTokens: 0, outputTokens: 0 };
      const text = await invokeBedrock({
        model: 'HAIKU',
        system,
        userPrompt,
        maxTokens: 4000,
        temperature: 0,
        jsonMode: true,
        guard: 'clinical',
        logContext: { feature: kind === 'medical' ? 'chart_digest_medical' : 'chart_digest', organizationId: input.gate?.organizationId ?? input.organizationId ?? null, actorUserId: input.gate?.userId ?? null },
        onUsage: (u) => (usage = u),
      });
      // Bedrock did not report usage: estimate (chars / 4) so the cost column is never zero
      return {
        text,
        tokensIn: usage.inputTokens || Math.ceil((system.length + userPrompt.length) / 4),
        tokensOut: usage.outputTokens || Math.ceil(text.length / 4),
      };
    },
    modelId: BEDROCK_MODELS.HAIKU,
    async audit(e) {
      const base = { action: e.action, resourceType: CHART_DIGEST_RESOURCE, resourceId: e.clientId, patientId: e.clientId, outcome: e.outcome, metadata: { ...e.metadata, kind } };
      if (input.gate) await auditPhiAccess({ gate: input.gate, req: input.req, ...base });
      else await writeAuditLog({ ...base, organizationId: input.organizationId ?? null, actorUserId: null, actorRole: 'SYSTEM', metadata: { ...e.metadata, via: input.scriptLabel ?? 'script' } });
    },
  };
}

/**
 * Latest digest for the pre-visit brief: Part 2 facts removed (the brief never shows Part 2
 * content), with the staleness flag. null = none generated yet.
 */
export async function digestForBrief(organizationId: string, clientId: string): Promise<{ digest: ChartDigest; generatedAt: Date; stale: boolean } | null> {
  const stored = await latestChartDigest(organizationId, clientId);
  const json = stored ? parseDigestJson(stored.digestJson) : null;
  if (!stored || !json || stored.status === 'failed') return null;
  const set = await loadDigestSources(organizationId, clientId);
  const fresh = digestStaleness(stored, computeSourceHash(selectSources(set).selected));
  return { digest: withoutPart2(json.digest), generatedAt: stored.generatedAt, stale: fresh.stale };
}
