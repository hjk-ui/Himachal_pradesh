import 'server-only';
import { parseDrFirstSettings } from './settings';
import { parseFdbSettings } from './fdb/settings';
export function getDrFirstConfig() {
  return parseDrFirstSettings(process.env);
}
export const getDrFirstEnvironment = () => getDrFirstConfig().environment;
export const isDrFirstEnabled = () => getDrFirstConfig().enabled;
export const getFdbConfig = () => parseFdbSettings(process.env);
