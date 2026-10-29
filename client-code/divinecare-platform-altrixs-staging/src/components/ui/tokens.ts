/**
 * Altrixs design tokens (staff app). Source of truth: docs/design-system.md.
 * Tailwind's `blue-*` scale is remapped to brand purple in tailwind.config.js,
 * so `blue-600` === #5C2D91. Semantic "info" uses `sky` to stay distinct from brand.
 */

/** Join class names, skipping falsy values. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export type Tone = 'neutral' | 'brand' | 'info' | 'success' | 'warning' | 'danger';

/** Soft fill + AA-contrast text + inset ring: badges, pills, icon chips. */
export const TONE_SOFT: Record<Tone, string> = {
  neutral: 'bg-slate-100 text-slate-700 ring-slate-200',
  brand: 'bg-blue-50 text-blue-700 ring-blue-200',
  info: 'bg-sky-50 text-sky-800 ring-sky-200',
  success: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  warning: 'bg-amber-50 text-amber-800 ring-amber-200',
  danger: 'bg-rose-50 text-rose-700 ring-rose-200',
};

/** Status dot colour (decorative; always paired with text). */
export const TONE_DOT: Record<Tone, string> = {
  neutral: 'bg-slate-400',
  brand: 'bg-blue-600',
  info: 'bg-sky-500',
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  danger: 'bg-rose-500',
};

/** Banner surfaces (Alert). */
export const TONE_BANNER: Record<Tone, string> = {
  neutral: 'border-slate-200 bg-slate-50 text-slate-800',
  brand: 'border-blue-200 bg-blue-50 text-blue-900',
  info: 'border-sky-200 bg-sky-50 text-sky-900',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  warning: 'border-amber-200 bg-amber-50 text-amber-900',
  danger: 'border-rose-200 bg-rose-50 text-rose-900',
};

export const TONE_ICON: Record<Tone, string> = {
  neutral: 'text-slate-500',
  brand: 'text-blue-600',
  info: 'text-sky-700',
  success: 'text-emerald-700',
  warning: 'text-amber-700',
  danger: 'text-rose-700',
};

/** One card surface for the whole app. */
export const SURFACE = 'rounded-xl border border-slate-200 bg-white shadow-xs';

/** Brand focus ring for custom interactive elements. */
export const FOCUS_RING =
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2';

/** Standard text input / select / textarea. */
export const INPUT =
  'block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-500 shadow-xs transition focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500 aria-[invalid=true]:border-rose-500 aria-[invalid=true]:focus:ring-rose-500/20';
