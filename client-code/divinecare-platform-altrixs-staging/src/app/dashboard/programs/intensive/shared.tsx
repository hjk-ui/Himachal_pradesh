'use client';

/**
 * Shared types and small UI pieces for the intensive programs pages (IOP / PHP). Every number on
 * these pages comes from /api/intensive/* (Altrixs records); nothing is estimated in the browser.
 */
import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Clock, ShieldAlert } from 'lucide-react';
import { buttonClasses, inputClasses, TONE_SOFT } from '@/components/ui';

export const BRAND = '#5C2D91';
export const BRAND_GRADIENT = 'linear-gradient(135deg, #5C2D91, #7C3AED)';

export type Effective = { value: number; isDefault: boolean };
export type Block = { key: string; label: string; start: string; minutes: number; sessionType: 'group' | 'individual' | 'family' | 'psychiatry' };
export type UnitRule = { code: string; unit: 'per_diem' | 'per_session' | 'per_15_min' | 'per_hour'; minMinutes: number | null; rounding: 'midpoint' | 'whole' };

export type Program = {
  id: string;
  name: string;
  locationId: string | null;
  locationName: string | null;
  programType: 'MH_IOP' | 'SUD_IOP' | 'PHP';
  typeLabel: string;
  level: 'IOP' | 'PHP';
  asamLevel: string | null;
  ageGroup: 'adult' | 'adolescent';
  active: boolean;
  phpLicensureConfirmed: boolean;
  part2: boolean;
  schedule: { days: number[]; blocks: Block[] };
  scheduleMinutes: { perDay: number; perWeek: number; daysPerWeek: number };
  policy: Record<'minWeeklyHours' | 'initialPlanDays' | 'planReviewDays' | 'authRenewalLeadDays' | 'followUpWindowDays' | 'missedDayOutreachHours', Effective>;
  policyConfirmed: { at: string; by: string | null } | null;
  billingMode: 'per_diem' | 'per_service';
  perDiemCode: string;
  perDiemIsDefault: boolean;
  serviceCodes: Record<Block['sessionType'], string | null>;
  serviceCodesIsDefault: boolean;
  unitRules: UnitRule[];
  unitRulesIsDefault: boolean;
  linkedGroupIds: string[];
  warnings: string[];
};

export type WeekC = { weekStart: string; hours: number; requiredHours: number; programDays: number; eligibleDays: number; complete: boolean; status: 'met' | 'under' | 'on_track' | 'at_risk' | 'not_applicable' };
export type AuthS = {
  id: string; payer: string; authNumber: string | null; startDate: string | null; endDate: string | null;
  approved: number; used: number; remaining: number; daysLeft: number | null; expired: boolean; exhausted: boolean; renewalDue: boolean; reasons: string[];
};
export type EnrollmentRow = {
  id: string; programId: string; programName: string; programType: Program['programType']; level: 'IOP' | 'PHP';
  clientId: string; clientName: string; mrn: string | null; status: string; part2: boolean;
  referralDate: string; admissionDate: string | null; dischargeDate: string | null; dischargeReason: string | null; stepDownLevel: string | null;
  team: { primaryClinician: string | null; prescriber: string | null; caseManager: string | null };
  isMine: boolean;
  weeks: { current: WeekC; previous: WeekC } | null;
  auth: AuthS | null;
  plan: { initialDue: string | null; initialState: string; nextReviewDue: string | null; reviewState: string; planId: string | null };
  review: { teamDone: boolean; prescriberRequired: boolean; prescriberDone: boolean; missing: string[]; weekStart: string; thisWeekStarted: boolean } | null;
  followUp: { state: 'met' | 'scheduled' | 'outside_window' | 'open' | 'missed' | 'not_expected'; windowEnd: string } | null;
  outreachOpen: number;
  outreachOverdue: number;
};

export const STATUS_LABEL: Record<string, string> = {
  referred: 'Referred', screening: 'Screening', admitted: 'Admitted', discharged: 'Discharged', declined: 'Not admitted',
};
export const STATUS_CLS: Record<string, string> = {
  referred: TONE_SOFT.neutral, screening: TONE_SOFT.warning, admitted: TONE_SOFT.info,
  discharged: TONE_SOFT.success, declined: TONE_SOFT.neutral,
};
export const WEEK_LABEL: Record<WeekC['status'], string> = {
  met: 'Met', under: 'Under minimum', on_track: 'On track', at_risk: 'At risk', not_applicable: 'No program days',
};
export const WEEK_CLS: Record<WeekC['status'], string> = {
  met: TONE_SOFT.success, under: TONE_SOFT.danger, on_track: TONE_SOFT.info, at_risk: TONE_SOFT.warning, not_applicable: TONE_SOFT.neutral,
};
export const FOLLOWUP_LABEL: Record<string, string> = {
  met: 'Seen in window', scheduled: 'Booked in window', outside_window: 'Outside window', open: 'Not booked yet', missed: 'Missed window', not_expected: 'Not expected',
};
export const PLAN_LABEL: Record<string, string> = { done: 'Current', due: 'Due', overdue: 'Overdue', not_applicable: '—' };
export const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const SESSION_LABEL: Record<Block['sessionType'], string> = { group: 'Group', individual: 'Individual', family: 'Family', psychiatry: 'Psychiatry' };
export const CONFIRM_LABEL = 'Practice policy — confirm';

export function Badge({ cls, children }: { cls: string; children: ReactNode }) {
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${cls}`}>{children}</span>;
}

export function Part2Badge() {
  return (
    <Badge cls={TONE_SOFT.brand}>
      <ShieldAlert size={11} aria-hidden /> 42 CFR Part 2
    </Badge>
  );
}

export function WeekBadge({ w }: { w: WeekC | null | undefined }) {
  if (!w) return <span className="text-xs text-slate-500">—</span>;
  return (
    <span className="inline-flex flex-col">
      <span className="text-sm font-semibold text-slate-900">
        {w.hours} / {w.requiredHours} h
      </span>
      <Badge cls={WEEK_CLS[w.status]}>{WEEK_LABEL[w.status]}</Badge>
    </span>
  );
}

export function AuthCell({ a }: { a: AuthS | null }) {
  if (!a) return <Badge cls={TONE_SOFT.warning}><AlertTriangle size={11} aria-hidden /> No auth</Badge>;
  return (
    <span className="inline-flex flex-col text-xs">
      <span className="font-semibold text-slate-900">{a.remaining} of {a.approved} left</span>
      <span className="text-slate-500">{a.payer}{a.endDate ? ` · ends ${a.endDate}` : ''}</span>
      {a.renewalDue && <Badge cls={TONE_SOFT.danger}><Clock size={11} aria-hidden /> Renewal due</Badge>}
    </span>
  );
}

export function ConfirmTag({ isDefault }: { isDefault: boolean }) {
  return isDefault ? <Badge cls={TONE_SOFT.warning}>{CONFIRM_LABEL}</Badge> : <Badge cls={TONE_SOFT.success}><CheckCircle2 size={11} aria-hidden /> Set by practice</Badge>;
}

export function Card({ title, icon, children, right }: { title: string; icon?: ReactNode; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-xs sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-slate-900">{icon}{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

export const inputCls = inputClasses;
export const btnPrimary = buttonClasses();
export const btnSecondary = buttonClasses({ variant: 'secondary' });
/** Sticky first column for wide program tables (keeps the client visible while scrolling sideways on phones). */
export const stickyTh = 'sticky left-0 z-10 bg-slate-50';
export const stickyTd = 'sticky left-0 z-10 bg-white';

export function errText(e: unknown) {
  return e instanceof Error ? e.message : 'Request failed';
}
