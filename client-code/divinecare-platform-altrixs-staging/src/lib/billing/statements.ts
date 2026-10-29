import 'server-only';

import type { Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { isSmtpConfigured, sendEmail } from '@/lib/email/smtp';
import { isSnsSmsConfigured } from '@/lib/sms/send';
import { sendPatientSms } from '@/lib/sms/patientSms';
import { statementSmsText } from '@/lib/billing/statementSms';
import { patientBalances, statementLineText, type PatientBalanceBreakdown, type StatementLines } from '@/lib/billing/patientLedger';

export const STATEMENT_STATUSES = [
  'outstanding',
  'sent',
  'viewed',
  'paid',
  'overdue',
  'plan',
] as const;

export type StatementStatus = (typeof STATEMENT_STATUSES)[number];

export const STATEMENT_STATUS_COLORS: Record<StatementStatus, string> = {
  outstanding: '#B45309',
  sent: '#0369A1',
  viewed: '#5C2D91',
  paid: '#15803D',
  overdue: '#DC2626',
  plan: '#15803D',
};

const STATEMENT_ROLES: Role[] = [
  'ADMIN',
  'DIRECTOR',
  'PRACTICE_DIRECTOR',
  'BILLING',
  'OFFICE_MANAGER',
];

export type StatementActor = {
  organizationId: string;
  actorUserId: string;
  actorRole: Role;
};

export function canAccessStatements(role: Role | undefined | null) {
  return Boolean(role && STATEMENT_ROLES.includes(role));
}

function isMissingTable(err: unknown) {
  const code =
    typeof err === 'object' && err && 'code' in err ? String((err as { code: unknown }).code) : '';
  const message = err instanceof Error ? err.message : String(err);
  return code === 'P2021' || code === 'P2010' || /does not exist/i.test(message);
}

export type StatementRecord = {
  id: string;
  clientId: string;
  clientName: string;
  status: StatementStatus;
  balanceCents: number;
  periodLabel: string | null;
  delivery: string | null;
  paymentLink: string | null;
  sentAt: string | null;
  viewedAt: string | null;
  paidAt: string | null;
  createdAt: string;
  note: string | null;
  /** How the balance was made up when the statement was generated (Valant opening balance line etc.) */
  lines: StatementLines | null;
};

export type StatementsSnapshot = {
  schemaReady: boolean;
  syncedAt: string;
  eraMode: 'waystar' | 'demo';
  emailConfigured: boolean;
  smsConfigured: boolean;
  kpis: {
    totalBalanceCents: number;
    outstandingCount: number;
    sentCount: number;
    overdueCount: number;
    paidCount: number;
    planCount: number;
  };
  statements: StatementRecord[];
};

function normalizeStatus(raw: string): StatementStatus {
  if ((STATEMENT_STATUSES as readonly string[]).includes(raw)) return raw as StatementStatus;
  return 'outstanding';
}

function mapStatement(row: {
  id: string;
  clientId: string;
  clientName: string;
  status: string;
  balanceCents: number;
  periodLabel: string | null;
  delivery: string | null;
  paymentLink: string | null;
  sentAt: Date | null;
  viewedAt: Date | null;
  paidAt: Date | null;
  createdAt: Date;
  metaJson: unknown;
}): StatementRecord {
  const note =
    row.metaJson &&
    typeof row.metaJson === 'object' &&
    !Array.isArray(row.metaJson) &&
    typeof (row.metaJson as { deliveryNote?: unknown }).deliveryNote === 'string'
      ? ((row.metaJson as { deliveryNote: string }).deliveryNote)
      : null;
  const meta = row.metaJson && typeof row.metaJson === 'object' && !Array.isArray(row.metaJson) ? (row.metaJson as Record<string, unknown>) : null;
  const lines = meta?.lines && typeof meta.lines === 'object' ? (meta.lines as StatementLines) : null;
  return {
    id: row.id,
    clientId: row.clientId,
    clientName: row.clientName,
    status: normalizeStatus(row.status),
    balanceCents: row.balanceCents,
    periodLabel: row.periodLabel,
    delivery: row.delivery,
    paymentLink: row.paymentLink,
    sentAt: row.sentAt?.toISOString() ?? null,
    viewedAt: row.viewedAt?.toISOString() ?? null,
    paidAt: row.paidAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    note,
    lines,
  };
}

export async function listStatements(actor: StatementActor): Promise<StatementsSnapshot> {
  const syncedAt = new Date().toISOString();
  const eraMode = process.env.WAYSTAR_CLIENT_ID ? ('waystar' as const) : ('demo' as const);
  try {
    const rows = await prisma.patientStatement.findMany({
      where: {
        organizationId: actor.organizationId,
        client: clientAccessWhere(actor),
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    const statements = rows.map(mapStatement);
    const kpis = {
      totalBalanceCents: statements
        .filter((s) => s.status !== 'paid')
        .reduce((sum, s) => sum + s.balanceCents, 0),
      outstandingCount: statements.filter((s) => s.status === 'outstanding').length,
      sentCount: statements.filter((s) => s.status === 'sent' || s.status === 'viewed').length,
      overdueCount: statements.filter((s) => s.status === 'overdue').length,
      paidCount: statements.filter((s) => s.status === 'paid').length,
      planCount: statements.filter((s) => s.status === 'plan').length,
    };
    return {
      schemaReady: true,
      syncedAt,
      eraMode,
      emailConfigured: isSmtpConfigured(),
      smsConfigured: isSnsSmsConfigured(),
      kpis,
      statements,
    };
  } catch (err) {
    if (isMissingTable(err)) {
      return {
        schemaReady: false,
        syncedAt,
        eraMode,
        emailConfigured: isSmtpConfigured(),
        smsConfigured: isSnsSmsConfigured(),
        kpis: {
          totalBalanceCents: 0,
          outstandingCount: 0,
          sentCount: 0,
          overdueCount: 0,
          paidCount: 0,
          planCount: 0,
        },
        statements: [],
      };
    }
    throw err;
  }
}

export type GenerateStatementsInput = {
  periodLabel: string;
  includeClientIds?: string[] | null;
  delivery: 'email' | 'sms' | 'both' | 'portal';
  minBalanceCents: number;
  paymentLink?: string | null;
  skipPaymentPlans: boolean;
  sendNow: boolean;
};

/** Clients are read in pages of this size (every active client is included; no silent cap). */
const CLIENT_PAGE = 500;

function appBaseUrl() {
  return (process.env.AUTH_URL || process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '');
}

async function clientBalances(actor: StatementActor, clientIds?: string[] | null) {
  const out: Array<{ id: string; name: string; email: string | null; phone: string | null; balanceCents: number; breakdown: PatientBalanceBreakdown | null }> = [];
  let cursor: string | null = null;
  for (;;) {
    const page: Array<{ id: string; name: string; email: string | null; phone: string | null }> = await prisma.client.findMany({
      where: {
        AND: [clientAccessWhere(actor), { status: 'ACTIVE' }],
        ...(clientIds?.length ? { id: { in: clientIds } } : {}),
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
      },
      orderBy: { id: 'asc' },
      take: CLIENT_PAGE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (!page.length) break;
    // Single source of truth: Valant opening balance + prepayment credit + claims - patient payments
    const balances = await patientBalances(actor.organizationId, page.map((c) => c.id));
    for (const client of page) {
      const b = balances.get(client.id);
      out.push({ ...client, balanceCents: b?.balanceCents ?? 0, breakdown: b ?? null });
    }
    if (page.length < CLIENT_PAGE) break;
    cursor = page[page.length - 1].id;
  }
  return out;
}

function linesOf(b: PatientBalanceBreakdown | null): StatementLines | null {
  if (!b) return null;
  return {
    openingBalanceCents: b.openingBalanceCents,
    openingBalanceAsOf: b.openingBalanceAsOf,
    prepaymentCreditCents: b.prepaymentCreditCents,
    claimsPatientCents: b.claimsPatientCents,
    patientPaymentsCents: b.patientPaymentsCents,
    adjustmentsCents: b.adjustmentsCents,
  };
}

export async function generateStatements(actor: StatementActor, input: GenerateStatementsInput) {
  const balances = await clientBalances(actor, input.includeClientIds);
  const settings = await prisma.practiceSettings
    .findUnique({ where: { organizationId: actor.organizationId }, select: { dbaName: true, legalName: true } })
    .catch(() => null);
  const practiceName = settings?.dbaName || settings?.legalName || null;

  let planClientIds = new Set<string>();
  if (input.skipPaymentPlans) {
    try {
      const plans = await prisma.patientStatement.findMany({
        where: {
          organizationId: actor.organizationId,
          status: 'plan',
        },
        select: { clientId: true },
      });
      planClientIds = new Set(plans.map((p) => p.clientId));
    } catch (err) {
      if (!isMissingTable(err)) throw err;
    }
  }

  const created: StatementRecord[] = [];
  const deliveryNotes: string[] = [];

  for (const client of balances) {
    if (client.balanceCents < input.minBalanceCents) continue;
    if (input.skipPaymentPlans && planClientIds.has(client.id)) continue;

    let status: StatementStatus = 'outstanding';
    let sentAt: Date | null = null;
    let deliveryNote: string | null = null;

    if (input.sendNow) {
      const sendResult = await deliverStatementMessage({
        delivery: input.delivery,
        clientId: client.id,
        organizationId: actor.organizationId,
        actor: { userId: actor.actorUserId, role: actor.actorRole },
        clientName: client.name,
        email: client.email,
        phone: client.phone,
        balanceCents: client.balanceCents,
        periodLabel: input.periodLabel,
        paymentLink: input.paymentLink,
        lines: linesOf(client.breakdown),
        practiceName,
      });
      deliveryNote = sendResult.note;
      if (sendResult.sent) {
        status = 'sent';
        sentAt = new Date();
      } else {
        status = 'outstanding';
      }
      deliveryNotes.push(sendResult.note);
    }

    const row = await prisma.patientStatement.create({
      data: {
        organizationId: actor.organizationId,
        clientId: client.id,
        clientName: client.name,
        status,
        balanceCents: client.balanceCents,
        periodLabel: input.periodLabel,
        delivery: input.delivery,
        paymentLink: input.paymentLink?.trim() || null,
        sentAt,
        metaJson: {
          createdFrom: 'estatements',
          deliveryNote,
          sendNow: input.sendNow,
          lines: linesOf(client.breakdown),
        },
      },
    });
    created.push(mapStatement(row));
  }

  await writeAuditLog({
    action: 'statements.generate',
    actorUserId: actor.actorUserId,
    organizationId: actor.organizationId,
    metadata: {
      created: created.length,
      clientsReviewed: balances.length,
      periodLabel: input.periodLabel,
      delivery: input.delivery,
      sendNow: input.sendNow,
    },
  });

  return {
    ok: true as const,
    created,
    clientsReviewed: balances.length,
    note:
      created.length === 0
        ? `No clients matched the balance / filter criteria (${balances.length} active client(s) reviewed).`
        : input.sendNow
          ? `${deliveryNotes[0] || `${created.length} statement(s) created.`} ${balances.length} active client(s) reviewed.`
          : `${created.length} statement(s) created and saved; ${balances.length} active client(s) reviewed.`,
  };
}

async function deliverStatementMessage(input: {
  delivery: GenerateStatementsInput['delivery'];
  clientId: string;
  organizationId: string;
  actor?: { userId?: string | null; role?: string | null };
  clientName: string;
  email: string | null;
  phone: string | null;
  balanceCents: number;
  periodLabel: string;
  paymentLink?: string | null;
  lines?: StatementLines | null;
  practiceName?: string | null;
}) {
  const amount = `$${(input.balanceCents / 100).toFixed(2)}`;
  const body = [
    `Hello ${input.clientName},`,
    ``,
    `Your patient statement for ${input.periodLabel} shows a balance of ${amount}.`,
    ...statementLineText(input.lines ?? null).map((l) => `  ${l}`),
    input.paymentLink ? `Pay online: ${input.paymentLink}` : null,
    ``,
    `Please contact the billing office with questions.`,
  ]
    .filter(Boolean)
    .join('\n');

  if (input.delivery === 'portal') {
    return {
      sent: false,
      note: 'Statement saved for portal delivery (no email/SMS sent).',
    };
  }

  const wantEmail = input.delivery === 'email' || input.delivery === 'both';
  const wantSms = input.delivery === 'sms' || input.delivery === 'both';
  const notes: string[] = [];
  let sent = false;

  if (wantEmail) {
    if (!isSmtpConfigured()) {
      notes.push('Email not configured (SMTP unset) — statement persisted only.');
    } else if (!input.email) {
      notes.push('Client has no email on file — statement persisted only.');
    } else {
      try {
        const result = await sendEmail({
          to: input.email,
          subject: `Patient statement · ${input.periodLabel}`,
          text: body,
          context: 'patient-statement',
        });
        sent = true;
        notes.push(result.mode !== 'console' ? 'Email sent.' : 'Email logged to console (dev).');
      } catch (err) {
        notes.push(err instanceof Error ? err.message : 'Email send failed.');
      }
    }
  }

  if (wantSms) {
    if (!input.phone) {
      notes.push('Client has no phone on file — statement persisted only.');
    } else {
      // Consent-gated (src/lib/sms/patientSms.ts). Minimum necessary: no balance or service detail.
      const text = await sendPatientSms({
        clientId: input.clientId,
        organizationId: input.organizationId,
        purpose: 'statement_ready',
        actor: input.actor,
        build: ({ sender }) => statementSmsText(sender, input.paymentLink?.trim() || `${appBaseUrl()}/patient/home`),
      });
      if (text.sent) sent = true;
      notes.push(text.sent ? 'SMS sent.' : `SMS ${text.message}`);
    }
  }

  return {
    sent,
    note: notes.join(' ') || 'Statement persisted.',
  };
}

export async function sendExistingStatement(actor: StatementActor, statementId: string) {
  const row = await prisma.patientStatement.findFirst({
    where: {
      id: statementId,
      organizationId: actor.organizationId,
      client: clientAccessWhere(actor),
    },
    include: {
      client: { select: { email: true, phone: true, name: true } },
    },
  });
  if (!row) {
    return { ok: false as const, error: 'Statement not found', status: 404 as const };
  }

  const delivery = (row.delivery as GenerateStatementsInput['delivery']) || 'email';
  const result = await deliverStatementMessage({
    delivery: delivery === 'portal' ? 'email' : delivery,
    clientId: row.clientId,
    organizationId: actor.organizationId,
    actor: { userId: actor.actorUserId, role: actor.actorRole },
    clientName: row.client.name,
    email: row.client.email,
    phone: row.client.phone,
    balanceCents: row.balanceCents,
    periodLabel: row.periodLabel || 'Current',
    paymentLink: row.paymentLink,
    lines: mapStatement(row).lines,
  });

  const prev =
    row.metaJson && typeof row.metaJson === 'object' && !Array.isArray(row.metaJson)
      ? { ...(row.metaJson as Record<string, unknown>) }
      : {};

  const updated = await prisma.patientStatement.update({
    where: { id: row.id },
    data: {
      status: result.sent ? 'sent' : row.status,
      sentAt: result.sent ? new Date() : row.sentAt,
      metaJson: { ...prev, deliveryNote: result.note },
    },
  });

  return {
    ok: true as const,
    statement: mapStatement(updated),
    note: result.note,
  };
}
