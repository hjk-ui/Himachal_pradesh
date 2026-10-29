'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { AlertTriangle, ArrowRight, Building2, Info, MapPin, RefreshCw, RotateCcw, Save, Sparkles, Trash2 } from 'lucide-react';
import {
  Alert,
  Button,
  buttonClasses,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  IconButton,
  inputClasses,
  LoadingState,
  Page,
  PageHeader,
  StatusBadge,
} from '@/components/ui';
import { PROGRAM_KEYS, programLabel, type FacilityKind } from '@/lib/locations/facilityMapping';
import { REASON_LABELS, RULES, type RecomputeReason, type RecomputeSummary, type SourceVerdict } from '@/lib/locations/recompute';
import type { PracticeOverview } from '@/lib/locations/overview';

type Loc = PracticeOverview['locations'][number];
type Mapping = {
  id: string;
  facilityName: string;
  kind: FacilityKind;
  locationId: string | null;
  programKey: string | null;
  needsConfirmation: boolean;
  note: string | null;
  origin: string;
  importedRows: number;
  billingEntityName: string | null;
  timezone: string | null;
  sourceActive: boolean | null;
};
type Suggestion = Omit<Mapping, 'id' | 'origin' | 'billingEntityName' | 'timezone' | 'sourceActive'> & { basis: string; seenInImport: boolean };
type FacilityNotes = {
  locationsWithoutFacility: { id: string; name: string }[];
  primaryLocationFacilities: string[];
  billingEntities: { mainEntity: string | null; others: { facilityName: string; billingEntityName: string }[] };
};
type SampleRow = {
  clientId: string;
  clientName: string | null;
  mrn: string | null;
  reason: RecomputeReason;
  fromLocationId: string | null;
  toLocationId: string | null;
  evidence: string | null;
  verdicts: SourceVerdict[];
};
type Preview = {
  summary: RecomputeSummary;
  fingerprint: string;
  defaultLocationId: string | null;
  evidenceAvailable: { journalRows: number; savedMappings: number; staffWithOneLocation: number; staffWithSeveralLocations: number };
  locations: { id: string; name: string }[];
  sample: SampleRow[];
};
type Run = { runId: string; changes: number; reverted: number; appliedAt: string | null };

const fmtN = (n: number) => n.toLocaleString('en-US');
const fmt$ = (cents: number) => `$${Math.round(cents / 100).toLocaleString('en-US')}`;

const TH = 'px-4 py-3 text-xs font-semibold text-slate-600';
const LINK = 'font-semibold text-blue-700 hover:underline';

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.success) throw new Error(data?.error || `Request failed (${res.status})`);
  return data as T;
}

function inputCls() {
  return 'rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900 shadow-xs focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20';
}

function Address({ l }: { l: Loc }) {
  const line = [l.addressLine1, l.addressLine2].filter(Boolean).join(', ');
  const city = [l.city, [l.state, l.postalCode].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  if (!line && !city) return <span className="text-slate-500">No address on file</span>;
  return <span>{[line, city].filter(Boolean).join(', ')}</span>;
}

function Evidence({ label, value, source }: { label: string; value: string; source: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2">
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className="text-sm font-semibold text-slate-900">{value}</p>
      <p className="mt-0.5 text-[11px] text-slate-500">source: {source}</p>
    </div>
  );
}

function MappingRow({
  row,
  locations,
  onSaved,
}: {
  row: Mapping;
  locations: Loc[];
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState(row);
  const [busy, setBusy] = useState(false);
  useEffect(() => setDraft(row), [row]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(row);

  const save = async () => {
    setBusy(true);
    try {
      await getJson('/api/locations/facility-map', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          facilityName: draft.facilityName,
          kind: draft.kind,
          locationId: draft.locationId,
          programKey: draft.programKey,
          needsConfirmation: draft.needsConfirmation,
          note: draft.note,
        }),
      });
      toast.success('Mapping saved.');
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!window.confirm(`Remove the mapping for "${row.facilityName}"?`)) return;
    setBusy(true);
    try {
      await getJson(`/api/locations/facility-map?facilityName=${encodeURIComponent(row.facilityName)}`, { method: 'DELETE' });
      toast.success('Mapping removed.');
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not remove');
    } finally {
      setBusy(false);
    }
  };

  return (
    <tr className="align-top">
      <td className="px-4 py-3">
        <p className="text-xs font-semibold text-slate-900">{row.facilityName}</p>
        <p className="text-[11px] text-slate-500">
          {fmtN(row.importedRows)} imported rows · {row.origin === 'suggested' ? 'from suggestion' : row.origin === 'facility_import' ? 'from Valant facility list' : 'owner'}
        </p>
        {row.billingEntityName || row.timezone || row.sourceActive !== null ? (
          <p className="text-[11px] text-slate-500">
            {[row.billingEntityName, row.timezone, row.sourceActive === null ? null : row.sourceActive ? 'Active in Valant' : 'Inactive in Valant'].filter(Boolean).join(' · ')}
          </p>
        ) : null}
        {row.note ? <p className="mt-1 max-w-xs text-[11px] text-slate-500">{row.note}</p> : null}
      </td>
      <td className="px-4 py-3">
        <select
          className={inputCls()}
          value={draft.kind}
          onChange={(e) => setDraft({ ...draft, kind: e.target.value as FacilityKind, programKey: e.target.value === 'program' ? draft.programKey ?? 'primary_care' : null })}
        >
          <option value="location">Location</option>
          <option value="program">Program</option>
          <option value="ignore">Ignore</option>
        </select>
      </td>
      <td className="px-4 py-3">
        {draft.kind === 'program' ? (
          <select className={inputCls()} value={draft.programKey ?? ''} onChange={(e) => setDraft({ ...draft, programKey: e.target.value })}>
            {PROGRAM_KEYS.map((k) => (
              <option key={k} value={k}>{programLabel(k)}</option>
            ))}
          </select>
        ) : draft.kind === 'location' ? (
          <select className={inputCls()} value={draft.locationId ?? ''} onChange={(e) => setDraft({ ...draft, locationId: e.target.value || null })}>
            <option value="">Choose location…</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        ) : (
          <span className="text-xs text-slate-500">Not counted</span>
        )}
      </td>
      <td className="px-4 py-3">
        <label className="flex items-center gap-1.5 text-xs text-slate-600">
          <input type="checkbox" checked={!draft.needsConfirmation} onChange={(e) => setDraft({ ...draft, needsConfirmation: !e.target.checked })} />
          Confirmed
        </label>
      </td>
      <td className="px-4 py-3 text-right">
        <div className="flex justify-end gap-1.5">
          <Button size="sm" icon={<Save />} disabled={!dirty || busy} onClick={save}>
            Save
          </Button>
          <IconButton
            disabled={busy}
            onClick={remove}
            label={`Remove mapping for ${row.facilityName}`}
            title="Remove mapping"
            icon={<Trash2 className="h-4 w-4" />}
            className="h-10 w-10 text-slate-500 ring-1 ring-inset ring-slate-300 hover:bg-rose-50 hover:text-rose-700 md:h-8 md:w-8"
          />
        </div>
      </td>
    </tr>
  );
}

export default function LocationsAdminPage() {
  const [overview, setOverview] = useState<PracticeOverview | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [mapError, setMapError] = useState<string | null>(null);
  const [notes, setNotes] = useState<FacilityNotes | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [applyBusy, setApplyBusy] = useState(false);
  const [runs, setRuns] = useState<Run[]>([]);
  const [newFacility, setNewFacility] = useState('');

  const loadOverview = useCallback(() => {
    getJson<{ overview: PracticeOverview }>('/api/locations/overview')
      .then((d) => { setOverview(d.overview); setOverviewError(null); })
      .catch((e: unknown) => setOverviewError(e instanceof Error ? e.message : 'Could not load'));
  }, []);
  const loadMapping = useCallback(() => {
    getJson<{ mappings: Mapping[]; suggestions: Suggestion[]; notes: FacilityNotes }>('/api/locations/facility-map')
      .then((d) => { setMappings(d.mappings); setSuggestions(d.suggestions); setNotes(d.notes); setMapError(null); })
      .catch((e: unknown) => setMapError(e instanceof Error ? e.message : 'Could not load'));
  }, []);
  const loadRuns = useCallback(() => {
    getJson<{ runs: Run[] }>('/api/locations/client-locations/runs').then((d) => setRuns(d.runs)).catch(() => setRuns([]));
  }, []);

  useEffect(() => {
    loadOverview();
    loadMapping();
    loadRuns();
  }, [loadOverview, loadMapping, loadRuns]);

  const locations = useMemo(() => overview?.locations ?? [], [overview]);
  const locName = useCallback((id: string | null) => (id ? locations.find((l) => l.id === id)?.name ?? 'Unknown location' : 'No location'), [locations]);

  const refreshAll = () => {
    loadOverview();
    loadMapping();
    setPreview(null);
  };

  const applySuggested = async () => {
    try {
      const d = await getJson<{ created: number; skippedUnknown: number }>('/api/locations/facility-map', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'apply_suggested' }),
      });
      toast.success(`Saved ${d.created} mapping${d.created === 1 ? '' : 's'}${d.skippedUnknown ? `; ${d.skippedUnknown} left for you to choose` : ''}.`);
      refreshAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not apply');
    }
  };

  const addFacility = async () => {
    const name = newFacility.trim();
    if (!name) return;
    try {
      await getJson('/api/locations/facility-map', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ facilityName: name, kind: 'ignore', needsConfirmation: true }),
      });
      setNewFacility('');
      toast.success('Facility added. Choose its location or program and save.');
      refreshAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not add');
    }
  };

  const runPreview = async () => {
    setPreviewBusy(true);
    try {
      setPreview(await getJson<Preview>('/api/locations/client-locations'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Preview failed');
    } finally {
      setPreviewBusy(false);
    }
  };

  const applyPlan = async () => {
    if (!preview) return;
    const n = preview.summary.byReason.move;
    if (!window.confirm(`Move ${fmtN(n)} client${n === 1 ? '' : 's'} to the locations shown? Each change is recorded and the run can be undone.`)) return;
    setApplyBusy(true);
    try {
      const d = await getJson<{ moved: number; runId: string }>('/api/locations/client-locations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fingerprint: preview.fingerprint }),
      });
      toast.success(`Moved ${fmtN(d.moved)} clients.`);
      setPreview(null);
      loadOverview();
      loadRuns();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Apply failed');
    } finally {
      setApplyBusy(false);
    }
  };

  const revert = async (run: Run) => {
    if (!window.confirm(`Undo this run? Clients still at the location it set go back to their previous location.`)) return;
    try {
      const d = await getJson<{ reverted: number; skippedChangedSince: number }>(`/api/locations/client-locations/runs/${encodeURIComponent(run.runId)}/revert`, { method: 'POST' });
      toast.success(`Reverted ${fmtN(d.reverted)}${d.skippedChangedSince ? `; ${fmtN(d.skippedChangedSince)} changed since and were left alone` : ''}.`);
      loadOverview();
      loadRuns();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Undo failed');
    }
  };

  return (
    <Page>
      <PageHeader
        eyebrow="Admin · Practice & locations"
        title="Locations"
        description="Where clients, visits, staff and Valant charges belong. Location details (address, NPI, POS) are edited in Practice settings."
        actions={
          <>
            <Link href="/dashboard/practice-setup" className={buttonClasses({ variant: 'secondary' })}>
              Practice settings
            </Link>
            <Link href="/dashboard/enterprise" className={buttonClasses()}>
              Practice overview
            </Link>
          </>
        }
      />

      {overviewError ? (
        <Alert
          tone="danger"
          actions={<Button variant="secondary" size="sm" onClick={loadOverview}>Try again</Button>}
        >
          Could not load locations: {overviewError}
        </Alert>
      ) : null}

      {overview?.warnings.length ? (
        <Card>
          <CardHeader title="Data checks" />
          <CardBody>
          <ul className="space-y-2">
            {overview.warnings.map((w) => (
              <li key={w.code} className="flex items-start gap-2 text-sm text-slate-700">
                {w.level === 'warning' ? <AlertTriangle size={16} aria-hidden className="mt-0.5 shrink-0 text-amber-600" /> : <Info size={16} aria-hidden className="mt-0.5 shrink-0 text-slate-400" />}
                <span>
                  {w.message}{' '}
                  {w.href ? <Link href={w.href} className={LINK}>Review</Link> : null}
                </span>
              </li>
            ))}
          </ul>
          </CardBody>
        </Card>
      ) : null}

      {/* Practice facilities (Valant): the practice's sites */}
      {overview?.facilityView ? (
        <Card id="facilities">
          <CardHeader
            title="Practice facilities (Valant)"
            description={
              <>
                The practice&apos;s sites as Valant lists them (Setup › Facilities). The Practice overview and Census group by these. Each facility still maps to an
                Altrixs location or program below, which scheduling and location features use.
              </>
            }
            actions={
              <Link href={overview.facilityView.links.facilityImport} className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
                {overview.facilityView.source === 'expected' ? 'Import facilities' : 'Re-import facilities'}
              </Link>
            }
          />
          <div className="clinic-scroll-x overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th scope="col" className={`${TH} sticky left-0 z-10 bg-slate-50`}>Facility</th>
                  <th scope="col" className={TH}>Billing entity</th>
                  <th scope="col" className={TH}>Time zone</th>
                  <th scope="col" className={TH}>Valant status</th>
                  <th scope="col" className={TH}>Altrixs location / program</th>
                  <th scope="col" className={`${TH} text-right`}>Clients (active)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {overview.facilityView.sites.map((f) => (
                  <tr key={f.facilityName} className="group hover:bg-slate-50">
                    <td className="sticky left-0 z-10 bg-white px-4 py-3 font-semibold text-slate-900 group-hover:bg-slate-50"><Building2 size={14} aria-hidden className="mr-1.5 inline text-blue-600" />{f.facilityName}</td>
                    <td className="px-4 py-3 text-slate-700">
                      {f.billingEntityName ?? '—'}
                      {f.separateBillingEntity ? (
                        <span className="block text-xs text-slate-500">
                          Separate entity: confirm billing provider / NPI in{' '}
                          <Link href={overview.facilityView!.links.billingProviders} className={LINK}>Practice settings › Billing providers</Link>
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-slate-700">{f.timezone ?? '—'}</td>
                    <td className="px-4 py-3">{f.active === null ? '—' : f.active ? <StatusBadge tone="success" size="sm">Active</StatusBadge> : <StatusBadge tone="neutral" size="sm">Inactive</StatusBadge>}</td>
                    <td className="px-4 py-3 text-slate-700">{f.mappedTo}{f.needsConfirmation ? <StatusBadge tone="warning" size="sm" className="ml-1.5">confirm</StatusBadge> : null}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-700">{f.clients ? `${fmtN(f.clients.assigned)} (${fmtN(f.clients.active)})` : '—'}</td>
                  </tr>
                ))}
                {overview.facilityView.expected.map((e) => (
                  <tr key={e.facilityName} className="bg-slate-50/60 text-slate-500">
                    <td className="px-4 py-3 font-semibold">{e.facilityName}</td>
                    <td className="px-4 py-3">{e.billingEntityName}</td>
                    <td className="px-4 py-3">{e.timezone}</td>
                    <td className="px-4 py-3">{e.active ? 'Active' : 'Inactive'}</td>
                    <td className="px-4 py-3 italic" colSpan={2}>Expected from Valant · not imported yet</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {overview.facilityView.clientAssignment.column && overview.facilityView.clientAssignment.withoutFacility > 0 ? (
            <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-600">
              {fmtN(overview.facilityView.clientAssignment.withoutFacility)} of {fmtN(overview.facilityView.clientAssignment.clientsTotal)} clients have no Valant facility: re-import the
              Valant client file on <Link href={overview.facilityView.links.clientImport} className={LINK}>Data import › Clients</Link> with &quot;Facility only&quot;.
            </p>
          ) : null}
        </Card>
      ) : null}

      {/* Locations + evidence */}
      <section className="space-y-3">
      <h2 className="text-base font-semibold text-slate-900">Altrixs locations (scheduling and location features)</h2>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {!overview && !overviewError ? <Card className="lg:col-span-2"><LoadingState label="Loading locations…" /></Card> : null}
        {overview && locations.length === 0 ? (
          <Card className="lg:col-span-2">
            <EmptyState
              icon={<MapPin />}
              title="No locations yet"
              description="Practice locations appear here with their clients, visits and staff. Add them in Practice settings."
            />
          </Card>
        ) : null}
        {locations.map((l) => (
          <Card key={l.id} className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <MapPin size={16} aria-hidden className="shrink-0 text-blue-600" />
                  <h3 className="text-sm font-semibold text-slate-900">{l.name}</h3>
                  {l.isPrimary ? <StatusBadge tone="brand" size="sm">Primary</StatusBadge> : null}
                  {!l.active ? <StatusBadge tone="neutral" size="sm">Inactive</StatusBadge> : null}
                </div>
                <p className="mt-1 text-xs text-slate-500"><Address l={l} /></p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {l.phone ? `${l.phone} · ` : ''}{l.timezone}{l.code ? ` · code ${l.code}` : ''} · NPI / POS: set in{' '}
                  <Link href="/dashboard/practice-setup" className={LINK}>Practice settings</Link>
                </p>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Evidence label="Clients" value={fmtN(l.clients.total)} source={l.sources.clients} />
              <Evidence label="Active clients" value={fmtN(l.clients.active)} source={l.sources.clients} />
              <Evidence label="Valant-imported" value={fmtN(l.clients.valantImported)} source="Client.sourcePlatform = valant" />
              <Evidence
                label="Appointments (90 days)"
                value={`${fmtN(l.appointments.last90.completed)} completed / ${fmtN(l.appointments.last90.total)}`}
                source={l.sources.appointments}
              />
              <Evidence label="Staff" value={`${fmtN(l.staff.count)}${l.staff.shared ? ` (${l.staff.shared} shared)` : ''}`} source={l.sources.staff} />
              <Evidence label="Valant charges (90 days)" value={fmt$(l.valant.last90.chargesCents)} source={l.sources.valant} />
            </div>
          </Card>
        ))}
      </div>
      </section>

      {/* Facility mapping */}
      <Card id="mapping">
        <CardHeader
          title="Valant facility mapping"
          description={
            <>
              Each Valant Transaction Journal facility belongs to a location, or is a program (Family Practice = primary care, IOP, PRP). Only saved rows count.
              Import the Valant facility list on <Link href="/dashboard/admin/migration" className={LINK}>Data import › Import Facilities</Link>.
            </>
          }
          actions={
            <Button
              size="sm"
              icon={<Sparkles />}
              onClick={applySuggested}
              disabled={!suggestions.some((s) => s.basis !== 'none')}
            >
              Apply suggested mapping
            </Button>
          }
        />
        {mapError ? (
          <div className="border-b border-slate-100 px-5 py-3">
            <Alert tone="danger" actions={<Button variant="secondary" size="sm" onClick={loadMapping}>Try again</Button>}>{mapError}</Alert>
          </div>
        ) : null}
        {notes && (notes.locationsWithoutFacility.length || notes.billingEntities.others.length) ? (
          <div className="space-y-1.5 border-b border-slate-100 bg-slate-50/60 px-5 py-3">
            {notes.locationsWithoutFacility.length ? (
              <p className="flex items-start gap-2 text-xs text-slate-700">
                <Info size={14} aria-hidden className="mt-0.5 shrink-0 text-slate-400" />
                <span>
                  {notes.locationsWithoutFacility.map((l) => l.name).join(' and ')}{' '}
                  {notes.locationsWithoutFacility.length === 1 ? 'has' : 'have'} no Valant facility of its own
                  {notes.primaryLocationFacilities.length
                    ? `; visits there appear to bill under ${notes.primaryLocationFacilities.join(', ')}`
                    : ''}
                  . Their Valant charges count under that facility&apos;s location, so per-location revenue reflects the billing facility, not where the visit took place.
                </span>
              </p>
            ) : null}
            {notes.billingEntities.others.length ? (
              <p className="flex items-start gap-2 text-xs text-slate-700">
                <Info size={14} aria-hidden className="mt-0.5 shrink-0 text-slate-400" />
                <span>
                  {notes.billingEntities.others.map((o) => `${o.facilityName} (${o.billingEntityName})`).join(' and ')}{' '}
                  {notes.billingEntities.others.length === 1 ? 'uses' : 'use'} a billing entity other than {notes.billingEntities.mainEntity ?? 'the main one'} and may bill
                  under a separate NPI. Confirm in{' '}
                  <Link href="/dashboard/practice-setup" className={LINK}>Practice settings › Billing providers</Link>.
                </span>
              </p>
            ) : null}
          </div>
        ) : null}
        {suggestions.length ? (
          <div className="border-b border-slate-100 bg-slate-50/60 px-5 py-3">
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Suggestions (not saved)</p>
            <ul className="space-y-1">
              {suggestions.map((s) => (
                <li key={s.facilityName} className="text-xs text-slate-700">
                  <span className="font-semibold">{s.facilityName}</span> <ArrowRight size={12} aria-label="maps to" className="inline text-slate-400" />{' '}
                  {s.kind === 'program' ? programLabel(s.programKey) : s.locationId ? locName(s.locationId) : 'no match'}
                  {s.needsConfirmation && s.basis !== 'none' ? <StatusBadge tone="warning" size="sm" className="ml-1.5">confirm</StatusBadge> : null}
                  <span className="text-slate-500"> · {s.seenInImport ? `${fmtN(s.importedRows)} imported rows` : 'seen in the Valant journal export, not imported yet'}</span>
                  {s.note ? <span className="block text-[11px] text-slate-500">{s.note}</span> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {mappings.length === 0 ? (
          <EmptyState compact icon={<Building2 />} title="No facility mapping saved" description="Apply the suggestions above, or add a facility below." />
        ) : (
          <div className="clinic-scroll-x overflow-x-auto">
            <table className="w-full min-w-[760px] text-left">
              <thead className="bg-slate-50">
                <tr>
                  <th scope="col" className={TH}>Valant facility</th>
                  <th scope="col" className={TH}>Kind</th>
                  <th scope="col" className={TH}>Location / program</th>
                  <th scope="col" className={TH}>Status</th>
                  <th scope="col" className={TH}><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {mappings.map((m) => (
                  <MappingRow key={m.id} row={m} locations={locations} onSaved={refreshAll} />
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex flex-col gap-2 border-t border-slate-200 bg-slate-50/60 px-5 py-3 sm:flex-row sm:items-center">
          <input value={newFacility} onChange={(e) => setNewFacility(e.target.value)} placeholder="Add a facility name exactly as Valant exports it" aria-label="Facility name" className={`${inputClasses} min-w-0 sm:flex-1`} />
          <Button variant="secondary" onClick={addFacility} disabled={!newFacility.trim()}>
            Add facility
          </Button>
        </div>
      </Card>

      {/* Recompute client locations */}
      <Card id="recompute">
        <CardHeader
          title="Recompute client locations"
          description={
            <>
              Preview first; nothing changes until you apply. Evidence: imported Valant journal charges at a mapped location facility
              (at least {RULES.minJournalRows} rows, {Math.round(RULES.minShare * 100)}% at one location, confirmed mapping) and visits with clinicians who work at one
              location only (at least {RULES.minClinicianWeight}). A client at the primary location moves on one strong source. A client at another
              location is never moved back to the primary location, and moves elsewhere only when both sources agree. Every change is recorded and can be undone.
            </>
          }
          actions={
            <Button variant="secondary" size="sm" icon={<RefreshCw />} loading={previewBusy} onClick={runPreview}>
              {previewBusy ? 'Computing…' : 'Run preview'}
            </Button>
          }
        />
        {preview ? (
          <div className="space-y-4 px-5 py-4">
            <p className="text-xs text-slate-500">
              Evidence available: {fmtN(preview.evidenceAvailable.journalRows)} journal charge rows with a facility, {preview.evidenceAvailable.savedMappings} saved facility mappings,{' '}
              {preview.evidenceAvailable.staffWithOneLocation} staff linked to one location, {preview.evidenceAvailable.staffWithSeveralLocations} to several.
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {(Object.keys(REASON_LABELS) as RecomputeReason[]).map((r) => (
                <div key={r} className="rounded-lg bg-slate-50 px-3 py-2">
                  <p className="text-[11px] text-slate-500">{REASON_LABELS[r]}</p>
                  <p className="text-sm font-semibold text-slate-900">{fmtN(preview.summary.byReason[r])}</p>
                </div>
              ))}
            </div>
            {preview.summary.moves.length ? (
              <div>
                <p className="mb-1 text-xs font-semibold text-slate-700">Planned moves</p>
                <ul className="space-y-0.5 text-xs text-slate-700">
                  {preview.summary.moves.map((m) => (
                    <li key={`${m.fromLocationId}>${m.toLocationId}`} className="flex flex-wrap items-center gap-1">{locName(m.fromLocationId)} <ArrowRight size={12} aria-label="to" className="text-slate-400" /> {locName(m.toLocationId)}: {fmtN(m.count)}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-xs font-semibold text-slate-700">No client would change location with the evidence available now.</p>
            )}
            {preview.sample.length ? (
              <div className="clinic-scroll-x overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full text-left text-xs text-slate-700">
                  <thead className="bg-slate-50">
                    <tr>
                      <th scope="col" className="px-3 py-2 text-xs font-semibold text-slate-600">Client</th>
                      <th scope="col" className="px-3 py-2 text-xs font-semibold text-slate-600">Result</th>
                      <th scope="col" className="px-3 py-2 text-xs font-semibold text-slate-600">Current / new</th>
                      <th scope="col" className="px-3 py-2 text-xs font-semibold text-slate-600">Evidence</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {preview.sample.map((s) => (
                      <tr key={s.clientId} className="hover:bg-slate-50">
                        <td className="px-3 py-2">
                          <Link href={`/dashboard/clients/${s.clientId}`} className="font-semibold text-slate-900 hover:underline">{s.clientName ?? 'Client'}</Link>
                          {s.mrn ? <span className="text-slate-500"> · {s.mrn}</span> : null}
                        </td>
                        <td className="px-3 py-2">{REASON_LABELS[s.reason]}</td>
                        <td className="px-3 py-2">
                          {locName(s.fromLocationId)}
                          {s.reason === 'move' ? (
                            <>
                              {' '}<ArrowRight size={12} aria-label="to" className="inline text-slate-400" /> {locName(s.toLocationId)}
                            </>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-slate-500">
                          {s.verdicts.filter((v) => v.locationId).map((v) => (
                            <span key={v.source} className="mr-2 inline-block">
                              {v.source === 'journal' ? 'Valant facility' : 'Clinician'}: {locName(v.locationId)} {v.count}/{v.total}
                              {v.strong ? '' : ` (weak: ${v.weakReason})`}
                            </span>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="border-t border-slate-100 px-3 py-2 text-[11px] text-slate-500">Showing up to 200 moves and 50 of each kept group.</p>
              </div>
            ) : null}
            <div className="flex justify-end">
              <Button
                onClick={applyPlan}
                disabled={applyBusy || preview.summary.byReason.move === 0}
              >
                {applyBusy ? 'Applying…' : `Apply ${fmtN(preview.summary.byReason.move)} changes`}
              </Button>
            </div>
          </div>
        ) : (
          <p className="px-5 py-4 text-sm text-slate-500">Run the preview to see which clients would change location and why.</p>
        )}
        {runs.length ? (
          <div className="border-t border-slate-100 px-5 py-3">
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Applied runs</p>
            <ul className="space-y-1">
              {runs.map((r) => (
                <li key={r.runId} className="flex flex-wrap items-center gap-2 text-xs text-slate-700">
                  <span>{r.appliedAt ? new Date(r.appliedAt).toLocaleString() : '—'}</span>
                  <span>· {fmtN(r.changes)} changes{r.reverted ? ` · ${fmtN(r.reverted)} undone` : ''}</span>
                  {r.reverted < r.changes ? (
                    <Button variant="secondary" size="sm" icon={<RotateCcw />} onClick={() => revert(r)}>
                      Undo
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Card>
    </Page>
  );
}
