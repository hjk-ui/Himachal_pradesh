'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  Check,
  ChevronRight,
  CheckCircle2,
  CircleAlert,
  Download,
  FileText,
  Flame,
  HeartPulse,
  Lock,
  Mail,
  MessageSquare,
  Moon,
  Pill,
  Plus,
  Pencil,
  Pin,
  StickyNote,
  Tag,
  Trash2,
  TrendingUp,
  UserCheck,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  Alert,
  Button,
  buttonClasses,
  Card,
  cardClasses,
  cx,
  EmptyState,
  FOCUS_RING,
  IconButton,
  inputClasses,
  LoadingState,
  Modal,
  Page,
  PageHeader,
  StatusBadge,
  TONE_SOFT,
  type Tone,
} from '@/components/ui';
import { ClientAvatar } from '@/components/clinic/ClientAvatar';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Legend,
} from 'recharts';
import { useAuth } from '@/features/auth';
import { ImportedPlanNotice } from '@/features/ehr/ImportedPlanNotice';
import type { ImportedPlanSource } from '@/lib/migration/valantTreatmentPlans';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { canAccessClientChartNotes, canWriteClientChartNotes, canEditClientProfile, canAccessClientRoster, canViewClientMedications, canWriteClientMedications, canManageCareTeam } from '@/lib/clients/orgScope';
import { medicalDirectorActive } from '@/lib/auth/medicalDirector';
import { SessionFrequencyCard } from '@/features/caseload/sessionFrequency';
import { SocialNeedsCard } from '@/features/sdoh/components/SocialNeedsCard';
import { ClientResourcesCard } from '@/features/resources/ClientResourcesCard';
import type { StaffRole } from '@/types/roles';
import { canPrescribe as isPrescriberRole, isClinicalStaff } from '@/types/roles';
import { isMedicalProvider } from '@/features/medical/roles';
import type { Appointment } from '@/features/appointments';
import { fetchAppointments } from '@/features/appointments';
import { AppointmentLabelChip } from '@/components/scheduling/AppointmentLabelChip';
import {
  createClientCheckIn,
  createClientNote,
  fetchClient,
  fetchClientNotes,
  removeClientAvatar,
  updateClientInsurance,
  uploadClientAvatar,
  sendPortalInvite,
  EditClientModal,
  type Client,
  type ClientCheckIn,
  type ClientProgressNote,
  type TreatmentTeamMember,
} from '@/features/clients';
import { apiJson } from '@/lib/api-client';
import { chartLegalName } from '@/lib/clients/legalName';
import { formatApptWhenStaff } from '@/lib/clients/appointmentDisplay';
import { SmartPhraseTextarea } from '@/components/notes/SmartPhraseTextarea';
import { DrFirstChartPanel, DrFirstLinkButton } from '@/components/drfirst/DrFirstChartPanel';
import { DRFIRST_SYNCED_EVENT, type DrFirstSyncedDetail } from '@/lib/drfirst/openRcopiaClient';
import { ValantReferenceCard } from '@/components/billing/ValantReferenceCard';
import { PatientBalanceCard } from '@/components/billing/PatientBalanceCard';
import { CHART_TABS, CHART_TAB_GROUP_LABELS, chartTabGroup, resolveChartTab, type ChartTabKey } from '@/components/chart/chartTabs';
import { PatientBanner, useChartBanner } from '@/components/chart/PatientBanner';
import { ClientConsentsCard } from '@/components/consents/ClientConsentsCard';
import { PortalAccessCard } from '@/components/chart/PortalAccessCard';
import { announceChartClient } from '@/components/layout/navStorage';
import { AssessmentsTab, DiagnosesTab, LabsTab, SafetyRiskTab } from '@/components/chart/ClinicalTabs';
import { MedicalTab } from '@/components/chart/MedicalTabs';
import { PreVisitBriefCard } from '@/components/ai/PreVisitBriefCard';
import { MeasuresCard } from '@/components/measures/MeasuresCard';
import {
  isMedicalTabKey,
  isMedicalViewerRole,
  MEDICAL_LABS_PATH,
  MEDICAL_PROBLEM_LIST_PATH,
  MEDICAL_ROLE_CHART_TABS,
  medicalTabAllowed,
  shouldShowMedicalTabs,
} from '@/lib/medical/medicalProgram';
import {
  AccessLogTab,
  AuthorizationsTab,
  CareTeamReferralsTab,
  DischargeTab,
  EligibilityPanel,
  MessagesTab,
  ProgramsTab,
  TreatmentPlanTab,
} from '@/components/chart/OperationsTabs';
import { canAccessClientMessages } from '@/lib/clients/orgScope';
import { isSensitivePrivilegedRole } from '@/lib/privacy/sensitiveRoles';
import { DrugPicker } from '@/components/ui/DrugPicker';
import {
  MEDICATION_SOURCE_OPTIONS,
  medicationSourceLabel,
  type MedicationSource,
} from '@/lib/clinical/medicationSource';

const RISK_TONE: Record<'high' | 'medium' | 'low', Tone> = {
  high: 'danger',
  medium: 'warning',
  low: 'success',
};

const APPT_STATUS_TONE: Record<string, Tone> = {
  scheduled: 'info',
  'checked-in': 'success',
  completed: 'neutral',
  cancelled: 'danger',
  'no-show': 'warning',
};

type Tab = ChartTabKey;

type ClientMedication = {
  id: string;
  clientId: string;
  medicationName: string;
  /** ClientMedication.source when the med is on the medication list */
  source?: string | null;
  dosage: string;
  instructions: string | null;
  doseTimes: string[];
  startDate: string;
  endDate: string | null;
  hasMobileApp?: boolean;
  adherenceStatus?: 'dispensed' | 'partially_dispensed' | 'not_dispensed' | 'transferred' | string;
  adherenceFlag?: 'ok' | 'warning_outreach_needed' | string;
  pharmacyFillNotes?: string | null;
  pharmacyName?: string | null;
  todayDoses?: Array<{
    time: string;
    taken: boolean;
    takenAt: string | null;
    skipped: boolean;
  }>;
};

export const ANTIPSYCHOTIC_DRUGS = [
  'aripiprazole', 'abilify',
  'asenapine', 'saphris',
  'brexpiprazole', 'rexulti',
  'cariprazine', 'vraylar',
  'chlorpromazine', 'thorazine',
  'clozapine', 'clozaril',
  'fluphenazine', 'prolixin',
  'haloperidol', 'haldol',
  'iloperidone', 'fanapt',
  'loxapine', 'loxitane',
  'lurasidone', 'latuda',
  'olanzapine', 'zyprexa',
  'paliperidone', 'invega',
  'perphenazine', 'trilafon',
  'pimavanserin', 'nuplazid',
  'quetiapine', 'seroquel',
  'risperidone', 'risperdal',
  'thioridazine', 'mellaril',
  'thiothixene', 'navane',
  'trifluoperazine', 'stelazine',
  'ziprasidone', 'geodon',
];

export function isAntipsychoticDrug(name: string): boolean {
  if (!name) return false;
  const lower = name.toLowerCase();
  return ANTIPSYCHOTIC_DRUGS.some((drug) => lower.includes(drug));
}

function formatNoteDate(value: string) {
  return new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Practice clock + zone label ("Mon, Oct 19, 9:00 AM ET"), never the viewer's browser zone. */
function formatApptWhen(a: Appointment) {
  return formatApptWhenStaff(a);
}

function riskFromMood(mood: number): 'high' | 'medium' | 'low' {
  if (mood <= 3) return 'high';
  if (mood <= 5) return 'medium';
  return 'low';
}

function canWriteNotes(role?: StaffRole | null) {
  return canWriteClientChartNotes(role);
}

function canWriteCheckIns(role?: StaffRole | null) {
  return (isClinicalStaff(role) && role !== 'PEER_SUPPORT') || role === 'FRONT_DESK';
}

/** Same rule as GET /api/clinical/medications and /api/clients/[id]/medications (canViewClientMedications). */
function canViewMedications(role?: StaffRole | null) {
  return canViewClientMedications(role);
}

/** Same rule as POST /api/clinical/medications (canWriteClientMedications). */
function canWriteMedications(role?: StaffRole | null) {
  return canWriteClientMedications(role);
}

function canEditInsurance(role?: StaffRole | null) {
  return (
    (isClinicalStaff(role) && role !== 'PEER_SUPPORT') ||
    role === 'FRONT_DESK' ||
    role === 'BILLING'
  );
}

function canManagePhoto(role?: StaffRole | null) {
  return (isClinicalStaff(role) && role !== 'PEER_SUPPORT') || role === 'FRONT_DESK';
}

function canSchedule(role?: StaffRole | null) {
  return canAccessPath(role, '/dashboard/appointments');
}

function canMessage(role?: StaffRole | null) {
  return canAccessPath(role, '/dashboard/messages');
}

export default function ClientDetailPage() {
  const params = useParams();
  const rawId = params?.id;
  const id = typeof rawId === 'string' ? rawId : Array.isArray(rawId) ? rawId[0] : '';
  const { user } = useAuth();
  const role = user?.role;

  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const userRoleStr = (user?.role || '').toLowerCase();
  // Same rule as /api/drfirst/sso (src/lib/drfirst/ssoPolicy.ts): opening a patient in DrFirst is for
  // prescribers only; an admin can open DrFirst messages / reports from E-Prescribing, never a chart
  const canPrescribe = isPrescriberRole(userRoleStr);

  const handleEPrescribeClick = async () => {
    if (!client) return;
    // 1. Immediately open empty window on user click to prevent Browser Pop-up Blocker
    const newWindow = window.open('about:blank', '_blank');

    try {
      // The server signs as the signed-in prescriber's own DrFirst username
      const res = await fetch(`/api/drfirst/sso?patient=${encodeURIComponent(client.id)}&screen=patient`);
      const data = await res.json();

      if (!res.ok) {
        if (newWindow) newWindow.close();
        toast.error(data.error || `DrFirst could not be opened (HTTP ${res.status}).`);
        return;
      }
      if (data.url && !data.demo && data.patientSynced === false) {
        toast(
          data.registerNote
            ? `DrFirst opens on patient search: this client could not be sent to DrFirst (${data.registerNote}). Complete the demographics in the chart and launch again.`
            : 'This client is not in DrFirst yet, so DrFirst opens on patient search.'
        );
      }
      if (data.url && !data.demo && newWindow) {
        // Live DrFirst SSO: Navigate newly opened tab
        newWindow.location.href = data.url;
        return;
      }
      if (data.url && !data.demo) {
        // Pop-up blocked: open in this tab instead
        window.location.assign(data.url);
        return;
      }
    } catch (err) {
      if (newWindow) newWindow.close();
      toast.error(err instanceof Error ? `DrFirst could not be opened: ${err.message}` : 'DrFirst could not be opened.');
      return;
    }

    // DrFirst is not configured on this server: say so, then open the internal prescriptions page
    if (newWindow) newWindow.close();
    toast('DrFirst is not configured on this server; opening the internal prescriptions page.');
    const cAny = client as any;
    const clientName = cAny.legalLastName && cAny.legalFirstName
      ? `${cAny.legalLastName}, ${cAny.legalFirstName}`
      : client.name;
    window.location.assign(
      `/dashboard/ehr/prescriptions?clientId=${encodeURIComponent(client.id)}&clientName=${encodeURIComponent(clientName)}`
    );
  };

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tabParam = searchParams?.get('tab') ?? null;
  const [activeTab, setActiveTabState] = useState<Tab>('summary');
  // ?tab= deep links: the URL is the source of truth; clicking a tab rewrites it without scrolling
  const setActiveTab = (tab: Tab) => {
    setActiveTabState(tab);
    const qs = new URLSearchParams(searchParams?.toString() ?? '');
    if (tab === 'summary') qs.delete('tab');
    else qs.set('tab', tab);
    const next = qs.toString();
    router.replace(next ? `${pathname}?${next}` : pathname || '', { scroll: false });
  };
  const [noteText, setNoteText] = useState('');
  const [bannerNonce, setBannerNonce] = useState(0);
  const [notes, setNotes] = useState<ClientProgressNote[]>([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [client, setClient] = useState<Client | null>(null);
  const [loading, setLoading] = useState(true);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsBreakGlass, setNeedsBreakGlass] = useState(false);
  const [btgReason, setBtgReason] = useState('');
  const [btgBusy, setBtgBusy] = useState(false);
  const [btgError, setBtgError] = useState<string | null>(null);
  const [loadNonce, setLoadNonce] = useState(0);
  // Sticky patient banner (GET /api/clients/[id]/banner); also sets document.title for breadcrumbs
  const { banner, error: bannerError } = useChartBanner(id, loadNonce + bannerNonce);
  // Nav breadcrumbs / Recent clients: id, display name and MRN only
  const chartClientId = client?.id;
  const chartClientName = client?.name;
  const chartClientMrn = client?.mrn ?? null;
  useEffect(() => {
    if (chartClientId && chartClientName) announceChartClient({ id: chartClientId, name: chartClientName, mrn: chartClientMrn });
  }, [chartClientId, chartClientName, chartClientMrn]);

  // Office Notes (Staff Operational Notes)
  type OfficeNoteCategory = 'Scheduling' | 'Billing' | 'Contact Preference' | 'Transportation' | 'General';
  const [officeNotes, setOfficeNotes] = useState<Array<{
    id: string;
    category: OfficeNoteCategory;
    noteText: string;
    authorName: string;
    authorRole: string;
    isPinned: boolean;
    createdAt: string;
  }>>([]);
  const [officeNotesLoading, setOfficeNotesLoading] = useState(false);
  const [officeNoteText, setOfficeNoteText] = useState('');
  const [officeNoteCat, setOfficeNoteCat] = useState<OfficeNoteCategory>('General');
  const [officeNoteSaving, setOfficeNoteSaving] = useState(false);

  const handleAddOfficeNote = async () => {
    if (!officeNoteText.trim() || officeNoteSaving || !client) return;
    setOfficeNoteSaving(true);
    try {
      const res = await fetch(`/api/clients/${encodeURIComponent(client.id)}/office-notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: officeNoteCat,
          noteText: officeNoteText.trim(),
          authorName: user?.name || user?.displayName || 'Staff Clinician',
          authorRole: user?.role || 'CLINICIAN',
          isPinned: false,
        }),
      });
      const data = await res.json();
      if (data.success && data.data) {
        setOfficeNotes(prev => [data.data, ...prev]);
        setOfficeNoteText('');
      }
    } catch (err) {
      console.error('Failed to save office note:', err);
    } finally {
      setOfficeNoteSaving(false);
    }
  };

  const handleTogglePinOfficeNote = async (noteId: string, currentPin: boolean) => {
    try {
      const nextPin = !currentPin;
      setOfficeNotes(prev => prev.map(n => n.id === noteId ? { ...n, isPinned: nextPin } : n).sort((a, b) => (b.isPinned ? 1 : 0) - (a.isPinned ? 1 : 0)));
      await fetch(`/api/clients/${encodeURIComponent(id)}/office-notes`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ noteId, isPinned: nextPin }),
      });
    } catch {}
  };

  const handleDeleteOfficeNote = async (noteId: string) => {
    try {
      setOfficeNotes(prev => prev.filter(n => n.id !== noteId));
      await fetch(`/api/clients/${encodeURIComponent(id)}/office-notes?noteId=${encodeURIComponent(noteId)}`, {
        method: 'DELETE',
      });
    } catch {}
  };

  useEffect(() => {
    if (!id || activeTab !== 'office-notes') return;
    setOfficeNotesLoading(true);
    fetch(`/api/clients/${encodeURIComponent(id)}/office-notes`)
      .then(res => res.json())
      .then(data => {
        if (data.data && Array.isArray(data.data)) {
          setOfficeNotes(data.data);
        }
      })
      .catch(() => {})
      .finally(() => setOfficeNotesLoading(false));
  }, [id, activeTab]);

  const [mood, setMood] = useState(5);
  const [stress, setStress] = useState(5);
  const [sleep, setSleep] = useState(5);
  const [checkInNote, setCheckInNote] = useState('');
  const [checkInSaving, setCheckInSaving] = useState(false);
  const [checkInError, setCheckInError] = useState<string | null>(null);

  const [medications, setMedications] = useState<ClientMedication[]>([]);
  const [medsLoading, setMedsLoading] = useState(false);
  const [medsError, setMedsError] = useState<string | null>(null);
  const [medName, setMedName] = useState('');
  /** RxCUI chosen in the drug typeahead (null = free text, not coded) */
  const [medRxcui, setMedRxcui] = useState<string | null>(null);
  const [medTty, setMedTty] = useState<string | null>(null);
  const [medDosage, setMedDosage] = useState('');
  const [medSource, setMedSource] = useState<MedicationSource>('outside_provider');
  const [medInstructions, setMedInstructions] = useState('');
  const [medTimes, setMedTimes] = useState('08:00, 20:00');
  const [medSaving, setMedSaving] = useState(false);

  // Clinical Safety Monitor: Antipsychotic QTc / EKG Protocol
  const [safetyCheck, setSafetyCheck] = useState<{
    needsEkg: boolean;
    antipsychoticCount: number;
    antipsychotics: Array<{ id: string; name: string; dosage?: string }>;
  }>({ needsEkg: false, antipsychoticCount: 0, antipsychotics: [] });

  const activeAntipsychotics = useMemo(() => {
    return medications.filter((m) => isAntipsychoticDrug(m.medicationName));
  }, [medications]);

  const needsEkg = safetyCheck.needsEkg || activeAntipsychotics.length >= 2;
  const ekgAntipsychoticsCount = Math.max(safetyCheck.antipsychoticCount, activeAntipsychotics.length);

  // Care Team Tagging in Notes
  const [noteType, setNoteType] = useState<
    'Progress Note' | 'Clinical Concern' | 'Care Coordination' | 'Team Communication'
  >('Progress Note');
  const [taggedStaffId, setTaggedStaffId] = useState('');
  const [taggedUrgency, setTaggedUrgency] = useState<'Urgent' | 'Routine' | 'FYI'>('Routine');

  const [insurancePayer, setInsurancePayer] = useState('');
  const [insuranceMemberId, setInsuranceMemberId] = useState('');
  const [insuranceGroupNumber, setInsuranceGroupNumber] = useState('');
  const [insuranceSaving, setInsuranceSaving] = useState(false);
  const [insuranceError, setInsuranceError] = useState<string | null>(null);
  const [insuranceSaved, setInsuranceSaved] = useState(false);

  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [appointmentsLoading, setAppointmentsLoading] = useState(false);
  const [appointmentsError, setAppointmentsError] = useState<string | null>(null);


  const canAssignClinician =
    user?.role === 'SUPER_ADMIN' ||
    user?.role === 'ADMIN' ||
    user?.role === 'PRACTICE_DIRECTOR' ||
    user?.role === 'DIRECTOR' ||
    user?.baseRole === 'ADMIN' ||
    user?.baseRole === 'SUPER_ADMIN';

  const [editModalOpen, setEditModalOpen] = useState(false);
  // The chart only loads for staff on the client's care team (server rule), so a caseload role
  // that can see it may edit the profile fields its role allows (status / team stay primary-only, server-enforced).
  const canEditClient = canEditClientProfile(role);

  const reloadClient = async () => {
    if (!id) return;
    try {
      const data = await fetchClient(id);
      if (data) {
        setClient(data);
        setInsurancePayer(data.insurancePayer || '');
        setInsuranceMemberId(data.insuranceMemberId || '');
        setInsuranceGroupNumber(data.insuranceGroupNumber || '');
      }
    } catch {
      // Ignore
    }
  };

  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [assigningClinicianId, setAssigningClinicianId] = useState('');
  const [assignSaving, setAssignSaving] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [staffDirectory, setStaffDirectory] = useState<
    Array<{ id: string; name: string; role: string; status?: string }>
  >([]);

  // Multi-Provider Treatment Team State (Commit 7fba6e5)
  const [treatmentTeam, setTreatmentTeam] = useState<TreatmentTeamMember[]>([]);
  const [showAddMember, setShowAddMember] = useState(false);
  const [teamSaving, setTeamSaving] = useState(false);

  // Same rule as the care-team / treatment-team APIs (canManageCareTeam): leadership, a Medical
  // Director, the assign roles, or this client's primary clinician. Other care-team members see the team.
  const canManageTeam =
    canEditClientProfile(role) &&
    (canManageCareTeam({ role, userId: user?.id ?? '' }, { assignedToId: client?.assignedToId ?? null }) ||
      medicalDirectorActive(role, user));

  const organizationRoster: TreatmentTeamMember[] = useMemo(() => {
    const palette = ['#5C2D91', '#0284C7', '#10B981', '#7C3AED', '#F59E0B', '#EC4899', '#0891B2', '#5C2D91'];
    // No sample providers — roster comes only from the staff directory.
    const demoFallbacks: TreatmentTeamMember[] = [];

    const mappedDirectory: TreatmentTeamMember[] = staffDirectory.map((s, idx) => {
      const parts = (s.name || '').trim().split(' ').filter(Boolean);
      const initials =
        parts.length >= 2
          ? `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
          : (s.name || 'MD').slice(0, 2).toUpperCase();
      const roleStr = String(s.role || 'Clinician');
      const formattedRole =
        roleStr === 'THERAPIST'
          ? 'Therapist'
          : roleStr === 'PSYCHIATRIST'
          ? 'Psychiatrist'
          : roleStr === 'NP' || roleStr === 'MEDICAL_NP'
          ? 'Nurse Practitioner'
          : roleStr === 'CASE_MANAGER'
          ? 'Case Manager'
          : roleStr === 'PEER_SUPPORT'
          ? 'Peer Support'
          : roleStr === 'PRP_SPECIALIST'
          ? 'PRP Specialist'
          : roleStr === 'PHYSICIAN'
          ? 'Physician'
          : roleStr;
      return {
        id: s.id,
        name: s.name,
        role: formattedRole,
        initials,
        color: palette[idx % palette.length],
        primary: false,
      };
    });

    const combined = [...mappedDirectory];
    for (const demo of demoFallbacks) {
      if (!combined.some((m) => m.name.toLowerCase() === demo.name.toLowerCase())) {
        combined.push(demo);
      }
    }
    return combined;
  }, [staffDirectory]);

  const handleAddTeamMember = async (member: TreatmentTeamMember) => {
    if (!client || teamSaving) return;
    const nextMember: TreatmentTeamMember = {
      ...member,
      primary: false,
    };
    const updatedTeam = [...treatmentTeam, nextMember];
    setTreatmentTeam(updatedTeam);
    setShowAddMember(false);
    setTeamSaving(true);
    try {
      await fetch(`/api/clients/${client.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ treatmentTeam: updatedTeam }),
      });
      await fetch(`/api/clients/${client.id}/care-team`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nextMember),
      }).catch(() => undefined);
    } catch (err) {
      console.error('Failed to persist treatment team member:', err);
    } finally {
      setTeamSaving(false);
    }
  };

  const handleRemoveTeamMember = async (memberId: string) => {
    if (!client || teamSaving) return;
    const updatedTeam = treatmentTeam.filter((m) => m.id !== memberId);
    setTreatmentTeam(updatedTeam);
    setTeamSaving(true);
    try {
      await fetch(`/api/clients/${client.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ treatmentTeam: updatedTeam }),
      });
      await fetch(`/api/clients/${client.id}/care-team?memberId=${encodeURIComponent(memberId)}`, {
        method: 'DELETE',
      }).catch(() => undefined);
    } catch (err) {
      console.error('Failed to persist treatment team removal:', err);
    } finally {
      setTeamSaving(false);
    }
  };


  // Section 5.1: Chart Flag Chips State
  const [chartFlags, setChartFlags] = useState<string[]>([]);
  const [showFlagModal, setShowFlagModal] = useState(false);
  const [newFlagName, setNewFlagName] = useState('');

  // Section 5.1: Client Documents: filed through Smart Document Intake
  const [clientDocuments, setClientDocuments] = useState<
    Array<{
      id: string; name: string; category: string; size: string; uploadedAt: string; url: string | null; filesTo: string;
      documentDate?: string | null; source?: string; readOnly?: boolean; canVoid?: boolean;
    }>
  >([]);
  const [documentsError, setDocumentsError] = useState<string | null>(null);
  const [documentsReload, setDocumentsReload] = useState(0);

  // Imported (Valant) records are read-only; leadership can void one with a reason (kept, never deleted)
  const voidDocument = async (docId: string) => {
    const reason = window.prompt('Reason for voiding this imported record (kept for the legal record):')?.trim();
    if (!reason) return;
    try {
      const res = await fetch('/api/ehr/doc-intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: docId, action: 'void', reason }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setDocumentsReload((n) => n + 1);
    } catch (err: unknown) {
      setDocumentsError(err instanceof Error ? err.message : 'Could not void the record');
    }
  };

  useEffect(() => {
    if (activeTab !== 'documents' || !client?.id) return;
    let cancelled = false;
    setDocumentsError(null);
    fetch(`/api/clients/${encodeURIComponent(client.id)}/documents`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error === 'SENSITIVE_RECORD' ? 'Protected record: documents need break-the-glass access' : data.error || `HTTP ${res.status}`);
        }
        if (!cancelled) setClientDocuments(Array.isArray(data.documents) ? data.documents : []);
      })
      .catch((err: unknown) => {
        if (!cancelled) setDocumentsError(err instanceof Error ? err.message : 'Could not load documents');
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, client?.id, documentsReload]);

  useEffect(() => {
    async function loadDirectory() {
      try {
        const res = await fetch('/api/staff/directory');
        const data = await res.json();
        if (data.success && Array.isArray(data.users)) {
          setStaffDirectory(data.users);
        }
      } catch (err) {
        console.error('Failed to load staff directory:', err);
      }
    }
    void loadDirectory();
  }, []);

  const handleAssignClinician = async () => {
    if (!client) return;
    setAssignSaving(true);
    setAssignError(null);
    try {
      const res = await fetch(`/api/clients/${client.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assignedToId: assigningClinicianId || null,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to update assigned clinician');
      }

      const assignedStaff = staffDirectory.find((s) => s.id === assigningClinicianId);
      setClient((prev) =>
        prev
          ? {
              ...prev,
              assignedToId: assigningClinicianId || null,
              assignedToName: assignedStaff ? assignedStaff.name : null,
            }
          : null
      );
      setAssignModalOpen(false);
      setBannerNonce((n) => n + 1);
    } catch (err: any) {
      setAssignError(err.message || 'Could not assign clinician');
    } finally {
      setAssignSaving(false);
    }
  };

  const [portalInviteSending, setPortalInviteSending] = useState(false);

  const handleSendPortalInvite = async () => {
    if (!client?.id || !client.email || portalInviteSending) return;
    setPortalInviteSending(true);
    try {
      const data = await sendPortalInvite(client.id);
      if (!data.success) {
        throw new Error(data.error || 'Failed to send portal invitation');
      }
      toast.success(data.message || `Portal invitation sent to ${client.email}`);
      setClient((prev) => (prev ? { ...prev, appAccess: 'invite_sent' } : null));
    } catch (err: any) {
      toast.error(err.message || 'Could not send portal invitation');
    } finally {
      setPortalInviteSending(false);
    }
  };

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setNeedsBreakGlass(false);
    setBtgError(null);
    fetchClient(id)
      .then((data) => {
        if (cancelled) return;
        if (!data) {
          setError('Client not found');
          setClient(null);
          return;
        }
        setNeedsBreakGlass(false);
        setClient(data);
        setInsurancePayer(data.insurancePayer || '');
        setInsuranceMemberId(data.insuranceMemberId || '');
        setInsuranceGroupNumber(data.insuranceGroupNumber || '');

        // Initialize treatment team (array or default)
        if (Array.isArray(data.treatmentTeam) && data.treatmentTeam.length > 0) {
          setTreatmentTeam(data.treatmentTeam as TreatmentTeamMember[]);
        } else if (data.assignedToName) {
          const parts = data.assignedToName.trim().split(' ').filter(Boolean);
          const initials =
            parts.length >= 2
              ? `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
              : data.assignedToName.slice(0, 2).toUpperCase();
          setTreatmentTeam([
            {
              id: data.assignedToId || 'primary-1',
              name: data.assignedToName,
              role: 'Primary Clinician',
              initials: initials || 'PC',
              color: '#5C2D91',
              primary: true,
            },
          ]);
        } else {
          setTreatmentTeam([]);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          const msg = err.message || 'Failed to load client';
          setClient(null);
          if (msg === 'SENSITIVE_RECORD' || /break.?glass|sensitive record/i.test(msg)) {
            setNeedsBreakGlass(true);
            setError('Sensitive record — break-glass required');
          } else {
            setNeedsBreakGlass(false);
            setError(msg);
          }
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, loadNonce]);

  const submitBreakGlass = async () => {
    if (!id) return;
    if (btgReason.trim().length < 15) {
      setBtgError('Reason must be at least 15 characters');
      return;
    }
    setBtgBusy(true);
    setBtgError(null);
    try {
      await apiJson(`/api/sensitive-records/${id}/break-glass`, {
        method: 'POST',
        body: JSON.stringify({ reason: btgReason.trim() }),
      });
      setBtgReason('');
      setNeedsBreakGlass(false);
      setLoadNonce((n) => n + 1);
    } catch (err: unknown) {
      setBtgError(err instanceof Error ? err.message : 'Break-glass request failed');
    } finally {
      setBtgBusy(false);
    }
  };

  useEffect(() => {
    if (!id) return;
    if (!canAccessClientChartNotes(role)) {
      setNotes([]);
      setNotesLoading(false);
      return;
    }
    let cancelled = false;
    setNotesLoading(true);
    setNoteError(null);
    fetchClientNotes(id)
      .then((data) => {
        if (!cancelled) setNotes(data);
      })
      .catch((err: Error) => {
        if (!cancelled) setNoteError(err.message || 'Failed to load notes');
      })
      .finally(() => {
        if (!cancelled) setNotesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, role]);

  useEffect(() => {
    if (!id || activeTab !== 'appointments') return;
    let cancelled = false;
    setAppointmentsLoading(true);
    setAppointmentsError(null);
    fetchAppointments({ clientId: id })
      .then((data) => {
        if (!cancelled) setAppointments(data);
      })
      .catch((err: Error) => {
        if (!cancelled) setAppointmentsError(err.message || 'Failed to load appointments');
      })
      .finally(() => {
        if (!cancelled) setAppointmentsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, activeTab]);

  // Bumped when this chart was refreshed from DrFirst (return from Rcopia / Refresh from DrFirst)
  const [medsNonce, setMedsNonce] = useState(0);
  useEffect(() => {
    if (!id) return;
    const onSynced = (e: Event) => {
      if ((e as CustomEvent<DrFirstSyncedDetail>).detail?.clientId === id) setMedsNonce((n) => n + 1);
    };
    window.addEventListener(DRFIRST_SYNCED_EVENT, onSynced);
    return () => window.removeEventListener(DRFIRST_SYNCED_EVENT, onSynced);
  }, [id]);

  useEffect(() => {
    if (!id || activeTab !== 'medications' || !canViewMedications(role)) return;
    let cancelled = false;
    setMedsLoading(true);
    setMedsError(null);
    fetch(`/api/clinical/medications?clientId=${encodeURIComponent(id)}`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.success === false) {
          throw new Error(data.error || 'Failed to load medications');
        }
        if (!cancelled) setMedications(Array.isArray(data.medications) ? data.medications : []);
      })
      .catch((err: Error) => {
        if (!cancelled) setMedsError(err.message || 'Failed to load medications');
      })
      .finally(() => {
        if (!cancelled) setMedsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, activeTab, role, medsNonce]);

  const [treatmentPlans, setTreatmentPlans] = useState<any[]>([]);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/ehr/treatment-plans?clientId=${encodeURIComponent(id)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.plans) setTreatmentPlans(data.plans);
      })
      .catch(() => {});

    fetch(`/api/clients/${encodeURIComponent(id)}/safety-check`)
      .then((r) => r.json())
      .then((data) => {
        if (data && data.success) {
          setSafetyCheck({
            needsEkg: Boolean(data.needsEkg),
            antipsychoticCount: Number(data.antipsychoticCount) || 0,
            antipsychotics: Array.isArray(data.antipsychotics) ? data.antipsychotics : [],
          });
        }
      })
      .catch(() => {});
  }, [id]);

  // Plain derivations (cheap); manual memo here blocked the React Compiler
  const isSudClient = (() => {
    if (!client) return false;
    const combined = `${client.primaryDiagnosisCode || ''} ${client.primaryDiagnosis || ''} ${client.secondaryDiagnoses || ''}`.toLowerCase();
    return /f10|f11|f12|f13|f14|f15|f16|f18|f19|substance|alcohol|opioid|cannabis|sedative|cocaine|sud/i.test(combined);
  })();

  // Plans imported from Valant carry no goals; the chart says where their content lives
  const importedPlans = useMemo(
    () =>
      treatmentPlans
        .filter((p) => p.status !== 'CLOSED' && p.status !== 'EXPIRED')
        .map((p) => ({ id: String(p.id), status: String(p.status || ''), reviewDueAt: p.reviewDueAt as string | null, source: (p.source ?? null) as ImportedPlanSource | null }))
        .filter((p): p is typeof p & { source: ImportedPlanSource } => Boolean(p.source)),
    [treatmentPlans]
  );

  const [pageOpenedAt] = useState(() => Date.now());
  const isPlanReviewOverdue = treatmentPlans.some((p) => p.reviewDueAt && new Date(p.reviewDueAt).getTime() < pageOpenedAt);

  const checkIns: ClientCheckIn[] = client?.checkIns ?? [];

  const chartData = checkIns.slice(-7).map((c) => ({
    date: c.date,
    mood: c.mood,
    stress: c.stress,
    sleep: c.sleep ?? null,
  }));

  const overviewAlerts = (() => {
    if (!client) return [] as { title: string; when: string }[];
    const items: { title: string; when: string }[] = [];
    if (client.risk === 'high') {
      items.push({ title: 'High risk status on file', when: 'Current' });
    }
    const last = checkIns[checkIns.length - 1];
    if (last && last.mood <= 3) {
      items.push({
        title: 'Low mood on latest check-in',
        when: last.date || 'Recent',
      });
    }
    if (last && last.stress >= 8) {
      items.push({
        title: 'Elevated stress on latest check-in',
        when: last.date || 'Recent',
      });
    }
    if (last && last.sleep != null && last.sleep <= 3) {
      items.push({
        title: 'Poor sleep on latest check-in',
        when: last.date || 'Recent',
      });
    }
    const crisis = [...checkIns]
      .reverse()
      .find((c) => /crisis|suicid|harm|urgent/i.test(c.note || ''));
    if (crisis) {
      items.push({
        title: 'Crisis keywords detected in check-in note',
        when: crisis.date || 'Recent',
      });
    }
    return items.slice(0, 4);
  })();

  const allowNotesWrite = canWriteNotes(role);
  const allowCheckInsWrite = canWriteCheckIns(role);
  const allowMedsView = canViewMedications(role);
  const allowMedsWrite = canWriteMedications(role);
  const allowInsuranceEdit = canEditInsurance(role);
  const allowPhoto = canManagePhoto(role);
  const allowSchedule = canSchedule(role);
  const allowMsg = canMessage(role);
  const allowConsents = canAccessPath(role, '/dashboard/ehr/consents');
  const allowEligibility = canAccessPath(role, '/dashboard/ehr/eligibility');
  // Valant reference balances (billing roles) and copay rules (anyone who collects payments)
  const allowValantReference =
    canAccessPath(role, '/dashboard/billing/valant-balances') || canAccessPath(role, '/dashboard/billing/payments');
  // Medical tab group: primary-care patient (records, intake, Valant Family Practice) or a medical viewer.
  // Location alone never counts: Silver Spring and Bowie also run behavioral health.
  const bannerData = banner && banner.locked === false ? banner : null;
  const showMedical = shouldShowMedicalTabs({
    primaryCarePatient: Boolean(bannerData?.primaryCarePatient),
    role,
  });
  const medicalViewer = isMedicalViewerRole(role);
  // Per-tab visibility: same rule as the practice-wide page each tab links to
  const tabAllowed: Record<Tab, boolean> = {
    summary: true,
    notes: canAccessClientChartNotes(role),
    'office-notes': true,
    'check-ins': allowCheckInsWrite,
    appointments: true,
    'treatment-plan': canAccessPath(role, '/dashboard/ehr/treatment-plans'),
    assessments: canAccessPath(role, '/dashboard/ehr/assessments'),
    // Problem list for primary care roles is in this tab (problems only, no BH diagnoses)
    diagnoses: canAccessPath(role, '/dashboard/ehr/diagnoses') || (showMedical && canAccessPath(role, MEDICAL_PROBLEM_LIST_PATH)),
    medications: allowMedsView,
    // One Labs tab for BH and primary-care lab orders (same LabOrder model)
    labs: canAccessPath(role, '/dashboard/ehr/labs') || (showMedical && canAccessPath(role, MEDICAL_LABS_PATH)),
    safety: canAccessPath(role, '/dashboard/alerts') || canAccessPath(role, '/dashboard/ehr/safety-plan'),
    documents: true,
    authorizations: canAccessPath(role, '/dashboard/billing/authorizations'),
    billing: true,
    'care-team': true,
    messages: canAccessClientMessages(role),
    programs: true,
    discharge: true,
    'access-log': isSensitivePrivilegedRole(role),
    'medical-visits': showMedical && medicalTabAllowed('medical-visits', role),
    'medical-vitals': showMedical && medicalTabAllowed('medical-vitals', role),
    'medical-preventive': showMedical && medicalTabAllowed('medical-preventive', role),
    'medical-history': showMedical && medicalTabAllowed('medical-history', role),
    'medical-orders': showMedical && medicalTabAllowed('medical-orders', role),
    'medical-ai': showMedical && medicalTabAllowed('medical-ai', role),
  };
  const visibleTabs: Tab[] = CHART_TABS.map((t) => t.key).filter((key) =>
    role === 'PEER_SUPPORT'
      ? key === 'summary' || key === 'check-ins'
      : medicalViewer
        ? MEDICAL_ROLE_CHART_TABS.includes(key) && tabAllowed[key]
        : tabAllowed[key]
  );
  const visibleTabsKey = visibleTabs.join(',');

  useEffect(() => {
    // Medical roles have no Summary tab: they open on Visits & SOAP
    setActiveTabState(resolveChartTab(tabParam ?? (medicalViewer ? 'medical-visits' : null), visibleTabsKey.split(',') as Tab[]));
  }, [tabParam, visibleTabsKey, medicalViewer]);

  if (loading) {
    return (
      <LoadingState label="Loading client…" className="min-h-[40vh]" />
    );
  }

  if (error || !client) {
    return (
      <div className="mx-auto mt-6 max-w-lg space-y-4 text-center">
        {needsBreakGlass && banner?.locked ? <PatientBanner banner={banner} error={null} /> : null}
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-800">
          <Lock className="h-5 w-5" aria-hidden />
        </div>
        <p className="text-lg font-semibold text-slate-900">{error || 'Client not found'}</p>
        {needsBreakGlass ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-left">
            <p className="text-sm font-semibold text-amber-950">Break the Glass</p>
            <p className="mt-1 text-xs text-amber-800">
              Emergency PHI access for this protected client expires in 24 hours. Your reason is
              audited.
            </p>
            <label className="mt-3 block text-sm font-medium text-slate-700">
              Clinical / emergency reason (min 15 characters)
              <textarea
                value={btgReason}
                onChange={(e) => setBtgReason(e.target.value)}
                rows={4}
                className={cx(inputClasses, 'mt-1')}
                placeholder="Describe why emergency PHI access is required…"
              />
            </label>
            {btgError ? <p role="alert" className="mt-2 text-xs font-semibold text-rose-700">{btgError}</p> : null}
            <Button
              size="lg"
              icon={<Lock />}
              disabled={btgBusy}
              onClick={() => void submitBreakGlass()}
              className="mt-3 w-full"
            >
              {btgBusy ? 'Granting…' : 'Confirm break-glass access'}
            </Button>
          </div>
        ) : null}
        <Link
          href="/dashboard/clients"
          className="inline-block text-sm font-semibold text-blue-600 hover:text-blue-700"
        >
          Back to clients
        </Link>
      </div>
    );
  }

  const avgMood =
    client.avgMood != null
      ? String(client.avgMood)
      : checkIns.length
        ? (checkIns.reduce((s, c) => s + (c.mood ?? 0), 0) / checkIns.length).toFixed(1)
        : '—';
  const avgStress =
    client.avgStress != null
      ? String(client.avgStress)
      : checkIns.length
        ? (checkIns.reduce((s, c) => s + (c.stress ?? 0), 0) / checkIns.length).toFixed(1)
        : '—';
  const sleepScores = checkIns
    .map((c) => c.sleep)
    .filter((s): s is number => s != null);
  const avgSleep =
    client.avgSleep != null
      ? String(client.avgSleep)
      : sleepScores.length
        ? (sleepScores.reduce((s, n) => s + n, 0) / sleepScores.length).toFixed(1)
        : '—';
  const streak = client.checkInStreak ?? client.streak ?? 0;

  const diagnoses = [
    client.primaryDiagnosisCode
      ? `${client.primaryDiagnosisCode}${client.primaryDiagnosis ? ` · ${client.primaryDiagnosis}` : ''}`
      : client.primaryDiagnosis,
    client.secondaryDiagnoses,
  ].filter(Boolean) as string[];

  const address = [client.addressLine1, client.city, client.state, client.postalCode]
    .filter(Boolean)
    .join(', ');

  const onPickPhoto = async (file: File | null) => {
    if (!file || !allowPhoto || !client) return;
    setPhotoError(null);
    setPhotoBusy(true);
    try {
      const updated = await uploadClientAvatar(client.id, file);
      setClient((prev) => (prev ? { ...prev, image: updated.image } : prev));
    } catch (err: any) {
      setPhotoError(err.message || 'Could not upload client photo');
    } finally {
      setPhotoBusy(false);
    }
  };

  const onRemovePhoto = async () => {
    if (!allowPhoto || !client) return;
    setPhotoError(null);
    setPhotoBusy(true);
    try {
      await removeClientAvatar(client.id);
      setClient((prev) => (prev ? { ...prev, image: null } : prev));
    } catch (err: any) {
      setPhotoError(err.message || 'Could not remove client photo');
    } finally {
      setPhotoBusy(false);
    }
  };

  const onSaveNote = async () => {
    const body = noteText.trim();
    if (!body || noteSaving || !allowNotesWrite || !client) return;
    setNoteError(null);
    setNoteSaving(true);
    try {
      // Chart notes carry the category picked above and today's date of service
      const now = new Date();
      const dateOfService = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const note = await createClientNote(client.id, body, { noteType, dateOfService });
      setNotes((prev) => [note, ...prev]);

      // If colleague tagged in Clinical Concern / Care Coordination / Team Communication, post live DB alert
      if (noteType !== 'Progress Note' && taggedStaffId) {
        await fetch('/api/alerts/team', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientId: client.id,
            targetUserId: taggedStaffId,
            urgency: taggedUrgency,
            noteType: noteType,
            message: body,
          }),
        }).catch((err) => console.error('Failed to post team alert:', err));
      }

      setNoteText('');
      setTaggedStaffId('');
      setNoteType('Progress Note');
    } catch (err: any) {
      setNoteError(err.message || 'Could not save note');
    } finally {
      setNoteSaving(false);
    }
  };

  const onSaveMedication = async () => {
    if (medSaving || !allowMedsWrite || !client) return;
    const medicationName = medName.trim();
    const dosage = medDosage.trim();
    const doseTimes = medTimes
      .split(/[,;\s]+/)
      .map((t) => t.trim())
      .filter(Boolean);
    if (!medicationName || !dosage) {
      setMedsError('Medication name and dosage are required');
      return;
    }
    if (doseTimes.length === 0 || doseTimes.some((t) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(t))) {
      setMedsError('Dose times must be HH:MM (e.g. 08:00, 13:00, 20:00)');
      return;
    }
    setMedsError(null);
    setMedSaving(true);
    try {
      const res = await fetch('/api/clinical/medications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: client.id,
          medicationName,
          dosage,
          instructions: medInstructions.trim() || undefined,
          doseTimes,
          daysSupply: 30,
          notifyPatient: true,
          source: medSource,
          ...(medRxcui ? { rxcui: medRxcui } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) {
        throw new Error(data.error || 'Could not save medication');
      }
      if (data.drugCodeWarning) {
        setMedsError(`Saved: ${data.drugCodeWarning}`);
      } else if (data.notifySkipReason) {
        setMedsError(`Saved, but push not sent: ${data.notifySkipReason}`);
      } else {
        setMedsError(null);
      }
      setMedName('');
      setMedRxcui(null);
      setMedTty(null);
      setMedDosage('');
      setMedSource('outside_provider');
      setMedInstructions('');
      setMedTimes('08:00, 20:00');
      const refresh = await fetch(
        `/api/clinical/medications?clientId=${encodeURIComponent(client.id)}`
      );
      const refreshJson = await refresh.json().catch(() => ({}));
      if (refresh.ok && Array.isArray(refreshJson.medications)) {
        setMedications(refreshJson.medications);
      }
    } catch (err: any) {
      setMedsError(err.message || 'Could not save medication');
    } finally {
      setMedSaving(false);
    }
  };

  const onSaveCheckIn = async () => {
    if (checkInSaving || !allowCheckInsWrite || !client) return;
    setCheckInError(null);
    setCheckInSaving(true);
    try {
      const result = await createClientCheckIn(client.id, {
        mood,
        stress,
        sleep,
        note: checkInNote.trim() || null,
      });
      const entry: ClientCheckIn = {
        id: result.checkIn.id,
        date:
          (result.checkIn as { dateLabel?: string }).dateLabel ||
          result.checkIn.date ||
          new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        dateKey: result.checkIn.date,
        mood: result.checkIn.mood,
        stress: result.checkIn.stress,
        sleep: result.checkIn.sleep ?? null,
        note: result.checkIn.note,
        createdAt: result.checkIn.createdAt,
      };
      const riskMap = { HIGH: 'high', MEDIUM: 'medium', LOW: 'low' } as const;
      setClient((prev) =>
        prev
          ? {
              ...prev,
              checkIns: [...(prev.checkIns || []), entry],
              checkInStreak: result.client.checkInStreak,
              streak: result.client.checkInStreak,
              avgMood: result.client.avgMood,
              avgStress: result.client.avgStress,
              avgSleep: result.client.avgSleep,
              risk: riskMap[result.client.riskLevel],
            }
          : prev
      );
      setCheckInNote('');
      setBannerNonce((n) => n + 1);
      setMood(5);
      setStress(5);
      setSleep(5);
    } catch (err: any) {
      setCheckInError(err.message || 'Could not save check-in');
    } finally {
      setCheckInSaving(false);
    }
  };

  const onSaveInsurance = async () => {
    if (insuranceSaving || !allowInsuranceEdit || !client) return;
    setInsuranceError(null);
    setInsuranceSaved(false);
    setInsuranceSaving(true);
    try {
      await updateClientInsurance(client.id, {
        insurancePayer,
        insuranceMemberId,
        insuranceGroupNumber,
      });
      // Re-read from DB so refresh-proof values are what the UI shows
      const refreshed = await fetchClient(client.id);
      if (refreshed) {
        setClient(refreshed);
        setInsurancePayer(refreshed.insurancePayer || '');
        setInsuranceMemberId(refreshed.insuranceMemberId || '');
        setInsuranceGroupNumber(refreshed.insuranceGroupNumber || '');
      }
      setInsuranceSaved(true);
      setBannerNonce((n) => n + 1);
    } catch (err: any) {
      setInsuranceError(err.message || 'Could not save insurance');
    } finally {
      setInsuranceSaving(false);
    }
  };

  return (
    <Page>
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2 text-sm text-slate-500">
        {/* ?from=medical: opened from the Primary care patients list */}
        {searchParams?.get('from') === 'medical' ? (
          <Link href="/dashboard/medical/patients" className="rounded font-medium hover:text-blue-700">
            Back to Primary care patients
          </Link>
        ) : (
          <Link href="/dashboard/clients" className="rounded font-medium hover:text-blue-700">
            Clients
          </Link>
        )}
        <ChevronRight size={14} className="shrink-0 text-slate-400" aria-hidden />
        <span className="truncate font-semibold text-slate-900" aria-current="page">{client.name}</span>
      </nav>

      <PatientBanner banner={banner} error={bannerError} onChanged={() => setBannerNonce((n) => n + 1)} />

      {/* 42 CFR Part 2 Confidentiality Notice */}
      {isSudClient && (
        <Alert tone="warning" title="42 CFR Part 2 Protected Record">
          This client has a substance use disorder diagnosis. Federal regulations (42 CFR Part 2) strictly prohibit unauthorized disclosure or re-disclosure of these records without specific Part 2 signed consent. A general HIPAA Release of Information is not sufficient.
        </Alert>
      )}

      {/* Profile header */}
      <Card className="p-4 sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <ClientAvatar name={client.name} image={client.image} className="h-16 w-16 shrink-0 text-xl" />
          <PageHeader
            className="min-w-0 flex-1"
            title={chartLegalName(client) ?? client.name}
            badges={
              <>
                <StatusBadge
                  tone={RISK_TONE[client.risk] ?? RISK_TONE.low}
                  icon={client.risk === 'high' ? <AlertTriangle /> : undefined}
                  className="capitalize"
                >
                  {client.risk} risk
                </StatusBadge>
                {isPlanReviewOverdue && <StatusBadge tone="danger">Plan Review Overdue</StatusBadge>}
                {client.status ? <StatusBadge tone="neutral">{client.status}</StatusBadge> : null}
                {/* Patient Portal Status Badge */}
                {client.email ? (
                  client.appAccess === 'active' ? (
                    <span title="Patient has activated their portal account">
                      <StatusBadge tone="success" icon={<CheckCircle2 />}>
                        Portal: Active
                      </StatusBadge>
                    </span>
                  ) : client.appAccess === 'invite_sent' ? (
                    <span title="Invitation sent, awaiting patient password creation">
                      <StatusBadge tone="warning" icon={<CircleAlert />}>
                        Portal: Invite Pending
                      </StatusBadge>
                    </span>
                  ) : (
                    <span title="Not yet enrolled in portal">
                      <StatusBadge tone="neutral">Portal: Not Enrolled</StatusBadge>
                    </span>
                  )
                ) : null}
              </>
            }
            description={
              <>
                {client.mrn ? (
                  <span className="block break-all font-mono text-xs font-semibold tracking-wide text-slate-600 sm:text-sm">
                    MRN {client.mrn}
                  </span>
                ) : null}
                <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-2 [overflow-wrap:anywhere]">
                  {(() => {
                    const masked =
                      (client.email || '').includes('••••') ||
                      (client.phone || '').includes('•••');
                    if (masked) {
                      return (
                        <span
                          className="inline-flex items-center gap-1.5"
                          title="Email / phone visible to Practice Director and Admin only"
                        >
                          <Lock size={12} className="text-slate-500" aria-hidden />
                          <span>{client.email || '••••@hidden'}</span>
                          <span aria-hidden>·</span>
                          <span>{client.phone || '••• ••• ••••'}</span>
                        </span>
                      );
                    }
                    return (
                      <>{[client.email, client.phone].filter(Boolean).join(' · ') || 'No contact on file'}</>
                    );
                  })()}
                </span>
              </>
            }
            actions={
              <>
                {allowPhoto && (
                  <label
                    className={buttonClasses({
                      variant: 'secondary',
                      className: 'cursor-pointer focus-within:ring-2 focus-within:ring-blue-600 focus-within:ring-offset-2',
                    })}
                  >
                    {photoBusy ? 'Uploading…' : 'Upload photo'}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      className="sr-only"
                      disabled={photoBusy}
                      onChange={(e) => {
                        onPickPhoto(e.target.files?.[0] || null);
                        e.currentTarget.value = '';
                      }}
                    />
                  </label>
                )}
                {allowPhoto && client.image ? (
                  <Button variant="secondary" disabled={photoBusy} onClick={onRemovePhoto}>
                    Remove photo
                  </Button>
                ) : null}
                {allowMsg ? (
                  <Link
                    href={`/dashboard/messages?client=${client.id}`}
                    className={buttonClasses({ variant: 'secondary' })}
                  >
                    <MessageSquare size={16} aria-hidden />
                    Message
                  </Link>
                ) : null}
                {canAssignClinician && (
                  <Button
                    variant="secondary"
                    icon={<UserCheck />}
                    onClick={() => {
                      setAssigningClinicianId((client as any).assignedToId || '');
                      setAssignModalOpen(true);
                    }}
                  >
                    {client.assignedToName ? `Clinician: ${client.assignedToName}` : 'Assign Clinician'}
                  </Button>
                )}
                {canEditClient && (
                  <Button variant="secondary" icon={<Pencil />} onClick={() => setEditModalOpen(true)}>
                    Edit Profile
                  </Button>
                )}
                {/* Patient Portal Invitation Action Button */}
                {canEditClient && client.email && (
                  <Button
                    variant="secondary"
                    icon={<Mail />}
                    disabled={portalInviteSending}
                    onClick={handleSendPortalInvite}
                    title={client.appAccess === 'active' ? 'Send a fresh login/activation link to client' : 'Send portal activation invitation to client'}
                  >
                    {portalInviteSending
                      ? 'Sending…'
                      : client.appAccess === 'active'
                        ? 'Resend Portal Link'
                        : client.appAccess === 'invite_sent'
                          ? 'Resend Invite'
                          : 'Invite to Portal'}
                  </Button>
                )}
                {/* E-Prescribe Header Button */}
                {canPrescribe ? (
                  <Button id="btn-eprescribe-main" variant="secondary" icon={<Pill />} onClick={handleEPrescribeClick}>
                    E-Prescribe
                  </Button>
                ) : (
                  <Button
                    variant="secondary"
                    icon={<Pill />}
                    title="E-Prescribe is for Psychiatrist, NP, Physician and Medical NP roles"
                    disabled
                  >
                    E-Prescribe (Restricted)
                  </Button>
                )}
                {allowSchedule ? (
                  <Link
                    href={`/dashboard/appointments?client=${client.id}&new=1`}
                    className={buttonClasses({ variant: 'primary' })}
                  >
                    <CalendarDays size={16} aria-hidden />
                    Schedule
                  </Link>
                ) : null}
              </>
            }
          >
            {photoError && (
              <p role="alert" className="text-xs font-medium text-rose-700">{photoError}</p>
            )}
            <p className="text-xs text-slate-500">
              Since {client.assignedSince || '—'} · {client.totalSessions ?? 0} sessions
            </p>

            {/* Section 5.1: Chart Flag Chips */}
            <div className="flex flex-wrap items-center gap-1.5">
              {chartFlags.map((flag) => (
                <span
                  key={flag}
                  className={cx(
                    'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset',
                    TONE_SOFT[
                      flag === 'High Risk' || flag === 'Latex Allergy'
                        ? 'danger'
                        : flag === 'Temp Medicaid' || flag === 'Balance Due'
                        ? 'warning'
                        : 'brand'
                    ]
                  )}
                >
                  <Tag size={12} aria-hidden />
                  {flag}
                  <button
                    type="button"
                    aria-label={`Remove ${flag} flag`}
                    onClick={() => setChartFlags((prev) => prev.filter((f) => f !== flag))}
                    className="ml-0.5 rounded-full hover:opacity-75 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                  >
                    <X size={12} aria-hidden />
                  </button>
                </span>
              ))}
              <button
                type="button"
                disabled
                title="Not available yet: chart flags have no database field, so they cannot be saved. Use Office Notes for now."
                className="inline-flex cursor-not-allowed items-center gap-1 rounded-full border border-dashed border-slate-300 px-2 py-0.5 text-[11px] font-semibold text-slate-500 opacity-60"
              >
                <Plus size={12} aria-hidden /> Flag
              </button>
            </div>

            {/* Section 5.1: Metadata Row */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-100 pt-2 text-xs text-slate-500">
              <span>
                Last Completed Appt:{' '}
                <strong className="text-slate-700">
                  {appointments.find((a) => a.status === 'completed')?.date || (appointments[0]?.date ? appointments[0].date : 'None on file')}
                </strong>
              </span>
              <span className="text-slate-400" aria-hidden>&bull;</span>
              <span>
                Last Chart Viewed:{' '}
                <strong className="font-mono text-slate-700">Today</strong> by{' '}
                <span className="text-slate-700">{user?.name || 'Staff Clinician'}</span>{' '}
                <span className="font-mono text-[11px] text-slate-500">({user?.role || 'CLINICIAN'})</span>
              </span>
            </div>
          </PageHeader>
        </div>

        {/* Metrics — screenshot layout (check-in mood/sleep: behavioral health, hidden from primary care roles) */}
        <div className={`mt-5 border-t border-slate-100 pt-5 ${medicalViewer ? 'hidden' : ''}`}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
            <div className="flex flex-col items-center text-center">
              <TrendingUp size={22} strokeWidth={2.25} className="text-blue-600" aria-hidden />
              <p className="stat-number mt-2.5 text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
                {avgMood === '—' ? '—' : `${avgMood}/10`}
              </p>
              <p className="mt-1 text-xs font-medium text-slate-500 sm:text-[13px]">
                Avg Mood (7d)
              </p>
            </div>

            <div className="flex flex-col items-center text-center">
              <CircleAlert size={22} strokeWidth={2.25} className="text-amber-600" aria-hidden />
              <p className="stat-number mt-2.5 text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
                {avgStress === '—' ? '—' : `${avgStress}/10`}
              </p>
              <p className="mt-1 text-xs font-medium text-slate-500 sm:text-[13px]">
                Avg Stress (7d)
              </p>
            </div>

            <div className="flex flex-col items-center text-center">
              <Moon size={22} strokeWidth={2.25} className="text-sky-600" aria-hidden />
              <p className="stat-number mt-2.5 text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
                {avgSleep === '—' ? '—' : `${avgSleep}/10`}
              </p>
              <p className="mt-1 text-xs font-medium text-slate-500 sm:text-[13px]">
                Avg Sleep (7d)
              </p>
            </div>

            <div className="flex flex-col items-center text-center">
              <Flame size={22} strokeWidth={2.25} className="text-amber-600" aria-hidden />
              <p className="stat-number mt-2.5 text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
                {streak} days
              </p>
              <p className="mt-1 text-xs font-medium text-slate-500 sm:text-[13px]">
                Check-in Streak
              </p>
            </div>
          </div>
        </div>
      </Card>

      {/* Secondary EHR Navigation Row (behavioral-health pages; not for primary care roles) */}
      {role !== 'PEER_SUPPORT' && !medicalViewer && (
        <nav aria-label="EHR quick links" className={cx(cardClasses, 'flex flex-wrap items-center gap-1.5 p-2')}>
          <span className="shrink-0 px-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            EHR Quick Links:
          </span>
          {[
            { label: 'Notes', href: `/dashboard/ehr/notes?clientId=${encodeURIComponent(client.id)}` },
            { label: 'Treatment Plans', href: `/dashboard/ehr/treatment-plans?clientId=${encodeURIComponent(client.id)}` },
            { label: 'Assessments', href: `/dashboard/ehr/assessments?clientId=${encodeURIComponent(client.id)}` },
            { label: 'Diagnoses', href: `/dashboard/ehr/diagnoses?clientId=${encodeURIComponent(client.id)}` },
            { label: 'Prescriptions', href: `/dashboard/ehr/prescriptions?clientId=${encodeURIComponent(client.id)}` },
            { label: 'Eligibility', href: `/dashboard/ehr/eligibility?clientId=${encodeURIComponent(client.id)}` },
            { label: 'Consents', href: `/dashboard/ehr/consents?clientId=${encodeURIComponent(client.id)}` },
            { label: 'Safety Plan', href: `/dashboard/ehr/safety-plan?clientId=${encodeURIComponent(client.id)}` },
            { label: 'Discharge', href: `/dashboard/ehr/discharge?clientId=${encodeURIComponent(client.id)}` },
          ].map((m) => (
            <Link
              key={m.href}
              href={m.href}
              className={cx(
                'inline-flex min-h-10 shrink-0 items-center rounded-lg px-3 text-xs font-semibold text-slate-700 transition hover:bg-blue-50 hover:text-blue-700 md:min-h-8',
                FOCUS_RING
              )}
            >
              {m.label}
            </Link>
          ))}
        </nav>
      )}

      {/* Tabs */}
      <div
        role="tablist"
        aria-label="Client chart sections"
        className="flex min-w-0 flex-nowrap items-end gap-1 overflow-x-auto border-b border-slate-200 [scrollbar-width:thin]"
      >
        {visibleTabs.map((tab, i) => {
          const group = chartTabGroup(tab);
          const startsGroup = group !== null && chartTabGroup(visibleTabs[i - 1] ?? '') !== group;
          return (
          <span key={tab} className="flex shrink-0 items-center gap-1">
          {startsGroup ? (
            <span className="ml-1 self-center border-l border-slate-200 pl-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              {CHART_TAB_GROUP_LABELS[group]}
            </span>
          ) : null}
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            onClick={() => setActiveTab(tab)}
            className={cx(
              '-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600',
              activeTab === tab
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-slate-600 hover:border-slate-300 hover:text-slate-900'
            )}
          >
            {CHART_TABS.find((t) => t.key === tab)?.label ?? tab}
          </button>
          </span>
          );
        })}
      </div>

      {activeTab === 'summary' && visibleTabs.includes('summary') && (
        <div className="space-y-4">
          {importedPlans.map((p) => (
            <div key={p.id} className="space-y-1">
              <ImportedPlanNotice source={p.source} reviewDueAt={p.reviewDueAt} status={p.status} clientId={client.id} planId={p.id} compact />
              <p className="px-1 text-xs text-slate-500">
                Valant Treatment Plan · {p.status === 'DRAFT' ? 'Draft' : 'Active'} ·{' '}
                <Link href={`/dashboard/ehr/treatment-plans?clientId=${encodeURIComponent(client.id)}`} className="font-semibold text-blue-700 hover:underline">
                  Treatment Plans
                </Link>
              </p>
            </div>
          ))}

          {/* Session frequency: recommended (with source) vs attended — same data as the alert */}
          {canAccessClientRoster(role) && <SessionFrequencyCard clientId={client.id} canSchedule={allowSchedule} />}
          {canAccessPath(role, '/dashboard/sdoh') && <SocialNeedsCard clientId={client.id} />}
          {canAccessPath(role, '/dashboard/resources') && <ClientResourcesCard clientId={client.id} />}
          {/* Portal proxy access: guardian / representative logins (one login for siblings) */}
          {canEditClient && <PortalAccessCard clientId={client.id} />}

          <PreVisitBriefCard clientId={client.id} />

          {/* Measures: latest score, change, trend, pending questionnaires (renders nothing without assessment / MBC access) */}
          <MeasuresCard clientId={client.id} />

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card className="p-4 sm:p-5 lg:col-span-2">
            <h2 className="text-sm font-semibold text-slate-900">Mood & Stress — Last 7 Days</h2>
            {mounted && chartData.length > 0 ? (
              <div className="mt-3 h-[260px] w-full sm:h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="4 4" stroke="#E2E8F0" vertical={false} />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 11, fill: '#64748B' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      domain={[0, 10]}
                      ticks={[0, 3, 6, 10]}
                      tick={{ fontSize: 11, fill: '#64748B' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      contentStyle={{
                        borderRadius: 12,
                        border: '1px solid #E2E8F0',
                        boxShadow: '0 8px 24px rgba(15,23,42,0.08)',
                      }}
                    />
                    <Legend
                      verticalAlign="top"
                      align="right"
                      iconType="circle"
                      wrapperStyle={{ fontSize: 12, paddingBottom: 8 }}
                    />
                    <ReferenceLine
                      y={4}
                      stroke="#E11D48"
                      strokeDasharray="5 5"
                      label={{
                        value: 'Risk threshold',
                        fill: '#E11D48',
                        fontSize: 11,
                        position: 'insideTopRight',
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="mood"
                      stroke="#5C2D91"
                      strokeWidth={2.5}
                      dot={{ fill: '#5C2D91', r: 4, strokeWidth: 0 }}
                      activeDot={{ r: 5 }}
                      name="Mood"
                    />
                    <Line
                      type="monotone"
                      dataKey="stress"
                      stroke="#D97706"
                      strokeWidth={2.5}
                      dot={{ fill: '#D97706', r: 4, strokeWidth: 0 }}
                      activeDot={{ r: 5 }}
                      name="Stress"
                    />
                    <Line
                      type="monotone"
                      dataKey="sleep"
                      stroke="#0284C7"
                      strokeWidth={2.5}
                      dot={{ fill: '#0284C7', r: 4, strokeWidth: 0 }}
                      activeDot={{ r: 5 }}
                      name="Sleep"
                      connectNulls
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="mt-4 flex h-52 items-center justify-center rounded-lg bg-slate-50 text-sm text-slate-500">
                No check-ins recorded yet for this client.
              </div>
            )}
          </Card>

          <div className="space-y-4">
            <Card className="p-4">
              <h3 className="text-sm font-semibold text-slate-900">Active Alerts</h3>
              {needsEkg && (
                <div role="alert" className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex min-w-0 flex-1 items-start gap-2">
                      <HeartPulse size={16} className="mt-0.5 shrink-0 text-amber-600" aria-hidden />
                      <div>
                        <p className="font-semibold text-amber-950">
                          EKG Required — Multiple Antipsychotics
                        </p>
                        <p className="mt-0.5 text-amber-800">
                          {ekgAntipsychoticsCount} antipsychotics on file. Baseline EKG needed per QTc protocol.
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setActiveTab('medications')}
                      className="shrink-0"
                    >
                      View in Medications tab
                      <ArrowRight size={14} aria-hidden />
                    </Button>
                  </div>
                </div>
              )}
              {overviewAlerts.length ? (
                <div className="mt-3 space-y-2">
                  {overviewAlerts.map((a) => (
                    <div
                      key={`${a.title}-${a.when}`}
                      className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5"
                    >
                      <p className="text-sm font-semibold text-rose-700">{a.title}</p>
                      <p className="mt-0.5 text-xs text-rose-700">{a.when}</p>
                    </div>
                  ))}
                </div>
              ) : !needsEkg ? (
                <p className="mt-3 text-sm text-slate-500">No active alerts.</p>
              ) : null}
            </Card>

            {/* Multi-Provider Treatment Team Panel (Commit 7fba6e5) */}
            <Card className="p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Users size={16} className="text-slate-500" aria-hidden />
                  <h3 className="text-sm font-semibold text-slate-900">Treatment Team</h3>
                </div>
                {canManageTeam && (
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<UserPlus />}
                    aria-expanded={showAddMember}
                    onClick={() => setShowAddMember((prev) => !prev)}
                  >
                    Add
                  </Button>
                )}
              </div>

              {/* Inline Add Member Drawer */}
              {showAddMember && (
                <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 p-2 animate-in fade-in">
                  <div className="mb-1.5 flex items-center justify-between px-1 text-xs font-semibold text-slate-700">
                    <span>Select Provider to Add</span>
                    <IconButton
                      label="Close provider list"
                      icon={<X size={14} />}
                      onClick={() => setShowAddMember(false)}
                      className="rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                    />
                  </div>
                  {(() => {
                    const unassigned = organizationRoster.filter(
                      (p) => !treatmentTeam.some((t) => t.id === p.id || t.name.toLowerCase() === p.name.toLowerCase())
                    );
                    if (unassigned.length === 0) {
                      return (
                        <p className="px-1 py-2 text-center text-xs text-slate-500">
                          All available providers already assigned.
                        </p>
                      );
                    }
                    return (
                      <div className="space-y-1 max-h-48 overflow-y-auto">
                        {unassigned.map((provider) => (
                          <button
                            key={provider.id}
                            type="button"
                            onClick={() => void handleAddTeamMember(provider)}
                            className={cx('group flex w-full items-center gap-2 rounded-lg p-1.5 text-left transition hover:bg-white', FOCUS_RING)}
                          >
                            <div
                              aria-hidden
                              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-50 text-[11px] font-semibold text-blue-700 ring-1 ring-inset ring-blue-200"
                            >
                              {provider.initials}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-xs font-semibold text-slate-800 group-hover:text-blue-700">
                                {provider.name}
                              </p>
                              <p className="truncate text-xs text-slate-500">{provider.role}</p>
                            </div>
                          </button>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* Assigned Team Members List */}
              <div className="space-y-1.5">
                {treatmentTeam.map((member) => (
                  <div
                    key={member.id}
                    className="group flex items-center justify-between rounded-lg p-2 transition hover:bg-slate-50"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <div
                        aria-hidden
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-50 text-xs font-semibold text-blue-700 ring-1 ring-inset ring-blue-200"
                      >
                        {member.initials}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-slate-800">{member.name}</p>
                        <p className="flex items-center gap-1 text-xs text-slate-500">
                          <span>{member.role}</span>
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {member.primary && (
                        <StatusBadge tone="brand" size="sm">
                          Primary
                        </StatusBadge>
                      )}
                      {!member.primary && canManageTeam && (
                        <IconButton
                          label={`Remove ${member.name}`}
                          icon={<X size={14} />}
                          onClick={() => void handleRemoveTeamMember(member.id)}
                          className="rounded-md p-1 text-slate-400 opacity-0 transition-opacity hover:text-rose-700 focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 group-hover:opacity-100"
                        />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="p-4">
              <h3 className="text-sm font-semibold text-slate-900">Diagnoses</h3>
              {diagnoses.length ? (
                <ul className="mt-3 space-y-2">
                  {diagnoses.map((d) => (
                    <li key={d} className="flex items-start gap-2 text-sm text-slate-700">
                      <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-600" />
                      {d}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-slate-500">No diagnosis on file.</p>
              )}
            </Card>

            <Card className="p-4">
              <h3 className="text-sm font-semibold text-slate-900">Emergency Contact</h3>
              {client.emergencyContactName || client.emergencyContactPhone ? (
                <>
                  <p className="mt-2 text-sm font-semibold text-slate-900">
                    {client.emergencyContactName || '—'}
                  </p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-sm text-slate-500">
                    {(client.emergencyContactPhone || '').includes('•••') ? (
                      <span
                        className="inline-flex items-center gap-1.5"
                        title="Emergency phone visible to Practice Director and Admin only"
                      >
                        <Lock size={12} className="text-slate-500" aria-hidden />
                        {client.emergencyContactPhone}
                      </span>
                    ) : (
                      client.emergencyContactPhone || '—'
                    )}
                  </p>
                </>
              ) : (
                <p className="mt-3 text-sm text-slate-500">No emergency contact on file.</p>
              )}
            </Card>

            <Card className="p-4">
              <h3 className="text-sm font-semibold text-slate-900">Demographics</h3>
              <dl className="mt-3 space-y-2 text-sm">
                {[
                  ['MRN', client.mrn || '—'],
                  ['Date of birth', client.dateOfBirth || '—'],
                  ['Gender', client.gender || '—'],
                  ['Address', address || '—'],
                  ['Location', client.locationName || '—'],
                ].map(([label, value]) => (
                  <div key={label as string}>
                    <dt className="text-xs text-slate-500">{label}</dt>
                    <dd
                      className={`font-medium text-slate-800 ${
                        label === 'MRN' ? 'font-mono text-xs tracking-wide sm:text-sm' : ''
                      }`}
                    >
                      {value}
                    </dd>
                  </div>
                ))}
                <div>
                  <dt className="text-xs text-slate-500">Clinician</dt>
                  <dd className="mt-0.5 flex items-center justify-between gap-2 font-medium text-slate-800">
                    <span>{client.assignedToName || 'Unassigned'}</span>
                    {canAssignClinician && (
                      <button
                        type="button"
                        onClick={() => {
                          setAssigningClinicianId((client as any).assignedToId || '');
                          setAssignModalOpen(true);
                        }}
                        className={buttonClasses({ variant: 'secondary', size: 'sm' })}
                      >
                        {client.assignedToName ? 'Change' : 'Assign'}
                      </button>
                    )}
                  </dd>
                </div>
              </dl>
            </Card>
          </div>
        </div>
        </div>
      )}

      {/* ── OFFICE NOTES TAB — internal operational notes ── */}
      {activeTab === 'office-notes' && visibleTabs.includes('office-notes') && (
        <div className="space-y-4">
          <Alert tone="warning" icon={<StickyNote />}>
            <span className="leading-relaxed">
              <strong>Internal operational notes</strong> — scheduling preferences, billing conversations, and contact notes.
              Visible to staff only, never visible in client portal. <strong>No clinical content:</strong> symptoms, diagnoses,
              and therapy belong in Progress Notes.
            </span>
          </Alert>

          <Card className="p-5">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Plus size={16} className="text-blue-600" aria-hidden /> Add Office Note
            </h3>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {(['Scheduling', 'Billing', 'Contact Preference', 'Transportation', 'General'] as OfficeNoteCategory[]).map((cat) => (
                <button
                  key={cat}
                  type="button"
                  aria-pressed={officeNoteCat === cat}
                  onClick={() => setOfficeNoteCat(cat)}
                  className={cx(
                    'rounded-full border px-3 py-1 text-xs font-semibold transition',
                    FOCUS_RING,
                    officeNoteCat === cat
                      ? 'border-blue-600 bg-blue-600 text-white shadow-xs'
                      : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
                  )}
                >
                  {cat}
                </button>
              ))}
            </div>
            <textarea
              rows={3}
              value={officeNoteText}
              onChange={(e) => setOfficeNoteText(e.target.value)}
              aria-label="Office note"
              placeholder="Enter internal operational note (e.g., Client prefers afternoon slots, bus route 24 delay info, billing review note)…"
              className={inputClasses}
            />
            <div className="mt-3 flex justify-end">
              <Button
                onClick={handleAddOfficeNote}
                disabled={!officeNoteText.trim() || officeNoteSaving}
              >
                {officeNoteSaving ? 'Saving…' : 'Post Office Note'}
              </Button>
            </div>
          </Card>

          <div className="space-y-2.5">
            {officeNotesLoading && <LoadingState label="Loading operational notes…" className="py-4" />}
            {!officeNotesLoading && officeNotes.length === 0 && (
              <Card>
                <EmptyState
                  compact
                  icon={<StickyNote />}
                  title="No office notes yet."
                  description="Add an internal note above."
                />
              </Card>
            )}
            {officeNotes.map((note) => (
              <div
                key={note.id}
                className={cx(cardClasses, 'p-4 transition-all', note.isPinned && 'ring-1 ring-blue-200')}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <StatusBadge tone="neutral" size="sm">
                        {note.category}
                      </StatusBadge>
                      {note.isPinned && (
                        <StatusBadge tone="brand" size="sm" icon={<Pin />}>
                          Pinned
                        </StatusBadge>
                      )}
                      <span className="text-xs text-slate-500">
                        {new Date(note.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <span className="text-xs text-slate-600 font-medium">
                        by {note.authorName} ({note.authorRole})
                      </span>
                    </div>
                    <p className="text-sm text-slate-800 leading-relaxed pt-1 whitespace-pre-wrap break-words">{note.noteText}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <IconButton
                      label={note.isPinned ? 'Unpin' : 'Pin to top'}
                      icon={<Pin size={14} />}
                      aria-pressed={note.isPinned}
                      onClick={() => handleTogglePinOfficeNote(note.id, note.isPinned)}
                      className={cx(
                        'rounded-lg p-1.5 text-xs transition',
                        FOCUS_RING,
                        note.isPinned ? 'bg-blue-50 text-blue-700' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
                      )}
                    />
                    <IconButton
                      label="Delete note"
                      icon={<Trash2 size={14} />}
                      onClick={() => handleDeleteOfficeNote(note.id)}
                      className={cx('rounded-lg p-1.5 text-xs text-slate-500 transition hover:bg-rose-50 hover:text-rose-700', FOCUS_RING)}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'check-ins' && visibleTabs.includes('check-ins') && (
        <div className="space-y-4">
          {allowCheckInsWrite && (
            <div className={cx(cardClasses, 'p-5')}>
              <h3 className="mb-3 text-sm font-semibold text-slate-900">Log check-in</h3>
              {checkInError && (
                <Alert tone="danger" className="mb-3">
                  {checkInError}
                </Alert>
              )}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <label className="block text-sm">
                  <span className="mb-1.5 block text-xs font-medium text-slate-500">
                    Mood (1–10)
                  </span>
                  <input
                    type="range"
                    min={1}
                    max={10}
                    value={mood}
                    onChange={(e) => setMood(Number(e.target.value))}
                    className="w-full accent-blue-600"
                  />
                  <span className="mt-1 block text-sm font-semibold text-slate-800">{mood}/10</span>
                </label>
                <label className="block text-sm">
                  <span className="mb-1.5 block text-xs font-medium text-slate-500">
                    Stress (1–10)
                  </span>
                  <input
                    type="range"
                    min={1}
                    max={10}
                    value={stress}
                    onChange={(e) => setStress(Number(e.target.value))}
                    className="w-full accent-amber-600"
                  />
                  <span className="mt-1 block text-sm font-semibold text-slate-800">{stress}/10</span>
                </label>
                <label className="block text-sm">
                  <span className="mb-1.5 block text-xs font-medium text-slate-500">
                    Sleep (1–10)
                  </span>
                  <input
                    type="range"
                    min={1}
                    max={10}
                    value={sleep}
                    onChange={(e) => setSleep(Number(e.target.value))}
                    className="w-full accent-sky-600"
                  />
                  <span className="mt-1 block text-sm font-semibold text-slate-800">{sleep}/10</span>
                </label>
              </div>
              <textarea
                value={checkInNote}
                onChange={(e) => setCheckInNote(e.target.value)}
                placeholder="Optional note…"
                maxLength={1000}
                className={cx(inputClasses, 'mt-4 h-20 resize-none')}
              />
              <div className="mt-3">
                <Button disabled={checkInSaving} onClick={onSaveCheckIn}>
                  {checkInSaving ? 'Saving…' : 'Save check-in'}
                </Button>
              </div>
            </div>
          )}

          <div className={cx(cardClasses, 'overflow-hidden')}>
            <div className="border-b border-slate-200 px-5 py-4">
              <h3 className="text-sm font-semibold text-slate-900">Check-in history</h3>
            </div>
            {checkIns.length === 0 ? (
              <EmptyState title="No check-ins yet." description={allowCheckInsWrite ? 'Log a check-in above to start the history.' : 'Check-ins the client logs in the portal appear here.'} />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                      {['Date', 'Mood', 'Stress', 'Sleep', 'Risk', 'Note'].map((h) => (
                        <th key={h} scope="col" className="px-5 py-3">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {[...checkIns].reverse().map((c, i) => {
                      const risk = riskFromMood(c.mood);
                      return (
                        <tr
                          key={c.id || `${c.date}-${i}`}
                          className="hover:bg-slate-50"
                        >
                          <td className="px-5 py-3 text-sm font-medium text-slate-700">{c.date}</td>
                          <td className="px-5 py-3 text-sm font-semibold text-slate-800">
                            {c.mood}/10
                          </td>
                          <td className="px-5 py-3 text-sm font-semibold text-slate-800">
                            {c.stress}/10
                          </td>
                          <td className="px-5 py-3 text-sm font-semibold text-slate-800">
                            {c.sleep != null ? `${c.sleep}/10` : '—'}
                          </td>
                          <td className="px-5 py-3">
                            <StatusBadge tone={RISK_TONE[risk]} className="capitalize">
                              {risk}
                            </StatusBadge>
                          </td>
                          <td className="max-w-xs truncate px-5 py-3 text-sm text-slate-500">
                            {c.note || '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'medications' && visibleTabs.includes('medications') && (
        <div className="space-y-4">
          {medsError && <Alert tone={medsError.startsWith('Saved') ? 'warning' : 'danger'}>{medsError}</Alert>}

          {/* Clinical Safety Monitor: Antipsychotic QTc / EKG Protocol Hero Alert */}
          {needsEkg && (
            <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 sm:p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
                    <AlertTriangle size={20} />
                  </span>
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold text-amber-950">
                        Baseline EKG Required — Multiple Antipsychotics
                      </h3>
                      <StatusBadge tone="warning" size="sm">
                        Flagged by Altrixs Safety Monitor
                      </StatusBadge>
                    </div>
                    <p className="text-xs text-amber-900 leading-relaxed">
                      Client is prescribed multiple antipsychotics ({activeAntipsychotics.map((m) => m.medicationName).join(', ') || `${ekgAntipsychoticsCount} active antipsychotics on file`}). QTc prolongation risk requires a baseline EKG per safety protocol.
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 self-start sm:self-center shrink-0">
                  <Link
                    href="/dashboard/ehr/labs"
                    className={buttonClasses({ variant: 'secondary' })}
                  >
                    Order EKG
                    <ArrowRight size={16} aria-hidden />
                  </Link>
                </div>
              </div>
            </div>
          )}

          {allowMedsWrite && (
            <div className={cx(cardClasses, 'p-5')}>
              <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
                <div>
                  <h3 className="mb-0.5 text-sm font-semibold text-slate-900">Medication Reconciliation</h3>
                  <p className="text-xs text-slate-500">
                    Track active and reported meds. Reported medications sync to DrFirst for drug interaction checking.
                  </p>
                </div>
                {canPrescribe ? (
                  <div className="flex items-center gap-2 flex-wrap">
                    {client && <DrFirstLinkButton clientId={client.id} />}
                    <Button icon={<Pill />} onClick={handleEPrescribeClick}>
                      E-Prescribe
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="secondary"
                    icon={<Pill />}
                    disabled
                    title="E-Prescribe is for Psychiatrist, NP, Physician and Medical NP roles"
                  >
                    E-Prescribe (Restricted)
                  </Button>
                )}
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="block text-sm">
                  <label htmlFor="chart-med-name" className="mb-1.5 block text-xs font-medium text-slate-500">
                    Medication name
                  </label>
                  <DrugPicker
                    id="chart-med-name"
                    kind="medication"
                    value={{ text: medName, rxcui: medRxcui, tty: medTty }}
                    onChange={(next) => {
                      setMedName(next.text);
                      setMedRxcui(next.rxcui);
                      setMedTty(next.tty ?? null);
                      // A coded pick carries its strength; prefill an empty dosage with it
                      const strength = next.rxcui ? next.text.match(/\d+(?:\.\d+)?\s?(?:MG|MCG|UNT|MEQ|ML|%)(?:\/\w+)?/i)?.[0] : null;
                      if (strength && !medDosage.trim()) setMedDosage(strength.toLowerCase());
                    }}
                    placeholder="Search brand or generic (e.g. Zoloft 50)"
                  />
                </div>
                <label className="block text-sm">
                  <span className="mb-1.5 block text-xs font-medium text-slate-500">Dosage</span>
                  <input
                    value={medDosage}
                    onChange={(e) => setMedDosage(e.target.value)}
                    className={inputClasses}
                    placeholder="e.g. 50mg"
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1.5 block text-xs font-medium text-slate-500">Source</span>
                  <select
                    value={medSource}
                    onChange={(e) => setMedSource(e.target.value as MedicationSource)}
                    className={inputClasses}
                    aria-label="Medication source"
                  >
                    {MEDICATION_SOURCE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm">
                  <span className="mb-1.5 block text-xs font-medium text-slate-500">
                    Dose times (HH:MM, comma-separated)
                  </span>
                  <input
                    value={medTimes}
                    onChange={(e) => setMedTimes(e.target.value)}
                    className={inputClasses}
                    placeholder="08:00, 20:00"
                  />
                </label>
                <label className="block text-sm sm:col-span-2">
                  <span className="mb-1.5 block text-xs font-medium text-slate-500">
                    Instructions (optional)
                  </span>
                  <input
                    value={medInstructions}
                    onChange={(e) => setMedInstructions(e.target.value)}
                    className={inputClasses}
                    placeholder="Take with food"
                  />
                </label>
              </div>
              <div className="mt-3">
                <Button disabled={medSaving} onClick={onSaveMedication}>
                  {medSaving ? 'Saving…' : 'Save medication'}
                </Button>
              </div>
            </div>
          )}

          {client && isClinicalStaff(role) && (
            <DrFirstChartPanel clientId={client.id} isPrescriber={isPrescriberRole(userRoleStr)} />
          )}

          <div className={cx(cardClasses, 'overflow-hidden')}>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-4">
              <h3 className="text-sm font-semibold text-slate-900">Active medications</h3>
              {canAccessPath(role, '/dashboard/ehr/prescriptions') ? (
                <Link
                  href="/dashboard/ehr/prescriptions"
                  className="text-xs font-semibold text-blue-700 hover:underline"
                >
                  Open E-Prescribing
                </Link>
              ) : null}
            </div>
            {medsLoading ? (
              <LoadingState label="Loading medications…" />
            ) : medications.length === 0 ? (
              <EmptyState
                icon={<Pill />}
                title="No active medications on file for this client."
                description={allowMedsWrite ? 'Add a medication above to start the reconciliation list.' : undefined}
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                      {['Medication', 'Dosage', 'Times', 'Adherence (RxFill)', 'Today', 'Instructions'].map((h) => (
                        <th key={h} scope="col" className="px-5 py-3">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {medications.map((m) => {
                      const isAntipsy = isAntipsychoticDrug(m.medicationName);
                      const highlight = needsEkg && isAntipsy;
                      return (
                        <tr
                          key={m.id}
                          className={cx('transition hover:bg-slate-50', highlight && 'bg-amber-50/80')}
                        >
                          <td className="px-5 py-3 text-sm font-semibold text-slate-900">
                            <span className="inline-flex flex-wrap items-center gap-2">
                              {m.medicationName}
                              {isAntipsy && (
                                <StatusBadge tone="warning" size="sm">
                                  Antipsychotic
                                </StatusBadge>
                              )}
                              {medicationSourceLabel(m.source) && (
                                <StatusBadge tone="brand" size="sm">
                                  {medicationSourceLabel(m.source)}
                                </StatusBadge>
                              )}
                            </span>
                          </td>
                          <td className="px-5 py-3 text-sm text-slate-700">{m.dosage}</td>
                          <td className="px-5 py-3 text-sm tabular-nums text-slate-700">
                            {m.doseTimes.join(', ')}
                          </td>
                          <td className="px-5 py-3 text-xs">
                            {m.adherenceFlag === 'warning_outreach_needed' || m.adherenceStatus === 'not_dispensed' ? (
                              <StatusBadge tone="danger" size="sm" dot>
                                Not Picked Up · Outreach Needed
                              </StatusBadge>
                            ) : m.adherenceStatus === 'partially_dispensed' ? (
                              <StatusBadge tone="warning" size="sm" dot>
                                Partially Dispensed
                              </StatusBadge>
                            ) : (
                              <StatusBadge tone="success" size="sm" dot>
                                Picked Up (Verified)
                              </StatusBadge>
                            )}
                          </td>
                          <td className="px-5 py-3 text-xs text-slate-600">
                            {(m.todayDoses || []).length === 0
                              ? '—'
                              : (m.todayDoses || []).map((d, idx) => (
                                  <span key={`${d.time}-${idx}`} className="inline-flex items-center gap-0.5">
                                    {idx > 0 ? <span aria-hidden className="mx-1">·</span> : null}
                                    {d.time}
                                    {d.taken ? (
                                      <>
                                        <Check size={12} className="text-emerald-700" aria-hidden />
                                        <span className="sr-only">taken</span>
                                      </>
                                    ) : d.skipped ? (
                                      ' skipped'
                                    ) : null}
                                  </span>
                                ))}
                          </td>
                          <td className="max-w-xs truncate px-5 py-3 text-sm text-slate-500">
                            {m.instructions || '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'billing' && visibleTabs.includes('billing') && (
        <div className="space-y-5">
          {insuranceError && <Alert tone="danger">{insuranceError}</Alert>}
          {insuranceSaved && !insuranceError && <Alert tone="success">Insurance saved.</Alert>}

          <div className={cx(cardClasses, 'p-5')}>
            <h3 className="mb-4 text-sm font-semibold text-slate-900">Edit insurance</h3>
            {allowInsuranceEdit ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <label className="block text-sm">
                  <span className="mb-1.5 block text-xs font-medium text-slate-500">
                    Payer / plan
                  </span>
                  <input
                    className={inputClasses}
                    value={insurancePayer}
                    onChange={(e) => {
                      setInsurancePayer(e.target.value);
                      setInsuranceSaved(false);
                    }}
                    placeholder="e.g. Medicaid"
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1.5 block text-xs font-medium text-slate-500">
                    Member ID
                  </span>
                  <input
                    className={inputClasses}
                    value={insuranceMemberId}
                    onChange={(e) => {
                      setInsuranceMemberId(e.target.value);
                      setInsuranceSaved(false);
                    }}
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1.5 block text-xs font-medium text-slate-500">
                    Group number
                  </span>
                  <input
                    className={inputClasses}
                    value={insuranceGroupNumber}
                    onChange={(e) => {
                      setInsuranceGroupNumber(e.target.value);
                      setInsuranceSaved(false);
                    }}
                  />
                </label>
                <div className="sm:col-span-3 flex flex-wrap items-center gap-3">
                  <Button disabled={insuranceSaving} onClick={onSaveInsurance}>
                    {insuranceSaving ? 'Saving…' : 'Save insurance'}
                  </Button>
                  {allowEligibility ? (
                    <Link
                      href={`/dashboard/ehr/eligibility?clientId=${encodeURIComponent(client.id)}`}
                      className={buttonClasses({ variant: 'secondary' })}
                    >
                      Run eligibility
                    </Link>
                  ) : null}
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-500">View only for your role.</p>
            )}
          </div>

          <div className={cx(cardClasses, 'p-5')}>
            <h3 className="mb-4 text-sm font-semibold text-slate-900">Saved on file</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {[
                ['Payer / plan', client.insurancePayer || '—'],
                ['Member ID', client.insuranceMemberId || '—'],
                ['Group number', client.insuranceGroupNumber || '—'],
                ['Insurance type', client.insuranceType || '—'],
                ['Coverage', client.insuranceCoverageType || '—'],
                ['Payer phone', client.insurancePayerPhone || '—'],
                [
                  'Coverage dates',
                  client.insuranceEffectiveFrom || client.insuranceEffectiveTo
                    ? `${client.insuranceEffectiveFrom || '…'} to ${client.insuranceEffectiveTo || 'open'}`
                    : '—',
                ],
                ['Copay', client.copayAmount != null ? `$${client.copayAmount.toFixed(2)}` : '—'],
                ['Second phone', client.phoneSecondary || '—'],
              ].map(([label, value]) => (
                <div key={label as string} className="rounded-lg bg-slate-50 px-4 py-3">
                  <p className="text-xs font-medium text-slate-500">{label}</p>
                  <p className="mt-1 text-sm font-semibold text-slate-900">{value}</p>
                </div>
              ))}
            </div>
          </div>

          {allowEligibility ? <EligibilityPanel clientId={client.id} /> : null}
          {allowValantReference ? <PatientBalanceCard clientId={client.id} /> : null}
          {allowValantReference ? <ValantReferenceCard clientId={client.id} /> : null}
        </div>
      )}

      {activeTab === 'notes' && visibleTabs.includes('notes') && (
        <div className="space-y-4">
          {allowNotesWrite ? (
            <div className={cx(cardClasses, 'p-5')}>
              <h3 className="mb-3 text-sm font-semibold text-slate-900">Add session note</h3>
              {noteError && (
                <Alert tone="danger" className="mb-3">
                  {noteError}
                </Alert>
              )}

              {/* Note Type Selector */}
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-slate-500">Note Type:</span>
                {(['Progress Note', 'Clinical Concern', 'Care Coordination', 'Team Communication'] as const).map((type) => (
                  <button
                    key={type}
                    type="button"
                    aria-pressed={noteType === type}
                    onClick={() => setNoteType(type)}
                    className={cx(
                      'rounded-lg px-3 py-1.5 text-xs font-semibold transition',
                      FOCUS_RING,
                      noteType === type
                        ? 'bg-blue-600 text-white shadow-xs'
                        : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                    )}
                  >
                    {type}
                  </button>
                ))}
              </div>

              {/* Care Team Tagging Bar (Appears when note is Clinical Concern, Care Coordination, or Team Communication) */}
              {noteType !== 'Progress Note' && (
                <div className="mb-3 space-y-2.5 rounded-lg border border-slate-200 bg-slate-50 p-3.5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <label htmlFor="chart-note-tag-clinician" className="shrink-0 text-xs font-semibold text-slate-700">Tag Clinician:</label>
                      <select
                        id="chart-note-tag-clinician"
                        value={taggedStaffId}
                        onChange={(e) => setTaggedStaffId(e.target.value)}
                        className={cx(inputClasses, 'w-full flex-1 py-1.5 text-xs sm:w-auto')}
                      >
                        <option value="">-- Select Care Team Colleague to Alert --</option>
                        {staffDirectory.map((s) => (
                          <option key={s.id} value={s.id}>
                            @{s.name} ({s.role.replace(/_/g, ' ')})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-xs font-semibold text-slate-600">Urgency:</span>
                      {(['Urgent', 'Routine', 'FYI'] as const).map((urg) => (
                        <button
                          key={urg}
                          type="button"
                          aria-pressed={taggedUrgency === urg}
                          onClick={() => setTaggedUrgency(urg)}
                          className={cx(
                            'rounded-lg px-2.5 py-1 text-xs font-semibold transition',
                            FOCUS_RING,
                            taggedUrgency === urg
                              ? urg === 'Urgent'
                                ? 'bg-rose-700 text-white shadow-xs'
                                : urg === 'Routine'
                                ? 'bg-blue-600 text-white shadow-xs'
                                : 'bg-slate-700 text-white shadow-xs'
                              : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                          )}
                        >
                          {urg}
                        </button>
                      ))}
                    </div>
                  </div>
                  {taggedStaffId ? (
                    <p className="text-xs font-medium text-slate-700">
                      Saving this note will automatically push a <strong>{taggedUrgency}</strong> clinical alert to the tagged clinician&apos;s Alert Hub (/dashboard/alerts).
                    </p>
                  ) : (
                    <p className="text-xs text-slate-500">
                      Select a colleague to notify them in real-time in the Team Alerts tab.
                    </p>
                  )}
                </div>
              )}

              <SmartPhraseTextarea
                value={noteText}
                onChange={setNoteText}
                aria-label="Session note"
                placeholder="Document clinical observations, medication concerns, treatment progress, or team consultation… (type a phrase key like .mse then Space)"
                maxLength={4000}
                className={cx(inputClasses, 'h-28 resize-none')}
              />

              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Button disabled={!noteText.trim() || noteSaving} onClick={onSaveNote}>
                  {noteSaving ? 'Saving…' : 'Save note'}
                </Button>
                <span className="text-xs text-slate-500">{noteText.trim().length}/4000</span>
              </div>
            </div>
          ) : (
            noteError && <Alert tone="danger">{noteError}</Alert>
          )}

          <div className={cx(cardClasses, 'overflow-hidden')}>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-4">
              <h3 className="text-sm font-semibold text-slate-900">Progress notes</h3>
              {/* Clinical notes worklist filtered to this client (sign, co-sign, addenda, print) */}
              <span className="flex flex-wrap gap-2">
                <Link href={`/dashboard/ehr/notes?filterClient=${encodeURIComponent(client.id)}`} className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
                  All notes in Clinical Notes
                </Link>
                {allowNotesWrite ? (
                  <Link href={`/dashboard/ehr/notes?clientId=${encodeURIComponent(client.id)}`} className={buttonClasses({ size: 'sm' })}>
                    New progress note
                  </Link>
                ) : null}
              </span>
            </div>
            {notesLoading ? (
              <LoadingState label="Loading notes…" />
            ) : notes.length === 0 ? (
              <EmptyState
                icon={<FileText />}
                title="No progress notes saved yet."
                description={allowNotesWrite ? 'Start one with New progress note.' : undefined}
              />
            ) : (
              <div className="divide-y divide-slate-100">
                {notes.map((row) => {
                  // API also returns metadata columns and addenda (not yet on ClientProgressNote)
                  const note = row as ClientProgressNote & {
                    dateOfService?: string | null;
                    cptCode?: string | null;
                    addenda?: { id: string; reason: string; text: string; authorName: string | null; createdAt: string }[];
                  };
                  return (
                  <article key={note.id} className="px-5 py-4">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-slate-900">
                          {note.clinicianName || note.clinicianEmail || 'Clinical staff'}
                        </p>
                        {note.noteType && (
                          <StatusBadge tone="brand" size="sm">
                            {note.noteType}
                          </StatusBadge>
                        )}
                        {note.workflowStatus && (
                          <StatusBadge tone="neutral" size="sm">
                            {note.workflowStatus}
                          </StatusBadge>
                        )}
                        {(note.cptCode || note.billingCode) && (
                          <span className="text-xs text-slate-500">CPT {note.cptCode || note.billingCode}</span>
                        )}
                      </div>
                      <span className="flex items-center gap-2">
                        <time className="text-xs font-medium text-slate-500">
                          {note.dateOfService ? `DOS ${note.dateOfService} · ` : ''}
                          {formatNoteDate(note.createdAt)}
                        </time>
                        <Link
                          href={`/dashboard/ehr/notes?filterClient=${encodeURIComponent(client.id)}&openNote=${encodeURIComponent(note.id)}`}
                          className={buttonClasses({ variant: 'ghost', size: 'sm', className: 'text-blue-700' })}
                        >
                          {(note.workflowStatus || 'Draft') === 'Draft' ? 'Continue' : 'Open'}
                        </Link>
                      </span>
                    </div>
                    <p className="whitespace-pre-wrap text-sm leading-6 text-slate-600">
                      {note.body}
                    </p>
                    {note.addenda && note.addenda.length > 0 && (
                      <div className="mt-3 space-y-2">
                        {note.addenda.map((addendum) => (
                          <div key={addendum.id} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                            <p className="text-xs font-semibold text-slate-700">
                              Addendum · {addendum.reason} · {addendum.authorName || 'Clinical staff'} · {formatNoteDate(addendum.createdAt)}
                            </p>
                            <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-600">{addendum.text}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </article>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'appointments' && visibleTabs.includes('appointments') && (
        <div className={cx(cardClasses, 'overflow-hidden')}>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Appointment history</h3>
              <p className="mt-0.5 text-xs text-slate-500">
                Live appointments for this client from the database
              </p>
            </div>
            {allowSchedule && (
              <Link
                href={`/dashboard/appointments?client=${client.id}&new=1`}
                className={buttonClasses({ size: 'sm' })}
              >
                Schedule new
              </Link>
            )}
          </div>
          {appointmentsError && (
            <Alert tone="danger" className="mx-5 mt-4">
              {appointmentsError}
            </Alert>
          )}
          {appointmentsLoading ? (
            <LoadingState label="Loading appointments…" />
          ) : appointments.length === 0 ? (
            <EmptyState
              icon={<CalendarDays />}
              title="No appointments for this client yet"
              description="Create one from Appointments, then return here — it will show after refresh."
              action={
                allowSchedule ? (
                  <Link
                    href={`/dashboard/appointments?client=${client.id}&new=1`}
                    className={buttonClasses({ variant: 'secondary' })}
                  >
                    Schedule appointment
                  </Link>
                ) : undefined
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                    {['When', 'Type', 'Clinician', 'Mode', 'Status'].map((h) => (
                      <th key={h} scope="col" className="px-5 py-3">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {appointments.map((a) => (
                    <tr
                      key={a.id}
                      className="hover:bg-slate-50"
                    >
                      <td className="px-5 py-3 text-sm font-medium text-slate-800">
                        {formatApptWhen(a)}
                      </td>
                      <td className="px-5 py-3 text-sm text-slate-700">{a.type}</td>
                      <td className="px-5 py-3 text-sm text-slate-600">
                        {a.clinicianName || '—'}
                      </td>
                      <td className="px-5 py-3 text-sm text-slate-600">
                        {a.isVirtual ? 'Virtual' : 'In person'}
                      </td>
                      <td className="px-5 py-3">
                        <StatusBadge
                          tone={APPT_STATUS_TONE[a.status] || APPT_STATUS_TONE.scheduled}
                          className="capitalize"
                        >
                          {a.status.replace('-', ' ')}
                        </StatusBadge>
                        {a.label ? (
                          <div className="mt-1">
                            <AppointmentLabelChip label={a.label} size="xs" />
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === 'treatment-plan' && visibleTabs.includes('treatment-plan') && (
        <TreatmentPlanTab clientId={client.id} plans={treatmentPlans} />
      )}
      {activeTab === 'assessments' && visibleTabs.includes('assessments') && <AssessmentsTab clientId={client.id} />}
      {activeTab === 'diagnoses' && visibleTabs.includes('diagnoses') && <DiagnosesTab clientId={client.id} canSetCode={isMedicalProvider(role)} />}
      {activeTab === 'labs' && visibleTabs.includes('labs') && <LabsTab clientId={client.id} fullListHref={canAccessPath(role, '/dashboard/ehr/labs') ? undefined : MEDICAL_LABS_PATH} />}
      {activeTab === 'safety' && visibleTabs.includes('safety') && <SafetyRiskTab clientId={client.id} />}
      {activeTab === 'authorizations' && visibleTabs.includes('authorizations') && <AuthorizationsTab clientId={client.id} />}
      {activeTab === 'care-team' && visibleTabs.includes('care-team') && (
        <CareTeamReferralsTab clientId={client.id} assignedClinician={client.assignedToName ?? null} />
      )}
      {activeTab === 'messages' && visibleTabs.includes('messages') && <MessagesTab clientId={client.id} />}
      {activeTab === 'programs' && visibleTabs.includes('programs') && <ProgramsTab clientId={client.id} />}
      {activeTab === 'discharge' && visibleTabs.includes('discharge') && <DischargeTab clientId={client.id} />}
      {activeTab === 'access-log' && visibleTabs.includes('access-log') && <AccessLogTab clientId={client.id} />}
      {isMedicalTabKey(activeTab) && visibleTabs.includes(activeTab) && (
        <MedicalTab tab={activeTab} clientId={client.id} canOpenDiagnoses={visibleTabs.includes('diagnoses')} canOpenLabs={visibleTabs.includes('labs')} onOpenTab={setActiveTab} />
      )}

      {activeTab === 'documents' && visibleTabs.includes('documents') && (
        <div className="space-y-4">
        <div className={cx(cardClasses, 'overflow-hidden')}>
          <div className="border-b border-slate-200 px-5 py-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Clinical Documents & Records</h3>
              <p className="mt-0.5 text-xs text-slate-500">
                Uploaded intake evaluations, lab requisitions, court records, and ROI disclosures
              </p>
            </div>
            <Link
              href="/dashboard/ehr/doc-intake"
              className={buttonClasses({ size: 'sm' })}
              title="Upload in Smart Document Intake; filed documents appear here after staff confirm the patient"
            >
              <Plus size={14} aria-hidden /> Upload Document
            </Link>
          </div>

          <div className="p-5 space-y-4">
            {documentsError ? <Alert tone="danger">{documentsError}</Alert> : null}
            {!documentsError && clientDocuments.length === 0 ? (
              <EmptyState
                compact
                icon={<FileText />}
                title="No documents filed to this chart yet."
                description="Upload a document in Smart Document Intake; it appears here once staff confirm the patient."
              />
            ) : null}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                    <th scope="col" className="px-3 py-2.5">Document Title</th>
                    <th scope="col" className="px-3 py-2.5">Category</th>
                    <th scope="col" className="px-3 py-2.5">File Size</th>
                    <th scope="col" className="px-3 py-2.5">Date</th>
                    <th scope="col" className="px-3 py-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {clientDocuments.map((doc) => (
                    <tr key={doc.id} className="hover:bg-slate-50">
                      <td className="py-3 px-3 font-semibold text-slate-900">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <FileText size={16} className="shrink-0 text-slate-500" aria-hidden />
                        <span className="min-w-0 break-words">{doc.name}</span>
                        {doc.readOnly ? (
                          <span title="Imported from Valant: read-only">
                            <StatusBadge tone="warning" size="sm" icon={<Lock />}>
                              {doc.source === 'Valant import' ? 'Valant import' : 'Imported'}
                            </StatusBadge>
                          </span>
                        ) : null}
                        </div>
                      </td>
                      <td className="py-3 px-3">
                        <StatusBadge tone="neutral" size="sm">
                          {doc.category}
                        </StatusBadge>
                      </td>
                      <td className="py-3 px-3 font-mono text-slate-500">{doc.size}</td>
                      <td className="py-3 px-3 font-mono text-slate-600" title={doc.documentDate ? 'Document date (from the file name)' : 'Date filed'}>
                        {doc.documentDate ?? doc.uploadedAt}
                      </td>
                      <td className="py-3 px-3 text-right whitespace-nowrap">
                        {doc.canVoid ? (
                          <button
                            type="button"
                            onClick={() => void voidDocument(doc.id)}
                            className="mr-3 inline-flex min-h-10 items-center rounded text-xs font-semibold text-rose-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 md:min-h-8"
                          >
                            Void
                          </button>
                        ) : null}
                        {doc.url ? (
                          <a
                            href={doc.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex min-h-10 items-center gap-1 rounded text-xs font-semibold text-blue-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 md:min-h-8"
                          >
                            <Download size={14} aria-hidden /> Open
                          </a>
                        ) : (
                          <span className="text-slate-500">No file</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <ClientConsentsCard clientId={id} allowed={allowConsents} canEdit={canEditClient} />

        </div>
      )}

      {/* Chart Flag Chips Modal */}
      {showFlagModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div role="dialog" aria-modal="true" aria-label="Manage Client Chart Flags" className="relative z-10 max-h-[calc(100dvh-2rem)] w-full max-w-sm space-y-4 overflow-y-auto rounded-xl bg-white p-5 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-2">
              <h2 className="text-sm font-semibold text-slate-900">Manage Client Chart Flags</h2>
              <IconButton
                label="Close"
                icon={<X size={16} />}
                onClick={() => setShowFlagModal(false)}
                className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
              />
            </div>

            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-slate-600">Quick Clinical Presets:</p>
              <div className="flex flex-wrap gap-1.5">
                {['Temp Medicaid', 'Balance Due', 'VIP', 'High Risk', 'Latex Allergy', 'Fall Risk', 'Interpreter Needed'].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => {
                      if (!chartFlags.includes(preset)) {
                        setChartFlags([...chartFlags, preset]);
                      }
                    }}
                    className={cx(
                      'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition',
                      FOCUS_RING,
                      chartFlags.includes(preset)
                        ? 'border-blue-200 bg-blue-50 text-blue-700'
                        : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                    )}
                  >
                    <Plus size={12} aria-hidden /> {preset}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Custom Flag Label</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newFlagName}
                  onChange={(e) => setNewFlagName(e.target.value)}
                  placeholder="e.g. Special accommodations…"
                  className={cx(inputClasses, 'min-w-0 flex-1')}
                />
                <button
                  type="button"
                  onClick={() => {
                    if (newFlagName.trim() && !chartFlags.includes(newFlagName.trim())) {
                      setChartFlags([...chartFlags, newFlagName.trim()]);
                      setNewFlagName('');
                    }
                  }}
                  className={buttonClasses({ size: 'sm' })}
                >
                  Add
                </button>
              </div>
            </div>

            <div className="flex justify-end border-t border-slate-200 pt-2">
              <button
                type="button"
                onClick={() => setShowFlagModal(false)}
                className={buttonClasses({ variant: 'secondary', className: 'w-full' })}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Assign Clinician Modal */}
      {assignModalOpen && (
        <Modal
          title={`Assign Clinician to ${client.name}`}
          size="sm"
          onClose={() => {
            setAssignModalOpen(false);
            setAssignError(null);
          }}
          footer={
            <>
              <Button
                variant="secondary"
                onClick={() => {
                  setAssignModalOpen(false);
                  setAssignError(null);
                }}
              >
                Cancel
              </Button>
              <Button disabled={assignSaving} onClick={handleAssignClinician}>
                {assignSaving ? 'Saving…' : 'Confirm Assignment'}
              </Button>
            </>
          }
        >
          {assignError && <Alert tone="danger">{assignError}</Alert>}

          <div className="space-y-2">
            <label htmlFor="assign-clinician-select" className="block text-sm font-medium text-slate-700">
              Select Clinician from Staff
            </label>
            <select
              id="assign-clinician-select"
              value={assigningClinicianId}
              onChange={(e) => setAssigningClinicianId(e.target.value)}
              className={inputClasses}
            >
              <option value="">-- None (Unassigned) --</option>
              {staffDirectory.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.role.replace(/_/g, ' ')}) {s.status === 'INVITED' ? '(Pending Invite)' : ''}
                </option>
              ))}
            </select>
            <p className="text-xs text-slate-500">
              The selected clinician will immediately have access to this client&apos;s chart notes and caseload.
            </p>
          </div>
        </Modal>
      )}

      {/* Edit Client Profile Modal */}
      <EditClientModal
        open={editModalOpen}
        client={client}
        onClose={() => setEditModalOpen(false)}
        onUpdated={(updated) => {
          setClient((prev) => (prev ? ({ ...prev, ...updated } as Client) : prev));
          void reloadClient();
        }}
      />
    </Page>
  );
}
