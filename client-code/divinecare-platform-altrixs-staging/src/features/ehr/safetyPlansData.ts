/** Stanley-Brown safety plan types + clinic seed (ClinicModuleState `ehr-safety-plans`). */

export type RiskLevel = 'High' | 'Moderate' | 'Low';

export type SafetyContact = {
  name: string;
  relationship: string;
  phone: string;
};

export type MeansItem = {
  id: string;
  label: string;
  done: boolean;
};

export type SafetyStep = {
  id: number;
  title: string;
  prompt: string;
  content: string;
};

export type CrisisResource = {
  label: string;
  value: string;
  urgent?: boolean;
};

export type ClientPlan = {
  id: string;
  /** Client record id (plans created before this field only carry clientName) */
  clientId?: string;
  clientName: string;
  initials: string;
  fullLabel: string;
  clinician: string;
  clinicianPhone: string;
  /** null = not recorded (never defaulted or derived) */
  phq9: number | null;
  /** null = not recorded (never derived from PHQ-9) */
  gad7: number | null;
  /** null = not assessed */
  risk: RiskLevel | null;
  /** ISO date; '' when unknown */
  createdAt: string;
  /** ISO date; '' when unknown */
  lastUpdated: string;
  /** ISO date; '' when never reviewed / unknown */
  lastReviewed: string;
  reviewDue: boolean;
  clientSigned: boolean;
  clinicianSigned: boolean;
  /** Counts toward “Reviewed in Session” KPI */
  sessionReviews: number;
  steps: SafetyStep[];
  distractionContacts: SafetyContact[];
  helpContacts: SafetyContact[];
  crisisResources: CrisisResource[];
  meansItems: MeansItem[];
  meansCounselingDocumented: boolean;
  meansNotes: string;
  /** High-risk client flagged without a usable plan (0% steps) */
  withoutPlan?: boolean;
};

export const STANLEY_BROWN_TEMPLATE: Omit<SafetyStep, 'content'>[] = [
  {
    id: 1,
    title: 'Warning Signs',
    prompt: 'Thoughts, feelings, moods, or behaviors that signal a crisis may be developing:',
  },
  {
    id: 2,
    title: 'Internal Coping Strategies',
    prompt: 'Things I can do on my own to distract myself and take my mind off the problem:',
  },
  {
    id: 3,
    title: 'Social Contacts Who Provide Distraction',
    prompt: 'People and social settings that provide distraction from the crisis:',
  },
  {
    id: 4,
    title: 'People I Can Ask for Help',
    prompt: 'People I can tell I am having a hard time and who I can ask for help:',
  },
  {
    id: 5,
    title: 'Professionals & Agencies',
    prompt: 'Clinicians, crisis lines, and agencies to contact for help:',
  },
  {
    id: 6,
    title: 'Making the Environment Safe',
    prompt: 'Things I can do to reduce access to lethal means and make my environment safer:',
  },
];

export const DEFAULT_MEANS_ITEMS: MeansItem[] = [
  {
    id: 'firearms',
    label: 'Remove firearms from home or transfer to a trusted person outside the household.',
    done: false,
  },
  {
    id: 'meds',
    label: 'Store medications with a trusted person or in a locked container.',
    done: false,
  },
  {
    id: 'substances',
    label: 'Limit access to alcohol and other substances in the home.',
    done: false,
  },
  {
    id: 'sharps',
    label: 'Asked family or roommate to secure sharp objects.',
    done: false,
  },
];

export const DEFAULT_CRISIS: CrisisResource[] = [
  { label: '988 Suicide and Crisis Lifeline', value: '988', urgent: true },
  { label: 'Crisis Text Line', value: 'Text HOME to 741741' },
  { label: 'Emergency Services', value: '911', urgent: true },
  { label: 'Nearest Emergency Room', value: "Prince George's Hospital Center — (301) 618-2000" },
];

/** Display helpers — missing values are shown as missing, never filled in. */
export const NOT_RECORDED = 'Not recorded';
export const NOT_ASSESSED = 'Not assessed';

export function scoreLabel(score: number | null | undefined): string {
  return typeof score === 'number' && Number.isFinite(score) ? String(score) : NOT_RECORDED;
}

export function riskLabel(risk: RiskLevel | null | undefined): string {
  return risk ?? NOT_ASSESSED;
}

export function dateLabel(date: string | null | undefined): string {
  return date && date.trim() ? date : '—';
}

function validScore(v: unknown, max: number): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max ? v : null;
}

function validRisk(v: unknown): RiskLevel | null {
  return v === 'High' || v === 'Moderate' || v === 'Low' ? v : null;
}

export function buildEmptySteps(): SafetyStep[] {
  return STANLEY_BROWN_TEMPLATE.map((s) => ({ ...s, content: '' }));
}

export function completedStepCount(plan: ClientPlan): number {
  return plan.steps.filter((s) => {
    if (s.id === 6) {
      return Boolean(
        s.content.trim() ||
          plan.meansItems.some((m) => m.done) ||
          plan.meansNotes.trim()
      );
    }
    if (s.id === 3 && plan.distractionContacts.length > 0) return true;
    if (s.id === 4 && plan.helpContacts.length > 0) return true;
    return s.content.trim().length > 0;
  }).length;
}

export function planProgress(plan: ClientPlan): number {
  return Math.round((completedStepCount(plan) / 6) * 100);
}

function means(doneIds: string[], extras?: Partial<MeansItem>[]): MeansItem[] {
  const base = DEFAULT_MEANS_ITEMS.map((m) => ({
    ...m,
    done: doneIds.includes(m.id),
  }));
  if (extras?.length) return [...base, ...extras.map((e, i) => ({ id: `x-${i}`, label: '', done: false, ...e }))];
  return base;
}

function plan(
  p: Omit<ClientPlan, 'gad7' | 'crisisResources'> & { gad7?: number | null; crisisResources?: CrisisResource[] }
): ClientPlan {
  const clinicianLine = [p.clinician.trim(), p.clinicianPhone.trim()].filter(Boolean).join(' — ');
  return {
    ...p,
    gad7: p.gad7 ?? null,
    crisisResources: p.crisisResources ?? [
      ...(clinicianLine ? [{ label: 'My Clinician', value: clinicianLine }] : []),
      ...DEFAULT_CRISIS,
    ],
  };
}

export function createBlankPlan(input: {
  id: string;
  clientId?: string;
  clientName: string;
  clinician: string;
  clinicianPhone?: string;
  risk?: RiskLevel | null;
  phq9?: number | null;
  gad7?: number | null;
}): ClientPlan {
  const initials = input.clientName
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]?.toUpperCase() || '')
    .join('.')
    .slice(0, 4);
  const today = new Date().toISOString().slice(0, 10);
  return plan({
    id: input.id,
    ...(input.clientId ? { clientId: input.clientId } : {}),
    clientName: input.clientName,
    initials: initials.includes('.') ? initials : `${initials}.`,
    fullLabel: `${input.clientName} — Outpatient`,
    clinician: input.clinician,
    clinicianPhone: input.clinicianPhone || '',
    phq9: validScore(input.phq9, 27),
    gad7: validScore(input.gad7, 21),
    risk: validRisk(input.risk),
    createdAt: today,
    lastUpdated: today,
    // Not reviewed with the client yet — set when the plan is saved/reviewed in session.
    lastReviewed: '',
    reviewDue: false,
    clientSigned: false,
    clinicianSigned: false,
    sessionReviews: 0,
    steps: buildEmptySteps(),
    distractionContacts: [],
    helpContacts: [],
    meansItems: means([]),
    meansCounselingDocumented: false,
    meansNotes: '',
  });
}

/** Normalize legacy seed rows that only had steps[].content */
export function normalizePlan(raw: Partial<ClientPlan> & { id: string }): ClientPlan {
  const clinician = raw.clinician || '';
  const phone = raw.clinicianPhone || '';
  const name =
    raw.clientName ||
    (raw.fullLabel ? raw.fullLabel.split('—')[0]?.trim() : '') ||
    raw.initials ||
    'Client';
  const baseSteps =
    Array.isArray(raw.steps) && raw.steps.length
      ? STANLEY_BROWN_TEMPLATE.map((t) => {
          const found = raw.steps?.find((s) => s.id === t.id);
          return { ...t, content: found?.content || '' };
        })
      : buildEmptySteps();

  return plan({
    id: raw.id,
    ...(raw.clientId ? { clientId: raw.clientId } : {}),
    clientName: name,
    initials: raw.initials || name.slice(0, 1) + '.',
    fullLabel: raw.fullLabel || name,
    clinician,
    clinicianPhone: phone,
    phq9: validScore(raw.phq9, 27),
    gad7: validScore(raw.gad7, 21),
    risk: validRisk(raw.risk),
    createdAt: raw.createdAt || '',
    lastUpdated: raw.lastUpdated || '',
    lastReviewed: raw.lastReviewed || '',
    reviewDue: Boolean(raw.reviewDue),
    clientSigned: Boolean(raw.clientSigned),
    clinicianSigned: Boolean(raw.clinicianSigned),
    sessionReviews: typeof raw.sessionReviews === 'number' ? raw.sessionReviews : 0,
    steps: baseSteps,
    distractionContacts: Array.isArray(raw.distractionContacts) ? raw.distractionContacts : [],
    helpContacts: Array.isArray(raw.helpContacts) ? raw.helpContacts : [],
    crisisResources: raw.crisisResources,
    meansItems: Array.isArray(raw.meansItems) && raw.meansItems.length ? raw.meansItems : means([]),
    meansCounselingDocumented: Boolean(raw.meansCounselingDocumented),
    meansNotes: raw.meansNotes || '',
    withoutPlan: raw.withoutPlan,
  });
}

/** No sample plans — plans are created per real client. */
export const SAFETY_PLAN_SEED: ClientPlan[] = [];
