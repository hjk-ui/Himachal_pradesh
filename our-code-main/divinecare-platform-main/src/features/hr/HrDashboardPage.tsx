'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import {
  HR_DASHBOARD_DESCRIPTION,
  HR_DASHBOARD_EYEBROW,
  HR_DASHBOARD_TITLE,
  HR_EMPTIES,
} from '@/lib/hr/constants';

type Reminder = { id: string; title: string; status: string };
type Checklist = { id: string; staffName: string; status: string; type: string };

export default function HrDashboardPage() {
  const router = useRouter();
  const [kpis, setKpis] = useState({
    expiredOrMissing: 0,
    dueWithin30: 0,
    exclusionDue: 0,
    headcount: 0,
  });
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [onboarding, setOnboarding] = useState<Checklist[]>([]);
  const [offboarding, setOffboarding] = useState<Checklist[]>([]);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    const res = await fetch('/api/hr/workspace?view=dashboard', { cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return;
    setKpis(data.kpis || kpis);
    setReminders(data.reminders || []);
    setOnboarding(data.onboarding || []);
    setOffboarding(data.offboarding || []);
  }, []);

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

  return (
    <>
      <PageHeader
        eyebrow={HR_DASHBOARD_EYEBROW}
        title={HR_DASHBOARD_TITLE}
        description={HR_DASHBOARD_DESCRIPTION}
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void act({ action: 'reminder-create', title: 'Weekly HR digest' }, 'Digest queued in-app')}
            >
              Weekly digest
            </Button>
            <Button variant="secondary" size="sm" onClick={() => void load()}>
              Refresh reminders
            </Button>
            <Button size="sm" onClick={() => router.push('/dashboard/hr/people?new=1')}>
              New hire
            </Button>
          </>
        }
      />
      {msg ? <p className="mb-3 text-sm text-slate-600">{msg}</p> : null}

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Expired or missing', value: kpis.expiredOrMissing },
          { label: 'Due within 30 days', value: kpis.dueWithin30 },
          { label: 'Staff due for exclusion checks', value: kpis.exclusionDue },
          { label: 'Headcount', value: kpis.headcount },
        ].map((k) => (
          <Card key={k.label}>
            <CardBody>
              <p className="text-xs font-medium uppercase tracking-wider text-slate-500">{k.label}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{k.value}</p>
            </CardBody>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="HR reminders" description="In-app only — no email is sent" />
          <CardBody className="space-y-3">
            {reminders.length === 0 ? (
              <p className="text-sm text-slate-500">{HR_EMPTIES.nothingWaiting}</p>
            ) : (
              reminders.map((r) => (
                <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2">
                  <p className="text-sm font-medium text-slate-900">{r.title}</p>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        void act({ action: 'reminder-status', id: r.id, status: 'done' }, 'Done')
                      }
                    >
                      Done
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        void act({ action: 'reminder-status', id: r.id, status: 'dismissed' }, 'Dismissed')
                      }
                    >
                      Dismiss
                    </Button>
                  </div>
                </div>
              ))
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Waiting on you" description="Profile changes need Approve / Reject" />
          <CardBody className="space-y-3">
            {reminders.length === 0 ? (
              <p className="text-sm text-slate-500">{HR_EMPTIES.nothingWaiting}</p>
            ) : (
              reminders.slice(0, 3).map((r) => (
                <div key={`w-${r.id}`} className="flex flex-wrap gap-2">
                  <p className="flex-1 text-sm text-slate-800">{r.title}</p>
                  <Button
                    size="sm"
                    onClick={() =>
                      void act({ action: 'reminder-status', id: r.id, status: 'done' }, 'Approved')
                    }
                  >
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() =>
                      void act({ action: 'reminder-status', id: r.id, status: 'dismissed' }, 'Rejected')
                    }
                  >
                    Reject
                  </Button>
                </div>
              ))
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Onboarding in progress"
            actions={
              <Link href="/dashboard/hr/onboarding" className="text-xs font-semibold text-blue-600">
                Open →
              </Link>
            }
          />
          <CardBody>
            {onboarding.length === 0 ? (
              <p className="text-sm text-slate-500">{HR_EMPTIES.noneInProgress}</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {onboarding.map((c) => (
                  <li key={c.id}>
                    {c.staffName} · {c.status}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Offboarding in progress"
            actions={
              <Link href="/dashboard/hr/offboarding" className="text-xs font-semibold text-blue-600">
                Open →
              </Link>
            }
          />
          <CardBody>
            {offboarding.length === 0 ? (
              <p className="text-sm text-slate-500">{HR_EMPTIES.noneInProgress}</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {offboarding.map((c) => (
                  <li key={c.id}>
                    {c.staffName} · {c.status}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Needs attention" />
          <CardBody>
            <p className="text-sm text-slate-500">{HR_EMPTIES.allCurrent}</p>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
