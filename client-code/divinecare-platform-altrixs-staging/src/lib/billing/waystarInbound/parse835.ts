/**
 * 835 Health Care Claim Payment/Advice reader — ASC X12N 005010X221A1.
 *
 * One Remittance per ST..SE (a file can carry several payments). Loops read:
 *   Header   BPR (financial information), TRN (reassociation trace), DTM*405,
 *            1000A N1*PR payer (+ REF*2U payer id), 1000B N1*PE payee (+ NPI)
 *   2100     CLP claim payment, CAS claim adjustments, NM1*QC patient / *IL insured,
 *            MOA / MIA remark codes, DTM*232/233 statement dates, REF*1K? (CLP07 holds the payer ICN)
 *   2110     SVC service payment, DTM*472, CAS line adjustments, REF*6R line control, AMT*B6, LQ*HE RARC
 *   Trailer  PLB provider-level adjustments
 * Balancing (X221A1 1.10.2): CLP03 - CLP04 = all claim + line CAS; SVC02 - SVC03 = line CAS;
 * BPR02 = sum(CLP04) - sum(PLB amounts).
 */
import { money, parseX12, transactionSets, x12DateToIso, type X12Doc } from './x12';

export type CasAdjustment = { group: string; carc: string; amount: number; quantity: number | null };

export type EraServiceLine = {
  /** 1-based order within the claim */
  seq: number;
  qualifier: string;
  procedureCode: string;
  modifiers: string[];
  charge: number;
  paid: number;
  revenueCode: string | null;
  unitsPaid: number | null;
  originalProcedure: string | null;
  originalUnits: number | null;
  serviceDate: string | null;
  serviceDateTo: string | null;
  lineControlNumber: string | null;
  allowed: number | null;
  adjustments: CasAdjustment[];
  remarks: string[];
};

export type EraClaim = {
  /** 1-based order within the remittance */
  seq: number;
  /** CLP01 = our CLM01 (claim control number / legacy claim id) */
  patientControlNumber: string;
  statusCode: string;
  charge: number;
  paid: number;
  patientResponsibility: number;
  filingIndicator: string;
  payerClaimControlNumber: string;
  facilityCode: string;
  frequencyCode: string;
  patientLastName: string;
  patientFirstName: string;
  memberId: string;
  insuredMemberId: string;
  correctedMemberId: string;
  renderingNpi: string;
  statementFrom: string | null;
  statementTo: string | null;
  receivedDate: string | null;
  claimAdjustments: CasAdjustment[];
  /** MOA / MIA remark codes plus claim-level LQ (rare) */
  claimRemarks: string[];
  coverageAmount: number | null;
  lines: EraServiceLine[];
};

export type ProviderAdjustment = {
  providerId: string;
  fiscalPeriodDate: string | null;
  reasonCode: string;
  reference: string;
  /** Positive reduces the payment (e.g. WO overpayment recovery), negative increases it (L6 interest) */
  amount: number;
};

export type Remittance = {
  /** ST02 */
  stControlNumber: string;
  handlingCode: string;
  paymentAmount: number;
  creditDebit: string;
  paymentMethod: string;
  paymentDate: string | null;
  /** TRN02 check or EFT trace number */
  traceNumber: string;
  /** TRN03 payer identifier ('1' + TIN), TRN04 originating sub-company */
  payerTraceId: string;
  payerSubId: string;
  productionDate: string | null;
  payerName: string;
  payerId: string;
  payeeName: string;
  payeeNpi: string;
  payeeTaxId: string;
  claims: EraClaim[];
  providerAdjustments: ProviderAdjustment[];
  /** Balancing problems inside the 835 itself; empty = balanced */
  balanceErrors: string[];
};

function readCas(s: string[]): CasAdjustment[] {
  const group = s[1] || '';
  const out: CasAdjustment[] = [];
  for (let i = 2; i + 1 < s.length; i += 3) {
    const carc = s[i];
    if (!carc) continue;
    const q = s[i + 2];
    out.push({ group, carc, amount: money(s[i + 1]), quantity: q ? Number(q) : null });
  }
  return out;
}

function sum(values: number[]) {
  return Math.round(values.reduce((t, v) => t + v, 0) * 100) / 100;
}

const close = (a: number, b: number) => Math.abs(a - b) < 0.005;

function balanceErrorsFor(r: Remittance): string[] {
  const errors: string[] = [];
  for (const c of r.claims) {
    const cas = sum([...c.claimAdjustments.map((a) => a.amount), ...c.lines.flatMap((l) => l.adjustments.map((a) => a.amount))]);
    if (!close(c.charge - c.paid, cas)) {
      errors.push(`Claim ${c.patientControlNumber}: charge ${c.charge.toFixed(2)} - paid ${c.paid.toFixed(2)} != adjustments ${cas.toFixed(2)}`);
    }
    for (const l of c.lines) {
      const lineCas = sum(l.adjustments.map((a) => a.amount));
      if (!close(l.charge - l.paid, lineCas)) {
        errors.push(`Claim ${c.patientControlNumber} line ${l.seq}: charge ${l.charge.toFixed(2)} - paid ${l.paid.toFixed(2)} != adjustments ${lineCas.toFixed(2)}`);
      }
    }
    if (c.lines.length) {
      const linePaid = sum(c.lines.map((l) => l.paid));
      if (!close(linePaid, c.paid)) errors.push(`Claim ${c.patientControlNumber}: lines paid ${linePaid.toFixed(2)} != claim paid ${c.paid.toFixed(2)}`);
    }
  }
  const expected = sum(r.claims.map((c) => c.paid)) - sum(r.providerAdjustments.map((p) => p.amount));
  if (!close(Math.round(expected * 100) / 100, r.paymentAmount)) {
    errors.push(`BPR02 ${r.paymentAmount.toFixed(2)} != claims paid ${sum(r.claims.map((c) => c.paid)).toFixed(2)} - provider adjustments ${sum(r.providerAdjustments.map((p) => p.amount)).toFixed(2)}`);
  }
  return errors;
}

function parseSet(set: string[][], doc: X12Doc): Remittance {
  const r: Remittance = {
    stControlNumber: set[0]?.[2] || '',
    handlingCode: '', paymentAmount: 0, creditDebit: 'C', paymentMethod: '', paymentDate: null,
    traceNumber: '', payerTraceId: '', payerSubId: '', productionDate: null,
    payerName: '', payerId: '', payeeName: '', payeeNpi: '', payeeTaxId: '',
    claims: [], providerAdjustments: [], balanceErrors: [],
  };
  let party: 'PR' | 'PE' | '' = '';
  let claim: EraClaim | null = null;
  let line: EraServiceLine | null = null;

  for (const s of set) {
    const id = s[0];
    switch (id) {
      case 'BPR':
        r.handlingCode = s[1] || '';
        r.paymentAmount = money(s[2]);
        r.creditDebit = s[3] || 'C';
        r.paymentMethod = s[4] || '';
        r.paymentDate = x12DateToIso(s[16]);
        break;
      case 'TRN':
        if (!claim) {
          r.traceNumber = s[2] || '';
          r.payerTraceId = s[3] || '';
          r.payerSubId = s[4] || '';
        }
        break;
      case 'DTM':
        if (!claim && s[1] === '405') r.productionDate = x12DateToIso(s[2]);
        else if (line && s[1] === '472') line.serviceDate = x12DateToIso(s[2]);
        else if (line && s[1] === '150') line.serviceDate = x12DateToIso(s[2]);
        else if (line && s[1] === '151') line.serviceDateTo = x12DateToIso(s[2]);
        else if (claim && !line && s[1] === '232') claim.statementFrom = x12DateToIso(s[2]);
        else if (claim && !line && s[1] === '233') claim.statementTo = x12DateToIso(s[2]);
        else if (claim && !line && s[1] === '050') claim.receivedDate = x12DateToIso(s[2]);
        break;
      case 'N1':
        if (!claim) {
          party = s[1] === 'PR' ? 'PR' : s[1] === 'PE' ? 'PE' : '';
          if (party === 'PR') {
            r.payerName = s[2] || '';
            if (s[3] === 'XV' && s[4]) r.payerId = s[4];
          } else if (party === 'PE') {
            r.payeeName = s[2] || '';
            if (s[3] === 'XX') r.payeeNpi = s[4] || '';
            if (s[3] === 'FI') r.payeeTaxId = s[4] || '';
          }
        }
        break;
      case 'REF':
        if (line) {
          if (s[1] === '6R') line.lineControlNumber = s[2] || null;
        } else if (!claim) {
          if (party === 'PR' && s[1] === '2U') r.payerId = s[2] || r.payerId;
          if (party === 'PE' && s[1] === 'TJ') r.payeeTaxId = s[2] || r.payeeTaxId;
        }
        break;
      case 'CLP':
        line = null;
        claim = {
          seq: r.claims.length + 1,
          patientControlNumber: s[1] || '',
          statusCode: s[2] || '',
          charge: money(s[3]),
          paid: money(s[4]),
          patientResponsibility: money(s[5]),
          filingIndicator: s[6] || '',
          payerClaimControlNumber: s[7] || '',
          facilityCode: s[8] || '',
          frequencyCode: s[9] || '',
          patientLastName: '', patientFirstName: '', memberId: '', insuredMemberId: '', correctedMemberId: '', renderingNpi: '',
          statementFrom: null, statementTo: null, receivedDate: null,
          claimAdjustments: [], claimRemarks: [], coverageAmount: null, lines: [],
        };
        r.claims.push(claim);
        break;
      case 'CAS':
        if (line) line.adjustments.push(...readCas(s));
        else if (claim) claim.claimAdjustments.push(...readCas(s));
        break;
      case 'NM1':
        if (claim && !line) {
          if (s[1] === 'QC') {
            claim.patientLastName = s[3] || '';
            claim.patientFirstName = s[4] || '';
            if (s[8] && s[9]) claim.memberId = s[9];
          } else if (s[1] === 'IL') {
            if (s[9]) claim.insuredMemberId = s[9];
          } else if (s[1] === '74') {
            if (s[9]) claim.correctedMemberId = s[9];
          } else if (s[1] === '82') {
            if (s[8] === 'XX') claim.renderingNpi = s[9] || '';
          }
        }
        break;
      case 'MOA':
        if (claim) claim.claimRemarks.push(...[s[3], s[4], s[5], s[6], s[7]].filter((v): v is string => Boolean(v)));
        break;
      case 'MIA':
        if (claim) claim.claimRemarks.push(...[s[5], s[20], s[21], s[22], s[23]].filter((v): v is string => Boolean(v)));
        break;
      case 'AMT':
        if (line && s[1] === 'B6') line.allowed = money(s[2]);
        else if (claim && !line && s[1] === 'AU') claim.coverageAmount = money(s[2]);
        break;
      case 'SVC': {
        if (!claim) break;
        const parts = (s[1] || '').split(doc.component);
        const orig = s[6] ? s[6].split(doc.component) : null;
        line = {
          seq: claim.lines.length + 1,
          qualifier: parts[0] || '',
          procedureCode: parts[1] || '',
          modifiers: parts.slice(2, 6).filter(Boolean),
          charge: money(s[2]),
          paid: money(s[3]),
          revenueCode: s[4] || null,
          unitsPaid: s[5] ? Number(s[5]) : null,
          originalProcedure: orig ? orig[1] || null : null,
          originalUnits: s[7] ? Number(s[7]) : null,
          serviceDate: null, serviceDateTo: null, lineControlNumber: null, allowed: null,
          adjustments: [], remarks: [],
        };
        claim.lines.push(line);
        break;
      }
      case 'LQ':
        if (s[1] === 'HE' && s[2]) {
          if (line) line.remarks.push(s[2]);
          else if (claim) claim.claimRemarks.push(s[2]);
        }
        break;
      case 'PLB': {
        claim = null;
        line = null;
        const providerId = s[1] || '';
        const fiscal = x12DateToIso(s[2]);
        for (let i = 3; i + 1 < s.length; i += 2) {
          if (!s[i]) continue;
          const [reasonCode = '', reference = ''] = s[i].split(doc.component);
          r.providerAdjustments.push({ providerId, fiscalPeriodDate: fiscal, reasonCode, reference, amount: money(s[i + 1]) });
        }
        break;
      }
      case 'LX':
      case 'TS3':
      case 'TS2':
        line = null;
        claim = null;
        break;
      default:
        break;
    }
  }
  r.balanceErrors = balanceErrorsFor(r);
  return r;
}

export function parse835(content: string): Remittance[] {
  const doc = parseX12(content);
  return transactionSets(doc)
    .filter((set) => set[0]?.[1] === '835')
    .map((set) => parseSet(set, doc));
}

/** Non-PR adjustments (what the payer wrote off / denied), claim + lines. */
export function contractualTotal(c: EraClaim): number {
  return sum([...c.claimAdjustments, ...c.lines.flatMap((l) => l.adjustments)].filter((a) => a.group !== 'PR').map((a) => a.amount));
}

export function allAdjustments(c: EraClaim): Array<CasAdjustment & { lineSeq: number | null }> {
  return [
    ...c.claimAdjustments.map((a) => ({ ...a, lineSeq: null })),
    ...c.lines.flatMap((l) => l.adjustments.map((a) => ({ ...a, lineSeq: l.seq }))),
  ];
}
