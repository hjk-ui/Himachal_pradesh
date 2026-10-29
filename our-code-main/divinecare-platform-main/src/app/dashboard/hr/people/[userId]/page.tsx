'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { EMPLOYEE_RECORD_TABS, HR_EMPTIES } from '@/lib/hr/constants';

export default function EmployeeRecordPage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = use(params);
  const [tab, setTab] = useState<(typeof EMPLOYEE_RECORD_TABS)[number]>(EMPLOYEE_RECORD_TABS[0]);
  const [access, setAccess] = useState({
    canSeeCompensation: true,
    canSeeDiscipline: true,
    canSeePersonal: true,
  });
  const [record, setRecord] = useState({
    compensationNote: '',
    personalNote: '',
    correctiveNote: '',
    documents: [] as string[],
  });
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    const res = await fetch(`/api/hr/workspace?view=employee&userId=${encodeURIComponent(userId)}`, {
      cache: 'no-store',
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok === false) return;
    setAccess(data.access || access);
    setRecord(data.record || record);
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const visibleTabs = EMPLOYEE_RECORD_TABS.filter((t) => {
    if (t === 'Compensation' && !access.canSeeCompensation) return false;
    if (t === 'Corrective action' && !access.canSeeDiscipline) return false;
    return true;
  });

  async function save(patch: Record<string, unknown>) {
    const res = await fetch('/api/hr/workspace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'employee-save', userId, patch }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok === false) {
      setMsg(data.error || 'Save failed');
      return;
    }
    setMsg('Saved');
    await load();
  }

  return (
    <>
      <PageHeader
        title="Employee record"
        description={`Staff id ${userId}`}
        actions={
          <Link href="/dashboard/hr/people" className="text-sm font-semibold text-blue-600 hover:underline">
            ← People
          </Link>
        }
      />
      {msg ? <p className="mb-2 text-sm text-slate-600">{msg}</p> : null}
      <div className="mb-4 flex flex-wrap gap-2">
        {visibleTabs.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded-lg px-3 py-1.5 text-[13px] font-semibold ${
              tab === t ? 'bg-blue-600 text-white shadow-xs' : 'border border-slate-300 bg-white text-slate-700'
            }`}
          >
            {t}
          </button>
        ))}
      </div>
      <Card>
        <CardBody className="space-y-3 text-sm text-slate-600">
          {tab === 'Overview' ? <p>Employment overview for this staff member.</p> : null}
          {tab === 'Compensation' ? (
            access.canSeeCompensation ? (
              <label className="block font-medium text-slate-700">
                Compensation notes
                <textarea
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  rows={3}
                  value={record.compensationNote}
                  onChange={(e) => setRecord((r) => ({ ...r, compensationNote: e.target.value }))}
                />
                <Button className="mt-2" size="sm" onClick={() => void save({ compensationNote: record.compensationNote })}>
                  Save
                </Button>
              </label>
            ) : (
              <p>Hidden for your role</p>
            )
          ) : null}
          {tab === 'Credentials' ? <p>{HR_EMPTIES.allCurrent}</p> : null}
          {tab === 'Documents' ? (
            <p>{record.documents.length ? record.documents.join(', ') : HR_EMPTIES.noDocuments}</p>
          ) : null}
          {tab === 'Training' ? <p>{HR_EMPTIES.noTrainings}</p> : null}
          {tab === 'Time off' ? <p>{HR_EMPTIES.nothingWaiting}</p> : null}
          {tab === 'Performance' ? <p>No reviews</p> : null}
          {tab === 'Onboarding' ? <p>{HR_EMPTIES.noChecklist}</p> : null}
          {tab === 'Corrective action' ? (
            access.canSeeDiscipline ? (
              <label className="block font-medium text-slate-700">
                Corrective action
                <textarea
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  rows={3}
                  value={record.correctiveNote}
                  onChange={(e) => setRecord((r) => ({ ...r, correctiveNote: e.target.value }))}
                />
                <Button className="mt-2" size="sm" onClick={() => void save({ correctiveNote: record.correctiveNote })}>
                  Save
                </Button>
                {!record.correctiveNote ? <p className="mt-2">{HR_EMPTIES.noCorrective}</p> : null}
              </label>
            ) : (
              <p>Hidden for your role</p>
            )
          ) : null}
          {tab === 'Altrixs account' ? <p>Account status managed in Admin › Users &amp; Roles.</p> : null}
          {tab !== 'Compensation' &&
          tab !== 'Corrective action' &&
          access.canSeePersonal === false &&
          tab === 'Overview' ? (
            <p className="text-xs text-slate-500">Personal fields redacted for Office Manager.</p>
          ) : null}
        </CardBody>
      </Card>
    </>
  );
}
