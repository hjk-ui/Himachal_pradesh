'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  InviteStaffModal,
  ManageStaffModal,
  useStaff,
  type StaffUser,
} from '@/features/staff';
import { LocationsPanel } from '@/features/locations';
import { useAuth } from '@/features/auth';
import { Activity, BellRing, FileSignature, MailPlus, Plug, Plus, ScrollText, UserCheck, UserPlus, Users } from 'lucide-react';
import {
  Alert,
  Button,
  buttonClasses,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  FOCUS_RING,
  FormField,
  inputClasses,
  LoadingState,
  Modal,
  Page,
  PageHeader,
  RowActionsMenu,
  StatCard,
  StatGrid,
  StatusBadge,
  Tabs,
  type Tone,
} from '@/components/ui';
import { useModuleList } from '@/lib/modules/useModuleList';
import { AuditLogTabRedirect, useAuditEventTotal } from './AuditLogLinks';
import { SECURITY_POLICY } from '@/lib/practice/securityPolicy';

const TABS = [
  'Users & Roles',
  'Role Dashboards',
  'Locations',
  'HIPAA Audit Log',
  'Security',
  'Integrations',
  'Notification Rules',
];

// Role chips use the brand tone (design system: brand = role/feature labels).
const ROLE_BADGE: Record<string, Tone> = {
  ADMIN: 'brand',
  PRACTICE_DIRECTOR: 'brand',
  DIRECTOR: 'brand',
  OFFICE_MANAGER: 'brand',
  CLINICIAN: 'brand',
  FRONT_DESK: 'brand',
  BILLING: 'brand',
  HR: 'brand',
  THERAPIST: 'brand',
  PSYCHIATRIST: 'brand',
  NP: 'brand',
  PRP_SPECIALIST: 'brand',
  CASE_MANAGER: 'brand',
  PEER_SUPPORT: 'brand',
};

const ROLE_LABEL: Record<string, string> = {
  ADMIN: 'Admin',
  PRACTICE_DIRECTOR: 'Practice Director',
  DIRECTOR: 'Practice Director',
  OFFICE_MANAGER: 'Office Manager',
  CLINICIAN: 'Therapist / Clinician',
  FRONT_DESK: 'Front Desk',
  BILLING: 'Billing Specialist',
  HR: 'HR Manager',
  THERAPIST: 'Therapist',
  PSYCHIATRIST: 'Psychiatrist',
  NP: 'Nurse Practitioner',
  PRP_SPECIALIST: 'PRP Specialist',
  CASE_MANAGER: 'Case Manager',
  PEER_SUPPORT: 'Peer Support',
};

type RoleDashboardCard = {
  role: string;
  title: string;
  summary: string;
  show: string[];
  scope: string;
  tone: Tone;
};

type RoleMatrixRow = {
  role: string;
  dashboard: string;
  sidebar: string;
  access: string;
};

const ROLE_DASHBOARDS: RoleDashboardCard[] = [
  {
    role: 'ADMIN',
    title: 'Admin console',
    summary: 'Full clinic control, staff setup, locations, settings, and audit visibility.',
    show: ['Org-wide staff list', 'Security status', 'Audit alerts', 'System settings'],
    scope: 'Clinic-wide operations',
    tone: 'neutral',
  },
  {
    role: 'PRACTICE_DIRECTOR',
    title: 'Practice director dashboard',
    summary: 'Care delivery overview, team utilization, and unresolved risks.',
    show: ['Daily census', 'High-risk clients', 'Care gaps', 'Program trends'],
    scope: 'Leadership oversight',
    tone: 'neutral',
  },
  {
    role: 'DIRECTOR',
    title: 'Practice director dashboard',
    summary: 'Care delivery overview, team utilization, and unresolved risks.',
    show: ['Daily census', 'High-risk clients', 'Care gaps', 'Program trends'],
    scope: 'Leadership oversight',
    tone: 'neutral',
  },
  {
    role: 'OFFICE_MANAGER',
    title: 'Office Manager dashboard',
    summary: 'Appointments, intake, waitlist, billing workflows, and operations queue.',
    show: ['Today schedule', 'Check-ins', 'Open slots', 'Billing & Copays'],
    scope: 'Practice & office operations',
    tone: 'neutral',
  },
  {
    role: 'FRONT_DESK',
    title: 'Front Desk dashboard',
    summary: 'Appointments, walk-ins, patient routing, and front desk queue.',
    show: ['Today schedule', 'Check-ins', 'Open slots', 'Missing documents'],
    scope: 'Front desk flow',
    tone: 'neutral',
  },
  {
    role: 'THERAPIST',
    title: 'Therapist dashboard',
    summary: 'Caseload, session prep, notes to complete, and follow-up tasks.',
    show: ['Today\'s clients', 'Unfinished notes', 'Follow-ups', 'Mood trends'],
    scope: 'Therapy panel',
    tone: 'neutral',
  },
  {
    role: 'PSYCHIATRIST',
    title: 'Psychiatrist dashboard',
    summary: 'Medication review, psychiatric follow-ups, and urgent consults.',
    show: ['Meds due', 'High-priority reviews', 'Open consults', 'Refill requests'],
    scope: 'Medication & consult review',
    tone: 'neutral',
  },
  {
    role: 'NP',
    title: 'Nurse practitioner dashboard',
    summary: 'Clinical assessments, vitals, care coordination, and escalations.',
    show: ['Assessment queue', 'Vitals alerts', 'Review tasks', 'Escalations'],
    scope: 'Advanced practice workflow',
    tone: 'neutral',
  },
  {
    role: 'PRP_SPECIALIST',
    title: 'PRP specialist dashboard',
    summary: 'Skill-building plans, attendance, progress notes, and goals.',
    show: ['Sessions today', 'Goal progress', 'Attendance', 'Plan updates'],
    scope: 'PRP program tracking',
    tone: 'neutral',
  },
  {
    role: 'CASE_MANAGER',
    title: 'Case manager dashboard',
    summary: 'Referrals, community resources, care plans, and service status.',
    show: ['Active cases', 'Pending referrals', 'Resource matches', 'Care plans'],
    scope: 'Care coordination',
    tone: 'neutral',
  },
  {
    role: 'PEER_SUPPORT',
    title: 'Peer support dashboard',
    summary: 'Outreach, check-ins, recovery milestones, and support follow-ups.',
    show: ['Check-ins today', 'Support notes', 'Milestones', 'Next outreach'],
    scope: 'Peer engagement',
    tone: 'neutral',
  },
  {
    role: 'BILLING',
    title: 'Billing dashboard',
    summary: 'Claims, payer status, aging balance, and missing codes.',
    show: ['Claims queue', 'Denials', 'A/R aging', 'Coding fixes'],
    scope: 'Revenue cycle',
    tone: 'neutral',
  },
  {
    role: 'HR',
    title: 'HR dashboard',
    summary: 'Staff onboarding, documents, role changes, and compliance tasks.',
    show: ['Open onboarding', 'Expiring docs', 'Role changes', 'Staff directory'],
    scope: 'People operations',
    tone: 'neutral',
  },
];

const ROLE_MATRIX: RoleMatrixRow[] = [
  {
    role: 'ADMIN',
    dashboard: 'Complete system overview',
    sidebar: 'All modules',
    access: 'All clinic operations',
  },
  {
    role: 'PRACTICE_DIRECTOR',
    dashboard: 'Practice performance, risks, staff, billing',
    sidebar: 'Clinical, EHR, billing, HR, reports',
    access: 'Leadership oversight',
  },
  {
    role: 'DIRECTOR',
    dashboard: 'Practice performance, risks, staff, billing',
    sidebar: 'Clinical, EHR, billing, HR, reports',
    access: 'Leadership oversight',
  },
  {
    role: 'OFFICE_MANAGER',
    dashboard: 'Appointments, intake, waitlist, billing, operations',
    sidebar: 'Operations, schedule, clients, billing, consents, eligibility, HR',
    access: 'Clinic operations & office management',
  },
  {
    role: 'FRONT_DESK',
    dashboard: 'Appointments, intake, waitlist, tasks',
    sidebar: 'Clients, schedule, intake, waitlist, consents, eligibility, copays',
    access: 'Front office flow (Admin assigns clinicians)',
  },
  {
    role: 'THERAPIST',
    dashboard: 'Today’s sessions, notes, assessments, alerts',
    sidebar: 'Clients, appointments, EHR, notes, messages',
    access: 'Own assigned patients only',
  },
  {
    role: 'PSYCHIATRIST',
    dashboard: 'Appointments, meds, prescriptions, alerts',
    sidebar: 'Clients, EHR, diagnoses, medications, e-prescribing',
    access: 'Own assigned patients only',
  },
  {
    role: 'NP',
    dashboard: 'Patients, prescriptions, notes, alerts',
    sidebar: 'Clients, EHR, e-prescribing, appointments',
    access: 'Own assigned patients only',
  },
  {
    role: 'PRP_SPECIALIST',
    dashboard: 'PRP clients, groups, attendance, documents',
    sidebar: 'PRP clients, group sessions, attendance, tasks',
    access: 'Program-specific workflow',
  },
  {
    role: 'CASE_MANAGER',
    dashboard: 'Assigned clients, follow-ups, appointments, messages',
    sidebar: 'Assigned clients, appointments, tasks, messages',
    access: 'Assigned-care coordination',
  },
  {
    role: 'PEER_SUPPORT',
    dashboard: 'Assigned clients, unread messages, outreach',
    sidebar: 'Limited client view, messages, appointments',
    access: 'Support-only client scope',
  },
  {
    role: 'BILLING',
    dashboard: 'Claims, denials, balances, payments',
    sidebar: 'Billing, claims, eligibility, prior auth, payments',
    access: 'Revenue cycle only',
  },
  {
    role: 'HR',
    dashboard: 'Staff onboarding, docs, compliance, supervision',
    sidebar: 'Staff, onboarding, documents, policies, compliance',
    access: 'People ops only — no patient/client data',
  },
];

type Integration = {
  name: string;
  description: string;
  icon: string;
  status: 'connected' | 'disconnected' | 'pending';
  plan: string;
  lastSync: string;
  accountId?: string;
  apiKey?: string;
  notes?: string;
};
const INTEGRATIONS: Integration[] = [
  {
    name: 'NextAuth',
    description: 'Email/password authentication and role-based login sessions.',
    icon: 'NA',
    status: 'connected',
    plan: 'Core authentication',
    lastSync: 'Live',
  },
  {
    name: 'PostgreSQL',
    description: 'Primary database for staff, locations, module state, and workflow records.',
    icon: 'PG',
    status: 'connected',
    plan: 'Production database',
    lastSync: 'Live',
  },
  {
    name: 'Email invite service',
    description: 'Staff invitation and onboarding email delivery workflow.',
    icon: 'EM',
    status: 'pending',
    plan: 'Invite workflow',
    lastSync: 'Awaiting provider setup',
  },
  {
    name: 'Audit retention',
    description: 'Compliance event storage for role, access, and workflow changes.',
    icon: 'AU',
    status: 'connected',
    plan: 'HIPAA operations',
    lastSync: 'Today',
  },
];

type NotifRule = {
  id: string;
  name: string;
  trigger: string;
  action: string;
  channel: string;
  active: boolean;
  severity: string;
};
const NOTIF_RULES: NotifRule[] = [
  {
    id: 'rule-credential-expiry',
    name: 'Credential expiring soon',
    trigger: 'License, DEA, malpractice, or background check expires within 60 days',
    action: 'Notify HR and assigned supervisor',
    channel: 'In-app + email',
    active: true,
    severity: 'warning',
  },
  {
    id: 'rule-supervision-signature',
    name: 'Supervision signature missing',
    trigger: 'Supervision log remains unsigned after 48 hours',
    action: 'Add HR task and notify supervisee',
    channel: 'In-app',
    active: true,
    severity: 'medium',
  },
  {
    id: 'rule-onboarding-checklist',
    name: 'Onboarding checklist due',
    trigger: 'New staff has incomplete onboarding items before start date',
    action: 'Notify HR manager',
    channel: 'Email',
    active: true,
    severity: 'info',
  },
  {
    id: 'rule-admin-security',
    name: 'Admin security event',
    trigger: 'Restricted admin action is denied or repeated login failures occur',
    action: 'Create audit alert for admin review',
    channel: 'In-app + email',
    active: true,
    severity: 'critical',
  },
];

const SEV_TONE: Record<string, Tone> = {
  critical: 'danger',
  high: 'danger',
  warning: 'warning',
  medium: 'info',
  low: 'neutral',
  info: 'neutral',
};

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState('Users & Roles');
  const auditTotal = useAuditEventTotal();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [manageUser, setManageUser] = useState<StaffUser | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [integrations, setIntegrations] = useModuleList<Integration>('admin-integrations', []);
  const [rules, setRules] = useModuleList<NotifRule>('admin-notification-rules', []);
  const [integrationModal, setIntegrationModal] = useState<Integration | null>(null);
  const [integrationForm, setIntegrationForm] = useState({
    accountId: '',
    apiKey: '',
    notes: '',
    status: 'connected' as Integration['status'],
  });
  const [ruleModalOpen, setRuleModalOpen] = useState(false);
  const [ruleForm, setRuleForm] = useState({
    name: '',
    trigger: '',
    action: '',
    channel: 'In-app',
    severity: 'info',
  });
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const {
    users,
    loading: usersLoading,
    error: usersError,
    sendInvite,
    resendInvite,
    manageStaff,
    changeEmail,
    setInactive,
    setActive,
    resetMfa,
  } = useStaff();
  // Users & Roles "Reset 2FA": ADMIN / PRACTICE_DIRECTOR (the API re-checks against the database)
  const canResetMfa = isAdmin || user?.role === 'PRACTICE_DIRECTOR';
  const confirmResetMfa = async (s: StaffUser) => {
    if (
      !confirm(
        `Reset two-factor sign-in for ${s.name || s.email}? Their authenticator, recovery codes and remembered devices stop working; they set up 2FA again at their next sign-in.`
      )
    ) {
      return;
    }
    setActionId(s.id);
    try {
      const result = await resetMfa(s.id);
      setStaffNotice(result.message || 'Two-factor sign-in was reset.');
    } catch (err: any) {
      alert(err.message || 'Reset 2FA failed');
    } finally {
      setActionId(null);
    }
  };
  const [emailUser, setEmailUser] = useState<StaffUser | null>(null);
  const [emailDraft, setEmailDraft] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailSaving, setEmailSaving] = useState(false);
  const [staffNotice, setStaffNotice] = useState<string | null>(null);

  /** Row action with the per-row busy flag; failures surface as an alert like the rest of this table. */
  const runRowAction = async (id: string, fn: () => Promise<unknown>, failMessage: string) => {
    setActionId(id);
    try {
      await fn();
    } catch (err: any) {
      alert(err?.message || failMessage);
    } finally {
      setActionId(null);
    }
  };

  const openEmailEdit = (s: StaffUser) => {
    setEmailUser(s);
    setEmailDraft(s.email);
    setEmailError(null);
  };

  const saveEmail = async () => {
    if (!emailUser) return;
    setEmailSaving(true);
    setEmailError(null);
    try {
      const result = await changeEmail(emailUser.id, emailDraft.trim());
      setStaffNotice(result.message || 'Email updated.');
      setEmailUser(null);
    } catch (err: any) {
      setEmailError(err.message || 'Could not change email');
    } finally {
      setEmailSaving(false);
    }
  };

  const toggleRule = (id: string) => {
    const source = rules.length > 0 ? rules : NOTIF_RULES;
    setRules(source.map((r) => (r.id === id ? { ...r, active: !r.active } : r)));
  };

  const displayIntegrations = integrations.length > 0
    ? INTEGRATIONS.map((catalog) => integrations.find((row) => row.name === catalog.name) ?? catalog)
    : INTEGRATIONS;

  const displayRules = rules.length > 0 ? rules : NOTIF_RULES;

  const openIntegration = (row: Integration) => {
    setIntegrationForm({
      accountId: row.accountId || '',
      apiKey: row.apiKey || '',
      notes: row.notes || '',
      status: row.status === 'disconnected' ? 'connected' : row.status,
    });
    setIntegrationModal(row);
  };

  const saveIntegration = () => {
    if (!integrationModal) return;
    const next: Integration = {
      ...integrationModal,
      accountId: integrationForm.accountId.trim(),
      apiKey: integrationForm.apiKey.trim(),
      notes: integrationForm.notes.trim(),
      status: integrationForm.status,
      lastSync: new Date().toISOString().slice(0, 16).replace('T', ' '),
    };
    const source = integrations.length > 0 ? integrations : INTEGRATIONS;
    const merged = source.some((row) => row.name === next.name)
      ? source.map((row) => (row.name === next.name ? next : row))
      : [next, ...source];
    setIntegrations(merged);
    setIntegrationModal(null);
  };

  const saveRule = () => {
    if (!ruleForm.name.trim() || !ruleForm.trigger.trim()) return;
    const source = rules.length > 0 ? rules : NOTIF_RULES;
    setRules([
      {
        id: `rule-${Date.now()}`,
        name: ruleForm.name.trim(),
        trigger: ruleForm.trigger.trim(),
        action: ruleForm.action.trim() || 'Notify assigned staff in-app',
        channel: ruleForm.channel,
        active: true,
        severity: ruleForm.severity,
      },
      ...source,
    ]);
    setRuleForm({ name: '', trigger: '', action: '', channel: 'In-app', severity: 'info' });
    setRuleModalOpen(false);
  };

  const activeCount = users.filter((u) => u.status === 'ACTIVE').length;
  const invitedCount = users.filter((u) => u.status === 'INVITED').length;

  return (
    <Page>
      <InviteStaffModal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onInvite={async (input) => sendInvite(input)}
      />
      <ManageStaffModal
        open={Boolean(manageUser)}
        user={manageUser}
        onClose={() => setManageUser(null)}
        onSave={async (userId, input) => {
          await manageStaff(userId, input);
        }}
      />

      <PageHeader
        title="Admin & compliance"
        description="User management, HIPAA audit log, and system settings"
        badges={
          <StatusBadge tone="brand" dot>
            Live staff directory
          </StatusBadge>
        }
        actions={
          canResetMfa ? (
            <>
              <Link href="/dashboard/admin/integrations/logs" className={buttonClasses({ variant: 'secondary' })}>
                <Activity className="mr-1.5 h-4 w-4" aria-hidden /> Integration logs
              </Link>
              <Link href="/dashboard/admin/baa" className={buttonClasses({ variant: 'secondary' })}>
                <FileSignature className="mr-1.5 h-4 w-4" aria-hidden /> Business Associate Agreement
              </Link>
            </>
          ) : null
        }
      />

      <StatGrid columns={4}>
        <StatCard label="Total staff" value={users.length} tone="brand" icon={<Users />} />
        <StatCard label="Active" value={activeCount} tone="success" icon={<UserCheck />} />
        <StatCard label="Pending invites" value={invitedCount} tone="warning" icon={<MailPlus />} />
        <StatCard label="Audit events" value={auditTotal ?? '—'} tone="neutral" icon={<ScrollText />} />
      </StatGrid>

      <Tabs
        items={TABS.map((tab) => ({ key: tab, label: tab }))}
        value={activeTab}
        onChange={setActiveTab}
        label="Admin sections"
        controlsPanels={false}
      />

      {activeTab === 'Users & Roles' && (
        <div className="space-y-4">
          <Alert tone="brand">
            <strong>Dashboard access (Admin only):</strong> Invite staff or click{' '}
            <em>Dashboards</em> on a row, then tick 2 / 3 / 6 roles (all 11 are allowed). That
            person sees a dropdown above Sign out. One role only → no dropdown. HR cannot assign
            these.
          </Alert>

          {usersError && <Alert tone="danger">{usersError}</Alert>}

          <Card>
            <CardHeader
              title={<>Staff accounts ({users.length})</>}
              actions={
                isAdmin && (
                  <Button size="sm" icon={<UserPlus />} onClick={() => setInviteOpen(true)}>
                    Invite staff
                  </Button>
                )
              }
            />
            {staffNotice && (
              <div className="px-4 pt-3">
                <Alert
                  tone="success"
                  actions={
                    <Button variant="ghost" size="sm" onClick={() => setStaffNotice(null)}>
                      Dismiss
                    </Button>
                  }
                >
                  {staffNotice}
                </Alert>
              </div>
            )}
            {usersLoading ? (
              <LoadingState label="Loading staff…" rows={4} />
            ) : users.length === 0 ? (
              <EmptyState
                icon={<Users />}
                title="No staff yet"
                description="Staff accounts appear here once invited. Click Invite staff to get started."
              />
            ) : (
              <div className="clinic-scroll-x overflow-x-auto">
                <table className="w-full min-w-[720px] text-left">
                  <thead className="bg-slate-50">
                    <tr className="border-b border-slate-200">
                      {['Staff member', 'Dashboards', 'Location', 'Status', 'Actions'].map((h, i) => (
                        <th
                          key={h}
                          scope="col"
                          className={`px-4 py-3 text-xs font-semibold text-slate-600 ${
                            i === 0 ? 'sticky left-0 z-10 bg-slate-50' : i === 4 ? 'text-right' : ''
                          }`}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {users.map((s) => {
                      const busy = actionId === s.id;
                      const isSelf = s.id === user?.id;
                      const statusTone: Tone =
                        s.status === 'ACTIVE'
                          ? 'success'
                          : s.status === 'INVITED'
                            ? 'warning'
                            : 'neutral';
                      return (
                        <tr
                          key={s.id}
                          className={`group transition-colors hover:bg-slate-50 ${
                            s.status === 'DEACTIVATED' ? 'opacity-70' : ''
                          }`}
                        >
                          <td className="sticky left-0 z-10 max-w-[16rem] bg-white px-4 py-3 group-hover:bg-slate-50">
                            <div className="flex min-w-0 items-center gap-3">
                              <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-blue-50 text-sm font-semibold text-blue-700">
                                {s.image ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={s.image} alt="" className="h-full w-full object-cover" />
                                ) : (
                                  (s.name || s.email || '?')[0]?.toUpperCase()
                                )}
                              </div>
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-slate-900">
                                  {s.name || '—'}
                                </p>
                                <p className="truncate text-xs text-slate-500" title={s.email}>{s.email}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-1">
                              {(s.roles?.length ? s.roles : [s.role]).map((r) => (
                                <StatusBadge key={r} tone={ROLE_BADGE[r] || 'neutral'} size="sm">
                                  {ROLE_LABEL[r] || r}
                                </StatusBadge>
                              ))}
                              {s.isMedicalDirector && (
                                <span title={s.medicalDirectorScope ? `Medical Director: ${s.medicalDirectorScope}` : 'Medical Director'}>
                                  <StatusBadge tone="brand" size="sm">Medical Director</StatusBadge>
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-sm text-slate-700">
                            {s.primaryLocationName || '—'}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-1">
                              <StatusBadge tone={statusTone} size="sm">{s.status}</StatusBadge>
                              {s.status === 'ACTIVE' && (
                                <StatusBadge tone={s.mfaEnabled ? 'success' : 'warning'} size="sm">
                                  {s.mfaEnabled ? '2FA on' : '2FA not set up'}
                                </StatusBadge>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            {!isAdmin ? (
                              canResetMfa && s.mfaEnabled && !isSelf ? (
                                <Button variant="ghost" size="sm" disabled={busy} onClick={() => void confirmResetMfa(s)}>
                                  Reset 2FA
                                </Button>
                              ) : (
                                <span className="text-xs text-slate-500">View only</span>
                              )
                            ) : (
                              <div className="flex items-center justify-end gap-1">
                                <Button variant="ghost" size="sm" onClick={() => setManageUser(s)}>
                                  Dashboards
                                </Button>
                                <RowActionsMenu
                                  label={`More actions for ${s.name || s.email}`}
                                  actions={[
                                    ...(s.status === 'INVITED'
                                      ? [{ key: 'resend', label: busy ? 'Resending…' : 'Resend invite', disabled: busy, onSelect: () => void runRowAction(s.id, () => resendInvite(s.id), 'Resend failed') }]
                                      : []),
                                    ...(s.status !== 'DEACTIVATED' && !isSelf
                                      ? [{ key: 'email', label: 'Edit email', disabled: busy, onSelect: () => openEmailEdit(s) }]
                                      : []),
                                    ...(s.mfaEnabled && !isSelf
                                      ? [{ key: 'mfa', label: 'Reset 2FA', disabled: busy, onSelect: () => void confirmResetMfa(s) }]
                                      : []),
                                    ...((s.status === 'ACTIVE' || s.status === 'INVITED') && !isSelf
                                      ? [{
                                          key: 'deactivate',
                                          label: 'Deactivate',
                                          danger: true,
                                          disabled: busy,
                                          onSelect: () => {
                                            if (!confirm(`Deactivate ${s.name || s.email}? They will not be able to log in.`)) return;
                                            void runRowAction(s.id, () => setInactive(s.id), 'Deactivate failed');
                                          },
                                        }]
                                      : []),
                                    ...(s.status === 'DEACTIVATED'
                                      ? [{ key: 'activate', label: 'Activate', emphasis: true, disabled: busy, onSelect: () => void runRowAction(s.id, () => setActive(s.id), 'Activate failed') }]
                                      : []),
                                  ]}
                                />
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}

      {activeTab === 'Role Dashboards' && (
        <div className="space-y-4">
          <Alert tone="brand">
            <strong>Same clinic app, different views:</strong> each role gets a focused dashboard
            so staff only see the data they need. Staff sign-in requires two-factor authentication (Practice settings › Compliance &amp; privacy).
          </Alert>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {ROLE_DASHBOARDS.map((card) => (
              <Card key={card.role} className="p-5">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      {card.role}
                    </p>
                    <h3 className="mt-1 text-base font-semibold text-slate-900">{card.title}</h3>
                  </div>
                  <StatusBadge tone={card.tone} size="sm">{card.scope}</StatusBadge>
                </div>
                <p className="text-sm leading-6 text-slate-600">{card.summary}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {card.show.map((item) => (
                    <span
                      key={item}
                      className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600"
                    >
                      {item}
                    </span>
                  ))}
                </div>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader
              title="Role matrix"
              titleAs="h3"
              description="What each role sees on the dashboard and in the sidebar"
              actions={<StatusBadge tone="neutral">11 staff roles</StatusBadge>}
            />
            <div className="clinic-scroll-x overflow-x-auto">
              <table className="w-full min-w-[720px] text-left">
                <thead className="bg-slate-50">
                  <tr className="border-b border-slate-200">
                    {['Role', 'Dashboard', 'Sidebar', 'Access scope'].map((h) => (
                      <th
                        key={h}
                        scope="col"
                        className="px-4 py-3 text-xs font-semibold text-slate-600"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {ROLE_MATRIX.map((row) => (
                    <tr key={row.role} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <StatusBadge tone={ROLE_BADGE[row.role] || 'neutral'} size="sm">
                          {ROLE_LABEL[row.role] || row.role}
                        </StatusBadge>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">{row.dashboard}</td>
                      <td className="px-4 py-3 text-sm text-slate-700">{row.sidebar}</td>
                      <td className="px-4 py-3 text-sm text-slate-700">{row.access}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {activeTab === 'Locations' && <LocationsPanel canManage={isAdmin} />}

      {activeTab === 'HIPAA Audit Log' && (
        <AuditLogTabRedirect />
      )}

      {activeTab === 'Security' && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {SECURITY_POLICY.map((section) => (
            <Card key={section.title}>
              <CardHeader title={section.title} titleAs="h3" />
              <CardBody className="py-2">
                {section.items.map((item) => (
                  <div
                    key={item.label}
                    className="flex items-center justify-between gap-3 border-b border-slate-100 py-2.5 last:border-0"
                  >
                    <span className="min-w-0 text-sm text-slate-600">{item.label}</span>
                    <span className={`text-right text-xs font-semibold ${item.gap ? 'text-amber-700' : 'text-blue-700'}`}>{item.value}</span>
                  </div>
                ))}
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      {activeTab === 'Integrations' && (
        <section className="space-y-4">
          <h2 className="text-base font-semibold text-slate-900">
            Connected services
          </h2>
          {displayIntegrations.length === 0 ? (
            <Card>
              <EmptyState
                icon={<Plug />}
                title="No integrations connected yet"
                description="Connected services such as authentication, email and audit storage appear here once configured."
              />
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {displayIntegrations.map((intg) => (
                <Card key={intg.name} className="p-5">
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900">{intg.name}</p>
                      <p className="text-xs text-slate-500">{intg.plan}</p>
                    </div>
                    <StatusBadge
                      size="sm"
                      tone={
                        intg.status === 'connected'
                          ? 'success'
                          : intg.status === 'pending'
                            ? 'warning'
                            : 'neutral'
                      }
                    >
                      {intg.status}
                    </StatusBadge>
                  </div>
                  <p className="mb-3 text-xs text-slate-500">{intg.description}</p>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs text-slate-500">Last sync: {intg.lastSync}</span>
                    <Button
                      size="sm"
                      variant={intg.status === 'connected' ? 'secondary' : 'primary'}
                      onClick={() => openIntegration(intg)}
                    >
                      {intg.status === 'connected'
                        ? 'Configure'
                        : intg.status === 'pending'
                          ? 'Continue setup'
                          : 'Connect'}
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </section>
      )}

      {activeTab === 'Notification Rules' && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-slate-900">
                Automated alert rules
              </h2>
              <p className="mt-0.5 text-sm text-slate-500">
                Configure when and how clinicians and admins are notified
              </p>
            </div>
            <Button size="sm" icon={<Plus />} onClick={() => setRuleModalOpen(true)}>
              Add rule
            </Button>
          </div>

          {displayRules.length === 0 ? (
            <Card>
              <EmptyState
                icon={<BellRing />}
                title="No notification rules configured yet"
                description="Rules that notify staff about credential expiries, missing signatures or security events appear here. Click Add rule to create one."
              />
            </Card>
          ) : (
            <div className="space-y-3">
              {displayRules.map((rule) => (
                <Card
                  key={rule.id}
                  className={`p-5 ${!rule.active ? 'opacity-60' : ''}`}
                >
                  <div className="flex items-start gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-slate-900">{rule.name}</span>
                        <StatusBadge tone={SEV_TONE[rule.severity] || 'neutral'} size="sm">{rule.severity}</StatusBadge>
                        <StatusBadge tone="neutral" size="sm">{rule.channel}</StatusBadge>
                      </div>
                      <p className="mb-1 text-xs text-slate-500">
                        <strong className="text-slate-600">Trigger:</strong> {rule.trigger}
                      </p>
                      <p className="text-xs text-slate-500">
                        <strong className="text-slate-600">Action:</strong> {rule.action}
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={rule.active}
                      aria-label={`${rule.name} active`}
                      onClick={() => toggleRule(rule.id)}
                      className={`relative h-6 w-12 shrink-0 rounded-full transition ${FOCUS_RING} ${
                        rule.active ? 'bg-blue-600' : 'bg-slate-200'
                      }`}
                    >
                      <span
                        className={`absolute left-0 top-0.5 h-5 w-5 rounded-full bg-white shadow-xs transition-transform ${
                          rule.active ? 'translate-x-6' : 'translate-x-0.5'
                        }`}
                      />
                    </button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </section>
      )}

      {emailUser && (
        <Modal
          title="Edit sign-in email"
          size="sm"
          onClose={() => !emailSaving && setEmailUser(null)}
          footer={
            <>
              <Button variant="secondary" disabled={emailSaving} onClick={() => setEmailUser(null)}>
                Cancel
              </Button>
              <Button
                loading={emailSaving}
                disabled={!emailDraft.trim() || emailDraft.trim().toLowerCase() === emailUser.email.toLowerCase()}
                onClick={saveEmail}
              >
                {emailUser.status === 'INVITED' ? 'Save and resend invite' : 'Save email'}
              </Button>
            </>
          }
        >
          <p className="text-sm text-slate-600">
            {emailUser.status === 'INVITED'
              ? `${emailUser.name || 'This person'} hasn't accepted their invite yet. Saving sends a new invite to the new address; the old link stops working.`
              : `${emailUser.name || 'This person'} keeps their password and signs in with the new email. Both the old and new address get a notice of the change.`}
          </p>
          <FormField label="Email">
            <input
              type="email"
              autoComplete="off"
              value={emailDraft}
              onChange={(e) => setEmailDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !emailSaving) void saveEmail();
              }}
              className={inputClasses}
            />
          </FormField>
          {emailError && <Alert tone="danger">{emailError}</Alert>}
        </Modal>
      )}

      {integrationModal && (
        <Modal
          title={`${integrationModal.name} settings`}
          size="sm"
          onClose={() => setIntegrationModal(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setIntegrationModal(null)}>
                Cancel
              </Button>
              <Button onClick={saveIntegration}>
                Save settings
              </Button>
            </>
          }
        >
          <p className="text-xs text-slate-500">
            Store clinic credentials locally. This does not start a live OAuth handshake.
          </p>
          <FormField label="Account / org ID">
            <input
              value={integrationForm.accountId}
              onChange={(e) => setIntegrationForm((f) => ({ ...f, accountId: e.target.value }))}
              className={inputClasses}
            />
          </FormField>
          <FormField label="API key or token">
            <input
              type="password"
              value={integrationForm.apiKey}
              onChange={(e) => setIntegrationForm((f) => ({ ...f, apiKey: e.target.value }))}
              className={inputClasses}
            />
          </FormField>
          <FormField label="Status">
            <select
              value={integrationForm.status}
              onChange={(e) => setIntegrationForm((f) => ({ ...f, status: e.target.value as Integration['status'] }))}
              className={inputClasses}
            >
              <option value="connected">connected</option>
              <option value="pending">pending</option>
              <option value="disconnected">disconnected</option>
            </select>
          </FormField>
          <FormField label="Notes">
            <textarea
              rows={3}
              value={integrationForm.notes}
              onChange={(e) => setIntegrationForm((f) => ({ ...f, notes: e.target.value }))}
              className={inputClasses}
            />
          </FormField>
        </Modal>
      )}

      {ruleModalOpen && (
        <Modal
          title="Add notification rule"
          size="sm"
          onClose={() => setRuleModalOpen(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setRuleModalOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={saveRule}
                disabled={!ruleForm.name.trim() || !ruleForm.trigger.trim()}
              >
                Save rule
              </Button>
            </>
          }
        >
          <FormField label="Rule name" required>
            <input
              value={ruleForm.name}
              onChange={(e) => setRuleForm((f) => ({ ...f, name: e.target.value }))}
              className={inputClasses}
            />
          </FormField>
          <FormField label="Trigger" required>
            <input
              value={ruleForm.trigger}
              onChange={(e) => setRuleForm((f) => ({ ...f, trigger: e.target.value }))}
              className={inputClasses}
            />
          </FormField>
          <FormField label="Action">
            <input
              value={ruleForm.action}
              onChange={(e) => setRuleForm((f) => ({ ...f, action: e.target.value }))}
              className={inputClasses}
            />
          </FormField>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Channel">
              <select
                value={ruleForm.channel}
                onChange={(e) => setRuleForm((f) => ({ ...f, channel: e.target.value }))}
                className={inputClasses}
              >
                <option>In-app</option>
                <option>In-app + email</option>
                <option>Email</option>
              </select>
            </FormField>
            <FormField label="Severity">
              <select
                value={ruleForm.severity}
                onChange={(e) => setRuleForm((f) => ({ ...f, severity: e.target.value }))}
                className={inputClasses}
              >
                <option value="info">info</option>
                <option value="medium">medium</option>
                <option value="warning">warning</option>
                <option value="critical">critical</option>
              </select>
            </FormField>
          </div>
        </Modal>
      )}
    </Page>
  );
}
