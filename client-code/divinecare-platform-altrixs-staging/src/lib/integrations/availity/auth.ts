import 'server-only';

import { getAvailityConfig } from './config';
import {
  AvailityAuthError,
  buildTokenRequestBody,
  parseAvailityTokenResponse,
  type AvailityTokenResponse,
} from './token';

export { AvailityAuthError };

type CachedToken = {
  accessToken: string;
  expiresAt: number;
};

let cached: CachedToken | null = null;

const TOKEN_SKEW_MS = 15_000;

/**
 * Server-only Client Credentials token. Never return this to the browser.
 * Official TTL is 300 seconds (5 minutes).
 */
export async function getAvailityAccessToken(): Promise<string> {
  const now = Date.now();
  if (cached && cached.expiresAt > now + TOKEN_SKEW_MS) {
    return cached.accessToken;
  }

  const config = getAvailityConfig();
  if (!config) {
    throw new AvailityAuthError(
      'Availity is not configured',
      503,
      'not_configured'
    );
  }

  let response: Response;
  try {
    response = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: buildTokenRequestBody({
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        scope: config.scope,
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new AvailityAuthError(
      'Availity authentication failed',
      502,
      'token_request_failed'
    );
  }

  if (!response.ok) {
    console.error('[availity-auth] token request failed', { status: response.status });
    throw new AvailityAuthError(
      'Availity authentication failed',
      502,
      'token_request_failed'
    );
  }

  let payload: AvailityTokenResponse;
  try {
    payload = (await response.json()) as AvailityTokenResponse;
  } catch {
    throw new AvailityAuthError(
      'Availity authentication failed',
      502,
      'invalid_token_response'
    );
  }

  const parsed = parseAvailityTokenResponse(payload);
  cached = {
    accessToken: parsed.accessToken,
    expiresAt: now + parsed.expiresIn * 1000,
  };
  return cached.accessToken;
}

export function clearAvailityTokenCache() {
  cached = null;
}
