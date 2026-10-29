'use client';

import { useEffect, useMemo, useState } from 'react';
import { FileText, Plus, Printer, Search, X } from 'lucide-react';
import { useAuth } from '@/features/auth';
import { useClients } from '@/features/clients';
import { fetchClaims, type ClaimRecord } from '@/features/billing/claimsApi';
import { fetchPayments, type PaymentRecord } from '@/features/billing/ledgerApi';
import { loadLockedNotes, type LockedNoteSnapshot } from '@/lib/notes/workflow';
import { useModuleList } from '@/lib/modules/useModuleList';
import { cptDescription, cptRateCents } from '@/features/billing/billingHubData';
import {
  DEFAULT_SUPERBILL_PRACTICE,
  type SuperbillLine,
  type SuperbillPractice,
  type SuperbillRecord,
} from '@/features/billing/billingSeeds';
import type { SoloPracticeSetup } from '@/lib/solo/types';
import {
  Alert,
  Button,
  Card,
  cx,
  EmptyState,
  FormField,
  IconButton,
  inputClasses,
  LoadingState,
  Modal,
  Page,
  PageHeader,
  StatusBadge,
} from '@/components/ui';

type ClientOption = {
  clientId: string;
  name: string;
  dob: string;
  address: string;
  payer: string;
  memberId: string | null;
  groupNumber: string | null;
  diagnosisCodes: string[];
};

function money(cents: number) {
  return `$${(cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

function parseLocalDate(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year, month - 1, day);
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatShortDate(value: string) {
  const parsed = parseLocalDate(value);
  if (!parsed) return value || '—';
  return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatTableDate(value: string) {
  const parsed = parseLocalDate(value);
  if (!parsed) return value || '—';
  return parsed.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
}

function initials(name: string) {
  return name
    .split(' ')
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function inRange(iso: string, from: string, to: string) {
  const date = parseLocalDate(iso);
  if (!date) return true;
  const start = from ? parseLocalDate(from) : null;
  const end = to ? parseLocalDate(to) : null;
  if (start) {
    start.setHours(0, 0, 0, 0);
    if (date < start) return false;
  }
  if (end) {
    end.setHours(23, 59, 59, 999);
    if (date > end) return false;
  }
  return true;
}

function centsFromUnknown(value: unknown, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.abs(n) >= 1000 ? Math.round(n) : Math.round(n * 100);
}

function normalizeSuperbill(
  record: SuperbillRecord | (Record<string, unknown> & { patient?: Record<string, unknown>; services?: Array<Record<string, unknown>>; practice?: Record<string, unknown> })
): SuperbillRecord {
  if ('totalBilledCents' in record && 'practice' in record && record.practice) {
    return record as SuperbillRecord;
  }
  const services = (record.services || []).map((service) => {
    const feeCents = 'feeCents' in service ? Number(service.feeCents) : centsFromUnknown(service.fee);
    const paidCents = 'paidCents' in service ? Number(service.paidCents) : centsFromUnknown(service.paid);
    const balanceCents =
      'balanceCents' in service ? Number(service.balanceCents) : centsFromUnknown(service.balance, feeCents - paidCents);
    return {
      date: String(service.date || ''),
      cptCode: String(service.cptCode || ''),
      description: String(service.description || ''),
      diagnosisCodes: Array.isArray(service.diagnosisCodes) ? service.diagnosisCodes.map(String) : [],
      feeCents,
      paidCents,
      balanceCents,
    };
  }) as SuperbillLine[];
  const practice = record.practice || {};
  return {
    superbillId: String(record.superbillId || `sb-${Date.now()}`),
    generatedAt: String(record.generatedAt || new Date().toISOString()),
    clinicianName: String(record.clinicianName || 'Clinician'),
    practice: {
      name: String(practice.name || DEFAULT_SUPERBILL_PRACTICE.name),
      address: String(practice.address || DEFAULT_SUPERBILL_PRACTICE.address),
      phone: String(practice.phone || DEFAULT_SUPERBILL_PRACTICE.phone),
      npi: String(practice.npi || DEFAULT_SUPERBILL_PRACTICE.npi),
      taxId: String(practice.taxId || DEFAULT_SUPERBILL_PRACTICE.taxId),
    },
    patient: {
      clientId: String(record.patient?.clientId || ''),
      name: String(record.patient?.name || ''),
      dob: String(record.patient?.dob || ''),
      address: String(record.patient?.address || ''),
      insurancePayer: String(record.patient?.insurancePayer || ''),
      memberId: record.patient?.memberId ? String(record.patient.memberId) : null,
      groupNumber: record.patient?.groupNumber ? String(record.patient.groupNumber) : null,
    },
    services,
    diagnosisCodes: Array.isArray(record.diagnosisCodes) ? record.diagnosisCodes.map(String) : [],
    totalBilledCents:
      'totalBilledCents' in record ? Number(record.totalBilledCents) : centsFromUnknown(record.totalBilled),
    totalPaidCents: 'totalPaidCents' in record ? Number(record.totalPaidCents) : centsFromUnknown(record.totalPaid),
    totalBalanceCents:
      'totalBalanceCents' in record ? Number(record.totalBalanceCents) : centsFromUnknown(record.totalBalance),
  };
}

type PracticeBillingIdentity = Pick<
  SoloPracticeSetup,
  'practiceName' | 'practiceAddress' | 'practiceCity' | 'practiceState' | 'practiceZip' | 'practicePhone' | 'npi'
>;

function practiceFromSetup(setup: PracticeBillingIdentity | null | undefined): SuperbillPractice {
  if (!setup?.practiceName) return DEFAULT_SUPERBILL_PRACTICE;
  const cityLine = [setup.practiceCity, setup.practiceState, setup.practiceZip].filter(Boolean).join(', ');
  const address = [setup.practiceAddress, cityLine].filter(Boolean).join(', ') || DEFAULT_SUPERBILL_PRACTICE.address;
  return {
    name: setup.practiceName,
    address,
    phone: setup.practicePhone || DEFAULT_SUPERBILL_PRACTICE.phone,
    npi: setup.npi || DEFAULT_SUPERBILL_PRACTICE.npi,
    taxId: DEFAULT_SUPERBILL_PRACTICE.taxId,
  };
}

function allocatePayments(feeCents: number, remainingPaid: { current: number }) {
  const paidCents = Math.min(feeCents, Math.max(0, remainingPaid.current));
  remainingPaid.current -= paidCents;
  return { paidCents, balanceCents: feeCents - paidCents };
}

function GenerateModal({
  clients,
  clinicianName,
  practice,
  claims,
  notes,
  payments,
  onClose,
  onGenerate,
}: {
  clients: ClientOption[];
  clinicianName: string;
  practice: SuperbillPractice;
  claims: ClaimRecord[];
  notes: LockedNoteSnapshot[];
  payments: PaymentRecord[];
  onClose: () => void;
  onGenerate: (sb: SuperbillRecord) => void;
}) {
  const [clientId, setClientId] = useState('');
  const [from, setFrom] = useState('2026-06-01');
  const [to, setTo] = useState('2026-06-30');

  const handleGenerate = () => {
    const client = clients.find((item) => item.clientId === clientId);
    if (!client) return;

    const relevantClaims = claims.filter(
      (claim) => claim.clientId === clientId && inRange(claim.serviceDate || claim.createdAt, from, to)
    );
    const relevantNotes = notes.filter(
      (note) => note.clientId === clientId && inRange(note.lockedAt || note.createdAt, from, to)
    );
    const paidPool = {
      current: payments
        .filter((payment) => payment.clientId === clientId && inRange(payment.paidAt, from, to))
        .reduce((sum, payment) => sum + payment.amountCents, 0),
    };

    let services: SuperbillLine[];
    if (relevantClaims.length > 0) {
      services = relevantClaims.map((claim) => {
        // Claims carry their own amount; a catalog code with no fee set adds nothing rather than a guessed fee
        const fee = claim.amountCents ?? cptRateCents(claim.cptCode) ?? 0;
        const fromStatus = claim.status === 'PAID' || claim.uiStatus === 'approved' ? fee : 0;
        const paid = fromStatus > 0 ? fromStatus : allocatePayments(fee, paidPool).paidCents;
        return {
          date: (claim.serviceDate || from).slice(0, 10),
          cptCode: claim.cptCode,
          description: claim.cptDescription || cptDescription(claim.cptCode),
          diagnosisCodes: client.diagnosisCodes,
          feeCents: fee,
          paidCents: paid,
          balanceCents: fee - paid,
        };
      });
    } else if (relevantNotes.length > 0) {
      services = relevantNotes.map((note) => {
        const fee = cptRateCents('90837') ?? 0;
        const { paidCents, balanceCents } = allocatePayments(fee, paidPool);
        return {
          date: (note.lockedAt || note.createdAt).slice(0, 10),
          cptCode: '90837',
          description: cptDescription('90837'),
          diagnosisCodes: client.diagnosisCodes,
          feeCents: fee,
          paidCents,
          balanceCents,
        };
      });
    } else {
      const fee = 18000;
      const { paidCents, balanceCents } = allocatePayments(fee, paidPool);
      services = [
        {
          date: from || new Date().toISOString().slice(0, 10),
          cptCode: '90837',
          description: 'Psychotherapy, 53 min',
          diagnosisCodes: client.diagnosisCodes,
          feeCents: fee,
          paidCents,
          balanceCents,
        },
      ];
    }

    const totalBilledCents = services.reduce((sum, line) => sum + line.feeCents, 0);
    const totalPaidCents = services.reduce((sum, line) => sum + line.paidCents, 0);
    const totalBalanceCents = services.reduce((sum, line) => sum + line.balanceCents, 0);

    onGenerate({
      superbillId: `sb-live-${Date.now()}`,
      generatedAt: new Date().toISOString(),
      clinicianName,
      practice,
      patient: {
        clientId: client.clientId,
        name: client.name,
        dob: client.dob,
        address: client.address,
        insurancePayer: client.payer,
        memberId: client.memberId,
        groupNumber: client.groupNumber,
      },
      services,
      diagnosisCodes: client.diagnosisCodes,
      totalBilledCents,
      totalPaidCents,
      totalBalanceCents,
    });
    onClose();
  };

  return (
    <Modal
      title="Generate Superbill"
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!clientId} onClick={handleGenerate}>
            Generate Superbill
          </Button>
        </>
      }
    >
      <FormField label="Client" required>
        <select value={clientId} onChange={(e) => setClientId(e.target.value)} className={inputClasses}>
          <option value="">Select a client…</option>
          {clients.map((client) => (
            <option key={client.clientId} value={client.clientId}>
              {client.name}
            </option>
          ))}
        </select>
      </FormField>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label="From">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputClasses} />
        </FormField>
        <FormField label="To">
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputClasses} />
        </FormField>
      </div>
      <p className="text-sm text-slate-500">
        The superbill will include all matching sessions in the selected date range.
      </p>
    </Modal>
  );
}

function SuperbillPreview({
  sb,
  onClose,
}: {
  sb: SuperbillRecord;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/55 p-4 backdrop-blur-sm print:static print:overflow-visible print:bg-white print:p-0 print:backdrop-blur-none">
      <div role="dialog" aria-modal="true" aria-label="Superbill preview" className="my-6 w-full max-w-3xl overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl print:my-0 print:max-w-none print:rounded-none print:border-0 print:shadow-none">
        <div className="flex items-center justify-end gap-2 border-b border-slate-200 px-5 py-3 print:hidden">
          <Button icon={<Printer />} onClick={() => window.print()}>
            Print
          </Button>
          <IconButton
            label="Close preview"
            icon={<X size={20} />}
            onClick={onClose}
            className="h-9 w-9 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
          />
        </div>

        <div className="bg-white px-5 py-6 text-slate-800 sm:px-10 sm:py-10">
          <div className="flex flex-col gap-4 border-b-2 border-blue-600 pb-5 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xl font-semibold tracking-tight text-slate-900">{sb.practice.name}</p>
              <p className="mt-1 text-sm text-slate-600">{sb.practice.address}</p>
              <p className="text-sm text-slate-600">Tel: {sb.practice.phone}</p>
              <p className="mt-2 text-sm text-slate-600">NPI: {sb.practice.npi}</p>
              <p className="text-sm text-slate-600">Tax ID: {sb.practice.taxId}</p>
            </div>
            <div className="text-left sm:text-right">
              <p className="text-2xl font-semibold tracking-[0.18em] text-blue-700">SUPERBILL</p>
              <p className="mt-3 text-sm text-slate-600">Generated: {formatShortDate(sb.generatedAt)}</p>
              <p className="text-sm text-slate-600">Clinician: {sb.clinicianName}</p>
            </div>
          </div>

          <div className="mt-6 grid gap-8 md:grid-cols-2">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Patient Information</p>
              <div className="mt-3 space-y-1 text-sm">
                <p>
                  <span className="text-slate-500">Name:</span> {sb.patient.name}
                </p>
                <p>
                  <span className="text-slate-500">DOB:</span> {sb.patient.dob ? formatTableDate(sb.patient.dob) : '—'}
                </p>
                <p>
                  <span className="text-slate-500">Address:</span> {sb.patient.address || '—'}
                </p>
              </div>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Insurance Information</p>
              <div className="mt-3 space-y-1 text-sm">
                <p>
                  <span className="text-slate-500">Payer:</span> {sb.patient.insurancePayer || '—'}
                </p>
                <p>
                  <span className="text-slate-500">Member ID:</span> {sb.patient.memberId || '—'}
                </p>
                <p>
                  <span className="text-slate-500">Group #:</span> {sb.patient.groupNumber || '—'}
                </p>
              </div>
            </div>
          </div>

          <div className="mt-7">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Diagnosis Codes (ICD-10-CM)</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {sb.diagnosisCodes.map((code) => (
                <StatusBadge key={code} tone="brand">
                  {code}
                </StatusBadge>
              ))}
            </div>
          </div>

          <div className="clinic-scroll-x mt-7 overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[40rem] border-collapse text-xs sm:text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th scope="col" className="px-3 py-2.5 text-left font-semibold">Date</th>
                  <th scope="col" className="px-3 py-2.5 text-left font-semibold">CPT</th>
                  <th scope="col" className="px-3 py-2.5 text-left font-semibold">Description</th>
                  <th scope="col" className="px-3 py-2.5 text-left font-semibold">Diagnosis</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">Fee</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">Paid</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">Balance</th>
                </tr>
              </thead>
              <tbody>
                {sb.services.map((service, index) => (
                  <tr key={`${service.date}-${service.cptCode}-${index}`} className="border-t border-slate-100">
                    <td className="px-3 py-2.5">{formatTableDate(service.date)}</td>
                    <td className="px-3 py-2.5 font-medium">{service.cptCode}</td>
                    <td className="px-3 py-2.5">{service.description}</td>
                    <td className="px-3 py-2.5">{service.diagnosisCodes.join(', ') || '—'}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{money(service.feeCents)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{money(service.paidCents)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{money(service.balanceCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-6 flex justify-end">
            <div className="w-full max-w-xs text-sm">
              <div className="flex justify-between py-1">
                <span className="text-slate-500">Total Billed</span>
                <span className="font-semibold">{money(sb.totalBilledCents)}</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-slate-500">Total Paid</span>
                <span className="font-semibold">{money(sb.totalPaidCents)}</span>
              </div>
              <div className="flex justify-between border-t border-slate-200 pt-2 text-base">
                <span className="font-semibold text-slate-900">Balance Due</span>
                <span className="font-semibold text-rose-700">{money(sb.totalBalanceCents)}</span>
              </div>
            </div>
          </div>

          <div className="mt-10 grid gap-8 sm:grid-cols-2">
            <div>
              <p className="text-sm text-slate-600">Provider Signature</p>
              <div className="mt-8 border-b border-slate-400" />
              <p className="mt-2 text-xs text-slate-500">Date: ____________________</p>
            </div>
            <div>
              <p className="text-sm text-slate-600">Patient Signature</p>
              <div className="mt-8 border-b border-slate-400" />
              <p className="mt-2 text-xs text-slate-500">Date: ____________________</p>
            </div>
          </div>

          <p className="mt-8 border-t border-slate-100 pt-4 text-xs leading-5 text-slate-500">
            This document is provided for the client&apos;s use in seeking out-of-network reimbursement from their
            insurance carrier. It is not a bill from this practice. Submission of this superbill does not guarantee
            reimbursement.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function SuperbillsPage() {
  const { user } = useAuth();
  const { clients } = useClients();
  const [claims, setClaims] = useState<ClaimRecord[]>([]);
  const [notes, setNotes] = useState<LockedNoteSnapshot[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [practice, setPractice] = useState<SuperbillPractice>(DEFAULT_SUPERBILL_PRACTICE);
  const [superbills, setSuperbills, superbillsMeta] = useModuleList<SuperbillRecord>('superbills', []);
  const [showGenerate, setShowGenerate] = useState(false);
  const [previewSb, setPreviewSb] = useState<SuperbillRecord | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetchClaims()
      .then(setClaims)
      .catch(() => setClaims([]));
    loadLockedNotes()
      .then(setNotes)
      .catch(() => setNotes([]));
    fetchPayments()
      .then((res) => setPayments(res.payments || []))
      .catch(() => setPayments([]));
    // Billing identity only (the full practice setup is leadership-only)
    fetch('/api/practice-setup/billing-identity')
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (json?.practice) setPractice(practiceFromSetup(json.practice as PracticeBillingIdentity));
      })
      .catch(() => undefined);
  }, []);

  const clientOptions = useMemo<ClientOption[]>(
    () =>
      clients.map((client) => {
        const address = [client.addressLine1, client.city, client.state, client.postalCode]
          .filter(Boolean)
          .join(', ');
        const diagnosisCodes = [client.primaryDiagnosisCode, client.secondaryDiagnoses]
          .filter(Boolean)
          .flatMap((value) =>
            String(value)
              .split(/[,;]/)
              .map((item) => item.trim())
              .filter(Boolean)
          );
        return {
          clientId: client.id,
          name: client.name,
          dob: client.dateOfBirth ? client.dateOfBirth.slice(0, 10) : '',
          address,
          payer: client.insurancePayer || 'Self-Pay',
          memberId: client.insuranceMemberId || null,
          groupNumber: client.insuranceGroupNumber || null,
          diagnosisCodes,
        };
      }),
    [clients]
  );

  const normalized = useMemo(
    () => superbills.map((item) => normalizeSuperbill(item as SuperbillRecord)),
    [superbills]
  );

  const filtered = useMemo(
    () =>
      normalized.filter((sb) => sb.patient.name.toLowerCase().includes(search.trim().toLowerCase())),
    [normalized, search]
  );

  return (
    <Page>
      {showGenerate ? (
        <GenerateModal
          clients={clientOptions}
          clinicianName={user?.displayName || user?.email || 'Clinician'}
          practice={practice}
          claims={claims}
          notes={notes}
          payments={payments}
          onClose={() => setShowGenerate(false)}
          onGenerate={(sb) => setSuperbills((prev) => [sb, ...prev])}
        />
      ) : null}
      {previewSb ? <SuperbillPreview sb={previewSb} onClose={() => setPreviewSb(null)} /> : null}

      <PageHeader
        title="Superbills"
        description="Generate itemized receipts for clients to submit for out-of-network reimbursement"
        actions={
          <Button icon={<Plus />} onClick={() => setShowGenerate(true)}>
            Generate Superbill
          </Button>
        }
      />

      <div className="relative">
        <Search size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by client name…"
          aria-label="Search superbills by client name"
          className={cx(inputClasses, 'pl-9')}
        />
      </div>

      {superbillsMeta.error && !superbillsMeta.loading && superbills.length === 0 ? (
        <Alert
          tone="danger"
          actions={
            <Button size="sm" variant="secondary" onClick={superbillsMeta.retry}>
              Try again
            </Button>
          }
        >
          {superbillsMeta.error}
        </Alert>
      ) : null}

      {superbillsMeta.loading ? (
        <Card>
          <LoadingState label="Loading superbills…" rows={3} />
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <EmptyState icon={<FileText />} title="No superbills yet." />
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((sb) => (
            <Card key={sb.superbillId} className="p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <div
                    aria-hidden
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-blue-50 text-sm font-semibold text-blue-700 ring-1 ring-inset ring-blue-200"
                  >
                    {initials(sb.patient.name)}
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-base font-semibold text-slate-900">{sb.patient.name}</h3>
                    <p className="text-sm text-slate-500">
                      {sb.patient.insurancePayer}
                      {sb.patient.memberId ? ` · ${sb.patient.memberId}` : ''}
                    </p>
                    <p className="mt-0.5 text-sm text-slate-500">
                      Generated {formatShortDate(sb.generatedAt)} · {sb.services.length}{' '}
                      {sb.services.length === 1 ? 'session' : 'sessions'}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Button size="sm" variant="secondary" onClick={() => setPreviewSb(sb)}>
                        View / Print
                      </Button>
                      {sb.diagnosisCodes.map((code) => (
                        <StatusBadge key={code} tone="neutral">
                          {code}
                        </StatusBadge>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="text-left sm:text-right">
                  <p className="text-2xl font-semibold tabular-nums text-slate-900">{money(sb.totalBilledCents)}</p>
                  <p className="mt-1 text-sm text-slate-500">
                    Paid {money(sb.totalPaidCents)}{' '}
                    <span aria-hidden className="text-slate-400">·</span> Balance{' '}
                    <span className="font-semibold text-rose-700">{money(sb.totalBalanceCents)}</span>
                  </p>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </Page>
  );
}
