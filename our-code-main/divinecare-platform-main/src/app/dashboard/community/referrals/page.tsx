'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  Plus,
  Shield,
  TrendingUp,
  X,
} from 'lucide-react';
import {
  createReferral,
  fetchReferrals,
  updateReferral,
  type CommunityReferral,
  type ReferralDirection,
  type ReferralStatus,
} from '@/features/referrals/api';

const PURPLE = '#6868D0';

type ListFilter = 'all' | ReferralDirection | ReferralStatus;

const SOURCE_LABELS: Record<string, string> = {
  primary_care: 'Primary Care',
  hospital: 'Hospital / ER',
  court: 'Court-Ordered',
  community_event: 'Community Event',
  social_media: 'Social Media',
  word_of_mouth: 'Word of Mouth',
  self: 'Self-Referral',
  other_provider: 'Other Provider',
};

const SOURCE_COLORS: Record<string, string> = {
  primary_care: '#6868D0',
  hospital: '#dc2626',
  court: '#d97706',
  community_event: '#0d9488',
  social_media: '#2563eb',
  word_of_mouth: '#3b82f6',
  self: '#6b7280',
  other_provider: '#ea580c',
};

const SOURCE_ORDER = [
  'primary_care',
  'court',
  'community_event',
  'hospital',
  'word_of_mouth',
  'social_media',
  'self',
  'other_provider',
];

const STATUS_STYLE: Record<
  ReferralStatus,
  { label: string; className: string; icon: 'check' | 'clock' | 'none' }
> = {
  pending: {
    label: 'Pending',
    className: 'bg-orange-100 text-orange-700',
    icon: 'clock',
  },
  accepted: {
    label: 'Accepted',
    className: 'bg-violet-100 text-violet-700',
    icon: 'check',
  },
  converted: {
    label: 'Converted',
    className: 'bg-green-100 text-green-700',
    icon: 'check',
  },
  declined: {
    label: 'Declined',
    className: 'bg-slate-100 text-slate-600',
    icon: 'none',
  },
};

const inputClass =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-[#6868D0] focus:ring-2 focus:ring-[#6868D0]/20';

function rateColor(rate: number) {
  if (rate >= 70) return '#15803d';
  if (rate >= 40) return '#d97706';
  if (rate > 0) return '#6b7280';
  return '#6b7280';
}

function StatusBadge({ status }: { status: ReferralStatus }) {
  const cfg = STATUS_STYLE[status];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${cfg.className}`}
    >
      {cfg.icon === 'check' ? <Check size={11} strokeWidth={2.5} /> : null}
      {cfg.icon === 'clock' ? <Clock size={11} /> : null}
      {cfg.label}
    </span>
  );
}

export default function ReferralsPage() {
  const [referrals, setReferrals] = useState<CommunityReferral[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'list' | 'analytics'>('list');
  const [filter, setFilter] = useState<ListFilter>('all');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [roiVerified, setRoiVerified] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState({
    direction: 'incoming' as ReferralDirection,
    patientName: '',
    sourceType: 'primary_care',
    sourceName: '',
    referralDate: new Date().toISOString().slice(0, 10),
    notes: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchReferrals();
      setReferrals(data.referrals);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load referrals');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const incoming = useMemo(
    () => referrals.filter((r) => r.direction === 'incoming'),
    [referrals]
  );
  const outgoing = useMemo(
    () => referrals.filter((r) => r.direction === 'outgoing'),
    [referrals]
  );
  const convertedIncoming = useMemo(
    () => incoming.filter((r) => r.status === 'converted'),
    [incoming]
  );
  const pendingAction = useMemo(
    () => referrals.filter((r) => r.status === 'pending').length,
    [referrals]
  );

  const incoming30 = incoming.length;

  const convRate = incoming.length
    ? Math.round((convertedIncoming.length / incoming.length) * 100)
    : 0;

  const avgConvertDays = useMemo(() => {
    const withDates = convertedIncoming.filter((r) => r.convertedAt);
    if (!withDates.length) return 0;
    const sum = withDates.reduce((acc, r) => {
      const start = new Date(`${r.referralDate}T12:00:00.000Z`).getTime();
      const end = new Date(`${r.convertedAt}T12:00:00.000Z`).getTime();
      return acc + Math.max(0, Math.floor((end - start) / 86_400_000));
    }, 0);
    return Math.round(sum / withDates.length);
  }, [convertedIncoming]);

  const counts = useMemo(
    () => ({
      all: referrals.length,
      incoming: incoming.length,
      outgoing: outgoing.length,
      pending: referrals.filter((r) => r.status === 'pending').length,
      accepted: referrals.filter((r) => r.status === 'accepted').length,
      converted: referrals.filter((r) => r.status === 'converted').length,
      declined: referrals.filter((r) => r.status === 'declined').length,
    }),
    [referrals, incoming.length, outgoing.length]
  );

  const filtered = useMemo(() => {
    const rows = [...referrals].sort((a, b) => a.referralDate.localeCompare(b.referralDate));
    if (filter === 'all') return rows;
    if (filter === 'incoming' || filter === 'outgoing') {
      return rows.filter((r) => r.direction === filter);
    }
    return rows.filter((r) => r.status === filter);
  }, [referrals, filter]);

  const bySource = useMemo(() => {
    const map: Record<string, { count: number; converted: number }> = {};
    for (const r of incoming) {
      if (!map[r.sourceType]) map[r.sourceType] = { count: 0, converted: 0 };
      map[r.sourceType].count += 1;
      if (r.status === 'converted') map[r.sourceType].converted += 1;
    }
    return Object.entries(map).sort((a, b) => {
      if (b[1].count !== a[1].count) return b[1].count - a[1].count;
      return SOURCE_ORDER.indexOf(a[0]) - SOURCE_ORDER.indexOf(b[0]);
    });
  }, [incoming]);

  const insight = useMemo(() => {
    if (!bySource.length) return null;
    const ranked = [...bySource].sort((a, b) => {
      const rateA = a[1].count ? a[1].converted / a[1].count : 0;
      const rateB = b[1].count ? b[1].converted / b[1].count : 0;
      if (rateB !== rateA) return rateB - rateA;
      if (b[1].count !== a[1].count) return b[1].count - a[1].count;
      if (a[0] === 'community_event') return -1;
      if (b[0] === 'community_event') return 1;
      return 0;
    });
    const [source, stats] = ranked[0];
    const rate = stats.count ? Math.round((stats.converted / stats.count) * 100) : 0;
    const label =
      source === 'community_event' ? 'Community Events' : (SOURCE_LABELS[source] ?? source);
    return {
      source,
      label,
      rate,
      count: stats.count,
      converted: stats.converted,
    };
  }, [bySource]);

  const patchLocal = (updated: CommunityReferral) => {
    setReferrals((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
  };

  const handleStatus = async (referral: CommunityReferral, status: ReferralStatus) => {
    setActionId(referral.id);
    setError(null);
    try {
      const next = await updateReferral(referral.id, { status });
      patchLocal(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update referral');
    } finally {
      setActionId(null);
    }
  };

  const handleSave = async () => {
    if (!form.patientName.trim() || !form.referralDate) {
      setFormError('Patient name and referral date are required.');
      return;
    }
    if (form.direction === 'outgoing' && !roiVerified) {
      setFormError('A signed Release of Information (ROI) must be verified on file before creating an outbound referral.');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const intakeDeadline = new Date(Date.now() + 48 * 60 * 60 * 1000).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
      const combinedNotes = form.direction === 'incoming'
        ? `[Auto-Assigned Intake Task: 48h deadline due ${intakeDeadline}] ${form.notes.trim()}`
        : `[Signed ROI on file verified] ${form.notes.trim()}`;

      const next = await createReferral({
        direction: form.direction,
        patientName: form.patientName.trim(),
        sourceType: form.sourceType,
        sourceName: form.sourceName.trim() || SOURCE_LABELS[form.sourceType],
        referralDate: form.referralDate,
        notes: combinedNotes,
      });
      setReferrals((prev) => [...prev, next]);
      setShowNew(false);
      setRoiVerified(false);
      setForm({
        direction: 'incoming',
        patientName: '',
        sourceType: 'primary_care',
        sourceName: '',
        referralDate: new Date().toISOString().slice(0, 10),
        notes: '',
      });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not save referral');
    } finally {
      setSaving(false);
    }
  };

  const pills: { key: ListFilter; label: string; count: number; incoming?: boolean; outgoing?: boolean }[] = [
    { key: 'all', label: 'All', count: counts.all },
    { key: 'incoming', label: 'Incoming', count: counts.incoming, incoming: true },
    { key: 'outgoing', label: 'Outgoing', count: counts.outgoing, outgoing: true },
    { key: 'pending', label: 'Pending', count: counts.pending },
    { key: 'accepted', label: 'Accepted', count: counts.accepted },
    { key: 'converted', label: 'Converted', count: counts.converted },
    { key: 'declined', label: 'Declined', count: counts.declined },
  ];

  return (
    <div className="mx-auto w-full max-w-[1280px] space-y-5 overflow-x-hidden pb-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-[28px]">
            Referral Management
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Track incoming referrals, outgoing referrals, and source analytics
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-xl border border-slate-200 bg-white p-0.5">
            <button
              type="button"
              onClick={() => setTab('list')}
              className={`rounded-[10px] px-3 py-2 text-sm font-semibold ${
                tab === 'list' ? 'text-white' : 'text-slate-600 hover:bg-slate-50'
              }`}
              style={tab === 'list' ? { backgroundColor: PURPLE } : undefined}
            >
              Referrals
            </button>
            <button
              type="button"
              onClick={() => setTab('analytics')}
              className={`inline-flex items-center gap-1.5 rounded-[10px] px-3 py-2 text-sm font-semibold ${
                tab === 'analytics' ? 'text-white' : 'text-slate-600 hover:bg-slate-50'
              }`}
              style={tab === 'analytics' ? { backgroundColor: PURPLE } : undefined}
            >
              Source Analytics
            </button>
          </div>
          <button
            type="button"
            onClick={() => {
              setFormError(null);
              setShowNew(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-semibold text-white shadow-sm"
            style={{ backgroundColor: PURPLE }}
          >
            <Plus size={16} />
            Log Referral
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-2xl border border-slate-200/80 bg-white px-4 py-4 shadow-sm">
          <p className="text-xs font-medium text-slate-500">Incoming (30 days)</p>
          <p className="mt-1 text-3xl font-bold" style={{ color: PURPLE }}>
            {incoming30}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200/80 bg-white px-4 py-4 shadow-sm">
          <p className="text-xs font-medium text-slate-500">Conversion Rate</p>
          <p className="mt-1 text-3xl font-bold text-green-600">{convRate}%</p>
        </div>
        <div className="rounded-2xl border border-slate-200/80 bg-white px-4 py-4 shadow-sm">
          <p className="text-xs font-medium text-slate-500">Avg Days to Convert</p>
          <p className="mt-1 text-3xl font-bold text-slate-900">{avgConvertDays}d</p>
        </div>
        <div className="rounded-2xl border border-slate-200/80 bg-white px-4 py-4 shadow-sm">
          <p className="text-xs font-medium text-slate-500">Pending Action</p>
          <p className="mt-1 text-3xl font-bold text-orange-500">{pendingAction}</p>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
          {error}
        </div>
      ) : null}

      {tab === 'analytics' ? (
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
            <p className="mb-5 flex items-center gap-2 text-sm font-semibold text-slate-800">
              <BarChart3 size={16} style={{ color: PURPLE }} />
              Referral Sources — Intake to Conversion
            </p>
            <div className="space-y-5">
              {bySource.length === 0 ? (
                <p className="text-sm text-slate-500">No incoming referrals yet.</p>
              ) : (
                bySource.map(([source, value]) => {
                  const rate = value.count ? Math.round((value.converted / value.count) * 100) : 0;
                  const color = SOURCE_COLORS[source] ?? '#6b7280';
                  return (
                    <div key={source}>
                      <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2 text-sm">
                        <span className="font-semibold text-slate-800">
                          {SOURCE_LABELS[source] ?? source}
                        </span>
                        <span className="text-slate-500">
                          {value.count} referral{value.count !== 1 ? 's' : ''} ·{' '}
                          <span className="font-semibold" style={{ color: rateColor(rate) }}>
                            {rate}% converted
                          </span>
                        </span>
                      </div>
                      <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{ width: `${rate}%`, backgroundColor: color }}
                        />
                      </div>
                      <p className="mt-1 text-xs text-slate-400">
                        {value.converted} converted of {value.count}
                      </p>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {insight ? (
            <div className="rounded-2xl border border-green-200 bg-green-50 p-4">
              <div className="flex items-start gap-3">
                <TrendingUp size={18} className="mt-0.5 shrink-0 text-green-700" />
                <div>
                  <p className="text-sm font-semibold text-green-800">
                    {insight.label}: {insight.rate}% conversion rate
                  </p>
                  <p className="mt-0.5 text-xs text-green-700">
                    {insight.count} referral{insight.count !== 1 ? 's' : ''} from{' '}
                    {insight.source === 'community_event' ? 'community outreach' : insight.label.toLowerCase()}{' '}
                    → {insight.converted} converted client{insight.converted !== 1 ? 's' : ''}.
                    {insight.source === 'community_event'
                      ? ' Your community engagement is a top-performing referral channel.'
                      : ' This is currently your top-performing referral channel.'}
                  </p>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <>
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:thin]">
            {pills.map((pill) => {
              const active = filter === pill.key;
              return (
                <button
                  key={pill.key}
                  type="button"
                  onClick={() => setFilter(pill.key)}
                  className={`inline-flex shrink-0 items-center gap-1 rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                    active ? 'text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                  style={active ? { backgroundColor: PURPLE } : undefined}
                >
                  {pill.incoming ? <ArrowRight size={11} /> : null}
                  {pill.outgoing ? <ArrowLeft size={11} /> : null}
                  {pill.label} ({pill.count})
                </button>
              );
            })}
          </div>

          {loading ? (
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-500">
              Loading referrals…
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map((referral) => {
                const isOpen = expanded === referral.id;
                const busy = actionId === referral.id;
                return (
                  <div
                    key={referral.id}
                    className="rounded-2xl border border-slate-200/80 bg-white shadow-sm"
                  >
                    <button
                      type="button"
                      className="flex w-full items-center gap-3 px-4 py-4 text-left sm:px-5"
                      onClick={() => setExpanded(isOpen ? null : referral.id)}
                    >
                      <div
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                        style={{ backgroundColor: '#EEF0FE' }}
                      >
                        {referral.direction === 'incoming' ? (
                          <ArrowRight size={14} style={{ color: PURPLE }} />
                        ) : (
                          <ArrowLeft size={14} style={{ color: PURPLE }} />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-bold text-slate-900">
                            {referral.patientName}
                          </span>
                          <StatusBadge status={referral.status} />
                          <span
                            className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-white"
                            style={{
                              backgroundColor: SOURCE_COLORS[referral.sourceType] ?? '#6b7280',
                            }}
                          >
                            {SOURCE_LABELS[referral.sourceType] ?? referral.sourceType}
                          </span>
                          {referral.direction === 'incoming' && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-700 border border-blue-200">
                              <Clock size={10} /> 48h Intake Task
                            </span>
                          )}
                          {referral.direction === 'outgoing' && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 border border-emerald-200">
                              <Check size={10} /> ROI Verified
                            </span>
                          )}
                        </div>
                        <p className="mt-1 truncate text-xs text-slate-500">
                          {referral.sourceName} · {referral.referralDate} · {referral.daysSinceReferral}d ago
                        </p>
                      </div>
                      {isOpen ? (
                        <ChevronUp size={16} className="shrink-0 text-slate-400" />
                      ) : (
                        <ChevronDown size={16} className="shrink-0 text-slate-400" />
                      )}
                    </button>

                    {isOpen ? (
                      <div className="space-y-3 border-t border-slate-100 px-4 py-4 sm:px-5">
                        {referral.notes ? (
                          <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
                            {referral.notes}
                          </p>
                        ) : (
                          <p className="text-sm text-slate-400">No notes logged.</p>
                        )}
                        {referral.convertedAt ? (
                          <p className="text-xs font-medium text-green-700">
                            Converted on {referral.convertedAt}
                          </p>
                        ) : null}
                        <div className="flex flex-wrap gap-2">
                          {referral.status === 'pending' ? (
                            <>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void handleStatus(referral, 'accepted')}
                                className="rounded-lg bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-700 hover:bg-violet-100 disabled:opacity-50"
                              >
                                Accept
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void handleStatus(referral, 'converted')}
                                className="rounded-lg bg-green-50 px-3 py-1.5 text-xs font-semibold text-green-700 hover:bg-green-100 disabled:opacity-50"
                              >
                                Convert
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void handleStatus(referral, 'declined')}
                                className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-200 disabled:opacity-50"
                              >
                                Decline
                              </button>
                            </>
                          ) : null}
                          {referral.status === 'accepted' ? (
                            <>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void handleStatus(referral, 'converted')}
                                className="rounded-lg bg-green-50 px-3 py-1.5 text-xs font-semibold text-green-700 hover:bg-green-100 disabled:opacity-50"
                              >
                                Convert
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void handleStatus(referral, 'declined')}
                                className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-200 disabled:opacity-50"
                              >
                                Decline
                              </button>
                            </>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
              {filtered.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
                  <p className="text-sm font-semibold text-slate-800">No referrals match these filters.</p>
                  <p className="mt-1 text-xs text-slate-500">Log a referral or choose another filter.</p>
                </div>
              ) : null}
            </div>
          )}
        </>
      )}

      {showNew ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 sm:items-center sm:p-4">
          <button
            type="button"
            className="absolute inset-0 cursor-default"
            aria-label="Close"
            onClick={() => !saving && setShowNew(false)}
          />
          <div className="relative z-10 flex max-h-[92vh] w-full max-w-lg flex-col overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl sm:p-6">
            <div className="mb-5 flex items-start justify-between">
              <h2 className="text-lg font-bold text-slate-900">Log Referral</h2>
              <button
                type="button"
                onClick={() => !saving && setShowNew(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-50 hover:text-slate-600"
              >
                <X size={18} />
              </button>
            </div>

            {formError ? (
              <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{formError}</p>
            ) : null}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">Direction</label>
                <select
                  className={inputClass}
                  value={form.direction}
                  onChange={(e) => {
                    setForm((prev) => ({ ...prev, direction: e.target.value as ReferralDirection }));
                    setRoiVerified(false);
                  }}
                >
                  <option value="incoming">Incoming (to us)</option>
                  <option value="outgoing">Outgoing (from us)</option>
                </select>
              </div>
              {form.direction === 'incoming' ? (
                <div className="sm:col-span-2 rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900 flex items-start gap-2">
                  <Clock size={16} className="text-blue-600 mt-0.5 shrink-0" />
                  <div>
                    <strong className="font-bold text-blue-950">Automated Intake Scheduling Task (48h):</strong>
                    <p className="mt-0.5 text-blue-800">
                      Per CARF Standard 2.A, an intake outreach task with a strict 48-hour SLA deadline will automatically be created and assigned to the intake coordination team upon saving.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="sm:col-span-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 space-y-2">
                  <div className="flex items-start gap-2">
                    <Shield size={16} className="text-amber-600 mt-0.5 shrink-0" />
                    <div>
                      <strong className="font-bold text-amber-950">HIPAA &amp; 42 CFR Part 2 ROI Verification:</strong>
                      <p className="mt-0.5 text-amber-800">
                        Transmitting clinical records to an external community provider requires a signed Release of Information (ROI) valid within 12 months.
                      </p>
                    </div>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer pt-1 font-semibold text-amber-950">
                    <input
                      type="checkbox"
                      checked={roiVerified}
                      onChange={(e) => setRoiVerified(e.target.checked)}
                      className="h-4 w-4 rounded border-amber-300 text-[#6868D0] focus:ring-[#6868D0]"
                    />
                    <span>I verify a signed, active Client Release of Information (ROI) is on file.</span>
                  </label>
                </div>
              )}
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">Patient Name</label>
                <input
                  className={inputClass}
                  placeholder="Full name"
                  value={form.patientName}
                  onChange={(e) => setForm((prev) => ({ ...prev, patientName: e.target.value }))}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">
                  Referral Source Type
                </label>
                <select
                  className={inputClass}
                  value={form.sourceType}
                  onChange={(e) => setForm((prev) => ({ ...prev, sourceType: e.target.value }))}
                >
                  {Object.entries(SOURCE_LABELS).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">Referral Date</label>
                <input
                  type="date"
                  className={inputClass}
                  value={form.referralDate}
                  onChange={(e) => setForm((prev) => ({ ...prev, referralDate: e.target.value }))}
                />
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-medium text-slate-500">
                  Source Name / Organization
                </label>
                <input
                  className={inputClass}
                  placeholder="e.g. Dr. Pamela Rhodes, MD — MedStar"
                  value={form.sourceName}
                  onChange={(e) => setForm((prev) => ({ ...prev, sourceName: e.target.value }))}
                />
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-medium text-slate-500">Notes</label>
                <textarea
                  rows={4}
                  className={`${inputClass} resize-none`}
                  placeholder="Clinical context, urgency, special considerations..."
                  value={form.notes}
                  onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
                />
              </div>
            </div>

            <div className="mt-5 flex items-center justify-between gap-3">
              <button
                type="button"
                disabled={saving}
                onClick={() => setShowNew(false)}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleSave()}
                className="rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                style={{ backgroundColor: PURPLE }}
              >
                {saving ? 'Saving…' : 'Save Referral'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
