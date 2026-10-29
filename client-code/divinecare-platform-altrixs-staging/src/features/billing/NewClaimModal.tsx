'use client';

import { useEffect, useMemo, useState, useRef } from 'react';
import {
  CPT_CATEGORIES,
  CPT_CODES,
  MODIFIER_CODES,
  POS_CODES,
  FEE_NOT_SET,
  chargeAmount,
  cptByCode,
  cptFeeMissing,
  cptCodesByCategory,
  defaultPosForCpt,
} from '@/lib/constants/cpt';
import { fetchClients } from '@/features/clients/api/clientsApi';
import {
  createManualClaim,
  fetchClientInsurance,
  fetchRenderingProviders,
  type ClaimRecord,
  type RenderingProvider,
} from '@/features/billing/claimsApi';
import { PAYER_LIST } from '@/lib/constants/payers';
import { formatCents } from '@/lib/migration/valantReportCommon';
import {
  fetchFeeSchedule,
  quoteFees,
  useFeeScheduleCodes,
  type FeeRow,
  type LineQuote,
  type QuoteContext,
} from '@/features/billing/feeScheduleApi';
import { AlertTriangle, Search, X, Split, Plus, Trash2 } from 'lucide-react';
import { Icd10CodeChips } from '@/components/clinical/Icd10Picker';
import { buttonClasses } from '@/components/ui';

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: (claim: ClaimRecord) => void;
  /** Primary button label; the caller decides what happens after creation. */
  actionLabel?: string;
};

// Searchable ClientCombo Box
function ClientCombo({
  clients,
  selectedId,
  onSelect,
}: {
  clients: Array<{ id: string; name: string }>;
  selectedId: string;
  onSelect: (client: { id: string; name: string } | null) => void;
}) {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedClient = clients.find((c) => c.id === selectedId);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filtered = useMemo(() => {
    if (!query.trim()) return clients;
    return clients.filter((c) => c.name.toLowerCase().includes(query.toLowerCase()));
  }, [clients, query]);

  if (selectedClient) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-blue-200 bg-blue-50 p-2.5">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white">
            {selectedClient.name[0]}
          </div>
          <span className="text-sm font-semibold text-slate-900">{selectedClient.name}</span>
        </div>
        <button
          type="button"
          onClick={() => {
            onSelect(null);
            setQuery('');
            setIsOpen(true);
          }}
          className="rounded-lg p-1 text-slate-500 hover:bg-slate-200/50 hover:text-slate-700"
          title="Change client"
        >
          <X size={16} />
        </button>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-3 h-4 w-4 text-slate-500" />
        <input
          type="text"
          value={query}
          onFocus={() => setIsOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          placeholder="Search client by name..."
          className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-2.5 text-sm placeholder:text-slate-500 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
        />
      </div>

      {isOpen && (
        <div className="absolute z-20 mt-1 max-h-52 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          {filtered.length === 0 ? (
            <p className="p-3 text-center text-xs text-slate-500">No matching clients found.</p>
          ) : (
            filtered.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  onSelect(c);
                  setIsOpen(false);
                }}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-blue-50 focus:bg-blue-50 focus:outline-none"
              >
                <span className="font-semibold text-slate-800">{c.name}</span>
                <span className="text-xs text-slate-500">ID: {c.id.slice(0, 8)}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ICD-10-CM picker for the claim: FY2027 code set search, billable codes only (headers blocked)
function IcdCombo({ selectedCodes, onChange, clientId }: { selectedCodes: string[]; onChange: (codes: string[]) => void; clientId?: string | null }) {
  return <Icd10CodeChips codes={selectedCodes} onChange={onChange} clientId={clientId} requireBillable context="bh" />;
}

type LineDraft = {
  cptCode: string;
  modifier: string;
  units: number;
  /** Total line charge override in dollars; blank = fee schedule. */
  charge: string;
  /** Blank = claim date of service. */
  serviceDate: string;
  pointers: number[];
  /** Fee schedule (Valant) code; '' = pick by visit (telehealth / self-pay / child) */
  feeCode: string;
};

const newLine = (cptCode = '90837'): LineDraft => ({
  cptCode,
  feeCode: '',
  modifier: '',
  units: 1,
  charge: '',
  serviceDate: '',
  pointers: [1],
});

/** Up to 4 diagnoses are sent on a manual claim; pointers reference them by position. */
const MAX_CLAIM_DX = 4;

/** Fee schedule rate x units (quoted by the server), else the built-in rate. */
function scheduleDollars(line: LineDraft, quote: LineQuote | undefined) {
  return quote ? (quote.feeCents * line.units) / 100 : chargeAmount(line.cptCode, line.units);
}

/** No fee anywhere for this code (e.g. 99212 before the practice sets one): never shown as $0.00 */
function feeNotSet(line: LineDraft, quote: LineQuote | undefined) {
  return quote ? Boolean(quote.feeMissing) : cptFeeMissing(line.cptCode);
}

function lineChargeDollars(line: LineDraft, quote?: LineQuote) {
  const override = line.charge.trim() === '' ? NaN : Number(line.charge);
  return Number.isFinite(override) && override >= 0 ? override : scheduleDollars(line, quote);
}

function contextLabel(c: QuoteContext | null) {
  if (!c) return null;
  const parts = [c.selfPay ? 'Self-pay' : 'Insurance', ...(c.telehealth ? ['Telehealth'] : []), ...(c.child ? ['Child (under 18 on DOS)'] : [])];
  return parts.join(' · ');
}

export function NewClaimModal({ open, onClose, onCreated, actionLabel = 'Create Claim' }: Props) {
  const [clients, setClients] = useState<Array<{ id: string; name: string }>>([]);
  const [clientId, setClientId] = useState('');
  const [serviceDate, setServiceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState<LineDraft[]>(() => [newLine()]);
  const [pos, setPos] = useState('11');
  const [diagnosisCodes, setDiagnosisCodes] = useState<string[]>(['F33.1']);
  const [payer, setPayer] = useState('');
  const [memberId, setMemberId] = useState('');
  const [groupNumber, setGroupNumber] = useState('');
  const [insuranceNote, setInsuranceNote] = useState<string | null>(null);
  /** Rendering provider: a staff user with a valid NPI (picked from the practice list, never typed) */
  const [renderingUserId, setRenderingUserId] = useState('');
  const [providers, setProviders] = useState<RenderingProvider[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const byCat = useMemo(() => cptCodesByCategory(), []);
  const firstCpt = lines[0]?.cptCode ?? '90837';
  const feeCodes = useFeeScheduleCodes();
  const [feeItems, setFeeItems] = useState<FeeRow[]>([]);
  const [quotes, setQuotes] = useState<LineQuote[]>([]);
  const [quoteContext, setQuoteContext] = useState<QuoteContext | null>(null);
  /** Base CPTs only in the fee schedule (e.g. 99212, 99204, 99205) */
  const extraCodes = useMemo(() => feeCodes.filter((f) => !cptByCode(f.code)), [feeCodes]);
  const quoteKey = JSON.stringify([clientId, serviceDate, payer.trim(), pos, lines.map((l) => [l.cptCode, l.feeCode, l.modifier])]);

  useEffect(() => {
    if (!open) return;
    void fetchFeeSchedule({ activeOnly: true })
      .then((r) => setFeeItems(r.items))
      .catch(() => setFeeItems([]));
  }, [open]);

  // Fee schedule defaults for every line (variant by telehealth / self-pay / child on DOS)
  useEffect(() => {
    if (!open) return;
    const [cid, dos, py, p, ls] = JSON.parse(quoteKey) as [string, string, string, string, [string, string, string][]];
    let alive = true;
    const t = setTimeout(() => {
      quoteFees({
        clientId: cid || null,
        serviceDate: dos || null,
        payer: py || null,
        telehealth: p === '02' || p === '10' || ls.some(([, , m]) => m === '95' || m === 'GT'),
        lines: ls.map(([cpt, code]) => ({ cpt, code: code || null })),
      })
        .then((r) => {
          if (!alive) return;
          setQuotes(r.quotes);
          setQuoteContext(r.context);
        })
        .catch(() => {
          if (alive) setQuotes([]);
        });
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [open, quoteKey]);

  useEffect(() => {
    if (!open) return;
    void fetchClients()
      .then((rows) => setClients(rows.map((c) => ({ id: c.id, name: c.name }))))
      .catch(() => setClients([]));
    void fetchRenderingProviders()
      .then(setProviders)
      .catch(() => setProviders([]));
  }, [open]);

  useEffect(() => {
    setPos(defaultPosForCpt(firstCpt));
  }, [firstCpt]);

  // Insurance auto-fills from the client's chart when a client is picked.
  useEffect(() => {
    if (!clientId) {
      setInsuranceNote(null);
      return;
    }
    let active = true;
    setInsuranceNote('Loading insurance on file…');
    fetchClientInsurance(clientId)
      .then((ins) => {
        if (!active) return;
        setPayer(ins.payer || '');
        setMemberId(ins.memberId || '');
        setGroupNumber(ins.groupNumber || '');
        setInsuranceNote(
          ins.payer || ins.memberId
            ? "Filled from the client's insurance on file. Edit if this claim goes to a different payer."
            : 'No insurance on file for this client. Enter the payer and member ID.'
        );
      })
      .catch(() => {
        if (active) setInsuranceNote('Could not load insurance on file. Enter the payer and member ID.');
      });
    return () => {
      active = false;
    };
  }, [clientId]);

  const dxUsed = diagnosisCodes.slice(0, MAX_CLAIM_DX);
  const total = lines.reduce((t, l, i) => t + lineChargeDollars(l, quotes[i]), 0);
  const insuranceClaim = quoteContext ? !quoteContext.selfPay : Boolean(payer.trim());
  const selfPayOnInsurance = lines.some((_, i) => Boolean(insuranceClaim && quotes[i]?.code && !quotes[i]?.insuranceBillable));
  const canSubmit = Boolean(clientId && serviceDate && diagnosisCodes.length > 0 && lines.length > 0);

  if (!open) return null;

  const setLine = (i: number, patch: Partial<LineDraft>) =>
    setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const togglePointer = (i: number, p: number) =>
    setLines((prev) =>
      prev.map((l, j) => {
        if (j !== i) return l;
        const has = l.pointers.includes(p);
        const next = has ? l.pointers.filter((x) => x !== p) : [...l.pointers, p].sort((a, b) => a - b).slice(0, 4);
        return { ...l, pointers: next.length ? next : [1] };
      })
    );

  const submit = async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const first = lines[0];
      const mods = first.modifier ? [first.modifier] : [];
      const telehealth = pos === '02' || pos === '10' || mods.includes('95') || mods.includes('GT');
      const claim = await createManualClaim({
        clientId,
        cptCode: first.cptCode,
        diagnosisCodes,
        placeOfService: pos,
        units: first.units,
        modifiers: mods,
        telehealth,
        payer: payer || null,
        memberId: memberId || null,
        groupNumber: groupNumber || null,
        serviceDate,
        renderingUserId: renderingUserId || null,
        markReady: true,
        lines: lines.map((l) => {
          const pointers = l.pointers.filter((p) => p <= dxUsed.length);
          const override = l.charge.trim() === '' ? null : Number(l.charge);
          return {
            cptCode: l.cptCode,
            feeCode: l.feeCode || null,
            modifiers: l.modifier ? [l.modifier] : [],
            units: l.units,
            charge: override != null && Number.isFinite(override) ? override : null,
            serviceDate: l.serviceDate || serviceDate,
            diagnosisPointers: pointers.length ? pointers : [1],
          };
        }),
      });

      onCreated(claim);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not create claim');
    } finally {
      setSubmitting(false);
    }
  };

  const inputCls =
    'w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm placeholder:text-slate-500 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20';
  const cellCls =
    'w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20';

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/50 p-2 sm:p-4">
      <div className="my-2 w-full max-w-3xl rounded-xl border border-slate-200 bg-white p-4 shadow-xl sm:my-6 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">New Behavioral Health Claim</h2>
            <p className="mt-1 text-sm text-slate-500">
              Build an 837P-ready claim with one or more service lines. Insurance fills in from the client&apos;s chart.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            aria-label="Close"
          >
            <X size={20} aria-hidden />
          </button>
        </div>

        {error ? (
          <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">
            {error}
          </div>
        ) : null}

        <div className="mt-5 grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <span className="mb-1 block text-sm font-medium text-slate-700">Client Name *</span>
              <ClientCombo
                clients={clients}
                selectedId={clientId}
                onSelect={(client) => setClientId(client ? client.id : '')}
              />
            </div>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700">Date of Service *</span>
              <input
                type="date"
                value={serviceDate}
                onChange={(e) => setServiceDate(e.target.value)}
                className={inputCls}
              />
            </label>
          </div>

          <div className="relative">
            <span className="mb-1 block text-sm font-medium text-slate-700">Diagnosis ICD-10 (DSM-5) *</span>
            <IcdCombo selectedCodes={diagnosisCodes} onChange={setDiagnosisCodes} clientId={clientId || null} />
            <span className="mt-1 block text-xs text-slate-500">
              Primary first. The first {MAX_CLAIM_DX} are sent on the claim; service lines point to them by number
              {dxUsed.length ? ` (${dxUsed.map((d, i) => `${i + 1} = ${d}`).join(', ')})` : ''}.
            </span>
          </div>

          {/* Service lines */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-sm font-medium text-slate-700">Service Lines *</span>
              <button
                type="button"
                onClick={() => setLines((prev) => (prev.length >= 50 ? prev : [...prev, newLine('90785')]))}
                className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:text-blue-900"
              >
                <Plus size={13} /> Add CPT line
              </button>
            </div>
            <div className="clinic-scroll-x overflow-x-auto rounded-lg border border-slate-200">
              <div className="min-w-[680px]">
                <div className="grid grid-cols-[minmax(0,1fr)_88px_56px_88px_124px_92px_28px] gap-2 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
                  <span>CPT / HCPCS</span>
                  <span>Modifier</span>
                  <span>Units</span>
                  <span>Charge ($)</span>
                  <span>DOS</span>
                  <span>Dx pointer</span>
                  <span />
                </div>
                {lines.map((line, i) => (
                  <div
                    key={i}
                    className="grid grid-cols-[minmax(0,1fr)_88px_56px_88px_124px_92px_28px] items-center gap-2 border-t border-slate-100 px-3 py-2"
                  >
                    <select
                      value={line.cptCode}
                      onChange={(e) => setLine(i, { cptCode: e.target.value, feeCode: '' })}
                      className={cellCls}
                      aria-label={`Line ${i + 1} CPT code`}
                    >
                      {CPT_CATEGORIES.map((cat) => (
                        <optgroup key={cat} label={cat}>
                          {(byCat[cat] || []).map((c) => (
                            <option key={c.code} value={c.code}>
                              {c.code} — {c.desc} ({c.rate == null ? FEE_NOT_SET : `$${c.rate}`})
                            </option>
                          ))}
                        </optgroup>
                      ))}
                      {extraCodes.length ? (
                        <optgroup label="Practice fee schedule">
                          {extraCodes.map((c) => (
                            <option key={c.code} value={c.code}>
                              {c.code} — {c.description} ({formatCents(c.feeCents)})
                            </option>
                          ))}
                        </optgroup>
                      ) : null}
                    </select>
                    <select
                      value={line.modifier}
                      onChange={(e) => setLine(i, { modifier: e.target.value })}
                      className={cellCls}
                      aria-label={`Line ${i + 1} modifier`}
                    >
                      <option value="">None</option>
                      {MODIFIER_CODES.map((m) => (
                        <option key={m.modifier} value={m.modifier}>
                          {m.modifier} — {m.desc}
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min={1}
                      max={99}
                      value={line.units}
                      onChange={(e) => setLine(i, { units: Math.max(1, Math.min(99, Number(e.target.value) || 1)) })}
                      className={cellCls}
                      aria-label={`Line ${i + 1} units`}
                    />
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={line.charge}
                      placeholder={feeNotSet(line, quotes[i]) ? FEE_NOT_SET : scheduleDollars(line, quotes[i]).toFixed(2)}
                      onChange={(e) => setLine(i, { charge: e.target.value })}
                      className={cellCls}
                      aria-label={`Line ${i + 1} charge`}
                      title="Leave blank to use the fee schedule rate x units"
                    />
                    <input
                      type="date"
                      value={line.serviceDate}
                      onChange={(e) => setLine(i, { serviceDate: e.target.value })}
                      className={cellCls}
                      aria-label={`Line ${i + 1} date of service`}
                      title="Leave blank to use the claim date of service"
                    />
                    <div className="flex flex-wrap gap-1">
                      {Array.from({ length: Math.max(1, dxUsed.length) }, (_, k) => k + 1).map((p) => {
                        const on = line.pointers.includes(p);
                        return (
                          <button
                            key={p}
                            type="button"
                            onClick={() => togglePointer(i, p)}
                            className={`h-6 w-6 rounded-md border text-[11px] font-semibold ${
                              on
                                ? 'border-blue-600 bg-blue-600 text-white'
                                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                            }`}
                            aria-pressed={on}
                            title={dxUsed[p - 1] ? `Diagnosis ${p}: ${dxUsed[p - 1]}` : `Diagnosis ${p}`}
                          >
                            {p}
                          </button>
                        );
                      })}
                    </div>
                    <button
                      type="button"
                      onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))}
                      disabled={lines.length === 1}
                      className="flex justify-center text-slate-500 hover:text-rose-600 disabled:opacity-30"
                      aria-label={`Remove line ${i + 1}`}
                    >
                      <Trash2 size={14} />
                    </button>
                    <FeeLineRow
                      line={line}
                      quote={quotes[i]}
                      items={feeItems.filter((f) => f.baseCpt === line.cptCode)}
                      insuranceClaim={insuranceClaim}
                      onPick={(feeCode) => setLine(i, { feeCode })}
                    />
                  </div>
                ))}
              </div>
            </div>
            <span className="mt-1 block text-xs text-slate-500">
              Charge blank = practice fee schedule rate x units (variant picked by the visit; change it per line). DOS blank =
              claim date of service.
              {contextLabel(quoteContext) ? ` Visit: ${contextLabel(quoteContext)}.` : ''}
            </span>
            {selfPayOnInsurance ? (
              <div className="mt-2 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                A self-pay or non-billable fee is picked on an insurance claim. Self-pay fees never go on an 837: pick the
                insurance code, or clear the payer for a self-pay claim.
              </div>
            ) : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700">Place of Service</span>
              <select value={pos} onChange={(e) => setPos(e.target.value)} className={inputCls}>
                {POS_CODES.map((p) => (
                  <option key={p.pos} value={p.pos}>
                    {p.pos} — {p.desc}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700">Rendering Clinician (NPI)</span>
              <select value={renderingUserId} onChange={(e) => setRenderingUserId(e.target.value)} className={inputCls}>
                <option value="">{providers.length ? 'Select the clinician who provided the service' : 'No providers with an NPI on file'}</option>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — NPI {p.npi} ({p.title})
                  </option>
                ))}
              </select>
              {!providers.length && (
                <span className="mt-1 block text-xs text-slate-500">
                  Add each clinician&apos;s NPI in Billing → Payer settings → Rendering providers (or their HR profile).
                </span>
              )}
            </label>
          </div>

          <div className="rounded-lg border border-slate-200 p-3">
            <div className="grid gap-4 sm:grid-cols-3">
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-slate-700">Primary Insurance Payer</span>
                <input
                  list="new-claim-payers"
                  value={payer}
                  onChange={(e) => setPayer(e.target.value)}
                  placeholder="Start typing a payer…"
                  className={inputCls}
                />
                <datalist id="new-claim-payers">
                  {PAYER_LIST.map((p) => (
                    <option key={p.id} value={p.label}>
                      {p.group}
                    </option>
                  ))}
                </datalist>
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-slate-700">Member ID</span>
                <input value={memberId} onChange={(e) => setMemberId(e.target.value)} className={inputCls} />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-slate-700">Group #</span>
                <input value={groupNumber} onChange={(e) => setGroupNumber(e.target.value)} className={inputCls} />
              </label>
            </div>
            {insuranceNote ? <p className="mt-2 text-xs text-slate-500">{insuranceNote}</p> : null}
          </div>

          {/* Secondary (COB) claims are not supported by the claims API yet */}
          <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
            <Split size={14} className="mt-0.5 shrink-0 text-slate-500" />
            <span>
              Secondary claim splitting (COB crossover) is not available yet. Create the secondary claim
              separately after the primary payer adjudicates.
            </span>
          </div>

          <div className="rounded-lg bg-blue-50 px-4 py-3 text-sm text-slate-700">
            {lines.map((l, i) => (
              <div key={i} className="flex justify-between font-mono text-xs">
                <span>
                  Line {i + 1}: {quotes[i]?.lineCpt || l.cptCode}
                  {l.modifier ? `-${l.modifier}` : ''} x {l.units}
                  {quotes[i]?.code ? ` (fee ${quotes[i].code})` : ''}
                  {cptByCode(l.cptCode) || feeCodes.some((f) => f.code === l.cptCode) ? '' : ' (not in catalog)'}
                </span>
                <span>${lineChargeDollars(l, quotes[i]).toFixed(2)}</span>
              </div>
            ))}
            <div className="mt-1 flex justify-between border-t border-blue-100 pt-1 font-semibold text-slate-900">
              <span>Claim total ({lines.length} line{lines.length === 1 ? '' : 's'})</span>
              <span className="font-mono">${total.toFixed(2)}</span>
            </div>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className={buttonClasses({ variant: 'secondary' })}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canSubmit || submitting || selfPayOnInsurance}
            onClick={() => void submit()}
            className={buttonClasses({})}
          >
            {submitting ? 'Saving claim…' : actionLabel}
          </button>
        </div>
        <span className="sr-only">{CPT_CODES.length} codes</span>
      </div>
    </div>
  );
}

/** Fee schedule variant for one line: auto (by visit) or a specific Valant code; warnings. */
function FeeLineRow({
  line,
  quote,
  items,
  insuranceClaim,
  onPick,
}: {
  line: LineDraft;
  quote: LineQuote | undefined;
  items: FeeRow[];
  insuranceClaim: boolean;
  onPick: (feeCode: string) => void;
}) {
  const blocked = Boolean(insuranceClaim && quote?.code && !quote.insuranceBillable);
  return (
    <div className="col-span-full -mt-1 space-y-1 pb-1 text-[11px] text-slate-500">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-slate-600">Fee</span>
        {items.length ? (
          <select
            value={line.feeCode}
            onChange={(e) => onPick(e.target.value)}
            className="rounded-md border border-slate-200 px-1.5 py-0.5 text-[11px]"
            aria-label="Fee schedule variant"
          >
            <option value="">Auto (by visit)</option>
            {items.map((f) => (
              <option key={f.id} value={f.code}>
                {f.code} — {f.variantLabel} ({formatCents(f.feeCents)}){f.insuranceBillable ? '' : ' · self-pay / not billable'}
                {f.needsReview ? ' · check' : ''}
              </option>
            ))}
          </select>
        ) : null}
        {quote ? (
          <span>
            {quote.code ? `${quote.code} · ${quote.variantLabel}` : 'Built-in rate'} · {formatCents(quote.feeCents)}
            {quote.lineCpt !== line.cptCode ? ` · payer gets ${quote.lineCpt}` : ''}
          </span>
        ) : null}
      </div>
      {blocked ? <p className="font-semibold text-rose-700">Self-pay fee on an insurance claim: never sent on an 837.</p> : null}
      {quote?.warnings.map((w) => (
        <p key={w} className="flex items-start gap-1 text-amber-700">
          <AlertTriangle size={11} className="mt-0.5 shrink-0" />
          {w}
        </p>
      ))}
    </div>
  );
}
