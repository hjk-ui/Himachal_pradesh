import { createHash, randomUUID } from 'node:crypto';
import { DrFirstError } from './errors';
import { mapPatient, mapPrescriber } from './mapping';
import { MOCK_LAUNCH_PATH, MOCK_SESSION_SECONDS, validateIntegrationResult } from './validation';
import type { DrFirstProvider } from './provider';
import type { IntegrationPatient, IntegrationPrescriber, IntegrationOrganization, IntegrationResult, MockFailure, SsoLaunchRequest, SsoLaunchResult } from './types';
export class MockDrFirstProvider implements DrFirstProvider {
  constructor(private readonly failure: MockFailure = 'none') {}
  private check() { if (this.failure === 'unavailable') throw new DrFirstError('DRFIRST_EXTERNAL_SERVICE_ERROR', 503); }
  private result(kind: string, id: string): IntegrationResult {
    return { externalId: `mock_${kind}_${createHash('sha256').update(id).digest('hex').slice(0, 24)}`, environment: 'mock', mode: 'MOCK' };
  }
  async createOrSyncPatient(patient: IntegrationPatient) {
    this.check();
    if (this.failure === 'patient') throw new DrFirstError('DRFIRST_PATIENT_INVALID');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(patient.dateOfBirth) || !Number.isFinite(Date.parse(patient.dateOfBirth)) || new Date(patient.dateOfBirth).toISOString().slice(0, 10) !== patient.dateOfBirth) throw new DrFirstError('DRFIRST_PATIENT_INVALID');
    mapPatient({ ...patient, dateOfBirth: new Date(patient.dateOfBirth) }, patient.organizationId);
    return this.result('patient', `${patient.organizationId}:${patient.id}`);
  }
  async createOrSyncPrescriber(prescriber: IntegrationPrescriber) {
    this.check();
    if (this.failure === 'prescriber') throw new DrFirstError('DRFIRST_PRESCRIBER_INVALID');
    mapPrescriber(prescriber, prescriber.organizationId);
    return this.result('prescriber', `${prescriber.organizationId}:${prescriber.id}`);
  }
  async createOrSyncOrganization(organization: IntegrationOrganization) {
    this.check();
    if (!organization.id || !organization.name.trim()) throw new DrFirstError('DRFIRST_INVALID_INPUT');
    return this.result('organization', organization.id);
  }
  async createSsoLaunchSession(request: SsoLaunchRequest): Promise<SsoLaunchResult> {
    this.check();
    for (const key of ['patient', 'prescriber', 'organization'] as const) validateIntegrationResult(request[key], 'mock');
    return { externalId: `mock_session_${randomUUID()}`, environment: 'mock', mode: 'MOCK', status: 'SIMULATED',
      launchUrl: MOCK_LAUNCH_PATH, expiresAt: new Date(Date.now() + MOCK_SESSION_SECONDS * 1000).toISOString() };
  }
  getLaunchUrl(session: SsoLaunchResult) { return session.launchUrl; }
  async checkConnection() { this.check(); return { enabled: true, environment: 'mock' as const, configured: true }; }
}
