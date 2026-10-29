/**
 * Cost of goods sold (COGS) model for pricing model v2 — ESTIMATES, not contract costs.
 *
 * Used by docs/pricing-model.md (via scripts/pricing-quotes.ts) and tests to check gross margin per
 * tier. Every unit cost below cites a source (accessed 2026-10-19) or is marked [EST].
 *
 * TODO(owner contracts): the DrFirst (Rcopia + EPCS) and Waystar (claim, ERA, eligibility, status)
 * figures are ESTIMATES kept on purpose until the owner sends the signed contract pricing
 * (decision 2026-10-20). Replace drFirstPerPrescriber, claim, era, eligibility and claimStatus then,
 * re-run scripts/pricing-quotes.ts and update docs/pricing-model.md.
 *
 * AI Scribe runs on standard Amazon Transcribe streaming by default (owner decision 2026-10-20),
 * with a behavioral-health custom vocabulary; Transcribe Medical stays available per practice.
 *
 * Usage assumptions per seat type (per month, 4.33 weeks):
 *  - clinician: 25 sessions/week × 50 min = 108 sessions; 30% by telehealth.
 *  - prescriber: 40 med-management visits/week × 25 min = 173 visits; 30% by telehealth.
 *  - paraprofessional: 60 contacts (PRP, case management, peer), 10% telehealth, ~15 claims (PRP monthly case rate).
 *  - support: logins only.
 */
import { CLAIM_OVERAGE_PER_CLAIM, TIERS, type BillableSeatType, type PriceQuote, type SeatType } from './plans';

/** Unit costs (USD). */
export const UNIT_COSTS = {
  /** Chime SDK meetings, per attendee-minute. [P] https://aws.amazon.com/chime/chime-sdk/pricing/ */
  chimeAttendeeMinute: 0.0017,
  /** Amazon Transcribe Medical streaming, per minute. [P] https://aws.amazon.com/transcribe/pricing/ */
  transcribeMedicalMinute: 0.075,
  /**
   * Amazon Transcribe standard streaming, per minute, tier 1 (first 250,000 min/month per account). [P] same page.
   * Tiered list rates (US East): $0.024 first 250k min, $0.015 next 750k, $0.0102 next 4M, $0.006 above 5M.
   * The model uses tier 1 for every minute (conservative); custom vocabularies add no charge.
   * 250k min/month is about 100 scribe users at 2,400 min each.
   */
  transcribeStandardMinute: 0.024,
  /** AWS HealthScribe, per minute ($0.001667/s). [P] https://aws.amazon.com/healthscribe/pricing/ */
  healthScribeMinute: 0.1,
  /** Claude Sonnet 4.5 via Bedrock, per 1M tokens in / out. [P] https://claude.com/pricing (Bedrock matches first-party list) */
  sonnetInPerM: 3,
  sonnetOutPerM: 15,
  /** Claude Haiku 4.5, per 1M tokens in / out. [P] same */
  haikuInPerM: 1,
  haikuOutPerM: 5,
  /** Comprehend Medical NERe/ICD-10 proxy, per 100-character unit. [P] https://aws.amazon.com/comprehend/medical/pricing/ */
  comprehendUnit: 0.01,
  /** US SMS: ~$0.00581 base + ~$0.0025 carrier fee. [EST] https://aws.amazon.com/end-user-messaging/pricing/ */
  smsMessage: 0.0083,
  /** Waystar via reseller: claim $0.11, ERA $0.04, eligibility $0.14. [3P, 2024 outage-era rates] https://sticomputer.com/waystar-billing-service-enrollment. TODO(owner contracts): replace with the Waystar contract. */
  claim: 0.11,
  era: 0.04,
  eligibility: 0.14,
  /** Claim status 276/277 per inquiry. [EST] no published figure found. */
  claimStatus: 0.1,
  /** DrFirst Rcopia + EPCS per prescriber per month. [EST] https://www.rfp.wiki/vendors/drfirst (historical ~$60). TODO(owner contracts): replace with the DrFirst contract. */
  drFirstPerPrescriber: 60,
  /** EPCS two-factor token / certificate, amortized: IdenTrust $96–$232 per 2 years. [3P/EST] */
  epcsTokenPerPrescriberMonth: 5,
  /**
   * PDMP. ASSUMPTION (owner decision 2026-10-20): Maryland CRISP PDMP access through DrFirst is included
   * in the DrFirst estimate, so no separate PDMP cost. If it turns out to be billed separately (for example
   * Bamboo PMP Gateway, ~$50 per provider per year [3P/EST]), set this to about 4.
   */
  pdmpPerPrescriberMonth: 0,
  /** Card processing on our own subscription invoices: Stripe 2.9% + $0.30. [P] https://stripe.com/pricing */
  paymentProcessingPercent: 2.9,
} as const;

/** Per-location monthly cost: fax line, phone numbers, PDMP facility share. [EST] */
export const LOCATION_COST_PER_MONTH = 10;

export type CostLine = { item: string; perMonth: number; basis: string };

const r2 = (n: number) => Math.round(n * 100) / 100;

function seatLines(type: SeatType): CostLine[] {
  const u = UNIT_COSTS;
  switch (type) {
    case 'clinician': {
      const visits = 108;
      const tele = visits * 0.3 * 50 * 2 * u.chimeAttendeeMinute;
      const ai =
        visits * ((6000 * u.haikuInPerM + 1000 * u.haikuOutPerM) / 1e6) +
        20 * ((20000 * u.sonnetInPerM + 2000 * u.sonnetOutPerM) / 1e6) +
        visits * 0.3 * 8 * u.comprehendUnit;
      const ch = visits * u.claim + 20 * u.era + 35 * u.eligibility + 20 * u.claimStatus;
      return [
        { item: 'Hosting, database, storage, backups, security services', perMonth: 8, basis: '[EST] allocation of current AWS bill' },
        { item: 'Telehealth video (Chime SDK)', perMonth: r2(tele), basis: '108 sessions × 30% × 50 min × 2 attendees' },
        { item: 'Text and email reminders', perMonth: r2(visits * 2 * u.smsMessage), basis: '2 texts per visit' },
        { item: 'AI insights (Bedrock) and coding assist (Comprehend Medical)', perMonth: r2(ai), basis: 'Haiku per visit, 20 Sonnet insights, coding on 30% of notes' },
        { item: 'Clearinghouse (Waystar)', perMonth: r2(ch), basis: '108 claims, 20 ERAs, 35 eligibility, 20 status checks' },
        { item: 'Customer support and success', perMonth: 8, basis: '[EST]' },
      ];
    }
    case 'prescriber': {
      const visits = 173;
      const tele = visits * 0.3 * 25 * 2 * u.chimeAttendeeMinute;
      const ai =
        visits * ((6000 * u.haikuInPerM + 1000 * u.haikuOutPerM) / 1e6) +
        20 * ((20000 * u.sonnetInPerM + 2000 * u.sonnetOutPerM) / 1e6) +
        visits * 0.3 * 8 * u.comprehendUnit;
      const ch = visits * u.claim + 30 * u.era + 50 * u.eligibility + 35 * u.claimStatus;
      return [
        { item: 'Hosting, database, storage, backups, security services', perMonth: 8, basis: '[EST]' },
        { item: 'Telehealth video (Chime SDK)', perMonth: r2(tele), basis: '173 visits × 30% × 25 min × 2 attendees' },
        { item: 'Text and email reminders', perMonth: r2(visits * 2 * u.smsMessage), basis: '2 texts per visit' },
        { item: 'AI insights and coding assist', perMonth: r2(ai), basis: 'as clinician, scaled to visits' },
        { item: 'Clearinghouse (Waystar)', perMonth: r2(ch), basis: '173 claims, 30 ERAs, 50 eligibility, 35 status checks' },
        {
          item: 'E-prescribing: DrFirst Rcopia + EPCS token + PDMP',
          perMonth: u.drFirstPerPrescriber + u.epcsTokenPerPrescriberMonth + u.pdmpPerPrescriberMonth,
          basis: '[EST] pass-through; PDMP via CRISP assumed included in DrFirst; replace with DrFirst contract',
        },
        { item: 'Customer support and success', perMonth: 10, basis: '[EST]' },
      ];
    }
    case 'paraprofessional': {
      const contacts = 60;
      return [
        { item: 'Hosting and storage', perMonth: 5, basis: '[EST]' },
        { item: 'Telehealth video', perMonth: r2(contacts * 0.1 * 45 * 2 * u.chimeAttendeeMinute), basis: '10% of 60 contacts × 45 min' },
        { item: 'Text reminders', perMonth: r2(contacts * u.smsMessage), basis: '1 text per contact' },
        { item: 'AI (Bedrock Haiku)', perMonth: r2(contacts * ((6000 * u.haikuInPerM + 1000 * u.haikuOutPerM) / 1e6)), basis: '1 call per contact' },
        { item: 'Clearinghouse', perMonth: r2(15 * u.claim + 15 * u.eligibility), basis: '15 claims and eligibility checks (PRP monthly billing)' },
        { item: 'Customer support', perMonth: 5, basis: '[EST]' },
      ];
    }
    case 'support':
      return [
        { item: 'Hosting', perMonth: 2, basis: '[EST]' },
        { item: 'Support', perMonth: 2, basis: '[EST]' },
      ];
  }
}

export function seatCostLines(type: SeatType): CostLine[] {
  return seatLines(type);
}

/** Estimated monthly COGS of one seat (excluding AI Scribe and payment processing). */
export function seatCost(type: SeatType): number {
  return r2(seatLines(type).reduce((s, l) => s + l.perMonth, 0));
}

/** Pass-through share of a seat's cost (clearinghouse + e-prescribing), for the software-only margin. */
export function seatPassThroughCost(type: SeatType): number {
  return r2(
    seatLines(type)
      .filter((l) => /Clearinghouse|E-prescribing/.test(l.item))
      .reduce((s, l) => s + l.perMonth, 0)
  );
}

export type ScribeEngine = 'transcribe_medical' | 'transcribe_standard' | 'healthscribe';

/** Engine the product uses by default (src/lib/scribe/settings.ts DEFAULT_TRANSCRIPTION_ENGINE = 'standard'). */
export const DEFAULT_SCRIBE_ENGINE: ScribeEngine = 'transcribe_standard';

/** Average ambient minutes per scribe user per month: ~55% of a clinician's 108 sessions, 40 min captured. */
export const SCRIBE_MINUTES_PER_USER = 2400;

/** Gross margin (%) of one AI Scribe user at a price, net of card processing. */
export function scribeMarginPercent(pricePerMonth: number, engine: ScribeEngine = DEFAULT_SCRIBE_ENGINE, minutes = SCRIBE_MINUTES_PER_USER): number {
  const cost = scribeCostPerUser(engine, minutes) + (pricePerMonth * UNIT_COSTS.paymentProcessingPercent) / 100;
  return r2(((pricePerMonth - cost) / pricePerMonth) * 100);
}

/** Monthly cost of one AI Scribe user on an engine (ASR + note drafting). */
export function scribeCostPerUser(engine: ScribeEngine, minutes = SCRIBE_MINUTES_PER_USER): number {
  const u = UNIT_COSTS;
  const notes = 65;
  const draft = notes * ((15000 * u.sonnetInPerM + 1500 * u.sonnetOutPerM) / 1e6);
  switch (engine) {
    case 'transcribe_medical':
      return r2(minutes * u.transcribeMedicalMinute + draft);
    case 'transcribe_standard':
      return r2(minutes * u.transcribeStandardMinute + draft);
    case 'healthscribe':
      return r2(minutes * u.healthScribeMinute); // HealthScribe drafts the note itself
  }
}

export type QuoteCost = {
  seats: number;
  support: number;
  locations: number;
  scribe: number;
  claimsOverageCost: number;
  paymentProcessing: number;
  total: number;
  passThrough: number;
  revenue: number;
  grossMargin: number;
  /** Margin with clearinghouse, e-prescribing and scribe ASR removed from both sides (software only). */
  softwareMargin: number;
};

/** Estimated monthly COGS and gross margin for a quote. */
export function costForQuote(
  q: PriceQuote,
  opts: { supportUsers?: number; scribeEngine?: ScribeEngine; scribeMinutesPerUser?: number } = {}
): QuoteCost {
  const engine = opts.scribeEngine ?? DEFAULT_SCRIBE_ENGINE;
  const types: BillableSeatType[] = ['prescriber', 'clinician', 'paraprofessional'];
  const seats = r2(types.reduce((s, t) => s + q.seats[t] * seatCost(t), 0));
  const seatPass = r2(types.reduce((s, t) => s + q.seats[t] * seatPassThroughCost(t), 0));
  const support = r2((opts.supportUsers ?? 0) * seatCost('support'));
  const locations = r2(q.locations * LOCATION_COST_PER_MONTH);
  const scribe = r2(q.aiScribeUsers * scribeCostPerUser(engine, opts.scribeMinutesPerUser));
  // Overage claims cost the clearinghouse fee plus its ERA, eligibility and status share (~$0.21); priced at CLAIM_OVERAGE_PER_CLAIM.
  const claimsOverageCost = r2((q.claimsOverage / CLAIM_OVERAGE_PER_CLAIM) * 0.21);
  const revenue = r2(q.subscriptionPerMonth + q.usagePerMonth);
  const paymentProcessing = r2((revenue * UNIT_COSTS.paymentProcessingPercent) / 100);
  const total = r2(seats + support + locations + scribe + claimsOverageCost + paymentProcessing);
  const passThrough = r2(seatPass + scribe + claimsOverageCost);
  const grossMargin = revenue > 0 ? r2(((revenue - total) / revenue) * 100) : 0;
  const scribeRevenue = q.lines.find((l) => l.id === 'addon_ai_scribe')?.amount ?? 0;
  // Software-only view: pass-through services are treated as resold at cost, so their cost is
  // removed from both revenue and COGS, and scribe/usage revenue is excluded.
  const softwareRevenue = revenue - scribeRevenue - q.usagePerMonth - seatPass;
  const softwareCost = total - passThrough;
  const softwareMargin = softwareRevenue > 0 ? r2(((softwareRevenue - softwareCost) / softwareRevenue) * 100) : 0;
  return { seats, support, locations, scribe, claimsOverageCost, paymentProcessing, total, passThrough, revenue, grossMargin, softwareMargin };
}

/** Stated margin targets (docs/pricing-model.md). */
export const MARGIN_TARGETS = {
  /** Software only (seats with clearinghouse and e-prescribing treated as resold at cost). Pure-SaaS benchmark is 75–80%. */
  softwarePercent: 70,
  /** Blended subscription on Professional and Clinic, including pass-through services and AI Scribe on standard Transcribe (the default engine). */
  blendedPercent: 55,
  /** AI Scribe line on its own. */
  scribePercent: 50,
} as const;

/** Tier list used by docs and tests. */
export const COSTED_TIERS = Object.keys(TIERS).filter((t) => TIERS[t as keyof typeof TIERS].seatPrices) as (keyof typeof TIERS)[];
