/**
 * Per-patient due items (pure, no prisma). Every reason is built from DueFacts: a missing date
 * says "none on file", never a guess. The loader fills DueFacts from the chart.
 */
import { isControlledSubstance } from '@/lib/ehr/psychMedMgmt';
import { standingDueState } from '@/lib/labs/standing';
import { toPracticeWallTime } from '@/lib/time/practiceTime';
import type { DueItem, VisitKind } from './types';
import { BH_KINDS, PLAN_KINDS, PRESCRIBER_KINDS, SUD_KINDS } from './protocols';

const DAY_MS = 86_400_000;

// ─── Medication classes (name patterns; generic + common brands) ─────────────

const BENZO = /alprazolam|xanax|lorazepam|ativan|clonazepam|klonopin|diazepam|valium|chlordiazepoxide|librium|clorazepate|tranxene|oxazepam|temazepam|restoril|triazolam|halcion|midazolam|clobazam|onfi/i;
const OPIOID = /buprenorphine|suboxone|subutex|zubsolv|sublocade|brixadi|methadone|oxycodone|oxycontin|percocet|hydrocodone|norco|vicodin|morphine|hydromorphone|dilaudid|fentanyl|tapentadol|nucynta|tramadol|ultram|codeine|oxymorphone/i;
const STIMULANT = /amphetamine|adderall|mydayis|lisdexamfetamine|vyvanse|dexedrine|zenzedi|evekeo|methylphenidate|ritalin|concerta|methylin|focalin|azstarys|jornay|daytrana|cotempla|quillichew|quillivant|relexxii|adzenys|dyanavel|desoxyn|methamphetamine/i;
const ANTIPSYCHOTIC = /clozapine|clozaril|versacloz|olanzapine|zyprexa|quetiapine|seroquel|risperidone|risperdal|paliperidone|invega|aripiprazole|abilify|aristada|ziprasidone|geodon|lurasidone|latuda|asenapine|saphris|iloperidone|fanapt|cariprazine|vraylar|brexpiprazole|rexulti|lumateperone|caplyta|haloperidol|haldol|fluphenazine|perphenazine|chlorpromazine|loxapine|thiothixene|pimavanserin|nuplazid/i;
const LITHIUM = /lithium|lithobid|eskalith/i;
const VALPROATE = /valpro|depakote|divalproex|depakene/i;
const ANTIDEPRESSANT = /sertraline|zoloft|fluoxetine|prozac|escitalopram|lexapro|citalopram|celexa|paroxetine|paxil|fluvoxamine|venlafaxine|effexor|desvenlafaxine|pristiq|duloxetine|cymbalta|levomilnacipran|bupropion|wellbutrin|mirtazapine|remeron|trazodone|vilazodone|viibryd|vortioxetine|trintellix|amitriptyline|nortriptyline|imipramine|desipramine|clomipramine|doxepin|phenelzine|tranylcypromine|selegiline|emsam|zuranolone|auvelity/i;

export type MedFlags = {
  controlled: boolean;
  antipsychotic: boolean;
  benzo: boolean;
  opioid: boolean;
  stimulant: boolean;
  lithium: boolean;
  valproate: boolean;
  antidepressant: boolean;
};

/** Class flags for one med. `schedule` is DrFirst / ClientMedication.schedule; isAntipsychotic the chart flag. */
export function classifyMed(name: string, opts: { schedule?: string | null; isAntipsychotic?: boolean } = {}): MedFlags {
  const n = name || '';
  return {
    controlled: isControlledSubstance(n, opts.schedule ?? null),
    antipsychotic: Boolean(opts.isAntipsychotic) || ANTIPSYCHOTIC.test(n),
    benzo: BENZO.test(n),
    opioid: OPIOID.test(n),
    stimulant: STIMULANT.test(n),
    lithium: LITHIUM.test(n),
    valproate: VALPROATE.test(n),
    antidepressant: ANTIDEPRESSANT.test(n),
  };
}

// ─── Input ───────────────────────────────────────────────────────────────────

export type DueMed = MedFlags & {
  name: string;
  /** start date on file (null = unknown) */
  startedAt: Date | null;
  /** started since the last completed visit */
  isNew: boolean;
};

export type DueFacts = {
  kind: VisitKind;
  ageYears: number | null;
  isVirtual: boolean;
  /** practice time zone for "today" (default America/New_York) */
  timeZone?: string;
  intervals: { phq9Days: number; gad7Days: number; aimsDays: number; sdohDays: number; pdmpDays: number };
  /** latest administration / result dates (null = none on file) */
  latest: {
    phq9: Date | null;
    gad7: Date | null;
    cssrs: Date | null;
    aims: Date | null;
    sdoh: Date | null;
    auditC: Date | null;
    glucoseOrA1c: Date | null;
    lipids: Date | null;
    pdmp: Date | null;
  };
  meds: DueMed[];
  standingLabs: { tests: string[]; nextDueAt: Date; active: boolean; endDate: Date | null }[];
  labsAwaitingReview: number;
  /** null = no active / draft plan on file */
  treatmentPlan: { status: string; reviewDueAt: Date | null } | null;
  consents: { telehealth: boolean; part2: boolean; medication: boolean; minor: boolean; treatment: boolean };
  safetyPlanOnFile: boolean;
  /** 'high' | 'moderate' | 'low' | 'unknown' */
  riskLevel: string;
  pendingRenewals: number;
  notPickedUp: { drug: string; date: Date }[];
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const daysSince = (d: Date, now: Date) => Math.floor((now.getTime() - d.getTime()) / DAY_MS);
const isoDay = (d: Date, tz: string) => toPracticeWallTime(d, tz).date;

function intervalItem(
  id: string,
  label: string,
  last: Date | null,
  intervalDays: number,
  now: Date,
  tz: string,
  extra: Pick<DueItem, 'action' | 'basis'>
): DueItem | null {
  if (!last) return { id, label, reason: `${label}: none on file (interval ${intervalDays} days)`, severity: 'due', ...extra };
  const days = daysSince(last, now);
  if (days < intervalDays) return null;
  return {
    id,
    label,
    reason: `last ${label} ${days} days ago on ${isoDay(last, tz)} (interval ${intervalDays} days)`,
    severity: days >= intervalDays * 2 ? 'overdue' : 'due',
    ...extra,
  };
}

const names = (meds: DueMed[]) => meds.map((m) => m.name).join(', ');

// ─── Rules ───────────────────────────────────────────────────────────────────

export function computeDueItems(facts: DueFacts, now: Date): DueItem[] {
  const tz = facts.timeZone || 'America/New_York';
  const out: DueItem[] = [];
  const add = (item: DueItem | null) => {
    if (item) out.push(item);
  };
  const kind = facts.kind;
  const bh = BH_KINDS.has(kind);
  const prescriber = PRESCRIBER_KINDS.has(kind);
  const medsVisit = prescriber || kind === 'primary_care';
  const minor = facts.ageYears != null && facts.ageYears < 18;
  const today = isoDay(now, tz);

  // C-SSRS every BH visit (practice policy, NPSG 15.01.01)
  if (bh) {
    const doneToday = facts.latest.cssrs && isoDay(facts.latest.cssrs, tz) === today;
    if (!doneToday) {
      add({
        id: 'cssrs',
        label: 'C-SSRS',
        reason: facts.latest.cssrs ? `last C-SSRS on ${isoDay(facts.latest.cssrs, tz)}; practice screens every behavioral health visit` : 'C-SSRS: none on file; practice screens every behavioral health visit',
        severity: facts.latest.cssrs ? 'due' : 'overdue',
        action: { kind: 'assessment', instrument: 'C-SSRS' },
        basis: ['tjc_suicide_screen'],
      });
    }
  }

  // Measurement-based care
  if (bh && kind !== 'discharge') {
    add(intervalItem('phq9', 'PHQ-9', facts.latest.phq9, facts.intervals.phq9Days, now, tz, { action: { kind: 'assessment', instrument: minor ? 'PHQ-A' : 'PHQ-9' }, basis: ['tjc_mbc'] }));
    add(intervalItem('gad7', 'GAD-7', facts.latest.gad7, facts.intervals.gad7Days, now, tz, { action: { kind: 'assessment', instrument: 'GAD-7' }, basis: ['tjc_mbc'] }));
  }

  // Safety plan when risk is elevated
  const risk = facts.riskLevel.toLowerCase();
  if ((risk === 'high' || risk === 'moderate' || risk === 'medium') && !facts.safetyPlanOnFile && kind !== 'no_show') {
    add({
      id: 'safety_plan',
      label: 'Safety plan',
      reason: `risk level ${risk}; no safety plan on file`,
      severity: 'overdue',
      action: { kind: 'safety_plan' },
      basis: ['tjc_suicide_screen'],
    });
  }

  // SDOH yearly
  if (bh || kind === 'primary_care') {
    add(intervalItem('sdoh', 'SDOH screen', facts.latest.sdoh, facts.intervals.sdohDays, now, tz, { action: { kind: 'sdoh' }, basis: ['sdoh_screen'] }));
  }

  // Treatment plan
  if (PLAN_KINDS.has(kind)) {
    const p = facts.treatmentPlan;
    if (!p) {
      add({ id: 'treatment_plan', label: 'Treatment plan', reason: 'no active treatment plan on file', severity: 'overdue', action: { kind: 'treatment_plan' }, basis: ['treatment_plan_review'] });
    } else if (p.reviewDueAt && p.reviewDueAt.getTime() < now.getTime()) {
      add({
        id: 'treatment_plan',
        label: 'Treatment plan review',
        reason: `plan review was due ${isoDay(p.reviewDueAt, tz)} (${daysSince(p.reviewDueAt, now)} days ago)`,
        severity: 'overdue',
        action: { kind: 'treatment_plan' },
        basis: ['treatment_plan_review'],
      });
    } else if (p.status === 'DRAFT') {
      add({ id: 'treatment_plan', label: 'Treatment plan', reason: 'treatment plan is a draft (not signed)', severity: 'due', action: { kind: 'treatment_plan' }, basis: ['treatment_plan_review'] });
    }
  }

  // Consents
  if (facts.isVirtual && !facts.consents.telehealth) {
    add({
      id: 'telehealth_consent',
      label: 'Telehealth consent',
      reason: 'telehealth visit; no signed telehealth consent on file',
      severity: 'due',
      action: { kind: 'consents', template: 'telehealth-consent' },
      basis: ['telehealth_consent_location'],
    });
  }
  if (SUD_KINDS.has(kind) && !facts.consents.part2) {
    add({
      id: 'part2_consent',
      label: '42 CFR Part 2 consent',
      reason: 'SUD visit; no signed Part 2 consent on file',
      severity: 'due',
      action: { kind: 'consents', template: 'part2-consent' },
      basis: ['part2_consent'],
    });
  }
  if (minor && !facts.consents.minor && kind !== 'no_show' && kind !== 'telephone') {
    const age = facts.ageYears as number;
    add({
      id: 'minor_consent',
      label: 'Minor consent',
      reason: `age ${age}; no minor treatment consent on file${age >= 16 ? ' (16+ may consent to outpatient mental health care)' : ''}`,
      severity: age >= 16 ? 'info' : 'due',
      action: { kind: 'consents', template: 'minor-consent-treatment' },
      basis: ['minor_consent_md'],
    });
  }

  if (medsVisit) {
    const active = facts.meds;
    // PDMP: benzodiazepine / opioid every 90 days (Md. Health-General §21-2A-04.1)
    const pdmpMeds = active.filter((m) => m.benzo || m.opioid);
    if (pdmpMeds.length) {
      const last = facts.latest.pdmp;
      const days = last ? daysSince(last, now) : null;
      // Started since the last query: the law asks for a query before the course starts
      const startedAfterQuery = last ? pdmpMeds.filter((m) => m.isNew && m.startedAt && m.startedAt.getTime() > last.getTime()) : [];
      if (days != null && days < facts.intervals.pdmpDays && startedAfterQuery.length) {
        add({
          id: 'pdmp',
          label: 'PDMP (CRISP) query',
          reason: `${names(startedAfterQuery)} started after the last PDMP query on ${isoDay(last as Date, tz)}; query before starting a benzodiazepine or opioid`,
          severity: 'due',
          basis: ['md_pdmp'],
          ...(prescriber ? { action: { kind: 'pdmp_attest' as const } } : {}),
        });
      } else if (days == null || days >= facts.intervals.pdmpDays) {
        add({
          id: 'pdmp',
          label: 'PDMP (CRISP) query',
          reason: last
            ? `on ${names(pdmpMeds)}; last PDMP query ${days} days ago on ${isoDay(last, tz)} (every ${facts.intervals.pdmpDays} days)`
            : `on ${names(pdmpMeds)}; no PDMP query on file`,
          severity: last ? 'overdue' : 'due',
          basis: ['md_pdmp'],
          ...(prescriber ? { action: { kind: 'pdmp_attest' as const } } : {}),
        });
      }
    } else {
      const stim = active.filter((m) => m.stimulant || (m.controlled && !m.benzo && !m.opioid));
      if (stim.length) {
        const last = facts.latest.pdmp;
        add({
          id: 'pdmp',
          label: 'PDMP (CRISP) check',
          reason: `on ${names(stim)} (controlled); ${last ? `last PDMP query on ${isoDay(last, tz)}` : 'no PDMP query on file'}; review recommended`,
          severity: 'info',
          basis: ['md_pdmp'],
          ...(prescriber ? { action: { kind: 'pdmp_attest' as const } } : {}),
        });
      }
    }
  }

  if (prescriber) {
    const active = facts.meds;
    const aps = active.filter((m) => m.antipsychotic);
    if (aps.length) {
      // AIMS every 6 months (practice) on an antipsychotic
      const last = facts.latest.aims;
      if (!last) {
        add({ id: 'aims', label: 'AIMS', reason: `on ${names(aps)}; no AIMS on file`, severity: 'due', action: { kind: 'assessment', instrument: 'AIMS' }, basis: ['apa_aims'] });
      } else if (daysSince(last, now) >= facts.intervals.aimsDays) {
        add({
          id: 'aims',
          label: 'AIMS',
          reason: `on ${names(aps)}; last AIMS ${daysSince(last, now)} days ago on ${isoDay(last, tz)} (every ${facts.intervals.aimsDays} days)`,
          severity: 'overdue',
          action: { kind: 'assessment', instrument: 'AIMS' },
          basis: ['apa_aims'],
        });
      }
      // Metabolic labs (ADA/APA; HEDIS SSD adults, APM youth)
      const startedEarliest = aps.map((m) => m.startedAt).filter((d): d is Date => Boolean(d)).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
      const g = facts.latest.glucoseOrA1c;
      const yearBasis = minor ? ['ada_apa_metabolic', 'hedis_apm'] : ['ada_apa_metabolic', 'hedis_ssd'];
      if (!g) {
        add({ id: 'metabolic_glucose', label: 'Glucose / A1c', reason: `on ${names(aps)}; no glucose or A1c result on file`, severity: 'due', action: { kind: 'labs' }, basis: yearBasis });
      } else if (daysSince(g, now) >= 365) {
        add({ id: 'metabolic_glucose', label: 'Glucose / A1c', reason: `on ${names(aps)}; last glucose / A1c on ${isoDay(g, tz)} (yearly)`, severity: 'overdue', action: { kind: 'labs' }, basis: yearBasis });
      } else if (startedEarliest && g.getTime() < startedEarliest.getTime() && daysSince(startedEarliest, now) >= 84) {
        add({ id: 'metabolic_glucose', label: 'Glucose / A1c (12-week)', reason: `antipsychotic started ${isoDay(startedEarliest, tz)}; last glucose / A1c ${isoDay(g, tz)} is before the start`, severity: 'due', action: { kind: 'labs' }, basis: ['ada_apa_metabolic'] });
      }
      const l = facts.latest.lipids;
      const lipidInterval = minor ? 365 : 365 * 5;
      if (!l) {
        add({ id: 'metabolic_lipids', label: 'Lipid panel', reason: `on ${names(aps)}; no lipid result on file`, severity: 'due', action: { kind: 'labs' }, basis: minor ? ['ada_apa_metabolic', 'hedis_apm'] : ['ada_apa_metabolic'] });
      } else if (daysSince(l, now) >= lipidInterval) {
        add({
          id: 'metabolic_lipids',
          label: 'Lipid panel',
          reason: `on ${names(aps)}; last lipids on ${isoDay(l, tz)} (${minor ? 'yearly for youth' : 'every 5 years when normal'})`,
          severity: 'due',
          action: { kind: 'labs' },
          basis: minor ? ['ada_apa_metabolic', 'hedis_apm'] : ['ada_apa_metabolic'],
        });
      } else if (startedEarliest && l.getTime() < startedEarliest.getTime() && daysSince(startedEarliest, now) >= 84) {
        add({ id: 'metabolic_lipids', label: 'Lipid panel (12-week)', reason: `antipsychotic started ${isoDay(startedEarliest, tz)}; last lipids ${isoDay(l, tz)} is before the start`, severity: 'due', action: { kind: 'labs' }, basis: ['ada_apa_metabolic'] });
      }
    }

    // Lithium / valproate levels: standing order expected
    const hasStanding = (re: RegExp) => facts.standingLabs.some((s) => s.active && s.tests.some((t) => re.test(t)));
    for (const [flag, label, re] of [
      ['lithium', 'Lithium level', /lithium/i],
      ['valproate', 'Valproate level', /valpro/i],
    ] as const) {
      const meds = active.filter((m) => m[flag]);
      if (meds.length && !hasStanding(re)) {
        add({ id: `${flag}_level`, label, reason: `on ${names(meds)}; no standing ${label.toLowerCase()} order on file`, severity: 'info', action: { kind: 'labs' } });
      }
    }

    // New medication without a medication consent on file
    const newMeds = active.filter((m) => m.isNew);
    if (newMeds.length && !facts.consents.medication) {
      add({
        id: 'med_consent',
        label: 'Medication consent',
        reason: `started ${names(newMeds)} since the last visit; no signed psychiatric medication consent on file`,
        severity: 'due',
        action: { kind: 'consents', template: 'psychiatric-medication-consent' },
        basis: ['informed_consent_psychotropic'],
      });
    }

    // HEDIS ADD: child newly on ADHD medication → prescriber follow-up within 30 days
    if (minor) {
      for (const m of active.filter((x) => x.stimulant && x.startedAt)) {
        const d = daysSince(m.startedAt as Date, now);
        if (d <= 30) {
          add({
            id: `add_followup_${m.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
            label: 'ADHD med 30-day follow-up',
            reason: `${m.name} started ${isoDay(m.startedAt as Date, tz)} (${d} days ago); this visit counts toward the 30-day follow-up`,
            severity: 'info',
            basis: ['hedis_add'],
          });
        }
      }
    }

    // HEDIS AMM: new antidepressant adherence
    for (const m of active.filter((x) => x.antidepressant && x.isNew && x.startedAt)) {
      add({
        id: `amm_${m.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
        label: 'Antidepressant adherence',
        reason: `${m.name} started ${isoDay(m.startedAt as Date, tz)}; check it is being taken (84 / 180 days)`,
        severity: 'info',
        basis: ['hedis_amm'],
      });
    }
  }

  if (medsVisit) {
    // Standing labs due / overdue (any order)
    for (const s of facts.standingLabs) {
      const state = standingDueState(s, now);
      if (state !== 'overdue' && state !== 'due_soon') continue;
      const tests = s.tests.join(', ') || 'standing order';
      add({
        id: `standing_${isoDay(s.nextDueAt, tz)}_${tests.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40)}`,
        label: 'Standing labs',
        reason: `${tests} ${state === 'overdue' ? 'overdue since' : 'due'} ${isoDay(s.nextDueAt, tz)}`,
        severity: state === 'overdue' ? 'overdue' : 'due',
        action: { kind: 'labs' },
      });
    }
    if (facts.labsAwaitingReview > 0) {
      add({ id: 'labs_review', label: 'Lab results to review', reason: `${facts.labsAwaitingReview} resulted lab order(s) awaiting review`, severity: 'due', action: { kind: 'labs' } });
    }
    if (facts.pendingRenewals > 0) {
      add({ id: 'renewals', label: 'Refill requests', reason: `${facts.pendingRenewals} pharmacy refill request(s) pending in DrFirst`, severity: 'due', action: { kind: 'drfirst', screen: 'message' } });
    }
    for (const f of facts.notPickedUp.slice(0, 5)) {
      add({
        id: `not_dispensed_${f.drug.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${isoDay(f.date, tz)}`,
        label: 'Prescription not picked up',
        reason: `pharmacy reported ${f.drug} not dispensed on ${isoDay(f.date, tz)}`,
        severity: 'due',
        action: { kind: 'drfirst', screen: 'manage_medications' },
        basis: ['tjc_med_rec'],
      });
    }
  }

  const rank = { overdue: 0, due: 1, info: 2 } as const;
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}
