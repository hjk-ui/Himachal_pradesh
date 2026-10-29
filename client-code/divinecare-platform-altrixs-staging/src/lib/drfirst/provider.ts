import type { ConnectionStatus, IntegrationOrganization, IntegrationPatient, IntegrationPrescriber, IntegrationResult, SsoLaunchRequest, SsoLaunchResult } from './types';
export interface DrFirstProvider {
  createOrSyncPatient(patient: IntegrationPatient): Promise<IntegrationResult>;
  createOrSyncPrescriber(prescriber: IntegrationPrescriber): Promise<IntegrationResult>;
  createOrSyncOrganization(organization: IntegrationOrganization): Promise<IntegrationResult>;
  createSsoLaunchSession(request: SsoLaunchRequest): Promise<SsoLaunchResult>;
  getLaunchUrl(session: SsoLaunchResult): string;
  checkConnection(): Promise<ConnectionStatus>;
}
