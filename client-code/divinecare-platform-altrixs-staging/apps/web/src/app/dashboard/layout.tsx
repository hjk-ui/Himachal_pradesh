'use client';
import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import OfflineBanner from '../../components/OfflineBanner';
import {
  LayoutDashboard, Users, AlertTriangle, CalendarDays, MessageSquare,
  Video, Activity, FileText, ClipboardList, ClipboardCheck, BarChart3, Microscope,
  Pill, PenLine, Shield, ShieldCheck, Lock, Mic, Bot, Receipt, TrendingUp, BookOpen,
  Puzzle, Building2, CreditCard, Building, Settings, Globe, Megaphone,
  ChevronDown, LogOut, RefreshCw, Bell, Menu, X, Stethoscope, Clock, GraduationCap,
  CheckSquare, ChevronRight, Circle, BarChart2, XCircle, Star, Share2,
  Zap, DollarSign, Sparkles, UserCheck, ShieldAlert, ScanSearch, Database,
  FlaskConical, TrendingDown, ReceiptText, CalendarPlus, Target,
  Search, ArrowRight, User, Command, Phone, UserPlus, ArrowLeftRight, Siren, BedDouble, Scale,
} from 'lucide-react';
import { useAuth, UserRole, ROLE_CONFIG, DEMO_USERS } from '../../hooks/useAuth';
import AltrixsLogo from '../../components/AltrixsLogo';

// ─── Multi-entity model ───────────────────────────────────────────────────────
const ENTITIES = [
  { id: 'mbh', name: 'Maryland Behavioral Health', shortName: 'MBH', color: '#6366F1', bg: '#EEF2FF', border: '#C7D2FE' },
  { id: 'ch',  name: 'Clear Horizon',              shortName: 'CH',  color: '#059669', bg: '#ECFDF5', border: '#A7F3D0' },
  { id: 'hb',  name: 'Honey B',                    shortName: 'HB',  color: '#D97706', bg: '#FFFBEB', border: '#FDE68A' },
] as const;
type EntityId = typeof ENTITIES[number]['id'];

const ALL_CLINICAL: UserRole[] = ['therapist', 'psychiatrist', 'physician', 'medical_np', 'medical_assistant', 'np', 'prp_specialist', 'case_manager', 'peer_support', 'crisis_responder'];
// Medical dept (primary care / family medicine) — scoped to medical workflow only
const MEDICAL_PROVIDERS: UserRole[] = ['physician', 'medical_np'];
// Behavioral health prescribers
const BH_PRESCRIBERS: UserRole[] = ['psychiatrist', 'np'];
// All prescribers across both depts
const PRESCRIBERS: UserRole[] = [...BH_PRESCRIBERS, ...MEDICAL_PROVIDERS];

type LucideIcon = React.ComponentType<{ size?: number | string; className?: string; strokeWidth?: number | string }>;

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
  badge?: boolean;
  allowedRoles?: UserRole[];
};

type NavSection = {
  label: string;
  roles: UserRole[];
  items: NavItem[];
};

const NAV_SECTIONS: NavSection[] = [
  {
    label: 'Clinical',
    roles: [...ALL_CLINICAL, 'office_manager', 'practice_director'],
    items: [
      {
        // BH dashboard — medical providers use Medical Overview as their home
        href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, exact: true,
        allowedRoles: ['therapist', 'psychiatrist', 'np', 'prp_specialist', 'case_manager', 'peer_support', 'crisis_responder', 'office_manager', 'practice_director'],
      },
      {
        href: '/dashboard/tasks', label: 'My To-Do', icon: CheckSquare, badge: true,
        allowedRoles: ['therapist', 'psychiatrist', 'physician', 'medical_np', 'medical_assistant', 'np', 'prp_specialist', 'case_manager', 'crisis_responder', 'practice_director'],
      },
      {
        // BH client list — medical assistant gets full patient access (both departments)
        href: '/dashboard/clients', label: 'Clients', icon: Users,
        allowedRoles: ['therapist', 'psychiatrist', 'np', 'medical_assistant', 'prp_specialist', 'case_manager', 'peer_support', 'office_manager', 'billing_specialist', 'practice_director'],
      },
      {
        href: '/dashboard/clients/waitlist', label: 'Waitlist', icon: Clock,
        allowedRoles: ['therapist', 'psychiatrist', 'np', 'case_manager', 'office_manager', 'practice_director'],
      },
      {
        href: '/dashboard/clients/intake', label: 'Digital Intake', icon: ClipboardCheck,
        allowedRoles: ['therapist', 'psychiatrist', 'np', 'case_manager', 'office_manager', 'practice_director'],
      },
      {
        // BH crisis alerts only — C-SSRS, suicidality, self-harm flagging
        href: '/dashboard/alerts', label: 'Risk Alerts', icon: AlertTriangle, badge: true,
        allowedRoles: ['therapist', 'psychiatrist', 'np', 'prp_specialist', 'case_manager', 'crisis_responder', 'practice_director'],
      },
      {
        // CARF-aligned mobile crisis: smart triage, dispatch, documentation, follow-up
        href: '/dashboard/crisis', label: 'Mobile Crisis', icon: Siren,
        allowedRoles: ['therapist', 'psychiatrist', 'np', 'prp_specialist', 'case_manager', 'peer_support', 'crisis_responder', 'office_manager', 'practice_director'],
      },
      {
        // Assisted Outpatient Treatment — court-ordered outpatient program
        href: '/dashboard/aot', label: 'AOT Program', icon: Scale,
        allowedRoles: ['therapist', 'psychiatrist', 'np', 'prp_specialist', 'case_manager', 'peer_support', 'office_manager', 'practice_director'],
      },
      { href: '/dashboard/appointments', label: 'Appointments', icon: CalendarDays },
      {
        href: '/dashboard/telehealth', label: 'Telehealth', icon: Video,
        allowedRoles: ['therapist', 'psychiatrist', 'physician', 'medical_np', 'medical_assistant', 'np', 'case_manager', 'crisis_responder', 'practice_director'],
      },
      {
        href: '/dashboard/communications', label: 'Communications', icon: Phone,
        allowedRoles: ['therapist', 'psychiatrist', 'physician', 'medical_np', 'medical_assistant', 'np', 'prp_specialist', 'case_manager', 'peer_support', 'crisis_responder', 'office_manager', 'practice_director'],
      },
    ],
  },
  {
    label: 'Medical',
    // Medical dept only — BH staff (therapist, psychiatrist, np) use EHR section
    roles: ['physician', 'medical_np', 'medical_assistant', 'practice_director', 'office_manager', 'billing_specialist'],
    items: [
      { href: '/dashboard/medical', label: 'Medical Overview', icon: Stethoscope, exact: true,
        allowedRoles: ['physician', 'medical_np', 'medical_assistant', 'practice_director'] as UserRole[] },
      { href: '/dashboard/medical/patients', label: 'Patients', icon: Users,
        allowedRoles: ['physician', 'medical_np', 'medical_assistant', 'practice_director'] as UserRole[] },
      { href: '/dashboard/medical/patients/intake', label: 'New Patient Intake', icon: UserPlus,
        allowedRoles: ['physician', 'medical_np', 'medical_assistant', 'practice_director', 'office_manager'] as UserRole[] },
      { href: '/dashboard/medical/visits', label: 'Medical Visits', icon: ClipboardList,
        allowedRoles: ['physician', 'medical_np', 'medical_assistant', 'practice_director', 'office_manager', 'billing_specialist'] as UserRole[] },
      { href: '/dashboard/medical/history', label: 'Medical History', icon: ClipboardCheck,
        allowedRoles: ['physician', 'medical_np', 'medical_assistant', 'practice_director'] as UserRole[] },
      { href: '/dashboard/medical/vitals', label: 'Vitals', icon: Activity,
        allowedRoles: ['physician', 'medical_np', 'medical_assistant', 'practice_director'] as UserRole[] },
      { href: '/dashboard/medical/labs', label: 'Labs & Results', icon: FlaskConical,
        allowedRoles: ['physician', 'medical_np', 'medical_assistant', 'practice_director'] as UserRole[] },
      { href: '/dashboard/medical/problem-list', label: 'Problem List', icon: ClipboardCheck,
        allowedRoles: ['physician', 'medical_np', 'practice_director'] as UserRole[] },
      { href: '/dashboard/medical/preventive-care', label: 'Preventive Care', icon: ShieldCheck,
        allowedRoles: ['physician', 'medical_np', 'practice_director'] as UserRole[] },
      { href: '/dashboard/medical/referrals', label: 'Referrals & Orders', icon: Share2,
        allowedRoles: ['physician', 'medical_np', 'practice_director'] as UserRole[] },
      { href: '/dashboard/medical/ai', label: 'Medical AI', icon: Sparkles,
        allowedRoles: ['physician', 'medical_np', 'practice_director'] as UserRole[] },
      { href: '/dashboard/medical/billing', label: 'Medical Billing', icon: ReceiptText,
        allowedRoles: ['physician', 'medical_np', 'practice_director', 'billing_specialist', 'office_manager'] as UserRole[] },
      { href: '/dashboard/medical/payer-settings', label: 'Payer Settings', icon: Settings,
        allowedRoles: ['practice_director', 'billing_specialist', 'office_manager'] as UserRole[] },
    ],
  },
  {
    label: 'EHR',
    // Behavioral health EHR only — physician/medical_np have their own Medical section
    roles: ['therapist', 'psychiatrist', 'np', 'prp_specialist', 'case_manager', 'office_manager', 'billing_specialist', 'practice_director'],
    items: [
      {
        href: '/dashboard/ehr', label: 'EHR Overview', icon: Activity, exact: true,
        allowedRoles: ['therapist', 'psychiatrist', 'np', 'prp_specialist', 'case_manager', 'practice_director'],
      },
      {
        href: '/dashboard/ehr/notes', label: 'Progress Notes', icon: FileText,
        allowedRoles: ['therapist', 'psychiatrist', 'np', 'prp_specialist', 'case_manager', 'practice_director'],
      },
      {
        href: '/dashboard/ehr/evaluations', label: 'Evaluations', icon: ClipboardCheck,
        allowedRoles: ['therapist', 'psychiatrist', 'np', 'case_manager', 'practice_director'],
      },
      {
        href: '/dashboard/ehr/treatment-plans', label: 'Treatment Plans', icon: ClipboardList,
        allowedRoles: ['therapist', 'psychiatrist', 'np', 'prp_specialist', 'practice_director'],
      },
      {
        href: '/dashboard/ehr/assessments', label: 'Assessments', icon: BarChart3,
        allowedRoles: ['therapist', 'psychiatrist', 'np', 'prp_specialist', 'practice_director'],
      },
      {
        href: '/dashboard/ehr/assessments/cssrs', label: 'C-SSRS (Suicide Scale)', icon: BarChart3,
        allowedRoles: ['therapist', 'psychiatrist', 'np', 'practice_director'],
      },
      {
        href: '/dashboard/ehr/diagnoses', label: 'Diagnoses', icon: Microscope,
        allowedRoles: ['therapist', 'psychiatrist', 'np', 'practice_director'],
      },
      {
        href: '/dashboard/ehr/prescriptions', label: 'E-Prescribing', icon: Pill,
        allowedRoles: [...PRESCRIBERS, 'practice_director'],
      },
      {
        href: '/dashboard/ehr/labs', label: 'Lab Orders & Results', icon: FlaskConical,
        allowedRoles: ['psychiatrist', 'np', 'therapist', 'case_manager', 'practice_director'],
      },
      {
        href: '/dashboard/ehr/consents', label: 'Consent Forms', icon: PenLine,
        allowedRoles: ['therapist', 'psychiatrist', 'np', 'prp_specialist', 'case_manager', 'office_manager', 'practice_director'],
      },
      { href: '/dashboard/ehr/eligibility', label: 'Eligibility', icon: Shield },
      {
        href: '/dashboard/ehr/scanner', label: 'Service Eligibility Scanner', icon: ScanSearch,
        allowedRoles: ['therapist', 'psychiatrist', 'np', 'prp_specialist', 'case_manager', 'practice_director'],
      },
      {
        href: '/dashboard/ehr/prior-auths', label: 'Prior Authorizations', icon: ShieldCheck,
        allowedRoles: ['therapist', 'psychiatrist', 'np', 'prp_specialist', 'case_manager', 'billing_specialist', 'office_manager', 'practice_director'],
      },
      {
        href: '/dashboard/ehr/group-sessions', label: 'Group Sessions', icon: Users,
        allowedRoles: ['therapist', 'psychiatrist', 'np', 'prp_specialist', 'practice_director'],
      },
      {
        href: '/dashboard/ehr/session-ai', label: 'AI Session Notes', icon: Sparkles,
        allowedRoles: ['therapist', 'psychiatrist', 'np', 'prp_specialist', 'case_manager', 'practice_director'],
      },
      {
        href: '/dashboard/ehr/supervisor-review', label: 'Supervisor Review', icon: UserCheck, badge: true,
        allowedRoles: ['psychiatrist', 'practice_director'],
      },
      {
        href: '/dashboard/ehr/note-builder', label: 'Note Builder', icon: PenLine,
        allowedRoles: ['therapist', 'psychiatrist', 'np', 'prp_specialist', 'case_manager', 'practice_director'],
      },
      {
        href: '/dashboard/ehr/goal-bank', label: 'Goal Bank', icon: BookOpen,
        allowedRoles: ['therapist', 'psychiatrist', 'np', 'prp_specialist', 'practice_director'],
      },
      {
        href: '/dashboard/ehr/part2', label: '42 CFR Part 2', icon: Lock,
        allowedRoles: ['therapist', 'psychiatrist', 'np', 'prp_specialist', 'case_manager', 'office_manager', 'billing_specialist', 'practice_director'],
      },
      {
        href: '/dashboard/ehr/safety-plan', label: 'Safety Planning', icon: ShieldAlert,
        allowedRoles: ['therapist', 'psychiatrist', 'np', 'prp_specialist', 'case_manager', 'practice_director'],
      },
      {
        href: '/dashboard/ehr/tms-spravato', label: 'TMS & Spravato', icon: Zap,
        allowedRoles: ['psychiatrist', 'np', 'practice_director'],
      },
      {
        href: '/dashboard/ehr/locus', label: 'LOCUS / CALOCUS', icon: BarChart3,
        allowedRoles: ['therapist', 'psychiatrist', 'np', 'prp_specialist', 'case_manager', 'practice_director'],
      },
      {
        href: '/dashboard/ehr/mandatory-reporting', label: 'Mandatory Reporting', icon: AlertTriangle, badge: true,
        allowedRoles: ['therapist', 'psychiatrist', 'np', 'prp_specialist', 'case_manager', 'practice_director'],
      },
      {
        href: '/dashboard/ehr/discharge', label: 'Discharge Planning', icon: LogOut,
        allowedRoles: ['therapist', 'psychiatrist', 'np', 'case_manager', 'practice_director'],
      },
      {
        href: '/dashboard/ehr/healthlake', label: 'HealthLake FHIR R4', icon: Database,
        allowedRoles: ['practice_director', 'admin'],
      },
    ],
  },
  {
    label: 'AI & Analytics',
    roles: ['therapist', 'psychiatrist', 'np', 'prp_specialist', 'case_manager', 'office_manager', 'practice_director'],
    items: [
      {
        href: '/dashboard/mbc', label: 'MBC Automation', icon: Activity,
        allowedRoles: ['therapist', 'psychiatrist', 'np', 'prp_specialist', 'practice_director'],
      },
      {
        href: '/dashboard/mbc/outcomes', label: 'Outcome Measures', icon: TrendingUp,
        allowedRoles: ['therapist', 'psychiatrist', 'np', 'prp_specialist', 'practice_director'],
      },
      {
        href: '/dashboard/scribe', label: 'AI Scribe', icon: Mic,
        allowedRoles: ['therapist', 'psychiatrist', 'np', 'prp_specialist', 'case_manager', 'practice_director'],
      },
      {
        href: '/dashboard/ai-insights', label: 'AI Insights', icon: Bot,
        allowedRoles: ['therapist', 'psychiatrist', 'np', 'prp_specialist', 'practice_director'],
      },
      {
        href: '/dashboard/coding', label: 'AI Coding', icon: Receipt,
        allowedRoles: ['therapist', 'psychiatrist', 'np', 'prp_specialist', 'case_manager', 'billing_specialist', 'office_manager', 'practice_director'],
      },
      { href: '/dashboard/analytics/schedule', label: 'Schedule Analytics', icon: BarChart2 },
      {
        href: '/dashboard/analytics/productivity', label: 'Doc Productivity', icon: CheckSquare,
        allowedRoles: ['practice_director', 'office_manager'],
      },
      {
        href: '/dashboard/analytics/surveys', label: 'Patient Satisfaction', icon: Star,
        allowedRoles: ['therapist', 'psychiatrist', 'np', 'office_manager', 'practice_director'],
      },
      { href: '/dashboard/reports', label: 'Outcomes & Reports', icon: TrendingUp },
      {
        href: '/dashboard/population', label: 'Population Health', icon: Activity,
        allowedRoles: ['therapist', 'psychiatrist', 'np', 'practice_director'],
      },
      {
        href: '/dashboard/sdoh', label: 'SDOH Screening', icon: ClipboardList,
        allowedRoles: ['therapist', 'psychiatrist', 'np', 'prp_specialist', 'case_manager', 'practice_director'],
      },
      { href: '/dashboard/resources', label: 'Resource Library', icon: BookOpen },
    ],
  },
  {
    label: 'Quality & Compliance',
    roles: ['practice_director', 'office_manager', 'hr_manager', 'therapist', 'psychiatrist', 'physician', 'medical_np', 'np'],
    items: [
      {
        href: '/dashboard/qi', label: 'Quality Improvement', icon: TrendingUp,
        allowedRoles: ['practice_director', 'office_manager'],
      },
      {
        href: '/dashboard/incidents', label: 'Incident Reports', icon: AlertTriangle, badge: true,
        allowedRoles: ['therapist', 'psychiatrist', 'physician', 'medical_np', 'np', 'prp_specialist', 'case_manager', 'office_manager', 'practice_director'],
      },
      {
        href: '/dashboard/grievances', label: 'Grievances & Rights', icon: MessageSquare,
        allowedRoles: ['office_manager', 'practice_director'],
      },
      {
        href: '/dashboard/compliance', label: 'Compliance Calendar', icon: CalendarDays,
        allowedRoles: ['practice_director', 'office_manager', 'hr_manager'],
      },
      {
        href: '/dashboard/peer-support', label: 'Peer Support', icon: Users,
        allowedRoles: ['peer_support', 'case_manager', 'prp_specialist', 'practice_director'],
      },
    ],
  },
  {
    label: 'Programs',
    roles: ['prp_specialist', 'case_manager', 'office_manager', 'practice_director'],
    items: [
      { href: '/dashboard/prp', label: 'PRP Program', icon: Puzzle },
      { href: '/dashboard/prp/assessment', label: 'PRP Assessment', icon: ClipboardList, allowedRoles: ['prp_specialist', 'case_manager', 'practice_director'] as UserRole[] },
      { href: '/dashboard/prp/irp', label: 'Individual Rehab Plan', icon: Target, allowedRoles: ['prp_specialist', 'case_manager', 'practice_director'] as UserRole[] },
      { href: '/dashboard/residential', label: 'Residential 3.1 / 3.5', icon: BedDouble },
    ],
  },
  {
    label: 'Business',
    roles: ['physician', 'medical_np', 'office_manager', 'billing_specialist', 'hr_manager', 'practice_director'],
    items: [
      {
        href: '/dashboard/enterprise', label: 'Enterprise', icon: Building2,
        allowedRoles: ['practice_director'],
      },
      {
        href: '/dashboard/billing', label: 'Billing', icon: CreditCard,
        allowedRoles: ['billing_specialist', 'office_manager', 'practice_director'],
      },
      {
        href: '/dashboard/billing/denials', label: 'Denial Management', icon: XCircle,
        allowedRoles: ['billing_specialist', 'office_manager', 'practice_director'],
      },
      {
        href: '/dashboard/billing/autopay', label: 'AutoPay', icon: Zap,
        allowedRoles: ['therapist', 'psychiatrist', 'physician', 'medical_np', 'np', 'billing_specialist', 'office_manager', 'practice_director'],
      },
      {
        href: '/dashboard/billing/superbills', label: 'Superbills', icon: FileText,
        allowedRoles: ['therapist', 'psychiatrist', 'physician', 'medical_np', 'np', 'billing_specialist', 'office_manager', 'practice_director'],
      },
      {
        href: '/dashboard/billing/payments', label: 'Payments & Invoices', icon: DollarSign,
        allowedRoles: ['therapist', 'psychiatrist', 'physician', 'medical_np', 'np', 'billing_specialist', 'office_manager', 'practice_director'],
      },
      {
        href: '/dashboard/billing/panels', label: 'Insurance Panels', icon: ShieldCheck,
        allowedRoles: ['therapist', 'psychiatrist', 'np', 'billing_specialist', 'office_manager', 'practice_director'],
      },
      {
        // BH payer routing (MD Medicaid ASO carve-out), coverage matrix, billing rules
        href: '/dashboard/billing/payer-settings', label: 'BH Payer Settings', icon: Settings,
        allowedRoles: ['billing_specialist', 'office_manager', 'practice_director'],
      },
      {
        href: '/dashboard/billing/ar-control', label: 'A/R Control Center', icon: TrendingDown,
        allowedRoles: ['billing_specialist', 'office_manager', 'practice_director'],
      },
      {
        href: '/dashboard/billing/claim-scrubber', label: 'Claim Scrubber', icon: ScanSearch,
        allowedRoles: ['billing_specialist', 'office_manager', 'practice_director'],
      },
      {
        // Census-driven per-diem (H0018/H0019) + mobile crisis (H2011) charge capture
        href: '/dashboard/billing/residential-crisis', label: 'Residential & Crisis Billing', icon: Receipt,
        allowedRoles: ['billing_specialist', 'office_manager', 'practice_director'],
      },
      {
        href: '/dashboard/billing/statements', label: 'eStatements', icon: ReceiptText,
        allowedRoles: ['billing_specialist', 'office_manager', 'practice_director'],
      },
      {
        href: '/dashboard/admin/scheduling-settings', label: 'Online Scheduling', icon: CalendarPlus,
        allowedRoles: ['office_manager', 'practice_director'],
      },
      {
        href: '/dashboard/hr', label: 'HR & Staff', icon: Building,
        allowedRoles: ['hr_manager', 'practice_director'],
      },
      {
        href: '/dashboard/hr/credentialing', label: 'Credentialing', icon: ShieldCheck,
        allowedRoles: ['hr_manager', 'practice_director'],
      },
      {
        href: '/dashboard/hr/supervision', label: 'Supervision Log', icon: GraduationCap,
        allowedRoles: ['therapist', 'psychiatrist', 'np', 'hr_manager', 'practice_director'],
      },
      {
        href: '/dashboard/hr/training', label: 'Training Hub', icon: GraduationCap,
        allowedRoles: ['hr_manager', 'practice_director'],
      },
      {
        href: '/dashboard/projects', label: 'Project Tracker', icon: CheckSquare,
        allowedRoles: ['practice_director', 'admin', 'office_manager', 'hr_manager'] as UserRole[],
      },
      {
        href: '/dashboard/admin', label: 'Admin & Compliance', icon: Settings,
        allowedRoles: ['practice_director'],
      },
      {
        href: '/dashboard/admin/migration', label: 'EHR Migration Import', icon: Database,
        allowedRoles: ['practice_director', 'admin'],
      },
    ],
  },
  {
    label: 'My Practice',
    roles: ['therapist', 'psychiatrist', 'np', 'practice_director'],
    items: [
      {
        href: '/onboarding', label: 'Practice Setup', icon: Settings,
        allowedRoles: ['therapist', 'psychiatrist', 'np', 'practice_director'],
      },
      {
        href: '/dashboard/subscription', label: 'Plan & Subscription', icon: Zap,
        allowedRoles: ['therapist', 'psychiatrist', 'np', 'practice_director'],
      },
    ],
  },
  {
    label: 'Community',
    roles: ['therapist', 'prp_specialist', 'case_manager', 'peer_support', 'office_manager', 'practice_director'],
    items: [
      { href: '/dashboard/community', label: 'Events & Outreach', icon: Globe },
      {
        href: '/dashboard/community/referrals', label: 'Referral Tracking', icon: Share2,
        allowedRoles: ['therapist', 'psychiatrist', 'np', 'case_manager', 'office_manager', 'practice_director'],
      },
      {
        href: '/dashboard/pr', label: 'PR & Marketing', icon: Megaphone,
        allowedRoles: ['office_manager', 'practice_director'],
      },
    ],
  },
];

const ROLE_ORDER: UserRole[] = [
  'therapist', 'psychiatrist', 'physician', 'medical_np', 'medical_assistant', 'np', 'prp_specialist', 'case_manager', 'peer_support', 'crisis_responder',
  'practice_director', 'office_manager', 'billing_specialist', 'hr_manager',
];

const ENTITY_COLORS: Record<string, string> = { mbh: '#6366F1', ch: '#059669', hb: '#D97706' };

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, logout, switchDemoRole } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [roleSwitcherOpen, setRoleSwitcherOpen] = useState(false);
  const [entitySwitcherOpen, setEntitySwitcherOpen] = useState(false);
  const [activeEntityId, setActiveEntityId] = useState<EntityId | 'all'>('all');

  // ── Command palette ────────────────────────────────────────────────────────
  const [cmdOpen, setCmdOpen]     = useState(false);
  const [cmdQuery, setCmdQuery]   = useState('');
  const [cmdIdx, setCmdIdx]       = useState(0);
  const cmdInputRef               = useRef<HTMLInputElement>(null);

  const openCmd = useCallback(() => { setCmdOpen(true); setCmdQuery(''); setCmdIdx(0); }, []);
  const closeCmd = useCallback(() => { setCmdOpen(false); setCmdQuery(''); }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); cmdOpen ? closeCmd() : openCmd(); }
      if (e.key === 'Escape') closeCmd();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cmdOpen, openCmd, closeCmd]);
  const isDemo = typeof window !== 'undefined' && localStorage.getItem('dc_demo_mode') === 'true';
  const trialName = typeof window !== 'undefined' ? localStorage.getItem('dc_trial_name') : null;
  const trialOrg = typeof window !== 'undefined' ? localStorage.getItem('dc_trial_org') : null;

  const activeEntity = activeEntityId === 'all' ? null : ENTITIES.find(e => e.id === activeEntityId) ?? null;
  const isDirector = user?.role === 'practice_director';

  useEffect(() => {
    if (!loading && !user) router.push('/login');
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <div className="text-center">
          <AltrixsLogo variant="dark" showSubtitle width={160} className="mx-auto mb-5" />
          <div className="flex items-center justify-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-bounce" style={{ animationDelay: '0ms' }} />
            <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-bounce" style={{ animationDelay: '150ms' }} />
            <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
        </div>
      </div>
    );
  }

  if (!user) return null;

  if (user.role === 'client') {
    return (
      <div className="min-h-screen flex items-center justify-center px-6 bg-slate-50">
        <div className="max-w-md w-full text-center">
          <div className="flex justify-center mb-6">
            <AltrixsLogo variant="light" showSubtitle={false} width={160} />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mb-3">Staff Portal Only</h1>
          <p className="text-slate-500 mb-6 leading-relaxed">
            The Altrixs web dashboard is for clinical and administrative staff.
            As a client, please use the Altrixs mobile app.
          </p>
          <div className="bg-white rounded-2xl border border-slate-200 p-5 mb-6 text-left space-y-2.5">
            {['Track your mood & daily check-ins', 'Message your care team securely', 'Access CBT/DBT coping tools', 'View appointments & medication reminders', 'Chat with Aria, your AI wellness companion', 'See your progress over time'].map((item, i) => (
              <div key={i} className="flex items-center gap-3 text-sm text-slate-700">
                <div className="w-5 h-5 rounded-full bg-green-100 flex items-center justify-center shrink-0">
                  <div className="w-2 h-2 rounded-full bg-green-500" />
                </div>
                {item}
              </div>
            ))}
          </div>
          <button onClick={() => { logout(); router.push('/login'); }}
            className="w-full py-3 rounded-xl font-semibold text-white text-sm bg-indigo-600 hover:bg-indigo-700 transition-colors">
            Back to Login
          </button>
        </div>
      </div>
    );
  }

  const roleConfig = ROLE_CONFIG[user.role];

  const visibleSections = NAV_SECTIONS
    .filter(s => s.roles.includes(user.role))
    .map(s => ({ ...s, items: s.items.filter(item => !item.allowedRoles || item.allowedRoles.includes(user.role)) }))
    .filter(s => s.items.length > 0);

  const handleLogout = async () => { await logout(); router.push('/login'); };

  const displayName = trialName || user.displayName || 'Staff';

  // ── Command palette data ───────────────────────────────────────────────────
  // Demo clients for quick navigation
  const CMD_CLIENTS = [
    { id: 'p1', name: 'Marcus Thompson',  href: '/dashboard/clients/p1' },
    { id: 'p2', name: 'Aisha Johnson',    href: '/dashboard/clients/p2' },
    { id: 'p3', name: 'Carlos Rivera',    href: '/dashboard/clients/p3' },
    { id: 'p4', name: 'Maria Santos',     href: '/dashboard/clients/p4' },
    { id: 'p5', name: 'DeShawn Williams', href: '/dashboard/clients/p5' },
    { id: 'p6', name: 'Priya Kapoor',     href: '/dashboard/clients/p6' },
    { id: 'p7', name: 'Jerome Carter',    href: '/dashboard/clients/p7' },
  ];

  const CMD_ACTIONS = [
    { id: 'crisis-call',  label: 'New Mobile Crisis Call',   href: '/dashboard/crisis',            icon: Siren },
    { id: 'new-intake',   label: 'Send New Intake Link',     href: '/dashboard/clients/intake',    icon: ClipboardCheck },
    { id: 'new-appt',     label: 'New Appointment',          href: '/dashboard/appointments',      icon: CalendarDays },
    { id: 'risk-alerts',  label: 'View Risk Alerts',         href: '/dashboard/alerts',            icon: AlertTriangle },
    { id: 'new-note',     label: 'Write Progress Note',      href: '/dashboard/ehr/notes',         icon: FileText },
    { id: 'ai-scribe',    label: 'Start AI Scribe Session',  href: '/dashboard/scribe',            icon: Mic },
    { id: 'communications', label: 'Communications (SMS, Calls, Secure)',  href: '/dashboard/communications', icon: Phone },
  ];
  const userInitials = displayName.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase() || '?';

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <OfflineBanner />
      <div className="flex flex-1">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/60 z-20 lg:hidden backdrop-blur-sm" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed top-0 left-0 h-full w-60 z-30 flex flex-col transition-transform duration-300
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0 lg:static lg:z-auto`}
        style={{ background: '#0F172A' }}
      >
        {/* Logo + entity switcher */}
        <div className="px-4 py-5 border-b border-white/8">
          <div className="mb-4">
            <AltrixsLogo compact variant="dark" />
          </div>

          {/* Entity switcher */}
          <div className="relative">
            <button
              onClick={() => setEntitySwitcherOpen(v => !v)}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left hover:bg-white/5 transition-colors border border-white/8"
            >
              <div className="w-5 h-5 rounded flex items-center justify-center text-xs font-bold shrink-0"
                style={{ backgroundColor: activeEntity ? ENTITY_COLORS[activeEntity.id] : '#334155', color: '#fff' }}>
                {activeEntity ? activeEntity.shortName[0] : 'A'}
              </div>
              <span className="text-slate-300 text-xs font-medium flex-1 truncate">
                {activeEntity ? activeEntity.name : 'All Entities'}
              </span>
              <ChevronDown size={12} className="text-slate-500 shrink-0" />
            </button>

            {entitySwitcherOpen && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden z-50">
                <div className="px-3 py-2 border-b border-slate-100">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Switch Entity</p>
                </div>
                <button onClick={() => { setActiveEntityId('all'); setEntitySwitcherOpen(false); }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 text-left ${activeEntityId === 'all' ? 'bg-indigo-50' : ''}`}>
                  <div className="w-6 h-6 rounded bg-slate-800 flex items-center justify-center text-white text-xs font-bold">A</div>
                  <div className="flex-1">
                    <p className="text-xs font-semibold text-slate-900">All Entities</p>
                    <p className="text-xs text-slate-400">Enterprise overview</p>
                  </div>
                  {activeEntityId === 'all' && <div className="w-1.5 h-1.5 rounded-full bg-indigo-500" />}
                </button>
                <div className="border-t border-slate-100" />
                {ENTITIES.map(e => (
                  <button key={e.id}
                    onClick={() => { setActiveEntityId(e.id); setEntitySwitcherOpen(false); }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 text-left ${activeEntityId === e.id ? 'bg-indigo-50' : ''}`}>
                    <div className="w-6 h-6 rounded flex items-center justify-center text-white text-xs font-bold"
                      style={{ backgroundColor: ENTITY_COLORS[e.id] }}>{e.shortName}</div>
                    <p className="text-xs font-semibold text-slate-900 flex-1">{e.name}</p>
                    {activeEntityId === e.id && <div className="w-1.5 h-1.5 rounded-full bg-indigo-500" />}
                  </button>
                ))}
                {isDirector && (
                  <div className="border-t border-slate-100">
                    <Link href="/dashboard/enterprise" onClick={() => setEntitySwitcherOpen(false)}
                      className="flex items-center gap-2 px-3 py-2.5 hover:bg-slate-50 text-xs font-semibold text-indigo-600">
                      <Building2 size={12} /> Enterprise Overview
                      <ChevronRight size={12} className="ml-auto" />
                    </Link>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 overflow-y-auto space-y-5">
          {visibleSections.map(section => (
            <div key={section.label}>
              <p className="text-slate-600 text-xs font-semibold uppercase tracking-widest px-3 mb-1.5">{section.label}</p>
              <div className="space-y-0.5">
                {section.items.map(item => {
                  const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
                  const Icon = item.icon;
                  return (
                    <Link key={item.href} href={item.href} onClick={() => setSidebarOpen(false)}
                      className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all group relative
                        ${active ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'}`}>
                      {active && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-indigo-400 rounded-r-full" />}
                      <Icon size={16} strokeWidth={active ? 2.5 : 2} className={active ? 'text-indigo-300' : 'text-slate-500 group-hover:text-slate-300'} />
                      <span className="flex-1">{item.label}</span>
                      {item.badge && (
                        <span className="bg-red-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center font-bold text-[10px]">3</span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* User area */}
        <div className="px-3 py-4 border-t border-white/8 space-y-2">
          {/* Role badge */}
          <div className="px-3 py-2 rounded-lg bg-white/5 flex items-center gap-2">
            <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0"
              style={{ backgroundColor: roleConfig.color + '30' }}>
              <Stethoscope size={12} style={{ color: roleConfig.color }} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold truncate" style={{ color: roleConfig.color }}>{roleConfig.label}</p>
            </div>
            {isDemo && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 font-bold">DEMO</span>}
          </div>

          {/* User card */}
          <div className="px-3 py-2 flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-300 font-bold text-xs shrink-0">
              {userInitials}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-slate-200 text-xs font-semibold truncate">{displayName}</p>
              <p className="text-slate-500 text-xs truncate">{trialOrg || user.email}</p>
            </div>
          </div>

          {/* Demo role switcher */}
          {isDemo && (
            <div className="relative">
              <button onClick={() => setRoleSwitcherOpen(v => !v)}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-slate-400 hover:text-slate-200 hover:bg-white/5 transition-colors">
                <RefreshCw size={12} />
                <span>Switch Demo Role</span>
                <ChevronDown size={11} className="ml-auto" />
              </button>
              {roleSwitcherOpen && (
                <div className="absolute bottom-full left-0 right-0 mb-1 bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden z-50 max-h-80 overflow-y-auto">
                  {[
                    { label: 'Clinical', roles: ['therapist', 'psychiatrist', 'physician', 'medical_np', 'medical_assistant', 'np', 'prp_specialist', 'case_manager', 'peer_support', 'crisis_responder'] as UserRole[] },
                    { label: 'Administrative', roles: ['practice_director', 'office_manager', 'billing_specialist', 'hr_manager'] as UserRole[] },
                  ].map(group => (
                    <div key={group.label}>
                      <div className="px-3 pt-2.5 pb-1">
                        <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">{group.label}</p>
                      </div>
                      {group.roles.map(role => {
                        const cfg = ROLE_CONFIG[role];
                        const demoUser = DEMO_USERS[role];
                        return (
                          <button key={role}
                            onClick={() => { switchDemoRole(role); setRoleSwitcherOpen(false); router.push('/dashboard'); router.refresh(); }}
                            className={`w-full flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 transition-colors text-left ${user.role === role ? 'bg-indigo-50' : ''}`}>
                            <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                              style={{ backgroundColor: cfg.bg, color: cfg.color }}>
                              {demoUser.displayName.split(' ').map((w: string) => w[0]).join('').slice(0, 2)}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-semibold text-slate-900 truncate">{demoUser.displayName}</p>
                              <p className="text-xs text-slate-400 truncate">{cfg.label}</p>
                            </div>
                            {user.role === role && <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 shrink-0" />}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <button onClick={handleLogout}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-slate-500 hover:text-slate-200 hover:bg-white/5 transition-colors">
            <LogOut size={13} />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="bg-white border-b border-slate-200 px-5 py-3.5 flex items-center gap-4 sticky top-0 z-10">
          <button onClick={() => setSidebarOpen(v => !v)}
            className="lg:hidden p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors">
            <Menu size={20} />
          </button>

          {/* Command palette trigger */}
          <button onClick={openCmd}
            className="hidden sm:flex items-center gap-2.5 px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-400 hover:border-slate-300 hover:text-slate-600 hover:bg-slate-50 transition-all flex-1 max-w-xs">
            <Search size={14} />
            <span className="flex-1 text-left text-xs">Search pages, clients…</span>
            <kbd className="flex items-center gap-0.5 text-[10px] font-mono bg-slate-100 text-slate-400 px-1.5 py-0.5 rounded border border-slate-200">
              <Command size={9} />K
            </kbd>
          </button>
          <button onClick={openCmd} className="sm:hidden p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors">
            <Search size={18} />
          </button>
          <div className="flex-1 hidden sm:block" />

          <div className="flex items-center gap-3">
            {activeEntity && (
              <span className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border"
                style={{ backgroundColor: activeEntity.bg, color: ENTITY_COLORS[activeEntity.id], borderColor: activeEntity.border }}>
                <span className="w-3.5 h-3.5 rounded-sm flex items-center justify-center text-white text-[9px] font-black"
                  style={{ backgroundColor: ENTITY_COLORS[activeEntity.id] }}>
                  {activeEntity.shortName[0]}
                </span>
                {activeEntity.shortName}
              </span>
            )}
            {isDemo && (
              <span className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border"
                style={{ backgroundColor: roleConfig.bg, color: roleConfig.color, borderColor: roleConfig.color + '40' }}>
                {roleConfig.label}
              </span>
            )}
            <button className="relative p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 transition-colors">
              <Bell size={18} />
              <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-red-500" />
            </button>
            <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-white font-bold text-xs">
              {userInitials}
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 p-6 overflow-auto">
          {children}
        </main>
      </div>
      </div>

      {/* ── Command Palette ─────────────────────────────────────────────────── */}
      {cmdOpen && (() => {
        const q = cmdQuery.toLowerCase().trim();

        // Filter pages from visible nav sections
        const pageResults = visibleSections
          .flatMap(s => s.items.map(item => ({ ...item, section: s.label })))
          .filter(item => !q || item.label.toLowerCase().includes(q) || item.section.toLowerCase().includes(q));

        // Filter clients
        const clientResults = CMD_CLIENTS.filter(c => !q || c.name.toLowerCase().includes(q));

        // Filter quick actions
        const actionResults = CMD_ACTIONS.filter(a => !q || a.label.toLowerCase().includes(q));

        // Flatten all results for keyboard nav
        type Flat = { id: string; label: string; sub: string; href: string; icon: React.ComponentType<{ size?: number; className?: string }> };
        const flat: Flat[] = [
          ...(!q ? actionResults.map(a => ({ id: a.id, label: a.label, sub: 'Quick Action', href: a.href, icon: a.icon })) : []),
          ...pageResults.map(p => ({ id: p.href, label: p.label, sub: p.section, href: p.href, icon: p.icon })),
          ...clientResults.map(c => ({ id: c.id, label: c.name, sub: 'Client', href: c.href, icon: User as React.ComponentType<{size?: number; className?: string}> })),
        ].slice(0, 12);

        const safeIdx = Math.min(cmdIdx, flat.length - 1);

        function go(href: string) { router.push(href); closeCmd(); setSidebarOpen(false); }

        function onKeyDown(e: React.KeyboardEvent) {
          if (e.key === 'ArrowDown')  { e.preventDefault(); setCmdIdx(i => Math.min(i + 1, flat.length - 1)); }
          if (e.key === 'ArrowUp')    { e.preventDefault(); setCmdIdx(i => Math.max(i - 1, 0)); }
          if (e.key === 'Enter' && flat[safeIdx]) go(flat[safeIdx].href);
          if (e.key === 'Escape') closeCmd();
        }

        return (
          <div className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] px-4"
            onClick={closeCmd}>
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
            <div className="relative w-full max-w-xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden"
              onClick={e => e.stopPropagation()}>

              {/* Search input */}
              <div className="flex items-center gap-3 px-4 py-3.5 border-b border-slate-100">
                <Search size={16} className="text-slate-400 shrink-0" />
                <input
                  ref={cmdInputRef}
                  autoFocus
                  value={cmdQuery}
                  onChange={e => { setCmdQuery(e.target.value); setCmdIdx(0); }}
                  onKeyDown={onKeyDown}
                  placeholder="Search pages, clients, actions…"
                  className="flex-1 text-sm text-slate-900 placeholder-slate-400 outline-none bg-transparent"
                />
                <kbd className="text-xs font-mono bg-slate-100 text-slate-400 px-2 py-0.5 rounded border border-slate-200 shrink-0">Esc</kbd>
              </div>

              {/* Results */}
              <div className="max-h-[60vh] overflow-y-auto py-2">
                {flat.length === 0 ? (
                  <div className="px-4 py-10 text-center text-sm text-slate-400">No results for "{cmdQuery}"</div>
                ) : (
                  <>
                    {/* Quick Actions (only when no query) */}
                    {!q && actionResults.length > 0 && (
                      <div>
                        <p className="px-4 pt-1 pb-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Quick Actions</p>
                        {flat.filter(f => f.sub === 'Quick Action').map((item, i) => {
                          const Icon = item.icon;
                          const isActive = i === safeIdx;
                          return (
                            <button key={item.id} onClick={() => go(item.href)}
                              className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${isActive ? 'bg-indigo-50' : 'hover:bg-slate-50'}`}>
                              <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${isActive ? 'bg-indigo-600' : 'bg-slate-100'}`}>
                                <Icon size={13} className={isActive ? 'text-white' : 'text-slate-500'} />
                              </div>
                              <span className={`text-sm font-medium flex-1 ${isActive ? 'text-indigo-700' : 'text-slate-700'}`}>{item.label}</span>
                              {isActive && <ArrowRight size={13} className="text-indigo-400 shrink-0" />}
                            </button>
                          );
                        })}
                        <div className="mx-4 my-2 border-t border-slate-100" />
                      </div>
                    )}

                    {/* Pages */}
                    {pageResults.length > 0 && (
                      <div>
                        <p className="px-4 pt-1 pb-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                          {q ? 'Pages' : 'All Pages'}
                        </p>
                        {flat.filter(f => f.sub !== 'Quick Action' && f.sub !== 'Client').slice(0, q ? 8 : 6).map((item, rawI) => {
                          const offset = !q ? actionResults.length : 0;
                          const i = rawI + offset;
                          const Icon = item.icon;
                          const isActive = i === safeIdx;
                          return (
                            <button key={item.id} onClick={() => go(item.href)}
                              className={`w-full flex items-center gap-3 px-4 py-2 text-left transition-colors ${isActive ? 'bg-indigo-50' : 'hover:bg-slate-50'}`}>
                              <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${isActive ? 'bg-indigo-600' : 'bg-slate-100'}`}>
                                <Icon size={13} className={isActive ? 'text-white' : 'text-slate-500'} />
                              </div>
                              <div className="flex-1 min-w-0">
                                <span className={`text-sm font-medium block ${isActive ? 'text-indigo-700' : 'text-slate-800'}`}>{item.label}</span>
                                <span className="text-xs text-slate-400">{item.sub}</span>
                              </div>
                              {isActive && <ArrowRight size={13} className="text-indigo-400 shrink-0" />}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {/* Clients */}
                    {clientResults.length > 0 && (q || !q) && (
                      <div>
                        {pageResults.length > 0 && <div className="mx-4 my-2 border-t border-slate-100" />}
                        <p className="px-4 pt-1 pb-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Clients</p>
                        {flat.filter(f => f.sub === 'Client').map((item, rawI) => {
                          const offset = (!q ? actionResults.length : 0) + flat.filter(f => f.sub !== 'Quick Action' && f.sub !== 'Client').slice(0, q ? 8 : 6).length;
                          const i = rawI + offset;
                          const isActive = i === safeIdx;
                          return (
                            <button key={item.id} onClick={() => go(item.href)}
                              className={`w-full flex items-center gap-3 px-4 py-2 text-left transition-colors ${isActive ? 'bg-indigo-50' : 'hover:bg-slate-50'}`}>
                              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${isActive ? 'bg-indigo-600 text-white' : 'bg-teal-100 text-teal-700'}`}>
                                {item.label.split(' ').map((n: string) => n[0]).join('').slice(0, 2)}
                              </div>
                              <span className={`text-sm font-medium flex-1 ${isActive ? 'text-indigo-700' : 'text-slate-800'}`}>{item.label}</span>
                              {isActive && <ArrowRight size={13} className="text-indigo-400 shrink-0" />}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Footer hint */}
              <div className="flex items-center gap-4 px-4 py-2.5 border-t border-slate-100 bg-slate-50 text-[10px] text-slate-400">
                <span className="flex items-center gap-1"><kbd className="bg-white border border-slate-200 rounded px-1 py-0.5 font-mono">↑↓</kbd> navigate</span>
                <span className="flex items-center gap-1"><kbd className="bg-white border border-slate-200 rounded px-1.5 py-0.5 font-mono">↵</kbd> open</span>
                <span className="flex items-center gap-1"><kbd className="bg-white border border-slate-200 rounded px-1.5 py-0.5 font-mono">Esc</kbd> close</span>
                <span className="ml-auto flex items-center gap-1"><Command size={9} /><kbd className="bg-white border border-slate-200 rounded px-1 py-0.5 font-mono">K</kbd> anytime</span>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
