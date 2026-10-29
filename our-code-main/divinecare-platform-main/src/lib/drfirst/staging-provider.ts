import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { DrFirstError } from './errors';
import { generateDrFirstMac, getDrFirstGmtTime } from './mac';
import type { DrFirstProvider } from './provider';
import { RcopiaStagingClient } from './rcopia/client';
import type {
  ConnectionStatus, DrFirstExchangeAuditSink, IntegrationOrganization, IntegrationPatient,
  IntegrationPrescriber, IntegrationResult, SsoLaunchRequest, SsoLaunchResult,
} from './types';

export type StagingProviderSettings = {
  stagingConfigured: boolean;
  engineUrl?: string;
  ssoUrl?: string;
  vendorUsername?: string;
  vendorPassword?: string;
  practiceUsername?: string;
  practiceName?: string;
  systemName?: string;
  prescriberMap: Record<string, string>;
  patientMap: Record<string, string>;
};

function configured(settings: StagingProviderSettings) {
  if (!settings.stagingConfigured || !settings.engineUrl || !settings.ssoUrl || !settings.vendorUsername ||
      !settings.vendorPassword || !settings.practiceUsername || !settings.systemName) {
    throw new DrFirstError('DRFIRST_NOT_CONFIGURED', 503);
  }
  return settings as StagingProviderSettings & {
    engineUrl: string; ssoUrl: string; vendorUsername: string; vendorPassword: string;
    practiceUsername: string; practiceName?: string; systemName: string;
  };
}

function mappedId(map: Record<string, string>, keys: Array<string | undefined>) {
  for (const key of keys) {
    const result = key && map[key.trim().toLowerCase()];
    if (result) return result;
  }
  return undefined;
}

export class StagingDrFirstProvider implements DrFirstProvider {
  private readonly settings: ReturnType<typeof configured>;
  private readonly client: RcopiaStagingClient;

  constructor(settings: StagingProviderSettings, private readonly audit: DrFirstExchangeAuditSink, request: typeof fetch = fetch) {
    this.settings = configured(settings);
    this.client = new RcopiaStagingClient(this.settings.engineUrl, {
      apiVersion: '2.54', vendorUsername: this.settings.vendorUsername, vendorPassword: this.settings.vendorPassword,
      application: 'Altrixs', applicationVersion: '1.0.0', practiceName: this.settings.practiceName || this.settings.practiceUsername,
      practiceUsername: this.settings.practiceUsername, systemName: this.settings.systemName,
    }, audit, request);
  }

  async createOrSyncPatient(patient: IntegrationPatient): Promise<IntegrationResult> {
    const existing = patient.externalId || mappedId(this.settings.patientMap, [patient.id, patient.mrn, patient.email]);
    const externalId = existing || `altrixs_${createHash('sha256').update(`${patient.organizationId}:${patient.id}`).digest('hex').slice(0, 24)}`;
    if (!existing) await this.client.uploadPatient(patient, externalId);
    return { externalId, environment: 'staging', mode: 'LIVE' };
  }

  async createOrSyncPrescriber(prescriber: IntegrationPrescriber): Promise<IntegrationResult> {
    const externalId = prescriber.externalId || mappedId(this.settings.prescriberMap, [prescriber.id, prescriber.email, prescriber.npi]);
    if (!externalId) throw new DrFirstError('DRFIRST_PRESCRIBER_INVALID');
    return { externalId, environment: 'staging', mode: 'LIVE' };
  }

  async getNotificationCounts(prescriber: IntegrationPrescriber) {
    const rcopiaUserName = mappedId(this.settings.prescriberMap, [prescriber.id, prescriber.email, prescriber.npi]);
    if (!rcopiaUserName) throw new DrFirstError('DRFIRST_PRESCRIBER_INVALID');
    return this.client.getNotificationCounts(rcopiaUserName);
  }

  async createOrSyncOrganization(organization: IntegrationOrganization): Promise<IntegrationResult> {
    return { externalId: organization.externalId || this.settings.practiceUsername, environment: 'staging', mode: 'LIVE' };
  }

  async createSsoLaunchSession(request: SsoLaunchRequest): Promise<SsoLaunchResult> {
    const { getAppBaseUrl } = await import('@/lib/staff/invite');
    const { drfirstLogoutUrl } = await import('@/lib/drfirst/returnAccess');
    const logout_url = drfirstLogoutUrl(getAppBaseUrl());
    const params = {
      rcopia_portal_system_name: this.settings.systemName,
      rcopia_practice_user_name: this.settings.practiceUsername,
      rcopia_user_external_id: request.prescriber.externalId,
      service: 'rcopia', action: 'login', startup_screen: 'patient',
      rcopia_patient_system_name: this.settings.systemName,
      rcopia_patient_external_id: request.patient.externalId,
      close_window: 'n',
      logout_url,
      time: getDrFirstGmtTime(),
    };
    const launchUrl = generateDrFirstMac(params, this.settings.vendorPassword, this.settings.ssoUrl).fullUrl;
    await this.audit({ operation: 'sso-launch', outcome: 'succeeded', launchUrl });
    return {
      externalId: `staging_session_${randomUUID()}`, environment: 'staging', mode: 'LIVE', launchUrl,
      status: 'READY', expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
  }

  getLaunchUrl(session: SsoLaunchResult) { return session.launchUrl; }
  async checkConnection(): Promise<ConnectionStatus> { return { enabled: true, environment: 'staging', configured: true }; }
}
