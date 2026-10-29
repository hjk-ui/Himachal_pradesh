'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CalendarDays, CheckCircle2, ClipboardList, RefreshCw, ShieldAlert, Sparkles, UserMinus, UserPlus, Users } from 'lucide-react';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  LoadingState,
  Page,
  PageHeader,
  StatCard,
  StatGrid,
  StatusBadge,
  buttonClasses,
} from '@/components/ui';
import { AiDraftNotice, ExpiryBadge, ProgressBar } from './HrBits';
import { fmtDate, hrFetch, useHrData } from './hrClient';

type Item = { key: string; userId: string; staffName: string; category: string; label: string; dueOn: string | null; status: string; daysLeft: number | null; href: string };
type Checklist = { id: string; userId: string; staffName: string; jobTitle: string; startOn: string; progress: { pct: number; done: number; total: number }; overdue: number };
type DashboardData = {
  today: string;
  settings: { blockSchedulingWhenLicenseExpired: boolean; aiDigest: boolean };
  summary: { expired: number; missing: number; due30: number; due60: number; licensesExpired: number; exclusionsDue: number; caqhDue: number; trainingsOverdue: number; tasksOverdue: number };
  items: Item[];
  tasks: Array<{ id: string; title: string; detail: string | null; dueOn: string | null; severity: string; href: string | null }>;
  onboarding: Checklist[];
  offboarding: Checklist[];
  changeRequests: Array<{ id: string; userId: string; name: string; changes: Record<string, unknown>; createdAt: string }>;
  pendingTimeOff: number;
  reviewsDue: number;
  licenseFlags: Array<{ userId: string; name: string; title: string; expiredOn: string; daysExpired: number }>;
  workforce: { headcount: number; hires12m: number; separations12m: number; turnover12mPct: number | null };
};

export function HrDashboard() {
  const { data, error, loading, reload } = useHrData<DashboardData>('/api/hr/dashboard');
  const [refreshing, setRefreshing] = useState(false);
  const [digest, setDigest] = useState<{ text: string; engine: 'bedrock' | 'rules'; disclaimer: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function refresh() {
    setRefreshing(true);
    try {
      await hrFetch('/api/hr/dashboard?refresh=1');
      await reload();
    } finally {
      setRefreshing(false);
    }
  }
  async function taskStatus(id: string, status: 'done' | 'dismissed') {
    setBusy(id);
    try {
      await hrFetch('/api/hr/tasks', { method: 'PATCH', json: { id, status } });
      await reload();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not update');
    } finally {
      setBusy(null);
    }
  }
  async function decideChange(id: string, decision: 'approved' | 'rejected') {
    setBusy(id);
    try {
      await hrFetch('/api/hr/change-requests', { method: 'PATCH', json: { id, decision } });
      await reload();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not update');
    } finally {
      setBusy(null);
    }
  }
  async function runDigest() {
    setBusy('digest');
    try {
      const r = await hrFetch<{ draft: { data: { text: string }; engine: 'bedrock' | 'rules'; disclaimer: string } }>('/api/hr/ai/digest', { method: 'POST', json: {} });
      setDigest({ text: r.draft.data.text, engine: r.draft.engine, disclaimer: r.draft.disclaimer });
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not build the digest');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Page>
      <PageHeader
        eyebrow="HR"
        title="HR dashboard"
        description="Expirations, reminders, onboarding and approvals in one place. Reminders appear in Altrixs only; no email is sent."
        actions={
          <>
            {data?.settings.aiDigest ? (
              <Button variant="secondary" icon={<Sparkles />} loading={busy === 'digest'} onClick={runDigest}>
                Weekly digest
              </Button>
            ) : null}
            <Button variant="secondary" icon={<RefreshCw />} loading={refreshing} onClick={refresh}>
              Refresh reminders
            </Button>
            <Link href="/dashboard/hr/people?new=1" className={buttonClasses({})}>
              <UserPlus className="h-4 w-4" aria-hidden /> New hire
            </Link>
          </>
        }
      />
      {msg ? (
        <Alert tone="danger" actions={<Button size="sm" variant="ghost" onClick={() => setMsg(null)}>Dismiss</Button>}>
          {msg}
        </Alert>
      ) : null}
      {loading && !data ? <LoadingState rows={6} /> : null}
      {error && !data ? <ErrorState description={error} onRetry={reload} /> : null}
      {data ? (
        <>
          {data.licenseFlags.length ? (
            <Alert tone="danger" title={`${data.licenseFlags.length} clinician license${data.licenseFlags.length === 1 ? '' : 's'} expired`}>
              {data.licenseFlags.map((f) => `${f.name} (${f.title}, expired ${fmtDate(f.expiredOn)})`).join('; ')}.{' '}
              {data.settings.blockSchedulingWhenLicenseExpired
                ? 'Practice setting: scheduling is blocked for these clinicians until the renewal is recorded.'
                : 'Scheduling is not blocked (practice setting off); HR and leadership see this warning on scheduling and billing.'}
            </Alert>
          ) : null}
          {digest ? (
            <Card>
              <CardHeader title="Weekly HR digest" icon={<Sparkles />} actions={<Button size="sm" variant="ghost" onClick={() => setDigest(null)}>Close</Button>} />
              <CardBody className="space-y-3">
                <AiDraftNotice engine={digest.engine} disclaimer={digest.disclaimer} />
                <p className="whitespace-pre-wrap text-sm text-slate-800">{digest.text}</p>
              </CardBody>
            </Card>
          ) : null}
          <StatGrid columns={4}>
            <StatCard label="Expired or missing" value={data.summary.expired + data.summary.missing} hint="Credentials, checks, trainings" icon={<ShieldAlert />} tone={data.summary.expired + data.summary.missing ? 'danger' : 'success'} href="/dashboard/hr/credentialing" />
            <StatCard label="Due within 30 days" value={data.summary.due30} hint={`${data.summary.due60} more within 60 days`} icon={<AlertTriangle />} tone={data.summary.due30 ? 'warning' : 'success'} href="/dashboard/hr/credentialing" />
            <StatCard label="Staff due for exclusion checks" value={new Set(data.items.filter((i) => i.key.startsWith('exclusion')).map((i) => i.userId)).size} hint="OIG, SAM.gov, Maryland Medicaid" icon={<CheckCircle2 />} tone="info" href="/dashboard/hr/credentialing?view=exclusions" />
            <StatCard label="Headcount" value={data.workforce.headcount} hint={data.workforce.turnover12mPct != null ? `12-month turnover ${data.workforce.turnover12mPct}%` : 'Turnover needs hire / end dates'} icon={<Users />} href="/dashboard/hr/org-chart" />
          </StatGrid>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader title="HR reminders" description="Open reminders from the expiration engine. Mark done when handled." icon={<ClipboardList />} />
              <CardBody flush>
                {data.tasks.length === 0 ? (
                  <EmptyState compact title="Nothing waiting" description="New reminders appear as items come due." />
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {data.tasks.slice(0, 40).map((t) => (
                      <li key={t.id} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <StatusBadge size="sm" tone={t.severity === 'critical' ? 'danger' : t.severity === 'warning' ? 'warning' : 'info'}>
                              {t.severity === 'critical' ? 'Overdue' : t.severity === 'warning' ? 'Soon' : 'Upcoming'}
                            </StatusBadge>
                            {t.href ? (
                              <Link href={t.href} className="truncate text-sm font-medium text-slate-900 hover:text-blue-700">{t.title}</Link>
                            ) : (
                              <span className="text-sm font-medium text-slate-900">{t.title}</span>
                            )}
                          </div>
                          {t.detail ? <p className="mt-0.5 truncate text-xs text-slate-500">{t.detail}</p> : null}
                        </div>
                        <div className="flex shrink-0 gap-2">
                          <Button size="sm" variant="secondary" loading={busy === t.id} onClick={() => taskStatus(t.id, 'done')}>Done</Button>
                          <Button size="sm" variant="ghost" disabled={busy === t.id} onClick={() => taskStatus(t.id, 'dismissed')}>Dismiss</Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Waiting on you" icon={<CalendarDays />} />
              <CardBody className="space-y-3 text-sm">
                <Link href="/dashboard/hr/time-off" className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 hover:bg-slate-50">
                  <span>Time-off requests</span>
                  <StatusBadge tone={data.pendingTimeOff ? 'warning' : 'neutral'}>{data.pendingTimeOff}</StatusBadge>
                </Link>
                <Link href="/dashboard/hr/performance" className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 hover:bg-slate-50">
                  <span>Reviews due</span>
                  <StatusBadge tone={data.reviewsDue ? 'warning' : 'neutral'}>{data.reviewsDue}</StatusBadge>
                </Link>
                <div className="rounded-lg border border-slate-200">
                  <div className="flex items-center justify-between px-3 py-2">
                    <span>Profile changes to approve</span>
                    <StatusBadge tone={data.changeRequests.length ? 'warning' : 'neutral'}>{data.changeRequests.length}</StatusBadge>
                  </div>
                  {data.changeRequests.slice(0, 5).map((r) => (
                    <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-3 py-2">
                      <span className="min-w-0 text-xs">
                        <Link className="font-medium text-slate-900 hover:text-blue-700" href={`/dashboard/hr/people/${r.userId}`}>{r.name}</Link>
                        <span className="text-slate-500"> · {Object.keys(r.changes).join(', ')}</span>
                      </span>
                      <span className="flex gap-1">
                        <Button size="sm" variant="secondary" loading={busy === r.id} onClick={() => decideChange(r.id, 'approved')}>Approve</Button>
                        <Button size="sm" variant="ghost" disabled={busy === r.id} onClick={() => decideChange(r.id, 'rejected')}>Reject</Button>
                      </span>
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>
          </div>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <ChecklistCard title="Onboarding in progress" icon={<UserPlus />} rows={data.onboarding} href="/dashboard/hr/onboarding" />
            <ChecklistCard title="Offboarding in progress" icon={<UserMinus />} rows={data.offboarding} href="/dashboard/hr/offboarding" />
          </div>
          <Card>
            <CardHeader title="Needs attention" description="Every dated item that is expired, missing or due within 60 days." actions={<Link className={buttonClasses({ variant: 'secondary', size: 'sm' })} href="/dashboard/hr/credentialing">Open credentialing</Link>} />
            <CardBody flush>
              {data.items.filter((i) => !i.key.startsWith('exclusion')).length === 0 ? (
                <EmptyState compact title="All current" />
              ) : (
                <div className="clinic-scroll-x">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold text-slate-600">
                        <th scope="col" className="px-4 py-2.5">Staff</th>
                        <th scope="col" className="px-4 py-2.5">Item</th>
                        <th scope="col" className="hidden px-4 py-2.5 md:table-cell">Type</th>
                        <th scope="col" className="px-4 py-2.5">Due</th>
                        <th scope="col" className="px-4 py-2.5">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {data.items
                        .filter((i) => !i.key.startsWith('exclusion'))
                        .slice(0, 60)
                        .map((i) => (
                          <tr key={i.key} className="hover:bg-slate-50">
                            <td className="px-4 py-2.5">
                              <Link href={`/dashboard/hr/people/${i.userId}`} className="font-medium text-slate-900 hover:text-blue-700">{i.staffName}</Link>
                            </td>
                            <td className="px-4 py-2.5">
                              <Link href={i.href} className="hover:text-blue-700">{i.label}</Link>
                            </td>
                            <td className="hidden px-4 py-2.5 text-slate-600 md:table-cell">{i.category}</td>
                            <td className="whitespace-nowrap px-4 py-2.5 text-slate-600">{fmtDate(i.dueOn)}</td>
                            <td className="px-4 py-2.5"><ExpiryBadge status={i.status} dueOn={i.dueOn} daysLeft={i.daysLeft} size="sm" /></td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardBody>
          </Card>
        </>
      ) : null}
    </Page>
  );
}

function ChecklistCard({ title, icon, rows, href }: { title: string; icon: React.ReactNode; rows: Checklist[]; href: string }) {
  return (
    <Card>
      <CardHeader title={title} icon={icon} actions={<Link href={href} className={buttonClasses({ variant: 'ghost', size: 'sm' })}>View all</Link>} />
      <CardBody flush>
        {rows.length === 0 ? (
          <EmptyState compact title="None in progress" />
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((c) => (
              <li key={c.id} className="px-5 py-3">
                <div className="flex items-center justify-between gap-3">
                  <Link href={`${href}?checklist=${c.id}`} className="min-w-0 truncate text-sm font-medium text-slate-900 hover:text-blue-700">
                    {c.staffName}
                  </Link>
                  <span className="shrink-0 text-xs text-slate-500">{fmtDate(c.startOn)}</span>
                </div>
                <div className="mt-1.5 flex items-center gap-3">
                  <div className="flex-1"><ProgressBar pct={c.progress.pct} label={`${c.staffName} progress`} tone={c.overdue ? 'warning' : 'brand'} /></div>
                  {c.overdue ? <StatusBadge size="sm" tone="danger">{c.overdue} overdue</StatusBadge> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
