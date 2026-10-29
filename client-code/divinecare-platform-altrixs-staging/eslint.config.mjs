import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Existing codebase uses catch (err: any) widely — don't paint the tree red
      '@typescript-eslint/no-explicit-any': 'off',
      // Data-fetch-on-mount pattern used in feature hooks
      'react-hooks/set-state-in-effect': 'off',
    },
  },
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'node_modules/**',
    'prisma/**',
    'next.config.js',
    'next-env.d.ts',
  ]),
]);
