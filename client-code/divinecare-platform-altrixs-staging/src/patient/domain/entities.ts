import type { PortalActor } from '@/patient/domain/proxy-policy';

export type PatientAccountStatus = 'INVITED' | 'ACTIVE' | 'DISABLED';

/**
 * The signed-in portal user acting on the ACTIVE client. accountId / portalUserId = the login
 * (PatientAccount); clientId / name / phone = the person being viewed (the user themself, or a child /
 * represented adult for a proxy). access says as whom (src/patient/domain/proxy-policy.ts).
 */
export type PatientProfile = {
  accountId: string;
  portalUserId: string;
  clientId: string;
  name: string;
  /** Login email of the portal user */
  email: string;
  phone: string | null;
  status: PatientAccountStatus;
  access: PortalActor;
};

export type PatientContext = PatientProfile & {
  organizationId: string;
  assignedClinicianId: string | null;
  assignedClinicianName: string | null;
  clientName: string;
};
