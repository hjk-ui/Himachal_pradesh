export class AvailityAuthError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: 'not_configured' | 'token_request_failed' | 'invalid_token_response'
  ) {
    super(message);
    this.name = 'AvailityAuthError';
  }
}

export type AvailityTokenResponse = {
  access_token?: unknown;
  token_type?: unknown;
  expires_in?: unknown;
};

export function parseAvailityTokenResponse(payload: AvailityTokenResponse): {
  accessToken: string;
  expiresIn: number;
} {
  const accessToken = typeof payload.access_token === 'string' ? payload.access_token.trim() : '';
  if (!accessToken) {
    throw new AvailityAuthError(
      'Availity authentication failed',
      502,
      'invalid_token_response'
    );
  }

  const tokenType =
    typeof payload.token_type === 'string' ? payload.token_type.trim().toLowerCase() : 'bearer';
  if (tokenType && tokenType !== 'bearer') {
    throw new AvailityAuthError(
      'Availity authentication failed',
      502,
      'invalid_token_response'
    );
  }

  const expiresInRaw = payload.expires_in;
  const expiresIn =
    typeof expiresInRaw === 'number' && Number.isFinite(expiresInRaw) && expiresInRaw > 0
      ? expiresInRaw
      : 300;

  return { accessToken, expiresIn };
}

/** Official OAuth 2.0 Client Credentials body (case-sensitive field names). */
export function buildTokenRequestBody(input: {
  clientId: string;
  clientSecret: string;
  scope: string;
}): string {
  return new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: input.clientId,
    client_secret: input.clientSecret,
    scope: input.scope,
  }).toString();
}
