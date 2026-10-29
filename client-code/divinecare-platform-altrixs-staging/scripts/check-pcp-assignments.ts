/**
 * READ-ONLY report: is each primary care patient assigned to the right PCP?
 *
 *   npx tsx --conditions=react-server --env-file=.env scripts/check-pcp-assignments.ts
 *   ... --org=<organizationId>   only this organization (default: every organization with primary care patients)
 *   ... --samples=<n>            sample mismatches to print (default 10)
 *
 * Rules: src/lib/medical/pcpAssignment.ts (current PCP = the "Primary Care Provider" care team member;
 * evidence = Family Practice Valant charges with a MAPPED provider code, medical visits, completed
 * appointments with a medical provider; plurality in 12 months, recency tie-break).
 * Prints counts, staff names (providers only) and client ids / MRNs. Never patient names. Writes nothing.
 */
import { prisma } from '@/lib/db/prisma';
import { loadPcpContext, loadPcpDecisions, primaryCareClientIds, type PcpClientDecision } from '@/lib/medical/pcpAssignmentDb';
import { isPcpEligible, PCP_STATUSES, pcpDisplayName, type PcpStatus } from '@/lib/medical/pcpAssignment';
import { providerCodeKey } from '@/lib/migration/valantProviderMap';
import { PRIMARY_CARE_VALANT_FACILITY } from '@/lib/medical/medicalProgram';

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? null;

async function main() {
  const orgFilter = arg('org');
  const samples = Math.max(0, parseInt(arg('samples') ?? '10', 10) || 10);
  const now = new Date();
  const orgs = await prisma.organization.findMany({ where: orgFilter ? { id: orgFilter } : {}, select: { id: true, name: true } });

  for (const org of orgs) {
    const ids = await primaryCareClientIds(org.id);
    if (!ids.length) continue;
    const ctx = await loadPcpContext(org.id);
    const decisions = await loadPcpDecisions(ctx, ids, now);
    const rows = [...decisions.values()];
    const staffName = (id: string | null) => {
      if (!id) return '(none)';
      const s = ctx.staff.get(id);
      return s ? pcpDisplayName(s) : `(unknown user ${id})`;
    };

    console.log(`\n=== Organization ${org.id} (${org.name}) — ${rows.length} primary care patients ===`);

    // 1. Counts per status
    console.log('\n1. Status counts');
    const byStatus = new Map<PcpStatus, PcpClientDecision[]>();
    for (const r of rows) byStatus.set(r.decision.status, [...(byStatus.get(r.decision.status) ?? []), r]);
    for (const s of PCP_STATUSES) console.log(`   ${s.padEnd(18)} ${byStatus.get(s)?.length ?? 0}`);
    const textOnly = rows.filter((r) => r.decision.current?.source === 'assigned_pcp_text');
    const multi = rows.filter((r) => r.pcpMemberCount > 1);
    console.log(`   current PCP from assignedPcp text only (no care team member yet): ${textOnly.length} (${textOnly.filter((r) => !r.decision.current?.userId).length} not a staff user)`);
    console.log(`   charts with more than one PCP care team member: ${multi.length}`);

    // 2. Provider code mapping
    console.log('\n2. Valant provider code -> staff mapping (ValantProviderMap)');
    const codeGroups = await prisma.valantTransaction.groupBy({
      by: ['providerCode'],
      where: { organizationId: org.id, category: 'charge', facility: { equals: PRIMARY_CARE_VALANT_FACILITY, mode: 'insensitive' } },
      _count: { _all: true },
    });
    const merged = new Map<string, { code: string; rows: number }>();
    for (const g of codeGroups) {
      const key = providerCodeKey(g.providerCode);
      const m = merged.get(key) ?? { code: String(g.providerCode ?? '').trim() || '(blank)', rows: 0 };
      m.rows += g._count._all;
      merged.set(key, m);
    }
    // encounters (provider-days) per unmapped code, from the decisions
    const unmappedEncounters = new Map<string, number>();
    for (const r of rows) for (const t of r.summary.tallies) if (!t.userId && t.code) unmappedEncounters.set(providerCodeKey(t.code), (unmappedEncounters.get(providerCodeKey(t.code)) ?? 0) + t.total);
    const sorted = [...merged.entries()].sort((a, b) => b[1].rows - a[1].rows);
    for (const [key, m] of sorted) {
      const uid = key ? ctx.codeMap.get(key) ?? null : null;
      const who = uid ? `${staffName(uid)}${isPcpEligible(ctx.staff.get(uid)) ? '' : '  [NOT a medical provider / inactive]'}` : 'UNMAPPED';
      console.log(`   ${m.code.padEnd(22)} ${String(m.rows).padStart(6)} Family Practice charge rows -> ${who}${uid ? '' : `  (${unmappedEncounters.get(key) ?? 0} encounters on primary care patients)`}`);
    }
    if (!sorted.length) console.log('   (no Family Practice charges imported)');
    const unmappedCount = sorted.filter(([k]) => k && !ctx.codeMap.get(k)).length;
    console.log(`   ${unmappedCount} unmapped code(s). Map them in Admin > Data import > Valant provider codes.`);

    // 3. Per provider: current vs evidence
    console.log('\n3. Patients per provider (current PCP vs evidence PCP)');
    const per = new Map<string, { current: number; evidence: number }>();
    const bump = (k: string, f: 'current' | 'evidence') => {
      const v = per.get(k) ?? { current: 0, evidence: 0 };
      v[f] += 1;
      per.set(k, v);
    };
    for (const r of rows) {
      if (r.decision.current?.userId) bump(`u:${r.decision.current.userId}`, 'current');
      else if (r.decision.current) bump('text:(text only, not a staff user)', 'current');
      const ev = r.decision.evidence;
      if (ev) bump(ev.userId ? `u:${ev.userId}` : `c:${ev.code}`, 'evidence');
    }
    for (const [k, v] of [...per.entries()].sort((a, b) => b[1].evidence + b[1].current - a[1].evidence - a[1].current)) {
      const label = k.startsWith('u:') ? staffName(k.slice(2)) : k.startsWith('c:') ? `Valant code ${k.slice(2)} (unmapped)` : k.slice(5);
      console.log(`   ${label.padEnd(40)} current ${String(v.current).padStart(5)}   evidence ${String(v.evidence).padStart(5)}`);
    }

    // 4. Sample mismatches (ids / MRNs only)
    console.log(`\n4. Sample mismatches (first ${samples}; client id / MRN only)`);
    for (const r of (byStatus.get('MISMATCH') ?? []).slice(0, samples)) {
      const ev = r.decision.evidence!;
      console.log(
        `   client=${r.clientId} mrn=${r.mrn ?? '-'} current=${r.decision.current?.userId} -> evidence=${ev.userId} ` +
          `(${ev.inWindow} in 12 mo, ${ev.total} total, last ${ev.lastDate}; basis ${r.decision.basis})`
      );
    }

    // 5. Current PCP is not a medical provider, or is inactive
    console.log('\n5. Current PCP is not a medical provider (PHYSICIAN / MEDICAL_NP) or is deactivated');
    const bad = rows.filter((r) => r.decision.current?.userId && !isPcpEligible(ctx.staff.get(r.decision.current.userId)));
    for (const r of bad) {
      const s = ctx.staff.get(r.decision.current!.userId!);
      console.log(`   client=${r.clientId} mrn=${r.mrn ?? '-'} pcp=${r.decision.current!.userId} (${s ? `${s.role}, ${s.status}` : 'not in this organization'})`);
    }
    if (!bad.length) console.log('   none');

    // Extra context for staff review
    const nonMedical = new Map<string, number>();
    let unattributed = 0;
    for (const r of rows) {
      unattributed += r.summary.unattributedVisits;
      for (const [id, n] of r.summary.nonMedical) nonMedical.set(id, (nonMedical.get(id) ?? 0) + n);
    }
    console.log('\nNotes');
    console.log(`   medical visits with no provider recorded (not counted): ${unattributed}`);
    for (const [id, n] of nonMedical) console.log(`   ${n} primary care encounters by ${staffName(id)} (not a medical provider; not counted as PCP evidence)`);
    console.log(`   AMBIGUOUS: ${byStatus.get('AMBIGUOUS')?.length ?? 0}, NO_EVIDENCE: ${byStatus.get('NO_EVIDENCE')?.length ?? 0}, UNMAPPED_PROVIDER: ${byStatus.get('UNMAPPED_PROVIDER')?.length ?? 0} need staff review (fix script never changes them).`);
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
