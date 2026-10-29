/**
 * READ-ONLY correctness check for the Service Eligibility Scanner. Never writes (SELECT only; the
 * scan runs in memory and is not stored; no audit rows).
 *
 *   npx tsx --conditions=react-server --env-file=.env scripts/check-service-eligibility.ts
 *   ... --org=<organizationId>   required when the database has more than one organization
 *   ... --samples=5              sample candidates per program (default 5)
 *
 * Output: client ids, MRNs, codes, scores and counts only — no names, no free text, no dates.
 * Sections:
 *   1. Data quality: active / inactive clients, no diagnoses, malformed or unknown ICD-10 codes,
 *      missing DOB, missing location / Valant facility, duplicates, medication / PHQ-9 / billing coverage
 *   2. Per program: status counts, worklist tiers (actionable / needs data / diagnosis only), exclusions and why (enrolled by record vs. billing, minor,
 *      contraindication, no qualifying diagnosis, level of care, inactive, dismissed / snoozed),
 *      data gaps behind "potential"
 *   3. Page tiles vs. drill-down list (lib/clinical/serviceEligibility/view.ts, the page's own code)
 *      for every program × status, on the stored snapshot (what the page shows) and on the live scan;
 *      snapshot drift vs. live
 *   4. Samples: id + MRN + the evidence codes each rule fired on
 *   5. Self-consistency: the diagnosis criterion re-derived from a raw SQL token query and an
 *      independent classifier (not codes.ts) — mismatches flagged with client ids
 *
 * Imports plain lib modules only (no next-auth / next/navigation chains).
 */
import { prisma } from '@/lib/db/prisma';
import { clientOrgFilter } from '@/lib/clients/orgScope';
import { getPracticeTimeZone } from '@/lib/time/practiceTimeServer';
import { loadIcd10CodeSet } from '@/lib/icd10/codeSet';
import { lookupIcd10 } from '@/lib/icd10/search';
import { runServiceEligibilityScan } from '@/lib/clinical/serviceEligibility/load';
import { ACUTE_QUERY, extractIcdCodes, normalizeIcd } from '@/lib/clinical/serviceEligibility/codes';
import { PRP_DX_CODES } from '@/lib/prp/dxCodes';
import { buildScannerRows, decisionState } from '@/lib/clinical/serviceEligibility/snapshot';
import { DEFAULT_FILTERS, listRows, tileCounts, tierCounts, tierOf, activeDecision, inTier, TIERS, type ScannerRow, type ViewFilters } from '@/lib/clinical/serviceEligibility/view';
import { ELIGIBILITY_STATUSES, PROGRAMS, type EligibilityStatus, type ProgramKey, type ProgramResult, type ScannedClient } from '@/lib/clinical/serviceEligibility/types';

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const pad = (s: string | number, n: number) => String(s).padEnd(n);
const num = (n: number | bigint | null | undefined) => Number(n ?? 0);
let problems = 0;
const flag = (ok: boolean, detail = '') => {
  if (!ok) problems += 1;
  return ok ? 'ok' : `MISMATCH${detail ? ` ${detail}` : ''}`;
};

function table(title: string, header: string[], rows: (string | number)[][]) {
  console.log(`\n=== ${title} ===`);
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i] ?? '').length)) + 2);
  console.log(header.map((h, i) => pad(h, widths[i])).join(''));
  for (const r of rows) console.log(r.map((c, i) => pad(c, widths[i])).join(''));
}

// ─── Independent diagnosis classifiers (deliberately NOT codes.ts) ───────────
// Input: dot-less upper-case ICD-10 tokens straight from SQL.
// F41.9 never qualifies on its own (clinic rule, see codes.ts); other listed codes do (Category B needs impairment, checked separately)
const PRP_LIST = new Set(PRP_DX_CODES.map((d) => d.code.replace('.', '')).filter((c) => c !== 'F419'));
const indep: Record<ProgramKey, (t: string) => boolean> = {
  prp: (t) => PRP_LIST.has(t) || /^F2\d/.test(t) || (/^F30/.test(t) && !/^F304/.test(t)) || (/^F31/.test(t) && !/^F317/.test(t)) || t === 'F322' || t === 'F323' || (/^F33/.test(t) && !/^F334/.test(t)),
  // MDD, not remission (F32.4/5, F33.4x), not F32.8x / F32.A
  tms: (t) => /^F32[0-39]?$/.test(t) || /^F33[0-389]?$/.test(t),
  spravato: (t) => /^F32[0-39]?$/.test(t) || /^F33[0-389]?$/.test(t),
  aot: (t) => /^F2\d/.test(t) || /^F31/.test(t) || ['F323', 'F333', 'F332'].includes(t),
  residential: (t) => /^F1[0-689]/.test(t) && !/^F1\d[129]1$/.test(t),
  iop: (t) => /^F1[0-689]/.test(t) && !/^F1\d[129]1$/.test(t),
};
/** Text the evaluator writes when the diagnosis criterion itself fails */
const DX_FAIL: Record<ProgramKey, RegExp> = {
  prp: /No diagnosis on the PRP priority-population list/,
  tms: /No active major depressive disorder diagnosis/,
  spravato: /No active major depressive disorder diagnosis/,
  aot: /No serious and persistent mental illness diagnosis/,
  residential: /No substance use disorder diagnosis|SUD diagnoses charted are in remission/,
  iop: /No substance use disorder diagnosis|SUD diagnoses charted are in remission/,
};

function exclusionReason(r: ProgramResult): string {
  if (r.status === 'enrolled') return r.evidence.some((e) => e.kind === 'billing') ? 'enrolled (billing)' : 'enrolled (record)';
  if (r.status === 'screen') return 'dx only';
  if (r.status !== 'not_indicated') return r.status;
  const u = r.unmet.join(' | ');
  if (DX_FAIL[r.program].test(u)) return 'no qualifying dx';
  if (/History prong not shown/.test(u)) return 'no acute history';
  if (/without documented functional impairment/.test(u)) return 'cat B no impairment';
  if (/under 18/.test(u)) return 'minor';
  if (/contraindication|Implanted device/i.test(u)) return 'contraindication';
  if (/level of care/i.test(u)) return 'ASAM level elsewhere';
  if (/residential treatment/i.test(u)) return 'in residential';
  return 'other unmet';
}

/** Evidence as codes / scores only (no labels, no dates) */
function evidenceCodes(r: ProgramResult): string {
  const out: string[] = [];
  for (const e of r.evidence) {
    const icd = extractIcdCodes(e.text).filter((c) => !/^F\d$/.test(c));
    const cpt = (e.text.match(/\b(?:[A-Z]\d{4}|\d{5})\b/g) ?? []).filter((c) => !icd.includes(normalizeIcd(c) ?? ''));
    const score = e.text.match(/\b(PHQ-9|LOCUS composite|C-SSRS)\s*:?\s*(\d+|[a-z ]+)?/i);
    const asam = e.kind === 'note' ? (e.text.match(/D\d [0-4–]/g) ?? []).join(' ') : '';
    const bits = [...icd, ...cpt, score ? `${score[1]}${score[2] ? `=${score[2].trim()}` : ''}` : '', asam].filter(Boolean);
    out.push(`${e.kind}${bits.length ? `:${bits.join('+')}` : ''}${e.date ? '' : '(undated)'}`);
  }
  return out.join(', ') || '(none)';
}

async function main() {
  const orgs = await prisma.organization.findMany({ select: { id: true } });
  const organizationId = arg('org') ?? (orgs.length === 1 ? orgs[0].id : undefined);
  if (!organizationId) {
    console.error(`More than one organization (${orgs.length}); pass --org=<id>`);
    process.exitCode = 1;
    return;
  }
  const sampleN = Number(arg('samples') ?? 5);
  const timeZone = await getPracticeTimeZone(organizationId);
  const now = new Date();
  const orgWhere = clientOrgFilter(organizationId);
  console.log(`Service Eligibility check — org ${organizationId} — ${now.toISOString()} — practice TZ ${timeZone}`);

  // ─── 1. Data quality ───────────────────────────────────────────────────────
  const all = await prisma.client.findMany({
    where: orgWhere,
    select: {
      id: true, mrn: true, status: true, dateOfBirth: true, locationId: true, valantFacility: true, sourceId: true,
      primaryDiagnosisCode: true, secondaryDiagnoses: true, legalFirstName: true, legalLastName: true, name: true,
    },
  });
  const active = all.filter((c) => c.status === 'ACTIVE');
  const activeIds = active.map((c) => c.id);
  const problemsRows = activeIds.length
    ? await prisma.medicalProblem.findMany({ where: { clientId: { in: activeIds }, resolvedDate: null }, select: { clientId: true, icd10Code: true } })
    : [];
  const probBy = new Map<string, string[]>();
  for (const p of problemsRows) probBy.set(p.clientId, [...(probBy.get(p.clientId) ?? []), p.icd10Code ?? '']);
  let codeSet: ReturnType<typeof loadIcd10CodeSet> | null = null;
  try {
    codeSet = loadIcd10CodeSet();
  } catch {
    console.log('(ICD-10 code set not found — skipping "unknown code" check)');
  }
  let noDx = 0, malformed = 0, unknown = 0, nonBillable = 0, f32a = 0;
  const malformedSamples: string[] = [];
  for (const c of active) {
    const fields = [c.primaryDiagnosisCode, c.secondaryDiagnoses, ...(probBy.get(c.id) ?? [])].filter(Boolean) as string[];
    const codes = fields.flatMap((f) => extractIcdCodes(f));
    if (!codes.length) noDx += 1;
    for (const f of fields) {
      for (const tok of f.split(/[,;\s]+/).filter(Boolean)) {
        if (!normalizeIcd(tok)) {
          malformed += 1;
          if (malformedSamples.length < 5) malformedSamples.push(`${c.id}:${tok.slice(0, 12)}`);
        }
      }
    }
    for (const code of codes) {
      if (code === 'F32.A') f32a += 1;
      if (!codeSet) continue;
      const hit = lookupIcd10(codeSet.index, code);
      if (!hit) unknown += 1;
      else if (!hit.billable) nonBillable += 1;
    }
  }
  const dupKey = (k: (c: (typeof all)[number]) => string | null) => {
    const m = new Map<string, number>();
    for (const c of active) {
      const key = k(c);
      if (key) m.set(key, (m.get(key) ?? 0) + 1);
    }
    return [...m.values()].filter((n) => n > 1).reduce((a, n) => a + n, 0);
  };
  const [medCov] = await prisma.$queryRaw<{ n: bigint }[]>`SELECT COUNT(DISTINCT m."clientId")::bigint AS n FROM "ClientMedication" m JOIN "Client" c ON c.id = m."clientId" WHERE c.id = ANY(${activeIds})`;
  const [phqCov] = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(DISTINCT x.cid)::bigint AS n FROM (
      SELECT "clientId" AS cid FROM "ClinicalAssessmentRecord" WHERE "organizationId" = ${organizationId} AND "createdAt" >= now() - interval '90 days' AND ("instrumentId" = 'phq-9' OR "instrumentName" ILIKE '%PHQ-9%')
      UNION SELECT r."clientId" FROM "MeasurementResult" r JOIN "MeasurementType" t ON t.id = r."measurementTypeId" WHERE r."organizationId" = ${organizationId} AND r."measuredAt" >= now() - interval '90 days' AND t."instrumentKey" IN ('phq-9','phq9') AND t."isSubscore" = false
    ) x WHERE x.cid = ANY(${activeIds})`;
  const [locusCov] = await prisma.$queryRaw<{ n: bigint }[]>`SELECT COUNT(DISTINCT "clientId")::bigint AS n FROM "LocusAssessmentRecord" WHERE "organizationId" = ${organizationId} AND "clientId" = ANY(${activeIds}) AND "assessmentDate" >= now() - interval '365 days'`;
  const [acuteCov] = await prisma.$queryRaw<{ billed: bigint; crisis: bigint }[]>`
    SELECT
      (SELECT COUNT(DISTINCT "clientId") FROM "ValantTransaction" WHERE "organizationId" = ${organizationId} AND category = 'charge' AND "clientId" = ANY(${activeIds})
         AND "serviceDate" >= now() - interval '36 months' AND (pos = ANY(${[...ACUTE_QUERY.pos]}) OR "codeBase" = ANY(${[...ACUTE_QUERY.codes]})))::bigint AS billed,
      (SELECT COUNT(DISTINCT "clientId") FROM "CrisisEpisode" WHERE "organizationId" = ${organizationId} AND "clientId" = ANY(${activeIds}) AND "startedAt" >= now() - interval '36 months')::bigint AS crisis`;
  const [txnCov] = await prisma.$queryRaw<{ n: bigint }[]>`SELECT COUNT(DISTINCT "clientId")::bigint AS n FROM "ValantTransaction" WHERE "organizationId" = ${organizationId} AND category = 'charge' AND "clientId" = ANY(${activeIds}) AND "serviceDate" >= now() - interval '365 days'`;
  const [unmatchedTxn] = await prisma.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*)::bigint AS n FROM "ValantTransaction" WHERE "organizationId" = ${organizationId} AND category = 'charge' AND "clientId" IS NULL`;
  table('1. Data quality (active clients unless noted)', ['metric', 'count'], [
    ['clients in org (all statuses)', all.length],
    ['active clients', active.length],
    ['inactive / other status (excluded from every program)', all.length - active.length],
    ['active with no diagnosis code (chart fields + problem list)', noDx],
    ['malformed diagnosis tokens (not ICD-10 shaped)', malformed],
    ['codes not in the FY2027 ICD-10-CM set', codeSet ? unknown : 'n/a'],
    ['non-billable (header) codes', codeSet ? nonBillable : 'n/a'],
    ['F32.A "depression, unspecified" (not counted as MDD)', f32a],
    ['missing date of birth', active.filter((c) => !c.dateOfBirth).length],
    ['missing location (Client.locationId)', active.filter((c) => !c.locationId).length],
    ['missing Valant facility', active.filter((c) => !c.valantFacility).length],
    ['duplicate Valant source id (clients involved)', dupKey((c) => (c.sourceId ? c.sourceId.toUpperCase() : null))],
    ['duplicate MRN (clients involved)', dupKey((c) => c.mrn)],
    ['possible duplicates: same legal name + DOB (clients involved)', dupKey((c) => (c.dateOfBirth ? `${(c.legalLastName || c.name).toLowerCase()}|${(c.legalFirstName || '').toLowerCase()}|${c.dateOfBirth.toISOString().slice(0, 10)}` : null))],
    ['with >= 1 medication on file (Valant med import not loaded)', num(medCov?.n)],
    ['with PHQ-9 in last 90 days (assessments + measurements)', num(phqCov?.n)],
    ['with Valant charges in last 365 days', num(txnCov?.n)],
    ['Valant charges not matched to a client (org-wide rows)', num(unmatchedTxn?.n)],
    ['with LOCUS in the last 12 months (PRP functional impairment)', num(locusCov?.n)],
    ['with billed inpatient / ED / crisis lines, 36 months (AOT history)', num(acuteCov?.billed)],
    ['with a mobile crisis episode, 36 months (AOT history)', num(acuteCov?.crisis)],
  ]);
  if (malformedSamples.length) console.log(`malformed token samples (client id:token): ${malformedSamples.join('  ')}`);

  // ─── live scan (in memory) ────────────────────────────────────────────────
  const t0 = Date.now();
  const live: ScannedClient[] = [];
  const scan = await runServiceEligibilityScan({
    db: prisma, organizationId, clientWhere: orgWhere, lockedIds: async () => new Set<string>(), now, timeZone,
    onBatch: async (rows) => { live.push(...rows); },
  });
  console.log(`\nLive scan: ${scan.clientsScanned} active clients in ${Date.now() - t0} ms${scan.truncated ? ' — TRUNCATED at MAX_CLIENTS' : ''}`);
  console.log(`check: scanned = active clients → ${flag(scan.clientsScanned === active.length, `${scan.clientsScanned} vs ${active.length}`)}`);

  const decisions = await prisma.serviceEligibilityDecision
    .findMany({ where: { organizationId }, select: { clientId: true, program: true, action: true, reason: true, reasonNote: true, snoozeUntil: true, outcome: true, decidedAt: true, decidedById: true } })
    .catch(() => {
      console.log('(service_eligibility_decisions table missing — run prisma/migrations/20261019_scanner_service_eligibility.sql)');
      return [];
    });

  // ─── 2. Per program ────────────────────────────────────────────────────────
  // Inactive clients that would meet the diagnosis criterion (independent SQL tokens)
  const tokenRows = await prisma.$queryRaw<{ id: string; status: string; tokens: string[] | null }[]>`
    SELECT c.id, c.status::text AS status,
           ARRAY(
             SELECT DISTINCT (regexp_matches(upper(replace(src.t, '.', '')), '([A-TV-Z][0-9][0-9AB][0-9A-Z]{0,4})', 'g'))[1]
             FROM (
               SELECT c."primaryDiagnosisCode" AS t UNION ALL SELECT c."secondaryDiagnoses"
               UNION ALL SELECT p."icd10Code" FROM "MedicalProblem" p
                WHERE p."clientId" = c.id AND p."resolvedDate" IS NULL
                  AND COALESCE(p.status, '') !~* '(resolved|inactive|entered\\s+in\\s+error|deleted|historical|ruled\\s+out)'
             ) src WHERE src.t IS NOT NULL
           ) AS tokens
      FROM "Client" c
     WHERE c.id = ANY(${all.map((c) => c.id)})`;
  const tokensBy = new Map(tokenRows.map((r) => [r.id, r.tokens ?? []]));
  const inactiveQualifying = (p: ProgramKey) => tokenRows.filter((r) => r.status !== 'ACTIVE' && (r.tokens ?? []).some(indep[p])).length;

  const decBy = new Map<string, (typeof decisions)[number]>();
  for (const d of decisions) decBy.set(`${d.clientId}:${d.program}`, d);
  const rows: (string | number)[][] = [];
  const gapRows: (string | number)[][] = [];
  for (const p of PROGRAMS) {
    const st = Object.fromEntries(ELIGIBILITY_STATUSES.map((s) => [s, 0])) as Record<EligibilityStatus, number>;
    const why = new Map<string, number>();
    const gaps = new Map<string, number>();
    let dismissed = 0, snoozed = 0;
    for (const c of live) {
      const r = c.results[p];
      st[r.status] += 1;
      const w = exclusionReason(r);
      why.set(w, (why.get(w) ?? 0) + 1);
      if (r.status === 'potential') for (const g of r.gaps) gaps.set(g, (gaps.get(g) ?? 0) + 1);
      const d = decBy.get(`${c.id}:${p}`);
      if (d?.action === 'dismissed') dismissed += 1;
      if (d?.action === 'snoozed' && d.snoozeUntil && d.snoozeUntil > now) snoozed += 1;
    }
    const tierN = { actionable: 0, needs_data: 0, dx_only: 0 };
    for (const c of live) {
      const t = tierOf(c.results[p].status, c.results[p].gaps.length);
      if (t && t !== 'enrolled') tierN[t] += 1;
    }
    rows.push([p, st.candidate, st.review, st.potential, st.screen, st.enrolled, st.not_indicated,
      tierN.actionable, tierN.needs_data, tierN.dx_only,
      why.get('enrolled (record)') ?? 0, why.get('enrolled (billing)') ?? 0, why.get('no qualifying dx') ?? 0, why.get('minor') ?? 0,
      why.get('contraindication') ?? 0, (why.get('ASAM level elsewhere') ?? 0) + (why.get('in residential') ?? 0),
      why.get('no acute history') ?? 0, why.get('cat B no impairment') ?? 0, why.get('other unmet') ?? 0,
      inactiveQualifying(p), dismissed, snoozed]);
    gapRows.push([p, [...gaps].sort((a, b) => b[1] - a[1]).map(([g, n]) => `${g}=${n}`).join(' ') || '-']);
  }
  table('2. Per program (live scan, all active clients, org-wide)', ['program', 'cand', 'review', 'potent', 'dx-only', 'enroll', 'not_ind', 'T:action', 'T:needs', 'T:dxonly', 'enr:record', 'enr:billing', 'x:no-dx', 'x:minor', 'x:contra', 'x:level', 'x:no-acute', 'x:catB', 'x:other', 'x:inactive*', 'dismissed', 'snoozed'], rows);
  console.log('T:* = worklist tier (actionable = candidate / review / potential with <= 1 data gap; needs = potential with 2+ gaps; dxonly = diagnosis only - screen)');
  console.log('* inactive clients whose diagnoses would meet the criterion (excluded because not ACTIVE)');
  table('2b. Data gaps behind "potential" (clients per gap)', ['program', 'gaps'], gapRows);

  // ─── 3. Tiles vs list ──────────────────────────────────────────────────────
  const tileCheck = (label: string, scannerRows: ScannerRow[], base: ViewFilters) => {
    const out: (string | number)[][] = [];
    for (const tier of TIERS) {
      const f = { ...base, tier };
      const tiles = tileCounts(scannerRows, f, now);
      const tc = tierCounts(scannerRows, f, now);
      for (const p of PROGRAMS) {
        for (const s of ['candidate', 'potential', 'review', 'screen', 'enrolled'] as const) {
          const list = listRows(scannerRows, { ...f, program: p, status: s }, now).length;
          // Independent recount straight from the rows (no listRows / tileCounts / tier code)
          const recount = scannerRows.filter((r) => {
            if (r.statuses[p] !== s) return false;
            const g = r.gaps[p]?.length ?? 0;
            const inT =
              tier === 'all' ? true
              : tier === 'actionable' ? s === 'enrolled' || s === 'candidate' || s === 'review' || (s === 'potential' && g <= 1)
              : tier === 'needs_data' ? s === 'potential' && g > 1
              : s === 'screen';
            if (!inT) return false;
            const d = activeDecision(r, p, now);
            return !(f.workflow === 'open' && d && (d.action === 'dismissed' || d.action === 'snoozed'));
          }).length;
          if (tiles[p][s] || list || recount) out.push([tier, p, s, tiles[p][s], list, recount, flag(tiles[p][s] === list && list === recount)]);
        }
        const programList = listRows(scannerRows, { ...f, program: p, status: 'all' }, now).length;
        const tileSum = tiles[p].candidate + tiles[p].potential + tiles[p].review + tiles[p].screen + (tier === 'all' ? tiles[p].enrolled : 0);
        out.push([tier, p, '(card click: all)', tileSum, programList, '', flag(tileSum === programList)]);
        if (tier !== 'all') out.push([tier, p, '(tier selector)', tc[p][tier], programList, '', flag(tc[p][tier] === programList)]);
      }
      if (tier !== 'all') {
        const allList = listRows(scannerRows, { ...f, program: 'all', status: 'all' }, now).length;
        out.push([tier, 'all', '(tier selector)', tc.all[tier], allList, '', flag(tc.all[tier] === allList)]);
      }
    }
    table(label, ['tier', 'program', 'status', 'tile', 'list rows', 'recount', 'check'], out);
  };
  const liveRows = buildScannerRows(
    active.map((c) => ({ id: c.id, name: c.id, mrn: c.mrn, assignedTo: null, location: null })),
    live.map((c) => ({
      clientId: c.id,
      statuses: Object.fromEntries(PROGRAMS.map((p) => [p, c.results[p].status])),
      anyIndicated: PROGRAMS.some((p) => c.results[p].status !== 'not_indicated'),
      summary: { priority: c.priority, gaps: Object.fromEntries(PROGRAMS.map((p) => [p, c.results[p].gaps])) },
      scannedAt: now,
    })),
    decisions.map((d) => ({ ...d }))
  ).rows;
  tileCheck('3a. Tiles vs drill-down — live scan, open worklist (dismissed / snoozed hidden), every tier', liveRows, DEFAULT_FILTERS);

  const snaps = await prisma.serviceEligibilitySnapshot
    .findMany({ where: { organizationId }, select: { clientId: true, statuses: true, anyIndicated: true, summary: true, scannedAt: true } })
    .catch(() => null);
  if (!snaps) console.log('\n(service_eligibility_snapshots table missing — the page cannot load until the migration runs)');
  else if (!snaps.length) console.log('\n(no snapshot yet — run scripts/service-eligibility-scan.ts or open the page once)');
  else {
    const built = buildScannerRows(active.map((c) => ({ id: c.id, name: c.id, mrn: c.mrn, assignedTo: null, location: null })), snaps, decisions);
    tileCheck('3b. Tiles vs drill-down — stored snapshot (what the page shows to leadership)', built.rows, DEFAULT_FILTERS);
    const liveBy = new Map(live.map((c) => [c.id, c]));
    let drift = 0;
    const driftIds: string[] = [];
    for (const s of snaps) {
      const l = liveBy.get(s.clientId);
      if (!l) continue;
      const st = s.statuses as Record<string, string>;
      if (PROGRAMS.some((p) => (st[p] ?? 'not_indicated') !== l.results[p].status)) {
        drift += 1;
        if (driftIds.length < 10) driftIds.push(s.clientId);
      }
    }
    const oldest = snaps.reduce((a, s) => (s.scannedAt < a ? s.scannedAt : a), snaps[0].scannedAt);
    console.log(`snapshot rows ${snaps.length}; active clients without a snapshot row ${built.notScanned}; oldest row age ${Math.round((now.getTime() - oldest.getTime()) / 3_600_000)} h`);
    console.log(`snapshot vs live status drift: ${drift} client(s)${drift ? ` (chart changed since the last scan — re-scan) e.g. ${driftIds.join(' ')}` : ''}`);
  }

  // ─── 4. Samples ────────────────────────────────────────────────────────────
  const mrnBy = new Map(active.map((c) => [c.id, c.mrn]));
  for (const p of PROGRAMS) {
    const actionable = live.filter((c) => c.results[p].status !== 'enrolled' && inTier(c.results[p].status, c.results[p].gaps.length, 'actionable'));
    const pick = (actionable.length ? actionable : live.filter((c) => ['potential', 'screen'].includes(c.results[p].status))).slice(0, sampleN);
    console.log(`\n=== 4. Samples — ${p} (${pick.length}${actionable.length ? ', actionable tier' : ', none actionable: needs-data / dx-only shown'}) ===`);
    for (const c of pick) {
      const r = c.results[p];
      console.log(`${c.id}  MRN ${mrnBy.get(c.id) ?? '-'}  ${r.status}  gaps[${r.gaps.join(',')}]  evidence: ${evidenceCodes(r)}`);
    }
  }

  // ─── 5. Self-consistency: diagnosis criterion via SQL tokens + independent classifier ─────
  const rows5: (string | number)[][] = [];
  for (const p of PROGRAMS) {
    let agree = 0;
    const mism: string[] = [];
    for (const c of live) {
      const r = c.results[p];
      if (r.status === 'enrolled') continue; // enrollment short-circuits the diagnosis check
      if (p === 'residential' || p === 'iop') {
        // radar-only "potential" has no diagnosis by design
        if (r.gaps.includes('sud_dx')) continue;
      }
      const rulesDx = !DX_FAIL[p].test(r.unmet.join(' | '));
      const sqlDx = (tokensBy.get(c.id) ?? []).some(indep[p]);
      if (rulesDx === sqlDx) agree += 1;
      else mism.push(`${c.id}(${rulesDx ? 'rules+' : 'rules-'}/${sqlDx ? 'sql+' : 'sql-'})`);
    }
    rows5.push([p, agree, mism.length, flag(mism.length === 0), mism.slice(0, 6).join(' ')]);
  }
  table('5. Diagnosis criterion: rules vs raw-SQL tokens (independent classifier)', ['program', 'agree', 'mismatch', 'check', 'examples (id rules/sql)'], rows5);

  console.log(`\n${problems ? `${problems} check(s) FAILED — see MISMATCH rows above` : 'All checks passed.'}`);
  if (problems) process.exitCode = 2;
  void decisionState;
}

main()
  .catch((err) => {
    console.error('check-service-eligibility failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
