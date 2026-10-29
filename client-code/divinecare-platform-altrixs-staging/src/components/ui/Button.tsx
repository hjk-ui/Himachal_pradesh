import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cx, FOCUS_RING } from './tokens';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-blue-600 text-white shadow-xs hover:bg-blue-700 active:bg-blue-800',
  secondary: 'border border-slate-300 bg-white text-slate-700 shadow-xs hover:bg-slate-50 hover:text-slate-900',
  ghost: 'text-slate-700 hover:bg-slate-100 hover:text-slate-900',
  danger: 'bg-rose-700 text-white shadow-xs hover:bg-rose-800',
};

const SIZE: Record<ButtonSize, string> = {
  // 40px tap target on phones/tablets; compact from md where a pointer is the norm.
  sm: 'h-10 gap-1.5 px-3 text-[13px] md:h-8',
  md: 'h-10 gap-2 px-4 text-sm md:h-9',
  lg: 'h-10 gap-2 px-5 text-sm',
};

/**
 * Class string for a button look. Use it on <Link> / <a> so links that act like
 * buttons match: `<Link className={buttonClasses({ variant: 'secondary' })}>`.
 */
export function buttonClasses({
  variant = 'primary',
  size = 'md',
  className,
}: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}): string {
  return cx(
    'inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-lg font-semibold transition disabled:cursor-not-allowed disabled:opacity-50',
    FOCUS_RING,
    VARIANT[variant],
    SIZE[size],
    className,
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading icon (Lucide element); hidden from screen readers. */
  icon?: ReactNode;
  /** Shows a spinner, disables the button and sets aria-busy. */
  loading?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', icon, loading = false, className, type = 'button', disabled, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClasses({ variant, size, className })}
      {...rest}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      ) : icon ? (
        <span aria-hidden className="inline-flex [&>svg]:h-4 [&>svg]:w-4">
          {icon}
        </span>
      ) : null}
      {children}
    </button>
  );
});
