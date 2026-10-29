/** Internal Altrixs contracts; these are NOT DrFirst wire formats. */
export type DrFirstEnvironment = 'mock' | 'staging' | 'production';
export type MockFailure = 'none' | 'patient' | 'prescriber' | 'unavailable';
export interface IntegrationPatient { id: string; organizationId: string; name: string; dateOfBirth: string; externalId?: string }
export interface IntegrationPrescriber { id: string; organizationId: string; name: string; npi?: string; externalId?: string }
export interface IntegrationOrganization { id: string; name: string; externalId?: string }
export interface IntegrationResult { externalId: string; environment: DrFirstEnvironment; mode: 'MOCK' | 'LIVE' }
export interface SsoLaunchRequest {
  patient: IntegrationResult;
  prescriber: IntegrationResult;
  organization: IntegrationResult;
}
export interface SsoLaunchResult extends IntegrationResult { launchUrl: string; status: 'SIMULATED' | 'READY'; expiresAt: string }
/** configured = a real DrFirst connection exists (never true for the mock); mock = the development mock harness is on */
export interface ConnectionStatus { enabled: boolean; environment: DrFirstEnvironment; configured: boolean; mock: boolean }
