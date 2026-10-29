import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { normalizeStaffRole } from '@/lib/auth/rolePersonas';

// Same roles the Payer Settings page admits. Payers and rules are shared tables, so writes are gated.
const PAYER_SETTINGS_WRITE_ROLES = new Set(['PRACTICE_DIRECTOR', 'BILLING', 'ADMIN', 'DIRECTOR']);

export const runtime = 'nodejs';

// No built-in payers or billing rules are seeded: the tables hold only what billing staff save.
// (The old seed invented payer IDs, addresses and clearinghouse routing, and rules "modified by
// Admin"; none of it was this practice's configuration.)

export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  try {
    const [payers, rules] = await Promise.all([
      prisma.medicalPayer.findMany({ orderBy: { name: 'asc' } }),
      prisma.medicalBillingRule.findMany({ orderBy: { priority: 'asc' } }),
    ]);

    return NextResponse.json({
      success: true,
      payers,
      rules,
      // No live clearinghouse integration for the medical module: never report telemetry.
      clearinghouses: [],
    });
  } catch (err) {
    console.error('Failed to load payer settings:', err instanceof Error ? err.name : 'error');
    return NextResponse.json(
      { success: false, error: 'Could not load payer settings from the database' },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  if (!PAYER_SETTINGS_WRITE_ROLES.has(String(normalizeStaffRole(gate.role)).toUpperCase())) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const action = body.action;

    switch (action) {
      case 'save_payer': {
        const { payer } = body;
        if (!payer || !payer.payerId?.trim() || !payer.name?.trim()) {
          return NextResponse.json({ success: false, error: 'Payer ID and Name are required' }, { status: 400 });
        }

        const normalizedPayerId = payer.payerId.trim();

        // 1-to-1 unique Payer ID validation
        const conflict = await prisma.medicalPayer.findUnique({
          where: { payerId: normalizedPayerId },
        });

        if (conflict && conflict.id !== payer.id) {
          return NextResponse.json(
            {
              success: false,
              error: `Payer ID ${normalizedPayerId} is already assigned to '${conflict.name}'. Each Payer ID must map to exactly one payer.`,
            },
            { status: 400 }
          );
        }

        const data = {
          payerId: normalizedPayerId,
          name: payer.name.trim(),
          shortName: payer.shortName?.trim() || payer.name.slice(0, 6).toUpperCase(),
          payerType: payer.payerType || 'Commercial',
          address: payer.address || '',
          claimsPhone: payer.claimsPhone || '',
          website: payer.website || '',
          timely: Number(payer.timely) || 180,
          electronicSubmission: Boolean(payer.electronicSubmission),
          clearinghouse: payer.clearinghouse || 'Availity',
          active: payer.active !== undefined ? Boolean(payer.active) : true,
        };

        const result = payer.id
          ? await prisma.medicalPayer.update({
              where: { id: payer.id },
              data,
            })
          : await prisma.medicalPayer.create({
              data,
            });

        return NextResponse.json({ success: true, payer: result });
      }

      case 'toggle_payer': {
        const { id } = body;
        const current = await prisma.medicalPayer.findUnique({ where: { id } });
        if (!current) {
          return NextResponse.json({ success: false, error: 'Payer not found' }, { status: 404 });
        }
        const updated = await prisma.medicalPayer.update({
          where: { id },
          data: { active: !current.active },
        });
        return NextResponse.json({ success: true, payer: updated });
      }

      case 'save_rule': {
        const { rule } = body;
        if (!rule || !rule.name?.trim() || !rule.trigger?.trim() || !rule.action?.trim()) {
          return NextResponse.json({ success: false, error: 'Name, Trigger, and Action are required' }, { status: 400 });
        }

        const userName = gate.session?.user?.name || 'Staff';

        if (rule.id) {
          const updated = await prisma.medicalBillingRule.update({
            where: { id: rule.id },
            data: {
              name: rule.name.trim(),
              description: rule.description || '',
              ruleType: rule.ruleType || 'custom',
              trigger: rule.trigger.trim(),
              action: rule.action.trim(),
              payers: Array.isArray(rule.payers) ? rule.payers : ['All'],
              active: rule.active !== undefined ? Boolean(rule.active) : true,
              lastModified: new Date().toISOString().slice(0, 10),
              modifiedBy: userName,
            },
          });
          return NextResponse.json({ success: true, rule: updated });
        } else {
          const maxPriorityRule = await prisma.medicalBillingRule.findFirst({
            orderBy: { priority: 'desc' },
          });
          const nextPriority = (maxPriorityRule?.priority || 0) + 1;

          const created = await prisma.medicalBillingRule.create({
            data: {
              name: rule.name.trim(),
              description: rule.description || '',
              ruleType: rule.ruleType || 'custom',
              trigger: rule.trigger.trim(),
              action: rule.action.trim(),
              payers: Array.isArray(rule.payers) ? rule.payers : ['All'],
              active: true,
              priority: nextPriority,
              lastModified: new Date().toISOString().slice(0, 10),
              modifiedBy: userName,
            },
          });
          return NextResponse.json({ success: true, rule: created });
        }
      }

      case 'toggle_rule': {
        const { id } = body;
        const current = await prisma.medicalBillingRule.findUnique({ where: { id } });
        if (!current) {
          return NextResponse.json({ success: false, error: 'Rule not found' }, { status: 404 });
        }
        const updated = await prisma.medicalBillingRule.update({
          where: { id },
          data: { active: !current.active },
        });
        return NextResponse.json({ success: true, rule: updated });
      }

      case 'reorder_rules': {
        const { ruleId, direction } = body;
        if (!ruleId || (direction !== 'up' && direction !== 'down')) {
          return NextResponse.json({ success: false, error: 'Invalid reorder parameters' }, { status: 400 });
        }

        const allRules = await prisma.medicalBillingRule.findMany({
          orderBy: { priority: 'asc' },
        });

        const currentIndex = allRules.findIndex((r) => r.id === ruleId);
        if (currentIndex === -1) {
          return NextResponse.json({ success: false, error: 'Rule not found' }, { status: 404 });
        }

        const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
        if (targetIndex < 0 || targetIndex >= allRules.length) {
          return NextResponse.json({ success: false, error: 'Cannot move beyond bounds' }, { status: 400 });
        }

        const currentRule = allRules[currentIndex];
        const targetRule = allRules[targetIndex];

        // Swap priorities atomically
        await prisma.$transaction([
          prisma.medicalBillingRule.update({
            where: { id: currentRule.id },
            data: { priority: targetRule.priority },
          }),
          prisma.medicalBillingRule.update({
            where: { id: targetRule.id },
            data: { priority: currentRule.priority },
          }),
        ]);

        const updatedRules = await prisma.medicalBillingRule.findMany({
          orderBy: { priority: 'asc' },
        });

        return NextResponse.json({ success: true, rules: updatedRules });
      }

      default:
        return NextResponse.json({ success: false, error: `Unsupported action: ${action}` }, { status: 400 });
    }
  } catch (err: any) {
    console.error('[medical/payer-settings] operation failed', err instanceof Error ? err.name : 'error');
    return NextResponse.json({ success: false, error: 'Operation failed' }, { status: 500 });
  }
}
