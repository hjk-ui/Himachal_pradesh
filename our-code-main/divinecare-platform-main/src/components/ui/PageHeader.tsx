import type { ReactNode } from 'react';

export function PageHeader({
  title,
  description,
  eyebrow,
  badges,
  actions,
}: {
  title: string;
  description?: string;
  eyebrow?: string;
  badges?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col items-stretch gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0 break-words">
        {eyebrow ? (
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">{eyebrow}</p>
        ) : null}
        <h1 className="min-w-0 break-words text-2xl font-semibold tracking-tight text-slate-900 sm:text-[28px]">
          {title}
        </h1>
        {description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}
        {badges ? <div className="mt-2 flex flex-wrap gap-2">{badges}</div> : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2 lg:max-w-[60%] lg:justify-end">{actions}</div>
      ) : null}
    </div>
  );
}
