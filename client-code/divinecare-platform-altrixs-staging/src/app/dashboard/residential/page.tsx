'use client';

import React, { useMemo, useState, useEffect } from 'react';
import {
  BedDouble,
  Users,
  User,
  UserPlus,
  ClipboardCheck,
  FileText,
  Shield,
  ShieldCheck,
  AlertTriangle,
  AlertOctagon,
  CheckCircle2,
  XCircle,
  Clock,
  CalendarDays,
  Flame,
  Pill,
  GraduationCap,
  BadgeCheck,
  TrendingUp,
  Sparkles,
  PenLine,
  Save,
  Printer,
  ChevronRight,
  ChevronLeft,
  Plus,
  Timer,
  BookOpen,
  Inbox,
  Hospital,
  Scale,
  ArrowDownCircle,
  ArrowUpCircle,
  Hourglass,
} from 'lucide-react';
import {
  BEDS_NOT_CONFIGURED,
  CAPACITY_SETTINGS_HREF,
  occupancyByLevel,
  openRoomLabels,
  summarizeCapacity,
  totalOccupancy,
  type CapacityRow,
  type CapacitySummary,
} from '@/lib/residential/capacity';
import { asamScoresFromDims } from '@/lib/residential/asamScores';
import { Alert, Button, buttonClasses, Card, LoadingState, Page, PageHeader, StatCard, StatGrid, Tabs, type Tone } from '@/components/ui';

// ---------------------------------------------------------------------------
// Static reference data — Residential ASAM 3.1 (low) & 3.5 (high intensity)
// ---------------------------------------------------------------------------

type Program = '3.1' | '3.5';

// Beds and room labels come from Practice settings > Programs & capacity (residential_capacity via
// /api/residential/capacity). No default bed counts: an unconfigured level shows "Beds not configured".

const COUNSELORS: string[] = [];

const PROGRAM_INFO: Record<Program, { title: string; subtitle: string; reviewCadence: string; color: string; bg: string; border: string }> = {
  '3.5': {
    title: 'ASAM 3.5 — High-Intensity Residential',
    subtitle: 'Clinically managed, 24-hr structure',
    reviewCadence: 'Continued-stay review every 7 days',
    color: 'text-rose-700',
    bg: 'bg-rose-50',
    border: 'border-rose-200',
  },
  '3.1': {
    title: 'ASAM 3.1 — Low-Intensity Residential',
    subtitle: 'Clinically managed, ≥5 hrs clinical/week',
    reviewCadence: 'Continued-stay review every 30 days',
    color: 'text-sky-700',
    bg: 'bg-sky-50',
    border: 'border-sky-200',
  },
};

interface Resident {
  id: string;
  name: string;
  program: Program;
  room: string;
  admitDate: string;
  losDays: number;
  counselor: string;
  txPlanStatus: 'current' | 'due' | 'overdue';
  orientationDone: boolean;
  phase: string;
}

const INITIAL_RESIDENTS: Resident[] = [];

// Outpatient clients eligible to step up into residential (loaded live from DB)
const OUTPATIENT_CLIENTS: string[] = [];

// Inbound referral queue (intake from referrals)
interface Referral {
  id: string;
  name: string;
  age: number;
  source: string;
  sourceKind: 'hospital' | 'court' | 'detox' | 'provider';
  concern: string;
  received: string;
  payer: string;
}

const INITIAL_REFERRALS: Referral[] = [];

const REFERRAL_ICON: Record<Referral['sourceKind'], React.FC<{ className?: string }>> = {
  hospital: Hospital,
  court: Scale,
  detox: ArrowDownCircle,
  provider: User,
};

// ── ASAM six dimensions (qualification instrument) ─────────────────────────

interface AsamDimension {
  id: number;
  name: string;
  description: string;
  anchors: { value: number; label: string }[];
}

const ASAM_DIMENSIONS: AsamDimension[] = [
  {
    id: 0,
    name: 'Dimension 1 — Acute Intoxication / Withdrawal Potential',
    description: 'Current intoxication and risk associated with withdrawal',
    anchors: [
      { value: 0, label: 'No intoxication or withdrawal risk' },
      { value: 1, label: 'Mild — minimal withdrawal risk, no monitoring needed' },
      { value: 2, label: 'Moderate — manageable with supportive monitoring' },
      { value: 3, label: 'Significant — needs medical withdrawal management (3.7-WM)' },
      { value: 4, label: 'Severe — high-risk withdrawal (seizure/DT history) — medical setting' },
    ],
  },
  {
    id: 1,
    name: 'Dimension 2 — Biomedical Conditions & Complications',
    description: 'Physical health conditions that affect treatment',
    anchors: [
      { value: 0, label: 'None or fully stable' },
      { value: 1, label: 'Mild — self-managed, routine care only' },
      { value: 2, label: 'Moderate — needs care coordination, stable in residential' },
      { value: 3, label: 'Significant — requires nursing/medical oversight beyond our scope' },
      { value: 4, label: 'Severe — acute medical instability — medical setting required' },
    ],
  },
  {
    id: 2,
    name: 'Dimension 3 — Emotional, Behavioral & Cognitive Conditions',
    description: 'Co-occurring mental health symptoms and cognitive functioning',
    anchors: [
      { value: 0, label: 'None — no co-occurring concerns' },
      { value: 1, label: 'Mild — stable symptoms, engaged in care' },
      { value: 2, label: 'Moderate — active symptoms needing structured support' },
      { value: 3, label: 'Serious — significant symptoms, needs 24-hr structure' },
      { value: 4, label: 'Severe — acute psychiatric instability — inpatient indicated' },
    ],
  },
  {
    id: 3,
    name: 'Dimension 4 — Readiness to Change',
    description: 'Engagement, motivation, and stage of change',
    anchors: [
      { value: 0, label: 'Engaged — actively seeking recovery' },
      { value: 1, label: 'Willing — ambivalent but cooperative' },
      { value: 2, label: 'Reluctant — needs motivational structure' },
      { value: 3, label: 'Resistant — external mandate only, high structure needed' },
      { value: 4, label: 'Unable to engage — needs intensive engagement setting' },
    ],
  },
  {
    id: 4,
    name: 'Dimension 5 — Relapse / Continued Use Potential',
    description: 'Likelihood of continued use or relapse without structure',
    anchors: [
      { value: 0, label: 'Low — sustained abstinence skills' },
      { value: 1, label: 'Mild — some skills, occasional cravings' },
      { value: 2, label: 'Moderate — relapse likely without regular support' },
      { value: 3, label: 'High — imminent relapse risk without 24-hr structure' },
      { value: 4, label: 'Severe — unable to interrupt use without containment' },
    ],
  },
  {
    id: 5,
    name: 'Dimension 6 — Recovery / Living Environment',
    description: 'Safety and supportiveness of the current living situation',
    anchors: [
      { value: 0, label: 'Supportive — stable, recovery-positive environment' },
      { value: 1, label: 'Mostly supportive — minor stressors' },
      { value: 2, label: 'Unsupportive — active use in home or unstable housing' },
      { value: 3, label: 'High risk — homeless or dangerous environment' },
      { value: 4, label: 'Hazardous — immediate environmental threat to recovery/safety' },
    ],
  },
];

// ── Assessments due tracker ────────────────────────────────────────────────

type DueStatus = 'overdue' | 'due' | 'upcoming' | 'complete';

interface AssessmentDue {
  id: string;
  residentId: string;
  name: string;
  due: string;
  daysLeft: number; // negative = overdue
  status: DueStatus;
  href?: string;
  why: string;
}

const INITIAL_ASSESSMENTS: AssessmentDue[] = [];

// ── Shift-note smart builder options ───────────────────────────────────────

const SHIFTS = ['7a–3p Day', '3p–11p Evening', '11p–7a Overnight'];

const NOTE_CHIPS: { group: string; options: string[] }[] = [
  { group: 'Participation', options: ['Attended all groups', 'Attended most groups', 'Declined groups', 'Led peer activity', 'Completed chores/responsibilities'] },
  { group: 'Mood & Behavior', options: ['Stable & engaged', 'Anxious', 'Irritable', 'Withdrawn', 'Bright / motivated', 'Tearful'] },
  { group: 'Medications', options: ['Self-administered meds observed', 'Meds taken as scheduled', 'Refused medication', 'PRN requested', 'No meds scheduled'] },
  { group: 'Safety & Milieu', options: ['No safety concerns', 'Safety check q30 completed', 'Verbal conflict — resolved', 'Contraband check clear', 'Incident report filed'] },
  { group: 'Recovery Work', options: ['Worked on treatment plan goal', 'Completed recovery assignment', 'Met with counselor 1:1', 'Family contact (approved)', 'Attended community support meeting'] },
];

// ── CARF program requirements (maintained in-program) ──────────────────────

interface DrillLog {
  date: string;
  type: string;
  shift: string;
  result: 'pass' | 'needs follow-up';
}

const INITIAL_DRILLS: DrillLog[] = [];

const CARF_PROGRAM_REQS: { area: string; Icon: React.FC<{ className?: string }>; items: { label: string; done: boolean; detail: string }[] }[] = [
  {
    area: 'Health & Safety',
    Icon: Flame,
    items: [
      { label: 'Evacuation drills — each shift, each quarter', done: false, detail: 'Not yet documented' },
      { label: 'Self-inspection walkthrough (monthly)', done: false, detail: 'Not yet documented' },
      { label: 'First aid / CPR coverage every shift', done: false, detail: 'Not yet documented' },
    ],
  },
  {
    area: 'Medication Management',
    Icon: Pill,
    items: [
      { label: 'Med room temp & refrigeration log (daily)', done: false, detail: 'Not yet documented' },
      { label: 'Controlled substance count — shift change', done: false, detail: 'Not yet documented' },
      { label: 'Self-administration observation records', done: false, detail: 'Not yet documented' },
    ],
  },
  {
    area: 'Rights & Orientation',
    Icon: BookOpen,
    items: [
      { label: 'Resident orientation within 24 hrs of admission', done: false, detail: 'Not yet documented' },
      { label: 'Rights, grievance & house guidelines signed', done: false, detail: 'Not yet documented' },
      { label: 'Input from persons served — monthly community meeting', done: false, detail: 'Not yet documented' },
    ],
  },
  {
    area: 'Workforce & Training',
    Icon: GraduationCap,
    items: [
      { label: 'De-escalation / crisis training current', done: false, detail: 'Not yet documented' },
      { label: 'Staffing ratios per schedule — 24/7 coverage', done: false, detail: 'Not yet documented' },
      { label: 'Annual competency evaluations', done: false, detail: 'Not yet documented' },
    ],
  },
];

// ---------------------------------------------------------------------------
// Admission qualification — decision engine
// ---------------------------------------------------------------------------

type YesNo = 'yes' | 'no' | null;

interface ExclusionAnswers {
  withdrawalRisk: YesNo;
  medicalInstability: YesNo;
  acutePsych: YesNo;
}

type Determination =
  | { outcome: 'refer-up'; label: string; detail: string; drivers: string[] }
  | { outcome: '3.5'; label: string; detail: string; drivers: string[] }
  | { outcome: '3.1'; label: string; detail: string; drivers: string[] }
  | { outcome: 'refer-out'; label: string; detail: string; drivers: string[] }
  | null;

function computeDetermination(excl: ExclusionAnswers, dims: (number | null)[]): Determination {
  if (excl.withdrawalRisk === 'yes') {
    return {
      outcome: 'refer-up',
      label: 'Refer — Medical Withdrawal Management (3.7-WM / 4.0)',
      detail: 'High-risk withdrawal requires medically monitored or managed care before residential admission. Document the referral and offer re-screen after stabilization.',
      drivers: ['Exclusionary gate: acute withdrawal risk'],
    };
  }
  if (excl.medicalInstability === 'yes') {
    return {
      outcome: 'refer-up',
      label: 'Refer — Medical Setting',
      detail: 'Acute medical instability exceeds clinically managed residential capability. Coordinate medical care and offer re-screen after stabilization.',
      drivers: ['Exclusionary gate: acute medical instability'],
    };
  }
  if (excl.acutePsych === 'yes') {
    return {
      outcome: 'refer-up',
      label: 'Refer — Psychiatric Inpatient / Crisis Services',
      detail: 'Imminent safety risk or acute psychiatric instability requires an inpatient or crisis level of care. Use the Mobile Crisis workflow if the person is in active crisis now.',
      drivers: ['Exclusionary gate: acute psychiatric risk'],
    };
  }
  if (dims.some((d) => d === null)) return null;
  const d = dims as number[];
  const drivers: string[] = [];

  if (d[0] >= 3 || d[1] >= 3 || d[2] >= 4) {
    if (d[0] >= 3) drivers.push(`Dim 1 withdrawal potential rated ${d[0]}`);
    if (d[1] >= 3) drivers.push(`Dim 2 biomedical severity rated ${d[1]}`);
    if (d[2] >= 4) drivers.push(`Dim 3 psychiatric severity rated ${d[2]}`);
    return {
      outcome: 'refer-up',
      label: 'Refer — Higher Level of Care',
      detail: 'One or more dimensions exceed what clinically managed residential can safely support. Refer to a medically monitored (3.7) or inpatient setting and document the disposition.',
      drivers,
    };
  }

  if (d[4] >= 3 && (d[2] >= 2 || d[3] >= 3)) {
    drivers.push(`Dim 5 relapse potential rated ${d[4]} — needs 24-hr structure`);
    if (d[2] >= 2) drivers.push(`Dim 3 co-occurring severity rated ${d[2]}`);
    if (d[3] >= 3) drivers.push(`Dim 4 readiness rated ${d[3]} — high external structure needed`);
    return {
      outcome: '3.5',
      label: 'Qualifies — ASAM 3.5 High-Intensity Residential',
      detail: 'High relapse potential combined with significant co-occurring symptoms or low readiness supports clinically managed high-intensity residential with 24-hour structure.',
      drivers,
    };
  }

  if (d[5] >= 2 || d[4] >= 2) {
    if (d[5] >= 2) drivers.push(`Dim 6 recovery environment rated ${d[5]} — unsafe/unsupportive housing`);
    if (d[4] >= 2) drivers.push(`Dim 5 relapse potential rated ${d[4]} — needs supportive structure`);
    return {
      outcome: '3.1',
      label: 'Qualifies — ASAM 3.1 Low-Intensity Residential',
      detail: 'Stable dimensions 1–3 with an unsupportive recovery environment or moderate relapse risk supports low-intensity residential with at least 5 hours of clinical services weekly.',
      drivers,
    };
  }

  drivers.push('All dimensions low severity with supportive environment');
  return {
    outcome: 'refer-out',
    label: 'Refer — Outpatient / IOP',
    detail: 'Severity profile does not meet residential medical necessity. Refer to outpatient or intensive outpatient, document the determination, and share community supports.',
    drivers,
  };
}

const DETERMINATION_STYLE: Record<Exclude<Determination, null>['outcome'], { bg: string; border: string; text: string; Icon: React.FC<{ className?: string }> }> = {
  'refer-up': { bg: 'bg-rose-50', border: 'border-rose-400', text: 'text-rose-800', Icon: ArrowUpCircle },
  '3.5': { bg: 'bg-rose-50', border: 'border-rose-300', text: 'text-rose-800', Icon: BedDouble },
  '3.1': { bg: 'bg-sky-50', border: 'border-sky-300', text: 'text-sky-800', Icon: BedDouble },
  'refer-out': { bg: 'bg-emerald-50', border: 'border-emerald-300', text: 'text-emerald-800', Icon: ArrowDownCircle },
};

// ---------------------------------------------------------------------------
// Shared helpers & small components
// ---------------------------------------------------------------------------

const DUE_BADGE: Record<DueStatus, { label: string; cls: string }> = {
  overdue: { label: 'Overdue', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  due: { label: 'Due Soon', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
  upcoming: { label: 'Upcoming', cls: 'bg-sky-50 text-sky-800 border-sky-200' },
  complete: { label: 'Complete', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
};

const TXPLAN_BADGE: Record<Resident['txPlanStatus'], { label: string; cls: string }> = {
  current: { label: 'Plan Current', cls: 'bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200' },
  due: { label: 'Review Due', cls: 'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200' },
  overdue: { label: 'Review Overdue', cls: 'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200' },
};

function initials(name: string) {
  return name.split(' ').map((w) => w[0]).join('').slice(0, 2);
}

// Rebuild the trackable due items from what the resident record holds, so they survive a reload.
function dueTasksFromRecord(r: { id: string; program: string; admitDate?: string | null; txPlanStatus?: string | null; nextCsrDate?: string | null }): AssessmentDue[] {
  const tasks: AssessmentDue[] = [];
  const dayMs = 1000 * 60 * 60 * 24;
  const program = r.program === '3.1' ? '3.1' : '3.5';
  if (r.nextCsrDate) {
    const due = new Date(r.nextCsrDate).toISOString().slice(0, 10);
    const daysLeft = Math.ceil((new Date(due).getTime() - new Date(todayISO()).getTime()) / dayMs);
    tasks.push({
      id: `${r.id}-csr`, residentId: r.id, name: `ASAM Continued-Stay Review (${program === '3.5' ? 7 : 30}-day)`,
      due, daysLeft, status: daysLeft < 0 ? 'overdue' : daysLeft <= 2 ? 'due' : 'upcoming',
      why: `${program} medical-necessity review cadence`, href: '/dashboard/ehr/locus',
    });
  }
  if (r.txPlanStatus && r.txPlanStatus !== 'current') {
    // Plan is due within 96 hrs (4 days) of admission.
    const admit = r.admitDate ? new Date(r.admitDate).getTime() : Date.now();
    const due = new Date(admit + 4 * dayMs).toISOString().slice(0, 10);
    const daysLeft = Math.ceil((new Date(due).getTime() - new Date(todayISO()).getTime()) / dayMs);
    tasks.push({
      id: `${r.id}-plan`, residentId: r.id, name: 'Initial Treatment Plan', due, daysLeft,
      status: daysLeft < 0 || r.txPlanStatus === 'overdue' ? 'overdue' : 'due',
      why: 'Individualized plan within 96 hrs of admission', href: '/dashboard/ehr/treatment-plans',
    });
  }
  return tasks;
}

function todayISO() {
  return new Date().toISOString().split('T')[0];
}

function addDaysISO(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function GateRow({
  question,
  hint,
  value,
  onChange,
}: {
  question: string;
  hint?: string;
  value: YesNo;
  onChange: (v: YesNo) => void;
}) {
  return (
    <div
      className={`bg-white rounded-xl border-2 p-4 transition-all ${
        value === 'yes' ? 'border-rose-400 bg-rose-50' : value === 'no' ? 'border-emerald-200' : 'border-slate-200 hover:border-slate-300'
      }`}
    >
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm text-slate-800 font-medium leading-snug">{question}</p>
          {hint && <p className="text-xs text-slate-500 mt-0.5">{hint}</p>}
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={() => onChange('yes')}
            className={`px-5 py-2 rounded-lg border-2 text-sm font-semibold transition-all ${
              value === 'yes' ? 'bg-rose-500 border-rose-500 text-white' : 'border-slate-200 text-slate-500 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700'
            }`}
          >
            Yes
          </button>
          <button
            onClick={() => onChange('no')}
            className={`px-5 py-2 rounded-lg border-2 text-sm font-semibold transition-all ${
              value === 'no' ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-slate-200 text-slate-500 hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700'
            }`}
          >
            No
          </button>
        </div>
      </div>
    </div>
  );
}

type Tab = 'census' | 'admissions' | 'residents' | 'assessments' | 'notes' | 'carf';

interface WaitlistEntry {
  name: string;
  program: Program;
  date: string;
  payer: string;
}

interface DeterminationLog {
  name: string;
  outcome: string;
  date: string;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ResidentialPage() {
  const [tab, setTab] = useState<Tab>('census');
  const [residents, setResidents] = useState<Resident[]>([]);
  const [assessments, setAssessments] = useState<AssessmentDue[]>([]);
  const [residentsLoading, setResidentsLoading] = useState(true);
  const [residentsError, setResidentsError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/residential/residents')
      .then((res) => res.json())
      .then((data) => {
        if (data.success && Array.isArray(data.residents)) {
          const now = Date.now();
          setResidents(
            data.residents.map((r: any) => {
              const admit = new Date(r.admitDate || Date.now()).getTime();
              const los = Math.max(0, Math.floor((now - admit) / (1000 * 60 * 60 * 24)));
              return {
                id: r.id,
                name: r.name,
                program: r.program === '3.1' ? '3.1' : '3.5',
                room: r.room,
                admitDate: r.admitDate ? new Date(r.admitDate).toISOString().split('T')[0] : todayISO(),
                losDays: los,
                counselor: r.counselor || 'Staff Counselor',
                txPlanStatus: (r.txPlanStatus as any) || 'current',
                orientationDone: Boolean(r.orientationDone),
                phase: r.phase || 'Active Treatment',
              };
            })
          );
          setAssessments(data.residents.flatMap((r: any) => dueTasksFromRecord(r)));
        } else {
          setResidents([]);
        }
      })
      .catch((err) => {
        console.warn('Could not load residents from PostgreSQL:', err);
        setResidentsError('Could not load residents. Refresh the page to try again.');
      })
      .finally(() => setResidentsLoading(false));
  }, []);
  const [capacity, setCapacity] = useState<CapacitySummary | null>(null);
  const [capacityError, setCapacityError] = useState<string | null>(null);
  useEffect(() => {
    fetch('/api/residential/capacity')
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.success) throw new Error(data?.error || `Could not load bed capacity (${res.status})`);
        setCapacity(summarizeCapacity(data.rows as CapacityRow[]));
      })
      .catch((err: unknown) => setCapacityError(err instanceof Error ? err.message : 'Could not load bed capacity'));
  }, []);
  const [dueFilter, setDueFilter] = useState<'all' | DueStatus>('all');
  const [completedIds, setCompletedIds] = useState<string[]>([]);
  const [drills] = useState<DrillLog[]>([]);

  // Admissions / qualification state
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [waitlist, setWaitlist] = useState<WaitlistEntry[]>([]);
  const [determinationLog, setDeterminationLog] = useState<DeterminationLog[]>([]);
  const [determinationLoadError, setDeterminationLoadError] = useState<string | null>(null);
  useEffect(() => {
    fetch('/api/residential/determinations')
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.success) throw new Error(data?.error || `Could not load the determination log (${res.status})`);
        setDeterminationLog(
          (data.determinations as Array<{ applicantName: string; detail: string; determinedAt: string }>).map((d) => ({
            name: d.applicantName,
            outcome: d.detail,
            date: String(d.determinedAt).slice(0, 10),
          }))
        );
      })
      .catch((err: unknown) => setDeterminationLoadError(err instanceof Error ? err.message : 'Could not load the determination log'));
  }, []);
  const [admStep, setAdmStep] = useState(0); // 0 source, 1 applicant, 2 gates, 3 dimensions, 4 determination
  const [admSource, setAdmSource] = useState<'new' | 'client' | 'referral' | null>(null);
  const [admReferralId, setAdmReferralId] = useState('');
  const [applicant, setApplicant] = useState({ name: '', dob: '', phone: '', payer: '', sourceNote: '' });
  const [excl, setExcl] = useState<ExclusionAnswers>({ withdrawalRisk: null, medicalInstability: null, acutePsych: null });
  const [dims, setDims] = useState<(number | null)[]>([null, null, null, null, null, null]);
  const [overrideLevel, setOverrideLevel] = useState<'' | '3.5' | '3.1'>('');
  const [overrideReason, setOverrideReason] = useState('');
  const [bedChoice, setBedChoice] = useState('');
  const [counselorChoice, setCounselorChoice] = useState(COUNSELORS[0] ?? '');
  const [admFinished, setAdmFinished] = useState<'' | 'admitted' | 'waitlisted' | 'referred'>('');
  const [admBusy, setAdmBusy] = useState(false);
  const [admError, setAdmError] = useState<string | null>(null);
  const [taskBusyId, setTaskBusyId] = useState<string | null>(null);
  const [taskError, setTaskError] = useState<string | null>(null);
  const [noteBusy, setNoteBusy] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);

  // AI continued-stay review drafter (AWS Bedrock via /api/residential/ai-csr)
  const [csrDraftRow, setCsrDraftRow] = useState('');
  const [csrDraftText, setCsrDraftText] = useState('');
  const [csrLoading, setCsrLoading] = useState(false);
  const [csrError, setCsrError] = useState<string | null>(null);

  // Server builds the draft from the resident record + signed shift notes; no local template on failure.
  const draftCsr = async (a: AssessmentDue, r: Resident) => {
    setCsrDraftRow(a.id);
    setCsrDraftText('');
    setCsrError(null);
    setCsrLoading(true);
    try {
      const res = await fetch('/api/residential/ai-csr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ residentId: r.id }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success || !data.justification) {
        throw new Error(data?.error || `AI draft failed (${res.status})`);
      }
      setCsrDraftText(data.justification);
    } catch (err: unknown) {
      setCsrError(err instanceof Error ? err.message : 'AI draft failed');
    } finally {
      setCsrLoading(false);
    }
  };

  // Smart note builder state
  const [noteResident, setNoteResident] = useState('');
  const [noteShift, setNoteShift] = useState(SHIFTS[0]);
  const [chips, setChips] = useState<string[]>([]);
  const [noteExtra, setNoteExtra] = useState('');
  const [noteSigned, setNoteSigned] = useState(false);
  const [noteSaved, setNoteSaved] = useState(false);

  const residentById = (id: string) => residents.find((r) => r.id === id);

  const toggleChip = (c: string) => {
    setNoteSaved(false);
    setChips((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  };

  const assessmentRows = useMemo(
    () =>
      assessments
        .map((a) => ({ ...a, status: completedIds.includes(a.id) ? ('complete' as DueStatus) : a.status }))
        .sort((x, y) => x.daysLeft - y.daysLeft),
    [assessments, completedIds]
  );

  const overdueCount = assessmentRows.filter((a) => a.status === 'overdue').length;
  const dueCount = assessmentRows.filter((a) => a.status === 'due').length;
  const filteredRows = assessmentRows.filter((a) => (dueFilter === 'all' ? a.status !== 'complete' : a.status === dueFilter));

  const census35 = residents.filter((r) => r.program === '3.5').length;
  const census31 = residents.filter((r) => r.program === '3.1').length;
  const levelOcc = occupancyByLevel(capacity ?? summarizeCapacity([]), residents.map((r) => r.program));
  const occOf = (prog: Program) => levelOcc.find((l) => l.level === prog) ?? { level: prog, beds: null, residents: 0, open: null, overCapacity: 0, occupancyPct: null };
  const occTotal = totalOccupancy(levelOcc.filter((l) => l.level === '3.5' || l.level === '3.1'));
  const occLevelText = (prog: Program) => {
    const o = occOf(prog);
    return o.beds === null ? `${prog}: ${o.residents} (beds not configured)` : `${prog}: ${o.residents}/${o.beds}`;
  };
  const avgLos: number | null = residents.length ? Math.round(residents.reduce((s, r) => s + r.losDays, 0) / residents.length) : null;

  /** Configured room labels still free; [] when no rooms are configured for the level */
  const openRooms = (prog: Program) => (capacity ? openRoomLabels(capacity, prog, residents.map((r) => r.room)) : []);
  const hasRoomList = (prog: Program) => Boolean(capacity?.levels.find((l) => l.level === prog)?.rooms.length);
  /** true only when beds are configured and every bed is taken */
  const bedsFull = (prog: Program) => occOf(prog).open === 0;

  // ── Qualification engine ──────────────────────────────────────────────
  const gateTriggered = excl.withdrawalRisk === 'yes' || excl.medicalInstability === 'yes' || excl.acutePsych === 'yes';
  const gatesAnswered = excl.withdrawalRisk !== null && excl.medicalInstability !== null && excl.acutePsych !== null;
  const dimsComplete = dims.every((d) => d !== null);
  const determination = computeDetermination(excl, dims);
  const recommendedLevel: '' | '3.5' | '3.1' = determination?.outcome === '3.5' ? '3.5' : determination?.outcome === '3.1' ? '3.1' : '';
  const finalLevel: '' | '3.5' | '3.1' = overrideLevel || recommendedLevel;
  const overrideActive = overrideLevel !== '' && overrideLevel !== recommendedLevel;

  const resetAdmission = () => {
    setAdmStep(0);
    setAdmSource(null);
    setAdmReferralId('');
    setApplicant({ name: '', dob: '', phone: '', payer: '', sourceNote: '' });
    setExcl({ withdrawalRisk: null, medicalInstability: null, acutePsych: null });
    setDims([null, null, null, null, null, null]);
    setOverrideLevel('');
    setOverrideReason('');
    setBedChoice('');
    setAdmFinished('');
  };

  const startFromReferral = (ref: Referral) => {
    resetAdmission();
    setAdmSource('referral');
    setAdmReferralId(ref.id);
    setApplicant({ name: ref.name, dob: '', phone: '', payer: ref.payer, sourceNote: ref.source });
    setAdmStep(1);
  };

  const generateAdmissionTasks = (residentId: string, program: Program): AssessmentDue[] => {
    const cadence = program === '3.5' ? 7 : 30;
    return [
      { id: `${residentId}-tb`, residentId, name: 'TB Screening & Health Questionnaire', due: addDaysISO(1), daysLeft: 1, status: 'due', why: 'Communicable disease screen on admission' },
      { id: `${residentId}-cssrs`, residentId, name: 'C-SSRS Baseline Screen', due: addDaysISO(1), daysLeft: 1, status: 'due', why: 'Suicide risk baseline within 24 hrs of admission', href: '/dashboard/ehr/assessments/cssrs' },
      { id: `${residentId}-bps`, residentId, name: 'Biopsychosocial Assessment', due: addDaysISO(3), daysLeft: 3, status: 'due', why: 'Complete within 72 hrs of admission', href: '/dashboard/ehr/evaluations' },
      { id: `${residentId}-plan`, residentId, name: 'Initial Treatment Plan', due: addDaysISO(4), daysLeft: 4, status: 'upcoming', why: 'Individualized plan within 96 hrs of admission', href: '/dashboard/ehr/treatment-plans' },
      { id: `${residentId}-csr`, residentId, name: `ASAM Continued-Stay Review (${cadence}-day)`, due: addDaysISO(cadence), daysLeft: cadence, status: 'upcoming', why: `${program} medical-necessity review cadence`, href: '/dashboard/ehr/locus' },
    ];
  };

  /** Stores a determination; the log shows it only once the server saved it. */
  const recordDetermination = async (entry: {
    outcome: 'admitted' | 'waitlisted' | 'referred';
    level: Program | null;
    detail: string;
    residentId?: string;
  }): Promise<boolean> => {
    try {
      const res = await fetch('/api/residential/determinations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ applicantName: applicant.name, ...entry }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) throw new Error(data?.error || `Could not save the determination (${res.status})`);
      setDeterminationLog((prev) => [{ name: applicant.name, outcome: entry.detail, date: todayISO() }, ...prev]);
      return true;
    } catch (e: unknown) {
      setAdmError(e instanceof Error ? e.message : 'Could not save the determination');
      return false;
    }
  };

  const handleAdmit = async () => {
    if (!finalLevel || !bedChoice || !applicant.name || admBusy) return;
    setAdmBusy(true);
    setAdmError(null);
    let id: string;
    try {
      const res = await fetch('/api/residential/residents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: applicant.name,
          program: finalLevel,
          room: bedChoice,
          counselor: counselorChoice || 'Unassigned',
          // All six dimensions rated, or null: never a default score
          asamScores: asamScoresFromDims(dims),
          withdrawalRisk: excl.withdrawalRisk === 'yes',
          medicalInstability: excl.medicalInstability === 'yes',
          acutePsych: excl.acutePsych === 'yes',
          overrideReason: overrideActive ? overrideReason : undefined,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success || !data.resident?.id) {
        throw new Error(data?.error || `Admission failed (${res.status})`);
      }
      id = data.resident.id;
    } catch (e: unknown) {
      setAdmError(e instanceof Error ? e.message : 'Admission failed');
      setAdmBusy(false);
      return;
    }
    const newResident: Resident = {
      id,
      name: applicant.name,
      program: finalLevel,
      room: bedChoice,
      admitDate: todayISO(),
      losDays: 0,
      counselor: counselorChoice || 'Unassigned',
      txPlanStatus: 'due',
      orientationDone: false,
      phase: 'Admission',
    };
    setResidents((prev) => [...prev, newResident]);
    setAssessments((prev) => {
      const fresh = generateAdmissionTasks(id, finalLevel);
      return [...prev.filter((t) => !fresh.some((f) => f.id === t.id)), ...fresh];
    });
    const logged = await recordDetermination({
      outcome: 'admitted',
      level: finalLevel,
      detail: `Admitted — ASAM ${finalLevel}${overrideActive ? ' (clinician override)' : ''}, Room ${bedChoice}`,
      residentId: id,
    });
    if (!logged) setAdmError('Resident admitted, but the determination log entry was not saved.');
    if (admSource === 'referral') setReferrals((prev) => prev.filter((r) => r.id !== admReferralId));
    setAdmBusy(false);
    setAdmFinished('admitted');
  };

  const handleWaitlist = async () => {
    if (!finalLevel || !applicant.name || admBusy) return;
    setAdmBusy(true);
    setAdmError(null);
    const logged = await recordDetermination({
      outcome: 'waitlisted',
      level: finalLevel,
      detail: `Qualified for ASAM ${finalLevel} — waitlisted (no open bed)`,
    });
    setAdmBusy(false);
    if (!logged) return;
    setWaitlist((prev) => [...prev, { name: applicant.name, program: finalLevel, date: todayISO(), payer: applicant.payer || '—' }]);
    if (admSource === 'referral') setReferrals((prev) => prev.filter((r) => r.id !== admReferralId));
    setAdmFinished('waitlisted');
  };

  // Records the outgoing referral in the org's referral log (/api/referrals) — confirmed only after the server saves it.
  const handleReferOut = async () => {
    if (!determination || !applicant.name || admBusy) return;
    setAdmBusy(true);
    setAdmError(null);
    try {
      const res = await fetch('/api/referrals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          direction: 'outgoing',
          patientName: applicant.name,
          sourceType: determination.outcome === 'refer-up' ? 'hospital' : 'other_provider',
          sourceName: determination.label,
          referralDate: todayISO(),
          notes: `Residential ASAM determination: ${determination.label}. ${determination.detail} Drivers: ${determination.drivers.join('; ')}`,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) throw new Error(data?.error || `Could not record referral (${res.status})`);
    } catch (e: unknown) {
      setAdmError(e instanceof Error ? e.message : 'Could not record referral');
      setAdmBusy(false);
      return;
    }
    const logged = await recordDetermination({ outcome: 'referred', level: null, detail: determination.label });
    if (!logged) setAdmError('Referral recorded, but the determination log entry was not saved.');
    if (admSource === 'referral') setReferrals((prev) => prev.filter((r) => r.id !== admReferralId));
    setAdmBusy(false);
    setAdmFinished('referred');
  };

  // Mark Done persists only for tasks the resident record can hold (continued-stay review, treatment plan).
  const persistableTask = (a: AssessmentDue) => a.id.endsWith('-csr') || a.id.endsWith('-plan');
  const markTaskDone = async (a: AssessmentDue, program: Program) => {
    if (!persistableTask(a) || taskBusyId) return;
    // The resident record cannot link a plan document yet, so staff attest that the signed plan is in the chart.
    if (a.id.endsWith('-plan') && !window.confirm('Confirm the initial treatment plan is completed and signed in the chart. This sets the plan status for this resident to current.')) return;
    setTaskBusyId(a.id);
    setTaskError(null);
    const cadence = program === '3.5' ? 7 : 30;
    const patch = a.id.endsWith('-csr')
      ? { lastCsrDate: todayISO(), nextCsrDate: addDaysISO(cadence) }
      : { txPlanStatus: 'current' };
    try {
      const res = await fetch(`/api/residential/residents/${encodeURIComponent(a.residentId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) throw new Error(data?.error || `Update failed (${res.status})`);
      setCompletedIds((prev) => [...prev, a.id]);
      if (a.id.endsWith('-plan')) {
        setResidents((prev) => prev.map((r) => (r.id === a.residentId ? { ...r, txPlanStatus: 'current' } : r)));
      }
    } catch (e: unknown) {
      setTaskError(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setTaskBusyId(null);
    }
  };

  // Auto-drafted narrative from selected chips (smart documentation)
  const resident = residentById(noteResident);
  const narrative = useMemo(() => {
    if (!resident) return '';
    const byGroup = NOTE_CHIPS.map((g) => ({ g: g.group, picked: g.options.filter((o) => chips.includes(o)) })).filter((x) => x.picked.length);
    if (!byGroup.length && !noteExtra) return '';
    const sentences = byGroup.map(({ g, picked }) => {
      const list = picked.join('; ').toLowerCase();
      switch (g) {
        case 'Participation': return `Participation this shift: ${list}.`;
        case 'Mood & Behavior': return `Observed mood/behavior: ${list}.`;
        case 'Medications': return `Medication status: ${list}.`;
        case 'Safety & Milieu': return `Safety & milieu: ${list}.`;
        case 'Recovery Work': return `Recovery work: ${list}.`;
        default: return '';
      }
    });
    return (
      `${resident.name} — ASAM ${resident.program} residential, ${noteShift} shift. ` +
      sentences.join(' ') +
      (noteExtra ? ` ${noteExtra}` : '') +
      ` Documentation ties to the resident's current individualized treatment plan (phase: ${resident.phase}).`
    );
  }, [resident, chips, noteExtra, noteShift]);

  const goalChipPicked = chips.some((c) => NOTE_CHIPS[4].options.includes(c));

  // Drills have no data store yet (Log Drill is not available): conformance is not tracked, never 0%
  const quarterStart = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(Math.floor(d.getMonth() / 3) * 3 + 1).padStart(2, '0')}-01`;
  })();
  const drillsThisQuarter = drills.filter((d) => d.date >= quarterStart);
  const drillCompliance: number | null = drillsThisQuarter.length
    ? Math.round((new Set(drillsThisQuarter.map((d) => d.shift)).size / 3) * 100)
    : null;

  return (
    <Page>
      <PageHeader
        title="Residential Housing — ASAM 3.1 & 3.5"
        description="Admissions, bed board, assessments due, smart documentation & CARF program requirements"
        actions={
          <>
            <Button variant="secondary" icon={<PenLine />} onClick={() => setTab('notes')}>
              Shift Note
            </Button>
            <Button icon={<UserPlus />} onClick={() => { resetAdmission(); setTab('admissions'); }}>
              New Admission
            </Button>
          </>
        }
      />

      {/* Metric tiles */}
      <StatGrid columns={4}>
        {[
          {
            label: 'Occupancy',
            value: occTotal.beds === null ? `${census35 + census31} residents` : `${census35 + census31}/${occTotal.beds}${occTotal.occupancyPct === null ? '' : ` · ${occTotal.occupancyPct}%`}`,
            sub: capacityError ? `Bed capacity unavailable: ${capacityError}` : capacity && !capacity.configured ? `${BEDS_NOT_CONFIGURED} (Practice settings › Programs & capacity)` : `${occLevelText('3.5')} · ${occLevelText('3.1')}`,
            Icon: BedDouble,
            tone: 'info' as Tone,
          },
          { label: 'Referrals Pending', value: String(referrals.length), sub: waitlist.length ? `${waitlist.length} on waitlist` : 'waitlist clear', Icon: Inbox, tone: (referrals.length ? 'brand' : 'success') as Tone },
          { label: 'Assessments Overdue', value: String(overdueCount), sub: `${dueCount} more due this week`, Icon: AlertTriangle, tone: (overdueCount ? 'danger' : 'success') as Tone },
          { label: 'Avg LOS / Drill Compliance', value: `${avgLos == null ? '—' : `${avgLos}d`} · ${drillCompliance == null ? '—' : `${drillCompliance}%`}`, sub: drillCompliance == null ? 'length of stay · drills not tracked yet' : 'length of stay · drills this qtr', Icon: Timer, tone: 'brand' as Tone },
        ].map((m) => (
          <StatCard key={m.label} label={m.label} value={m.value} hint={m.sub} icon={<m.Icon />} tone={m.tone} />
        ))}
      </StatGrid>

      {/* Tabs */}
      <Tabs
        label="Residential sections"
        controlsPanels={false}
        value={tab}
        onChange={setTab}
        items={([
          { id: 'census', label: 'Bed Board', Icon: BedDouble },
          { id: 'admissions', label: 'Admissions', Icon: UserPlus, badge: referrals.length },
          { id: 'residents', label: 'Residents', Icon: Users },
          { id: 'assessments', label: 'Assessments Due', Icon: ClipboardCheck, badge: overdueCount },
          { id: 'notes', label: 'Smart Documentation', Icon: PenLine },
          { id: 'carf', label: 'CARF Requirements', Icon: ShieldCheck },
        ] as { id: Tab; label: string; Icon: React.FC<{ className?: string }>; badge?: number }[]).map((t) => ({
          key: t.id,
          label: t.label,
          icon: <t.Icon />,
          count: t.badge || undefined,
          countTone: 'attention' as const,
        }))}
      />

      {residentsError && <Alert tone="danger">{residentsError}</Alert>}
      {residentsLoading && <Card><LoadingState label="Loading residents…" /></Card>}

      {/* ===================================================================
          TAB — BED BOARD / CENSUS
      =================================================================== */}
      {tab === 'census' && (
        <div className="space-y-5">
          {(['3.5', '3.1'] as Program[]).map((prog) => {
            const info = PROGRAM_INFO[prog];
            const progResidents = residents.filter((r) => r.program === prog);
            const occ = occOf(prog);
            const open = occ.open ?? 0;
            return (
              <div key={prog} className={`bg-white rounded-xl border-2 ${info.border} overflow-hidden`}>
                <div className={`px-5 py-3.5 ${info.bg} border-b ${info.border} flex flex-wrap items-center gap-2`}>
                  <div>
                    <h2 className={`text-sm font-semibold ${info.color}`}>{info.title}</h2>
                    <p className="text-[11px] text-slate-500">{info.subtitle} · {info.reviewCadence}</p>
                  </div>
                  <span className="ml-auto text-xs font-semibold text-slate-600">
                    {occ.beds === null ? (
                      <>
                        {progResidents.length} resident{progResidents.length === 1 ? '' : 's'} ·{' '}
                        <a href={CAPACITY_SETTINGS_HREF} className="text-amber-700 underline">{BEDS_NOT_CONFIGURED}</a>
                      </>
                    ) : (
                      <>
                        {progResidents.length}/{occ.beds} beds · <span className={open ? 'text-emerald-700' : 'text-rose-600'}>{open} open</span>
                        {occ.overCapacity ? <span className="text-rose-600"> · {occ.overCapacity} over capacity</span> : null}
                      </>
                    )}
                  </span>
                </div>
                <div className="p-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {progResidents.map((r) => {
                    const tp = TXPLAN_BADGE[r.txPlanStatus];
                    return (
                      <button
                        key={r.id}
                        onClick={() => { setNoteResident(r.id); setTab('residents'); }}
                        className="text-left rounded-xl border border-slate-200 p-3 hover:border-blue-300 hover:shadow-sm transition-all"
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <div className="w-8 h-8 rounded-full bg-blue-50 text-blue-700 flex items-center justify-center text-xs font-semibold shrink-0">
                            {initials(r.name)}
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-slate-900 truncate">{r.name}</p>
                            <p className="text-[11px] text-slate-500">Room {r.room} · Day {r.losDays}</p>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded-full ${tp.cls}`}>{tp.label}</span>
                          {!r.orientationDone && (
                            <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-700">Orientation Pending</span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                  {Array.from({ length: open }).map((_, i) => (
                    <button
                      key={`open-${i}`}
                      onClick={() => { resetAdmission(); setTab('admissions'); }}
                      className="rounded-xl border-2 border-dashed border-slate-200 p-3 flex flex-col items-center justify-center text-slate-500 min-h-[84px] hover:border-sky-300 hover:text-sky-700 transition-colors"
                    >
                      <BedDouble className="h-5 w-5 mb-1" />
                      <span className="text-[11px] font-semibold">Open Bed — Admit</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3.5 flex gap-3">
            <Sparkles className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
            <p className="text-sm text-blue-700">
              Bed cards surface compliance at a glance — treatment-plan status and pending orientation show right on the
              board. Tap an open bed to start an admission.
            </p>
          </div>
        </div>
      )}

      {/* ===================================================================
          TAB — ADMISSIONS & SMART QUALIFICATION
      =================================================================== */}
      {tab === 'admissions' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Wizard column */}
          <div className="lg:col-span-2 space-y-4">
            {/* Stepper */}
            <div className="flex gap-1.5">
              {['Source', 'Applicant', 'Safety Gates', 'ASAM Dimensions', 'Determination'].map((label, i) => {
                const skipDims = gateTriggered && i === 3;
                return (
                  <div
                    key={label}
                    className={`flex-1 py-2 px-1 rounded-lg text-center text-[11px] font-semibold border-2 ${
                      admStep === i
                        ? 'bg-sky-700 border-sky-700 text-white'
                        : admStep > i
                        ? 'bg-sky-50 border-sky-200 text-sky-700'
                        : skipDims
                        ? 'bg-slate-50 border-slate-100 text-slate-500 line-through'
                        : 'bg-slate-50 border-slate-200 text-slate-500'
                    }`}
                  >
                    {i + 1}. {label}
                  </div>
                );
              })}
            </div>

            {/* Finished banner */}
            {admFinished && (
              <div className={`rounded-xl border-2 p-6 text-center ${
                admFinished === 'admitted' ? 'bg-emerald-50 border-emerald-300' : admFinished === 'waitlisted' ? 'bg-amber-50 border-amber-300' : 'bg-blue-50 border-blue-300'
              }`}>
                <CheckCircle2 className={`h-10 w-10 mx-auto mb-2 ${admFinished === 'admitted' ? 'text-emerald-700' : admFinished === 'waitlisted' ? 'text-amber-700' : 'text-blue-500'}`} />
                <h2 className="text-lg font-semibold text-slate-900 mb-1">
                  {admFinished === 'admitted' ? `${applicant.name} admitted to ASAM ${finalLevel}` : admFinished === 'waitlisted' ? `${applicant.name} added to the ${finalLevel} waitlist` : 'Referral out documented'}
                </h2>
                <p className="text-sm text-slate-600 mb-4">
                  {admFinished === 'admitted'
                    ? `Room ${bedChoice} assigned and the resident record is saved. Admission tasks are listed under Assessments Due — orientation within 24 hrs, TB screen & C-SSRS baseline tomorrow, biopsychosocial in 72 hrs, initial plan in 96 hrs. Per-diem billing (${finalLevel === '3.5' ? 'H0018' : 'H0019'}) is not generated automatically — enter it in Residential & Crisis Billing once prior auth is on file.`
                    : admFinished === 'waitlisted'
                    ? 'The waitlist is kept on this screen only and is not saved yet — record the waitlist placement in the referral log or the client chart.'
                    : 'The outgoing referral and the determination rationale are saved to the referral log.'}
                </p>
                <div className="flex justify-center gap-2">
                  {admFinished === 'admitted' && (
                    <button onClick={() => { setTab('census'); }} className={buttonClasses()}>
                      <BedDouble className="h-4 w-4" /> View Bed Board
                    </button>
                  )}
                  <button onClick={resetAdmission} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-100 text-slate-700 text-sm font-semibold hover:bg-slate-200">
                    <UserPlus className="h-4 w-4" /> Start Another
                  </button>
                </div>
              </div>
            )}

            {/* STEP 0 — Source */}
            {!admFinished && admStep === 0 && (
              <div className="space-y-3">
                <p className="text-sm text-slate-600">Where is this admission coming from?</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {([
                    { id: 'new', label: 'New Person', desc: 'Not yet in the system — enter their details', Icon: UserPlus },
                    { id: 'client', label: 'Existing Client', desc: 'Step-up from outpatient / PRP caseload', Icon: Users },
                    { id: 'referral', label: 'From Referral', desc: `${referrals.length} pending in the queue`, Icon: Inbox },
                  ] as { id: 'new' | 'client' | 'referral'; label: string; desc: string; Icon: React.FC<{ className?: string }> }[]).map((s) => (
                    <button
                      key={s.id}
                      onClick={() => { setAdmSource(s.id); if (s.id !== 'referral') setAdmStep(1); }}
                      className={`rounded-xl border-2 p-4 text-left transition-all ${
                        admSource === s.id ? 'border-sky-400 bg-sky-50' : 'border-slate-200 bg-white hover:border-sky-200'
                      }`}
                    >
                      <s.Icon className="h-5 w-5 text-sky-700 mb-2" />
                      <p className="text-sm font-semibold text-slate-900">{s.label}</p>
                      <p className="text-xs text-slate-500">{s.desc}</p>
                    </button>
                  ))}
                </div>

                {/* Referral queue inline when that source is picked */}
                {admSource === 'referral' && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Pick a referral to qualify</p>
                    {referrals.length === 0 && (
                      <p className="text-sm text-slate-500 bg-white border border-slate-200 rounded-xl p-4">Referral queue is empty.</p>
                    )}
                    {referrals.map((ref) => {
                      const Icon = REFERRAL_ICON[ref.sourceKind];
                      return (
                        <button
                          key={ref.id}
                          onClick={() => startFromReferral(ref)}
                          className="w-full bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-3 text-left hover:border-sky-300 hover:shadow-sm transition-all"
                        >
                          <div className="w-9 h-9 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                            <Icon className="h-4 w-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-slate-900">{ref.name} <span className="text-slate-500 font-normal">· {ref.age}</span></p>
                            <p className="text-xs text-slate-500 truncate">{ref.source}</p>
                            <p className="text-[11px] text-slate-500">{ref.concern} · {ref.payer}</p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-[11px] text-slate-500">Received {ref.received}</p>
                            <span className="text-xs font-semibold text-sky-700 inline-flex items-center gap-1">Start Qualification <ChevronRight className="h-3.5 w-3.5" /></span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* STEP 1 — Applicant */}
            {!admFinished && admStep === 1 && (
              <div className="space-y-4">
                <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
                  {admSource === 'client' ? (
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                        <Users className="inline h-3.5 w-3.5 mr-1 -mt-0.5" /> Select Existing Client
                      </label>
                      <select
                        value={applicant.name}
                        onChange={(e) => setApplicant((p) => ({ ...p, name: e.target.value, sourceNote: 'Internal step-up from outpatient caseload' }))}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                      >
                        <option value="">Choose from client list…</option>
                        {OUTPATIENT_CLIENTS.map((c) => (
                          <option key={c}>{c}</option>
                        ))}
                      </select>
                      <p className="text-[11px] text-slate-500 mt-1.5">Demographics, insurance & history pull forward from the existing chart — no re-entry.</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Full Name</label>
                        <input
                          value={applicant.name}
                          onChange={(e) => setApplicant((p) => ({ ...p, name: e.target.value }))}
                          placeholder="First Last"
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Date of Birth</label>
                        <input
                          type="date"
                          value={applicant.dob}
                          onChange={(e) => setApplicant((p) => ({ ...p, dob: e.target.value }))}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Phone</label>
                        <input
                          value={applicant.phone}
                          onChange={(e) => setApplicant((p) => ({ ...p, phone: e.target.value }))}
                          placeholder="(___) ___-____"
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Payer / Insurance</label>
                        <input
                          value={applicant.payer}
                          onChange={(e) => setApplicant((p) => ({ ...p, payer: e.target.value }))}
                          placeholder="e.g., Maryland Medicaid"
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500"
                        />
                      </div>
                    </div>
                  )}
                  {applicant.sourceNote && (
                    <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-xs text-blue-700">
                      <strong>Source:</strong> {applicant.sourceNote}
                    </div>
                  )}
                </div>
                <div className="flex justify-between">
                  <button onClick={() => setAdmStep(0)} className="inline-flex items-center gap-2 px-5 py-2.5 bg-slate-100 text-slate-700 rounded-lg font-semibold text-sm hover:bg-slate-200">
                    <ChevronLeft className="h-4 w-4" /> Back
                  </button>
                  <button
                    onClick={() => setAdmStep(2)}
                    disabled={!applicant.name}
                    className={buttonClasses({ size: 'lg' })}
                  >
                    Next: Safety Gates <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}

            {/* STEP 2 — Exclusionary safety gates */}
            {!admFinished && admStep === 2 && (
              <div className="space-y-3">
                <div className="bg-rose-50 border border-rose-200 rounded-xl p-3.5 flex gap-3">
                  <AlertOctagon className="h-4 w-4 text-rose-600 mt-0.5 shrink-0" />
                  <p className="text-sm text-rose-700">
                    <strong>Exclusionary screen.</strong> A Yes on any gate means our clinically managed levels can&apos;t
                    safely serve this person right now — the six-dimension assessment is skipped and a documented
                    referral out is generated instead.
                  </p>
                </div>
                <GateRow
                  question="High-risk withdrawal — needs medical withdrawal management?"
                  hint="Current heavy use with seizure/DT history, or significant active withdrawal signs"
                  value={excl.withdrawalRisk}
                  onChange={(v) => setExcl((p) => ({ ...p, withdrawalRisk: v }))}
                />
                <GateRow
                  question="Acute medical instability beyond residential capability?"
                  hint="Needs nursing or medical monitoring we cannot provide at 3.1/3.5"
                  value={excl.medicalInstability}
                  onChange={(v) => setExcl((p) => ({ ...p, medicalInstability: v }))}
                />
                <GateRow
                  question="Imminent danger to self or others, or acute psychiatric instability?"
                  hint="If in active crisis right now, use the Mobile Crisis workflow"
                  value={excl.acutePsych}
                  onChange={(v) => setExcl((p) => ({ ...p, acutePsych: v }))}
                />
                {gateTriggered && gatesAnswered && determination && (
                  <div className={`rounded-xl border-2 p-4 ${DETERMINATION_STYLE[determination.outcome].bg} ${DETERMINATION_STYLE[determination.outcome].border}`}>
                    <div className="flex items-center gap-3">
                      <ArrowUpCircle className={`h-6 w-6 shrink-0 ${DETERMINATION_STYLE[determination.outcome].text}`} />
                      <div>
                        <p className={`text-sm font-semibold ${DETERMINATION_STYLE[determination.outcome].text}`}>{determination.label}</p>
                        <p className="text-xs text-slate-600 mt-0.5">{determination.detail}</p>
                      </div>
                    </div>
                  </div>
                )}
                <div className="flex justify-between pt-1">
                  <button onClick={() => setAdmStep(1)} className="inline-flex items-center gap-2 px-5 py-2.5 bg-slate-100 text-slate-700 rounded-lg font-semibold text-sm hover:bg-slate-200">
                    <ChevronLeft className="h-4 w-4" /> Back
                  </button>
                  <button
                    onClick={() => setAdmStep(gateTriggered ? 4 : 3)}
                    disabled={!gatesAnswered}
                    className={buttonClasses({ size: 'lg' })}
                  >
                    {gateTriggered ? 'Go to Determination' : 'Next: ASAM Dimensions'} <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}

            {/* STEP 3 — Six dimensions */}
            {!admFinished && admStep === 3 && (
              <div className="space-y-4">
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-3.5 flex gap-3">
                  <ClipboardCheck className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
                  <p className="text-sm text-blue-700">
                    Rate each ASAM dimension 0–4 using the anchors. The level-of-care recommendation computes live as you
                    rate — watch it update in the panel on the right.
                  </p>
                </div>
                {ASAM_DIMENSIONS.map((dim) => (
                  <div key={dim.id} className="bg-white rounded-xl border border-slate-200 p-4">
                    <p className="text-sm font-semibold text-slate-800">{dim.name}</p>
                    <p className="text-xs text-slate-500 mb-3">{dim.description}</p>
                    <div className="space-y-1.5">
                      {dim.anchors.map((a) => (
                        <button
                          key={a.value}
                          onClick={() => setDims((prev) => prev.map((v, i) => (i === dim.id ? a.value : v)))}
                          className={`w-full text-left px-3 py-2 rounded-lg border text-sm transition-all flex items-center gap-3 ${
                            dims[dim.id] === a.value
                              ? a.value >= 3
                                ? 'bg-rose-50 border-rose-300 text-rose-800 font-medium'
                                : a.value === 2
                                ? 'bg-amber-50 border-amber-300 text-amber-800 font-medium'
                                : 'bg-emerald-50 border-emerald-300 text-emerald-800 font-medium'
                              : 'border-slate-100 text-slate-600 hover:bg-slate-50 hover:border-slate-200'
                          }`}
                        >
                          <span
                            className={`w-6 h-6 rounded-full text-xs font-semibold flex items-center justify-center shrink-0 ${
                              dims[dim.id] === a.value
                                ? a.value >= 3 ? 'bg-rose-600 text-white' : a.value === 2 ? 'bg-amber-500 text-white' : 'bg-emerald-600 text-white'
                                : 'bg-slate-100 text-slate-500'
                            }`}
                          >
                            {a.value}
                          </span>
                          <span>{a.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                <div className="flex justify-between pt-1">
                  <button onClick={() => setAdmStep(2)} className="inline-flex items-center gap-2 px-5 py-2.5 bg-slate-100 text-slate-700 rounded-lg font-semibold text-sm hover:bg-slate-200">
                    <ChevronLeft className="h-4 w-4" /> Back
                  </button>
                  <button
                    onClick={() => setAdmStep(4)}
                    disabled={!dimsComplete}
                    className={buttonClasses({ size: 'lg' })}
                  >
                    View Determination <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}

            {/* STEP 4 — Determination, bed assignment & admit */}
            {!admFinished && admStep === 4 && determination && (
              <div className="space-y-4">
                {/* Determination banner */}
                <div className={`rounded-xl border-2 p-6 ${DETERMINATION_STYLE[determination.outcome].bg} ${DETERMINATION_STYLE[determination.outcome].border}`}>
                  {(() => { const S = DETERMINATION_STYLE[determination.outcome]; return (
                    <div className="flex items-center gap-4">
                      <div className="p-3 rounded-xl bg-white/70 shrink-0">
                        <S.Icon className={`h-8 w-8 ${S.text}`} />
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-1">Computed Level of Care — {applicant.name}</p>
                        <h2 className={`text-xl font-semibold leading-tight ${S.text}`}>{determination.label}</h2>
                      </div>
                    </div>
                  ); })()}
                  <p className="mt-4 text-sm text-slate-700 bg-white/70 rounded-lg p-3 border border-white">{determination.detail}</p>
                  <div className="mt-3">
                    <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Driving factors</p>
                    <ul className="space-y-0.5">
                      {determination.drivers.map((d) => (
                        <li key={d} className="text-xs text-slate-600 flex items-center gap-1.5">
                          <ChevronRight className="h-3 w-3 text-slate-500" /> {d}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                {admError && (
                  <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">Not saved: {admError}</div>
                )}

                {/* Refer-out path */}
                {(determination.outcome === 'refer-up' || determination.outcome === 'refer-out') && !overrideLevel && (
                  <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
                    <p className="text-sm text-slate-600">
                      Document the referral out, or override the recommendation with clinical justification if the
                      determination doesn&apos;t reflect the full picture.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={handleReferOut}
                        disabled={admBusy}
                        className={buttonClasses({ size: 'lg' })}
                      >
                        <FileText className="h-4 w-4" /> {admBusy ? 'Saving…' : 'Document Referral Out'}
                      </button>
                      {determination.outcome === 'refer-out' && (
                        <>
                          <button onClick={() => setOverrideLevel('3.1')} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border-2 border-sky-200 text-sky-700 text-sm font-semibold hover:bg-sky-50">
                            Override: Admit to 3.1
                          </button>
                          <button onClick={() => setOverrideLevel('3.5')} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border-2 border-rose-200 text-rose-700 text-sm font-semibold hover:bg-rose-50">
                            Override: Admit to 3.5
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}

                {/* Admission path (qualified, or override chosen) */}
                {finalLevel && (
                  <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
                    {/* Level confirm / override */}
                    <div>
                      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Confirm Level of Care</p>
                      <div className="flex gap-2">
                        {(['3.5', '3.1'] as const).map((lv) => (
                          <button
                            key={lv}
                            onClick={() => { setOverrideLevel(lv === recommendedLevel ? '' : lv); setBedChoice(''); }}
                            className={`flex-1 py-2.5 rounded-lg border-2 text-sm font-semibold transition-all ${
                              finalLevel === lv
                                ? lv === '3.5' ? 'bg-rose-600 border-rose-600 text-white' : 'bg-sky-700 border-sky-700 text-white'
                                : 'border-slate-200 text-slate-500 hover:border-slate-300'
                            }`}
                          >
                            ASAM {lv} {recommendedLevel === lv && <span className="text-[11px] font-semibold opacity-80">(recommended)</span>}
                          </button>
                        ))}
                      </div>
                      {overrideActive && (
                        <div className="mt-2">
                          <textarea
                            value={overrideReason}
                            onChange={(e) => setOverrideReason(e.target.value)}
                            rows={2}
                            placeholder="Required: clinical justification for overriding the computed recommendation…"
                            className="w-full rounded-lg border-2 border-amber-300 bg-amber-50 px-3 py-2 text-sm placeholder-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-500"
                          />
                        </div>
                      )}
                    </div>

                    {/* Payer / eligibility */}
                    <div className="bg-slate-50 border border-slate-100 rounded-lg p-3 flex flex-wrap items-center gap-3">
                      <Shield className="h-4 w-4 text-blue-500 shrink-0" />
                      <p className="text-xs text-slate-600 flex-1">
                        <strong>Payer:</strong> {applicant.payer || 'Not recorded'} — run{' '}
                        <a href="/dashboard/ehr/eligibility" className="text-blue-600 font-semibold underline">eligibility</a> and start{' '}
                        <a href="/dashboard/ehr/prior-auths" className="text-blue-600 font-semibold underline">prior auth</a> for residential days.
                      </p>
                    </div>

                    {/* Bed + counselor */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                          Assign Bed — ASAM {finalLevel}
                          {occOf(finalLevel).open === null ? ' (beds not configured)' : ` (${occOf(finalLevel).open} open)`}
                        </p>
                        {bedsFull(finalLevel) ? (
                          <p className="text-xs text-amber-700 font-semibold flex items-center gap-1.5">
                            <Hourglass className="h-3.5 w-3.5" /> No open beds in {finalLevel} — use the waitlist below.
                          </p>
                        ) : !hasRoomList(finalLevel) ? (
                          <input
                            value={bedChoice}
                            onChange={(e) => setBedChoice(e.target.value)}
                            placeholder="Room / bed (e.g. B-201)"
                            maxLength={40}
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                          />
                        ) : openRooms(finalLevel).length ? (
                          <div className="flex flex-wrap gap-1.5">
                            {openRooms(finalLevel).map((room) => (
                              <button
                                key={room}
                                onClick={() => setBedChoice(room)}
                                className={`px-3 py-2 rounded-lg border-2 text-xs font-semibold transition-all ${
                                  bedChoice === room ? 'bg-blue-600 border-blue-600 text-white' : 'border-slate-200 text-slate-600 hover:border-slate-300'
                                }`}
                              >
                                {room}
                              </button>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-amber-700 font-semibold flex items-center gap-1.5">
                            <Hourglass className="h-3.5 w-3.5" /> No open beds in {finalLevel} — use the waitlist below.
                          </p>
                        )}
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Primary Counselor</p>
                        <select
                          value={counselorChoice}
                          onChange={(e) => setCounselorChoice(e.target.value)}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                        >
                          <option value="">Unassigned</option>
                          {COUNSELORS.map((c) => (
                            <option key={c}>{c}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Admission clock preview */}
                    <div className="bg-sky-50 border border-sky-100 rounded-lg p-3">
                      <p className="text-[11px] font-semibold text-sky-700 uppercase tracking-wider mb-1">On admit, the task clock starts automatically</p>
                      <p className="text-xs text-sky-800">
                        Orientation ≤ 24 hrs · TB screen & C-SSRS baseline ≤ 24 hrs · Biopsychosocial ≤ 72 hrs · Initial
                        treatment plan ≤ 96 hrs · First continued-stay review in {finalLevel === '3.5' ? '7' : '30'} days.
                      </p>
                    </div>

                    <div className="flex flex-wrap justify-end gap-2">
                      {bedsFull(finalLevel) && (
                        <button
                          onClick={() => void handleWaitlist()}
                          disabled={overrideActive && !overrideReason.trim()}
                          className={buttonClasses({ variant: 'secondary', size: 'lg' })}
                        >
                          <Hourglass className="h-4 w-4" /> Add to Waitlist
                        </button>
                      )}
                      <button
                        onClick={handleAdmit}
                        disabled={admBusy || !bedChoice || (overrideActive && !overrideReason.trim())}
                        title={!bedChoice ? 'Select a bed' : overrideActive && !overrideReason.trim() ? 'Override justification required' : ''}
                        className={buttonClasses({ size: 'lg' })}
                      >
                        <BedDouble className="h-4 w-4" /> {admBusy ? 'Admitting…' : `Admit to ASAM ${finalLevel}`}
                      </button>
                    </div>
                  </div>
                )}

                <div className="flex justify-start">
                  <button
                    onClick={() => setAdmStep(gateTriggered ? 2 : 3)}
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-slate-100 text-slate-700 rounded-lg font-semibold text-sm hover:bg-slate-200"
                  >
                    <ChevronLeft className="h-4 w-4" /> Back
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Right rail — live recommendation, waitlist, determination log */}
          <div className="space-y-4">
            {/* Live recommendation panel */}
            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
              <h3 className="text-sm font-semibold mb-3 text-slate-900 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-blue-600" aria-hidden /> Live Recommendation
              </h3>
              {determination ? (
                <>
                  <p className={`text-sm font-semibold mb-1 ${
                    determination.outcome === '3.5' ? 'text-rose-700' : determination.outcome === '3.1' ? 'text-sky-800' : determination.outcome === 'refer-up' ? 'text-rose-700' : 'text-emerald-800'
                  }`}>
                    {determination.label}
                  </p>
                  <ul className="space-y-1 mt-2">
                    {determination.drivers.map((d) => (
                      <li key={d} className="text-[11px] text-slate-500 flex gap-1.5">
                        <ChevronRight className="h-3 w-3 shrink-0 mt-0.5" /> {d}
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="text-xs text-slate-500">
                  Updates in real time as gates and dimensions are answered. {gatesAnswered ? `${dims.filter((d) => d !== null).length}/6 dimensions rated.` : 'Awaiting safety gates.'}
                </p>
              )}
              <div className="mt-3 pt-3 border-t border-white/10 space-y-1.5 text-[11px] text-slate-500">
                <p className="flex gap-1.5"><span className="text-rose-600 font-semibold shrink-0">3.5</span> High relapse potential + significant co-occurring severity or low readiness → 24-hr structure.</p>
                <p className="flex gap-1.5"><span className="text-sky-700 font-semibold shrink-0">3.1</span> Stable dims 1–3, unsupportive environment or moderate relapse risk → supportive structure.</p>
                <p className="flex gap-1.5"><span className="text-rose-600 font-semibold shrink-0">Up</span> Severe dim 1/2/3 or any gate → medical / inpatient referral.</p>
                <p className="flex gap-1.5"><span className="text-emerald-700 font-semibold shrink-0">Out</span> Low severity profile → outpatient / IOP referral.</p>
              </div>
            </div>

            {/* Waitlist */}
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <h3 className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2">
                <Hourglass className="h-4 w-4 text-amber-700" /> Waitlist
              </h3>
              {waitlist.length === 0 ? (
                <p className="text-xs text-slate-500">No one waiting.</p>
              ) : (
                <div className="space-y-2">
                  {waitlist.map((w, i) => (
                    <div key={i} className="flex items-center gap-2.5 p-2.5 rounded-lg bg-amber-50 border border-amber-100">
                      <div className="w-7 h-7 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center text-[11px] font-semibold shrink-0">
                        {initials(w.name)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-slate-800">{w.name}</p>
                        <p className="text-[11px] text-slate-500">ASAM {w.program} · {w.payer} · since {w.date}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Determination log — CARF record of admissions AND non-admissions */}
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <h3 className="text-sm font-semibold text-slate-700 mb-1 flex items-center gap-2">
                <FileText className="h-4 w-4 text-blue-500" /> Determination Log
              </h3>
              <p className="text-[11px] text-slate-500 mb-2.5">
                CARF expects a record of everyone screened — admitted or not — with the determination and where
                non-admissions were directed.
              </p>
              <div className="space-y-2">
                {determinationLoadError && <p className="text-xs text-rose-600">{determinationLoadError}</p>}
                {determinationLog.length === 0 && !determinationLoadError && <p className="text-xs text-slate-500">No screenings recorded yet.</p>}
                {determinationLog.map((d, i) => (
                  <div key={i} className="text-xs border-b border-slate-50 last:border-0 pb-2 last:pb-0">
                    <p className="font-semibold text-slate-800">{d.name} <span className="text-slate-500 font-normal">· {d.date}</span></p>
                    <p className="text-slate-500">{d.outcome}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================
          TAB — RESIDENTS ROSTER
      =================================================================== */}
      {tab === 'residents' && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-600 bg-slate-50 border-b border-slate-200">
                  <th scope="col" className="sticky left-0 z-10 bg-slate-50 px-5 py-2.5 font-semibold">Resident</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Program</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Admitted / LOS</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Phase</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Counselor</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Tx Plan</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Open Items</th>
                </tr>
              </thead>
              <tbody>
                {residents.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-5 py-8 text-center text-xs text-slate-500">
                      No residents yet.
                    </td>
                  </tr>
                )}
                {residents.map((r) => {
                  const tp = TXPLAN_BADGE[r.txPlanStatus];
                  const openItems = assessmentRows.filter((a) => a.residentId === r.id && a.status !== 'complete');
                  return (
                    <tr key={r.id} className="group border-b border-slate-50 last:border-0 hover:bg-slate-50">
                      <td className="sticky left-0 z-10 bg-white px-5 py-3 group-hover:bg-slate-50">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-full bg-blue-50 text-blue-700 flex items-center justify-center text-xs font-semibold shrink-0">
                            {initials(r.name)}
                          </div>
                          <div>
                            <p className="font-semibold text-slate-900 text-xs">{r.name}</p>
                            <p className="text-[11px] text-slate-500">Room {r.room}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${r.program === '3.5' ? 'bg-rose-100 text-rose-700' : 'bg-sky-100 text-sky-700'}`}>
                          ASAM {r.program}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-xs text-slate-600">{r.admitDate}<span className="text-slate-500"> · {r.losDays}d</span></td>
                      <td className="px-3 py-3 text-xs text-slate-600">{r.phase}</td>
                      <td className="px-3 py-3 text-xs text-slate-600">{r.counselor}</td>
                      <td className="px-3 py-3">
                        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${tp.cls}`}>{tp.label}</span>
                      </td>
                      <td className="px-3 py-3">
                        {openItems.length ? (
                          <button
                            onClick={() => { setDueFilter('all'); setTab('assessments'); }}
                            className={`text-xs font-semibold ${openItems.some((o) => o.status === 'overdue') ? 'text-rose-600' : 'text-amber-700'} hover:underline`}
                          >
                            {openItems.length} due <ChevronRight className="inline h-3 w-3" aria-hidden />
                          </button>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
                            <CheckCircle2 className="h-3.5 w-3.5" /> Clear
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ===================================================================
          TAB — ASSESSMENTS DUE
      =================================================================== */}
      {tab === 'assessments' && (
        <div className="space-y-4">
          {taskError && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">Not saved: {taskError}</div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {([
              { id: 'all', label: `Open (${assessmentRows.filter((a) => a.status !== 'complete').length})` },
              { id: 'overdue', label: `Overdue (${overdueCount})` },
              { id: 'due', label: `Due Soon (${dueCount})` },
              { id: 'upcoming', label: 'Upcoming' },
              { id: 'complete', label: 'Completed' },
            ] as { id: 'all' | DueStatus; label: string }[]).map((f) => (
              <button
                key={f.id}
                onClick={() => setDueFilter(f.id)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                  dueFilter === f.id ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
                }`}
              >
                {f.label}
              </button>
            ))}
            <p className="ml-auto text-[11px] text-slate-500 hidden sm:block">
              Due dates auto-computed from admission date, ASAM level cadence & prior completions
            </p>
          </div>

          <div className="space-y-2.5">
            {filteredRows.length === 0 && (
              <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-sm text-slate-500">
                <CheckCircle2 className="h-6 w-6 text-emerald-700 mx-auto mb-2" />
                Nothing here — all caught up.
              </div>
            )}
            {filteredRows.map((a) => {
              const r = residentById(a.residentId);
              if (!r) return null;
              const badge = DUE_BADGE[a.status];
              return (
                <React.Fragment key={a.id}>
                <div
                  className={`bg-white rounded-xl border-2 p-4 flex flex-col sm:flex-row sm:items-center gap-3 ${
                    a.status === 'overdue' ? 'border-rose-200' : 'border-slate-200'
                  }`}
                >
                  <div className="w-9 h-9 rounded-full bg-blue-50 text-blue-700 flex items-center justify-center text-xs font-semibold shrink-0">
                    {initials(r.name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-slate-900">{a.name}</p>
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${badge.cls}`}>{badge.label}</span>
                      <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded-full ${r.program === '3.5' ? 'bg-rose-100 text-rose-700' : 'bg-sky-100 text-sky-700'}`}>
                        {r.name} · ASAM {r.program}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">{a.why}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs font-semibold text-slate-700 flex items-center gap-1 justify-end">
                      <CalendarDays className="h-3.5 w-3.5 text-slate-500" /> {a.due}
                    </p>
                    <p className={`text-[11px] font-semibold ${a.daysLeft < 0 ? 'text-rose-600' : a.daysLeft <= 3 ? 'text-amber-700' : 'text-slate-500'}`}>
                      {a.status === 'complete' ? 'Done' : a.daysLeft < 0 ? `${-a.daysLeft} days overdue` : a.daysLeft === 0 ? 'Due today' : `in ${a.daysLeft} days`}
                    </p>
                  </div>
                  {a.status !== 'complete' && (
                    <div className="flex flex-wrap gap-2 shrink-0">
                      {a.name.includes('Continued-Stay') && (
                        <button
                          onClick={() => draftCsr(a, r)}
                          className={buttonClasses({ size: 'sm' })}
                        >
                          <Sparkles className="h-3.5 w-3.5" /> AI Draft
                        </button>
                      )}
                      {a.href && (
                        <a
                          href={a.href}
                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 text-white text-xs font-semibold hover:bg-brand-700"
                        >
                          Start Now <ChevronRight className="h-3.5 w-3.5" />
                        </a>
                      )}
                      {persistableTask(a) ? (
                        <button
                          onClick={() => markTaskDone(a, r.program)}
                          disabled={taskBusyId !== null}
                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 text-slate-600 text-xs font-semibold hover:bg-emerald-100 hover:text-emerald-700 disabled:opacity-50"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" /> {taskBusyId === a.id ? 'Saving…' : a.id.endsWith('-plan') ? 'Confirm Plan Signed' : 'Mark Done'}
                        </button>
                      ) : (
                        <span className="inline-flex items-center px-2 py-2 text-[11px] text-slate-500" title="This task is tracked through the assessment itself — complete it in the chart.">
                          Complete in chart
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* AI continued-stay review draft panel */}
                {csrDraftRow === a.id && (
                  <div className="bg-white rounded-xl border-2 border-slate-200 p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Sparkles className="h-4 w-4 text-blue-500" />
                      <p className="text-sm font-semibold text-slate-700 flex-1">AI Continued-Stay Review Draft — {r.name}</p>
                      <span className="text-[11px] font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
                        AWS Bedrock · AI draft
                      </span>
                      <button onClick={() => setCsrDraftRow('')} className="p-1 rounded text-slate-500 hover:bg-slate-100" aria-label="Close draft">
                        <XCircle className="h-4 w-4" />
                      </button>
                    </div>
                    {csrLoading ? (
                      <p className="text-sm text-slate-500 italic py-4 text-center">
                        Reviewing this resident&apos;s shift notes and treatment plan status…
                      </p>
                    ) : csrError ? (
                      <p className="text-sm text-rose-600 py-4 text-center">No draft: {csrError}</p>
                    ) : (
                      <>
                        <textarea
                          value={csrDraftText}
                          onChange={(e) => setCsrDraftText(e.target.value)}
                          rows={10}
                          className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-mono text-slate-700 leading-relaxed focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <div className="mt-2 flex flex-wrap items-center gap-3">
                          <a
                            href={a.href ?? '/dashboard/ehr/locus'}
                            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700"
                          >
                            Open ASAM Review to File <ChevronRight className="h-3.5 w-3.5" />
                          </a>
                          <p className="text-[11px] text-slate-500">
                            AI-drafted medical-necessity justification — the clinician reviews, edits, and signs it in the
                            ASAM review. A current review is what keeps this resident&apos;s per-diem billing unblocked.
                          </p>
                        </div>
                      </>
                    )}
                  </div>
                )}
                </React.Fragment>
              );
            })}
          </div>
        </div>
      )}

      {/* ===================================================================
          TAB — SMART DOCUMENTATION (shift notes)
      =================================================================== */}
      {tab === 'notes' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 space-y-4">
            <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                    <User className="inline h-3.5 w-3.5 mr-1 -mt-0.5" /> Resident
                  </label>
                  <select
                    value={noteResident}
                    onChange={(e) => { setNoteResident(e.target.value); setNoteSaved(false); }}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                  >
                    <option value="">Select resident…</option>
                    {residents.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name} — ASAM {r.program} · Room {r.room}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                    <Clock className="inline h-3.5 w-3.5 mr-1 -mt-0.5" /> Shift
                  </label>
                  <div className="flex gap-1.5">
                    {SHIFTS.map((s) => (
                      <button
                        key={s}
                        onClick={() => { setNoteShift(s); setNoteSaved(false); }}
                        className={`flex-1 px-2 py-2 rounded-lg border-2 text-xs font-semibold transition-all ${
                          noteShift === s ? 'bg-sky-700 border-sky-700 text-white' : 'border-slate-200 text-slate-500 hover:border-slate-300'
                        }`}
                      >
                        {s.split(' ')[1]}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {NOTE_CHIPS.map((g) => (
                <div key={g.group}>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">{g.group}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {g.options.map((o) => (
                      <button
                        key={o}
                        onClick={() => toggleChip(o)}
                        className={`px-2.5 py-1.5 rounded-full text-[11px] font-medium border transition-all ${
                          chips.includes(o)
                            ? 'bg-sky-700 border-sky-700 text-white'
                            : 'border-slate-200 text-slate-500 hover:border-sky-200 hover:bg-sky-50'
                        }`}
                      >
                        {o}
                      </button>
                    ))}
                  </div>
                </div>
              ))}

              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Additional Observations (optional)</p>
                <textarea
                  value={noteExtra}
                  onChange={(e) => { setNoteExtra(e.target.value); setNoteSaved(false); }}
                  rows={2}
                  placeholder="Anything the chips don't capture…"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>
            </div>

            <div className="bg-white rounded-xl border-2 border-sky-200 p-5">
              <h3 className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-sky-700" /> Auto-Drafted Narrative
                <span className="ml-auto text-[11px] font-semibold text-sky-700 bg-sky-50 px-2 py-0.5 rounded-full">built from your selections — edit freely</span>
              </h3>
              <div className="rounded-lg bg-slate-50 border border-slate-100 p-3 min-h-[72px] text-sm text-slate-700 leading-relaxed">
                {narrative || <span className="text-slate-500 italic">Pick a resident and tap chips — the compliant narrative writes itself here.</span>}
              </div>

              <div className="mt-3 space-y-1.5">
                {[
                  { ok: !!resident, label: 'Resident identified' },
                  { ok: goalChipPicked, label: 'Ties to a treatment-plan goal (pick a Recovery Work chip)' },
                  { ok: chips.some((c) => NOTE_CHIPS[3].options.includes(c)), label: 'Safety/milieu status documented' },
                ].map((c) => (
                  <p key={c.label} className={`text-[11px] flex items-center gap-1.5 ${c.ok ? 'text-emerald-700' : 'text-slate-500'}`}>
                    {c.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />} {c.label}
                  </p>
                ))}
              </div>

              <label className="mt-3 flex items-start gap-2.5 cursor-pointer select-none rounded-lg border border-slate-200 p-3 hover:border-slate-300">
                <input
                  type="checkbox"
                  checked={noteSigned}
                  onChange={(e) => setNoteSigned(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded text-sky-700 focus:ring-sky-500"
                />
                <span className="text-xs text-slate-600 leading-relaxed">
                  I attest this note is accurate, was completed during or immediately after the shift, and reflects
                  services tied to the resident&apos;s individualized plan. Electronic signature & timestamp applied on save.
                </span>
              </label>

              <div className="mt-3 flex justify-end gap-2">
                <button
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-100 text-slate-700 text-sm font-semibold hover:bg-slate-200"
                >
                  <Printer className="h-4 w-4" /> Print
                </button>
                {noteSaved ? (
                  <span className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold">
                    <CheckCircle2 className="h-4 w-4" /> Saved to Chart
                  </span>
                ) : (
                  <button
                    onClick={async () => {
                      if (!resident || !goalChipPicked || !noteSigned || noteBusy) return;
                      setNoteBusy(true);
                      setNoteError(null);
                      try {
                        const res = await fetch('/api/residential/shift-notes', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            residentId: resident.id,
                            shift: noteShift,
                            // Only what staff picked: Safety & Milieu chips, and Medications chips.
                            milieu: chips.filter((c) => NOTE_CHIPS[3].options.includes(c)).join('; ') || 'Not documented',
                            adherence: chips.filter((c) => NOTE_CHIPS[2].options.includes(c)).join('; ') || 'Not documented',
                            notes: narrative,
                          }),
                        });
                        const data = await res.json().catch(() => null);
                        if (!res.ok || !data?.success) throw new Error(data?.error || `Save failed (${res.status})`);
                        setNoteSaved(true);
                      } catch (e: unknown) {
                        setNoteError(e instanceof Error ? e.message : 'Save failed');
                      } finally {
                        setNoteBusy(false);
                      }
                    }}
                    disabled={!resident || !goalChipPicked || !noteSigned || noteBusy}
                    title={!resident ? 'Select a resident' : !goalChipPicked ? 'Pick at least one Recovery Work chip' : !noteSigned ? 'Signature required' : ''}
                    className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-sky-700 text-white text-sm font-semibold hover:bg-sky-800 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Save className="h-4 w-4" /> {noteBusy ? 'Saving…' : 'Sign & Save'}
                  </button>
                )}
                {noteError && <span className="text-xs text-rose-600">Not saved: {noteError}</span>}
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
              <h3 className="text-sm font-semibold mb-3 text-slate-900 flex items-center gap-2">
                <Shield className="h-4 w-4 text-blue-600" aria-hidden /> Why This Stays Compliant
              </h3>
              <ul className="space-y-2.5 text-xs text-slate-600">
                <li className="flex gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-700 shrink-0 mt-0.5" /> Every note must reference a treatment-plan goal before it can be signed — no orphan documentation.</li>
                <li className="flex gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-700 shrink-0 mt-0.5" /> Safety & milieu status is required each shift, creating the 24-hr supervision record residential surveys look for.</li>
                <li className="flex gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-700 shrink-0 mt-0.5" /> Chips standardize language across staff while the narrative stays editable and person-centered.</li>
                <li className="flex gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-700 shrink-0 mt-0.5" /> Signature + timestamp + audit log on save; records lock for QI review.</li>
              </ul>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <h3 className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2">
                <FileText className="h-4 w-4 text-blue-500" /> Other Documentation
              </h3>
              <div className="space-y-1.5">
                {[
                  { label: 'Progress Notes (clinical)', href: '/dashboard/ehr/notes' },
                  { label: 'Group Session Notes', href: '/dashboard/ehr/group-sessions' },
                  { label: 'Treatment Plans', href: '/dashboard/ehr/treatment-plans' },
                  { label: 'Incident Reports', href: '/dashboard/incidents' },
                  { label: 'Discharge / Transition Planning', href: '/dashboard/ehr/discharge' },
                ].map((l) => (
                  <a key={l.href} href={l.href} className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-blue-700">
                    <ChevronRight className="h-3.5 w-3.5 text-slate-500" /> {l.label}
                  </a>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================
          TAB — CARF PROGRAM REQUIREMENTS
      =================================================================== */}
      {tab === 'carf' && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {CARF_PROGRAM_REQS.map((area) => {
              const done = area.items.filter((i) => i.done).length;
              return (
                <div key={area.area} className="bg-white rounded-xl border border-slate-200 p-5">
                  <div className="flex items-center gap-2.5 mb-3">
                    <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                      <area.Icon className="h-4 w-4" />
                    </div>
                    <h3 className="text-sm font-semibold text-slate-800 flex-1">{area.area}</h3>
                    <span className={`text-xs font-semibold ${done === area.items.length ? 'text-emerald-700' : 'text-amber-700'}`}>
                      {done}/{area.items.length}
                    </span>
                  </div>
                  <div className="space-y-2.5">
                    {area.items.map((item) => (
                      <div key={item.label} className="flex gap-2.5">
                        {item.done ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-700 shrink-0 mt-0.5" />
                        ) : (
                          <AlertTriangle className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" />
                        )}
                        <div>
                          <p className={`text-sm font-medium ${item.done ? 'text-slate-700' : 'text-slate-800'}`}>{item.label}</p>
                          <p className="text-[11px] text-slate-500">{item.detail}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                  <Flame className="h-4 w-4 text-rose-600" /> Emergency Drill Log
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">Evacuation drills required on each shift, each quarter — plus annual severe-weather & medical-emergency drills.</p>
              </div>
              {/* No drill data store exists yet — never record a drill that staff did not enter. */}
              <button
                type="button"
                disabled
                title="Not connected yet: emergency drills have no data store. Keep the paper drill log until this is built."
                className="ml-auto inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-300 text-white text-xs font-semibold cursor-not-allowed"
              >
                <Plus className="h-3.5 w-3.5" /> Log Drill (not available yet)
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-600 bg-slate-50 border-b border-slate-200">
                    <th scope="col" className="px-5 py-2.5 font-semibold">Date</th>
                    <th scope="col" className="px-3 py-2.5 font-semibold">Drill Type</th>
                    <th scope="col" className="px-3 py-2.5 font-semibold">Shift</th>
                    <th scope="col" className="px-3 py-2.5 font-semibold">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {drills.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-5 py-8 text-center text-xs text-slate-500">
                        No drills logged yet.
                      </td>
                    </tr>
                  )}
                  {drills.map((d, i) => (
                    <tr key={i} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                      <td className="px-5 py-3 text-xs text-slate-700 font-medium">{d.date}</td>
                      <td className="px-3 py-3 text-xs text-slate-600">{d.type}</td>
                      <td className="px-3 py-3 text-xs text-slate-600">{d.shift}</td>
                      <td className="px-3 py-3">
                        <span className={`inline-flex items-center gap-1 text-xs font-semibold ${d.result === 'pass' ? 'text-emerald-700' : 'text-amber-700'}`}>
                          {d.result === 'pass' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                          {d.result === 'pass' ? 'Pass' : 'Needs follow-up'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h3 className="text-sm font-semibold text-slate-700 mb-3">CARF Residential — How This Module Conforms</h3>
              <ul className="space-y-2.5 text-sm text-slate-600">
                {[
                  ['Screening & admission criteria', 'Exclusionary gates plus the ASAM six-dimension assessment apply admission criteria consistently; every determination — admit, waitlist, or refer out — is logged with its rationale.'],
                  ['Individualized, person-centered planning', 'Initial plan due within 96 hrs; review cycles surface on the bed board and in Assessments Due.'],
                  ['Medical necessity & continued stay', 'Continued-stay reviews auto-scheduled by level — every 7 days for 3.5, every 30 days for 3.1.'],
                  ['24-hour milieu documentation', 'Shift notes required each shift with safety status — the smart builder makes the compliant note the fastest note.'],
                  ['Health, safety & emergency preparedness', 'Drill log by shift and quarter, self-inspections, med-room checks — gaps surface before the surveyor finds them.'],
                  ['Rights & orientation of persons served', 'Orientation within 24 hrs tracked per admission; community-meeting input documented monthly.'],
                  ['Transition & discharge planning', 'Transition-prep phase triggers discharge-readiness and aftercare tasks; step-down 3.5 → 3.1 is tracked.'],
                  ['Performance measurement & improvement', 'Occupancy, LOS, overdue rates and drill compliance feed the QI dashboard.'],
                ].map(([title, body]) => (
                  <li key={title} className="flex gap-2.5">
                    <BadgeCheck className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
                    <span><strong className="text-slate-800">{title}.</strong> {body}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-[11px] text-slate-500">
                Map items to your current CARF Behavioral Health standards manual (residential program designation) during
                survey prep — numbering varies by manual year.
              </p>
            </div>

            <div className="space-y-4">
              <div className="bg-white rounded-xl border border-slate-200 p-5">
                <h3 className="text-sm font-semibold text-slate-700 mb-3">Survey Readiness — Residential</h3>
                {(
                  [
                    {
                      label: 'Assessments completed on time (90-day)',
                      pct: assessmentRows.length ? Math.round((assessmentRows.filter((a) => a.status !== 'overdue').length / assessmentRows.length) * 100) : null,
                    },
                    // No expected-shift schedule exists to measure against: not tracked, never 0%
                    { label: 'Shift documentation completeness', pct: null },
                    { label: 'Drill schedule conformance', pct: drillCompliance },
                    {
                      label: 'Orientation within 24 hrs of admission',
                      pct: residents.length ? Math.round((residents.filter((r) => r.orientationDone).length / residents.length) * 100) : null,
                    },
                    {
                      label: 'Treatment plan reviews current',
                      pct: residents.length ? Math.round((residents.filter((r) => r.txPlanStatus === 'current').length / residents.length) * 100) : null,
                    },
                  ] as Array<{ label: string; pct: number | null }>
                ).map((m) => (
                  <div key={m.label} className="mb-3 last:mb-0">
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-slate-600 font-medium">{m.label}</span>
                      {m.pct == null ? (
                        <span className="font-semibold text-slate-500">—</span>
                      ) : (
                        <span className={`font-semibold ${m.pct >= 90 ? 'text-emerald-700' : 'text-amber-700'}`}>{m.pct}%</span>
                      )}
                    </div>
                    <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                      {m.pct != null ? (
                        <div className={`h-full rounded-full ${m.pct >= 90 ? 'bg-emerald-500' : 'bg-amber-500'}`} style={{ width: `${m.pct}%` }} />
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex gap-3">
                <TrendingUp className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
                <p className="text-sm text-blue-800">
                  Exceptions flow into <a href="/dashboard/qi" className="font-semibold underline">Quality Improvement</a>,
                  critical events into <a href="/dashboard/incidents" className="font-semibold underline">Incident Reports</a>,
                  and training gaps into the <a href="/dashboard/hr/training" className="font-semibold underline">Training Hub</a> —
                  keeping the CARF performance-improvement loop closed.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </Page>
  );
}
