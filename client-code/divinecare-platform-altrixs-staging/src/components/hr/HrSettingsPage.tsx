'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Plus, Save, Sparkles, Trash2 } from 'lucide-react';
import { Alert, Button, Card, CardBody, CardFooter, CardHeader, EmptyState, ErrorState, LoadingState, Page, PageHeader, StatusBadge, Tabs } from '@/components/ui';
import { Labeled, PolicyConfirm, ProgressBar, Select, TextArea, TextInput } from './HrBits';
import { fmtDate, fmtDateTime, hrFetch, roleLabel, STAFF_ROLE_OPTIONS, titleCase, useHrData } from './hrClient';

type Settings = {
  blockSchedulingWhenLicenseExpired: boolean;
  dueSoonDays: number;
  urgentDays: number;
  caqhAttestationDays: number;
  exclusionCheckIntervalDays: number;
  sickAccrualHoursWorked: number | null;
  sickAnnualAccrualCap: number | null;
  sickBalanceCap: number | null;
  sickAnnualUsageCap: number | null;
  ptoPolicy: { hoursPerPeriod?: number | null; periodsPerYear?: number | null; balanceCap?: number | null } | null;
  ceuRequirements: Record<string, { hours?: number | null; cycleMonths?: number | null }>;
  immunizationPolicy: { fluRoles?: string[]; hepBRoles?: string[]; tbRoles?: string[]; tbIntervalMonths?: number | null };
  cprRequiredRoles: string[];
  i9StoreDocumentImages: boolean;
  aiDocumentExtract: boolean;
  aiWritingDrafts: boolean;
  aiReviewAssistant: boolean;
  aiPolicyQa: boolean;
  aiDigest: boolean;
  policyConfirmedAt: string | null;
};
type SettingsData = {
  settings: Settings;
  canEdit: boolean;
  canEditLeadershipSettings: boolean;
  aiFeatures: Array<{ key: keyof Settings; label: string; description: string }>;
  bedrockConfigured: boolean;
  licenseTypes: Array<{ code: string; label: string; level: string }>;
};

const num = (v: string) => (v.trim() === '' ? null : Number(v));
const str = (v: number | null | undefined) => (v == null ? '' : String(v));

export function HrSettingsPage() {
  const params = useSearchParams();
  const [view, setView] = useState<'policy' | 'ai' | 'templates' | 'policies'>((params.get('view') as 'templates') || 'policy');
  return (
    <Page>
      <PageHeader eyebrow="HR" title="HR settings" description="Practice HR policy, AI features, onboarding / offboarding templates and the employee handbook." />
      <Tabs
        label="Settings sections"
        value={view}
        onChange={setView}
        items={[
          { key: 'policy', label: 'Policy settings' },
          { key: 'ai', label: 'AI features' },
          { key: 'templates', label: 'Checklist templates' },
          { key: 'policies', label: 'Handbook & policies' },
        ]}
      />
      {view === 'policy' || view === 'ai' ? <SettingsForm view={view} /> : null}
      {view === 'templates' ? <TemplatesEditor /> : null}
      {view === 'policies' ? <PoliciesAdmin /> : null}
    </Page>
  );
}

function RoleChecks({ value, onChange, disabled }: { value: string[]; onChange: (v: string[]) => void; disabled?: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
      {STAFF_ROLE_OPTIONS.map((r) => (
        <label key={r} className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" disabled={disabled} checked={value.includes(r)} onChange={(e) => onChange(e.target.checked ? [...value, r] : value.filter((x) => x !== r))} />
          {roleLabel(r)}
        </label>
      ))}
    </div>
  );
}

function SettingsForm({ view }: { view: 'policy' | 'ai' }) {
  const { data, error, loading, reload } = useHrData<SettingsData>('/api/hr/settings');
  const [s, setS] = useState<Settings | null>(null);
  const [ceuDraft, setCeuDraft] = useState<Record<string, { hours: string; cycleMonths: string }>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  useEffect(() => {
    if (data) {
      setS(data.settings);
      const d: Record<string, { hours: string; cycleMonths: string }> = {};
      for (const lt of data.licenseTypes) d[lt.code] = { hours: str(data.settings.ceuRequirements[lt.code]?.hours), cycleMonths: str(data.settings.ceuRequirements[lt.code]?.cycleMonths) };
      setCeuDraft(d);
    }
  }, [data]);
  if (loading && !data) return <LoadingState rows={6} />;
  if (error && !data) return <ErrorState description={error} onRetry={reload} />;
  if (!data || !s) return null;
  const edit = data.canEdit;
  const lead = data.canEditLeadershipSettings;
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS({ ...s, [k]: v });

  async function save(extra: Record<string, unknown> = {}) {
    if (!s) return;
    setBusy(true);
    setMsg(null);
    try {
      const ceu: Record<string, { hours: number | null; cycleMonths: number | null }> = {};
      for (const [k, v] of Object.entries(ceuDraft)) if (v.hours || v.cycleMonths) ceu[k] = { hours: num(v.hours), cycleMonths: num(v.cycleMonths) };
      const body: Record<string, unknown> =
        view === 'ai'
          ? { aiDocumentExtract: s.aiDocumentExtract, aiWritingDrafts: s.aiWritingDrafts, aiReviewAssistant: s.aiReviewAssistant, aiPolicyQa: s.aiPolicyQa, aiDigest: s.aiDigest }
          : {
              dueSoonDays: s.dueSoonDays,
              urgentDays: s.urgentDays,
              caqhAttestationDays: s.caqhAttestationDays,
              exclusionCheckIntervalDays: s.exclusionCheckIntervalDays,
              sickAccrualHoursWorked: s.sickAccrualHoursWorked,
              sickAnnualAccrualCap: s.sickAnnualAccrualCap,
              sickBalanceCap: s.sickBalanceCap,
              sickAnnualUsageCap: s.sickAnnualUsageCap,
              ptoPolicy: s.ptoPolicy,
              ceuRequirements: ceu,
              immunizationPolicy: s.immunizationPolicy,
              cprRequiredRoles: s.cprRequiredRoles,
              ...(lead ? { blockSchedulingWhenLicenseExpired: s.blockSchedulingWhenLicenseExpired, i9StoreDocumentImages: s.i9StoreDocumentImages } : {}),
            };
      await hrFetch('/api/hr/settings', { method: 'PUT', json: { ...body, ...extra } });
      setMsg({ tone: 'success', text: 'Saved.' });
      reload();
    } catch (e) {
      setMsg({ tone: 'danger', text: e instanceof Error ? e.message : 'Could not save' });
    } finally {
      setBusy(false);
    }
  }

  if (view === 'ai') {
    return (
      <Card>
        <CardHeader title="AI features" icon={<Sparkles />} description="Each feature is off until leadership turns it on. AI runs on AWS Bedrock under the practice BAA, sees staff data only (never client PHI), returns drafts a person must review, and every use is logged in the audit log." />
        <CardBody className="space-y-4">
          {!data.bedrockConfigured ? <Alert tone="warning">Bedrock is not configured on this server: features fall back to rules-based templates and text matching.</Alert> : null}
          {!lead ? <Alert tone="info">Only leadership (administrator, director, practice director) can change AI features.</Alert> : null}
          {data.aiFeatures.map((f) => (
            <label key={String(f.key)} className="flex items-start gap-3 rounded-lg border border-slate-200 p-3">
              <input type="checkbox" className="mt-1" disabled={!lead} checked={Boolean(s[f.key])} onChange={(e) => set(f.key, e.target.checked as never)} />
              <span>
                <span className="block text-sm font-medium text-slate-900">{f.label}</span>
                <span className="block text-xs text-slate-600">{f.description}</span>
              </span>
            </label>
          ))}
        </CardBody>
        {lead ? (
          <CardFooter>
            {msg ? <span className={msg.tone === 'success' ? 'text-sm text-emerald-700' : 'text-sm text-rose-700'}>{msg.text}</span> : null}
            <Button icon={<Save />} loading={busy} onClick={() => save()}>Save</Button>
          </CardFooter>
        ) : null}
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {msg ? <Alert tone={msg.tone}>{msg.text}</Alert> : null}
      <Alert tone={s.policyConfirmedAt ? 'success' : 'warning'} title={s.policyConfirmedAt ? `Policy confirmed ${fmtDateTime(s.policyConfirmedAt)}` : 'Practice policy not confirmed yet'}>
        Numbers marked &ldquo;practice policy, confirm&rdquo; come from regulations or practice choices that Altrixs does not hard-code. Review them with counsel / payroll and confirm.
        {lead && !s.policyConfirmedAt ? <div className="mt-2"><Button size="sm" onClick={() => save({ confirmPolicy: true })}>Confirm these settings</Button></div> : null}
      </Alert>
      <Card>
        <CardHeader title="Expirations and screening" />
        <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Labeled label="Due soon window (days)"><TextInput type="number" disabled={!edit} value={s.dueSoonDays} onChange={(e) => set('dueSoonDays', Number(e.target.value))} /></Labeled>
          <Labeled label="Urgent window (days)"><TextInput type="number" disabled={!edit} value={s.urgentDays} onChange={(e) => set('urgentDays', Number(e.target.value))} /></Labeled>
          <Labeled label="CAQH re-attestation every (days)" hint="CAQH ProView cycle is 120 days."><TextInput type="number" disabled={!edit} value={s.caqhAttestationDays} onChange={(e) => set('caqhAttestationDays', Number(e.target.value))} /></Labeled>
          <Labeled label="Exclusion checks every (days)" hint={<>Monthly OIG / SAM.gov / Maryland Medicaid screening. <PolicyConfirm /></>}><TextInput type="number" disabled={!edit} value={s.exclusionCheckIntervalDays} onChange={(e) => set('exclusionCheckIntervalDays', Number(e.target.value))} /></Labeled>
          <label className="flex items-start gap-2 text-sm sm:col-span-2">
            <input type="checkbox" className="mt-0.5" disabled={!lead} checked={s.blockSchedulingWhenLicenseExpired} onChange={(e) => set('blockSchedulingWhenLicenseExpired', e.target.checked)} />
            <span>
              <span className="font-medium">Block scheduling when a clinician&apos;s license is expired</span>
              <span className="block text-xs text-slate-500">Off by default: HR and leadership see a warning on scheduling and billing instead. Leadership only.</span>
            </span>
          </label>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Sick and safe leave (Maryland Healthy Working Families Act)" description={<PolicyConfirm />} />
        <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Labeled label="1 hour of sick leave per N hours worked" hint="HWFA default is 30."><TextInput type="number" disabled={!edit} value={str(s.sickAccrualHoursWorked)} onChange={(e) => set('sickAccrualHoursWorked', num(e.target.value))} /></Labeled>
          <Labeled label="Annual accrual cap (hours)" hint="Blank = none set"><TextInput type="number" disabled={!edit} value={str(s.sickAnnualAccrualCap)} onChange={(e) => set('sickAnnualAccrualCap', num(e.target.value))} /></Labeled>
          <Labeled label="Balance cap (hours)"><TextInput type="number" disabled={!edit} value={str(s.sickBalanceCap)} onChange={(e) => set('sickBalanceCap', num(e.target.value))} /></Labeled>
          <Labeled label="Annual usage cap (hours)"><TextInput type="number" disabled={!edit} value={str(s.sickAnnualUsageCap)} onChange={(e) => set('sickAnnualUsageCap', num(e.target.value))} /></Labeled>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="PTO" description={<PolicyConfirm />} />
        <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Labeled label="Hours per pay period (1.0 FTE)"><TextInput type="number" disabled={!edit} value={str(s.ptoPolicy?.hoursPerPeriod)} onChange={(e) => set('ptoPolicy', { ...(s.ptoPolicy ?? {}), hoursPerPeriod: num(e.target.value) })} /></Labeled>
          <Labeled label="Pay periods per year"><TextInput type="number" disabled={!edit} value={str(s.ptoPolicy?.periodsPerYear)} onChange={(e) => set('ptoPolicy', { ...(s.ptoPolicy ?? {}), periodsPerYear: num(e.target.value) })} /></Labeled>
          <Labeled label="Balance cap (hours)"><TextInput type="number" disabled={!edit} value={str(s.ptoPolicy?.balanceCap)} onChange={(e) => set('ptoPolicy', { ...(s.ptoPolicy ?? {}), balanceCap: num(e.target.value) })} /></Labeled>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="CEU hours per license renewal cycle" description={<>Maryland boards set these per license type. <PolicyConfirm>Practice policy, confirm with each board</PolicyConfirm></>} />
        <CardBody flush>
          <div className="clinic-scroll-x">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold text-slate-600">
                  <th scope="col" className="px-4 py-2">License</th>
                  <th scope="col" className="px-4 py-2">CEU hours</th>
                  <th scope="col" className="px-4 py-2">Cycle (months)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.licenseTypes.map((lt) => (
                  <tr key={lt.code}>
                    <td className="px-4 py-2"><span className="font-medium">{lt.code}</span> <span className="text-xs text-slate-500">{lt.label}</span></td>
                    <td className="px-4 py-2"><TextInput aria-label={`${lt.code} hours`} type="number" disabled={!edit} value={ceuDraft[lt.code]?.hours ?? ''} onChange={(e) => setCeuDraft({ ...ceuDraft, [lt.code]: { ...(ceuDraft[lt.code] ?? { cycleMonths: '' }), hours: e.target.value } })} className="w-24" /></td>
                    <td className="px-4 py-2"><TextInput aria-label={`${lt.code} cycle`} type="number" disabled={!edit} value={ceuDraft[lt.code]?.cycleMonths ?? ''} onChange={(e) => setCeuDraft({ ...ceuDraft, [lt.code]: { ...(ceuDraft[lt.code] ?? { hours: '' }), cycleMonths: e.target.value } })} className="w-24" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Health screening and CPR" description={<PolicyConfirm />} />
        <CardBody className="space-y-5">
          <Labeled label="TB screening repeats every (months)" hint="Blank = once at hire"><TextInput type="number" disabled={!edit} value={str(s.immunizationPolicy.tbIntervalMonths)} onChange={(e) => set('immunizationPolicy', { ...s.immunizationPolicy, tbIntervalMonths: num(e.target.value) })} className="w-32" /></Labeled>
          <div><p className="mb-1.5 text-sm font-medium text-slate-700">TB screening required for</p><RoleChecks disabled={!edit} value={s.immunizationPolicy.tbRoles ?? []} onChange={(v) => set('immunizationPolicy', { ...s.immunizationPolicy, tbRoles: v })} /></div>
          <div><p className="mb-1.5 text-sm font-medium text-slate-700">Flu vaccine or declination required for</p><RoleChecks disabled={!edit} value={s.immunizationPolicy.fluRoles ?? []} onChange={(v) => set('immunizationPolicy', { ...s.immunizationPolicy, fluRoles: v })} /></div>
          <div><p className="mb-1.5 text-sm font-medium text-slate-700">Hepatitis B series or declination required for</p><RoleChecks disabled={!edit} value={s.immunizationPolicy.hepBRoles ?? []} onChange={(v) => set('immunizationPolicy', { ...s.immunizationPolicy, hepBRoles: v })} /></div>
          <div><p className="mb-1.5 text-sm font-medium text-slate-700">CPR / BLS required for</p><RoleChecks disabled={!edit} value={s.cprRequiredRoles} onChange={(v) => set('cprRequiredRoles', v)} /></div>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5" disabled={!lead} checked={s.i9StoreDocumentImages} onChange={(e) => set('i9StoreDocumentImages', e.target.checked)} />
            <span>Store I-9 identity document copies in Altrixs <span className="block text-xs text-slate-500">Off by default: HR records completion only. Leadership only.</span></span>
          </label>
        </CardBody>
        {edit ? (
          <CardFooter>
            <Button icon={<Save />} loading={busy} onClick={() => save()}>Save settings</Button>
          </CardFooter>
        ) : null}
      </Card>
    </div>
  );
}

type TemplateItem = { key: string; label: string; category: string; ownerType: string; dueOffsetDays?: number; dueBusinessDays?: number; requiresAck?: boolean; requiresUpload?: boolean; systemAction?: string; policyKind?: string; clinicalOnly?: boolean; licensedOnly?: boolean; prescriberOnly?: boolean; workerTypes?: string[]; roles?: string[]; help?: string };
type Template = { id: string | null; kind: 'onboarding' | 'offboarding'; name: string; roles: string[]; items: TemplateItem[]; builtIn: boolean };

function TemplatesEditor() {
  const { data, error, loading, reload } = useHrData<{ templates: Template[] }>('/api/hr/templates');
  const [editing, setEditing] = useState<Template | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  if (loading && !data) return <LoadingState rows={4} />;
  if (error && !data) return <ErrorState description={error} onRetry={reload} />;
  async function save() {
    if (!editing) return;
    setBusy(true);
    try {
      await hrFetch('/api/hr/templates', { method: 'PUT', json: { id: editing.id, kind: editing.kind, name: editing.name, roles: editing.roles, items: editing.items } });
      setEditing(null);
      reload();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }
  const upd = (i: number, patch: Partial<TemplateItem>) => editing && setEditing({ ...editing, items: editing.items.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  return (
    <div className="space-y-6">
      {msg ? <Alert tone="danger">{msg}</Alert> : null}
      <Card>
        <CardHeader title="Templates" description="Standard templates are built in. Copy one to make a practice version (for example, a prescriber or PRP onboarding)." />
        <CardBody flush>
          <ul className="divide-y divide-slate-100">
            {(data?.templates ?? []).map((t) => (
              <li key={`${t.kind}-${t.id ?? 'builtin'}`} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-900">{t.name} {t.builtIn ? <StatusBadge size="sm">Built in</StatusBadge> : null}</p>
                  <p className="text-xs text-slate-500">{titleCase(t.kind)} · {t.items.length} items · {t.roles.length ? t.roles.map(roleLabel).join(', ') : 'any role'}</p>
                </div>
                <Button size="sm" variant="secondary" onClick={() => setEditing(t.builtIn ? { ...t, id: null, builtIn: false, name: `${t.name} (practice)` } : t)}>
                  {t.builtIn ? 'Copy and edit' : 'Edit'}
                </Button>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
      {editing ? (
        <Card>
          <CardHeader title={editing.id ? 'Edit template' : 'New practice template'} actions={<Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Close</Button>} />
          <CardBody className="space-y-4">
            <Labeled label="Name"><TextInput value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Labeled>
            <div><p className="mb-1.5 text-sm font-medium text-slate-700">Use automatically for these roles (none = any role)</p><RoleChecks value={editing.roles} onChange={(v) => setEditing({ ...editing, roles: v })} /></div>
            <div className="space-y-2">
              {editing.items.map((it, i) => (
                <div key={i} className="grid grid-cols-1 gap-2 rounded-lg border border-slate-200 p-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_100px_auto] md:items-end">
                  <Labeled label="Task"><TextInput value={it.label} onChange={(e) => upd(i, { label: e.target.value })} /></Labeled>
                  <Labeled label="Group"><TextInput value={it.category} onChange={(e) => upd(i, { category: e.target.value })} /></Labeled>
                  <Labeled label="Owner">
                    <Select value={it.ownerType} onChange={(e) => upd(i, { ownerType: e.target.value })}>
                      {['hr', 'manager', 'employee', 'admin', 'clinical_director', 'it'].map((o) => <option key={o} value={o}>{titleCase(o)}</option>)}
                    </Select>
                  </Labeled>
                  <Labeled label="Due (days)"><TextInput type="number" value={it.dueOffsetDays ?? ''} onChange={(e) => upd(i, { dueOffsetDays: e.target.value === '' ? undefined : Number(e.target.value), dueBusinessDays: undefined })} /></Labeled>
                  <Button size="sm" variant="ghost" aria-label="Remove task" onClick={() => setEditing({ ...editing, items: editing.items.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" /></Button>
                  <p className="text-xs text-slate-500 md:col-span-5">
                    {[it.prescriberOnly && 'prescribers only', it.licensedOnly && 'licensed only', it.clinicalOnly && 'clinical staff only', it.workerTypes?.length && `worker types: ${it.workerTypes.join(', ')}`, it.requiresAck && 'acknowledgment', it.requiresUpload && 'upload', it.systemAction && `action: ${titleCase(it.systemAction)}`]
                      .filter(Boolean)
                      .join(' · ') || 'Applies to everyone'}
                  </p>
                </div>
              ))}
              <Button size="sm" variant="secondary" icon={<Plus />} onClick={() => setEditing({ ...editing, items: [...editing.items, { key: '', label: '', category: 'Other', ownerType: 'hr', dueOffsetDays: 0 }] })}>Add task</Button>
            </div>
          </CardBody>
          <CardFooter><Button icon={<Save />} loading={busy} onClick={save} disabled={!editing.name || editing.items.some((x) => !x.label.trim())}>Save template</Button></CardFooter>
        </Card>
      ) : null}
    </div>
  );
}

type Policy = { id: string; kind: string; title: string; version: string; effectiveOn: string | null; requiresAck: boolean; sectionCount: number };
type Report = Array<{ policyId: string; title: string; version: string; acknowledged: number; total: number; missing: Array<{ userId: string; name: string }> }>;

function PoliciesAdmin() {
  const list = useHrData<{ policies: Policy[]; kinds: Array<{ key: string; label: string }> }>('/api/hr/policies');
  const report = useHrData<{ report: Report }>('/api/hr/policies/report');
  const [f, setF] = useState({ kind: 'handbook', title: 'Employee handbook', version: '1.0', effectiveOn: '', text: '', requiresAck: true });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  async function publish() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await hrFetch<{ sectionCount: number }>('/api/hr/policies', { method: 'POST', json: { ...f, effectiveOn: f.effectiveOn || null } });
      setMsg({ tone: 'success', text: `Published with ${r.sectionCount} sections. Staff see it on My HR to acknowledge.` });
      setF({ ...f, text: '' });
      list.reload();
      report.reload();
    } catch (e) {
      setMsg({ tone: 'danger', text: e instanceof Error ? e.message : 'Could not publish' });
    } finally {
      setBusy(false);
    }
  }
  async function retire(id: string) {
    await hrFetch(`/api/hr/policies/${id}`, { method: 'DELETE' }).catch(() => undefined);
    list.reload();
    report.reload();
  }
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Published policies" description="Staff acknowledge each version. The handbook Q&A answers only from these texts." />
        <CardBody flush>
          {(list.data?.policies ?? []).length === 0 ? (
            <EmptyState compact title="No policies published" />
          ) : (
            <ul className="divide-y divide-slate-100">
              {list.data!.policies.map((p) => {
                const r = report.data?.report.find((x) => x.policyId === p.id);
                return (
                  <li key={p.id} className="grid grid-cols-1 gap-2 px-5 py-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] md:items-center">
                    <div>
                      <p className="text-sm font-medium text-slate-900">{p.title} v{p.version}</p>
                      <p className="text-xs text-slate-500">{list.data!.kinds.find((k) => k.key === p.kind)?.label} · {p.sectionCount} sections{p.effectiveOn ? ` · effective ${fmtDate(p.effectiveOn)}` : ''}</p>
                      {r && r.missing.length ? <p className="text-xs text-amber-700">Not acknowledged: {r.missing.slice(0, 8).map((m) => m.name).join(', ')}{r.missing.length > 8 ? ` +${r.missing.length - 8}` : ''}</p> : null}
                    </div>
                    {r ? <ProgressBar pct={r.total ? (r.acknowledged / r.total) * 100 : 0} label={`${p.title} acknowledgments`} /> : <span className="text-xs text-slate-500">No acknowledgment needed</span>}
                    <Button size="sm" variant="ghost" onClick={() => retire(p.id)}>Retire</Button>
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Publish a policy or a new version" description="Paste the text. Headings (numbered, ALL CAPS or # lines) become sections used for citations." />
        <CardBody className="space-y-4">
          {msg ? <Alert tone={msg.tone}>{msg.text}</Alert> : null}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
            <Labeled label="Type">
              <Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
                {(list.data?.kinds ?? []).map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
              </Select>
            </Labeled>
            <Labeled label="Title"><TextInput value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Labeled>
            <Labeled label="Version"><TextInput value={f.version} onChange={(e) => setF({ ...f, version: e.target.value })} /></Labeled>
            <Labeled label="Effective"><TextInput type="date" value={f.effectiveOn} onChange={(e) => setF({ ...f, effectiveOn: e.target.value })} /></Labeled>
          </div>
          <Labeled label="Policy text"><TextArea rows={12} value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} /></Labeled>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.requiresAck} onChange={(e) => setF({ ...f, requiresAck: e.target.checked })} /> Staff must acknowledge</label>
        </CardBody>
        <CardFooter><Button loading={busy} onClick={publish} disabled={f.text.trim().length < 20 || !f.title || !f.version}>Publish</Button></CardFooter>
      </Card>
    </div>
  );
}
