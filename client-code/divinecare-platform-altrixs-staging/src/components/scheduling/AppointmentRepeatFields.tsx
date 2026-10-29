'use client';

import { useMemo } from 'react';
import type { AppointmentFormValues } from '@/features/appointments/appointmentForm';
import { formRecurrenceRule } from '@/features/appointments/appointmentForm';
import {
  MAX_SERIES_OCCURRENCES,
  describeRecurrence,
  occurrenceDates,
  seriesHardEnd,
  validateRecurrence,
  weekdayIndex,
} from '@/lib/scheduling/recurrence';
import { Button, cx, FOCUS_RING, inputClasses } from '@/components/ui';

type SetForm = (fn: (f: AppointmentFormValues) => AppointmentFormValues) => void;

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Audio only (phone)" for telehealth: notes and claims default their audio-only flag from it. */
export function AudioOnlyToggle({ form, setForm }: { form: AppointmentFormValues; setForm: SetForm }) {
  if (!form.isVirtual) return null;
  return (
    <label className="flex items-center gap-2 text-sm font-medium text-slate-700 sm:pt-6">
      <input
        type="checkbox"
        checked={form.audioOnly}
        onChange={(e) => setForm((f) => ({ ...f, audioOnly: e.target.checked }))}
        className="h-4 w-4 rounded border-slate-300 text-blue-600"
      />
      Audio only (phone)
    </label>
  );
}

/**
 * Repeat control for NEW appointments: weekly / every 2 weeks / monthly, ends after N visits or
 * on a date (max 26 visits, 6 months). Shows the dates that will be booked; the server books
 * them one by one and skips (and lists) any that conflict.
 */
export function RepeatFields({ form, setForm }: { form: AppointmentFormValues; setForm: SetForm }) {
  const rule = formRecurrenceRule(form);
  const problem = rule && form.date && form.startTime ? validateRecurrence(rule) : null;
  const dates = useMemo(() => (rule && !problem && form.date && form.startTime ? occurrenceDates(rule) : []), [rule, problem, form.date, form.startTime]);
  const dateWeekday = /^\d{4}-\d{2}-\d{2}$/.test(form.date) ? weekdayIndex(form.date) : null;

  const toggleDay = (d: number) =>
    setForm((f) => {
      const current = f.repeatWeekdays.length ? f.repeatWeekdays : dateWeekday != null ? [dateWeekday] : [];
      const next = current.includes(d) ? current.filter((x) => x !== d) : [...current, d];
      return { ...f, repeatWeekdays: next.sort((a, b) => a - b) };
    });

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 sm:col-span-2 lg:col-span-3">
      <label className="block text-sm font-medium text-slate-700">
        Repeat
        <select
          className={cx(inputClasses, 'mt-1')}
          value={form.repeat}
          onChange={(e) => setForm((f) => ({ ...f, repeat: e.target.value as AppointmentFormValues['repeat'] }))}
        >
          <option value="none">Does not repeat</option>
          <option value="weekly">Weekly</option>
          <option value="biweekly">Every 2 weeks</option>
          <option value="monthly">Monthly (same day of month)</option>
        </select>
      </label>

      {form.repeat !== 'none' ? (
        <div className="mt-3 space-y-3">
          {form.repeat !== 'monthly' ? (
            <div>
              <p className="text-sm font-medium text-slate-700">On</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {WEEKDAYS.map((name, d) => {
                  const on = form.repeatWeekdays.length ? form.repeatWeekdays.includes(d) : d === dateWeekday;
                  return (
                    <button
                      key={name}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggleDay(d)}
                      className={cx(
                        'rounded-lg border px-2.5 py-1 text-xs font-semibold',
                        on ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
                        FOCUS_RING,
                      )}
                    >
                      {name}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm font-medium text-slate-700">
              Ends
              <select
                className="mt-1 block rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                value={form.repeatEnds}
                onChange={(e) => setForm((f) => ({ ...f, repeatEnds: e.target.value as 'count' | 'date' }))}
              >
                <option value="count">After a number of visits</option>
                <option value="date">On a date</option>
              </select>
            </label>
            {form.repeatEnds === 'count' ? (
              <label className="text-sm font-medium text-slate-700">
                Visits
                <input
                  type="number"
                  min={1}
                  max={MAX_SERIES_OCCURRENCES}
                  className="mt-1 block w-24 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                  value={form.repeatCount}
                  onChange={(e) => setForm((f) => ({ ...f, repeatCount: Math.max(1, Math.min(MAX_SERIES_OCCURRENCES, Number(e.target.value) || 1)) }))}
                />
              </label>
            ) : (
              <label className="text-sm font-medium text-slate-700">
                Until
                <input
                  type="date"
                  min={form.date || undefined}
                  max={form.date ? seriesHardEnd(form.date) : undefined}
                  className="mt-1 block rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                  value={form.repeatUntil}
                  onChange={(e) => setForm((f) => ({ ...f, repeatUntil: e.target.value }))}
                />
              </label>
            )}
          </div>

          {problem ? (
            <p role="alert" className="text-xs text-rose-700">{problem}</p>
          ) : rule && dates.length ? (
            <p className="text-xs text-slate-600">
              {describeRecurrence(rule)}: {dates.length} visit{dates.length === 1 ? '' : 's'}, {dates[0]} to {dates[dates.length - 1]}. Times that conflict
              with another appointment are skipped and listed after booking.
            </p>
          ) : (
            <p className="text-xs text-slate-500">Choose a date and start time to see the visits.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * After a 409 CLINICIAN_OVERLAP: book anyway only with a reason (intentional overbook; the reason
 * is saved on the appointment and in the audit log).
 */
export function OverbookPrompt({
  form,
  setForm,
  onBookAnyway,
  saving,
}: {
  form: AppointmentFormValues;
  setForm: SetForm;
  onBookAnyway: () => void;
  saving: boolean;
}) {
  const ready = form.overbookReason.trim().length >= 5;
  return (
    <div className="mt-2 w-full rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
      <p className="font-semibold">Book over the existing appointment?</p>
      <p className="mt-0.5 text-xs">Only for an intentional overbook (for example a crisis add-on). The reason is saved and audited.</p>
      <textarea
        rows={2}
        maxLength={300}
        placeholder="Reason for overbooking"
        aria-label="Reason for overbooking"
        className={cx(inputClasses, 'mt-2')}
        value={form.overbookReason}
        onChange={(e) => setForm((f) => ({ ...f, overbookReason: e.target.value }))}
      />
      <Button size="sm" variant="secondary" className="mt-2" disabled={!ready || saving} onClick={onBookAnyway}>
        Book anyway
      </Button>
    </div>
  );
}
