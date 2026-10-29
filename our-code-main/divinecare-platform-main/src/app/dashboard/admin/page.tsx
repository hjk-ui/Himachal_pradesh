'use client';

import { useState } from 'react';
import {
  InviteStaffModal,
  ManageStaffModal,
  useStaff,
  type StaffUser,
} from '@/features/staff';
import { LocationsPanel } from '@/features/locations';
import { useAuth } from '@/features/auth';
import { PageHeader, StatCard, Badge, EmptyState } from '@/components/clinic/ui';
import { useModuleList } from '@/lib/modules/useModuleList';
import { apiJson } from '@/lib/api-client';
import { MFA_COPY } from '@/lib/mfa/messages';
import { BaaNotice } from '@/components/legal/BaaNotice';

const TABS = [
  'Users & Roles',
  'Role Dashboards',
  'Locations',
  'HIPAA Audit Log',
  'Security',
  'Integrations',
  'Notification Rules',
];

const ROLE_BADGE: Record<string, 'violet' | 'blue' | 'green' | 'amber' | 'rose' | 'slate'> = {
  ADMIN: 'violet',
  PRACTICE_DIRECTOR: 'blue',
  DIRECTOR: 'blue',
  OFFICE_MANAGER: 'blue',
  CLINICIAN: 'green',
  FRONT_DESK: 'blue',
  BILLING: 'amber',
  HR: 'rose',
  THERAPIST: 'green',
  PSYCHIATRIST: 'violet',
  NP: 'blue',
  PRP_SPECIALIST: 'amber',
  CASE_MANAGER: 'slate',
  PEER_SUPPORT: 'rose',
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
  tone: 'violet' | 'blue' | 'green' | 'amber' | 'rose' | 'slate';
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
    tone: 'violet',
  },
  {
    role: 'PRACTICE_DIRECTOR',
    title: 'Practice director dashboard',
    summary: 'Care delivery overview, team utilization, and unresolved risks.',
    show: ['Daily census', 'High-risk clients', 'Care gaps', 'Program trends'],
    scope: 'Leadership oversight',
    tone: 'blue',
  },
  {
    role: 'DIRECTOR',
    title: 'Practice director dashboard',
    summary: 'Care delivery overview, team utilization, and unresolved risks.',
    show: ['Daily census', 'High-risk clients', 'Care gaps', 'Program trends'],
    scope: 'Leadership oversight',
    tone: 'blue',
  },
  {
    role: 'OFFICE_MANAGER',
    title: 'Office Manager dashboard',
    summary: 'Appointments, intake, waitlist, billing workflows, and operations queue.',
    show: ['Today schedule', 'Check-ins', 'Open slots', 'Billing & Copays'],
    scope: 'Practice & office operations',
    tone: 'blue',
  },
  {
    role: 'FRONT_DESK',
    title: 'Front Desk dashboard',
    summary: 'Appointments, walk-ins, patient routing, and front desk queue.',
    show: ['Today schedule', 'Check-ins', 'Open slots', 'Missing documents'],
    scope: 'Front desk flow',
    tone: 'green',
  },
  {
    role: 'THERAPIST',
    title: 'Therapist dashboard',
    summary: 'Caseload, session prep, notes to complete, and follow-up tasks.',
    show: ['Today\'s clients', 'Unfinished notes', 'Follow-ups', 'Mood trends'],
    scope: 'Therapy panel',
    tone: 'green',
  },
  {
    role: 'PSYCHIATRIST',
    title: 'Psychiatrist dashboard',
    summary: 'Medication review, psychiatric follow-ups, and urgent consults.',
    show: ['Meds due', 'High-priority reviews', 'Open consults', 'Refill requests'],
    scope: 'Medication & consult review',
    tone: 'violet',
  },
  {
    role: 'NP',
    title: 'Nurse practitioner dashboard',
    summary: 'Clinical assessments, vitals, care coordination, and escalations.',
    show: ['Assessment queue', 'Vitals alerts', 'Review tasks', 'Escalations'],
    scope: 'Advanced practice workflow',
    tone: 'blue',
  },
  {
    role: 'PRP_SPECIALIST',
    title: 'PRP specialist dashboard',
    summary: 'Skill-building plans, attendance, progress notes, and goals.',
    show: ['Sessions today', 'Goal progress', 'Attendance', 'Plan updates'],
    scope: 'PRP program tracking',
    tone: 'amber',
  },
  {
    role: 'CASE_MANAGER',
    title: 'Case manager dashboard',
    summary: 'Referrals, community resources, care plans, and service status.',
    show: ['Active cases', 'Pending referrals', 'Resource matches', 'Care plans'],
    scope: 'Care coordination',
    tone: 'slate',
  },
  {
    role: 'PEER_SUPPORT',
    title: 'Peer support dashboard',
    summary: 'Outreach, check-ins, recovery milestones, and support follow-ups.',
    show: ['Check-ins today', 'Support notes', 'Milestones', 'Next outreach'],
    scope: 'Peer engagement',
    tone: 'rose',
  },
  {
    role: 'BILLING',
    title: 'Billing dashboard',
    summary: 'Claims, payer status, aging balance, and missing codes.',
    show: ['Claims queue', 'Denials', 'A/R aging', 'Coding fixes'],
    scope: 'Revenue cycle',
    tone: 'amber',
  },
  {
    role: 'HR',
    title: 'HR dashboard',
    summary: 'Staff onboarding, documents, role changes, and compliance tasks.',
    show: ['Open onboarding', 'Expiring docs', 'Role changes', 'Staff directory'],
    scope: 'People operations',
    tone: 'rose',
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

type AuditEntry = {
  id: string;
  user: string;
  action: string;
  resource: string;
  ip: string;
  timestamp: string;
  severity: string;
};
const AUDIT_ENTRIES: AuditEntry[] = [];

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

const SEV_TONE: Record<string, 'rose' | 'amber' | 'blue' | 'slate'> = {
  critical: 'rose',
  high: 'rose',
  warning: 'amber',
  medium: 'blue',
  low: 'slate',
  info: 'slate',
};

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState('Users & Roles');
  const [auditFilter, setAuditFilter] = useState('all');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [manageUser, setManageUser] = useState<StaffUser | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [auditEntries] = useModuleList<AuditEntry>('admin-audit-log', []);
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
    updateSignInEmail,
    setInactive,
    setActive,
    reload,
  } = useStaff();
  const [emailEditUser, setEmailEditUser] = useState<StaffUser | null>(null);
  const [emailDraft, setEmailDraft] = useState('');
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailError, setEmailError] = useState('');

  const filteredAudit =
    auditFilter === 'all'
      ? auditEntries
      : auditEntries.filter((e) => e.severity === auditFilter);

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

  const exportAuditCsv = () => {
    const header = ['Timestamp', 'User', 'Action', 'Resource', 'IP', 'Severity'];
    const rows = filteredAudit.map((e) => [
      e.timestamp,
      e.user,
      e.action,
      e.resource,
      e.ip,
      e.severity,
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv || 'Timestamp,User,Action,Resource,IP,Severity\n'], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hipaa-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const activeCount = users.filter((u) => u.status === 'ACTIVE').length;
  const invitedCount = users.filter((u) => u.status === 'INVITED').length;

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
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
        actions={
          <span className="inline-flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700">
            <span className="h-2 w-2 rounded-full bg-blue-500" />
            Live staff directory
          </span>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total staff" value={users.length} tone="blue" />
        <StatCard label="Active" value={activeCount} tone="blue" />
        <StatCard label="Pending invites" value={invitedCount} tone="amber" />
        <StatCard label="Audit events" value={auditEntries.length} tone="slate" />
      </div>

      <div className="clinic-card flex overflow-x-auto p-1.5">
        {TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`min-w-fit flex-1 whitespace-nowrap rounded-lg px-3 py-2.5 text-sm font-semibold transition ${
              activeTab === tab
                ? 'bg-blue-600 text-white'
                : 'text-slate-500 hover:bg-slate-50'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === 'Users & Roles' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
              Staff accounts ({users.length})
            </h2>
            {isAdmin && (
              <button type="button" onClick={() => setInviteOpen(true)} className="clinic-btn-primary">
                Invite staff
              </button>
            )}
          </div>

          <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
            <strong>Dashboard access (Admin only):</strong> Invite staff or click{' '}
            <em>Dashboards</em> on a row, then tick 2 / 3 / 6 roles (all 11 are allowed). That
            person sees a dropdown above Sign out. One role only → no dropdown. HR cannot assign
            these.
          </div>

          {usersError && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {usersError}
            </div>
          )}

          <div className="clinic-card overflow-hidden">
            {usersLoading ? (
              <p className="px-5 py-8 text-sm text-slate-500">Loading staff…</p>
            ) : users.length === 0 ? (
              <EmptyState title="No staff yet" description="Click Invite staff to get started." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-left">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/70">
                      {['Staff member', 'Dashboards', 'Location', 'Status', 'Actions'].map((h) => (
                        <th
                          key={h}
                          className="px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((s) => {
                      const busy = actionId === s.id;
                      const isSelf = s.id === user?.id;
                      const statusTone =
                        s.status === 'ACTIVE'
                          ? 'green'
                          : s.status === 'INVITED'
                            ? 'amber'
                            : 'slate';
                      return (
                        <tr
                          key={s.id}
                          className={`border-b border-slate-100 last:border-0 transition-colors hover:bg-slate-50/80 ${
                            s.status === 'DEACTIVATED' ? 'opacity-70' : ''
                          }`}
                        >
                          <td className="px-5 py-4">
                            <div className="flex items-center gap-3">
                              <div className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-blue-50 text-sm font-semibold text-blue-700">
                                {s.image ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={s.image} alt="" className="h-full w-full object-cover" />
                                ) : (
                                  (s.name || s.email || '?')[0]?.toUpperCase()
                                )}
                              </div>
                              <div>
                                <p className="text-sm font-semibold text-slate-900">
                                  {s.name || '—'}
                                </p>
                                <p className="text-xs text-slate-400">{s.email}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-5 py-4">
                            <div className="flex flex-wrap gap-1">
                              {(s.roles?.length ? s.roles : [s.role]).map((r) => (
                                <Badge key={r} tone={ROLE_BADGE[r] || 'slate'}>
                                  {ROLE_LABEL[r] || r}
                                </Badge>
                              ))}
                            </div>
                          </td>
                          <td className="px-5 py-4 text-sm text-slate-600">
                            {s.primaryLocationName || '—'}
                          </td>
                          <td className="px-5 py-4">
                            <Badge tone={statusTone}>{s.status}</Badge>
                            {s.status === 'ACTIVE' && (
                              <p
                                className={`mt-1 text-xs font-medium ${s.mfaEnabled ? 'text-emerald-700' : 'text-slate-400'}`}
                                data-testid="staff-mfa-status"
                              >
                                {s.mfaEnabled ? MFA_COPY.enabled : MFA_COPY.notSetUp}
                              </p>
                            )}
                          </td>
                          <td className="px-5 py-4">
                            {!isAdmin ? (
                              <span className="text-xs text-slate-400">View only</span>
                            ) : (
                              <div className="flex flex-wrap items-center gap-2">
                                {s.status === 'INVITED' && (
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={async () => {
                                      setActionId(s.id);
                                      try {
                                        await resendInvite(s.id);
                                      } catch (err: any) {
                                        alert(err.message || 'Resend failed');
                                      } finally {
                                        setActionId(null);
                                      }
                                    }}
                                    className="text-xs font-semibold text-blue-600 hover:text-blue-700 disabled:opacity-50"
                                  >
                                    {busy ? '…' : 'Resend'}
                                  </button>
                                )}
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => {
                                    setEmailEditUser(s);
                                    setEmailDraft(s.email);
                                    setEmailError('');
                                  }}
                                  className="text-xs font-semibold text-slate-700 hover:text-slate-900"
                                  data-testid="staff-edit-email"
                                >
                                  Edit email
                                </button>
                                {s.mfaEnabled && !isSelf && (
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={async () => {
                                      if (
                                        !confirm(
                                          `Reset 2FA for ${s.name || s.email}? They will set it up again at their next sign-in.`
                                        )
                                      ) {
                                        return;
                                      }
                                      setActionId(s.id);
                                      try {
                                        await apiJson('/api/auth/mfa/enroll', {
                                          method: 'DELETE',
                                          body: JSON.stringify({ userId: s.id }),
                                        });
                                        await reload();
                                      } catch (err: any) {
                                        alert(err.message || 'Reset failed');
                                      } finally {
                                        setActionId(null);
                                      }
                                    }}
                                    className="text-xs font-semibold text-slate-700 hover:text-slate-900 disabled:opacity-50"
                                    data-testid="staff-reset-mfa"
                                  >
                                    {MFA_COPY.reset}
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => setManageUser(s)}
                                  className="text-xs font-semibold text-slate-700 hover:text-slate-900"
                                >
                                  Dashboards
                                </button>
                                {(s.status === 'ACTIVE' || s.status === 'INVITED') && !isSelf && (
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={async () => {
                                      if (
                                        !confirm(
                                          `Deactivate ${s.name || s.email}? They will not be able to log in.`
                                        )
                                      ) {
                                        return;
                                      }
                                      setActionId(s.id);
                                      try {
                                        await setInactive(s.id);
                                      } catch (err: any) {
                                        alert(err.message || 'Deactivate failed');
                                      } finally {
                                        setActionId(null);
                                      }
                                    }}
                                    className="text-xs font-semibold text-rose-600 hover:text-rose-700 disabled:opacity-50"
                                  >
                                    {s.status === 'INVITED' ? 'Deactivate invite' : 'Deactivate'}
                                  </button>
                                )}
                                {s.status === 'DEACTIVATED' && (
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={async () => {
                                      setActionId(s.id);
                                      try {
                                        await setActive(s.id);
                                      } catch (err: any) {
                                        alert(err.message || 'Activate failed');
                                      } finally {
                                        setActionId(null);
                                      }
                                    }}
                                    className="text-xs font-semibold text-blue-700 hover:text-blue-800 disabled:opacity-50"
                                  >
                                    Activate
                                  </button>
                                )}
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
          </div>
        </div>
      )}

      {activeTab === 'Role Dashboards' && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-4 text-sm text-blue-800">
            <strong>Same clinic app, different views:</strong> each role gets a focused dashboard
            so staff only see the data they need. MFA is not included in the current build.
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {ROLE_DASHBOARDS.map((card) => (
              <div key={card.role} className="clinic-card overflow-hidden p-5">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                      {card.role}
                    </p>
                    <h3 className="mt-1 text-base font-semibold text-slate-900">{card.title}</h3>
                  </div>
                  <Badge tone={card.tone}>{card.scope}</Badge>
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
              </div>
            ))}
          </div>

          <div className="clinic-card overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Role matrix</h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  What each role sees on the dashboard and in the sidebar
                </p>
              </div>
              <Badge tone="slate">11 staff roles</Badge>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-left">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/70">
                    {['Role', 'Dashboard', 'Sidebar', 'Access scope'].map((h) => (
                      <th
                        key={h}
                        className="px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ROLE_MATRIX.map((row) => (
                    <tr key={row.role} className="border-b border-slate-100 last:border-0">
                      <td className="px-5 py-4">
                        <Badge tone={ROLE_BADGE[row.role] || 'slate'}>
                          {ROLE_LABEL[row.role] || row.role}
                        </Badge>
                      </td>
                      <td className="px-5 py-4 text-sm text-slate-700">{row.dashboard}</td>
                      <td className="px-5 py-4 text-sm text-slate-600">{row.sidebar}</td>
                      <td className="px-5 py-4 text-sm text-slate-600">{row.access}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'Locations' && <LocationsPanel canManage={isAdmin} />}

      {activeTab === 'HIPAA Audit Log' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                Access & activity log
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                All PHI access events are logged and retained for 6 years per HIPAA requirements
              </p>
            </div>
            <button type="button" onClick={exportAuditCsv} className="clinic-btn-secondary">
              Export log (CSV)
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            {['all', 'info', 'warning', 'critical'].map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setAuditFilter(f)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold capitalize transition ${
                  auditFilter === f
                    ? 'bg-blue-600 text-white'
                    : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                {f === 'all' ? 'All events' : f}
              </button>
            ))}
          </div>

          <div className="clinic-card overflow-hidden">
            {filteredAudit.length === 0 ? (
              <EmptyState title="No audit log entries yet" />
            ) : (
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/70">
                    {[
                      'Timestamp',
                      'User',
                      'Action',
                      'Resource',
                      'IP address',
                      'Severity',
                    ].map((h) => (
                      <th
                        key={h}
                        className="px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredAudit.map((entry) => (
                    <tr
                      key={entry.id}
                      className={`border-b border-slate-100 last:border-0 hover:bg-slate-50/80 ${
                        entry.severity === 'critical' ? 'bg-rose-50/30' : ''
                      }`}
                    >
                      <td className="whitespace-nowrap px-5 py-4 font-mono text-xs text-slate-500">
                        {new Date(entry.timestamp).toLocaleString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </td>
                      <td className="px-5 py-4 text-sm font-medium text-slate-800">
                        {entry.user}
                      </td>
                      <td className="px-5 py-4 text-sm text-slate-700">{entry.action}</td>
                      <td className="px-5 py-4 text-xs text-slate-500">{entry.resource}</td>
                      <td className="px-5 py-4 font-mono text-xs text-slate-400">{entry.ip}</td>
                      <td className="px-5 py-4">
                        <Badge tone={SEV_TONE[entry.severity] || 'slate'}>
                          {entry.severity}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-4 text-sm text-blue-800">
            <strong>HIPAA compliance note:</strong> This audit log meets 45 CFR §164.312(b)
            requirements for audit controls. Logs are encrypted at rest, retained for 6 years, and
            cannot be altered or deleted by any staff user.
          </div>
        </div>
      )}

      {activeTab === 'Security' && (
        <div className="grid gap-4 sm:grid-cols-2">
          {[
            {
              title: 'Password policy',
              items: [
                { label: 'Minimum length', value: '12 characters' },
                { label: 'Require uppercase & lowercase', value: 'Enforced' },
                { label: 'Require numbers & symbols', value: 'Enforced' },
                { label: 'Password expiry', value: 'Every 90 days' },
                { label: 'Prevent password reuse', value: 'Last 12 passwords' },
              ],
            },
            {
              title: 'Session security',
              items: [
                { label: 'Session timeout', value: '30 minutes inactivity' },
                { label: 'Multi-factor authentication', value: 'Not enabled in current build' },
                { label: 'IP allowlist', value: 'Disabled (all IPs)' },
                { label: 'Single sign-on (SSO)', value: 'Not configured' },
                { label: 'Login attempt lockout', value: 'After 5 failures' },
              ],
            },
            {
              title: 'Data encryption & storage',
              items: [
                { label: 'Data at rest', value: 'AES-256 (PostgreSQL)' },
                { label: 'Data in transit', value: 'TLS 1.3' },
                { label: 'Database backups', value: 'Daily · Encrypted' },
                { label: 'Backup retention', value: '30 days' },
                { label: 'PHI access controls', value: 'Role-based (RBAC)' },
              ],
            },
            {
              title: 'Compliance certifications',
              items: [
                { label: 'HIPAA', value: 'Compliant' },
                { label: 'HITECH', value: 'Compliant' },
                { label: 'COMAR 10.21.20', value: 'Compliant' },
                { label: 'SOC 2 Type II', value: 'Compliant' },
                { label: '42 CFR Part 2', value: 'Under review' },
              ],
            },
          ].map((section) => (
            <div key={section.title} className="clinic-card p-5">
              <h3 className="mb-4 text-sm font-semibold text-slate-900">{section.title}</h3>
              <div className="space-y-0">
                {section.items.map((item) => (
                  <div
                    key={item.label}
                    className="flex items-center justify-between border-b border-slate-100 py-2.5 last:border-0"
                  >
                    <span className="text-sm text-slate-600">{item.label}</span>
                    <span className="text-xs font-semibold text-blue-700">{item.value}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'Integrations' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
              Connected services
            </h2>
            <a
              href="/dashboard/admin/integrations/logs"
              className="text-xs font-semibold text-[#5C2D91] hover:underline"
            >
              Integration logs
            </a>
          </div>
          <BaaNotice />
          {displayIntegrations.length === 0 ? (
            <EmptyState title="No integrations connected yet" />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {displayIntegrations.map((intg) => (
                <div key={intg.name} className="clinic-card p-5">
                  <div className="mb-3 flex items-start justify-between">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{intg.name}</p>
                      <p className="text-xs text-slate-400">{intg.plan}</p>
                    </div>
                    <Badge
                      tone={
                        intg.status === 'connected'
                          ? 'green'
                          : intg.status === 'pending'
                            ? 'amber'
                            : 'slate'
                      }
                    >
                      {intg.status}
                    </Badge>
                  </div>
                  <p className="mb-3 text-xs text-slate-500">{intg.description}</p>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-400">Last sync: {intg.lastSync}</span>
                    <button
                      type="button"
                      onClick={() => openIntegration(intg)}
                      className={
                        intg.status === 'connected' ? 'clinic-btn-secondary py-1.5 text-xs' : 'clinic-btn-primary py-1.5 text-xs'
                      }
                    >
                      {intg.status === 'connected'
                        ? 'Configure'
                        : intg.status === 'pending'
                          ? 'Continue setup'
                          : 'Connect'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'Notification Rules' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                Automated alert rules
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Configure when and how clinicians and admins are notified
              </p>
            </div>
            <button type="button" onClick={() => setRuleModalOpen(true)} className="clinic-btn-primary">
              Add rule
            </button>
          </div>

          {displayRules.length === 0 ? (
            <EmptyState title="No notification rules configured yet" />
          ) : (
            <div className="space-y-3">
              {displayRules.map((rule) => (
                <div
                  key={rule.id}
                  className={`clinic-card p-5 ${!rule.active ? 'opacity-50' : ''}`}
                >
                  <div className="flex items-start gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-slate-900">{rule.name}</span>
                        <Badge tone={SEV_TONE[rule.severity] || 'slate'}>{rule.severity}</Badge>
                        <Badge tone="slate">{rule.channel}</Badge>
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
                      onClick={() => toggleRule(rule.id)}
                      className={`relative h-6 w-12 shrink-0 rounded-full transition ${
                        rule.active ? 'bg-blue-600' : 'bg-slate-200'
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                          rule.active ? 'translate-x-6' : 'translate-x-0.5'
                        }`}
                      />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {integrationModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">{integrationModal.name} settings</h2>
              <button type="button" onClick={() => setIntegrationModal(null)} className="text-slate-400 hover:text-slate-600">
                ×
              </button>
            </div>
            <p className="mb-4 text-xs text-slate-500">
              Store clinic credentials locally. This does not start a live OAuth handshake.
            </p>
            <div className="space-y-3">
              <label className="block text-xs font-medium text-slate-600">
                Account / org ID
                <input
                  value={integrationForm.accountId}
                  onChange={(e) => setIntegrationForm((f) => ({ ...f, accountId: e.target.value }))}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
                />
              </label>
              <label className="block text-xs font-medium text-slate-600">
                API key or token
                <input
                  type="password"
                  value={integrationForm.apiKey}
                  onChange={(e) => setIntegrationForm((f) => ({ ...f, apiKey: e.target.value }))}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
                />
              </label>
              <label className="block text-xs font-medium text-slate-600">
                Status
                <select
                  value={integrationForm.status}
                  onChange={(e) => setIntegrationForm((f) => ({ ...f, status: e.target.value as Integration['status'] }))}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
                >
                  <option value="connected">connected</option>
                  <option value="pending">pending</option>
                  <option value="disconnected">disconnected</option>
                </select>
              </label>
              <label className="block text-xs font-medium text-slate-600">
                Notes
                <textarea
                  rows={3}
                  value={integrationForm.notes}
                  onChange={(e) => setIntegrationForm((f) => ({ ...f, notes: e.target.value }))}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
                />
              </label>
            </div>
            <div className="mt-5 flex gap-3">
              <button type="button" onClick={() => setIntegrationModal(null)} className="clinic-btn-secondary flex-1">
                Cancel
              </button>
              <button type="button" onClick={saveIntegration} className="clinic-btn-primary flex-1">
                Save settings
              </button>
            </div>
          </div>
        </div>
      )}

      {ruleModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">Add notification rule</h2>
              <button type="button" onClick={() => setRuleModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                ×
              </button>
            </div>
            <div className="space-y-3">
              <label className="block text-xs font-medium text-slate-600">
                Rule name
                <input
                  value={ruleForm.name}
                  onChange={(e) => setRuleForm((f) => ({ ...f, name: e.target.value }))}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
                />
              </label>
              <label className="block text-xs font-medium text-slate-600">
                Trigger
                <input
                  value={ruleForm.trigger}
                  onChange={(e) => setRuleForm((f) => ({ ...f, trigger: e.target.value }))}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
                />
              </label>
              <label className="block text-xs font-medium text-slate-600">
                Action
                <input
                  value={ruleForm.action}
                  onChange={(e) => setRuleForm((f) => ({ ...f, action: e.target.value }))}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-xs font-medium text-slate-600">
                  Channel
                  <select
                    value={ruleForm.channel}
                    onChange={(e) => setRuleForm((f) => ({ ...f, channel: e.target.value }))}
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
                  >
                    <option>In-app</option>
                    <option>In-app + email</option>
                    <option>Email</option>
                  </select>
                </label>
                <label className="block text-xs font-medium text-slate-600">
                  Severity
                  <select
                    value={ruleForm.severity}
                    onChange={(e) => setRuleForm((f) => ({ ...f, severity: e.target.value }))}
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
                  >
                    <option value="info">info</option>
                    <option value="medium">medium</option>
                    <option value="warning">warning</option>
                    <option value="critical">critical</option>
                  </select>
                </label>
              </div>
            </div>
            <div className="mt-5 flex gap-3">
              <button type="button" onClick={() => setRuleModalOpen(false)} className="clinic-btn-secondary flex-1">
                Cancel
              </button>
              <button
                type="button"
                onClick={saveRule}
                disabled={!ruleForm.name.trim() || !ruleForm.trigger.trim()}
                className="clinic-btn-primary flex-1 disabled:opacity-50"
              >
                Save rule
              </button>
            </div>
          </div>
        </div>
      )}

      {emailEditUser ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div
            className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xs"
            role="dialog"
            aria-labelledby="edit-signin-email-title"
            data-testid="edit-signin-email-modal"
          >
            <h2 id="edit-signin-email-title" className="text-base font-semibold text-slate-900">
              Edit sign-in email
            </h2>
            <p className="mt-2 text-sm text-slate-500">
              {emailEditUser.status === 'INVITED'
                ? `${emailEditUser.name || 'This user'} hasn't accepted their invite yet. Saving sends a new invite to the new address; the old link stops working.`
                : `${emailEditUser.name || 'This user'} keeps their password. Both the old and new address get a notice.`}
            </p>
            <label className="mt-4 block text-sm font-medium text-slate-700">
              Email
              <input
                type="email"
                className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-xs focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20"
                value={emailDraft}
                onChange={(e) => setEmailDraft(e.target.value)}
                autoFocus
              />
            </label>
            {emailError ? <p className="mt-2 text-xs font-medium text-rose-700">{emailError}</p> : null}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 shadow-xs hover:bg-slate-50"
                onClick={() => setEmailEditUser(null)}
                disabled={emailBusy}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-semibold text-white shadow-xs hover:bg-blue-700 disabled:opacity-50"
                disabled={emailBusy}
                data-testid="save-signin-email"
                onClick={async () => {
                  setEmailBusy(true);
                  setEmailError('');
                  try {
                    await updateSignInEmail(emailEditUser.id, emailDraft);
                    await reload();
                    setEmailEditUser(null);
                  } catch (err: any) {
                    setEmailError(err.message || 'Email update failed');
                  } finally {
                    setEmailBusy(false);
                  }
                }}
              >
                {emailEditUser.status === 'INVITED' ? 'Save and resend invite' : 'Save email'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
