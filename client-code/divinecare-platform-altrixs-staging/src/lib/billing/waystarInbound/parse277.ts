/**
 * 277 readers:
 *   - 277CA Health Care Claim Acknowledgment, ASC X12N 005010X214 (answer to our 837):
 *     HL 20/21/19/PT; claim at HL*PT with TRN*2 = CLM01, STC, REF*1K payer claim number, REF*D9.
 *   - 277 Health Care Claim Status Response, ASC X12N 005010X212 (answer to our 276):
 *     HL 20/21/19/22/23; claim (2200D/E) with TRN*2 = our 276 TRN02, STC, REF*1K, REF*EJ
 *     (patient account number = CLM01), DTP*472; service lines 2220D with SVC + STC.
 * STC01 = category:status:entity; STC04 charge, STC05 paid, STC06 adjudication date,
 * STC08 check date, STC09 check / EFT number, STC12 free-form message.
 */
import { STC_CATEGORY_TEXT } from './codes';
import { money, parseX12, transactionSets, x12DateToIso } from './x12';

export type StcStatus = {
  category: string;
  status: string;
  entity: string;
  effectiveDate: string | null;
  text: string;
};

export type ClaimStatusEntry = {
  kind: '277' | '277CA';
  /** TRN02 at the claim level */
  traceNumber: string;
  /** REF*EJ patient account number (our CLM01) when present */
  patientAccountNumber: string;
  payerClaimControlNumber: string;
  clearinghouseTrace: string;
  statuses: StcStatus[];
  lineStatuses: Array<{ procedure: string; charge: number; statuses: StcStatus[] }>;
  chargeAmount: number | null;
  paidAmount: number | null;
  adjudicatedDate: string | null;
  checkNumber: string;
  serviceDate: string | null;
};

export type StatusEffect =
  | 'accepted'
  | 'pending'
  | 'paid'
  | 'denied'
  | 'finalized'
  | 'rejected'
  | 'not_found'
  | 'info_requested'
  | 'error'
  | 'informational';

function stc(s: string[], component: string): StcStatus {
  const [category = '', status = '', entity = ''] = (s[1] || '').split(component);
  const extras = [s[10], s[11]]
    .filter(Boolean)
    .map((c) => c.split(component).slice(0, 3).filter(Boolean).join(':'));
  const label = STC_CATEGORY_TEXT[category] || `Category ${category || '?'}`;
  const text = [
    `${category} ${label}`,
    `status ${status || '?'}${entity ? ` (entity ${entity})` : ''}`,
    ...(extras.length ? [`also ${extras.join(', ')}`] : []),
    ...(s[12] ? [s[12]] : []),
  ].join('; ');
  return { category, status, entity, effectiveDate: x12DateToIso(s[2]), text };
}

export function parse277(content: string): ClaimStatusEntry[] {
  const doc = parseX12(content);
  const out: ClaimStatusEntry[] = [];
  for (const set of transactionSets(doc)) {
    if (set[0]?.[1] !== '277') continue;
    const version = (set[0][3] || '').toUpperCase();
    const bht = set.find((s) => s[0] === 'BHT');
    const kind: '277' | '277CA' = version.includes('X212') || (!version.includes('X214') && bht?.[6] === 'DG') ? '277' : '277CA';
    const claimLevels = kind === '277CA' ? new Set(['PT']) : new Set(['22', '23']);
    let level = '';
    let cur: ClaimStatusEntry | null = null;
    let line: ClaimStatusEntry['lineStatuses'][number] | null = null;
    for (const s of set) {
      if (s[0] === 'HL') { level = s[3] || ''; cur = null; line = null; continue; }
      if (!claimLevels.has(level)) continue;
      switch (s[0]) {
        case 'TRN':
          if (s[1] === '2') {
            cur = {
              kind, traceNumber: s[2] || '', patientAccountNumber: '', payerClaimControlNumber: '', clearinghouseTrace: '',
              statuses: [], lineStatuses: [], chargeAmount: null, paidAmount: null, adjudicatedDate: null, checkNumber: '', serviceDate: null,
            };
            out.push(cur);
            line = null;
          }
          break;
        case 'STC': {
          if (!cur) break;
          const st = stc(s, doc.component);
          if (line) { line.statuses.push(st); break; }
          cur.statuses.push(st);
          if (s[4] && cur.chargeAmount == null) cur.chargeAmount = money(s[4]);
          if (s[5] && cur.paidAmount == null) cur.paidAmount = money(s[5]);
          if (s[6] && !cur.adjudicatedDate) cur.adjudicatedDate = x12DateToIso(s[6]);
          if (s[9] && !cur.checkNumber) cur.checkNumber = s[9];
          break;
        }
        case 'REF':
          if (!cur || line) break;
          if (s[1] === '1K') cur.payerClaimControlNumber = s[2] || '';
          else if (s[1] === 'EJ') cur.patientAccountNumber = s[2] || '';
          else if (s[1] === 'D9') cur.clearinghouseTrace = s[2] || '';
          break;
        case 'DTP':
          if (cur && !line && s[1] === '472') cur.serviceDate = x12DateToIso((s[3] || '').split('-')[0]);
          break;
        case 'SVC':
          if (!cur) break;
          line = { procedure: (s[1] || '').split(doc.component).slice(1, 3).join(' '), charge: money(s[2]), statuses: [] };
          cur.lineStatuses.push(line);
          break;
        default:
          break;
      }
    }
  }
  return out;
}

const REJECTED = new Set(['A3', 'A6', 'A7', 'A8']);

/** What a claim-level status means for the claim (first STC wins; any rejection overrides). */
export function statusEffect(entry: ClaimStatusEntry): StatusEffect {
  const cats = entry.statuses.map((s) => s.category);
  if (cats.some((c) => REJECTED.has(c))) return 'rejected';
  const c = cats[0] || '';
  if (c === 'A2') return 'accepted';
  if (c === 'A4') return 'not_found';
  if (c.startsWith('P')) return 'pending';
  if (c === 'F1') return 'paid';
  if (c === 'F2') return 'denied';
  if (c.startsWith('F')) return 'finalized';
  if (c.startsWith('R')) return 'info_requested';
  if (c.startsWith('E') || c === 'D0') return 'error';
  return 'informational';
}

/** Claim reference to match on: REF*EJ (CLM01) for a 277, TRN02 for a 277CA. */
export function claimReference(entry: ClaimStatusEntry): string {
  return (entry.kind === '277' && entry.patientAccountNumber ? entry.patientAccountNumber : entry.traceNumber).trim();
}
