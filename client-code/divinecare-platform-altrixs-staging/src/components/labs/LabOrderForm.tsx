'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BookOpen, CalendarClock, Check, FlaskConical, Loader2, Plus, Printer, Search, Sparkles, X } from 'lucide-react';
import { DiagnosisAutocomplete, type SelectedDiagnosis } from '@/components/clinical/DiagnosisAutocomplete';
import { apiJson } from '@/lib/api-client';
import { LAB_CATEGORY_LABEL, findTestByKey, searchCatalog } from '@/lib/labs/catalog';
import { BILL_TO_OPTIONS, COLLECTION_SITES, PERFORMING_LABS } from '@/lib/labs/facility';
import { STANDING_INTERVAL_UNITS, describeInterval, type StandingIntervalUnit } from '@/lib/labs/standing';
import { fetchOrderContext, openRequisition, useLabCatalog, type LabOrderDto, type LabTestDef, type OrderContext } from './labClient';
import { buttonClasses, Alert } from '@/components/ui';

type Line = { key: string; name: string; codes: string[] };
type StandingPick = { label: string; testKeys: string[]; unit: StandingIntervalUnit; count: number; on: boolean };

export type LabOrderPrefill = {
  tests: { key: string | null; name: string; icd10Codes: string[] }[];
  standingOrderId?: string;
  lab?: string;
};

/**
 * Lab order form (prescribers). Test search over the org catalog (names + aliases + Valant names),
 * ICD-10 per test (medical necessity) with the client's active diagnoses suggested, priority,
 * fasting, collection site, performing lab, bill-to, manual Medicare ABN flag, medication order
 * sets (suggestions the prescriber confirms) and optional standing orders. Signed under the
 * prescriber's NPI on submit; nothing is transmitted to a lab — print the requisition.
 */
export function LabOrderForm({
  clientId: fixedClientId,
  clientName: fixedClientName,
  initialClientId,
  program,
  prefill,
  onClose,
  onPlaced,
}: {
  clientId?: string | null;
  clientName?: string | null;
  /** Preselects the patient picker (still changeable); ignored when clientId is fixed */
  initialClientId?: string | null;
  program?: 'medical';
  prefill?: LabOrderPrefill | null;
  onClose: () => void;
  onPlaced: (order: LabOrderDto) => void;
}) {
  const { catalog, catalogError } = useLabCatalog();
  const [clientId, setClientId] = useState(fixedClientId ?? initialClientId ?? '');
  const [clients, setClients] = useState<{ id: string; name: string }[] | null>(null);
  const [clientErr, setClientErr] = useState<string | null>(null);
  const [ctx, setCtx] = useState<OrderContext | null>(null);
  const [ctxErr, setCtxErr] = useState<string | null>(null);

  const [q, setQ] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [dx, setDx] = useState<SelectedDiagnosis[]>([]);
  const [priority, setPriority] = useState<'Routine' | 'STAT'>('Routine');
  const [lab, setLab] = useState<string>(prefill?.lab ?? 'QUEST');
  const [site, setSite] = useState<string>('in_office');
  const [billTo, setBillTo] = useState<string>('insurance');
  const [fasting, setFasting] = useState<boolean | null>(null);
  const [abn, setAbn] = useState(false);
  const [abnNote, setAbnNote] = useState('');
  const [notes, setNotes] = useState('');
  const [orderSetKey, setOrderSetKey] = useState<string | null>(null);
  const [standingPicks, setStandingPicks] = useState<StandingPick[]>([]);
  const [customStanding, setCustomStanding] = useState<{ on: boolean; unit: StandingIntervalUnit; count: number; endDate: string }>({ on: false, unit: 'months', count: 3, endDate: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [placed, setPlaced] = useState<LabOrderDto | null>(null);
  const [standingNote, setStandingNote] = useState<string | null>(null);

  // Client list only when the form was opened without a client (practice-wide worklist)
  useEffect(() => {
    if (fixedClientId) return;
    apiJson<{ clients: { id: string; name: string }[] }>(`/api/clients${program === 'medical' ? '?program=medical' : ''}`)
      .then((d) => {
        const list = [...d.clients].map((c) => ({ id: c.id, name: c.name })).sort((a, b) => a.name.localeCompare(b.name));
        setClients(list);
        // A preselected patient outside the user's client list is dropped (scope is enforced server side too)
        setClientId((cur) => (cur && !list.some((c) => c.id === cur) ? '' : cur));
      })
      .catch((e) => setClientErr(e instanceof Error ? e.message : 'Could not load clients'));
  }, [fixedClientId, program]);

  useEffect(() => {
    if (!clientId) {
      setCtx(null);
      return;
    }
    setCtxErr(null);
    fetchOrderContext(clientId)
      .then((c) => {
        setCtx(c);
        if (c.insurance.medicare) setBillTo('insurance');
      })
      .catch((e) => setCtxErr(e instanceof Error ? e.message : 'Could not load the client'));
  }, [clientId]);

  // Prefill from a standing order ("place the next order")
  useEffect(() => {
    if (!prefill || !catalog) return;
    const codes = [...new Set(prefill.tests.flatMap((t) => t.icd10Codes))];
    setDx(codes.map((code, i) => ({ code, description: '', isPrimary: i === 0 })));
    setLines(
      prefill.tests.map((t) => {
        const def = t.key ? findTestByKey(t.key, catalog.tests) : null;
        return { key: def?.key ?? t.key ?? t.name, name: def?.name ?? t.name, codes: t.icd10Codes };
      })
    );
  }, [prefill, catalog]);

  const tests = useMemo(() => catalog?.tests ?? [], [catalog]);
  const results = useMemo(() => (q.trim() ? searchCatalog(q, tests, 12) : []), [q, tests]);
  const defOf = (key: string) => findTestByKey(key, tests);
  const dxCodes = dx.map((d) => d.code);
  const autoFasting = lines.some((l) => defOf(l.key)?.fastingRequired);
  const fastingOn = fasting ?? autoFasting;

  const addTest = (t: LabTestDef) => {
    setLines((prev) => (prev.some((l) => l.key === t.key) ? prev : [...prev, { key: t.key, name: t.name, codes: dxCodes.slice(0, 1) }]));
    setQ('');
  };
  const removeTest = (key: string) => setLines((prev) => prev.filter((l) => l.key !== key));
  const togglePointer = (key: string, code: string) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, codes: l.codes.includes(code) ? l.codes.filter((c) => c !== code) : [...l.codes, code] } : l)));

  const setDiagnoses = (next: SelectedDiagnosis[]) => {
    const added = next.map((d) => d.code).filter((c) => !dxCodes.includes(c));
    setDx(next);
    const keep = new Set(next.map((d) => d.code));
    // A new diagnosis points at every test that has none yet; removed ones are unpointed
    setLines((prev) => prev.map((l) => ({ ...l, codes: [...l.codes.filter((c) => keep.has(c)), ...(l.codes.filter((c) => keep.has(c)).length ? [] : added.slice(0, 1))] })));
  };
  const addSuggestedDx = (code: string, description: string) => {
    if (dxCodes.includes(code)) return;
    setDiagnoses([...dx, { code, description, isPrimary: dx.length === 0 }]);
  };

  const applyOrderSet = (key: string) => {
    const set = catalog?.orderSets.find((s) => s.key === key);
    if (!set) return;
    setOrderSetKey(key);
    for (const item of set.items) {
      const def = defOf(item.testKey);
      if (def && item.defaultOn) addTest(def);
    }
    setStandingPicks(set.standing.map((s) => ({ ...s, on: false })));
  };

  const activeSet = catalog?.orderSets.find((s) => s.key === orderSetKey) ?? null;
  const missingDx = lines.filter((l) => !l.codes.length);
  const canSubmit = Boolean(clientId) && lines.length > 0 && missingDx.length === 0 && (!abn || abnNote.trim()) && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setErr(null);
    try {
      const d = await apiJson<{ order: LabOrderDto }>('/api/labs/orders', {
        method: 'POST',
        body: JSON.stringify({
          clientId,
          lab,
          priority,
          tests: lines.map((l) => ({ key: l.key, name: l.name, icd10Codes: l.codes })),
          diagnoses: dx.map((x) => ({ code: x.code, description: x.description || null })),
          fastingRequired: fastingOn,
          collectionSite: site,
          billTo,
          abnRequired: abn,
          abnNote: abn ? abnNote : null,
          clinicalNotes: notes || null,
          standingOrderId: prefill?.standingOrderId ?? null,
        }),
      });
      // Standing orders the prescriber turned on (each its own recurring schedule)
      const wanted: { testKeys: string[]; unit: StandingIntervalUnit; count: number; endDate?: string }[] = [
        ...standingPicks.filter((s) => s.on),
        ...(customStanding.on ? [{ testKeys: lines.map((l) => l.key), unit: customStanding.unit, count: customStanding.count, endDate: customStanding.endDate }] : []),
      ];
      const made: string[] = [];
      for (const s of wanted) {
        const sTests = lines.filter((l) => s.testKeys.includes(l.key));
        if (!sTests.length) continue;
        try {
          await apiJson('/api/labs/standing-orders', {
            method: 'POST',
            body: JSON.stringify({
              clientId,
              tests: sTests.map((l) => ({ key: l.key, name: l.name, icd10Codes: l.codes })),
              intervalUnit: s.unit,
              intervalCount: s.count,
              endDate: s.endDate || null,
              orderSetKey,
              lab,
            }),
          });
          made.push(`${sTests.map((t) => t.name).join(' + ')}: ${describeInterval(s.unit, s.count).toLowerCase()}`);
        } catch (e) {
          made.push(`Standing order not saved (${e instanceof Error ? e.message : 'error'})`);
        }
      }
      setStandingNote(made.length ? made.join(' · ') : null);
      setPlaced(d.order);
      onPlaced(d.order);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not place the order');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4" role="dialog" aria-modal="true" aria-label="Order labs">
      <div className="my-6 w-full min-w-0 max-w-4xl rounded-xl bg-white shadow-xs">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <FlaskConical size={18} className="text-blue-600" />
            <h2 className="text-base font-bold text-slate-900">Order labs{fixedClientName ? ` — ${fixedClientName}` : ''}</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {placed ? (
          <div className="space-y-4 px-5 py-6">
            <Alert tone="success">
              Order placed and signed under your NPI ({placed.testLines.length || placed.panels.length} test{(placed.testLines.length || placed.panels.length) === 1 ? '' : 's'}).
              It is not sent to the lab electronically — print the requisition and send it with the specimen or the patient.
            </Alert>
            {standingNote ? <p className="text-xs text-slate-600"><CalendarClock size={12} className="mr-1 inline" />Standing: {standingNote}</p> : null}
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => openRequisition(placed.id)} className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white">
                <Printer size={15} /> Print requisition
              </button>
              <button type="button" onClick={onClose} className={buttonClasses({ variant: 'secondary' })}>
                Done
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-5 px-5 py-5">
            {catalogError ? <Alert tone="danger">{catalogError}</Alert> : null}

            {!fixedClientId ? (
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-700">Patient *</label>
                {clientErr ? <p className="text-xs text-rose-700">{clientErr}. Open the patient’s chart and order from the Labs tab.</p> : null}
                <select value={clientId} onChange={(e) => setClientId(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" disabled={!clients}>
                  <option value="">{clients ? 'Select a patient…' : 'Loading patients…'}</option>
                  {(clients ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            {ctxErr ? <Alert tone="danger">{ctxErr}</Alert> : null}

            {/* Order sets */}
            {catalog ? (
              <div>
                <p className="mb-1.5 text-xs font-bold text-slate-700">Medication monitoring order sets <span className="font-normal text-slate-500">(suggestions — review each test)</span></p>
                <div className="flex flex-wrap gap-2">
                  {catalog.orderSets.map((s) => {
                    const suggested = ctx?.suggestedOrderSets.includes(s.key);
                    return (
                      <button
                        key={s.key}
                        type="button"
                        onClick={() => applyOrderSet(s.key)}
                        className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold ${orderSetKey === s.key ? 'border-blue-600 bg-blue-50 text-blue-600' : suggested ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-slate-200 text-slate-700 hover:bg-slate-50'}`}
                        title={suggested ? 'Matches an active medication' : undefined}
                      >
                        {suggested ? <Sparkles size={12} /> : null}
                        {s.name}
                      </button>
                    );
                  })}
                </div>
                {activeSet ? (
                  <div className="mt-2 rounded-xl border border-blue-100 bg-blue-50/50 p-3 text-xs text-slate-700">
                    <p className="font-semibold text-slate-900">{activeSet.name}</p>
                    <p className="mt-1">{activeSet.schedule}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {activeSet.items.map((it) => {
                        const def = defOf(it.testKey);
                        if (!def) return null;
                        const on = lines.some((l) => l.key === def.key);
                        return (
                          <button
                            key={it.testKey}
                            type="button"
                            onClick={() => (on ? removeTest(def.key) : addTest(def))}
                            className={`rounded-full border px-2 py-0.5 ${on ? 'border-blue-600 bg-white font-semibold text-blue-600' : 'border-slate-200 bg-white text-slate-600'}`}
                            title={it.note}
                          >
                            {on ? <Check size={11} className="mr-0.5 inline" /> : <Plus size={11} className="mr-0.5 inline" />}
                            {def.name}
                            {it.when === 'baseline' ? ' (baseline)' : ''}
                          </button>
                        );
                      })}
                    </div>
                    {activeSet.measurements?.length ? <p className="mt-2">Also record in Vitals: {activeSet.measurements.join(', ')}.</p> : null}
                    <details className="mt-2">
                      <summary className="cursor-pointer font-semibold text-blue-600"><BookOpen size={11} className="mr-1 inline" />Sources</summary>
                      <ul className="mt-1 list-disc space-y-0.5 pl-4">
                        {activeSet.sources.map((k) => (
                          <li key={k}>{catalog.orderSetSources[k] ?? k}</li>
                        ))}
                      </ul>
                    </details>
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* Test search */}
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-700">Add tests *</label>
              <div className="relative">
                <Search size={14} className="absolute left-3 top-2.5 text-slate-500" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search by name, alias (e.g. Depakote, LFTs, Chem 7), CPT or LOINC"
                  className="w-full rounded-xl border border-slate-200 py-2 pl-9 pr-3 text-sm"
                  aria-label="Search lab tests"
                />
                {results.length ? (
                  <ul className="absolute z-10 mt-1 max-h-72 w-full overflow-auto rounded-xl border border-slate-200 bg-white shadow-lg">
                    {results.map((t) => (
                      <li key={t.key}>
                        <button type="button" onClick={() => addTest(t)} className="flex w-full items-start justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50">
                          <span>
                            <span className="font-semibold text-slate-900">{t.name}</span>
                            {t.isPanel ? <span className="ml-1 text-[11px] text-slate-500">panel</span> : null}
                            {t.orderType === 'in_office_procedure' ? <span className="ml-1 text-[11px] text-amber-700">in-office procedure</span> : null}
                            <span className="block text-[11px] text-slate-500">
                              {LAB_CATEGORY_LABEL[t.category]}
                              {t.aliases.length ? ` · also: ${t.aliases.slice(0, 3).join(', ')}` : ''}
                            </span>
                          </span>
                          <span className="shrink-0 text-right font-mono text-[11px] text-slate-500">
                            {t.cpt ? `CPT ${t.cpt}` : 'CPT code needed'}
                            {t.fastingRequired ? <span className="block text-amber-700">fasting</span> : null}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>

            {/* Diagnoses */}
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-700">Diagnoses (ICD-10-CM) — medical necessity *</label>
              {ctx?.diagnoses.length ? (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  <span className="text-[11px] text-slate-500">Active on chart:</span>
                  {ctx.diagnoses.map((d) => (
                    <button
                      key={d.code}
                      type="button"
                      disabled={dxCodes.includes(d.code)}
                      onClick={() => addSuggestedDx(d.code, d.description)}
                      className="rounded-full border border-slate-200 px-2 py-0.5 text-[11px] text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                      title={d.source}
                    >
                      + {d.code} {d.description}
                    </button>
                  ))}
                </div>
              ) : null}
              <DiagnosisAutocomplete
                value={dx}
                onChange={setDiagnoses}
                suggestions={ctx?.diagnoses}
                requireBillable
                context={program === 'medical' ? 'primary' : 'any'}
                title="ICD-10-CM diagnoses (billable codes)"
              />
            </div>

            {/* Selected tests with per-test pointers */}
            {lines.length ? (
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full min-w-[640px] text-left text-xs">
                  <thead className="bg-slate-50 text-[11px] uppercase text-slate-500">
                    <tr>
                      <th scope="col" className="px-3 py-2">Test</th>
                      <th scope="col" className="px-3 py-2">Codes</th>
                      <th scope="col" className="px-3 py-2">Specimen / handling</th>
                      <th scope="col" className="px-3 py-2">Diagnosis pointers *</th>
                      <th scope="col" className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {lines.map((l) => {
                      const def = defOf(l.key);
                      return (
                        <tr key={l.key} className={l.codes.length ? '' : 'bg-rose-50/40'}>
                          <td className="px-3 py-2 font-semibold text-slate-900">
                            {l.name}
                            {def?.orderType === 'in_office_procedure' ? <span className="block text-[11px] font-normal text-amber-700">In-office procedure (not sent to a lab)</span> : null}
                          </td>
                          <td className="px-3 py-2 font-mono text-[11px] text-slate-600">
                            {def?.cpt ? `CPT ${def.cpt}` : <span className="text-amber-700">CPT code needed</span>}
                            {def?.loinc ? <span className="block">LOINC {def.loinc}</span> : null}
                            {def?.codeNote ? <span className="block max-w-[220px] whitespace-normal font-sans text-[11px] text-slate-500">{def.codeNote}</span> : null}
                          </td>
                          <td className="px-3 py-2 text-[11px] text-slate-600">
                            {[def?.specimenType, def?.container].filter(Boolean).join(' · ') || '—'}
                            {def?.fastingRequired ? <span className="block font-semibold text-amber-700">Fasting</span> : null}
                            {def?.specialHandling ? <span className="block max-w-[240px] whitespace-normal">{def.specialHandling}</span> : null}
                          </td>
                          <td className="px-3 py-2">
                            {dx.length ? (
                              <div className="flex flex-wrap gap-1">
                                {dx.map((d) => (
                                  <label key={d.code} className={`inline-flex cursor-pointer items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[11px] ${l.codes.includes(d.code) ? 'border-blue-600 bg-blue-50 text-blue-600' : 'border-slate-200 text-slate-500'}`}>
                                    <input type="checkbox" className="sr-only" checked={l.codes.includes(d.code)} onChange={() => togglePointer(l.key, d.code)} />
                                    {d.code}
                                  </label>
                                ))}
                              </div>
                            ) : (
                              <span className="text-[11px] text-rose-700">Add a diagnosis above</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <button type="button" onClick={() => removeTest(l.key)} className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-rose-600" aria-label={`Remove ${l.name}`}>
                              <X size={14} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <p className="border-t border-slate-100 px-3 py-1.5 text-[11px] text-slate-500">Specimen and container are typical — follow the performing lab’s directory of services.</p>
              </div>
            ) : null}

            {/* Order details */}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <label className="text-xs font-bold text-slate-700">
                Priority
                <select value={priority} onChange={(e) => setPriority(e.target.value as 'Routine' | 'STAT')} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal">
                  <option value="Routine">Routine</option>
                  <option value="STAT">STAT</option>
                </select>
              </label>
              <label className="text-xs font-bold text-slate-700">
                Performing lab
                <select value={lab} onChange={(e) => setLab(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal">
                  {PERFORMING_LABS.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-bold text-slate-700">
                Specimen collection
                <select value={site} onChange={(e) => setSite(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal">
                  {COLLECTION_SITES.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-bold text-slate-700">
                Bill to
                <select value={billTo} onChange={(e) => setBillTo(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal">
                  {BILL_TO_OPTIONS.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.label}
                    </option>
                  ))}
                </select>
                {ctx ? <span className="mt-1 block font-normal text-slate-500">Primary insurance: {ctx.insurance.payer || 'not on file'}{ctx.insurance.type ? ` (${ctx.insurance.type})` : ''}</span> : null}
              </label>
              <label className="flex items-start gap-2 pt-5 text-xs font-bold text-slate-700">
                <input type="checkbox" checked={fastingOn} onChange={(e) => setFasting(e.target.checked)} className="mt-0.5" />
                <span>
                  Fasting specimen
                  <span className="block font-normal text-slate-500">{autoFasting ? 'A selected test is ordered fasting.' : 'Nothing selected requires fasting.'}</span>
                </span>
              </label>
            </div>

            {/* ABN */}
            <div className={`rounded-xl border p-3 ${ctx?.insurance.medicare ? 'border-amber-200 bg-amber-50/60' : 'border-slate-200'}`}>
              <label className="flex items-start gap-2 text-xs font-bold text-slate-800">
                <input type="checkbox" checked={abn} onChange={(e) => setAbn(e.target.checked)} className="mt-0.5" />
                <span>
                  Medicare ABN given (Advance Beneficiary Notice)
                  <span className="block font-normal text-slate-600">
                    {ctx?.insurance.medicare ? 'Primary insurance looks like Medicare. ' : ''}Check when a test may not be covered for these diagnoses. There is no automated coverage (LCD/NCD) check — staff decide.
                  </span>
                </span>
              </label>
              {abn ? (
                <textarea value={abnNote} onChange={(e) => setAbnNote(e.target.value)} rows={2} placeholder="Which test(s) and why they may not be covered *" className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs" />
              ) : null}
            </div>

            {/* Standing */}
            <div className="rounded-xl border border-slate-200 p-3">
              <p className="mb-1 flex items-center gap-1.5 text-xs font-bold text-slate-800"><CalendarClock size={13} /> Standing / recurring order (optional)</p>
              <p className="mb-2 text-[11px] text-slate-500">Tracks the next due date and lists it on the Labs worklist. Each later order is still placed and signed by a prescriber.</p>
              {standingPicks.map((s, i) => (
                <label key={s.label} className="mb-1 flex items-center gap-2 text-xs text-slate-700">
                  <input type="checkbox" checked={s.on} onChange={(e) => setStandingPicks((prev) => prev.map((p, j) => (j === i ? { ...p, on: e.target.checked } : p)))} />
                  {s.label} <span className="text-slate-500">(from the order set)</span>
                </label>
              ))}
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-700">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={customStanding.on} onChange={(e) => setCustomStanding((p) => ({ ...p, on: e.target.checked }))} />
                  Repeat all tests on this order every
                </label>
                <input type="number" min={1} max={60} value={customStanding.count} onChange={(e) => setCustomStanding((p) => ({ ...p, count: Math.max(1, Number(e.target.value) || 1) }))} className="w-16 rounded-lg border border-slate-200 px-2 py-1" aria-label="Interval" />
                <select value={customStanding.unit} onChange={(e) => setCustomStanding((p) => ({ ...p, unit: e.target.value as StandingIntervalUnit }))} className="rounded-lg border border-slate-200 px-2 py-1" aria-label="Interval unit">
                  {STANDING_INTERVAL_UNITS.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
                <span>until</span>
                <input type="date" value={customStanding.endDate} onChange={(e) => setCustomStanding((p) => ({ ...p, endDate: e.target.value }))} className="rounded-lg border border-slate-200 px-2 py-1" aria-label="End date (optional)" />
              </div>
            </div>

            <label className="block text-xs font-bold text-slate-700">
              Clinical notes / instructions to the lab
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal" placeholder="e.g. last dose time for drug levels" />
            </label>

            {missingDx.length ? (
              <p className="flex items-center gap-1.5 text-xs text-rose-700"><AlertTriangle size={13} /> Each test needs at least one diagnosis pointer: {missingDx.map((l) => l.name).join(', ')}</p>
            ) : null}
            {err ? <Alert tone="danger">{err}</Alert> : null}

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
              <p className="text-[11px] text-slate-500">Signing places the order under your NPI. Not transmitted electronically; a requisition prints next.</p>
              <div className="flex gap-2">
                <button type="button" onClick={onClose} className={buttonClasses({ variant: 'secondary' })}>
                  Cancel
                </button>
                <button type="button" disabled={!canSubmit} onClick={() => void submit()} className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
                  {busy ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
                  Sign &amp; place order ({lines.length})
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
