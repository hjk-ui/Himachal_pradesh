/**
 * Practice policy documents (handbook, code of conduct, HIPAA, confidentiality, Part 2) as text
 * sections, staff acknowledgments per version, and the section store used by the handbook Q&A.
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { dateOnlyValue, splitPolicyText, ymd, type PolicySection } from './standard';
import { isMissingTable, loadRoster, type HrCtx } from './server';

export const POLICY_KINDS = [
  { key: 'handbook', label: 'Employee handbook' },
  { key: 'code_of_conduct', label: 'Code of conduct' },
  { key: 'hipaa', label: 'HIPAA privacy & security policy' },
  { key: 'confidentiality', label: 'Confidentiality agreement' },
  { key: 'part2', label: '42 CFR Part 2 policy' },
  { key: 'other', label: 'Other policy' },
] as const;

type Section = { id: string; heading: string; text: string };

export async function listPolicies(organizationId: string, viewerUserId?: string) {
  try {
    const rows = await prisma.hrPolicyDocument.findMany({ where: { organizationId, active: true }, orderBy: [{ kind: 'asc' }, { updatedAt: 'desc' }] });
    const acks = viewerUserId
      ? await prisma.hrPolicyAcknowledgment.findMany({ where: { organizationId, userId: viewerUserId }, select: { policyId: true, version: true, acknowledgedAt: true } })
      : [];
    return rows.map((r) => {
      const sections = (r.sections as unknown as Section[]) ?? [];
      const ack = acks.find((a) => a.policyId === r.id && a.version === r.version);
      return {
        id: r.id,
        kind: r.kind,
        title: r.title,
        version: r.version,
        effectiveOn: ymd(r.effectiveOn),
        requiresAck: r.requiresAck,
        sectionCount: sections.length,
        sections,
        acknowledgedAt: ack?.acknowledgedAt.toISOString() ?? null,
        updatedAt: r.updatedAt.toISOString(),
      };
    });
  } catch (err) {
    if (isMissingTable(err)) return [];
    throw err;
  }
}

/** New policy or new version (the previous version of the same kind + title is retired). */
export async function savePolicy(
  ctx: HrCtx,
  input: { kind: string; title: string; version: string; effectiveOn?: string | null; text: string; requiresAck: boolean },
) {
  const sections = splitPolicyText(input.text);
  if (!sections.length) return { ok: false as const, status: 400, error: 'Paste the policy text' };
  const row = await prisma.$transaction(async (tx) => {
    await tx.hrPolicyDocument.updateMany({ where: { organizationId: ctx.organizationId, kind: input.kind, title: input.title, active: true }, data: { active: false } });
    return tx.hrPolicyDocument.create({
      data: {
        organizationId: ctx.organizationId,
        kind: input.kind,
        title: input.title.trim(),
        version: input.version.trim(),
        effectiveOn: dateOnlyValue(input.effectiveOn ?? null),
        sections: sections as unknown as Prisma.InputJsonValue,
        requiresAck: input.requiresAck,
        uploadedById: ctx.userId,
      },
    });
  });
  return { ok: true as const, id: row.id, sectionCount: sections.length };
}

export async function retirePolicy(ctx: HrCtx, id: string) {
  const p = await prisma.hrPolicyDocument.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!p) return { ok: false as const, status: 404, error: 'Policy not found' };
  await prisma.hrPolicyDocument.update({ where: { id }, data: { active: false } });
  return { ok: true as const };
}

export async function acknowledgePolicy(ctx: HrCtx, id: string) {
  const p = await prisma.hrPolicyDocument.findFirst({ where: { id, organizationId: ctx.organizationId, active: true } });
  if (!p) return { ok: false as const, status: 404, error: 'Policy not found' };
  await prisma.hrPolicyAcknowledgment.upsert({
    where: { policyId_userId_version: { policyId: p.id, userId: ctx.userId, version: p.version } },
    update: {},
    create: { organizationId: ctx.organizationId, policyId: p.id, userId: ctx.userId, version: p.version },
  });
  // Close the matching onboarding acknowledgment task, if any.
  const key = p.kind === 'code_of_conduct' ? 'ack_conduct' : `ack_${p.kind}`;
  await prisma.hrChecklistTask.updateMany({
    where: { organizationId: ctx.organizationId, userId: ctx.userId, key, status: 'open' },
    data: { status: 'done', acknowledgedAt: new Date(), completedAt: new Date(), completedById: ctx.userId, completedByName: ctx.name },
  });
  return { ok: true as const, version: p.version };
}

/** Acknowledgment status per active staff member per required policy. */
export async function acknowledgmentReport(organizationId: string) {
  const [policies, roster] = await Promise.all([listPolicies(organizationId), loadRoster(organizationId)]);
  const required = policies.filter((p) => p.requiresAck);
  let acks: Array<{ policyId: string; userId: string; version: string }> = [];
  try {
    acks = await prisma.hrPolicyAcknowledgment.findMany({ where: { organizationId }, select: { policyId: true, userId: true, version: true } });
  } catch (err) {
    if (!isMissingTable(err)) throw err;
  }
  return required.map((p) => {
    const done = new Set(acks.filter((a) => a.policyId === p.id && a.version === p.version).map((a) => a.userId));
    const active = roster.filter((r) => r.hrStatus !== 'Terminated');
    return {
      policyId: p.id,
      title: p.title,
      version: p.version,
      acknowledged: active.filter((r) => done.has(r.userId)).length,
      total: active.length,
      missing: active.filter((r) => !done.has(r.userId)).map((r) => ({ userId: r.userId, name: r.name })),
    };
  });
}

/** Sections of active policies for retrieval (handbook Q&A). */
export async function policySections(organizationId: string): Promise<PolicySection[]> {
  const policies = await listPolicies(organizationId);
  return policies.flatMap((p) => p.sections.map((s) => ({ policyId: p.id, policyTitle: `${p.title} (v${p.version})`, sectionId: s.id, heading: s.heading, text: s.text })));
}
