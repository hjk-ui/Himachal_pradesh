/**
 * 271 Eligibility, Coverage or Benefit Information reader — ASC X12N 005010X279A1.
 *
 * Loops: 2000A/2100A information source (payer) + AAA, 2000B/2100B information receiver + AAA,
 * 2000C/2100C subscriber (TRN*2 echoes our 270 TRN02, NM1*IL, DMG, DTP plan dates, AAA),
 * 2000D/2100D dependent (same), 2110C/2110D EB benefit lines (+ DTP, MSG, AAA, LS/LE entities).
 *
 * Mapped into EligibilityCheck (status + benefits) for mental-health service types (MH, A4, A6,
 * A8, AI...), falling back to 30 (health benefit plan coverage) when the payer only returns 30.
 */
import { AAA_FOLLOWUP, AAA_REASON, EB_INFO, MH_SERVICE_TYPES, SERVICE_TYPE, describe } from './codes';
import { money, parseX12, transactionSets, x12Period } from './x12';

export type BenefitLine = {
  info: string;
  coverageLevel: string;
  serviceTypes: string[];
  insuranceType: string;
  planDescription: string;
  timePeriod: string;
  amount: number | null;
  percent: number | null;
  quantityQualifier: string;
  quantity: number | null;
  authRequired: string;
  inNetwork: string;
  procedure: string;
  dates: Array<{ qualifier: string; from: string | null; to: string | null }>;
  messages: string[];
  /** 2120C/2120D related entities under this EB (LS*2120 .. LE): e.g. the Medicaid MCO (Y2) or another payer (PR / PRP) */
  relatedEntities?: RelatedEntity[];
};

export type RelatedEntity = { entityCode: string; name: string; idQualifier: string; id: string };

export type AaaRejection = { level: string; validResponse: string; reasonCode: string; followUp: string; text: string };

export type EligibilityResponse = {
  /** TRN02 of our 270 (TRN*2 in the 271) = EligibilityCheck.id */
  traceNumber: string;
  payerName: string;
  payerId: string;
  memberId: string;
  subscriberLastName: string;
  subscriberFirstName: string;
  isDependent: boolean;
  planBegin: string | null;
  planEnd: string | null;
  eligibilityBegin: string | null;
  eligibilityEnd: string | null;
  groupNumber: string;
  planName: string;
  benefits: BenefitLine[];
  rejections: AaaRejection[];
};

export type EligibilitySummary = {
  status: 'ELIGIBLE' | 'INELIGIBLE' | 'ERROR';
  statusText: string;
  /** Same shape as the Availity path (EligibilityBenefits) so the page renders both */
  benefits: {
    deductible: number;
    deductibleMet: number;
    copay: number;
    oopMax: number;
    oopMet: number;
    coveredServices: string[];
  };
  coinsurancePercent: number | null;
  /** false = the payer reported no copay; benefits.copay is then 0 for display only and means "unknown", not $0 */
  copayKnown: boolean;
  /** EB04 insurance type codes on active coverage lines (e.g. MC Medicaid, HM HMO, MB Medicare B) */
  insuranceTypes: string[];
  /** Managed care organization from 2120 (NM1*Y2), or the payer named in 2120 on an active line */
  managedCare: { name: string; idQualifier: string; id: string; entityCode: string } | null;
  benefitSource: 'mental_health' | 'plan' | 'none';
  priorAuthRequired: boolean;
  planBegin: string | null;
  planEnd: string | null;
  planName: string;
  rejections: string[];
  notes: string[];
};

const ACTIVE = new Set(['1', '2', '3', '4', '5']);
const INACTIVE = new Set(['6', '7', '8']);

function newResponse(): EligibilityResponse {
  return {
    traceNumber: '', payerName: '', payerId: '', memberId: '', subscriberLastName: '', subscriberFirstName: '',
    isDependent: false, planBegin: null, planEnd: null, eligibilityBegin: null, eligibilityEnd: null,
    groupNumber: '', planName: '', benefits: [], rejections: [],
  };
}

function aaa(level: string, s: string[]): AaaRejection {
  const reason = s[3] || '';
  const follow = s[4] || '';
  return {
    level,
    validResponse: s[1] || '',
    reasonCode: reason,
    followUp: follow,
    text: [AAA_REASON[reason] ? `${reason} ${AAA_REASON[reason]}` : `Reject reason ${reason || '?'}`, AAA_FOLLOWUP[follow]].filter(Boolean).join(' — '),
  };
}

/** One EligibilityResponse per subscriber/dependent loop that carries a TRN*2 (or per HL 22/23). */
export function parse271(content: string): EligibilityResponse[] {
  const doc = parseX12(content);
  const out: EligibilityResponse[] = [];
  for (const set of transactionSets(doc)) {
    if (set[0]?.[1] !== '271') continue;
    let payerName = '';
    let payerId = '';
    const sourceRejections: AaaRejection[] = [];
    let level = '';
    let cur: EligibilityResponse | null = null;
    let subscriberCtx: EligibilityResponse | null = null;
    let eb: BenefitLine | null = null;
    let inLs = false;

    for (const s of set) {
      const id = s[0];
      if (id === 'HL') {
        level = s[3] || '';
        eb = null;
        inLs = false;
        if (level === '22' || level === '23') {
          cur = newResponse();
          cur.payerName = payerName;
          cur.payerId = payerId;
          cur.isDependent = level === '23';
          cur.rejections.push(...sourceRejections);
          if (level === '22') subscriberCtx = cur;
          else if (subscriberCtx) {
            cur.memberId = subscriberCtx.memberId;
            cur.subscriberFirstName = subscriberCtx.subscriberFirstName;
            cur.subscriberLastName = subscriberCtx.subscriberLastName;
            cur.groupNumber = subscriberCtx.groupNumber;
          }
          out.push(cur);
        }
        continue;
      }
      if (id === 'LS') { inLs = true; continue; }
      if (id === 'LE') { inLs = false; continue; }
      // Related-entity loop 2120 (MCO, other payer, PCP): kept on the EB it belongs to; not used for status
      if (inLs) {
        if (id === 'NM1' && eb) {
          (eb.relatedEntities ??= []).push({ entityCode: s[1] || '', name: s[3] || '', idQualifier: s[8] || '', id: s[9] || '' });
        }
        continue;
      }

      if (level === '20') {
        if (id === 'NM1' && s[1] === 'PR') {
          payerName = s[3] || '';
          if (s[8] === 'PI' || s[8] === 'XV') payerId = s[9] || '';
        } else if (id === 'AAA') sourceRejections.push(aaa('payer', s));
        continue;
      }
      if (level === '21') {
        if (id === 'AAA') sourceRejections.push(aaa('provider', s));
        continue;
      }
      if (!cur) continue;
      switch (id) {
        case 'TRN':
          if (s[1] === '2' && s[2]) cur.traceNumber = s[2];
          break;
        case 'NM1':
          if (s[1] === 'IL' || s[1] === '03') {
            if (s[1] === 'IL') {
              cur.subscriberLastName = s[3] || '';
              cur.subscriberFirstName = s[4] || '';
              if (s[9]) cur.memberId = s[9];
            }
          }
          break;
        case 'REF':
          if (!eb && (s[1] === '6P' || s[1] === 'IG')) cur.groupNumber = s[2] || cur.groupNumber;
          if (!eb && s[1] === '18' && s[3]) cur.planName = s[3];
          break;
        case 'DTP': {
          const p = x12Period(s[2], s[3]);
          if (eb) { eb.dates.push({ qualifier: s[1] || '', ...p }); break; }
          if (s[1] === '346') cur.planBegin = p.from;
          else if (s[1] === '347') cur.planEnd = p.from;
          else if (s[1] === '356') cur.eligibilityBegin = p.from;
          else if (s[1] === '357') cur.eligibilityEnd = p.from;
          else if (s[1] === '291') { cur.planBegin = cur.planBegin || p.from; if (s[2] === 'RD8') cur.planEnd = cur.planEnd || p.to; }
          else if (s[1] === '307') { cur.eligibilityBegin = cur.eligibilityBegin || p.from; if (s[2] === 'RD8') cur.eligibilityEnd = cur.eligibilityEnd || p.to; }
          break;
        }
        case 'AAA':
          cur.rejections.push(aaa(eb ? `benefit ${eb.serviceTypes.join('/') || ''}`.trim() : cur.isDependent ? 'dependent' : 'subscriber', s));
          break;
        case 'EB':
          eb = {
            info: s[1] || '',
            coverageLevel: s[2] || '',
            serviceTypes: (s[3] || '').split(doc.repetition).filter(Boolean),
            insuranceType: s[4] || '',
            planDescription: s[5] || '',
            timePeriod: s[6] || '',
            amount: s[7] ? money(s[7]) : null,
            percent: s[8] ? Number(s[8]) : null,
            quantityQualifier: s[9] || '',
            quantity: s[10] ? Number(s[10]) : null,
            authRequired: s[11] || '',
            inNetwork: s[12] || '',
            procedure: s[13] ? s[13].split(doc.component).slice(0, 2).join(' ') : '',
            dates: [],
            messages: [],
          };
          if (!cur.planName && ACTIVE.has(eb.info) && eb.planDescription) cur.planName = eb.planDescription;
          cur.benefits.push(eb);
          break;
        case 'MSG':
          if (eb && s[1]) eb.messages.push(s[1]);
          break;
        default:
          break;
      }
    }
  }
  // A subscriber loop that only parents a dependent (HL*22*1, no TRN / EB) is not an answer
  return out.filter((r) => r.traceNumber || r.benefits.length || r.rejections.some((x) => x.level !== 'payer' && x.level !== 'provider'));
}

function pickAmount(lines: BenefitLine[], info: string, periods: string[]): number | null {
  for (const p of periods) {
    const hit = lines.find((l) => l.info === info && l.timePeriod === p && l.amount != null);
    if (hit) return hit.amount;
  }
  return null;
}

/** Reduces a 271 subscriber/dependent response to the EligibilityCheck record fields. */
export function summarizeEligibility(r: EligibilityResponse): EligibilitySummary {
  const notes: string[] = [];
  const rejections = r.rejections.map((a) => `${a.level}: ${a.text}`);
  const statusLines = r.benefits.filter((b) => ACTIVE.has(b.info) || INACTIVE.has(b.info));
  const anyActive = statusLines.some((b) => ACTIVE.has(b.info));
  const anyInactive = statusLines.some((b) => INACTIVE.has(b.info));

  // Prefer in-network (EB12 Y, or not stated), individual coverage, mental-health service types
  const usable = r.benefits.filter((b) => b.inNetwork !== 'N' && (b.coverageLevel === '' || b.coverageLevel === 'IND'));
  const mh = usable.filter((b) => b.serviceTypes.some((t) => MH_SERVICE_TYPES.has(t)));
  const plan = usable.filter((b) => b.serviceTypes.length === 0 || b.serviceTypes.includes('30'));
  // Each field falls back from mental-health service types to plan level (30) on its own:
  // payers often send MH copay / coinsurance but report deductible and OOP only under 30.
  let usedMh = false;
  const pick = <T,>(fromMh: T | null | undefined, fromPlan: T | null | undefined): T | null => {
    if (fromMh != null) { usedMh = true; return fromMh; }
    return fromPlan ?? null;
  };
  const copayAmount = pick(pickAmount(mh, 'B', ['27', '', '7', '23']), pickAmount(plan, 'B', ['27', '', '7', '23']));
  const copay = copayAmount ?? 0;
  const coinsLine = pick(mh.find((b) => b.info === 'A' && b.percent != null), plan.find((b) => b.info === 'A' && b.percent != null));
  const deductibleFromMh = pickAmount(mh, 'C', ['23', '22', '25', '24']) != null;
  const dedSet = deductibleFromMh ? mh : plan;
  const deductible = pick(deductibleFromMh ? pickAmount(mh, 'C', ['23', '22', '25', '24']) : null, pickAmount(plan, 'C', ['23', '22', '25', '24'])) ?? 0;
  const deductibleRemaining = pickAmount(dedSet, 'C', ['29']);
  const oopFromMh = pickAmount(mh, 'G', ['23', '22', '25', '24']) != null;
  const oopSet = oopFromMh ? mh : plan;
  const oopMax = pick(oopFromMh ? pickAmount(mh, 'G', ['23', '22', '25', '24']) : null, pickAmount(plan, 'G', ['23', '22', '25', '24'])) ?? 0;
  const oopRemaining = pickAmount(oopSet, 'G', ['29']);
  const priorAuthRequired = mh.some((b) => b.authRequired === 'Y') || plan.some((b) => b.authRequired === 'Y');
  const benefitSource: EligibilitySummary['benefitSource'] = usedMh ? 'mental_health' : plan.some((b) => ['A', 'B', 'C', 'G'].includes(b.info)) ? 'plan' : 'none';

  const covered = new Set<string>();
  for (const b of r.benefits) {
    if (!ACTIVE.has(b.info)) continue;
    for (const t of b.serviceTypes.length ? b.serviceTypes : ['30']) covered.add(SERVICE_TYPE[t] || t);
  }
  if (r.benefits.some((b) => b.info === 'R')) notes.push('Payer reports other or additional coverage (coordination of benefits)');
  if (copayAmount == null) notes.push('Copay not reported by the payer: unknown (not $0); confirm before collecting');
  const activeLines = r.benefits.filter((b) => ACTIVE.has(b.info));
  const insuranceTypes = Array.from(new Set(activeLines.map((b) => b.insuranceType).filter(Boolean)));
  const entities = r.benefits.flatMap((b) => (b.relatedEntities || []).map((e) => ({ e, active: ACTIVE.has(b.info) })));
  const mcoHit = entities.find((x) => x.e.entityCode === 'Y2') ?? entities.find((x) => x.active && (x.e.entityCode === 'PR' || x.e.entityCode === 'PRP'));
  const managedCare = mcoHit ? { name: mcoHit.e.name, idQualifier: mcoHit.e.idQualifier, id: mcoHit.e.id, entityCode: mcoHit.e.entityCode } : null;
  if (managedCare) notes.push(`Managed care: ${managedCare.name || managedCare.id} (2120 ${managedCare.entityCode}); bill the plan named here`);
  if (priorAuthRequired) notes.push('Payer indicates prior authorization is required for this service type');
  for (const b of r.benefits.filter((x) => x.info === 'I' && x.serviceTypes.some((t) => MH_SERVICE_TYPES.has(t)))) {
    notes.push(`Non-covered: ${b.serviceTypes.map((t) => SERVICE_TYPE[t] || t).join(', ')}`);
  }

  let status: EligibilitySummary['status'];
  let statusText: string;
  // Active plan / MH coverage wins; an inactive MH-family type (e.g. AI) beside it is a note.
  // Only "plan active, every MH-family type inactive" makes the check INELIGIBLE.
  const activeTypes = new Set(r.benefits.filter((b) => ACTIVE.has(b.info)).flatMap((b) => (b.serviceTypes.length ? b.serviceTypes : ['30'])));
  const inactiveMhTypes = r.benefits
    .filter((b) => INACTIVE.has(b.info))
    .flatMap((b) => b.serviceTypes.filter((t) => MH_SERVICE_TYPES.has(t) && !activeTypes.has(t)));
  const mhCoveredActive = activeTypes.has('30') || Array.from(activeTypes).some((t) => MH_SERVICE_TYPES.has(t));
  for (const t of inactiveMhTypes) notes.push(`${SERVICE_TYPE[t] || t}: inactive`);
  const mhInactive = anyActive && !mhCoveredActive && inactiveMhTypes.length > 0;
  if (anyActive && !mhInactive) {
    status = 'ELIGIBLE';
    statusText = describe(EB_INFO, statusLines.find((b) => ACTIVE.has(b.info))?.info);
  } else if (anyInactive || mhInactive) {
    status = 'INELIGIBLE';
    statusText = mhInactive && anyActive ? 'Plan active, mental health benefits inactive' : describe(EB_INFO, statusLines.find((b) => INACTIVE.has(b.info))?.info);
  } else if (rejections.length) {
    status = 'ERROR';
    statusText = `Rejected: ${r.rejections[0].text}`;
  } else {
    status = 'ERROR';
    statusText = 'No coverage status (EB01) in the 271';
  }

  return {
    status,
    statusText,
    benefits: {
      deductible,
      deductibleMet: deductible && deductibleRemaining != null ? Math.max(0, Math.round((deductible - deductibleRemaining) * 100) / 100) : 0,
      copay,
      oopMax,
      oopMet: oopMax && oopRemaining != null ? Math.max(0, Math.round((oopMax - oopRemaining) * 100) / 100) : 0,
      coveredServices: Array.from(covered),
    },
    coinsurancePercent: coinsLine?.percent != null ? coinsLine.percent : null,
    copayKnown: copayAmount != null,
    insuranceTypes,
    managedCare,
    benefitSource,
    priorAuthRequired,
    planBegin: r.planBegin || r.eligibilityBegin,
    planEnd: r.planEnd || r.eligibilityEnd,
    planName: r.planName,
    rejections,
    notes,
  };
}
