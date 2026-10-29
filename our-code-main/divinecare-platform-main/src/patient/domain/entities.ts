export type PatientAccountStatus = 'INVITED' | 'ACTIVE' | 'DISABLED';

export type PatientProfile = {
  accountId: string;
  clientId: string;
  name: string;
  email: string;
  phone: string | null;
  status: PatientAccountStatus;
};

export type PatientContext = PatientProfile & {
  organizationId: string;
  assignedClinicianId: string | null;
  assignedClinicianName: string | null;
  clientName: string;
};
