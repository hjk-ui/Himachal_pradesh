import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AvailityAuthError,
  buildTokenRequestBody,
  parseAvailityTokenResponse,
} from '../src/lib/integrations/availity/token';

test('token request body uses official client_credentials fields', () => {
  const body = buildTokenRequestBody({
    clientId: 'example-client-id',
    clientSecret: 'example-secret',
    scope: 'healthcare-hipaa-transactions healthcare-hipaa-transactions-demo',
  });
  const params = new URLSearchParams(body);
  assert.equal(params.get('grant_type'), 'client_credentials');
  assert.equal(params.get('client_id'), 'example-client-id');
  assert.equal(params.get('client_secret'), 'example-secret');
  assert.equal(
    params.get('scope'),
    'healthcare-hipaa-transactions healthcare-hipaa-transactions-demo'
  );
});

test('token parser accepts official expires_in of 300', () => {
  const parsed = parseAvailityTokenResponse({
    access_token: 'opaque-token',
    token_type: 'Bearer',
    expires_in: 300,
  });
  assert.equal(parsed.accessToken, 'opaque-token');
  assert.equal(parsed.expiresIn, 300);
});

test('token parser rejects missing access_token', () => {
  assert.throws(
    () => parseAvailityTokenResponse({ token_type: 'Bearer', expires_in: 300 }),
    (err: unknown) => err instanceof AvailityAuthError && err.code === 'invalid_token_response'
  );
});
