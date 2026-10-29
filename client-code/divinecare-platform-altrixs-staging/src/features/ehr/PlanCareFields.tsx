'use client';
import { useState } from 'react';
import { BookOpen } from 'lucide-react';
import {
  PLAN_TYPES,
  LEVELS_OF_CARE,
  ASAM_LEVELS,
  SERVICE_FREQUENCIES,
  EXPECTED_DURATIONS,
  PRACTICE_TEMPLATES,
  type PlanCare,
  type PracticeTemplate,
} from '@/lib/ehr/planLibrary';
export function PlanCareFields({
  value,
  onChange,
  onTemplate,
}: {
  value: PlanCare;
  onChange: (value: PlanCare) => void;
  onTemplate: (template: PracticeTemplate) => void;
}) {
  const [libraryOpen, setLibraryOpen] = useState(false);
  return (
    <div className="space-y-4">
      <button
        type="button"
        aria-expanded={libraryOpen}
        onClick={() => setLibraryOpen(!libraryOpen)}
        className="flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-semibold text-blue-600"
      >
        <BookOpen size={16} />
        Use Practice Library Template
      </button>
      {libraryOpen && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
          <p className="mb-3 text-xs text-slate-600">
            Selecting a preset fills the diagnosis and care defaults, and adds editable goals.
            Review and personalize before saving.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {PRACTICE_TEMPLATES.map((template) => (
              <button
                key={template.name}
                type="button"
                onClick={() => {
                  onTemplate(template);
                  setLibraryOpen(false);
                }}
                className="rounded-lg border border-slate-200 bg-white p-3 text-left text-sm font-medium text-blue-600 hover:bg-blue-100"
              >
                {template.name}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {(
          [
            ['planType', 'Plan Type', PLAN_TYPES],
            ['levelOfCare', 'Level of Care', LEVELS_OF_CARE],
            ['asamLevel', 'ASAM Level', ASAM_LEVELS],
            ['serviceFrequency', 'Service Frequency', SERVICE_FREQUENCIES],
            ['expectedDuration', 'Expected Duration', EXPECTED_DURATIONS],
          ] as const
        ).map(([field, label, options]) => (
          <label key={field} className="text-xs font-semibold text-slate-600">
            {label}
            <select
              aria-label={label}
              value={value[field]}
              onChange={(event) => onChange({ ...value, [field]: event.target.value })}
              className="mt-1 w-full rounded-xl border border-slate-200 bg-white p-2.5 text-sm"
            >
              <option value="">Select {label.toLowerCase()}…</option>
              {options.map((option) => (
                <option key={option}>{option}</option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {(
          [
            [
              'coordinationOfCare',
              'Coordination of Care',
              'PCP, school, family and other providers; include consent needs…',
            ],
            [
              'barriersToTreatment',
              'Barriers to Treatment',
              'Transportation, childcare, stigma, access needs…',
            ],
          ] as const
        ).map(([field, label, placeholder]) => (
          <label key={field} className="text-xs font-semibold text-slate-600">
            {label}
            <textarea
              aria-label={label}
              value={value[field]}
              onChange={(event) => onChange({ ...value, [field]: event.target.value })}
              placeholder={placeholder}
              maxLength={4000}
              rows={3}
              className="mt-1 w-full rounded-xl border border-slate-200 p-2.5 text-sm font-normal"
            />
          </label>
        ))}
      </div>
    </div>
  );
}
export function PlanCareDetail({ care }: { care: PlanCare }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {[
          care.planType,
          care.levelOfCare,
          care.asamLevel,
          care.serviceFrequency,
          care.expectedDuration,
        ]
          .filter(Boolean)
          .map((value) => (
            <span
              key={value}
              className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-600"
            >
              {value}
            </span>
          ))}
      </div>
      {care.coordinationOfCare && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
          <h3 className="text-xs font-semibold text-blue-900">Coordination of Care</h3>
          <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">
            {care.coordinationOfCare}
          </p>
        </div>
      )}
      {care.barriersToTreatment && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <h3 className="text-xs font-semibold text-amber-900">Barriers to Treatment</h3>
          <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">
            {care.barriersToTreatment}
          </p>
        </div>
      )}
    </div>
  );
}
