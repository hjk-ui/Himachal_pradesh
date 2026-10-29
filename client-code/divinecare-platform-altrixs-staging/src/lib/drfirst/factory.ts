import { DrFirstError } from './errors';
import { MockDrFirstProvider } from './mock-provider';
import type { DrFirstProvider } from './provider';
import type { DrFirstEnvironment, MockFailure } from './types';
/** Replace these fail-closed placeholders only after receiving the official contract. */
export class StagingDrFirstProvider {
  constructor() { throw new DrFirstError('DRFIRST_NOT_CONFIGURED', 503); }
}
export class ProductionDrFirstProvider {
  constructor() { throw new DrFirstError('DRFIRST_NOT_CONFIGURED', 503); }
}
export function createDrFirstProvider(config: { enabled: boolean; environment: DrFirstEnvironment; mockFailure?: MockFailure }): DrFirstProvider {
  if (!config.enabled) throw new DrFirstError('DRFIRST_DISABLED', 503);
  switch (config.environment) {
    case 'mock': return new MockDrFirstProvider(config.mockFailure);
    case 'staging': new StagingDrFirstProvider(); break;
    case 'production': new ProductionDrFirstProvider(); break;
  }
  throw new DrFirstError('DRFIRST_NOT_CONFIGURED', 503);
}
