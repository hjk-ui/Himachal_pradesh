'use client';

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'children'> & {
  /** Accessible name, required: icon-only buttons have no visible text */
  label: string;
  /** The icon element (e.g. a Lucide icon); rendered aria-hidden */
  icon: ReactNode;
  /** Show the label as a native tooltip too (default true) */
  showTooltip?: boolean;
};

/** Icon-only button with a required accessible name and a brand focus ring. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, showTooltip = true, className = '', type = 'button', title, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={title ?? (showTooltip ? label : undefined)}
      className={`inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg transition md:min-h-8 md:min-w-8 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${className}`.trim()}
      {...rest}
    >
      <span aria-hidden className="inline-flex">
        {icon}
      </span>
    </button>
  );
});
