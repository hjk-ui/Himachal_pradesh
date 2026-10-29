const MIN_PRODUCTION_SECRET_BYTES = 32;

export function getAuthSecret(): string {
  const secret = process.env.AUTH_SECRET?.trim();
  if (secret) {
    if (
      process.env.NODE_ENV === 'production' &&
      new TextEncoder().encode(secret).byteLength < MIN_PRODUCTION_SECRET_BYTES
    ) {
      throw new Error('AUTH_SECRET must be at least 32 bytes in production');
    }
    return secret;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('AUTH_SECRET is required in production');
  }

  // Tests and local development only. Production always fails closed above.
  return 'local-development-auth-secret-not-for-production';
}

export function getAuthSecretBytes(): Uint8Array {
  return new TextEncoder().encode(getAuthSecret());
}
