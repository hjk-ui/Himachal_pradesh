export type RevalStatus = 'overdue' | 'due_soon' | 'current';
export type NoteStatus = 'Signed' | 'Draft' | 'Locked';
export type ActionUrgency = 'overdue' | 'soon' | 'info';

export interface EhrOverviewKpi {
  id: string;
  label: string;
  value: number;
  sub: string;
  tone: 'blue' | 'green' | 'orange' | 'red';
}

export interface EhrRevalPatient {
  id: string;
  name: string;
  lastEval: string;
  daysSince: number;
  nextDue: string;
  provider: string;
  status: RevalStatus;
}

export interface EhrRecentNote {
  id: string;
  client: string;
  type: string;
  date: string;
  duration: string;
  status: NoteStatus;
}

export interface EhrPendingAction {
  id: string;
  text: string;
  urgency: ActionUrgency;
}

// ─── Seed (DB via npm run db:seed:ehr-modules) ────────────────────────────────

export const EHR_OVERVIEW_KPI_SEED: EhrOverviewKpi[] = [];
export const EHR_REVAL_SEED: EhrRevalPatient[] = [];
export const EHR_RECENT_NOTES_SEED: EhrRecentNote[] = [];
export const EHR_PENDING_ACTIONS_SEED: EhrPendingAction[] = [];
