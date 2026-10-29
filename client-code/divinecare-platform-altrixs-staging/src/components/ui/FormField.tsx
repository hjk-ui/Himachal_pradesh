'use client';

import {
  cloneElement,
  isValidElement,
  useId,
  type ReactElement,
  type ReactNode,
} from 'react';

type ControlProps = {
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean | 'true' | 'false';
  'aria-required'?: boolean;
};

export type FormFieldControl = {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
  'aria-required'?: true;
};

/**
 * Label + hint + error wired to one control.
 * - Single child element: the id / aria-describedby / aria-invalid are cloned onto it.
 * - Render function child: receives those props to spread wherever the control lives.
 */
export function FormField({
  label,
  hint,
  error,
  required,
  id: idProp,
  className = '',
  labelClassName = 'mb-1.5 block text-sm font-medium text-slate-700',
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  id?: string;
  className?: string;
  labelClassName?: string;
  children: ReactElement<ControlProps> | ((control: FormFieldControl) => ReactNode);
}) {
  const autoId = useId();
  const childId =
    typeof children !== 'function' && isValidElement(children) ? children.props.id : undefined;
  const id = idProp ?? childId ?? `field-${autoId}`;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;

  const control: FormFieldControl = { id };
  if (required) control['aria-required'] = true;
  if (error) control['aria-invalid'] = true;

  let content: ReactNode;
  if (typeof children === 'function') {
    const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
    content = children({ ...control, ...(describedBy ? { 'aria-describedby': describedBy } : {}) });
  } else {
    const existing = children.props['aria-describedby'];
    const describedBy = [existing, hintId, errorId].filter(Boolean).join(' ') || undefined;
    content = cloneElement(children, {
      ...control,
      ...(describedBy ? { 'aria-describedby': describedBy } : {}),
    });
  }

  return (
    <div className={className}>
      <label htmlFor={id} className={labelClassName}>
        {label}
        {required ? (
          <span className="ml-0.5 text-rose-600" aria-hidden>
            *
          </span>
        ) : null}
      </label>
      {content}
      {hint ? (
        <p id={hintId} className="mt-1 text-xs text-slate-500">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="mt-1 text-xs font-medium text-rose-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
