import { Prisma, type Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import { clinicDate } from '@/lib/workflows/dates';
import { scoreAssessment, type AssessmentSubmission } from './assessmentScoring';
import { AssessmentError } from './assessmentErrors';
import { createHash } from 'node:crypto';

type Actor = { organizationId: string; actorUserId: string; actorRole: Role };
type Bucket = { clientId: string; clientName: string; items: Record<string, unknown>[] };
function buckets(value: unknown): Bucket[] {
  if (!Array.isArray(value)) return [];
  return value.filter((row): row is Bucket => Boolean(row && typeof row === 'object' &&
    typeof row.clientId === 'string' && typeof row.clientName === 'string' && Array.isArray(row.items)))
    .map((row) => ({ ...row, items: row.items.filter((item) => item !== null && typeof item === 'object') }));
}

export async function listAssessments(actor: Actor) {
  const clients = await prisma.client.findMany({ where: clientAccessWhere(actor), select: { id: true, name: true } });
  const allowed = new Map(clients.map((client) => [client.id, client.name]));
  const row = await prisma.clinicModuleState.findUnique({
    where: { organizationId_module: { organizationId: actor.organizationId, module: 'assessments' } },
  });
  return { data: buckets(row?.data).filter((bucket) => allowed.has(bucket.clientId))
    .map((bucket) => ({ ...bucket, clientName: allowed.get(bucket.clientId)! })), version: row?.updatedAt.toISOString() ?? 'new' };
}

/** Submission and mandatory safety event are committed together, and retries reuse the submission ID. */
export async function submitAssessment(actor: Actor, input: AssessmentSubmission) {
  const scored = scoreAssessment(input);
  const fingerprint = createHash('sha256').update(JSON.stringify({ clientId: input.clientId, type: input.type,
    responses: 'responses' in input ? input.responses : null, score: scored.score, severity: scored.severity })).digest('hex');
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const client = await tx.client.findFirst({
          where: { id: input.clientId, ...clientAccessWhere(actor) },
          select: { id: true, name: true, assignedToId: true },
        });
        if (!client) throw new AssessmentError('Client not found in your caseload', 404);
        const key = { organizationId: actor.organizationId, module: 'assessments' };
        const row = await tx.clinicModuleState.findUnique({ where: { organizationId_module: key } });
        const existing = buckets(row?.data);
        const duplicate = existing.flatMap((bucket) => bucket.items).find((item) => item.id === input.submissionId);
        if (duplicate) {
          if (duplicate.clientId !== input.clientId || duplicate.type !== input.type || duplicate.fingerprint !== fingerprint) {
            throw new AssessmentError('Submission ID already used for a different assessment', 409);
          }
          return { assessment: duplicate, crisisReviewRequired: duplicate.suicidalIdeation === true, duplicate: true };
        }
        const entry = {
          id: input.submissionId, clientId: client.id, type: input.type, date: clinicDate(), fingerprint,
          ...scored, responses: 'responses' in input ? input.responses : null,
          recordedById: actor.actorUserId, recordedAt: new Date().toISOString(),
          source: 'clinician', scoringVersion: 'pdf-v1.3-item-safety-1',
        };
        const bucket = existing.find((item) => item.clientId === client.id);
        if (bucket) bucket.items = [entry, ...bucket.items];
        else existing.push({ clientId: client.id, clientName: client.name, items: [entry] });
        await tx.clinicModuleState.upsert({
          where: { organizationId_module: key },
          create: { ...key, data: existing as unknown as Prisma.InputJsonValue },
          update: { data: existing as unknown as Prisma.InputJsonValue },
        });
        if (scored.suicidalIdeation) {
          await tx.riskAlert.create({ data: {
            organizationId: actor.organizationId, clientId: client.id, clientName: client.name,
            clinicianId: client.assignedToId, type: 'suicidal_ideation', severity: 'HIGH',
            source: 'PHQ9_Q9', sourceId: entry.id, reviewed: false,
            description: 'PHQ-9 item 9 is positive. Clinical review is required regardless of total score.',
          } });
        }
        return { assessment: entry, crisisReviewRequired: scored.suicidalIdeation, duplicate: false };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2034', 'P2002'].includes(error.code) && attempt < 2) continue;
      throw error;
    }
  }
  throw new Error('Please retry the assessment submission');
}
