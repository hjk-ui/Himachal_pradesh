/** Internal Altrixs contracts; these are NOT DrFirst wire formats. */
export type DrFirstEnvironment = 'mock' | 'staging' | 'production';
export type MockFailure = 'none' | 'patient' | 'prescriber' | 'unavailable';
export interface IntegrationPatient {
  id: string;
  organizationId: string;
  name: string;
  firstName?: string;
  middleName?: string;
  lastName?: string;
  dateOfBirth: string;
  sex?: 'M' | 'F' | 'U';
  addressLine1?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  phone?: string;
  email?: string;
  mrn?: string;
  externalId?: string;
}
export interface IntegrationPrescriber {
  id: string;
  organizationId: string;
  name: string;
  email?: string;
  npi?: string;
  externalId?: string;
}
export interface IntegrationOrganization { id: string; name: string; externalId?: string }
export interface IntegrationResult { externalId: string; environment: DrFirstEnvironment; mode: 'MOCK' | 'LIVE' }
export interface SsoLaunchRequest {
  patient: IntegrationResult;
  prescriber: IntegrationResult;
  organization: IntegrationResult;
}
export interface SsoLaunchResult extends IntegrationResult { launchUrl: string; status: 'SIMULATED' | 'READY'; expiresAt: string }
export interface ConnectionStatus { enabled: boolean; environment: DrFirstEnvironment; configured: boolean }

export type DrFirstExchangeAuditEvent = {
  operation: 'patient-upload' | 'sso-launch' | 'notification-count' | 'history-download';
  outcome: 'succeeded' | 'failed';
  requestXml?: string;
  responseXml?: string;
  launchUrl?: string;
  errorCode?: string;
};

export type DrFirstExchangeAuditSink = (event: DrFirstExchangeAuditEvent) => Promise<void>;
