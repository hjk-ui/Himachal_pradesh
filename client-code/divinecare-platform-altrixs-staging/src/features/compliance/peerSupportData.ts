/**
 * Shapes of the retired ClinicModuleState lists `peer-contacts`, `peer-goals`, `peer-placements`
 * (free-text client names, not linked to a chart). Kept for reference only: the server parses
 * them in src/lib/peerSupport/workflow.ts (parseLegacyList) so leadership can file each entry
 * to a client with "Import legacy entries". `peer-meta` (CPRS certification block) is not
 * imported: staff certification and CEUs belong in HR Credentialing.
 */

export type LegacyContactEntry = {
  id: string;
  date: string;
  client: string;
  contactType: string;
  duration: number;
  topics: string[];
  goalsAddressed: string[];
  response: string;
  specialist: string;
};

export type LegacyRecoveryGoal = {
  id: string;
  client: string;
  title: string;
  status: 'Active' | 'In Progress' | 'Completed' | 'On Hold';
  daysIn: number;
  goalDays: number;
  progress: number;
  notes: string;
  targetDate?: string;
};

export type LegacyCommunityPlacement = {
  id: string;
  client: string;
  activityType: 'Volunteer' | 'Competitive Employment' | 'Social Club' | 'Housing Program' | 'Education' | 'Internship';
  organization: string;
  startDate: string | null;
  status: 'Active' | 'Pending' | 'Completed' | 'Ended';
  hoursPerWeek: number | null;
  notes: string;
};
