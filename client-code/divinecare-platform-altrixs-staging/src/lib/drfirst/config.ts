import 'server-only';
import { parseDrFirstSettings } from './settings';
export function getDrFirstConfig() {
  return {
    ...parseDrFirstSettings(process.env),
    credentials: {
      ssoUrl: process.env.DRFIRST_SSO_URL, apiBaseUrl: process.env.DRFIRST_API_BASE_URL,
      partnerId: process.env.DRFIRST_PARTNER_ID, username: process.env.DRFIRST_USERNAME,
      password: process.env.DRFIRST_PASSWORD, clientId: process.env.DRFIRST_CLIENT_ID,
      clientSecret: process.env.DRFIRST_CLIENT_SECRET,
    },
  };
}
export const getDrFirstEnvironment = () => getDrFirstConfig().environment;
export const isDrFirstEnabled = () => getDrFirstConfig().enabled;
