'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Shield,
  Video,
  Share2,
  Camera,
  Microscope,
  Mail,
  Globe,
  PenLine,
  FileSignature,
  Loader2,
} from 'lucide-react';
import { EmptyState } from '@/components/clinic/ui';
import { DisclosurePanel } from '@/components/consents/DisclosurePanel';
import { fetchClients, type Client } from '@/features/clients';
import {
  createConsents,
  declineConsent,
  fetchConsents,
  resendConsent,
  signConsent,
  type ConsentItem,
  type ConsentStatus,
} from '@/features/consents/api';

type ConsentType =
  | 'Consent to Treat'
  | 'HIPAA Notice'
  | 'Telehealth Consent'
  | 'Release of Information'
  | 'Photography/Media'
  | 'Research Participation'
  | 'SMS Consent';

type DeliveryMethod = 'Email' | 'Patient Portal' | 'In-Person' | 'DocuSign';

const CONSENT_TYPES: { type: ConsentType; description: string; duration: string }[] = [
  {
    type: 'Consent to Treat',
    description: 'Authorization to provide mental health treatment services',
    duration: '1 year',
  },
  {
    type: 'HIPAA Notice',
    description: 'Notice of Privacy Practices acknowledgment',
    duration: '1 year',
  },
  {
    type: 'Telehealth Consent',
    description: 'Informed consent for video/telehealth services',
    duration: '6 months',
  },
  {
    type: 'Release of Information',
    description: 'Authorization to share records with specified parties',
    duration: '1 year',
  },
  {
    type: 'Photography/Media',
    description: 'Consent for use of photos/video for marketing or education',
    duration: 'Indefinite',
  },
  {
    type: 'Research Participation',
    description: 'Informed consent for clinical research participation',
    duration: 'Per study protocol',
  },
  {
    type: 'SMS Consent',
    description: 'Permission to send appointment texts. The message cannot include a diagnosis.',
    duration: '1 year',
  },
];

const STATUS_STYLES: Record<string, string> = {
  Signed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Pending: 'bg-amber-50 text-amber-700 border-amber-200',
  Expired: 'bg-rose-50 text-rose-700 border-rose-200',
  Declined: 'bg-slate-100 text-slate-600 border-slate-200',
};

function uiStatus(s: ConsentStatus) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function ConsentTypeIcon({ type, size = 20 }: { type: string; size?: number }) {
  switch (type) {
    case 'Telehealth Consent':
      return <Video size={size} className="text-blue-600" />;
    case 'Release of Information':
      return <Share2 size={size} className="text-orange-600" />;
    case 'Photography/Media':
      return <Camera size={size} className="text-pink-600" />;
    case 'Research Participation':
      return <Microscope size={size} className="text-blue-600" />;
    default:
      return <Shield size={size} className="text-blue-600" />;
  }
}

function MethodIcon({ method, size = 14 }: { method: string; size?: number }) {
  if (method === 'Email') return <Mail size={size} />;
  if (method === 'Patient Portal') return <Globe size={size} />;
  if (method === 'DocuSign') return <FileSignature size={size} />;
  return <PenLine size={size} />;
}

export default function ConsentsPage() {
  const [consents, setConsents] = useState<ConsentItem[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [now] = useState(() => Date.now());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('All Consents');
  const [statusFilter, setStatusFilter] = useState<'All' | 'Signed' | 'Pending' | 'Expired' | 'Declined'>(
    'All'
  );
  const [search, setSearch] = useState('');
  const [showSend, setShowSend] = useState(false);
  const [showPreview, setShowPreview] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [sendForm, setSendForm] = useState<{
    clientId: string;
    types: ConsentType[];
    method: DeliveryMethod;
    notes: string;
  }>({ clientId: '', types: [], method: 'In-Person', notes: '' });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rows, clientRows] = await Promise.all([fetchConsents(), fetchClients()]);
      setConsents(rows);
      setClients(clientRows);
    } catch (err: any) {
      setError(err.message || 'Could not load consents');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const expiringConsents = useMemo(
    () =>
      consents.filter((c) => {
        if (c.status !== 'signed' || !c.expiresAt) return false;
        const diff = (new Date(c.expiresAt).getTime() - now) / 86_400_000;
        return diff <= 30 && diff >= 0;
      }),
    [consents, now]
  );

  const stats = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return [
      {
        label: 'Signed Today',
        value: consents.filter((c) => c.status === 'signed' && c.signedAt === today).length,
        color: '#6868D0',
        bgColor: 'bg-blue-100',
        Icon: FileSignature,
      },
      {
        label: 'Pending Signature',
        value: consents.filter((c) => c.status === 'pending').length,
        color: '#ea580c',
        bgColor: 'bg-orange-100',
        Icon: PenLine,
      },
      {
        label: 'Expiring in 30 Days',
        value: expiringConsents.length,
        color: '#D4A017',
        bgColor: 'bg-yellow-100',
        Icon: AlertTriangle,
      },
      {
        label: 'Total Active',
        value: consents.filter((c) => c.status === 'signed' || c.status === 'pending').length,
        color: '#6868D0',
        bgColor: 'bg-blue-100',
        Icon: Shield,
      },
    ];
  }, [consents, expiringConsents.length]);

  const filtered = useMemo(() => {
    return consents.filter((c) => {
      const label = uiStatus(c.status);
      const matchStatus = statusFilter === 'All' || label === statusFilter;
      const matchSearch =
        c.clientName.toLowerCase().includes(search.toLowerCase()) ||
        c.type.toLowerCase().includes(search.toLowerCase());
      const matchTab =
        activeTab === 'All Consents' ||
        (activeTab === 'Expiring Soon' && expiringConsents.some((e) => e.id === c.id));
      return matchStatus && matchSearch && matchTab;
    });
  }, [consents, statusFilter, search, activeTab, expiringConsents]);

  const toggleConsentType = (type: ConsentType) => {
    setSendForm((p) => ({
      ...p,
      types: p.types.includes(type) ? p.types.filter((t) => t !== type) : [...p.types, type],
    }));
  };

  const handleSend = async () => {
    if (!sendForm.clientId || sendForm.types.length === 0 || saving) return;
    setSaving(true);
    try {
      const created = await createConsents({
        clientId: sendForm.clientId,
        types: sendForm.types,
        method: sendForm.method,
        notes: sendForm.notes || null,
      });
      setConsents((prev) => [...created, ...prev]);
      setShowSend(false);
      setSendForm({ clientId: '', types: [], method: 'In-Person', notes: '' });
    } catch (err: any) {
      alert(err.message || 'Could not create consent');
    } finally {
      setSaving(false);
    }
  };

  const onDecline = async (c: ConsentItem) => {
    setActionId(c.id);
    try {
      const updated = await declineConsent(c.id);
      setConsents((prev) => prev.map((row) => (row.id === updated.id ? updated : row)));
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Could not turn SMS consent off');
    } finally {
      setActionId(null);
    }
  };

  const onSign = async (c: ConsentItem) => {
    setActionId(c.id);
    try {
      const updated = await signConsent(c.id, c.clientName);
      setConsents((prev) => prev.map((row) => (row.id === updated.id ? updated : row)));
    } catch (err: any) {
      alert(err.message || 'Could not mark as signed');
    } finally {
      setActionId(null);
    }
  };

  const onResend = async (c: ConsentItem) => {
    setActionId(c.id);
    try {
      const updated = await resendConsent(c.id);
      setConsents((prev) => prev.map((row) => (row.id === updated.id ? updated : row)));
    } catch (err: any) {
      alert(err.message || 'Could not resend consent');
    } finally {
      setActionId(null);
    }
  };

  return (
    <div className="space-y-6">
      <DisclosurePanel />
      {expiringConsents.length > 0 && (
        <div className="flex items-center gap-3 rounded-xl bg-amber-50 p-4 ring-1 ring-inset ring-amber-100">
          <AlertTriangle size={22} className="shrink-0 text-amber-500" />
          <div className="flex-1">
            <p className="text-sm font-bold text-amber-800">
              {expiringConsents.length} consent{expiringConsents.length > 1 ? 's' : ''} expiring
              within 30 days
            </p>
            <p className="text-xs text-amber-600">
              {expiringConsents.map((c) => `${c.clientName} — ${c.type}`).join(', ')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setActiveTab('Expiring Soon')}
            className="rounded-lg border border-amber-300 px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-100"
          >
            View
          </button>
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Consent Forms</h1>
          <p className="mt-1 text-sm text-slate-500">
            HIPAA, consent to treat, telehealth, ROI & more
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowSend(true)}
          className="rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:opacity-90"
          style={{ background: 'linear-gradient(135deg, #6868D0, #6868D0)' }}
        >
          + Send Consent
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((s) => (
          <div
            key={s.label}
            className="rounded-xl border border-slate-200/80 bg-white p-5 shadow-sm"
          >
            <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${s.bgColor}`}>
              <s.Icon size={20} style={{ color: s.color }} />
            </div>
            <p className="mt-2 text-2xl font-semibold" style={{ color: s.color }}>
              {s.value}
            </p>
            <p className="mt-0.5 text-xs font-semibold text-slate-700">{s.label}</p>
          </div>
        ))}
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-bold text-slate-900">Consent library</h2>
        <p className="mt-1 text-xs text-slate-500">Each form has a signature and an expiry. An intake packet sends Consent to Treat, the HIPAA notice, and telehealth consent together.</p>
        <button
          type="button"
          onClick={() => {
            setSendForm((current) => ({
              ...current,
              types: ['Consent to Treat', 'HIPAA Notice', 'Telehealth Consent'],
            }));
            setShowSend(true);
          }}
          className="mt-3 rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800"
        >
          Intake packet
        </button>
      </section>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {CONSENT_TYPES.map((ct) => (
          <div
            key={ct.type}
            className="cursor-pointer rounded-xl border border-slate-200/80 bg-white p-4 text-center shadow-sm transition-all hover:shadow-md"
            onClick={() => setShowPreview(ct.type)}
          >
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-slate-50">
              <ConsentTypeIcon type={ct.type} size={20} />
            </div>
            <p className="mt-2 text-xs font-bold leading-tight text-slate-800">{ct.type}</p>
            <p className="mt-1 text-xs text-slate-400">{ct.duration}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
        <div className="flex gap-1 rounded-xl border border-slate-200/80 bg-white p-1.5 shadow-sm">
          {['All Consents', 'Expiring Soon'].map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`relative rounded-xl px-4 py-2.5 text-sm font-semibold transition-all ${
                activeTab === tab ? 'text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
              style={activeTab === tab ? { background: '#6868D0' } : {}}
            >
              {tab}
              {tab === 'Expiring Soon' && expiringConsents.length > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-amber-500 text-[10px] font-bold text-white">
                  {expiringConsents.length}
                </span>
              )}
            </button>
          ))}
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search client or consent type..."
          className="flex-1 rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
        <div className="flex gap-1.5">
          {(['All', 'Signed', 'Pending', 'Expired', 'Declined'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition-all ${
                statusFilter === s ? 'text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
              }`}
              style={statusFilter === s ? { background: '#6868D0' } : {}}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
          <Loader2 className="animate-spin" size={16} /> Loading consents…
        </div>
      ) : error ? (
        <EmptyState title="Could not load consents" description={error} />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-50 text-xs uppercase text-slate-400">
                  <th className="px-5 py-3 text-left font-semibold">Client</th>
                  <th className="px-5 py-3 text-left font-semibold">Form Type</th>
                  <th className="px-5 py-3 text-left font-semibold">Sent</th>
                  <th className="px-5 py-3 text-left font-semibold">Signed</th>
                  <th className="px-5 py-3 text-left font-semibold">Expiry</th>
                  <th className="px-5 py-3 text-left font-semibold">Method</th>
                  <th className="px-5 py-3 text-left font-semibold">Status</th>
                  <th className="px-5 py-3 text-left font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((c) => {
                  const label = uiStatus(c.status);
                  const isExpiringSoon =
                    c.expiresAt &&
                    c.status === 'signed' &&
                    (() => {
                      const diff =
                        (new Date(c.expiresAt!).getTime() - Date.now()) / 86_400_000;
                      return diff <= 30 && diff >= 0;
                    })();
                  return (
                    <tr
                      key={c.id}
                      className={`transition-colors hover:bg-slate-50 ${
                        isExpiringSoon ? 'bg-amber-50/30' : ''
                      }`}
                    >
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <div
                            className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold text-white"
                            style={{ background: 'linear-gradient(135deg, #6868D0, #6868D0)' }}
                          >
                            {c.clientName[0]}
                          </div>
                          <span className="text-sm font-medium text-slate-900">
                            {c.clientName}
                          </span>
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <span className="flex items-center gap-1.5 text-sm text-slate-700">
                          <ConsentTypeIcon type={c.type} size={14} /> {c.type}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-sm text-slate-600">{c.sentAt}</td>
                      <td className="px-5 py-3 text-sm text-slate-600">
                        {c.signedAt || <span className="text-slate-400">—</span>}
                      </td>
                      <td className="px-5 py-3">
                        {c.expiresAt ? (
                          <span
                            className={`flex items-center gap-1 text-sm ${
                              isExpiringSoon
                                ? 'font-semibold text-amber-600'
                                : 'text-slate-600'
                            }`}
                          >
                            {isExpiringSoon && <AlertTriangle size={13} />}
                            {c.expiresAt}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-sm text-slate-600">
                        <span className="flex items-center gap-1.5">
                          <MethodIcon method={c.method} size={14} /> {c.method}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${STATUS_STYLES[label]}`}
                        >
                          {label}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex gap-1.5">
                          <button
                            type="button"
                            onClick={() => setShowPreview(c.type)}
                            className="rounded-lg px-2.5 py-1 text-xs font-semibold text-[#5C2D91] hover:bg-violet-50"
                          >
                            View
                          </button>
                          {c.type === 'SMS Consent' && c.status === 'signed' && (
                            <button
                              type="button"
                              disabled={actionId === c.id}
                              onClick={() => onDecline(c)}
                              className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                            >
                              {actionId === c.id ? '…' : 'Turn SMS off'}
                            </button>
                          )}
                          {(c.status === 'pending' || (c.type === 'SMS Consent' && c.status === 'declined')) && (
                            <>
                              <button
                                type="button"
                                disabled={actionId === c.id}
                                onClick={() => onResend(c)}
                                className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                              >
                                {actionId === c.id ? '…' : 'Resend'}
                              </button>
                              <button
                                type="button"
                                disabled={actionId === c.id}
                                onClick={() => onSign(c)}
                                className="rounded-lg border border-emerald-200 px-2.5 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                              >
                                {actionId === c.id ? '…' : c.status === 'declined' ? 'Turn SMS on' : 'Sign'}
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filtered.length === 0 && (
              <div className="py-12 text-center text-slate-400">
                No consents yet — send a consent to get started
              </div>
            )}
          </div>
        </div>
      )}

      {showSend && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white shadow-xl">
            <div className="sticky top-0 flex items-center justify-between border-b border-slate-200/80 bg-white px-6 py-4">
              <h2 className="text-lg font-semibold text-slate-900">Send Consent Form</h2>
              <button
                type="button"
                onClick={() => setShowSend(false)}
                className="text-xl font-bold text-slate-400 hover:text-slate-600"
              >
                ×
              </button>
            </div>
            <div className="space-y-4 p-6">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">
                  Client *
                </label>
                <select
                  value={sendForm.clientId}
                  onChange={(e) => setSendForm((p) => ({ ...p, clientId: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                >
                  <option value="">Select client...</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-2 block text-xs font-semibold text-slate-600">
                  Consent Type(s) *
                </label>
                <div className="space-y-2">
                  {CONSENT_TYPES.map((ct) => (
                    <label
                      key={ct.type}
                      className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200/80 p-3 transition-all hover:bg-slate-50"
                    >
                      <input
                        type="checkbox"
                        checked={sendForm.types.includes(ct.type)}
                        onChange={() => toggleConsentType(ct.type)}
                        className="accent-blue-600"
                      />
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-50">
                        <ConsentTypeIcon type={ct.type} size={16} />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-slate-800">{ct.type}</p>
                        <p className="text-xs text-slate-400">{ct.description}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">
                  Delivery Method *
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {(['Email', 'Patient Portal', 'In-Person', 'DocuSign'] as DeliveryMethod[]).map(
                    (method) => (
                      <button
                        key={method}
                        type="button"
                        onClick={() => setSendForm((p) => ({ ...p, method }))}
                        className={`flex items-center gap-2 rounded-xl border p-3 text-left text-sm font-medium transition-all ${
                          sendForm.method === method
                            ? 'border-blue-300 bg-blue-50 text-blue-700'
                            : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        <MethodIcon method={method} size={16} />
                        {method}
                      </button>
                    )
                  )}
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowSend(false)}
                  className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-600"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={saving || !sendForm.clientId || sendForm.types.length === 0}
                  onClick={() => void handleSend()}
                  className="flex-1 rounded-xl py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg, #6868D0, #6868D0)' }}
                >
                  {saving ? 'Saving…' : 'Create Consent'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[80vh] w-full max-w-lg overflow-auto rounded-xl bg-white p-6 shadow-xl">
            <h2 className="mb-3 text-lg font-semibold text-slate-900">{showPreview}</h2>
            <p className="text-sm leading-relaxed text-slate-600">
              {CONSENT_TYPES.find((c) => c.type === showPreview)?.description ||
                'Standard clinic consent form.'}
            </p>
            <button
              type="button"
              onClick={() => setShowPreview(null)}
              className="mt-5 rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
