import { createHash } from 'node:crypto';

/**
 * Generates GMT timestamp in DrFirst's required format: MMDDYYHHMMSS (UTC)
 */
export function getDrFirstGmtTime(): string {
  const d = new Date();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const year = String(d.getUTCFullYear() % 100).padStart(2, '0');
  const hour = String(d.getUTCHours()).padStart(2, '0');
  const min = String(d.getUTCMinutes()).padStart(2, '0');
  const sec = String(d.getUTCSeconds()).padStart(2, '0');
  return `${month}${day}${year}${hour}${min}${sec}`;
}

export type DrFirstSsoParams = {
  rcopia_portal_system_name: string;
  rcopia_practice_user_name: string;
  action?: string;
  service?: string;
  startup_screen?: string;
  rcopia_user_external_id: string;
  rcopia_patient_system_name: string;
  rcopia_patient_external_id?: string;
  close_window?: string;
  allow_popup_screens?: string;
  logout_url?: string;
  time?: string;
  [key: string]: string | undefined;
};

/**
 * Implements DrFirst official MAC (Message Authentication Code) Signature Generation.
 * Algorithm: MD5_HASH("key1=val1&key2=val2..."+secret_key).toUpperCase()
 */
export function generateDrFirstMac(
  params: Record<string, string | undefined>,
  secretKey: string,
  configuredBaseUrl?: string,
): { mac: string; queryString: string; fullUrl: string; baseUrl: string } {
  const baseUrl = configuredBaseUrl?.trim() || process.env.DRFIRST_SSO_URL?.trim();
  if (!baseUrl) throw new Error('DRFIRST_NOT_CONFIGURED');
  
  // Exclude undefined/empty values
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');

  // Step 1: Create Parameter String
  const paramPairs = entries.map(([k, v]) => `${k}=${v}`).join('&');

  // Step 2: Append Secret Key to string
  const rawStringWithSecret = paramPairs + secretKey;

  // Step 3: Generate MD5 hash & convert to uppercase
  const mac = createHash('md5').update(rawStringWithSecret).digest('hex').toUpperCase();

  // Step 4 & 5: Append MAC to query string & construct full URL
  // The signature covers the unescaped values in the documented insertion order.
  // URL encoding happens only after the MAC is calculated.
  const encodedPairs = entries.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`).join('&');
  const queryString = `${encodedPairs}&MAC=${mac}`;
  const fullUrl = `${baseUrl}?${queryString}`;

  return {
    mac,
    queryString,
    fullUrl,
    baseUrl,
  };
}
