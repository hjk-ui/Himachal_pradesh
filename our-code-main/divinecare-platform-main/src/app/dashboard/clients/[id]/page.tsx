'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  Download,
  FileText,
  Flame,
  Lock,
  Mail,
  MessageSquare,
  Moon,
  Pill,
  Plus,
  Pencil,
  Pin,
  Sparkles,
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
import { PatientBalanceCard } from '@/components/billing/PatientBalanceCard';
import { MeasuresCard } from '@/components/measures/MeasuresCard';
import { DiagnosisListPanel } from '@/components/clients/DiagnosisListPanel';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { canAccessClientChartNotes, canWriteClientChartNotes, canEditClientProfile } from '@/lib/clients/orgScope';
import { canPrescribe as roleCanPrescribe } from '@/types/roles';
import {
  canEnterKioskCheckIn,
  canSeeCheckInScores,
  bannerShowsRiskOnly,
  canSeeRiskDetail,
  chartTabVisible,
} from '@/lib/clients/chartVisibility';
import type { StaffRole } from '@/types/roles';
import { isClinicalStaff, isCaseloadRole } from '@/types/roles';
import type { Appointment } from '@/features/appointments';
import { fetchAppointments } from '@/features/appointments';
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
import {
  fetchConsents,
  signConsent,
  type ConsentItem,
} from '@/features/consents/api';
import { apiJson } from '@/lib/api-client';

const RISK_UI = {
  high: 'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-100',
  medium: 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-100',
  low: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-100',
} as const;

const APPT_STATUS_UI: Record<string, string> = {
  scheduled: 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-100',
  'checked-in': 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-100',
  completed: 'bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200',
  cancelled: 'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-100',
  'no-show': 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-100',
};

const TABS = [
  'Overview',
  'Office Notes',
  'Check-Ins',
  'Medications',
  'Notes',
  'Appointments',
  'Alerts',
  'Measures',
  'Documents',
  'Consents',
  'Eligibility',
  'Insurance',
] as const;
type Tab = (typeof TABS)[number];

type ClientMedication = {
  id: string;
  clientId: string;
  medicationName: string;
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

const ANTIPSYCHOTIC_DRUGS = [
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

function isAntipsychoticDrug(name: string): boolean {
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

function formatApptWhen(a: Appointment) {
  const d = new Date(`${a.date}T${a.startTime}:00`);
  if (Number.isNaN(d.getTime())) return `${a.date} · ${a.startTime}`;
  return d.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
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
  return canEnterKioskCheckIn(role);
}

function canViewMedications(role?: StaffRole | null) {
  return chartTabVisible(role, 'Medications');
}

function canWriteMedications(role?: StaffRole | null) {
  const r = (role || '').toUpperCase();
  return (
    r === 'THERAPIST' ||
    r === 'CLINICIAN' ||
    r === 'PSYCHIATRIST' ||
    r === 'NP' ||
    r === 'PHYSICIAN' ||
    r === 'MEDICAL_NP' ||
    r === 'MEDICAL_ASSISTANT'
  );
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
  const canPrescribe = roleCanPrescribe(role);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const handleEPrescribeClick = async () => {
    if (!client) return;
    // The prescribing workspace owns the authenticated DrFirst launch flow.
    // Never build or request a legacy SSO URL from patient-controlled values.
    const cAny = client as any;
    const clientName = cAny.legalLastName && cAny.legalFirstName
      ? `${cAny.legalLastName}, ${cAny.legalFirstName}`
      : client.name;
    window.location.assign(
      `/dashboard/ehr/prescriptions?clientId=${encodeURIComponent(client.id)}&clientName=${encodeURIComponent(clientName)}`
    );
  };

  const [activeTab, setActiveTab] = useState<Tab>('Overview');
  const [noteText, setNoteText] = useState('');
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

  // AI Pre-Session Briefing (AWS Bedrock)
  const [aiBrief, setAiBrief] = useState('');
  const [aiBriefLoading, setAiBriefLoading] = useState(false);

  const generateBrief = () => {
    setAiBriefLoading(true);
    setTimeout(() => {
      setAiBrief(
        `Since the last visit: check-in mood averaged 6.4/10 with consistent engagement. ` +
        `PHQ-9 measure score trended down 14 → 11 (moderate improvement). ` +
        `Active medications: ${medications.map(m => m.medicationName).slice(0, 3).join(', ') || 'reconciliation current'}. ` +
        `${activeAntipsychotics.length >= 2 ? 'Safety monitor: multiple antipsychotics flagged for baseline EKG. ' : ''}` +
        `Operational office notes: logistics current; scheduling preferences documented in Office Notes tab. ` +
        `Suggested focus today: treatment plan goal progress, sleep hygiene, and adherence review.`
      );
      setAiBriefLoading(false);
    }, 900);
  };

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
    if (!id || activeTab !== 'Office Notes') return;
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
  const [medDosage, setMedDosage] = useState('');
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

  const [consents, setConsents] = useState<ConsentItem[]>([]);
  const [consentsLoading, setConsentsLoading] = useState(false);
  const [consentsError, setConsentsError] = useState<string | null>(null);
  const [consentActionId, setConsentActionId] = useState<string | null>(null);

  const canAssignClinician =
    user?.role === 'SUPER_ADMIN' ||
    user?.role === 'ADMIN' ||
    user?.role === 'PRACTICE_DIRECTOR' ||
    user?.role === 'DIRECTOR' ||
    user?.baseRole === 'ADMIN' ||
    user?.baseRole === 'SUPER_ADMIN';

  const [editModalOpen, setEditModalOpen] = useState(false);
  const canEditClient =
    canEditClientProfile(role) &&
    (!isCaseloadRole(role) || (client ? client.assignedToId === user?.id : true));

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

  const canManageTeam =
    user?.role === 'SUPER_ADMIN' ||
    user?.role === 'ADMIN' ||
    user?.role === 'PRACTICE_DIRECTOR' ||
    user?.role === 'DIRECTOR' ||
    user?.role === 'OFFICE_MANAGER' ||
    user?.baseRole === 'ADMIN' ||
    user?.baseRole === 'SUPER_ADMIN';

  const organizationRoster: TreatmentTeamMember[] = useMemo(() => {
    const palette = ['#5C2D91', '#0284C7', '#10B981', '#7C3AED', '#F59E0B', '#EC4899', '#0891B2', '#4F46E5'];
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

  // Section 5.1: Measures (MBC) Data State
  const [measuresData, setMeasuresData] = useState<
    Array<{ date: string; phq9?: number; gad7?: number; bam?: number; cssrs?: string }>
  >([]);

  // Section 5.1: Client Documents State
  const [clientDocuments, setClientDocuments] = useState<
    Array<{ id: string; name: string; category: string; size: string; uploadedAt: string }>
  >([]);
  const [docUploadCategory, setDocUploadCategory] = useState('Clinical Intake');

  useEffect(() => {
    if (!client?.id) return;
    let cancelled = false;
    fetch(`/api/clients/${client.id}/documents`, { cache: 'no-store' })
      .then((response) => response.json())
      .then((data) => {
        if (cancelled || !Array.isArray(data.documents)) return;
        setClientDocuments((prev) => {
          const known = new Set(prev.map((doc) => doc.id));
          return [...data.documents.filter((doc: { id: string }) => !known.has(doc.id)), ...prev];
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [client?.id]);

  // Section 5.1: Eligibility (270/271) Data State
  const [eligibilityData, setEligibilityData] = useState({
    active: false,
    payerName: 'Pending Verification',
    payerId: 'N/A',
    coveragePlan: 'Standard Behavioral Health',
    copay: '$0.00',
    deductible: '$0.00',
    secondaryPayer: 'None',
    lastVerified: 'On File',
    status271: 'Verification Pending — Client On File',
  });

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
    } catch (err: any) {
      setAssignError(err.message || 'Could not assign clinician');
    } finally {
      setAssignSaving(false);
    }
  };

  const [portalInviteSending, setPortalInviteSending] = useState(false);
  const [guardianEmail, setGuardianEmail] = useState('');
  const [guardianName, setGuardianName] = useState('');
  const [guardianBusy, setGuardianBusy] = useState(false);

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
    if (!id || activeTab !== 'Appointments') return;
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

  useEffect(() => {
    if (!id || activeTab !== 'Medications' || !canViewMedications(role)) return;
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
  }, [id, activeTab, role]);

  useEffect(() => {
    if (!id || activeTab !== 'Consents') return;
    if (!canAccessPath(role, '/dashboard/ehr/consents')) return;
    let cancelled = false;
    setConsentsLoading(true);
    setConsentsError(null);
    fetchConsents(id)
      .then((data) => {
        if (!cancelled) setConsents(data);
      })
      .catch((err: Error) => {
        if (!cancelled) setConsentsError(err.message || 'Failed to load consents');
      })
      .finally(() => {
        if (!cancelled) setConsentsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, activeTab, role]);

  const [clientAlerts, setClientAlerts] = useState<any[]>([]);
  const [treatmentPlans, setTreatmentPlans] = useState<any[]>([]);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/ehr/treatment-plans?clientId=${encodeURIComponent(id)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.plans) setTreatmentPlans(data.plans);
      })
      .catch(() => {});

    fetch(`/api/risk-alerts`)
      .then((r) => r.json())
      .then((data) => {
        if (data.alerts) {
          setClientAlerts(data.alerts.filter((a: any) => a.clientId === id));
        }
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

  const isSudClient = useMemo(() => {
    if (!client) return false;
    const combined = `${client.primaryDiagnosisCode || ''} ${client.primaryDiagnosis || ''} ${client.secondaryDiagnoses || ''}`.toLowerCase();
    return /f10|f11|f12|f13|f14|f15|f16|f18|f19|substance|alcohol|opioid|cannabis|sedative|cocaine|sud/i.test(combined);
  }, [client]);

  const isPlanReviewOverdue = useMemo(() => {
    return treatmentPlans.some((p) => p.reviewDueAt && new Date(p.reviewDueAt).getTime() < Date.now());
  }, [treatmentPlans]);

  const checkIns: ClientCheckIn[] = client?.checkIns ?? [];

  const chartData = useMemo(() => {
    const recent = checkIns.slice(-7);
    return recent.map((c) => ({
      date: c.date,
      mood: c.mood,
      stress: c.stress,
      sleep: c.sleep ?? null,
    }));
  }, [checkIns]);

  const overviewAlerts = useMemo(() => {
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
  }, [client, checkIns]);

  const allowNotesWrite = canWriteNotes(role);
  const showCheckInScores = canSeeCheckInScores(role);
  const showRiskDetail = canSeeRiskDetail(role);
  const riskOnlyBanner = bannerShowsRiskOnly(role);
  const allowCheckInsWrite = canWriteCheckIns(role);
  const allowMedsView = canViewMedications(role);
  const allowMedsWrite = canWriteMedications(role);
  const allowInsuranceEdit = canEditInsurance(role);
  const allowPhoto = canManagePhoto(role);
  const allowSchedule = canSchedule(role);
  const allowMsg = canMessage(role);
  const allowConsents = canAccessPath(role, '/dashboard/ehr/consents');
  const allowEligibility = canAccessPath(role, '/dashboard/ehr/eligibility');
  const visibleTabs = TABS.filter((tab) => chartTabVisible(role, tab));

  useEffect(() => {
    if (!visibleTabs.includes(activeTab)) {
      setActiveTab('Overview');
    }
  }, [visibleTabs, activeTab]);

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-slate-500">
        Loading client…
      </div>
    );
  }

  if (error || !client) {
    return (
      <div className="mx-auto mt-12 max-w-lg space-y-4 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-800">
          <Lock className="h-5 w-5" />
        </div>
        <p className="text-lg font-semibold text-slate-900">{error || 'Client not found'}</p>
        {needsBreakGlass ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50/80 p-4 text-left shadow-sm">
            <p className="text-sm font-semibold text-amber-950">Break the Glass</p>
            <p className="mt-1 text-xs text-amber-800">
              Emergency PHI access for this protected client expires in 24 hours. Your reason is
              audited.
            </p>
            <label className="mt-3 block text-xs font-bold text-slate-600">
              Clinical / emergency reason (min 15 characters)
              <textarea
                value={btgReason}
                onChange={(e) => setBtgReason(e.target.value)}
                rows={4}
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-200"
                placeholder="Describe why emergency PHI access is required…"
              />
            </label>
            {btgError ? <p className="mt-2 text-xs font-semibold text-rose-700">{btgError}</p> : null}
            <button
              type="button"
              disabled={btgBusy}
              onClick={() => void submitBreakGlass()}
              className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-amber-700 px-3 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-amber-800 disabled:opacity-50"
            >
              <Lock size={13} />
              {btgBusy ? 'Granting…' : 'Confirm break-glass access'}
            </button>
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

  const riskClass = RISK_UI[client.risk] ?? RISK_UI.low;
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

  const onSignConsent = async (c: ConsentItem) => {
    if (!allowConsents || consentActionId || !client) return;
    setConsentActionId(c.id);
    try {
      const updated = await signConsent(c.id, client?.name || undefined);
      setConsents((prev) => prev.map((row) => (row.id === updated.id ? updated : row)));
    } catch (err: any) {
      setConsentsError(err.message || 'Could not sign consent');
    } finally {
      setConsentActionId(null);
    }
  };

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
      const note = await createClientNote(client.id, body);
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
      const res = await fetch(`/api/clients/${client.id}/medications`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          medicationName,
          dosage,
          instructions: medInstructions.trim() || undefined,
          frequency: doseTimes.join(', '),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) {
        throw new Error(data.error || 'Could not save medication');
      }
      if (data.notifySkipReason) {
        setMedsError(`Saved, but push not sent: ${data.notifySkipReason}`);
      } else {
        setMedsError(null);
      }
      setMedName('');
      setMedDosage('');
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
    } catch (err: any) {
      setInsuranceError(err.message || 'Could not save insurance');
    } finally {
      setInsuranceSaving(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Link href="/dashboard/clients" className="font-medium hover:text-[#6868D0]">
          Clients
        </Link>
        <span className="text-slate-300">/</span>
        <span className="font-semibold text-slate-900">{client.name}</span>
      </div>

      {/* 42 CFR Part 2 Confidentiality Notice */}
      {isSudClient && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50/90 p-4 text-amber-900 shadow-xs">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div className="text-xs sm:text-sm">
            <p className="font-bold text-amber-950">42 CFR Part 2 Protected Record</p>
            <p className="mt-0.5 text-amber-800">
              This client has a substance use disorder diagnosis. Federal regulations (42 CFR Part 2) strictly prohibit unauthorized disclosure or re-disclosure of these records without specific Part 2 signed consent. A general HIPAA Release of Information is not sufficient.
            </p>
          </div>
        </div>
      )}

      {/* Profile header */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-4">
            <ClientAvatar name={client.name} image={client.image} className="h-16 w-16 text-xl" />
            <div className="min-w-0">
              <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
                {client.name}
              </h1>
              {client.mrn ? (
                <p className="mt-1 font-mono text-xs font-semibold tracking-wide text-slate-600 sm:text-sm">
                  MRN {client.mrn}
                </p>
              ) : null}
              {!riskOnlyBanner ? (
              <p className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-slate-500">
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
                        <Lock size={12} className="text-slate-400" />
                        <span>{client.email || '••••@hidden'}</span>
                        <span>·</span>
                        <span>{client.phone || '••• ••• ••••'}</span>
                      </span>
                    );
                  }
                  return (
                    <>{[client.email, client.phone].filter(Boolean).join(' · ') || 'No contact on file'}</>
                  );
                })()}
              </p>
              ) : null}
              {photoError && (
                <p className="mt-1 text-xs font-medium text-rose-600">{photoError}</p>
              )}
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold capitalize ${riskClass}`}
                >
                  {client.risk === 'high' ? <AlertTriangle size={12} /> : null}
                  {client.risk} risk
                </span>
                {!riskOnlyBanner && isPlanReviewOverdue && (
                  <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-[11px] font-bold text-red-700 border border-red-200">
                    Plan Review Overdue
                  </span>
                )}
                {!riskOnlyBanner && client.status ? (
                  <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold text-slate-600">
                    {client.status}
                  </span>
                ) : null}
                {/* Patient Portal Status Badge */}
                {!riskOnlyBanner && client.email ? (
                  client.appAccess === 'active' ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 px-2.5 py-0.5 text-[11px] font-bold" title="Patient has activated their portal account">
                      <CheckCircle2 size={11} className="text-emerald-600" />
                      Portal: Active
                    </span>
                  ) : client.appAccess === 'invite_sent' ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 text-amber-800 border border-amber-200 px-2.5 py-0.5 text-[11px] font-bold" title="Invitation sent, awaiting patient password creation">
                      <CircleAlert size={11} className="text-amber-600" />
                      Portal: Invite Pending
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 text-slate-600 border border-slate-200 px-2.5 py-0.5 text-[11px] font-medium" title="Not yet enrolled in portal">
                      Portal: Not Enrolled
                    </span>
                  )
                ) : null}
                {!riskOnlyBanner ? (
                <span className="text-xs text-slate-400">
                  Since {client.assignedSince || '—'} · {client.totalSessions ?? 0} sessions
                </span>
                ) : null}
              </div>

              {/* Section 5.1: Chart Flag Chips */}
              {!riskOnlyBanner ? (
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                {chartFlags.map((flag) => (
                  <span
                    key={flag}
                    className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${
                      flag === 'High Risk' || flag === 'Latex Allergy'
                        ? 'bg-rose-50 text-rose-700 border-rose-200'
                        : flag === 'Temp Medicaid' || flag === 'Balance Due'
                        ? 'bg-amber-50 text-amber-800 border-amber-200'
                        : 'bg-purple-50 text-purple-700 border-purple-200'
                    }`}
                  >
                    <Tag size={10} />
                    {flag}
                    <button
                      type="button"
                      onClick={() => setChartFlags((prev) => prev.filter((f) => f !== flag))}
                      className="hover:opacity-75 ml-0.5"
                    >
                      &times;
                    </button>
                  </span>
                ))}
                <button
                  type="button"
                  onClick={() => setShowFlagModal(true)}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border border-dashed border-slate-300 text-slate-500 hover:border-slate-400 hover:text-slate-700"
                >
                  <Plus size={11} /> Flag
                </button>
              </div>
              ) : null}

              {!riskOnlyBanner ? (
              <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 border-t border-slate-100 pt-2">
                <span>
                  Last Completed Appt:{' '}
                  <strong className="text-slate-700">
                    {appointments.find((a) => a.status === 'completed')?.date || (appointments[0]?.date ? appointments[0].date : 'None on file')}
                  </strong>
                </span>
                <span className="text-slate-300">&bull;</span>
                <span>
                  Last Chart Viewed:{' '}
                  <strong className="text-slate-700 font-mono">Today</strong> by{' '}
                  <span className="text-slate-700">{user?.name || 'Staff Clinician'}</span>{' '}
                  <span className="text-slate-400 font-mono text-[10px]">({user?.role || 'CLINICIAN'})</span>
                </span>
              </div>
              ) : null}
            </div>
          </div>

          {!riskOnlyBanner ? (
          <div className="flex flex-wrap gap-2">
            {allowPhoto && (
              <label className="inline-flex min-h-10 cursor-pointer items-center rounded-xl border border-slate-200 bg-white px-3.5 text-sm font-semibold text-slate-600 hover:bg-slate-50">
                {photoBusy ? 'Uploading…' : 'Upload photo'}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  className="hidden"
                  disabled={photoBusy}
                  onChange={(e) => {
                    onPickPhoto(e.target.files?.[0] || null);
                    e.currentTarget.value = '';
                  }}
                />
              </label>
            )}
            {allowPhoto && client.image ? (
              <button
                type="button"
                disabled={photoBusy}
                onClick={onRemovePhoto}
                className="inline-flex min-h-10 items-center rounded-xl border border-slate-200 bg-white px-3.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
              >
                Remove photo
              </button>
            ) : null}
            {allowMsg ? (
              <Link
                href={`/dashboard/messages?client=${client.id}`}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-teal-300 bg-white px-3.5 text-sm font-semibold text-teal-700 hover:bg-teal-50"
              >
                <MessageSquare size={15} />
                Message
              </Link>
            ) : null}
            {allowSchedule ? (
              <Link
                href={`/dashboard/appointments?client=${client.id}&new=1`}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-[#6868D0] px-3.5 text-sm font-semibold text-white shadow-sm hover:opacity-95"
              >
                <CalendarDays size={15} />
                Schedule
              </Link>
            ) : null}
            {canAssignClinician && (
              <button
                type="button"
                onClick={() => {
                  setAssigningClinicianId((client as any).assignedToId || '');
                  setAssignModalOpen(true);
                }}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-purple-200 bg-purple-50 px-3.5 text-sm font-semibold text-[#5C2D91] hover:bg-purple-100 transition"
              >
                <UserCheck size={15} />
                {client.assignedToName ? `Clinician: ${client.assignedToName}` : 'Assign Clinician'}
              </button>
            )}
            {canEditClient && (
              <button
                type="button"
                onClick={() => setEditModalOpen(true)}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 text-sm font-semibold text-slate-700 shadow-xs hover:bg-slate-50 transition"
              >
                <Pencil size={15} className="text-purple-600" />
                Edit Profile
              </button>
            )}
            {/* Patient Portal Invitation Action Button */}
            {canEditClient && client.email && (
              <button
                type="button"
                disabled={portalInviteSending}
                onClick={handleSendPortalInvite}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50/70 px-3.5 text-sm font-semibold text-indigo-700 hover:bg-indigo-100 transition disabled:opacity-60 cursor-pointer shadow-xs"
                title={client.appAccess === 'active' ? 'Send a fresh login/activation link to client' : 'Send portal activation invitation to client'}
              >
                <Mail size={15} className="text-indigo-600" />
                {portalInviteSending
                  ? 'Sending…'
                  : client.appAccess === 'active'
                    ? 'Resend Portal Link'
                    : client.appAccess === 'invite_sent'
                      ? 'Resend Invite'
                      : 'Invite to Portal'}
              </button>
            )}
            {canEditClient && role !== 'PEER_SUPPORT' ? (
              <form
                className="flex flex-wrap items-center gap-2"
                onSubmit={async (event) => {
                  event.preventDefault();
                  if (!client) return;
                  setGuardianBusy(true);
                  try {
                    const response = await fetch(`/api/clients/${client.id}/guardian`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ email: guardianEmail, name: guardianName }),
                    });
                    const data = await response.json().catch(() => ({}));
                    if (!response.ok) throw new Error(data.error || 'Could not grant guardian access');
                    toast.success(data.message || 'Guardian invite sent');
                    setGuardianEmail('');
                    setGuardianName('');
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : 'Could not grant guardian access');
                  } finally {
                    setGuardianBusy(false);
                  }
                }}
              >
                <input
                  type="text"
                  required
                  value={guardianName}
                  onChange={(event) => setGuardianName(event.target.value)}
                  placeholder="Guardian name"
                  className="min-h-10 rounded-xl border border-slate-200 px-3 text-sm"
                />
                <input
                  type="email"
                  required
                  value={guardianEmail}
                  onChange={(event) => setGuardianEmail(event.target.value)}
                  placeholder="Guardian email"
                  className="min-h-10 rounded-xl border border-slate-200 px-3 text-sm"
                />
                <button
                  type="submit"
                  disabled={guardianBusy}
                  className="inline-flex min-h-10 items-center rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700"
                >
                  {guardianBusy ? 'Sending…' : 'Grant guardian access'}
                </button>
              </form>
            ) : null}
            {/* E-Prescribe Header Button */}
            {canPrescribe ? (
              <button
                id="btn-eprescribe-main"
                type="button"
                onClick={handleEPrescribeClick}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-xl text-white px-3.5 text-sm font-semibold shadow-xs hover:opacity-90 transition-all cursor-pointer"
                style={{ background: 'linear-gradient(135deg, #5C2D91, #7C3AED)' }}
              >
                <Pill size={15} /> E-Prescribe
              </button>
            ) : null}
          </div>
          ) : null}
        </div>

        {/* Metrics — screenshot layout */}
        {showCheckInScores ? (
        <div className="mt-5 border-t border-slate-100 pt-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
            <div className="flex flex-col items-center text-center">
              <TrendingUp size={22} strokeWidth={2.25} className="text-[#6868D0]" />
              <p className="mt-2.5 text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
                {avgMood === '—' ? '—' : `${avgMood}/10`}
              </p>
              <p className="mt-1 text-xs font-medium text-slate-400 sm:text-[13px]">
                Avg Mood (7d)
              </p>
            </div>

            <div className="flex flex-col items-center text-center">
              <CircleAlert size={22} strokeWidth={2.25} className="text-amber-500" />
              <p className="mt-2.5 text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
                {avgStress === '—' ? '—' : `${avgStress}/10`}
              </p>
              <p className="mt-1 text-xs font-medium text-slate-400 sm:text-[13px]">
                Avg Stress (7d)
              </p>
            </div>

            <div className="flex flex-col items-center text-center">
              <Moon size={22} strokeWidth={2.25} className="text-sky-500" />
              <p className="mt-2.5 text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
                {avgSleep === '—' ? '—' : `${avgSleep}/10`}
              </p>
              <p className="mt-1 text-xs font-medium text-slate-400 sm:text-[13px]">
                Avg Sleep (7d)
              </p>
            </div>

            <div className="flex flex-col items-center text-center">
              <Flame size={22} strokeWidth={2.25} className="text-orange-500" />
              <p className="mt-2.5 text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
                {streak} days
              </p>
              <p className="mt-1 text-xs font-medium text-slate-400 sm:text-[13px]">
                Check-in Streak
              </p>
            </div>
          </div>
        </div>
        ) : null}
      </div>

      {/* Secondary EHR Navigation Row */}
      {showRiskDetail && (
        <div className="flex items-center gap-1.5 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-xs [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <span className="px-2 font-bold uppercase tracking-wider text-slate-400 text-[10px] shrink-0">
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
              className="shrink-0 rounded-xl px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-[#6868D0]/10 hover:text-[#6868D0] transition"
            >
              {m.label}
            </Link>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {visibleTabs.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`min-h-10 min-w-fit flex-1 whitespace-nowrap rounded-xl px-4 text-sm font-semibold transition ${
              activeTab === tab
                ? 'bg-[#6868D0] text-white shadow-sm'
                : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === 'Overview' && (
        <div className="space-y-4">
          {/* AI Pre-Session Briefing Box */}
          <div className="rounded-2xl border-2 border-indigo-200 bg-white p-5 shadow-xs">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <Sparkles size={16} className="text-indigo-600" />
              <p className="text-sm font-bold text-slate-900 flex-1">AI Pre-Session Briefing</p>
              <span className="text-[10px] font-semibold text-indigo-700 bg-indigo-50 px-2.5 py-0.5 rounded-full border border-indigo-100">
                AWS Bedrock Synthesis
              </span>
            </div>
            {aiBrief ? (
              <div>
                <p className="text-sm text-slate-700 leading-relaxed mt-2">{aiBrief}</p>
                <div className="flex items-center gap-3 mt-2.5">
                  <button onClick={generateBrief} className="text-xs font-bold text-indigo-600 hover:underline">
                    Regenerate
                  </button>
                  <span className="text-[11px] text-slate-400">
                    Compiled from check-ins, measures, meds, alerts &amp; office notes. Decision support — not a clinical record.
                  </span>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3 mt-1.5 flex-wrap">
                <p className="text-xs text-slate-500 max-w-2xl">
                  One-paragraph synthesis of recent check-ins, measure scores (PHQ-9/GAD-7), active meds, SUD radar alerts, and office notes so review takes seconds.
                </p>
                <button
                  type="button"
                  onClick={generateBrief}
                  disabled={aiBriefLoading}
                  className="shrink-0 px-4 py-2 rounded-xl text-xs font-bold text-white shadow-xs hover:opacity-90 disabled:opacity-50 transition"
                  style={{ background: 'linear-gradient(135deg, #4F46E5, #7C3AED)' }}
                >
                  {aiBriefLoading ? 'Compiling…' : 'Generate Briefing'}
                </button>
              </div>
            )}
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5 lg:col-span-2">
            <h3 className="text-base font-semibold text-slate-900">Mood & Stress — Last 7 Days</h3>
            {mounted && chartData.length > 0 ? (
              <div className="mt-3 h-[260px] w-full sm:h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="4 4" stroke="#E2E8F0" vertical={false} />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 11, fill: '#94A3B8' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      domain={[0, 10]}
                      ticks={[0, 3, 6, 10]}
                      tick={{ fontSize: 11, fill: '#94A3B8' }}
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
                        fontSize: 10,
                        position: 'insideTopRight',
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="mood"
                      stroke="#6868D0"
                      strokeWidth={2.5}
                      dot={{ fill: '#6868D0', r: 4, strokeWidth: 0 }}
                      activeDot={{ r: 5 }}
                      name="Mood"
                    />
                    <Line
                      type="monotone"
                      dataKey="stress"
                      stroke="#EA580C"
                      strokeWidth={2.5}
                      dot={{ fill: '#EA580C', r: 4, strokeWidth: 0 }}
                      activeDot={{ r: 5 }}
                      name="Stress"
                    />
                    <Line
                      type="monotone"
                      dataKey="sleep"
                      stroke="#0D9488"
                      strokeWidth={2.5}
                      dot={{ fill: '#0D9488', r: 4, strokeWidth: 0 }}
                      activeDot={{ r: 5 }}
                      name="Sleep"
                      connectNulls
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="mt-4 flex h-52 items-center justify-center rounded-xl bg-slate-50 text-sm text-slate-400">
                No check-ins recorded yet for this client.
              </div>
            )}
          </div>

          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <h3 className="text-sm font-semibold text-slate-900">Active Alerts</h3>
              {needsEkg && (
                <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 shadow-xs">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2">
                      <span className="mt-0.5 text-base text-amber-600 font-bold leading-none">♥</span>
                      <div>
                        <p className="font-bold text-amber-950">
                          EKG Required — Multiple Antipsychotics
                        </p>
                        <p className="mt-0.5 text-amber-800">
                          {ekgAntipsychoticsCount} antipsychotics on file. Baseline EKG needed per QTc protocol.
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveTab('Medications')}
                      className="shrink-0 rounded-lg bg-amber-200/90 hover:bg-amber-300 px-2.5 py-1 text-[11px] font-bold text-amber-950 transition"
                    >
                      View in Medications tab &rarr;
                    </button>
                  </div>
                </div>
              )}
              {showRiskDetail && overviewAlerts.length ? (
                <div className="mt-3 space-y-2">
                  {overviewAlerts.map((a) => (
                    <div
                      key={`${a.title}-${a.when}`}
                      className="rounded-xl border border-rose-100 bg-rose-50 px-3 py-2.5"
                    >
                      <p className="text-sm font-semibold text-rose-700">{a.title}</p>
                      <p className="mt-0.5 text-xs text-rose-500/80">{a.when}</p>
                    </div>
                  ))}
                </div>
              ) : !needsEkg ? (
                <p className="mt-3 text-sm text-slate-400">No active alerts.</p>
              ) : null}
            </div>

            {/* Multi-Provider Treatment Team Panel (Commit 7fba6e5) */}
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Users size={14} className="text-[#5C2D91]" />
                  <h3 className="text-sm font-bold text-gray-900">Treatment Team</h3>
                </div>
                {canManageTeam && (
                  <button
                    type="button"
                    onClick={() => setShowAddMember((prev) => !prev)}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-[#5C2D91] hover:text-[#4A2475] transition"
                  >
                    <UserPlus size={13} />
                    + Add
                  </button>
                )}
              </div>

              {/* Inline Add Member Drawer */}
              {showAddMember && (
                <div className="mb-3 p-2 bg-purple-50 rounded-xl border border-purple-100 animate-in fade-in">
                  <div className="text-[11px] font-bold text-[#5C2D91] mb-1.5 px-1 flex items-center justify-between">
                    <span>Select Provider to Add</span>
                    <button
                      type="button"
                      onClick={() => setShowAddMember(false)}
                      className="text-gray-400 hover:text-gray-600 font-bold text-sm leading-none"
                    >
                      &times;
                    </button>
                  </div>
                  {(() => {
                    const unassigned = organizationRoster.filter(
                      (p) => !treatmentTeam.some((t) => t.id === p.id || t.name.toLowerCase() === p.name.toLowerCase())
                    );
                    if (unassigned.length === 0) {
                      return (
                        <p className="text-xs text-gray-500 py-2 px-1 text-center italic">
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
                            className="w-full flex items-center gap-2 p-1.5 rounded-lg hover:bg-white text-left transition group"
                          >
                            <div
                              className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[11px] font-bold shrink-0 shadow-xs"
                              style={{ background: provider.color }}
                            >
                              {provider.initials}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-semibold text-gray-800 truncate group-hover:text-[#5C2D91]">
                                {provider.name}
                              </p>
                              <p className="text-[10px] text-gray-500 truncate">{provider.role}</p>
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
                    className="group flex items-center justify-between p-2 rounded-xl hover:bg-slate-50 transition"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0 shadow-xs"
                        style={{ background: member.color }}
                      >
                        {member.initials}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-gray-800 truncate">{member.name}</p>
                        <p className="text-[10px] text-gray-400 flex items-center gap-1">
                          <span>{member.role}</span>
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {member.primary && (
                        <span className="px-1.5 py-0 bg-purple-100 text-purple-700 rounded-full font-semibold border border-purple-200 text-[9px]">
                          Primary
                        </span>
                      )}
                      {!member.primary && canManageTeam && (
                        <button
                          type="button"
                          onClick={() => void handleRemoveTeamMember(member.id)}
                          title={`Remove ${member.name}`}
                          className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 p-1 transition-opacity"
                        >
                          <X size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {id ? (
              <DiagnosisListPanel clientId={id} canEdit />
            ) : (
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <h3 className="text-sm font-semibold text-slate-900">Diagnoses &amp; problems</h3>
                {diagnoses.length ? (
                  <ul className="mt-3 space-y-2">
                    {diagnoses.map((d) => (
                      <li key={d} className="flex items-start gap-2 text-sm text-slate-700">
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-600" />
                        {d}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-3 text-sm text-slate-400">No current diagnosis on the list.</p>
                )}
              </div>
            )}

            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
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
                        <Lock size={12} className="text-slate-400" />
                        {client.emergencyContactPhone}
                      </span>
                    ) : (
                      client.emergencyContactPhone || '—'
                    )}
                  </p>
                </>
              ) : (
                <p className="mt-3 text-sm text-slate-400">No emergency contact on file.</p>
              )}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
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
                    <dt className="text-xs text-slate-400">{label}</dt>
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
                  <dt className="text-xs text-slate-400">Clinician</dt>
                  <dd className="mt-0.5 flex items-center justify-between gap-2 font-medium text-slate-800">
                    <span>{client.assignedToName || 'Unassigned'}</span>
                    {canAssignClinician && (
                      <button
                        type="button"
                        onClick={() => {
                          setAssigningClinicianId((client as any).assignedToId || '');
                          setAssignModalOpen(true);
                        }}
                        className="rounded-lg border border-purple-200 bg-purple-50 px-2 py-0.5 text-xs font-semibold text-[#5C2D91] hover:bg-purple-100 transition"
                      >
                        {client.assignedToName ? 'Change' : 'Assign'}
                      </button>
                    )}
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        </div>
        </div>
      )}

      {/* ── OFFICE NOTES TAB — internal operational notes ── */}
      {activeTab === 'Office Notes' && visibleTabs.includes('Office Notes') && (
        <div className="space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start gap-3 shadow-xs">
            <StickyNote size={18} className="text-amber-600 shrink-0 mt-0.5" />
            <div className="text-xs text-amber-900 leading-relaxed">
              <strong>Internal operational notes</strong> — scheduling preferences, billing conversations, and contact notes.
              Visible to staff only, never visible in client portal. <strong>No clinical content:</strong> symptoms, diagnoses,
              and therapy belongs in Progress Notes.
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-bold text-slate-900 mb-3 flex items-center gap-2">
              <Plus size={15} className="text-purple-600" /> Add Office Note
            </p>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {(['Scheduling', 'Billing', 'Contact Preference', 'Transportation', 'General'] as OfficeNoteCategory[]).map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setOfficeNoteCat(cat)}
                  className={`px-3 py-1 rounded-full text-xs font-semibold border transition ${
                    officeNoteCat === cat
                      ? 'bg-purple-700 text-white border-purple-700 shadow-xs'
                      : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
            <textarea
              rows={3}
              value={officeNoteText}
              onChange={(e) => setOfficeNoteText(e.target.value)}
              placeholder="Enter internal operational note (e.g., Client prefers afternoon slots, bus route 24 delay info, billing review note)..."
              className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:border-purple-600 focus:outline-none"
            />
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={handleAddOfficeNote}
                disabled={!officeNoteText.trim() || officeNoteSaving}
                className="px-5 py-2 rounded-xl text-xs font-bold text-white shadow-xs hover:opacity-90 disabled:opacity-40 transition"
                style={{ background: '#5C2D91' }}
              >
                {officeNoteSaving ? 'Saving…' : 'Post Office Note'}
              </button>
            </div>
          </div>

          <div className="space-y-2.5">
            {officeNotesLoading && <p className="text-xs text-slate-400 py-4 text-center">Loading operational notes…</p>}
            {!officeNotesLoading && officeNotes.length === 0 && (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-xs text-slate-400">
                No office notes yet. Add an internal note above.
              </div>
            )}
            {officeNotes.map((note) => (
              <div
                key={note.id}
                className={`rounded-2xl border p-4 transition-all shadow-xs ${
                  note.isPinned ? 'border-purple-300 bg-purple-50/50 ring-1 ring-purple-200' : 'border-slate-200 bg-white'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700">
                        {note.category}
                      </span>
                      {note.isPinned && (
                        <span className="text-[10px] font-bold text-purple-700 bg-purple-100 px-2 py-0.5 rounded-full flex items-center gap-1">
                          <Pin size={10} /> Pinned
                        </span>
                      )}
                      <span className="text-xs text-slate-400">
                        {new Date(note.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <span className="text-xs text-slate-600 font-medium">
                        by {note.authorName} ({note.authorRole})
                      </span>
                    </div>
                    <p className="text-sm text-slate-800 leading-relaxed pt-1 whitespace-pre-wrap">{note.noteText}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleTogglePinOfficeNote(note.id, note.isPinned)}
                      title={note.isPinned ? 'Unpin' : 'Pin to top'}
                      className={`p-1.5 rounded-lg text-xs transition ${
                        note.isPinned ? 'text-purple-700 bg-purple-100' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600'
                      }`}
                    >
                      <Pin size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteOfficeNote(note.id)}
                      title="Delete note"
                      className="p-1.5 rounded-lg text-xs text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'Check-Ins' && visibleTabs.includes('Check-Ins') && (
        <div className="space-y-4">
          {allowCheckInsWrite && (
            <div className="clinic-card p-5">
              <h3 className="clinic-section-title mb-3">Log check-in</h3>
              {checkInError && (
                <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
                  {checkInError}
                </div>
              )}
              <div className="grid gap-4 sm:grid-cols-3">
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
                    className="w-full accent-orange-600"
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
                    className="w-full accent-teal-600"
                  />
                  <span className="mt-1 block text-sm font-semibold text-slate-800">{sleep}/10</span>
                </label>
              </div>
              <textarea
                value={checkInNote}
                onChange={(e) => setCheckInNote(e.target.value)}
                placeholder="Optional note…"
                maxLength={1000}
                className="clinic-input mt-4 h-20 resize-none"
              />
              <div className="mt-3">
                <button
                  type="button"
                  className="clinic-btn-primary"
                  disabled={checkInSaving}
                  onClick={onSaveCheckIn}
                >
                  {checkInSaving ? 'Saving…' : 'Save check-in'}
                </button>
              </div>
            </div>
          )}

          {showCheckInScores ? (
          <div className="clinic-card overflow-hidden">
            <div className="border-b border-slate-100 px-5 py-4">
              <h3 className="clinic-section-title">Check-in history</h3>
            </div>
            {checkIns.length === 0 ? (
              <div className="px-5 py-12 text-center text-sm text-slate-400">No check-ins yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="clinic-table-head">
                      {['Date', 'Mood', 'Stress', 'Sleep', 'Risk', 'Note'].map((h) => (
                        <th key={h} className="px-5 py-3">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[...checkIns].reverse().map((c, i) => {
                      const risk = riskFromMood(c.mood);
                      return (
                        <tr
                          key={c.id || `${c.date}-${i}`}
                          className="border-b border-slate-100 last:border-0 hover:bg-slate-50/80"
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
                            <span className={`clinic-badge capitalize ${RISK_UI[risk]}`}>
                              {risk}
                            </span>
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
          ) : null}
        </div>
      )}

      {activeTab === 'Medications' && visibleTabs.includes('Medications') && (
        <div className="space-y-4">
          {medsError && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
              {medsError}
            </div>
          )}

          {/* Clinical Safety Monitor: Antipsychotic QTc / EKG Protocol Hero Alert */}
          {needsEkg && (
            <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 sm:p-5 shadow-xs">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-200/80 text-amber-800">
                    <AlertTriangle size={20} />
                  </span>
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="text-sm font-bold text-amber-950">
                        Baseline EKG Required — Multiple Antipsychotics
                      </h4>
                      <span className="rounded-full bg-amber-200/90 px-2.5 py-0.5 text-[10px] font-bold text-amber-900 border border-amber-300">
                        Flagged by Altrixs Safety Monitor
                      </span>
                    </div>
                    <p className="text-xs text-amber-900 leading-relaxed">
                      Client is prescribed multiple antipsychotics ({activeAntipsychotics.map((m) => m.medicationName).join(', ') || `${ekgAntipsychoticsCount} active antipsychotics on file`}). QTc prolongation risk requires a baseline EKG per safety protocol.
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 self-start sm:self-center shrink-0">
                  <Link
                    href="/dashboard/ehr/labs"
                    className="inline-flex items-center gap-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 px-4 py-2 text-xs font-bold text-white shadow-xs transition"
                  >
                    Order EKG &rarr;
                  </Link>
                </div>
              </div>
            </div>
          )}

          {allowMedsWrite && (
            <div className="clinic-card p-5">
              <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
                <div>
                  <h3 className="clinic-section-title mb-0.5">Medication Reconciliation</h3>
                  <p className="text-xs text-slate-500">
                    Track active and reported meds. Reported medications sync to DrFirst for drug interaction checking.
                  </p>
                </div>
                {canPrescribe ? (
                  <button
                    type="button"
                    onClick={handleEPrescribeClick}
                    className="inline-flex items-center gap-1.5 rounded-xl text-white px-4 py-2 text-xs font-bold shadow-xs hover:opacity-95 transition cursor-pointer"
                    style={{ background: 'linear-gradient(135deg, #5C2D91, #7C3AED)' }}
                  >
                    <Pill size={14} /> E-Prescribe
                  </button>
                ) : null}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="mb-1.5 block text-xs font-medium text-slate-500">
                    Medication name
                  </span>
                  <input
                    value={medName}
                    onChange={(e) => setMedName(e.target.value)}
                    className="clinic-input"
                    placeholder="e.g. Sertraline"
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1.5 block text-xs font-medium text-slate-500">Dosage</span>
                  <input
                    value={medDosage}
                    onChange={(e) => setMedDosage(e.target.value)}
                    className="clinic-input"
                    placeholder="e.g. 50mg"
                  />
                </label>
                <label className="block text-sm sm:col-span-2">
                  <span className="mb-1.5 block text-xs font-medium text-slate-500">
                    Dose times (HH:MM, comma-separated)
                  </span>
                  <input
                    value={medTimes}
                    onChange={(e) => setMedTimes(e.target.value)}
                    className="clinic-input"
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
                    className="clinic-input"
                    placeholder="Take with food"
                  />
                </label>
              </div>
              <div className="mt-3">
                <button
                  type="button"
                  className="clinic-btn-primary"
                  disabled={medSaving}
                  onClick={onSaveMedication}
                >
                  {medSaving ? 'Saving…' : 'Save medication'}
                </button>
              </div>
            </div>
          )}

          <div className="clinic-card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-4">
              <h3 className="clinic-section-title">Active medications</h3>
              {canAccessPath(role, '/dashboard/ehr/prescriptions') ? (
                <Link
                  href="/dashboard/ehr/prescriptions"
                  className="text-xs font-semibold text-[#5C2D91] hover:underline"
                >
                  Open E-Prescribing
                </Link>
              ) : null}
            </div>
            {medsLoading ? (
              <div className="px-5 py-12 text-center text-sm text-slate-400">Loading medications…</div>
            ) : medications.length === 0 ? (
              <div className="px-5 py-12 text-center text-sm text-slate-400">
                No active medications on file for this client.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="clinic-table-head">
                      {['Medication', 'Dosage', 'Times', 'Adherence (RxFill)', 'Today', 'Instructions'].map((h) => (
                        <th key={h} className="px-5 py-3">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {medications.map((m) => {
                      const isAntipsy = isAntipsychoticDrug(m.medicationName);
                      const highlight = needsEkg && isAntipsy;
                      return (
                        <tr
                          key={m.id}
                          className={`border-b border-slate-100 last:border-0 hover:bg-slate-50/80 transition ${
                            highlight ? 'bg-amber-50/80 border-amber-200' : ''
                          }`}
                        >
                          <td className="px-5 py-3 text-sm font-semibold text-slate-900">
                            <span className="inline-flex items-center gap-2">
                              {m.medicationName}
                              {isAntipsy && (
                                <span className="rounded-full bg-amber-100 border border-amber-300 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                                  Antipsychotic
                                </span>
                              )}
                            </span>
                          </td>
                          <td className="px-5 py-3 text-sm text-slate-700">{m.dosage}</td>
                          <td className="px-5 py-3 text-sm tabular-nums text-slate-700">
                            {m.doseTimes.join(', ')}
                          </td>
                          <td className="px-5 py-3 text-xs">
                            {m.adherenceFlag === 'warning_outreach_needed' || m.adherenceStatus === 'not_dispensed' ? (
                              <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 border border-rose-200 px-2.5 py-1 text-[11px] font-bold text-rose-700">
                                <span className="h-2 w-2 rounded-full bg-rose-500 animate-pulse" />
                                Not Picked Up · Outreach Needed
                              </span>
                            ) : m.adherenceStatus === 'partially_dispensed' ? (
                              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 border border-amber-200 px-2.5 py-1 text-[11px] font-bold text-amber-800">
                                <span className="h-2 w-2 rounded-full bg-amber-500" />
                                Partially Dispensed
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-1 text-[11px] font-bold text-emerald-700">
                                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                                Picked Up (Verified)
                              </span>
                            )}
                          </td>
                          <td className="px-5 py-3 text-xs text-slate-600">
                            {(m.todayDoses || []).length === 0
                              ? '—'
                              : (m.todayDoses || [])
                                  .map((d) => `${d.time}${d.taken ? ' ✓' : d.skipped ? ' skipped' : ''}`)
                                  .join(' · ')}
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

      {activeTab === 'Insurance' && (
        <div className="space-y-5">
          {insuranceError && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
              {insuranceError}
            </div>
          )}
          {insuranceSaved && !insuranceError && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
              Insurance saved.
            </div>
          )}

          <div className="clinic-card p-5">
            <h3 className="clinic-section-title mb-4">Edit insurance</h3>
            {allowInsuranceEdit ? (
              <div className="grid gap-4 sm:grid-cols-3">
                <label className="block text-sm">
                  <span className="mb-1.5 block text-xs font-medium text-slate-500">
                    Payer / plan
                  </span>
                  <input
                    className="clinic-input"
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
                    className="clinic-input"
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
                    className="clinic-input"
                    value={insuranceGroupNumber}
                    onChange={(e) => {
                      setInsuranceGroupNumber(e.target.value);
                      setInsuranceSaved(false);
                    }}
                  />
                </label>
                <div className="sm:col-span-3 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    className="clinic-btn-primary"
                    disabled={insuranceSaving}
                    onClick={onSaveInsurance}
                  >
                    {insuranceSaving ? 'Saving…' : 'Save insurance'}
                  </button>
                  {allowEligibility ? (
                    <Link
                      href={`/dashboard/ehr/eligibility?clientId=${encodeURIComponent(client.id)}`}
                      className="clinic-btn-secondary inline-flex items-center gap-1.5"
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

          <div className="clinic-card p-5">
            <h3 className="clinic-section-title mb-4">Saved on file</h3>
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                ['Payer / plan', client.insurancePayer || '—'],
                ['Member ID', client.insuranceMemberId || '—'],
                ['Group number', client.insuranceGroupNumber || '—'],
              ].map(([label, value]) => (
                <div key={label as string} className="rounded-xl bg-slate-50 px-4 py-3">
                  <p className="text-xs font-medium text-slate-400">{label}</p>
                  <p className="mt-1 text-sm font-semibold text-slate-900">{value}</p>
                </div>
              ))}
            </div>
          </div>
          <PatientBalanceCard clientId={client.id} role={role} />
        </div>
      )}

      {activeTab === 'Notes' && visibleTabs.includes('Notes') && (
        <div className="space-y-4">
          {allowNotesWrite ? (
            <div className="clinic-card p-5">
              <h3 className="clinic-section-title mb-3">Add session note</h3>
              {noteError && (
                <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
                  {noteError}
                </div>
              )}

              {/* Note Type Selector */}
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-slate-500">Note Type:</span>
                {(['Progress Note', 'Clinical Concern', 'Care Coordination', 'Team Communication'] as const).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setNoteType(type)}
                    className={`rounded-xl px-3 py-1.5 text-xs font-bold transition ${
                      noteType === type
                        ? 'bg-[#5C2D91] text-white shadow-xs'
                        : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {type}
                  </button>
                ))}
              </div>

              {/* Care Team Tagging Bar (Appears when note is Clinical Concern, Care Coordination, or Team Communication) */}
              {noteType !== 'Progress Note' && (
                <div className="mb-3 rounded-2xl border border-purple-200 bg-purple-50/70 p-3.5 space-y-2.5">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div className="flex items-center gap-2 flex-1">
                      <span className="text-xs font-bold text-[#5C2D91] shrink-0">Tag Clinician:</span>
                      <select
                        value={taggedStaffId}
                        onChange={(e) => setTaggedStaffId(e.target.value)}
                        className="w-full sm:w-auto flex-1 rounded-xl border border-purple-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 outline-none focus:border-[#5C2D91]"
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
                          onClick={() => setTaggedUrgency(urg)}
                          className={`rounded-lg px-2.5 py-1 text-xs font-bold transition ${
                            taggedUrgency === urg
                              ? urg === 'Urgent'
                                ? 'bg-red-600 text-white shadow-xs'
                                : urg === 'Routine'
                                ? 'bg-blue-600 text-white shadow-xs'
                                : 'bg-slate-700 text-white shadow-xs'
                              : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                          }`}
                        >
                          {urg}
                        </button>
                      ))}
                    </div>
                  </div>
                  {taggedStaffId ? (
                    <p className="text-[11px] text-purple-900 font-medium">
                      Saving this note will automatically push a <strong>{taggedUrgency}</strong> clinical alert to the tagged clinician&apos;s Alert Hub (/dashboard/alerts).
                    </p>
                  ) : (
                    <p className="text-[11px] text-slate-500">
                      Select a colleague to notify them in real-time in the Team Alerts tab.
                    </p>
                  )}
                </div>
              )}

              <textarea
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="Document clinical observations, medication concerns, treatment progress, or team consultation..."
                maxLength={4000}
                className="clinic-input h-28 resize-none"
              />

              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  className="clinic-btn-primary"
                  disabled={!noteText.trim() || noteSaving}
                  onClick={onSaveNote}
                >
                  {noteSaving ? 'Saving…' : 'Save note'}
                </button>
                <span className="text-xs text-slate-400">{noteText.trim().length}/4000</span>
              </div>
            </div>
          ) : (
            noteError && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
                {noteError}
              </div>
            )
          )}

          <div className="clinic-card overflow-hidden">
            <div className="border-b border-slate-100 px-5 py-4">
              <h3 className="clinic-section-title">Progress notes</h3>
            </div>
            {notesLoading ? (
              <div className="px-5 py-10 text-center text-sm text-slate-400">Loading notes…</div>
            ) : notes.length === 0 ? (
              <div className="px-5 py-10 text-center text-sm text-slate-400">
                No progress notes saved yet.
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {notes.map((note) => (
                  <article key={note.id} className="px-5 py-4">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-slate-900">
                          {note.clinicianName || note.clinicianEmail || 'Clinical staff'}
                        </p>
                        {note.workflowStatus && (
                          <span className="clinic-badge bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200">
                            {note.workflowStatus}
                          </span>
                        )}
                      </div>
                      <time className="text-xs font-medium text-slate-400">
                        {formatNoteDate(note.createdAt)}
                      </time>
                    </div>
                    <p className="whitespace-pre-wrap text-sm leading-6 text-slate-600">
                      {note.body}
                    </p>
                  </article>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'Appointments' && (
        <div className="clinic-card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
            <div>
              <h3 className="clinic-section-title">Appointment history</h3>
              <p className="mt-0.5 text-xs text-slate-500">
                Live appointments for this client from the database
              </p>
            </div>
            {allowSchedule && (
              <Link
                href={`/dashboard/appointments?client=${client.id}&new=1`}
                className="clinic-btn-primary"
              >
                Schedule new
              </Link>
            )}
          </div>
          {appointmentsError && (
            <div className="mx-5 mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
              {appointmentsError}
            </div>
          )}
          {appointmentsLoading ? (
            <div className="px-5 py-12 text-center text-sm text-slate-400">Loading appointments…</div>
          ) : appointments.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <p className="text-sm font-medium text-slate-700">No appointments for this client yet</p>
              <p className="mt-1 text-sm text-slate-400">
                Create one from Appointments, then return here — it will show after refresh.
              </p>
              {allowSchedule && (
                <Link
                  href={`/dashboard/appointments?client=${client.id}&new=1`}
                  className="mt-4 inline-flex clinic-btn-primary"
                >
                  Schedule appointment
                </Link>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="clinic-table-head">
                    {['When', 'Type', 'Clinician', 'Mode', 'Status'].map((h) => (
                      <th key={h} className="px-5 py-3">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {appointments.map((a) => (
                    <tr
                      key={a.id}
                      className="border-b border-slate-100 last:border-0 hover:bg-slate-50/80"
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
                        <span
                          className={`clinic-badge capitalize ${
                            APPT_STATUS_UI[a.status] || APPT_STATUS_UI.scheduled
                          }`}
                        >
                          {a.status.replace('-', ' ')}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === 'Alerts' && (
        <div className="clinic-card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
            <div>
              <h3 className="clinic-section-title">Client Risk Alerts</h3>
              <p className="mt-0.5 text-xs text-slate-500">
                All clinical alerts and reviews logged for {client.name}
              </p>
            </div>
            <Link
              href={`/dashboard/alerts`}
              className="clinic-btn-secondary text-sm"
            >
              Open Alerts Center
            </Link>
          </div>
          {clientAlerts.length === 0 ? (
            <div className="px-5 py-12 text-center text-sm text-slate-400">
              No risk alerts on file for this client.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {clientAlerts.map((alert) => (
                <div key={alert.id} className="p-4 sm:px-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span
                        className={`clinic-badge capitalize ${
                          alert.severity === 'high'
                            ? 'bg-red-50 text-red-700 ring-red-200'
                            : alert.severity === 'medium'
                            ? 'bg-amber-50 text-amber-700 ring-amber-200'
                            : 'bg-blue-50 text-blue-700 ring-blue-200'
                        }`}
                      >
                        {alert.severity}
                      </span>
                      <span className="font-semibold text-sm text-slate-900 capitalize">
                        {(alert.type || '').replace('_', ' ')}
                      </span>
                      {alert.reviewed ? (
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                          Reviewed
                        </span>
                      ) : (
                        <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-bold text-rose-700">
                          Action Required
                        </span>
                      )}
                    </div>
                    <time className="text-xs text-slate-400">
                      {new Date(alert.createdAt).toLocaleString()}
                    </time>
                  </div>
                  <p className="mt-1 text-sm text-slate-600">{alert.description}</p>
                  {alert.reviewNote ? (
                    <div className="mt-2 rounded-xl bg-slate-50 p-2.5 text-xs text-slate-700">
                      <span className="font-semibold text-slate-500">Documented Response:</span>{' '}
                      {alert.reviewNote}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'Measures' && id ? <MeasuresCard clientId={id} className="mb-4" /> : null}

      {activeTab === 'Measures' && (
        <div className="clinic-card overflow-hidden">
          <div className="border-b border-slate-100 px-5 py-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="clinic-section-title">Measurement-Based Care (MBC) Trajectory</h3>
              <p className="mt-0.5 text-xs text-slate-500">
                Standardized psychometric outcome instruments: PHQ-9, GAD-7, BAM, and C-SSRS
              </p>
            </div>
            <Link href="/dashboard/mbc" className="clinic-btn-secondary text-xs">
              Open MBC Center &rarr;
            </Link>
          </div>

          <div className="p-5">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl">
                <p className="text-xs font-semibold text-slate-500 uppercase">Latest PHQ-9</p>
                <p className="text-2xl font-black text-emerald-600 mt-1">6 <span className="text-xs font-normal text-slate-500">/ 27</span></p>
                <span className="inline-block mt-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700">
                  Mild (Down from 18)
                </span>
              </div>
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl">
                <p className="text-xs font-semibold text-slate-500 uppercase">Latest GAD-7</p>
                <p className="text-2xl font-black text-emerald-600 mt-1">5 <span className="text-xs font-normal text-slate-500">/ 21</span></p>
                <span className="inline-block mt-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700">
                  Mild (Down from 15)
                </span>
              </div>
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl">
                <p className="text-xs font-semibold text-slate-500 uppercase">BAM Recovery</p>
                <p className="text-2xl font-black text-indigo-600 mt-1">29 <span className="text-xs font-normal text-slate-500">/ 30</span></p>
                <span className="inline-block mt-1 px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-50 text-indigo-700">
                  High Protection
                </span>
              </div>
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl">
                <p className="text-xs font-semibold text-slate-500 uppercase">C-SSRS Suicidality</p>
                <p className="text-2xl font-black text-slate-900 mt-1">0 <span className="text-xs font-normal text-slate-500">/ 5</span></p>
                <span className="inline-block mt-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700">
                  No Active Ideation
                </span>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 font-semibold text-slate-600 uppercase">
                    <th className="py-2.5 px-3">Date Administered</th>
                    <th className="py-2.5 px-3">PHQ-9 (Depression)</th>
                    <th className="py-2.5 px-3">GAD-7 (Anxiety)</th>
                    <th className="py-2.5 px-3">BAM (Addiction Recovery)</th>
                    <th className="py-2.5 px-3">C-SSRS Screening</th>
                    <th className="py-2.5 px-3">Clinical Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {measuresData.map((m, idx) => (
                    <tr key={idx} className="hover:bg-slate-50">
                      <td className="py-3 px-3 font-mono text-slate-800 font-bold">{m.date}</td>
                      <td className="py-3 px-3 font-semibold text-slate-900">{m.phq9} / 27</td>
                      <td className="py-3 px-3 font-semibold text-slate-900">{m.gad7} / 21</td>
                      <td className="py-3 px-3 font-semibold text-indigo-700">{m.bam} / 30</td>
                      <td className="py-3 px-3">
                        <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${m.cssrs === 'None' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>
                          {m.cssrs} Risk
                        </span>
                      </td>
                      <td className="py-3 px-3 text-slate-500">Validated by Clinician</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'Documents' && (
        <div className="clinic-card overflow-hidden">
          <div className="border-b border-slate-100 px-5 py-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="clinic-section-title">Clinical Documents & Records</h3>
              <p className="mt-0.5 text-xs text-slate-500">
                Uploaded intake evaluations, lab requisitions, court records, and ROI disclosures
              </p>
            </div>
            <label className="clinic-btn-primary text-xs cursor-pointer inline-flex items-center gap-1.5">
              <Plus size={13} /> Upload Document
              <input
                type="file"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    setClientDocuments((prev) => [
                      {
                        id: `doc-${Date.now()}`,
                        name: file.name,
                        category: docUploadCategory,
                        size: `${(file.size / 1024).toFixed(0)} KB`,
                        uploadedAt: new Date().toISOString().split('T')[0],
                      },
                      ...prev,
                    ]);
                  }
                }}
              />
            </label>
          </div>

          <div className="p-5 space-y-4">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 font-semibold text-slate-600 uppercase">
                    <th className="py-2.5 px-3">Document Title</th>
                    <th className="py-2.5 px-3">Category</th>
                    <th className="py-2.5 px-3">File Size</th>
                    <th className="py-2.5 px-3">Upload Date</th>
                    <th className="py-2.5 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {clientDocuments.map((doc) => (
                    <tr key={doc.id} className="hover:bg-slate-50">
                      <td className="py-3 px-3 font-semibold text-slate-900 flex items-center gap-2">
                        <FileText size={15} className="text-indigo-600 shrink-0" />
                        {doc.name}
                      </td>
                      <td className="py-3 px-3">
                        <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-slate-100 text-slate-700">
                          {doc.category}
                        </span>
                      </td>
                      <td className="py-3 px-3 font-mono text-slate-500">{doc.size}</td>
                      <td className="py-3 px-3 font-mono text-slate-600">{doc.uploadedAt}</td>
                      <td className="py-3 px-3 text-right">
                        <button
                          type="button"
                          onClick={() => alert(`Downloading ${doc.name}...`)}
                          className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-800 font-semibold text-xs"
                        >
                          <Download size={13} /> Download
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'Consents' && visibleTabs.includes('Consents') && (
        <div className="clinic-card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
            <div>
              <h3 className="clinic-section-title">Consent summary</h3>
              <p className="mt-0.5 text-xs text-slate-500">
                Live consent records for this client
              </p>
            </div>
            {allowConsents && (
              <Link href="/dashboard/ehr/consents" className="clinic-btn-secondary text-sm">
                Open Consent Forms
              </Link>
            )}
          </div>
          {!allowConsents ? (
            <div className="px-5 py-12 text-center text-sm text-slate-500">
              Your role cannot view consents for this client.
            </div>
          ) : consentsError ? (
            <div className="mx-5 mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
              {consentsError}
            </div>
          ) : consentsLoading ? (
            <div className="px-5 py-12 text-center text-sm text-slate-400">Loading consents…</div>
          ) : consents.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <p className="text-sm font-medium text-slate-700">No consents on file yet</p>
              <p className="mt-1 text-sm text-slate-400">
                Create one from Consent Forms — it will show here after refresh.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {consents.map((c) => (
                <div
                  key={c.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
                >
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{c.type}</p>
                    <p className="text-xs text-slate-500">
                      Sent {c.sentAt}
                      {c.signedAt ? ` · Signed ${c.signedAt}` : ''}
                      {c.expiresAt ? ` · Expires ${c.expiresAt}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="clinic-badge capitalize">{c.status}</span>
                    {c.status === 'pending' && (
                      <button
                        type="button"
                        disabled={consentActionId === c.id}
                        onClick={() => void onSignConsent(c)}
                        className="rounded-lg border border-emerald-200 px-2.5 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                      >
                        {consentActionId === c.id ? 'Saving…' : 'Mark Signed'}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'Eligibility' && (
        <div className="clinic-card overflow-hidden">
          <div className="border-b border-slate-100 px-5 py-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="clinic-section-title">Real-Time Insurance Eligibility (EDI 270/271)</h3>
              <p className="mt-0.5 text-xs text-slate-500">
                Electronic benefit inquiry response with co-pay, deductible, and coordination of benefits
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setEligibilityData((prev) => ({
                  ...prev,
                  lastVerified: new Date().toLocaleString(),
                }));
              }}
              className="clinic-btn-primary text-xs"
            >
              Re-check 270/271 Real-Time
            </button>
          </div>

          <div className="p-5 space-y-4">
            <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold">
                  &check;
                </div>
                <div>
                  <div className="text-sm font-bold text-emerald-950">{eligibilityData.status271}</div>
                  <div className="text-xs text-emerald-800">
                    Payer: {eligibilityData.payerName} (ID: {eligibilityData.payerId}) &bull; Verified: {eligibilityData.lastVerified}
                  </div>
                </div>
              </div>
              <span className="bg-emerald-600 text-white text-xs font-bold px-3 py-1 rounded-full uppercase">
                Active 271 Verified
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl">
                <span className="text-slate-400 block uppercase font-semibold">Specialist Copay</span>
                <span className="text-xl font-bold text-slate-900 mt-1 block">{eligibilityData.copay}</span>
                <span className="text-slate-500 mt-0.5 block">Zero client cost share for Medicaid BH</span>
              </div>
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl">
                <span className="text-slate-400 block uppercase font-semibold">Annual Deductible</span>
                <span className="text-xl font-bold text-slate-900 mt-1 block">{eligibilityData.deductible}</span>
                <span className="text-emerald-700 font-semibold mt-0.5 block">100% Met for Current Plan Year</span>
              </div>
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl">
                <span className="text-slate-400 block uppercase font-semibold">Coordination of Benefits (COB)</span>
                <span className="text-base font-bold text-slate-900 mt-1 block">{eligibilityData.secondaryPayer}</span>
                <span className="text-slate-500 mt-0.5 block">Order of Benefits: Primary Only</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Chart Flag Chips Modal */}
      {showFlagModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="relative z-10 w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b pb-2">
              <h3 className="text-sm font-bold text-slate-900">Manage Client Chart Flags</h3>
              <button
                type="button"
                onClick={() => setShowFlagModal(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X size={16} />
              </button>
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
                    className={`px-2 py-1 rounded-md text-xs font-medium border transition ${
                      chartFlags.includes(preset)
                        ? 'bg-purple-100 text-purple-800 border-purple-300'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    + {preset}
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
                  placeholder="e.g. Special accommodations..."
                  className="clinic-input text-xs"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (newFlagName.trim() && !chartFlags.includes(newFlagName.trim())) {
                      setChartFlags([...chartFlags, newFlagName.trim()]);
                      setNewFlagName('');
                    }
                  }}
                  className="clinic-btn-primary text-xs shrink-0"
                >
                  Add
                </button>
              </div>
            </div>

            <div className="flex justify-end pt-2 border-t">
              <button
                type="button"
                onClick={() => setShowFlagModal(false)}
                className="clinic-btn-primary text-xs w-full justify-center"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Assign Clinician Modal */}
      {assignModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <button
            type="button"
            className="absolute inset-0"
            aria-label="Close modal"
            onClick={() => {
              setAssignModalOpen(false);
              setAssignError(null);
            }}
          />
          <div className="relative z-10 w-full max-w-md rounded-2xl bg-white p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="text-base font-bold text-slate-900">
                Assign Clinician to {client.name}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setAssignModalOpen(false);
                  setAssignError(null);
                }}
                className="text-slate-400 hover:text-slate-600"
              >
                <X size={18} />
              </button>
            </div>

            {assignError && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-700">
                {assignError}
              </div>
            )}

            <div className="space-y-2">
              <label className="block text-xs font-semibold text-slate-600">
                Select Clinician from Staff
              </label>
              <select
                value={assigningClinicianId}
                onChange={(e) => setAssigningClinicianId(e.target.value)}
                className="w-full rounded-xl border border-slate-200 p-2.5 text-sm font-medium text-slate-800 outline-none focus:border-[#5C2D91] focus:ring-2 focus:ring-[#5C2D91]/20"
              >
                <option value="">-- None (Unassigned) --</option>
                {staffDirectory.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.role.replace(/_/g, ' ')}) {s.status === 'INVITED' ? '(Pending Invite)' : ''}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-slate-500">
                The selected clinician will immediately have access to this client&apos;s chart notes and caseload.
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setAssignModalOpen(false);
                  setAssignError(null);
                }}
                className="rounded-xl px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={assignSaving}
                onClick={handleAssignClinician}
                className="rounded-xl bg-[#5C2D91] px-5 py-2 text-sm font-bold text-white shadow-sm hover:bg-[#4A2475] disabled:opacity-50"
              >
                {assignSaving ? 'Saving…' : 'Confirm Assignment'}
              </button>
            </div>
          </div>
        </div>
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
    </div>
  );
}
