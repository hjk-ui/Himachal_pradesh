/**
 * Payer fit per program — general Maryland coverage patterns, not a benefits check. Pure.
 * Every value is labelled "typical"; staff confirm benefits and authorization with the payer
 * (Waystar eligibility / the authorization forecast) before referral.
 */
import type { ProgramKey } from './types';

export type PayerClass = 'medicaid' | 'medicare' | 'commercial' | 'self_pay' | 'unknown';

export type PayerFit = {
  payerClass: PayerClass;
  /** typical: the payer class usually covers the program; varies; not_typical; unknown (no payer charted) */
  coverage: 'typical' | 'varies' | 'not_typical' | 'unknown' | 'n/a';
  /** Prior authorization usually required (null = unknown / not applicable) */
  priorAuth: boolean | null;
  note: string;
};

export const AUTH_FORECAST_HREF = '/dashboard/billing/authorizations';

const MEDICAID = /medicaid|medical assistance|priority partners|amerigroup|wellpoint|maryland physicians care|\bjai\b|carefirst community|aetna better health|united.*community|kaiser.*medicaid|healthchoice|\bmco\b|\bpbhs\b|optum maryland/i;
const MEDICARE = /medicare/i;
const SELF = /self[\s-]?pay|uninsured|private pay|cash/i;

export function classifyPayer(payer: string | null | undefined): PayerClass {
  const p = (payer ?? '').trim();
  if (!p) return 'unknown';
  if (MEDICAID.test(p)) return 'medicaid';
  if (MEDICARE.test(p)) return 'medicare';
  if (SELF.test(p)) return 'self_pay';
  return 'commercial';
}

type Rule = Omit<PayerFit, 'payerClass'>;

const RULES: Record<ProgramKey, Partial<Record<PayerClass, Rule>>> = {
  prp: {
    medicaid: { coverage: 'typical', priorAuth: true, note: 'Maryland Medicaid / PBHS covers PRP; authorization through Optum Maryland' },
    medicare: { coverage: 'not_typical', priorAuth: null, note: 'Medicare does not cover PRP; state-funded PBHS rules (1 of 4 criteria) may apply' },
    commercial: { coverage: 'not_typical', priorAuth: null, note: 'Commercial plans rarely cover PRP; state-funded PBHS rules may apply' },
    self_pay: { coverage: 'varies', priorAuth: true, note: 'Uninsured: state-funded PBHS (1 of 4 eligibility criteria)' },
  },
  tms: {
    medicare: { coverage: 'typical', priorAuth: false, note: 'Medicare (Novitas L34998) covers TMS for severe MDD; Medicare Advantage plans usually require PA' },
    commercial: { coverage: 'typical', priorAuth: true, note: 'Commercial plans usually cover TMS with prior authorization (trial counts vary)' },
    medicaid: { coverage: 'varies', priorAuth: true, note: 'Maryland Medicaid coverage and PA rules for TMS — confirm with the MCO / Optum' },
    self_pay: { coverage: 'not_typical', priorAuth: null, note: 'Self-pay course' },
  },
  spravato: {
    commercial: { coverage: 'typical', priorAuth: true, note: 'Commercial plans usually cover Spravato with PA (drug and G2082 / G2083 visit)' },
    medicare: { coverage: 'typical', priorAuth: false, note: 'Medicare covers Spravato (Part B / Part D by plan); Medicare Advantage may require PA' },
    medicaid: { coverage: 'typical', priorAuth: true, note: 'Maryland Medicaid covers Spravato with prior authorization' },
    self_pay: { coverage: 'not_typical', priorAuth: null, note: 'Self-pay cost is high; check the manufacturer program' },
  },
  aot: {},
  residential: {
    medicaid: { coverage: 'typical', priorAuth: true, note: 'Maryland Medicaid covers ASAM 3.1 / 3.5 (H0019 / H0018) with ASO authorization' },
    commercial: { coverage: 'varies', priorAuth: true, note: 'Commercial residential SUD benefits vary; PA required' },
    medicare: { coverage: 'not_typical', priorAuth: null, note: 'Medicare does not cover non-hospital residential SUD (3.1 / 3.5)' },
    self_pay: { coverage: 'varies', priorAuth: null, note: 'State-funded SUD treatment may apply' },
  },
  iop: {
    medicaid: { coverage: 'typical', priorAuth: true, note: 'Maryland Medicaid covers SUD IOP (H0015) with ASO authorization' },
    commercial: { coverage: 'typical', priorAuth: true, note: 'Commercial plans usually cover IOP with PA' },
    medicare: { coverage: 'varies', priorAuth: false, note: 'Medicare IOP benefit (2024+) depends on the setting (hospital outpatient / CMHC / FQHC)' },
    self_pay: { coverage: 'varies', priorAuth: null, note: 'State-funded SUD treatment may apply' },
  },
};

export function payerFit(program: ProgramKey, payer: string | null | undefined): PayerFit {
  const payerClass = classifyPayer(payer);
  if (program === 'aot') return { payerClass, coverage: 'n/a', priorAuth: null, note: 'Court-ordered program — coverage follows the treatment ordered' };
  if (payerClass === 'unknown') return { payerClass, coverage: 'unknown', priorAuth: null, note: 'No insurance charted — coverage cannot be estimated' };
  const rule = RULES[program][payerClass];
  return rule ? { payerClass, ...rule } : { payerClass, coverage: 'varies', priorAuth: null, note: 'Confirm benefits with the payer' };
}
