import 'server-only';
import { getDrFirstConfig } from './config';
import { createDrFirstProvider } from './factory';
export function getDrFirstProvider() { return createDrFirstProvider(getDrFirstConfig()); }
