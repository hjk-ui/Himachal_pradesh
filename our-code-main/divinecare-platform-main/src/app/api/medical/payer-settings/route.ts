import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';

export const runtime = 'nodejs';

export const CANONICAL_PAYERS = [
  {
    payerId: '87726',
    name: 'UnitedHealthcare / Optum',
    shortName: 'UHC',
    payerType: 'Commercial',
    address: 'PO Box 740800, Atlanta, GA 30374',
    claimsPhone: '(877) 842-3210',
    website: 'https://www.uhcprovider.com',
    timely: 90,
    electronicSubmission: true,
    clearinghouse: 'Availity',
    active: true,
  },
  {
    payerId: '00050',
    name: 'Humana',
    shortName: 'HUM',
    payerType: 'Commercial',
    address: 'PO Box 14601, Lexington, KY 40512',
    claimsPhone: '(800) 448-6262',
    website: 'https://www.humana.com/provider',
    timely: 180,
    electronicSubmission: true,
    clearinghouse: 'Change Healthcare',
    active: true,
  },
  {
    payerId: '00960',
    name: 'Aetna',
    shortName: 'AET',
    payerType: 'Commercial',
    address: 'PO Box 981106, El Paso, TX 79998',
    claimsPhone: '(800) 624-0756',
    website: 'https://www.aetna.com/health-care-professionals.html',
    timely: 180,
    electronicSubmission: true,
    clearinghouse: 'Availity',
    active: true,
  },
  {
    payerId: '00901',
    name: 'BlueCross BlueShield of Maryland',
    shortName: 'BCBS-MD',
    payerType: 'Commercial',
    address: '10455 Mill Run Circle, Owings Mills, MD 21117',
    claimsPhone: '(800) 676-2583',
    website: 'https://provider.carefirst.com',
    timely: 180,
    electronicSubmission: true,
    clearinghouse: 'Availity',
    active: true,
  },
  {
    payerId: '00840',
    name: 'Medicare Part B — Novitas Solutions',
    shortName: 'MCR',
    payerType: 'Medicare',
    address: 'PO Box 3111, Mechanicsburg, PA 17055',
    claimsPhone: '(855) 252-8782',
    website: 'https://www.novitas-solutions.com',
    timely: 365,
    electronicSubmission: true,
    clearinghouse: 'Change Healthcare',
    active: true,
  },
  {
    payerId: '77013',
    name: 'Maryland Medicaid (HealthChoice)',
    shortName: 'MDMCD',
    payerType: 'Medicaid',
    address: 'PO Box 1935, Baltimore, MD 21203',
    claimsPhone: '(800) 445-1159',
    website: 'https://mmcp.health.maryland.gov',
    timely: 360,
    electronicSubmission: true,
    clearinghouse: 'Availity',
    active: true,
  },
  {
    payerId: '52133',
    name: 'Cigna Healthcare',
    shortName: 'CIG',
    payerType: 'Commercial',
    address: 'PO Box 188011, Chattanooga, TN 37422',
    claimsPhone: '(800) 882-4462',
    website: 'https://www.cigna.com/health-care-providers',
    timely: 180,
    electronicSubmission: true,
    clearinghouse: 'Office Ally',
    active: true,
  },
  {
    payerId: 'SELF',
    name: 'Self-Pay',
    shortName: 'SP',
    payerType: 'Self-Pay',
    address: 'In-Clinic Private Pay Account',
    claimsPhone: 'N/A',
    website: 'N/A',
    timely: 0,
    electronicSubmission: false,
    clearinghouse: 'N/A',
    active: true,
  },
];

export const CANONICAL_RULES = [
  {
    priority: 1,
    name: 'Supervisor NPI — Box 24J',
    description: 'Enforces supervising physician NPI on claims rendered by residents or interns.',
    ruleType: 'supervisor_npi',
    trigger: 'Rendering provider role = Intern / Resident',
    action: 'Populate Box 24J with supervising physician NPI from provider record',
    payers: ['All'],
    active: true,
    lastModified: '2026-10-06',
    modifiedBy: 'Admin',
  },
  {
    priority: 2,
    name: 'Telehealth Modifier — Medicaid (GT)',
    description: 'Attaches modifier GT to all telehealth procedure codes for state Medicaid claims.',
    ruleType: 'telehealth_modifier',
    trigger: 'Visit location = Telehealth AND payer type = Medicaid',
    action: 'Append modifier GT to all procedure codes on claim',
    payers: ['77013'],
    active: true,
    lastModified: '2026-10-06',
    modifiedBy: 'Admin',
  },
  {
    priority: 3,
    name: 'Telehealth Modifier — Commercial/Medicare (95)',
    description: 'Attaches modifier 95 to all commercial and Medicare telehealth procedure lines.',
    ruleType: 'telehealth_modifier',
    trigger: 'Visit location = Telehealth AND payer type ≠ Medicaid',
    action: 'Append modifier 95 to all procedure codes on claim',
    payers: ['All except Medicaid'],
    active: true,
    lastModified: '2026-10-06',
    modifiedBy: 'Admin',
  },
  {
    priority: 4,
    name: 'Preventive + Office Visit Modifier (25)',
    description: 'Appends modifier 25 to E&M visits occurring on the same day as a wellness visit.',
    ruleType: 'modifier_auto',
    trigger: 'Same-day CPT: 99381-99397 AND 99202-99215',
    action: 'Append modifier 25 to E&M code (99202-99215)',
    payers: ['All'],
    active: true,
    lastModified: '2026-10-06',
    modifiedBy: 'Admin',
  },
  {
    priority: 5,
    name: 'Medicare Secondary Payer Check',
    description: 'Flags claims for coordination of benefits review when Medicare is primary with secondary.',
    ruleType: 'payer_specific',
    trigger: 'Primary payer = Medicare AND secondary insurance on file',
    action: 'Flag claim as MSP review required before submission',
    payers: ['00840'],
    active: true,
    lastModified: '2026-10-06',
    modifiedBy: 'Admin',
  },
  {
    priority: 6,
    name: 'Timely Filing Warning',
    description: 'Alerts billing staff when a charge approaches within 30 days of the filing cutoff.',
    ruleType: 'custom',
    trigger: 'Date of service + timely filing limit ≤ 30 days from today',
    action: 'Show amber warning banner on charge and flag in worklist',
    payers: ['All'],
    active: true,
    lastModified: '2026-10-06',
    modifiedBy: 'Admin',
  },
];

export const CANONICAL_CLEARINGHOUSES = [
  {
    name: 'Availity',
    status: 'connected',
    warningMsg: '',
    lastTx: '09/28/2026',
    claimsMTD: 847,
  },
  {
    name: 'Change Healthcare',
    status: 'connected',
    warningMsg: '',
    lastTx: '09/27/2026',
    claimsMTD: 312,
  },
  {
    name: 'Office Ally',
    status: 'warning',
    warningMsg: 'Credentials expiring in 8 days',
    lastTx: '09/20/2026',
    claimsMTD: 141,
  },
];

async function seedIfEmpty() {
  const existingPayers = await prisma.medicalPayer.count();
  if (existingPayers === 0) {
    for (const p of CANONICAL_PAYERS) {
      await prisma.medicalPayer.create({
        data: p,
      });
    }
  }

  const existingRules = await prisma.medicalBillingRule.count();
  if (existingRules === 0) {
    for (const r of CANONICAL_RULES) {
      await prisma.medicalBillingRule.create({
        data: r,
      });
    }
  }

  const existingClearinghouses = await prisma.medicalClearinghouseStatus.count();
  if (existingClearinghouses === 0) {
    for (const c of CANONICAL_CLEARINGHOUSES) {
      await prisma.medicalClearinghouseStatus.create({
        data: c,
      });
    }
  }
}

export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPath(gate.role, '/dashboard/medical/payer-settings')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    await seedIfEmpty();

    const [payers, rules, clearinghouses] = await Promise.all([
      prisma.medicalPayer.findMany({ orderBy: { name: 'asc' } }),
      prisma.medicalBillingRule.findMany({ orderBy: { priority: 'asc' } }),
      prisma.medicalClearinghouseStatus.findMany({ orderBy: { name: 'asc' } }),
    ]);

    return NextResponse.json({
      success: true,
      payers,
      rules,
      clearinghouses,
    });
  } catch (err) {
    console.error('Failed to load payer settings:', err);
    return NextResponse.json({
      success: true,
      payers: CANONICAL_PAYERS.map((p, i) => ({ id: `p-${i}`, ...p, createdAt: new Date(), updatedAt: new Date() })),
      rules: CANONICAL_RULES.map((r, i) => ({ id: `r-${i}`, ...r, createdAt: new Date(), updatedAt: new Date() })),
      clearinghouses: CANONICAL_CLEARINGHOUSES.map((c, i) => ({ id: `c-${i}`, ...c, updatedAt: new Date() })),
    });
  }
}

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPath(gate.role, '/dashboard/medical/payer-settings')) {
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
    console.error('Error in payer-settings API:', err);
    return NextResponse.json({ success: false, error: err.message || 'Operation failed' }, { status: 500 });
  }
}
