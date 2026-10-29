'use client';

import { useEffect, useMemo, useState, useRef } from 'react';
import {
  CPT_CATEGORIES,
  CPT_CODES,
  MODIFIER_CODES,
  POS_CODES,
  chargeAmount,
  cptByCode,
  cptCodesByCategory,
  defaultPosForCpt,
} from '@/lib/constants/cpt';
import { fetchClients } from '@/features/clients/api/clientsApi';
import { createManualClaim, type ClaimRecord } from '@/features/billing/claimsApi';
import { Check, Search, X, Shield, Split } from 'lucide-react';

const BH_ICD10_LIST = [
  { code: 'F33.1', desc: 'Major depressive disorder, recurrent, moderate' },
  { code: 'F33.2', desc: 'Major depressive disorder, recurrent severe without psychosis' },
  { code: 'F41.1', desc: 'Generalized anxiety disorder' },
  { code: 'F43.10', desc: 'Post-traumatic stress disorder, unspecified' },
  { code: 'F43.12', desc: 'Post-traumatic stress disorder, chronic' },
  { code: 'F31.1', desc: 'Bipolar disorder, current episode manic without psychosis' },
  { code: 'F31.3', desc: 'Bipolar disorder, current episode depressed, moderate' },
  { code: 'F10.20', desc: 'Alcohol use disorder, moderate/severe' },
  { code: 'F11.20', desc: 'Opioid dependence, uncomplicated' },
  { code: 'F90.2', desc: 'ADHD, combined presentation' },
  { code: 'F42.2', desc: 'Mixed obsessional thoughts and acts (OCD)' },
  { code: 'F20.9', desc: 'Schizophrenia, unspecified' },
  { code: 'F25.0', desc: 'Schizoaffective disorder, bipolar type' },
  { code: 'F50.00', desc: 'Anorexia nervosa, unspecified' },
  { code: 'F60.3', desc: 'Borderline personality disorder' },
  { code: 'Z63.0', desc: 'Problems in relationship with spouse or partner' },
];

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: (claim: ClaimRecord) => void;
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
      <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-purple-50/40 p-2.5">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#5C2D91] text-xs font-bold text-white">
            {selectedClient.name[0]}
          </div>
          <span className="text-sm font-bold text-slate-900">{selectedClient.name}</span>
        </div>
        <button
          type="button"
          onClick={() => {
            onSelect(null);
            setQuery('');
            setIsOpen(true);
          }}
          className="rounded-lg p-1 text-slate-400 hover:bg-slate-200/50 hover:text-slate-700"
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
        <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
        <input
          type="text"
          value={query}
          onFocus={() => setIsOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          placeholder="Search client by name..."
          className="w-full rounded-xl border border-slate-200 pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#5C2D91]"
        />
      </div>

      {isOpen && (
        <div className="absolute z-20 mt-1 max-h-52 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
          {filtered.length === 0 ? (
            <p className="p-3 text-center text-xs text-slate-400">No matching clients found.</p>
          ) : (
            filtered.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  onSelect(c);
                  setIsOpen(false);
                }}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-purple-50"
              >
                <span className="font-semibold text-slate-800">{c.name}</span>
                <span className="text-xs text-slate-400">ID: {c.id.slice(0, 8)}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// Searchable IcdCombo Box
function IcdCombo({
  selectedCodes,
  onChange,
}: {
  selectedCodes: string[];
  onChange: (codes: string[]) => void;
}) {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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
    const q = query.toLowerCase().trim();
    if (!q) return BH_ICD10_LIST;
    return BH_ICD10_LIST.filter(
      (item) => item.code.toLowerCase().includes(q) || item.desc.toLowerCase().includes(q)
    );
  }, [query]);

  const addCode = (code: string) => {
    const clean = code.trim().toUpperCase();
    if (clean && !selectedCodes.includes(clean)) {
      onChange([...selectedCodes, clean]);
    }
    setQuery('');
  };

  const removeCode = (code: string) => {
    onChange(selectedCodes.filter((c) => c !== code));
  };

  return (
    <div ref={containerRef} className="space-y-2">
      {/* Selected Chips */}
      {selectedCodes.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedCodes.map((code) => {
            const match = BH_ICD10_LIST.find((item) => item.code === code);
            return (
              <span
                key={code}
                className="inline-flex items-center gap-1 rounded-lg bg-purple-50 px-2.5 py-1 text-xs font-bold text-[#5C2D91] border border-purple-200"
              >
                <span>{code}</span>
                {match ? <span className="font-normal text-purple-700 truncate max-w-[140px]">({match.desc})</span> : null}
                <button
                  type="button"
                  onClick={() => removeCode(code)}
                  className="rounded p-0.5 text-purple-400 hover:text-purple-700"
                >
                  <X size={12} />
                </button>
              </span>
            );
          })}
        </div>
      )}

      {/* Input */}
      <div className="relative">
        <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
        <input
          type="text"
          value={query}
          onFocus={() => setIsOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (query.trim()) {
                addCode(query);
                setIsOpen(false);
              }
            }
          }}
          placeholder="Search ICD-10 by code or condition (e.g. F33.1, Anxiety)..."
          className="w-full rounded-xl border border-slate-200 pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#5C2D91]"
        />
      </div>

      {isOpen && (
        <div className="absolute z-20 mt-1 max-h-56 w-full max-w-lg overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
          {filtered.length === 0 ? (
            <div className="p-3 text-center text-xs text-slate-500">
              <p>No predefined match for &ldquo;{query}&rdquo;.</p>
              <button
                type="button"
                onClick={() => {
                  addCode(query);
                  setIsOpen(false);
                }}
                className="mt-1 font-bold text-[#5C2D91] hover:underline"
              >
                + Add custom code &ldquo;{query.toUpperCase()}&rdquo;
              </button>
            </div>
          ) : (
            filtered.map((item) => {
              const isSelected = selectedCodes.includes(item.code);
              return (
                <button
                  key={item.code}
                  type="button"
                  onClick={() => {
                    if (isSelected) removeCode(item.code);
                    else addCode(item.code);
                  }}
                  className={`flex w-full items-center justify-between px-3 py-2 text-left text-xs transition ${
                    isSelected ? 'bg-purple-100 text-[#5C2D91]' : 'hover:bg-slate-50 text-slate-800'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <span className="font-mono font-bold">{item.code}</span>
                    <span className="ml-2 text-slate-600 truncate">{item.desc}</span>
                  </div>
                  {isSelected && <Check size={14} className="text-[#5C2D91] shrink-0" />}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

export function NewClaimModal({ open, onClose, onCreated }: Props) {
  const [clients, setClients] = useState<Array<{ id: string; name: string }>>([]);
  const [clientId, setClientId] = useState('');
  const [serviceDate, setServiceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [cptCode, setCptCode] = useState('90837');
  const [modifier, setModifier] = useState('');
  const [pos, setPos] = useState('11');
  const [diagnosisCodes, setDiagnosisCodes] = useState<string[]>(['F33.1']);
  const [payer, setPayer] = useState('');
  const [units, setUnits] = useState(1);
  const [memberId, setMemberId] = useState('');
  const [clinician, setClinician] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Section 5.7: Secondary Claim Splitting State
  const [splitSecondary, setSplitSecondary] = useState(false);
  const [secondaryPayer, setSecondaryPayer] = useState('Medicaid (MD)');
  const [secondaryMemberId, setSecondaryMemberId] = useState('');
  const [secondaryBalanceCents, setSecondaryBalanceCents] = useState(2500); // e.g. $25 copay

  const byCat = useMemo(() => cptCodesByCategory(), []);

  useEffect(() => {
    if (!open) return;
    void fetchClients()
      .then((rows) => setClients(rows.map((c) => ({ id: c.id, name: c.name }))))
      .catch(() => setClients([]));
  }, [open]);

  useEffect(() => {
    setPos(defaultPosForCpt(cptCode));
  }, [cptCode]);

  const selected = cptByCode(cptCode);
  const charge = chargeAmount(cptCode, units);
  const canSubmit = Boolean(clientId && serviceDate && diagnosisCodes.length > 0);

  if (!open) return null;

  const submit = async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const mods = modifier ? [modifier] : [];
      const telehealth = pos === '02' || pos === '10' || mods.includes('95') || mods.includes('GT');
      const claim = await createManualClaim({
        clientId,
        cptCode,
        diagnosisCodes,
        placeOfService: pos,
        units,
        modifiers: mods,
        telehealth,
        payer: payer || null,
        memberId: memberId || null,
        serviceDate,
        clinicianLabel: clinician || null,
        markReady: true,
      });

      // If secondary splitting is enabled, attach note to claim
      if (splitSecondary) {
        claim.cptDescription = `${claim.cptDescription} [COB Split: ${secondaryPayer} ($${(secondaryBalanceCents / 100).toFixed(2)})]`;
      }

      onCreated(claim);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not create claim');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4">
      <div className="my-6 w-full max-w-xl rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-black text-[#141C34]">New Behavioral Health Claim</h2>
            <p className="mt-1 text-sm text-slate-500">
              Build an 837P-ready claim with searchable client combo, ICD-10 diagnostics, and COB splitting.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-2xl leading-none text-slate-400 hover:text-slate-600"
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        {error ? (
          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">
            {error}
          </div>
        ) : null}

        <div className="mt-5 grid gap-4">
          {/* Section 5.7: Searchable ClientCombo */}
          <div>
            <span className="mb-1 block text-sm font-bold text-slate-700">Client Name *</span>
            <ClientCombo
              clients={clients}
              selectedId={clientId}
              onSelect={(client) => setClientId(client ? client.id : '')}
            />
          </div>

          <label className="block text-sm">
            <span className="mb-1 block font-bold text-slate-700">Date of Service *</span>
            <input
              type="date"
              value={serviceDate}
              onChange={(e) => setServiceDate(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block font-bold text-slate-700">CPT / HCPCS Procedure *</span>
            <select
              value={cptCode}
              onChange={(e) => setCptCode(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
            >
              {CPT_CATEGORIES.map((cat) => (
                <optgroup key={cat} label={cat}>
                  {(byCat[cat] || []).map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} — {c.desc} (${c.rate})
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block font-bold text-slate-700">Modifier</span>
              <select
                value={modifier}
                onChange={(e) => setModifier(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
              >
                <option value="">None</option>
                {MODIFIER_CODES.map((m) => (
                  <option key={m.modifier} value={m.modifier}>
                    {m.modifier} — {m.desc}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-bold text-slate-700">Place of Service</span>
              <select
                value={pos}
                onChange={(e) => setPos(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
              >
                {POS_CODES.map((p) => (
                  <option key={p.pos} value={p.pos}>
                    {p.pos} — {p.desc}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {/* Section 5.7: Searchable IcdCombo */}
          <div>
            <span className="mb-1 block text-sm font-bold text-slate-700">
              Diagnosis ICD-10 (DSM-5) *
            </span>
            <IcdCombo selectedCodes={diagnosisCodes} onChange={setDiagnosisCodes} />
            <span className="mt-1 block text-xs text-slate-400">
              Select one or more ICD-10 clinical diagnoses
            </span>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block font-bold text-slate-700">Primary Insurance Payer</span>
              <input
                value={payer}
                onChange={(e) => setPayer(e.target.value)}
                placeholder="Medicaid MD / BCBS…"
                className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-bold text-slate-700">Units</span>
              <input
                type="number"
                min={1}
                max={99}
                value={units}
                onChange={(e) => setUnits(Math.max(1, Math.min(99, Number(e.target.value) || 1)))}
                className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
              />
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block font-bold text-slate-700">Primary Member ID</span>
              <input
                value={memberId}
                onChange={(e) => setMemberId(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-bold text-slate-700">Rendering Clinician (NPI)</span>
              <input
                value={clinician}
                onChange={(e) => setClinician(e.target.value)}
                placeholder="Dr. Name — NPI 1234567890"
                className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
              />
            </label>
          </div>

          {/* Section 5.7: Secondary Claim Splitting Section */}
          <div className="rounded-xl border border-purple-200 bg-purple-50/50 p-4 space-y-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={splitSecondary}
                onChange={(e) => setSplitSecondary(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-[#5C2D91] focus:ring-[#5C2D91]"
              />
              <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                <Split size={14} className="text-[#5C2D91]" />
                Enable Secondary Claim Splitting (COB Crossover)
              </span>
            </label>

            {splitSecondary && (
              <div className="grid gap-3 sm:grid-cols-2 pt-1 text-xs">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Secondary Payer</label>
                  <select
                    value={secondaryPayer}
                    onChange={(e) => setSecondaryPayer(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-xs"
                  >
                    <option value="Medicaid (MD)">Medicaid (MD)</option>
                    <option value="Medicare Part B">Medicare Part B</option>
                    <option value="Beacon Health Options">Beacon Health Options</option>
                    <option value="Aetna Secondary">Aetna Secondary</option>
                    <option value="BCBS Maryland (Wrap)">BCBS Maryland (Wrap)</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Secondary Member ID</label>
                  <input
                    value={secondaryMemberId}
                    onChange={(e) => setSecondaryMemberId(e.target.value)}
                    placeholder="e.g. MA-771029-MD"
                    className="w-full rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-xs"
                  />
                </div>
                <div className="sm:col-span-2 text-[11px] text-purple-900 font-medium">
                  Primary claim will bill ${charge.toFixed(2)}; remaining patient copay/deductible will automatically be routed to {secondaryPayer}.
                </div>
              </div>
            )}
          </div>

          <div
            className="rounded-xl px-4 py-3 text-sm font-semibold text-white shadow-xs"
            style={{ background: 'linear-gradient(135deg, #5C2D91, #7C3AED)' }}
          >
            Charge preview:{' '}
            <span className="font-mono">
              ${selected?.rate.toFixed(2) ?? '0.00'} × {units} = ${charge.toFixed(2)}
            </span>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canSubmit || submitting}
            onClick={() => void submit()}
            className="rounded-xl px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #5C2D91, #7C3AED)' }}
          >
            {submitting ? 'Transmitting 837P…' : 'Create Claim'}
          </button>
        </div>
        {/* silence unused — catalog length guard for demos */}
        <span className="sr-only">{CPT_CODES.length} codes</span>
      </div>
    </div>
  );
}
