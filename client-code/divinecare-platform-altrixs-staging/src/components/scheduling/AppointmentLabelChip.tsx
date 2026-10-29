'use client';

import { Check, Sparkles, Tag } from 'lucide-react';
import {
  labelForMeaning,
  LABEL_MEANING_TEXT,
  type AppointmentLabelChipData,
  type AppointmentLabelDto,
  type LabelMeaning,
} from '@/lib/scheduling/appointmentLabels';

/** Read-only label chip: swatch color plus the label text (never color alone). */
export function AppointmentLabelChip({
  label,
  size = 'sm',
  className = '',
}: {
  label: AppointmentLabelChipData | null | undefined;
  size?: 'xs' | 'sm';
  className?: string;
}) {
  if (!label) return null;
  const pad = size === 'xs' ? 'px-1.5 py-0 text-[11px]' : 'px-2 py-0.5 text-xs';
  return (
    <span
      className={`inline-flex max-w-full items-center gap-1 rounded-full font-semibold ${pad} ${className}`}
      style={{ backgroundColor: label.color, color: label.textColor }}
      title={`Label: ${label.displayName}`}
    >
      <Tag className="h-3 w-3 shrink-0" aria-hidden />
      <span className="truncate">{label.displayName}</span>
    </span>
  );
}

/** One-click suggestion: "Suggested: Blue (Tele)". Applying is always the user's click. */
export function LabelSuggestionChip({
  meaning,
  labels,
  onApply,
  disabled,
}: {
  meaning: LabelMeaning | null | undefined;
  labels: AppointmentLabelDto[];
  onApply: (label: AppointmentLabelDto, meaning: LabelMeaning) => void;
  disabled?: boolean;
}) {
  const label = meaning ? labelForMeaning(labels, meaning) : null;
  if (!label || !meaning) return null;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onApply(label, meaning)}
      className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-[#5C2D91]/40 bg-purple-50 px-2.5 py-1 text-xs font-semibold text-[#5C2D91] hover:bg-purple-100 disabled:opacity-50"
      title={`Suggested because: ${LABEL_MEANING_TEXT[meaning]}`}
    >
      <Sparkles className="h-3 w-3" aria-hidden />
      Suggested:
      <span
        className="inline-flex items-center rounded-full px-1.5 py-0 text-[11px]"
        style={{ backgroundColor: label.color, color: label.textColor }}
      >
        {label.displayName}
      </span>
    </button>
  );
}

/** Radio-style picker over the active labels plus "No label". */
export function AppointmentLabelPicker({
  labels,
  value,
  onChange,
  disabled,
}: {
  labels: AppointmentLabelDto[];
  value: string | null;
  onChange: (labelId: string | null) => void;
  disabled?: boolean;
}) {
  const active = labels.filter((l) => l.active);
  return (
    <div role="radiogroup" aria-label="Calendar label" className="flex flex-wrap gap-1.5">
      <button
        type="button"
        role="radio"
        aria-checked={!value}
        disabled={disabled}
        onClick={() => onChange(null)}
        className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold disabled:opacity-50 ${
          !value ? 'border-[#5C2D91] bg-purple-50 text-[#5C2D91]' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
        }`}
      >
        {!value ? <Check className="h-3 w-3" aria-hidden /> : null}
        No label
      </button>
      {active.map((l) => {
        const on = value === l.id;
        return (
          <button
            key={l.id}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => onChange(l.id)}
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold disabled:opacity-50 ${
              on ? 'ring-2 ring-offset-1 ring-[#5C2D91]' : 'hover:brightness-95'
            }`}
            style={{ backgroundColor: l.color, color: l.textColor }}
          >
            {on ? <Check className="h-3 w-3" aria-hidden /> : null}
            {l.displayName}
          </button>
        );
      })}
    </div>
  );
}
