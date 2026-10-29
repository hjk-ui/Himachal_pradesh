/**
 * Server helpers for MDH AOT form documents (aot_documents) and the outreach log (aot_outreach_attempts).
 * Org scope comes from src/app/api/aot/_scope.ts; chart data used for prefill is read only when the
 * signed-in user may open that chart (caseload scope via clientAccessWhere).
 */
import type { AotDocument, AotParticipant, Role } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { findParticipantInOrg } from '@/app/api/aot/_scope';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import { chartDiagnoses } from '@/lib/clients/diagnosisOverviewCore';
import { verifiedMedicalDirector } from '@/lib/auth/medicalDirector';
import {
  FORM_DEFINITIONS,
  FORM_TYPES,
  docMeta,
  formFields,
  formProgress,
  signingState,
  type FormType,
} from '@/lib/aot/forms';
import { buildPrefill, type PrefillSources } from '@/lib/aot/forms/prefill';
import { aotFormFlags, formDueDates } from '@/lib/aot/forms/deadlines';

export type OrgGate = {
  organizationId: string;
  userId: string;
  role: string;
  session: { user: { name?: string | null } };
};

/** The document, only when its participant is visible to the caller's organization. */
export async function loadDocumentInOrg(id: string, organizationId: string) {
  if (!z.string().uuid().safeParse(id).success) return null;
  const doc = await prisma.aotDocument.findFirst({ where: { id, organizationId } });
  if (!doc) return null;
  const participant = await findParticipantInOrg(doc.participantId, organizationId);
  return participant ? { doc, participant } : null;
}

export function isMedicalDirector(gate: OrgGate): boolean {
  return verifiedMedicalDirector({ userId: gate.userId, role: gate.role, organizationId: gate.organizationId });
}

/** The linked chart, only when this user may open it (null otherwise). */
export async function chartForPrefill(gate: OrgGate, clientId: string | null) {
  if (!clientId) return null;
  return prisma.client.findFirst({
    where: {
      id: clientId,
      AND: [clientAccessWhere({ organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role as Role })],
    },
    select: {
      id: true,
      name: true,
      dateOfBirth: true,
      phone: true,
      email: true,
      addressLine1: true,
      addressLine2: true,
      city: true,
      state: true,
      postalCode: true,
      insuranceType: true,
      insurancePayer: true,
      primaryDiagnosis: true,
      primaryDiagnosisCode: true,
      secondaryDiagnoses: true,
    },
  });
}

export async function listOutreach(organizationId: string, participantId: string) {
  return prisma.aotOutreachAttempt.findMany({
    where: { organizationId, participantId },
    orderBy: { attemptedAt: 'desc' },
    take: 200,
  });
}

/** Latest signed data per form type (for carrying program / CCT contact details forward). */
async function latestSignedData(organizationId: string, participantId: string) {
  const docs = await prisma.aotDocument.findMany({
    where: { organizationId, participantId, status: 'signed' },
    orderBy: { signedAt: 'desc' },
    select: { formType: true, data: true },
  });
  const out: Partial<Record<FormType, Record<string, unknown>>> = {};
  for (const d of docs) if (!out[d.formType as FormType]) out[d.formType as FormType] = formFields(d.data);
  return out;
}

export async function sdohForClient(organizationId: string, clientId: string) {
  const [latest, referrals] = await Promise.all([
    prisma.sdohScreening.findFirst({
      where: { organizationId, clientId },
      orderBy: { completedAt: 'desc' },
      select: { completedAt: true, positiveDomains: true },
    }),
    prisma.sdohReferral.findMany({
      where: { organizationId, clientId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { domain: true, status: true, referralType: true, resourceId: true, createdAt: true },
    }),
  ]);
  const resourceIds = [...new Set(referrals.map((r) => r.resourceId).filter((x): x is string => !!x))];
  const resources = resourceIds.length
    ? await prisma.sdohResource.findMany({ where: { organizationId, id: { in: resourceIds } }, select: { id: true, name: true } })
    : [];
  const name = new Map(resources.map((r) => [r.id, r.name]));
  return {
    latest,
    referrals: referrals.map((r) => ({ ...r, resourceName: r.resourceId ? name.get(r.resourceId) ?? null : null })),
  };
}

/** Prefill for a new draft: participant record, chart (if the user may open it), outreach log, SDOH, earlier signed forms. */
export async function prefillFor(gate: OrgGate, participant: AotParticipant, formType: FormType) {
  const chart = await chartForPrefill(gate, participant.clientId);
  const [outreach, previous, coverages, sdoh] = await Promise.all([
    listOutreach(gate.organizationId, participant.id),
    latestSignedData(gate.organizationId, participant.id),
    chart
      ? prisma.clientInsuranceCoverage.findMany({
          where: { organizationId: gate.organizationId, clientId: chart.id },
          select: { payerName: true, claimFilingCode: true, active: true },
        })
      : Promise.resolve([]),
    chart ? sdohForClient(gate.organizationId, chart.id) : Promise.resolve(null),
  ]);
  const sources: PrefillSources = {
    participant,
    client: chart,
    coverages,
    diagnoses: chart ? chartDiagnoses(chart).map((d) => ({ code: d.code, label: d.label })) : [],
    outreach,
    sdoh,
    actor: { name: gate.session.user.name ?? null, role: gate.role },
    previous,
  };
  const result = buildPrefill(formType, sources);
  const chartNote =
    participant.clientId && !chart
      ? 'Chart details were not prefilled: the linked chart is not on your caseload.'
      : !participant.clientId
        ? 'No chart is linked to this participant, so chart details were not prefilled.'
        : null;
  return { ...result, chartNote };
}

export function documentSummary(d: AotDocument) {
  const type = d.formType as FormType;
  const def = FORM_DEFINITIONS[type];
  const meta = docMeta(d.data);
  const sign = def ? signingState(def, d.data) : null;
  return {
    id: d.id,
    formType: d.formType,
    title: def?.title ?? d.formType,
    mdhNumber: def?.mdhNumber ?? null,
    version: d.version,
    status: d.status,
    progress: def ? formProgress(type, d.data) : null,
    signatures: (meta.signatures ?? []).map((s) => ({ slot: s.slot, name: s.name, title: s.title ?? null, signedAt: s.signedAt })),
    pendingSlots: sign ? sign.pending.map((s) => s.id) : [],
    amendsId: meta.amendsId ?? null,
    mailing: meta.mailing ? { trackingNumber: meta.mailing.trackingNumber, mailedDate: meta.mailing.mailedDate } : null,
    signedByName: d.signedByName,
    signedAt: d.signedAt,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

/** Per-form workspace rows: latest document, status, completeness, due date. */
export function formsOverview(participant: AotParticipant, docs: AotDocument[]) {
  const dues = formDueDates(participant);
  return FORM_TYPES.map((type) => {
    const mine = docs.filter((d) => d.formType === type).sort((a, b) => b.version - a.version || b.createdAt.getTime() - a.createdAt.getTime());
    const draft = mine.find((d) => d.status === 'draft') ?? null;
    const signed = mine.filter((d) => d.status === 'signed');
    const latest = draft ?? signed[0] ?? null;
    const def = FORM_DEFINITIONS[type];
    return {
      formType: type,
      title: def.title,
      mdhNumber: def.mdhNumber,
      multiInstance: def.multiInstance,
      status: !latest ? 'not_started' : draft ? (docMeta(draft.data).signatures?.length ? 'signing' : 'draft') : 'signed',
      latest: latest ? documentSummary(latest) : null,
      signedCount: signed.length,
      documents: mine.map(documentSummary),
      due: dues[type] ?? null,
    };
  });
}

export async function flagsForParticipants(organizationId: string, participants: AotParticipant[], now = new Date()) {
  const ids = participants.map((p) => p.id);
  if (!ids.length) return new Map<string, { flags: ReturnType<typeof aotFormFlags>; lastEp: { date: string | null; signedAt: Date | null } | null }>();
  const [docs, outreach] = await Promise.all([
    prisma.aotDocument.findMany({
      where: { organizationId, participantId: { in: ids }, status: { in: ['draft', 'signed'] } },
      select: { participantId: true, formType: true, status: true, signedAt: true, data: true },
    }),
    prisma.aotOutreachAttempt.findMany({
      where: { organizationId, participantId: { in: ids } },
      select: { participantId: true, attemptedAt: true, result: true },
    }),
  ]);
  const out = new Map<string, { flags: ReturnType<typeof aotFormFlags>; lastEp: { date: string | null; signedAt: Date | null } | null }>();
  for (const p of participants) {
    const pd = docs.filter((d) => d.participantId === p.id);
    const eps = pd
      .filter((d) => d.formType === 'ep_notification' && d.status === 'signed')
      .sort((a, b) => (b.signedAt?.getTime() ?? 0) - (a.signedAt?.getTime() ?? 0));
    const epDate = eps[0] ? formFields(eps[0].data).epDate : null;
    out.set(p.id, {
      flags: aotFormFlags(p, pd, outreach.filter((o) => o.participantId === p.id), now),
      lastEp: eps[0] ? { date: typeof epDate === 'string' ? epDate : null, signedAt: eps[0].signedAt } : null,
    });
  }
  return out;
}

/**
 * HRSN summary for the participant workspace: latest AHC HRSN screening + SDOH referrals (when the chart
 * is on the caller's caseload) and the HRSN answers of the latest treatment plan.
 */
export async function hrsnSummary(gate: OrgGate, participant: AotParticipant, docs: AotDocument[]) {
  const chart = await chartForPrefill(gate, participant.clientId);
  const sdoh = chart ? await sdohForClient(gate.organizationId, chart.id) : null;
  const plan = docs
    .filter((d) => d.formType === 'treatment_plan' && d.status !== 'superseded')
    .sort((a, b) => b.version - a.version)[0];
  const f = plan ? formFields(plan.data) : {};
  const pick = (k: string) => (typeof f[k] === 'string' ? (f[k] as string) : Array.isArray(f[k]) ? (f[k] as string[]) : null);
  return {
    chartAvailable: !!chart,
    screening: sdoh?.latest ? { completedAt: sdoh.latest.completedAt, positiveDomains: sdoh.latest.positiveDomains } : null,
    referrals: (sdoh?.referrals ?? []).map((r) => ({ domain: r.domain, status: r.status, resourceName: r.resourceName, createdAt: r.createdAt })),
    plan: plan
      ? {
          documentId: plan.id,
          version: plan.version,
          status: plan.status,
          livingSituation: pick('livingSituation'),
          transportationProblems: pick('transportationProblems'),
          foodProblems: pick('foodProblems'),
          snap: pick('snap'),
          incomeSources: pick('incomeSources'),
          insurance: pick('insurance'),
        }
      : null,
  };
}
