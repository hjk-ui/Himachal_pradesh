'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { LogOut, Plus, UserPlus } from 'lucide-react';
import { Alert, Button, Card, CardBody, CardHeader, EmptyState, ErrorState, LoadingState, Modal, Page, PageHeader, StatusBadge, Tabs } from '@/components/ui';
import { Labeled, ProgressBar, Select, TextInput } from './HrBits';
import { ChecklistTasks, type Checklist } from './ChecklistTasks';
import { fmtDate, hrFetch, roleLabel, useHrData } from './hrClient';

type BoardData = {
  today: string;
  viewer: { userId: string; role: string };
  checklists: Checklist[];
  templates: Array<{ id: string | null; name: string; roles: string[]; builtIn: boolean; itemCount: number }>;
  people: Array<{ userId: string; name: string; role: string; hrStatus: string; hireDate: string | null }>;
};

/** Onboarding or offboarding: checklists with owners, due dates and progress. */
export function ChecklistBoard({ kind }: { kind: 'onboarding' | 'offboarding' }) {
  const params = useSearchParams();
  const [status, setStatus] = useState<'active' | 'complete' | 'cancelled'>('active');
  const { data, error, loading, reload } = useHrData<BoardData>(`/api/hr/checklists?kind=${kind}&status=${status}`);
  const [selected, setSelected] = useState<string | null>(params.get('checklist'));
  const [starting, setStarting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const list = useMemo(() => data?.checklists ?? [], [data]);
  const current = list.find((c) => c.id === selected) ?? list[0] ?? null;
  useEffect(() => {
    if (!selected && list[0]) setSelected(list[0].id);
  }, [list, selected]);

  async function cancel(id: string) {
    setBusy(true);
    try {
      await hrFetch(`/api/hr/checklists/${id}`, { method: 'DELETE' });
      setSelected(null);
      reload();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not cancel');
    } finally {
      setBusy(false);
    }
  }

  const isOn = kind === 'onboarding';
  return (
    <Page width="full">
      <PageHeader
        eyebrow="HR"
        title={isOn ? 'Onboarding' : 'Offboarding'}
        description={
          isOn
            ? 'Role-based checklists: paperwork (I-9, W-4, MW507), screening, credentials, training, policy acknowledgments, system access, equipment and 30/60/90-day check-ins.'
            : 'Last day, exit interview, equipment, access removal (Altrixs, DrFirst), payer notifications, caseload handoff by count, final pay and COBRA notice. Every step is audited.'
        }
        actions={
          <>
            <Link href="/dashboard/hr/settings?view=templates" className="text-sm font-medium text-blue-700 hover:underline">Edit templates</Link>
            <Button icon={isOn ? <UserPlus /> : <LogOut />} onClick={() => setStarting(true)}>{isOn ? 'Start onboarding' : 'Start offboarding'}</Button>
          </>
        }
      />
      {msg ? <Alert tone="danger" actions={<Button size="sm" variant="ghost" onClick={() => setMsg(null)}>Dismiss</Button>}>{msg}</Alert> : null}
      <Tabs label="Status" variant="pill" value={status} onChange={(v) => { setStatus(v); setSelected(null); }} items={[{ key: 'active', label: 'In progress' }, { key: 'complete', label: 'Complete' }, { key: 'cancelled', label: 'Cancelled' }]} />
      {loading && !data ? <LoadingState rows={6} /> : null}
      {error && !data ? <ErrorState description={error} onRetry={reload} /> : null}
      {data ? (
        list.length === 0 ? (
          <Card><EmptyState title={`No ${kind} checklists here`} action={<Button onClick={() => setStarting(true)}>{isOn ? 'Start onboarding' : 'Start offboarding'}</Button>} /></Card>
        ) : (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
            <Card>
              <ul className="divide-y divide-slate-100">
                {list.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(c.id)}
                      aria-current={current?.id === c.id ? 'true' : undefined}
                      className={`block w-full px-4 py-3 text-left hover:bg-slate-50 ${current?.id === c.id ? 'bg-blue-50' : ''}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium text-slate-900">{c.staffName}</span>
                        {c.overdue ? <StatusBadge size="sm" tone="danger">{c.overdue} overdue</StatusBadge> : null}
                      </div>
                      <p className="text-xs text-slate-500">{c.jobTitle || '—'} · {isOn ? 'starts' : 'last day'} {fmtDate(c.startOn)}</p>
                      <div className="mt-1.5"><ProgressBar pct={c.progress.pct} label={`${c.staffName} progress`} /></div>
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
            {current ? (
              <Card>
                <CardHeader
                  title={current.staffName}
                  description={`${current.templateName} · ${isOn ? 'start date' : 'last day'} ${fmtDate(current.startOn)} · ${current.progress.done} of ${current.progress.total} done`}
                  actions={
                    <>
                      <Link href={`/dashboard/hr/people/${current.userId}`} className="text-sm font-medium text-blue-700 hover:underline">Employee record</Link>
                      {current.status === 'active' ? <Button size="sm" variant="ghost" loading={busy} onClick={() => cancel(current.id)}>Cancel checklist</Button> : null}
                    </>
                  }
                />
                <CardBody>
                  <ChecklistTasks checklist={current} today={data.today} viewer={{ userId: data.viewer.userId, role: data.viewer.role, hrAdmin: true }} onChanged={reload} />
                </CardBody>
              </Card>
            ) : null}
          </div>
        )
      ) : null}
      {starting && data ? (
        <StartChecklistModal
          kind={kind}
          people={data.people}
          templates={data.templates}
          today={data.today}
          onClose={() => setStarting(false)}
          onSaved={(id) => {
            setStarting(false);
            setStatus('active');
            setSelected(id);
            reload();
          }}
        />
      ) : null}
    </Page>
  );
}

function StartChecklistModal({
  kind,
  people,
  templates,
  today,
  onClose,
  onSaved,
}: {
  kind: 'onboarding' | 'offboarding';
  people: BoardData['people'];
  templates: BoardData['templates'];
  today: string;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const [userId, setUserId] = useState('');
  const [startOn, setStartOn] = useState(today);
  const [templateId, setTemplateId] = useState('');
  const [separationType, setSeparationType] = useState('voluntary');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const candidates = kind === 'onboarding' ? people : people.filter((p) => p.hrStatus !== 'Terminated');
  async function save() {
    setBusy(true);
    setError(null);
    try {
      const r = await hrFetch<{ id: string }>('/api/hr/checklists', {
        method: 'POST',
        json: { userId, kind, startOn, templateId: templateId || null, separationType: kind === 'offboarding' ? separationType : null },
      });
      onSaved(r.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={kind === 'onboarding' ? 'Start onboarding' : 'Start offboarding'}
      size="sm"
      onClose={onClose}
      dismissible={!busy}
      footer={
        <div className="flex justify-end gap-2 p-4">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button icon={<Plus />} loading={busy} onClick={save} disabled={!userId}>Create checklist</Button>
        </div>
      }
    >
      <div className="space-y-4 p-5">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {kind === 'onboarding' ? <Alert tone="info">New hires not in Altrixs yet: add them from People, New hire.</Alert> : null}
        <Labeled label="Staff member" required>
          <Select value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">Choose</option>
            {candidates.map((p) => <option key={p.userId} value={p.userId}>{p.name} ({roleLabel(p.role)})</option>)}
          </Select>
        </Labeled>
        <Labeled label={kind === 'onboarding' ? 'Start date' : 'Last day worked'} required>
          <TextInput type="date" value={startOn} onChange={(e) => setStartOn(e.target.value)} />
        </Labeled>
        {kind === 'offboarding' ? (
          <Labeled label="Separation type" hint="HR and leadership only.">
            <Select value={separationType} onChange={(e) => setSeparationType(e.target.value)}>
              <option value="voluntary">Voluntary (resignation)</option>
              <option value="involuntary">Involuntary</option>
              <option value="retirement">Retirement</option>
              <option value="end_of_contract">End of contract</option>
              <option value="other">Other</option>
            </Select>
          </Labeled>
        ) : null}
        <Labeled label="Template" hint="Default: a practice template for the role, or the standard list. Items apply by role (prescriber, licensed, clinical) and worker type.">
          <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
            <option value="">Automatic for the role</option>
            {templates.filter((t) => t.id).map((t) => <option key={t.id!} value={t.id!}>{t.name} ({t.itemCount} items)</option>)}
          </Select>
        </Labeled>
      </div>
    </Modal>
  );
}
