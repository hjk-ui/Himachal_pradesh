/**
 * Chart diagnoses from the client record (primaryDiagnosisCode / primaryDiagnosis /
 * secondaryDiagnoses). Since 20261025_diagnosis_list.sql those fields are a derived copy of the
 * client's diagnosis list (ClientDiagnosis, src/lib/diagnoses); the overview prefers the list when
 * a client has one. Pure helpers (no I/O) so they can be tested.
 */
export type ChartDiagnosisSource = {
  id: string;
  primaryDiagnosisCode: string | null;
  primaryDiagnosis: string | null;
  secondaryDiagnoses: string | null;
};

export type ChartDiagnosis = {
  code: string | null;
  label: string;
  rank: 'primary' | 'secondary';
  /** Diagnosis-list status (ACTIVE / PROVISIONAL) when the client has a saved list */
  status?: string;
  /** Coding problem to fix: "Not coded", "Not billable", "Not in FY2027", "Unspecified" */
  flag?: string | null;
};

/** Secondary diagnoses are stored comma- (or semicolon-) separated; blanks and repeats dropped. */
export function parseSecondaryDiagnoses(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const part of raw.split(/[,;\n]/)) {
    const v = part.trim();
    if (v && !out.some((x) => x.toUpperCase() === v.toUpperCase())) out.push(v);
  }
  return out;
}

const ICD10 = /^[A-Z]\d[0-9A-Z](?:\.[0-9A-Z]{1,4})?$/i;

export function chartDiagnoses(c: ChartDiagnosisSource): ChartDiagnosis[] {
  const list: ChartDiagnosis[] = [];
  const pCode = c.primaryDiagnosisCode?.trim() || null;
  const pName = c.primaryDiagnosis?.trim() || null;
  if (pCode || pName) list.push({ code: pCode, label: pName || pCode!, rank: 'primary' });
  for (const s of parseSecondaryDiagnoses(c.secondaryDiagnoses)) {
    if (pCode && s.toUpperCase() === pCode.toUpperCase()) continue;
    list.push({ code: ICD10.test(s) ? s.toUpperCase() : null, label: s, rank: 'secondary' });
  }
  return list;
}

export type DiagnosisSummary = {
  clientsWithDiagnosis: number;
  /** Clients with two or more chart diagnoses */
  multiDxClients: number;
  uniqueCodes: number;
  /** Primary-diagnosis prevalence by code (or label when uncoded), most common first */
  prevalence: Array<{ key: string; count: number }>;
};

export function summarizeDiagnoses(rows: ChartDiagnosisSource[]): DiagnosisSummary {
  let withDx = 0;
  let multi = 0;
  const codes = new Set<string>();
  const prev = new Map<string, number>();
  for (const r of rows) {
    const dx = chartDiagnoses(r);
    if (dx.length === 0) continue;
    withDx++;
    if (dx.length >= 2) multi++;
    for (const d of dx) if (d.code) codes.add(d.code.toUpperCase());
    const primary = dx.find((d) => d.rank === 'primary');
    if (primary) {
      const key = primary.code ? primary.code.toUpperCase() : primary.label;
      prev.set(key, (prev.get(key) || 0) + 1);
    }
  }
  return {
    clientsWithDiagnosis: withDx,
    multiDxClients: multi,
    uniqueCodes: codes.size,
    prevalence: [...prev.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)),
  };
}
