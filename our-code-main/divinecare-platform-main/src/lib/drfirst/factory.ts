import { DrFirstError } from './errors';
import { MockDrFirstProvider } from './mock-provider';
import type { DrFirstProvider } from './provider';
import type { DrFirstEnvironment, MockFailure } from './types';
/** Production remains fail-closed until DrFirst certification and production credentials are approved. */
export class ProductionDrFirstProvider {
  constructor() { throw new DrFirstError('DRFIRST_NOT_CONFIGURED', 503); }
}
export function createDrFirstProvider(config: {
  enabled: boolean;
  environment: DrFirstEnvironment;
  mockFailure?: MockFailure;
  stagingConfigured?: boolean;
  engineUrl?: string;
  ssoUrl?: string;
  vendorUsername?: string;
  vendorPassword?: string;
  practiceUsername?: string;
  systemName?: string;
  prescriberMap?: Record<string, string>;
  patientMap?: Record<string, string>;
}, stagingFactory?: () => DrFirstProvider): DrFirstProvider {
  if (!config.enabled) throw new DrFirstError('DRFIRST_DISABLED', 503);
  switch (config.environment) {
    case 'mock': return new MockDrFirstProvider(config.mockFailure);
    case 'staging':
      if (stagingFactory) return stagingFactory();
      break;
    case 'production': new ProductionDrFirstProvider(); break;
  }
  throw new DrFirstError('DRFIRST_NOT_CONFIGURED', 503);
}
