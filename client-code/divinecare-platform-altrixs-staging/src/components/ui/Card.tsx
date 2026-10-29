import type { HTMLAttributes, ReactNode } from 'react';
import { cx, SURFACE } from './tokens';

type DivProps = HTMLAttributes<HTMLDivElement>;

/** The one card surface: rounded-xl, slate-200 border, white, shadow-xs. */
export function Card({ className, ...rest }: DivProps) {
  return <div className={cx(SURFACE, 'min-w-0', className)} {...rest} />;
}

/** Card title row: title + optional description on the left, actions on the right. */
export function CardHeader({
  title,
  description,
  actions,
  icon,
  className,
  titleAs: TitleTag = 'h2',
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  icon?: ReactNode;
  className?: string;
  titleAs?: 'h2' | 'h3' | 'h4';
}) {
  return (
    <div
      className={cx(
        'flex flex-col gap-2 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between',
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        {icon ? (
          <span aria-hidden className="mt-0.5 inline-flex text-slate-500 [&>svg]:h-5 [&>svg]:w-5">
            {icon}
          </span>
        ) : null}
        <div className="min-w-0">
          <TitleTag className="text-sm font-semibold text-slate-900">{title}</TitleTag>
          {description ? <p className="mt-0.5 text-[13px] text-slate-500">{description}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** Card content with the standard padding. `flush` removes padding (tables, lists). */
export function CardBody({ className, flush = false, ...rest }: DivProps & { flush?: boolean }) {
  return <div className={cx(flush ? '' : 'p-5', className)} {...rest} />;
}

export function CardFooter({ className, ...rest }: DivProps) {
  return (
    <div
      className={cx(
        'flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 bg-slate-50/60 px-5 py-3',
        className,
      )}
      {...rest}
    />
  );
}
