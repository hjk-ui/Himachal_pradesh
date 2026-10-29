import { isAuthConfigured, isDatabaseConfigured } from './env';

/** Prefer live API when DB is configured. */
export function shouldUseLiveData(): boolean {
  return isDatabaseConfigured;
}

export { isAuthConfigured, isDatabaseConfigured };
