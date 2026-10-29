'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Lightbulb, Plus, Receipt, Trash2 } from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import { Button, cx, FOCUS_RING, IconButton, inputClasses } from '@/components/ui';
import {
  MAX_ADD_ONS,
  NO_FEE_SET,
  PLACE_OF_SERVICE_OPTIONS,
  billingSectionOpenByDefault,
  normalizeCode,
  type AddOnSuggestion,
  type PlannedPlan,
} from '@/lib/appointments/plannedCodes';
import {
  applyDefaults,
  blankLine,
  dollarsToCents,
  draftFromPlan,
  quoteLines,
  type CodesDraft,
  type DraftLine,
} from '@/features/appointments/billingCodesDraft';

type Price = { code: string; chargeCents: number | null; feeCode: string | null; message: string | null };
type QuoteRes = {
  success: true;
  context: {
    defaultPrimary: string | null;
    defaultSource: 'appointment_type' | 'group' | null;
    telehealthModifiers: string[];
    telehealthNote: string | null;
    autoPlaceOfService: string;
    payerName: string | null;
    payerMapped: boolean;
    supervision: { preLicensed: boolean; supervisorId: string | null; supervisorName: string | null; payerPolicy: string | null; message: string | null };
    facility: { id: string | null; name: string | null };
  };
  prices: Price[];
  suggestions: AddOnSuggestion[];
  check: { errors: string[]; warnings: string[] };
  permissions: { canEdit: boolean; canOverrideCharge: boolean; canSetDiscount: boolean; openByDefault: boolean };
  codeOptions?: { code: string; description: string; hasFee: boolean }[];
  plan?: PlannedPlan;
};

export type BillingCodesVisit = {
  appointmentId: string | null;
  clientId: string;
  clinicianId: string;
  type: string;
  date: string;
  isVirtual: boolean;
  audioOnly: boolean;
};

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const labelCls = 'block text-xs font-medium text-slate-700';

/**
 * Booking panel "Billing codes" (Valant-style primary code, units, modifiers, add-ons, charge,
 * courtesy discount). PLANNED codes: they prefill the progress note; the signed note's codes bill.
 * Charges come from the fee schedule only ("No fee set" otherwise). Add-ons are suggestions only.
 */
export function AppointmentBillingCodes({
  visit,
  role,
  staff,
  draft,
  onDraft,
}: {
  visit: BillingCodesVisit;
  role: string | null | undefined;
  staff: { id: string; name: string }[];
  draft: CodesDraft;
  onDraft: (fn: (d: CodesDraft) => CodesDraft) => void;
}) {
  const [open, setOpen] = useState(() => billingSectionOpenByDefault(role));
  const [quote, setQuote] = useState<QuoteRes | null>(null);
  const [options, setOptions] = useState<NonNullable<QuoteRes['codeOptions']>>([]);
  const [error, setError] = useState<string | null>(null);
  const listId = useId();
  const loadedFor = useRef<string | null>(null);

  // Edit mode: load the saved plan once per appointment
  useEffect(() => {
    const id = visit.appointmentId;
    if (!id || loadedFor.current === id) return;
    loadedFor.current = id;
    let cancelled = false;
    apiJson<QuoteRes>(`/api/appointments/${encodeURIComponent(id)}/codes?options=1`)
      .then((res) => {
        if (cancelled) return;
        if (res.codeOptions) setOptions(res.codeOptions);
        const loaded = draftFromPlan(res.plan);
        onDraft(() => ({ ...loaded, canEdit: res.permissions.canEdit, canSetDiscount: res.permissions.canSetDiscount }));
      })
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : 'Could not load billing codes'));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visit.appointmentId]);

  const linesKey = JSON.stringify(quoteLines(draft));
  const needOptions = options.length === 0;
  // Quote (defaults, fees, suggestions, checks) whenever the visit or the codes change
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      apiJson<QuoteRes>('/api/appointments/codes/quote', {
        method: 'POST',
        body: JSON.stringify({
          appointmentId: visit.appointmentId,
          clientId: visit.clientId || null,
          clinicianId: visit.clinicianId || null,
          type: visit.type,
          date: visit.date || null,
          isVirtual: visit.isVirtual,
          audioOnly: visit.isVirtual && visit.audioOnly,
          lines: JSON.parse(linesKey),
          withOptions: needOptions,
        }),
      })
        .then((res) => {
          if (cancelled) return;
          setError(null);
          setQuote(res);
          if (res.codeOptions) setOptions(res.codeOptions);
          onDraft((d) => {
            const withDefaults = applyDefaults(d, { primary: res.context.defaultPrimary, telehealthModifiers: res.context.telehealthModifiers });
            const sup = !withDefaults.supervisingProviderId && res.context.supervision.preLicensed && res.context.supervision.supervisorId
              ? { supervisingProviderId: res.context.supervision.supervisorId }
              : {};
            const next = { ...withDefaults, ...sup, canEdit: res.permissions.canEdit, canSetDiscount: res.permissions.canSetDiscount };
            return JSON.stringify(next) === JSON.stringify(d) ? d : next;
          });
        })
        .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : 'Could not price the codes'));
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visit.appointmentId, visit.clientId, visit.clinicianId, visit.type, visit.date, visit.isVirtual, visit.audioOnly, linesKey]);

  const optionByCode = useMemo(() => new Map(options.map((o) => [o.code, o])), [options]);
  const priceFor = (code: string) => quote?.prices.find((p) => p.code === normalizeCode(code)) ?? null;
  const perms = quote?.permissions ?? { canEdit: draft.canEdit, canOverrideCharge: false, canSetDiscount: draft.canSetDiscount, openByDefault: false };
  const readOnly = !perms.canEdit;

  const edit = (fn: (d: CodesDraft) => CodesDraft) => onDraft((d) => ({ ...fn(d), dirty: true }));
  const setPrimary = (patch: Partial<DraftLine>, manual: { code?: boolean; mods?: boolean } = {}) =>
    edit((d) => ({
      ...d,
      primary: { ...d.primary, ...patch },
      primaryAuto: manual.code ? false : d.primaryAuto,
      modifiersAuto: manual.mods ? false : d.modifiersAuto,
    }));
  const setAddOn = (i: number, patch: Partial<DraftLine>) =>
    edit((d) => ({ ...d, addOns: d.addOns.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));

  const summary = [normalizeCode(draft.primary.code), ...draft.addOns.map((l) => normalizeCode(l.code))].filter(Boolean).join(' + ');
  const codedLines = [draft.primary, ...draft.addOns].filter((l) => normalizeCode(l.code));
  const allCharges = codedLines.map((l) => l.overrideCents ?? priceFor(l.code)?.chargeCents ?? null);
  const total = allCharges.length && allCharges.every((c) => c != null) ? allCharges.reduce((t: number, c) => t + (c ?? 0), 0) : null;
  const discountCents = dollarsToCents(draft.discount);
  const sup = quote?.context.supervision;

  const chargeCell = (line: DraftLine, onPatch: (p: Partial<DraftLine>) => void) => {
    const price = priceFor(line.code);
    const fee = price?.chargeCents ?? null;
    const overriding = line.overrideCents != null;
    return (
      <div className="min-w-0">
        <span className={labelCls}>Charge</span>
        {perms.canOverrideCharge && !readOnly ? (
          <>
            <input
              inputMode="decimal"
              aria-label={`Charge for ${normalizeCode(line.code) || 'code'}`}
              className={cx(inputClasses, 'mt-1')}
              placeholder={fee != null ? (fee / 100).toFixed(2) : NO_FEE_SET}
              value={overriding ? (line.overrideCents! / 100).toFixed(2) : fee != null ? (fee / 100).toFixed(2) : ''}
              onChange={(e) => {
                const c = dollarsToCents(e.target.value);
                onPatch({ overrideCents: c == null || Number.isNaN(c) || c === fee ? null : c });
              }}
            />
            {overriding ? (
              <input
                aria-label="Override reason"
                className={cx(inputClasses, 'mt-1')}
                placeholder="Reason for the different charge"
                maxLength={300}
                value={line.overrideReason}
                onChange={(e) => onPatch({ overrideReason: e.target.value })}
              />
            ) : null}
          </>
        ) : (
          <p className="mt-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            {overriding ? money(line.overrideCents!) : fee != null ? money(fee) : <span className="text-slate-500">{normalizeCode(line.code) ? NO_FEE_SET : '—'}</span>}
          </p>
        )}
        {price?.feeCode && !overriding ? <p className="mt-0.5 text-[11px] text-slate-500">Fee schedule {price.feeCode}</p> : null}
      </div>
    );
  };

  const modifierInputs = (line: DraftLine, onMods: (mods: string[]) => void, label: string) => (
    <fieldset className="min-w-0">
      <legend className={labelCls}>Modifiers</legend>
      <div className="mt-1 grid grid-cols-4 gap-1.5">
        {line.modifiers.map((m, i) => (
          <input
            key={i}
            aria-label={`${label} modifier ${i + 1}`}
            maxLength={2}
            disabled={readOnly}
            className={cx(inputClasses, 'px-2 text-center uppercase')}
            value={m}
            onChange={(e) => onMods(line.modifiers.map((x, j) => (j === i ? e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') : x)))}
          />
        ))}
      </div>
    </fieldset>
  );

  const codeInput = (line: DraftLine, onCode: (code: string) => void, label: string) => {
    const opt = optionByCode.get(normalizeCode(line.code));
    return (
      <label className={cx(labelCls, 'min-w-0')}>
        {label}
        <input
          list={listId}
          aria-label={label}
          disabled={readOnly}
          autoComplete="off"
          placeholder="Search code or description"
          className={cx(inputClasses, 'mt-1 uppercase')}
          value={line.code}
          onChange={(e) => onCode(e.target.value.toUpperCase().split(' ')[0].slice(0, 12))}
        />
        {opt ? <span className="mt-0.5 block truncate text-[11px] font-normal text-slate-500">{opt.description}</span> : null}
      </label>
    );
  };

  return (
    <section className="mt-4 rounded-xl border border-slate-200" aria-label="Billing codes">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={cx('flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-left', FOCUS_RING)}
      >
        <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-slate-800">
          <Receipt className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />
          Billing codes
          {summary ? <span className="truncate text-xs font-medium text-slate-500">{summary}</span> : null}
        </span>
        {open ? <ChevronDown className="h-4 w-4 text-slate-500" aria-hidden /> : <ChevronRight className="h-4 w-4 text-slate-500" aria-hidden />}
      </button>
      {open ? (
        <div className="space-y-3 border-t border-slate-200 px-3 pb-3 pt-3">
          <p className="text-xs text-slate-500">
            Planned codes prefill the provider&apos;s note. The provider can change them; the signed note&apos;s codes are what bill.
            {readOnly ? ' You can view these codes; front desk, billing or the visit’s clinician can change them.' : ''}
          </p>
          <datalist id={listId}>
            {options.map((o) => (
              <option key={o.code} value={o.code}>{`${o.code}: ${o.description}${o.hasFee ? '' : ` (${NO_FEE_SET})`}`}</option>
            ))}
          </datalist>

          {/* Primary */}
          <div className="grid gap-3 sm:grid-cols-2">
            {codeInput(draft.primary, (code) => setPrimary({ code, overrideCents: null, overrideReason: '' }, { code: true }), 'Primary code')}
            <label className={labelCls}>
              Units
              <input
                type="number"
                min={1}
                max={99}
                disabled={readOnly}
                className={cx(inputClasses, 'mt-1')}
                value={draft.primary.units}
                onChange={(e) => setPrimary({ units: Math.max(0, Math.trunc(Number(e.target.value) || 0)) })}
              />
            </label>
            {modifierInputs(draft.primary, (modifiers) => setPrimary({ modifiers }, { mods: true }), 'Primary')}
            {chargeCell(draft.primary, (p) => setPrimary(p))}
          </div>
          {quote?.context.defaultSource && draft.primaryAuto && normalizeCode(draft.primary.code) ? (
            <p className="text-[11px] text-slate-500">
              Default from the {quote.context.defaultSource === 'group' ? 'group' : 'appointment type'}.
            </p>
          ) : null}
          {quote?.context.telehealthNote && (visit.isVirtual || visit.audioOnly) ? (
            <p className="text-[11px] text-slate-500">Telehealth modifier: {quote.context.telehealthNote}</p>
          ) : null}

          {/* Add-ons */}
          {draft.addOns.map((line, i) => (
            <div key={i} className="grid gap-3 rounded-lg bg-slate-50 p-2.5 sm:grid-cols-2">
              <div className="flex min-w-0 items-end gap-2 sm:col-span-2">
                <div className="min-w-0 flex-1">
                  {codeInput(line, (code) => setAddOn(i, { code, overrideCents: null, overrideReason: '' }), `Add-on code ${i + 1}`)}
                </div>
                {!readOnly ? (
                  <IconButton
                    label={`Remove add-on ${i + 1}`}
                    icon={<Trash2 className="h-4 w-4" />}
                    onClick={() => edit((d) => ({ ...d, addOns: d.addOns.filter((_, j) => j !== i) }))}
                    className="mb-0.5 p-2 text-slate-500 hover:bg-slate-200"
                  />
                ) : null}
              </div>
              <label className={labelCls}>
                Units
                <input
                  type="number"
                  min={1}
                  max={99}
                  disabled={readOnly}
                  className={cx(inputClasses, 'mt-1')}
                  value={line.units}
                  onChange={(e) => setAddOn(i, { units: Math.max(0, Math.trunc(Number(e.target.value) || 0)) })}
                />
              </label>
              {chargeCell(line, (p) => setAddOn(i, p))}
              <div className="sm:col-span-2">{modifierInputs(line, (modifiers) => setAddOn(i, { modifiers }), `Add-on ${i + 1}`)}</div>
            </div>
          ))}
          {!readOnly && draft.addOns.length < MAX_ADD_ONS ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="secondary" icon={<Plus />} onClick={() => edit((d) => ({ ...d, addOns: [...d.addOns, blankLine()] }))}>
                Add-on code
              </Button>
              {(quote?.suggestions ?? [])
                .filter((s) => !draft.addOns.some((l) => normalizeCode(l.code) === s.code))
                .map((s) => (
                  <button
                    key={s.code}
                    type="button"
                    title={s.reason}
                    onClick={() => edit((d) => ({ ...d, addOns: [...d.addOns, blankLine(s.code)].slice(0, MAX_ADD_ONS) }))}
                    className={cx('inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100', FOCUS_RING)}
                  >
                    <Lightbulb className="h-3 w-3" aria-hidden />
                    {s.code}
                    <span className="sr-only">: {s.reason} (suggestion)</span>
                  </button>
                ))}
            </div>
          ) : null}

          {/* Visit-level */}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={labelCls}>
              Place of service
              <select
                disabled={readOnly}
                className={cx(inputClasses, 'mt-1')}
                value={draft.placeOfService}
                onChange={(e) => edit((d) => ({ ...d, placeOfService: e.target.value }))}
              >
                <option value="">Automatic ({quote?.context.autoPlaceOfService || '…'})</option>
                {PLACE_OF_SERVICE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <div className={labelCls}>
              Facility
              <p className="mt-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-normal text-slate-700">
                {quote?.context.facility.name || (visit.appointmentId ? 'Not set' : 'Set from the clinic location when booked')}
              </p>
            </div>
            {sup?.preLicensed ? (
              <label className={cx(labelCls, 'sm:col-span-2')}>
                Supervising provider (incident-to / 2310D)
                <select
                  disabled={readOnly}
                  className={cx(inputClasses, 'mt-1')}
                  value={draft.supervisingProviderId}
                  onChange={(e) => edit((d) => ({ ...d, supervisingProviderId: e.target.value }))}
                >
                  <option value="">Select supervisor…</option>
                  {sup.supervisorId && !staff.some((s) => s.id === sup.supervisorId) ? (
                    <option value={sup.supervisorId}>{sup.supervisorName || 'Supervisor on file'}</option>
                  ) : null}
                  {staff.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                {sup.message ? <span className="mt-0.5 block text-[11px] font-normal text-slate-500">{sup.message}</span> : null}
              </label>
            ) : null}
          </div>

          {perms.canSetDiscount ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={labelCls}>
                Courtesy discount ($)
                <input
                  inputMode="decimal"
                  className={cx(inputClasses, 'mt-1')}
                  value={draft.discount}
                  placeholder="0.00"
                  onChange={(e) => edit((d) => ({ ...d, discount: e.target.value }))}
                />
              </label>
              <label className={labelCls}>
                Discount note
                <input
                  className={cx(inputClasses, 'mt-1')}
                  maxLength={500}
                  value={draft.discountNote}
                  onChange={(e) => edit((d) => ({ ...d, discountNote: e.target.value }))}
                />
              </label>
            </div>
          ) : draft.discount ? (
            <p className="text-xs text-slate-600">Courtesy discount ${draft.discount} (billing, front desk or office manager can change it)</p>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2 text-xs text-slate-600">
            <span>
              Planned total: {total != null ? money(total) : summary ? NO_FEE_SET : '—'}
              {discountCents && !Number.isNaN(discountCents) && total != null ? ` · after discount ${money(Math.max(0, total - discountCents))}` : ''}
            </span>
            {quote?.context.payerName ? (
              <span className="text-slate-500">
                Payer {quote.context.payerName}
                {quote.context.payerMapped ? '' : ' (not mapped)'}
              </span>
            ) : null}
          </div>
          {quote?.check.errors.length ? (
            <ul role="alert" className="list-disc space-y-0.5 pl-5 text-xs text-rose-700">
              {quote.check.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          ) : null}
          {quote?.check.warnings.length ? (
            <ul className="list-disc space-y-0.5 pl-5 text-xs text-amber-700">
              {quote.check.warnings.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          ) : null}
          {error ? <p className="text-xs text-rose-700">{error}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
