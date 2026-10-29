'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import {
  CREDENTIALING_TABS,
  HR_EMPTIES,
  ORG_CHART_TABS,
  TIME_OFF_TABS,
} from '@/lib/hr/constants';
import { useStaff } from '@/features/staff/hooks/useStaff';

type ModuleKey =
  | 'onboarding'
  | 'offboarding'
  | 'time-off'
  | 'performance'
  | 'org-chart'
  | 'settings'
  | 'me'
  | 'credentialing'
  | 'training';

export function HrModulePage({ module }: { module: ModuleKey }) {
  const { users } = useStaff();
  const { data: session } = useSession();
  const me = session?.user as { id?: string; name?: string | null; firstName?: string } | undefined;
  const firstName = (me?.name || 'there').split(' ')[0];
  const [items, setItems] = useState<any[]>([]);
  const [goals, setGoals] = useState<any[]>([]);
  const [access, setAccess] = useState<Record<string, boolean>>({});
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [sub, setSub] = useState(0);
  const [msg, setMsg] = useState('');
  const [staffPick, setStaffPick] = useState('');

  const load = useCallback(async () => {
    const view =
      module === 'onboarding' || module === 'offboarding'
        ? 'checklists'
        : module === 'time-off'
          ? 'pto'
          : module === 'performance'
            ? 'reviews'
            : module === 'training'
              ? 'trainings'
              : module === 'settings'
                ? 'settings'
                : module === 'me'
                  ? 'pto'
                  : null;
    if (!view) return;
    const type =
      module === 'onboarding' ? 'onboarding' : module === 'offboarding' ? 'offboarding' : '';
    const q = type ? `&type=${type}` : '';
    const res = await fetch(`/api/hr/workspace?view=${view}${q}`, { cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return;
    setItems(data.items || []);
    setGoals(data.goals || []);
    setAccess(data.access || {});
    if (data.settings) setSettings(data.settings);
  }, [module]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(body: Record<string, unknown>, ok: string) {
    const res = await fetch('/api/hr/workspace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(data.error || 'Failed');
      return;
    }
    setMsg(ok);
    await load();
  }

  if (module === 'credentialing') {
    return (
      <>
        <PageHeader
          title="Credentialing & compliance"
          description="Expirations, exclusion checks, credential registry, payer enrollment"
        />
        <div className="mb-4 flex flex-wrap gap-2">
          {CREDENTIALING_TABS.map((t, i) => (
            <button
              key={t}
              type="button"
              onClick={() => setSub(i)}
              className={`rounded-lg px-3 py-1.5 text-[13px] font-semibold ${
                sub === i ? 'bg-blue-600 text-white' : 'border border-slate-300 bg-white'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="mb-4 grid gap-3 sm:grid-cols-4">
          {['Expired', 'Missing', 'Due 30', 'Due 60'].map((k) => (
            <Card key={k}>
              <CardBody>
                <p className="text-xs uppercase text-slate-500">{k}</p>
                <p className="text-2xl font-semibold tabular-nums">0</p>
              </CardBody>
            </Card>
          ))}
        </div>
        <Card>
          <CardBody>
            <p className="text-sm text-slate-500">Nothing matches</p>
            <a href="/dashboard/hr/credentialing" className="mt-2 inline-block text-sm font-semibold text-blue-600">
              Open full credentialing workspace →
            </a>
          </CardBody>
        </Card>
      </>
    );
  }

  if (module === 'org-chart') {
    const filtered = users.filter((u) => u.status === 'ACTIVE' || u.status === 'INVITED');
    return (
      <>
        <PageHeader title="Org chart & directory" description="Directory, org chart, headcount & turnover" />
        <div className="mb-4 flex flex-wrap gap-2">
          {ORG_CHART_TABS.map((t, i) => (
            <button
              key={t}
              type="button"
              onClick={() => setSub(i)}
              className={`rounded-lg px-3 py-1.5 text-[13px] font-semibold ${
                sub === i ? 'bg-blue-600 text-white' : 'border border-slate-300 bg-white'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        <Card>
          <CardBody>
            {filtered.length === 0 ? (
              <p className="text-sm text-slate-500">No one matches</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {filtered.map((u) => (
                  <li key={u.id} className="flex justify-between border-b border-slate-100 py-2">
                    <span className="font-medium">{u.name || u.email}</span>
                    <span className="text-slate-500">{u.role}</span>
                  </li>
                ))}
              </ul>
            )}
            {sub === 2 && access.canManageSettings === false ? (
              <p className="mt-3 text-xs text-slate-500">Headcount & turnover analytics: HR/leadership only.</p>
            ) : null}
          </CardBody>
        </Card>
      </>
    );
  }

  if (module === 'onboarding' || module === 'offboarding') {
    const title = module === 'onboarding' ? 'Onboarding' : 'Offboarding';
    const cta = module === 'onboarding' ? 'Start onboarding' : 'Start offboarding';
    return (
      <>
        <PageHeader
          title={title}
          description="Checklist boards — status In progress | Complete | Cancelled"
          actions={
            <div className="flex flex-wrap gap-2">
              <select
                className="rounded-lg border border-slate-300 px-2 text-sm"
                value={staffPick}
                onChange={(e) => setStaffPick(e.target.value)}
              >
                <option value="">Select staff…</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name || u.email}
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                onClick={() => {
                  const staff = users.find((u) => u.id === staffPick);
                  if (!staff) {
                    setMsg('Select staff');
                    return;
                  }
                  void act(
                    {
                      action: 'checklist-start',
                      type: module,
                      staffUserId: staff.id,
                      staffName: staff.name || staff.email,
                    },
                    'Checklist started'
                  );
                }}
              >
                {cta}
              </Button>
            </div>
          }
        />
        {msg ? <p className="mb-2 text-sm text-slate-600">{msg}</p> : null}
        {items.length === 0 ? (
          <Card>
            <CardBody>
              <p className="text-sm text-slate-500">{HR_EMPTIES.noneInProgress}</p>
            </CardBody>
          </Card>
        ) : (
          <div className="space-y-3">
            {items.map((c) => (
              <Card key={c.id}>
                <CardHeader
                  title={c.staffName}
                  description={c.status}
                  actions={
                    <div className="flex gap-1">
                      {(['In progress', 'Complete', 'Cancelled'] as const).map((st) => (
                        <Button
                          key={st}
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            void act(
                              { action: 'checklist-status', checklistId: c.id, status: st },
                              st
                            )
                          }
                        >
                          {st}
                        </Button>
                      ))}
                    </div>
                  }
                />
                <CardBody>
                  <ul className="space-y-2">
                    {(c.tasks || []).map((t: { id: string; label: string; done: boolean }) => (
                      <li key={t.id} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={Boolean(t.done)}
                          onChange={(e) =>
                            void act(
                              {
                                action: 'checklist-task',
                                checklistId: c.id,
                                taskId: t.id,
                                done: e.target.checked,
                              },
                              'Task updated'
                            )
                          }
                        />
                        <span className={t.done ? 'text-slate-400 line-through' : ''}>{t.label}</span>
                      </li>
                    ))}
                  </ul>
                </CardBody>
              </Card>
            ))}
          </div>
        )}
      </>
    );
  }

  if (module === 'time-off' || module === 'me') {
    const isMe = module === 'me';
    return (
      <>
        <PageHeader
          title={isMe ? `Hi, ${firstName}` : 'Time off'}
          description={
            isMe
              ? 'Overview, My profile, Credentials, Training & CEUs, Time off, Documents, Performance, Policies, My team'
              : 'Requests, calendar, and balances'
          }
          actions={
            <Button
              size="sm"
              onClick={() =>
                void act(
                  {
                    action: 'pto-create',
                    staffUserId: me?.id || 'self',
                    staffName: me?.name || firstName,
                    startDate: new Date().toISOString().slice(0, 10),
                    endDate: new Date().toISOString().slice(0, 10),
                    reason: 'Time off request',
                  },
                  'Request entered'
                )
              }
            >
              {isMe ? 'Request time off' : 'Enter request'}
            </Button>
          }
        />
        {!isMe ? (
          <div className="mb-4 flex flex-wrap gap-2">
            {TIME_OFF_TABS.map((t, i) => (
              <button
                key={t}
                type="button"
                onClick={() => setSub(i)}
                className={`rounded-lg px-3 py-1.5 text-[13px] font-semibold ${
                  sub === i ? 'bg-blue-600 text-white' : 'border border-slate-300 bg-white'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        ) : (
          <div className="mb-4 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                void act({ action: 'training-create', title: 'CEU entry', hours: 1 }, 'Training / CEU added')
              }
            >
              Add training / CEU
            </Button>
          </div>
        )}
        {msg ? <p className="mb-2 text-sm">{msg}</p> : null}
        <Card>
          <CardBody>
            {items.length === 0 ? (
              <p className="text-sm text-slate-500">No time-off requests</p>
            ) : (
              <ul className="space-y-2">
                {items.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span>
                      {r.staffName}: {r.startDate} → {r.endDate} · {r.status}
                    </span>
                    {access.canApprovePto && r.status === 'pending' ? (
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          onClick={() =>
                            void act({ action: 'pto-status', id: r.id, status: 'approved' }, 'Approved')
                          }
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() =>
                            void act({ action: 'pto-status', id: r.id, status: 'denied' }, 'Denied')
                          }
                        >
                          Deny
                        </Button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </>
    );
  }

  if (module === 'performance') {
    return (
      <>
        <PageHeader
          title="Performance"
          description="Open reviews | Completed | Goals"
          actions={
            <Button
              size="sm"
              onClick={() => {
                const staff = users[0];
                if (!staff) return;
                void act(
                  {
                    action: 'review-create',
                    staffUserId: staff.id,
                    staffName: staff.name || staff.email,
                  },
                  'Review started'
                );
              }}
            >
              Start a review
            </Button>
          }
        />
        {msg ? <p className="mb-2 text-sm">{msg}</p> : null}
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Reviews" />
            <CardBody>
              {items.length === 0 ? (
                <p className="text-sm text-slate-500">No reviews</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {items.map((r) => (
                    <li key={r.id}>
                      {r.staffName} · {r.status}
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader
              title="Goals"
              actions={
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    void act(
                      { action: 'goal-create', title: 'Clinical documentation', staffName: 'Team' },
                      'Goal added'
                    )
                  }
                >
                  Add goal
                </Button>
              }
            />
            <CardBody>
              {goals.length === 0 ? (
                <p className="text-sm text-slate-500">No goals yet</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {goals.map((g) => (
                    <li key={g.id}>{g.title}</li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      </>
    );
  }

  if (module === 'training') {
    return (
      <>
        <PageHeader
          title="Training & CEUs"
          description="Required trainings and continuing education"
          actions={
            <Button
              size="sm"
              onClick={() =>
                void act({ action: 'training-create', title: 'HIPAA annual', hours: 2 }, 'Training added')
              }
            >
              Add required training
            </Button>
          }
        />
        <Card>
          <CardBody>
            {items.length === 0 ? (
              <p className="text-sm text-slate-500">{HR_EMPTIES.noTrainings}</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {items.map((t) => (
                  <li key={t.id}>
                    {t.title} · {t.hours}h
                  </li>
                ))}
              </ul>
            )}
            <a href="/dashboard/hr/training" className="mt-3 inline-block text-sm font-semibold text-blue-600">
              Open Training Hub →
            </a>
          </CardBody>
        </Card>
      </>
    );
  }

  if (module === 'settings') {
    return (
      <>
        <PageHeader title="HR settings" description="Expirations, MD sick leave, PTO, CEU, templates, policies, AI features" />
        {msg ? <p className="mb-2 text-sm">{msg}</p> : null}
        <Card>
          <CardBody className="grid gap-3 sm:grid-cols-2">
            {(
              [
                ['expirationsDays', 'Expirations / screening (days)'],
                ['mdSickLeaveDays', 'MD sick leave days'],
                ['ptoDays', 'PTO days'],
                ['ceuHours', 'CEU hours'],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="text-sm font-medium text-slate-700">
                {label}
                <input
                  type="number"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={Number(settings[key] ?? 0)}
                  onChange={(e) => setSettings((s) => ({ ...s, [key]: Number(e.target.value) }))}
                />
              </label>
            ))}
            <label className="text-sm font-medium text-slate-700 sm:col-span-2">
              Templates
              <textarea
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                rows={2}
                value={String(settings.templates || '')}
                onChange={(e) => setSettings((s) => ({ ...s, templates: e.target.value }))}
              />
            </label>
            <label className="text-sm font-medium text-slate-700 sm:col-span-2">
              Policies
              <textarea
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                rows={2}
                value={String(settings.policies || '')}
                onChange={(e) => setSettings((s) => ({ ...s, policies: e.target.value }))}
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={Boolean(settings.aiEnabled)}
                onChange={(e) => setSettings((s) => ({ ...s, aiEnabled: e.target.checked }))}
              />
              AI features
            </label>
            <Button
              onClick={() => void act({ action: 'settings-save', patch: settings }, 'Settings saved')}
            >
              Save settings
            </Button>
          </CardBody>
        </Card>
      </>
    );
  }

  return null;
}
