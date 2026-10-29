/**
 * Counts-only dry run of the Valant reference-only report parsers over local export files.
 * Prints no patient names or IDs. Usage:
 *   npx tsx scripts/valant-reference-counts.ts <aging.csv> <prepayments.csv> <copays.csv> <insurance-aging.csv> <combined-aging.csv> <transactions.csv> <authorizations.csv>
 * Pass '-' to skip a file.
 */
import fs from 'node:fs';
import { parseCsvText } from '../src/lib/migration/valantReportCommon';
import { parseAgingReport, PATIENT_AGING_LAYOUT, INSURANCE_AGING_LAYOUT } from '../src/lib/migration/valantAging';
import { parsePrepaymentReport } from '../src/lib/migration/valantPrepayments';
import { parseCopayReport } from '../src/lib/migration/valantCopays';
import { parseCombinedAgingReport } from '../src/lib/migration/valantCombinedAging';
import { checkPatientSubtotals, chunkByPatient, isTransactionHeader, occurrenceNumbers, parseTransactionRow, type ValantTxnRow } from '../src/lib/migration/valantTransactions';
import { authIsExpired, parseAuthorizationReport } from '../src/lib/migration/valantAuthorizations';
import { reportMoneyToCents } from '../src/lib/migration/valantReportCommon';

const [agingPath, prepayPath, copayPath, insPath, combinedPath, txPath, authPath] = process.argv.slice(2);
const read = (p?: string) => (p && fs.existsSync(p) ? parseCsvText(fs.readFileSync(p, 'utf8')) : null);
const usd = (c: number | null) => (c == null ? 'n/a' : (c / 100).toFixed(2));

function aging(label: string, recs: string[][] | null, layout = PATIENT_AGING_LAYOUT) {
  if (!recs) return console.log(`${label}: file not found`);
  const a = parseAgingReport(recs, layout);
  console.log(`${label}:`, JSON.stringify({
    ok: a.ok, error: a.error, asOf: a.asOf?.toISOString().slice(0, 10), rows: a.rows.length, errors: a.errors.length,
    rowsWithBucketMismatch: a.rowsWithBucketMismatch, distinctKeys: new Set(a.rows.map((r) => r.key)).size,
    columnSums: a.columnSumsCents.map(usd), total: usd(a.totalSumCents),
    report: a.reportBucketsCents.map(usd), reportTotal: usd(a.reportTotalCents),
    inconsistentReportCells: a.inconsistentReportCells, reconcile: a.reconcile,
    negativeBucketCells: a.rows.reduce((n, r) => n + r.bucketsCents.filter((c) => c < 0).length, 0),
  }));
}
aging('Patient aging', read(agingPath));
aging('Insurance aging', read(insPath), INSURANCE_AGING_LAYOUT);

const pre = read(prepayPath);
if (pre) {
  const p = parsePrepaymentReport(pre);
  const byName = new Map<string, number>();
  for (const t of p.txns) byName.set(t.valantName.toLowerCase(), (byName.get(t.valantName.toLowerCase()) ?? 0) + t.amountCents);
  console.log('Prepayments:', JSON.stringify({
    ok: p.ok, error: p.error, period: [p.periodStart?.toISOString().slice(0, 10), p.periodEnd?.toISOString().slice(0, 10)],
    rows: p.txns.length, errors: p.errors.length, received: p.received, applied: p.applied,
    sum: usd(p.sumCents), reportNet: usd(p.reportNetCents), reconciles: p.reconciles, distinctNames: p.distinctNames,
    patientIdColumn: p.patientIdCol !== null, distinctHashes: new Set(p.txns.map((t) => t.rowHash)).size,
    namesWithNegativeNet: [...byName.values()].filter((v) => v < 0).length,
    namesWithPositiveNet: [...byName.values()].filter((v) => v > 0).length,
    namesWithZeroNet: [...byName.values()].filter((v) => v === 0).length,
    types: [...new Set(p.txns.map((t) => t.type))],
  }));
}

const cp = read(copayPath);
if (cp) {
  const c = parseCopayReport(cp);
  console.log('Copays:', JSON.stringify({
    ok: c.ok, error: c.error, rules: c.rules.length, errors: c.errors.length, duplicateKeys: c.duplicateKeys,
    conflictingDuplicates: c.conflictingDuplicates, distinctPatients: c.distinctPatients, distinctPayers: c.distinctPayers,
    providerTypes: [...new Set(c.rules.map((r) => r.providerType))], cptRules: [...new Set(c.rules.map((r) => r.cptRule))],
    limitValues: [...new Set(c.rules.map((r) => r.valantLimitRaw))].length,
    amountsDistinct: [...new Set(c.rules.map((r) => r.amountCents))].length,
  }));
}

const ca = read(combinedPath);
if (ca) {
  const c = parseCombinedAgingReport(ca);
  console.log('Combined aging:', JSON.stringify({
    ok: c.ok, error: c.error, asOf: c.asOf?.toISOString().slice(0, 10), csvRows: ca.length - 1, blocks: c.blocks,
    partyRows: c.partyRows.length, patients: c.patients.length, errors: c.errors.length, partyCounts: c.partyCounts,
    maxPartyRowsPerPatient: Math.max(0, ...Object.values(c.partyRows.reduce<Record<string, number>>((m, r) => ((m[r.valantPatientId] = (m[r.valantPatientId] ?? 0) + 1), m), {}))),
    patientBucketSums: c.patientBucketSumsCents.map(usd), patientTotal: usd(c.patientTotalSumCents), partyTotal: usd(c.partyTotalSumCents),
    report: c.reportBucketsCents.map(usd), grand: usd(c.reportGrandTotalCents),
    partyRowsWithBucketMismatch: c.partyRowsWithBucketMismatch, patientsWithPartyMismatch: c.patientsWithPartyMismatch,
    patientsInconsistent: c.patientsInconsistent, reconcile: c.reconcile,
    distinctPayers: new Set(c.partyRows.map((r) => r.payerName).filter(Boolean)).size,
  }));
}

const tx = read(txPath);
if (tx) {
  const data = tx.slice(1);
  const rows: ValantTxnRow[] = [];
  let errors = 0;
  for (const c of data) {
    const r = parseTransactionRow(c);
    if (r.row) rows.push(r.row);
    else errors += 1;
  }
  const sum = rows.reduce((s, r) => s + r.amountCents, 0);
  const sub = checkPatientSubtotals(rows);
  const dates = rows.map((r) => r.serviceDate?.toISOString().slice(0, 10)).filter(Boolean).sort();
  const byCat: Record<string, [number, string]> = {};
  for (const r of rows) {
    const e = (byCat[r.category] ??= [0, '0']);
    e[0] += 1;
    e[1] = (Number(e[1]) + r.amountCents / 100).toFixed(2);
  }
  const codes = new Map<string, { n: number; cat: string }>();
  for (const r of rows) codes.set(r.code, { n: (codes.get(r.code)?.n ?? 0) + 1, cat: r.category });
  console.log('Transactions:', JSON.stringify({
    headerOk: isTransactionHeader(tx[0]), label: data[0]?.[0], rows: rows.length, errors, patients: sub.patients,
    sum: usd(sum), reportTotal: usd(reportMoneyToCents(data[0]?.[7] ?? '')), reconciles: sum === reportMoneyToCents(data[0]?.[7] ?? ''),
    subtotalMismatches: sub.mismatched.length, subtotalInconsistent: sub.inconsistent.length,
    serviceDates: [dates[0], dates[dates.length - 1]], identicalRowRepeats: occurrenceNumbers(rows).filter((n) => n > 1).length,
    chunks2000: chunkByPatient(data, 2000).length, distinctCodes: codes.size, byCategory: byCat,
  }));
  if (process.env.SHOW_CODES) for (const [k, v] of [...codes].sort((a, b) => a[1].cat.localeCompare(b[1].cat) || b[1].n - a[1].n)) console.log(`  ${v.cat}	${k}	${v.n}`);
}

const au = read(authPath);
if (au) {
  const a = parseAuthorizationReport(au);
  const today = new Date();
  console.log('Authorizations:', JSON.stringify({
    ok: a.ok, error: a.error, reportDate: a.reportDate?.toISOString().slice(0, 10), rows: a.auths.length, errors: a.errors.length,
    patients: a.distinctPatients, payers: a.distinctPayers, sharedAuthKeys: a.sharedAuthKeys,
    expired: a.auths.filter((x) => authIsExpired(x, today)).length, overLimit: a.auths.filter((x) => x.overLimit).length,
    lowVisitWarning: a.auths.filter((x) => x.remainingWarning).length, blankStart: a.auths.filter((x) => !x.startDate).length,
    blankEnd: a.auths.filter((x) => !x.endDate).length,
  }));
}
