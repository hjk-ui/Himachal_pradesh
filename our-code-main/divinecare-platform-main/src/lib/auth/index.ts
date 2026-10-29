import NextAuth from 'next-auth';
import { authConfig } from './config';
import { getAuthSecret } from '@/lib/security/secrets';

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  secret: getAuthSecret(),
});
