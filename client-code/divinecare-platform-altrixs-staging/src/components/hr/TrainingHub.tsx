'use client';

import { useMemo, useState } from 'react';
import { CheckCircle2, GraduationCap, ListChecks, Plus, Settings2 } from 'lucide-react';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  LoadingState,
  Modal,
  Page,
  PageHeader,
  StatCard,
  StatGrid,
  StatusBadge,
  Tabs,
} from '@/components/ui';
import { ExpiryBadge, Labeled, PersonLink, PolicyConfirm, ProgressBar, Select, TextInput } from './HrBits';
import { fmtDate, hrFetch, roleLabel, STAFF_ROLE_OPTIONS, useHrData } from './hrClient';

export type Requirement = { id: string; key: string; name: string; category: string; frequencyMonths: number | null; roles: string[]; dueWithinDaysOfHire: number | null; active: boolean; policyNote: string | null };
type Cell = { status: string; dueOn: string | null; lastCompletedOn: string | null };
export type Completion = { id: string; requirementId: string | null; title: string; completedOn: string; expiresOn: string | null; hours: number | null; ceuEligible: boolean; credentialId: string | null; provider: string | null; certificateNumber: string | null; status: string; source: string };
export type CeuRow = { credentialId: string; title: string; licenseType: string | null; required: number | null; earned: number; pct: number | null; cycleStart: string; cycleEnd: string; source: string };
export type TrainingRow = { userId: string; name: string; role: string; jobTitle: string; cells: Record<string, Cell>; compliancePct: number | null; ceu: CeuRow[]; completions: Completion[] };
type TrainingData = {
  today: string;
  requirements: Requirement[];
  rows: TrainingRow[];
  orgCompliancePct: number | null;
  pendingReview: Array<Completion & { userId: string; name: string }>;
};

const FREQ = (m: number | null) => (m == null ? 'One time' : m === 12 ? 'Annual' : m === 24 ? 'Every 2 years' : `Every ${m} months`);

export function TrainingHub() {
  const { data, error, loading, reload } = useHrData<TrainingData>('/api/hr/training');
  const [tab, setTab] = useState<'matrix' | 'ceu' | 'review' | 'requirements'>('matrix');
  const [record, setRecord] = useState<{ userId?: string; requirementId?: string } | null>(null);
  const [editReq, setEditReq] = useState<Requirement | 'new' | null>(null);
  const [roleFilter, setRoleFilter] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const active = (data?.requirements ?? []).filter((r) => r.active);
  const rows = (data?.rows ?? []).filter((r) => !roleFilter || r.role === roleFilter);
  const ceuRows = useMemo(() => (data?.rows ?? []).flatMap((r) => r.ceu.map((c) => ({ ...c, userId: r.userId, name: r.name }))), [data]);

  async function loadSuggested() {
    try {
      const r = await hrFetch<{ added: number }>('/api/hr/training/requirements', { method: 'POST', json: { action: 'load_suggested' } });
      setMsg(r.added ? `Added ${r.added} suggested trainings. Review the frequencies and roles; they are practice policy.` : 'All suggested trainings are already on the list.');
      reload();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not load');
    }
  }
  async function verify(id: string, decision: 'verified' | 'rejected') {
    await hrFetch(`/api/hr/training/completions/${id}`, { method: 'PATCH', json: { decision } }).catch((e) => setMsg(e.message));
    reload();
  }

  return (
    <Page width="full">
      <PageHeader
        eyebrow="HR"
        title="Training & CEUs"
        description="Required trainings by role, completions with certificates, and CEU hours per license renewal cycle."
        actions={<Button icon={<Plus />} onClick={() => setRecord({})}>Record completion</Button>}
      />
      {msg ? <Alert tone="info" actions={<Button size="sm" variant="ghost" onClick={() => setMsg(null)}>Dismiss</Button>}>{msg}</Alert> : null}
      {loading && !data ? <LoadingState rows={6} /> : null}
      {error && !data ? <ErrorState description={error} onRetry={reload} /> : null}
      {data ? (
        <>
          <StatGrid columns={4}>
            <StatCard label="Training compliance" value={data.orgCompliancePct == null ? 'No data' : `${data.orgCompliancePct}%`} hint="Required trainings current" icon={<CheckCircle2 />} tone={data.orgCompliancePct != null && data.orgCompliancePct < 90 ? 'warning' : 'success'} />
            <StatCard label="Required trainings" value={active.length} hint="Active requirements" icon={<ListChecks />} />
            <StatCard label="Waiting for review" value={data.pendingReview.length} hint="Self-reported by staff" icon={<GraduationCap />} tone={data.pendingReview.length ? 'warning' : 'neutral'} />
            <StatCard label="Licenses below CEU target" value={ceuRows.filter((c) => c.pct != null && c.pct < 100).length} hint={`${ceuRows.filter((c) => c.required == null).length} with no CEU target set`} icon={<GraduationCap />} />
          </StatGrid>
          <Tabs
            label="Training views"
            value={tab}
            onChange={setTab}
            items={[
              { key: 'matrix', label: 'Compliance matrix' },
              { key: 'ceu', label: 'CEUs by license' },
              { key: 'review', label: 'Waiting for review', count: data.pendingReview.length },
              { key: 'requirements', label: 'Requirements', count: active.length },
            ]}
          />
          {tab === 'matrix' ? (
            <Card>
              <CardHeader
                title="Who is current"
                actions={
                  <Select aria-label="Role" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} className="w-full sm:w-48">
                    <option value="">All roles</option>
                    {STAFF_ROLE_OPTIONS.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
                  </Select>
                }
              />
              <CardBody flush>
                {active.length === 0 ? (
                  <EmptyState
                    title="No required trainings yet"
                    description="Load the suggested list (HIPAA, Part 2, compliance, mandated reporter, de-escalation, CPR, suicide prevention, cultural competency) and adjust it to practice policy."
                    action={<Button onClick={loadSuggested}>Load suggested trainings</Button>}
                  />
                ) : (
                  <div className="clinic-scroll-x">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold text-slate-600">
                          <th scope="col" className="sticky left-0 z-10 bg-slate-50 px-4 py-2.5">Staff</th>
                          <th scope="col" className="px-3 py-2.5">Compliance</th>
                          {active.map((r) => <th key={r.id} scope="col" className="min-w-[130px] px-3 py-2.5">{r.name}<span className="block font-normal text-slate-500">{FREQ(r.frequencyMonths)}</span></th>)}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {rows.map((r) => (
                          <tr key={r.userId}>
                            <td className="sticky left-0 z-10 max-w-[14rem] bg-white px-4 py-2.5"><PersonLink userId={r.userId} name={r.name} sub={roleLabel(r.role)} /></td>
                            <td className="w-36 px-3 py-2.5">{r.compliancePct == null ? '—' : <ProgressBar pct={r.compliancePct} tone={r.compliancePct < 100 ? 'warning' : 'success'} label={`${r.name} compliance`} />}</td>
                            {active.map((req) => {
                              const c = r.cells[req.id];
                              return (
                                <td key={req.id} className="px-3 py-2.5">
                                  {c?.status === 'not_required' ? (
                                    <span className="text-xs text-slate-400">Not required</span>
                                  ) : (
                                    <button type="button" className="text-left" onClick={() => setRecord({ userId: r.userId, requirementId: req.id })} aria-label={`Record ${req.name} for ${r.name}`}>
                                      <ExpiryBadge size="sm" status={c?.status ?? 'missing'} dueOn={c?.dueOn} />
                                      <span className="mt-0.5 block text-[11px] text-slate-500">{c?.lastCompletedOn ? `Done ${fmtDate(c.lastCompletedOn)}` : c?.dueOn ? `Due ${fmtDate(c.dueOn)}` : ''}</span>
                                    </button>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardBody>
            </Card>
          ) : null}
          {tab === 'ceu' ? (
            <Card>
              <CardHeader title="CEU hours per license renewal cycle" description={<>Required hours come from the license record or the HR setting for the license type. <PolicyConfirm>Maryland board requirements: practice policy, confirm</PolicyConfirm></>} />
              <CardBody flush>
                {ceuRows.length === 0 ? (
                  <EmptyState compact title="No licenses on file" />
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {ceuRows.map((c) => (
                      <li key={c.credentialId} className="grid grid-cols-1 gap-2 px-5 py-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_220px] md:items-center">
                        <PersonLink userId={c.userId} name={c.name} sub={c.title} />
                        <span className="text-xs text-slate-600">Cycle {fmtDate(c.cycleStart)} to {fmtDate(c.cycleEnd)}</span>
                        {c.required == null ? (
                          <span className="text-xs text-amber-700">{c.earned} h earned · target not set</span>
                        ) : (
                          <div>
                            <ProgressBar pct={c.pct ?? 0} tone={(c.pct ?? 0) >= 100 ? 'success' : 'warning'} label={`${c.name} CEUs`} />
                            <span className="text-xs text-slate-500">{c.earned} of {c.required} h</span>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          ) : null}
          {tab === 'review' ? (
            <Card>
              <CardHeader title="Self-reported completions" description="Verify against the certificate before accepting." />
              <CardBody flush>
                {data.pendingReview.length === 0 ? (
                  <EmptyState compact title="Nothing to review" />
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {data.pendingReview.map((c) => (
                      <li key={c.id} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="text-sm font-medium text-slate-900">{c.name}: {c.title}</p>
                          <p className="text-xs text-slate-500">Completed {fmtDate(c.completedOn)}{c.hours ? ` · ${c.hours} h` : ''}{c.provider ? ` · ${c.provider}` : ''}</p>
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" onClick={() => verify(c.id, 'verified')}>Verify</Button>
                          <Button size="sm" variant="ghost" onClick={() => verify(c.id, 'rejected')}>Reject</Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          ) : null}
          {tab === 'requirements' ? (
            <Card>
              <CardHeader
                title="Required trainings"
                description={<>Frequencies and roles are practice policy. <PolicyConfirm /></>}
                actions={
                  <>
                    <Button size="sm" variant="secondary" onClick={loadSuggested}>Load suggested</Button>
                    <Button size="sm" icon={<Plus />} onClick={() => setEditReq('new')}>Add</Button>
                  </>
                }
              />
              <CardBody flush>
                {data.requirements.length === 0 ? (
                  <EmptyState compact title="None yet" />
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {data.requirements.map((r) => (
                      <li key={r.id} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="text-sm font-medium text-slate-900">{r.name} {r.active ? null : <StatusBadge size="sm">Inactive</StatusBadge>}</p>
                          <p className="text-xs text-slate-500">
                            {FREQ(r.frequencyMonths)} · {r.roles.length ? r.roles.map(roleLabel).join(', ') : 'Everyone'}
                            {r.dueWithinDaysOfHire != null ? ` · new hires within ${r.dueWithinDaysOfHire} days` : ''}
                            {r.policyNote ? ` · ${r.policyNote}` : ''}
                          </p>
                        </div>
                        <Button size="sm" variant="secondary" icon={<Settings2 />} onClick={() => setEditReq(r)}>Edit</Button>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          ) : null}
        </>
      ) : null}
      {record && data ? (
        <RecordCompletionModal
          people={data.rows.map((r) => ({ userId: r.userId, name: r.name, licenses: r.ceu.map((c) => ({ id: c.credentialId, title: c.title })) }))}
          requirements={active}
          initial={record}
          onClose={() => setRecord(null)}
          onSaved={() => {
            setRecord(null);
            reload();
          }}
        />
      ) : null}
      {editReq ? <RequirementModal req={editReq === 'new' ? null : editReq} onClose={() => setEditReq(null)} onSaved={() => { setEditReq(null); reload(); }} /> : null}
    </Page>
  );
}

/** Record a training / CEU completion. HR records verified; staff self-report (pending review). */
export function RecordCompletionModal({
  people,
  requirements,
  initial,
  selfOnly,
  onClose,
  onSaved,
}: {
  people: Array<{ userId: string; name: string; licenses: Array<{ id: string; title: string }> }>;
  requirements: Requirement[];
  initial: { userId?: string; requirementId?: string };
  selfOnly?: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [f, setF] = useState({
    userId: initial.userId || people[0]?.userId || '',
    requirementId: initial.requirementId || '',
    title: '',
    completedOn: new Date().toISOString().slice(0, 10),
    expiresOn: '',
    hours: '',
    ceuEligible: false,
    credentialId: '',
    provider: '',
    certificateNumber: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const licenses = people.find((p) => p.userId === f.userId)?.licenses ?? [];
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await hrFetch('/api/hr/training', {
        method: 'POST',
        json: {
          userId: f.userId,
          requirementId: f.requirementId || null,
          title: f.title || null,
          completedOn: f.completedOn,
          expiresOn: f.expiresOn || null,
          hours: f.hours ? Number(f.hours) : null,
          ceuEligible: f.ceuEligible,
          credentialId: f.ceuEligible && f.credentialId ? f.credentialId : null,
          provider: f.provider || null,
          certificateNumber: f.certificateNumber || null,
        },
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={selfOnly ? 'Add a training or CEU' : 'Record completion'}
      size="md"
      onClose={onClose}
      dismissible={!busy}
      footer={
        <div className="flex justify-end gap-2 p-4">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button loading={busy} onClick={save} disabled={!f.userId || (!f.requirementId && !f.title)}>{selfOnly ? 'Send to HR' : 'Save'}</Button>
        </div>
      }
    >
      <div className="space-y-4 p-5">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {selfOnly ? <Alert tone="info">HR verifies self-reported trainings against your certificate. Upload the certificate under Documents.</Alert> : null}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {!selfOnly ? (
            <Labeled label="Staff member">
              <Select value={f.userId} onChange={(e) => set('userId', e.target.value)}>
                {people.map((p) => <option key={p.userId} value={p.userId}>{p.name}</option>)}
              </Select>
            </Labeled>
          ) : null}
          <Labeled label="Required training">
            <Select value={f.requirementId} onChange={(e) => set('requirementId', e.target.value)}>
              <option value="">Other / CEU course</option>
              {requirements.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </Select>
          </Labeled>
          {!f.requirementId ? <Labeled label="Course title" required><TextInput value={f.title} onChange={(e) => set('title', e.target.value)} /></Labeled> : null}
          <Labeled label="Completed on" required><TextInput type="date" value={f.completedOn} onChange={(e) => set('completedOn', e.target.value)} /></Labeled>
          <Labeled label="Expires" hint="Blank: from the training frequency"><TextInput type="date" value={f.expiresOn} onChange={(e) => set('expiresOn', e.target.value)} /></Labeled>
          <Labeled label="Hours"><TextInput type="number" min={0} step={0.25} value={f.hours} onChange={(e) => set('hours', e.target.value)} /></Labeled>
          <Labeled label="Provider"><TextInput value={f.provider} onChange={(e) => set('provider', e.target.value)} /></Labeled>
          <Labeled label="Certificate number"><TextInput value={f.certificateNumber} onChange={(e) => set('certificateNumber', e.target.value)} /></Labeled>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.ceuEligible} onChange={(e) => set('ceuEligible', e.target.checked)} /> Counts toward license CEUs
        </label>
        {f.ceuEligible && licenses.length ? (
          <Labeled label="License">
            <Select value={f.credentialId} onChange={(e) => set('credentialId', e.target.value)}>
              <option value="">Any license</option>
              {licenses.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}
            </Select>
          </Labeled>
        ) : null}
      </div>
    </Modal>
  );
}

function RequirementModal({ req, onClose, onSaved }: { req: Requirement | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    name: req?.name ?? '',
    category: req?.category ?? 'compliance',
    frequencyMonths: req?.frequencyMonths == null ? '' : String(req.frequencyMonths),
    roles: req?.roles ?? ([] as string[]),
    dueWithinDaysOfHire: req?.dueWithinDaysOfHire == null ? '' : String(req.dueWithinDaysOfHire),
    active: req?.active ?? true,
    policyNote: req?.policyNote ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setBusy(true);
    try {
      await hrFetch('/api/hr/training/requirements', {
        method: 'PUT',
        json: {
          id: req?.id ?? null,
          name: f.name,
          category: f.category,
          frequencyMonths: f.frequencyMonths ? Number(f.frequencyMonths) : null,
          roles: f.roles,
          dueWithinDaysOfHire: f.dueWithinDaysOfHire ? Number(f.dueWithinDaysOfHire) : null,
          active: f.active,
          policyNote: f.policyNote || null,
        },
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={req ? 'Edit required training' : 'Add required training'}
      size="md"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2 p-4">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={busy} onClick={save} disabled={!f.name}>Save</Button>
        </div>
      }
    >
      <div className="space-y-4 p-5">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Labeled label="Name" required><TextInput value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Labeled>
          <Labeled label="Category">
            <Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
              {['compliance', 'clinical', 'safety', 'other'].map((c) => <option key={c}>{c}</option>)}
            </Select>
          </Labeled>
          <Labeled label="Every (months)" hint="Blank = one time"><TextInput type="number" min={1} value={f.frequencyMonths} onChange={(e) => setF({ ...f, frequencyMonths: e.target.value })} /></Labeled>
          <Labeled label="New hires complete within (days)"><TextInput type="number" min={0} value={f.dueWithinDaysOfHire} onChange={(e) => setF({ ...f, dueWithinDaysOfHire: e.target.value })} /></Labeled>
        </div>
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-slate-700">Required for (none checked = everyone)</legend>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {STAFF_ROLE_OPTIONS.map((r) => (
              <label key={r} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={f.roles.includes(r)} onChange={(e) => setF({ ...f, roles: e.target.checked ? [...f.roles, r] : f.roles.filter((x) => x !== r) })} />
                {roleLabel(r)}
              </label>
            ))}
          </div>
        </fieldset>
        <Labeled label="Policy note"><TextInput value={f.policyNote} onChange={(e) => setF({ ...f, policyNote: e.target.value })} /></Labeled>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Active
        </label>
      </div>
    </Modal>
  );
}
