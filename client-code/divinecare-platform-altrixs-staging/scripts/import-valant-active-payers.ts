/**
 * Load the billing team's "Valant Active Payer List" into the payer master (Billing › Payers).
 *
 * Input is a reviewed JSON file (one object per payer) prepared from the Valant export: name,
 * valantEdi, optional payerType / structured claims address / phone, and notes. Placeholder
 * addresses and phone numbers found in Valant are left out of the fields and recorded in notes.
 *
 * Rules (owner, Oct 2026): the Valant EDI ID is reference only and is NEVER saved as the Waystar
 * payer ID (payerId stays blank until billing verifies it). Each payer is linked to its imported
 * Valant insurance company when one matches by name + EDI ID. Payers already in the master (same
 * name) are skipped. Dry run by default; --apply writes. Audited per payer (field names only).
 *
 * Usage (on the server, from the app directory):
 *   npx tsx --conditions=react-server --env-file=.env scripts/import-valant-active-payers.ts <file.json> --org=<organizationId> --actor=<staff email> [--apply]
 */
import fs from 'node:fs';
import { prisma } from '@/lib/db/prisma';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { createPayer } from '@/lib/billing/payerMasterDb';
import { normalizeEdiId, normalizePayerName } from '@/lib/billing/valantPayers';

type Row = {
  name: string;
  valantEdi: string;
  payerType?: string | null;
  claimsAddressLine1?: string | null;
  claimsAddressLine2?: string | null;
  claimsCity?: string | null;
  claimsState?: string | null;
  claimsZip?: string | null;
  phone?: string | null;
  notes: string;
};

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);

async function main() {
  const file = process.argv[2];
  const org = arg('org');
  const actorEmail = arg('actor')?.toLowerCase();
  const apply = process.argv.includes('--apply');
  if (!file || !org || !actorEmail) throw new Error('Usage: <file.json> --org=<id> --actor=<email> [--apply]');

  const rows = JSON.parse(fs.readFileSync(file, 'utf8')) as Row[];
  const actor = await prisma.user.findFirst({ where: { email: actorEmail, organizationId: org }, select: { id: true, role: true } });
  if (!actor) throw new Error('Actor not found in this organization');

  const existing = await prisma.payerRegistry.findMany({ where: { organizationId: org }, select: { name: true } });
  const existingNames = new Set(existing.map((p) => normalizePayerName(p.name)));
  const valant = await prisma.valantPayer.findMany({
    where: { organizationId: org },
    select: { id: true, normalizedName: true, ediPayerId: true, payerRegistryId: true },
  });

  const counts = { rows: rows.length, created: 0, skippedExisting: 0, linkedValant: 0, noValantMatch: 0, failed: 0 };
  for (const r of rows) {
    const key = normalizePayerName(r.name);
    if (existingNames.has(key)) {
      counts.skippedExisting++;
      console.log(`skip (already in payer list): ${r.name}`);
      continue;
    }
    const byName = valant.filter((v) => v.normalizedName === key && !v.payerRegistryId);
    const match = byName.find((v) => normalizeEdiId(v.ediPayerId) === normalizeEdiId(r.valantEdi)) ?? (byName.length === 1 ? byName[0] : null);
    if (match) counts.linkedValant++;
    else counts.noValantMatch++;
    const input = {
      name: r.name,
      payerId: null, // never the Valant EDI ID
      payerType: r.payerType ?? null,
      claimsAddressLine1: r.claimsAddressLine1 ?? null,
      claimsAddressLine2: r.claimsAddressLine2 ?? null,
      claimsCity: r.claimsCity ?? null,
      claimsState: r.claimsState ?? null,
      claimsZip: r.claimsZip ?? null,
      phone: r.phone ?? null,
      notes: r.notes,
      active: true,
    };
    if (!apply) {
      console.log(`would create: ${r.name}${match ? ' (link Valant)' : ''}`);
      continue;
    }
    try {
      const result = await createPayer(org, actor.id, input, match?.id ?? null);
      existingNames.add(key);
      if (match) match.payerRegistryId = result.row.id;
      counts.created++;
      await writeAuditLog({
        action: 'CREATE',
        actorUserId: actor.id,
        actorRole: String(actor.role),
        organizationId: org,
        resourceType: 'PayerRegistry',
        resourceId: result.row.id,
        outcome: 'SUCCESS',
        userAgent: 'script:import-valant-active-payers',
        metadata: { fields: result.fields, valantLinked: result.valantLinked, source: 'Valant Active Payer List' },
      });
    } catch (e) {
      counts.failed++;
      console.log(`FAILED: ${r.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  console.log(`${apply ? 'APPLIED' : 'DRY RUN'} ${JSON.stringify(counts)}`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
