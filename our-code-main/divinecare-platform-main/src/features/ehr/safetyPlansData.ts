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
  clientName: string;
  initials: string;
  fullLabel: string;
  clinician: string;
  clinicianPhone: string;
  phq9: number;
  gad7: number;
  risk: RiskLevel;
  createdAt: string;
  lastUpdated: string;
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
  { label: 'Practice Crisis Line', value: '' },
  { label: '988 Suicide and Crisis Lifeline', value: '988', urgent: true },
  { label: 'Crisis Text Line', value: 'Text HOME to 741741' },
  { label: 'Emergency Services', value: '911', urgent: true },
  { label: 'Nearest Emergency Room', value: "Prince George's Hospital Center — (301) 618-2000" },
];

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

function steps(contents: (string | null)[]): SafetyStep[] {
  return STANLEY_BROWN_TEMPLATE.map((s, i) => ({
    ...s,
    content: contents[i] || '',
  }));
}

function means(doneIds: string[], extras?: Partial<MeansItem>[]): MeansItem[] {
  const base = DEFAULT_MEANS_ITEMS.map((m) => ({
    ...m,
    done: doneIds.includes(m.id),
  }));
  if (extras?.length) return [...base, ...extras.map((e, i) => ({ id: `x-${i}`, label: '', done: false, ...e }))];
  return base;
}

function plan(p: Omit<ClientPlan, 'gad7' | 'crisisResources'> & { gad7?: number; crisisResources?: CrisisResource[] }): ClientPlan {
  return {
    ...p,
    gad7: p.gad7 ?? Math.max(5, p.phq9 - 4),
    crisisResources: p.crisisResources ?? [
      { label: 'My Clinician', value: `${p.clinician} — ${p.clinicianPhone}` },
      ...DEFAULT_CRISIS,
    ],
  };
}

export function createBlankPlan(input: {
  id: string;
  clientName: string;
  clinician: string;
  clinicianPhone?: string;
  risk?: RiskLevel;
  phq9?: number;
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
    clientName: input.clientName,
    initials: initials.includes('.') ? initials : `${initials}.`,
    fullLabel: `${input.clientName} — Outpatient`,
    clinician: input.clinician,
    clinicianPhone: input.clinicianPhone || '',
    phq9: input.phq9 ?? 0,
    gad7: 0,
    risk: input.risk ?? 'Moderate',
    createdAt: today,
    lastUpdated: today,
    lastReviewed: today,
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
  const clinician = raw.clinician || 'Clinic Clinician';
  const phone = raw.clinicianPhone || '(301) 555-0100';
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
    clientName: name,
    initials: raw.initials || name.slice(0, 1) + '.',
    fullLabel: raw.fullLabel || `${name} — Outpatient`,
    clinician,
    clinicianPhone: phone,
    phq9: typeof raw.phq9 === 'number' ? raw.phq9 : 10,
    gad7: typeof raw.gad7 === 'number' ? raw.gad7 : undefined,
    risk: raw.risk === 'High' || raw.risk === 'Low' || raw.risk === 'Moderate' ? raw.risk : 'Moderate',
    createdAt: raw.createdAt || raw.lastUpdated || '2026-01-15',
    lastUpdated: raw.lastUpdated || '2026-08-01',
    lastReviewed: raw.lastReviewed || raw.lastUpdated || '2026-08-01',
    reviewDue: Boolean(raw.reviewDue),
    clientSigned: Boolean(raw.clientSigned),
    clinicianSigned: Boolean(raw.clinicianSigned),
    sessionReviews: typeof raw.sessionReviews === 'number' ? raw.sessionReviews : 1,
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

export const SAFETY_PLAN_SEED: ClientPlan[] = [];
