'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, Check, Clock, Mail, Phone, Plus, Settings, Shield, Users } from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import {
  Alert, Button, Card, EmptyState, FormField, LoadingState, Page, PageHeader, StatCard, StatGrid, StatusBadge,
  Tabs, buttonClasses, cx, FOCUS_RING, inputClasses, type Tone,
} from '@/components/ui';
import { SidePanel } from '@/features/billing/SidePanel';
import { formatPhone } from '@/lib/billing/payerMaster';
import { PANEL_STATUSES, PANEL_STATUS_LABEL, panelCounts, panelInputSchema, type PanelRow, type PanelStatus } from '@/lib/billing/payerPanels';

type Staff = { id: string; name: string; npi: string | null; credentials: string | null; role: string };
type PayerOption = { id: string; name: string; payerId: string | null; active: boolean };

const STATUS_TONE: Record<PanelStatus, Tone> = {
  not_started: 'neutral',
  application_submitted: 'warning',
  in_process: 'info',
  approved: 'success',
  denied: 'danger',
  termed: 'danger',
};

const OTHER = '__other__';

type FormState = {
  payerRegistryId: string;
  payerName: string;
  providerUserIds: string[];
  status: PanelStatus;
  submittedDate: string;
  effectiveDate: string;
  recredentialingDueDate: string;
  providerPin: string;
  openToNewClients: boolean;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  notes: string;
};

const BLANK: FormState = {
  payerRegistryId: '', payerName: '', providerUserIds: [], status: 'not_started', submittedDate: '', effectiveDate: '',
  recredentialingDueDate: '', providerPin: '', openToNewClients: false, contactName: '', contactPhone: '', contactEmail: '', notes: '',
};

function toForm(p: PanelRow): FormState {
  return {
    payerRegistryId: p.payerRegistryId ?? OTHER, payerName: p.payerName, providerUserIds: p.providerUserIds, status: p.status,
    submittedDate: p.submittedDate ?? '', effectiveDate: p.effectiveDate ?? '', recredentialingDueDate: p.recredentialingDueDate ?? '',
    providerPin: p.providerPin ?? '', openToNewClients: p.openToNewClients, contactName: p.contactName ?? '', contactPhone: p.contactPhone ?? '',
    contactEmail: p.contactEmail ?? '', notes: p.notes ?? '',
  };
}

const fmtDate = (d: string | null) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString() : null);

// ─── Add / edit panel ────────────────────────────────────────────────────────

function PanelForm({
  panel, canEdit, staff, payers, onClose, onSaved,
}: {
  panel: PanelRow | null; canEdit: boolean; staff: Staff[]; payers: PayerOption[];
  onClose: () => void; onSaved: (rows: PanelRow[]) => void;
}) {
  const [form, setForm] = useState<FormState>(panel ? toForm(panel) : BLANK);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ro = !canEdit;
  const other = form.payerRegistryId === OTHER;
  const payerChoices = payers.filter((p) => p.active || p.id === panel?.payerRegistryId);
  // Staff no longer listed (left the practice) stay on the panel until unticked
  const extraStaff = (panel?.providers ?? []).filter((p) => !staff.some((s) => s.id === p.id));

  async function save() {
    setServerError(null);
    const body = {
      ...form,
      payerRegistryId: other ? null : form.payerRegistryId || null,
      payerName: other ? form.payerName : null,
    };
    const parsed = panelInputSchema.safeParse(body);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const i of parsed.error.issues) {
        const k = String(i.path[0] ?? 'form');
        if (!next[k]) next[k] = i.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const d = panel
        ? await apiJson<{ panels: PanelRow[] }>(`/api/billing/panels/${encodeURIComponent(panel.id)}`, { method: 'PATCH', body: JSON.stringify({ panel: body }) })
        : await apiJson<{ panels: PanelRow[] }>('/api/billing/panels', { method: 'POST', body: JSON.stringify({ panel: body }) });
      onSaved(d.panels);
      onClose();
    } catch (e) {
      setServerError(e instanceof Error ? e.message : 'Could not save the panel');
    } finally {
      setBusy(false);
    }
  }

  const input = (k: keyof FormState, label: string, opts: { type?: string; placeholder?: string; inputMode?: 'tel' | 'email'; hint?: string } = {}) => (
    <FormField label={label} error={errors[k]} hint={opts.hint}>
      <input
        type={opts.type ?? 'text'}
        value={String(form[k])}
        disabled={ro}
        placeholder={opts.placeholder}
        inputMode={opts.inputMode}
        onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}
        className={inputClasses}
      />
    </FormField>
  );

  return (
    <SidePanel
      title={panel ? (ro ? panel.payerName : `Edit panel: ${panel.payerName}`) : 'Add insurance panel'}
      titleId="panel-form-title"
      onClose={onClose}
      footer={ro ? <Button variant="secondary" onClick={onClose}>Close</Button> : (
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void save()} loading={busy}>{panel ? 'Save panel' : 'Add panel'}</Button>
        </>
      )}
    >
      <div className="space-y-5">
        {ro ? <Alert tone="info">View only. Billing and practice leadership edit insurance panels.</Alert> : null}
        {serverError ? <Alert tone="danger">{serverError}</Alert> : null}
        {Object.keys(errors).length ? <Alert tone="danger">Fix the highlighted fields.</Alert> : null}

        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-slate-900">Payer</h3>
          <FormField label="Payer" required error={errors.payerRegistryId ?? (other ? undefined : errors.payerName)} hint={payers.length ? undefined : 'The payer list is empty. Add payers under Billing › Payers, or type the name below.'}>
            <select value={form.payerRegistryId} disabled={ro} onChange={(e) => setForm((f) => ({ ...f, payerRegistryId: e.target.value }))} className={inputClasses}>
              <option value="">Choose a payer…</option>
              {payerChoices.map((p) => <option key={p.id} value={p.id}>{p.name}{p.payerId ? ` (${p.payerId})` : ''}</option>)}
              <option value={OTHER}>Payer not on the payer list…</option>
            </select>
          </FormField>
          {other ? input('payerName', 'Payer name', { placeholder: 'Type the payer name', hint: 'Add the payer under Billing › Payers when you can, then pick it here.' }) : null}
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-900">Providers on this panel</h3>
          {errors.providerUserIds ? <p className="text-xs text-rose-700">{errors.providerUserIds}</p> : null}
          {staff.length + extraStaff.length === 0 ? (
            <p className="text-xs text-slate-500">No clinicians or staff with an NPI found.</p>
          ) : (
            <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
              {[...staff.map((s) => ({ id: s.id, label: s.name + (s.credentials ? `, ${s.credentials}` : ''), npi: s.npi })), ...extraStaff.map((s) => ({ id: s.id, label: s.name, npi: s.npi }))].map((s) => (
                <label key={s.id} className="flex items-start gap-2 rounded px-1 py-1 text-sm text-slate-700 hover:bg-slate-50">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    disabled={ro}
                    checked={form.providerUserIds.includes(s.id)}
                    onChange={(e) => setForm((f) => ({ ...f, providerUserIds: e.target.checked ? [...f.providerUserIds, s.id] : f.providerUserIds.filter((x) => x !== s.id) }))}
                  />
                  <span className="min-w-0 break-words">{s.label}{s.npi ? <span className="ml-1 font-mono text-xs text-slate-500">NPI {s.npi}</span> : <span className="ml-1 text-xs text-amber-700">no NPI</span>}</span>
                </label>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-slate-900">Credentialing</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Status" error={errors.status}>
              <select value={form.status} disabled={ro} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as PanelStatus }))} className={inputClasses}>
                {PANEL_STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </FormField>
            <FormField label="Open to new clients">
              <select value={form.openToNewClients ? 'yes' : 'no'} disabled={ro} onChange={(e) => setForm((f) => ({ ...f, openToNewClients: e.target.value === 'yes' }))} className={inputClasses}>
                <option value="no">No</option>
                <option value="yes">Yes</option>
              </select>
            </FormField>
            {input('submittedDate', 'Application submitted', { type: 'date' })}
            {input('effectiveDate', 'Effective date', { type: 'date' })}
            {input('recredentialingDueDate', 'Re-credentialing due', { type: 'date' })}
            {input('providerPin', 'Provider ID / PIN from the payer')}
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-slate-900">Credentialing contact</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {input('contactName', 'Name')}
            {input('contactPhone', 'Phone', { inputMode: 'tel' })}
            <div className="sm:col-span-2">{input('contactEmail', 'Email', { inputMode: 'email', type: 'email' })}</div>
          </div>
          <FormField label="Notes" error={errors.notes}>
            <textarea rows={3} value={form.notes} disabled={ro} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className={cx(inputClasses, 'resize-y')} />
          </FormField>
        </section>
      </div>
    </SidePanel>
  );
}

// ─── Panel card ──────────────────────────────────────────────────────────────

function PanelCard({ panel, onOpen }: { panel: PanelRow; onOpen: () => void }) {
  return (
    <Card>
      <button type="button" onClick={onOpen} className={cx('flex w-full flex-col gap-3 rounded-xl p-4 text-left sm:flex-row sm:items-start sm:justify-between', FOCUS_RING)}>
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-600 text-sm font-semibold text-white">
            {panel.payerName.slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0 space-y-1">
            <p className="break-words font-semibold text-slate-900">{panel.payerName}</p>
            <p className="text-xs text-slate-500">
              {panel.registryPayerId ? <>Payer ID <span className="font-mono">{panel.registryPayerId}</span></> : panel.payerRegistryId ? 'Payer ID missing on the payer list' : 'Not on the payer list'}
              {panel.providerPin ? <> · Provider ID / PIN <span className="font-mono">{panel.providerPin}</span></> : null}
            </p>
            <p className="flex flex-wrap items-center gap-1 text-xs text-slate-600">
              <Users className="h-3.5 w-3.5 text-slate-400" aria-hidden />
              {panel.providers.length ? panel.providers.map((p) => p.name).join(', ') : 'No providers listed'}
            </p>
            <p className="flex flex-wrap gap-x-4 text-xs text-slate-600">
              {panel.submittedDate ? <span>Submitted {fmtDate(panel.submittedDate)}</span> : null}
              {panel.effectiveDate ? <span>Effective {fmtDate(panel.effectiveDate)}</span> : null}
              {panel.recredentialingDueDate ? <span className="inline-flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5 text-slate-400" aria-hidden /> Re-credentialing {fmtDate(panel.recredentialingDueDate)}</span> : null}
            </p>
            {panel.contactName || panel.contactPhone || panel.contactEmail ? (
              <p className="flex flex-wrap gap-x-3 text-xs text-slate-600">
                {panel.contactName ? <span>{panel.contactName}</span> : null}
                {panel.contactPhone ? <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3 text-slate-400" aria-hidden />{formatPhone(panel.contactPhone)}</span> : null}
                {panel.contactEmail ? <span className="inline-flex min-w-0 items-center gap-1 break-all"><Mail className="h-3 w-3 shrink-0 text-slate-400" aria-hidden />{panel.contactEmail}</span> : null}
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 sm:flex-col sm:items-end">
          <StatusBadge tone={STATUS_TONE[panel.status] ?? 'neutral'}>{PANEL_STATUS_LABEL[panel.status] ?? panel.status}</StatusBadge>
          {panel.status === 'approved' ? (
            <span className={cx('text-xs', panel.openToNewClients ? 'text-emerald-700' : 'text-slate-500')}>
              {panel.openToNewClients ? 'Open to new clients' : 'Closed to new clients'}
            </span>
          ) : null}
        </div>
      </button>
    </Card>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function PanelsPage() {
  const [panels, setPanels] = useState<PanelRow[] | null>(null);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [payers, setPayers] = useState<PayerOption[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [legacyPending, setLegacyPending] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [filterStatus, setFilterStatus] = useState<PanelStatus | 'all'>('all');
  const [open, setOpen] = useState<{ id: string | null } | null>(null);

  const load = useCallback(() => {
    setError(null);
    apiJson<{ panels: PanelRow[]; staff: Staff[]; payers: PayerOption[]; canEdit: boolean; legacyPending: number }>('/api/billing/panels')
      .then((d) => { setPanels(d.panels); setStaff(d.staff); setPayers(d.payers); setCanEdit(d.canEdit); setLegacyPending(d.legacyPending); })
      .catch((e) => { setPanels((p) => p ?? []); setError(e instanceof Error ? e.message : 'Could not load panels'); });
  }, []);
  useEffect(load, [load]);

  async function importLegacy() {
    setImporting(true);
    setError(null);
    try {
      const d = await apiJson<{ panels: PanelRow[]; imported: number }>('/api/billing/panels', { method: 'POST', body: JSON.stringify({ action: 'import_legacy' }) });
      setPanels(d.panels);
      setLegacyPending(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not import the saved panels');
    } finally {
      setImporting(false);
    }
  }

  const all = panels ?? [];
  const filtered = useMemo(() => all.filter((p) => filterStatus === 'all' || p.status === filterStatus), [all, filterStatus]);
  const counts = useMemo(() => panelCounts(all), [all]);
  const editing = open?.id ? all.find((p) => p.id === open.id) ?? null : null;
  const close = useCallback(() => setOpen(null), []);

  return (
    <Page className="max-w-4xl">
      <PageHeader
        title="Insurance Panels"
        description="Credentialing status, payer-assigned provider IDs, re-credentialing dates and panel availability, per payer"
        actions={<>
          <a href="/dashboard/billing/payer-settings" className={buttonClasses({ variant: 'secondary' })}>
            <Settings size={16} aria-hidden /> Payers
          </a>
          {canEdit ? (
            <Button icon={<Plus />} onClick={() => setOpen({ id: null })} disabled={panels == null}>
              Add Panel
            </Button>
          ) : null}
        </>}
      />

      {error ? <Alert tone="danger" actions={<Button size="sm" variant="secondary" onClick={load}>Retry</Button>}>{error}</Alert> : null}
      {canEdit && legacyPending > 0 ? (
        <Alert tone="warning" actions={<Button size="sm" onClick={() => void importLegacy()} loading={importing}>Import them</Button>}>
          {legacyPending} panel{legacyPending === 1 ? ' was' : 's were'} saved on the old version of this page. Import them to keep tracking them here (the old payer ID, fee schedule and renewal date go into the notes).
        </Alert>
      ) : null}

      <StatGrid columns={4}>
        <StatCard label="Active Panels" value={panels ? counts.active : '…'} hint="approved / in network" tone="success" icon={<Check />} />
        <StatCard label="In Progress" value={panels ? counts.pending : '…'} hint="submitted or in process" tone="warning" icon={<Clock />} />
        <StatCard label="Open to New Clients" value={panels ? counts.open : '…'} tone="brand" icon={<Shield />} />
        <StatCard label="Re-credentialing Due" value={panels ? counts.recredDue : '…'} hint="within 90 days or overdue" tone={counts.recredDue ? 'danger' : 'neutral'} icon={<CalendarClock />} />
      </StatGrid>

      <Tabs
        variant="pill"
        label="Filter panels by status"
        controlsPanels={false}
        value={filterStatus}
        onChange={setFilterStatus}
        items={[{ key: 'all' as const, label: 'All' }, ...PANEL_STATUSES.map(([v, l]) => ({ key: v, label: l }))]}
      />

      <div className="space-y-3">
        {filtered.map((p) => <PanelCard key={p.id} panel={p} onOpen={() => setOpen({ id: p.id })} />)}
      </div>

      {filtered.length === 0 && (
        <Card>
          {panels == null ? (
            <LoadingState label="Loading panels…" />
          ) : all.length === 0 ? (
            <EmptyState
              icon={<Shield />}
              title="No insurance panels yet"
              description={canEdit ? 'Add a panel for each payer the practice is credentialing with: the providers on it, the status, dates and the payer\'s credentialing contact.' : 'Billing has not added panels yet.'}
              action={canEdit ? <Button icon={<Plus />} onClick={() => setOpen({ id: null })}>Add Panel</Button> : undefined}
            />
          ) : (
            <EmptyState icon={<Shield />} title="No panels in this category" />
          )}
        </Card>
      )}

      {open && (open.id === null || editing) ? (
        <PanelForm
          key={open.id ?? 'new'}
          panel={editing}
          canEdit={canEdit}
          staff={staff}
          payers={payers}
          onClose={close}
          onSaved={setPanels}
        />
      ) : null}
    </Page>
  );
}
