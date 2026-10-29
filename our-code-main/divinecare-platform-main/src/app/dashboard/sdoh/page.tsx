'use client';

import { useMemo, useState, useEffect, type ReactNode } from 'react';
import {
  Banknote,
  Bus,
  ChevronDown,
  ChevronUp,
  Home,
  Phone,
  Plus,
  Search,
  Shield,
  ShoppingBasket,
  Users,
  X,
  HeartHandshake,
  Clock3,
} from 'lucide-react';
import { useModuleList } from '@/lib/modules/useModuleList';
import { useClients } from '@/features/clients';

import {
  type DomainKey,
  type NeedLevel,
  type DomainResponse,
  type Screening,
  type Resource,
} from '@/features/analytics/sdohData';

const DOMAIN_META: Record<
  DomainKey,
  { label: string; icon: ReactNode; question: string }
> = {
  housing: {
    label: 'Housing',
    icon: <Home size={16} />,
    question: 'Do you have a safe, stable place to sleep tonight?',
  },
  food: {
    label: 'Food',
    icon: <ShoppingBasket size={16} />,
    question: 'In the past month, have you worried about running out of food?',
  },
  transport: {
    label: 'Transport',
    icon: <Bus size={16} />,
    question: 'Do you have reliable transportation to appointments?',
  },
  safety: {
    label: 'Safety',
    icon: <Shield size={16} />,
    question: 'Do you feel safe in your home and relationships?',
  },
  financial: {
    label: 'Financial',
    icon: <Banknote size={16} />,
    question: 'Are you able to pay for basic needs like utilities and medications?',
  },
  social: {
    label: 'Social',
    icon: <Users size={16} />,
    question: 'Do you have people you can turn to for emotional support?',
  },
};

const NEED_STYLE: Record<NeedLevel, { label: string; bg: string; text: string; bar: string }> = {
  none: { label: 'None', bg: 'bg-emerald-50', text: 'text-emerald-700', bar: '#10b981' },
  some: { label: 'Some', bg: 'bg-amber-50', text: 'text-amber-700', bar: '#f59e0b' },
  significant: { label: 'Significant', bg: 'bg-rose-50', text: 'text-rose-700', bar: '#ef4444' },
};

function overallFromDomains(domains: { needLevel: NeedLevel }[]): NeedLevel {
  if (domains.some((d) => d.needLevel === 'significant')) return 'significant';
  if (domains.some((d) => d.needLevel === 'some')) return 'some';
  return 'none';
}

function AddScreeningModal({
  open,
  onClose,
  onSave,
  resources,
  clientNames,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (s: Screening) => void;
  resources: Resource[];
  clientNames: string[];
}) {
  const roster = clientNames.length > 0 ? clientNames : ['No clients yet'];
  const [client, setClient] = useState(roster[0]);
  useEffect(() => {
    if (open && clientNames[0]) setClient(clientNames[0]);
  }, [open, clientNames]);
  const [screener, setScreener] = useState('Marcus Williams, LCSW');
  const [notes, setNotes] = useState('');
  const [levels, setLevels] = useState<Record<DomainKey, NeedLevel>>(
    () =>
      Object.fromEntries((Object.keys(DOMAIN_META) as DomainKey[]).map((k) => [k, 'none'])) as Record<
        DomainKey,
        NeedLevel
      >
  );
  const [answers, setAnswers] = useState<Record<DomainKey, string>>(
    () => Object.fromEntries((Object.keys(DOMAIN_META) as DomainKey[]).map((k) => [k, ''])) as Record<DomainKey, string>
  );

  if (!open) return null;

  function submit() {
    const domains: DomainResponse[] = (Object.keys(DOMAIN_META) as DomainKey[]).map((domain) => {
      const needLevel = levels[domain];
      const matched =
        needLevel === 'none'
          ? []
          : resources
              .filter((r) => r.domain === domain)
              .slice(0, needLevel === 'significant' ? 2 : 1)
              .map((r) => r.name);
      return {
        domain,
        question: DOMAIN_META[domain].question,
        answer: answers[domain].trim() || (needLevel === 'none' ? 'No concerns reported' : 'Need identified'),
        needLevel,
        resourcesMatched: matched,
      };
    });
    onSave({
      id: `s-${Date.now()}`,
      client,
      date: new Date().toISOString().slice(0, 10),
      screener,
      overallNeed: overallFromDomains(domains),
      domains,
      notes: notes.trim(),
    });
    setNotes('');
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Add SDOH screening</h2>
            <p className="text-sm text-slate-500">Document domain needs and auto-match resources</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-50">
            <X size={18} />
          </button>
        </div>
        <div className="space-y-4 p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1.5 text-sm">
              <span className="font-medium text-slate-700">Client</span>
              <select
                value={client}
                onChange={(e) => setClient(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2.5 outline-none focus:ring-2 focus:ring-indigo-400"
              >
                {roster.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1.5 text-sm">
              <span className="font-medium text-slate-700">Screener</span>
              <input
                value={screener}
                onChange={(e) => setScreener(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2.5 outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </label>
          </div>
          {(Object.keys(DOMAIN_META) as DomainKey[]).map((domain) => (
            <div key={domain} className="rounded-xl border border-slate-200 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <span className="grid h-8 w-8 place-items-center rounded-lg bg-indigo-50 text-indigo-600">
                    {DOMAIN_META[domain].icon}
                  </span>
                  {DOMAIN_META[domain].label}
                </div>
                <select
                  value={levels[domain]}
                  onChange={(e) =>
                    setLevels((prev) => ({ ...prev, [domain]: e.target.value as NeedLevel }))
                  }
                  className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs font-semibold outline-none"
                >
                  <option value="none">None</option>
                  <option value="some">Some</option>
                  <option value="significant">Significant</option>
                </select>
              </div>
              <p className="mt-2 text-xs text-slate-500">{DOMAIN_META[domain].question}</p>
              <input
                value={answers[domain]}
                onChange={(e) => setAnswers((prev) => ({ ...prev, [domain]: e.target.value }))}
                placeholder="Answer / notes"
                className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </div>
          ))}
          <label className="block space-y-1.5 text-sm">
            <span className="font-medium text-slate-700">Overall notes</span>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </label>
        </div>
        <div className="flex gap-3 border-t border-slate-200 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            className="flex-1 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            Save screening
          </button>
        </div>
      </div>
    </div>
  );
}

function ScreeningRow({ screening }: { screening: Screening }) {
  const [open, setOpen] = useState(false);
  const overall = NEED_STYLE[screening.overallNeed];
  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-3 p-4 text-left">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-indigo-50 text-indigo-600">
          <HeartHandshake size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-slate-900">{screening.client}</span>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${overall.bg} ${overall.text}`}>
              {overall.label} need
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {screening.date} · {screening.screener}
          </p>
        </div>
        {open ? <ChevronUp size={18} className="text-slate-400" /> : <ChevronDown size={18} className="text-slate-400" />}
      </button>
      {open && (
        <div className="space-y-3 border-t border-slate-100 px-4 pb-4 pt-3">
          {screening.notes && (
            <p className="rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2 text-sm text-slate-700">
              {screening.notes}
            </p>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            {screening.domains.map((d) => {
              const meta = DOMAIN_META[d.domain];
              const need = NEED_STYLE[d.needLevel];
              return (
                <div key={d.domain} className="rounded-xl border border-slate-200 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                      <span className="text-indigo-600">{meta.icon}</span>
                      {meta.label}
                    </div>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${need.bg} ${need.text}`}>
                      {need.label}
                    </span>
                  </div>
                  <p className="mt-1.5 text-xs text-slate-500">{d.question}</p>
                  <p className="mt-1 text-sm text-slate-700">{d.answer}</p>
                  {d.resourcesMatched.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {d.resourcesMatched.map((r) => (
                        <span key={r} className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-600">
                          {r}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default function SdohPage() {
  const { clients } = useClients();
  const clientNames = useMemo(() => clients.map((c) => c.name).filter(Boolean), [clients]);
  const [screenings, setScreenings, { loading: loadingScreenings }] = useModuleList<Screening>(
    'sdoh-screenings',
    []
  );
  const [resources, , { loading: loadingResources }] = useModuleList<Resource>('sdoh-resources', []);
  const [query, setQuery] = useState('');
  const [needFilter, setNeedFilter] = useState<'all' | NeedLevel>('all');
  const [domainFilter, setDomainFilter] = useState<'all' | DomainKey>('all');
  const [modalOpen, setModalOpen] = useState(false);

  const loading = loadingScreenings || loadingResources;

  const filteredScreenings = useMemo(() => {
    return screenings.filter((s) => {
      if (needFilter !== 'all' && s.overallNeed !== needFilter) return false;
      if (domainFilter !== 'all' && !s.domains.some((d) => d.domain === domainFilter && d.needLevel !== 'none')) {
        return false;
      }
      if (!query.trim()) return true;
      const q = query.toLowerCase();
      return s.client.toLowerCase().includes(q) || s.screener.toLowerCase().includes(q) || s.notes.toLowerCase().includes(q);
    });
  }, [screenings, needFilter, domainFilter, query]);

  const filteredResources = useMemo(() => {
    if (domainFilter === 'all') return resources;
    return resources.filter((r) => r.domain === domainFilter);
  }, [resources, domainFilter]);

  const stats = useMemo(() => {
    const significant = screenings.filter((s) => s.overallNeed === 'significant').length;
    const some = screenings.filter((s) => s.overallNeed === 'some').length;
    const none = screenings.filter((s) => s.overallNeed === 'none').length;
    const domainCounts = (Object.keys(DOMAIN_META) as DomainKey[]).map((domain) => ({
      domain,
      count: screenings.filter((s) => s.domains.some((d) => d.domain === domain && d.needLevel !== 'none')).length,
    }));
    const max = Math.max(1, ...domainCounts.map((d) => d.count));
    return { significant, some, none, domainCounts, max, total: screenings.length };
  }, [screenings]);

  if (loading && screenings.length === 0 && resources.length === 0) {
    return <p className="text-sm text-slate-500">Loading…</p>;
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-indigo-600">Social care</p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">SDOH Screening</h1>
          <p className="mt-1 text-sm text-slate-500">Domain needs, matched resources, and community directory</p>
        </div>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700"
        >
          <Plus size={16} /> Add screening
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Screenings', value: stats.total, tone: 'text-indigo-600 bg-indigo-50' },
          { label: 'Significant need', value: stats.significant, tone: 'text-rose-600 bg-rose-50' },
          { label: 'Some need', value: stats.some, tone: 'text-amber-600 bg-amber-50' },
          { label: 'No identified need', value: stats.none, tone: 'text-emerald-600 bg-emerald-50' },
        ].map((s) => (
          <div key={s.label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium text-slate-500">{s.label}</p>
            <p className="mt-2 text-3xl font-bold text-slate-900">{s.value}</p>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Needs by domain</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {stats.domainCounts.map((row) => (
            <button
              key={row.domain}
              type="button"
              onClick={() => setDomainFilter(domainFilter === row.domain ? 'all' : row.domain)}
              className={`rounded-xl border p-3 text-left transition ${
                domainFilter === row.domain ? 'border-indigo-600 bg-indigo-50' : 'border-slate-200 hover:bg-slate-50'
              }`}
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="inline-flex items-center gap-2 text-sm font-semibold text-slate-800">
                  <span className="text-indigo-600">{DOMAIN_META[row.domain].icon}</span>
                  {DOMAIN_META[row.domain].label}
                </span>
                <span className="text-sm font-bold text-slate-900">{row.count}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${(row.count / stats.max) * 100}%`, backgroundColor: '#4F46E5' }}
                />
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="relative min-w-[180px] flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search client or notes…"
            className="w-full rounded-xl border border-slate-200 py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-indigo-400"
          />
        </div>
        <select
          value={needFilter}
          onChange={(e) => setNeedFilter(e.target.value as 'all' | NeedLevel)}
          className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-400"
        >
          <option value="all">All need levels</option>
          <option value="significant">Significant</option>
          <option value="some">Some</option>
          <option value="none">None</option>
        </select>
        <select
          value={domainFilter}
          onChange={(e) => setDomainFilter(e.target.value as 'all' | DomainKey)}
          className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-400"
        >
          <option value="all">All domains</option>
          {(Object.keys(DOMAIN_META) as DomainKey[]).map((d) => (
            <option key={d} value={d}>
              {DOMAIN_META[d].label}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        <div className="space-y-3 lg:col-span-3">
          <h2 className="text-sm font-semibold text-slate-900">Screenings ({filteredScreenings.length})</h2>
          {filteredScreenings.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-10 text-center text-sm text-slate-500">
              {query || needFilter !== 'all' || domainFilter !== 'all'
                ? 'No screenings match your filters.'
                : 'No SDOH screenings recorded yet. Click "Add screening" to document social care needs.'}
            </div>
          ) : (
            filteredScreenings.map((s) => <ScreeningRow key={s.id} screening={s} />)
          )}
        </div>

        <div className="lg:col-span-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Resource directory</h2>
            <div className="space-y-3">
              {filteredResources.map((r) => (
                <div key={r.id} className="rounded-xl border border-slate-200 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{r.name}</p>
                      <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-indigo-600">
                        {DOMAIN_META[r.domain].icon}
                        {DOMAIN_META[r.domain].label}
                      </p>
                    </div>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                      {r.cost}
                    </span>
                  </div>
                  <div className="mt-2 space-y-1 text-xs text-slate-600">
                    <p className="inline-flex items-center gap-1.5">
                      <Phone size={12} className="text-slate-400" /> {r.phone}
                    </p>
                    <p className="flex items-center gap-1.5">
                      <Clock3 size={12} className="text-slate-400" /> {r.hours}
                    </p>
                    <p className="text-slate-500">{r.notes}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <AddScreeningModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSave={(s) => setScreenings((prev) => [s, ...prev])}
        resources={resources}
        clientNames={clientNames}
      />
    </div>
  );
}
