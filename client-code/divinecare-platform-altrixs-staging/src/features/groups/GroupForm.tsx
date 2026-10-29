'use client';

import { useEffect, useState } from 'react';
import { FormField, Alert } from '@/components/ui';
import { apiJson } from '@/lib/api-client';
import { defaultBilling, GROUP_TYPES, type GroupKind } from '@/lib/groups/types';
import { apiBase, WEEKDAYS } from './shared';

export type GroupFormValues = {
  name: string;
  groupType: string;
  description: string;
  program: string;
  facilitatorId: string;
  coFacilitatorId: string;
  locationId: string;
  room: string;
  telehealth: boolean;
  capacity: number;
  defaultDurationMinutes: number;
  billingCode: string;
  billingMode: 'per_session' | 'attendance_only';
  minBillableMinutes: string;
  maxBillableGroupSize: string;
  enrollment: 'open' | 'closed';
  status: 'active' | 'paused' | 'archived';
  recurFrequency: '' | 'weekly' | 'biweekly' | 'monthly';
  recurWeekdays: number[];
  recurStartTime: string;
  recurStartDate: string;
  recurEndDate: string;
};

export type GroupOptions = { me: string; staff: { id: string; name: string; credentials: string | null; role: string }[]; locations: { id: string; name: string }[] };

export function useGroupOptions(kind: GroupKind) {
  const [options, setOptions] = useState<GroupOptions | null>(null);
  useEffect(() => {
    let live = true;
    apiJson<GroupOptions & { success: true }>(`${apiBase()}/options?kind=${kind}`)
      .then((r) => live && setOptions(r))
      .catch(() => live && setOptions({ me: '', staff: [], locations: [] }));
    return () => {
      live = false;
    };
  }, [kind]);
  return options;
}

export function emptyGroupForm(kind: GroupKind, me: string): GroupFormValues {
  const groupType = kind === 'sud' ? 'sud_counseling' : 'therapy';
  const def = defaultBilling(kind, groupType);
  return {
    name: '',
    groupType,
    description: '',
    program: kind === 'sud' ? 'SUD outpatient' : 'OMHC',
    facilitatorId: me,
    coFacilitatorId: '',
    locationId: '',
    room: '',
    telehealth: false,
    capacity: kind === 'sud' ? 12 : 10,
    defaultDurationMinutes: kind === 'sud' ? 90 : 60,
    billingCode: def.billingCode ?? '',
    billingMode: def.billingMode,
    minBillableMinutes: '',
    maxBillableGroupSize: '',
    enrollment: 'open',
    status: 'active',
    recurFrequency: 'weekly',
    recurWeekdays: [],
    recurStartTime: '10:00',
    recurStartDate: '',
    recurEndDate: '',
  };
}

/** Payload for POST / PATCH /api/ehr/groups */
export function groupPayload(v: GroupFormValues) {
  const num = (s: string) => (s.trim() ? Number(s) : null);
  return {
    name: v.name,
    groupType: v.groupType,
    description: v.description || null,
    program: v.program || null,
    facilitatorId: v.facilitatorId || null,
    coFacilitatorId: v.coFacilitatorId || null,
    locationId: v.locationId || null,
    room: v.room || null,
    telehealth: v.telehealth,
    capacity: v.capacity,
    defaultDurationMinutes: v.defaultDurationMinutes,
    billingCode: v.billingCode.trim() || null,
    billingMode: v.billingMode,
    minBillableMinutes: num(v.minBillableMinutes),
    maxBillableGroupSize: num(v.maxBillableGroupSize),
    enrollment: v.enrollment,
    status: v.status,
    recurFrequency: v.recurFrequency || null,
    recurWeekdays: v.recurWeekdays,
    recurStartTime: v.recurFrequency ? v.recurStartTime || null : null,
    recurStartDate: v.recurFrequency ? v.recurStartDate || null : null,
    recurEndDate: v.recurEndDate || null,
  };
}

export function GroupForm({
  kind,
  value,
  onChange,
  options,
  billingLocked,
}: {
  kind: GroupKind;
  value: GroupFormValues;
  onChange: (next: GroupFormValues) => void;
  options: GroupOptions | null;
  billingLocked?: boolean;
}) {
  const set = <K extends keyof GroupFormValues>(k: K, v: GroupFormValues[K]) => onChange({ ...value, [k]: v });
  const def = defaultBilling(kind, value.groupType);
  const locked = billingLocked || Boolean(def.locked);
  const changeType = (groupType: string) => {
    const d = defaultBilling(kind, groupType);
    onChange({ ...value, groupType, billingCode: d.billingCode ?? '', billingMode: d.billingMode });
  };
  const toggleDay = (d: number) =>
    set('recurWeekdays', value.recurWeekdays.includes(d) ? value.recurWeekdays.filter((x) => x !== d) : [...value.recurWeekdays, d].sort());
  return (
    <div className="space-y-5">
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Group</legend>
        <FormField label="Group name" required>
          <input className="clinic-input" value={value.name} onChange={(e) => set('name', e.target.value)} placeholder={kind === 'sud' ? 'e.g. Relapse Prevention Tuesday' : 'e.g. Anxiety Skills Group'} />
        </FormField>
        <FormField label="Type" required>
          <select className="clinic-input" value={value.groupType} onChange={(e) => changeType(e.target.value)}>
            {GROUP_TYPES[kind].map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Program">
          <input className="clinic-input" value={value.program} onChange={(e) => set('program', e.target.value)} />
        </FormField>
        <FormField label="Enrollment" hint="Closed groups add members only at the start of a cycle">
          <select className="clinic-input" value={value.enrollment} onChange={(e) => set('enrollment', e.target.value as 'open' | 'closed')}>
            <option value="open">Open (rolling)</option>
            <option value="closed">Closed (fixed cohort)</option>
          </select>
        </FormField>
        <FormField label="Description" className="sm:col-span-2">
          <textarea className="clinic-input" rows={2} value={value.description} onChange={(e) => set('description', e.target.value)} />
        </FormField>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Staff and place</legend>
        <FormField label={kind === 'sud' ? 'Facilitator (SUD counselor)' : 'Facilitator'} required>
          <select className="clinic-input" value={value.facilitatorId} onChange={(e) => set('facilitatorId', e.target.value)}>
            <option value="">Choose staff</option>
            {(options?.staff ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.credentials ? `, ${s.credentials}` : ''}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Co-facilitator">
          <select className="clinic-input" value={value.coFacilitatorId} onChange={(e) => set('coFacilitatorId', e.target.value)}>
            <option value="">None</option>
            {(options?.staff ?? []).filter((s) => s.id !== value.facilitatorId).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.credentials ? `, ${s.credentials}` : ''}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Location">
          <select className="clinic-input" value={value.locationId} onChange={(e) => set('locationId', e.target.value)}>
            <option value="">Not set</option>
            {(options?.locations ?? []).map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Room">
          <input className="clinic-input" value={value.room} onChange={(e) => set('room', e.target.value)} placeholder="e.g. Group Room B" />
        </FormField>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" className="h-5 w-5" checked={value.telehealth} onChange={(e) => set('telehealth', e.target.checked)} />
          Telehealth group (POS 02 / 10 from each member&apos;s location)
        </label>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Capacity">
            <input type="number" min={1} max={60} className="clinic-input" value={value.capacity} onChange={(e) => set('capacity', Number(e.target.value))} />
          </FormField>
          <FormField label="Length (min)">
            <input type="number" min={15} max={480} step={5} className="clinic-input" value={value.defaultDurationMinutes} onChange={(e) => set('defaultDurationMinutes', Number(e.target.value))} />
          </FormField>
        </div>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Repeat schedule</legend>
        <FormField label="Repeats">
          <select className="clinic-input" value={value.recurFrequency} onChange={(e) => set('recurFrequency', e.target.value as GroupFormValues['recurFrequency'])}>
            <option value="">Does not repeat (add sessions one at a time)</option>
            <option value="weekly">Weekly</option>
            <option value="biweekly">Every 2 weeks</option>
            <option value="monthly">Monthly</option>
          </select>
        </FormField>
        <FormField label="Start time">
          <input type="time" className="clinic-input" value={value.recurStartTime} onChange={(e) => set('recurStartTime', e.target.value)} disabled={!value.recurFrequency} />
        </FormField>
        {value.recurFrequency && value.recurFrequency !== 'monthly' ? (
          <div className="sm:col-span-2">
            <p className="mb-1.5 text-sm font-medium text-slate-700">Days</p>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Days of the week">
              {WEEKDAYS.map((d, i) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={value.recurWeekdays.includes(i)}
                  onClick={() => toggleDay(i)}
                  className={`min-h-11 min-w-12 rounded-lg border px-3 text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${value.recurWeekdays.includes(i) ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-200 bg-white text-slate-700'}`}
                >
                  {d}
                </button>
              ))}
            </div>
            <p className="mt-1 text-xs text-slate-500">No day chosen = the start date&apos;s weekday.</p>
          </div>
        ) : null}
        <FormField label="First date">
          <input type="date" className="clinic-input" value={value.recurStartDate} onChange={(e) => set('recurStartDate', e.target.value)} disabled={!value.recurFrequency} />
        </FormField>
        <FormField label="End date" hint="Optional. Sessions are created up to 26 at a time.">
          <input type="date" className="clinic-input" value={value.recurEndDate} onChange={(e) => set('recurEndDate', e.target.value)} disabled={!value.recurFrequency} />
        </FormField>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Billing</legend>
        <Alert tone="warning">{def.note}</Alert>
        <FormField label="Claim lines">
          <select className="clinic-input" value={value.billingMode} disabled={locked} onChange={(e) => set('billingMode', e.target.value as GroupFormValues['billingMode'])}>
            <option value="per_session">One claim line per attendee per session</option>
            <option value="attendance_only">Attendance only (no per-session claim line)</option>
          </select>
        </FormField>
        <FormField label="Service code (CPT / HCPCS)" hint="Configurable per group; confirm with billing">
          <input className="clinic-input uppercase" value={value.billingCode} disabled={locked || value.billingMode !== 'per_session'} onChange={(e) => set('billingCode', e.target.value.toUpperCase())} placeholder={kind === 'sud' ? 'H0005' : '90853'} />
        </FormField>
        <FormField label="Minimum minutes to bill" hint="Set only when billing confirms a payer rule">
          <input type="number" min={1} max={480} className="clinic-input" value={value.minBillableMinutes} onChange={(e) => set('minBillableMinutes', e.target.value)} disabled={locked} />
        </FormField>
        <FormField label="Group size cap" hint="Set only when a payer caps group size">
          <input type="number" min={1} max={60} className="clinic-input" value={value.maxBillableGroupSize} onChange={(e) => set('maxBillableGroupSize', e.target.value)} disabled={locked} />
        </FormField>
      </fieldset>
    </div>
  );
}
