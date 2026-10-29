'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Download, Sparkles, UserPlus } from 'lucide-react';
import { Alert, Button, Card, DataTable, Modal, Page, PageHeader, StatusBadge, type DataTableColumn } from '@/components/ui';
import { FILTER_SELECT, FilterBar, Labeled, PersonLink, SearchField, Select, TextInput } from './HrBits';
import { fmtDate, hrFetch, PROGRAM_OPTIONS, roleLabel, STAFF_ROLE_OPTIONS, useHrData } from './hrClient';
import { AiWritingModal } from './AiWritingModal';

type Person = {
  userId: string;
  name: string;
  email: string;
  role: string;
  accountStatus: string;
  credentials: string | null;
  jobTitle: string;
  department: string;
  programs: string[];
  employmentType: string;
  workerType: string | null;
  hrStatus: string;
  hireDate: string | null;
  managerName: string | null;
  locationNames: string[];
  hasProfile: boolean;
  attention: { expired: number; due: number };
};

export function PeopleList() {
  const params = useSearchParams();
  const router = useRouter();
  const [former, setFormer] = useState(false);
  const { data, error, loading, reload } = useHrData<{ people: Person[]; canEdit: boolean }>(`/api/hr/people${former ? '?former=1' : ''}`);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [location, setLocation] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [showWriting, setShowWriting] = useState(false);

  useEffect(() => {
    if (params.get('new') === '1') setShowNew(true);
  }, [params]);

  const people = useMemo(() => data?.people ?? [], [data]);
  const locations = useMemo(() => [...new Set(people.flatMap((p) => p.locationNames))].sort(), [people]);
  const filtered = people.filter((p) => {
    const hay = `${p.name} ${p.email} ${p.jobTitle} ${p.department} ${p.role} ${p.programs.join(' ')}`.toLowerCase();
    return (!q || hay.includes(q.toLowerCase())) && (!status || p.hrStatus === status) && (!location || p.locationNames.includes(location));
  });

  function exportCsv() {
    const header = ['Name', 'Email', 'Title', 'Role', 'Department', 'Programs', 'Locations', 'Status', 'Hire date', 'Manager'];
    const lines = filtered.map((p) =>
      [p.name, p.email, p.jobTitle, roleLabel(p.role), p.department, p.programs.join('; '), p.locationNames.join('; '), p.hrStatus, p.hireDate ?? '', p.managerName ?? '']
        .map((v) => `"${String(v).replaceAll('"', '""')}"`)
        .join(','),
    );
    const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'staff-directory.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const columns: DataTableColumn<Person>[] = [
    { key: 'name', header: 'Name', cell: (p) => <PersonLink userId={p.userId} name={p.name} sub={[p.jobTitle || roleLabel(p.role), p.credentials].filter(Boolean).join(' · ')} /> },
    { key: 'role', header: 'Role', hideOnMobile: true, cell: (p) => roleLabel(p.role) },
    { key: 'loc', header: 'Location / program', hideOnMobile: true, cell: (p) => <span className="text-xs text-slate-600">{[p.locationNames.join(', '), p.programs.join(', ')].filter(Boolean).join(' · ') || '—'}</span> },
    { key: 'status', header: 'Status', cell: (p) => <StatusBadge tone={p.hrStatus === 'Active' ? 'success' : p.hrStatus === 'Terminated' ? 'neutral' : p.hrStatus === 'Offboarding' ? 'warning' : 'info'}>{p.hrStatus}</StatusBadge> },
    { key: 'hire', header: 'Hire date', hideOnMobile: true, cell: (p) => fmtDate(p.hireDate) },
    {
      key: 'attention',
      header: 'Compliance',
      cell: (p) =>
        p.attention.expired ? (
          <StatusBadge tone="danger" dot>{p.attention.expired} expired / missing</StatusBadge>
        ) : p.attention.due ? (
          <StatusBadge tone="warning" dot>{p.attention.due} due soon</StatusBadge>
        ) : (
          <StatusBadge tone="success" dot>Current</StatusBadge>
        ),
    },
  ];

  return (
    <Page>
      <PageHeader
        eyebrow="HR"
        title="People"
        description="Every staff member's employee record: personal, employment, credentials, documents, training, time off and performance."
        actions={
          <>
            <Button variant="secondary" icon={<Download />} onClick={exportCsv}>Export</Button>
            {data?.canEdit ? (
              <>
                <Button variant="secondary" icon={<Sparkles />} onClick={() => setShowWriting(true)}>Draft job posting / offer</Button>
                <Button icon={<UserPlus />} onClick={() => setShowNew(true)}>New hire</Button>
              </>
            ) : null}
          </>
        }
      >
        <FilterBar>
          <SearchField label="Search staff" placeholder="Search name, title, program" value={q} onChange={setQ} />
          <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className={FILTER_SELECT}>
            <option value="">All statuses</option>
            {['Active', 'Onboarding', 'On Leave', 'Offboarding', 'Terminated'].map((s) => <option key={s}>{s}</option>)}
          </Select>
          <Select aria-label="Location" value={location} onChange={(e) => setLocation(e.target.value)} className={FILTER_SELECT}>
            <option value="">All locations</option>
            {locations.map((l) => <option key={l}>{l}</option>)}
          </Select>
          <label className="flex min-h-10 items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={former} onChange={(e) => setFormer(e.target.checked)} /> Former staff
          </label>
        </FilterBar>
      </PageHeader>
      <Card>
        <DataTable columns={columns} rows={filtered} rowKey={(p) => p.userId} loading={loading} error={error} onRetry={reload} empty="No staff match" caption="Staff" />
      </Card>
      {showNew ? (
        <NewHireModal
          people={people}
          onClose={() => {
            setShowNew(false);
            if (params.get('new')) router.replace('/dashboard/hr/people');
          }}
          onCreated={(id) => router.push(`/dashboard/hr/people/${id}`)}
        />
      ) : null}
      {showWriting ? <AiWritingModal onClose={() => setShowWriting(false)} /> : null}
    </Page>
  );
}

function NewHireModal({ people, onClose, onCreated }: { people: Person[]; onClose: () => void; onCreated: (id: string) => void }) {
  const [f, setF] = useState({
    name: '',
    email: '',
    role: 'THERAPIST',
    jobTitle: '',
    department: 'Clinical',
    employmentType: 'Full-Time',
    workerType: 'W2',
    hireDate: '',
    managerUserId: '',
    programs: [] as string[],
    sendInvite: true,
    startOnboarding: true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const r = await hrFetch<{ userId: string }>('/api/hr/people', {
        method: 'POST',
        json: { ...f, hireDate: f.hireDate || null, managerUserId: f.managerUserId || null },
      });
      onCreated(r.userId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="New hire"
      size="md"
      onClose={onClose}
      dismissible={!busy}
      footer={
        <div className="flex justify-end gap-2 p-4">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button loading={busy} onClick={save} disabled={!f.name || !f.email || !f.jobTitle}>Add new hire</Button>
        </div>
      }
    >
      <div className="space-y-4 p-5">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Labeled label="Full name" required><TextInput value={f.name} onChange={(e) => set('name', e.target.value)} /></Labeled>
          <Labeled label="Work email" required><TextInput type="email" value={f.email} onChange={(e) => set('email', e.target.value)} /></Labeled>
          <Labeled label="Altrixs role" required>
            <Select value={f.role} onChange={(e) => set('role', e.target.value)}>
              {STAFF_ROLE_OPTIONS.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
            </Select>
          </Labeled>
          <Labeled label="Job title" required><TextInput value={f.jobTitle} onChange={(e) => set('jobTitle', e.target.value)} /></Labeled>
          <Labeled label="Department"><TextInput value={f.department} onChange={(e) => set('department', e.target.value)} /></Labeled>
          <Labeled label="Start date"><TextInput type="date" value={f.hireDate} onChange={(e) => set('hireDate', e.target.value)} /></Labeled>
          <Labeled label="Employment">
            <Select value={f.employmentType} onChange={(e) => set('employmentType', e.target.value)}>
              {['Full-Time', 'Part-Time', 'Per Diem', 'Contract'].map((x) => <option key={x}>{x}</option>)}
            </Select>
          </Labeled>
          <Labeled label="Worker type">
            <Select value={f.workerType} onChange={(e) => set('workerType', e.target.value)}>
              <option value="W2">W-2</option>
              <option value="1099">1099</option>
              <option value="PER_DIEM">Per diem</option>
            </Select>
          </Labeled>
          <Labeled label="Manager">
            <Select value={f.managerUserId} onChange={(e) => set('managerUserId', e.target.value)}>
              <option value="">Not set</option>
              {people.map((p) => <option key={p.userId} value={p.userId}>{p.name}</option>)}
            </Select>
          </Labeled>
        </div>
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-slate-700">Programs</legend>
          <div className="flex flex-wrap gap-3">
            {PROGRAM_OPTIONS.map((p) => (
              <label key={p} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={f.programs.includes(p)} onChange={(e) => set('programs', e.target.checked ? [...f.programs, p] : f.programs.filter((x) => x !== p))} />
                {p}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5" checked={f.sendInvite} onChange={(e) => set('sendInvite', e.target.checked)} />
          <span>Send Altrixs invite (they set their own password from the email)</span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5" checked={f.startOnboarding} onChange={(e) => set('startOnboarding', e.target.checked)} />
          <span>Start the onboarding checklist for this role (also schedules the 90-day review)</span>
        </label>
      </div>
    </Modal>
  );
}
