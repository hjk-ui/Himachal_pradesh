'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ExternalLink, ShieldCheck } from 'lucide-react';
import { Alert, Button, Card, CardBody, CardHeader, EmptyState, ErrorState, LoadingState, Modal, Page, PageHeader, StatCard, StatGrid, StatusBadge, Tabs } from '@/components/ui';
import { ExpiryBadge, FILTER_SELECT, FilterBar, Labeled, SearchField, Select, TextArea, TextInput } from './HrBits';
import { fmtDate, hrFetch, titleCase, useHrData } from './hrClient';
import { CredentialRegistry } from './CredentialRegistry';

type View = 'expirations' | 'exclusions' | 'registry' | 'payers';
type Item = { key: string; source: string; userId: string; staffName: string; category: string; label: string; dueOn: string | null; status: string; daysLeft: number | null; href: string };

export function CredentialingHub() {
  const params = useSearchParams();
  const router = useRouter();
  const [view, setView] = useState<View>((params.get('view') as View) || 'expirations');
  const change = (v: View) => {
    setView(v);
    router.replace(`/dashboard/hr/credentialing?view=${v}`, { scroll: false });
  };
  return (
    <Page width="full">
      <PageHeader
        eyebrow="HR"
        title="Credentialing & compliance"
        description="Licenses, DEA / CDS, board certification, malpractice, CAQH, Maryland Medicaid, exclusion screening and health compliance, with one expiration status for everything."
      />
      <Tabs
        label="Credentialing views"
        value={view}
        onChange={change}
        items={[
          { key: 'expirations', label: 'Expirations' },
          { key: 'exclusions', label: 'Exclusion checks' },
          { key: 'registry', label: 'Credential registry' },
          { key: 'payers', label: 'Payer enrollment' },
        ]}
      />
      {view === 'expirations' ? <Expirations /> : null}
      {view === 'exclusions' ? <Exclusions /> : null}
      {view === 'registry' ? <CredentialRegistry initialTab="credentials" /> : null}
      {view === 'payers' ? <CredentialRegistry initialTab="payer_intake" /> : null}
    </Page>
  );
}

function Expirations() {
  const [all, setAll] = useState(false);
  const { data, error, loading, reload } = useHrData<{ items: Item[]; summary: Record<string, number>; today: string }>(`/api/hr/expirations${all ? '?all=1' : ''}`);
  const [source, setSource] = useState('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  if (loading && !data) return <LoadingState rows={6} />;
  if (error && !data) return <ErrorState description={error} onRetry={reload} />;
  if (!data) return null;
  const rows = data.items.filter((i) => i.source !== 'exclusion' && (!source || i.source === source) && (!status || i.status === status) && (!q || `${i.staffName} ${i.label}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <div className="space-y-6">
      <StatGrid columns={4}>
        <StatCard label="Expired" value={data.summary.expired ?? 0} tone={data.summary.expired ? 'danger' : 'success'} icon={<ShieldCheck />} />
        <StatCard label="Missing" value={data.summary.missing ?? 0} tone={data.summary.missing ? 'danger' : 'success'} />
        <StatCard label="Due within 30 days" value={data.summary.due30 ?? 0} tone={data.summary.due30 ? 'warning' : 'success'} />
        <StatCard label="Due within 60 days" value={data.summary.due60 ?? 0} />
      </StatGrid>
      <Card>
        <CardHeader title="All dated items" />
        <div className="border-b border-slate-100 px-5 py-3">
          <FilterBar>
              <SearchField label="Search dated items" placeholder="Search staff or item" value={q} onChange={setQ} />
              <Select aria-label="Type" value={source} onChange={(e) => setSource(e.target.value)} className={FILTER_SELECT}>
                <option value="">All types</option>
                {['credential', 'compliance', 'caqh', 'training', 'document', 'checklist', 'review'].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
              </Select>
              <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className={FILTER_SELECT}>
                <option value="">Any status</option>
                {['expired', 'missing', 'due_30', 'due_60', 'current'].map((s) => <option key={s} value={s}>{titleCase(s.replace('due_', 'due '))}</option>)}
              </Select>
              <label className="flex min-h-10 items-center gap-1.5 text-sm"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Include current</label>
          </FilterBar>
        </div>
        <CardBody flush>
          {rows.length === 0 ? (
            <EmptyState compact title="Nothing matches" />
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
                  {rows.map((i) => (
                    <tr key={i.key} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5"><Link className="font-medium text-slate-900 hover:text-blue-700" href={`/dashboard/hr/people/${i.userId}?tab=credentials`}>{i.staffName}</Link></td>
                      <td className="px-4 py-2.5"><Link className="hover:text-blue-700" href={i.href}>{i.label}</Link></td>
                      <td className="hidden px-4 py-2.5 text-slate-600 md:table-cell">{i.category}</td>
                      <td className="whitespace-nowrap px-4 py-2.5">{fmtDate(i.dueOn)}</td>
                      <td className="px-4 py-2.5"><ExpiryBadge size="sm" status={i.status} dueOn={i.dueOn} daysLeft={i.daysLeft} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

type SourceCell = { lastCheckedOn: string | null; result: string | null; checkedByName: string | null; dueOn: string; status: string };
type ExclusionData = {
  rows: Array<{ userId: string; name: string; jobTitle: string; sources: Record<string, SourceCell> }>;
  today: string;
  intervalDays: number;
  sources: Array<{ key: string; label: string; description: string; url: string }>;
  automation: string;
};

function Exclusions() {
  const { data, error, loading, reload } = useHrData<ExclusionData>('/api/hr/exclusions');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [recording, setRecording] = useState<null | { userIds: string[]; single: boolean }>(null);
  if (loading && !data) return <LoadingState rows={6} />;
  if (error && !data) return <ErrorState description={error} onRetry={reload} />;
  if (!data) return null;
  const due = data.rows.filter((r) => Object.values(r.sources).some((s) => s.status !== 'current'));
  const tone = (s: string) => (s === 'current' ? 'success' : s === 'due_soon' ? 'warning' : 'danger');
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <div className="space-y-6">
      <Alert tone="info" title={`Monthly screening (every ${data.intervalDays} days)`}>
        Search each list, then record the result here with the date. {data.automation}
        <span className="mt-2 flex flex-wrap gap-3">
          {data.sources.map((s) => (
            <a key={s.key} href={s.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-blue-700 hover:underline">
              {s.label} <ExternalLink className="h-3 w-3" aria-hidden />
            </a>
          ))}
        </span>
      </Alert>
      <Card>
        <CardHeader
          title={`${due.length} of ${data.rows.length} staff due`}
          actions={
            <>
              <Button size="sm" variant="secondary" onClick={() => setSelected(new Set(due.map((r) => r.userId)))}>Select all due</Button>
              <Button size="sm" disabled={!selected.size} onClick={() => setRecording({ userIds: [...selected], single: false })}>Record clear results ({selected.size})</Button>
            </>
          }
        />
        <CardBody flush>
          <div className="clinic-scroll-x">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold text-slate-600">
                  <th scope="col" className="w-10 px-4 py-2.5"><span className="sr-only">Select</span></th>
                  <th scope="col" className="sticky left-0 z-10 bg-slate-50 px-4 py-2.5">Staff</th>
                  {data.sources.map((s) => <th key={s.key} scope="col" className="px-4 py-2.5">{s.label}</th>)}
                  <th scope="col" className="px-4 py-2.5"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.rows.map((r) => (
                  <tr key={r.userId}>
                    <td className="px-4 py-2.5"><input type="checkbox" aria-label={`Select ${r.name}`} checked={selected.has(r.userId)} onChange={() => toggle(r.userId)} /></td>
                    <td className="sticky left-0 z-10 bg-white px-4 py-2.5"><Link className="font-medium text-slate-900 hover:text-blue-700" href={`/dashboard/hr/people/${r.userId}?tab=credentials`}>{r.name}</Link><span className="block text-xs text-slate-500">{r.jobTitle}</span></td>
                    {data.sources.map((s) => {
                      const c = r.sources[s.key];
                      return (
                        <td key={s.key} className="px-4 py-2.5">
                          <StatusBadge size="sm" tone={c.result && c.result !== 'clear' ? 'danger' : tone(c.status)}>
                            {c.result && c.result !== 'clear' ? titleCase(c.result) : c.status === 'never' ? 'Never checked' : c.status === 'overdue' ? 'Overdue' : c.status === 'due_soon' ? 'Due soon' : 'Current'}
                          </StatusBadge>
                          <span className="block text-[11px] text-slate-500">{c.lastCheckedOn ? `Last ${fmtDate(c.lastCheckedOn)}` : ''}{c.checkedByName ? ` · ${c.checkedByName}` : ''}</span>
                        </td>
                      );
                    })}
                    <td className="px-4 py-2.5 text-right"><Button size="sm" variant="ghost" onClick={() => setRecording({ userIds: [r.userId], single: true })}>Record</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>
      {recording ? (
        <RecordExclusionModal
          userIds={recording.userIds}
          single={recording.single}
          sources={data.sources}
          today={data.today}
          names={data.rows.filter((r) => recording.userIds.includes(r.userId)).map((r) => r.name)}
          onClose={() => setRecording(null)}
          onSaved={() => {
            setRecording(null);
            setSelected(new Set());
            reload();
          }}
        />
      ) : null}
    </div>
  );
}

function RecordExclusionModal({ userIds, single, sources, today, names, onClose, onSaved }: { userIds: string[]; single: boolean; sources: ExclusionData['sources']; today: string; names: string[]; onClose: () => void; onSaved: () => void }) {
  const [checked, setChecked] = useState<string[]>(sources.map((s) => s.key));
  const [checkedOn, setCheckedOn] = useState(today);
  const [result, setResult] = useState('clear');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await hrFetch('/api/hr/exclusions', { method: 'POST', json: { userIds, sources: checked, checkedOn, result, reference: reference || null, notes: notes || null } });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={single ? `Exclusion check: ${names[0] ?? ''}` : `Record clear results for ${userIds.length} staff`}
      size="md"
      onClose={onClose}
      dismissible={!busy}
      footer={
        <div className="flex justify-end gap-2 p-4">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button loading={busy} onClick={save} disabled={!checked.length}>Save</Button>
        </div>
      }
    >
      <div className="space-y-4 p-5">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {!single ? <p className="text-sm text-slate-600">{names.slice(0, 12).join(', ')}{names.length > 12 ? ` and ${names.length - 12} more` : ''}</p> : null}
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-slate-700">Lists searched</legend>
          {sources.map((s) => (
            <label key={s.key} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={checked.includes(s.key)} onChange={(e) => setChecked(e.target.checked ? [...checked, s.key] : checked.filter((x) => x !== s.key))} />
              {s.label}
            </label>
          ))}
        </fieldset>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Labeled label="Date searched"><TextInput type="date" value={checkedOn} onChange={(e) => setCheckedOn(e.target.value)} /></Labeled>
          <Labeled label="Result">
            <Select value={result} onChange={(e) => setResult(e.target.value)} disabled={!single}>
              <option value="clear">Clear (no match)</option>
              <option value="possible_match">Possible match (needs review)</option>
              <option value="match">Confirmed match</option>
            </Select>
          </Labeled>
        </div>
        {result !== 'clear' ? <Alert tone="danger">A match must be reviewed with leadership and compliance right away. Excluded individuals cannot bill federal health care programs.</Alert> : null}
        <Labeled label="Reference" hint="e.g. search confirmation or screenshot file name kept in the compliance folder"><TextInput value={reference} onChange={(e) => setReference(e.target.value)} /></Labeled>
        <Labeled label="Notes"><TextArea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Labeled>
      </div>
    </Modal>
  );
}
