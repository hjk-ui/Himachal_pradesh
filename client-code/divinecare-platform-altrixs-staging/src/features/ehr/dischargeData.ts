/** Discharge & transition planning — ClinicModuleState `ehr-discharge-cases`. */

export type DischargeStatus = 'planning' | 'ready' | 'discharged' | 'follow_up';

export type ChecklistItem = {
  id: string;
  label: string;
  done: boolean;
};

export type FollowUpMilestone = {
  day: 30 | 60 | 90;
  scheduled: string;
  completed: boolean;
  notes: string;
};

export type DischargeCase = {
  id: string;
  /** Client record id (cases created before Oct 2026 only carry clientName; see
   * scripts/backfill-module-client-ids.ts). The modules API scopes cases by it. */
  clientId?: string;
  clientName: string;
  initials: string;
  dob: string;
  label: string;
  reason: string;
  clinician: string;
  status: DischargeStatus;
  admitDate: string;
  targetDischarge: string;
  diagnosis: string;
  extraDiagnoses: number;
  /** Percent of treatment-plan goals met. null = not recorded (never defaulted). */
  goalsMet: number | null;
  /** Measurement-based-care scores. null = not recorded (never defaulted). */
  phq9Start: number | null;
  phq9Latest: number | null;
  gad7Start: number | null;
  gad7Latest: number | null;
  aftercare: string[];
  checklist: ChecklistItem[];
  milestones: FollowUpMilestone[];
  summary: string;
};

export const DISCHARGE_CHECKLIST_LABELS: Record<string, string> = {
  final_session_completed: 'Final session completed',
  discharge_summary_signed: 'Discharge summary written and signed',
  aftercare_confirmed: 'Aftercare appointments confirmed (not just referred)',
  prescriptions_continuity_confirmed: 'Prescriptions filled / medication continuity confirmed',
  crisis_plan_given: 'Crisis plan reviewed and copy given to client',
  roi_sent: 'Release of information sent to new provider(s)',
  followup_7d_scheduled: '7-day follow-up call scheduled',
  chart_closed_inactive: 'Chart closed / status updated to Inactive',
};

export function checklistFromRecord(record: Record<string, boolean>): ChecklistItem[] {
  return Object.entries(record).map(([id, done]) => ({
    id,
    label: DISCHARGE_CHECKLIST_LABELS[id] ?? id.replace(/_/g, ' '),
    done,
  }));
}

export function emptyChecklist(): ChecklistItem[] {
  return checklistFromRecord({
    final_session_completed: false,
    discharge_summary_signed: false,
    aftercare_confirmed: false,
    prescriptions_continuity_confirmed: false,
    crisis_plan_given: false,
    roi_sent: false,
    followup_7d_scheduled: false,
    chart_closed_inactive: false,
  });
}

function flattenAftercare(aftercare: {
  referrals: string[];
  medications: string[];
  crisisContacts: string[];
  followUpAppt: string;
}): string[] {
  return [
    ...aftercare.referrals,
    ...aftercare.medications,
    ...aftercare.crisisContacts,
    aftercare.followUpAppt,
  ].filter(Boolean);
}

export function initialsFromName(name: string): string {
  const parts = name.replace(/\./g, '').split(/\s+/).filter(Boolean);
  if (parts.length === 1) return `${parts[0][0]}.`;
  return `${parts[0][0]}.${parts[parts.length - 1][0]}.`;
}

export function checklistDoneCount(c: DischargeCase) {
  return c.checklist.filter((i) => i.done).length;
}

export function signaturePending(c: DischargeCase) {
  return c.checklist.some((i) => i.id === 'client_signed' && !i.done);
}

export function monthsBetween(start: string, end: string) {
  if (!start || !end) return 0;
  const a = new Date(`${start}T12:00:00`);
  const b = new Date(`${end}T12:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
  const months =
    (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()) + (b.getDate() - a.getDate()) / 30;
  return Math.max(0, months);
}

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Normalize a stored discharge case. Missing clinical values stay null/empty so
 * the UI shows "Not recorded" — never a made-up score, date or percentage.
 */
export function normalizeCase(raw: Partial<DischargeCase> & { id: string }): DischargeCase {
  const clientName =
    raw.clientName ||
    (raw.label ? raw.label.split('—')[0]?.trim() : '') ||
    raw.initials ||
    '';
  const reason =
    raw.reason ||
    (raw.label?.includes('—') ? raw.label.split('—').slice(1).join('—').trim() : '');
  return {
    id: raw.id,
    ...(raw.clientId ? { clientId: raw.clientId } : {}),
    clientName,
    initials: raw.initials || (clientName ? initialsFromName(clientName) : ''),
    dob: raw.dob || '',
    label: raw.label || [clientName, reason].filter(Boolean).join(' — '),
    reason,
    clinician: raw.clinician || '',
    status: raw.status || 'planning',
    admitDate: raw.admitDate || '',
    targetDischarge: raw.targetDischarge || '',
    diagnosis: raw.diagnosis || '',
    extraDiagnoses: typeof raw.extraDiagnoses === 'number' ? raw.extraDiagnoses : 0,
    goalsMet: numOrNull(raw.goalsMet),
    phq9Start: numOrNull(raw.phq9Start),
    phq9Latest: numOrNull(raw.phq9Latest),
    gad7Start: numOrNull(raw.gad7Start),
    gad7Latest: numOrNull(raw.gad7Latest),
    aftercare: Array.isArray(raw.aftercare) ? raw.aftercare : [],
    checklist:
      Array.isArray(raw.checklist) && raw.checklist.length ? raw.checklist : emptyChecklist(),
    milestones: Array.isArray(raw.milestones) ? raw.milestones : [],
    summary: raw.summary || '',
  };
}

export function createBlankDischarge(input: {
  id: string;
  clientId?: string;
  clientName: string;
  dob?: string;
  clinician: string;
  diagnosis?: string;
  reason?: string;
  admitDate?: string;
  targetDischarge?: string;
}): DischargeCase {
  const reason = input.reason || '';
  return normalizeCase({
    id: input.id,
    ...(input.clientId ? { clientId: input.clientId } : {}),
    clientName: input.clientName,
    initials: initialsFromName(input.clientName),
    dob: input.dob || '',
    label: [input.clientName, reason].filter(Boolean).join(' — '),
    reason,
    clinician: input.clinician,
    status: 'planning',
    admitDate: input.admitDate || '',
    targetDischarge: input.targetDischarge || '',
    diagnosis: input.diagnosis || '',
    extraDiagnoses: 0,
    // Outcome measures are not known at creation — left unrecorded, never zeroed.
    goalsMet: null,
    phq9Start: null,
    phq9Latest: null,
    gad7Start: null,
    gad7Latest: null,
    aftercare: [],
    checklist: emptyChecklist(),
    // Follow-up dates are unscheduled until someone books them.
    milestones: [
      { day: 30, scheduled: '', completed: false, notes: '' },
      { day: 60, scheduled: '', completed: false, notes: '' },
      { day: 90, scheduled: '', completed: false, notes: '' },
    ],
    summary: '',
  });
}

/** No sample discharge records — cases are created per real client. */
export const DISCHARGE_CASES_SEED: DischargeCase[] = [];
