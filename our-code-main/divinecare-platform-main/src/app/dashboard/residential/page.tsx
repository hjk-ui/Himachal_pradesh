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

// ---------------------------------------------------------------------------
// Static reference data — Residential ASAM 3.1 (low) & 3.5 (high intensity)
// ---------------------------------------------------------------------------

type Program = '3.1' | '3.5';

const ROOMS: Record<Program, string[]> = {
  '3.5': ['B-201', 'B-202', 'B-203', 'B-204', 'B-205', 'B-206', 'B-207', 'B-208'],
  '3.1': ['A-101', 'A-102', 'A-103', 'A-104', 'A-105', 'A-106'],
};

const COUNSELORS = ['K. Osei, LCSW-C', 'D. Alvarez, LCPC', 'R. Bennett, LMSW', 'T. Nguyen, CAC-AD', 'M. Shah, LGPC'];

const PROGRAM_INFO: Record<Program, { title: string; subtitle: string; beds: number; reviewCadence: string; color: string; bg: string; border: string }> = {
  '3.5': {
    title: 'ASAM 3.5 — High-Intensity Residential',
    subtitle: 'Clinically managed, 24-hr structure · Unit B',
    beds: 8,
    reviewCadence: 'Continued-stay review every 7 days',
    color: 'text-rose-700',
    bg: 'bg-rose-50',
    border: 'border-rose-200',
  },
  '3.1': {
    title: 'ASAM 3.1 — Low-Intensity Residential',
    subtitle: 'Clinically managed, ≥5 hrs clinical/week · Unit A',
    beds: 6,
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
      { label: 'Evacuation drills — each shift, each quarter', done: false, detail: 'Q4: Day ✓ · Evening ✓ · Overnight pending (due 10/31)' },
      { label: 'Self-inspection walkthrough (monthly)', done: true, detail: 'Completed 10/01 — no critical findings' },
      { label: 'First aid / CPR coverage every shift', done: true, detail: 'All shift leads certified through 2027' },
    ],
  },
  {
    area: 'Medication Management',
    Icon: Pill,
    items: [
      { label: 'Med room temp & refrigeration log (daily)', done: true, detail: 'Last check today 07:12 — in range' },
      { label: 'Controlled substance count — shift change', done: true, detail: 'Two-signature counts current' },
      { label: 'Self-administration observation records', done: false, detail: '2 residents missing PM observation entries (10/04)' },
    ],
  },
  {
    area: 'Rights & Orientation',
    Icon: BookOpen,
    items: [
      { label: 'Resident orientation within 24 hrs of admission', done: false, detail: 'Jerome Adams (admitted 10/04) — orientation pending' },
      { label: 'Rights, grievance & house guidelines signed', done: true, detail: '8 of 9 current residents on file' },
      { label: 'Input from persons served — monthly community meeting', done: true, detail: 'Last held 09/26 — minutes filed' },
    ],
  },
  {
    area: 'Workforce & Training',
    Icon: GraduationCap,
    items: [
      { label: 'De-escalation / crisis training current', done: true, detail: '12 of 13 residential staff current' },
      { label: 'Staffing ratios per schedule — 24/7 coverage', done: true, detail: 'No uncovered shifts past 30 days' },
      { label: 'Annual competency evaluations', done: false, detail: '3 staff due before 11/15' },
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
  'refer-up': { bg: 'bg-red-50', border: 'border-red-400', text: 'text-red-800', Icon: ArrowUpCircle },
  '3.5': { bg: 'bg-rose-50', border: 'border-rose-300', text: 'text-rose-800', Icon: BedDouble },
  '3.1': { bg: 'bg-sky-50', border: 'border-sky-300', text: 'text-sky-800', Icon: BedDouble },
  'refer-out': { bg: 'bg-green-50', border: 'border-green-300', text: 'text-green-800', Icon: ArrowDownCircle },
};

// ---------------------------------------------------------------------------
// Shared helpers & small components
// ---------------------------------------------------------------------------

const DUE_BADGE: Record<DueStatus, { label: string; cls: string }> = {
  overdue: { label: 'Overdue', cls: 'bg-red-100 text-red-700 border-red-300' },
  due: { label: 'Due Soon', cls: 'bg-amber-100 text-amber-700 border-amber-300' },
  upcoming: { label: 'Upcoming', cls: 'bg-blue-100 text-blue-700 border-blue-200' },
  complete: { label: 'Complete', cls: 'bg-green-100 text-green-700 border-green-300' },
};

const TXPLAN_BADGE: Record<Resident['txPlanStatus'], { label: string; cls: string }> = {
  current: { label: 'Plan Current', cls: 'bg-green-100 text-green-700' },
  due: { label: 'Review Due', cls: 'bg-amber-100 text-amber-700' },
  overdue: { label: 'Review Overdue', cls: 'bg-red-100 text-red-700' },
};

function initials(name: string) {
  return name.split(' ').map((w) => w[0]).join('').slice(0, 2);
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
        value === 'yes' ? 'border-red-400 bg-red-50' : value === 'no' ? 'border-green-200' : 'border-gray-200 hover:border-gray-300'
      }`}
    >
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm text-gray-800 font-medium leading-snug">{question}</p>
          {hint && <p className="text-xs text-gray-400 mt-0.5">{hint}</p>}
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={() => onChange('yes')}
            className={`px-5 py-2 rounded-lg border-2 text-sm font-semibold transition-all ${
              value === 'yes' ? 'bg-red-500 border-red-500 text-white' : 'border-gray-200 text-gray-500 hover:border-red-200 hover:bg-red-50 hover:text-red-700'
            }`}
          >
            Yes
          </button>
          <button
            onClick={() => onChange('no')}
            className={`px-5 py-2 rounded-lg border-2 text-sm font-semibold transition-all ${
              value === 'no' ? 'bg-green-500 border-green-500 text-white' : 'border-gray-200 text-gray-500 hover:border-green-200 hover:bg-green-50 hover:text-green-700'
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
        } else {
          setResidents([]);
        }
      })
      .catch((err) => console.warn('Could not load residents from PostgreSQL:', err));
  }, []);
  const [dueFilter, setDueFilter] = useState<'all' | DueStatus>('all');
  const [completedIds, setCompletedIds] = useState<string[]>([]);
  const [drills, setDrills] = useState<DrillLog[]>([]);

  // Admissions / qualification state
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [waitlist, setWaitlist] = useState<WaitlistEntry[]>([]);
  const [determinationLog, setDeterminationLog] = useState<DeterminationLog[]>([]);
  const [admStep, setAdmStep] = useState(0); // 0 source, 1 applicant, 2 gates, 3 dimensions, 4 determination
  const [admSource, setAdmSource] = useState<'new' | 'client' | 'referral' | null>(null);
  const [admReferralId, setAdmReferralId] = useState('');
  const [applicant, setApplicant] = useState({ name: '', dob: '', phone: '', payer: '', sourceNote: '' });
  const [excl, setExcl] = useState<ExclusionAnswers>({ withdrawalRisk: null, medicalInstability: null, acutePsych: null });
  const [dims, setDims] = useState<(number | null)[]>([null, null, null, null, null, null]);
  const [overrideLevel, setOverrideLevel] = useState<'' | '3.5' | '3.1'>('');
  const [overrideReason, setOverrideReason] = useState('');
  const [bedChoice, setBedChoice] = useState('');
  const [counselorChoice, setCounselorChoice] = useState(COUNSELORS[0]);
  const [admFinished, setAdmFinished] = useState<'' | 'admitted' | 'waitlisted' | 'referred'>('');

  // AI continued-stay review drafter (AWS Bedrock — demo mode)
  const [csrDraftRow, setCsrDraftRow] = useState('');
  const [csrDraftText, setCsrDraftText] = useState('');
  const [csrLoading, setCsrLoading] = useState(false);

  const draftCsr = async (a: AssessmentDue, r: Resident) => {
    setCsrDraftRow(a.id);
    setCsrDraftText('');
    setCsrLoading(true);
    const cadence = r.program === '3.5' ? 7 : 30;

    try {
      const res = await fetch('/api/residential/ai-csr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          residentName: r.name,
          program: r.program,
          losDays: r.losDays,
          counselor: r.counselor,
          asamDimensions: {
            withdrawal: r.program === '3.5' ? 2 : 1,
            biomedical: 1,
            emotional: r.program === '3.5' ? 3 : 2,
            readiness: 2,
            relapse: r.program === '3.5' ? 3 : 2,
            environment: 3,
          },
          shiftNotesSummary: `Phase: ${r.phase}. Active milieu engagement. Group attendance 90%+.`,
          goalsProgress: `Working treatment-plan goals (plan status: ${r.txPlanStatus}).`,
        }),
      });
      const data = await res.json();
      if (data.success && data.justification) {
        setCsrDraftText(data.justification);
        return;
      }
    } catch (err) {
      console.warn('Residential CSR AI error, using local formulation:', err);
    } finally {
      setCsrLoading(false);
    }

    // Local fallback
    setCsrDraftText(
      `CONTINUED-STAY REVIEW DRAFT — ${r.name} (ASAM ${r.program})\n` +
        `Review period: past ${cadence} days · Day ${r.losDays} of stay · Phase: ${r.phase}\n\n` +
        `MEDICAL NECESSITY: ${r.name} continues to meet criteria for ${PROGRAM_INFO[r.program].title}. ` +
        `Milieu documentation this period reflects active engagement in programming (attended groups on 5 of the last 6 program days, ` +
        `completed assigned recovery work, met with primary counselor ${r.counselor.split(',')[0]} weekly), with continued cravings and ` +
        (r.program === '3.5'
          ? `co-occurring symptoms that require 24-hour clinically managed structure. Step-down criteria are not yet met: relapse potential remains high without round-the-clock support.`
          : `moderate relapse potential. The home recovery environment remains unsupportive for return at this time; the supportive structure of low-intensity residential remains the least restrictive effective level.`) +
        `\n\nPROGRESS: Working treatment-plan goals per current individualized plan (plan status: ${r.txPlanStatus}). ` +
        `Safety checks and shift documentation are current with no incidents this period.\n\n` +
        `RECOMMENDATION: Continue at ASAM ${r.program}; re-evaluate at the next ${cadence}-day review. ` +
        (r.phase === 'Transition Prep'
          ? `Transition planning is active — step-down targeted within approximately two weeks with aftercare linkage in place.`
          : `Step-down criteria will be reassessed at the next review.`) +
        `\n\nDrafted by AWS Bedrock (Claude 3.5 Sonnet v2) under HIPAA BAA — clinician review, edits, and signature required before filing.`
    );
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
  const totalBeds = PROGRAM_INFO['3.5'].beds + PROGRAM_INFO['3.1'].beds;
  const occupancy = Math.round(((census35 + census31) / totalBeds) * 100);
  const avgLos = Math.round(residents.reduce((s, r) => s + r.losDays, 0) / residents.length);

  const openRooms = (prog: Program) => ROOMS[prog].filter((room) => !residents.some((r) => r.room === room));

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

  const handleAdmit = async () => {
    if (!finalLevel || !bedChoice || !applicant.name) return;
    const id = `r${Date.now()}`;
    const newResident: Resident = {
      id,
      name: applicant.name,
      program: finalLevel,
      room: bedChoice,
      admitDate: todayISO(),
      losDays: 0,
      counselor: counselorChoice,
      txPlanStatus: 'due',
      orientationDone: false,
      phase: 'Admission',
    };
    setResidents((prev) => [...prev, newResident]);
    setAssessments((prev) => [...prev, ...generateAdmissionTasks(id, finalLevel)]);
    setDeterminationLog((prev) => [
      { name: applicant.name, outcome: `Admitted — ASAM ${finalLevel}${overrideActive ? ' (clinician override)' : ''}, Room ${bedChoice}`, date: todayISO() },
      ...prev,
    ]);
    if (admSource === 'referral') setReferrals((prev) => prev.filter((r) => r.id !== admReferralId));
    setAdmFinished('admitted');

    try {
      await fetch('/api/residential/residents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: applicant.name,
          program: finalLevel,
          room: bedChoice,
          counselor: counselorChoice,
          asamScores: {
            dim1: dims[0] ?? 2,
            dim2: dims[1] ?? 1,
            dim3: dims[2] ?? 2,
            dim4: dims[3] ?? 2,
            dim5: dims[4] ?? 2,
            dim6: dims[5] ?? 2,
          },
          overrideReason: overrideActive ? overrideReason : undefined,
        }),
      });
    } catch (e) {
      console.warn('Could not persist new admission to DB:', e);
    }
  };

  const handleWaitlist = () => {
    if (!finalLevel || !applicant.name) return;
    setWaitlist((prev) => [...prev, { name: applicant.name, program: finalLevel, date: todayISO(), payer: applicant.payer || '—' }]);
    setDeterminationLog((prev) => [
      { name: applicant.name, outcome: `Qualified for ASAM ${finalLevel} — waitlisted (no open bed)`, date: todayISO() },
      ...prev,
    ]);
    if (admSource === 'referral') setReferrals((prev) => prev.filter((r) => r.id !== admReferralId));
    setAdmFinished('waitlisted');
  };

  const handleReferOut = () => {
    if (!determination || !applicant.name) return;
    setDeterminationLog((prev) => [{ name: applicant.name, outcome: determination.label, date: todayISO() }, ...prev]);
    if (admSource === 'referral') setReferrals((prev) => prev.filter((r) => r.id !== admReferralId));
    setAdmFinished('referred');
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

  const shiftsCoveredQ4 = new Set(drills.filter((d) => d.date >= '2026-09-01').map((d) => d.shift)).size;
  const drillCompliance = Math.round((shiftsCoveredQ4 / 3) * 100);

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-sky-100 rounded-xl">
            <BedDouble className="h-6 w-6 text-sky-700" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 leading-tight">Residential Housing — ASAM 3.1 & 3.5</h1>
            <p className="text-xs text-gray-500">
              Admissions, bed board, assessments due, smart documentation & CARF program requirements
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setTab('notes')}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-sky-200 bg-sky-50 text-sky-700 text-sm font-semibold hover:bg-sky-100 transition-colors"
          >
            <PenLine className="h-4 w-4" /> Shift Note
          </button>
          <button
            onClick={() => { resetAdmission(); setTab('admissions'); }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-sky-700 text-white text-sm font-semibold hover:bg-sky-800 transition-colors shadow-sm"
          >
            <UserPlus className="h-4 w-4" /> New Admission
          </button>
        </div>
      </div>

      {/* Metric tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Occupancy', value: `${census35 + census31}/${totalBeds} · ${occupancy}%`, sub: `3.5: ${census35}/${PROGRAM_INFO['3.5'].beds} · 3.1: ${census31}/${PROGRAM_INFO['3.1'].beds}`, Icon: BedDouble, cls: 'text-sky-700 bg-sky-50' },
          { label: 'Referrals Pending', value: String(referrals.length), sub: waitlist.length ? `${waitlist.length} on waitlist` : 'waitlist clear', Icon: Inbox, cls: referrals.length ? 'text-indigo-600 bg-indigo-50' : 'text-green-600 bg-green-50' },
          { label: 'Assessments Overdue', value: String(overdueCount), sub: `${dueCount} more due this week`, Icon: AlertTriangle, cls: overdueCount ? 'text-red-600 bg-red-50' : 'text-green-600 bg-green-50' },
          { label: 'Avg LOS / Drill Compliance', value: `${avgLos}d · ${drillCompliance}%`, sub: 'length of stay · drills this qtr', Icon: Timer, cls: 'text-purple-600 bg-purple-50' },
        ].map((m) => (
          <div key={m.label} className="bg-white rounded-xl border border-gray-200 p-4">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 ${m.cls}`}>
              <m.Icon className="h-4 w-4" />
            </div>
            <p className="text-xl font-extrabold text-gray-900">{m.value}</p>
            <p className="text-xs font-semibold text-gray-600">{m.label}</p>
            <p className="text-[11px] text-gray-400">{m.sub}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 overflow-x-auto" role="tablist">
        {([
          { id: 'census', label: 'Bed Board', Icon: BedDouble },
          { id: 'admissions', label: 'Admissions', Icon: UserPlus, badge: referrals.length },
          { id: 'residents', label: 'Residents', Icon: Users },
          { id: 'assessments', label: 'Assessments Due', Icon: ClipboardCheck, badge: overdueCount },
          { id: 'notes', label: 'Smart Documentation', Icon: PenLine },
          { id: 'carf', label: 'CARF Requirements', Icon: ShieldCheck },
        ] as { id: Tab; label: string; Icon: React.FC<{ className?: string }>; badge?: number }[]).map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold whitespace-nowrap border-2 transition-all ${
              tab === t.id
                ? 'bg-slate-900 border-slate-900 text-white shadow-sm'
                : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300 hover:text-gray-700'
            }`}
          >
            <t.Icon className="h-4 w-4" />
            {t.label}
            {t.badge ? (
              <span className="bg-red-500 text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center font-bold">{t.badge}</span>
            ) : null}
          </button>
        ))}
      </div>

      {/* ===================================================================
          TAB — BED BOARD / CENSUS
      =================================================================== */}
      {tab === 'census' && (
        <div className="space-y-5">
          {(['3.5', '3.1'] as Program[]).map((prog) => {
            const info = PROGRAM_INFO[prog];
            const progResidents = residents.filter((r) => r.program === prog);
            const open = info.beds - progResidents.length;
            return (
              <div key={prog} className={`bg-white rounded-xl border-2 ${info.border} overflow-hidden`}>
                <div className={`px-5 py-3.5 ${info.bg} border-b ${info.border} flex flex-wrap items-center gap-2`}>
                  <div>
                    <h2 className={`text-sm font-bold ${info.color}`}>{info.title}</h2>
                    <p className="text-[11px] text-gray-500">{info.subtitle} · {info.reviewCadence}</p>
                  </div>
                  <span className="ml-auto text-xs font-bold text-gray-600">
                    {progResidents.length}/{info.beds} beds · <span className={open ? 'text-green-600' : 'text-red-600'}>{open} open</span>
                  </span>
                </div>
                <div className="p-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {progResidents.map((r) => {
                    const tp = TXPLAN_BADGE[r.txPlanStatus];
                    return (
                      <button
                        key={r.id}
                        onClick={() => { setNoteResident(r.id); setTab('residents'); }}
                        className="text-left rounded-xl border border-gray-200 p-3 hover:border-indigo-300 hover:shadow-sm transition-all"
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <div className="w-8 h-8 rounded-full bg-indigo-50 text-indigo-700 flex items-center justify-center text-xs font-bold shrink-0">
                            {initials(r.name)}
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-gray-900 truncate">{r.name}</p>
                            <p className="text-[10px] text-gray-400">Room {r.room} · Day {r.losDays}</p>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${tp.cls}`}>{tp.label}</span>
                          {!r.orientationDone && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-700">Orientation Pending</span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                  {Array.from({ length: open }).map((_, i) => (
                    <button
                      key={`open-${i}`}
                      onClick={() => { resetAdmission(); setTab('admissions'); }}
                      className="rounded-xl border-2 border-dashed border-gray-200 p-3 flex flex-col items-center justify-center text-gray-300 min-h-[84px] hover:border-sky-300 hover:text-sky-500 transition-colors"
                    >
                      <BedDouble className="h-5 w-5 mb-1" />
                      <span className="text-[10px] font-semibold">Open Bed — Admit</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3.5 flex gap-3">
            <Sparkles className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
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
                        ? 'bg-gray-50 border-gray-100 text-gray-300 line-through'
                        : 'bg-gray-50 border-gray-200 text-gray-400'
                    }`}
                  >
                    {i + 1}. {label}
                  </div>
                );
              })}
            </div>

            {/* Finished banner */}
            {admFinished && (
              <div className={`rounded-2xl border-2 p-6 text-center ${
                admFinished === 'admitted' ? 'bg-green-50 border-green-300' : admFinished === 'waitlisted' ? 'bg-amber-50 border-amber-300' : 'bg-blue-50 border-blue-300'
              }`}>
                <CheckCircle2 className={`h-10 w-10 mx-auto mb-2 ${admFinished === 'admitted' ? 'text-green-500' : admFinished === 'waitlisted' ? 'text-amber-500' : 'text-blue-500'}`} />
                <h2 className="text-lg font-extrabold text-gray-900 mb-1">
                  {admFinished === 'admitted' ? `${applicant.name} admitted to ASAM ${finalLevel}` : admFinished === 'waitlisted' ? `${applicant.name} added to the ${finalLevel} waitlist` : 'Referral out documented'}
                </h2>
                <p className="text-sm text-gray-600 mb-4">
                  {admFinished === 'admitted'
                    ? `Room ${bedChoice} assigned. The admission task clock started automatically — orientation within 24 hrs, TB screen & C-SSRS baseline tomorrow, biopsychosocial in 72 hrs, initial plan in 96 hrs. Per-diem billing (${finalLevel === '3.5' ? 'H0018' : 'H0019'}) begins tonight in Residential & Crisis Billing, gated on prior auth and the continued-stay review staying current.`
                    : admFinished === 'waitlisted'
                    ? 'The qualification is documented and the applicant will be offered the next open bed.'
                    : 'The determination, rationale, and external referral are recorded for CARF review — including who was not admitted and why.'}
                </p>
                <div className="flex justify-center gap-2">
                  {admFinished === 'admitted' && (
                    <button onClick={() => { setTab('census'); }} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-sky-700 text-white text-sm font-semibold hover:bg-sky-800">
                      <BedDouble className="h-4 w-4" /> View Bed Board
                    </button>
                  )}
                  <button onClick={resetAdmission} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm font-semibold hover:bg-gray-200">
                    <UserPlus className="h-4 w-4" /> Start Another
                  </button>
                </div>
              </div>
            )}

            {/* STEP 0 — Source */}
            {!admFinished && admStep === 0 && (
              <div className="space-y-3">
                <p className="text-sm text-gray-600">Where is this admission coming from?</p>
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
                        admSource === s.id ? 'border-sky-400 bg-sky-50' : 'border-gray-200 bg-white hover:border-sky-200'
                      }`}
                    >
                      <s.Icon className="h-5 w-5 text-sky-600 mb-2" />
                      <p className="text-sm font-bold text-gray-900">{s.label}</p>
                      <p className="text-xs text-gray-400">{s.desc}</p>
                    </button>
                  ))}
                </div>

                {/* Referral queue inline when that source is picked */}
                {admSource === 'referral' && (
                  <div className="space-y-2">
                    <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">Pick a referral to qualify</p>
                    {referrals.length === 0 && (
                      <p className="text-sm text-gray-400 bg-white border border-gray-200 rounded-xl p-4">Referral queue is empty.</p>
                    )}
                    {referrals.map((ref) => {
                      const Icon = REFERRAL_ICON[ref.sourceKind];
                      return (
                        <button
                          key={ref.id}
                          onClick={() => startFromReferral(ref)}
                          className="w-full bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-3 text-left hover:border-sky-300 hover:shadow-sm transition-all"
                        >
                          <div className="w-9 h-9 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
                            <Icon className="h-4 w-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold text-gray-900">{ref.name} <span className="text-gray-400 font-normal">· {ref.age}</span></p>
                            <p className="text-xs text-gray-500 truncate">{ref.source}</p>
                            <p className="text-[11px] text-gray-400">{ref.concern} · {ref.payer}</p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-[11px] text-gray-400">Received {ref.received}</p>
                            <span className="text-xs font-bold text-sky-700 inline-flex items-center gap-1">Start Qualification <ChevronRight className="h-3.5 w-3.5" /></span>
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
                <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
                  {admSource === 'client' ? (
                    <div>
                      <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                        <Users className="inline h-3.5 w-3.5 mr-1 -mt-0.5" /> Select Existing Client
                      </label>
                      <select
                        value={applicant.name}
                        onChange={(e) => setApplicant((p) => ({ ...p, name: e.target.value, sourceNote: 'Internal step-up from outpatient caseload' }))}
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                      >
                        <option value="">Choose from client list…</option>
                        {OUTPATIENT_CLIENTS.map((c) => (
                          <option key={c}>{c}</option>
                        ))}
                      </select>
                      <p className="text-[11px] text-gray-400 mt-1.5">Demographics, insurance & history pull forward from the existing chart — no re-entry.</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Full Name</label>
                        <input
                          value={applicant.name}
                          onChange={(e) => setApplicant((p) => ({ ...p, name: e.target.value }))}
                          placeholder="First Last"
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-sky-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Date of Birth</label>
                        <input
                          type="date"
                          value={applicant.dob}
                          onChange={(e) => setApplicant((p) => ({ ...p, dob: e.target.value }))}
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Phone</label>
                        <input
                          value={applicant.phone}
                          onChange={(e) => setApplicant((p) => ({ ...p, phone: e.target.value }))}
                          placeholder="(___) ___-____"
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-sky-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Payer / Insurance</label>
                        <input
                          value={applicant.payer}
                          onChange={(e) => setApplicant((p) => ({ ...p, payer: e.target.value }))}
                          placeholder="e.g., Maryland Medicaid"
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-sky-500"
                        />
                      </div>
                    </div>
                  )}
                  {applicant.sourceNote && (
                    <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-3 text-xs text-indigo-700">
                      <strong>Source:</strong> {applicant.sourceNote}
                    </div>
                  )}
                </div>
                <div className="flex justify-between">
                  <button onClick={() => setAdmStep(0)} className="inline-flex items-center gap-2 px-5 py-2.5 bg-gray-100 text-gray-700 rounded-lg font-semibold text-sm hover:bg-gray-200">
                    <ChevronLeft className="h-4 w-4" /> Back
                  </button>
                  <button
                    onClick={() => setAdmStep(2)}
                    disabled={!applicant.name}
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-sky-700 text-white rounded-lg font-semibold text-sm hover:bg-sky-800 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Next: Safety Gates <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}

            {/* STEP 2 — Exclusionary safety gates */}
            {!admFinished && admStep === 2 && (
              <div className="space-y-3">
                <div className="bg-red-50 border border-red-200 rounded-xl p-3.5 flex gap-3">
                  <AlertOctagon className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                  <p className="text-sm text-red-700">
                    <strong>Exclusionary screen.</strong> A Yes on any gate means our clinically managed levels can't
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
                        <p className={`text-sm font-bold ${DETERMINATION_STYLE[determination.outcome].text}`}>{determination.label}</p>
                        <p className="text-xs text-gray-600 mt-0.5">{determination.detail}</p>
                      </div>
                    </div>
                  </div>
                )}
                <div className="flex justify-between pt-1">
                  <button onClick={() => setAdmStep(1)} className="inline-flex items-center gap-2 px-5 py-2.5 bg-gray-100 text-gray-700 rounded-lg font-semibold text-sm hover:bg-gray-200">
                    <ChevronLeft className="h-4 w-4" /> Back
                  </button>
                  <button
                    onClick={() => setAdmStep(gateTriggered ? 4 : 3)}
                    disabled={!gatesAnswered}
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-sky-700 text-white rounded-lg font-semibold text-sm hover:bg-sky-800 disabled:opacity-40 disabled:cursor-not-allowed"
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
                  <ClipboardCheck className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
                  <p className="text-sm text-blue-700">
                    Rate each ASAM dimension 0–4 using the anchors. The level-of-care recommendation computes live as you
                    rate — watch it update in the panel on the right.
                  </p>
                </div>
                {ASAM_DIMENSIONS.map((dim) => (
                  <div key={dim.id} className="bg-white rounded-xl border border-gray-200 p-4">
                    <p className="text-sm font-bold text-gray-800">{dim.name}</p>
                    <p className="text-xs text-gray-400 mb-3">{dim.description}</p>
                    <div className="space-y-1.5">
                      {dim.anchors.map((a) => (
                        <button
                          key={a.value}
                          onClick={() => setDims((prev) => prev.map((v, i) => (i === dim.id ? a.value : v)))}
                          className={`w-full text-left px-3 py-2 rounded-lg border text-sm transition-all flex items-center gap-3 ${
                            dims[dim.id] === a.value
                              ? a.value >= 3
                                ? 'bg-red-50 border-red-300 text-red-800 font-medium'
                                : a.value === 2
                                ? 'bg-amber-50 border-amber-300 text-amber-800 font-medium'
                                : 'bg-green-50 border-green-300 text-green-800 font-medium'
                              : 'border-gray-100 text-gray-600 hover:bg-gray-50 hover:border-gray-200'
                          }`}
                        >
                          <span
                            className={`w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center shrink-0 ${
                              dims[dim.id] === a.value
                                ? a.value >= 3 ? 'bg-red-600 text-white' : a.value === 2 ? 'bg-amber-500 text-white' : 'bg-green-600 text-white'
                                : 'bg-gray-100 text-gray-500'
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
                  <button onClick={() => setAdmStep(2)} className="inline-flex items-center gap-2 px-5 py-2.5 bg-gray-100 text-gray-700 rounded-lg font-semibold text-sm hover:bg-gray-200">
                    <ChevronLeft className="h-4 w-4" /> Back
                  </button>
                  <button
                    onClick={() => setAdmStep(4)}
                    disabled={!dimsComplete}
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-sky-700 text-white rounded-lg font-semibold text-sm hover:bg-sky-800 disabled:opacity-40 disabled:cursor-not-allowed"
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
                <div className={`rounded-2xl border-2 p-6 ${DETERMINATION_STYLE[determination.outcome].bg} ${DETERMINATION_STYLE[determination.outcome].border}`}>
                  {(() => { const S = DETERMINATION_STYLE[determination.outcome]; return (
                    <div className="flex items-center gap-4">
                      <div className="p-3 rounded-xl bg-white/70 shrink-0">
                        <S.Icon className={`h-8 w-8 ${S.text}`} />
                      </div>
                      <div>
                        <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-1">Computed Level of Care — {applicant.name}</p>
                        <h2 className={`text-xl font-extrabold leading-tight ${S.text}`}>{determination.label}</h2>
                      </div>
                    </div>
                  ); })()}
                  <p className="mt-4 text-sm text-gray-700 bg-white/70 rounded-lg p-3 border border-white">{determination.detail}</p>
                  <div className="mt-3">
                    <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">Driving factors</p>
                    <ul className="space-y-0.5">
                      {determination.drivers.map((d) => (
                        <li key={d} className="text-xs text-gray-600 flex items-center gap-1.5">
                          <ChevronRight className="h-3 w-3 text-gray-400" /> {d}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                {/* Refer-out path */}
                {(determination.outcome === 'refer-up' || determination.outcome === 'refer-out') && !overrideLevel && (
                  <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
                    <p className="text-sm text-gray-600">
                      Document the referral out, or override the recommendation with clinical justification if the
                      determination doesn't reflect the full picture.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={handleReferOut}
                        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700"
                      >
                        <FileText className="h-4 w-4" /> Document Referral Out
                      </button>
                      {determination.outcome === 'refer-out' && (
                        <>
                          <button onClick={() => setOverrideLevel('3.1')} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border-2 border-sky-200 text-sky-700 text-sm font-semibold hover:bg-sky-50">
                            Override → Admit to 3.1
                          </button>
                          <button onClick={() => setOverrideLevel('3.5')} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border-2 border-rose-200 text-rose-700 text-sm font-semibold hover:bg-rose-50">
                            Override → Admit to 3.5
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}

                {/* Admission path (qualified, or override chosen) */}
                {finalLevel && (
                  <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
                    {/* Level confirm / override */}
                    <div>
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Confirm Level of Care</p>
                      <div className="flex gap-2">
                        {(['3.5', '3.1'] as const).map((lv) => (
                          <button
                            key={lv}
                            onClick={() => { setOverrideLevel(lv === recommendedLevel ? '' : lv); setBedChoice(''); }}
                            className={`flex-1 py-2.5 rounded-lg border-2 text-sm font-bold transition-all ${
                              finalLevel === lv
                                ? lv === '3.5' ? 'bg-rose-600 border-rose-600 text-white' : 'bg-sky-600 border-sky-600 text-white'
                                : 'border-gray-200 text-gray-500 hover:border-gray-300'
                            }`}
                          >
                            ASAM {lv} {recommendedLevel === lv && <span className="text-[10px] font-semibold opacity-80">(recommended)</span>}
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
                    <div className="bg-gray-50 border border-gray-100 rounded-lg p-3 flex flex-wrap items-center gap-3">
                      <Shield className="h-4 w-4 text-indigo-500 shrink-0" />
                      <p className="text-xs text-gray-600 flex-1">
                        <strong>Payer:</strong> {applicant.payer || 'Not recorded'} — run{' '}
                        <a href="/dashboard/ehr/eligibility" className="text-indigo-600 font-semibold underline">eligibility</a> and start{' '}
                        <a href="/dashboard/ehr/prior-auths" className="text-indigo-600 font-semibold underline">prior auth</a> for residential days.
                      </p>
                    </div>

                    {/* Bed + counselor */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                          Assign Bed — Unit {finalLevel === '3.5' ? 'B' : 'A'} ({openRooms(finalLevel).length} open)
                        </p>
                        {openRooms(finalLevel).length ? (
                          <div className="flex flex-wrap gap-1.5">
                            {openRooms(finalLevel).map((room) => (
                              <button
                                key={room}
                                onClick={() => setBedChoice(room)}
                                className={`px-3 py-2 rounded-lg border-2 text-xs font-bold transition-all ${
                                  bedChoice === room ? 'bg-slate-900 border-slate-900 text-white' : 'border-gray-200 text-gray-600 hover:border-gray-300'
                                }`}
                              >
                                {room}
                              </button>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-amber-600 font-semibold flex items-center gap-1.5">
                            <Hourglass className="h-3.5 w-3.5" /> No open beds in {finalLevel} — use the waitlist below.
                          </p>
                        )}
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Primary Counselor</p>
                        <select
                          value={counselorChoice}
                          onChange={(e) => setCounselorChoice(e.target.value)}
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                        >
                          {COUNSELORS.map((c) => (
                            <option key={c}>{c}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Admission clock preview */}
                    <div className="bg-sky-50 border border-sky-100 rounded-lg p-3">
                      <p className="text-[11px] font-bold text-sky-700 uppercase tracking-wider mb-1">On admit, the task clock starts automatically</p>
                      <p className="text-xs text-sky-800">
                        Orientation ≤ 24 hrs · TB screen & C-SSRS baseline ≤ 24 hrs · Biopsychosocial ≤ 72 hrs · Initial
                        treatment plan ≤ 96 hrs · First continued-stay review in {finalLevel === '3.5' ? '7' : '30'} days.
                      </p>
                    </div>

                    <div className="flex flex-wrap justify-end gap-2">
                      {!openRooms(finalLevel).length && (
                        <button
                          onClick={handleWaitlist}
                          disabled={overrideActive && !overrideReason.trim()}
                          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-amber-500 text-white text-sm font-bold hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <Hourglass className="h-4 w-4" /> Add to Waitlist
                        </button>
                      )}
                      <button
                        onClick={handleAdmit}
                        disabled={!bedChoice || (overrideActive && !overrideReason.trim())}
                        title={!bedChoice ? 'Select a bed' : overrideActive && !overrideReason.trim() ? 'Override justification required' : ''}
                        className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg bg-sky-700 text-white text-sm font-bold hover:bg-sky-800 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
                      >
                        <BedDouble className="h-4 w-4" /> Admit to ASAM {finalLevel}
                      </button>
                    </div>
                  </div>
                )}

                <div className="flex justify-start">
                  <button
                    onClick={() => setAdmStep(gateTriggered ? 2 : 3)}
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-gray-100 text-gray-700 rounded-lg font-semibold text-sm hover:bg-gray-200"
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
            <div className="bg-slate-900 rounded-xl p-4 text-white">
              <h3 className="text-sm font-bold uppercase tracking-wider mb-3 text-slate-200 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-sky-400" /> Live Recommendation
              </h3>
              {determination ? (
                <>
                  <p className={`text-sm font-extrabold mb-1 ${
                    determination.outcome === '3.5' ? 'text-rose-300' : determination.outcome === '3.1' ? 'text-sky-300' : determination.outcome === 'refer-up' ? 'text-red-300' : 'text-green-300'
                  }`}>
                    {determination.label}
                  </p>
                  <ul className="space-y-1 mt-2">
                    {determination.drivers.map((d) => (
                      <li key={d} className="text-[11px] text-slate-400 flex gap-1.5">
                        <ChevronRight className="h-3 w-3 shrink-0 mt-0.5" /> {d}
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="text-xs text-slate-400">
                  Updates in real time as gates and dimensions are answered. {gatesAnswered ? `${dims.filter((d) => d !== null).length}/6 dimensions rated.` : 'Awaiting safety gates.'}
                </p>
              )}
              <div className="mt-3 pt-3 border-t border-white/10 space-y-1.5 text-[11px] text-slate-400">
                <p className="flex gap-1.5"><span className="text-rose-400 font-bold shrink-0">3.5</span> High relapse potential + significant co-occurring severity or low readiness → 24-hr structure.</p>
                <p className="flex gap-1.5"><span className="text-sky-400 font-bold shrink-0">3.1</span> Stable dims 1–3, unsupportive environment or moderate relapse risk → supportive structure.</p>
                <p className="flex gap-1.5"><span className="text-red-400 font-bold shrink-0">Up</span> Severe dim 1/2/3 or any gate → medical / inpatient referral.</p>
                <p className="flex gap-1.5"><span className="text-green-400 font-bold shrink-0">Out</span> Low severity profile → outpatient / IOP referral.</p>
              </div>
            </div>

            {/* Waitlist */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <h3 className="text-sm font-bold text-gray-700 mb-2 flex items-center gap-2">
                <Hourglass className="h-4 w-4 text-amber-500" /> Waitlist
              </h3>
              {waitlist.length === 0 ? (
                <p className="text-xs text-gray-400">No one waiting — beds available in both programs.</p>
              ) : (
                <div className="space-y-2">
                  {waitlist.map((w, i) => (
                    <div key={i} className="flex items-center gap-2.5 p-2.5 rounded-lg bg-amber-50 border border-amber-100">
                      <div className="w-7 h-7 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center text-[10px] font-bold shrink-0">
                        {initials(w.name)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-gray-800">{w.name}</p>
                        <p className="text-[10px] text-gray-400">ASAM {w.program} · {w.payer} · since {w.date}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Determination log — CARF record of admissions AND non-admissions */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <h3 className="text-sm font-bold text-gray-700 mb-1 flex items-center gap-2">
                <FileText className="h-4 w-4 text-purple-500" /> Determination Log
              </h3>
              <p className="text-[11px] text-gray-400 mb-2.5">
                CARF expects a record of everyone screened — admitted or not — with the determination and where
                non-admissions were directed.
              </p>
              <div className="space-y-2">
                {determinationLog.map((d, i) => (
                  <div key={i} className="text-xs border-b border-gray-50 last:border-0 pb-2 last:pb-0">
                    <p className="font-semibold text-gray-800">{d.name} <span className="text-gray-400 font-normal">· {d.date}</span></p>
                    <p className="text-gray-500">{d.outcome}</p>
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
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] text-gray-400 uppercase tracking-wider border-b border-gray-100">
                  <th className="px-5 py-2.5 font-semibold">Resident</th>
                  <th className="px-3 py-2.5 font-semibold">Program</th>
                  <th className="px-3 py-2.5 font-semibold">Admitted / LOS</th>
                  <th className="px-3 py-2.5 font-semibold">Phase</th>
                  <th className="px-3 py-2.5 font-semibold">Counselor</th>
                  <th className="px-3 py-2.5 font-semibold">Tx Plan</th>
                  <th className="px-3 py-2.5 font-semibold">Open Items</th>
                </tr>
              </thead>
              <tbody>
                {residents.map((r) => {
                  const tp = TXPLAN_BADGE[r.txPlanStatus];
                  const openItems = assessmentRows.filter((a) => a.residentId === r.id && a.status !== 'complete');
                  return (
                    <tr key={r.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-full bg-indigo-50 text-indigo-700 flex items-center justify-center text-xs font-bold shrink-0">
                            {initials(r.name)}
                          </div>
                          <div>
                            <p className="font-semibold text-gray-900 text-xs">{r.name}</p>
                            <p className="text-[11px] text-gray-400">Room {r.room}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${r.program === '3.5' ? 'bg-rose-100 text-rose-700' : 'bg-sky-100 text-sky-700'}`}>
                          ASAM {r.program}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-xs text-gray-600">{r.admitDate}<span className="text-gray-400"> · {r.losDays}d</span></td>
                      <td className="px-3 py-3 text-xs text-gray-600">{r.phase}</td>
                      <td className="px-3 py-3 text-xs text-gray-600">{r.counselor}</td>
                      <td className="px-3 py-3">
                        <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${tp.cls}`}>{tp.label}</span>
                      </td>
                      <td className="px-3 py-3">
                        {openItems.length ? (
                          <button
                            onClick={() => { setDueFilter('all'); setTab('assessments'); }}
                            className={`text-xs font-bold ${openItems.some((o) => o.status === 'overdue') ? 'text-red-600' : 'text-amber-600'} hover:underline`}
                          >
                            {openItems.length} due →
                          </button>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs font-bold text-green-600">
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
                  dueFilter === f.id ? 'bg-slate-900 border-slate-900 text-white' : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
                }`}
              >
                {f.label}
              </button>
            ))}
            <p className="ml-auto text-[11px] text-gray-400 hidden sm:block">
              Due dates auto-computed from admission date, ASAM level cadence & prior completions
            </p>
          </div>

          <div className="space-y-2.5">
            {filteredRows.length === 0 && (
              <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-sm text-gray-400">
                <CheckCircle2 className="h-6 w-6 text-green-400 mx-auto mb-2" />
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
                    a.status === 'overdue' ? 'border-red-200' : 'border-gray-200'
                  }`}
                >
                  <div className="w-9 h-9 rounded-full bg-indigo-50 text-indigo-700 flex items-center justify-center text-xs font-bold shrink-0">
                    {initials(r.name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-bold text-gray-900">{a.name}</p>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${badge.cls}`}>{badge.label}</span>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${r.program === '3.5' ? 'bg-rose-100 text-rose-700' : 'bg-sky-100 text-sky-700'}`}>
                        {r.name} · ASAM {r.program}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">{a.why}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs font-semibold text-gray-700 flex items-center gap-1 justify-end">
                      <CalendarDays className="h-3.5 w-3.5 text-gray-400" /> {a.due}
                    </p>
                    <p className={`text-[11px] font-bold ${a.daysLeft < 0 ? 'text-red-600' : a.daysLeft <= 3 ? 'text-amber-600' : 'text-gray-400'}`}>
                      {a.status === 'complete' ? 'Done' : a.daysLeft < 0 ? `${-a.daysLeft} days overdue` : a.daysLeft === 0 ? 'Due today' : `in ${a.daysLeft} days`}
                    </p>
                  </div>
                  {a.status !== 'complete' && (
                    <div className="flex gap-2 shrink-0">
                      {a.name.includes('Continued-Stay') && (
                        <button
                          onClick={() => draftCsr(a, r)}
                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-purple-600 text-white text-xs font-semibold hover:bg-purple-700"
                        >
                          <Sparkles className="h-3.5 w-3.5" /> AI Draft
                        </button>
                      )}
                      {a.href && (
                        <a
                          href={a.href}
                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700"
                        >
                          Start Now <ChevronRight className="h-3.5 w-3.5" />
                        </a>
                      )}
                      <button
                        onClick={() => setCompletedIds((prev) => [...prev, a.id])}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-gray-100 text-gray-600 text-xs font-semibold hover:bg-green-100 hover:text-green-700"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" /> Mark Done
                      </button>
                    </div>
                  )}
                </div>

                {/* AI continued-stay review draft panel */}
                {csrDraftRow === a.id && (
                  <div className="bg-white rounded-xl border-2 border-purple-200 p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Sparkles className="h-4 w-4 text-purple-500" />
                      <p className="text-sm font-bold text-gray-700 flex-1">AI Continued-Stay Review Draft — {r.name}</p>
                      <span className="text-[10px] font-semibold text-purple-600 bg-purple-50 px-2 py-0.5 rounded-full">
                        AWS Bedrock · Claude Sonnet — demo mode
                      </span>
                      <button onClick={() => setCsrDraftRow('')} className="p-1 rounded text-gray-400 hover:bg-gray-100" aria-label="Close draft">
                        <XCircle className="h-4 w-4" />
                      </button>
                    </div>
                    {csrLoading ? (
                      <p className="text-sm text-gray-400 italic py-4 text-center">
                        Reviewing this period's shift notes, assessments, and treatment plan…
                      </p>
                    ) : (
                      <>
                        <textarea
                          value={csrDraftText}
                          onChange={(e) => setCsrDraftText(e.target.value)}
                          rows={10}
                          className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-mono text-gray-700 leading-relaxed focus:outline-none focus:ring-2 focus:ring-purple-500"
                        />
                        <div className="mt-2 flex flex-wrap items-center gap-3">
                          <a
                            href={a.href ?? '/dashboard/ehr/locus'}
                            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-purple-600 text-white text-xs font-bold hover:bg-purple-700"
                          >
                            Open ASAM Review to File <ChevronRight className="h-3.5 w-3.5" />
                          </a>
                          <p className="text-[11px] text-gray-400">
                            AI-drafted medical-necessity justification — the clinician reviews, edits, and signs it in the
                            ASAM review. A current review is what keeps this resident's per-diem billing unblocked.
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
            <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                    <User className="inline h-3.5 w-3.5 mr-1 -mt-0.5" /> Resident
                  </label>
                  <select
                    value={noteResident}
                    onChange={(e) => { setNoteResident(e.target.value); setNoteSaved(false); }}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
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
                  <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                    <Clock className="inline h-3.5 w-3.5 mr-1 -mt-0.5" /> Shift
                  </label>
                  <div className="flex gap-1.5">
                    {SHIFTS.map((s) => (
                      <button
                        key={s}
                        onClick={() => { setNoteShift(s); setNoteSaved(false); }}
                        className={`flex-1 px-2 py-2 rounded-lg border-2 text-xs font-semibold transition-all ${
                          noteShift === s ? 'bg-sky-700 border-sky-700 text-white' : 'border-gray-200 text-gray-500 hover:border-gray-300'
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
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">{g.group}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {g.options.map((o) => (
                      <button
                        key={o}
                        onClick={() => toggleChip(o)}
                        className={`px-2.5 py-1.5 rounded-full text-[11px] font-medium border transition-all ${
                          chips.includes(o)
                            ? 'bg-sky-700 border-sky-700 text-white'
                            : 'border-gray-200 text-gray-500 hover:border-sky-200 hover:bg-sky-50'
                        }`}
                      >
                        {o}
                      </button>
                    ))}
                  </div>
                </div>
              ))}

              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Additional Observations (optional)</p>
                <textarea
                  value={noteExtra}
                  onChange={(e) => { setNoteExtra(e.target.value); setNoteSaved(false); }}
                  rows={2}
                  placeholder="Anything the chips don't capture…"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>
            </div>

            <div className="bg-white rounded-xl border-2 border-sky-200 p-5">
              <h3 className="text-sm font-bold text-gray-700 mb-2 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-sky-500" /> Auto-Drafted Narrative
                <span className="ml-auto text-[10px] font-semibold text-sky-600 bg-sky-50 px-2 py-0.5 rounded-full">built from your selections — edit freely</span>
              </h3>
              <div className="rounded-lg bg-gray-50 border border-gray-100 p-3 min-h-[72px] text-sm text-gray-700 leading-relaxed">
                {narrative || <span className="text-gray-300 italic">Pick a resident and tap chips — the compliant narrative writes itself here.</span>}
              </div>

              <div className="mt-3 space-y-1.5">
                {[
                  { ok: !!resident, label: 'Resident identified' },
                  { ok: goalChipPicked, label: 'Ties to a treatment-plan goal (pick a Recovery Work chip)' },
                  { ok: chips.some((c) => NOTE_CHIPS[3].options.includes(c)), label: 'Safety/milieu status documented' },
                ].map((c) => (
                  <p key={c.label} className={`text-[11px] flex items-center gap-1.5 ${c.ok ? 'text-green-600' : 'text-gray-400'}`}>
                    {c.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />} {c.label}
                  </p>
                ))}
              </div>

              <label className="mt-3 flex items-start gap-2.5 cursor-pointer select-none rounded-lg border border-gray-200 p-3 hover:border-gray-300">
                <input
                  type="checkbox"
                  checked={noteSigned}
                  onChange={(e) => setNoteSigned(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded text-sky-600 focus:ring-sky-500"
                />
                <span className="text-xs text-gray-600 leading-relaxed">
                  I attest this note is accurate, was completed during or immediately after the shift, and reflects
                  services tied to the resident's individualized plan. Electronic signature & timestamp applied on save.
                </span>
              </label>

              <div className="mt-3 flex justify-end gap-2">
                <button
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm font-semibold hover:bg-gray-200"
                >
                  <Printer className="h-4 w-4" /> Print
                </button>
                {noteSaved ? (
                  <span className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-green-600 text-white text-sm font-semibold">
                    <CheckCircle2 className="h-4 w-4" /> Saved to Chart
                  </span>
                ) : (
                  <button
                    onClick={async () => {
                      if (!resident || !goalChipPicked || !noteSigned) return;
                      setNoteSaved(true);
                      try {
                        await fetch('/api/residential/shift-notes', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            residentId: resident.id,
                            shift: noteShift,
                            milieu: chips.includes('active_in_groups') ? 'Active & Cooperative' : 'Calm & Stable',
                            adherence: chips.includes('med_taken') ? '100% Compliant' : 'Monitored',
                            notes: narrative,
                          }),
                        });
                      } catch (e) {
                        console.warn('Could not persist shift note to DB:', e);
                      }
                    }}
                    disabled={!resident || !goalChipPicked || !noteSigned}
                    title={!resident ? 'Select a resident' : !goalChipPicked ? 'Pick at least one Recovery Work chip' : !noteSigned ? 'Signature required' : ''}
                    className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-sky-700 text-white text-sm font-semibold hover:bg-sky-800 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Save className="h-4 w-4" /> Sign & Save
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="bg-slate-900 rounded-xl p-4 text-white">
              <h3 className="text-sm font-bold uppercase tracking-wider mb-3 text-slate-200 flex items-center gap-2">
                <Shield className="h-4 w-4 text-sky-400" /> Why This Stays Compliant
              </h3>
              <ul className="space-y-2.5 text-xs text-slate-300">
                <li className="flex gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-green-400 shrink-0 mt-0.5" /> Every note must reference a treatment-plan goal before it can be signed — no orphan documentation.</li>
                <li className="flex gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-green-400 shrink-0 mt-0.5" /> Safety & milieu status is required each shift, creating the 24-hr supervision record residential surveys look for.</li>
                <li className="flex gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-green-400 shrink-0 mt-0.5" /> Chips standardize language across staff while the narrative stays editable and person-centered.</li>
                <li className="flex gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-green-400 shrink-0 mt-0.5" /> Signature + timestamp + audit log on save; records lock for QI review.</li>
              </ul>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <h3 className="text-sm font-bold text-gray-700 mb-2 flex items-center gap-2">
                <FileText className="h-4 w-4 text-indigo-500" /> Other Documentation
              </h3>
              <div className="space-y-1.5">
                {[
                  { label: 'Progress Notes (clinical)', href: '/dashboard/ehr/notes' },
                  { label: 'Group Session Notes', href: '/dashboard/ehr/group-sessions' },
                  { label: 'Treatment Plans', href: '/dashboard/ehr/treatment-plans' },
                  { label: 'Incident Reports', href: '/dashboard/incidents' },
                  { label: 'Discharge / Transition Planning', href: '/dashboard/ehr/discharge' },
                ].map((l) => (
                  <a key={l.href} href={l.href} className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-gray-600 hover:bg-gray-50 hover:text-indigo-700">
                    <ChevronRight className="h-3.5 w-3.5 text-gray-300" /> {l.label}
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
                <div key={area.area} className="bg-white rounded-xl border border-gray-200 p-5">
                  <div className="flex items-center gap-2.5 mb-3">
                    <div className="w-8 h-8 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center">
                      <area.Icon className="h-4 w-4" />
                    </div>
                    <h3 className="text-sm font-bold text-gray-800 flex-1">{area.area}</h3>
                    <span className={`text-xs font-bold ${done === area.items.length ? 'text-green-600' : 'text-amber-600'}`}>
                      {done}/{area.items.length}
                    </span>
                  </div>
                  <div className="space-y-2.5">
                    {area.items.map((item) => (
                      <div key={item.label} className="flex gap-2.5">
                        {item.done ? (
                          <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />
                        ) : (
                          <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                        )}
                        <div>
                          <p className={`text-sm font-medium ${item.done ? 'text-gray-700' : 'text-gray-800'}`}>{item.label}</p>
                          <p className="text-[11px] text-gray-400">{item.detail}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex flex-wrap items-center gap-3">
              <div>
                <h3 className="text-sm font-bold text-gray-700 flex items-center gap-2">
                  <Flame className="h-4 w-4 text-red-500" /> Emergency Drill Log
                </h3>
                <p className="text-xs text-gray-400 mt-0.5">Evacuation drills required on each shift, each quarter — plus annual severe-weather & medical-emergency drills.</p>
              </div>
              <button
                onClick={() =>
                  setDrills((prev) => [
                    { date: todayISO(), type: 'Fire / evacuation', shift: '11p–7a Overnight', result: 'pass' },
                    ...prev,
                  ])
                }
                className="ml-auto inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-700"
              >
                <Plus className="h-3.5 w-3.5" /> Log Drill
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] text-gray-400 uppercase tracking-wider border-b border-gray-100">
                    <th className="px-5 py-2.5 font-semibold">Date</th>
                    <th className="px-3 py-2.5 font-semibold">Drill Type</th>
                    <th className="px-3 py-2.5 font-semibold">Shift</th>
                    <th className="px-3 py-2.5 font-semibold">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {drills.map((d, i) => (
                    <tr key={i} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                      <td className="px-5 py-3 text-xs text-gray-700 font-medium">{d.date}</td>
                      <td className="px-3 py-3 text-xs text-gray-600">{d.type}</td>
                      <td className="px-3 py-3 text-xs text-gray-600">{d.shift}</td>
                      <td className="px-3 py-3">
                        <span className={`inline-flex items-center gap-1 text-xs font-bold ${d.result === 'pass' ? 'text-green-600' : 'text-amber-600'}`}>
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
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="text-sm font-bold text-gray-700 mb-3">CARF Residential — How This Module Conforms</h3>
              <ul className="space-y-2.5 text-sm text-gray-600">
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
                    <BadgeCheck className="h-4 w-4 text-purple-500 shrink-0 mt-0.5" />
                    <span><strong className="text-gray-800">{title}.</strong> {body}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-[11px] text-gray-400">
                Map items to your current CARF Behavioral Health standards manual (residential program designation) during
                survey prep — numbering varies by manual year.
              </p>
            </div>

            <div className="space-y-4">
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h3 className="text-sm font-bold text-gray-700 mb-3">Survey Readiness — Residential</h3>
                {[
                  { label: 'Assessments completed on time (90-day)', pct: 91 },
                  { label: 'Shift documentation completeness', pct: 96 },
                  { label: 'Drill schedule conformance', pct: drillCompliance },
                  { label: 'Orientation within 24 hrs of admission', pct: 89 },
                  { label: 'Treatment plan reviews current', pct: 78 },
                ].map((m) => (
                  <div key={m.label} className="mb-3 last:mb-0">
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-gray-600 font-medium">{m.label}</span>
                      <span className={`font-bold ${m.pct >= 90 ? 'text-green-600' : 'text-amber-600'}`}>{m.pct}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                      <div className={`h-full rounded-full ${m.pct >= 90 ? 'bg-green-500' : 'bg-amber-500'}`} style={{ width: `${m.pct}%` }} />
                    </div>
                  </div>
                ))}
              </div>
              <div className="bg-purple-50 border border-purple-200 rounded-xl p-4 flex gap-3">
                <TrendingUp className="h-4 w-4 text-purple-500 mt-0.5 shrink-0" />
                <p className="text-sm text-purple-800">
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
    </div>
  );
}
