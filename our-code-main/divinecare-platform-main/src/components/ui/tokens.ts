/** Oct 22 design tokens — single source for product chrome. */
export const clinicTokens = {
  primary: '#5C2D91',
  primaryDark: '#4A2475',
  primarySoft: '#F5F3FF',
  navy: '#141C34',
  appBg: '#F8FAFC',
  surface: '#FFFFFF',
  border: '#E2E8F0',
  muted: '#64748B',
  warn: '#EA580C',
  secondaryAccent: '#7C3AED',
  marketingGold: '#D4A017',
  marketingTeal: '#00897B',
  marketingCoral: '#E8673A',
} as const;

export const SURFACE_CARD =
  'rounded-xl border border-slate-200 bg-white shadow-xs';

export const INPUT_CLASSES =
  'block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-500 shadow-xs focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20 disabled:bg-slate-50 aria-invalid:border-rose-500';
