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
  goalsMet: number;
  phq9Start: number;
  phq9Latest: number;
  gad7Start: number;
  gad7Latest: number;
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
  const a = new Date(`${start}T12:00:00`);
  const b = new Date(`${end}T12:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
  const months =
    (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()) + (b.getDate() - a.getDate()) / 30;
  return Math.max(0, months);
}

export function normalizeCase(raw: Partial<DischargeCase> & { id: string }): DischargeCase {
  const clientName =
    raw.clientName ||
    (raw.label ? raw.label.split('—')[0]?.trim() : '') ||
    raw.initials ||
    'Client';
  const reason =
    raw.reason ||
    (raw.label?.includes('—') ? raw.label.split('—').slice(1).join('—').trim() : 'Discharge planning');
  return {
    id: raw.id,
    clientName,
    initials: raw.initials || initialsFromName(clientName),
    dob: raw.dob || '1990-01-01',
    label: raw.label || `${clientName} — ${reason}`,
    reason,
    clinician: raw.clinician || 'Clinic Clinician',
    status: raw.status || 'planning',
    admitDate: raw.admitDate || '2025-01-01',
    targetDischarge: raw.targetDischarge || new Date().toISOString().slice(0, 10),
    diagnosis: raw.diagnosis || 'Unspecified',
    extraDiagnoses: typeof raw.extraDiagnoses === 'number' ? raw.extraDiagnoses : 0,
    goalsMet: typeof raw.goalsMet === 'number' ? raw.goalsMet : 50,
    phq9Start: typeof raw.phq9Start === 'number' ? raw.phq9Start : 15,
    phq9Latest: typeof raw.phq9Latest === 'number' ? raw.phq9Latest : 8,
    gad7Start: typeof raw.gad7Start === 'number' ? raw.gad7Start : 12,
    gad7Latest: typeof raw.gad7Latest === 'number' ? raw.gad7Latest : 6,
    aftercare: Array.isArray(raw.aftercare) ? raw.aftercare : [],
    checklist:
      Array.isArray(raw.checklist) && raw.checklist.length ? raw.checklist : emptyChecklist(),
    milestones: Array.isArray(raw.milestones) ? raw.milestones : [],
    summary: raw.summary || '',
  };
}

export function createBlankDischarge(input: {
  id: string;
  clientName: string;
  dob?: string;
  clinician: string;
  diagnosis?: string;
  reason?: string;
  admitDate?: string;
  targetDischarge?: string;
}): DischargeCase {
  const today = new Date().toISOString().slice(0, 10);
  const reason = input.reason || 'Mutually agreed — treatment goals met';
  return normalizeCase({
    id: input.id,
    clientName: input.clientName,
    initials: initialsFromName(input.clientName),
    dob: input.dob || '1990-01-01',
    label: `${input.clientName} — ${reason}`,
    reason,
    clinician: input.clinician,
    status: 'planning',
    admitDate: input.admitDate || today,
    targetDischarge: input.targetDischarge || today,
    diagnosis: input.diagnosis || 'To be documented',
    extraDiagnoses: 0,
    goalsMet: 0,
    phq9Start: 0,
    phq9Latest: 0,
    gad7Start: 0,
    gad7Latest: 0,
    aftercare: [],
    checklist: emptyChecklist(),
    milestones: [
      { day: 30, scheduled: today, completed: false, notes: '30-day follow-up' },
      { day: 60, scheduled: today, completed: false, notes: '60-day follow-up' },
      { day: 90, scheduled: today, completed: false, notes: '90-day follow-up' },
    ],
    summary: '',
  });
}

const ALL_DONE = checklistFromRecord({
  treatment_plan_reviewed: true,
  safety_plan_reviewed: true,
  medications_reconciled: true,
  referrals_made: true,
  client_rights_reviewed: true,
  aftercare_confirmed: true,
  client_signed: true,
});

function completedCase(p: {
  id: string;
  name: string;
  dob: string;
  clinician: string;
  diagnosis: string;
  reason?: string;
  admit: string;
  discharge: string;
  phq9: [number, number];
  gad7: [number, number];
  goalsMet: number;
  day30Done?: boolean;
}): DischargeCase {
  const reason = p.reason || 'Mutually agreed — treatment goals met';
  return normalizeCase({
    id: p.id,
    clientName: p.name,
    initials: initialsFromName(p.name),
    dob: p.dob,
    label: `${p.name} — ${reason}`,
    reason,
    clinician: p.clinician,
    status: 'follow_up',
    admitDate: p.admit,
    targetDischarge: p.discharge,
    diagnosis: p.diagnosis,
    extraDiagnoses: 0,
    goalsMet: p.goalsMet,
    phq9Start: p.phq9[0],
    phq9Latest: p.phq9[1],
    gad7Start: p.gad7[0],
    gad7Latest: p.gad7[1],
    aftercare: ['Community aftercare confirmed', '988 provided', '30-day call scheduled'],
    checklist: ALL_DONE,
    milestones: [
      {
        day: 30,
        scheduled: p.discharge,
        completed: Boolean(p.day30Done),
        notes: p.day30Done ? '30-day contact completed' : 'Pending 30-day contact',
      },
      { day: 60, scheduled: p.discharge, completed: false, notes: 'Pending' },
      { day: 90, scheduled: p.discharge, completed: false, notes: 'Pending' },
    ],
    summary: 'Discharge completed. Follow-up tracking in progress.',
  });
}

export const DISCHARGE_CASES_SEED: DischargeCase[] = [];
