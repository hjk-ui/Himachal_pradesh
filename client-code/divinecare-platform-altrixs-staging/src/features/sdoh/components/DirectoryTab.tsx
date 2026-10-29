'use client';

import { useMemo, useState } from 'react';
import { BadgeCheck, Clock3, Download, FileDown, Globe, Mail, MapPin, Pencil, Phone, Plus, Search, Upload, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { RESOURCE_DOMAIN_LABEL, RESOURCE_DOMAINS, type ResourceDomain } from '@/lib/sdoh/workflow';
import { COUNTIES, countyLabel, csvTemplate } from '@/lib/resources/community';
import { downloadTextFile } from '@/lib/browser/downloadFile';
import { sdohApi, type ResourceForm, type SdohResourceDto } from '../api';
import { DomainIcon, EmptyState, Pill, formatDate, inputCls, primaryBtn, secondaryBtn } from './ui';

const EMPTY: ResourceForm = {
  name: '',
  domains: [],
  address: '',
  city: '',
  state: '',
  postalCode: '',
  phone: '',
  website: '',
  hours: '',
  languages: [],
  cost: '',
  eligibilityNotes: '',
  active: true,
  counties: [],
  email: '',
  verificationSource: '',
};

function ResourceModal({ initial, onClose, onSaved }: { initial: SdohResourceDto | null; onClose: () => void; onSaved: (r: SdohResourceDto) => void }) {
  const [form, setForm] = useState<ResourceForm>(() => (initial ? { ...EMPTY, ...initial } : EMPTY));
  const [langText, setLangText] = useState((initial?.languages ?? []).join(', '));
  const [verified, setVerified] = useState(false);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof ResourceForm>(k: K, v: ResourceForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function save() {
    if (!form.name.trim()) return toast.error('Enter the resource name');
    if (!form.domains.length) return toast.error('Pick at least one need it helps with');
    setSaving(true);
    try {
      const body: ResourceForm = {
        ...form,
        languages: langText.split(',').map((x) => x.trim()).filter(Boolean),
        verified,
      };
      const { resource } = initial ? await sdohApi.updateResource(initial.id, body) : await sdohApi.createResource(body);
      onSaved(resource);
      toast.success(initial ? 'Resource updated' : 'Resource added');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  const field = (k: 'address' | 'city' | 'state' | 'postalCode' | 'phone' | 'website' | 'hours' | 'cost', label: string, placeholder = '') => (
    <label className="space-y-1 text-sm">
      <span className="font-medium text-slate-700">{label}</span>
      <input value={(form[k] as string | null) ?? ''} placeholder={placeholder} onChange={(e) => set(k, e.target.value)} className={inputCls} />
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 sm:items-center sm:p-4">
      <div className="max-h-[90dvh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-white shadow-xl sm:rounded-3xl">
        <div className="sticky top-0 flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-4">
          <h2 className="text-lg font-semibold text-slate-900">{initial ? 'Edit resource' : 'Add a resource'}</h2>
          <button type="button" onClick={onClose} className="inline-flex h-10 w-10 shrink-0 md:h-8 md:w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-50" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="space-y-4 p-5">
          <label className="block space-y-1 text-sm">
            <span className="font-medium text-slate-700">Name</span>
            <input value={form.name} onChange={(e) => set('name', e.target.value)} className={inputCls} />
          </label>
          <div className="space-y-1.5">
            <p className="text-sm font-medium text-slate-700">Helps with</p>
            <div className="flex flex-wrap gap-2">
              {RESOURCE_DOMAINS.map((d) => {
                const on = form.domains.includes(d);
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => set('domains', on ? form.domains.filter((x) => x !== d) : [...form.domains, d])}
                    className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-full border px-3 text-sm ${
                      on ? 'border-[#5C2D91] bg-[#5C2D91]/10 font-semibold text-[#5C2D91]' : 'border-slate-200 text-slate-700'
                    }`}
                  >
                    <DomainIcon domain={d} /> {RESOURCE_DOMAIN_LABEL[d]}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="space-y-1.5">
            <p className="text-sm font-medium text-slate-700">Service area</p>
            <div className="flex flex-wrap gap-2">
              {COUNTIES.map((c) => {
                const list = form.counties ?? [];
                const on = list.includes(c.value);
                return (
                  <button
                    key={c.value}
                    type="button"
                    aria-pressed={on}
                    onClick={() => set('counties', on ? list.filter((x) => x !== c.value) : [...list, c.value])}
                    className={`inline-flex min-h-[40px] items-center rounded-full border px-3 text-sm ${on ? 'border-[#5C2D91] bg-[#5C2D91]/10 font-semibold text-[#5C2D91]' : 'border-slate-200 text-slate-700'}`}
                  >
                    {c.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {field('phone', 'Phone')}
            <label className="space-y-1 text-sm">
              <span className="font-medium text-slate-700">Email</span>
              <input value={form.email ?? ''} onChange={(e) => set('email', e.target.value)} className={inputCls} />
            </label>
            {field('website', 'Website', 'https://')}
            <div className="sm:col-span-2">{field('address', 'Street address')}</div>
            {field('city', 'City')}
            <div className="grid grid-cols-2 gap-3">
              {field('state', 'State')}
              {field('postalCode', 'ZIP')}
            </div>
            {field('hours', 'Hours')}
            {field('cost', 'Cost', 'Free, sliding scale…')}
            <label className="space-y-1 text-sm sm:col-span-2">
              <span className="font-medium text-slate-700">Languages (comma separated)</span>
              <input value={langText} onChange={(e) => setLangText(e.target.value)} placeholder="English, Spanish" className={inputCls} />
            </label>
          </div>
          <label className="block space-y-1 text-sm">
            <span className="font-medium text-slate-700">Eligibility and how to refer</span>
            <textarea rows={3} value={form.eligibilityNotes ?? ''} onChange={(e) => set('eligibilityNotes', e.target.value)} className={inputCls} />
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" className="h-5 w-5 accent-[#5C2D91]" checked={verified} onChange={(e) => setVerified(e.target.checked)} />
            I checked these details with the organization today
          </label>
          <label className="block space-y-1 text-sm">
            <span className="font-medium text-slate-700">How it was verified</span>
            <input value={form.verificationSource ?? ''} onChange={(e) => set('verificationSource', e.target.value)} placeholder="Agency website URL, or phone call" className={inputCls} />
          </label>
          {initial && (
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" className="h-5 w-5 accent-[#5C2D91]" checked={form.active} onChange={(e) => set('active', e.target.checked)} />
              Active (uncheck to hide it from referral pickers)
            </label>
          )}
        </div>
        <div className="sticky bottom-0 flex gap-3 border-t border-slate-200 bg-white px-5 py-4">
          <button type="button" onClick={onClose} className={`${secondaryBtn} flex-1`}>
            Cancel
          </button>
          <button type="button" onClick={save} disabled={saving} className={`${primaryBtn} flex-1`}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function DirectoryTab({
  resources,
  legacyAvailable,
  onChanged,
}: {
  resources: SdohResourceDto[];
  legacyAvailable: number;
  onChanged: () => void;
}) {
  const [q, setQ] = useState('');
  const [domain, setDomain] = useState<'all' | ResourceDomain>('all');
  const [city, setCity] = useState('all');
  const [county, setCounty] = useState('all');
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<SdohResourceDto | 'new' | null>(null);
  const [importing, setImporting] = useState(false);

  const cities = useMemo(() => [...new Set(resources.map((r) => r.city?.trim()).filter((c): c is string => Boolean(c)))].sort(), [resources]);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return resources.filter((r) => {
      if (!showInactive && !r.active) return false;
      if (domain !== 'all' && !r.domains.includes(domain)) return false;
      if (city !== 'all' && (r.city ?? '').trim() !== city) return false;
      if (county !== 'all' && !(r.counties ?? []).includes(county) && !(r.counties ?? []).includes('statewide')) return false;
      if (!needle) return true;
      return [r.name, r.eligibilityNotes, r.address, r.city, r.languages.join(' ')].some((x) => (x ?? '').toLowerCase().includes(needle));
    });
  }, [resources, q, domain, city, county, showInactive]);

  async function importCsv(file: File) {
    setImporting(true);
    try {
      const r = await sdohApi.importCsv(await file.text());
      const errs = r.errors.length ? ` · ${r.errors.length} row${r.errors.length === 1 ? '' : 's'} skipped: ${r.errors.slice(0, 3).map((e) => `line ${e.line} ${e.error}`).join('; ')}` : '';
      toast.success(`Imported ${r.created} agenc${r.created === 1 ? 'y' : 'ies'}${errs}`, { duration: 8000 });
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  }

  async function runImport() {
    setImporting(true);
    try {
      const r = await sdohApi.importLegacy();
      toast.success(`Imported ${r.created} resource${r.created === 1 ? '' : 's'}${r.skipped ? ` (${r.skipped} already imported)` : ''}`);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  }

  async function markVerified(r: SdohResourceDto) {
    try {
      await sdohApi.updateResource(r.id, { verified: true });
      toast.success('Marked verified today');
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="relative w-full min-w-0 sm:w-auto sm:min-w-[16rem] sm:flex-[1_1_20rem]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, language, notes…" className={`${inputCls} pl-9`} aria-label="Search resources" />
        </div>
        <select value={domain} onChange={(e) => setDomain(e.target.value as typeof domain)} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm sm:w-auto" aria-label="Need">
          <option value="all">All needs</option>
          {RESOURCE_DOMAINS.map((d) => (
            <option key={d} value={d}>
              {RESOURCE_DOMAIN_LABEL[d]}
            </option>
          ))}
        </select>
        <select value={city} onChange={(e) => setCity(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm sm:w-auto" aria-label="City">
          <option value="all">All cities</option>
          {cities.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select value={county} onChange={(e) => setCounty(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm sm:w-auto" aria-label="Service area">
          <option value="all">All areas</option>
          {COUNTIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 px-1 text-sm text-slate-600">
          <input type="checkbox" className="accent-[#5C2D91]" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Inactive
        </label>
        <button type="button" className={secondaryBtn} onClick={() => downloadTextFile('community-resources-template.csv', csvTemplate())}>
          <FileDown size={16} /> CSV template
        </button>
        <label className={`${secondaryBtn} cursor-pointer`}>
          <Upload size={16} /> {importing ? 'Importing…' : 'Import CSV'}
          <input
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            disabled={importing}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void importCsv(f);
            }}
          />
        </label>
        <button type="button" className={primaryBtn} onClick={() => setEditing('new')}>
          <Plus size={16} /> Add resource
        </button>
      </div>

      {legacyAvailable > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p>
            The previous SDOH page has {legacyAvailable} resource{legacyAvailable === 1 ? '' : 's'} that are not in this directory. Import copies them once,
            marked “Imported — verify details”.
          </p>
          <button type="button" className={secondaryBtn} disabled={importing} onClick={runImport}>
            <Download size={16} /> {importing ? 'Importing…' : 'Import existing resource list'}
          </button>
        </div>
      )}

      {resources.length === 0 ? (
        <EmptyState title="The directory is empty">
          Add the community organizations your staff refer to: food pantries, housing programs, utility assistance, transportation, DV
          services. Use <strong>Add resource</strong>, pick the needs it helps with, and include the phone number and how to refer.
        </EmptyState>
      ) : rows.length === 0 ? (
        <EmptyState title="No resources match these filters" />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {rows.map((r) => (
            <div key={r.id} className={`rounded-2xl border bg-white p-4 shadow-sm ${r.active ? 'border-slate-200' : 'border-dashed border-slate-300 opacity-70'}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900">{r.name}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {r.domains.map((d) => (
                      <Pill key={d} tone="brand">
                        <DomainIcon domain={d} /> {RESOURCE_DOMAIN_LABEL[d] ?? d}
                      </Pill>
                    ))}
                  </div>
                </div>
                <button type="button" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label={`Edit ${r.name}`} onClick={() => setEditing(r)}>
                  <Pencil size={16} />
                </button>
              </div>
              <div className="mt-3 space-y-1 text-sm text-slate-700">
                {(r.counties ?? []).length > 0 && (
                  <p className="text-xs text-slate-500">Serves: {(r.counties ?? []).map(countyLabel).join(', ')}</p>
                )}
                {r.email && (
                  <a href={`mailto:${r.email}`} className="flex items-center gap-1.5 hover:underline">
                    <Mail size={14} className="text-slate-400" /> {r.email}
                  </a>
                )}
                {r.phone && (
                  <a href={`tel:${r.phone.replace(/[^\d+]/g, '')}`} className="flex items-center gap-1.5 hover:underline">
                    <Phone size={14} className="text-slate-400" /> {r.phone}
                  </a>
                )}
                {(r.address || r.city) && (
                  <p className="flex items-center gap-1.5">
                    <MapPin size={14} className="text-slate-400" /> {[r.address, r.city, r.state, r.postalCode].filter(Boolean).join(', ')}
                  </p>
                )}
                {r.hours && (
                  <p className="flex items-center gap-1.5">
                    <Clock3 size={14} className="text-slate-400" /> {r.hours}
                  </p>
                )}
                {r.website && (
                  <a href={r.website} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-[#5C2D91] hover:underline">
                    <Globe size={14} /> Website
                  </a>
                )}
                {r.languages.length > 0 && <p className="text-xs text-slate-500">Languages: {r.languages.join(', ')}</p>}
                {r.cost && <p className="text-xs text-slate-500">Cost: {r.cost}</p>}
                {r.eligibilityNotes && <p className="text-xs text-slate-500">{r.eligibilityNotes}</p>}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                {r.lastVerifiedAt ? (
                  <span className="inline-flex items-center gap-1 text-emerald-700">
                    <BadgeCheck size={14} /> Verified {formatDate(r.lastVerifiedAt)}
                    {r.source === 'seed' ? ' (statewide starter entry)' : ''}
                  </span>
                ) : (
                  <>
                    <Pill tone="amber">{r.source === 'legacy' ? 'Imported — verify details' : 'Not verified'}</Pill>
                    <button type="button" className="font-semibold text-[#5C2D91] hover:underline" onClick={() => markVerified(r)}>
                      Mark verified
                    </button>
                  </>
                )}
                {!r.active && <Pill>Inactive</Pill>}
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <ResourceModal
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onChanged();
          }}
        />
      )}
    </div>
  );
}
